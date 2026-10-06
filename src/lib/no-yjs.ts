// Tiptap's drag handle also works in editors kept in step with Yjs, and
// imports Yjs helpers for that. Doc pages merge edits their own way
// (src/features/docs/page-sync.ts), so vite.config.ts resolves those imports
// to this file and Yjs stays out of the bundle. With no Yjs plugin in the
// editor, the handle never calls the position helpers.
import type { Transaction } from "@tiptap/pm/state";
import { PluginKey } from "@tiptap/pm/state";

export const ySyncPluginKey = new PluginKey("y-sync");

export function isChangeOrigin(_transaction: Transaction): boolean {
  return false;
}

export function absolutePositionToRelativePosition(): null {
  return null;
}

export function relativePositionToAbsolutePosition(): null {
  return null;
}
