/* IziPilot service worker.
 * 1. Web Push: receives push events and routes notification clicks into the app.
 * 2. Offline: precaches an offline fallback page + app icons, serves hashed
 *    Next.js static assets cache-first, and falls back to /offline.html when a
 *    navigation fails (POs on flaky mobile networks).
 * Bump CACHE_VERSION on any change to the precached files.
 */

const CACHE_VERSION = "izipilot-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network first, offline fallback. Never cache HTML —
  // every page is session-scoped and personalised.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then(
          (cached) =>
            cached ||
            new Response("Hors ligne", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
        ),
      ),
    );
    return;
  }

  // Never touch API or auth traffic.
  if (url.pathname.startsWith("/api/")) return;

  // Hashed immutable build assets (JS, CSS, fonts under /_next/static) and
  // the precached icons: cache first, populate on miss.
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname);
  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch (_e) {
    data = { title: "IziPilot", body: event.data.text() };
  }

  const title = data.title || "IziPilot";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      // If a tab is already open, focus it and navigate.
      for (const client of all) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(target);
          return;
        }
      }
      // Otherwise open a new tab.
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});

// The browser may replace (or expire) a subscription on its own. Without this
// handler the server keeps the dead endpoint and the user silently stops
// receiving anything. Resubscribe with the same VAPID key and tell the server,
// which swaps the old row for the new one. Uses the session cookie; if the
// session has expired the next visit's silent resubscribe covers it.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const sub =
        event.newSubscription ||
        (old &&
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: old.options.applicationServerKey,
          })));
      if (!sub) return;
      const json = sub.toJSON();
      await fetch("/api/account/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          oldEndpoint: old ? old.endpoint : undefined,
        }),
      });
    })(),
  );
});
