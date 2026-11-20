/* ==========================================================================
 * config.js — 數值設定表（武魂／魂獸／魂環／關卡／兌換碼）
 * 全部純資料，改這裡就能調平衡，不需要動邏輯。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- 魂環年份：加成與顏色 ---------- */
  const RING_TIERS = [
    { key: 'white',  name: '十年魂環',   color: '#f2f2f2', mult: 0.10, minLevel: 10,  atk: 0.10, hp: 0.10, css: 't-white'  },
    { key: 'yellow', name: '百年魂環',   color: '#ffd93d', mult: 0.25, minLevel: 20,  atk: 0.25, hp: 0.25, css: 't-yellow' },
    { key: 'violet', name: '千年魂環',   color: '#b06bff', mult: 0.60, minLevel: 30,  atk: 0.60, hp: 0.60, css: 't-violet' },
    { key: 'black',  name: '萬年魂環',   color: '#3a3a46', mult: 1.50, minLevel: 40,  atk: 1.50, hp: 1.50, css: 't-black'  },
    { key: 'red',    name: '十萬年魂環', color: '#ff4d5e', mult: 4.00, minLevel: 50,  atk: 4.00, hp: 4.00, css: 't-red'    },
  ];
  const TIER_BY_KEY = Object.fromEntries(RING_TIERS.map((t) => [t.key, t]));

  /* ---------- 武魂（角色）----------
   * role：atk 強攻 / ctrl 控制 / def 防禦 / sup 輔助
   * skill 由 battle.js 依 role 實作，這裡只給倍率與描述
   */
  const SOULS = [
    { id: 'haotian',  name: '昊天錘',     emoji: '🔨', role: 'atk',  star: 3, atk: 14, hp: 120, def: 6,  spd: 92,  skillName: '昊天九絕',   skillText: '對全體敵人造成 70% 攻擊傷害' },
    { id: 'phoenix',  name: '邪火鳳凰',   emoji: '🔥', role: 'atk',  star: 4, atk: 17, hp: 105, def: 5,  spd: 104, skillName: '鳳凰火焰',   skillText: '對單體造成 200% 傷害並灼燒' },
    { id: 'bluemoss', name: '藍銀草',     emoji: '🌿', role: 'ctrl', star: 3, atk: 10, hp: 140, def: 8,  spd: 96,  skillName: '藍銀纏繞',   skillText: '單體 60% 傷害，40% 機率暈眩 1 回合' },
    { id: 'fox',      name: '魅惑天狐',   emoji: '🦊', role: 'ctrl', star: 4, atk: 11, hp: 118, def: 6,  spd: 112, skillName: '魅惑領域',   skillText: '全體 45% 傷害，命中者減速 30%' },
    { id: 'turtle',   name: '玄武龜',     emoji: '🐢', role: 'def',  star: 4, atk: 8,  hp: 240, def: 16, spd: 78,  skillName: '玄武真身',   skillText: '嘲諷 1 回合，全隊獲得護盾' },
    { id: 'bear',     name: '大力金剛熊', emoji: '🐻', role: 'def',  star: 3, atk: 12, hp: 210, def: 13, spd: 82,  skillName: '金剛咆哮',   skillText: '嘲諷並降低敵方攻擊 20%' },
    { id: 'tower',    name: '七寶琉璃塔', emoji: '🗼', role: 'sup',  star: 5, atk: 9,  hp: 130, def: 7,  spd: 108, skillName: '七寶琉璃',   skillText: '全隊攻擊 +40%、回復 25% 生命' },
    { id: 'sausage',  name: '香腸專賣',   emoji: '🌭', role: 'sup',  star: 2, atk: 7,  hp: 110, def: 5,  spd: 100, skillName: '恢復大香腸', skillText: '回復生命最低的隊友 40% 生命' },
    { id: 'nether',   name: '幽冥靈貓',   emoji: '🐈', role: 'atk',  star: 4, atk: 19, hp: 96,  def: 4,  spd: 118, skillName: '幽冥爪',     skillText: '對單體造成 230% 傷害' },
    { id: 'seagod',   name: '海神三叉戟', emoji: '🔱', role: 'atk',  star: 5, atk: 22, hp: 150, def: 9,  spd: 110, skillName: '無定風波',   skillText: '全體 110% 傷害，無視 30% 防禦' },
  ];
  const SOUL_BY_ID = Object.fromEntries(SOULS.map((s) => [s.id, s]));

  const ROLE_LABEL = { atk: '強攻', ctrl: '控制', def: '防禦', sup: '輔助' };
  const ROLE_COLOR = { atk: '#ff8a5b', ctrl: '#b06bff', def: '#6ea8ff', sup: '#57d98b' };

  /* ---------- 魂獸（獵魂場）----------
   * tier 決定掉落的魂環年份；reqLevel 是建議等級（低於會被勸退）
   */
  const BEASTS = [
    { id: 'baboon', name: '風狒狒',     emoji: '🐒', tier: 'white',  year: '十年',   hp: 320,  atk: 18,  reqLevel: 10, cdSec: 25 },
    { id: 'mandala', name: '曼陀羅蛇',  emoji: '🐍', tier: 'yellow', year: '百年',   hp: 900,  atk: 34,  reqLevel: 20, cdSec: 40 },
    { id: 'spider', name: '人面魔蛛',   emoji: '🕷', tier: 'violet', year: '千年',   hp: 2400, atk: 62,  reqLevel: 30, cdSec: 60 },
    { id: 'darkbear', name: '暗金恐爪熊', emoji: '🐾', tier: 'black', year: '萬年',   hp: 6200, atk: 118, reqLevel: 40, cdSec: 90 },
    { id: 'whale',  name: '深海魔鯨',   emoji: '🐋', tier: 'red',    year: '十萬年', hp: 16000, atk: 210, reqLevel: 50, cdSec: 120 },
  ];
  const BEAST_BY_ID = Object.fromEntries(BEASTS.map((b) => [b.id, b]));

  /* ---------- 關卡場景 ---------- */
  const STAGE_AREAS = [
    '諾丁學院 · 後山', '星斗大森林 · 外圍', '索托城 · 競技場', '冰火兩儀眼',
    '海神島 · 試煉之路', '武魂城 · 擂台', '殺戮之都', '深淵 · 神界裂縫',
  ];
  function areaFor(stage) { return STAGE_AREAS[Math.floor((stage - 1) / 10) % STAGE_AREAS.length]; }

  /* ---------- 成長公式 ---------- */
  const MAX_LEVEL = 90;
  const BASE_KILLS_PER_STAGE = 10;          // 每關殺 10 隻小怪出 BOSS
  const PULL_COST_TICKET = 1;
  const PULL_COST_DIAMOND = 100;
  const PULL10_COST_TICKET = 10;
  const PULL10_COST_DIAMOND = 900;

  function expNeed(level) { return Math.round(14 * Math.pow(level, 1.55) + 10 * level); }
  function levelCap(ringsEquipped) { return Math.min(MAX_LEVEL, 10 + 10 * ringsEquipped); }

  function enemyStats(stage, isBoss) {
    const mul = Math.pow(1.16, stage - 1);
    return {
      hp: Math.round(58 * mul * (isBoss ? 7.5 : 1)),
      atk: Math.round(7 * mul * (isBoss ? 1.9 : 1)),
      def: Math.round(2 * mul * (isBoss ? 2 : 1)),
      spd: 70 + Math.min(50, stage),
      name: isBoss ? `第 ${stage} 關守關魂獸` : '野生魂獸',
      emoji: isBoss ? '👹' : '🦟',
      boss: !!isBoss,
    };
  }
  function killReward(stage) {
    return { coins: Math.round(4 * Math.pow(stage, 1.12)), exp: Math.round(6 * Math.pow(stage, 0.95)) };
  }
  function offlinePerMinute(stage) {
    const r = killReward(stage);
    return { coins: Math.round(r.coins * 5), exp: Math.round(r.exp * 5) };
  }

  /* ---------- 抽卡池 ---------- */
  const PULL_POOL = SOULS.map((s) => ({ id: s.id, star: s.star, weight: s.star === 5 ? 3 : s.star === 4 ? 12 : 35 }));
  const PULL_BONES = [
    { id: 'bone1', name: '外附魂骨 · 疾風', desc: '全隊速度 +5%' },
    { id: 'bone2', name: '魂骨 · 巨力',     desc: '全隊攻擊 +6%' },
  ];

  /* ---------- 兌換碼 ---------- */
  const CODES = {
    VIP666:    { diamonds: 8888,  tickets: 5,  msg: '鑽石 8888、覺醒券 5' },
    DOULUO888: { diamonds: 18888, ring: 'black', msg: '鑽石 18888、萬年魂環 ×1' },
    TANG3:     { coins: 88888, exp: 6000, msg: '魂幣 88888、經驗 6000' },
  };

  global.CFG = {
    RING_TIERS, TIER_BY_KEY, SOULS, SOUL_BY_ID, ROLE_LABEL, ROLE_COLOR,
    BEASTS, BEAST_BY_ID, STAGE_AREAS, areaFor,
    MAX_LEVEL, BASE_KILLS_PER_STAGE,
    PULL_COST_TICKET, PULL_COST_DIAMOND, PULL10_COST_TICKET, PULL10_COST_DIAMOND,
    expNeed, levelCap, enemyStats, killReward, offlinePerMinute,
    PULL_POOL, PULL_BONES, CODES,
  };
})(window);
