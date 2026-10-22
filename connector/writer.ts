import { createHash } from "node:crypto";

import { getTagValue } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";

import type { Target } from "@/lib/connected-tables";
import { findTargets } from "@/lib/connected-tables";
import type { CrmTable } from "@/lib/crm";
import { parseRecord, recordTemplate } from "@/lib/crm";
import {
  addressOf,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  isDeleted,
  latest,
} from "@/lib/model";
import type { SourceFields } from "@/lib/sources";
import type { TeamRelay } from "@/lib/team-relay";

import { mapItem, mergeRecord } from "./merge";
import type { Item } from "./sources/types";

export type Outcome = "created" | "updated" | "unchanged" | "deleted";

const CACHE_TTL = 30_000;

/** The same record id for the same item in the same table, every time. */
export function recordId(table: CrmTable, source: string, key: string): string {
  return createHash("sha256")
    .update(`${table.address}|${source}|${key}`)
    .digest("hex")
    .slice(0, 16);
}

/** Finds the tables that take a source's items, and writes items into them. */
export class Writer {
  private readonly relay: TeamRelay;
  private cache?: { at: number; targets: Promise<Target[]> };

  constructor(relay: TeamRelay) {
    this.relay = relay;
  }

  private get me(): string {
    return this.relay.pubkey;
  }

  /** Tables changed: look them up again next time. */
  invalidate(): void {
    this.cache = undefined;
  }

  /** Tables whose latest version has the source switched on. */
  async targets(source: string): Promise<Target[]> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_TTL) {
      this.cache = { at: Date.now(), targets: findTargets(this.relay) };
    }
    const { cache } = this;
    let targets: Target[];
    try {
      targets = await cache.targets;
    } catch (error) {
      // A failed lookup isn't kept: the next one asks the relay again.
      if (this.cache === cache) {
        this.invalidate();
      }
      throw error;
    }
    return targets.filter(({ connection }) => connection.source === source);
  }

  /** The attributes some table maps, so only those are fetched from the source. */
  static wanted(targets: Target[]): Set<string> {
    return new Set(
      targets.flatMap(({ connection }) => Object.keys(connection.fields))
    );
  }

  async write(
    target: Target,
    source: SourceFields,
    item: Item
  ): Promise<Outcome> {
    const { project, table, connection } = target;
    const id = recordId(table, source.id, item.key);
    const members = new Set(project.members);
    const events = await this.relay.fetch({
      "#d": [id],
      kinds: [CRM_RECORD_KIND],
    });
    const versions = events.filter(
      (event) =>
        (members.has(event.pubkey) || event.pubkey === this.me) &&
        getTagValue(event, "d") === id &&
        addressOf(event, CRM_TABLE_KIND) === table.address
    );
    const current = latest(versions);
    // A teammate deleted it: never bring it back.
    if (current && isDeleted(current)) {
      return "deleted";
    }
    const own = latest(versions.filter((event) => event.pubkey === this.me));
    const record = mergeRecord({
      base: own ? parseRecord(own, id, table.id) : undefined,
      current: current ? parseRecord(current, id, table.id) : undefined,
      id,
      item,
      mapped: mapItem(table, connection, source, item),
      me: this.me,
      now: unixNow(),
      table,
    });
    const template = recordTemplate(table, record);
    if (
      current &&
      JSON.stringify(template.tags) ===
        JSON.stringify(
          recordTemplate(table, parseRecord(current, id, table.id)).tags
        )
    ) {
      return "unchanged";
    }
    await this.relay.publish(template, current);
    return current ? "updated" : "created";
  }
}
