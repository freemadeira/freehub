import { describe, expect, it } from "vitest";

import { ADDRESS_FORMATS } from "./addresses";
import type { Context, Element, Merchant } from "./plan";
import { mayDeleteOrMove, plan } from "./plan";

const PIN = { lat: 32.65, lon: -16.91 };
/** About 200 m north of PIN. */
const NEW_PIN = { lat: 32.6518, lon: -16.91 };
const NEW_ADDRESS = "Rua Nova 3, 9000-100 Funchal";

function merchant(fields: Partial<Merchant>): Merchant {
  return {
    address: "",
    lastVisit: undefined,
    listing: undefined,
    newLocation: undefined,
    website: "",
    ...fields,
  };
}

function node(tags: Record<string, string>): Element {
  return { position: PIN, tags, type: "node" };
}

const standalone: Context = {
  readAddress: ADDRESS_FORMATS.get("pt"),
  standalone: true,
};
const shared: Context = { ...standalone, standalone: false };

describe("accepting bitcoin", () => {
  it("adds the currency and the visit date, and leaves the payment tags alone", () => {
    const result = plan(
      merchant({ lastVisit: "2026-10-20", listing: "accepting" }),
      node({ name: "Café", "payment:onchain": "no" }),
      standalone
    );
    expect(result.action).toEqual({
      changes: [
        { from: undefined, key: "currency:XBT", to: "yes" },
        {
          from: undefined,
          key: "check_date:currency:XBT",
          to: "2026-10-20",
        },
      ],
      kind: "edit",
    });
    expect(result.onMap).toBe(true);
  });

  it("never moves the check date back", () => {
    const result = plan(
      merchant({ lastVisit: "2026-01-01", listing: "accepting" }),
      node({
        "check_date:currency:XBT": "2026-05-01",
        "currency:XBT": "yes",
      }),
      standalone
    );
    expect(result.action).toEqual({ kind: "keep" });
  });

  it("fills in a missing website and address, and never touches the name", () => {
    const result = plan(
      merchant({
        address: NEW_ADDRESS,
        listing: "accepting",
        website: "https://cafe.example",
      }),
      node({ "currency:XBT": "yes", name: "Café" }),
      standalone
    );
    expect(result.action).toEqual({
      changes: [
        { from: undefined, key: "website", to: "https://cafe.example" },
        { from: undefined, key: "addr:city", to: "Funchal" },
        { from: undefined, key: "addr:housenumber", to: "3" },
        { from: undefined, key: "addr:postcode", to: "9000-100" },
        { from: undefined, key: "addr:street", to: "Rua Nova" },
      ],
      kind: "edit",
    });
  });

  it("keeps the website and address OSM already has", () => {
    const result = plan(
      merchant({
        address: NEW_ADDRESS,
        listing: "accepting",
        website: "https://cafe.example",
      }),
      node({
        "addr:street": "Rua Velha",
        "contact:website": "https://old.example",
        "currency:XBT": "yes",
      }),
      standalone
    );
    expect(result.action).toEqual({ kind: "keep" });
  });

  it("writes no address without a reader, and reports one it can't read", () => {
    const tags = { "currency:XBT": "yes" };
    const unread = plan(
      merchant({ address: "Somewhere", listing: "accepting" }),
      node(tags),
      standalone
    );
    expect(unread).toMatchObject({
      action: { kind: "keep" },
      unreadAddress: true,
    });
    const noReader = plan(
      merchant({ address: NEW_ADDRESS, listing: "accepting" }),
      node(tags),
      { readAddress: undefined, standalone: true }
    );
    expect(noReader).toMatchObject({
      action: { kind: "keep" },
      unreadAddress: false,
    });
  });
});

