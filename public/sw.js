const CACHE = "montadores-v1";

// Assets to cache on install
const PRECACHE = [
  "/montadores/dashboard",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {})),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for API calls — never cache
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first for static assets (JS, CSS, images)
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/api/uploads/") ||
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return response;
        }).catch(() => cached ?? new Response("Offline", { status: 503 }));
      }),
    );
    return;
  }

  // Network-first with offline fallback for HTML navigation
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/montadores/dashboard").then((r) => r ?? new Response("Offline", { status: 503 })),
      ),
    );
  }
});
