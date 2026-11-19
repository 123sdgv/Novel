const scope = self.registration.scope;
const prefix = 'novel-chat:' + scope + ':';
const cacheName = prefix + '1.3.0-1';
const assets = ['./', './index.html', './style.css', './manifest.webmanifest', './icons/book.svg',
  './icons/book-192.png', './icons/book-512.png', './icons/book-mask.png',
  './js/app.js', './js/view.js', './js/story.js', './js/swipe.js', './js/backup.js', './js/api.js', './js/db.js'];
const allowed = new Set(assets.map(asset => new URL(asset, scope).href));
self.addEventListener('install', event => event.waitUntil(
  caches.open(cacheName).then(cache => cache.addAll(assets.map(asset => new Request(new URL(asset, scope), {cache:'reload'}))))
));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization') || !allowed.has(request.url)) return;
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(request)) || fetch(request)));
});
