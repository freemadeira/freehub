import { cn } from "cn";
import { ChevronRightIcon, HardDriveIcon } from "lucide-react";
import type { ComponentProps } from "react";
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
} from "@/components/ui/sidebar";
import { drivePath, parseFolderParam } from "@/features/drive/drive-context";
import { useDropInto } from "@/features/drive/drive-dnd";
import { FolderIcon } from "@/features/drive/file-icon";
import type { DriveFolder, DriveTree } from "@/lib/drive";
import { pathTo, TOP } from "@/lib/drive";
import type { Project } from "@/lib/project";

/** Deeper folders stop stepping in, so their names keep some room. */
const MAX_INDENT = 5;
const DROP = "bg-primary/20 ring-primary ring-2";

const ACTION =
  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-3 [&>svg]:size-4";

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
  tree: DriveTree;
  canEdit: boolean;
  openId?: string;
  isExpanded: (folder: DriveFolder) => boolean;
  onExpandedChange: (folder: DriveFolder, expanded: boolean) => void;
}

function FolderRow({
  folder,
  depth,
  ...props
}: TreeProps & { folder: DriveFolder; depth: number }) {
  const { project, tree, canEdit, openId, isExpanded, onExpandedChange } =
    props;
  const children = tree.children.get(folder.id) ?? [];
  const expanded = children.length > 0 && isExpanded(folder);
  const inset = `${0.5 + Math.min(depth, MAX_INDENT) * 0.75}rem`;
  const drop = useDropInto(folder.id, {
    canEdit,
    destination: { folder: folder.id, project },
    label: folder.name,
    project,
    tree,
  });
  return (
    <li className="min-w-0">
      <div
        className={cn(
          "group/row relative rounded-lg transition-[background-color,box-shadow] duration-150",
          drop.over && DROP
        )}
        {...drop.handlers}
      >
        <SidebarMenuSubButton
          isActive={folder.id === openId}
          render={<NavLink href={drivePath(project, folder)} />}
          style={{ paddingLeft: inset }}
        >
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              children.length > 0 && "group-hover/row:invisible"
            )}
          >
            <FolderIcon
              folder={folder}
              open={drop.over !== undefined}
              size="sm"
            />
          </span>
          <span>{folder.name}</span>
        </SidebarMenuSubButton>
        {children.length > 0 && (
          <ActionButton
            aria-expanded={expanded}
            className="invisible absolute top-1 size-6 -translate-x-1 group-hover/row:visible focus-visible:visible [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out aria-expanded:[&>svg]:rotate-90"
            label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
            onClick={() => onExpandedChange(folder, !expanded)}
            style={{ left: inset }}
          >
            <ChevronRightIcon />
          </ActionButton>
        )}
      </div>
      {expanded && (
        <ul className="flex min-w-0 flex-col gap-0.5 pt-0.5">
          {children.map((child) => (
            <FolderRow
              depth={depth + 1}
              folder={child}
              key={child.id}
              {...props}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A project's Drive in the sidebar: a link to it, and its folders as a tree.
 * Files and folders dragged onto a row move there; files from the computer
 * upload there.
 */
export function SidebarDrive({
  project,
  tree,
  canEdit,
}: {
  project: Project;
  tree: DriveTree;
  canEdit: boolean;
}) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const base = drivePath(project);
  const openId = location.startsWith(`${base}/`)
    ? parseFolderParam(location.slice(base.length + 1))
    : undefined;
  const openFolder = openId ? tree.byId.get(openId) : undefined;
  // The folders above the open one unfold, so it shows, and stay unfolded after.
  const trail = openFolder
    ? pathTo(tree, openFolder.parent).map((folder) => folder.id)
    : [];
  const reveal = openFolder ? `${openFolder.id}:${trail.join(",")}` : undefined;
  const [revealed, setRevealed] = useState<string>();
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (openFolder) {
      setOpen(true);
      setExpanded({
        ...expanded,
        ...Object.fromEntries(trail.map((id) => [id, true])),
      });
    }
  }
  const roots = tree.children.get(TOP) ?? [];
  const drop = useDropInto(undefined, {
    canEdit,
    destination: { project },
    label: "the Drive",
    project,
    tree,
  });

  const props: TreeProps = {
    canEdit,
    isExpanded: (folder) => expanded[folder.id] ?? false,
    onExpandedChange: (folder, next) =>
      setExpanded({ ...expanded, [folder.id]: next }),
    openId,
    project,
    tree,
  };

  return (
    <Collapsible
      onOpenChange={setOpen}
      open={open}
      render={<SidebarMenuSubItem />}
    >
      <div
        className={cn(
          "group/row relative rounded-lg transition-[background-color,box-shadow] duration-150",
          drop.over && DROP
        )}
        {...drop.handlers}
      >
        <SidebarMenuSubButton
          className={cn(
            roots.length > 0 &&
              "group-focus-within/row:pr-8 group-hover/row:pr-8"
          )}
          isActive={location === base}
          render={<NavLink href={base} />}
        >
          <HardDriveIcon />
          <span>Drive</span>
        </SidebarMenuSubButton>
        {roots.length > 0 && (
          <div className="absolute top-1 right-1 flex items-center">
            <CollapsibleTrigger
              render={
                <ActionButton
                  className="opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100 [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-out data-panel-open:[&>svg]:rotate-90"
                  label={`${open ? "Collapse" : "Expand"} folders`}
                />
              }
            >
              <ChevronRightIcon />
            </CollapsibleTrigger>
          </div>
        )}
      </div>
      {roots.length > 0 && (
        <CollapsibleContent>
          <ul className="flex min-w-0 flex-col gap-0.5 pt-0.5">
            {roots.map((folder) => (
              <FolderRow depth={1} folder={folder} key={folder.id} {...props} />
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
