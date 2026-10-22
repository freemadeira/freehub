import { FolderInputIcon, TagsIcon, Trash2Icon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactElement } from "react";

import { usePlaces } from "@/components/app-link";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import type { ShownLink } from "@/features/catalogs/catalog-context";
import { useCatalog } from "@/features/catalogs/catalog-context";
import { CategoryPicker } from "@/features/catalogs/category-picker";
import { fileLinks, moveLinks, removeLinks } from "@/lib/catalog-actions";
import { canEdit } from "@/lib/model";

/** Other catalogs the person can move links into, by project, as menu items. */
function MoveTargets({
  links,
  onMoved,
}: {
  links: ShownLink[];
  onMoved?: () => void;
}) {
  const { catalog, project: from, me } = useCatalog();
  const { projects, catalogs } = usePlaces();
  const groups = projects
    .filter((project) => canEdit(project, me))
    .map((project) => ({
      catalogs: (catalogs.get(project.address)?.catalogs ?? []).filter(
        (item) => item.id !== catalog.id
      ),
      project,
    }))
    .filter((group) => group.catalogs.length > 0);
  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-3 text-center text-sm text-balance">
        There’s no other catalog to move links into.
      </p>
    );
  }
  return groups.map(({ project, catalogs: inProject }) => (
    <DropdownMenuGroup key={project.address}>
      <DropdownMenuLabel>{project.title}</DropdownMenuLabel>
      {inProject.map((target) => (
        <DropdownMenuItem
          key={target.id}
          onClick={async () => {
            await moveLinks(from, links, { catalog: target, project });
            onMoved?.();
          }}
        >
          <span className="truncate">{target.title}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  ));
}

/** A menu of the catalogs links can move to, opened by `trigger`. */
function MoveMenu({
  links,
  trigger,
  onMoved,
}: {
  links: ShownLink[];
  trigger: ReactElement;
  onMoved?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="center" className="w-60" side="top">
        <MoveTargets links={links} onMoved={onMoved} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Move to…", as an item opening the catalogs beside it, inside another menu. */
export function MoveSubmenu({
  links,
  onMoved,
}: {
  links: ShownLink[];
  onMoved?: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInputIcon />
        Move to…
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        <MoveTargets links={links} onMoved={onMoved} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * What can be done to the links picked, all at once: filed under a
 * category or taken out of one, moved to another catalog, or deleted.
 */
export function SelectionBar({ onClear }: { onClear: () => void }) {
  const { catalog, project, links, selected, canEdit: editable } = useCatalog();
  const picked = links.filter((link) => selected.has(link.id));
  const everyone = catalog.categories
    .filter((category) =>
      picked.every((link) => link.categories.includes(category.id))
    )
    .map((category) => category.id);
  const some = new Set(
    catalog.categories
      .filter(
        (category) =>
          !everyone.includes(category.id) &&
          picked.some((link) => link.categories.includes(category.id))
      )
      .map((category) => category.id)
  );

  const file = (next: string[]) => {
    for (const id of next.filter((item) => !everyone.includes(item))) {
      fileLinks(project, picked, id, true);
    }
    for (const id of everyone.filter((item) => !next.includes(item))) {
      fileLinks(project, picked, id, false);
    }
  };

  return (
    <AnimatePresence>
      {editable && picked.length > 0 && (
        <motion.div
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
          exit={{ filter: "blur(4px)", opacity: 0, y: 12 }}
          initial={{ filter: "blur(4px)", opacity: 0, y: 12 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          <div
            aria-label="Selected links"
            className="bg-popover text-popover-foreground shadow-raised pointer-events-auto flex h-12 items-center gap-1 rounded-full pr-1.5 pl-4"
            role="toolbar"
          >
            <span className="mr-2 text-sm font-medium tabular-nums">
              {picked.length} selected
            </span>
            <FluidTooltip.Group>
              <CategoryPicker
                align="center"
                aria-label="Categories"
                className="hover:bg-accent focus-visible:ring-ring/50 data-popup-open:bg-accent flex h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-3"
                onChange={file}
                partial={some}
                value={everyone}
              >
                <TagsIcon aria-hidden className="size-4" />
                <span className="max-sm:sr-only">Categories</span>
              </CategoryPicker>
              <MoveMenu
                links={picked}
                onMoved={onClear}
                trigger={
                  <Button className="rounded-full" variant="ghost">
                    <FolderInputIcon />
                    <span className="max-sm:sr-only">Move</span>
                  </Button>
                }
              />
              <IconButton
                className="text-destructive hover:text-destructive rounded-full"
                label="Delete"
                onClick={() => {
                  removeLinks(project, picked);
                  onClear();
                }}
              >
                <Trash2Icon />
              </IconButton>
              <IconButton
                className="rounded-full"
                label="Clear selection"
                onClick={onClear}
              >
                <XIcon />
              </IconButton>
            </FluidTooltip.Group>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
