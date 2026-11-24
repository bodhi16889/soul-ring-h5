/* ==========================================================================
 * state.js — 存檔、衍生數值、離線收益、存檔碼匯出／匯入
 * 純資料層：不碰 DOM，方便測試與日後搬到後端。
 * ========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'soulring.save.v1';
  const BAK = KEY + '.bak';       // 上一份可用的存檔（主檔壞掉時的唯一退路）
  const TMP = KEY + '.tmp';       // 寫入暫存：先寫這裡、驗證過才換上去
  const SAVE_VERSION = 1;         // 存檔格式版本，每次改 schema 加 1 並補遷移
  const SAVE_EVERY_MS = 10000;
  const OFFLINE_CAP_H = 12;

  /* ---------- 建立新檔 ---------- */
  function newSave() {
    const starter = {
      id: 'haotian', star: CFG.SOUL_BY_ID.haotian.star, level: 1, rings: [], bone: null, ascend: 0,
    };
    return {
      v: 1,
      name: T('無名靈師'),
      level: 1,
      exp: 0,
      coins: 120,
      diamonds: 300,
      tickets: 3,
      stage: 1,
      bestStage: 1,
      lastRebirthBest: 0,
      kills: 0,              // 本關已擊殺小怪
      slots: 1,              // 上陣人數
      souls: [starter],
      team: ['haotian'],
      ringBag: [],           // 未裝備的靈環
      bones: [],             // [{uid, id}] 未裝備的靈骨
      bonePulls: 0,          // 靈幣抽靈骨次數（成本會遞增）
      freeTenUsed: false,    // 新手免費十連是否已用（v1.10.0）
      week: { key: '', kills: 0, hunts: 0, merges: 0, claimed: [] },   // 每週任務
      codex: { souls: {}, bones: {}, rings: {}, beasts: {} },          // 圖鑑（收集表）
      cores: 0,              // 獸核：獵靈掉落，用來把滿級靈印升「覺醒階」
      ticketPulls: 0,        // 覺醒券抽的累計次數（里程用）
      relics: [],            // 靈寶（限量 12 件，只能拿一次）
      milestoneAt: 0,        // 上次已結算的券抽里程（防止重複發獎）
      spire: { best: 0, day: '', used: 0 },   // 無盡深塔：最高層 / 日期 / 今日已用次數
      dungeon: { day: '', done: [] },         // 每日副本：今天打過哪些
      shop: { day: '', bought: {} },          // 商店：今日各格已買次數
      talents: {},                            // 命印天賦：nodeId → 等級
      relicLv: {},                            // 靈寶等級：id → 1..5
      settings: { autoRing: true, autoBoss: true, autoHunt: true, autoMerge: true, autoStar: true, speed: 1, autoPriority: 'boss' },
      rerolls: 0,                             // 重鑄券（商店買）
      elite: { day: '', ids: [] },   // 今日已打的精英靈獸
      depth: {},             // 深林層數：beastId -> 已連續狩獵次數
      pendingOffline: null,  // 這次回歸的離線收益（可看廣告加倍一次）
      daily: { day: '', idle: 0, hunt: 0, merge: 0, claimed: [] },   // 每日任務進度
      ach: { unlocked: {} },   // 成就（id -> true），每項永久 +0.5% 全屬性
      cd: {},                // 靈獸 id -> 下次可獵時間
      codes: [],
      checkin: { lastDay: '', streak: 0, total: 0 },   // 每日簽到
      rebirths: 0,           // 轉生次數
      marks: 0,              // 命印：永久加成（每點全屬性 +6%）
      stats: { kills: 0, hunts: 0, pulls: 0, inherits: 0, weeklyClaims: 0, dungeons: 0 },
      lastSave: Date.now(),
    };
  }

  let S = newSave();
  let lastError = null;          // 'quota' | 'verify' | 'write' | null
  let blocked = false;           // 讀到「比本版新」的存檔時停止寫入，避免蓋掉玩家進度

  /* ---------- 存檔：原子寫入 + 回讀驗證 + .bak 備援 ---------- */
  function readKey(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeKey(k, val) {
    try { localStorage.setItem(k, val); return true; }
    catch (e) { try { localStorage.removeItem(k); } catch (_) {} return false; }   // 配額爆掉別留半截
  }

  /* 存檔要能被自己讀回來才算數：欄位不對一律當壞檔 */
  function validateSave(d) {
    if (!d || typeof d !== 'object') return false;
    if (typeof d.v !== 'number') return false;
    if (typeof d.stage !== 'number' || d.stage < 1) return false;
    if (!Array.isArray(d.souls) || !d.souls.length) return false;
    if (!d.souls.every((x) => x && typeof x.id === 'string')) return false;
    return true;
  }
  function parseSave(raw) {
    if (!raw) return null;
    try { const d = JSON.parse(raw); return validateSave(d) ? d : null; } catch (e) { return null; }
  }

  function saveNow() {
    if (blocked) return false;
    const json = JSON.stringify(S);
    if (!writeKey(TMP, json)) { lastError = 'quota'; return false; }
    // 回讀驗證：TMP 必須解析得回來、版本相符
    let ok = false;
    try { ok = validateSave(JSON.parse(readKey(TMP))); } catch (e) { ok = false; }
    if (!ok) { try { localStorage.removeItem(TMP); } catch (e) {} lastError = 'verify'; return false; }
    // 舊主檔降級成 .bak（備份失敗不阻擋本次寫入）
    const cur = readKey(KEY);
    if (cur) writeKey(BAK, cur);
    if (!writeKey(KEY, json)) { lastError = 'write'; return false; }
    try { localStorage.removeItem(TMP); } catch (e) {}
    lastError = null;
    return true;
  }

  /* ---------- 存取 ---------- */
  function load() {
    const main = readKey(KEY);
    const bak = readKey(BAK);
    let d = parseSave(main);
    let from = 'main';
    if (!d) { d = parseSave(bak); from = d ? 'bak' : 'none'; }

    if (!d) {
      // 兩份都不能用：把現場留下來（不覆蓋），再開新檔
      const stamp = Date.now();
      if (main) writeKey(KEY + '.corrupt.' + stamp, main);
      if (bak) writeKey(KEY + '.corrupt.' + stamp + '.bak', bak);
      S = newSave();
      codexSync();
      relicBackfill();
      return { fresh: true, corrupted: !!(main || bak), from };
    }
    if (d.v > SAVE_VERSION) {
      // 未來版本的存檔：不覆蓋、不強制遷移
      blocked = true;
      S = newSave();
      codexSync();
      relicBackfill();
      return { newer: true, from };
    }

    S = migrate(d);
    codexSync();
    relicBackfill();
    if (from === 'bak') { writeKey(KEY, JSON.stringify(S)); }   // 備份救回來就立刻補回主檔
    const gap = offlineGain(S);
    return { fresh: false, offline: gap, restored: from === 'bak' };
  }

  function migrate(d) {
    const base = newSave();
    const out = Object.assign({}, base, d || {});
    out.stats = Object.assign({}, base.stats, (d && d.stats) || {});
    out.souls = Array.isArray(d && d.souls) && d.souls.length ? d.souls : base.souls;
    out.team = Array.isArray(d && d.team) && d.team.length ? d.team : [out.souls[0].id];
    out.ringBag = Array.isArray(d && d.ringBag) ? d.ringBag : [];
    out.cd = (d && d.cd) || {};
    out.codes = Array.isArray(d && d.codes) ? d.codes : [];
    out.checkin = Object.assign({ lastDay: '', streak: 0, total: 0 }, (d && d.checkin) || {});
    out.freeTenUsed = !!(d && d.freeTenUsed);
    out.week = Object.assign({ key: '', kills: 0, hunts: 0, merges: 0, claimed: [] }, (d && d.week) || {});
    if (!Array.isArray(out.week.claimed)) out.week.claimed = [];
    out.codex = Object.assign({ souls: {}, bones: {}, rings: {}, beasts: {} }, (d && d.codex) || {});
    out.pendingOffline = (d && d.pendingOffline) || null;
    out.cores = Math.max(0, out.cores | 0);
    out.ticketPulls = Math.max(0, out.ticketPulls | 0);
    out.relics = Array.isArray(d && d.relics) ? d.relics.slice() : [];
    out.milestoneAt = Math.max(0, out.milestoneAt | 0);
    out.spire = Object.assign({ best: 0, day: '', used: 0 }, (d && d.spire) || {});
    out.dungeon = Object.assign({ day: '', done: [] }, (d && d.dungeon) || {});
    out.shop = Object.assign({ day: '', bought: {} }, (d && d.shop) || {});
    if (!out.shop.bought || typeof out.shop.bought !== 'object') out.shop.bought = {};
    out.rerolls = Math.max(0, out.rerolls | 0);
    out.talents = Object.assign({}, (d && d.talents) || {});
    out.relicLv = Object.assign({}, (d && d.relicLv) || {});
    Object.keys(out.relicLv).forEach((k) => {
      out.relicLv[k] = Math.max(1, Math.min(CFG.RELIC.maxLevel, out.relicLv[k] | 0));
    });
    if (!out.settings) out.settings = {};
    if (!CFG.SPEEDS.includes(out.settings.speed | 0)) out.settings.speed = 1;
    if (['boss', 'hunt', 'farm'].indexOf(out.settings.autoPriority) < 0) out.settings.autoPriority = 'boss';
    if (!Array.isArray(out.dungeon.done)) out.dungeon.done = [];
    out.elite = Object.assign({ day: '', ids: [] }, (d && d.elite) || {});
    out.depth = Object.assign({}, (d && d.depth) || {});
    if (!Array.isArray(out.elite.ids)) out.elite.ids = [];
    /* 圖鑑回填：舊存檔沒有 codex，用「目前持有」推回已收集，
       否則老玩家更新後會看到 0 / 25（明明身上有五個武魂）。 */
    (out.souls || []).forEach((x) => { if (x && x.id) out.codex.souls[x.id] = 1; });
    (out.bones || []).forEach((x) => { if (x && x.id) out.codex.bones[x.id] = 1; });
    (out.ringBag || []).forEach((x) => { if (x && x.tier) out.codex.rings[x.tier] = 1; });
    Object.keys(out.cd || {}).forEach((id) => { out.codex.beasts[id] = 1; });   // 打過才有冷卻
    out.rebirths = Math.max(0, out.rebirths | 0);
    out.marks = Math.max(0, out.marks | 0);
    // 舊存檔：把「上次轉生時的最高關卡」補成現在的 bestStage，
    // 避免一升級就直接白拿一大筆（要再推更深才有）
    out.lastRebirthBest = typeof d.lastRebirthBest === 'number'
      ? d.lastRebirthBest : Math.max(0, out.bestStage | 0);
    /* 這裡會整包覆蓋 settings —— 預設值要跟上面一致，否則 reload 後
       倍速（speed）、自動升星（autoStar）、自動化優先序（autoPriority）會被吃掉。 */
    out.settings = Object.assign({
      autoBoss: true, autoHunt: true, autoRing: true, autoMerge: true,
      autoStar: true, speed: 1, autoPriority: 'boss',
    }, (d && d.settings) || {});
    if (!CFG.SPEEDS.includes(out.settings.speed | 0)) out.settings.speed = 1;
    if (['boss', 'hunt', 'farm'].indexOf(out.settings.autoPriority) < 0) out.settings.autoPriority = 'boss';
    out.slots = Math.max(1, Math.min(5, out.slots | 0 || 1));
    out.team = out.team.filter((id) => out.souls.some((s) => s.id === id)).slice(0, out.slots);
    out.souls.forEach((s) => {
      if (!Array.isArray(s.rings)) s.rings = [];
      s.ascend = Math.max(0, Math.min(CFG.ASCEND.maxStage, s.ascend | 0));
      if (s.bone === undefined) s.bone = null;
    });
    // 舊版靈骨只存 id 字串 → 轉成 {uid, id}
    // 舊版裝備靈環時會從背包移除物件 → 補回（年份已遺失，以白色處理）
    const bagUids = new Set(out.ringBag.map((r) => r.uid));
    out.souls.forEach((soul) => {
      (soul.rings || []).forEach((uid) => {
        if (!bagUids.has(uid)) {
          out.ringBag.push({ uid, tier: 'white', name: T('白靈環'), equipped: soul.id });
          bagUids.add(uid);
        }
      });
    });
    out.ringBag.forEach((r) => {
      if (!r.element) r.element = 'wind';
      if (r.equipped && !out.souls.some((x) => x.id === r.equipped)) r.equipped = null;
    });

    out.bones = (Array.isArray(d && d.bones) ? d.bones : []).map((b, i) => {
      if (typeof b === 'string') return { uid: 'bo_mig' + i, id: b };
      if (b && b.id) return { uid: b.uid || ('bo_' + i), id: b.id };
      return null;
    }).filter(Boolean);
    return out;
  }

  let saveTimer = 0;
  function save(force) {
    if (!S.stats) S.stats = {};
    try {
      const _p = power();
      if (!S.stats.bestPower || _p > S.stats.bestPower) S.stats.bestPower = _p;
    } catch (e) { /* 存檔不能因戰力計算失敗而中斷 */ }
    S.lastSave = Date.now();
    if (!force && saveTimer) return;
    saveNow();
    if (!force) {
      saveTimer = setTimeout(() => { saveTimer = 0; }, SAVE_EVERY_MS);
    }
  }
  function reset() {
    blocked = false;
    S = newSave();
    save(true);
    return S;
  }

  /* ---------- 存檔狀態 / 還原備份（設定頁用）---------- */
  function saveStatus() {
    const main = readKey(KEY);
    const bak = readKey(BAK);
    const okMain = !!parseSave(main);
    const okBak = !!parseSave(bak);
    let bakTime = 0;
    try { bakTime = okBak ? (JSON.parse(bak).lastSave || 0) : 0; } catch (e) {}
    return {
      main: okMain ? 'ok' : (main ? 'corrupt' : 'missing'),
      bak: okBak ? 'ok' : (bak ? 'corrupt' : 'missing'),
      bakTime, lastError, blocked,
    };
  }
  function restoreBackup() {
    const bak = readKey(BAK);
    const d = parseSave(bak);
    if (!d) return { ok: false, reason: 'no-bak' };
    if (!writeKey(KEY, bak)) return { ok: false, reason: 'write' };
    blocked = false;
    S = migrate(d);
    save(true);
    return { ok: true, stage: S.stage, bestStage: S.bestStage, level: S.level };
  }

  /* ---------- 離線收益（上限 12 小時）---------- */
  function offlineGain(s) {
    const now = Date.now();
    const last = Number(s.lastSave) || now;
    const ms = Math.max(0, now - last);
    const capped = Math.min(ms, OFFLINE_CAP_H * 3600 * 1000);
    const minutes = Math.floor(capped / 60000);
    if (minutes < 1) return null;
    const rate = CFG.offlinePerMinute(s.stage);
    const mul = 1 + CFG.REBIRTH.perMark.income * s.marks;
    const coins = Math.round(rate.coins * minutes * mul);
    const rawExp = Math.round(rate.exp * minutes * mul);
    const levelBefore = s.level | 0;

    /* v1.20.0：離線經驗只推進到「等級上限 × 80%」。
       實測問題：3 小時離線就把 Lv12 拉到 Lv100（滿級），等級完全失去意義。
       現在超過的部分直接不給（不是先給再扣回），並在明細裡標示上限。 */
    const rings = totalRingsEquipped();
    const lvCap = CFG.levelCap(rings);
    const targetLv = Math.max(levelBefore, Math.floor(lvCap * CFG.OFFLINE.levelCapRatio));
    let exp = rawExp;
    let expCapped = false;
    if (levelBefore >= targetLv) {
      expCapped = rawExp > 0;
      exp = 0;
    } else {
      let need = 0;
      for (let l = levelBefore; l < targetLv; l++) need += CFG.expNeed(l);
      need = Math.max(0, need - (s.exp || 0));
      if (rawExp > need) { exp = need; expCapped = true; }
    }

    s.coins += coins;
    addExp(s, exp, { silent: true });
    const levelAfter = s.level | 0;
    s.lastSave = now;
    /* v1.19.0：離線要有「明細」才有感——時長、靈幣、經驗、升了幾級、每分鐘速率 */
    const detail = {
      minutes, capped: ms > capped, coins, exp, rawExp, expCapped, expCapLv: targetLv, rate,
      levelBefore, levelAfter, levels: Math.max(0, levelAfter - levelBefore),
      coinsPerMin: Math.round(rate.coins * mul), expPerMin: Math.round(rate.exp * mul),
      stage: s.stage | 0, at: now,
    };
    s.pendingOffline = Object.assign({ doubled: false }, detail);
    return detail;
  }

  /* 離線收益加倍：廣告看完才能用，一次回歸只能用一次（不覆蓋原本已入帳的那份） */
  function claimOfflineDouble() {
    const p = S.pendingOffline;
    if (!p || p.doubled) return { ok: false, msg: T('沒有可加倍的離線收益') };
    p.doubled = true;
    S.coins += p.coins;
    addExp(S, p.exp, { silent: true });
    return { ok: true, coins: p.coins, exp: p.exp };
  }

  /* ---------- 每週任務（週一 0 點換週）---------- */
  function weekKey(d) {
    const t = d ? new Date(d) : new Date();
    const jan1 = new Date(t.getFullYear(), 0, 1);
    const days = Math.floor((t - jan1) / 86400000);
    const week = Math.ceil((days + jan1.getDay() + 1) / 7);
    return t.getFullYear() + '-W' + (week < 10 ? '0' + week : week);
  }
  function weekReset() {
    const k = weekKey();
    if (S.week.key === k) return false;
    S.week = { key: k, kills: 0, hunts: 0, merges: 0, claimed: [] };
    return true;
  }
  function weeklyAdd(kind, amount) {
    weekReset();
    if (!(kind in S.week)) return;
    S.week[kind] = Math.min(999999, (S.week[kind] || 0) + amount);
  }
  function weeklyInfo() {
    weekReset();
    return CFG.WEEKLY.map((t) => {
      const done = (S.week[t.id] || 0) | 0;
      const claimed = S.week.claimed.indexOf(t.id) >= 0;
      return { id: t.id, label: t.label, need: t.need, done,
               reward: t.reward, claimed, can: !claimed && done >= t.need };
    });
  }
  function weeklyClaim(id) {
    const info = weeklyInfo().find((x) => x.id === id);
    if (!info) return { ok: false, msg: T('沒有這個任務') };
    if (info.claimed) return { ok: false, msg: T('本週已領過') };
    if (!info.can) return { ok: false, msg: T('任務還沒完成') };
    S.week.claimed.push(id);
    S.stats.weeklyClaims = (S.stats.weeklyClaims | 0) + 1;
    S.diamonds += info.reward.diamonds || 0;
    return { ok: true, reward: info.reward };
  }

  /* ---------- 羈絆（同元素 ≥2 上陣 → 該元素 +12%；三種元素以上 → 全隊 +8%）---------- */
  function bondInfo() {
    const counts = {};
    teamSouls().forEach((x) => {
      const el = (CFG.SOUL_BY_ID[x.id] || {}).element;
      if (el && el !== 'poison') counts[el] = (counts[el] || 0) + 1;
    });
    const kinds = Object.keys(counts).length;
    const strong = Object.keys(counts).filter((el) => counts[el] >= CFG.BOND.sameNeed);
    return { counts, kinds, strong, tri: kinds >= CFG.BOND.triKinds,
             sameBonus: CFG.BOND.sameBonus, triBonus: CFG.BOND.triBonus };
  }

  /* ---------- 套裝：同元素 3 隻 ---------- */
  function setInfo() {
    const counts = bondInfo().counts;
    const active = Object.keys(CFG.SET_BONUS).filter((el) => (counts[el] || 0) >= 3);
    return { counts, active, bonus: active.map((el) => ({ el, ...CFG.SET_BONUS[el] })) };
  }
  function setMulFor(element) {
    const sets = setInfo();
    if (sets.active.indexOf(element) < 0) return { atk: 1, hp: 1, def: 1, spd: 1, hunt: 1 };
    const b = CFG.SET_BONUS[element];
    const out = { atk: 1, hp: 1, def: 1, spd: 1, hunt: 1 };
    if (b.stat === 'hunt') out.hunt = 1 + b.bonus;
    else out[b.stat] = 1 + b.bonus;
    return out;
  }

  /* ---------- 命印天賦樹 ---------- */
  /* v1.21.0：天賦上限不是固定的 5 級——每 2 次轉生 +1 級（上限 99）。
     這是「每次轉生要能升級更多項目」的實作：轉生越多，同一棵樹能繼續點高。 */
  function talentMaxLevel() {
    const n = Math.max(0, S.rebirths | 0);
    return Math.min(CFG.SIGIL.talentCap,
      CFG.SIGIL.talentBase + Math.floor(n / CFG.SIGIL.talentPerRebirth));
  }

  function talentLevel(nid) {
    return Math.min(talentMaxLevel(), ((S.talents || {})[nid] | 0));
  }
  function spentMarks() {
    let n = 0;
    CFG.TALENTS.branches.forEach((b) => b.nodes.forEach((nd) => { n += talentLevel(nd.id); }));
    return n;
  }
  function unspentMarks() { return Math.max(0, (S.marks | 0) - spentMarks()); }
  function talentMul() {
    const out = { atk: 1, hp: 1, def: 1, spd: 1, crit: 0, pen: 0, leech: 0, coin: 0, cores: 0 };
    CFG.TALENTS.branches.forEach((b) => b.nodes.forEach((nd) => {
      const lv = talentLevel(nd.id);
      if (!lv) return;
      if (nd.stat === 'atk' || nd.stat === 'hp' || nd.stat === 'def' || nd.stat === 'spd') out[nd.stat] *= 1 + nd.per * lv;
      else out[nd.stat] += nd.per * lv;
    }));
    return out;
  }
  function talentInfo() {
    const t = talentMul();
    return {
      total: S.marks | 0, spent: spentMarks(), unspent: unspentMarks(),
      resetCores: CFG.TALENTS.resetCores, mul: t,
      maxLevel: talentMaxLevel(),
      branches: CFG.TALENTS.branches.map((b) => ({
        id: b.id, name: b.name,
        nodes: b.nodes.map((nd) => ({
          id: nd.id, name: nd.name, label: nd.label, per: nd.per, stat: nd.stat,
          level: talentLevel(nd.id), max: talentMaxLevel(),
        })),
      })),
    };
  }
  function talentNode(nid) {
    for (const b of CFG.TALENTS.branches) {
      const nd = b.nodes.find((x) => x.id === nid);
      if (nd) return nd;
    }
    return null;
  }
  function learnTalent(nid) {
    const nd = talentNode(nid);
    if (!nd) return { ok: false, msg: T('沒有這個天賦') };
    const lv = talentLevel(nid);
    if (lv >= talentMaxLevel()) return { ok: false, msg: T('已滿級') };
    if (unspentMarks() < 1) return { ok: false, msg: T('沒有可用的命印') };
    S.talents[nid] = lv + 1;
    return { ok: true, level: lv + 1, node: nd };
  }
  function resetTalents() {
    const spent = spentMarks();
    if (!spent) return { ok: false, msg: T('尚未投入命印') };
    const cost = CFG.TALENTS.resetCores;
    if ((S.cores | 0) < cost) return { ok: false, msg: T('獸核不足'), need: cost };
    S.cores -= cost;
    S.talents = {};
    return { ok: true, refunded: spent };
  }

  /* ---------- 印記：無上限的戰績／覺醒成長 ---------- */
  function sigilInfo() {
    const stageMarks = Math.max(0, Math.floor((S.bestStage | 0) / CFG.SIGIL.perStage));
    const milestones = Math.max(0, Math.floor((S.ticketPulls | 0) / CFG.RELIC.every));
    const awakenMarks = Math.max(0, milestones - CFG.RELICS.length);
    const stagePct = stageMarks * CFG.SIGIL.stageBonus;
    const awakenPct = awakenMarks * CFG.SIGIL.awakenBonus;
    return {
      stage: stageMarks, awaken: awakenMarks,
      stagePct, awakenPct,
      mul: (1 + stagePct) * (1 + awakenPct),
      nextStageAt: (stageMarks + 1) * CFG.SIGIL.perStage,
      nextAwakenIn: CFG.RELIC.every - ((S.ticketPulls | 0) % CFG.RELIC.every),
    };
  }

  /* ---------- 商店（每日 6 格）---------- */
  function shopReset() {
    const k = todayKey();
    if (!S.shop || S.shop.day !== k) S.shop = { day: k, bought: {} };
  }
  function shopInfo() {
    shopReset();
    return CFG.SHOP.map((it) => {
      const bought = (S.shop.bought[it.id] | 0);
      const canAfford = Object.keys(it.cost).every((cur) => {
        if (cur === 'cores') return (S.cores | 0) >= it.cost[cur];
        if (cur === 'diamonds') return S.diamonds >= it.cost[cur];
        if (cur === 'coins') return S.coins >= it.cost[cur];
        return false;
      });
      return { ...it, bought, left: Math.max(0, it.stock - bought),
               can: bought < it.stock && canAfford };
    });
  }
  function shopBuy(id) {
    shopReset();
    const it = shopInfo().find((x) => x.id === id);
    if (!it) return { ok: false, msg: T('沒有這個商品') };
    if (it.bought >= it.stock) return { ok: false, msg: T('今日已售完') };
    const cur = it.cost;
    if (cur.cores && (S.cores | 0) < cur.cores) return { ok: false, msg: T('獸核不足') };
    if (cur.diamonds && S.diamonds < cur.diamonds) return { ok: false, msg: T('鑽石不足') };
    if (cur.coins && S.coins < cur.coins) return { ok: false, msg: T('靈幣不足') };
    if (cur.cores) S.cores -= cur.cores;
    if (cur.diamonds) S.diamonds -= cur.diamonds;
    if (cur.coins) S.coins -= cur.coins;
    const g = it.give;
    if (g.tickets) S.tickets += g.tickets;
    if (g.diamonds) S.diamonds += g.diamonds;
    if (g.coins) S.coins += g.coins;
    if (g.cores) addCores(g.cores, { raw: true });
    if (g.rerolls) S.rerolls = (S.rerolls | 0) + g.rerolls;
    if (g.bones) {
      for (let i = 0; i < g.bones; i++) {
        const b = CFG.BONES[Math.floor(Math.random() * CFG.BONES.length)];
        S.bones.push({ uid: 'bo' + Date.now().toString(36) + '_' + i, id: b.id });
        codexMark('bones', b.id);
      }
    }
    S.shop.bought[id] = (S.shop.bought[id] | 0) + 1;
    return { ok: true, item: it };
  }

  /* ---------- 自動升星（QoL）---------- */
  function autoStarUp() {
    if ((S.settings || {}).autoStar === false) return null;
    const list = (S.souls || []).slice().sort((a, b) => (b.star || 3) - (a.star || 3));
    for (const soul of list) {
      const info = starUpInfo(soul);
      if (info.maxed) continue;
      if (freeBones().length < info.bones || S.coins < info.coins) return null;
      const r = starUp(soul.id);
      if (r.ok) return r;
    }
    return null;
  }

  /* ---------- 無盡深塔 ---------- */
  function spireReset() {
    const k = todayKey();
    if (!S.spire || S.spire.day !== k) S.spire = { best: (S.spire && S.spire.best) || 0, day: k, used: 0 };
  }
  function spireInfo() {
    spireReset();
    const best = S.spire.best | 0;
    return { best, used: S.spire.used | 0, perDay: CFG.SPIRE.perDay,
             left: Math.max(0, CFG.SPIRE.perDay - (S.spire.used | 0)),
             marks: Math.min(best, CFG.SPIRE.maxMark),
             bonus: CFG.SPIRE.markBonus * Math.min(best, CFG.SPIRE.maxMark) };
  }
  function spireUse() {
    spireReset();
    if ((S.spire.used | 0) >= CFG.SPIRE.perDay) return { ok: false, msg: T('今日深塔次數已用完') };
    S.spire.used = (S.spire.used | 0) + 1;
    return { ok: true, left: CFG.SPIRE.perDay - S.spire.used };
  }
  /* 回報本次抵達的層數：更新最高紀錄、發獸核 */
  function spireReport(floor) {
    spireReset();
    floor = Math.max(0, floor | 0);
    const before = S.spire.best | 0;
    if (floor > before) S.spire.best = floor;
    return { floor, best: S.spire.best, newBest: floor > before, cores: 0 };
  }
  function spireStats(floor) {
    const f = Math.max(1, floor | 0);
    const sp = CFG.SPIRE;
    const boss = f % sp.bossEvery === 0;
    const hp = Math.round(sp.hpBase * Math.pow(sp.hpGrow, f - 1) * (boss ? 2.2 : 1));
    const atk = Math.round(sp.atkBase * Math.pow(sp.atkGrow, f - 1) * (boss ? 1.15 : 1));
    return { floor: f, boss, hp, atk,
             def: Math.round(atk * 0.4), spd: 88 + Math.min(40, Math.floor(f / 3)) };
  }
  function spireMul() { return 1 + CFG.SPIRE.markBonus * Math.min(S.spire ? (S.spire.best | 0) : 0, CFG.SPIRE.maxMark); }

  /* ---------- 每日副本 ---------- */
  function dungeonReset() {
    const k = todayKey();
    if (!S.dungeon || S.dungeon.day !== k) S.dungeon = { day: k, done: [] };
  }
  function dungeonInfo() {
    dungeonReset();
    return CFG.DUNGEONS.map((d) => ({
      id: d.id, name: d.name, emoji: d.emoji, desc: d.desc,
      done: S.dungeon.done.indexOf(d.id) >= 0,
    }));
  }
  function dungeonMark(id) { dungeonReset(); if (S.dungeon.done.indexOf(id) < 0) S.dungeon.done.push(id); }
  function dungeonReward(id) {
    const d = CFG.DUNGEONS.find((x) => x.id === id);
    if (!d) return null;
    const stage = Math.max(1, S.bestStage | 0);
    if (d.stat === 'coins') return { stat: 'coins', amount: Math.round(CFG.killReward(stage).coins * 900) };
    if (d.stat === 'cores') return { stat: 'cores', amount: 6 };
    return { stat: 'tickets', amount: 2 };
  }
  function dungeonClaim(id) {
    const info = dungeonInfo().find((x) => x.id === id);
    if (!info) return { ok: false, msg: T('沒有這個副本') };
    if (info.done) return { ok: false, msg: T('今天已打過') };
    const rw = dungeonReward(id);
    if (rw.stat === 'coins') S.coins += rw.amount;
    else if (rw.stat === 'cores') S.cores = (S.cores | 0) + rw.amount;
    else if (rw.stat === 'tickets') {
      S.tickets += rw.amount;
      S.ticketPulls = (S.ticketPulls || 0);   // 券本身不動里程，抽的時候才算
    }
    dungeonMark(id);
    S.stats.dungeons = (S.stats.dungeons | 0) + 1;
    return { ok: true, reward: rw };
  }

  /* ---------- 靈環詞條 ---------- */
  function rollAffix() {
    if (Math.random() >= CFG.AFFIX.chance) return null;
    const list = CFG.AFFIX.list;
    const a = list[Math.floor(Math.random() * list.length)];
    return { key: a.key, val: a.val };
  }
  function rerollAffix(uid) {
    const ring = S.ringBag.find((r) => r.uid === uid);
    if (!ring) return { ok: false, msg: T('找不到靈環') };
    let paid = 0;
    if ((S.rerolls | 0) > 0) { S.rerolls -= 1; paid = 0; }
    else {
      if ((S.cores | 0) < CFG.AFFIX.rerollCost) return { ok: false, msg: T('獸核不足'), need: CFG.AFFIX.rerollCost };
      S.cores -= CFG.AFFIX.rerollCost; paid = CFG.AFFIX.rerollCost;
    }
    let a = null;
    for (let i = 0; i < 12 && !a; i++) a = rollAffix();
    ring.affix = a;   // null 代表洗成無詞條（風險）
    return { ok: true, affix: a, cost: paid, usedTicket: paid === 0 };
  }
  function affixTotals() {
    const out = { crit: 0, leech: 0, pen: 0, swift: 0 };
    (S.ringBag || []).forEach((r) => {
      if (!r.affix || !r.equipped) return;
      out[r.affix.key] = (out[r.affix.key] || 0) + r.affix.val;
    });
    return out;
  }

  /* 戰鬥修正：靈環詞條 + 命印天賦（破防 / 吸血），battle.js 只讀這一個入口 */
  function combatMods() {
    const a = affixTotals();
    const t = talentMul();
    return {
      crit: (a.crit || 0) + (t.crit || 0),
      pen: (a.pen || 0) + (t.pen || 0),
      leech: (a.leech || 0) + (t.leech || 0),
    };
  }

  /* ---------- 靈寶（覺醒里程獎勵）---------- */
  function relicProgress() {
    const s = S;
    return Math.max(0, (s.bestStage | 0) + (s.rebirths | 0) * 30 + (s.marks | 0) * 3);
  }
  function relicTierWeights() { return CFG.RELIC.tierWeights(relicProgress()); }
  function hasRelic(id) { return (S.relics || []).indexOf(id) >= 0; }
  function relicCount() { return (S.relics || []).length; }
  /* 抽一件還沒拿到的靈寶；階級用權重、同階內平均。全收集 → null */
  function rollRelic() {
    const w = relicTierWeights();
    const owned = S.relics || [];
    const pools = {};
    CFG.RELICS.forEach((r) => {
      if (owned.indexOf(r.id) >= 0) return;
      (pools[r.tier] = pools[r.tier] || []).push(r);
    });
    const tiers = Object.keys(pools);
    if (!tiers.length) return null;
    // 只在「還有貨」的階級之間依權重抽
    const total = tiers.reduce((a, k) => a + (w[k] || 0), 0);
    if (total <= 0) return pools[tiers[0]][0];
    let roll = Math.random() * total;
    let key = tiers[0];
    for (const k of tiers) { roll -= (w[k] || 0); if (roll <= 0) { key = k; break; } }
    const list = pools[key];
    return list[Math.floor(Math.random() * list.length)];
  }
  /* 舊存檔回填：改版前抽的次數沒有計入里程。
     用 stats.pulls 折算（4 抽算 1 次進度、上限 30），並把該給的靈寶一次補發。 */
  function relicBackfill() {
    if (!S || !CFG || !CFG.RELIC) return 0;
    if (S.ticketPulls && S.ticketPulls > 0) return 0;      // 已經有里程紀錄就不動
    const hist = (S.stats && S.stats.pulls) | 0;
    if (hist <= 0) return 0;
    const credited = Math.min(30, Math.floor(hist / 4));
    if (credited <= 0) return 0;
    S.ticketPulls = credited;
    S.milestoneAt = Math.floor(credited / CFG.RELIC.every) * CFG.RELIC.every;
    const owed = Math.floor(credited / CFG.RELIC.every) - (S.relics || []).length;
    let got = 0;
    for (let i = 0; i < owed; i++) {
      const r = rollRelic();
      if (!r) break;
      S.relics.push(r.id);
      got++;
    }
    return got;
  }

  /* 里程結算：券抽次數每到 10 的倍數就給一件；全收集改給獸核 */
  function relicMilestone() {
    const every = CFG.RELIC.every;
    if ((S.ticketPulls || 0) <= 0 || S.ticketPulls % every !== 0) return null;
    if (S.milestoneAt === S.ticketPulls) return null;   // 防同一里程重複觸發
    S.milestoneAt = S.ticketPulls;
    const relic = rollRelic();
    if (!relic) {
      S.cores = (S.cores || 0) + CFG.RELIC.dupCores;
      return { kind: 'cores', cores: CFG.RELIC.dupCores, at: S.ticketPulls };
    }
    S.relics.push(relic.id);
    return { kind: 'relic', relic, at: S.ticketPulls };
  }
  /* 靈寶等級：只有已擁有的才有等級（預設 1） */
  function relicLevel(id) {
    if (!hasRelic(id)) return 0;
    return Math.max(1, Math.min(CFG.RELIC.maxLevel, (S.relicLv || {})[id] | 0 || 1));
  }
  function relicUpCost(id) {
    const r = CFG.RELICS.find((x) => x.id === id);
    if (!r) return null;
    const base = CFG.RELIC.upCost[r.tier] || 10;
    const lv = relicLevel(id);
    if (lv >= CFG.RELIC.maxLevel) return null;
    return base * lv;           // 1→2 用 1 倍、4→5 用 4 倍
  }
  function relicUpgrade(id) {
    if (!hasRelic(id)) return { ok: false, msg: T('尚未擁有這件靈寶') };
    const lv = relicLevel(id);
    if (lv >= CFG.RELIC.maxLevel) return { ok: false, msg: T('已滿級') };
    const cost = relicUpCost(id);
    if ((S.cores | 0) < cost) return { ok: false, msg: T('獸核不足'), need: cost };
    S.cores -= cost;
    S.relicLv[id] = lv + 1;
    return { ok: true, level: lv + 1, cost };
  }
  function relicInfo() {
    return CFG.RELICS.map((r) => {
      const t = CFG.RELIC_BY_KEY[r.tier];
      const owned = hasRelic(r.id);
      const lv = owned ? relicLevel(r.id) : 0;
      const mul = owned ? 1 + CFG.RELIC.perLevel * (lv - 1) : 0;
      return { id: r.id, name: r.name, tier: r.tier, stat: r.stat, owned, level: lv,
               max: CFG.RELIC.maxLevel, cost: owned ? relicUpCost(r.id) : null,
               curPct: owned ? +(t.bonus * mul * 100).toFixed(1) : 0,
               maxed: owned && lv >= CFG.RELIC.maxLevel };
    });
  }

  function relicBonus() {
    const out = { atk: 0, hp: 0, def: 0, spd: 0 };
    (S.relics || []).forEach((id) => {
      const r = CFG.RELICS.find((x) => x.id === id);
      if (!r) return;
      const t = CFG.RELIC_BY_KEY[r.tier];
      if (!t) return;
      const lv = relicLevel(id) || 1;
      const mul = 1 + CFG.RELIC.perLevel * (lv - 1);      // 5 級 → ×2.2
      const maxed = lv >= CFG.RELIC.maxLevel;
      let b = t.bonus * mul;
      if (r.stat === 'all') {
        const all = b + (maxed ? CFG.RELIC.maxAllBonus : 0);
        out.atk += all; out.hp += all; out.def += all; out.spd += all;
      } else {
        out[r.stat] = (out[r.stat] || 0) + b;
        if (maxed) { out.atk += CFG.RELIC.maxAllBonus; out.hp += CFG.RELIC.maxAllBonus;
                     out.def += CFG.RELIC.maxAllBonus; out.spd += CFG.RELIC.maxAllBonus; }
      }
    });
    return out;
  }
  function relicMilestoneInfo() {
    const every = CFG.RELIC.every;
    const n = S.ticketPulls || 0;
    return { total: n, need: every, have: n % every, nextIn: every - (n % every),
             owned: relicCount(), all: CFG.RELICS.length,
             progress: relicProgress(), weights: relicTierWeights() };
  }

  /* ---------- 元素組合羈絆（例：風＋火 → 燎原 SPD +12%）---------- */
  function combosInfo() {
    const counts = bondInfo().counts;
    const active = CFG.COMBOS.filter((c) => counts[c.pair[0]] > 0 && counts[c.pair[1]] > 0);
    const stat = { atk: 1, hp: 1, def: 1, spd: 1, hunt: 1, core: 0 };
    active.forEach((c) => {
      if (c.stat === 'core') stat.core += c.bonus;
      else stat[c.stat] *= (1 + c.bonus);
    });
    return { active, stat };
  }

  /* ---------- 深林層數（同一隻靈獸連續狩獵）---------- */
  function depthOf(beastId) { return (S.depth && S.depth[beastId]) | 0; }
  function depthInfo(beastId) {
    const d = depthOf(beastId);
    const coreMul = 1 + Math.floor(d / CFG.DEPTH.coreEvery);
    const bonusRing = d > 0 && d % CFG.DEPTH.bonusRingEvery === 0;
    return { depth: d, coreMul, bonusRing, next: CFG.DEPTH.bonusRingEvery - (d % CFG.DEPTH.bonusRingEvery) };
  }
  function depthPlus(beastId) {
    if (!S.depth) S.depth = {};
    S.depth[beastId] = depthOf(beastId) + 1;
    return S.depth[beastId];
  }

  /* ---------- 傳承（把星級轉給另一隻武魂）---------- */
  function inheritInfo(fromId, toId) {
    const from = S.souls.find((x) => x.id === fromId);
    const to = S.souls.find((x) => x.id === toId);
    if (!from || !to) return { ok: false, reason: 'missing' };
    if (fromId === toId) return { ok: false, reason: 'same' };
    const fromStar = from.star || 3;
    const toStar = to.star || 3;
    if (fromStar <= CFG.INHERIT.minStar) return { ok: false, reason: 'source' };
    if (toStar >= CFG.INHERIT.starCap) return { ok: false, reason: 'capped' };
    const cost = CFG.INHERIT.costPerStar * toStar;
    return { ok: true, fromStar, toStar, cost, can: S.cores >= cost };
  }
  function inheritStar(fromId, toId) {
    const info = inheritInfo(fromId, toId);
    if (!info.ok) {
      const msg = info.reason === 'same' ? T('來源與目標不能相同')
        : info.reason === 'source' ? T(`來源需高於 ${CFG.INHERIT.minStar}★`)
        : info.reason === 'capped' ? T('目標已滿星') : T('沒有這個靈印');
      return { ok: false, msg };
    }
    if (S.cores < info.cost) return { ok: false, msg: T('獸核不足'), need: info.cost };
    S.cores -= info.cost;
    const from = S.souls.find((x) => x.id === fromId);
    const to = S.souls.find((x) => x.id === toId);
    S.stats.inherits = (S.stats.inherits | 0) + 1;
    from.star = (from.star || 3) - 1;
    to.star = (to.star || 3) + 1;
    return { ok: true, fromStar: from.star, toStar: to.star, cost: info.cost };
  }

  /* ---------- 覺醒階（滿級靈印 + 獸核）---------- */
  function ascendInfo(soulId) {
    const soul = S.souls.find((x) => x.id === soulId);
    if (!soul) return null;
    const stage = soul.ascend || 0;
    const maxed = stage >= CFG.ASCEND.maxStage;
    const cost = maxed ? 0 : (CFG.ASCEND.cost[stage] || 0);
    const needLevel = CFG.levelCap();
    const levelOk = (soul.level || 1) >= needLevel;
    return { stage, max: CFG.ASCEND.maxStage, cost, cores: S.cores, needLevel, levelOk, maxed,
             can: !maxed && levelOk && S.cores >= cost };
  }
  function ascendSoul(soulId) {
    const info = ascendInfo(soulId);
    if (!info) return { ok: false, msg: T('沒有這個靈印') };
    if (info.maxed) return { ok: false, msg: T('已達最高覺醒階') };
    if (!info.levelOk) return { ok: false, msg: T(`需要滿級 ${info.needLevel}`), need: info.needLevel };
    if (S.cores < info.cost) return { ok: false, msg: T('獸核不足'), need: info.cost };
    S.cores -= info.cost;
    const soul = S.souls.find((x) => x.id === soulId);
    soul.ascend = info.stage + 1;
    return { ok: true, stage: soul.ascend, cost: info.cost };
  }
  function addCores(n, opts) {
    let add = (n | 0);
    if (!(opts && opts.raw) && add > 0) add = Math.max(1, Math.round(add * (1 + talentMul().cores)));
    S.cores = Math.max(0, (S.cores | 0) + add);
    return S.cores;
  }

  /* ---------- 精英靈獸（每日每隻一次）---------- */
  function eliteReset() {
    const k = todayKey();
    if (S.elite.day !== k) S.elite = { day: k, ids: [] };
  }
  function eliteInfo(beastId) {
    eliteReset();
    return { used: S.elite.ids.indexOf(beastId) >= 0, hpMul: CFG.ELITE.hpMul, coreMul: CFG.ELITE.coreMul };
  }
  function eliteMarkUsed(beastId) {
    eliteReset();
    if (S.elite.ids.indexOf(beastId) < 0) S.elite.ids.push(beastId);
  }

  /* ---------- 五行剋制（以隊伍主元素判斷）---------- */
  function huntCounter(beastId) {
    const beast = CFG.BEAST_BY_ID[beastId];
    if (!beast) return { mult: 1, kind: 'neutral' };
    const counts = bondInfo().counts;
    const main = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!main) return { mult: 1, kind: 'neutral', element: null };
    if (CFG.COUNTER[main] === beast.element) return { mult: 1.25, kind: 'strong', element: main };
    if (CFG.COUNTER[beast.element] === main) return { mult: 0.9, kind: 'weak', element: main };
    return { mult: 1, kind: 'neutral', element: main };
  }

  /* ---------- 圖鑑 ---------- */
  function codexMark(kind, id) {
    if (!id || !S.codex || !S.codex[kind]) return false;
    if (S.codex[kind][id]) return false;
    S.codex[kind][id] = 1;
    return true;
  }
  /* 用「目前持有」把圖鑑補齊（新檔的起始武魂、舊檔沒 codex 欄位都靠這支） */
  function codexSync() {
    (S.souls || []).forEach((x) => { if (x && x.id) codexMark('souls', x.id); });
    (S.bones || []).forEach((x) => { if (x && x.id) codexMark('bones', x.id); });
    (S.ringBag || []).forEach((x) => { if (x && x.tier) codexMark('rings', x.tier); });
    Object.keys(S.cd || {}).forEach((id) => { codexMark('beasts', id); });
  }

  function codexInfo() {
    const groups = [
      { key: 'souls',  label: '武魂',  items: CFG.SOULS.map((x) => ({ id: x.id, name: x.name, emoji: x.emoji })) },
      { key: 'bones',  label: '靈骨',  items: CFG.BONES.map((x) => ({ id: x.id, name: x.name, emoji: '🦴' })) },
      { key: 'rings',  label: '靈環',  items: (CFG.RING_TIERS || []).map((x) => ({ id: x.key, name: x.name, emoji: '💠' })) },
      { key: 'beasts', label: '靈獸',  items: CFG.BEASTS.map((x) => ({ id: x.id, name: x.name, emoji: x.emoji })) },
    ];
    let total = 0, owned = 0;
    const out = groups.map((g) => {
      const items = g.items.map((it) => ({ ...it, owned: !!S.codex[g.key][it.id] }));
      const got = items.filter((x) => x.owned).length;
      total += items.length; owned += got;
      return { key: g.key, label: g.label, items, got, all: items.length };
    });
    return { groups: out, owned, total, bonus: CFG.CODEX.bonusPer * owned };
  }
  function codexMul() { return 1 + CFG.CODEX.bonusPer * codexInfo().owned; }

  /* ---------- 衍生數值 ---------- */
  function ringBonus(soul) {
    let atk = 0, hp = 0;
    for (const uid of soul.rings) {
      const r = S.ringBag.find((x) => x.uid === uid);
      if (!r) continue;
      const t = CFG.TIER_BY_KEY[r.tier];
      if (!t) continue;
      atk += t.atk; hp += t.hp;
    }
    return { atk, hp };
  }

  /* ---------- 靈骨 ---------- */
  function boneOf(soul) {
    if (!soul || !soul.bone) return null;
    const item = S.bones.find((b) => b.uid === soul.bone);
    return item ? CFG.BONE_BY_ID[item.id] : null;
  }
  function freeBones() { return S.bones.filter((b) => !S.souls.some((s) => s.bone === b.uid)); }
  function equippedBones() { return S.souls.filter((s) => s.bone).length; }

  /* 光環：同隊其他靈印的靈骨，按 BONE_AURA 比例加成（裝備者自己吃 100%） */
  function teamAura(excludeSoulId) {
    const acc = { atk: 0, hp: 0, def: 0, spd: 0 };
    for (const soul of teamSouls()) {
      if (soul.id === excludeSoulId) continue;
      const b = boneOf(soul);
      if (!b) continue;
      acc.atk += b.atk * CFG.BONE_AURA;
      acc.hp += b.hp * CFG.BONE_AURA;
      acc.def += b.def * CFG.BONE_AURA;
      acc.spd += b.spd * CFG.BONE_AURA;
    }
    return acc;
  }

  function soulStats(soul) {
    const base = CFG.SOUL_BY_ID[soul.id] || CFG.SOULS[0];
    /* 3★→1.0、5★→1.7（每星 +35%）；
       6★ 之後每星 +18%：10★ = 1.7 × (1+0.18×5) ≈ 3.23，
       避免「星級上限拉高」直接變成戰力爆炸。 */
    const starN = soul.star || 3;
    const starMul = (1 + 0.35 * (Math.min(starN, 5) - 3)) * (1 + 0.18 * Math.max(0, starN - 5));
    const lvMul = 1 + 0.10 * ((soul.level || 1) - 1);
    const rb = ringBonus(soul);
    const own = boneOf(soul) || { atk: 0, hp: 0, def: 0, spd: 0 };
    const aura = teamAura(soul.id);
    const pm = CFG.REBIRTH.perMark;
    const el = (base && base.element) || null;
    const bond = bondInfo();
    const bondMul = (bond.strong.indexOf(el) >= 0 ? 1 + bond.sameBonus : 1)
                  * (bond.tri ? 1 + bond.triBonus : 1);
    const ascMul = 1 + CFG.ASCEND.bonusPerStage * (soul.ascend || 0);
    const cb = combosInfo().stat;   // 元素組合：atk / hp / def / spd 各自乘算
    const rl = relicBonus();        // 靈寶：限量收藏品，永久加成
    const st = setMulFor(el);       // 套裝：同元素 3 隻
    const sg = sigilInfo();        // 印記：戰績／覺醒里程（無上限）
    const tbMul = (1 + trueBodyOf(soul).bonus) * achMul() * codexMul() * bondMul * ascMul * spireMul() * sg.mul;   // 真身 × 成就 × 圖鑑 × 羈絆 × 覺醒 × 印記
    /* 三種加成各自乘算，不能全部倒進同一個括號：
       靈環後期 +3600%，若命印（+6%/點）與靈骨（+14~20%）也加在同一個括號裡，
       25 點命印只讓戰力多 5%，玩家會覺得「轉生沒用、戰力卡死」。
       靈環（加法）→ 靈骨（乘）→ 命印（乘）→ 真身（乘） */
    const boneAtk = 1 + own.atk + aura.atk;
    const boneHp = 1 + own.hp + aura.hp;
    const boneDef = 1 + own.def + aura.def;
    const boneSpd = 1 + own.spd + aura.spd;
    /* v1.18.0：投入天賦的命印不再給「每點 +6% 全屬性」，只有未投入的才給；
       天賦改走自己的乘算層（攻擊/生命/防禦/速度）→ 產生「集中 or 平均」的選擇。 */
    const tm = talentMul();
    const um = unspentMarks();
    const markAtk = (1 + pm.atk * um) * tm.atk;
    const markHp = (1 + pm.hp * um) * tm.hp;
    const markDef = (1 + pm.def * um) * tm.def;
    const markSpd = tm.spd;   // 疾行天賦才加速度
    return {
      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk) * boneAtk * markAtk * tbMul * cb.atk * (1 + rl.atk) * st.atk),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp) * boneHp * markHp * tbMul * cb.hp * (1 + rl.hp) * st.hp),
      def: Math.round(base.def * starMul * lvMul * boneDef * markDef * tbMul * cb.def * (1 + rl.def) * st.def),
      spd: Math.round(base.spd * boneSpd * markSpd * tbMul * cb.spd * (1 + rl.spd) * st.spd),
      role: base.role,
      name: base.name,
      emoji: base.emoji,
    };
  }

  function teamSouls() {
    return S.team.map((id) => S.souls.find((s) => s.id === id)).filter(Boolean);
  }
  function teamStats() {
    const list = teamSouls().map(soulStats);
    return {
      atk: list.reduce((a, x) => a + x.atk, 0),
      hp: list.reduce((a, x) => a + x.hp, 0),
      def: list.reduce((a, x) => a + x.def, 0),
      spd: list.length ? Math.round(list.reduce((a, x) => a + x.spd, 0) / list.length) : 0,
      list,
    };
  }
  /* 爆擊率：基礎 10% + 命印每點 0.15%（上限 +40%） */
  function critChance() {
    // 命印 + 靈環詞條（crit）都在這裡疊加，上限 60%
    const c = CFG.COMBAT.critBase
      + Math.min(CFG.REBIRTH.critMax, unspentMarks() * CFG.REBIRTH.critPerMark)
      + (talentMul().crit || 0)
      + (affixTotals().crit || 0);
    return Math.min(0.6, c);
  }

  function power() {
    const t = teamStats();
    return Math.round(t.atk * 2.2 + t.hp * 0.35 + t.def * 2.5 + t.spd * 0.6);
  }

  /* ---------- 靈環合成：3 個同階 → 1 個高一階 ---------- */
  function mergeInfo() {
    const free = freeRings();
    const out = {};
    CFG.RING_ORDER.forEach((tier) => {
      const n = free.filter((r) => r.tier === tier).length;
      out[tier] = { count: n, can: tiersMergeable(tier) && n >= CFG.RING_MERGE_COUNT };
    });
    return out;
  }
  function tiersMergeable(tier) {
    const i = CFG.RING_ORDER.indexOf(tier);
    return i >= 0 && i < CFG.RING_ORDER.length - 1;
  }
  /* 合成一次（指定階）；回傳新靈環 */
  function mergeRings(tier) {
    if (!tiersMergeable(tier)) return { ok: false, msg: T('紅靈環已是最高階') };
    const pool = freeRings().filter((r) => r.tier === tier);
    if (pool.length < CFG.RING_MERGE_COUNT) {
      return { ok: false, msg: T(`需要 ${CFG.RING_MERGE_COUNT} 個同階靈環（目前 ${pool.length}）`) };
    }
    const take = pool.slice(0, CFG.RING_MERGE_COUNT);
    const counts = {};
    take.forEach((r) => { const el = r.element || 'wind'; counts[el] = (counts[el] || 0) + 1; });
    const element = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const uids = new Set(take.map((r) => r.uid));
    S.ringBag = S.ringBag.filter((r) => !uids.has(r.uid));
    const nextTier = CFG.RING_ORDER[CFG.RING_ORDER.indexOf(tier) + 1];
    const ring = newRing(nextTier, element);
    S.ringBag.push(ring);
    codexMark('rings', nextTier);
    dailyAdd('merge', 1);
    weeklyAdd('merges', 1);
    return { ok: true, ring, nextTier, element };
  }
  /* 一鍵合成：由低到高，合到不能再合 */
  function mergeAll() {
    let made = 0;
    const gained = [];
    for (const tier of CFG.RING_ORDER) {
      if (!tiersMergeable(tier)) continue;
      let guard = 0;
      while (freeRings().filter((r) => r.tier === tier).length >= CFG.RING_MERGE_COUNT && guard < 500) {
        const r = mergeRings(tier);
        if (!r.ok) break;
        made++;
        gained.push(r.nextTier);
        guard++;
      }
    }
    return { ok: made > 0, made, gained, bag: S.ringBag.length, free: freeRings().length };
  }

  /* 自動合成：只合十年/百年（保護千年以上，讓玩家自己決定要不要衝真身） */
  function mergeLowTiers() {
    if ((S.settings || {}).autoMerge === false) return { made: 0 };
    let made = 0;
    for (const tier of ['white', 'yellow']) {
      let guard = 0;
      while (freeRings().filter((r) => r.tier === tier).length >= CFG.RING_MERGE_COUNT && guard < 100) {
        const r = mergeRings(tier);
        if (!r.ok) break;
        made++; guard++;
      }
    }
    return { made };
  }

  /* ---------- 靈印真身（3/6/9 個萬年以上靈環）---------- */
  function trueBodyOf(soul) {
    const high = (soul.rings || []).filter((uid) => {
      const r = S.ringBag.find((x) => x.uid === uid);
      return r && (r.tier === 'black' || r.tier === 'red');
    }).length;
    let bonus = 0;
    for (const step of CFG.TRUE_BODY) if (high >= step.need) bonus = step.mult;
    return { high, bonus };
  }

  /* ---------- 屬性共鳴（3 個同系靈環）---------- */
  function resonanceOf(soul) {
    const counts = {};
    (soul.rings || []).forEach((uid) => {
      const r = S.ringBag.find((x) => x.uid === uid);
      if (!r) return;
      counts[r.element || 'wind'] = (counts[r.element || 'wind'] || 0) + 1;
    });
    let best = null;
    for (const [el, n] of Object.entries(counts)) {
      if (n >= CFG.RESONANCE.need && (!best || n > best.count)) best = { element: el, count: n };
    }
    return best;
  }

  /* 該靈印最強的靈環技能（千年以上才有） */
  function ringSkillOf(soul) {
    let best = null;
    (soul.rings || []).forEach((uid) => {
      const r = S.ringBag.find((x) => x.uid === uid);
      if (!r) return;
      const sk = CFG.RING_SKILL[r.tier];
      if (!sk) return;
      if (!best || sk.mult > best.mult) best = { ...sk, tier: r.tier, element: r.element || 'wind' };
    });
    return best;
  }

  function hasFreeRingSlot() {
    return teamSouls().some((soul) => ringSlotsOf(soul) > 0 && soul.rings.length < ringSlotsOf(soul));
  }

  /* 命印帶來的收益倍率（靈幣/經驗） */
  function incomeMul() { return (1 + CFG.REBIRTH.perMark.income * S.marks) * (1 + talentMul().coin); }

  function totalRingsEquipped() {
    let n = 0;
    for (const s of S.souls) n += (s.rings || []).length;
    return n;
  }
  function levelCap() { return CFG.levelCap(totalRingsEquipped()); }
  function atCap() { return S.level >= levelCap(); }

  /* ---------- 成長 ---------- */
  function addExp(s, amount, opts) {
    const cap = CFG.levelCap(s.souls.reduce((a, x) => a + (x.rings || []).length, 0));
    const before = s.level;
    if (s.level >= cap) return { levelUps: 0, capped: true };
    s.exp += amount;
    let ups = 0;
    while (s.level < cap) {
      const need = CFG.expNeed(s.level);
      if (s.exp < need) break;
      s.exp -= need;
      s.level++;
      ups++;
      // 靈印等級跟玩家等級同步成長（上限 90）
      for (const soul of s.souls) soul.level = Math.min(90, Math.max(soul.level || 1, Math.min(s.level, 90)));
    }
    return { levelUps: ups, capped: s.level >= cap, before, after: s.level };
  }

  function addCoins(n) { S.coins += n; }
  function spendCoins(n) {
    if (S.coins < n) return false;
    S.coins -= n; return true;
  }
  function addDiamonds(n) { S.diamonds += n; }
  function spendDiamonds(n) {
    if (S.diamonds < n) return false;
    S.diamonds -= n; return true;
  }

  /* ---------- 靈環 ---------- */
  let uidSeq = 0;
  function newRing(tierKey, element) {
    const t = CFG.TIER_BY_KEY[tierKey];
    codexMark('rings', tierKey);
    uidSeq++;
    return {
      uid: 'r' + Date.now().toString(36) + '_' + uidSeq,
      tier: tierKey, name: t ? t.name : T('靈環'),
      element: element || 'wind',
      equipped: null,
      affix: rollAffix(),     // 15% 機率帶詞條（爆擊／吸血／破防／迅捷）
    };
  }
  function ringSlotsOf(soul) {
    return CFG.ringSlots(S.level);   // 每 10 級 1 槽，最多 9
  }
  /* 自動裝備：找第一個還有空槽的上陣靈印 */
  function autoEquipBestRing() {
    if ((S.settings || {}).autoRing === false) return null;
    if (!freeRings().length) return null;
    for (const soul of teamSouls()) {
      if (ringSlotsOf(soul) === 0) continue;
      if (soul.rings.length >= ringSlotsOf(soul)) continue;
      const best = freeRings().slice().sort((a, b) => {
        const ta = (CFG.TIER_BY_KEY[a.tier] || {}).mult || 0;
        const tb = (CFG.TIER_BY_KEY[b.tier] || {}).mult || 0;
        return tb - ta;
      })[0];
      const r = equipRing(soul.id, best.uid);
      if (r.ok) return { soul, ring: best };
    }
    return null;
  }

  function equipRing(soulId, uid) {
    const soul = S.souls.find((s) => s.id === soulId);
    const item = S.ringBag.find((r) => r.uid === uid);
    if (!soul || !item) return { ok: false, msg: T('找不到靈環') };
    if (item.equipped) return { ok: false, msg: T('這枚靈環已經裝在別人身上') };
    if (soul.rings.length >= ringSlotsOf(soul)) return { ok: false, msg: T(`靈環槽已滿（每 10 級才開一格，目前 ${ringSlotsOf(soul)} 格）`) };
    soul.rings.push(uid);
    item.equipped = soulId;
    return { ok: true };
  }

  /* 沒裝備的靈環（背包） */
  function freeRings() { return S.ringBag.filter((r) => !r.equipped); }
  function unequipRing(soulId, uid) {
    const soul = S.souls.find((s) => s.id === soulId);
    if (!soul) return { ok: false };
    const i = soul.rings.indexOf(uid);
    if (i < 0) return { ok: false };
    soul.rings.splice(i, 1);
    const item = S.ringBag.find((r) => r.uid === uid);
    if (item) item.equipped = null;
    return { ok: true };
  }

  function equipBone(soulId, uid) {
    const soul = S.souls.find((s) => s.id === soulId);
    const item = S.bones.find((b) => b.uid === uid);
    if (!soul || !item) return { ok: false, msg: T('找不到靈骨') };
    if (S.souls.some((s) => s.bone === uid)) return { ok: false, msg: T('這塊靈骨已裝備') };
    soul.bone = uid;
    return { ok: true };
  }
  function unequipBone(soulId) {
    const soul = S.souls.find((s) => s.id === soulId);
    if (!soul || !soul.bone) return { ok: false };
    soul.bone = null;
    return { ok: true };
  }

  /* 升星：消耗未裝備靈骨（star-2 塊）＋靈幣，上限 5★ */
  function starUpInfo(soul) {
    const star = soul.star || 3;
    return {
      maxed: star >= CFG.STAR_MAX,
      star,
      bones: CFG.starUpBones(star),
      coins: CFG.starUpCoin(star),
      available: freeBones().length,
      canAfford: star < CFG.STAR_MAX && freeBones().length >= CFG.starUpBones(star) && S.coins >= CFG.starUpCoin(star),
    };
  }
  function starUp(soulId) {
    const soul = S.souls.find((s) => s.id === soulId);
    if (!soul) return { ok: false, msg: T('找不到靈印') };
    const info = starUpInfo(soul);
    if (info.maxed) return { ok: false, msg: T('已達最高星級') };
    if (freeBones().length < info.bones) return { ok: false, msg: T(`需要 ${info.bones} 塊未裝備靈骨（目前 ${info.available}）`) };
    if (S.coins < info.coins) return { ok: false, msg: T(`靈幣不足（需 ${info.coins}）`) };
    // 吃掉最舊的未裝備靈骨
    const eat = freeBones().slice(0, info.bones).map((b) => b.uid);
    S.bones = S.bones.filter((b) => !eat.includes(b.uid));
    S.coins -= info.coins;
    soul.star = Math.min(CFG.STAR_MAX, soul.star + 1);
    return { ok: true, star: soul.star, eaten: eat.length };
  }

  /* ---------- 陣容 ---------- */
  const SLOT_COST = [0, 800, 5000, 26000, 120000];   // 第 2~5 位
  const SLOT_LEVEL = [0, 5, 15, 30, 50];
  function slotNextCost() { return SLOT_COST[S.slots] || 0; }
  function slotNextLevel() { return SLOT_LEVEL[S.slots] || 0; }
  function canExpand() {
    return S.slots < 5 && S.level >= slotNextLevel() && S.coins >= slotNextCost() && S.souls.length > S.slots;
  }
  function expandSlot() {
    if (S.slots >= 5) return { ok: false, msg: T('已是五人小隊') };
    if (S.level < slotNextLevel()) return { ok: false, msg: T(`需等級 ${slotNextLevel()}`) };
    if (S.souls.length <= S.slots) return { ok: false, msg: T('沒有可上陣的新靈印，先去覺醒抽卡') };
    if (!spendCoins(slotNextCost())) return { ok: false, msg: T('靈幣不足') };
    S.slots++;
    const next = S.souls.find((s) => !S.team.includes(s.id));
    if (next) S.team.push(next.id);
    return { ok: true, slots: S.slots };
  }
  function toggleTeam(soulId) {
    const inTeam = S.team.includes(soulId);
    if (inTeam) {
      if (S.team.length <= 1) return { ok: false, msg: T('至少要上陣一位靈印') };
      S.team = S.team.filter((id) => id !== soulId);
      return { ok: true, in: false };
    }
    if (S.team.length >= S.slots) return { ok: false, msg: T('陣容已滿，先擴充名額') };
    S.team.push(soulId);
    return { ok: true, in: true };
  }

  /* ---------- 成就（永久加成）---------- */
  function achList() {
    if (!S.ach) S.ach = { unlocked: {} };
    if (!S.ach.unlocked) S.ach.unlocked = {};
    return CFG.ACHIEVEMENTS.map((a) => ({
      id: a.id, name: a.name, desc: a.desc,
      unlocked: !!S.ach.unlocked[a.id],
      done: !!a.test(S),
    }));
  }
  function checkAchievements() {
    if (!S.ach) S.ach = { unlocked: {} };
    if (!S.ach.unlocked) S.ach.unlocked = {};
    const fresh = [];
    CFG.ACHIEVEMENTS.forEach((a) => {
      if (!S.ach.unlocked[a.id] && a.test(S)) {
        S.ach.unlocked[a.id] = true;
        fresh.push({ id: a.id, name: a.name, desc: a.desc });
      }
    });
    return fresh;
  }
  function achCount() {
    return (S.ach && S.ach.unlocked) ? Object.keys(S.ach.unlocked).length : 0;
  }
  function achMul() {
    return 1 + CFG.ACH_BONUS * achCount();
  }

  /* ---------- 每日任務 ---------- */
  function todayKey(now) {
    const d = now ? new Date(now) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dailyReset() {
    const key = todayKey();
    if (!S.daily || S.daily.day !== key) {
      S.daily = { day: key, idle: 0, hunt: 0, merge: 0, claimed: [] };
      return true;
    }
    return false;
  }
  function dailyInfo() {
    dailyReset();
    return CFG.DAILY.map((t) => {
      const done = Math.min(t.need, S.daily[t.id] || 0);
      const claimed = (S.daily.claimed || []).indexOf(t.id) >= 0;
      return { id: t.id, label: t.label, need: t.need, unit: t.unit,
               done, reward: t.reward, claimed, can: done >= t.need && !claimed };
    });
  }
  function dailyAdd(kind, amount) {
    dailyReset();
    if (!(kind in S.daily)) return;
    S.daily[kind] = Math.min(9999, (S.daily[kind] || 0) + amount);
  }
  function dailyClaim(id) {
    const info = dailyInfo().find((x) => x.id === id);
    if (!info) return { ok: false, msg: T('沒有這個任務') };
    if (info.claimed) return { ok: false, msg: T('今天已領過') };
    if (!info.can) return { ok: false, msg: T('任務還沒完成') };
    S.daily.claimed.push(id);
    S.diamonds += info.reward.diamonds || 0;
    return { ok: true, reward: info.reward };
  }

  /* ---------- 靈印獨立等級（靈幣升級，可超越玩家等級 N 級）---------- */
  function soulLevelCap() {
    return Math.min(CFG.SOUL_LV.max, (S.level || 1) + CFG.SOUL_LV.maxAhead);
  }
  function soulLevelInfo(soulId) {
    const soul = S.souls.find((x) => x.id === soulId);
    if (!soul) return null;
    const lv = soul.level || 1;
    const cap = soulLevelCap();
    const cost = CFG.soulLevelCost(lv);
    return { level: lv, cap, cost, can: lv < cap && S.coins >= cost, maxed: lv >= cap };
  }
  function soulLevelUp(soulId) {
    const info = soulLevelInfo(soulId);
    if (!info) return { ok: false, msg: T('沒有這個靈印') };
    if (info.maxed) return { ok: false, msg: T('已達等級上限（玩家等級 +20）') };
    if (S.coins < info.cost) return { ok: false, msg: T('靈幣不足'), need: info.cost };
    S.coins -= info.cost;
    const soul = S.souls.find((x) => x.id === soulId);
    soul.level = (soul.level || 1) + 1;
    return { ok: true, level: soul.level, cost: info.cost };
  }

  /* ---------- 靈幣抽靈骨 ---------- */
  function coinBonePull(times) {
    const n = Math.max(1, times | 0 || 1);
    let paid = 0;
    const got = [];
    for (let i = 0; i < n; i++) {
      const cost = CFG.coinPullCost(S.bonePulls || 0);
      if (S.coins < cost) {
        if (!got.length) return { ok: false, msg: T('靈幣不足'), cost, need: cost };
        break;
      }
      S.coins -= cost;
      paid += cost;
      S.bonePulls = (S.bonePulls || 0) + 1;
      const w = CFG.COIN_PULL.weights;
      const total = Object.keys(w).reduce((a, k) => a + w[k], 0);
      let roll = Math.random() * total, picked = 'wind';
      for (const k of Object.keys(w)) { roll -= w[k]; if (roll <= 0) { picked = k; break; } }
      const b = CFG.BONE_BY_ID[picked];
      const uid = 'bo' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
      S.bones.push({ uid, id: b.id });
      codexMark('bones', b.id);
      got.push({ id: b.id, name: b.name, desc: b.desc, uid });
    }
    return { ok: got.length > 0, got, paid, nextCost: CFG.coinPullCost(S.bonePulls || 0) };
  }

  /* ---------- 抽卡 ---------- */
  function pullOnce(useTickets) {
    const cost = useTickets ? CFG.PULL_COST_TICKET : CFG.PULL_COST_DIAMOND;
    if (useTickets) { if (S.tickets < cost) return { ok: false, msg: T('覺醒券不足') }; S.tickets -= cost; }
    else { if (!spendDiamonds(cost)) return { ok: false, msg: T('鑽石不足') }; }
    const result = rollOne();
    /* 里程計「所有覺醒抽」（券或鑽都算）：
       原本只算券，結果玩家用鑽石抽 50 次進度還是 0 —— 體感上就是「抽不到」。 */
    S.ticketPulls = (S.ticketPulls || 0) + 1;
    const milestone = relicMilestone();   // 每 10 次覺醒抽一件靈寶
    return { ok: true, result, milestone };
  }
  /* 新手免費十連：只能領一次，不扣券也不扣鑽。
     目的：讓新玩家在前 3 分鐘就體驗到靈骨/升星，而不是 25 分鐘後才碰到覺醒。 */
  function pullTenFree() {
    if (S.freeTenUsed) return { ok: false, msg: T('免費十連已使用'), results: [] };
    S.freeTenUsed = true;
    const results = [];
    const milestones = [];
    for (let i = 0; i < 10; i++) {
      results.push(rollOne());
      S.ticketPulls = (S.ticketPulls || 0) + 1;   // 免費十連也算覺醒里程
      const m = relicMilestone();
      if (m) milestones.push(m);
    }
    S.stats.pulls += results.length;
    return { ok: true, results, milestones };
  }

  function rollOne() {
    // 15% 出靈骨，其餘出靈印
    if (Math.random() < 0.15 && CFG.PULL_BONES.length) {
      const b = CFG.BONES[Math.floor(Math.random() * CFG.BONES.length)];
      const uid = 'bo' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
      S.bones.push({ uid, id: b.id });
      codexMark('bones', b.id);
      return { kind: 'bone', id: b.id, name: b.name, desc: b.desc, uid };
    }
    const pool = CFG.PULL_POOL;
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let roll = Math.random() * total, picked = pool[0];
    for (const p of pool) { roll -= p.weight; if (roll <= 0) { picked = p; break; } }
    const existing = S.souls.find((s) => s.id === picked.id);
    if (existing) {
      codexMark('souls', picked.id);
      if (existing.star < 5) { existing.star++; return { kind: 'star', id: picked.id, name: CFG.SOUL_BY_ID[picked.id].name, star: existing.star }; }
      S.diamonds += 200;
      return { kind: 'dup', id: picked.id, name: CFG.SOUL_BY_ID[picked.id].name, diamonds: 200 };
    }
    codexMark('souls', picked.id);
    S.souls.push({ id: picked.id, star: picked.star, level: S.level, rings: [] });
    return { kind: 'new', id: picked.id, name: CFG.SOUL_BY_ID[picked.id].name, star: picked.star };
  }

  /* ---------- 轉生 ---------- */
  function rebirthInfo() {
    const lastBest = S.lastRebirthBest || 0;
    const deep = Math.max(0, (S.bestStage || 0) - lastBest);
    const gain = CFG.rebirthGain(S.bestStage, S.level, lastBest);
    return {
      gain,
      deep,
      lastBest,
      needStage: Math.max(CFG.REBIRTH.minStage, lastBest + 1),
      can: gain > 0 && S.bestStage > lastBest,
      marks: S.marks,
      rebirths: S.rebirths,
      bestStage: S.bestStage,
      minStage: CFG.REBIRTH.minStage,
      bonusText: T(`全屬性 +${Math.round(CFG.REBIRTH.perMark.atk * 100 * S.marks)}% · 收益 +${Math.round(CFG.REBIRTH.perMark.income * 100 * S.marks)}%`),
    };
  }

  /* 轉生：保留靈印/星級/靈骨/命印/簽到，重置本輪進度 */
  function doRebirth() {
    const info = rebirthInfo();
    if (!info.can) return { ok: false, msg: T(`歷史最高關卡需達 ${CFG.REBIRTH.minStage} 關`) };
    S.marks += info.gain;
    S.rebirths += 1;
    S.lastRebirthBest = S.bestStage;   // 本輪紀錄歸零，下次要再推更深
    // 每次轉生後起始等級提高，重跑不必一直從 1 級爬
    const startLv = Math.min(CFG.REBIRTH.startLevelMax || 1,
                             1 + (CFG.REBIRTH.startLevelPerRebirth || 0) * S.rebirths);
    S.level = startLv;
    S.exp = 0;
    S.stage = 1;
    S.kills = 0;
    S.coins = 0;
    // 靈環保留（那是打來的資產；重置掉會讓玩家重複勞動，戰力也會瞬間掉兩個量級）
    S.souls.forEach((soul) => { soul.level = startLv; });
    S.cd = {};
    S.lastSave = Date.now();
    save(true);
    return { ok: true, gain: info.gain, marks: S.marks, rebirths: S.rebirths };
  }

  /* ---------- 每日簽到 ---------- */
  function dayKey(d) {
    const x = d || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function prevDayKey(d) {
    const x = new Date((d || new Date()).getTime());
    x.setDate(x.getDate() - 1);
    return dayKey(x);
  }
  function checkinInfo(now) {
    const c = S.checkin;
    const today = dayKey(now);
    const canCheck = c.lastDay !== today;
    const continuous = c.lastDay === prevDayKey(now);
    const nextTotal = c.total + 1;
    const dayIndex = ((nextTotal - 1) % CFG.CHECKIN.length) + 1;
    return {
      canCheck,
      today,
      streak: canCheck ? (continuous ? c.streak + 1 : 1) : c.streak,
      total: c.total,
      dayIndex: canCheck ? dayIndex : (((c.total - 1) % CFG.CHECKIN.length) + 1),
      reward: CFG.CHECKIN[dayIndex - 1],
      continuous,
    };
  }
  function grantCheckinReward(r) {
    if (!r) return;
    if (r.kind === 'coins') S.coins += r.amount;
    else if (r.kind === 'diamonds') S.diamonds += r.amount;
    else if (r.kind === 'tickets') S.tickets += r.amount;
    else if (r.kind === 'ring') S.ringBag.push(newRing(r.tier));
    else if (r.kind === 'gift') {
      if (r.ring) S.ringBag.push(newRing(r.ring));
      if (r.tickets) S.tickets += r.tickets;
      if (r.diamonds) S.diamonds += r.diamonds;
    }
  }
  function checkIn(now) {
    const info = checkinInfo(now);
    if (!info.canCheck) return { ok: false, msg: T('今天已經簽過了，明天再來') };
    const c = S.checkin;
    c.streak = info.streak;
    c.total += 1;
    c.lastDay = dayKey(now);
    const idx = ((c.total - 1) % CFG.CHECKIN.length);
    const reward = CFG.CHECKIN[idx];
    grantCheckinReward(reward);
    return { ok: true, reward, dayIndex: idx + 1, streak: c.streak, total: c.total };
  }

  /* ---------- 兌換碼 ---------- */
  function redeem(code) {
    const key = String(code || '').trim().toUpperCase();
    if (!key) return { ok: false, msg: T('請輸入兌換碼') };
    if (S.codes.includes(key)) return { ok: false, msg: T('這個兌換碼已用過') };
    const c = CFG.CODES[key];
    if (!c) return { ok: false, msg: T('兌換碼無效') };
    S.codes.push(key);
    if (c.diamonds) S.diamonds += c.diamonds;
    if (c.tickets) S.tickets += c.tickets;
    if (c.coins) S.coins += c.coins;
    if (c.exp) addExp(S, c.exp);
    if (c.ring) S.ringBag.push(newRing(c.ring));
    return { ok: true, msg: c.msg };
  }

  /* ---------- 存檔碼 ---------- */
  function exportCode() {
    const json = JSON.stringify(S);
    return btoa(unescape(encodeURIComponent(json)));
  }
  function importCode(code) {
    try {
      const json = decodeURIComponent(escape(atob(String(code || '').trim())));
      const data = JSON.parse(json);
      if (!data || !Array.isArray(data.souls)) throw new Error(T('格式錯誤'));
      S = migrate(data);
      S.lastSave = Date.now();
      save(true);
      return { ok: true, save: S };
    } catch (e) {
      return { ok: false, msg: T('存檔碼無法解析') };
    }
  }

  global.State = {
    get data() { return S; },
    load, save, reset,
    addExp, addCoins, spendCoins, addDiamonds, spendDiamonds,
    soulStats, teamSouls, teamStats, power,
    claimOfflineDouble, weekKey, weeklyAdd, weeklyInfo, weeklyClaim, codexMark, codexSync, codexInfo, codexMul,
    bondInfo, combosInfo, depthOf, depthInfo, depthPlus, inheritInfo, inheritStar,
    relicProgress, relicTierWeights, hasRelic, relicCount, rollRelic, relicMilestone, relicBackfill, relicBonus, relicMilestoneInfo,
    setInfo, setMulFor, shopReset, shopInfo, shopBuy, autoStarUp,
    talentLevel, spentMarks, unspentMarks, talentMul, talentInfo, learnTalent, resetTalents, combatMods,
    relicLevel, relicUpCost, relicUpgrade, relicInfo, sigilInfo, talentMaxLevel,
    spireReset, spireInfo, spireUse, spireReport, spireStats, spireMul,
    dungeonReset, dungeonInfo, dungeonMark, dungeonReward, dungeonClaim,
    rollAffix, rerollAffix, affixTotals,
    ascendInfo, ascendSoul, addCores, eliteInfo, eliteMarkUsed, huntCounter,
    totalRingsEquipped, levelCap, atCap, incomeMul, rebirthInfo, doRebirth, migrate, coinBonePull, critChance, soulLevelUp, soulLevelInfo, soulLevelCap, dailyInfo, dailyAdd, dailyClaim, todayKey, achList, checkAchievements, achCount, achMul,
    trueBodyOf, resonanceOf, ringSkillOf, hasFreeRingSlot,
    mergeInfo, mergeRings, mergeAll, mergeLowTiers,
    newRing, ringSlotsOf, ringBonus, equipRing, unequipRing, autoEquipBestRing, freeRings,
    boneOf, freeBones, equippedBones, teamAura, equipBone, unequipBone,
    starUpInfo, starUp,
    slotNextCost, slotNextLevel, canExpand, expandSlot, toggleTeam,
    dayKey, checkinInfo, checkIn,
    pullOnce, rollOne, redeem, exportCode, importCode,
    offlineGain, OFFLINE_CAP_H, pullTenFree,
    saveStatus, restoreBackup,
  };
})(window);
