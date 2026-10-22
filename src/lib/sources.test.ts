import { describe, expect, it } from "vitest";

import type { Field } from "@/lib/crm";
import type { Source, SourceAttribute } from "@/lib/sources";
import { suggestConnection, suggestOptions } from "@/lib/sources";

const journey: Field = {
  config: "",
  id: "journey",
  name: "Journey",
  options: [
    { color: "green", id: "won", kind: "won", label: "Closed" },
    { color: "red", id: "lost", kind: "lost", label: "Lost" },
  ],
  type: "stage",
};

const stage: SourceAttribute = {
  config: "",
  id: "stage",
  name: "Stage",
  type: "stage",
  values: [
    { color: "gray", id: "closed", kind: "lost", label: "Closed" },
    { color: "red", id: "lost", kind: "lost", label: "Lost" },
  ],
};

function source(attributes: SourceAttribute[]): Source {
  return {
    attributes,
    connector: "f".repeat(64),
    event: {} as Source["event"],
    id: "src",
    name: "Source",
    type: "test",
  };
}

describe("suggestOptions", () => {
  it("maps a stage's values to options of the same label and outcome only", () => {
    expect(suggestOptions(stage, journey)).toEqual({ lost: "lost" });
  });
});

describe("suggestConnection", () => {
  it("puts a stage attribute on the table's stage field, whatever its name", () => {
    expect(suggestConnection(source([stage]), { fields: [journey] })).toEqual({
      connector: "f".repeat(64),
      fields: { stage: "journey" },
      options: { stage: { lost: "lost" } },
      source: "src",
    });
  });

  it("prefers a field of the attribute's own name", () => {
    const status: Field = {
      config: "",
      id: "status",
      name: "Stage",
      options: [],
      type: "select",
    };
    expect(
      suggestConnection(source([stage]), { fields: [journey, status] }).fields
    ).toEqual({ stage: "status" });
  });
});
