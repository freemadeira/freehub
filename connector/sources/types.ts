import type { IncomingHttpHeaders } from "node:http";

import type { SourceFields } from "@/lib/sources";

/** One thing from a source, like an order, as values for its attributes. */
export interface Item {
  /** Stable id in the source, like the order id. */
  key: string;
  /** Unix seconds. */
  createdAt: number;
  updatedAt: number;
  /** Attribute id to values, in the app's text formats. */
  values: Record<string, string[]>;
}

export interface Delivery {
  headers: IncomingHttpHeaders;
  /** The raw body, as signed. */
  body: Buffer;
}

/**
 * What a kind of source does. `wanted` holds the attributes some switched-on
 * table maps: only those are fetched, so nothing unused leaves the source.
 */
export interface Adapter {
  /** The manifest the app maps from; final once `start` resolved. */
  readonly source: SourceFields;
  /** Gets access and the source's details. With a callback URL, also makes sure webhooks go there. */
  start: (callbackUrl?: string) => Promise<void>;
  /** The items a webhook delivery is about, or "invalid" when it isn't genuine. */
  receive: (
    delivery: Delivery,
    wanted: Set<string>
  ) => Promise<Item[] | "invalid">;
  /** Every item changed since then, oldest change first. */
  changedSince: (since: Date, wanted: Set<string>) => AsyncIterable<Item>;
}
