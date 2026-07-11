// Fila offline — permite ações e fotos quando sem internet, via service worker.
//
// ATENÇÃO: o service worker (public/sw.js) NÃO é registrado hoje e não há chamadores
// destas funções — a fila offline está INATIVA. Para ativá-la seria preciso registrar
// o SW no boot do client e persistir a fila em IndexedDB. Até lá, o fallback abaixo faz
// envio direto e PROPAGA erros (nunca engole em silêncio), para o chamador tratar/retentar.

export type QueueStatus = {
  pendingActions: number;
  pendingPhotos: number;
};

function swReady(): ServiceWorker | null {
  return navigator.serviceWorker?.controller ?? null;
}

/** Enfileira (via SW) ou envia direto. Retorna true se enviado/enfileirado; lança em falha de rede. */
export async function queueAction(opts: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  label?: string;
}): Promise<boolean> {
  const sw = swReady();
  if (sw) {
    sw.postMessage({ type: "QUEUE_ACTION", payload: opts });
    return true;
  }
  // Sem SW: envia direto. Erro PROPAGA (não silencioso) para o chamador tratar.
  const res = await fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body ?? undefined });
  if (!res.ok) throw new Error(`Falha ao enviar ação (${res.status})`);
  return true;
}

export function queuePhoto(opts: {
  jobId: string;
  data: ArrayBuffer;
  mimeType: string;
  fileName: string;
  authHeader?: string;
}): boolean {
  const sw = swReady();
  if (sw) {
    sw.postMessage({ type: "QUEUE_PHOTO", payload: opts });
    return true;
  }
  // Sem SW não há como persistir a foto offline — sinaliza ao chamador (não engole).
  return false;
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
