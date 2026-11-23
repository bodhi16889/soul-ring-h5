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
      id: 'haotian', star: CFG.SOUL_BY_ID.haotian.star, level: 1, rings: [], bone: null,
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
      pendingOffline: null,  // 這次回歸的離線收益（可看廣告加倍一次）
      daily: { day: '', idle: 0, hunt: 0, merge: 0, claimed: [] },   // 每日任務進度
      ach: { unlocked: {} },   // 成就（id -> true），每項永久 +0.5% 全屬性
      cd: {},                // 靈獸 id -> 下次可獵時間
      codes: [],
      checkin: { lastDay: '', streak: 0, total: 0 },   // 每日簽到
      rebirths: 0,           // 轉生次數
      marks: 0,              // 命印：永久加成（每點全屬性 +6%）
      settings: { autoBoss: true, autoHunt: true, autoRing: true, autoMerge: true },   // 放置用開關
      stats: { kills: 0, hunts: 0, pulls: 0 },
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
      return { fresh: true, corrupted: !!(main || bak), from };
    }
    if (d.v > SAVE_VERSION) {
      // 未來版本的存檔：不覆蓋、不強制遷移
      blocked = true;
      S = newSave();
      codexSync();
      return { newer: true, from };
    }

    S = migrate(d);
    codexSync();
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
    out.settings = Object.assign({ autoBoss: true, autoHunt: true, autoRing: true, autoMerge: true }, (d && d.settings) || {});
    out.slots = Math.max(1, Math.min(5, out.slots | 0 || 1));
    out.team = out.team.filter((id) => out.souls.some((s) => s.id === id)).slice(0, out.slots);
    out.souls.forEach((s) => {
      if (!Array.isArray(s.rings)) s.rings = [];
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
    const exp = Math.round(rate.exp * minutes * mul);
    s.coins += coins;
    addExp(s, exp, { silent: true });
    s.lastSave = now;
    s.pendingOffline = { minutes, coins, exp, doubled: false, at: now };
    return { minutes, capped: ms > capped, coins, exp, rate };
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
    S.diamonds += info.reward.diamonds || 0;
    return { ok: true, reward: info.reward };
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
    const starMul = 1 + 0.35 * (soul.star - 3);
    const lvMul = 1 + 0.10 * ((soul.level || 1) - 1);
    const rb = ringBonus(soul);
    const own = boneOf(soul) || { atk: 0, hp: 0, def: 0, spd: 0 };
    const aura = teamAura(soul.id);
    const pm = CFG.REBIRTH.perMark;
    const tbMul = (1 + trueBodyOf(soul).bonus) * achMul() * codexMul();   // 真身 × 成就 × 圖鑑，都乘算
    /* 三種加成各自乘算，不能全部倒進同一個括號：
       靈環後期 +3600%，若命印（+6%/點）與靈骨（+14~20%）也加在同一個括號裡，
       25 點命印只讓戰力多 5%，玩家會覺得「轉生沒用、戰力卡死」。
       靈環（加法）→ 靈骨（乘）→ 命印（乘）→ 真身（乘） */
    const boneAtk = 1 + own.atk + aura.atk;
    const boneHp = 1 + own.hp + aura.hp;
    const boneDef = 1 + own.def + aura.def;
    const boneSpd = 1 + own.spd + aura.spd;
    const markAtk = 1 + pm.atk * S.marks;
    const markHp = 1 + pm.hp * S.marks;
    const markDef = 1 + pm.def * S.marks;
    const markSpd = 1;   // 命印不再加速度（速度有物理上限），改在 critChance() 給爆擊
    return {
      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk) * boneAtk * markAtk * tbMul),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp) * boneHp * markHp * tbMul),
      def: Math.round(base.def * starMul * lvMul * boneDef * markDef * tbMul),
      spd: Math.round(base.spd * boneSpd * markSpd * tbMul),
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
    const c = CFG.COMBAT.critBase + Math.min(CFG.REBIRTH.critMax,
      (S.marks || 0) * CFG.REBIRTH.critPerMark);
    return Math.min(0.5, c);
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
  function incomeMul() { return 1 + CFG.REBIRTH.perMark.income * S.marks; }

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
      maxed: star >= 5,
      star,
      bones: CFG.starUpBones(star),
      coins: CFG.starUpCoin(star),
      available: freeBones().length,
      canAfford: star < 5 && freeBones().length >= CFG.starUpBones(star) && S.coins >= CFG.starUpCoin(star),
    };
  }
  function starUp(soulId) {
    const soul = S.souls.find((s) => s.id === soulId);
    if (!soul) return { ok: false, msg: T('找不到靈印') };
    const info = starUpInfo(soul);
    if (info.maxed) return { ok: false, msg: T('已是 5 星') };
    if (freeBones().length < info.bones) return { ok: false, msg: T(`需要 ${info.bones} 塊未裝備靈骨（目前 ${info.available}）`) };
    if (S.coins < info.coins) return { ok: false, msg: T(`靈幣不足（需 ${info.coins}）`) };
    // 吃掉最舊的未裝備靈骨
    const eat = freeBones().slice(0, info.bones).map((b) => b.uid);
    S.bones = S.bones.filter((b) => !eat.includes(b.uid));
    S.coins -= info.coins;
    soul.star = Math.min(5, soul.star + 1);
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
    return { ok: true, result: rollOne() };
  }
  /* 新手免費十連：只能領一次，不扣券也不扣鑽。
     目的：讓新玩家在前 3 分鐘就體驗到靈骨/升星，而不是 25 分鐘後才碰到覺醒。 */
  function pullTenFree() {
    if (S.freeTenUsed) return { ok: false, msg: T('免費十連已使用'), results: [] };
    S.freeTenUsed = true;
    const results = [];
    for (let i = 0; i < 10; i++) results.push(rollOne());
    S.stats.pulls += results.length;
    return { ok: true, results };
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
