#!/usr/bin/env python3
"""Stage 2：9 靈環槽（每 10 級開一格、上限 100）＋靈環技能＋屬性共鳴＋靈印真身。"""
import io, os

ROOT = os.path.expanduser('~/work/soul-ring-h5')


def patch(name, pairs):
    p = os.path.join(ROOT, name)
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (name, s.count(old), old[:80])
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('✓', name)


# ---------------------------------------------------------------- config
patch('js/config.js', [
    ("""  const MAX_LEVEL = 90;""",
     """  const MAX_LEVEL = 100;          // GDD：百級神祇
  const RING_SLOTS_PER_LEVEL = 10;  // 每 10 級開 1 個靈環槽
  const MAX_RING_SLOTS = 9;         // 單一靈印最多 9 槽（GDD）"""),

    ("""  function levelCap(ringsEquipped) { return Math.min(MAX_LEVEL, 10 + 10 * ringsEquipped); }""",
     """  /* 等級上限改成固定 100（GDD 模型）；靈環不再解鎖等級，而是每 10 級開一格 */
  function levelCap() { return MAX_LEVEL; }
  function ringSlots(level) { return Math.min(MAX_RING_SLOTS, Math.floor((level || 1) / RING_SLOTS_PER_LEVEL)); }

  /* ---------- 靈環技能（依年份）----------
   * 十年/百年：純屬性（被動）
   * 千年：群體 120% / 萬年：震懾 150%（50% 暈眩）/ 十萬年：群體 200%
   */
  const RING_SKILL = {
    white: null,
    yellow: null,
    violet: { type: 'aoe', mult: 1.2, label: '靈技 · 千軍' },
    black: { type: 'stun', mult: 1.5, chance: 0.5, label: '靈技 · 震懾' },
    red: { type: 'aoe', mult: 2.0, label: '靈技 · 神滅' },
  };

  /* 屬性共鳴：同一靈印 3 個同系靈環 → 該系靈技傷害 +25% */
  const RESONANCE = { need: 3, mult: 1.25 };

  /* 靈印真身：同一靈印 3/6/9 個萬年以上靈環 → 全屬性 +15%/35%/60% */
  const TRUE_BODY = [
    { need: 3, mult: 0.15 },
    { need: 6, mult: 0.35 },
    { need: 9, mult: 0.60 },
  ];"""),

    ("""  const BEASTS = [
    { id: 'baboon', name: '嘯風猿',     emoji: '🐒', tier: 'white',  year: '十年',   hp: 220,  atk: 12,  reqLevel: 10, cdSec: 18 },
    { id: 'mandala', name: '纏魂藤蛇',  emoji: '🐍', tier: 'yellow', year: '百年',   hp: 640,  atk: 26,  reqLevel: 20, cdSec: 30 },
    { id: 'spider', name: '織影蛛',   emoji: '🕷', tier: 'violet', year: '千年',   hp: 2400, atk: 62,  reqLevel: 30, cdSec: 60 },
    { id: 'darkbear', name: '暗金裂爪熊', emoji: '🐾', tier: 'black', year: '萬年',   hp: 6200, atk: 118, reqLevel: 40, cdSec: 90 },
    { id: 'whale',  name: '深海巨鯨',   emoji: '🐋', tier: 'red',    year: '十萬年', hp: 16000, atk: 210, reqLevel: 50, cdSec: 120 },
  ];""",
     """  const BEASTS = [
    { id: 'baboon', name: '嘯風猿',     emoji: '🐒', tier: 'white',  year: '十年',   element: 'wind',   hp: 220,  atk: 12,  reqLevel: 10, cdSec: 18 },
    { id: 'mandala', name: '纏魂藤蛇',  emoji: '🐍', tier: 'yellow', year: '百年',   element: 'wood',   hp: 640,  atk: 26,  reqLevel: 20, cdSec: 30 },
    { id: 'spider', name: '織影蛛',   emoji: '🕷', tier: 'violet', year: '千年',   element: 'poison', hp: 2400, atk: 62,  reqLevel: 30, cdSec: 60 },
    { id: 'darkbear', name: '暗金裂爪熊', emoji: '🐾', tier: 'black', year: '萬年',   element: 'earth',  hp: 6200, atk: 118, reqLevel: 40, cdSec: 90 },
    { id: 'whale',  name: '深海巨鯨',   emoji: '🐋', tier: 'red',    year: '十萬年', element: 'water',  hp: 16000, atk: 210, reqLevel: 50, cdSec: 120 },
  ];
  const ELEMENT_LABEL = { wind: '風', wood: '木', poison: '毒', earth: '土', water: '水' };
  const ELEMENT_COLOR = { wind: '#5ad8ff', wood: '#57d98b', poison: '#b06bff', earth: '#e0a458', water: '#6ea8ff' };"""),

    ("""    MAX_LEVEL, BASE_KILLS_PER_STAGE, AUTO_BOSS_DELAY, AUTO_HUNT_DELAY,""",
     """    MAX_LEVEL, RING_SLOTS_PER_LEVEL, MAX_RING_SLOTS,
    RING_SKILL, RESONANCE, TRUE_BODY, ELEMENT_LABEL, ELEMENT_COLOR,
    BASE_KILLS_PER_STAGE, AUTO_BOSS_DELAY, AUTO_HUNT_DELAY,"""),

    ("""    expNeed, levelCap, enemyStats, killReward, offlinePerMinute,""",
     """    expNeed, levelCap, ringSlots, enemyStats, killReward, offlinePerMinute,"""),
])

