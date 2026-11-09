/* AhmaMart service worker (safe version)
   - never serves old saved pages: every request goes to the network
   - on activation it deletes all old caches, so a stale/old website is cleared automatically */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
    const wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach(w => { try { w.navigate(w.url); } catch (e) {} });
  })());
});
/* no fetch handler on purpose: the browser loads everything fresh from the network */