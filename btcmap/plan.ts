import type { StageKind } from "@/lib/crm";

/** What the team's records say about a merchant, in the terms OSM needs. */
export interface Merchant {
  /** `won` takes bitcoin, `lost` doesn't (not interested, or closed), `open` is still being worked on. */
  stage: StageKind | undefined;
  /** The business is gone from this address: closed or moved away. */
  closed: boolean;
  name: string;
  address: string;
  website: string;
  /** YYYY-MM-DD of the newest visit, Lisbon time. */
  lastVisit: string | undefined;
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
  const address = merchant.address.trim() ? splitAddress(merchant.address) : undefined;
  for (const [key, value] of Object.entries(address ?? {})) {
    set(key, value);
  }
  return {
    ...result,
    changes,
    onBtcMap: true,
    unsplitAddress: merchant.address.trim() !== "" && !address,
  };
}
