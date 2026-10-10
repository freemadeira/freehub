import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { AuthRequiredError, Relay, RelayClosedError } from "applesauce-relay";
import type { PrivateKeySigner } from "applesauce-signers";
import {
  exhaustMap,
  filter,
  firstValueFrom,
  from,
  lastValueFrom,
  reduce,
  repeat,
  retry,
  Subscription,
  take,
  takeWhile,
  timeout,
  timer,
} from "rxjs";

import type { Template } from "@/lib/model";
import { nextCreatedAt } from "@/lib/model";
import { errorMessage, sleep } from "@/lib/utils";

/** Haven hands out at most this many stored events per REQ. */
const PAGE_SIZE = 500;
const AUTH_TIMEOUT = 30_000;
const REQUEST_TIMEOUT = 30_000;
/**
 * Haven takes 50 events a minute from an address, so publishes keep under
 * that, with room for anyone else behind the same address.
 */
const PUBLISH_INTERVAL = 1500;
/** Haven lets an address open only 3 connections every 5 minutes. */
const MIN_RECONNECT = 10;
const MAX_RECONNECT = 120;
const REFUSED_RETRY = 60_000;

/** The team relay as a service sees it, like a connector or the notifier: authenticated as its key. */
export class TeamRelay {
  readonly relay: Relay;
  readonly pubkey: string;
  private readonly signer: PrivateKeySigner;
  private readonly subscriptions = new Subscription();
  private nextPublish = 0;

  constructor(url: string, signer: PrivateKeySigner, pubkey: string) {
    this.relay = new Relay(url, { enablePing: true });
    this.relay.reconnectTimer = (_, attempts = 0) =>
      timer(Math.min(MIN_RECONNECT * 1.5 ** attempts, MAX_RECONNECT) * 1000);
    this.signer = signer;
    this.pubkey = pubkey;
  }

  private async answerChallenge(): Promise<void> {
    try {
      const response = await this.relay.authenticate(this.signer);
      if (!response.ok) {
        console.error(`Relay refused AUTH: ${response.message ?? ""}`);
      }
    } catch (error) {
      console.error(`AUTH failed: ${errorMessage(error)}`);
    }
  }

  // Haven answers auth-required even after AUTH when the key isn't whitelisted.
  private refused(error: unknown): boolean {
    return (
      (error instanceof AuthRequiredError &&
        this.relay.authenticatedAs === this.pubkey) ||
      (error instanceof RelayClosedError &&
        /^(?:restricted|blocked):/u.test(error.reason))
    );
  }

  /**
   * Answers each NIP-42 challenge, and keeps one subscription open: it holds
   * the connection, since Haven limits new ones, and reports `filters` events.
   */
  start(filters: Filter[], onEvent: (event: NostrEvent) => void): void {
    this.subscriptions.add(
      this.relay.challenge$
        .pipe(
          filter(
            (challenge) =>
              challenge !== null && this.relay.authenticatedAs !== this.pubkey
          ),
          exhaustMap(() => from(this.answerChallenge()))
        )
        .subscribe()
    );
    this.subscriptions.add(
      this.relay
        .req(
          filters.map((item) => ({ ...item, limit: 0 })),
          { waitForAuth: false }
        )
        .pipe(
          repeat({ delay: MIN_RECONNECT * 1000 }),
          retry({
            delay: (error: unknown) => {
              if (
                error instanceof AuthRequiredError &&
                this.relay.authenticatedAs !== this.pubkey
              ) {
                return this.relay.authenticatedAs$.pipe(
                  filter((pubkey) => pubkey === this.pubkey),
                  take(1)
                );
              }
              const refused = this.refused(error);
              console.error(
                refused
                  ? `The relay refuses this key; is its npub on the whitelist? ${errorMessage(error)}`
                  : `Relay subscription ended: ${errorMessage(error)}`
              );
              return timer(refused ? REFUSED_RETRY : MIN_RECONNECT * 1000);
            },
          })
        )
        .subscribe((message) => {
          if (message.type === "EVENT") {
            onEvent(message.event);
          }
        })
    );
  }

  close(): void {
    this.subscriptions.unsubscribe();
    this.relay.close();
  }

  /** Resolves once authenticated as the service. */
  authenticated(): Promise<unknown> {
    if (this.relay.authenticatedAs === this.pubkey) {
      return Promise.resolve();
    }
    return firstValueFrom(
      this.relay.authenticatedAs$.pipe(
        filter((pubkey) => pubkey === this.pubkey),
        timeout({
          each: AUTH_TIMEOUT,
          with: () => {
            throw new Error("The relay didn't authenticate this key.");
          },
        })
      )
    );
  }

  // A REQ answered up to EOSE. A connection that ends first is an error, not an empty answer.
  private async page(query: Filter): Promise<NostrEvent[]> {
    const { answered, events } = await lastValueFrom(
      this.relay.req([query], { waitForAuth: false }).pipe(
        takeWhile((message) => message.type !== "EOSE", true),
        reduce(
          (result, message) => {
            if (message.type === "EVENT") {
              result.events.push(message.event);
            } else if (message.type === "EOSE") {
              result.answered = true;
            }
            return result;
          },
          { answered: false, events: [] as NostrEvent[] }
        ),
        timeout(REQUEST_TIMEOUT)
      )
    );
    if (!answered) {
      throw new Error("The relay closed before answering.");
    }
    return events;
  }

  /** Every stored event matching the filter, a page at a time. */
  async fetch(query: Filter): Promise<NostrEvent[]> {
    await this.authenticated();
    const seen = new Map<string, NostrEvent>();
    let until: number | undefined;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- each page starts where the last ended
      const events = await this.page({
        ...query,
        limit: PAGE_SIZE,
        ...(until === undefined ? {} : { until }),
      });
      let fresh = 0;
      let oldest = until ?? Number.POSITIVE_INFINITY;
      for (const event of events) {
        oldest = Math.min(oldest, event.created_at);
        if (!seen.has(event.id)) {
          seen.set(event.id, event);
          fresh += 1;
        }
      }
      if (events.length < PAGE_SIZE) {
        return [...seen.values()];
      }
      // A page can end partway through a second, so ask from that second again.
      const next = fresh > 0 ? oldest : oldest - 1;
      if (next === until) {
        return [...seen.values()];
      }
      until = next;
    }
  }

  /** Signs and sends the event, newer than `previous`. Throws unless the relay takes it. */
  async publish(
    template: Template,
    previous?: NostrEvent
  ): Promise<NostrEvent> {
    const wait = this.nextPublish - Date.now();
    this.nextPublish =
      Math.max(Date.now(), this.nextPublish) + PUBLISH_INTERVAL;
    if (wait > 0) {
      await sleep(wait);
    }
    await this.authenticated();
    const event = await this.signer.signEvent({
      ...template,
      created_at: nextCreatedAt(previous),
    });
    const response = await this.relay.publish(event);
    if (!(response.ok || (response.message ?? "").startsWith("duplicate:"))) {
      throw new Error(`The relay refused the event: ${response.message ?? ""}`);
    }
    return event;
  }
}
