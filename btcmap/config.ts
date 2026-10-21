import { PrivateKeySigner } from "applesauce-signers";

import { CRM_TABLE_KIND, isPubkey } from "@/lib/model";

export interface BtcmapConfig {
  signer: PrivateKeySigner;
  relay: string;
  /** Address of the merchants table, `30305:<creator pubkey>:<table id>`. */
  table: string;
  osmApi: string;
  overpass: string;
}

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

function tableAddress(value: string): string {
  const [kind, creator, id] = value.split(":");
  if (kind !== String(CRM_TABLE_KIND) || !isPubkey(creator) || !id) {
    throw new ConfigError(
      `BTCMAP_TABLE must be a table address, ${CRM_TABLE_KIND}:<creator pubkey>:<table id>.`
    );
  }
  return value;
}

export function loadConfig(): BtcmapConfig {
  let signer: PrivateKeySigner;
  try {
    signer = PrivateKeySigner.fromKey(required("BTCMAP_KEY"));
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError("BTCMAP_KEY must be an nsec or a hex key.");
  }
  return {
    osmApi: (
      process.env.OSM_API?.trim() || "https://api.openstreetmap.org"
    ).replace(/\/+$/u, ""),
    overpass:
      process.env.OVERPASS_URL?.trim() ||
      "https://overpass-api.de/api/interpreter",
    relay: required("RELAY_URL"),
    signer,
    table: tableAddress(required("BTCMAP_TABLE")),
  };
}
