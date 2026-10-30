/**
 * AURA IPTV — service worker. Caches the app shell only.
 * Never caches streams, provider API calls, proxied URLs or credentials.
 */
const CACHE_NAME = 'aura-shell-v3-9';
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './css/desktop.css',
  './js/core.js',
  './js/data.js',
  './js/ui.js',
  './js/player.js',
  './js/views-main.js',
  './js/views-more.js',
  './js/app.js',
  './js/playlist-worker.js',
  './icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/stream') || url.pathname.startsWith('/api/') || /\.(m3u8?|ts)$/i.test(url.pathname) || url.search.includes('url=')) return;

  // Network first for the shell so deploys show up immediately; fall back to cache offline.
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
