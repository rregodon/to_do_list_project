// Service worker: guarda la app en el dispositivo para que abra al instante
// (aunque el servidor esté "dormido") y funcione sin conexión.
const CACHE = "tareas-v4";
const ARCHIVOS = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.json", "/icono-180.png", "/icono-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // La API y el login siempre van al servidor
  if (e.request.method !== "GET" || url.origin !== location.origin ||
      url.pathname.startsWith("/api/") || url.pathname === "/login.html") return;

  // Responde con la copia guardada y la actualiza por detrás para la próxima vez
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardada = await cache.match(e.request, { ignoreSearch: true });
      const deRed = fetch(e.request)
        .then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; })
        .catch(() => guardada);
      return guardada || deRed;
    })
  );
});
