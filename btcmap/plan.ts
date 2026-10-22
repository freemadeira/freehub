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
  /** The record's title, the business's name. */
  name: string;
  listing: Listing | undefined;
  /** Where the record has the business; for a relocated one, where it was. */
  location: Position | undefined;
  /** Where a relocated business is now, once someone pinned it. */
  newLocation: Position | undefined;
  address: string;
  website: string;
  /** YYYY-MM-DD of the newest visit since the record took its stage. */
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
  /** The plan needed the record's address, and the reader couldn't read it. */
  unreadAddress: boolean;
}

export interface Context {
  /** The element is a node no way or relation uses, so it can be deleted or moved. */
  standalone: boolean;
  readAddress: AddressReader | undefined;
}

/** Closer than this, two positions are the same spot. */
const MOVE_THRESHOLD = 25;

const CURRENCY = "currency:XBT";
const CHECK_DATE = "check_date:currency:XBT";
const PAYMENT_TAGS = [
  "payment:bitcoin",
  "payment:lightning",
  "payment:onchain",
];
/** Only the currency is ever added: records don't say lightning or on-chain. */
const ACCEPTANCE_TAGS = new Set([
  CURRENCY,
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

function isNear(a: Position, b: Position | undefined): boolean {
  return b !== undefined && metresBetween(a, b) <= MOVE_THRESHOLD;
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

function removing(tags: Record<string, string>, keys: string[]): TagChange[] {
  return keys.flatMap((key) =>
    tags[key] === undefined ? [] : [{ from: tags[key], key }]
  );
}

/** The tags once the changes are made. */
function applying(
  tags: Record<string, string>,
  changes: TagChange[]
): Record<string, string> {
  const next = new Map(Object.entries(tags));
  for (const { key, to } of changes) {
    if (to === undefined) {
      next.delete(key);
    } else {
      next.set(key, to);
    }
  }
  return Object.fromEntries(next);
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
    ...removing(
      tags,
      Object.keys(tags).filter(
        (key) => key.startsWith("addr:") && !(key in address)
      )
    ),
    ...Object.entries(address).flatMap(([key, value]) =>
      setting(tags, key, value)
    ),
  ];
}

/** The website as OSM takes it: a full http or https address, or nothing. */
function webAddress(text: string): string {
  const url = URL.parse(text.trim());
  return url && ["http:", "https:"].includes(url.protocol) ? text.trim() : "";
}

function normalized(text: string): string {
  return text
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether the element is still the record's business: its name, alone or with
 * its branch, is the record's title. A link to a spot another business took
 * since must not change that business.
 */
function sameBusiness(
  merchant: Merchant,
  tags: Record<string, string>
): boolean {
  const { name = "", branch = "" } = tags;
  const title = normalized(merchant.name);
  return (
    name !== "" &&
    [name, `${name} ${branch}`].some(
      (candidate) => normalized(candidate) === title
    )
  );
}

/** A relocated business's node still where the record had it, and away from where it is now. */
function wouldMove(merchant: Merchant, element: Element): boolean {
  const { position } = element;
  return (
    merchant.listing === "relocated" &&
    element.type === "node" &&
    position !== undefined &&
    merchant.newLocation !== undefined &&
    !isNear(position, merchant.newLocation) &&
    isNear(position, merchant.location)
  );
}

/** Whether the plan would delete or move the node if nothing else used it: only then is OSM asked. */
export function mayDeleteOrMove(merchant: Merchant, element: Element): boolean {
  return (
    (merchant.listing === "closed" && element.type === "node") ||
    wouldMove(merchant, element)
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
      : setting(tags, "website", webAddress(merchant.website))),
    ...(address && !hasAddress(tags) ? replacingAddress(tags, address) : []),
  ]);
}

/** Takes off what says the business accepts bitcoin. An explicit "no" stays: it's true. */
function declined(tags: Record<string, string>): Action {
  const accepted = Object.keys(tags).filter(
    (key) => ACCEPTANCE_TAGS.has(key) && tags[key] === "yes"
  );
  return accepted.length > 0
    ? edit(removing(tags, [...accepted, CHECK_DATE]))
    : KEEP;
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
  const { location, newLocation } = merchant;
  const { position, tags } = element;
  if (!newLocation) {
    return KEEP;
  }
  if (element.type !== "node" || !position) {
    return byHand("drawn as an area: move it");
  }
  const metres = metresBetween(position, newLocation);
  if (metres <= MOVE_THRESHOLD) {
    return KEEP;
  }
  const away = `${Math.round(metres)} m from its new location`;
  // Once moved, or put right by a mapper, the node isn't where the record had it, and stays put.
  if (!isNear(position, location)) {
    return byHand(`${away}, and not where the record had it: check it`);
  }
  if (!standalone) {
    return byHand(`${away}, and a way or relation uses the node: move it`);
  }
  const changes = address ? replacingAddress(tags, address) : [];
  // An address that changes nothing on OSM is the old one.
  if (hasAddress(tags) && changes.length === 0) {
    return byHand(`${away}, and its new address isn't known: move it`);
  }
  return { changes, from: position, kind: "move", metres, to: newLocation };
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

/** The element's tags once the action is carried out, or nothing once it's deleted. */
function tagsAfter(
  tags: Record<string, string>,
  action: Action
): Record<string, string> | undefined {
  switch (action.kind) {
    case "delete": {
      return undefined;
    }
    case "edit":
    case "move": {
      return applying(tags, action.changes);
    }
    default: {
      return tags;
    }
  }
}

/** What to do to the element so it matches the merchant's record. Empty fields never clear a tag. */
export function plan(
  merchant: Merchant,
  element: Element,
  context: Context
): Plan {
  const { tags } = element;
  const typed = merchant.address.trim();
  const address = typed ? context.readAddress?.(typed) : undefined;
  let action = actionFor(merchant, element, context, address);
  if (action.kind !== "keep" && !sameBusiness(merchant, tags)) {
    action = byHand(
      `OSM calls it "${tags.name ?? ""}", the record "${merchant.name}": check the link`
    );
  }
  const after = tagsAfter(tags, action);
  const wantsAddress =
    (merchant.listing === "accepting" && !hasAddress(tags)) ||
    wouldMove(merchant, element);
  return {
    action,
    onMap: after !== undefined && takesBitcoin(after),
    unreadAddress:
      wantsAddress &&
      typed !== "" &&
      context.readAddress !== undefined &&
      !address,
  };
}
