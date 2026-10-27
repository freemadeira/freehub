import type { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";

import type { RelatedRef } from "@/lib/card-activity";
import {
  cardChangeTemplate,
  foldChanges,
  parseCardActivity,
} from "@/lib/card-activity";
import type { Board, BoardContent, CardFields, Template } from "@/lib/model";
import {
  boardTemplate,
  cardTemplate,
  parseBoard,
  relationTemplate,
  resolveBoard,
} from "@/lib/model";
import type { RelatedCard } from "@/lib/relations";
import { cardFinder, holdUps, relationsOf } from "@/lib/relations";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const STRANGER = "c".repeat(64);

let clock = 1000;

function signed(template: Template, pubkey: string, time?: number): NostrEvent {
  clock += 1;
  const createdAt = time ?? clock;
  return {
    ...template,
    created_at: createdAt,
    id: `${pubkey.slice(0, 4)}${createdAt}`,
    pubkey,
    sig: "sig",
  };
}

function makeBoard(id: string, code: string, members: string[]): Board {
  const board = parseBoard(
    signed(
      boardTemplate({
        code,
        creator: ALICE,
        description: "",
        id,
        members,
        project: `30304:${ALICE}:p1`,
        statuses: ["todo", "progress", "done"],
        title: code,
        viewers: [],
      }),
      ALICE
    )
  );
  if (!board) {
    throw new Error("No board");
  }
  return board;
}

function card(id: string, number: number, fields: Partial<CardFields> = {}) {
  return {
    assignees: [],
    description: "",
    id,
    labels: [],
    number,
    rank: number,
    status: "todo",
    title: `Card ${number}`,
    ...fields,
  } satisfies CardFields;
}

const free = makeBoard("b1", "FREE", [ALICE, BOB]);
// Bob isn't on it: his marks to its cards don't count.
const ops = makeBoard("b2", "OPS", [ALICE]);

const place = (board: Board, id: string) => ({
  board: board.address,
  card: id,
});

const cardEvents = [
  signed(cardTemplate(free, card("c1", 1)), ALICE),
  signed(cardTemplate(free, card("c2", 2)), ALICE),
  signed(cardTemplate(free, card("c3", 3, { status: "done" })), ALICE),
  signed(cardTemplate(ops, card("o1", 1)), ALICE),
];

function contentsOf(events: NostrEvent[]): Map<string, BoardContent> {
  const on = (board: Board) =>
    events.filter((event) =>
      event.tags.some(
        ([name, value]) => name === "a" && value === board.address
      )
    );
  return new Map([
    [free.address, resolveBoard(free, on(free))],
    [ops.address, resolveBoard(ops, on(ops))],
  ]);
}

function cardAt(
  contents: Map<string, BoardContent>,
  board: Board,
  id: string
): RelatedCard {
  const found = cardFinder([free, ops], contents)(place(board, id));
  if (!found) {
    throw new Error(`No card ${id}`);
  }
  return found;
}

function contentOf(
  contents: Map<string, BoardContent>,
  board: Board
): BoardContent {
  const content = contents.get(board.address);
  if (!content) {
    throw new Error(`No board ${board.code}`);
  }
  return content;
}

function ref(item: RelatedCard, key: string): RelatedRef {
  return {
    board: item.board.address,
    card: item.card.id,
    key,
    title: item.card.title,
  };
}

describe("card relations", () => {
  it("reads a blocking relation from each side, on both boards", () => {
    const blocks = signed(
      relationTemplate({
        from: place(ops, "o1"),
        kind: "blocks",
        to: place(free, "c1"),
      }),
      ALICE
    );
    const contents = contentsOf([...cardEvents, blocks]);
    const find = cardFinder([free, ops], contents);
    const c1 = cardAt(contents, free, "c1");
    const o1 = cardAt(contents, ops, "o1");

    const fromC1 = relationsOf(contentOf(contents, free), c1, find);
    expect(fromC1.map(({ relation }) => relation)).toEqual(["blockedBy"]);
    expect(fromC1[0]?.other.card.id).toBe("o1");
    const fromO1 = relationsOf(contentOf(contents, ops), o1, find);
    expect(fromO1.map(({ relation }) => relation)).toEqual(["blocking"]);
    expect(holdUps(c1.card, fromC1).blockedBy).toHaveLength(1);
  });

  it("keeps one relation per pair: the newest, until it's undone", () => {
    const pair = { from: place(free, "c1"), to: place(free, "c2") };
    const related = signed(
      relationTemplate({ ...pair, kind: "related" }),
      ALICE,
      2000
    );
    // Marked the other way round, from the other card, by someone else.
    const blocks = signed(
      relationTemplate({
        from: pair.to,
        kind: "blocks",
        to: pair.from,
      }),
      BOB,
      2001
    );
    const undone = signed(
      relationTemplate(
        { from: pair.to, kind: "blocks", to: pair.from },
        { deleted: true }
      ),
      ALICE,
      2002
    );
    const marked = contentsOf([...cardEvents, related, blocks]);
    expect(marked.get(free.address)?.relations).toMatchObject([
      { author: BOB, from: pair.to, kind: "blocks", to: pair.from },
    ]);
    const cleared = contentsOf([...cardEvents, related, blocks, undone]);
    expect(cleared.get(free.address)?.relations).toEqual([]);
  });

  it("ignores marks from outside either card's board", () => {
    const pair = { from: place(free, "c1"), to: place(ops, "o1") };
    const byBob = signed(relationTemplate({ ...pair, kind: "related" }), BOB);
    const byStranger = signed(
      relationTemplate({ ...pair, kind: "related" }),
      STRANGER
    );
    const contents = contentsOf([...cardEvents, byBob, byStranger]);
    const find = cardFinder([free, ops], contents);
    // Bob is on FREE, so FREE keeps his mark, but OPS's card won't have it.
    expect(contents.get(free.address)?.relations).toHaveLength(1);
    expect(
      relationsOf(contentOf(contents, free), cardAt(contents, free, "c1"), find)
    ).toEqual([]);
    expect(contents.get(ops.address)?.relations).toEqual([]);
  });

  it("ignores a relation whose d tag isn't its cards'", () => {
    const template = relationTemplate({
      from: place(free, "c1"),
      kind: "related",
      to: place(free, "c2"),
    });
    const forged = signed(
      {
        ...template,
        tags: template.tags.map((tag) => (tag[0] === "d" ? ["d", "x"] : tag)),
      },
      ALICE
    );
    expect(contentsOf([forged]).get(free.address)?.relations).toEqual([]);
  });

  it("doesn't hold up on closed cards", () => {
    const blocks = signed(
      relationTemplate({
        from: place(free, "c3"),
        kind: "blocks",
        to: place(free, "c1"),
      }),
      ALICE
    );
    const contents = contentsOf([...cardEvents, blocks]);
    const c1 = cardAt(contents, free, "c1");
    const relations = relationsOf(
      contentOf(contents, free),
      c1,
      cardFinder([free, ops], contents)
    );
    expect(relations).toHaveLength(1);
    expect(holdUps(c1.card, relations).blockedBy).toEqual([]);
  });
});

describe("relation activity", () => {
  const contents = contentsOf(cardEvents);
  const o1 = ref(cardAt(contents, ops, "o1"), "OPS-1");
  const c2 = ref(cardAt(contents, free, "c2"), "FREE-2");

  it("reads back what it tells", () => {
    const template = cardChangeTemplate(
      { assignees: [], author: ALICE, id: "c1" },
      [
        { added: [o1], field: "blockedBy", removed: [] },
        { added: [], field: "related", removed: [c2] },
      ],
      []
    );
    expect(template.content).toBe(
      "Marked it as blocked by OPS-1\nRemoved its relation to FREE-2"
    );
    expect(parseCardActivity(signed(template, ALICE))?.changes).toEqual([
      { added: [o1], field: "blockedBy", removed: [] },
      { added: [], field: "related", removed: [c2] },
    ]);
  });

  it("drops a card marked and unmarked in one run", () => {
    expect(
      foldChanges([
        { added: [o1], field: "blocking", removed: [] },
        { added: [c2], field: "blocking", removed: [] },
        { added: [], field: "blocking", removed: [o1] },
      ])
    ).toEqual([{ added: [c2], field: "blocking", removed: [] }]);
    expect(
      foldChanges([
        { added: [o1], field: "related", removed: [] },
        { added: [], field: "related", removed: [o1] },
      ])
    ).toEqual([]);
  });
});
