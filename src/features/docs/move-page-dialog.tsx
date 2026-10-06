import { cn } from "cn";
import { BookOpenTextIcon, CheckIcon } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageIcon } from "@/features/docs/page-icon";
import type { DocPage, DocsContent } from "@/lib/docs";
import { ancestors, pageTitle } from "@/lib/docs";
import { canMoveUnder, movePage } from "@/lib/docs-actions";
import type { Project } from "@/lib/project";

const OPTION =
  "hover:bg-accent focus-visible:bg-accent flex h-8 w-full min-w-0 shrink-0 items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-colors duration-150 [&>svg]:text-muted-foreground";

interface MovePageDialogProps {
  project: Project;
  docs: DocsContent;
  page: DocPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function MoveList({
  project,
  docs,
  page,
  onDone,
}: Omit<MovePageDialogProps, "open" | "onOpenChange"> & {
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const targets = docs.pages.filter(
    (item) =>
      canMoveUnder(docs, page, item.id) &&
      (!needle || pageTitle(item).toLowerCase().includes(needle))
  );
  const move = (parent?: string) => {
    if (parent !== page.parent) {
      movePage(project, docs, page, parent);
    }
    onDone();
  };
  const depth = (item: DocPage) => (needle ? 0 : ancestors(docs, item).length);

  return (
    <>
      <Input
        aria-label="Search pages"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is for picking a page
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search pages…"
        value={query}
      />
      <div className="-mx-1 flex max-h-80 min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
        {!needle && (
          <button className={OPTION} onClick={() => move()} type="button">
            <BookOpenTextIcon className="size-4 shrink-0" />
            <span className="truncate">Top of Docs</span>
            {page.parent === undefined && (
              <CheckIcon className="ml-auto size-4" />
            )}
          </button>
        )}
        {targets.map((item) => (
          <button
            className={OPTION}
            key={item.id}
            onClick={() => move(item.id)}
            style={{ paddingLeft: `${0.5 + depth(item) * 1.25}rem` }}
            type="button"
          >
            <PageIcon className="text-muted-foreground" page={item} />
            <span
              className={cn(
                "truncate",
                !item.title.trim() && "text-muted-foreground"
              )}
            >
              {pageTitle(item)}
            </span>
            {item.id === page.parent && (
              <CheckIcon className="ml-auto size-4" />
            )}
          </button>
        ))}
        {needle && targets.length === 0 && (
          <p className="text-muted-foreground px-2 py-1.5">No pages found</p>
        )}
      </div>
    </>
  );
}

/** Picks where a page moves: under another page, or to the top of the docs. */
export function MovePageDialog({
  open,
  onOpenChange,
  ...props
}: MovePageDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {pageTitle(props.page)}</DialogTitle>
        </DialogHeader>
        <MoveList {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
