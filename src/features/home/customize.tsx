import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "cn";
import { GripVerticalIcon, SlidersHorizontalIcon } from "lucide-react";
import { useId } from "react";

import { IconButton } from "@/components/icon-button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { SENSORS } from "@/features/board/use-card-drag";
import { useHome } from "@/features/home/home-context";
import type { SectionSetting } from "@/lib/home";
import { HOME_SECTIONS } from "@/lib/home";

function SectionRow({
  section,
  index,
  onShownChange,
}: {
  section: SectionSetting;
  index: number;
  onShownChange: (shown: boolean) => void;
}) {
  const id = useId();
  const { ref, handleRef, isDragging } = useSortable({
    id: section.id,
    index,
  });
  const label =
    HOME_SECTIONS.find((known) => known.id === section.id)?.label ?? "";
  return (
    <li
      className={cn(
        "bg-popover flex h-10 items-center gap-1.5 rounded-lg pr-2 pl-0.5 transition-shadow duration-150",
        isDragging && "shadow-raised"
      )}
      ref={ref}
    >
      <button
        aria-label={`Move ${label}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md outline-none focus-visible:ring-3 active:cursor-grabbing"
        ref={handleRef}
        type="button"
      >
        <GripVerticalIcon aria-hidden className="size-4" />
      </button>
      <Label className="flex-1 font-normal" htmlFor={id}>
        {label}
      </Label>
      <Switch
        checked={!section.hidden}
        id={id}
        onCheckedChange={onShownChange}
      />
    </li>
  );
}

/** Which of Home's sections show, and in what order. */
export function CustomizeHome() {
  const { prefs, set } = useHome();
  const { sections } = prefs;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton label="Customize Home">
            <SlidersHorizontalIcon />
          </IconButton>
        }
      />
      <PopoverContent align="end" className="w-60 p-1.5">
        <DragDropProvider
          onDragEnd={(event) => {
            if (!event.canceled) {
              set("sections", move(sections, event));
            }
          }}
          sensors={SENSORS}
        >
          <ul aria-label="Sections" className="flex flex-col gap-0.5">
            {sections.map((section, index) => (
              <SectionRow
                index={index}
                key={section.id}
                onShownChange={(shown) =>
                  set(
                    "sections",
                    sections.map((item) =>
                      item.id === section.id
                        ? { ...item, hidden: !shown }
                        : item
                    )
                  )
                }
                section={section}
              />
            ))}
          </ul>
        </DragDropProvider>
      </PopoverContent>
    </Popover>
  );
}
