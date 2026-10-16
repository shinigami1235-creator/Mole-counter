// Mole Counter, Cygnus Solutions
//
// The app files are served network-first so a fix pushed to GitHub Pages
// reaches the next page load, with the cached copy used when offline.
// Icons are served cache-first. Bump CACHE_NAME on every deploy.
const CACHE_NAME = 'mole-counter-v5';
const FACE_CACHE = 'mole-counter-face-0.10.18';   // kept across deploys
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './moles.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-48.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME && n !== FACE_CACHE).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.origin.includes('fonts.g')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  // The face detector's code and model sit at fixed version numbers, so a
  // cached copy stays valid and face landmarks keep working offline.
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(FACE_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }))
    );
    return;
  }

  // no-cache makes the browser check GitHub for a newer copy instead of
  // serving the one it kept for up to 10 minutes.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
