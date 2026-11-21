import { describe, expect, it } from "vitest";

import type { Merchant } from "./plan";
import { acceptanceOnly } from "./scope";

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    address: "",
    lastVisit: undefined,
    listing: "accepting",
    location: undefined,
    name: "Café",
    newLocation: undefined,
    website: "",
    ...overrides,
  };
}

describe("acceptanceOnly", () => {
  it("keeps the acceptance tags of an edit and leaves the rest for a mapper", () => {
    const result = acceptanceOnly(merchant(), {
      changes: [
        { key: "currency:XBT", to: "yes" },
        { key: "check_date:currency:XBT", to: "2026-11-05" },
        { key: "website", to: "https://example.org" },
        { key: "addr:street", to: "Rua Direita" },
      ],
      kind: "edit",
    });
    expect(result.action).toEqual({
      changes: [
        { key: "currency:XBT", to: "yes" },
        { key: "check_date:currency:XBT", to: "2026-11-05" },
      ],
      kind: "edit",
    });
    expect(result.byHand.map(({ key }) => key)).toEqual([
      "website",
      "addr:street",
    ]);
  });

  it("keeps the element when an edit has no acceptance tag", () => {
    const result = acceptanceOnly(merchant(), {
      changes: [{ key: "website", to: "https://example.org" }],
      kind: "edit",
    });
    expect(result.action).toEqual({ kind: "keep" });
    expect(result.byHand).toHaveLength(1);
  });

  it("never moves a pin: a relocation is left for a mapper", () => {
    const result = acceptanceOnly(merchant({ listing: "relocated" }), {
      changes: [],
      from: { lat: 32.6, lon: -16.9 },
      kind: "move",
      metres: 120,
      to: { lat: 32.61, lon: -16.9 },
    });
    expect(result.action).toEqual({ kind: "keep" });
    expect(result.move).toBe(true);
  });

  it("deletes only a Closed business", () => {
    expect(
      acceptanceOnly(merchant({ listing: "closed" }), { kind: "delete" }).action
    ).toEqual({ kind: "delete" });
    expect(
      acceptanceOnly(merchant({ listing: "declined" }), { kind: "delete" })
        .action
    ).toEqual({ kind: "keep" });
  });
});
