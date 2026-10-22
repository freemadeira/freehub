import type { AddressReader } from "./addresses";
import type { ElementType } from "./osm";

/** What a record's stage means on OSM, as its table maps the stage's options. */
export const LISTINGS = [
  "accepting",
  "declined",
  "closed",
  "relocated",
] as const;

export type Listing = (typeof LISTINGS)[number];

export interface Position {
  lat: number;
  lon: number;
}

/** What the team's record says about a merchant, in the terms OSM needs. */
export interface Merchant {
  listing: Listing | undefined;
  /** Where a relocated business is now, once someone pinned it. */
  newLocation: Position | undefined;
  address: string;
  website: string;
  /** YYYY-MM-DD of the newest visit. */
  lastVisit: string | undefined;
}

/** The OSM element as the rules need it. */
export interface Element {
  type: ElementType;
  tags: Record<string, string>;
  /** A node's position. */
  position?: Position;
}

export interface TagChange {
  key: string;
  from?: string;
  to?: string;
}

export type Action =
  | { kind: "keep" }
  | { kind: "edit"; changes: TagChange[] }
  | { kind: "delete" }
  | {
      kind: "move";
      from: Position;
      to: Position;
      metres: number;
      changes: TagChange[];
    }
  | { kind: "by hand"; reason: string };

export interface Plan {
  action: Action;
  /** Whether the element takes bitcoin once the action is carried out. */
  onMap: boolean;
  /** The record has an address the reader can't read, so it's left out. */
  unreadAddress: boolean;
}

export interface Context {
  /** The element is a node no way or relation uses, so it can be deleted or moved. */
  standalone: boolean;
  readAddress: AddressReader | undefined;
}

/** Closer than this, the new location and the OSM pin are the same spot. */
const MOVE_THRESHOLD = 25;

const CURRENCY = "currency:XBT";
const CHECK_DATE = "check_date:currency:XBT";
const PAYMENT_TAGS = [
  "payment:bitcoin",
  "payment:lightning",
  "payment:onchain",
];
/** Taken off a business that doesn't accept bitcoin. Only the currency is ever added: records don't say lightning or on-chain. */
const BITCOIN_TAGS = new Set([
  CURRENCY,
  CHECK_DATE,
  ...PAYMENT_TAGS,
  "payment:lightning_contactless",
]);
const KEEP: Action = { kind: "keep" };

function takesBitcoin(tags: Record<string, string>): boolean {
  return [CURRENCY, ...PAYMENT_TAGS].some((key) => tags[key] === "yes");
}

function metresBetween(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function edit(changes: TagChange[]): Action {
  return changes.length > 0 ? { changes, kind: "edit" } : KEEP;
}

function byHand(reason: string): Action {
  return { kind: "by hand", reason };
}

function setting(
  tags: Record<string, string>,
  key: string,
  value: string
): TagChange[] {
  return value && tags[key] !== value
    ? [{ from: tags[key], key, to: value }]
    : [];
}

function hasAddress(tags: Record<string, string>): boolean {
  return Object.keys(tags).some((key) => key.startsWith("addr:"));
}

/** The element's addr:* tags swapped for the address's. */
function replacingAddress(
  tags: Record<string, string>,
  address: Record<string, string>
): TagChange[] {
  return [
    ...Object.entries(tags)
      .filter(([key]) => key.startsWith("addr:") && !(key in address))
      .map(([key, from]) => ({ from, key })),
    ...Object.entries(address).flatMap(([key, value]) =>
      setting(tags, key, value)
    ),
  ];
}

/** How far a relocated business's node has to go: nothing when it isn't pinned yet or is there already. */
function moveDistance(
  merchant: Merchant,
  element: Element
): number | undefined {
  const { newLocation } = merchant;
  if (!(newLocation && element.position)) {
    return undefined;
  }
  const metres = metresBetween(element.position, newLocation);
  return metres > MOVE_THRESHOLD ? metres : undefined;
}

/** Whether the plan would delete or move the node if nothing else used it: only then is OSM asked. */
export function mayDeleteOrMove(merchant: Merchant, element: Element): boolean {
  return (
    element.type === "node" &&
    (merchant.listing === "closed" ||
      (merchant.listing === "relocated" &&
        moveDistance(merchant, element) !== undefined))
  );
}

function accepting(
  merchant: Merchant,
  tags: Record<string, string>,
  address: Record<string, string> | undefined
): Action {
  const { lastVisit } = merchant;
  const checked = tags[CHECK_DATE];
  return edit([
    ...setting(tags, CURRENCY, "yes"),
    ...(lastVisit && !(checked && checked >= lastVisit)
      ? setting(tags, CHECK_DATE, lastVisit)
      : []),
    // The business's own details are the mappers': the record only fills in what OSM lacks.
    ...(tags.website || tags["contact:website"]
      ? []
      : setting(tags, "website", merchant.website.trim())),
    ...(address && !hasAddress(tags) ? replacingAddress(tags, address) : []),
  ]);
}

function declined(tags: Record<string, string>): Action {
  return edit(
    Object.entries(tags)
      .filter(([key]) => BITCOIN_TAGS.has(key))
      .map(([key, from]) => ({ from, key }))
  );
}

function closed(element: Element, standalone: boolean): Action {
  if (element.type !== "node") {
    return byHand("drawn as an area: take the business off it");
  }
  if (!standalone) {
    return byHand("a way or relation uses the node: take the business off it");
  }
  return { kind: "delete" };
}

function relocated(
  merchant: Merchant,
  element: Element,
  standalone: boolean,
  address: Record<string, string> | undefined
): Action {
  const { newLocation } = merchant;
  const from = element.position;
  if (!newLocation) {
    return KEEP;
  }
  if (element.type !== "node" || !from) {
    return byHand("drawn as an area: move it");
  }
  const metres = moveDistance(merchant, element);
  if (metres === undefined) {
    return KEEP;
  }
  const away = `${Math.round(metres)} m away`;
  if (!standalone) {
    return byHand(`${away}, and a way or relation uses the node: move it`);
  }
  if (hasAddress(element.tags) && !address) {
    return byHand(`${away}, and its new address isn't known: move it`);
  }
  return {
    changes: address ? replacingAddress(element.tags, address) : [],
    from,
    kind: "move",
    metres,
    to: newLocation,
  };
}

function actionFor(
  merchant: Merchant,
  element: Element,
  { standalone }: Context,
  address: Record<string, string> | undefined
): Action {
  switch (merchant.listing) {
    case "accepting": {
      return accepting(merchant, element.tags, address);
    }
    case "declined": {
      return declined(element.tags);
    }
    case "closed": {
      return closed(element, standalone);
    }
    case "relocated": {
      return relocated(merchant, element, standalone, address);
    }
    default: {
      return KEEP;
    }
  }
}

/** What to do to the element so it matches the merchant's record. Empty fields never clear a tag. */
export function plan(
  merchant: Merchant,
  element: Element,
  context: Context
): Plan {
  const typed = merchant.address.trim();
  const address = typed ? context.readAddress?.(typed) : undefined;
  const action = actionFor(merchant, element, context, address);
  let onMap = takesBitcoin(element.tags);
  if (merchant.listing === "accepting") {
    onMap = true;
  } else if (merchant.listing === "declined" || action.kind === "delete") {
    onMap = false;
  }
  return {
    action,
    onMap,
    unreadAddress:
      typed !== "" && context.readAddress !== undefined && !address,
  };
}
