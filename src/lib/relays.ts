import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { PublishResponse } from "applesauce-relay";
import { AuthRequiredError, Relay, RelayClosedError } from "applesauce-relay";
import type { Observable } from "rxjs";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  filter,
  from,
  map,
  merge,
  of,
  retry,
  scan,
  share,
  shareReplay,
  startWith,
  Subscription,
  switchMap,
  take,
  tap,
  throwError,
  timer,
} from "rxjs";

import { getConfig } from "@/config";
import { abortSigning, accounts, eventStore } from "@/lib/nostr";
import { signerState$ } from "@/lib/signer";
import { TimeoutError, withTimeout } from "@/lib/utils";

export type RelayState = "connecting" | "online" | "offline" | "rejected";
export type Access = "ok" | "offline" | "denied";
export type PublishOutcome =
  | { status: "ok" }
  | { status: "rejected"; reason: string }
  | { status: "failed" };

interface Session {
  pubkey: string;
  relays: Relay[];
  rejected$: BehaviorSubject<ReadonlySet<string>>;
  states$: Observable<RelayState[]>;
  subscription: Subscription;
}

const AUTH_TIMEOUT = 60_000;
const MAX_BACKOFF = 30;
const RETRY_DELAY = 15_000;
const REFUSED = /^(?:restricted|blocked|invalid|pow):/u;
const RECONNECT = {
  count: Number.POSITIVE_INFINITY,
  delay: (_: unknown, attempt: number) =>
    timer(Math.min(attempt, MAX_BACKOFF) * 1000),
  resetOnSuccess: true,
};

const session$ = new BehaviorSubject<Session | undefined>(undefined);

export const relayStates$: Observable<RelayState[]> = session$.pipe(
  switchMap((session) => session?.states$ ?? of([])),
  shareReplay(1)
);

export const access$: Observable<Access> = relayStates$.pipe(
  map((states) => {
    if (states.length > 0 && states.every((state) => state === "rejected")) {
      return "denied";
    }
    if (
      states.length > 0 &&
      states.every((state) => state === "offline" || state === "rejected")
    ) {
      return "offline";
    }
    return "ok";
  }),
  distinctUntilChanged(),
  shareReplay(1)
);

export function currentPubkey(): string | undefined {
  return session$.value?.pubkey;
}

export const sessionPubkey$: Observable<string | undefined> = session$.pipe(
  map((session) => session?.pubkey)
);

function reject(session: Session, url: string): void {
  if (!session.rejected$.value.has(url)) {
    session.rejected$.next(new Set([...session.rejected$.value, url]));
  }
}

function relayState(
  relay: Relay,
  rejected$: Observable<ReadonlySet<string>>
): Observable<RelayState> {
  return combineLatest([relay.connected$, relay.attempts$, rejected$]).pipe(
    map(([connected, attempts, rejected]): RelayState => {
      if (rejected.has(relay.url)) {
        return "rejected";
      }
      if (connected) {
        return "online";
      }
      return attempts > 0 ? "offline" : "connecting";
    }),
    distinctUntilChanged()
  );
}

async function authenticate(session: Session, relay: Relay): Promise<void> {
  try {
    const response = await withTimeout(
      relay.authenticate(accounts.signer),
      AUTH_TIMEOUT,
      "auth"
    );
    if (!response.ok && REFUSED.test(response.message ?? "")) {
      reject(session, relay.url);
    }
  } catch (error) {
    if (error instanceof TimeoutError) {
      abortSigning(error);
    }
  }
}

// NIP-42: answer each challenge once the signer is reachable.
function autoAuth(session: Session, relay: Relay): Subscription {
  return combineLatest([relay.challenge$, signerState$])
    .pipe(
      filter(
        ([challenge, signer]) =>
          challenge !== null &&
          signer === "live" &&
          relay.authenticatedAs !== session.pubkey
      ),
      exhaustMap(() => from(authenticate(session, relay)))
    )
    .subscribe();
}

function createSession(pubkey: string): Session {
  const relays = getConfig().relays.map((url) => {
    const relay = new Relay(url);
    relay.reconnectTimer = (_, attempts = 0) =>
      timer(Math.min(1.5 ** attempts, MAX_BACKOFF) * 1000);
    return relay;
  });
  const rejected$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  const session: Session = {
    pubkey,
    rejected$,
    relays,
    states$: combineLatest(
      relays.map((relay) => relayState(relay, rejected$))
    ).pipe(shareReplay(1)),
    subscription: new Subscription(),
  };
  for (const relay of relays) {
    session.subscription.add(autoAuth(session, relay));
  }
  return session;
}

