/* ==========================================================================
 * ads-crazy.js — CrazyGames SDK v3 provider
 *
 * SDK：https://sdk.crazygames.com/crazygames-sdk-v3.js（由 index.html 靜態載入）
 * 注意 v3 的差異：
 *   - 必須 await SDK.init() 之後才能呼叫其他 API
 *   - loading 改名：loadingStart() / loadingStop()（v2 的 sdkGameLoadingStart 已移除）
 *   - 廣告：ad.requestAd('midgame'|'rewarded', { adStarted, adError, adFinished })
 *   - 頻率由 CrazyGames 自己節流（最快 3 分鐘一次），我們仍保留自己的冷卻當雙保險
 * ========================================================================== */
(function (global) {
  'use strict';
  var providers = global.ADS_PROVIDERS = global.ADS_PROVIDERS || {};

  var ready = null;          // init 的 Promise
  var loading = false;       // loadingStart 是否已送出（避免重複）
  var started = false;

  function sdk() {
    return (global.CrazyGames && global.CrazyGames.SDK) ? global.CrazyGames.SDK : null;
  }
  function has() { return !!sdk(); }
  function env() {
    var s = sdk();
    try { return (s && s.environment) || 'unknown'; } catch (e) { return 'unknown'; }
  }

  /* v3 規定：必須先 await SDK.init() 才能呼叫其他 API（loadingStart 也算）。
     所以 init 完才送 loadingStart，並把任何 rejection 吃掉，避免 unhandled rejection。 */
  function ensure() {
    if (ready) return ready;
    var s = sdk();
    if (!s) {
      ready = Promise.reject(new Error('no-sdk'));
      ready.catch(function () {});
      return ready;
    }
    ready = Promise.resolve(s.init ? s.init() : null).then(function () {
      try {
        if (s.game && s.game.loadingStart) { s.game.loadingStart(); loading = true; }
      } catch (e) { /* 舊版沒有就算了 */ }
      return true;
    }, function () { return false; });
    return ready;
  }

  function ad(type) {
    return ensure().then(function () {
      return new Promise(function (resolve) {
        var s = sdk();
        if (!s || !s.ad || !s.ad.requestAd) return resolve({ success: false, message: 'no-sdk' });
        var done = false;
        var finish = function (ok, msg) {
          if (done) return;
          done = true;
          resolve(ok ? { success: true } : { success: false, message: msg || 'ad-failed' });
        };
        try {
          s.ad.requestAd(type, {
            adStarted: function () { global.ADS.setPaused(true); },
            adError: function (err) {
              global.ADS.setPaused(false);
              finish(false, 'ad-error:' + (err && err.code ? err.code : err));
            },
            adFinished: function () {
              global.ADS.setPaused(false);
              finish(true);
            },
          });
        } catch (e) {
          finish(false, 'request-threw');
        }
      });
    }, function () { return { success: false, message: 'no-sdk' }; });
  }

  providers.crazy = {
    id: 'crazy',
    hasSdk: has,

    adsAllowed: function () {
      if (!has()) return false;
      var e = env();
      return e !== 'disabled';
    },

    init: function () { ensure().catch(function () {}); },

    loading: function () { /* CrazyGames 沒有百分比 API，只在 init 時打 loadingStart */ },

    loaded: function () {
      return ensure().then(function () {
        var s = sdk();
        if (loading && s && s.game && s.game.loadingStop) {
          try { s.game.loadingStop(); loading = false; } catch (e) {}
        }
      }, function () {});
    },

    gameStart: function () {
      ensure().then(function () {
        if (started) return;
        started = true;
        var s = sdk();
        if (s && s.game && s.game.gameplayStart) { try { s.game.gameplayStart(); } catch (e) {} }
      }, function () {});
    },

    interstitial: function () { return ad('midgame'); },
    reward: function () { return ad('rewarded'); },

    happy: function () {
      var s = sdk();
      if (s && s.game && s.game.happytime) { try { s.game.happytime(); } catch (e) {} }
    },
    sad: function () { /* CrazyGames 沒有 sadMoment 對應 */ },

    /* 進選單／切分頁要告訴 SDK 遊戲暫停（requirements 要求），回戰鬥再 gameplayStart */
    paused: function (v) {
      if (!started) return;
      ensure().then(function () {
        var s = sdk();
        if (!s || !s.game) return;
        try {
          if (v && s.game.gameplayStop) s.game.gameplayStop();
          else if (!v && s.game.gameplayStart) s.game.gameplayStart();
        } catch (e) {}
      }, function () {});
    },
  };
})(window);
