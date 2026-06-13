// Fila offline — permite ações e fotos quando sem internet.
// Comunica com o service worker via postMessage.

export type QueueStatus = {
  pendingActions: number;
  pendingPhotos: number;
};

function swReady(): ServiceWorker | null {
  return navigator.serviceWorker?.controller ?? null;
}

export function queueAction(opts: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  label?: string;
}): void {
  const sw = swReady();
  if (sw) {
    sw.postMessage({ type: "QUEUE_ACTION", payload: opts });
  } else {
    // Sem SW: tenta imediatamente e falha silenciosamente
    fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body ?? undefined }).catch(() => {});
  }
}

export function queuePhoto(opts: {
  jobId: string;
  data: ArrayBuffer;
  mimeType: string;
  fileName: string;
  authHeader?: string;
}): void {
  const sw = swReady();
  if (sw) {
    sw.postMessage({ type: "QUEUE_PHOTO", payload: opts });
  }
}

export function getQueueStatus(): Promise<QueueStatus> {
  return new Promise((resolve) => {
    const sw = swReady();
    if (!sw) { resolve({ pendingActions: 0, pendingPhotos: 0 }); return; }

    const timeout = setTimeout(() => resolve({ pendingActions: 0, pendingPhotos: 0 }), 1000);

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "QUEUE_STATUS") {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", handler);
        resolve({ pendingActions: event.data.pendingActions, pendingPhotos: event.data.pendingPhotos });
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    sw.postMessage({ type: "GET_QUEUE_STATUS" });
  });
}

export function forceSync(): void {
  swReady()?.postMessage({ type: "FORCE_SYNC" });
}

export function onSyncCompleted(callback: (data: { type: string }) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === "OFFLINE_SYNC_COMPLETED" || event.data?.type === "OFFLINE_SYNC_ITEM") {
      callback(event.data);
    }
  };
  navigator.serviceWorker?.addEventListener("message", handler);
  return () => navigator.serviceWorker?.removeEventListener("message", handler);
}

export function isOnline(): boolean {
  return navigator.onLine;
}
