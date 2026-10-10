import { createHash } from "node:crypto";

import {
  generateVAPIDKeys,
  sendNotification,
  setVapidDetails,
  WebPushError,
} from "web-push";

import type { PushDevice } from "@/lib/push-devices";

/** What the service worker shows; see `notify` in public/sw.js. */
export interface PushMessage {
  title: string;
  body: string;
  /** Where clicking it leads, as an app path. */
  path: string;
  /** A notification with the same tag replaces the last one on the device. */
  tag: string;
  /** When it happened, in seconds. */
  at: number;
}

/** How long a push service keeps trying a device that's off, in seconds. */
const TTL = 24 * 60 * 60;

export type Outcome = "sent" | "gone" | "failed";

/** Signs every push with the notifier's VAPID keys, which browsers subscribed to. */
export function setUpPush(vapid: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): void {
  setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
}

/** Why a push failed; a refused connection has a code but no message. */
function reason(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const { code } = error as Error & { code?: string };
  return error.message || code || error.name;
}

/**
 * Sends the message, encrypted to the device. A push service that says the
 * device is gone means it was switched off or replaced.
 */
export async function push(
  device: PushDevice,
  message: PushMessage
): Promise<Outcome> {
  try {
    await sendNotification(device, JSON.stringify(message), {
      TTL,
      // A newer push about the same thing replaces one still waiting for an offline device.
      topic: createHash("sha256")
        .update(message.tag)
        .digest("base64url")
        .slice(0, 32),
      urgency: "normal",
    });
    return "sent";
  } catch (error) {
    if (
      error instanceof WebPushError &&
      (error.statusCode === 404 || error.statusCode === 410)
    ) {
      return "gone";
    }
    console.error(
      `Push to ${new URL(device.endpoint).host} failed: ${reason(error)}`
    );
    return "failed";
  }
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return generateVAPIDKeys();
}
