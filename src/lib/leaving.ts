const savers = new Set<() => void>();

/**
 * Runs `save` before the app reloads into a new build, for whatever waits on
 * a pause in typing or a run of changes to settle. Returns the way to stop.
 */
export function onLeave(save: () => void): () => void {
  savers.add(save);
  return () => savers.delete(save);
}

/** Saves everything waiting, now. */
export function saveAll(): void {
  for (const save of savers) {
    save();
  }
}
