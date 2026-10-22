import { describe, expect, it } from "vitest";

import { ADDRESS_FORMATS } from "./addresses";
import type { Context, Element, Merchant } from "./plan";
import { mayDeleteOrMove, plan } from "./plan";

const PIN = { lat: 32.65, lon: -16.91 };
/** About 200 m north of PIN. */
const NEW_PIN = { lat: 32.6518, lon: -16.91 };
/** About 40 m north of NEW_PIN. */
const NUDGED = { lat: 32.65216, lon: -16.91 };
const NEW_ADDRESS = "Rua Nova 3, 9000-100 Funchal";

function merchant(fields: Partial<Merchant>): Merchant {
  return {
    address: "",
    lastVisit: undefined,
    listing: undefined,
    location: PIN,
    name: "Café",
    newLocation: undefined,
    website: "",
    ...fields,
  };
}

function node(tags: Record<string, string>, position = PIN): Element {
  return { position, tags: { name: "Café", ...tags }, type: "node" };
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
      node({ "payment:onchain": "no" }),
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
        name: "CAFÉ",
        website: "https://cafe.example",
      }),
      node({ "currency:XBT": "yes" }),
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

  it("keeps the website and address OSM has, and leaves out a website that isn't a web address", () => {
    const tags = { "currency:XBT": "yes" };
    expect(
      plan(
        merchant({
          address: NEW_ADDRESS,
          listing: "accepting",
          website: "https://cafe.example",
        }),
        node({
          ...tags,
          "addr:street": "Rua Velha",
          "contact:website": "https://old.example",
        }),
        standalone
      ).action
    ).toEqual({ kind: "keep" });
    for (const website of ["www.cafe.example", "-", "instagram"]) {
      expect(
        plan(
          merchant({ listing: "accepting", website }),
          node(tags),
          standalone
        ).action
      ).toEqual({ kind: "keep" });
    }
  });

  it("reports an address it needed and couldn't read, and only then", () => {
    const unread = merchant({ address: "Somewhere", listing: "accepting" });
    expect(
      plan(unread, node({ "currency:XBT": "yes" }), standalone).unreadAddress
    ).toBe(true);
    expect(
      plan(
        unread,
        node({ "addr:street": "Rua Velha", "currency:XBT": "yes" }),
        standalone
      ).unreadAddress
    ).toBe(false);
    expect(
      plan({ ...unread, listing: "closed" }, node({}), standalone).unreadAddress
    ).toBe(false);
    expect(
      plan(unread, node({}), { readAddress: undefined, standalone: true })
        .unreadAddress
    ).toBe(false);
  });
});

describe("not interested", () => {
  it("takes off what says yes, with its check date, and keeps an explicit no", () => {
    const result = plan(
      merchant({ listing: "declined" }),
      node({
        "check_date:currency:XBT": "2025-01-01",
        "currency:XBT": "yes",
        "payment:cash": "yes",
        "payment:lightning": "no",
      }),
      standalone
    );
    expect(result.action).toEqual({
      changes: [
        { from: "yes", key: "currency:XBT" },
        { from: "2025-01-01", key: "check_date:currency:XBT" },
      ],
      kind: "edit",
    });
    expect(result.onMap).toBe(false);
  });

  it("leaves a business that only says no as it is", () => {
    expect(
      plan(
        merchant({ listing: "declined" }),
        node({
          "check_date:currency:XBT": "2025-01-01",
          "currency:XBT": "no",
        }),
        standalone
      ).action
    ).toEqual({ kind: "keep" });
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
    const tags = { building: "retail", type: "multipolygon" };
    expect(
      plan(merchant({ listing: "closed" }), node(tags), shared).action.kind
    ).toBe("by hand");
    expect(
      plan(
        merchant({ listing: "closed" }),
        { tags: { name: "Café", ...tags }, type: "relation" },
        standalone
      ).action.kind
    ).toBe("by hand");
  });
});

describe("the linked element", () => {
  it("must still be the record's business before anything changes", () => {
    const newcomer = node({ name: "New Bakery", "payment:lightning": "yes" });
    for (const listing of ["accepting", "declined", "closed"] as const) {
      expect(
        plan(merchant({ listing }), newcomer, standalone).action.kind
      ).toBe("by hand");
    }
  });

  it("can be named apart from its branch", () => {
    const result = plan(
      merchant({ listing: "accepting", name: "A Confeitaria – Lido" }),
      node({ branch: "Lido", name: "A Confeitaria" }),
      standalone
    );
    expect(result.action.kind).toBe("edit");
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
    expect(plan(relocated, node({}, NEW_PIN), standalone).action).toEqual({
      kind: "keep",
    });
  });

  it("never moves a node back once a mapper put it right", () => {
    expect(plan(relocated, node({}, NUDGED), standalone).action.kind).toBe(
      "by hand"
    );
    expect(mayDeleteOrMove(relocated, node({}, NUDGED))).toBe(false);
  });

  it("leaves a node that isn't where the record had it to a mapper", () => {
    expect(
      plan({ ...relocated, location: undefined }, node({}), standalone).action
        .kind
    ).toBe("by hand");
  });

  it("leaves a shared node, an area, or an old or unknown address to a mapper", () => {
    const old = { "addr:housenumber": "3", "addr:street": "Rua Nova" };
    for (const [element, context, address] of [
      [node({}), shared, NEW_ADDRESS],
      [{ tags: { name: "Café" }, type: "way" }, standalone, NEW_ADDRESS],
      [node({ "addr:street": "Rua Velha" }), standalone, ""],
      [
        node({ ...old, "addr:city": "Funchal", "addr:postcode": "9000-100" }),
        standalone,
        NEW_ADDRESS,
      ],
    ] as const) {
      expect(
        plan({ ...relocated, address }, element, context).action.kind
      ).toBe("by hand");
    }
  });
});

describe("a stage the table doesn't map", () => {
  it("changes nothing", () => {
    expect(
      plan(merchant({}), node({ "currency:XBT": "yes" }), standalone)
    ).toEqual({
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
