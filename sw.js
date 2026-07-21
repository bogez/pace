/**
 * Pace service worker: offline app shell (bogez/pace#6).
 *
 * Strategy: stale-while-revalidate for same-origin GETs — the cached shell
 * answers instantly (and offline), while a background fetch keeps it fresh
 * for the next load. Only same-origin requests are ever touched or cached;
 * there are no external origins anywhere in Pace (TRUST.md commitment 2).
 *
 * Bump VERSION on any shell change: the new worker precaches, then deletes
 * old caches on activate.
 */

const VERSION = "pace-v2";
const SHELL = [
  "./",
  "index.html",
  "app/tracker.css",
  "app/tracker.js",
  "app/window.js",
  "app/calibration.js",
  "sensors/weights.mjs",
  "src/pace.js",
  "manifest.webmanifest",
  "app/icons/icon-192.png",
  "app/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request);
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached); // offline: the cache is all we have, and enough
      return cached || refresh;
    })
  );
});
