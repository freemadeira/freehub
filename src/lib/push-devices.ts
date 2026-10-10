/**
 * The devices someone gets push notifications on. Each device keeps its own
 * NIP-78 app data event, so two devices never overwrite each other, with its
 * Web Push subscription encrypted (NIP-44) to the notifier: anyone holding it
 * could push to the device. No browser APIs here: the notifier reads them.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import type { Template } from "@/lib/model";
import { APP_DATA_KIND, isDeleted } from "@/lib/model";

/** The start of each device's `d` tag; its id follows. */
export const DEVICE_PREFIX = "freehub/push/";

/** A Web Push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function deviceTemplate(
  device: string,
  content: string,
  notifier: string
): Template {
  return {
    content,
    kind: APP_DATA_KIND,
    tags: [
      ["d", `${DEVICE_PREFIX}${device}`],
      // Names who can read it, and routes it to them.
      ["p", notifier],
    ],
  };
}

/** The device switched off: nothing left to push to. */
export function deviceOffTemplate(device: string, notifier: string): Template {
  return {
    content: "",
    kind: APP_DATA_KIND,
    tags: [["d", `${DEVICE_PREFIX}${device}`], ["p", notifier], ["deleted"]],
  };
}

export function isDeviceEvent(event: NostrEvent): boolean {
  return (
    event.kind === APP_DATA_KIND &&
    (getTagValue(event, "d") ?? "").startsWith(DEVICE_PREFIX) &&
    !isDeleted(event)
  );
}

export function parsePushDevice(text: string): PushDevice | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const { endpoint, keys } = value as Partial<PushDevice>;
    return typeof endpoint === "string" &&
      endpoint.startsWith("https://") &&
      typeof keys?.p256dh === "string" &&
      typeof keys.auth === "string"
      ? { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } }
      : undefined;
  } catch {
    return undefined;
  }
}
