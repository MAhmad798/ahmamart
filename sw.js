/* AhmaMart service worker (v2)
   - Makes repeat visits fast: the site's own CSS / JS / images are served from the phone's cache instantly,
     and refreshed quietly in the background (stale-while-revalidate), so updates still arrive on the next visit.
   - Pages (HTML), the database, payments and everything else always go straight to the network, so nobody sees an old page.
   - On activation it removes caches from older versions of this file. */
const CACHE = 'ahma-static-v2';
const STATIC = /\.(?:css|js|png|webp|jpe?g|svg|ico|woff2?)$/i;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !STATIC.test(url.pathname)) return;   /* leave everything else alone */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const refresh = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  })());
});
