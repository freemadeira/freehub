import type { IAccount } from "applesauce-accounts";
import {
  ExtensionAccount,
  NostrConnectAccount,
} from "applesauce-accounts/accounts";
import type { NostrConnectSigner } from "applesauce-signers";
import { BehaviorSubject } from "rxjs";
import { toast } from "sonner";

import { logout, waitForExtension } from "@/lib/login";
import { accounts } from "@/lib/nostr";
import { TimeoutError, withTimeout } from "@/lib/utils";

export type SignerState =
  | "none"
  | "checking"
  | "live"
  | "unreachable"
  | "revoked";

const PING_TIMEOUT = 15_000;
const EXTENSION_TIMEOUT = 30_000;
const FOCUS_THROTTLE = 60_000;

export const signerState$ = new BehaviorSubject<SignerState>("none");

let lastCheck = 0;
let generation = 0;

// A restored NIP-46 session must never call connect(): resume and ping instead.
async function checkNostrConnect(
  signer: NostrConnectSigner
): Promise<SignerState> {
  try {
    await signer.open();
    signer.isConnected = true;
    await withTimeout(signer.ping(), PING_TIMEOUT, "ping");
    return "live";
  } catch (error) {
    return error instanceof TimeoutError ? "unreachable" : "revoked";
  }
}

async function checkExtension(
  account: IAccount
): Promise<SignerState | "mismatch"> {
  const extension = await waitForExtension(1000);
  if (!extension) {
    return "unreachable";
  }
  try {
    const pubkey = await withTimeout(
      extension.getPublicKey(),
      EXTENSION_TIMEOUT,
      "extension"
    );
    return pubkey === account.pubkey ? "live" : "mismatch";
  } catch {
    return "unreachable";
  }
}

function check(account: IAccount): Promise<SignerState | "mismatch"> {
  if (account instanceof NostrConnectAccount) {
    return checkNostrConnect(account.signer as NostrConnectSigner);
  }
  if (account instanceof ExtensionAccount) {
    return checkExtension(account);
  }
  return Promise.resolve("unreachable");
}

async function run(showChecking: boolean): Promise<void> {
  const account = accounts.active;
  generation += 1;
  const current = generation;
  if (!account) {
    signerState$.next("none");
    return;
  }
  if (showChecking) {
    signerState$.next("checking");
  }
  lastCheck = Date.now();
  const state = await check(account);
  if (current !== generation || accounts.active !== account) {
    return;
  }
  if (state === "mismatch") {
    toast("Your extension switched to another key. Log in again.");
    await logout();
    return;
  }
  signerState$.next(state);
}

export function recheckSigner(): Promise<void> {
  return run(false);
}

export function startSignerChecks(): void {
  accounts.active$.subscribe(() => {
    run(true);
  });
  window.addEventListener("focus", () => {
    const state = signerState$.value;
    if (
      state === "none" ||
      state === "revoked" ||
      state === "checking" ||
      Date.now() - lastCheck < FOCUS_THROTTLE
    ) {
      return;
    }
    run(false);
  });
}
