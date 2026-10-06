import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { PublishResponse, RelayReqMessage } from "applesauce-relay";
import { AuthRequiredError, Relay, RelayClosedError } from "applesauce-relay";
import type { Observable } from "rxjs";
import {
  asyncScheduler,
  BehaviorSubject,
  catchError,
  combineLatest,
  concat,
  defer,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  expand,
  filter,
  finalize,
  from,
  ignoreElements,
  map,
  merge,
  of,
  reduce,
  ReplaySubject,
  retry,
  scan,
  share,
  shareReplay,
  startWith,
  Subscription,
  switchMap,
  take,
  takeWhile,
  tap,
  throttleTime,
  throwError,
  timer,
} from "rxjs";

import { getConfig } from "@/config";
import { abortSigning, accounts, eventStore } from "@/lib/nostr";
import { signerState$ } from "@/lib/signer";
import { errorMessage, TimeoutError, withTimeout } from "@/lib/utils";

export type RelayState = "connecting" | "online" | "offline" | "rejected";
export type Access = "ok" | "offline" | "denied";

/** What each team relay did with a published event. */
export interface Delivery {
  accepted: string[];
  refused: { url: string; reason: string }[];
  /** Unreachable, or asked to try again later. */
  failed: string[];
}

interface Session {
  pubkey: string;
  relays: Relay[];
  rejected$: BehaviorSubject<ReadonlySet<string>>;
  states$: Observable<RelayState[]>;
  subscription: Subscription;
}

/** One page of stored events, as far back as it reached. */
interface Page {
  fresh: number;
  oldest?: number;
  until?: number;
}

const AUTH_TIMEOUT = 60_000;
const MAX_BACKOFF = 30;
/**
 * Stored events asked for at a time. Haven, strfry and nak all hand out this
 * many; a relay that caps lower just answers with smaller pages.
 */
const PAGE_SIZE = 500;
/** How long a feed keeps listening after its last view closes, so going back costs nothing. */
const KEEP_ALIVE = 10 * 60_000;
/** While a feed pages through stored events, views are worked out at most this often. */
const LOADING_REFRESH = 100;
const REFUSED = /^(?:restricted|blocked|invalid|pow):/u;

/** The relay ended the connection before answering, e.g. while restarting. */
class ClosedError extends Error {
  override name = "ClosedError";
}

const session$ = new BehaviorSubject<Session | undefined>(undefined);
const feeds = new Map<string, Observable<boolean>>();

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

// A REQ answered up to EOSE. A connection that ends first is an error, not an empty answer.
function fetchPage(
  relay: Relay,
  query: Filter,
  keep: (event: NostrEvent) => void
): Observable<NostrEvent[]> {
  return defer(() =>
    relay.req([query], { waitForAuth: false }).pipe(
      takeWhile((message) => message.type !== "EOSE", true),
      reduce(
        (page, message: RelayReqMessage) => {
          if (message.type === "EVENT") {
            keep(message.event);
            page.events.push(message.event);
          } else if (message.type === "EOSE") {
            page.answered = true;
          }
          return page;
        },
        { answered: false, events: [] as NostrEvent[] }
      ),
      map(({ answered, events }) => {
        if (!answered) {
          throw new ClosedError("The relay closed before answering.");
        }
        return events;
      })
    )
  );
}

/**
 * Every stored event matching the filter, newest first, a page at a time.
 * Without a `limit`, relays only send their newest few hundred events (Haven
 * 250), so a single REQ leaves older cards and records out.
 */
function backfill(
  relay: Relay,
  query: Filter,
  keep: (event: NostrEvent) => void
): Observable<never> {
  const seen = new Set<string>();
  const wanted = query.limit ?? Number.POSITIVE_INFINITY;
  const page = (until?: number): Observable<Page> =>
    fetchPage(
      relay,
      {
        ...query,
        limit: Math.min(PAGE_SIZE, wanted - seen.size),
        ...(until === undefined ? {} : { until }),
      },
      keep
    ).pipe(
      map((events) => {
        let fresh = 0;
        let oldest: number | undefined;
        for (const event of events) {
          oldest = Math.min(oldest ?? event.created_at, event.created_at);
          if (!seen.has(event.id)) {
            seen.add(event.id);
            fresh += 1;
          }
        }
        return { fresh, oldest, until };
      })
    );
  return page().pipe(
    expand(({ fresh, oldest, until }) => {
      if (oldest === undefined || seen.size >= wanted) {
        return EMPTY;
      }
      // A page can end partway through a second, so ask from that second again.
      if (fresh > 0) {
        return page(Math.min(oldest, until ?? oldest));
      }
      // Nothing new from that second: step past it, unless the relay ignores `until`.
      return until === undefined || oldest - 1 < until
        ? page(oldest - 1)
        : EMPTY;
    }),
    ignoreElements()
  );
}

/**
 * Keeps the store in step with one relay: listens for new events, then pages
 * through the stored ones, and emits true once it has them all. Starts over
 * whenever the connection drops or the relay closes it, so nothing published
 * in between is missed.
 */
