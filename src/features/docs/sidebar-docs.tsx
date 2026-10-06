import { cn } from "cn";
import {
  BookOpenTextIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PlusIcon,
} from "lucide-react";
import type { ComponentProps, DragEvent, HTMLAttributes } from "react";
import { useState } from "react";
import { useLocation } from "wouter";

import { NavLink } from "@/components/nav-link";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  docsPath,
  pagePath,
  parsePageParam,
} from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { PageMenu } from "@/features/docs/page-menu";
import type { DocPage, DocsContent } from "@/lib/docs";
import { ancestors, pageTitle } from "@/lib/docs";
import { canMoveUnder, createPage, movePage } from "@/lib/docs-actions";
import type { Project } from "@/lib/project";

/** Where a dragged page lands, next to the page it's over or inside it. */
type Where = "before" | "inside" | "after";

/** The row a page is dragged over: a page's id, or "" for the docs themselves. */
interface Drop {
  id: string;
  where: Where;
}

// The top and bottom quarter of a row put the page beside it; the middle, inside.
function whereOver(event: DragEvent<HTMLElement>): Where {
  const rect = event.currentTarget.getBoundingClientRect();
  const share = (event.clientY - rect.top) / rect.height;
  if (share < 0.25) {
    return "before";
  }
  return share > 0.75 ? "after" : "inside";
}

/** Deeper pages stop stepping in, so their titles keep some room. */
const MAX_INDENT = 5;

const ACTION =
  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-3 [&>svg]:size-4";
// Shown while the row is hovered or focused, and always on touch screens.
const REVEAL =
  "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100";

function ActionButton({
  label,
  className,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      aria-label={label}
      className={cn(ACTION, className)}
      title={label}
      type="button"
      {...props}
    />
  );
}

interface TreeProps {
  project: Project;
  docs: DocsContent;
  /** The page the current link opens, if any. */
  openId?: string;
  isExpanded: (page: DocPage) => boolean;
  onExpandedChange: (page: DocPage, expanded: boolean) => void;
  onAdd: (parent: DocPage) => void;
  /** The page being dragged, if any. */
  dragged?: string;
  drop?: Drop;
  /** Drag and drop for a page's row. */
  dnd: (page: DocPage) => HTMLAttributes<HTMLDivElement>;
}