describe("not interested", () => {
  it("takes off the bitcoin tags and nothing else", () => {
    const result = plan(
      merchant({ listing: "declined" }),
      node({
        "currency:XBT": "yes",
        name: "Bar",
        "payment:cash": "yes",
        "payment:onchain": "no",
      }),
      standalone
    );
    expect(result.action).toEqual({
      changes: [
        { from: "yes", key: "currency:XBT" },
        { from: "no", key: "payment:onchain" },
      ],
      kind: "edit",
    });
    expect(result.onMap).toBe(false);
  });
});

describe("closed", () => {
  it("deletes a node nothing else uses", () => {
    const result = plan(
      merchant({ listing: "closed" }),
      node({ "currency:XBT": "yes" }),
      standalone
    );
    expect(result).toMatchObject({ action: { kind: "delete" }, onMap: false });
  });

  it("leaves a shared node or an area to a mapper, untouched", () => {
    const tags = { building: "retail", shop: "bakery", type: "multipolygon" };
    expect(
      plan(merchant({ listing: "closed" }), node(tags), shared).action.kind
    ).toBe("by hand");
    expect(
      plan(
        merchant({ listing: "closed" }),
        { tags, type: "relation" },
        standalone
      ).action.kind
    ).toBe("by hand");
  });
});

describe("relocated", () => {
  const relocated = merchant({
    address: NEW_ADDRESS,
    listing: "relocated",
    newLocation: NEW_PIN,
  });

  it("waits for the new location to be pinned", () => {
    expect(
      plan(merchant({ listing: "relocated" }), node({}), standalone).action
    ).toEqual({ kind: "keep" });
  });

  it("moves the node and swaps its address", () => {
    const { action } = plan(
      relocated,
      node({ "addr:street": "Rua Velha", "addr:unit": "B" }),
      standalone
    );
    expect(action).toMatchObject({
      changes: [
        { from: "B", key: "addr:unit" },
        { from: undefined, key: "addr:city", to: "Funchal" },
        { from: undefined, key: "addr:housenumber", to: "3" },
        { from: undefined, key: "addr:postcode", to: "9000-100" },
        { from: "Rua Velha", key: "addr:street", to: "Rua Nova" },
      ],
      from: PIN,
      kind: "move",
      to: NEW_PIN,
    });
  });

  it("does nothing once the node is there", () => {
    const there = { position: NEW_PIN, tags: {}, type: "node" } as const;
    expect(plan(relocated, there, standalone).action).toEqual({
      kind: "keep",
    });
  });

  it("leaves a shared node, an area or an unknown new address to a mapper", () => {
    expect(plan(relocated, node({}), shared).action.kind).toBe("by hand");
    expect(
      plan(relocated, { tags: {}, type: "way" }, standalone).action.kind
    ).toBe("by hand");
    expect(
      plan(
        { ...relocated, address: "" },
        node({ "addr:street": "Rua Velha" }),
        standalone
      ).action.kind
    ).toBe("by hand");
  });
});

describe("a stage the table doesn't map", () => {
  it("changes nothing", () => {
    const result = plan(
      merchant({}),
      node({ "currency:XBT": "yes" }),
      standalone
    );
    expect(result).toEqual({
      action: { kind: "keep" },
      onMap: true,
      unreadAddress: false,
    });
  });
});

describe("mayDeleteOrMove", () => {
  it("asks about nodes that would be deleted or moved", () => {
    expect(mayDeleteOrMove(merchant({ listing: "closed" }), node({}))).toBe(
      true
    );
    expect(
      mayDeleteOrMove(
        merchant({ listing: "relocated", newLocation: NEW_PIN }),
        node({})
      )
    ).toBe(true);
  });

  it("doesn't ask otherwise", () => {
    expect(
      mayDeleteOrMove(
        merchant({ listing: "relocated", newLocation: PIN }),
        node({})
      )
    ).toBe(false);
    expect(
      mayDeleteOrMove(merchant({ listing: "closed" }), {
        tags: {},
        type: "way",
      })
    ).toBe(false);
    expect(mayDeleteOrMove(merchant({ listing: "accepting" }), node({}))).toBe(
      false
    );
  });
});
