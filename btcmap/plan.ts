import type { StageKind } from "@/lib/crm";

/** What the team's records say about a merchant, in the terms OSM needs. */
export interface Merchant {
  /** `won` takes bitcoin, `lost` doesn't (not interested, or closed), `open` is still being worked on. */
  stage: StageKind | undefined;
  /** The business no longer exists: its listing comes off OSM. */
  closed: boolean;
  /** The business moved: its listing follows the record's Location once the new spot is pinned. */
  relocated: boolean;
  location: Position | undefined;
  name: string;
  address: string;
  website: string;
  /** YYYY-MM-DD of the newest visit, Lisbon time. */
  lastVisit: string | undefined;
}

export interface Position {
  lat: number;
  lon: number;
}

export interface TagChange {
  key: string;
  from?: string;
  to?: string;
}

export interface Plan {
  changes: TagChange[];
  /** Delete the whole element from OSM: a closed business on a node nothing else uses. */
  deleteElement: boolean;
  /** Whether the element takes bitcoin once the changes are made. */
  onBtcMap: boolean;
  /** The address is set but couldn't be split into OSM's parts. */
  unsplitAddress: boolean;
}

// Only the currency: records don't say lightning vs. on-chain, and OSM often does (a `payment:onchain=no` must stay).
const BITCOIN_TAGS: Record<string, string> = { "currency:XBT": "yes" };
const CHECK_DATE = "check_date:currency:XBT";
const REMOVED_TAGS = [
  ...Object.keys(BITCOIN_TAGS),
  "payment:lightning",
  "payment:onchain",
  "payment:bitcoin",
  "payment:lightning_contactless",
  CHECK_DATE,
];

/** What an element that can't be deleted keeps once its business closed: the premises, not the business. */
const KEPT_WHEN_CLOSED = /^(?:addr:|building|level|entrance|indoor)/u;

const ADDRESS =
  /^(?<street>[^,]+?)[\s,]+(?<number>\d+[A-Za-z]?)\s*,\s*(?<postcode>\d{4}-\d{3})\s+(?<city>[^,\d]+)$/u;

/** A Portuguese address as OSM's addr:* parts, when it has the usual shape. */
export function splitAddress(text: string): Record<string, string> | undefined {
  const parts = ADDRESS.exec(text.trim().replaceAll(/\s+/gu, " "))?.groups;
  if (!(parts?.street && parts.number && parts.postcode && parts.city)) {
    return undefined;
  }
  return {
    "addr:city": parts.city.trim(),
    "addr:housenumber": parts.number,
    "addr:postcode": parts.postcode,
    "addr:street": parts.street.trim(),
  };
}

export function takesBitcoin(tags: Record<string, string>): boolean {
  return ["currency:XBT", "payment:bitcoin", "payment:lightning", "payment:onchain"].some(
    (key) => tags[key] === "yes"
  );
}

function removing(tags: Record<string, string>, keep: (key: string) => boolean): TagChange[] {
  return Object.entries(tags)
    .filter(([key]) => !keep(key))
    .map(([key, value]) => ({ from: value, key }));
}

/**
 * What to do to the element so it matches the merchant's record. Empty fields never clear a tag.
 * `deletable`: the element is a node no way or relation uses, so a closed business can be deleted outright.
 */
export function plan(
  merchant: Merchant,
  tags: Record<string, string>,
  deletable = false
): Plan {
  const result = { deleteElement: false, onBtcMap: false, unsplitAddress: false };
  if (merchant.closed) {
    // Closed or moved away: the listing comes off OSM. A building or shared node stays, without the business.
    return deletable
      ? { ...result, changes: [], deleteElement: true }
      : { ...result, changes: removing(tags, (key) => KEPT_WHEN_CLOSED.test(key)) };
  }
  if (merchant.stage === "lost") {
    return {
      ...result,
      changes: removing(tags, (key) => !REMOVED_TAGS.includes(key)),
    };
  }
  if (merchant.stage !== "won") {
    return { ...result, changes: [], onBtcMap: takesBitcoin(tags) };
  }
  const changes: TagChange[] = [];
  const set = (key: string, value: string) => {
    if (value && tags[key] !== value) {
      changes.push({ from: tags[key], key, to: value });
    }
  };
  for (const [key, value] of Object.entries(BITCOIN_TAGS)) {
    set(key, value);
  }
  const checked = tags[CHECK_DATE];
  if (merchant.lastVisit && !(checked && checked >= merchant.lastVisit)) {
    set(CHECK_DATE, merchant.lastVisit);
  }
  set("name", merchant.name.trim());
  set("website", merchant.website.trim());
  changes.push(...addressChanges(merchant.address, tags));
  return {
    ...result,
    changes,
    onBtcMap: true,
    unsplitAddress: merchant.address.trim() !== "" && !splitAddress(merchant.address),
  };
}

/** The addr:* changes the record's Address asks for, when it splits cleanly. */
export function addressChanges(address: string, tags: Record<string, string>): TagChange[] {
  const parts = address.trim() ? splitAddress(address) : undefined;
  return Object.entries(parts ?? {})
    .filter(([key, value]) => tags[key] !== value)
    .map(([key, value]) => ({ from: tags[key], key, to: value }));
}

/** Closer than this, the record's Location and the OSM pin are the same spot: nothing was re-pinned. */
export const MOVE_THRESHOLD = 25;

export function metresBetween(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export type Move =
  | { kind: "move"; to: Position; metres: number; changes: TagChange[] }
  | { kind: "by hand"; metres?: number };

/**
 * Where a Relocated merchant's listing goes. Nothing until the new spot is pinned in the record
 * (until then its Location is still the OSM pin's). Only a node nothing else uses is moved; a
 * building outline or a shared node is left for a mapper.
 */
export function relocation(
  merchant: Merchant,
  element: { tags: Record<string, string>; position?: Position },
  movable: boolean
): Move | undefined {
  if (!(merchant.relocated && merchant.location)) {
    return undefined;
  }
  if (!element.position) {
    return { kind: "by hand" };
  }
  const metres = metresBetween(element.position, merchant.location);
  if (metres <= MOVE_THRESHOLD) {
    return undefined;
  }
  return movable
    ? {
        changes: addressChanges(merchant.address, element.tags),
        kind: "move",
        metres,
        to: merchant.location,
      }
    : { kind: "by hand", metres };
}
