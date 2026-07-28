// Lavalle Haus OS — minimal service worker. Pure passthrough: it exists so the
// app is installable everywhere; caching stays with the browser/CDN so the
// team always runs the latest deploy (no stale-app headaches).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
