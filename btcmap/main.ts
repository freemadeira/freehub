import { npubEncode, nsecEncode } from "applesauce-core/helpers/pointers";
import { PrivateKeySigner } from "applesauce-signers";

import { CRM_TABLE_KIND, latest, SOURCE_KIND } from "@/lib/model";
import { sourceTemplate } from "@/lib/sources";
import { TeamRelay } from "@/lib/team-relay";
import { errorMessage } from "@/lib/utils";

import type { BtcmapConfig } from "./config";
import { loadConfig } from "./config";
import type { Run } from "./schedule";
import { DISCOVERY_HOUR, dueRuns, NIGHTLY_HOUR } from "./schedule";
import { SOURCE } from "./source";
import { discover, nightly } from "./sync";

type Job = (relay: TeamRelay, config: BtcmapConfig) => Promise<void>;

const JOBS: Record<Run["job"], Job> = { discover, nightly };
const TICK = 60_000;
/** A run that failed is tried again this much later, while it's still due that day. */
const RETRY = 15 * 60_000;

/** Publishes the source when it changed, so tables can switch the sync on. */
async function describe(relay: TeamRelay): Promise<void> {
  const existing = latest(
    await relay.fetch({
      "#d": [SOURCE.id],
      authors: [relay.pubkey],
      kinds: [SOURCE_KIND],
    })
  );
  const template = sourceTemplate(SOURCE);
  if (JSON.stringify(existing?.tags) !== JSON.stringify(template.tags)) {
    await relay.publish(template, existing);
    console.log(`Published the ${SOURCE.name} source.`);
  }
}

async function connect(config: BtcmapConfig): Promise<TeamRelay> {
  const pubkey = await config.signer.getPublicKey();
  const relay = new TeamRelay(config.relay, config.signer, pubkey);
  relay.start([{ "#p": [pubkey], kinds: [CRM_TABLE_KIND] }], () => {
    // The subscription only holds the connection, which Haven limits; its events aren't needed.
  });
  await relay.authenticated();
  await describe(relay);
  return relay;
}

async function once(job: Job): Promise<void> {
  const config = loadConfig();
  const relay = await connect(config);
  try {
    await job(relay, config);
  } finally {
    relay.close();
  }
}

/** Nightly, and on the first Monday of each month when there's an area to look in. */
async function serve(): Promise<void> {
  const config = loadConfig();
  const relay = await connect(config);
  const done = new Set<string>();
  /** Run key to when it last failed. */
  const failed = new Map<string, number>();
  let running = false;
  const tick = async () => {
    const now = Date.now();
    const runs = dueRuns(new Date(now), config.area !== undefined).filter(
      ({ key }) => !done.has(key) && now - (failed.get(key) ?? 0) >= RETRY
    );
    if (running || runs.length === 0) {
      return;
    }
    running = true;
    for (const { job, key } of runs) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- jobs share the relay and OSM's rate limit
        await JOBS[job](relay, config);
        done.add(key);
      } catch (error) {
        failed.set(key, Date.now());
        console.error(`${key} failed: ${errorMessage(error)}`);
      }
    }
    running = false;
  };
  // A tick never throws: each job reports its own failure.
  setInterval(() => {
    tick();
  }, TICK);
  console.log(
    config.area
      ? `Waiting for ${NIGHTLY_HOUR}:00 (nightly) and the first Monday's ${DISCOVERY_HOUR}:00 (discovery).`
      : `Waiting for ${NIGHTLY_HOUR}:00 (nightly). Set BTCMAP_AREA for discovery.`
  );
  process.once("SIGTERM", () => {
    relay.close();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === "key") {
    // A new key for the sync: whitelist the npub on the relay, keep the nsec secret.
    const signer = new PrivateKeySigner();
    console.log(`BTCMAP_KEY=${nsecEncode(signer.key)}`);
    console.log(`npub: ${npubEncode(await signer.getPublicKey())}`);
    return;
  }
  if (command === "nightly") {
    await once(nightly);
    return;
  }
  if (command === "discover") {
    await once(discover);
    return;
  }
  if (command !== undefined) {
    throw new Error(
      `Unknown command "${command}". Use key, nightly, discover, or nothing to run on schedule.`
    );
  }
  await serve();
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
