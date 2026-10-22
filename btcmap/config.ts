import { PrivateKeySigner } from "applesauce-signers";

import type { AddressReader } from "./addresses";
import { ADDRESS_FORMATS } from "./addresses";

export interface BtcmapConfig {
  signer: PrivateKeySigner;
  relay: string;
  osmApi: string;
  overpass: string;
  /** Where discovery looks, as Overpass's south,west,north,east. Without it, there's no discovery. */
  area: string | undefined;
  /** Reads the records' addresses. Without it, no address goes to OSM. */
  readAddress: AddressReader | undefined;
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

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function area(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const edges = value.split(",").map((edge) => Number(edge.trim()));
  const [
    south = Number.NaN,
    west = Number.NaN,
    north = Number.NaN,
    east = Number.NaN,
  ] = edges;
  if (edges.length !== 4 || !(south < north && west < east)) {
    throw new ConfigError(
      "BTCMAP_AREA must be south,west,north,east in degrees."
    );
  }
  return edges.join(",");
}

function addressReader(value: string | undefined): AddressReader | undefined {
  if (!value) {
    return undefined;
  }
  const reader = ADDRESS_FORMATS.get(value.toLowerCase());
  if (!reader) {
    throw new ConfigError(
      `ADDRESS_FORMAT must be one of: ${[...ADDRESS_FORMATS.keys()].join(", ")}.`
    );
  }
  return reader;
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
    area: area(optional("BTCMAP_AREA")),
    osmApi: (optional("OSM_API") ?? "https://api.openstreetmap.org").replace(
      /\/+$/u,
      ""
    ),
    overpass:
      optional("OVERPASS_URL") ?? "https://overpass-api.de/api/interpreter",
    readAddress: addressReader(optional("ADDRESS_FORMAT")),
    relay: required("RELAY_URL"),
    signer,
  };
}
