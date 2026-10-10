import { readFileSync } from "node:fs";

import { PrivateKeySigner } from "applesauce-signers";

export interface SourceConfig {
  /** Stable id, part of the webhook path and of every record id. */
  id: string;
  /** Kind of source, like `shopify`. */
  type: string;
  name: string;
  /** Settings of the source's own kind, with `${VAR}` replaced from the environment. */
  [setting: string]: unknown;
}

export interface ConnectorConfig {
  signer: PrivateKeySigner;
  relay: string;
  /** Where the connector is reachable from the internet, without a trailing slash. */
  publicUrl: string;
  /** Profile name, shown on the records it writes. */
  name: string;
  port: number;
  sources: SourceConfig[];
}

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const VARIABLE = /\$\{(?<name>[A-Z0-9_]+)\}/gu;

export class ConfigError extends Error {
  override name = "ConfigError";
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Set ${name}.`);
  }
  return value;
}

// Secrets stay in the environment; the sources file names them as ${VAR}.
function substitute(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replaceAll(VARIABLE, (_, name: string) => {
      const replacement = process.env[name];
      if (replacement === undefined) {
        throw new ConfigError(`The sources file uses \${${name}}; set it.`);
      }
      return replacement;
    });
  }
  if (Array.isArray(value)) {
    return value.map(substitute);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item)])
    );
  }
  return value;
}

// From SOURCES when it's set, which suits hosts configured through environment
// variables, or else from the sources file.
function readSources(): SourceConfig[] {
  const inline = process.env.SOURCES?.trim();
  const path = process.env.SOURCES_FILE?.trim() || "/app/sources.json";
  const where = inline ? "SOURCES" : path;
  let raw: unknown;
  try {
    raw = JSON.parse(inline || readFileSync(path, "utf-8"));
  } catch (error) {
    throw new ConfigError(`Can't read the sources from ${where}: ${error}`);
  }
  if (!Array.isArray(raw)) {
    throw new ConfigError(`${where} must hold a list of sources.`);
  }
  const sources = raw.map((entry: unknown) => {
    const source = substitute(entry) as Partial<SourceConfig>;
    if (typeof source.id !== "string" || !SOURCE_ID.test(source.id)) {
      throw new ConfigError(
        `Each source needs an "id" of lowercase letters, digits and hyphens.`
      );
    }
    if (typeof source.type !== "string") {
      throw new ConfigError(`Source "${source.id}" needs a "type".`);
    }
    return {
      ...source,
      id: source.id,
      name: typeof source.name === "string" ? source.name : source.id,
      type: source.type,
    };
  });
  const ids = new Set(sources.map((source) => source.id));
  if (ids.size < sources.length) {
    throw new ConfigError("Source ids must be unique.");
  }
  return sources;
}

export function loadConfig(): ConnectorConfig {
  let signer: PrivateKeySigner;
  try {
    signer = PrivateKeySigner.fromKey(required("CONNECTOR_KEY"));
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError("CONNECTOR_KEY must be an nsec or a hex key.");
  }
  const sources = readSources();
  const [only] = sources;
  const name =
    process.env.CONNECTOR_NAME?.trim() ||
    (sources.length === 1 && only ? only.name : "Connector");
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError("PORT must be a port number.");
  }
  return {
    name,
    port,
    publicUrl: required("PUBLIC_URL").replace(/\/+$/u, ""),
    relay: required("RELAY_URL"),
    signer,
    sources,
  };
}
