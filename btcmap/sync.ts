import { getTagValue } from "applesauce-core/helpers/event";
import { format } from "date-fns";

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
  /** Record id to the YYYY-MM-DD of its newest visit. */
  visits: Map<string, string>;
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

/** The tables that switched the sync on. */
async function osmTargets(relay: TeamRelay): Promise<Target[]> {
  const targets = await findTargets(relay);
  return targets.filter(({ connection }) => connection.source === SOURCE.id);
}

/** Record id to the YYYY-MM-DD of its newest visit, from the visits logged in the project. */
async function lastVisits(
  relay: TeamRelay,
  project: Project
): Promise<Map<string, string>> {
  const comments = await relay.fetch({
    "#k": [String(CRM_RECORD_KIND)],
    authors: project.members,
    kinds: [COMMENT_KIND],
  });
  const newest = new Map<string, number>();
  for (const event of comments) {
    const [kind, , id] = (getTagValue(event, "A") ?? "").split(":");
    if (
      getTagValue(event, "activity") === "visit" &&
      kind === String(CRM_RECORD_KIND) &&
      id
    ) {
      newest.set(id, Math.max(newest.get(id) ?? 0, event.created_at));
    }
  }
  return new Map(
    [...newest].map(([id, at]) => [id, format(at * 1000, "yyyy-MM-dd")])
  );
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
    element = await fetchElement(config.osmApi, ref);
    if (element !== "gone" && mayDeleteOrMove(merchant, element)) {
      standalone = !(await nodeInUse(config.osmApi, ref));
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
  target: Target
): Promise<void> {
  const { table } = target;
  const mapping = mappingOf(table, target.connection);
  if (!linksOsm(mapping)) {
    console.log(
      `\n"${table.title}": pick its OSM link field under Connections, in the table's settings.`
    );
    return;
  }
  const [records, visits] = await Promise.all([
    fetchRecords(relay, target),
    lastVisits(relay, target.project),
  ]);
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
  const run: Run = { config, mapping, report, visits };
  // Records sharing an element would ask different things of it, so none of them is applied.
  const linked = Map.groupBy(records, (record) => {
    const ref = refOf(record, mapping);
    return ref ? refKey(ref) : "";
  });
  console.log(`\n"${table.title}": ${plural(records.length, "record")}.`);
  for (const record of records) {
    const link = osmLinkOf(record, mapping);
    const ref = refOf(record, mapping);
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

/** Compares every merchant in the tables that switched the sync on with its OSM element, and prints what would change. Writes nothing to OSM. */
export async function nightly(
  relay: TeamRelay,
  config: BtcmapConfig
): Promise<void> {
  const targets = await osmTargets(relay);
  console.log(
    `Dry run, nothing is written to OSM. Tables with OpenStreetMap switched on: ${targets.length}.`
  );
  for (const target of targets) {
    // oxlint-disable-next-line no-await-in-loop -- one table at a time keeps OSM reads paced and reports apart
    await nightlyTable(relay, config, target);
  }
}

async function linkedElements(
  relay: TeamRelay,
  target: Target
): Promise<string[]> {
  const mapping = mappingOf(target.table, target.connection);
  const records = await fetchRecords(relay, target);
  return records.flatMap((record) => {
    const ref = refOf(record, mapping);
    return ref ? [refKey(ref)] : [];
  });
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
  const [targets, elements] = await Promise.all([
    osmTargets(relay),
    bitcoinElements(config.overpass, area),
  ]);
  const linked = await Promise.all(
    targets.map((target) => linkedElements(relay, target))
  );
  const known = new Set(linked.flat());
  const fresh = elements.filter((element) => !known.has(refKey(element)));
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
