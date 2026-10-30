import type { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";

import type { Pressing, Signals } from "@/features/home/pressing";
import { needsYou, newlyAssigned, reasonLabel } from "@/features/home/pressing";
import type { InboxGroup, InboxItem } from "@/hooks/use-inbox";
import type { MyCard } from "@/hooks/use-my-cards";
import type { CardFields, SprintFields, Template } from "@/lib/model";
import {
  boardTemplate,
  cardTemplate,
  parseBoard,
  resolveBoard,
  sprintTemplate,
} from "@/lib/model";

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
// A Friday.
const TODAY = new Date(2026, 9, 30);

let clock = 1000;

function signed(template: Template, pubkey: string): NostrEvent {
  clock += 1;
  return {
    ...template,
    created_at: clock,
    id: `${pubkey.slice(0, 4)}${clock}`,
    pubkey,
    sig: "sig",
  };
}

const parsed = parseBoard(
  signed(
    boardTemplate({
      code: "FREE",
      creator: ME,
      description: "",
      id: "b1",
      members: [ME, BOB],
      project: `30304:${ME}:p1`,
      statuses: ["todo", "progress", "done"],
      title: "Free",
      viewers: [],
    }),
    ME
  )
);
if (!parsed) {
  throw new Error("No board");
}
const board = parsed;

function card(id: string, fields: Partial<CardFields> = {}): CardFields {
  return {
    assignees: [ME],
    creator: BOB,
    description: "",
    id,
    labels: [],
    rank: 0,
    status: "todo",
    title: id,
    ...fields,
  };
}

function sprint(id: string, fields: Partial<SprintFields>): SprintFields {
  return { id, number: 1, status: "active", title: id, ...fields };
}

/** The person's cards on the board, as Home finds them. */
function mine(cards: CardFields[], sprints: SprintFields[] = []): MyCard[] {
  const content = resolveBoard(board, [
    ...cards.map((fields) => signed(cardTemplate(board, fields), ME)),
    ...sprints.map((fields) => signed(sprintTemplate(board, fields), ME)),
  ]);
  return content.cards.map((found) => ({
    assigned: found.assignees.includes(ME),
    board,
    card: found,
    content,
    created: found.creator === ME,
  }));
}

function signals(fields: Partial<Signals> = {}): Signals {
  return { assigned: new Set(), blocking: () => 0, today: TODAY, ...fields };
}

const told = (pressing: Pressing[]) =>
  pressing.map(({ item, reason }) => [
    item.card.id,
    reasonLabel(reason, TODAY),
  ]);

/** What a card in a sprint ending then is told, if anything. */
const ending = (end: string, status: SprintFields["status"] = "active") =>
  told(
    needsYou(
      mine([card("c1", { sprint: "s1" })], [sprint("s1", { end, status })]),
      signals()
    )
  );

const group = (latest: InboxItem): InboxGroup => ({
  items: [latest],
  latest,
  read: latest.read,
  subject: "c1",
});

describe("needs you", () => {
  it("ranks overdue, due today, blocking, urgent, newly assigned, then sprint ending", () => {
    const cards = mine(
      [
        card("sprint", { sprint: "s1" }),
        card("assigned"),
        card("urgent", { priority: "urgent" }),
        card("blocking"),
        card("today", { due: "2026-10-30" }),
        card("overdue", { due: "2026-10-27" }),
        card("later", { due: "2026-11-02", priority: "high" }),
      ],
      [sprint("s1", { end: "2026-11-01" })]
    );
    const pressing = needsYou(
      cards,
      signals({
        assigned: new Set([`${board.address}/assigned`]),
        blocking: (item) => (item.card.id === "blocking" ? 2 : 0),
      })
    );
    expect(told(pressing)).toEqual([
      ["overdue", "3 days overdue"],
      ["today", "Due today"],
      ["blocking", "Blocking 2 cards"],
      ["urgent", "Urgent"],
      ["assigned", "Newly assigned"],
    ]);
  });

  it("shows only the five most pressing", () => {
    const cards = mine(
      ["1", "2", "3", "4", "5", "6"].map((day) =>
        card(`c${day}`, { due: `2026-10-0${day}` })
      )
    );
    expect(told(needsYou(cards, signals()))).toEqual([
      ["c1", "29 days overdue"],
      ["c2", "28 days overdue"],
      ["c3", "27 days overdue"],
      ["c4", "26 days overdue"],
      ["c5", "25 days overdue"],
    ]);
  });

  it("puts what holds up the most cards first", () => {
    const cards = mine([card("one"), card("three")]);
    const pressing = needsYou(
      cards,
      signals({ blocking: (item) => (item.card.id === "three" ? 3 : 1) })
    );
    expect(told(pressing)).toEqual([
      ["three", "Blocking 3 cards"],
      ["one", "Blocking 1 card"],
    ]);
  });

  it("leaves out cards the person made for someone else", () => {
    const due = "2026-10-29";
    const cards = mine([
      card("theirs", { assignees: [BOB], creator: ME, due }),
      card("unassigned", { assignees: [], creator: ME, due }),
    ]).filter((item) => item.assigned || item.created);
    expect(told(needsYou(cards, signals()))).toEqual([
      ["unassigned", "1 day overdue"],
    ]);
  });

  it("counts a running sprint's cards from two days before it ends", () => {
    expect(ending("2026-10-30")).toEqual([["c1", "Sprint ends today"]]);
    expect(ending("2026-10-31")).toEqual([["c1", "Sprint ends tomorrow"]]);
    expect(ending("2026-11-01")).toEqual([["c1", "Sprint ends Sunday"]]);
    expect(ending("2026-11-02")).toEqual([]);
    expect(ending("2026-10-29")).toEqual([]);
    expect(ending("2026-10-31", "future")).toEqual([]);
  });
});

describe("newly assigned", () => {
  const [{ card: assigned }] = mine([card("c1")]) as [MyCard];

  function assignment(added: string[], read: boolean): InboxItem {
    return {
      board,
      card: assigned,
      notification: {
        actor: BOB,
        cardId: "c1",
        changes: [{ added, field: "assignees", removed: [] }],
        createdAt: 1,
        direct: true,
        id: "e1",
        reason: "change",
        type: "card",
      },
      read,
    };
  }

  it("finds cards the person was put on and hasn't opened", () => {
    expect([...newlyAssigned([group(assignment([ME], false))], ME)]).toEqual([
      `${board.address}/c1`,
    ]);
    expect(newlyAssigned([group(assignment([ME], true))], ME).size).toBe(0);
    expect(newlyAssigned([group(assignment([BOB], false))], ME).size).toBe(0);
  });
});
