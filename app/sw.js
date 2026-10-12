// app/sw.js — アプリシェルのみキャッシュ。データ（Supabase/R2/CDN等のクロスオリジン）は対象外（spec §7 PWA）
// デプロイのたびに VER を上げること（上げないと旧シェルが配信され続ける）
const VER = 'genba-v3';
const SHELL = ['./', './index.html', './login.html', './list.html', './case.html',
  './new-case.html', './photos.html', './report.html', './monthly.html',
  './settings.html', './progress.html',
  './shared/style.css', './shared/config.js', './shared/calc.js',
  './shared/store.js', './shared/ui.js', './shared/drafts.js', './manifest.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Supabase REST・R2署名URL・CDN などクロスオリジンはキャッシュせず素通し（データ鮮度を守る）
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(hit => hit ||
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VER).then(c => c.put(e.request, copy));
      return res;
    })));
});
