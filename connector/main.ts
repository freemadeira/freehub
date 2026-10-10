import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";

import { CRM_TABLE_KIND, SOURCE_KIND } from "@/lib/model";
import { sourceTemplate, sourceTombstoneTemplate } from "@/lib/sources";
import { TeamRelay } from "@/lib/team-relay";
import { errorMessage } from "@/lib/utils";

import type { ConnectorConfig } from "./config";
import { loadConfig } from "./config";
import { createAdapter } from "./sources";
import type { Adapter, Item } from "./sources/types";
import type { Outcome } from "./writer";
import { Writer } from "./writer";

const MAX_BODY = 1024 * 1024;
const FIRST_RECONCILE = 60_000;
const RECONCILE_INTERVAL = 60 * 60_000;
/** Each reconcile looks this far back, so a missed hour or a day down is caught up. */
const RECONCILE_WINDOW = 26 * 60 * 60_000;
const ROUTE = /^\/sources\/(?<id>[a-z0-9-]+)\/?$/u;

class Connector {
  private readonly config: ConnectorConfig;
  readonly relay: TeamRelay;
  private readonly writer: Writer;
  readonly adapters: Map<string, Adapter>;
  /** Deliveries and items are written one at a time, in the order they came. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The newest change written per item, so an older copy fetched earlier can't undo it. */
  private readonly written = new Map<string, number>();

  constructor(config: ConnectorConfig, pubkey: string) {
    this.config = config;
    this.relay = new TeamRelay(config.relay, config.signer, pubkey);
    this.writer = new Writer(this.relay);
    this.adapters = new Map(
      config.sources.map((source) => [source.id, createAdapter(source)])
    );
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    const done = Promise.withResolvers<null>();
    this.queue = done.promise;
    try {
      await previous;
      return await task();
    } finally {
      done.resolve(null);
    }
  }

  /** Connects to the relay and gets each source ready, with its webhooks if asked. */
  async start(webhooks: boolean): Promise<void> {
    this.relay.start(
      [{ "#p": [this.relay.pubkey], kinds: [CRM_TABLE_KIND] }],
      () => this.writer.invalidate()
    );
    await this.relay.authenticated();
    console.log(`Connected to ${this.config.relay} as ${this.relay.pubkey}`);
    for (const adapter of this.adapters.values()) {
      const callback = `${this.config.publicUrl}/sources/${adapter.source.id}`;
      try {
        // oxlint-disable-next-line no-await-in-loop -- sources start one by one, for readable logs
        await adapter.start(webhooks ? callback : undefined);
        console.log(`${adapter.source.id}: ready`);
      } catch (error) {
        console.error(`${adapter.source.id}: ${errorMessage(error)}`);
      }
    }
  }

  /** The connector's name and its sources' manifests, when they changed. */
  async describe(): Promise<void> {
    const me = this.relay.pubkey;
    const [profiles, manifests] = await Promise.all([
      this.relay.fetch({ authors: [me], kinds: [0] }),
      this.relay.fetch({ authors: [me], kinds: [SOURCE_KIND] }),
    ]);
    const [profile] = profiles.toSorted((a, b) => b.created_at - a.created_at);
    const content = JSON.stringify({ name: this.config.name });
    if (profile?.content !== content) {
      await this.relay.publish({ content, kind: 0, tags: [] }, profile);
    }
    const byId = new Map(
      manifests.map((event) => [
        event.tags.find(([name]) => name === "d")?.[1] ?? "",
        event,
      ])
    );
    for (const adapter of this.adapters.values()) {
      const template = sourceTemplate(adapter.source);
      const existing = byId.get(adapter.source.id);
      if (JSON.stringify(existing?.tags) !== JSON.stringify(template.tags)) {
        // oxlint-disable-next-line no-await-in-loop -- publishes are paced anyway
        await this.relay.publish(template, existing);
        console.log(`${adapter.source.id}: manifest published`);
      }
    }
    // Sources taken out of the sources file leave the app's Connections.
    for (const [id, event] of byId) {
      const gone =
        !this.adapters.has(id) &&
        !event.tags.some(([name]) => name === "deleted");
      if (id && gone) {
        // oxlint-disable-next-line no-await-in-loop -- publishes are paced anyway
        await this.relay.publish(sourceTombstoneTemplate(id), event);
      }
    }
  }

