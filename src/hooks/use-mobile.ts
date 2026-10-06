import { useSyncExternalStore } from "react";

const query = window.matchMedia("(max-width: 767px)");

function subscribe(onChange: () => void): () => void {
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Below Tailwind's `md` breakpoint, where the sidebar turns into a sheet. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => query.matches);
}
