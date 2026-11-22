/* ==========================================================================
 * ads-gamepix.js — GamePix SDK v3 provider
 *
 * 只放 SDK 專屬邏輯；DOM、冷卻、暫停狀態在 js/ads.js。
 * SDK 由 index.html 的 <head> 靜態載入（官方要求早於任何遊戲程式），
 * 這裡不再動態注入——沒有 SDK（CDN 掛掉／本機）就全部 no-op。
 * ========================================================================== */
(function (global) {
  'use strict';
  var providers = global.ADS_PROVIDERS = global.ADS_PROVIDERS || {};
  var bound = false;

  function sdk() { return global.GamePix; }
  function has() { return typeof sdk() !== 'undefined'; }
  function lc(fn) { var s = sdk(); return s && s.lifecycle && s.lifecycle[fn]; }

  providers.gamepix = {
    id: 'gamepix',

    hasSdk: has,

    /* 廣告只在 Player（iframe）或 gamepix 網域；本機要 ?gpx_ads=1 才開，
       避免公開 demo 被 SDK 模擬的假廣告蓋住。 */
    adsAllowed: function () {
      try {
        if (global.self !== global.top) return true;
        if (/(^|\.)gamepix\.com$/i.test(global.location.hostname)) return true;
        return /[?&]gpx_ads=1\b/.test(global.location.search || '');
      } catch (e) { return false; }
    },

    init: function () {
      if (!has()) { if (global.ADS && global.ADS.note) global.ADS.note('sdk unavailable'); return; }
      if (bound) return;
      bound = true;
      if (global.ADS && global.ADS.note) global.ADS.note('sdk present');
      try {
        var s = sdk();
        if (s.events && s.events.on) {
          s.events.on('pause', function () { global.ADS.setPaused(true); });
          s.events.on('resume', function () { global.ADS.setPaused(false); });
        }
        if (global.ADS && global.ADS.note) global.ADS.note('events bound');
      } catch (e) { /* 沒有 events 模組就算了 */ }
    },

    loading: function (pct) {
      var f = lc('loading');
      if (f) { try { f(pct); } catch (e) {} }
    },

    loaded: function () {
      var f = lc('loaded');
      if (!f) return null;
      try { return f(); } catch (e) { return null; }
    },

    gameStart: function () {
      var f = lc('gameStart');
      if (f) { try { f(); } catch (e) {} }
    },

    interstitial: function () {
      var s = sdk();
      if (!s || !s.ads || !s.ads.interstitial) return Promise.resolve({ success: false, message: 'no-sdk' });
      return Promise.resolve(s.ads.interstitial()).then(
        function (r) { return r && typeof r === 'object' ? r : { success: !!r }; },
        function () { return { success: false }; }
      );
    },

    reward: function () {
      var s = sdk();
      if (!s || !s.ads || !s.ads.reward) return Promise.resolve({ success: false, message: 'no-sdk' });
      return Promise.resolve(s.ads.reward()).then(
        function (r) { return r && typeof r === 'object' ? r : { success: !!r }; },
        function () { return { success: false }; }
      );
    },

    happy: function (t) { var s = sdk(); if (s && s.happyMoment) { try { s.happyMoment(t); } catch (e) {} } },
    sad: function (t) { var s = sdk(); if (s && s.sadMoment) { try { s.sadMoment(t); } catch (e) {} } },

    paused: function () { /* GamePix 沒有對應 API；暫停由 events 進來 */ },
  };
})(window);
