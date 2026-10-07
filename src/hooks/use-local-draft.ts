import { useRef, useState } from "react";

import { readDraft, writeDraft } from "@/lib/drafts";

/**
 * State that's also kept in this browser under `key`, so what's being written
 * survives the dialog closing, a reload or a crash, and comes back the next
 * time it opens. Setting it back to empty, e.g. once sent, drops the draft.
 *
 * The key is read once: mount it per thing being written, with a React `key`.
 */
export function useLocalDraft<T>(
  key: string,
  /** The saved draft, or the starting value when `saved` is `undefined` or unusable. */
  parse: (saved: unknown) => T,
  /** Nothing worth keeping. */
  isEmpty: (value: T) => boolean
): [T, (update: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState(() => parse(readDraft(key)));
  // Updates in one event build on each other, before any re-render.
  const latest = useRef(value);

  // Saved right away rather than in an effect, so a commit made while the
  // dialog unmounts, like the description editor's, still lands.
  const set = (update: T | ((current: T) => T)) => {
    const next =
      typeof update === "function"
        ? (update as (current: T) => T)(latest.current)
        : update;
    latest.current = next;
    setValue(next);
    writeDraft(key, isEmpty(next) ? undefined : next);
  };

  return [value, set];
}
