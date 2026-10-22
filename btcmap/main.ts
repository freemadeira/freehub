import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import { npubEncode, nsecEncode } from "applesauce-core/helpers/pointers";
import { PrivateKeySigner } from "applesauce-signers";

import type { CrmRecord, CrmTable, Field } from "@/lib/crm";
import { resolveProject } from "@/lib/crm";
import { readLocation } from "@/lib/location";
import {
  addressOf,
  COMMENT_KIND,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  DELETE_KIND,
  newer,
  PROJECT_KIND,
} from "@/lib/model";
import type { Project } from "@/lib/project";
import { parseProject } from "@/lib/project";
import { TeamRelay } from "@/lib/team-relay";
import { errorMessage } from "@/lib/utils";

import type { BtcmapConfig } from "./config";
import { loadConfig } from "./config";
import type { ElementRef, OsmElement } from "./osm";
import {
  bitcoinElements,
  fetchElement,
  nodeInUse,
  osmUrl,
  parseOsmLink,
  refKey,
} from "./osm";
import type { Merchant, Move, TagChange } from "./plan";
import { plan, relocation } from "./plan";

const TIME_ZONE = "Europe/Lisbon";
const NIGHTLY_HOUR = 23;
const DISCOVERY_HOUR = 9;
const TICK = 60_000;

interface Merchants {
  project: Project;
  table: CrmTable;
  records: CrmRecord[];
  /** Record id → YYYY-MM-DD of its newest visit. */
  lastVisit: Map<string, string>;
}

function latest(events: NostrEvent[]): NostrEvent | undefined {
  let found: NostrEvent | undefined;
  for (const event of events) {
    if (!found || newer(event, found)) {
      found = event;
    }
  }
  return found;
}

function lisbonParts(at: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
  }).formatToParts(at);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function lisbonDate(at: Date): string {
  const { year, month, day } = lisbonParts(at);
  return `${year}-${month}-${day}`;
}

async function fetchProject(
  relay: TeamRelay,
  address: string
): Promise<Project | undefined> {
  const [, creator, id] = address.split(":");
  if (!(creator && id)) {
    return undefined;
  }
  const [versions, deletions] = await Promise.all([
    relay.fetch({ "#d": [id], authors: [creator], kinds: [PROJECT_KIND] }),
    relay.fetch({ "#a": [address], authors: [creator], kinds: [DELETE_KIND] }),
  ]);
  const event = latest(versions);
  const deleted = latest(deletions);
  if (!event || (deleted && deleted.created_at >= event.created_at)) {
    return undefined;
  }
  return parseProject(event);
}

async function loadMerchants(
  relay: TeamRelay,
  config: BtcmapConfig
): Promise<Merchants> {
  const tableId = config.table.split(":").slice(2).join(":");
  const versions = await relay.fetch({
    "#d": [tableId],
    kinds: [CRM_TABLE_KIND],
  });
  const projectAddress = versions
    .map((event) => addressOf(event, PROJECT_KIND))
    .find(Boolean);
  const project = projectAddress
    ? await fetchProject(relay, projectAddress)
    : undefined;
  if (!project) {
    throw new Error(
      "Can't find the merchants table's project: check BTCMAP_TABLE and that this key's npub is whitelisted on the relay."
    );
  }
  const [tables, records, comments] = await Promise.all([
    relay.fetch({ "#a": [project.address], kinds: [CRM_TABLE_KIND] }),
    relay.fetch({ "#a": [config.table], kinds: [CRM_RECORD_KIND] }),
    relay.fetch({
      "#k": [String(CRM_RECORD_KIND)],
      authors: project.members,
      kinds: [COMMENT_KIND],
    }),
  ]);
  const content = resolveProject(project, [...tables, ...records]);
  const table = content.tables.find(({ id }) => id === tableId);
  if (!table) {
    throw new Error("The merchants table was deleted or isn't in its project.");
  }
  // Records point at the table by its creator's address, so another creator finds none.
  if (table.address !== config.table) {
    throw new Error(`BTCMAP_TABLE should be ${table.address}.`);
  }
  const lastVisit = new Map<string, number>();
  for (const event of comments) {
    if (getTagValue(event, "activity") !== "visit") {
      continue;
    }
    const [kind, , id] = (getTagValue(event, "A") ?? "").split(":");
    if (kind === String(CRM_RECORD_KIND) && id) {
      lastVisit.set(id, Math.max(lastVisit.get(id) ?? 0, event.created_at));
    }
  }
  return {
    lastVisit: new Map(
      [...lastVisit].map(([id, at]) => [id, lisbonDate(new Date(at * 1000))])
    ),
    project,
    records: content.byTable.get(table.id) ?? [],
    table,
  };
}

