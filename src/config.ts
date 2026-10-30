import { normalizeToPubkey } from "applesauce-core/helpers/pointers";
import { normalizeURL } from "applesauce-core/helpers/url";

export interface MapConfig {
  /** URL of a baked world pack's `world.json`. */
  world: string;
}

export interface NotifierConfig {
  /** The notifier's key: inbox marks and devices are encrypted to it. */
  pubkey: string;
  /** Its VAPID public key, which browsers check web pushes against. */
  vapidKey: string;
}

export interface ReaderConfig {
  /** The reader service's key: only its readings of links are trusted. */
  pubkey: string;
}

/** A website whose blog is written in a project of the app. */
export interface WebsiteConfig {
  /** The key the website's indexer files posts under, like `example`. */
  site: string;
  /** How the app names it, like `example.org`. */
  name: string;
  /** Its address, which "View on site" links start from. */
  url: string;
  /** The languages it publishes, as ISO 639-1 codes, its main one first. */
  locales: string[];
  /** Address of the project whose blog it publishes: `30304:<owner>:<d>`. */
  project: string;
  /** The Blossom server its posts' pictures go to, and are read from. */
  media: string;
}

export interface Config {
  name: string;
  logo: string;
  logoDark: string;
  accent?: string;
  relays: string[];
  signerRelays: string[];
  lookupRelays: string[];
  /** Only organizations that set this get the map. */
  map?: MapConfig;
  /** Pubkeys of the connector services the organization runs, like a store's. */
  connectors: string[];
  /**
   * Blossom servers for the team's files: uploads go to the first, and files
   * are read from whichever has them. Only organizations that set this get the Drive.
   */
  blossom: string[];
  /** The organization's push notifier. Only organizations that run one get pushes. */
  notifier?: NotifierConfig;
  /**
   * The organization's reader, which reads, titles and files the links saved
   * to catalogs. Without one, links show as saved.
   */
  reader?: ReaderConfig;
  /** Websites whose blogs are written here. Only the projects they name get a Blog. */
  websites: WebsiteConfig[];
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const DEFAULT_SIGNER_RELAYS = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
];
const DEFAULT_LOOKUP_RELAYS = [
  "wss://purplepag.es",
  "wss://profiles.nostr1.com",
  "wss://directory.yabu.me",
];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SITE_KEY = /^[a-z0-9][a-z0-9-]*$/u;
const LOCALE = /^[a-z]{2}$/u;
const PROJECT_ADDRESS = /^30304:[0-9a-f]{64}:[^:]+$/u;

let current: Config | undefined;

export function getConfig(): Config {
  if (!current) {
    throw new Error("Config not loaded");
  }
  return current;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function relayList(
  field: string,
  value: unknown,
  fallback: string[] = []
): string[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`"${field}" must be a list of relay URLs.`);
  }
  const urls = new Set<string>();
  for (const entry of value) {
    let url: URL;
    try {
      url = new URL(String(entry));
    } catch {
      throw new ConfigError(`"${entry}" in "${field}" is not a valid URL.`);
    }
    const secure =
      url.protocol === "wss:" ||
      (url.protocol === "ws:" && LOCAL_HOSTS.has(url.hostname));
    if (!secure) {
      throw new ConfigError(`"${entry}" in "${field}" must start with wss://.`);
    }
    urls.add(normalizeURL(url.toString()));
  }
  return [...urls];
}

function mapConfig(value: unknown): MapConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const world = text(raw.world);
  if (!world) {
    throw new ConfigError(
      `"map" needs "world": the address of a world pack’s world.json.`
    );
  }
  if (!URL.canParse(world, window.location.href)) {
    throw new ConfigError(`"${world}" in "map" is not a valid address.`);
  }
  return { world };
}

/** An `https://` address, or `http://` on this machine. */
function webAddress(field: string, value: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new ConfigError(`"${value}" in "${field}" is not a valid URL.`);
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure) {
    throw new ConfigError(`"${value}" in "${field}" must start with https://.`);
  }
  return url;
}

function serverList(field: string, value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`"${field}" must be a list of server URLs.`);
  }
  return [...new Set(value.map((entry) => webAddress(field, entry).origin))];
}

function pubkeyList(field: string, value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`"${field}" must be a list of npubs.`);
  }
  return [
    ...new Set(
      value.map((entry) => {
        const pubkey = normalizeToPubkey(String(entry));
        if (!pubkey) {
          throw new ConfigError(`"${entry}" in "${field}" is not an npub.`);
        }
        return pubkey;
      })
    ),
  ];
}

