/* ==========================================================================
 * ads.js — 廣告／平台 SDK 的門面（façade）
 *
 * 為什麼要這一層：同一個遊戲要上 GamePix、CrazyGames、itch，每家的 SDK 名稱、
 * 生命週期、廣告 API 都不同。這裡只留「遊戲需要的動詞」，SDK 差異收在各 provider：
 *
 *   js/ads.js          ← 這個檔：DOM（載入條／遮罩）、冷卻、暫停狀態、事件派送
 *   js/ads-gamepix.js  ← GamePix SDK v3
 *   js/ads-crazy.js    ← CrazyGames SDK v3
 *   （itch 版：兩個 provider 都不打包，ui.js 走 hideLoading() 分支）
 *
 * 對外介面（與舊版 GP 完全相容，window.GP 是別名）：
 *   boot() loading(pct) loaded()->Promise gameStart()
 *   interstitial()->Promise<{success}> reward()->Promise<{success}>
 *   happy(type) sad(type) setPaused(bool)
 *   paused / adsAllowed / hasSdk / log / state / name
 *
 * 本機測試：?ads=crazy|gamepix|none 可強制選 provider；?gpx_ads=1 讓 GamePix 本機也放廣告。
 * ========================================================================== */
(function (global) {
  'use strict';

  var providers = global.ADS_PROVIDERS = global.ADS_PROVIDERS || {};

  /* ---------- 選 provider：先看強制值，再看 host/SDK 是否存在 ---------- */
  var forced = (function () {
    if (global.ADS_PROVIDER) return String(global.ADS_PROVIDER).toLowerCase();
    var m = /[?&]ads=([a-z]+)/i.exec(global.location ? global.location.search || '' : '');
    return m ? m[1].toLowerCase() : '';
  })();

  function pick() {
    if (forced === 'none') return null;
    if (forced && providers[forced]) return providers[forced];
    if (providers.gamepix && providers.gamepix.hasSdk()) return providers.gamepix;
    if (providers.crazy && providers.crazy.hasSdk()) return providers.crazy;
    return null;
  }

  /* provider 檔案在 ads.js 之後才載入（index.html 順序），所以不能在建構時就挑；
     改成第一次用到時才挑，之後快取。 */
  var P = null, picked = false;
  function provider() { if (!picked) { P = pick(); picked = true; } return P; }
  var state = { paused: false, started: false, lastAd: 0, lastReward: 0, log: [] };
  var AD_COOLDOWN = 120000;       // 插頁最短間隔（ CrazyGames 自己也會節流，這只是雙保險）
  var REWARD_COOLDOWN = 600000;   // 獎勵廣告最短間隔
  var lastPct = 0;

  function note(msg) { state.log.push(msg); if (state.log.length > 40) state.log.shift(); }

  /* ---------- 載入條與遮罩（DOM 只出現在這一層）---------- */
  function loading(pct) {
    var p = Math.max(0, Math.min(100, pct | 0));
    if (p < lastPct) return;              // 只前進不後退
    lastPct = p;
    var bar = document.getElementById('loadingBar');
    if (bar) bar.style.width = p + '%';
    var pv = provider();
    if (pv && pv.loading) { try { pv.loading(p); } catch (e) { note('loading err'); } }
  }

  function hideOverlay() {
    var el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
  }

  function loaded() {
    loading(100);
    var done = function () { hideOverlay(); };
    var pv = provider(), r = null;
    if (pv && pv.loaded) { try { r = pv.loaded(); } catch (e) { note('loaded err'); } }
    return Promise.resolve(r).then(done, done);
  }

  function boot() {
    var pv = provider();
    if (pv && pv.init) { try { pv.init(); } catch (e) { note('init err'); } }
    else note('no provider');
    loading(8);
  }

  function gameStart() {
    if (state.started) return;
    state.started = true;
    var pv = provider();
    if (pv && pv.gameStart) { try { pv.gameStart(); note('gameStart'); } catch (e) { note('start err'); } }
  }

  /* ---------- 廣告（統一成 Promise<{success}>）---------- */
  function allowed() { var pv = provider(); return !!(pv && pv.adsAllowed && pv.adsAllowed()); }

  function runAd(kind) {
    var now = Date.now();
    if (!allowed()) return Promise.resolve({ success: false, message: 'ads-disabled' });
    if (kind === 'midgame') {
      if (now - state.lastAd < AD_COOLDOWN) return Promise.resolve({ success: false, message: 'cooldown' });
      state.lastAd = now;
    } else {
      if (now - state.lastReward < REWARD_COOLDOWN) return Promise.resolve({ success: false, message: 'cooldown' });
      state.lastReward = now;
    }
    var pv = provider();
    var fn = kind === 'midgame' ? pv && pv.interstitial : pv && pv.reward;
    if (!fn) return Promise.resolve({ success: false, message: 'not-supported' });
    var out;
    try { out = fn.call(pv); } catch (e) { note(kind + ' err'); return Promise.resolve({ success: false }); }
    return Promise.resolve(out).then(
      function (r) { note(kind + ' ' + (r && r.success)); return r && typeof r === 'object' ? r : { success: !!r }; },
      function () { note(kind + ' fail'); return { success: false }; }
    );
  }

  function interstitial() { return runAd('midgame'); }
  function reward() { return runAd('rewarded'); }

  function happy(t) { var pv = provider(); if (pv && pv.happy) { try { pv.happy(t); } catch (e) {} } }
  function sad(t) { var pv = provider(); if (pv && pv.sad) { try { pv.sad(t); } catch (e) {} } }

  /* ---------- 暫停（冪等；SDK 事件與分頁切換都會呼叫）---------- */
  function setPaused(v) {
    if (state.paused === v) return;
    state.paused = v;
    global.__gpPaused = v;
    var pv = provider();
    if (pv && pv.paused) { try { pv.paused(v); } catch (e) {} }
    document.dispatchEvent(new CustomEvent(v ? 'gp:pause' : 'gp:resume'));
  }

  var api = {
    boot: boot, loading: loading, loaded: loaded, gameStart: gameStart,
    interstitial: interstitial, reward: reward, happy: happy, sad: sad,
    setPaused: setPaused,
    get paused() { return state.paused; },
    get adsAllowed() { return allowed(); },
    get hasSdk() { var pv = provider(); return !!(pv && pv.hasSdk && pv.hasSdk()); },
    get log() { return state.log.slice(); },
    note: function (m) { note(m); },
    get name() { var pv = provider(); return pv ? pv.id : 'none'; },
    state: state,
  };

  global.ADS = api;
  global.GP = api;          // 舊程式碼與測試沿用；之後新程式碼請用 ADS
})(window);
