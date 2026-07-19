// Service worker DESATIVADO intencionalmente.
//
// Este SW não é (e não deve ser) registrado pelo client — ver src/client/main.tsx.
// O comportamento anterior (cache-first de assets) foi removido por representar
// risco de cache preso. Para não deixar risco latente, se este worker chegar a ser
// registrado por engano ele agora se AUTODESREGISTRA e limpa todos os caches,
// sem interceptar nenhuma requisição (nunca faz cache de /api nem de nada).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll();
      clients.forEach((c) => c.navigate(c.url));
    })(),
  );
});

// Sem handler de fetch: todas as requisições vão direto à rede.
