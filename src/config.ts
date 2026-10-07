import { normalizeURL } from "applesauce-core/helpers/url";

export interface MapConfig {
  /** URL of a baked world pack's `world.json`. */
  world: string;
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
  "wss://user.kindpag.es",
  "wss://relay.damus.io",
];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
    logo,
    logoDark: text(raw.logoDark) ?? logo,
    lookupRelays: relayList(
      "lookupRelays",
      raw.lookupRelays,
      DEFAULT_LOOKUP_RELAYS
    ),
    map: mapConfig(raw.map),
    name: text(raw.name) ?? "Kanban",
    relays,
    signerRelays: relayList(
      "signerRelays",
      raw.signerRelays,
      DEFAULT_SIGNER_RELAYS
    ),
  };
  return current;
}
