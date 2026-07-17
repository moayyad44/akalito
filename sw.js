// أكليتو - Service Worker مشترك (زبون / سائق / أدمن)
// استراتيجية: network-first مع fallback للكاش — عشان التحديثات أثناء التطوير توصل فوراً
// وبنفس الوقت التطبيق يفتح حتى لو الاتصال ضعيف أو منقطع لحظياً.

const CACHE_NAME = "akleto-cache-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // بس نطلب GET، ونتجاهل أي شي مش من نفس الأصل (Firestore, Google APIs...)
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
