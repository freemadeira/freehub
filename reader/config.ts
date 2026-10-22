import { PrivateKeySigner } from "applesauce-signers";

export interface ReaderConfig {
  signer: PrivateKeySigner;
  relay: string;
  /** The Blossom server pictures go to. Without it, cards show pictures from where they are on the web. */
  blossom?: string;
  /** Without a key, links get only what their pages say about themselves. */
  openRouterKey?: string;
  model: string;
  /** Runs one person may start in an hour, across what they save and sort. */
  runsPerHour: number;
  /** The organization's name, which OpenRouter shows its runs under. */
  appName: string;
  port: number;
}

/** A cheap model that takes structured output well. */
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
/** Plenty for pasting fifty links at once a few times over. */
const DEFAULT_RUNS_PER_HOUR = 200;

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

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function whole(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a whole number above 0.`);
  }
  return value;
}

function server(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("BLOSSOM_URL must be the file server's address.");
  }
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new ConfigError("BLOSSOM_URL must start with https://.");
  }
  return url.origin;
}

export function loadConfig(): ReaderConfig {
  let signer: PrivateKeySigner;
  try {
    signer = PrivateKeySigner.fromKey(required("READER_KEY"));
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError("READER_KEY must be an nsec or a hex key.");
  }
  return {
    appName: optional("APP_NAME") ?? "Freehub",
    blossom: server(optional("BLOSSOM_URL")),
    model: optional("OPENROUTER_MODEL") ?? DEFAULT_MODEL,
    openRouterKey: optional("OPENROUTER_API_KEY"),
    port: whole("PORT", 3000),
    relay: required("RELAY_URL"),
    runsPerHour: whole("AI_RUNS_PER_HOUR", DEFAULT_RUNS_PER_HOUR),
    signer,
  };
}
