// Service Worker — App Montadores
// Versão: 2.0 (offline queue + IndexedDB)

const CACHE = "montadores-v2";
const OFFLINE_QUEUE_STORE = "offline_queue";
const OFFLINE_PHOTOS_STORE = "offline_photos";
const DB_NAME = "montadores_offline";
const DB_VERSION = 1;

// Assets estáticos a pré-cachear na instalação
const PRECACHE = ["/montadores/app", "/montadores/app/minhas-montagens"];

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        const store = db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains(OFFLINE_PHOTOS_STORE)) {
        const ps = db.createObjectStore(OFFLINE_PHOTOS_STORE, { keyPath: "id", autoIncrement: true });
        ps.createIndex("jobId", "jobId");
        ps.createIndex("status", "status");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName, indexName, indexValue) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = indexName ? store.index(indexName).getAll(indexValue) : store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE).catch(() => {}),
    ),
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
      openDB(), // garante que o IndexedDB está criado
    ]).then(() => self.clients.claim()),
  );
});

// ── Fetch intercept ───────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Nunca cachear requisições de API — sempre network-first
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first para assets estáticos
  if (
    url.pathname.startsWith("/assets/") ||
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font"
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

  // Network-first com fallback offline para navegação HTML
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/montadores/app").then((r) =>
          r ?? new Response("Offline — sincronize quando houver internet.", { status: 503 }),
        ),
      ),
    );
  }
});

// ── Background sync ───────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === "offline-queue-sync") {
    event.waitUntil(syncOfflineQueue());
  }
  if (event.tag === "offline-photos-sync") {
    event.waitUntil(syncOfflinePhotos());
  }
});

async function syncOfflineQueue() {
  const items = await dbGetAll(OFFLINE_QUEUE_STORE, "status", "PENDENTE");
  for (const item of items) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body ?? undefined,
      });
      if (response.ok) {
        await dbPut(OFFLINE_QUEUE_STORE, { ...item, status: "SINCRONIZADO", syncedAt: new Date().toISOString() });
        // Notifica clientes abertos
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) => c.postMessage({ type: "OFFLINE_SYNC_ITEM", id: item.id, url: item.url }));
      } else {
        await dbPut(OFFLINE_QUEUE_STORE, { ...item, status: "ERRO", lastError: `HTTP ${response.status}` });
      }
    } catch (err) {
      await dbPut(OFFLINE_QUEUE_STORE, { ...item, status: "ERRO", lastError: String(err) });
    }
  }

  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) => c.postMessage({ type: "OFFLINE_SYNC_COMPLETED" }));
}

async function syncOfflinePhotos() {
  const photos = await dbGetAll(OFFLINE_PHOTOS_STORE, "status", "PENDENTE");
  for (const photo of photos) {
    try {
      const formData = new FormData();
      const blob = new Blob([photo.data], { type: photo.mimeType });
      formData.append("file", blob, photo.fileName);

      const uploadResp = await fetch("/api/upload", {
        method: "POST",
        headers: photo.authHeader ? { Authorization: photo.authHeader } : {},
        body: formData,
      });
      if (!uploadResp.ok) throw new Error(`Upload falhou: HTTP ${uploadResp.status}`);
      const { url } = await uploadResp.json();

      const attachResp = await fetch(`/api/assembly/${photo.jobId}/photos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(photo.authHeader ? { Authorization: photo.authHeader } : {}),
        },
        body: JSON.stringify({ fileUrl: url, photoType: "EVIDENCIA" }),
      });
      if (!attachResp.ok) throw new Error(`Attach falhou: HTTP ${attachResp.status}`);

      await dbPut(OFFLINE_PHOTOS_STORE, { ...photo, status: "SINCRONIZADO", uploadedUrl: url, syncedAt: new Date().toISOString() });
    } catch (err) {
      await dbPut(OFFLINE_PHOTOS_STORE, { ...photo, status: "ERRO", lastError: String(err) });
    }
  }
}

// ── Mensagens do cliente ──────────────────────────────────────────────────────

self.addEventListener("message", (event) => {
  if (event.data?.type === "QUEUE_ACTION") {
    dbPut(OFFLINE_QUEUE_STORE, {
      ...event.data.payload,
      status: "PENDENTE",
      createdAt: new Date().toISOString(),
    }).then(() => {
      // Tenta sync imediato — se falhar, Background Sync tentará depois
      self.registration.sync?.register("offline-queue-sync").catch(() => {});
    });
  }

  if (event.data?.type === "QUEUE_PHOTO") {
    dbPut(OFFLINE_PHOTOS_STORE, {
      ...event.data.payload,
      status: "PENDENTE",
      createdAt: new Date().toISOString(),
    }).then(() => {
      self.registration.sync?.register("offline-photos-sync").catch(() => {});
    });
  }

  if (event.data?.type === "GET_QUEUE_STATUS") {
    Promise.all([
      dbGetAll(OFFLINE_QUEUE_STORE, "status", "PENDENTE"),
      dbGetAll(OFFLINE_PHOTOS_STORE, "status", "PENDENTE"),
    ]).then(([actions, photos]) => {
      event.source?.postMessage({
        type: "QUEUE_STATUS",
        pendingActions: actions.length,
        pendingPhotos: photos.length,
      });
    });
  }

  if (event.data?.type === "FORCE_SYNC") {
    Promise.all([syncOfflineQueue(), syncOfflinePhotos()]);
  }
});
