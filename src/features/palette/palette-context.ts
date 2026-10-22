import { createContext, use } from "react";

import type { SearchPage } from "@/features/search/search-item";

/** Lists the command palette can open straight into. */
export type Picker = "projects" | "boards";

/** Where the palette opens: its commands, or straight into a list of them. */
export type PaletteStart = SearchPage | Picker;

/** Opens the command palette, or one of its lists. */
export const PaletteContext = createContext<
  ((start?: PaletteStart) => void) | null
>(null);

export function useOpenPalette(): (start?: PaletteStart) => void {
  const open = use(PaletteContext);
  if (!open) {
    throw new Error("useOpenPalette needs a PaletteContext provider.");
  }
  return open;
}
