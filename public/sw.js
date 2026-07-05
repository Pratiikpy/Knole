// Knole service worker — two jobs:
//   1) PWA offline shell: precache a branded offline page + icons; network-first for navigations
//      (always try fresh content), cache-first with background refresh for static hashed assets.
//   2) Web-push delivery for the weekly digest + proactive nudges (opt-in from Settings).
// Bump CACHE to invalidate old caches on deploy.

const CACHE = "knole-v2";
const PRECACHE = ["/offline.html", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A request we're allowed to cache: same-origin, GET, and a static asset (not an API / server fn).
function isCacheableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (/\/assets\//.test(url.pathname) ||
      /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|ico|json)$/.test(url.pathname))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Navigations: network-first (fresh SSR content), fall back to the last good page or offline shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/offline.html"))),
    );
    return;
  }

  // Static assets: cache-first, refresh in the background (stale-while-revalidate).
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Knole", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Knole";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "knole-digest",
      data: { url: data.url || "/today" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an open tab if there is one; otherwise open a fresh window.
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