  private async writeItem(adapter: Adapter, item: Item): Promise<Outcome[]> {
    const key = `${adapter.source.id}:${item.key}`;
    if (item.updatedAt < (this.written.get(key) ?? 0)) {
      return [];
    }
    const targets = await this.writer.targets(adapter.source.id);
    const outcomes: Outcome[] = [];
    for (const target of targets) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time keeps versions in order
      const outcome = await this.writer.write(target, adapter.source, item);
      if (outcome === "created" || outcome === "updated") {
        console.log(`${key} → ${target.table.title}: ${outcome}`);
      }
      outcomes.push(outcome);
    }
    this.written.set(key, Math.max(item.updatedAt, this.written.get(key) ?? 0));
    return outcomes;
  }

  /** A webhook: true once its items are written, false when it isn't genuine. */
  receive(adapter: Adapter, body: Buffer, request: IncomingMessage) {
    return this.enqueue(async () => {
      const targets = await this.writer.targets(adapter.source.id);
      const items = await adapter.receive(
        { body, headers: request.headers },
        Writer.wanted(targets)
      );
      if (items === "invalid") {
        return false;
      }
      for (const item of items) {
        // oxlint-disable-next-line no-await-in-loop -- in order
        await this.writeItem(adapter, item);
      }
      return true;
    });
  }

  /** Writes everything changed since then. Webhooks get their turn between items. */
  async catchUp(adapter: Adapter, since: Date): Promise<number> {
    const targets = await this.writer.targets(adapter.source.id);
    if (targets.length === 0) {
      return 0;
    }
    let count = 0;
    for await (const item of adapter.changedSince(
      since,
      Writer.wanted(targets)
    )) {
      await this.enqueue(() => this.writeItem(adapter, item));
      count += 1;
    }
    return count;
  }

  async reconcile(): Promise<void> {
    const since = new Date(Date.now() - RECONCILE_WINDOW);
    for (const adapter of this.adapters.values()) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- one source at a time
        await this.catchUp(adapter, since);
      } catch (error) {
        console.error(
          `${adapter.source.id}: reconcile failed: ${errorMessage(error)}`
        );
      }
    }
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  let size = 0;
  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      reject(new Error("Body too large."));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => resolve(Buffer.concat(chunks)));
  request.on("error", reject);
  return promise;
}

function answer(response: ServerResponse, status: number, text: string) {
  response.writeHead(status, { "Content-Type": "text/plain" }).end(text);
}

async function handle(
  connector: Connector,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const { pathname } = new URL(request.url ?? "/", "http://connector");
  if (request.method === "GET" && pathname === "/") {
    answer(response, 200, "ok");
    return;
  }
  const id = ROUTE.exec(pathname)?.groups?.id;
  const adapter = id ? connector.adapters.get(id) : undefined;
  if (request.method !== "POST" || !adapter) {
    answer(response, 404, "Not found");
    return;
  }
  let body: Buffer;
  try {
    body = await readBody(request);
  } catch {
    answer(response, 413, "Too large");
    return;
  }
  try {
    const genuine = await connector.receive(adapter, body, request);
    answer(response, genuine ? 200 : 401, genuine ? "ok" : "Unauthorized");
  } catch (error) {
    // The source retries, and record ids are stable, so a retry can't duplicate.
    console.error(`${adapter.source.id}: ${errorMessage(error)}`);
    answer(response, 500, "Try again");
  }
}

async function serve(connector: Connector, port: number): Promise<void> {
  await connector.start(true);
  await connector.describe();
  // Neither handling nor reconciling throws: each reports its own failures.
  const server = createServer((request, response) => {
    handle(connector, request, response);
  });
  server.listen(port, () => console.log(`Listening on ${port}`));
  const reconcile = () => {
    connector.reconcile();
  };
  setTimeout(reconcile, FIRST_RECONCILE);
  setInterval(reconcile, RECONCILE_INTERVAL);
  process.once("SIGTERM", () => {
    server.close();
    connector.relay.close();
    process.exit(0);
  });
}

/** `backfill <source> <YYYY-MM-DD>`: writes every order changed since that day. */
async function backfill(
  connector: Connector,
  id: string | undefined,
  day: string | undefined
): Promise<void> {
  const adapter = id ? connector.adapters.get(id) : undefined;
  const since = day ? new Date(day) : undefined;
  if (!(adapter && since && !Number.isNaN(since.getTime()))) {
    throw new Error(
      `Usage: node connector.js backfill <${[...connector.adapters.keys()].join("|")}> <YYYY-MM-DD>`
    );
  }
  await connector.start(false);
  const count = await connector.catchUp(adapter, since);
  console.log(`${id}: ${count} checked since ${day}`);
  connector.relay.close();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const connector = new Connector(config, await config.signer.getPublicKey());
  const [command, ...args] = process.argv.slice(2);
  if (command === "backfill") {
    await backfill(connector, args[0], args[1]);
    process.exit(0);
  } else if (command === undefined) {
    await serve(connector, config.port);
  } else {
    throw new Error(`Unknown command "${command}".`);
  }
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
