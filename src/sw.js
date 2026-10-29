/**
 * AURA IPTV — Progressive Web App Service Worker
 * Caches app shell assets only.
 * CRITICAL: NEVER cache streams (.m3u8, .ts, /stream), API calls (/api/), or credentials.
 */

const CACHE_NAME = 'aura-shell-v2';
const APP_SHELL = [
  '/',
  './css/aura.css',
  './js/aura-app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass all media stream URLs, HLS manifests, TS segments
  if (
    url.pathname.startsWith('/stream') ||
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.ts') ||
    url.protocol === 'aura:'
  ) {
    return;
  }

  // 2. Bypass all provider API requests
  if (url.pathname.startsWith('/api/') || url.pathname.includes('player_api.php')) {
    return;
  }

  // 3. For non-GET requests, bypass
  if (event.request.method !== 'GET') {
    return;
  }

  // 4. Stale-while-revalidate for app shell
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