const VAPID_KEY = /^[A-Za-z0-9_-]{80,100}$/u;

function notifierConfig(value: unknown): NotifierConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const pubkey = normalizeToPubkey(String(raw.pubkey ?? ""));
  if (!pubkey) {
    throw new ConfigError(`"notifier" needs "pubkey": the notifier’s npub.`);
  }
  const vapidKey = text(raw.vapidKey);
  if (!(vapidKey && VAPID_KEY.test(vapidKey))) {
    throw new ConfigError(
      `"notifier" needs "vapidKey": the VAPID public key the notifier prints.`
    );
  }
  return { pubkey, vapidKey };
}

function readerConfig(value: unknown): ReaderConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const pubkey = normalizeToPubkey(String(raw.pubkey ?? ""));
  if (!pubkey) {
    throw new ConfigError(`"reader" needs "pubkey": the reader’s npub.`);
  }
  return { pubkey };
}

function website(value: unknown): WebsiteConfig {
  const raw: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const site = text(raw.site);
  if (!(site && SITE_KEY.test(site))) {
    throw new ConfigError(
      `Each of "websites" needs "site": a key of lowercase letters, digits and hyphens, like "example".`
    );
  }
  const field = `websites.${site}`;
  const locales = Array.isArray(raw.locales)
    ? [...new Set(raw.locales.map(String))]
    : [];
  if (locales.length === 0 || !locales.every((locale) => LOCALE.test(locale))) {
    throw new ConfigError(
      `"${field}" needs "locales": the languages it publishes, as two-letter codes like ["pt", "en"].`
    );
  }
  const project = text(raw.project);
  if (!(project && PROJECT_ADDRESS.test(project))) {
    throw new ConfigError(
      `"${field}" needs "project": the address of the project its blog is written in, as 30304:<owner hex>:<project d>.`
    );
  }
  if (raw.media === undefined) {
    throw new ConfigError(
      `"${field}" needs "media": the Blossom server its pictures go to.`
    );
  }
  const url = webAddress(field, raw.url);
  return {
    locales,
    media: webAddress(field, raw.media).origin,
    name: text(raw.name) ?? url.host,
    project,
    site,
    url: url.href.replace(/\/+$/u, ""),
  };
}

function websiteList(value: unknown): WebsiteConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`"websites" must be a list of websites.`);
  }
  const websites = value.map(website);
  for (const [index, { site, project }] of websites.entries()) {
    const earlier = websites.slice(0, index);
    if (earlier.some((other) => other.site === site)) {
      throw new ConfigError(`Two of "websites" are both "${site}".`);
    }
    if (earlier.some((other) => other.project === project)) {
      throw new ConfigError(
        `"websites.${site}" names a project another website already has: each project writes one website’s blog.`
      );
    }
  }
  return websites;
}

export async function loadConfig(): Promise<Config> {
  const response = await fetch(`${import.meta.env.BASE_URL}config.json`, {
    cache: "no-cache",
  });
  if (!response.ok) {
    throw new ConfigError("config.json is missing.");
  }
  const raw: Record<string, unknown> = await response.json().catch(() => {
    throw new ConfigError("config.json is not valid JSON.");
  });

  const relays = relayList("relays", raw.relays);
  if (relays.length === 0) {
    throw new ConfigError(
      'Add at least one team relay to "relays" in config.json.'
    );
  }
  const logo = text(raw.logo) ?? `${import.meta.env.BASE_URL}logo.svg`;

  current = {
    accent: text(raw.accent),
    blossom: serverList("blossom", raw.blossom),
    connectors: pubkeyList("connectors", raw.connectors),
    logo,
    logoDark: text(raw.logoDark) ?? logo,
    lookupRelays: relayList(
      "lookupRelays",
      raw.lookupRelays,
      DEFAULT_LOOKUP_RELAYS
    ),
    map: mapConfig(raw.map),
    name: text(raw.name) ?? "Kanban",
    notifier: notifierConfig(raw.notifier),
    reader: readerConfig(raw.reader),
    relays,
    signerRelays: relayList(
      "signerRelays",
      raw.signerRelays,
      DEFAULT_SIGNER_RELAYS
    ),
    websites: websiteList(raw.websites),
  };
  return current;
}
