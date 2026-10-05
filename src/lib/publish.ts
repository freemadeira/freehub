import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue, isReplaceable } from "applesauce-core/helpers/event";
import { BehaviorSubject, combineLatest, filter, map, noop } from "rxjs";
import { toast } from "sonner";

import type { Template } from "@/lib/model";
import { DELETE_KIND, nextCreatedAt } from "@/lib/model";
import { abortSigning, accounts, addDraft, eventStore } from "@/lib/nostr";
import type { PublishOutcome } from "@/lib/relays";
import { access$, publishToRelays, sessionPubkey$ } from "@/lib/relays";
import {
  readStorage,
  TimeoutError,
  withTimeout,
  writeStorage,
} from "@/lib/utils";

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

function readOutbox(pubkey: string): NostrEvent[] {
  try {
    const events: unknown = JSON.parse(readStorage(outboxKey(pubkey)) ?? "[]");
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

function writeOutbox(pubkey: string, events: NostrEvent[]): void {
  writeStorage(
    outboxKey(pubkey),
    events.length > 0 ? JSON.stringify(events) : null
  );
  if (pubkey === accounts.active?.pubkey) {
    outboxSize$.next(events.length);
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
    (item) => key === undefined || address(item) !== key
  );
  writeOutbox(event.pubkey, [...queued, event]);
}

async function deliver(event: NostrEvent): Promise<PublishOutcome> {
  delivering.add(event.id);
  try {
    const result = await publishToRelays(event);
    if (result.status !== "failed") {
      writeOutbox(
        event.pubkey,
        readOutbox(event.pubkey).filter((item) => item.id !== event.id)
      );
    }
    return result;
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
  if (!pubkey || outboxSize$.value === 0) {
    return;
  }
  for (const event of readOutbox(pubkey)) {
    if (!delivering.has(event.id)) {
      redeliver(event);
    }
  }
}

export function startOutbox(): void {
  sessionPubkey$.subscribe((pubkey) => {
    const queued = pubkey ? readOutbox(pubkey) : [];
    outboxSize$.next(queued.length);
    for (const event of queued) {
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
