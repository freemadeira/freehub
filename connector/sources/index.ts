import type { SourceConfig } from "../config";
import { ConfigError } from "../config";
import { ShopifyAdapter } from "./shopify";
import type { Adapter } from "./types";

/** Each kind of source the connector can read. Add new ones here. */
const ADAPTERS: Record<string, (config: SourceConfig) => Adapter> = {
  shopify: (config) => new ShopifyAdapter(config),
};

export function createAdapter(config: SourceConfig): Adapter {
  const create = ADAPTERS[config.type];
  if (!create) {
    throw new ConfigError(
      `Source "${config.id}" has an unknown type "${config.type}". Known: ${Object.keys(ADAPTERS).join(", ")}.`
    );
  }
  return create(config);
}
