import { describe, expect, it } from "vitest";

import { dueRuns } from "./schedule";

describe("dueRuns", () => {
  it("runs the sync every night from 23:00", () => {
    expect(dueRuns(new Date(2026, 9, 21, 22, 59), true)).toEqual([]);
    expect(dueRuns(new Date(2026, 9, 21, 23, 40), true)).toEqual([
      { job: "nightly", key: "nightly 2026-10-21" },
    ]);
  });

  it("looks for merchants on the first Monday of the month from 9:00, with an area", () => {
    const firstMonday = new Date(2026, 9, 5, 9, 0);
    expect(dueRuns(firstMonday, true)).toEqual([
      { job: "discover", key: "discover 2026-10-05" },
    ]);
    expect(dueRuns(firstMonday, false)).toEqual([]);
    expect(dueRuns(new Date(2026, 9, 12, 9, 0), true)).toEqual([]);
    expect(dueRuns(new Date(2026, 9, 5, 8, 59), true)).toEqual([]);
  });
});
