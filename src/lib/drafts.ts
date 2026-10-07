import { readStorage, writeStorage } from "@/lib/utils";

/**
 * Text being written but not sent yet, kept in this browser so closing a
 * dialog, the tab or the app mid-sentence doesn't lose it. localStorage over
 * IndexedDB: writes are synchronous, so they still land while the page closes.
 */

const PREFIX = "draft:";
/** Drafts left this long are given up on. */
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

interface Saved {
  value: unknown;
  /** When it was last written, in milliseconds. */
  at: number;
}

function parseSaved(raw: string | null): Saved | undefined {
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    return typeof saved === "object" &&
      saved !== null &&
      "at" in saved &&
      typeof saved.at === "number" &&
      "value" in saved
      ? { at: saved.at, value: saved.value }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Each account's drafts are its own: `draftKey(pubkey, "comment", card.id)`. */
export function draftKey(pubkey: string, ...scope: string[]): string {
  return `${PREFIX}${pubkey}:${scope.join(":")}`;
}

/** The saved draft, or `undefined` if there's none or it's too old. */
export function readDraft(key: string): unknown {
  const saved = parseSaved(readStorage(key));
  return saved && Date.now() - saved.at < MAX_AGE ? saved.value : undefined;
}

/** A saved draft's fields, to check one by one: it may predate a change to its shape. */
export function draftFields(saved: unknown): Record<string, unknown> {
  return typeof saved === "object" && saved !== null ? { ...saved } : {};
}

/** A saved text field, or empty. */
export function draftText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Saves the draft; `undefined` drops it. */
export function writeDraft(key: string, value: unknown): void {
  writeStorage(
    key,
    value === undefined ? null : JSON.stringify({ at: Date.now(), value })
  );
}

/** Drops drafts nobody came back to, so they don't pile up. */
export function pruneDrafts(): void {
  try {
    const stale = Object.keys(localStorage).filter(
      (key) => key.startsWith(PREFIX) && readDraft(key) === undefined
    );
    for (const key of stale) {
      writeStorage(key, null);
    }
  } catch {
    // Storage blocked: there are no drafts to prune.
  }
}
