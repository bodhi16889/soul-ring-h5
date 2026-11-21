/* ==========================================================================
 * config.js — 數值設定表（靈印／靈獸／靈環／關卡／兌換碼）
 * 全部純資料，改這裡就能調平衡，不需要動邏輯。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- 靈環年份：加成與顏色 ---------- */
  const RING_TIERS = [
    { key: 'white',  name: '白靈環',   color: '#f2f2f2', mult: 0.10, minLevel: 10,  atk: 0.10, hp: 0.10, css: 't-white'  },
    { key: 'yellow', name: '黃靈環',   color: '#ffd93d', mult: 0.25, minLevel: 20,  atk: 0.25, hp: 0.25, css: 't-yellow' },
    { key: 'violet', name: '紫靈環',   color: '#b06bff', mult: 0.60, minLevel: 30,  atk: 0.60, hp: 0.60, css: 't-violet' },
    { key: 'black',  name: '黑靈環',   color: '#3a3a46', mult: 1.50, minLevel: 40,  atk: 1.50, hp: 1.50, css: 't-black'  },
    { key: 'red',    name: '紅靈環', color: '#ff4d5e', mult: 4.00, minLevel: 50,  atk: 4.00, hp: 4.00, css: 't-red'    },
  ];
  const TIER_BY_KEY = Object.fromEntries(RING_TIERS.map((t) => [t.key, t]));

  /* ---------- 靈印（角色）----------
   * role：atk 強攻 / ctrl 控制 / def 防禦 / sup 輔助
   * skill 由 battle.js 依 role 實作，這裡只給倍率與描述
   */
  const SOULS = [
    { id: 'haotian',  name: '巨靈槌',     emoji: '🔨', role: 'atk',  star: 3, atk: 16, hp: 130, def: 6,  spd: 92,  skillName: '巨靈九式',   skillText: '對全體敵人造成 200% 攻擊傷害' },
    { id: 'phoenix',  name: '赤焰鳶',   emoji: '🔥', role: 'atk',  star: 4, atk: 17, hp: 105, def: 5,  spd: 104, skillName: '焰羽燎原',   skillText: '對單體造成 200% 傷害並灼燒' },
    { id: 'bluemoss', name: '青藤',     emoji: '🌿', role: 'ctrl', star: 3, atk: 10, hp: 140, def: 8,  spd: 96,  skillName: '藤蔓纏繞',   skillText: '單體 60% 傷害，40% 機率暈眩 1 回合' },
    { id: 'fox',      name: '惑心狐',   emoji: '🦊', role: 'ctrl', star: 4, atk: 11, hp: 118, def: 6,  spd: 112, skillName: '惑心領域',   skillText: '全體 45% 傷害，命中者減速 30%' },
    { id: 'turtle',   name: '玄甲龜',     emoji: '🐢', role: 'def',  star: 4, atk: 8,  hp: 240, def: 16, spd: 78,  skillName: '甲冑真身',   skillText: '嘲諷 1 回合，全隊獲得護盾' },
    { id: 'bear',     name: '鐵背熊', emoji: '🐻', role: 'def',  star: 3, atk: 12, hp: 210, def: 13, spd: 82,  skillName: '震山咆哮',   skillText: '嘲諷並降低敵方攻擊 20%' },
    { id: 'tower',    name: '琉璃塔', emoji: '🗼', role: 'sup',  star: 5, atk: 9,  hp: 130, def: 7,  spd: 108, skillName: '琉璃灌頂',   skillText: '全隊攻擊 +40%、回復 25% 生命' },
    { id: 'sausage',  name: '甘露囊',   emoji: '🌭', role: 'sup',  star: 2, atk: 7,  hp: 110, def: 5,  spd: 100, skillName: '甘露回春', skillText: '回復生命最低的隊友 40% 生命' },
    { id: 'nether',   name: '幽影貓',   emoji: '🐈', role: 'atk',  star: 4, atk: 19, hp: 96,  def: 4,  spd: 118, skillName: '影襲爪',     skillText: '對單體造成 230% 傷害' },
    { id: 'seagod',   name: '怒潮戟', emoji: '🔱', role: 'atk',  star: 5, atk: 22, hp: 150, def: 9,  spd: 110, skillName: '怒潮席捲',   skillText: '全體 110% 傷害，無視 30% 防禦' },
  ];
  const SOUL_BY_ID = Object.fromEntries(SOULS.map((s) => [s.id, s]));

  const ROLE_LABEL = { atk: '強攻', ctrl: '控制', def: '防禦', sup: '輔助' };
  const ROLE_COLOR = { atk: '#ff8a5b', ctrl: '#b06bff', def: '#6ea8ff', sup: '#57d98b' };

  /* ---------- 靈獸（獵靈場）----------
   * tier 決定掉落的靈環年份；reqLevel 是建議等級（低於會被勸退）
   */
  const BEASTS = [
    { id: 'baboon', name: '嘯風猿',     emoji: '🐒', tier: 'white',  year: '十年',   element: 'wind',   hp: 220,  atk: 12,  reqLevel: 10, cdSec: 18 },
    { id: 'mandala', name: '纏魂藤蛇',  emoji: '🐍', tier: 'yellow', year: '百年',   element: 'wood',   hp: 640,  atk: 26,  reqLevel: 20, cdSec: 30 },
    { id: 'spider', name: '織影蛛',   emoji: '🕷', tier: 'violet', year: '千年',   element: 'poison', hp: 2400, atk: 62,  reqLevel: 30, cdSec: 60 },
    { id: 'darkbear', name: '暗金裂爪熊', emoji: '🐾', tier: 'black', year: '萬年',   element: 'earth',  hp: 6200, atk: 118, reqLevel: 40, cdSec: 90 },
    { id: 'whale',  name: '深海巨鯨',   emoji: '🐋', tier: 'red',    year: '十萬年', element: 'water',  hp: 16000, atk: 210, reqLevel: 50, cdSec: 120 },
  ];
  const ELEMENT_LABEL = { wind: '風', wood: '木', poison: '毒', earth: '土', water: '水' };
  const ELEMENT_COLOR = { wind: '#5ad8ff', wood: '#57d98b', poison: '#b06bff', earth: '#e0a458', water: '#6ea8ff' };
  const BEAST_BY_ID = Object.fromEntries(BEASTS.map((b) => [b.id, b]));

  /* ---------- 關卡場景 ---------- */
  const STAGE_AREAS = [
    '青岩學院 · 後山', '幽篁林 · 外圍', '鐵砧城 · 競技場', '霜火雙泉',
    '潮汐島 · 試煉之路', '靈印城 · 擂台', '斷刃之城', '深淵 · 裂隙',
  ];
  function areaFor(stage) { return STAGE_AREAS[Math.floor((stage - 1) / 10) % STAGE_AREAS.length]; }

  /* ---------- 成長公式 ---------- */
  const VERSION = '1.9.0';        // 1.4.0 = 去識別化改名 / 英文預設 i18n / GamePix SDK
  const MAX_LEVEL = 100;          // GDD：百級神祇
  const RING_SLOTS_PER_LEVEL = 10;  // 每 10 級開 1 個靈環槽
  const MAX_RING_SLOTS = 9;         // 單一靈印最多 9 槽（GDD）
  const RING_ORDER = ['white', 'yellow', 'violet', 'black', 'red'];  // 合成階梯
  const RING_MERGE_COUNT = 3;       // 3 個同階 → 1 個高一階
  const BASE_KILLS_PER_STAGE = 8;           // 每關殺 8 隻小怪出 BOSS（放置遊戲不要拖）
  const AUTO_BOSS_DELAY = 1800;            // 清完小怪後幾毫秒自動挑戰 BOSS
  /* 橡皮筋難度：怪物數值再高也被隊伍現況夾住，避免「某關之後永遠打不死」 */
  const BAND = {
    waveSec: 2.5,        // 小怪血量 ≤ 隊伍 DPS × 2.5 秒
    bossSec: 15,         // BOSS 血量 ≤ 隊伍 DPS × 15 秒
    atkOfWeakestHp: 0.10, // 敵人單下 ≤ 最脆隊友血量的 10%（約 10 下才倒）
    defOfTeamAtk: 0.12,  // 敵人防禦 ≤ 隊伍總攻擊的 12%（否則減傷吃光傷害）
    bossFailStep: 0.82,  // 每次挑戰失敗，BOSS 血量上限再 ×0.82（最多 5 次）
    bossFailMax: 5,
    bossHealMax: 2,      // 單場最多回血 2 次，保證打得死
    /* 深度放寬：第 100 關之後，每多 100 關，怪物上限 ×2（上限 ×4）
       讓「關卡數字」重新等於難度，不然第 800 關和第 104 關一樣軟 */
    widenFrom: 100,
    widenPerStage: 150,
    widenMax: 1.4,
    /* 戰力換速度：實際 DPS 超過該關所需 DPS 時，戰鬥時間可縮到 60%
       （變強 1.67 倍以內換得到速度；再往上只影響能不能打更深的關） */
    speedFloor: 0.6,
  };
  const AUTO_HUNT_DELAY = 2500;            // 卡等時幾毫秒自動去獵靈
  const PULL_COST_TICKET = 1;
  const PULL_COST_DIAMOND = 100;
  const PULL10_COST_TICKET = 10;
  const PULL10_COST_DIAMOND = 900;

  function expNeed(level) { return Math.round(8 * Math.pow(level, 1.3) + 6 * level); }
  /* 等級上限改成固定 100（GDD 模型）；靈環不再解鎖等級，而是每 10 級開一格 */
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
  ];

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
      name: isBoss
        ? (typeof I18N !== 'undefined' && I18N.lang === 'en' ? `Stage ${stage} Boss` : `第 ${stage} 關守關靈獸`)
        : (typeof I18N !== 'undefined' && I18N.lang === 'en' ? 'Wild beast' : '野生靈獸'),
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
  /* ---------- 靈骨（可裝備，裝備者 100%、同隊其他靈印 30% 光環）---------- */
  const BONES = [
    { id: 'wind',  name: '外附靈骨 · 疾風', slot: 'speed', atk: 0.00, hp: 0.00, def: 0.00, spd: 0.12, css: 'bone-cyan',  desc: '速度 +12%' },
    { id: 'giant', name: '靈骨 · 巨力',     slot: 'atk',   atk: 0.14, hp: 0.00, def: 0.00, spd: 0.00, css: 'bone-red',   desc: '攻擊 +14%' },
    { id: 'life',  name: '靈骨 · 生命',     slot: 'hp',    atk: 0.00, hp: 0.18, def: 0.00, spd: 0.00, css: 'bone-green', desc: '生命 +18%' },
    { id: 'armor', name: '靈骨 · 堅甲',     slot: 'def',   atk: 0.00, hp: 0.00, def: 0.20, spd: 0.00, css: 'bone-blue',  desc: '防禦 +20%' },
    { id: 'king',  name: '靈骨 · 王者',     slot: 'all',   atk: 0.08, hp: 0.08, def: 0.08, spd: 0.04, css: 'bone-gold',  desc: '全屬性 +8%（速度 +4%）' },
  ];
  const BONE_BY_ID = Object.fromEntries(BONES.map((b) => [b.id, b]));
  const BONE_AURA = 0.3;          // 光環：給同隊其他靈印的比例
  const PULL_BONES = BONES;       // 抽卡池：15% 出靈骨（state.rollOne 會讀這個）
  const STAR_COIN = [0, 0, 0, 0, 0, 0];   // 佔位，實際成本用 starUpCoin()

  function bonePullWeight() { return 3; }   // 每種靈骨的抽卡權重

  /* ---------- 靈幣抽靈骨（靈幣的唯一出口）----------
   * 成本隨「已用靈幣抽過幾次」成長，越抽越貴 → 天然上限，不會變成無限印鈔。
   * 每次必得 1 塊（不是機率），但王者比較稀有。 */
  /* ---------- 戰鬥常數（速度曲線 / 防禦減傷）---------- */
  const COMBAT = {
    spdK: 617,        // 速度半飽和點：原本速度 617 就撞到 tick 上限
    defK: 300,        // 減傷常數：def / (def + 300 × 等級)
    defCap: 0.35,     // 單邊最多減傷 35%
    critBase: 0.10,   // 基礎爆擊 10%（命印再加）
    critMult: 1.8,
  };

  const COIN_PULL = {
    base: 2000,
    growth: 1.35,
    weights: { wind: 26, giant: 26, life: 22, armor: 20, king: 6 },
  };
  function coinPullCost(pulls) {
    return Math.round(COIN_PULL.base * Math.pow(COIN_PULL.growth, Math.max(0, pulls | 0)));
  }
  function starUpBones(star) { return Math.max(1, star - 2); }            // 3→4:1、4→5:2
  function starUpCoin(star) { return star <= 3 ? 1200 : 6000; }

  /* ---------- 靈印獨立等級（靈幣升級，可超越玩家等級 10 級）---------- */
  const SOUL_LV = { maxAhead: 20, max: 150, base: 300, pow: 1.9 };
  function soulLevelCost(level) {
    return Math.round(SOUL_LV.base * Math.pow(Math.max(1, level), SOUL_LV.pow));
  }

  /* ---------- 成就（永久加成，每項 +0.5% 全屬性）---------- */
  const ACH_BONUS = 0.005;
  const ACHIEVEMENTS = [
    { id: 'stage20',  name: '初入魂道',   desc: '推進到第 20 關',      test: (s) => s.bestStage >= 20 },
    { id: 'stage50',  name: '站穩腳跟',   desc: '推進到第 50 關',      test: (s) => s.bestStage >= 50 },
    { id: 'stage100', name: '百關之志',   desc: '推進到第 100 關',     test: (s) => s.bestStage >= 100 },
    { id: 'stage200', name: '深淵行者',   desc: '推進到第 200 關',     test: (s) => s.bestStage >= 200 },
    { id: 'stage500', name: '無盡之路',   desc: '推進到第 500 關',     test: (s) => s.bestStage >= 500 },
    { id: 'reb1',     name: '第一次轉生', desc: '完成 1 次轉生',        test: (s) => (s.rebirths || 0) >= 1 },
    { id: 'reb10',    name: '輪迴十次',   desc: '完成 10 次轉生',       test: (s) => (s.rebirths || 0) >= 10 },
    { id: 'marks100', name: '命印百枚',   desc: '累積 100 枚命印',      test: (s) => (s.marks || 0) >= 100 },
    { id: 'souls5',   name: '五人小隊',   desc: '上陣 5 名靈印',        test: (s) => (s.team || []).length >= 5 },
    { id: 'star5',    name: '五星圓滿',   desc: '任一靈印升到 5★',      test: (s) => s.souls.some((x) => x.star >= 5) },
    { id: 'bones5',   name: '靈骨收藏家', desc: '持有 5 塊靈骨',        test: (s) => (s.bones || []).length >= 5 },
    { id: 'rings45',  name: '環滿全身',   desc: '全隊裝備 45 個靈環',   test: (s) => s.souls.reduce((a, x) => a + (x.rings || []).length, 0) >= 45 },
  ];

  /* ---------- 里程碑獎勵（每 50 關給十萬年環）---------- */
  const MILESTONE = { every: 50, tier: 'red' };

  /* ---------- 每日任務（每天 3 條，領鑽石）---------- */
  const DAILY = [
    { id: 'idle',  need: 10, label: '掛機 10 分鐘',  unit: '分', reward: { diamonds: 60 } },
    { id: 'hunt',  need: 3,  label: '獵靈 3 次',     unit: '次', reward: { diamonds: 60 } },
    { id: 'merge', need: 3,  label: '合成靈環 3 次', unit: '次', reward: { diamonds: 80 } },
  ];

  /* ---------- 每日簽到（7 天一輪，連續簽到 streak 會保留）---------- */
  const CHECKIN = [
    { day: 1, kind: 'coins',    amount: 3000,  label: '靈幣 3000',        emoji: '🪙' },
    { day: 2, kind: 'diamonds', amount: 120,   label: '鑽石 120',         emoji: '💎' },
    { day: 3, kind: 'tickets',  amount: 2,     label: '覺醒券 2',         emoji: '🎟️' },
    { day: 4, kind: 'coins',    amount: 12000, label: '靈幣 12000',       emoji: '🪙' },
    { day: 5, kind: 'ring',     tier: 'yellow', label: '黃靈環',        emoji: '🟡' },
    { day: 6, kind: 'diamonds', amount: 500,   label: '鑽石 500',         emoji: '💎' },
    { day: 7, kind: 'gift',     ring: 'black', tickets: 3, diamonds: 888, label: '黑靈環＋888💎', emoji: '🎁' },
  ];

  /* ---------- 轉生（命印）----------
   * 條件：歷史最高關卡 ≥ 20
   * 收益：floor(bestStage/5) + floor(level/10) 點命印
   * 每點命印：全屬性 +6%（速度 +2%）、靈幣與經驗 +4%
   */
  const REBIRTH = {
    minStage: 20,
    perMark: { atk: 0.06, hp: 0.06, def: 0.06, spd: 0.02, income: 0.04 },
    startLevelPerRebirth: 5,   // 每次轉生後起始等級 +5（重跑會越來越快）
    startLevelMax: 60,
    /* 命印不再加速度（速度有硬上限，加了也是白加），改成爆擊率 */
    critPerMark: 0.0015,       // 每點 +0.15% 爆擊
    critMax: 0.40,             // 上限 +40%
  };

  /* 轉生收益只看「本輪推進深度」，不看歷史最高：
     以前用 bestStage，因為它不會降 → 每次轉生固定 +30，等於按鈕產幣。
     現在必須刷新紀錄（bestStage > lastRebirthBest）才能轉，deep 才是獎勵來源。 */
  function rebirthGain(bestStage, level, lastBest) {
    if (!bestStage || bestStage < REBIRTH.minStage) return 0;
    const deep = Math.max(0, bestStage - (lastBest || 0));
    if (deep < 1) return 0;                       // 沒刷新紀錄不給轉
    return Math.floor(deep / 5) + Math.floor((level || 1) / 20);
  }

  /* ---------- 兌換碼 ---------- */
  const CODES = {
    VIP666:    { diamonds: 8888,  tickets: 5,  msg: '鑽石 8888、覺醒券 5' },
    DOULUO888: { diamonds: 18888, ring: 'black', msg: '鑽石 18888、黑靈環 ×1' },
    TANG3:     { coins: 88888, exp: 6000, msg: '靈幣 88888、經驗 6000' },
  };

  global.CFG = {
    RING_TIERS, TIER_BY_KEY, SOULS, SOUL_BY_ID, ROLE_LABEL, ROLE_COLOR,
    BEASTS, BEAST_BY_ID, STAGE_AREAS, areaFor,
    VERSION, MAX_LEVEL, RING_SLOTS_PER_LEVEL, MAX_RING_SLOTS,
    RING_SKILL, RESONANCE, TRUE_BODY, ELEMENT_LABEL, ELEMENT_COLOR,
    RING_ORDER, RING_MERGE_COUNT,
    BASE_KILLS_PER_STAGE, AUTO_BOSS_DELAY, AUTO_HUNT_DELAY, BAND,
    REBIRTH, rebirthGain, stageMul,
    PULL_COST_TICKET, PULL_COST_DIAMOND, PULL10_COST_TICKET, PULL10_COST_DIAMOND,
    expNeed, levelCap, ringSlots, enemyStats, killReward, offlinePerMinute,
    PULL_POOL, PULL_BONES, BONES, BONE_BY_ID, BONE_AURA, bonePullWeight,
    starUpBones, starUpCoin, CHECKIN, CODES, COIN_PULL, coinPullCost, COMBAT, SOUL_LV, soulLevelCost, DAILY, ACHIEVEMENTS, ACH_BONUS, MILESTONE,
  };
})(window);
