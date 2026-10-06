import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue, isReplaceable } from "applesauce-core/helpers/event";
import { BehaviorSubject, combineLatest, filter, map, noop } from "rxjs";
import { toast } from "sonner";

import { getConfig } from "@/config";
import type { Template } from "@/lib/model";
import { DELETE_KIND, nextCreatedAt } from "@/lib/model";
import { abortSigning, accounts, addDraft, eventStore } from "@/lib/nostr";
import { access$, publishToRelays, sessionPubkey$ } from "@/lib/relays";
import {
  readStorage,
  TimeoutError,
  withTimeout,
  writeStorage,
} from "@/lib/utils";

type Outcome =
  | { status: "ok" }
  | { status: "rejected"; reason: string }
  | { status: "failed" };

/** A signed change and the team relays that don't have it yet. */
interface Queued {
  event: NostrEvent;
  relays: string[];
  /** A relay already has it, so it counts as saved. */
  saved: boolean;
}

const SIGN_TIMEOUT = 60_000;
const RETRY_INTERVAL = 30_000;

const outboxSize$ = new BehaviorSubject(0);
const signing$ = new BehaviorSubject(0);

/** Changes no relay has accepted yet, whether still at the signer or queued to send. */
export const unsynced$ = combineLatest([signing$, outboxSize$]).pipe(
  map(([signing, queued]) => signing + queued)
);

const delivering = new Set<string>();

function outboxKey(pubkey: string): string {
  return `outbox:${pubkey}`;
}

function queue(event: NostrEvent): Queued {
  return { event, relays: getConfig().relays, saved: false };
}

// Outboxes saved before changes were tracked per relay hold bare events.
function readOutbox(pubkey: string): Queued[] {
  try {
    const items: unknown = JSON.parse(readStorage(outboxKey(pubkey)) ?? "[]");
    return Array.isArray(items)
      ? items.map((item: Queued | NostrEvent) =>
          "event" in item ? item : queue(item)
        )
      : [];
  } catch {
    return [];
  }
}

function writeOutbox(pubkey: string, items: Queued[]): void {
  writeStorage(
    outboxKey(pubkey),
    items.length > 0 ? JSON.stringify(items) : null
  );
  if (pubkey === accounts.active?.pubkey) {
    outboxSize$.next(items.filter((item) => !item.saved).length);
  }
}

function address(event: NostrEvent): string | undefined {
  return isReplaceable(event.kind)
    ? `${event.kind}:${getTagValue(event, "d") ?? ""}`
    : undefined;
}

function enqueue(event: NostrEvent): void {
  const key = address(event);
  const queued = readOutbox(event.pubkey).filter(
    (item) => key === undefined || address(item.event) !== key
  );
  writeOutbox(event.pubkey, [...queued, queue(event)]);
}

// The relays still to send it to. If the team moved relays, an unsaved change goes to the new ones.
function pending(item: Queued): string[] {
  const { relays } = getConfig();
  const known = item.relays.filter((url) => relays.includes(url));
  return known.length > 0 || item.saved ? known : relays;
}

/** Sends a queued change to every relay that doesn't have it yet. */
async function deliver(event: NostrEvent): Promise<Outcome> {
  const item =
    readOutbox(event.pubkey).find((queued) => queued.event.id === event.id) ??
    queue(event);
  delivering.add(event.id);
  try {
    const delivery = await publishToRelays(event, pending(item));
    if (!delivery) {
      return { status: "failed" };
    }
    const saved = item.saved || delivery.accepted.length > 0;
    // Relays that refused won't change their mind; the unreachable ones get it later.
    writeOutbox(
      event.pubkey,
      readOutbox(event.pubkey).flatMap((queued) => {
        if (queued.event.id !== event.id) {
          return [queued];
        }
        return delivery.failed.length > 0
          ? [{ ...queued, relays: delivery.failed, saved }]
          : [];
      })
    );
    const [refused] = delivery.refused;
    if (saved) {
      return { status: "ok" };
    }
    return refused && delivery.failed.length === 0
      ? { reason: refused.reason, status: "rejected" }
      : { status: "failed" };
  } finally {
    delivering.delete(event.id);
  }
}

async function redeliver(event: NostrEvent): Promise<void> {
  const result = await deliver(event);
  if (result.status === "rejected") {
    toast.error("The relay refused a saved change.", {
      description: result.reason,
    });
  }
}

function flush(): void {
  const pubkey = accounts.active?.pubkey;
  if (!pubkey) {
    return;
  }
  for (const { event } of readOutbox(pubkey)) {
    if (!delivering.has(event.id)) {
      redeliver(event);
    }
  }
}

export function startOutbox(): void {
  sessionPubkey$.subscribe((pubkey) => {
    const queued = pubkey ? readOutbox(pubkey) : [];
    outboxSize$.next(queued.filter((item) => !item.saved).length);
    for (const { event } of queued) {
      eventStore.add(event);
    }
    flush();
  });
  access$.pipe(filter((access) => access === "ok")).subscribe(flush);
  setInterval(flush, RETRY_INTERVAL);
  // Changes waiting for the signer only exist in memory.
  addEventListener("beforeunload", (event) => {
    if (signing$.value > 0) {
      event.preventDefault();
    }
  });
}

interface Staged {
  commit: (signed: NostrEvent) => void;
  discard: () => void;
}

// Shows the change right away and restores the previous version if it never lands.
function stage(event: EventTemplate, pubkey: string): Staged {
  if (event.kind === DELETE_KIND) {
    return { commit: (signed) => eventStore.add(signed), discard: noop };
  }
  const replaced = isReplaceable(event.kind)
    ? eventStore.getReplaceable(event.kind, pubkey, getTagValue(event, "d"))
    : undefined;
  let current: NostrEvent = {
    ...event,
    id: `draft-${crypto.randomUUID()}`,
    pubkey,
    sig: "",
  };
  addDraft(current);
  return {
    commit(signed) {
      eventStore.remove(current);
      current = signed;
      eventStore.add(signed);
    },
    discard() {
      eventStore.remove(current);
      if (replaced) {
        eventStore.add(replaced);
      }
    },
  };
}

/** Signs and publishes a change. Pass the version it replaces so it always wins. */
export async function publish(
  template: Template,
  previous?: NostrEvent
): Promise<boolean> {
  const account = accounts.active;
  if (!account) {
    return false;
  }
  const unsigned: EventTemplate = {
    ...template,
    created_at: nextCreatedAt(previous),
  };
  const staged = stage(unsigned, account.pubkey);
  let signed: NostrEvent;
  signing$.next(signing$.value + 1);
  try {
    signed = await withTimeout(
      account.signEvent(unsigned),
      SIGN_TIMEOUT,
      "Your signer didn’t answer."
    );
    // Queue before sending so a reload mid-publish can't lose the change.
    enqueue(signed);
  } catch (error) {
    if (error instanceof TimeoutError) {
      abortSigning(error);
    }
    staged.discard();
    toast.error("Change not saved", {
      description:
        error instanceof TimeoutError
          ? error.message
          : "Your signer refused it.",
    });
    return false;
  } finally {
    signing$.next(signing$.value - 1);
  }
  if (accounts.active !== account) {
    return true;
  }
  staged.commit(signed);
  const result = await deliver(signed);
  if (result.status === "rejected") {
    staged.discard();
    toast.error("The relay refused this change.", {
      description: result.reason,
    });
    return false;
  }
  return true;
}
