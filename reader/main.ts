import { createServer } from "node:http";

import { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { npubEncode, nsecEncode } from "applesauce-core/helpers/pointers";
import { unixNow } from "applesauce-core/helpers/time";
import { PrivateKeySigner } from "applesauce-signers";

import type {
  Catalog,
  CatalogsContent,
  Link,
  LinkThumb,
  ReadingFields,
  SortReport,
} from "@/lib/catalogs";
import {
  MAX_LINK_CATEGORIES,
  readingTemplate,
  resolveCatalogs,
  sortReportTemplate,
} from "@/lib/catalogs";
import {
  addressOf,
  CATALOG_KIND,
  DELETE_KIND,
  isDeleted,
  LINK_KIND,
  PROJECT_KIND,
  READING_KIND,
} from "@/lib/model";
import type { Project } from "@/lib/project";
import { parseProject } from "@/lib/project";
import { TeamRelay } from "@/lib/team-relay";
import { errorMessage } from "@/lib/utils";

import { Ai } from "./ai";
import { AiError } from "./ai-error";
import { Blobs } from "./blobs";
import type { ReaderConfig } from "./config";
import { loadConfig } from "./config";
import type { LinkMeta } from "./linkmeta";
import { firstImage, readLinkMeta } from "./linkmeta";
import type { AiReading, SortCandidate } from "./reading";
import {
  parseAiReading,
  READING_INSTRUCTIONS,
  readingFields,
  readingPrompt,
  readingSchema,
  SORT_BATCH,
  SORT_INSTRUCTIONS,
  SORT_SCHEMA,
  sortMatches,
  sortPrompt,
} from "./reading";

/** How often everything is asked for again, to catch what a dropped connection missed. */
const REFRESH_INTERVAL = 10 * 60_000;
/** Asking again starts this long before the last time, in seconds, for clocks a little apart. */
const REFRESH_OVERLAP = 5 * 60;
/** Changes to a project are looked at once they settle for this long. */
const CHECK_DELAY = 1500;
/** Links read, or catalogs sorted, at once. */
const WORKERS = 2;
/** A link whose reading couldn't be saved waits this long before it's tried again. */
const RETRY_AFTER = 10 * 60_000;
/** What was deleted this long ago, in seconds, is let go: undoing it is long past. */
const GRACE = 60 * 60;
/** Suggested names from other links the model is told of, so a topic keeps one name. */
const SUGGESTED_KEPT = 20;

type Job =
  | { type: "read"; project: string; link: string }
  | {
      type: "sort";
      project: string;
      catalog: string;
      category: string;
      at: number;
    };

function jobKey(job: Job): string {
  return job.type === "read"
    ? `read:${job.link}`
    : `sort:${job.catalog}:${job.category}:${job.at}`;
}

/** Runs the task, logging rather than throwing if it fails: the next one may work. */
async function reportFailure(
  what: string,
  task: () => Promise<unknown>
): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`${what} failed: ${errorMessage(error)}`);
  }
}

/** Names the catalog's other links suggested lately, newest first. */
function suggestedIn(content: CatalogsContent, catalog: Catalog): string[] {
  const names = new Map<string, string>();
  for (const link of content.linksIn.get(catalog.id) ?? []) {
    for (const name of link.reading?.suggested ?? []) {
      names.set(name.toLowerCase(), name);
    }
    if (names.size >= SUGGESTED_KEPT) {
      break;
    }
  }
  return [...names.values()];
}

/** Links that could go under the category: read, not filed by hand, with room, and not under it. */
function sortable(
  content: CatalogsContent,
  catalog: Catalog,
  category: string
): Link[] {
  return (content.linksIn.get(catalog.id) ?? []).filter(
    (link) =>
      link.reading?.state === "ready" &&
      link.saved.edits.filed === undefined &&
      link.categories.length < MAX_LINK_CATEGORIES &&
      !link.categories.includes(category)
  );
}

