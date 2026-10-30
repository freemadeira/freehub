import { describe, expect, it } from "vitest";

import { homePrefs, parseHomeDoc } from "@/lib/home";

function sectionsOf(saved: { id: string; hidden?: boolean }[]) {
  const doc = parseHomeDoc(
    JSON.stringify({ sections: { at: 1, value: saved } })
  );
  return doc && homePrefs(doc).sections;
}

describe("home sections", () => {
  it("adds a new section after the one it follows by default", () => {
    expect(
      sectionsOf([
        { id: "projects" },
        { hidden: true, id: "pinned" },
        { id: "tasks" },
        { id: "mentions" },
        { id: "links" },
      ])
    ).toEqual([
      { hidden: false, id: "projects" },
      { hidden: true, id: "pinned" },
      { hidden: false, id: "focus" },
      { hidden: false, id: "tasks" },
      { hidden: false, id: "mentions" },
      { hidden: false, id: "links" },
    ]);
  });

  it("puts the first section first when it's missing, and drops unknown ones", () => {
    expect(
      sectionsOf([{ id: "gone" }, { id: "tasks" }, { id: "tasks" }])?.map(
        ({ id }) => id
      )
    ).toEqual(["pinned", "focus", "tasks", "mentions", "links", "projects"]);
  });
});
