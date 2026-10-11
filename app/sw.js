// app/sw.js — アプリシェルのみキャッシュ。データは対象外（spec §7 PWA）
const VER = 'genba-v1';
const SHELL = ['./', './index.html', './list.html', './case.html', './settings.html',
  './shared/style.css', './shared/config.js', './shared/calc.js',
  './shared/mock-data.js', './shared/store.js', './shared/ui.js', './manifest.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit ||
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VER).then(c => c.put(e.request, copy));
      return res;
    })));
});
