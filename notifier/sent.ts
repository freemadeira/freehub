import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Notifications already pushed, or let go, by recipient and id. Each keeps
 * the time of its news, and is forgotten once too old to push anyway.
 */
export class SentLog {
  /** Whether there was no log yet: the notifier's first start, or its volume went missing. */
  readonly fresh: boolean;
  private readonly file: string;
  private readonly entries = new Map<string, number>();

  constructor(file: string) {
    this.file = file;
    this.fresh = !existsSync(file);
    try {
      const saved: unknown = JSON.parse(readFileSync(file, "utf-8"));
      if (typeof saved === "object" && saved !== null) {
        for (const [key, at] of Object.entries(saved)) {
          if (typeof at === "number") {
            this.entries.set(key, at);
          }
        }
      }
    } catch {
      // An unreadable log starts over.
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Remembers the notification; `save` writes it down. */
  add(key: string, at: number): void {
    this.entries.set(key, at);
  }

  /** Forgets entries about news from before `oldest`, in seconds. */
  prune(oldest: number): void {
    for (const [key, at] of this.entries) {
      if (at < oldest) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Writes a copy, then swaps it in, so a crash mid-write keeps the last one.
   * Each push is written at once: a restart must never repeat one.
   */
  save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.entries)));
    renameSync(temporary, this.file);
  }
}
