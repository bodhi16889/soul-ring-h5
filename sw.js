/* sw.js — 只給 GitHub Pages 版用（CrazyGames / GamePix / itch 的嵌入頁不會註冊）
 *
 * 策略：
 *   導航請求（開網址）→ network-first，離線時回快取的 index.html
 *   同源靜態檔     → stale-while-revalidate（先回快取、背景更新）
 *   跨網域（SDK）  → 完全交給瀏覽器，不攔
 *
 * 改版時只要改 VERSION，activate 會清掉舊快取。
 */
const VERSION = 'v1.10.0';
const CACHE = 'soulring-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/state.js',
  './js/battle.js',
  './js/ui.js',
  './js/i18n.js',
  './js/sfx.js',
  './js/ads.js',
  './js/ads-gamepix.js',
  './manifest.webmanifest',
  './pwa/icon-192.png',
  './pwa/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // 個別檔案失敗不要讓整次安裝失敗
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // SDK 等外部資源不攔

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
