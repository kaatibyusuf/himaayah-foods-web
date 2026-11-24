// Minimal offline shell: network first, fall back to cache.
const CACHE = 'hf-shell-v5';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/config.js', 'js/remote.js', 'assets/vendor/leaflet.js', 'assets/vendor/leaflet.css', 'assets/logo.svg', 'assets/logo-dark.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