# ---------------------------------------------------------------- state
patch('js/state.js', [
    # 環槽：改吃玩家等級
    ("""  function ringSlotsOf(soul) {
    const star = soul.star || 3;
    return Math.min(3, 1 + (star >= 4 ? 1 : 0) + (star >= 5 ? 1 : 0));
  }""",
     """  function ringSlotsOf(soul) {
    return CFG.ringSlots(S.level);   // 每 10 級 1 槽，最多 9
  }"""),

    # 靈環帶屬性元素 + 年份技能
    ("""  function newRing(tierKey) {
    const t = CFG.TIER_BY_KEY[tierKey];
    uidSeq++;
    return { uid: 'r' + Date.now().toString(36) + '_' + uidSeq, tier: tierKey, name: t ? t.name : '靈環' };
  }""",
     """  function newRing(tierKey, element) {
    const t = CFG.TIER_BY_KEY[tierKey];
    uidSeq++;
    return {
      uid: 'r' + Date.now().toString(36) + '_' + uidSeq,
      tier: tierKey, name: t ? t.name : '靈環',
      element: element || 'wind',
      equipped: null,
    };
  }"""),

    # 靈印真身 + 共鳴查詢
    ("""  /* 命印帶來的收益倍率（靈幣/經驗） */""",
     """  /* ---------- 靈印真身（3/6/9 個萬年以上靈環）---------- */
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

  /* 命印帶來的收益倍率（靈幣/經驗） */"""),

    # 真身加成進數值
    ("""    const pm = CFG.REBIRTH.perMark;
    return {""",
     """    const pm = CFG.REBIRTH.perMark;
    const tb = trueBodyOf(soul).bonus;
    return {"""),
    ("""      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk + own.atk + aura.atk + pm.atk * S.marks)),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp + own.hp + aura.hp + pm.hp * S.marks)),
      def: Math.round(base.def * starMul * lvMul * (1 + own.def + aura.def + pm.def * S.marks)),
      spd: Math.round(base.spd * (1 + own.spd + aura.spd + pm.spd * S.marks)),""",
     """      atk: Math.round(base.atk * starMul * lvMul * (1 + rb.atk + own.atk + aura.atk + pm.atk * S.marks + tb)),
      hp: Math.round(base.hp * starMul * lvMul * (1 + rb.hp + own.hp + aura.hp + pm.hp * S.marks + tb)),
      def: Math.round(base.def * starMul * lvMul * (1 + own.def + aura.def + pm.def * S.marks + tb)),
      spd: Math.round(base.spd * (1 + own.spd + aura.spd + pm.spd * S.marks + tb)),"""),

    # 環槽滿的訊息
    ("""    if (soul.rings.length >= ringSlotsOf(soul)) return { ok: false, msg: '靈環槽已滿（升星可增加槽位）' };""",
     """    if (soul.rings.length >= ringSlotsOf(soul)) return { ok: false, msg: `靈環槽已滿（每 10 級才開一格，目前 ${ringSlotsOf(soul)} 格）` };"""),

    # 自動裝備的判斷：沒空槽就跳過
    ("""    for (const soul of teamSouls()) {
      if (soul.rings.length >= ringSlotsOf(soul)) continue;""",
     """    for (const soul of teamSouls()) {
      if (ringSlotsOf(soul) === 0) continue;
      if (soul.rings.length >= ringSlotsOf(soul)) continue;"""),

    # 有沒有空槽（給自動獵靈判斷）
    ("""  /* 命印帶來的收益倍率（靈幣/經驗） */""",
     """  function hasFreeRingSlot() {
    return teamSouls().some((soul) => ringSlotsOf(soul) > 0 && soul.rings.length < ringSlotsOf(soul));
  }

  /* 命印帶來的收益倍率（靈幣/經驗） */"""),

    # 舊存檔遷移：靈環補 element
    ("""    out.ringBag.forEach((r) => { if (r.equipped && !out.souls.some((x) => x.id === r.equipped)) r.equipped = null; });""",
     """    out.ringBag.forEach((r) => {
      if (!r.element) r.element = 'wind';
      if (r.equipped && !out.souls.some((x) => x.id === r.equipped)) r.equipped = null;
    });"""),

    ("""    totalRingsEquipped, levelCap, atCap, incomeMul, rebirthInfo, doRebirth,""",
     """    totalRingsEquipped, levelCap, atCap, incomeMul, rebirthInfo, doRebirth,
    trueBodyOf, resonanceOf, ringSkillOf, hasFreeRingSlot,"""),
])

