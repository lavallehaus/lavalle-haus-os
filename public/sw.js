// KILL SWITCH — this service worker replaced a stale one that hung all
// requests. It installs, deletes every cache, unregisters itself, and
// reloads open tabs so the app runs service-worker-free from now on.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const cs = await self.clients.matchAll({ type: "window" });
      cs.forEach((c) => c.navigate(c.url));
    } catch (err) {}
  })());
});
