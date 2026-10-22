import { getTagValue } from "applesauce-core/helpers/event";

import type { Target } from "@/lib/connected-tables";
import { fetchRecords, findTargets } from "@/lib/connected-tables";
import type { CrmRecord } from "@/lib/crm";
import { COMMENT_KIND, CRM_RECORD_KIND } from "@/lib/model";
import type { Project } from "@/lib/project";
import type { TeamRelay } from "@/lib/team-relay";
import { errorMessage, plural } from "@/lib/utils";

import type { BtcmapConfig } from "./config";
import type { ElementRef, OsmElement } from "./osm";
import {
  bitcoinElements,
  fetchElement,
  nodeInUse,
  osmUrl,
  parseOsmLink,
  refKey,
} from "./osm";
import type { Action, Listing, Position, TagChange } from "./plan";
import { mayDeleteOrMove, plan } from "./plan";
import type { Mapping } from "./source";
import {
  linksOsm,
  listingLabel,
  mappingOf,
  merchantOf,
  onMapOf,
  osmLinkOf,
  SOURCE,
} from "./source";

/** A table that switched the sync on, with its records. */
interface Table {
  target: Target;
  mapping: Mapping;
  /** Empty when no field holds the OSM link. */
  records: CrmRecord[];
}

/** What a dry run found in one table, printed at its end. */
interface Report {
  edits: string[];
  deleted: string[];
  moves: string[];
  byHand: string[];
  noLink: string[];
  badLink: string[];
  shared: string[];
  gone: string[];
  unreadAddress: string[];
  onMap: string[];
  unchanged: number;
  failed: number;
}

interface Run {
  config: BtcmapConfig;
  mapping: Mapping;
  /** Record id to when each of its visits was logged, in seconds. */
  visits: Map<string, number[]>;
  report: Report;
}