class Reader {
  readonly relay: TeamRelay;
  private readonly config: ReaderConfig;
  private readonly store = new EventStore();
  private readonly ai: Ai;
  private readonly blobs?: Blobs;
  private readonly readers: ReadonlySet<string>;
  private readonly queue: Job[] = [];
  private readonly queued = new Set<string>();
  private readonly dirty = new Set<string>();
  /** Links whose reading couldn't be saved, by when, in milliseconds. */
  private readonly failed = new Map<string, number>();
  private working = 0;
  private fetchedAt = 0;
  private ready = false;
  private checkTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(config: ReaderConfig, pubkey: string) {
    this.config = config;
    this.relay = new TeamRelay(config.relay, config.signer, pubkey);
    this.readers = new Set([pubkey]);
    this.ai = new Ai({
      apiKey: config.openRouterKey,
      appName: config.appName,
      model: config.model,
      runsPerHour: config.runsPerHour,
    });
    this.blobs = config.blossom
      ? new Blobs(config.blossom, config.signer)
      : undefined;
  }

  /** Everything the reader keeps: projects, their catalogs and links, and its own notes. */
  private filters(): Filter[] {
    return [
      { kinds: [PROJECT_KIND] },
      { kinds: [CATALOG_KIND, LINK_KIND] },
      { authors: [this.relay.pubkey], kinds: [READING_KIND] },
      { "#k": [String(PROJECT_KIND)], kinds: [DELETE_KIND] },
    ];
  }

  private add(event: NostrEvent): void {
    if (!this.store.add(event) || !this.ready) {
      return;
    }
    const project =
      event.kind === PROJECT_KIND
        ? `${PROJECT_KIND}:${event.pubkey}:${getTagValue(event, "d") ?? ""}`
        : addressOf(event, PROJECT_KIND);
    if (project) {
      this.dirty.add(project);
      clearTimeout(this.checkTimer);
      this.checkTimer = setTimeout(() => this.checkDirty(), CHECK_DELAY);
    }
  }

  /** Fetches what's changed since the last time. */
  private async refresh(): Promise<number> {
    const since =
      this.fetchedAt === 0 ? undefined : this.fetchedAt - REFRESH_OVERLAP;
    const started = unixNow();
    let count = 0;
    for (const filter of this.filters()) {
      // oxlint-disable-next-line no-await-in-loop -- one filter at a time, as Haven pages them
      const events = await this.relay.fetch(
        since === undefined ? filter : { ...filter, since }
      );
      for (const event of events) {
        this.add(event);
      }
      count += events.length;
    }
    this.fetchedAt = started;
    return count;
  }

  async start(): Promise<void> {
    this.relay.start(this.filters(), (event) => this.add(event));
    await this.relay.authenticated();
    console.log(`Connected to ${this.config.relay} as ${this.relay.pubkey}`);
    console.log(`Loaded ${await this.refresh()} events`);
    console.log(
      this.ai.enabled
        ? `Reading with ${this.config.model}`
        : "No OPENROUTER_API_KEY: links get what their pages say, unsorted"
    );
    if (!this.blobs) {
      console.log("No BLOSSOM_URL: pictures stay where they are on the web");
    }
    this.ready = true;
    this.checkAll();
    setInterval(() => {
      reportFailure("Refresh", async () => {
        await this.refresh();
        this.checkAll();
      });
    }, REFRESH_INTERVAL);
  }

  private projects(): Project[] {
    return this.store
      .getByFilters({ kinds: [PROJECT_KIND] })
      .flatMap((event) => parseProject(event) ?? []);
  }

  private content(project: Project): CatalogsContent {
    return resolveCatalogs(
      project,
      this.store.getByFilters({
        "#a": [project.address],
        kinds: [CATALOG_KIND, LINK_KIND, READING_KIND],
      }),
      this.readers
    );
  }

  private checkAll(): void {
    const projects = this.projects();
    for (const project of projects) {
      this.check(project);
    }
    reportFailure("Letting go of old readings", () =>
      this.sweep(new Set(projects.map((project) => project.address)))
    );
  }

