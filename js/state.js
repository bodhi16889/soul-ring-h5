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
      name: T('無名靈師'),
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
      ringBag: [],           // 未裝備的靈環
      bones: [],             // [{uid, id}] 未裝備的靈骨
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
    out.rebirths = Math.max(0, out.rebirths | 0);
    out.marks = Math.max(0, out.marks | 0);
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
    const mul = 1 + CFG.REBIRTH.perMark.income * s.marks;
    const coins = Math.round(rate.coins * minutes * mul);
    const exp = Math.round(rate.exp * minutes * mul);
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
    const tbMul = 1 + trueBodyOf(soul).bonus;   // 靈印真身：乘算
    return {
      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk + own.atk + aura.atk + pm.atk * S.marks) * tbMul),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp + own.hp + aura.hp + pm.hp * S.marks) * tbMul),
      def: Math.round(base.def * starMul * lvMul * (1 + own.def + aura.def + pm.def * S.marks) * tbMul),
      spd: Math.round(base.spd * (1 + own.spd + aura.spd + pm.spd * S.marks) * tbMul),
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

  /* ---------- 抽卡 ---------- */
  function pullOnce(useTickets) {
    const cost = useTickets ? CFG.PULL_COST_TICKET : CFG.PULL_COST_DIAMOND;
    if (useTickets) { if (S.tickets < cost) return { ok: false, msg: T('覺醒券不足') }; S.tickets -= cost; }
    else { if (!spendDiamonds(cost)) return { ok: false, msg: T('鑽石不足') }; }
    return { ok: true, result: rollOne() };
  }
  function rollOne() {
    // 15% 出靈骨，其餘出靈印
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

  /* ---------- 轉生 ---------- */
  function rebirthInfo() {
    const gain = CFG.rebirthGain(S.bestStage, S.level);
    return {
      gain,
      can: gain > 0,
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
    S.level = 1;
    S.exp = 0;
    S.stage = 1;
    S.kills = 0;
    S.coins = 0;
    S.ringBag = [];
    S.souls.forEach((soul) => { soul.rings = []; soul.level = 1; });
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
    totalRingsEquipped, levelCap, atCap, incomeMul, rebirthInfo, doRebirth,
    trueBodyOf, resonanceOf, ringSkillOf, hasFreeRingSlot,
    mergeInfo, mergeRings, mergeAll, mergeLowTiers,
    newRing, ringSlotsOf, ringBonus, equipRing, unequipRing, autoEquipBestRing, freeRings,
    boneOf, freeBones, equippedBones, teamAura, equipBone, unequipBone,
    starUpInfo, starUp,
    slotNextCost, slotNextLevel, canExpand, expandSlot, toggleTeam,
    dayKey, checkinInfo, checkIn,
    pullOnce, rollOne, redeem, exportCode, importCode,
    offlineGain, OFFLINE_CAP_H,
  };
})(window);
