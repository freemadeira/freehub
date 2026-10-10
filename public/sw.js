/*
 * The app's service worker. It lets the installed app open without a
 * connection, and open fast with one, and shows the notifier's pushes. It
 * never decides which version runs: pages, the config and logos come from the
 * network first, so a deploy is live on the next load, and src/lib/updates.ts
 * reloads open ones.
 * Only same-origin GETs are handled: relays, Blossom servers and everything
 * else cross-origin go straight to the network and are never cached.
 *
 * To switch it off for everyone: remove `register()` from `startPwa` in
 * src/lib/pwa.ts, replace this file with a worker that deletes every cache
 * and calls `self.registration.unregister()` on activate, and release. Don't
 * reload clients from it: pages still registering it would loop.
 */

const SHELL_CACHE = "shell-v1";
const ASSET_CACHE = "assets-v1";
const BRANDING_CACHE = "branding-v1";
/** Built files pile up across deploys; past this many, the oldest go. */
const MAX_ASSETS = 200;
const ASSET_PATH = /\/assets\/[\w.-]+/gu;

/** Every route serves the same index.html, so one copy covers them all. */
const keepShell = async (response) => {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put("/", response);
};

const trim = async () => {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  const extra = keys.slice(0, Math.max(0, keys.length - MAX_ASSETS));
  await Promise.all(extra.map((key) => cache.delete(key)));
};

/**
 * The config, and the logos and icons beside it, which the app can't start
 * without. A team changes them without a rebuild, so they come from the
 * cache only while the network doesn't answer.
 */
const isBranding = (url) =>
  url.pathname === "/config.json" ||
  url.pathname.startsWith("/icons/") ||
  /^\/[\w.-]+\.(?:png|svg|webmanifest)$/u.test(url.pathname);

const keepBranding = async (request, response) => {
  const cache = await caches.open(BRANDING_CACHE);
  await cache.put(request, response);
};

const keepAsset = async (request, response) => {
  const cache = await caches.open(ASSET_CACHE);
  await cache.put(request, response);
  await trim();
};

/**
 * The page that registered this worker loaded before it ran, so what it needs
 * to open offline gets cached here. Best effort: a miss only means it opens
 * offline after the next visit instead.
 */
const warm = async () => {
  try {
    const response = await fetch("/", { cache: "no-cache" });
    if (!response.ok) {
      return;
    }
    const html = await response.clone().text();
    await keepShell(response);
    const config = await fetch("/config.json", { cache: "no-cache" });
    if (config.ok) {
      await keepBranding("/config.json", config);
    }
    const cache = await caches.open(ASSET_CACHE);
    const urls = [...new Set(html.match(ASSET_PATH))];
    // One by one, so a file that fails doesn't keep the rest out.
    await Promise.allSettled(urls.map((url) => cache.add(url)));
  } catch {
    // Offline, or mid-deploy: the next visit fills it in.
  }
};

const activate = async () => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE, BRANDING_CACHE]);
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => !keep.has(name)).map((name) => caches.delete(name))
  );
  // Starts the page's request while the worker boots, where supported.
  await self.registration.navigationPreload?.enable();
  await self.clients.claim();
};

const isPage = (response) =>
  response.ok &&
  !response.redirected &&
  (response.headers.get("Content-Type") ?? "").includes("text/html");

/** From the network, so it's always the live build; offline, the last one seen. */
const page = async (event) => {
  try {
    const response =
      (await event.preloadResponse) ?? (await fetch(event.request));
    if (isPage(response)) {
      event.waitUntil(keepShell(response.clone()));
    }
    return response;
  } catch {
    const shell = await caches.match("/", { cacheName: SHELL_CACHE });
    return shell ?? Response.error();
  }
};

/** From the network, so a new config or logo shows at once; offline, the last ones seen. */
const branding = async (event) => {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      event.waitUntil(keepBranding(event.request, response.clone()));
    }
    return response;
  } catch {
    const kept = await caches.match(event.request, {
      cacheName: BRANDING_CACHE,
      ignoreSearch: true,
    });
    return kept ?? Response.error();
  }
};

/** Built files are named by their content, so a cached copy is always right. */
const asset = async (event) => {
  const cached = await caches.match(event.request, { cacheName: ASSET_CACHE });
  if (cached) {
    return cached;
  }
  const response = await fetch(event.request);
  if (response.ok && response.type === "basic") {
    event.waitUntil(keepAsset(event.request, response.clone()));
  }
  return response;
};

/**
 * Every push shows a notification: Safari stops pushing to a site that
 * receives one without showing it, and Chrome shows a vague one instead. The
 * notifier only pushes what the person hasn't read yet. A notification about
 * the same card, page, file or record replaces the last one.
 */
const notify = async (event) => {
  let message = {};
  try {
    message = event.data?.json() ?? {};
  } catch {
    // Not from the notifier; still say something.
  }
  await self.registration.showNotification(message.title ?? "Something new", {
    badge: "/icons/badge.png",
    body: message.body ?? "",
    data: { path: message.path ?? "/inbox" },
    icon: "/icons/icon-192.png",
    renotify: Boolean(message.tag),
    tag: message.tag,
    timestamp: message.at ? message.at * 1000 : Date.now(),
  });
  // Without a count, the installed app's icon shows a dot until it opens.
  try {
    await self.navigator.setAppBadge?.();
  } catch {
    // Badges are a nicety; not every browser has them.
  }
};

/** Opens where the notification leads, in an open window if there is one. */
const follow = async (path) => {
  const windows = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  const open = windows.find((client) => "focus" in client);
  if (open) {
    await open.focus();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's client takes no origin
    open.postMessage({ open: path });
    return;
  }
  await self.clients.openWindow(path);
};

self.addEventListener("install", (event) => {
  // Nothing here is tied to a build, so a new worker can take over at once.
  self.skipWaiting();
  event.waitUntil(warm());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Range requests want partial answers, which a cached whole can't give.
  if (request.method !== "GET" || request.headers.has("Range")) {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(page(event));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(asset(event));
  } else if (isBranding(url)) {
    event.respondWith(branding(event));
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(notify(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  event.waitUntil(
    follow(typeof path === "string" && path.startsWith("/") ? path : "/inbox")
  );
});