function closeSession(session: Session): void {
  session.subscription.unsubscribe();
  for (const relay of session.relays) {
    relay.close();
  }
  eventStore.removeByFilters({});
}

export function startRelays(): void {
  accounts.active$
    .pipe(
      map((account) => account?.pubkey),
      distinctUntilChanged()
    )
    .subscribe((pubkey) => {
      const previous = session$.value;
      if (previous) {
        closeSession(previous);
      }
      session$.next(pubkey ? createSession(pubkey) : undefined);
    });
}

// Haven answers auth-required even after AUTH when the key isn't whitelisted,
// so retry only while we are not yet authenticated as this user.
function isRefusal(error: unknown, relay: Relay, pubkey: string): boolean {
  if (error instanceof AuthRequiredError) {
    return relay.authenticatedAs === pubkey;
  }
  return (
    error instanceof RelayClosedError &&
    /^(?:restricted|blocked):/u.test(error.reason)
  );
}

function relayFeed(
  session: Session,
  relay: Relay,
  filters: Filter[]
): Observable<boolean> {
  return relay.req(filters, { reconnect: RECONNECT, waitForAuth: false }).pipe(
    retry({
      delay: (error: unknown) => {
        if (
          error instanceof AuthRequiredError &&
          relay.authenticatedAs !== session.pubkey
        ) {
          return relay.authenticatedAs$.pipe(
            filter((pubkey) => pubkey === session.pubkey),
            take(1)
          );
        }
        if (isRefusal(error, relay, session.pubkey)) {
          return throwError(() => error);
        }
        return timer(RETRY_DELAY);
      },
    }),
    tap((message) => {
      if (message.type === "EVENT") {
        eventStore.add(message.event, relay.url);
      }
    }),
    map((message) => message.type === "EOSE"),
    catchError(() => {
      reject(session, relay.url);
      return EMPTY;
    })
  );
}

function sessionFeed(session: Session, filters: Filter[]): Observable<boolean> {
  const synced$ = merge(
    ...session.relays.map((relay) => relayFeed(session, relay, filters))
  ).pipe(
    scan((synced, eose) => synced || eose, false),
    startWith(false),
    share()
  );
  const unreachable$ = session.states$.pipe(
    map((states) =>
      states.every((state) => state === "offline" || state === "rejected")
    )
  );
  return combineLatest([synced$, unreachable$]).pipe(
    map(([synced, unreachable]) => synced || unreachable)
  );
}

/** Longest tag value that relays built on eventstore (Haven among them) index. */
const MAX_INDEXED_TAG = 100;

/**
 * Relay filters for events pointing at any of the addresses through `tag`.
 * Boards, projects, cards and records made before `d` tags were shortened
 * have addresses too long to be indexed, so events pointing at those are
 * asked for by author instead. Read them back from the store with the exact
 * address filter, which matches locally whatever the length.
 */
export function addressFilters(
  tag: "#a" | "#A",
  addresses: string[],
  base: Filter,
  authors: string[]
): Filter[] {
  const indexed = addresses.filter(
    (address) => address.length <= MAX_INDEXED_TAG
  );
  const filters: Filter[] =
    indexed.length > 0 ? [{ ...base, [tag]: indexed }] : [];
  if (indexed.length < addresses.length) {
    filters.push({ ...base, authors });
  }
  return filters;
}

/** Streams matching events from the team relays into the store and reports when the first relay finished. */
export function sync(filters: Filter[]): Observable<boolean> {
  return session$.pipe(
    switchMap((session) =>
      session ? sessionFeed(session, filters) : of(false)
    ),
    distinctUntilChanged()
  );
}

function outcome(
  responses: PromiseSettledResult<PublishResponse>[],
  session: Session
): PublishOutcome {
  let reason: string | undefined;
  for (const [index, result] of responses.entries()) {
    if (result.status === "fulfilled") {
      const message = result.value.message ?? "";
      if (result.value.ok || message.startsWith("duplicate:")) {
        return { status: "ok" };
      }
      if (REFUSED.test(message)) {
        reason = message;
      }
    } else {
      const relay = session.relays[index];
      if (relay && isRefusal(result.reason, relay, session.pubkey)) {
        reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
      }
    }
  }
  return reason ? { reason, status: "rejected" } : { status: "failed" };
}

export async function publishToRelays(
  event: NostrEvent
): Promise<PublishOutcome> {
  const session = session$.value;
  if (!session || session.pubkey !== event.pubkey) {
    return { status: "failed" };
  }
  const responses = await Promise.allSettled(
    session.relays.map((relay) => relay.publish(event))
  );
  return outcome(responses, session);
}
