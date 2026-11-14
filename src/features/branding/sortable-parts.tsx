import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "cn";
import { GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SENSORS } from "@/features/board/use-card-drag";
import { placePart } from "@/lib/brand-actions";
import type { BrandPart } from "@/lib/brands";
import type { Project } from "@/lib/project";

/** What an item gets to show while sorted: a handle to drag it by, and whether it's dragged. */
export interface Sortable {
  /** Missing for whoever can't change the order. */
  handle?: ReactNode;
  dragging: boolean;
}

interface ItemProps<T extends BrandPart> {
  part: T;
  index: number;
  group: string;
  editable: boolean;
  className?: string;
  handleClassName?: string;
  label: (part: T) => string;
  render: (part: T, sortable: Sortable) => ReactNode;
}

function SortableItem<T extends BrandPart>({
  part,
  index,
  group,
  editable,
  className,
  handleClassName,
  label,
  render,
}: ItemProps<T>) {
  const { ref, handleRef, isDragging } = useSortable({
    disabled: !editable,
    group,
    id: part.id,
    index,
  });
  const handle = editable ? (
    <button
      aria-label={`Move ${label(part)}`}
      className={cn(
        "focus-visible:ring-ring/50 flex size-7 shrink-0 cursor-grab items-center justify-center rounded-full outline-none focus-visible:ring-3 active:cursor-grabbing",
        handleClassName
      )}
      ref={handleRef}
      type="button"
    >
      <GripVerticalIcon aria-hidden className="size-4" />
    </button>
  ) : undefined;
  return (
    <div
      className={cn(
        "rounded-2xl transition-shadow duration-150",
        isDragging && "shadow-raised",
        className
      )}
      ref={ref}
    >
      {render(part, { dragging: isDragging, handle })}
    </div>
  );
}

/**
 * Parts of a brand in a layout their editors can drag into order.
 */
export function SortableParts<T extends BrandPart>({
  project,
  parts,
  group,
  editable,
  className,
  itemClassName,
  handleClassName,
  label,
  render,
  children,
}: {
  project: Project;
  parts: T[];
  /** Keeps drags within their own layout. */
  group: string;
  editable: boolean;
  className?: string;
  itemClassName?: string;
  handleClassName?: string;
  /** What each part is called, for its handle. */
  label: (part: T) => string;
  render: (part: T, sortable: Sortable) => ReactNode;
  /** After the parts, like a tile to add another. */
  children?: ReactNode;
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled || !editable) {
          return;
        }
        const ordered = move(parts, event);
        const id = event.operation.source?.id;
        const part = ordered.find((item) => item.id === id);
        if (part && parts.indexOf(part) !== ordered.indexOf(part)) {
          placePart(project, ordered, part);
        }
      }}
      sensors={SENSORS}
    >
      <div className={className}>
        {parts.map((part, index) => (
          <SortableItem
            className={itemClassName}
            editable={editable}
            group={group}
            handleClassName={handleClassName}
            index={index}
            key={part.id}
            label={label}
            part={part}
            render={render}
          />
        ))}
        {children}
      </div>
    </DragDropProvider>
  );
}
