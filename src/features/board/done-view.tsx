import { Empty, EmptyTitle } from "@/components/ui/empty";
import { useBoard } from "@/features/board/board-context";
import { Bucket } from "@/features/board/bucket";
import { CardRow } from "@/features/board/card-tile";
import { activeSprint } from "@/lib/model";

export function DoneView() {
  const { content, cards } = useBoard();
  const active = activeSprint(content);
  const done = cards
    .filter(
      (card) => card.status === "done" && !(active && card.sprint === active.id)
    )
    .toSorted((a, b) => b.event.created_at - a.event.created_at);

  if (done.length === 0) {
    return (
      <Empty>
        <EmptyTitle>Nothing done yet</EmptyTitle>
      </Empty>
    );
  }

  const sprints = content.sprints
    .filter((sprint) => sprint !== active)
    .toReversed();
  const known = new Set(sprints.map((sprint) => sprint.id));
  const groups = [
    ...sprints.map((sprint) => ({
      cards: done.filter((card) => card.sprint === sprint.id),
      id: sprint.id,
      title: sprint.title,
    })),
    {
      cards: done.filter((card) => !(card.sprint && known.has(card.sprint))),
      id: "none",
      title: "No sprint",
    },
  ].filter((group) => group.cards.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <Bucket count={group.cards.length} key={group.id} title={group.title}>
          {group.cards.map((card) => (
            <CardRow card={card} key={card.id} />
          ))}
        </Bucket>
      ))}
    </div>
  );
}
