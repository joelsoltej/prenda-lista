// Guarda la app y el modelo de recorte para que funcione sin conexión (Gemini sí necesita internet).
const VERSION = 'v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'js/db.js', 'js/images.js', 'js/ai.js', 'js/emoji.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'img/grass-1.jpg', 'img/grass-2.jpg'];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'staticimgly.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('shell-' + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== 'shell-' + VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // App: red primero (para recibir cambios), caché si no hay conexión.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(url.href, { cache: 'no-cache' })
        .then((r) => { const copy = r.clone(); caches.open('shell-' + VERSION).then((c) => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
    return;
  }

  // Librería y modelo de recorte: caché primero, se descargan una sola vez.
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open('runtime').then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      }),
    );
  }
});
