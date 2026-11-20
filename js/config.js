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
    { id: 'haotian',  name: '昊天錘',     emoji: '🔨', role: 'atk',  star: 3, atk: 16, hp: 130, def: 6,  spd: 92,  skillName: '昊天九絕',   skillText: '對全體敵人造成 200% 攻擊傷害' },
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
    { id: 'baboon', name: '風狒狒',     emoji: '🐒', tier: 'white',  year: '十年',   hp: 220,  atk: 12,  reqLevel: 10, cdSec: 18 },
    { id: 'mandala', name: '曼陀羅蛇',  emoji: '🐍', tier: 'yellow', year: '百年',   hp: 640,  atk: 26,  reqLevel: 20, cdSec: 30 },
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
  const BASE_KILLS_PER_STAGE = 8;           // 每關殺 8 隻小怪出 BOSS（放置遊戲不要拖）
  const AUTO_BOSS_DELAY = 1800;            // 清完小怪後幾毫秒自動挑戰 BOSS
  const AUTO_HUNT_DELAY = 2500;            // 卡等時幾毫秒自動去獵魂
  const PULL_COST_TICKET = 1;
  const PULL_COST_DIAMOND = 100;
  const PULL10_COST_TICKET = 10;
  const PULL10_COST_DIAMOND = 900;

  function expNeed(level) { return Math.round(8 * Math.pow(level, 1.3) + 6 * level); }
  function levelCap(ringsEquipped) { return Math.min(MAX_LEVEL, 10 + 10 * ringsEquipped); }

  /* 無限關卡的難度曲線：前 60 關指數（1.16），之後轉慢速（1.06）
     → 深關不會變成 1e27 這種天文數字，轉生才有意義 */
  function stageMul(stage, fast, slow, pivot) {
    const f = Math.min(stage, pivot);
    const rest = Math.max(0, stage - pivot);
    return Math.pow(fast, f - 1) * Math.pow(slow, rest);
  }

  function enemyStats(stage, isBoss) {
    const mul = stageMul(stage, 1.16, 1.06, 60);
    return {
      hp: Math.round(42 * mul * (isBoss ? 3.0 : 1)),
      atk: Math.round(7 * mul * (isBoss ? 1.0 : 1)),
      def: Math.round(2 * mul * (isBoss ? 1.5 : 1)),
      spd: 70 + Math.min(50, stage),
      name: isBoss ? `第 ${stage} 關守關魂獸` : '野生魂獸',
      emoji: isBoss ? '👹' : '🦟',
      boss: !!isBoss,
    };
  }
  function killReward(stage) {
    return { coins: Math.round(5 * Math.pow(stage, 1.12)), exp: Math.round(12 * Math.pow(stage, 0.95)) };
  }
  function offlinePerMinute(stage) {
    const r = killReward(stage);
    return { coins: Math.round(r.coins * 5), exp: Math.round(r.exp * 5) };
  }

  /* ---------- 抽卡池 ---------- */
  const PULL_POOL = SOULS.map((s) => ({ id: s.id, star: s.star, weight: s.star === 5 ? 3 : s.star === 4 ? 12 : 35 }));
  /* ---------- 魂骨（可裝備，裝備者 100%、同隊其他武魂 30% 光環）---------- */
  const BONES = [
    { id: 'wind',  name: '外附魂骨 · 疾風', slot: 'speed', atk: 0.00, hp: 0.00, def: 0.00, spd: 0.12, css: 'bone-cyan',  desc: '速度 +12%' },
    { id: 'giant', name: '魂骨 · 巨力',     slot: 'atk',   atk: 0.14, hp: 0.00, def: 0.00, spd: 0.00, css: 'bone-red',   desc: '攻擊 +14%' },
    { id: 'life',  name: '魂骨 · 生命',     slot: 'hp',    atk: 0.00, hp: 0.18, def: 0.00, spd: 0.00, css: 'bone-green', desc: '生命 +18%' },
    { id: 'armor', name: '魂骨 · 堅甲',     slot: 'def',   atk: 0.00, hp: 0.00, def: 0.20, spd: 0.00, css: 'bone-blue',  desc: '防禦 +20%' },
    { id: 'king',  name: '魂骨 · 王者',     slot: 'all',   atk: 0.08, hp: 0.08, def: 0.08, spd: 0.04, css: 'bone-gold',  desc: '全屬性 +8%（速度 +4%）' },
  ];
  const BONE_BY_ID = Object.fromEntries(BONES.map((b) => [b.id, b]));
  const BONE_AURA = 0.3;          // 光環：給同隊其他武魂的比例
  const STAR_COIN = [0, 0, 0, 0, 0, 0];   // 佔位，實際成本用 starUpCoin()

  function bonePullWeight() { return 3; }   // 每種魂骨的抽卡權重
  function starUpBones(star) { return Math.max(1, star - 2); }            // 3→4:1、4→5:2
  function starUpCoin(star) { return star <= 3 ? 1200 : 6000; }

  /* ---------- 每日簽到（7 天一輪，連續簽到 streak 會保留）---------- */
  const CHECKIN = [
    { day: 1, kind: 'coins',    amount: 3000,  label: '魂幣 3000',        emoji: '🪙' },
    { day: 2, kind: 'diamonds', amount: 120,   label: '鑽石 120',         emoji: '💎' },
    { day: 3, kind: 'tickets',  amount: 2,     label: '覺醒券 2',         emoji: '🎟️' },
    { day: 4, kind: 'coins',    amount: 12000, label: '魂幣 12000',       emoji: '🪙' },
    { day: 5, kind: 'ring',     tier: 'yellow', label: '百年魂環',        emoji: '🟡' },
    { day: 6, kind: 'diamonds', amount: 500,   label: '鑽石 500',         emoji: '💎' },
    { day: 7, kind: 'gift',     ring: 'black', tickets: 3, diamonds: 888, label: '萬年魂環＋888💎', emoji: '🎁' },
  ];

  /* ---------- 轉生（魂印）----------
   * 條件：歷史最高關卡 ≥ 20
   * 收益：floor(bestStage/5) + floor(level/10) 點魂印
   * 每點魂印：全屬性 +6%（速度 +2%）、魂幣與經驗 +4%
   */
  const REBIRTH = {
    minStage: 20,
    perMark: { atk: 0.06, hp: 0.06, def: 0.06, spd: 0.02, income: 0.04 },
  };

  function rebirthGain(bestStage, level) {
    if (!bestStage || bestStage < REBIRTH.minStage) return 0;
    return Math.floor(bestStage / 5) + Math.floor((level || 1) / 10);
  }

  /* ---------- 兌換碼 ---------- */
  const CODES = {
    VIP666:    { diamonds: 8888,  tickets: 5,  msg: '鑽石 8888、覺醒券 5' },
    DOULUO888: { diamonds: 18888, ring: 'black', msg: '鑽石 18888、萬年魂環 ×1' },
    TANG3:     { coins: 88888, exp: 6000, msg: '魂幣 88888、經驗 6000' },
  };

  global.CFG = {
    RING_TIERS, TIER_BY_KEY, SOULS, SOUL_BY_ID, ROLE_LABEL, ROLE_COLOR,
    BEASTS, BEAST_BY_ID, STAGE_AREAS, areaFor,
    MAX_LEVEL, BASE_KILLS_PER_STAGE, AUTO_BOSS_DELAY, AUTO_HUNT_DELAY,
    REBIRTH, rebirthGain, stageMul,
    PULL_COST_TICKET, PULL_COST_DIAMOND, PULL10_COST_TICKET, PULL10_COST_DIAMOND,
    expNeed, levelCap, enemyStats, killReward, offlinePerMinute,
    PULL_POOL, BONES, BONE_BY_ID, BONE_AURA, bonePullWeight,
    starUpBones, starUpCoin, CHECKIN, CODES,
  };
})(window);
