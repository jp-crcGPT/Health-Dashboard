/* Health Baseline service worker: keeps the app working offline.
   It caches only the app's own files. Your results live in browser storage, not here. */
const CACHE = 'health-baseline-1.0.0';
const ASSETS = ['./', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'atkinson-hyperlegible-next.woff2', 'pdf.min.js', 'pdf.worker.min.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('health-baseline-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Serve from the cache straight away, and refresh the cache from the network in the background.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const network = fetch(req).then(async res => {
    if (res && res.ok && res.type === 'basic') { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); }
    return res;
  }).catch(() => undefined);
  event.waitUntil(network.then(() => undefined));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (cached) return cached;
    const res = await network;
    return res || new Response('Offline, and this file is not saved yet. Open the app once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
