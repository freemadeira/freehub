/**
 * The sync as a source tables switch on in their settings, under
 * Connections. The table's mapping says which field holds what, and what each
 * stage option means on OSM; besides each record's title, nothing else of the
 * table is read.
 */
import { format } from "date-fns";

import type { Connection, CrmRecord, CrmTableFields } from "@/lib/crm";
import { readLocation } from "@/lib/location";
import type { SourceFields } from "@/lib/sources";
import { canFill } from "@/lib/sources";

import type { Listing, Merchant, Position } from "./plan";
import { LISTINGS } from "./plan";

const LINK = "link";
const STAGE = "stage";
const LOCATION = "location";
const NEW_LOCATION = "new-location";
const ADDRESS = "address";
const WEBSITE = "website";
const ON_MAP = "on-map";

export const SOURCE: SourceFields = {
  attributes: [
    { config: "", id: LINK, name: "OSM link", type: "url", values: [] },
    {
      config: "",
      id: STAGE,
      name: "Stage",
      type: "stage",
      values: [
        {
          color: "green",
          id: "accepting",
          kind: "won",
          label: "Accepting bitcoin",
        },
        { color: "red", id: "declined", kind: "lost", label: "Not interested" },
        { color: "gray", id: "closed", kind: "lost", label: "Closed" },
        { color: "yellow", id: "relocated", kind: "open", label: "Relocated" },
      ],
    },
    {
      config: "",
      id: LOCATION,
      name: "Location",
      type: "location",
      values: [],
    },
    {
      config: "",
      id: NEW_LOCATION,
      name: "New location",
      type: "location",
      values: [],
    },
    { config: "", id: ADDRESS, name: "Address", type: "text", values: [] },
    { config: "", id: WEBSITE, name: "Website", type: "url", values: [] },
    {
      config: "",
      id: ON_MAP,
      name: "On BTC Map",
      type: "checkbox",
      values: [],
    },
  ],
  id: "osm",
  name: "OpenStreetMap",
  type: "osm",
};

/** Where one table keeps what the sync reads. */
export interface Mapping {
  /** Attribute id to the id of the field that holds it. */
  fields: ReadonlyMap<string, string>;
  /** Stage option id to what it means on OSM. */
  listings: ReadonlyMap<string, Listing>;
  /** Labels of stage options mapped to more than one meaning, which mean nothing. */
  conflicts: string[];
}

export function mappingOf(
  table: Pick<CrmTableFields, "fields">,
  connection: Connection
): Mapping {
  const fields = new Map<string, string>();
  for (const attribute of SOURCE.attributes) {
    const field = table.fields.find(
      ({ id }) => id === connection.fields[attribute.id]
    );
    if (field && canFill(attribute, field)) {
      fields.set(attribute.id, field.id);
    }
  }
  const claims = new Map<string, Listing[]>();
  for (const [value, option] of Object.entries(
    connection.options[STAGE] ?? {}
  )) {
    const listing = LISTINGS.find((item) => item === value);
    if (listing) {
      claims.set(option, [...(claims.get(option) ?? []), listing]);
    }
  }
  const listings = new Map<string, Listing>();
  const conflicts: string[] = [];
  const stage = table.fields.find(({ id }) => id === fields.get(STAGE));
  for (const [option, [listing, ...others]] of claims) {
    if (others.length > 0) {
      conflicts.push(
        stage?.options.find(({ id }) => id === option)?.label ?? option
      );
    } else if (listing) {
      listings.set(option, listing);
    }
  }
  return { conflicts, fields, listings };
}

function valueOf(
  record: Pick<CrmRecord, "values">,
  mapping: Mapping,
  attribute: string
): string {
  const field = mapping.fields.get(attribute);
  return field ? (record.values[field]?.[0] ?? "") : "";
}

function positionOf(
  record: Pick<CrmRecord, "values">,
  mapping: Mapping,
  attribute: string
): Position | undefined {
  const pinned = readLocation(valueOf(record, mapping, attribute));
  return pinned && { lat: pinned.lat, lon: pinned.lng };
}

function day(at: number): string {
  return format(at * 1000, "yyyy-MM-dd");
}

export function linksOsm(mapping: Mapping): boolean {
  return mapping.fields.has(LINK);
}

export function osmLinkOf(
  record: Pick<CrmRecord, "values">,
  mapping: Mapping
): string {
  return valueOf(record, mapping, LINK);
}

/** The record in the rules' terms. `visits` holds when each of its visits was logged, in seconds. */
export function merchantOf(
  record: Pick<CrmRecord, "title" | "values" | "moves">,
  mapping: Mapping,
  visits: readonly number[] = []
): Merchant {
  const stage = valueOf(record, mapping, STAGE);
  // A visit from before the record took its stage didn't find what the stage says.
  const since = record.moves.findLast((move) => move.stage === stage)?.at;
  const days = visits.map(day).filter((visit) => !since || visit >= day(since));
  return {
    address: valueOf(record, mapping, ADDRESS),
    lastVisit: days.toSorted().at(-1),
    listing: mapping.listings.get(stage),
    location: positionOf(record, mapping, LOCATION),
    name: record.title,
    newLocation: positionOf(record, mapping, NEW_LOCATION),
    website: valueOf(record, mapping, WEBSITE),
  };
}

/** Whether the record's "On BTC Map" box is ticked, when a field holds it. */
export function onMapOf(
  record: Pick<CrmRecord, "values">,
  mapping: Mapping
): boolean | undefined {
  return mapping.fields.has(ON_MAP)
    ? valueOf(record, mapping, ON_MAP) === "true"
    : undefined;
}

export function listingLabel(listing: Listing | undefined): string {
  return (
    SOURCE.attributes
      .find(({ id }) => id === STAGE)
      ?.values.find(({ id }) => id === listing)?.label ?? "no stage"
  );
}
