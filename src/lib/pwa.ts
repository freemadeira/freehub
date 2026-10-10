import { useSyncExternalStore } from "react";

import { withTimeout } from "@/lib/utils";

/** How long the service worker gets to start before pushes count as unavailable. */
const WORKER_TIMEOUT = 10_000;

/** Chrome's offer to install the app, which only it and Edge make. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

/** Whether the app runs installed, rather than in a browser tab. */
export const installed: boolean =
  matchMedia("(display-mode: standalone)").matches ||
  // Older iOS says so here instead.
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhones and iPads, where any browser installs through the share sheet instead. */
export const installsFromShareSheet: boolean =
  /iPhone|iPad|iPod/u.test(navigator.userAgent) ||
  // iPadOS asks for desktop sites, so it reads as a Mac with a touch screen.
  (/Macintosh/u.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Whether the service worker runs: in builds only, where it caches nothing Vite serves. */
export const hasWorker: boolean =
  import.meta.env.PROD && "serviceWorker" in navigator;

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks the browser to install the app, or null when it hasn't offered to. */
export function useInstall(): (() => Promise<void>) | null {
  const current = useSyncExternalStore(subscribe, () => offer);
  if (!current) {
    return null;
  }
  return async () => {
    // An offer works once; the browser makes a new one if it's turned down.
    offer = null;
    notify();
    await current.prompt();
  };
}

/** The service worker, once it's running, or nothing where there's none. */
export async function workerRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (!hasWorker) {
    return undefined;
  }
  try {
    return await withTimeout(
      navigator.serviceWorker.ready,
      WORKER_TIMEOUT,
      "The service worker didn’t start."
    );
  } catch {
    return undefined;
  }
}

async function register(): Promise<void> {
  try {
    await navigator.serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
  } catch {
    // The app works without it, only not offline and without pushes.
  }
}

/**
 * Registers the service worker and keeps the browser's install offer. `open`
 * follows a notification someone clicked to where it leads.
 */
export function startPwa(open: (path: string) => void): void {
  addEventListener("beforeinstallprompt", (event) => {
    offer = event as InstallPromptEvent;
    notify();
  });
  addEventListener("appinstalled", () => {
    offer = null;
    notify();
  });
  if (!hasWorker) {
    return;
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data: unknown = event.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "open" in data &&
      typeof data.open === "string" &&
      data.open.startsWith("/")
    ) {
      open(data.open);
    }
  });
  // After the page has loaded, so the worker's own fetching doesn't slow it.
  if (document.readyState === "complete") {
    register();
  } else {
    addEventListener("load", register, { once: true });
  }
}
