import { describe, expect, it } from "vitest";

import type { BoardScope } from "@/features/board/board-context";
import type { Lane, SprintCard } from "@/features/boards/sprint-cards";
import { lanesOf } from "@/features/boards/sprint-cards";
import type { Card } from "@/lib/model";

const ANN = "a".repeat(64);
const BOB = "b".repeat(64);
const CAT = "c".repeat(64);

function scope(address: string): BoardScope {
  return { board: { address } } as BoardScope;
}

const FREE = scope("30302:x:free");
const OPS = scope("30302:x:ops");

function item(id: string, on: BoardScope, assignees: string[]): SprintCard {
  return {
    card: { assignees, id, rank: 0, status: "todo" } as unknown as Card,
    id: `${on.board.address}/${id}`,
    rank: 0,
    scope: on,
  };
}

function summary(lanes: Lane[]) {
  return lanes.map((lane) => ({
    ids: lane.cards.map((each) => each.id),
    key: lane.key,
  }));
}

describe("lanesOf", () => {
  const cards = [
    item("1", FREE, [BOB]),
    item("2", OPS, [ANN, BOB]),
    item("3", FREE, []),
    item("4", OPS, [CAT]),
  ];

  it("keeps the cards together without lanes", () => {
    expect(lanesOf("none", cards, [ANN, BOB])).toStrictEqual([]);
  });

  it("makes a row per board, in the order the cards come", () => {
    expect(summary(lanesOf("board", cards, []))).toStrictEqual([
      {
        ids: [`${FREE.board.address}/1`, `${FREE.board.address}/3`],
        key: FREE.board.address,
      },
      {
        ids: [`${OPS.board.address}/2`, `${OPS.board.address}/4`],
        key: OPS.board.address,
      },
    ]);
  });

  it("makes a row per person, then anyone else assigned, then the unassigned", () => {
    expect(summary(lanesOf("assignee", cards, [ANN, BOB]))).toStrictEqual([
      { ids: [`${ANN}/${OPS.board.address}/2`], key: ANN },
      {
        ids: [
          `${BOB}/${FREE.board.address}/1`,
          `${BOB}/${OPS.board.address}/2`,
        ],
        key: BOB,
      },
      { ids: [`${CAT}/${OPS.board.address}/4`], key: CAT },
      { ids: [`${FREE.board.address}/3`], key: "unassigned" },
    ]);
  });

  it("leaves out people with no cards", () => {
    const lanes = lanesOf("assignee", [item("1", FREE, [BOB])], [ANN, BOB]);
    expect(lanes.map((lane) => lane.key)).toStrictEqual([BOB]);
  });
});
