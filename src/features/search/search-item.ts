import type { ReactNode } from "react";

import type { Keys } from "@/lib/shortcuts";

/** Something search can open: a place in the app, or something found in one. */
export interface SearchItem {
  /** Its kind and id, which no other item in a list shares. */
  key: string;
  title: string;
  /** Where it sits, like its project, or its board and key for a card. */
  context?: string;
  /** Words from inside it, around what matched. */
  snippet?: string;
  icon: ReactNode;
  /** Where it opens. */
  href?: string;
  /** What it does instead of opening a place, given what opened it. */
  run?: (event: Event) => void;
  /** A list of its own it opens instead, to pick from. */
  page?: SearchPage;
  /** The shortcut that does the same, shown at its end. */
  keys?: Keys;
  /** Other words it's found by, like "theme" for dark mode. */
  keywords?: string;
  /** Address of the project it's in, for searches in one project. */
  project?: string;
}

/** A list of its own an item opens, like the statuses a card can move to. */
export interface SearchPage {
  /** Before the field while it's open. */
  title: string;
  placeholder: string;
  items: () => SearchItem[];
}

/** A titled group of items, as the list shows them. */
export interface SearchGroup {
  /** Which group it is, which no other group shares. */
  value: string;
  label: string;
  items: SearchItem[];
  /** Beside the title, like a way to clear what the group holds. */
  action?: ReactNode;
  /** Shown without its title, where the field already says what's listed. */
  quiet?: boolean;
}