  private checkDirty(): void {
    const dirty = new Set(this.dirty);
    this.dirty.clear();
    for (const project of this.projects()) {
      if (dirty.has(project.address)) {
        this.check(project);
      }
    }
  }

  /** Queues what the project's links and catalogs are waiting for. */
  private check(project: Project): void {
    const content = this.content(project);
    const now = Date.now();
    for (const link of content.links) {
      const failedAt = this.failed.get(link.id) ?? 0;
      if (link.state === "reading" && now - failedAt > RETRY_AFTER) {
        this.enqueue({ link: link.id, project: project.address, type: "read" });
      }
    }
    for (const catalog of content.catalogs) {
      const reports = content.sorts.get(catalog.id) ?? [];
      for (const sort of catalog.sorts) {
        const report = reports.find((item) => item.category === sort.category);
        if (!report || report.at < sort.at) {
          this.enqueue({
            at: sort.at,
            catalog: catalog.id,
            category: sort.category,
            project: project.address,
            type: "sort",
          });
        }
      }
    }
  }

  private enqueue(job: Job): void {
    const key = jobKey(job);
    if (this.queued.has(key)) {
      return;
    }
    this.queued.add(key);
    this.queue.push(job);
    this.work();
  }

  private work(): void {
    while (this.working < WORKERS && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) {
        return;
      }
      this.working += 1;
      this.run(job);
    }
  }

  /** Does the job, then makes room for the next. */
  private async run(job: Job): Promise<void> {
    await reportFailure(job.type === "read" ? "Reading" : "Sorting", () =>
      job.type === "read" ? this.read(job) : this.sortCatalog(job)
    );
    this.working -= 1;
    this.queued.delete(jobKey(job));
    this.work();
  }

  private project(address: string): Project | undefined {
    return this.projects().find((project) => project.address === address);
  }

  private async picture(
    link: Link,
    images: string[]
  ): Promise<{ thumb?: LinkThumb; image?: string }> {
    if (!this.blobs) {
      return { image: images[0] };
    }
    const image = await firstImage(images);
    if (!image) {
      return {};
    }
    try {
      return { thumb: await this.blobs.upload(image) };
    } catch (error) {
      console.error(
        `A picture for ${link.url} wasn't kept: ${errorMessage(error)}`
      );
      return {};
    }
  }

  /** Reads a link: what its page says, its picture, and what the model makes of them. */
  private async read(job: Extract<Job, { type: "read" }>): Promise<void> {
    const project = this.project(job.project);
    const content = project && this.content(project);
    const link = content?.linkById.get(job.link);
    const catalog = link && content?.byId.get(link.catalog);
    if (!(project && content && link && catalog) || link.state !== "reading") {
      return;
    }
    const meta = await readLinkMeta(link.url);
    const picture = await this.picture(link, meta?.images ?? []);
    const ai = await this.ask(link, catalog, content, meta);
    const fields = readingFields(link.saved, catalog, meta, ai, picture);
    await this.keep(project, link, fields);
    console.log(`Read ${link.url}${ai ? "" : " (page only)"}: ${fields.state}`);
  }

  /** What the model makes of the link, if it can say. */
  private async ask(
    link: Link,
    catalog: Catalog,
    content: CatalogsContent,
    meta: LinkMeta | null
  ): Promise<AiReading | undefined> {
    try {
      return parseAiReading(
        await this.ai.run(link.savedBy, {
          instructions: READING_INSTRUCTIONS,
          name: "reading",
          prompt: readingPrompt(
            {
              catalog,
              categories: catalog.categories,
              note: link.note,
              suggested: suggestedIn(content, catalog),
              url: link.url,
            },
            meta
          ),
          schema: readingSchema(
            catalog.categories.map((category) => category.name)
          ),
        })
      );
    } catch (error) {
      if (!(error instanceof AiError)) {
        throw error;
      }
      if (error.reason !== "off") {
        console.error(`The model didn't read ${link.url}: ${error.message}`);
      }
      return undefined;
    }
  }

  /** Publishes the reading, and lets go of the picture it no longer shows. */
  private async keep(
    project: Project,
    link: Link,
    fields: ReadingFields
  ): Promise<void> {
    const previous = link.reading?.event;
    try {
      const published = await this.relay.publish(
        readingTemplate(project, fields),
        previous
      );
      this.store.add(published);
      this.failed.delete(link.id);
    } catch (error) {
      this.failed.set(link.id, Date.now());
      // Never saved, so nothing will show it.
      if (fields.thumb) {
        await this.blobs?.delete(fields.thumb.hash);
      }
      throw error;
    }
    const old = link.reading?.thumb?.hash;
    if (old && old !== fields.thumb?.hash) {
      await this.blobs?.delete(old);
    }
  }

  /** Files a link under the category, as sorting found it belongs, unless it changed since. */
  private async fileUnder(
    project: Project,
    catalog: string,
    linkId: string,
    category: string
  ): Promise<boolean> {
    const content = this.content(project);
    const target = content.byId.get(catalog);
    const link =
      target &&
      sortable(content, target, category).find((item) => item.id === linkId);
    const reading = link?.reading;
    if (!reading) {
      return false;
    }
    const published = await this.relay.publish(
      readingTemplate(project, {
        ...reading,
        categories: [...reading.categories, category].slice(
          0,
          MAX_LINK_CATEGORIES
        ),
      }),
      reading.event
    );
    this.store.add(published);
    return true;
  }

  /** Saves how sorting into the category went, beside how the catalog's other sortings did. */
  private async report(
    project: Project,
    catalog: string,
    report: SortReport
  ): Promise<void> {
    const previous = this.store.getReplaceable(
      READING_KIND,
      this.relay.pubkey,
      catalog
    );
    const others =
      this.content(project)
        .sorts.get(catalog)
        ?.filter((item) => item.category !== report.category) ?? [];
    const published = await this.relay.publish(
      sortReportTemplate(project, catalog, [...others, report]),
      previous
    );
    this.store.add(published);
  }

  /**
   * Checks the catalog's links for a category someone added or renamed, and
   * files those that belong. Links filed by hand are left alone.
   */
  private async sortCatalog(
    job: Extract<Job, { type: "sort" }>
  ): Promise<void> {
    const project = this.project(job.project);
    const content = project && this.content(project);
    const catalog = content?.byId.get(job.catalog);
    const category = catalog?.categories.find(
      (item) => item.id === job.category
    );
    if (!(project && content && catalog && category)) {
      return;
    }
    const base = { at: job.at, category: category.id };
    // Whoever saved the newest version asked for it.
    const asker = catalog.author;
    if (!this.ai.enabled) {
      await this.report(project, catalog.id, {
        ...base,
        ok: false,
        reason: "off",
      });
      return;
    }
    const candidates: SortCandidate[] = sortable(
      content,
      catalog,
      category.id
    ).map((link) => ({
      id: link.id,
      note: link.note,
      summary: link.summary,
      title: link.title,
    }));
    let filed = 0;
    for (let start = 0; start < candidates.length; start += SORT_BATCH) {
      const batch = candidates.slice(start, start + SORT_BATCH);
      let answer: unknown;
      try {
        // oxlint-disable-next-line no-await-in-loop -- one batch at a time, so runs don't pile up
        answer = await this.ai.run(asker, {
          instructions: SORT_INSTRUCTIONS,
          name: "sorting",
          prompt: sortPrompt(catalog, category, batch),
          schema: SORT_SCHEMA,
        });
      } catch (error) {
        if (!(error instanceof AiError)) {
          throw error;
        }
        // oxlint-disable-next-line no-await-in-loop -- the report ends the sorting
        await this.report(
          project,
          catalog.id,
          filed > 0
            ? { ...base, checked: start, filed, ok: true }
            : { ...base, ok: false, reason: error.reason }
        );
        return;
      }
      for (const match of sortMatches(answer, batch)) {
        // oxlint-disable-next-line no-await-in-loop -- each is a change of its own, paced for the relay
        if (await this.fileUnder(project, catalog.id, match.id, category.id)) {
          filed += 1;
        }
      }
    }
    await this.report(project, catalog.id, {
      ...base,
      checked: candidates.length,
      filed,
      ok: true,
    });
    console.log(
      `Sorted ${catalog.title} into ${category.name}: ${filed} of ${candidates.length}`
    );
  }

  /**
   * Lets go of readings of links deleted a while ago, or whose catalog or
   * project is gone: their pictures leave the file server, and the readings
   * the relay.
   */
  private async sweep(live: ReadonlySet<string>): Promise<void> {
    const now = unixNow();
    const readings = this.store.getByFilters({
      "#k": [String(LINK_KIND)],
      authors: [this.relay.pubkey],
      kinds: [READING_KIND],
    });
    for (const reading of readings) {
      const id = getTagValue(reading, "d");
      const project = addressOf(reading, PROJECT_KIND);
      if (
        !(id && project) ||
        isDeleted(reading) ||
        !this.gone(live, project, id, now)
      ) {
        continue;
      }
      const thumb = reading.tags.find(([name]) => name === "thumb")?.[1];
      // oxlint-disable-next-line no-await-in-loop -- one at a time, paced for the relay
      if (thumb && this.blobs && !(await this.blobs.delete(thumb))) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- one at a time, paced for the relay
      const published = await this.relay.publish(
        {
          content: "",
          kind: READING_KIND,
          tags: [
            ["d", id],
            ["a", project],
            ["k", String(LINK_KIND)],
            ["deleted"],
          ],
        },
        reading
      );
      this.store.add(published);
    }
  }

  /** Whether the link was deleted long enough ago, or its catalog or project is gone. */
  private gone(
    live: ReadonlySet<string>,
    projectAddress: string,
    id: string,
    now: number
  ): boolean {
    if (!live.has(projectAddress)) {
      return true;
    }
    const project = this.project(projectAddress);
    const content = project && this.content(project);
    if (!content || content.linkById.has(id)) {
      return false;
    }
    const versions = this.store.getByFilters({
      "#a": [projectAddress],
      "#d": [id],
      kinds: [LINK_KIND],
    });
    const [newest] = versions.toSorted((a, b) => b.created_at - a.created_at);
    if (!newest) {
      return false;
    }
    if (isDeleted(newest)) {
      return newest.created_at < now - GRACE;
    }
    // Its catalog was deleted, long enough ago.
    const catalog = getTagValue(newest, "catalog");
    const catalogs = this.store
      .getByFilters({
        "#a": [projectAddress],
        "#d": [catalog ?? ""],
        kinds: [CATALOG_KIND],
      })
      .toSorted((a, b) => b.created_at - a.created_at);
    const [latest] = catalogs;
    return (
      latest !== undefined &&
      isDeleted(latest) &&
      latest.created_at < now - GRACE
    );
  }

  stop(): void {
    clearTimeout(this.checkTimer);
    this.relay.close();
  }
}

async function serve(config: ReaderConfig): Promise<void> {
  const reader = new Reader(config, await config.signer.getPublicKey());
  await reader.start();
  // For the host's health check.
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  });
  server.listen(config.port, () => console.log(`Listening on ${config.port}`));
  process.once("SIGTERM", () => {
    server.close();
    reader.stop();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === "key") {
    // A new Nostr key for the reader: whitelist the npub, keep the nsec secret.
    const signer = new PrivateKeySigner();
    console.log(`READER_KEY=${nsecEncode(signer.key)}`);
    console.log(`npub: ${npubEncode(await signer.getPublicKey())}`);
    return;
  }
  if (command !== undefined) {
    throw new Error(`Unknown command "${command}".`);
  }
  await serve(loadConfig());
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
