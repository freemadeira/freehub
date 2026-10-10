/**
 * Personal data kept on the team relay, like inbox marks and devices to push
 * to. It's encrypted with NIP-44, so only its owner, and one reader they
 * name, can open it: the team's notifier when there is one.
 */
import { getConfig } from "@/config";
import { accounts } from "@/lib/nostr";
import { withTimeout } from "@/lib/utils";

const TIMEOUT = 60_000;

/** Who reads the person's private data besides them: the notifier, or no one else. */
export function privateReader(pubkey: string): string {
  return getConfig().notifier?.pubkey ?? pubkey;
}

/** Whether the person's signer can encrypt at all; older extensions can't. */
export function canEncrypt(pubkey: string): boolean {
  const account = accounts.active;
  return account?.pubkey === pubkey && account.nip44 !== undefined;
}

/** The text encrypted between the person and `reader`, or nothing if their signer won't. */
export async function encryptFor(
  pubkey: string,
  reader: string,
  text: string
): Promise<string | undefined> {
  const account = accounts.active;
  if (account?.pubkey !== pubkey || !account.nip44) {
    return undefined;
  }
  try {
    return await withTimeout(
      account.nip44.encrypt(reader, text),
      TIMEOUT,
      "Your signer didn’t answer."
    );
  } catch {
    return undefined;
  }
}

/** The text of the person's own event encrypted to `reader`, or nothing if it can't be read. */
export async function decryptFor(
  pubkey: string,
  reader: string,
  content: string
): Promise<string | undefined> {
  const account = accounts.active;
  if (account?.pubkey !== pubkey || !account.nip44) {
    return undefined;
  }
  try {
    return await withTimeout(
      account.nip44.decrypt(reader, content),
      TIMEOUT,
      "Your signer didn’t answer."
    );
  } catch {
    return undefined;
  }
}