function labelOf(record: CrmRecord): string {
  return record.title || record.id;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function coordinates({ lat, lon }: Position): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function describe(change: TagChange): string {
  if (change.to === undefined) {
    return `- ${change.key}=${change.from}`;
  }
  if (change.from === undefined) {
    return `+ ${change.key}=${change.to}`;
  }
  return `~ ${change.key}: ${change.from} → ${change.to}`;
}

function changesBelow(changes: TagChange[]): string {
  return changes.map((change) => `\n    ${describe(change)}`).join("");
}

function refOf(record: CrmRecord, mapping: Mapping): ElementRef | undefined {
  return parseOsmLink(osmLinkOf(record, mapping));
}

/** The tables that switched the sync on, with their records. */
async function loadTables(relay: TeamRelay): Promise<Table[]> {
  const targets = await findTargets(relay);
  return Promise.all(
    targets
      .filter(({ connection }) => connection.source === SOURCE.id)
      .map(async (target) => {
        const mapping = mappingOf(target.table, target.connection);
        const records = linksOsm(mapping)
          ? await fetchRecords(relay, target)
          : [];
        return { mapping, records, target };
      })
  );
}

/** Every element the tables' records link to, with how many records link to it. */
function linkCounts(tables: Table[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { mapping, records } of tables) {
    for (const record of records) {
      const ref = refOf(record, mapping);
      if (ref) {
        counts.set(refKey(ref), (counts.get(refKey(ref)) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Record id to when each visit logged in the project was, in seconds. */
async function visitTimes(
  relay: TeamRelay,
  project: Project
): Promise<Map<string, number[]>> {
  const comments = await relay.fetch({
    "#k": [String(CRM_RECORD_KIND)],
    authors: project.members,
    kinds: [COMMENT_KIND],
  });
  const visits = new Map<string, number[]>();
  for (const event of comments) {
    const [kind, , id] = (getTagValue(event, "A") ?? "").split(":");
    if (
      getTagValue(event, "activity") === "visit" &&
      kind === String(CRM_RECORD_KIND) &&
      id
    ) {
      visits.set(id, [...(visits.get(id) ?? []), event.created_at]);
    }
  }
  return visits;
}

/** Adds what the action does to the element to the report. */
function note(
  report: Report,
  heading: string,
  action: Action,
  listing: Listing | undefined
): void {
  switch (action.kind) {
    case "keep": {
      report.unchanged += 1;
      break;
    }
    case "edit": {
      report.edits.push(
        `${heading} [${listingLabel(listing)}]${changesBelow(action.changes)}`
      );
      break;
    }
    case "delete": {
      report.deleted.push(heading);
      break;
    }
    case "move": {
      report.moves.push(
        `${heading} ${coordinates(action.from)} → ${coordinates(action.to)} (${Math.round(action.metres)} m)${changesBelow(action.changes)}`
      );
      break;
    }
    default: {
      report.byHand.push(`${heading} (${action.reason})`);
    }
  }
}

/** Compares one merchant with its OSM element and adds what would change to the report. */
async function compare(
  run: Run,
  record: CrmRecord,
  ref: ElementRef
): Promise<void> {
  const { config, mapping, report } = run;
  const label = labelOf(record);
  const merchant = merchantOf(record, mapping, run.visits.get(record.id));
  let element: OsmElement | "gone";
  let standalone = false;
  try {
    element = await fetchElement(config.osm, ref);
    if (element !== "gone" && mayDeleteOrMove(merchant, element)) {
      standalone = !(await nodeInUse(config.osm, ref));
    }
  } catch (error) {
    report.failed += 1;
    console.error(`${label}: ${errorMessage(error)}`);
    return;
  }
  const heading = `${label}: ${osmUrl(ref)}`;
  if (element === "gone") {
    report.gone.push(heading);
    return;
  }
  const result = plan(merchant, element, {
    readAddress: config.readAddress,
    standalone,
  });
  note(report, heading, result.action, merchant.listing);
  if (result.unreadAddress) {
    report.unreadAddress.push(label);
  }
  const ticked = onMapOf(record, mapping);
  if (ticked !== undefined && ticked !== result.onMap) {
    report.onMap.push(`${label}: ${yesNo(ticked)} → ${yesNo(result.onMap)}`);
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
  list("Would change", report.edits);
  list("Closed: would be deleted from OSM", report.deleted);
  list("Relocated: would move to the new location", report.moves);
  list("For a mapper to do by hand", report.byHand);
  list("No OSM link, skipped", report.noLink);
  list("OSM link not understood", report.badLink);
  list("OSM link on more than one record, skipped", report.shared);
  list("Deleted on OSM", report.gone);
  list("Address not understood, left out", report.unreadAddress);
  list('"On BTC Map" would change', report.onMap);
  console.log(
    `\n${report.edits.length} would change, ${report.deleted.length} would be deleted, ${report.moves.length} would move, ${report.byHand.length} by hand, ${report.unchanged} already match, ${report.failed} failed to load.`
  );
}

async function nightlyTable(
  relay: TeamRelay,
  config: BtcmapConfig,
  { mapping, records, target }: Table,
  links: Map<string, number>
): Promise<void> {
  const { title } = target.table;
  if (!linksOsm(mapping)) {
    console.log(
      `\n"${title}": pick its OSM link field under Connections, in the table's settings.`
    );
    return;
  }
  console.log(`\n"${title}": ${plural(records.length, "record")}.`);
  if (mapping.conflicts.length > 0) {
    console.log(
      `Stage options mapped to more than one meaning, so they change nothing: ${mapping.conflicts.join(", ")}.`
    );
  }
  const report: Report = {
    badLink: [],
    byHand: [],
    deleted: [],
    edits: [],
    failed: 0,
    gone: [],
    moves: [],
    noLink: [],
    onMap: [],
    shared: [],
    unchanged: 0,
    unreadAddress: [],
  };
  const visits = await visitTimes(relay, target.project);
  const run: Run = { config, mapping, report, visits };
  for (const record of records) {
    const link = osmLinkOf(record, mapping);
    const ref = refOf(record, mapping);
    if (!link) {
      report.noLink.push(labelOf(record));
    } else if (!ref) {
      report.badLink.push(`${labelOf(record)}: ${link}`);
    } else if ((links.get(refKey(ref)) ?? 0) > 1) {
      report.shared.push(`${labelOf(record)}: ${osmUrl(ref)}`);
    } else {
      // oxlint-disable-next-line no-await-in-loop -- one OSM read at a time, per its usage policy
      await compare(run, record, ref);
    }
  }
  printReport(report);
}

/** Compares every merchant in the tables that switched the sync on with its OSM element, and prints what would change. Writes nothing to OSM. */
export async function nightly(
  relay: TeamRelay,
  config: BtcmapConfig
): Promise<void> {
  const tables = await loadTables(relay);
  console.log(
    `Dry run, nothing is written to OSM. Tables with OpenStreetMap switched on: ${tables.length}.`
  );
  // Records sharing an element, in one table or across tables, would ask different things of it, so none of them is applied.
  const links = linkCounts(tables);
  for (const table of tables) {
    // oxlint-disable-next-line no-await-in-loop -- one table at a time keeps OSM reads paced and reports apart
    await nightlyTable(relay, config, table, links);
  }
}

/** Lists the merchants OSM says take bitcoin in the area that no record links to. Writes nothing. */
export async function discover(
  relay: TeamRelay,
  config: BtcmapConfig
): Promise<void> {
  const { area } = config;
  if (!area) {
    throw new Error("Set BTCMAP_AREA to look for merchants.");
  }
  const [tables, elements] = await Promise.all([
    loadTables(relay),
    bitcoinElements(config.osm, area),
  ]);
  const links = linkCounts(tables);
  const fresh = elements.filter((element) => !links.has(refKey(element)));
  console.log(
    `${elements.length} bitcoin merchants on OSM in the area, ${fresh.length} that no record links to.`
  );
  for (const element of fresh.toSorted((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    console.log(
      `  ${element.name || "(no name)"}  ${osmUrl(element)}  ${coordinates(element)}`
    );
  }
}