function relayFeed(
  session: Session,
  relay: Relay,
  filters: Filter[]
): Observable<boolean> {
  const keep = (event: NostrEvent) => {
    eventStore.add(event, relay.url);
  };
  const run = defer(() => {
    // `limit: 0` asks for new events only; the pages bring the stored ones.
    const live = relay
      .req(
        filters.map((item) => ({ ...item, limit: 0 })),
        { waitForAuth: false }
      )
      .pipe(share());
    return merge(
      live.pipe(
        tap((message) => {
          if (message.type === "EVENT") {
            keep(message.event);
          }
        }),
        ignoreElements()
      ),
      // Paging waits until the relay listens, so nothing slips in between.
      live.pipe(
        filter((message) => message.type === "EOSE"),
        take(1),
        exhaustMap(() =>
          concat(
            merge(...filters.map((item) => backfill(relay, item, keep))),
            of(true)
          )
        )
      )
    );
  });
  return concat(
    run,
    throwError(() => new ClosedError("Connection closed."))
  ).pipe(
    retry({
      delay: (error: unknown, attempt: number) => {
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
        return timer(Math.min(attempt, MAX_BACKOFF) * 1000);
      },
      resetOnSuccess: true,
    }),
    catchError(() => {
      reject(session, relay.url);
      return EMPTY;
    })
  );
}

// Loaded once every relay has sent all it stores or can't be reached, and from then on.
function sessionFeed(session: Session, filters: Filter[]): Observable<boolean> {
  const synced$ = combineLatest(
    session.relays.map((relay) =>
      relayFeed(session, relay, filters).pipe(startWith(false))
    )
  );
  return combineLatest([synced$, session.states$]).pipe(
    map(([synced, states]) =>
      states.every(
        (state, index) =>
          synced[index] === true || state === "offline" || state === "rejected"
      )
    ),
    scan((loaded, done) => loaded || done, false)
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

/**
 * Streams every matching event from the team relays into the store, then keeps
 * listening. Reports true once each reachable relay sent all it has.
 */
export function sync(filters: Filter[]): Observable<boolean> {
  if (filters.length === 0) {
    return of(true);
  }
  // Views asking for the same events share one feed, and it keeps listening for
  // a while after they close: going back needs no paging, the store is current.
  const key = JSON.stringify(filters);
  let feed = feeds.get(key);
  if (!feed) {
    feed = session$.pipe(
      switchMap((session) =>
        session ? sessionFeed(session, filters) : of(false)
      ),
      distinctUntilChanged(),
      finalize(() => feeds.delete(key)),
      share({
        connector: () => new ReplaySubject<boolean>(1),
        resetOnRefCountZero: () => timer(KEEP_ALIVE),
      })
    );
    feeds.set(key, feed);
  }
  return feed;
}

/**
 * The source as is once loaded. While the feed still pages through stored
 * events, at most one value per LOADING_REFRESH, so a view is worked out a
 * few times a second instead of once per event.
 */
export function whileLoading<T>(
  source: Observable<T>,
  loaded: Observable<boolean>
): Observable<T> {
  return loaded.pipe(
    distinctUntilChanged(),
    switchMap((done) =>
      done
        ? source
        : source.pipe(
            throttleTime(LOADING_REFRESH, asyncScheduler, {
              leading: true,
              trailing: true,
            })
          )
    )
  );
}

function isAccepted(result: PromiseSettledResult<PublishResponse>): boolean {
  return (
    result.status === "fulfilled" &&
    (result.value.ok || (result.value.message ?? "").startsWith("duplicate:"))
  );
}

// Why the relay won't take the event, when it refused for good rather than failed for now.
function refusal(
  result: PromiseSettledResult<PublishResponse>,
  relay: Relay,
  pubkey: string
): string | undefined {
  if (result.status === "fulfilled") {
    const message = result.value.message ?? "";
    return REFUSED.test(message) ? message : undefined;
  }
  return isRefusal(result.reason, relay, pubkey)
    ? errorMessage(result.reason)
    : undefined;
}

/** Sends the event to the given team relays. Undefined while logged out or as someone else. */
export async function publishToRelays(
  event: NostrEvent,
  urls: readonly string[]
): Promise<Delivery | undefined> {
  const session = session$.value;
  if (!session || session.pubkey !== event.pubkey) {
    return undefined;
  }
  const relays = session.relays.filter((relay) => urls.includes(relay.url));
  const responses = await Promise.allSettled(
    relays.map((relay) => relay.publish(event))
  );
  const delivery: Delivery = { accepted: [], failed: [], refused: [] };
  for (const [index, result] of responses.entries()) {
    const relay = relays[index];
    if (relay) {
      const reason = refusal(result, relay, session.pubkey);
      if (isAccepted(result)) {
        delivery.accepted.push(relay.url);
      } else if (reason === undefined) {
        delivery.failed.push(relay.url);
      } else {
        delivery.refused.push({ reason, url: relay.url });
      }
    }
  }
  return delivery;
}
