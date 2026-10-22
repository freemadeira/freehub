import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { SearchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useRef, useState } from "react";

import { ShortcutKeys } from "@/components/shortcut-keys";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { getConfig } from "@/config";
import { hasBlossom } from "@/lib/blossom";
import {
  keySteps,
  keysText,
  PROJECT_KEYS,
  SHORTCUT_GROUPS,
  SHORTCUTS,
} from "@/lib/shortcuts";

interface Row {
  id: string;
  name: string;
  description?: string;
  group: string;
  keys: ReactNode;
  /** The keys as text, so they can be searched too. */
  keysText: string;
}

/** Ctrl or ⌘ with 1 to 9, as one row rather than nine. */
function projectRow(): Row {
  const [modifier] = keySteps(PROJECT_KEYS[0])[0] ?? [];
  return {
    description: "In the order the sidebar lists them",
    group: "Navigation",
    id: "go.project-number",
    keys: (
      <KbdGroup>
        <Kbd>{modifier}</Kbd>
        <Kbd>1</Kbd>
        <span className="text-muted-foreground px-0.5 text-xs">to</span>
        <Kbd>9</Kbd>
      </KbdGroup>
    ),
    keysText: `${keysText(PROJECT_KEYS[0])} to 9`,
    name: "Project 1 to 9",
  };
}

/** Shortcuts to places the team has: no Map or Drive without them. */
function offered(id: string): boolean {
  if (id === "go.map") {
    return getConfig().map !== undefined;
  }
  return id !== "go.drive" || hasBlossom();
}

function shortcutRows(): Row[] {
  const rows: Row[] = Object.values(SHORTCUTS)
    .filter((shortcut) => offered(shortcut.id))
    .map((shortcut) => ({
      description: shortcut.meta?.description,
      group: shortcut.meta?.group ?? "General",
      id: shortcut.id,
      keys: <ShortcutKeys keys={shortcut} />,
      keysText: keysText(shortcut),
      name: shortcut.meta?.name ?? shortcut.id,
    }));
  return [...rows, projectRow()];
}

function matches(row: Row, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return [row.name, row.description, row.group, row.keysText].some((text) =>
    text?.toLowerCase().includes(wanted)
  );
}

function ShortcutGroup({ title, rows }: { title: string; rows: Row[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3
        className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium"
        id={id}
      >
        {title}
      </h3>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            className="flex min-h-9 items-center gap-4 rounded-lg px-3 py-1.5"
            key={row.id}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{row.name}</span>
              {row.description && (
                <span className="text-muted-foreground truncate text-xs">
                  {row.description}
                </span>
              )}
            </span>
            <span className="ml-auto">{row.keys}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every keyboard shortcut, by section, with a field to find one. */
export function ShortcutsDialog({
  open,
  onOpenChange,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}) {
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const rows = shortcutRows().filter((row) => matches(row, query));
  return (
    <Dialog
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          setQuery("");
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        finalFocus={finalFocus}
        initialFocus={field}
      >
        <div className="flex flex-col gap-3 px-5 pt-5 pb-2">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <label className="bg-foreground/5 focus-within:bg-card focus-within:ring-ring/40 flex h-9 items-center gap-2 rounded-lg px-3 transition-[background-color,box-shadow] duration-150 focus-within:ring-2">
            <SearchIcon
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
            <input
              aria-label="Find a shortcut"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a shortcut"
              ref={field}
              value={query}
            />
          </label>
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto px-2 pb-3">
          {SHORTCUT_GROUPS.map((group) => {
            const shown = rows.filter((row) => row.group === group);
            return (
              shown.length > 0 && (
                <ShortcutGroup key={group} rows={shown} title={group} />
              )
            );
          })}
          {rows.length === 0 && (
            <p className="text-muted-foreground px-3 py-10 text-center">
              No shortcut matches “{query.trim()}”.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
