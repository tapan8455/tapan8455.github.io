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

  // 1. Only handle same-origin requests for the app shell — completely ignore third-party CDNs, poster images, etc.
  if (url.origin !== self.location.origin) {
    return;
  }

  // 2. Bypass all media stream URLs, HLS manifests, TS segments
  if (
    url.pathname.startsWith('/stream') ||
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.ts') ||
    url.protocol === 'aura:'
  ) {
    return;
  }

  // 3. Bypass all provider API requests
  if (url.pathname.startsWith('/api/') || url.pathname.includes('player_api.php')) {
    return;
  }

  // 4. For non-GET requests, bypass
  if (event.request.method !== 'GET') {
    return;
  }

  // 5. Stale-while-revalidate for local app shell
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
      }).catch(() => {
        return cachedResponse || new Response('Offline', { status: 503, statusText: 'Offline' });
      });

      return cachedResponse || fetchPromise;
    })
  );
});
