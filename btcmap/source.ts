/**
 * The sync as a source tables switch on in their settings, under
 * Connections. The table's mapping says which field holds what, and what each
 * stage option means on OSM; nothing else of the table is read.
 */
import type { Connection, CrmRecord, CrmTableFields } from "@/lib/crm";
import { readLocation } from "@/lib/location";
import type { SourceFields } from "@/lib/sources";
import { canFill } from "@/lib/sources";

import type { Listing, Merchant } from "./plan";
import { LISTINGS } from "./plan";

const LINK = "link";
const STAGE = "stage";
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
  const listings = new Map<string, Listing>();
  for (const [value, option] of Object.entries(
    connection.options[STAGE] ?? {}
  )) {
    const listing = LISTINGS.find((item) => item === value);
    if (listing) {
      listings.set(option, listing);
    }
  }
  return { fields, listings };
}

function valueOf(
  record: Pick<CrmRecord, "values">,
  mapping: Mapping,
  attribute: string
): string {
  const field = mapping.fields.get(attribute);
  return field ? (record.values[field]?.[0] ?? "") : "";
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

export function merchantOf(
  record: Pick<CrmRecord, "values">,
  mapping: Mapping,
  lastVisit?: string
): Merchant {
  const pinned = readLocation(valueOf(record, mapping, NEW_LOCATION));
  return {
    address: valueOf(record, mapping, ADDRESS),
    lastVisit,
    listing: mapping.listings.get(valueOf(record, mapping, STAGE)),
    newLocation: pinned && { lat: pinned.lat, lon: pinned.lng },
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
