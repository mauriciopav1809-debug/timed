/* TIMED: cache offline. Ao publicar uma versao nova, troque o numero abaixo. */
var CACHE = 'timed-v13';
var FILES = [
  './',
  './index.html',
  './sw.js',
  './manifest.webmanifest',
  './importacao.js',
  './backup.js',
  './assets/emblema.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './lib/xlsx.full.min.js',
  './lib/pdf.min.mjs',
  './lib/pdf.worker.min.mjs',
  './guia/TIMED-Guia-Rapido.pdf'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES);
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf('timed-v') === 0 && k !== CACHE;
    }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.tipo === 'atualizar') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.get('range')) return;
  var url;
  try { url = new URL(req.url); } catch (x) { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true });
    }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var cp = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.open(CACHE).then(function (c) {
          return c.match('./index.html');
        });
        return Response.error();
      });
    })
  );
});
