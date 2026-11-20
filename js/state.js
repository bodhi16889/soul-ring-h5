/* ==========================================================================
 * state.js — 存檔、衍生數值、離線收益、存檔碼匯出／匯入
 * 純資料層：不碰 DOM，方便測試與日後搬到後端。
 * ========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'soulring.save.v1';
  const SAVE_EVERY_MS = 10000;
  const OFFLINE_CAP_H = 12;

  /* ---------- 建立新檔 ---------- */
  function newSave() {
    const starter = {
      id: 'haotian', star: CFG.SOUL_BY_ID.haotian.star, level: 1, rings: [],
    };
    return {
      v: 1,
      name: '無名魂師',
      level: 1,
      exp: 0,
      coins: 120,
      diamonds: 300,
      tickets: 3,
      stage: 1,
      bestStage: 1,
      kills: 0,              // 本關已擊殺小怪
      slots: 1,              // 上陣人數
      souls: [starter],
      team: ['haotian'],
      ringBag: [],           // 未裝備的魂環
      bones: [],
      cd: {},                // 魂獸 id -> 下次可獵時間
      codes: [],
      stats: { kills: 0, hunts: 0, pulls: 0 },
      lastSave: Date.now(),
    };
  }

  let S = newSave();

  /* ---------- 存取 ---------- */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* 私密模式 */ }
    if (!raw) { S = newSave(); return { fresh: true }; }
    try {
      const parsed = JSON.parse(raw);
      S = migrate(parsed);
      const gap = offlineGain(S);
      return { fresh: false, offline: gap };
    } catch (e) {
      S = newSave();
      return { fresh: true, corrupted: true };
    }
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
    out.slots = Math.max(1, Math.min(5, out.slots | 0 || 1));
    out.team = out.team.filter((id) => out.souls.some((s) => s.id === id)).slice(0, out.slots);
    out.souls.forEach((s) => { if (!Array.isArray(s.rings)) s.rings = []; });
    return out;
  }

  let saveTimer = 0;
  function save(force) {
    S.lastSave = Date.now();
    if (!force && saveTimer) return;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 私密模式 */ }
    if (!force) {
      saveTimer = setTimeout(() => { saveTimer = 0; }, SAVE_EVERY_MS);
    }
  }
  function reset() {
    S = newSave();
    save(true);
    return S;
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
    const coins = rate.coins * minutes;
    const exp = rate.exp * minutes;
    s.coins += coins;
    addExp(s, exp, { silent: true });
    s.lastSave = now;
    return { minutes, capped: ms > capped, coins, exp, rate };
  }

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

  function soulStats(soul) {
    const base = CFG.SOUL_BY_ID[soul.id] || CFG.SOULS[0];
    const starMul = 1 + 0.35 * (soul.star - 3);
    const lvMul = 1 + 0.10 * ((soul.level || 1) - 1);
    const rb = ringBonus(soul);
    return {
      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk)),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp)),
      def: Math.round(base.def * starMul * lvMul),
      spd: base.spd,
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
  function power() {
    const t = teamStats();
    return Math.round(t.atk * 2.2 + t.hp * 0.35 + t.def * 2.5 + t.spd * 0.6);
  }

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
      // 武魂等級跟玩家等級同步成長（上限 90）
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

  /* ---------- 魂環 ---------- */
  let uidSeq = 0;
  function newRing(tierKey) {
    const t = CFG.TIER_BY_KEY[tierKey];
    uidSeq++;
    return { uid: 'r' + Date.now().toString(36) + '_' + uidSeq, tier: tierKey, name: t ? t.name : '魂環' };
  }
  function ringSlotsOf(soul) {
    const star = soul.star || 3;
    return Math.min(3, 1 + (star >= 4 ? 1 : 0) + (star >= 5 ? 1 : 0));
  }
  function equipRing(soulId, uid) {
    const soul = S.souls.find((s) => s.id === soulId);
    const idx = S.ringBag.findIndex((r) => r.uid === uid);
    if (!soul || idx < 0) return { ok: false, msg: '找不到魂環' };
    if (soul.rings.length >= ringSlotsOf(soul)) return { ok: false, msg: '魂環槽已滿（升星可增加槽位）' };
    soul.rings.push(uid);
    S.ringBag.splice(idx, 1);
    return { ok: true };
  }
  function unequipRing(soulId, uid) {
    const soul = S.souls.find((s) => s.id === soulId);
    if (!soul) return { ok: false };
    const i = soul.rings.indexOf(uid);
    if (i < 0) return { ok: false };
    soul.rings.splice(i, 1);
    S.ringBag.push({ uid, tier: (S.ringBag.find((r) => r.uid === uid) || {}).tier || 'white', name: '魂環' });
    return { ok: true };
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
    if (S.slots >= 5) return { ok: false, msg: '已是五人小隊' };
    if (S.level < slotNextLevel()) return { ok: false, msg: `需等級 ${slotNextLevel()}` };
    if (S.souls.length <= S.slots) return { ok: false, msg: '沒有可上陣的新武魂，先去覺醒抽卡' };
    if (!spendCoins(slotNextCost())) return { ok: false, msg: '魂幣不足' };
    S.slots++;
    const next = S.souls.find((s) => !S.team.includes(s.id));
    if (next) S.team.push(next.id);
    return { ok: true, slots: S.slots };
  }
  function toggleTeam(soulId) {
    const inTeam = S.team.includes(soulId);
    if (inTeam) {
      if (S.team.length <= 1) return { ok: false, msg: '至少要上陣一位武魂' };
      S.team = S.team.filter((id) => id !== soulId);
      return { ok: true, in: false };
    }
    if (S.team.length >= S.slots) return { ok: false, msg: '陣容已滿，先擴充名額' };
    S.team.push(soulId);
    return { ok: true, in: true };
  }

  /* ---------- 抽卡 ---------- */
  function pullOnce(useTickets) {
    const cost = useTickets ? CFG.PULL_COST_TICKET : CFG.PULL_COST_DIAMOND;
    if (useTickets) { if (S.tickets < cost) return { ok: false, msg: '覺醒券不足' }; S.tickets -= cost; }
    else { if (!spendDiamonds(cost)) return { ok: false, msg: '鑽石不足' }; }
    return { ok: true, result: rollOne() };
  }
  function rollOne() {
    // 15% 出魂骨，其餘出武魂
    if (Math.random() < 0.15 && CFG.PULL_BONES.length) {
      const b = CFG.PULL_BONES[Math.floor(Math.random() * CFG.PULL_BONES.length)];
      S.bones.push(b.id);
      return { kind: 'bone', id: b.id, name: b.name, desc: b.desc };
    }
    const pool = CFG.PULL_POOL;
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let roll = Math.random() * total, picked = pool[0];
    for (const p of pool) { roll -= p.weight; if (roll <= 0) { picked = p; break; } }
    const existing = S.souls.find((s) => s.id === picked.id);
    if (existing) {
      if (existing.star < 5) { existing.star++; return { kind: 'star', id: picked.id, name: CFG.SOUL_BY_ID[picked.id].name, star: existing.star }; }
      S.diamonds += 200;
      return { kind: 'dup', id: picked.id, name: CFG.SOUL_BY_ID[picked.id].name, diamonds: 200 };
    }
    S.souls.push({ id: picked.id, star: picked.star, level: S.level, rings: [] });
    return { kind: 'new', id: picked.id, name: CFG.SOUL_BY_ID[picked.id].name, star: picked.star };
  }

  /* ---------- 兌換碼 ---------- */
  function redeem(code) {
    const key = String(code || '').trim().toUpperCase();
    if (!key) return { ok: false, msg: '請輸入兌換碼' };
    if (S.codes.includes(key)) return { ok: false, msg: '這個兌換碼已用過' };
    const c = CFG.CODES[key];
    if (!c) return { ok: false, msg: '兌換碼無效' };
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
      if (!data || !Array.isArray(data.souls)) throw new Error('格式錯誤');
      S = migrate(data);
      S.lastSave = Date.now();
      save(true);
      return { ok: true, save: S };
    } catch (e) {
      return { ok: false, msg: '存檔碼無法解析' };
    }
  }

  global.State = {
    get data() { return S; },
    load, save, reset,
    addExp, addCoins, spendCoins, addDiamonds, spendDiamonds,
    soulStats, teamSouls, teamStats, power,
    totalRingsEquipped, levelCap, atCap,
    newRing, ringSlotsOf, ringBonus, equipRing, unequipRing,
    slotNextCost, slotNextLevel, canExpand, expandSlot, toggleTeam,
    pullOnce, rollOne, redeem, exportCode, importCode,
    offlineGain, OFFLINE_CAP_H,
  };
})(window);
