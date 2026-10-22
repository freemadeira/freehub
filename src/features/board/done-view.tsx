import { Empty, EmptyTitle } from "@/components/ui/empty";
import { useBoard } from "@/features/board/board-context";
import { Bucket } from "@/features/board/bucket";
import { doneGroups } from "@/features/board/card-order";
import { CardRow } from "@/features/board/card-tile";

export function DoneView() {
  const { content, cards } = useBoard();
  const groups = doneGroups(content, cards);

  if (groups.length === 0) {
    return (
      <Empty>
        <EmptyTitle>Nothing done yet</EmptyTitle>
      </Empty>
    );
  }

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
