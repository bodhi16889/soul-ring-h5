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
      id: 'haotian', star: CFG.SOUL_BY_ID.haotian.star, level: 1, rings: [], bone: null,
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
      bones: [],             // [{uid, id}] 未裝備的魂骨
      cd: {},                // 魂獸 id -> 下次可獵時間
      codes: [],
      checkin: { lastDay: '', streak: 0, total: 0 },   // 每日簽到
      settings: { autoBoss: true, autoHunt: true, autoRing: true },   // 放置用開關
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
    out.checkin = Object.assign({ lastDay: '', streak: 0, total: 0 }, (d && d.checkin) || {});
    out.settings = Object.assign({ autoBoss: true, autoHunt: true, autoRing: true }, (d && d.settings) || {});
    out.slots = Math.max(1, Math.min(5, out.slots | 0 || 1));
    out.team = out.team.filter((id) => out.souls.some((s) => s.id === id)).slice(0, out.slots);
    out.souls.forEach((s) => {
      if (!Array.isArray(s.rings)) s.rings = [];
      if (s.bone === undefined) s.bone = null;
    });
    // 舊版魂骨只存 id 字串 → 轉成 {uid, id}
    // 舊版裝備魂環時會從背包移除物件 → 補回（年份已遺失，以白色處理）
    const bagUids = new Set(out.ringBag.map((r) => r.uid));
    out.souls.forEach((soul) => {
      (soul.rings || []).forEach((uid) => {
        if (!bagUids.has(uid)) {
          out.ringBag.push({ uid, tier: 'white', name: '十年魂環', equipped: soul.id });
          bagUids.add(uid);
        }
      });
    });
    out.ringBag.forEach((r) => { if (r.equipped && !out.souls.some((x) => x.id === r.equipped)) r.equipped = null; });

    out.bones = (Array.isArray(d && d.bones) ? d.bones : []).map((b, i) => {
      if (typeof b === 'string') return { uid: 'bo_mig' + i, id: b };
      if (b && b.id) return { uid: b.uid || ('bo_' + i), id: b.id };
      return null;
    }).filter(Boolean);
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

  /* ---------- 魂骨 ---------- */
  function boneOf(soul) {
    if (!soul || !soul.bone) return null;
    const item = S.bones.find((b) => b.uid === soul.bone);
    return item ? CFG.BONE_BY_ID[item.id] : null;
  }
  function freeBones() { return S.bones.filter((b) => !S.souls.some((s) => s.bone === b.uid)); }
  function equippedBones() { return S.souls.filter((s) => s.bone).length; }

  /* 光環：同隊其他武魂的魂骨，按 BONE_AURA 比例加成（裝備者自己吃 100%） */
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
    return {
      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk + own.atk + aura.atk)),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp + own.hp + aura.hp)),
      def: Math.round(base.def * starMul * lvMul * (1 + own.def + aura.def)),
      spd: Math.round(base.spd * (1 + own.spd + aura.spd)),
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
  /* 自動裝備：找第一個還有空槽的上陣武魂 */
  function autoEquipBestRing() {
    if ((S.settings || {}).autoRing === false) return null;
    if (!freeRings().length) return null;
    for (const soul of teamSouls()) {
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
    if (!soul || !item) return { ok: false, msg: '找不到魂環' };
    if (item.equipped) return { ok: false, msg: '這枚魂環已經裝在別人身上' };
    if (soul.rings.length >= ringSlotsOf(soul)) return { ok: false, msg: '魂環槽已滿（升星可增加槽位）' };
    soul.rings.push(uid);
    item.equipped = soulId;
    return { ok: true };
  }

  /* 沒裝備的魂環（背包） */
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
    if (!soul || !item) return { ok: false, msg: '找不到魂骨' };
    if (S.souls.some((s) => s.bone === uid)) return { ok: false, msg: '這塊魂骨已裝備' };
    soul.bone = uid;
    return { ok: true };
  }
  function unequipBone(soulId) {
    const soul = S.souls.find((s) => s.id === soulId);
    if (!soul || !soul.bone) return { ok: false };
    soul.bone = null;
    return { ok: true };
  }

  /* 升星：消耗未裝備魂骨（star-2 塊）＋魂幣，上限 5★ */
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
    if (!soul) return { ok: false, msg: '找不到武魂' };
    const info = starUpInfo(soul);
    if (info.maxed) return { ok: false, msg: '已是 5 星' };
    if (freeBones().length < info.bones) return { ok: false, msg: `需要 ${info.bones} 塊未裝備魂骨（目前 ${info.available}）` };
    if (S.coins < info.coins) return { ok: false, msg: `魂幣不足（需 ${info.coins}）` };
    // 吃掉最舊的未裝備魂骨
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
      const b = CFG.BONES[Math.floor(Math.random() * CFG.BONES.length)];
      const uid = 'bo' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
      S.bones.push({ uid, id: b.id });
      return { kind: 'bone', id: b.id, name: b.name, desc: b.desc, uid };
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
    if (!info.canCheck) return { ok: false, msg: '今天已經簽過了，明天再來' };
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
    newRing, ringSlotsOf, ringBonus, equipRing, unequipRing, autoEquipBestRing, freeRings,
    boneOf, freeBones, equippedBones, teamAura, equipBone, unequipBone,
    starUpInfo, starUp,
    slotNextCost, slotNextLevel, canExpand, expandSlot, toggleTeam,
    dayKey, checkinInfo, checkIn,
    pullOnce, rollOne, redeem, exportCode, importCode,
    offlineGain, OFFLINE_CAP_H,
  };
})(window);
