/* IziPilot service worker — push notifications only.
 * Kept intentionally minimal: no caching, no offline support, no fetch
 * interception. The only jobs are receiving Web Push events and routing
 * the click back into the app.
 */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
