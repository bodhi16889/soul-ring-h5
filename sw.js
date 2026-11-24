/* sw.js — 只給 GitHub Pages 版用（CrazyGames / GamePix / itch 的嵌入頁不會註冊）
 *
 * 策略：
 *   導航請求（開網址）→ network-first，離線時回快取的 index.html
 *   同源靜態檔     → **network-first**，失敗才回快取
 *   跨網域（SDK）  → 完全交給瀏覽器，不攔
 *
 * 為什麼不用 stale-while-revalidate：那會讓玩家「重新整理一次還是舊版」。
 * 放置遊戲更新頻繁（平衡調整），寧可多花 100ms 抓新版，也不要讓玩家看到舊數值。
 *
 * 改版時只要改 VERSION，activate 會清掉舊快取。
 */
const VERSION = 'v1.22.0';
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

  /* cache: 'reload' 很重要：預設 fetch 會吃瀏覽器 HTTP 快取（GitHub Pages 給 max-age=600），
     所以「network-first」其實會拿到 10 分鐘前的舊檔，玩家重整也沒用。 */
  const fresh = () => fetch(req, { cache: 'reload' });

  if (req.mode === 'navigate') {
    e.respondWith(
      fresh()
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
    fresh()
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
