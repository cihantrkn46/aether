// sw.js - Güncellenmiş ve kararlı sürüm
const VERSION = 'v3.4-online';
const STATIC_CACHE = `aether-static-${VERSION}`;
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable.png'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(STATIC_CACHE).then(async (cache) => {
            for (const asset of ASSETS) {
                try { await cache.add(asset); }
                catch (err) { console.warn('Cache hatası:', asset, err); }
            }
        })
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (!key.includes(VERSION)) return caches.delete(key);
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    if (!e.request.url.startsWith(self.location.origin)) return;

    e.respondWith(
        caches.match(e.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;

            return fetch(e.request)
                .then(networkResponse => {
                    const responseClone = networkResponse.clone();
                    caches.open(STATIC_CACHE)
                        .then(cache => cache.put(e.request, responseClone))
                        .catch(err => console.warn('Cache put hatası:', err));
                    return networkResponse;
                })
                .catch(() => {
                    return new Response('Ağ bağlantısı yok veya kaynak bulunamadı', {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                });
        })
    );
});