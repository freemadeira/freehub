import { AccountManager, BaseAccount } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { verifyEvent } from "applesauce-core/helpers/event";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";

import { getConfig } from "@/config";
import { readStorage, writeStorage } from "@/lib/utils";

const ACCOUNTS_KEY = "accounts";

// Unsigned local versions shown while the signer works; anything else needs a valid signature.
const drafts = new WeakSet<NostrEvent>();

export const eventStore = new EventStore({
  verifyEvent: (event) => drafts.has(event) || verifyEvent(event),
});
export const pool = new RelayPool();
export const accounts = new AccountManager();

registerCommonAccountTypes(accounts);
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

export function addDraft(draft: NostrEvent): void {
  drafts.add(draft);
  eventStore.add(draft);
}

/** Drops queued signing requests so a stuck signer doesn't block later ones. */
export function abortSigning(reason: Error): void {
  const account = accounts.active;
  if (account instanceof BaseAccount) {
    account.abortQueue(reason);
  }
}

export function initNostr(): void {
  eventStore.eventLoader = createEventLoaderForStore(eventStore, pool, {
    lookupRelays: getConfig().lookupRelays,
  });

  const saved = readStorage(ACCOUNTS_KEY);
  if (saved) {
    try {
      accounts.fromJSON(JSON.parse(saved), true);
    } catch {
      writeStorage(ACCOUNTS_KEY, null);
    }
  }
  const [first] = accounts.accounts;
  if (!accounts.active && first) {
    accounts.setActive(first);
  }
  accounts.accounts$.subscribe(() => {
    writeStorage(ACCOUNTS_KEY, JSON.stringify(accounts.toJSON(true)));
  });
}
