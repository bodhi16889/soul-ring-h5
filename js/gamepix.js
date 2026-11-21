/* ==========================================================================
 * gamepix.js — GamePix SDK v3 包裝層
 *
 * 原則：
 *  - 沒有 SDK（本機 file://、CDN 掛掉、GitHub Pages）時全部 no-op，遊戲照常可玩
 *  - 廣告只在「關卡之間」，有冷卻；獎勵廣告一定要玩家自己按，且寫清楚換什麼
 *  - pause/resume 必須冪等（SDK 與分頁切換都會呼叫）
 *
 * 本機測試：?gpx_inspector=1 顯示狀態；?gpx_ads=1 在非 Player 環境強制開廣告
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDK_URL = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';
  var hasSdk = function () { return typeof global.GamePix !== 'undefined'; };

  /* 廣告只在 Player（iframe）或 gamepix 網域；本機要 ?gpx_ads=1 才開，
     避免公開 demo 被 SDK 模擬的假廣告蓋住。 */
  var adsAllowed = (function () {
    try {
      if (global.self !== global.top) return true;
      if (/(^|\.)gamepix\.com$/i.test(location.hostname)) return true;
      return /[?&]gpx_ads=1\b/.test(location.search || '');
    } catch (e) { return false; }
  })();

  var state = { paused: false, started: false, lastAd: 0, lastReward: 0, log: [] };
  var AD_COOLDOWN = 120000;      // 插頁廣告最短間隔
  var REWARD_COOLDOWN = 600000;  // 獎勵廣告最短間隔

  function note(msg) { state.log.push(msg); if (state.log.length > 40) state.log.shift(); }

  function loading(pct) {
    var p = Math.max(0, Math.min(100, pct | 0));
    var bar = document.getElementById('loadingBar');
    if (bar) bar.style.width = p + '%';
    if (hasSdk() && global.GamePix.lifecycle && global.GamePix.lifecycle.loading) {
      try { global.GamePix.lifecycle.loading(p); } catch (e) { note('loading err'); }
    }
  }

  function loaded() {
    loading(100);
    var done = function () { hideOverlay(); };
    if (hasSdk() && global.GamePix.lifecycle && global.GamePix.lifecycle.loaded) {
      try {
        var r = global.GamePix.lifecycle.loaded();
        if (r && typeof r.then === 'function') { r.then(done, done); return; }
      } catch (e) { note('loaded err'); }
    }
    done();
  }

  function hideOverlay() {
    var el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
  }

  function gameStart() {
    if (state.started) return;
    state.started = true;
    if (hasSdk() && global.GamePix.lifecycle && global.GamePix.lifecycle.gameStart) {
      try { global.GamePix.lifecycle.gameStart(); note('gameStart'); } catch (e) { note('start err'); }
    }
  }

  function interstitial() {
    if (!adsAllowed) return Promise.resolve({ success: false, message: 'ads-disabled-outside-player' });
    if (!hasSdk() || !global.GamePix.ads) return Promise.resolve({ success: false, message: 'no-sdk' });
    var now = Date.now();
    if (now - state.lastAd < AD_COOLDOWN) return Promise.resolve({ success: false, message: 'cooldown' });
    state.lastAd = now;
    try {
      return Promise.resolve(global.GamePix.ads.interstitial()).then(
        function (r) { note('interstitial ' + (r && r.success)); return r || { success: false }; },
        function () { note('interstitial fail'); return { success: false }; }
      );
    } catch (e) { note('interstitial err'); return Promise.resolve({ success: false }); }
  }

  function reward() {
    if (!adsAllowed) return Promise.resolve({ success: false, message: 'ads-disabled-outside-player' });
    if (!hasSdk() || !global.GamePix.ads) return Promise.resolve({ success: false, message: 'no-sdk' });
    var now = Date.now();
    if (now - state.lastReward < REWARD_COOLDOWN) return Promise.resolve({ success: false, message: 'cooldown' });
    state.lastReward = now;
    try {
      return Promise.resolve(global.GamePix.ads.reward()).then(
        function (r) { note('reward ' + (r && r.success)); return r || { success: false }; },
        function () { note('reward fail'); return { success: false }; }
      );
    } catch (e) { note('reward err'); return Promise.resolve({ success: false }); }
  }

  function happy(t) { if (hasSdk() && global.GamePix.happyMoment) { try { global.GamePix.happyMoment(t); } catch (e) {} } }
  function sad(t) { if (hasSdk() && global.GamePix.sadMoment) { try { global.GamePix.sadMoment(t); } catch (e) {} } }

  /* pause / resume：SDK 與頁面可見性都會呼叫，必須冪等 */
  function setPaused(v) {
    if (state.paused === v) return;
    state.paused = v;
    global.__gpPaused = v;
    var ev = new CustomEvent(v ? 'gp:pause' : 'gp:resume');
    document.dispatchEvent(ev);
  }

  function bind() {
    if (hasSdk() && global.GamePix.events && global.GamePix.events.on) {
      try {
        global.GamePix.events.on('pause', function () { setPaused(true); note('sdk pause'); });
        global.GamePix.events.on('resume', function () { setPaused(false); note('sdk resume'); });
      } catch (e) { note('events err'); }
    }
    document.addEventListener('visibilitychange', function () {
      setPaused(document.hidden);
    });
    document.addEventListener('gp:pause', function () {
      if (global.State && State.save) { try { State.save(true); } catch (e) {} }
    });
  }

  /* 依序：載入 SDK → 回報 loading → 綁事件 */
  function boot() {
    loading(8);
    if (hasSdk()) { bind(); loading(40); return; }
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = function () { loading(45); bind(); note('sdk ok'); };
    s.onerror = function () { loading(45); note('sdk unavailable — no-op'); };
    document.head.appendChild(s);
  }

  global.GP = {
    boot: boot, loading: loading, loaded: loaded, gameStart: gameStart,
    interstitial: interstitial, reward: reward, happy: happy, sad: sad,
    setPaused: setPaused,
    get paused() { return state.paused; },
    get adsAllowed() { return adsAllowed; },
    get hasSdk() { return hasSdk(); },
    get log() { return state.log.slice(); },
    state: state,
  };
})(window);
