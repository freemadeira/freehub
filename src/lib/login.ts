import type { IAccount } from "applesauce-accounts";
import {
  ExtensionAccount,
  NostrConnectAccount,
} from "applesauce-accounts/accounts";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PrivateKeySigner,
} from "applesauce-signers";

import { getConfig } from "@/config";
import {
  BOARD_KIND,
  CARD_KIND,
  COMMENT_KIND,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  DRIVE_FILE_KIND,
  DRIVE_FOLDER_KIND,
  PROJECT_KIND,
  SPRINT_KIND,
} from "@/lib/model";
import { accounts } from "@/lib/nostr";
import { sleep, TimeoutError, withTimeout } from "@/lib/utils";

const PERMISSIONS = NostrConnectSigner.buildSigningPermissions([
  22_242,
  BOARD_KIND,
  CARD_KIND,
  SPRINT_KIND,
  PROJECT_KIND,
  CRM_TABLE_KIND,
  CRM_RECORD_KIND,
  DRIVE_FOLDER_KIND,
  DRIVE_FILE_KIND,
  COMMENT_KIND,
  5,
  // Blossom's authorization for uploading and deleting files.
  24_242,
]);

const EXTENSION_TIMEOUT = 60_000;
const CONNECT_TIMEOUT = 30_000;
const PING_TIMEOUT = 15_000;
const LOGOUT_TIMEOUT = 5000;

interface NostrExtension {
  getPublicKey: () => Promise<string>;
}

export async function waitForExtension(
  ms: number
): Promise<NostrExtension | undefined> {
  const { nostr } = window as Window & { nostr?: NostrExtension };
  if (nostr || ms <= 0) {
    return nostr;
  }
  await sleep(100);
  return waitForExtension(ms - 100);
}

function activate(account: IAccount): void {
  accounts.addAccount(account);
  accounts.setActive(account);
}

export async function loginWithExtension(): Promise<void> {
  if (!(await waitForExtension(1000))) {
    throw new Error("No Nostr extension found.");
  }
  const signer = new ExtensionSigner();
  try {
    const pubkey = await withTimeout(
      signer.getPublicKey(),
      EXTENSION_TIMEOUT,
      "Your extension didn’t answer."
    );
    activate(new ExtensionAccount(pubkey, signer));
  } catch (error) {
    throw error instanceof TimeoutError
      ? error
      : new Error("Your extension refused the request.");
  }
}

async function pubkeyOrClose(signer: NostrConnectSigner): Promise<string> {
  try {
    return await withTimeout(
      signer.getPublicKey(),
      CONNECT_TIMEOUT,
      "Your signer didn’t share your public key."
    );
  } catch (error) {
    await signer.close();
    throw error;
  }
}

async function connectSigner(
  signer: NostrConnectSigner,
  signal: AbortSignal
): Promise<void> {
  // waitForSigner closes the signer whenever its signal aborts, even after it
  // connected, so only forward aborts that happen while still waiting.
  const waiting = new AbortController();
  const stop = () => waiting.abort();
  signal.addEventListener("abort", stop, { once: true });
  try {
    await signer.waitForSigner(waiting.signal);
  } catch (error) {
    await signer.close();
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
  }
  activate(new NostrConnectAccount(await pubkeyOrClose(signer), signer));
}

export interface NostrConnectSession {
  uri: string;
  connect: (signal: AbortSignal) => Promise<void>;
}

export function createNostrConnect(): NostrConnectSession {
  const options = {
    // getRandomValues, not randomUUID: the latter is missing on plain-http
    // origins, such as the dev server opened from a phone on the LAN.
    connectSecret: Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join(""),
    relays: getConfig().signerRelays,
    signer: new PrivateKeySigner(),
  };
  const uri = new NostrConnectSigner(options).getNostrConnectURI({
    name: getConfig().name,
    permissions: PERMISSIONS,
    url: location.origin,
  });
  // Each attempt gets its own signer, so closing an aborted one can't end the next.
  return {
    connect: (signal) => connectSigner(new NostrConnectSigner(options), signal),
    uri,
  };
}

// Amber answers a repeated connect with "already connected" and applesauce then
// closes the signer. The bunker already knows this client, so resume instead.
async function connectOrResume(
  signer: NostrConnectSigner,
  secret?: string
): Promise<void> {
  try {
    await withTimeout(
      signer.connect(secret, PERMISSIONS),
      CONNECT_TIMEOUT,
      "Your signer didn’t answer."
    );
  } catch (error) {
    if (
      error instanceof TimeoutError ||
      !(error instanceof Error) ||
      !/already connected/iu.test(error.message)
    ) {
      await signer.close();
      throw error;
    }
    try {
      await signer.open();
      signer.isConnected = true;
      await withTimeout(
        signer.ping(),
        PING_TIMEOUT,
        "Your signer didn’t answer."
      );
    } catch {
      await signer.close();
      throw error;
    }
  }
}

export async function loginWithBunker(uri: string): Promise<void> {
  let parsed: ReturnType<typeof NostrConnectSigner.parseBunkerURI>;
  try {
    parsed = NostrConnectSigner.parseBunkerURI(uri.trim());
  } catch {
    throw new Error("That isn’t a bunker:// link.");
  }
  const signer = new NostrConnectSigner({
    relays: parsed.relays,
    remote: parsed.remote,
  });
  await connectOrResume(signer, parsed.bunkerSecret);
  activate(new NostrConnectAccount(await pubkeyOrClose(signer), signer));
}

export async function logout(): Promise<void> {
  const account = accounts.active;
  if (!account) {
    return;
  }
  if (account instanceof NostrConnectAccount) {
    const signer = account.signer as NostrConnectSigner;
    try {
      await withTimeout(signer.logout(), LOGOUT_TIMEOUT, "logout");
    } catch {
      // Offline signer: closing locally is enough.
    }
    await signer.close();
  }
  accounts.removeAccount(account);
}
