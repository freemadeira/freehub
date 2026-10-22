/**
 * The tables that switched on a service's sources, as a service like the
 * connector finds them on the team relay. No browser APIs here.
 */
import type { Connection, CrmRecord, CrmTable } from "@/lib/crm";
import { resolveProject, resolveTables } from "@/lib/crm";
import {
  addressOf,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  DELETE_KIND,
  latest,
  PROJECT_KIND,
} from "@/lib/model";
import type { Project } from "@/lib/project";
import { parseProject } from "@/lib/project";
import type { TeamRelay } from "@/lib/team-relay";

/** A table that switched on a source of the service. */
export interface Target {
  project: Project;
  table: CrmTable;
  connection: Connection;
}

/** Longest tag value that relays built on eventstore (Haven among them) index. */
const MAX_INDEXED_TAG = 100;

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

async function projectTargets(
  relay: TeamRelay,
  address: string
): Promise<Target[]> {
  const project = await fetchProject(relay, address);
  if (!project) {
    return [];
  }
  const events = await relay.fetch(
    address.length <= MAX_INDEXED_TAG
      ? { "#a": [address], kinds: [CRM_TABLE_KIND] }
      : { authors: project.members, kinds: [CRM_TABLE_KIND] }
  );
  return resolveTables(project, events).flatMap((table) =>
    table.connections
      .filter((connection) => connection.connector === relay.pubkey)
      .map((connection) => ({ connection, project, table }))
  );
}

/** Every table whose latest version has one of the service's sources switched on. */
export async function findTargets(relay: TeamRelay): Promise<Target[]> {
  const tagged = await relay.fetch({
    "#p": [relay.pubkey],
    kinds: [CRM_TABLE_KIND],
  });
  const projects = new Set(
    tagged.flatMap((event) => addressOf(event, PROJECT_KIND) ?? [])
  );
  const targets = await Promise.all(
    [...projects].map((address) => projectTargets(relay, address))
  );
  return targets.flat();
}

/** The table's records, each at its newest version by a member or connector. */
export async function fetchRecords(
  relay: TeamRelay,
  { project, table }: Target
): Promise<CrmRecord[]> {
  const events = await relay.fetch(
    table.address.length <= MAX_INDEXED_TAG
      ? { "#a": [table.address], kinds: [CRM_RECORD_KIND] }
      : {
          authors: [...project.members, ...table.connectors],
          kinds: [CRM_RECORD_KIND],
        }
  );
  return (
    resolveProject(project, [table.event, ...events]).byTable.get(table.id) ??
    []
  );
}