# ---------------------------------------------------------------- battle
patch('js/battle.js', [
    # 獵靈帶元素
    ("""      const ring = State.newRing(beast.tier);""",
     """      const ring = State.newRing(beast.tier, beast.element);"""),

    # 卡等 → 改成「有空環槽」就自動獵靈
    ("""    if (cfg.autoHunt !== false && B.mode === 'farm' && State.atCap()) {""",
     """    if (cfg.autoHunt !== false && B.mode === 'farm' && State.hasFreeRingSlot()) {"""),
    ("""        setTimeout(() => {
          if (B.mode === 'farm' && State.atCap()) hunt(beast.id);
        }, CFG.AUTO_HUNT_DELAY);""",
     """        setTimeout(() => {
          if (B.mode === 'farm' && State.hasFreeRingSlot()) hunt(beast.id);
        }, CFG.AUTO_HUNT_DELAY);"""),

    # 靈技：優先放靈環技能（千年以上），並吃共鳴加成
    ("""  function castSkill(u) {
    emit('skill', { unit: u, role: u.role, name: (CFG.SOUL_BY_ID[u.id] || {}).skillName || '靈技' });""",
     """  function castSkill(u) {
    const soul = State.data.souls.find((s) => s.id === u.id);
    const ringSkill = soul ? State.ringSkillOf(soul) : null;
    if (ringSkill) {
      const reso = soul ? State.resonanceOf(soul) : null;
      const resoMul = reso && reso.element === ringSkill.element ? CFG.RESONANCE.mult : 1;
      emit('skill', {
        unit: u, role: u.role, ring: true,
        name: ringSkill.label,
        element: ringSkill.element,
        resonance: resoMul > 1,
      });
      const targets = aliveEnemies();
      if (ringSkill.type === 'aoe') {
        for (const e of targets) {
          hitEnemy(e, calcDamage(u.atk * (1 + u.buffAtk) * ringSkill.mult * resoMul, e.def, 0.95, 1.05), u, true);
        }
        if (targets.length > 1) emit('aoe', { count: targets.length });
      } else {
        const t = targetEnemy();
        if (t) {
          hitEnemy(t, calcDamage(u.atk * (1 + u.buffAtk) * ringSkill.mult * resoMul, t.def, 0.95, 1.05), u, true);
          if (Math.random() < (ringSkill.chance || 0) && t.alive) {
            t.stun = Math.max(t.stun, 1);
            emit('stun', { who: 'enemy', enemyId: t.id });
          }
        }
      }
      return;
    }
    emit('skill', { unit: u, role: u.role, name: (CFG.SOUL_BY_ID[u.id] || {}).skillName || '靈技' });"""),
])
print('stage2 core patched')
