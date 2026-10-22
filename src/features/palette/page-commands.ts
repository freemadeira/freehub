import { useEffect, useId, useSyncExternalStore } from "react";

import type { SearchItem } from "@/features/search/search-item";

/** What a page on screen can do, under its own title in the command palette. */
export interface PageCommands {
  title: string;
  items: SearchItem[];
}

/** A page's commands, and which page they're from, which no other shares. */
export interface ShownCommands extends PageCommands {
  id: string;
}

/** When each page came on screen, which keeps their order. */
const arrived = new Map<string, number>();
const shown = new Map<string, PageCommands>();
const listeners = new Set<() => void>();
let snapshot: ShownCommands[] = [];
let count = 0;

function changed() {
  snapshot = [...shown.entries()]
    .toSorted(([a], [b]) => (arrived.get(a) ?? 0) - (arrived.get(b) ?? 0))
    .map(([id, commands]) => ({ ...commands, id }));
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Offers what the page can do in the command palette, for as long as it's on
 * screen. Kept up with every render, so the commands act on what the page
 * shows now.
 */
export function usePageCommands(title: string, items: SearchItem[]): void {
  const id = useId();
  useEffect(() => {
    count += 1;
    arrived.set(id, count);
    return () => {
      arrived.delete(id);
    };
  }, [id]);
  useEffect(() => {
    shown.set(id, { items, title });
    changed();
    return () => {
      shown.delete(id);
      changed();
    };
  });
}

/** What the pages on screen offer, the first to come on screen first. */
export function usePageCommandGroups(): ShownCommands[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}
