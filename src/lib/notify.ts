/**
 * System notifications on this device. With the team's notifier set up, it
 * pushes them even when the app is closed; without it, the app shows them
 * while it's open in the background. Either way, each person turns them on
 * per device.
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { navigate } from "wouter/use-browser-location";

import { getConfig } from "@/config";
import { APP_DATA_KIND } from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import { encryptFor } from "@/lib/private-data";
import { publish } from "@/lib/publish";
import {
  DEVICE_PREFIX,
  deviceOffTemplate,
  deviceTemplate,
} from "@/lib/push-devices";
import {
  hasWorker,
  installed,
  installsFromShareSheet,
  workerRegistration,
} from "@/lib/pwa";
import { readStorage, writeStorage } from "@/lib/utils";

/**
 * - `unsupported`: this browser can't show notifications.
 * - `install`: iPhones and iPads only notify from the app on the Home Screen.
 * - `blocked`: the person said no; only the browser's settings can undo it.
 */
export type NotifyState = "unsupported" | "install" | "blocked" | "off" | "on";

export interface SystemNotification {
  title: string;
  body: string;
  /** A notification with the same tag replaces the last one. */
  tag: string;
  /** Where clicking it leads, as an app path. */
  path: string;
}

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Permission can change in the browser's settings while the app is away.
  document.addEventListener("visibilitychange", listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

const onKey = (pubkey: string) => `notify:${pubkey}`;
/** What this device last told the notifier, so it's only told again when that changes. */
const sentKey = (pubkey: string) => `notify-sent:${pubkey}`;

/** This browser's id among the person's devices. */
function deviceId(): string {
  const saved = readStorage("device");
  if (saved) {
    return saved;
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  writeStorage("device", id);
  return id;
}

export function notifyState(pubkey: string): NotifyState {
  if (installsFromShareSheet && !installed) {
    return "install";
  }
  if (!("Notification" in globalThis)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  return Notification.permission === "granted" &&
    readStorage(onKey(pubkey)) === "on"
    ? "on"
    : "off";
}

export function useNotifyState(pubkey: string): NotifyState {
  return useSyncExternalStore(subscribe, () => notifyState(pubkey));
}

/** Whether the notifier pushes to this device, so the app needn't show anything itself. */
export function pushesHere(pubkey: string): boolean {
  return (
    notifyState(pubkey) === "on" &&
    readStorage(sentKey(pubkey)) !== null &&
    getConfig().notifier !== undefined
  );
}

function base64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) {
    return "";
  }
  return btoa(String.fromCodePoint(...new Uint8Array(buffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/** The push subscription for the notifier's key, made anew if the key changed. */
async function pushSubscription(
  registration: ServiceWorkerRegistration,
  vapidKey: string
): Promise<PushSubscription> {
  const current = await registration.pushManager.getSubscription();
  if (current && base64Url(current.options.applicationServerKey) === vapidKey) {
    return current;
  }
  await current?.unsubscribe();
  return registration.pushManager.subscribe({
    applicationServerKey: vapidKey,
    userVisibleOnly: true,
  });
}

/**
 * Tells the notifier where to push to on this device, unless it already
 * knows. Browsers renew subscriptions now and then, so this runs on start.
 */
async function registerDevice(pubkey: string): Promise<boolean> {
  const { notifier } = getConfig();
  const registration = await workerRegistration();
  if (!(notifier && registration && "pushManager" in registration)) {
    return false;
  }
  let text: string;
  try {
    const subscription = await pushSubscription(
      registration,
      notifier.vapidKey
    );
    text = JSON.stringify(subscription.toJSON());
  } catch {
    return false;
  }
  const sent = `${notifier.pubkey}:${text}`;
  if (readStorage(sentKey(pubkey)) === sent) {
    return true;
  }
  const content = await encryptFor(pubkey, notifier.pubkey, text);
  const device = deviceId();
  if (
    content === undefined ||
    !(await publish(
      deviceTemplate(device, content, notifier.pubkey),
      eventStore.getReplaceable(
        APP_DATA_KIND,
        pubkey,
        `${DEVICE_PREFIX}${device}`
      )
    ))
  ) {
    return false;
  }
  writeStorage(sentKey(pubkey), sent);
  return true;
}

/** Asks to show notifications, and on a yes, sets up pushes. Never throws. */
export async function turnOnNotifications(pubkey: string): Promise<void> {
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    permission = "default";
  }
  if (permission !== "granted") {
    changed();
    return;
  }
  writeStorage(onKey(pubkey), "on");
  changed();
  if (getConfig().notifier && hasWorker && !(await registerDevice(pubkey))) {
    toast("Notifications only show while the app is open", {
      description:
        "This browser or your signer couldn’t set up notifications for when it’s closed.",
    });
  }
}

/** Stops notifications on this device, and tells the notifier. Never throws. */
export async function turnOffNotifications(pubkey: string): Promise<void> {
  writeStorage(onKey(pubkey), null);
  changed();
  const { notifier } = getConfig();
  if (!(notifier && readStorage(sentKey(pubkey)) !== null)) {
    return;
  }
  writeStorage(sentKey(pubkey), null);
  const registration = await workerRegistration();
  try {
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Gone already; the notifier forgets it once the device says it's off.
  }
  const device = deviceId();
  await publish(
    deviceOffTemplate(device, notifier.pubkey),
    eventStore.getReplaceable(
      APP_DATA_KIND,
      pubkey,
      `${DEVICE_PREFIX}${device}`
    )
  );
}

/** Keeps this device's push subscription current, if notifications are on. */
export function startNotifications(pubkey: string): void {
  if (notifyState(pubkey) === "on" && getConfig().notifier && hasWorker) {
    registerDevice(pubkey);
  }
}

/** Shows a notification from the app itself, as the notifier would push it. */
export async function showNotification({
  title,
  body,
  tag,
  path,
}: SystemNotification): Promise<void> {
  const options = {
    badge: "/icons/badge.png",
    body,
    data: { path },
    icon: "/icons/icon-192.png",
    tag,
  };
  const registration = await workerRegistration();
  if (registration) {
    await registration.showNotification(title, options);
    return;
  }
  const shown = new Notification(title, options);
  shown.addEventListener("click", () => {
    focus();
    navigate(path);
    shown.close();
  });
}
