import { describe, expect, it } from "vitest";

import type { OsmElement } from "./osm";
import { applyChanges, osmChange } from "./writer";

/** Ciao Pizzeria's node as OpenStreetMap had it on 2026-10-21, trimmed. */
const NODE: OsmElement = {
  id: 10_899_529_872,
  position: { lat: 32.648_808_9, lon: -16.905_947_3 },
  tags: {
    amenity: "restaurant",
    "currency:XBT": "yes",
    name: "Ciao Pizzeria",
    "payment:onchain": "yes",
  },
  type: "node",
  version: 11,
};

const WAY: OsmElement = {
  id: 42,
  nodes: [1, 2, 3, 1],
  tags: { building: "yes", name: "Café & Bar" },
  type: "way",
  version: 3,
};

describe("applyChanges", () => {
  it("sets, replaces and removes tags, leaving the rest", () => {
    expect(
      applyChanges(NODE.tags, [
        { from: "yes", key: "currency:XBT" },
        { key: "check_date:currency:XBT", to: "2026-10-22" },
      ])
    ).toEqual({
      amenity: "restaurant",
      "check_date:currency:XBT": "2026-10-22",
      name: "Ciao Pizzeria",
      "payment:onchain": "yes",
    });
  });
});

describe("osmChange", () => {
  it("deletes a node at the version it was read", () => {
    expect(osmChange(NODE, { kind: "delete" }, 7)).toBe(
      '<osmChange version="0.6"><delete><node id="10899529872" version="11" changeset="7" lat="32.6488089" lon="-16.9059473"/></delete></osmChange>'
    );
  });

  it("edits a node's tags in place", () => {
    const xml = osmChange(
      NODE,
      { changes: [{ from: "yes", key: "payment:onchain" }], kind: "edit" },
      7
    );
    expect(xml).toContain(
      '<modify><node id="10899529872" version="11" changeset="7" lat="32.6488089" lon="-16.9059473">'
    );
    expect(xml).toContain('<tag k="currency:XBT" v="yes"/>');
    expect(xml).not.toContain("payment:onchain");
  });

  it("moves a node to the new position", () => {
    const xml = osmChange(
      NODE,
      { changes: [], kind: "move", to: { lat: 32.65, lon: -16.9 } },
      7
    );
    expect(xml).toContain('lat="32.65" lon="-16.9"');
  });

  it("keeps a way's nodes and escapes values", () => {
    const xml = osmChange(
      WAY,
      { changes: [{ key: "currency:XBT", to: "yes" }], kind: "edit" },
      7
    );
    expect(xml).toContain(
      '<way id="42" version="3" changeset="7"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/>'
    );
    expect(xml).toContain('<tag k="name" v="Café &amp; Bar"/>');
  });

  it("refuses to edit a way whose nodes weren't read", () => {
    expect(() =>
      osmChange(
        { ...WAY, nodes: undefined },
        { changes: [], kind: "edit" },
        7
      )
    ).toThrow("nodes");
  });
});
