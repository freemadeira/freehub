import { PrivateKeySigner } from "applesauce-signers";

export interface NotifierConfig {
  signer: PrivateKeySigner;
  relay: string;
  /** Public relays to read people's names from, for the notifications' text. */
  lookupRelays: string[];
  vapid: { publicKey: string; privateKey: string; subject: string };
  /** How long news waits before it's pushed, so what's read meanwhile isn't. */
  delay: number;
  /** Where sent notifications are remembered, so a restart doesn't repeat them. */
  stateFile: string;
  port: number;
}

const DEFAULT_LOOKUP_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.damus.io",
];

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

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${name} must be a number of seconds.`);
  }
  return value;
}

export function loadConfig(): NotifierConfig {
  let signer: PrivateKeySigner;
  try {
    signer = PrivateKeySigner.fromKey(required("NOTIFIER_KEY"));
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError("NOTIFIER_KEY must be an nsec or a hex key.");
  }
  const subject = required("VAPID_SUBJECT");
  if (!/^(?:mailto:|https:\/\/)/u.test(subject)) {
    throw new ConfigError(
      "VAPID_SUBJECT must be a mailto: or https:// address push services can reach you at."
    );
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError("PORT must be a port number.");
  }
  const lookup = process.env.LOOKUP_RELAYS?.trim();
  return {
    delay: seconds("DELAY", 30),
    lookupRelays: lookup
      ? lookup.split(/[\s,]+/u).filter(Boolean)
      : DEFAULT_LOOKUP_RELAYS,
    port,
    relay: required("RELAY_URL"),
    signer,
    stateFile: process.env.STATE_FILE?.trim() || "/app/data/state.json",
    vapid: {
      privateKey: required("VAPID_PRIVATE_KEY"),
      publicKey: required("VAPID_PUBLIC_KEY"),
      subject,
    },
  };
}