function PageRow({
  page,
  depth,
  ...tree
}: TreeProps & { page: DocPage; depth: number }) {
  const { project, docs, openId, isExpanded, onExpandedChange, onAdd } = tree;
  const { dragged, drop, dnd } = tree;
  const over = drop?.id === page.id ? drop.where : undefined;
  const children = docs.children.get(page.id) ?? [];
  const expanded = children.length > 0 && isExpanded(page);
  const inset = `${0.5 + Math.min(depth, MAX_INDENT) * 0.75}rem`;
  return (
    <li className="min-w-0">
      <div
        className={cn(
          "group/row relative rounded-lg transition-[background-color,opacity] duration-150",
          over === "inside" && "bg-primary/20",
          dragged === page.id && "opacity-50"
        )}
        {...dnd(page)}
      >
        {over && over !== "inside" && (
          <span
            aria-hidden
            className={cn(
              "bg-primary pointer-events-none absolute right-1 z-10 h-0.5 rounded-full",
              over === "before" ? "-top-px" : "-bottom-px"
            )}
            style={{ left: inset }}
          />
        )}
        <SidebarMenuSubButton
          className="group-focus-within/row:pr-14 group-hover/row:pr-14 has-data-popup-open:pr-14"
          isActive={page.id === openId}
          render={<NavLink href={pagePath(project, page)} />}
          style={{ paddingLeft: inset }}
        >
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              children.length > 0 && "group-hover/row:invisible"
            )}
          >
            <PageIcon className="text-muted-foreground" page={page} />
          </span>
          <span className={cn(!page.title.trim() && "text-muted-foreground")}>
            {pageTitle(page)}
          </span>
        </SidebarMenuSubButton>
        {children.length > 0 && (
          // Over the page icon while hovered, like Notion's.
          <ActionButton
            aria-expanded={expanded}
            className="invisible absolute top-1 size-6 -translate-x-1 group-hover/row:visible focus-visible:visible [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out aria-expanded:[&>svg]:rotate-90"
            label={`${expanded ? "Collapse" : "Expand"} ${pageTitle(page)}`}
            onClick={() => onExpandedChange(page, !expanded)}
            style={{ left: inset }}
          >
            <ChevronRightIcon />
          </ActionButton>
        )}
        <div
          className={cn(
            "absolute top-1 right-1 flex items-center gap-px",
            REVEAL
          )}
        >
          <PageMenu
            align="start"
            docs={docs}
            page={page}
            project={project}
            trigger={
              <ActionButton label={`More for ${pageTitle(page)}`}>
                <EllipsisIcon />
              </ActionButton>
            }
          />
          <ActionButton
            label={`Add a page inside ${pageTitle(page)}`}
            onClick={() => onAdd(page)}
          >
            <PlusIcon />
          </ActionButton>
        </div>
      </div>
      {expanded && (
        <ul className="flex min-w-0 flex-col gap-0.5 pt-0.5">
          {children.map((child) => (
            <PageRow depth={depth + 1} key={child.id} page={child} {...tree} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A project's docs in the sidebar: a link to them, and their pages as a tree. */
export function SidebarDocs({
  project,
  docs,
}: {
  project: Project;
  docs: DocsContent;
}) {
  const [location, navigate] = useLocation();
  const { setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const base = docsPath(project);
  const openId = location.startsWith(`${base}/`)
    ? parsePageParam(location.slice(base.length + 1))
    : undefined;
  const openPage = openId ? docs.byId.get(openId) : undefined;
  // The pages above the open one unfold, so it shows, and stay unfolded after.
  const trail = openPage
    ? ancestors(docs, openPage).map((page) => page.id)
    : [];
  const reveal = openPage ? `${openPage.id}:${trail.join(",")}` : undefined;
  const [revealed, setRevealed] = useState<string>();
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (trail.length > 0) {
      setExpanded({
        ...expanded,
        ...Object.fromEntries(trail.map((id) => [id, true])),
      });
    }
  }

  const add = (parent?: DocPage) => {
    const { id } = createPage(project, docs, { parent: parent?.id });
    if (parent) {
      setExpanded({ ...expanded, [parent.id]: true });
    }
    setOpen(true);
    setOpenMobile(false);
    navigate(pagePath(project, { id, title: "" }));
  };

  const [dragged, setDragged] = useState<string>();
  const [drop, setDrop] = useState<Drop>();
  const moving = dragged ? docs.byId.get(dragged) : undefined;

  const endDrag = () => {
    setDragged(undefined);
    setDrop(undefined);
  };

  // Puts the dragged page where it was dropped, unless it's already there.
  const place = (page: DocPage, target: DocPage, where: Where) => {
    if (where === "inside") {
      if (page.parent !== target.id) {
        movePage(project, docs, page, target.id);
      }
      setExpanded({ ...expanded, [target.id]: true });
      return;
    }
    const siblings = target.parent
      ? (docs.children.get(target.parent) ?? [])
      : docs.roots;
    const index = siblings.indexOf(target);
    if (siblings[where === "before" ? index - 1 : index + 1] === page) {
      return;
    }
    const others = siblings.filter((item) => item !== page);
    const at = others.indexOf(target);
    movePage(
      project,
      docs,
      page,
      target.parent,
      where === "before"
        ? { after: target, before: others[at - 1] }
        : { after: others[at + 1], before: target }
    );
  };

  // Shows where the page would land, if it may go there.
  const hover = (
    event: DragEvent<HTMLElement>,
    next: Drop,
    parent?: string
  ) => {
    if (
      !moving ||
      next.id === moving.id ||
      !canMoveUnder(docs, moving, parent)
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (drop?.id !== next.id || drop.where !== next.where) {
      setDrop(next);
    }
  };

  const leave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) {
      setDrop(undefined);
    }
  };

  const dnd = (page: DocPage): HTMLAttributes<HTMLDivElement> => ({
    draggable: true,
    onDragEnd: endDrag,
    onDragLeave: leave,
    onDragOver: (event) => {
      const where = whereOver(event);
      hover(
        event,
        { id: page.id, where },
        where === "inside" ? page.id : page.parent
      );
    },
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      setDragged(page.id);
    },
    onDrop: (event) => {
      event.preventDefault();
      if (moving && drop?.id === page.id) {
        place(moving, page, drop.where);
      }
      endDrag();
    },
  });

  const tree: TreeProps = {
    dnd,
    docs,
    dragged,
    drop,
    isExpanded: (page) => expanded[page.id] ?? false,
    onAdd: add,
    onExpandedChange: (page, next) =>
      setExpanded({ ...expanded, [page.id]: next }),
    openId,
    project,
  };

  return (
    <Collapsible
      onOpenChange={setOpen}
      open={open}
      render={<SidebarMenuSubItem />}
    >
      <div
        className={cn(
          "group/row relative rounded-lg transition-colors duration-150",
          drop?.id === "" && "bg-primary/20"
        )}
        onDragLeave={leave}
        onDragOver={(event) => hover(event, { id: "", where: "inside" })}
        onDrop={(event) => {
          event.preventDefault();
          if (moving && drop?.id === "" && moving.parent !== undefined) {
            movePage(project, docs, moving);
          }
          endDrag();
        }}
      >
        <SidebarMenuSubButton
          className="group-focus-within/row:pr-14 group-hover/row:pr-14"
          isActive={location === base}
          render={<NavLink href={base} />}
        >
          <BookOpenTextIcon />
          <span>Docs</span>
        </SidebarMenuSubButton>
        <div className="absolute top-1 right-1 flex items-center gap-px">
          <ActionButton
            className={REVEAL}
            label={`New page in ${project.title}`}
            onClick={() => add()}
          >
            <PlusIcon />
          </ActionButton>
          {docs.roots.length > 0 && (
            <CollapsibleTrigger
              render={
                <ActionButton
                  className={cn(
                    REVEAL,
                    "[&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out data-panel-open:[&>svg]:rotate-90"
                  )}
                  label={`${open ? "Collapse" : "Expand"} docs`}
                />
              }
            >
              <ChevronRightIcon />
            </CollapsibleTrigger>
          )}
        </div>
      </div>
      {docs.roots.length > 0 && (
        <CollapsibleContent>
          <ul className="flex min-w-0 flex-col gap-0.5 pt-0.5">
            {docs.roots.map((page) => (
              <PageRow depth={1} key={page.id} page={page} {...tree} />
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
