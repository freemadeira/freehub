import { describe, expect, it } from "vitest";

import type { Connection, Field } from "@/lib/crm";

import { mappingOf, merchantOf, onMapOf, osmLinkOf, SOURCE } from "./source";

const fields: Field[] = [
  { config: "", id: "title", name: "Business", options: [], type: "title" },
  {
    config: "",
    id: "journey",
    name: "Journey",
    options: [
      { color: "green", id: "yes", kind: "won", label: "Accepting bitcoin" },
      { color: "gray", id: "gone", kind: "lost", label: "Closed" },
      { color: "red", id: "no", kind: "lost", label: "Not interested" },
    ],
    type: "stage",
  },
  { config: "", id: "osm", name: "OSM link", options: [], type: "url" },
  { config: "", id: "moved", name: "New spot", options: [], type: "location" },
  { config: "", id: "notes", name: "Notes", options: [], type: "longtext" },
  { config: "", id: "box", name: "On BTC Map", options: [], type: "checkbox" },
];

const connection: Connection = {
  connector: "f".repeat(64),
  fields: {
    link: "osm",
    "new-location": "moved",
    "on-map": "box",
    stage: "journey",
    // Notes can't hold a website: the mapping is ignored.
    website: "notes",
  },
  options: { stage: { accepting: "yes", closed: "gone", unknown: "no" } },
  source: SOURCE.id,
};

describe("a table's mapping", () => {
  const mapping = mappingOf({ fields }, connection);

  it("keeps the fields that can hold their attribute", () => {
    expect([...mapping.fields]).toEqual([
      ["link", "osm"],
      ["stage", "journey"],
      ["new-location", "moved"],
      ["on-map", "box"],
    ]);
  });

  it("reads a record through it", () => {
    const record = {
      values: {
        box: ["true"],
        journey: ["gone"],
        moved: ["32.651800,-16.910000"],
        notes: ["https://cafe.example"],
        osm: ["https://www.openstreetmap.org/node/1"],
      },
    };
    expect(osmLinkOf(record, mapping)).toBe(
      "https://www.openstreetmap.org/node/1"
    );
    expect(merchantOf(record, mapping, "2026-10-20")).toEqual({
      address: "",
      lastVisit: "2026-10-20",
      listing: "closed",
      newLocation: { lat: 32.6518, lon: -16.91 },
      website: "",
    });
    expect(onMapOf(record, mapping)).toBe(true);
  });

  it("means nothing for options it doesn't map", () => {
    const record = { values: { journey: ["no"] } };
    expect(merchantOf(record, mapping).listing).toBeUndefined();
  });

  it("has no checkbox when no field holds it", () => {
    const unmapped = mappingOf({ fields }, { ...connection, fields: {} });
    expect(onMapOf({ values: { box: ["true"] } }, unmapped)).toBeUndefined();
  });
});