function fieldNamed(table: CrmTable, name: string): Field | undefined {
  const wanted = name.toLowerCase();
  return table.fields.find(
    (field) => field.name.trim().toLowerCase() === wanted
  );
}

function valueOf(record: CrmRecord, field: Field | undefined): string {
  return field ? (record.values[field.id]?.[0] ?? "") : "";
}

function describe(change: TagChange): string {
  if (change.to === undefined) {
    return `  - ${change.key}=${change.from}`;
  }
  if (change.from === undefined) {
    return `  + ${change.key}=${change.to}`;
  }
  return `  ~ ${change.key}: ${change.from} → ${change.to}`;
}

function labelOf(record: CrmRecord): string {
  return record.title || record.id;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function osmField(table: CrmTable): Field {
  const field = fieldNamed(table, "OSM link");
  if (!field) {
    throw new Error(`"${table.title}" needs an "OSM link" field.`);
  }
  return field;
}

/** The fields the sync reads: the stage and Location by type, the rest by name. */
interface MerchantFields {
  stage: Field;
  osm: Field;
  address: Field | undefined;
  location: Field | undefined;
  onBtcMap: Field | undefined;
  website: Field | undefined;
}

function merchantFields(table: CrmTable): MerchantFields {
  const stage = table.fields.find((field) => field.type === "stage");
  if (!stage) {
    throw new Error(`"${table.title}" needs a stage field.`);
  }
  return {
    address: fieldNamed(table, "Address"),
    location: table.fields.find((field) => field.type === "location"),
    onBtcMap: fieldNamed(table, "On BTC Map"),
    osm: osmField(table),
    stage,
    website: fieldNamed(table, "Website"),
  };
}

/** The record in the rules' terms, and its stage's label. */
function merchantOf(
  record: CrmRecord,
  fields: MerchantFields,
  lastVisit: string | undefined
): { merchant: Merchant; stage: string | undefined } {
  const option = fields.stage.options.find(
    ({ id }) => id === record.values[fields.stage.id]?.[0]
  );
  const stageLabel = option?.label.trim().toLowerCase();
  const pinned = readLocation(valueOf(record, fields.location));
  return {
    merchant: {
      address: valueOf(record, fields.address),
      // Only these exact labels delete or move a listing, so a renamed stage can't do it by accident.
      closed: option?.kind === "lost" && stageLabel === "closed",
      lastVisit,
      location: pinned && { lat: pinned.lat, lon: pinned.lng },
      name: record.title,
      relocated: stageLabel === "relocated",
      stage: option?.kind,
      website: valueOf(record, fields.website),
    },
    stage: option?.label,
  };
}

/** Deleting or moving a node is only safe when no way or relation uses it, so OSM is asked when either is planned. */
async function standaloneNode(
  api: string,
  ref: ElementRef,
  merchant: Merchant,
  element: OsmElement
): Promise<boolean> {
  const planned =
    merchant.closed || relocation(merchant, element, true)?.kind === "move";
  return ref.type === "node" && planned && !(await nodeInUse(api, ref));
}

function describeMove(
  label: string,
  ref: ElementRef,
  element: OsmElement,
  move: Move
): string {
  if (move.kind === "by hand") {
    return `${label}: ${osmUrl(ref)}${move.metres === undefined ? " (building outline)" : ` (${Math.round(move.metres)} m away, shared node)`}`;
  }
  const from = element.position;
  return `${label}: ${osmUrl(ref)} ${from?.lat.toFixed(6)},${from?.lon.toFixed(6)} → ${move.to.lat.toFixed(6)},${move.to.lon.toFixed(6)} (${Math.round(move.metres)} m)${move.changes.map((change) => `\n  ${describe(change)}`).join("")}`;
}

/** What a dry run found, printed at its end. */
interface Report {
  deleted: string[];
  moves: string[];
  byHand: string[];
  noLink: string[];
  badLink: string[];
  shared: string[];
  gone: string[];
  unsplit: string[];
  checkbox: string[];
  changed: number;
  unchanged: number;
  failed: number;
}

interface Run {
  config: BtcmapConfig;
  fields: MerchantFields;
  lastVisit: Map<string, string>;
  report: Report;
}

/** Compares one merchant with its OSM element and adds what would change to the report. */
async function compare(
  run: Run,
  record: CrmRecord,
  ref: ElementRef
): Promise<void> {
  const { config, report } = run;
  const label = labelOf(record);
  const { merchant, stage } = merchantOf(
    record,
    run.fields,
    run.lastVisit.get(record.id)
  );
  let element: OsmElement | "gone";
  let standalone = false;
  try {
    element = await fetchElement(config.osmApi, ref);
    if (element !== "gone") {
      standalone = await standaloneNode(config.osmApi, ref, merchant, element);
    }
  } catch (error) {
    report.failed += 1;
    console.error(`${label}: ${errorMessage(error)}`);
    return;
  }
  if (element === "gone") {
    report.gone.push(`${label}: ${osmUrl(ref)}`);
    return;
  }
  const move = relocation(merchant, element, standalone);
  if (move) {
    report[move.kind === "move" ? "moves" : "byHand"].push(
      describeMove(label, ref, element, move)
    );
  }
  const result = plan(merchant, element.tags, standalone);
  if (result.unsplitAddress) {
    report.unsplit.push(label);
  }
  const checked = valueOf(record, run.fields.onBtcMap) === "true";
  if (run.fields.onBtcMap && checked !== result.onBtcMap) {
    report.checkbox.push(
      `${label}: ${yesNo(checked)} → ${yesNo(result.onBtcMap)}`
    );
  }
  if (result.deleteElement) {
    report.deleted.push(`${label}: ${osmUrl(ref)}`);
    return;
  }
  if (result.changes.length === 0) {
    report.unchanged += 1;
    return;
  }
  report.changed += 1;
  console.log(`\n${label} [${stage ?? "no stage"}] ${osmUrl(ref)}`);
  for (const change of result.changes) {
    console.log(describe(change));
  }
}

function list(title: string, items: string[]): void {
  if (items.length > 0) {
    console.log(`\n${title} (${items.length}):`);
    for (const item of items) {
      console.log(`  ${item}`);
    }
  }
}

function printReport(report: Report): void {
  list("Closed: would be deleted from OSM", report.deleted);
  list("Relocated: would move to the pinned location", report.moves);
  list("Relocated: move by hand on OSM", report.byHand);
  list("No OSM link, skipped", report.noLink);
  list("OSM link not understood", report.badLink);
  list("OSM link on more than one record, skipped", report.shared);
  list("Deleted on OSM", report.gone);
  list("Address not split, left alone", report.unsplit);
  list('"On BTC Map" would change', report.checkbox);
  console.log(
    `\n${report.deleted.length} would be deleted, ${report.moves.length} would move, ${report.changed} would change, ${report.unchanged} already match, ${report.failed} failed to load.`
  );
}

/** Compares every merchant with its OSM element and prints what would change. Writes nothing. */
async function nightly(relay: TeamRelay, config: BtcmapConfig): Promise<void> {
  const { table, records, lastVisit } = await loadMerchants(relay, config);
  const fields = merchantFields(table);
  const report: Report = {
    badLink: [],
    byHand: [],
    changed: 0,
    checkbox: [],
    deleted: [],
    failed: 0,
    gone: [],
    moves: [],
    noLink: [],
    shared: [],
    unchanged: 0,
    unsplit: [],
  };
  const run: Run = { config, fields, lastVisit, report };
  // Records sharing an element would ask different things of it, so none of them is applied.
  const linked = Map.groupBy(records, (record) => {
    const ref = parseOsmLink(valueOf(record, fields.osm));
    return ref ? refKey(ref) : "";
  });
  console.log(
    `Dry run: ${records.length} records in "${table.title}". Nothing is written.`
  );
  for (const record of records) {
    const link = valueOf(record, fields.osm);
    const ref = parseOsmLink(link);
    if (!link) {
      report.noLink.push(labelOf(record));
    } else if (!ref) {
      report.badLink.push(`${labelOf(record)}: ${link}`);
    } else if ((linked.get(refKey(ref))?.length ?? 0) > 1) {
      report.shared.push(`${labelOf(record)}: ${osmUrl(ref)}`);
    } else {
      // oxlint-disable-next-line no-await-in-loop -- one OSM read at a time, per its usage policy
      await compare(run, record, ref);
    }
  }
  printReport(report);
}

/** Lists merchants OSM says take bitcoin in Madeira that no record links to. Writes nothing. */
async function discover(relay: TeamRelay, config: BtcmapConfig): Promise<void> {
  const [{ table, records }, elements] = await Promise.all([
    loadMerchants(relay, config),
    bitcoinElements(config.overpass),
  ]);
  const osm = osmField(table);
  const known = new Set(
    records.flatMap((record) => {
      const ref: ElementRef | undefined = parseOsmLink(valueOf(record, osm));
      return ref ? [refKey(ref)] : [];
    })
  );
  const fresh = elements.filter((element) => !known.has(refKey(element)));
  console.log(
    `Dry run: ${elements.length} bitcoin merchants on OSM in Madeira, ${fresh.length} not in "${table.title}". Nothing is written.`
  );
  for (const element of fresh.toSorted((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    console.log(
      `  ${element.name || "(no name)"}  ${osmUrl(element)}  ${element.lat.toFixed(6)},${element.lon.toFixed(6)}`
    );
  }
}

async function connect(config: BtcmapConfig): Promise<TeamRelay> {
  const pubkey = await config.signer.getPublicKey();
  const relay = new TeamRelay(config.relay, config.signer, pubkey);
  relay.start([{ "#p": [pubkey], kinds: [CRM_TABLE_KIND] }], () => {
    // The subscription only holds the connection, which Haven limits; its events aren't needed.
  });
  await relay.authenticated();
  return relay;
}

async function once(job: typeof nightly): Promise<void> {
  const config = loadConfig();
  const relay = await connect(config);
  try {
    await job(relay, config);
  } finally {
    relay.close();
  }
}

/** Nightly at 23:00 and the first Monday of each month at 09:00, Lisbon time. */
async function serve(): Promise<void> {
  const config = loadConfig();
  const relay = await connect(config);
  const done = new Set<string>();
  let running = false;
  const tick = async () => {
    const now = lisbonParts(new Date());
    const today = `${now.year}-${now.month}-${now.day}`;
    const hour = Number(now.hour);
    const jobs: [string, typeof nightly][] = [];
    if (hour === NIGHTLY_HOUR && !done.has(`nightly ${today}`)) {
      jobs.push([`nightly ${today}`, nightly]);
    }
    if (
      now.weekday === "Mon" &&
      Number(now.day) <= 7 &&
      hour === DISCOVERY_HOUR &&
      !done.has(`discover ${today}`)
    ) {
      jobs.push([`discover ${today}`, discover]);
    }
    if (running || jobs.length === 0) {
      return;
    }
    running = true;
    for (const [name, job] of jobs) {
      done.add(name);
      try {
        // oxlint-disable-next-line no-await-in-loop -- jobs share the relay and OSM's rate limit
        await job(relay, config);
      } catch (error) {
        console.error(`${name} failed: ${errorMessage(error)}`);
      }
    }
    running = false;
  };
  // A tick never throws: each job reports its own failure.
  setInterval(() => {
    tick();
  }, TICK);
  console.log(
    "Waiting for 23:00 (nightly) and the first Monday 09:00 (discovery), Lisbon time."
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
