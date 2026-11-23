/* ==========================================================================
 * sfx.js — 極簡音效（WebAudio 合成，零素材、零外部請求）
 *
 * 原則：
 *  - 全部用 oscillator 合成，不載任何檔案（GitHub Pages / GamePix 都不需要資源）
 *  - 第一次使用者互動才建立 AudioContext（瀏覽器自動播放政策）
 *  - 廣告 / 分頁切換時 suspend()，回來 resume()
 *  - 可整體關閉（存 localStorage，跟語系一樣是裝置偏好）
 * ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'soulring.sfx';
  var enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) { enabled = true; }

  var ctx = null;
  var lastHit = 0;

  /* BGM：8 小節五聲音階琶音循環，全部用 oscillator 合成（零素材）。
     預設關閉——平台上自動播放音樂會被審查挑，玩家想聽再自己開。 */
  var BGM_KEY = 'soulring.bgm';
  var bgmOn = false;
  var bgmTimer = null;
  var bgmStep = 0;
  var BGM_SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
  try { bgmOn = localStorage.getItem(BGM_KEY) === 'on'; } catch (e) { bgmOn = false; }

  function bgmTick() {
    if (!bgmOn || !enabled) return;
    var c = ac();
    if (!c || c.state === 'suspended') return;
    var t0 = c.currentTime;
    var note = BGM_SCALE[(bgmStep * 3) % BGM_SCALE.length];
    var bass = BGM_SCALE[(bgmStep * 5) % 4] / 2;
    [[note, 0.9, 'sine', 0.012], [bass, 1.6, 'triangle', 0.010]].forEach(function (n) {
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = n[2];
      osc.frequency.setValueAtTime(n[0], t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(n[3], t0 + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1]);
      osc.connect(g); g.connect(c.destination);
      osc.start(t0); osc.stop(t0 + n[1] + 0.05);
    });
    bgmStep = (bgmStep + 1) % 16;
  }

  function bgmSet(v) {
    bgmOn = !!v;
    try { localStorage.setItem(BGM_KEY, bgmOn ? 'on' : 'off'); } catch (e) {}
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    if (bgmOn) { unlockAudio(); bgmTick(); bgmTimer = setInterval(bgmTick, 620); }
  }

  function ac() {
    if (!ctx) {
      var C = global.AudioContext || global.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch (e) { ctx = null; }
    }
    return ctx;
  }

  function blip(freq, dur, type, gain, when) {
    if (!enabled) return;
    var c = ac();
    if (!c || c.state === 'suspended') return;
    var t0 = c.currentTime + (when || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.03, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function hit() {
    var now = Date.now();
    if (now - lastHit < 70) return;      // 多段傷害時不要糊成一片
    lastHit = now;
    blip(440 + Math.random() * 120, 0.05, 'square', 0.018);
  }
  function kill() { blip(300, 0.12, 'triangle', 0.03); blip(180, 0.18, 'triangle', 0.022, 0.05); }
  function levelup() { blip(523, 0.1, 'sine', 0.035); blip(784, 0.16, 'sine', 0.032, 0.09); }
  function clear() { blip(392, 0.09, 'sine', 0.03); blip(587, 0.12, 'sine', 0.03, 0.08); blip(784, 0.18, 'sine', 0.028, 0.16); }
  function boss() { blip(110, 0.25, 'sawtooth', 0.03); }
  function unlock() { blip(659, 0.1, 'sine', 0.032); blip(988, 0.18, 'sine', 0.03, 0.1); }
  function tap() { blip(600, 0.03, 'sine', 0.02); }

  function unlockAudio() {
    // 第一次點擊時把 AudioContext 叫醒（iOS 需要）
    var c = ac();
    if (c && c.state === 'suspended') c.resume();
  }

  function suspend() { if (ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) {} } }
  function resume() { if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} } }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) {}
  }

  global.SFX = {
    hit: hit, kill: kill, levelup: levelup, clear: clear, boss: boss,
    unlock: unlock, tap: tap, unlockAudio: unlockAudio,
    suspend: suspend, resume: resume,
    setEnabled: setEnabled,
    bgmSet: bgmSet,
    get bgm() { return bgmOn; },
    get enabled() { return enabled; },
  };

  document.addEventListener('gp:pause', suspend);
  document.addEventListener('gp:resume', resume);
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) suspend(); else resume();
  });
})(window);
