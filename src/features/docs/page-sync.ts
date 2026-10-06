import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import { isSigned } from "@/lib/docs";
import { mergeText } from "@/lib/merge";
import { newer } from "@/lib/model";

/** Typing pauses this long before the page saves. */
const SAVE_DELAY = 1000;
/** Typing without a pause still saves this often. */
const MAX_DELAY = 5000;
/** A busy editor (mid-composition) takes a teammate's edit this much later. */
const RETRY_DELAY = 250;
/** Own saves remembered, to tell them apart when they come back from the relay. */
const REMEMBERED = 10;

export interface PageSyncOptions {
  /** The person editing. */
  me: string;
  /** The version the editor opened. */
  opened: NostrEvent;
  /** The editor's text as markdown. */
  read: () => string;
  /** Shows merged markdown in the editor. */
  show: (markdown: string) => void;
  /** Whether the editor can't take outside changes right now, e.g. mid-composition. */
  busy: () => boolean;
  /** Saves the text as a new version, edited from `prev`. */
  publish: (content: string, prev: NostrEvent) => Promise<boolean>;
}

/**
 * Keeps an open page and its versions on the relays in step. Edits save a
 * moment after typing pauses; a teammate's version is merged into the text
 * as it arrives, with the version it was edited from as the common base, so
 * neither side's edits to other lines are lost.
 */
export class PageSync {
  readonly #options: PageSyncOptions;
  /** The newest version the text builds on: its next save is edited from it. */
  #synced: NostrEvent;
  /** The text as last saved or merged; anything else in the editor is unsaved. */
  #saved: string;
  /** Saves another change, like the title, even when the text is unchanged. */
  #forced = false;
  readonly #mine: string[] = [];
  readonly #texts = new Map<string, string>();
  readonly #seen = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #since: number | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;

  constructor(options: PageSyncOptions, versions: NostrEvent[]) {
    this.#options = options;
    this.#synced = options.opened;
    this.#saved = options.opened.content;
    if (options.opened.pubkey === options.me) {
      // A page just made here may open before its signed version comes back.
      this.#mine.push(options.opened.content);
    }
    for (const version of versions) {
      this.#remember(version);
    }
    this.#remember(options.opened);
  }

  /** Unsaved edits, typed or merged in. */
  get dirty(): boolean {
    return (
      this.#forced ||
      this.#timer !== undefined ||
      this.#options.read() !== this.#saved
    );
  }

  #remember(version: NostrEvent): void {
    this.#seen.add(version.id);
    if (isSigned(version)) {
      this.#texts.set(version.id, version.content);
    }
  }

  /** Takes in every member's newest version of the page, each time they change. */
  receive(versions: NostrEvent[]): void {
    clearTimeout(this.#retry);
    if (this.#options.busy()) {
      this.#retry = setTimeout(() => this.receive(versions), RETRY_DELAY);
      return;
    }
    const fresh = versions
      .filter((version) => !this.#seen.has(version.id))
      .toSorted((a, b) => a.created_at - b.created_at);
    for (const version of fresh) {
      this.#remember(version);
      const own =
        version.pubkey === this.#options.me &&
        this.#mine.includes(version.content);
      if (!own) {
        this.#merge(version);
      } else if (isSigned(version) && newer(version, this.#synced)) {
        this.#synced = version;
      }
    }
  }

  #merge(theirs: NostrEvent): void {
    const prev = getTagValue(theirs, "prev");
    const known = prev === undefined ? undefined : this.#texts.get(prev);
    // A version from before the page opened, edited from one this device
    // never saw, can't be placed: merging it would undo what came since.
    const base =
      known ?? (newer(theirs, this.#synced) ? this.#synced.content : undefined);
    if (base === undefined || !isSigned(theirs)) {
      return;
    }
    const mine = this.#options.read();
    const unsaved = mine !== this.#saved || this.#timer !== undefined;
    const merged = mergeText(base, mine, theirs.content, unsaved);
    this.#synced = theirs;
    this.#saved = theirs.content;
    if (merged !== mine) {
      this.#options.show(merged);
    }
    // What's left differs from their version: save it so they get it too.
    if (this.#options.read() !== this.#saved) {
      this.changed();
    }
  }

  /** The text or another part of the page changed: save once typing pauses. */
  changed(force = false): void {
    this.#forced ||= force;
    const now = Date.now();
    this.#since ??= now;
    clearTimeout(this.#timer);
    const wait = Math.min(SAVE_DELAY, MAX_DELAY - (now - this.#since));
    this.#timer = setTimeout(() => this.save(), Math.max(0, wait));
  }

  /** Saves now, if anything changed. */
  save(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#since = undefined;
    const text = this.#options.read();
    if (text === this.#saved && !this.#forced) {
      return;
    }
    this.#forced = false;
    const before = this.#saved;
    this.#saved = text;
    this.#mine.push(text);
    if (this.#mine.length > REMEMBERED) {
      this.#mine.shift();
    }
    this.#publish(text, before);
  }

  async #publish(text: string, before: string): Promise<void> {
    const saved = await this.#options.publish(text, this.#synced);
    // Not saved, e.g. the signer refused: the text stays unsaved, and the
    // next edit tries again.
    if (!saved && this.#saved === text) {
      this.#saved = before;
    }
  }

  /** Stops waiting on timers; call `save` first to keep unsaved edits. */
  dispose(): void {
    clearTimeout(this.#timer);
    clearTimeout(this.#retry);
  }
}
