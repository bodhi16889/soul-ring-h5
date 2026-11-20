/* ==========================================================================
 * battle.js — ATB 自動戰鬥、技能、關卡推進、獵魂
 * 只負責「算出發生什麼事」，畫面交給 ui.js（事件 → UI 更新 / 飄字 / 光圈）。
 * ========================================================================== */
(function (global) {
  'use strict';

  const TICK_MS = 120;
  const ATB_SPEED = 1.7;          // 行動條填充速度（越大越快）
  const SKILL_MP = 100;
  const MP_PER_ACTION = 26;

  const B = {
    mode: 'farm',                 // farm | boss | hunt
    running: false,
    units: [],
    enemy: null,
    ticker: 0,
    huntBeast: null,
    events: [],
    pendingBoss: false,
    autoReviveAt: 0,
    defeatFlash: 0,
  };

  const listeners = new Set();
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(type, data) {
    const ev = Object.assign({ type, at: Date.now() }, data || {});
    B.events.push(ev);
    if (B.events.length > 60) B.events.shift();
    listeners.forEach((fn) => { try { fn(ev); } catch (e) { /* UI 不該弄死戰鬥 */ } });
  }

  /* ---------- 建立我方 ---------- */
  function buildTeam() {
    B.units = State.teamSouls().map((soul) => {
      const st = State.soulStats(soul);
      return {
        id: soul.id, name: st.name, emoji: st.emoji, role: st.role,
        maxHp: st.hp, hp: st.hp, atk: st.atk, def: st.def, spd: st.spd,
        gauge: Math.random() * 0.3, mp: 0, shield: 0, alive: true,
        buffAtk: 0, buffTurns: 0, taunt: 0,
      };
    });
  }

  /* ---------- 建立敵人 ---------- */
  function spawnEnemy(kind) {
    if (kind === 'hunt') {
      const beast = B.huntBeast;
      B.enemy = {
        id: beast.id, name: beast.name, emoji: beast.emoji,
        maxHp: beast.hp, hp: beast.hp, atk: beast.atk, def: Math.round(beast.atk * 0.35),
        spd: 88, gauge: 0, stun: 0, alive: true, boss: true, hunt: true,
      };
      return;
    }
    const isBoss = kind === 'boss';
    const st = CFG.enemyStats(State.data.stage, isBoss);
    B.enemy = {
      id: 'e' + Date.now().toString(36), name: st.name, emoji: st.emoji,
      maxHp: st.hp, hp: st.hp, atk: st.atk, def: st.def,
      spd: st.spd, gauge: 0, stun: 0, alive: true, boss: st.boss,
    };
  }

  /* ---------- 對外操作 ---------- */
  function init() {
    buildTeam();
    B.mode = 'farm';
    B.pendingBoss = false;
    if (!B.enemy || !B.enemy.alive) spawnEnemy('farm');
    start();
  }

  function start() {
    if (B.running) return;
    B.running = true;
    B.ticker = setInterval(tick, TICK_MS);
  }
  function stop() {
    B.running = false;
    if (B.ticker) { clearInterval(B.ticker); B.ticker = 0; }
  }

  function refreshTeam() {
    // 陣容／武魂變動時重建，保留當前敵人
    const old = new Map(B.units.map((u) => [u.id, u]));
    buildTeam();
    B.units.forEach((u) => {
      const prev = old.get(u.id);
      if (prev) { u.hp = Math.min(u.maxHp, Math.max(1, prev.hp / prev.maxHp * u.maxHp)); u.mp = prev.mp; }
    });
  }

  function challengeBoss() {
    if (!B.pendingBoss) return { ok: false, msg: '先清掉 10 隻小怪' };
    if (!State.teamSouls().length) return { ok: false, msg: '沒有上陣武魂' };
    B.mode = 'boss';
    B.pendingBoss = false;
    spawnEnemy('boss');
    reviveTeam(false);
    emit('bossStart', { stage: State.data.stage });
    return { ok: true };
  }

  function hunt(beastId) {
    const beast = CFG.BEAST_BY_ID[beastId];
    if (!beast) return { ok: false, msg: '找不到魂獸' };
    if (B.mode === 'hunt') return { ok: false, msg: '正在獵魂中' };
    const next = State.data.cd[beastId] || 0;
    if (Date.now() < next) return { ok: false, msg: `冷卻中，還要 ${Math.ceil((next - Date.now()) / 1000)} 秒` };
    if (State.data.level < beast.reqLevel) return { ok: false, msg: `需等級 ${beast.reqLevel} 才能挑戰` };
    B.huntBeast = beast;
    B.mode = 'hunt';
    spawnEnemy('hunt');
    reviveTeam(false);
    emit('huntStart', { beast });
    return { ok: true };
  }

  function reviveTeam(healFull) {
    B.units.forEach((u) => {
      u.alive = true;
      u.hp = healFull ? u.maxHp : Math.max(1, Math.round(u.maxHp * 0.6));
      u.gauge = Math.random() * 0.2;
      u.shield = 0;
    });
  }

  function backToFarm() {
    B.mode = 'farm';
    B.huntBeast = null;
    spawnEnemy('farm');
  }

  /* ---------- 主循環 ---------- */
  function tick() {
    if (B.mode === 'hunt' && !B.enemy) { backToFarm(); return; }
    if (!B.enemy) spawnEnemy(B.mode === 'boss' ? 'boss' : 'farm');

    // 全滅 → 2 秒後自動復活（放置遊戲不要卡死）
    if (!B.units.some((u) => u.alive)) {
      if (!B.autoReviveAt) {
        B.autoReviveAt = Date.now() + 2000;
        emit('wipe', { mode: B.mode });
      }
      if (Date.now() >= B.autoReviveAt) {
        B.autoReviveAt = 0;
        reviveTeam(true);
        if (B.mode === 'boss') { B.mode = 'farm'; spawnEnemy('farm'); }
        if (B.mode === 'hunt') { B.mode = 'farm'; B.huntBeast = null; spawnEnemy('farm'); }
        emit('revived', {});
      }
      return;
    }

    // 我方行動
    for (const u of B.units) {
      if (!u.alive) continue;
      u.gauge += (u.spd / 100) * ATB_SPEED;
      if (u.gauge < 1) continue;
      u.gauge = 0;
      if (!B.enemy || !B.enemy.alive) continue;
      unitAct(u);
      if (!B.enemy || !B.enemy.alive) break;
    }

    // 敵方行動
    if (B.enemy && B.enemy.alive) {
      B.enemy.gauge += (B.enemy.spd / 100) * ATB_SPEED;
      if (B.enemy.gauge >= 1) {
        B.enemy.gauge = 0;
        if (B.enemy.stun > 0) {
          B.enemy.stun--;
          emit('stun', { who: 'enemy' });
        } else {
          enemyAct();
        }
      }
    }

    // 擊殺處理（在函式內 emit）
  }

  /* ---------- 我方行動 ---------- */
  function unitAct(u) {
    if (u.buffTurns > 0) { u.buffTurns--; if (u.buffTurns === 0) u.buffAtk = 0; }
    if (u.mp >= SKILL_MP) {
      u.mp = 0;
      castSkill(u);
      return;
    }
    const dmg = calcDamage(u.atk * (1 + u.buffAtk), B.enemy.def, 0.9, 1.1);
    hitEnemy(dmg, u, false);
    u.mp = Math.min(SKILL_MP, u.mp + MP_PER_ACTION);
  }

  function castSkill(u) {
    const e = B.enemy;
    emit('skill', { unit: u, name: (CFG.SOUL_BY_ID[u.id] || {}).skillName || '魂技' });
    if (u.role === 'atk') {
      const dmg = calcDamage(u.atk * (1 + u.buffAtk) * 2.0, e.def, 0.95, 1.05);
      hitEnemy(dmg, u, true);
    } else if (u.role === 'ctrl') {
      const dmg = calcDamage(u.atk * (1 + u.buffAtk) * 1.2, e.def, 0.95, 1.05);
      hitEnemy(dmg, u, true);
      if (Math.random() < 0.45 && e.alive) { e.stun = Math.max(e.stun, 1); emit('stun', { who: 'enemy' }); }
    } else if (u.role === 'def') {
      const shield = Math.round(u.maxHp * 0.22);
      B.units.forEach((x) => { if (x.alive) x.shield += shield; });
      u.taunt = 2;
      emit('shield', { unit: u, shield });
      const dmg = calcDamage(u.atk * 0.8, e.def, 0.9, 1.1);
      hitEnemy(dmg, u, false);
    } else {
      // 輔助：全隊回復 + 攻擊加成
      B.units.forEach((x) => {
        if (!x.alive) return;
        const heal = Math.round(x.maxHp * 0.28);
        x.hp = Math.min(x.maxHp, x.hp + heal);
        x.buffAtk = 0.4; x.buffTurns = 3;
        emit('heal', { unit: x, amount: heal });
      });
    }
  }

  function hitEnemy(dmg, u, isSkill) {
    const e = B.enemy;
    if (!e || !e.alive) return;
    e.hp -= dmg;
    emit('hit', { side: 'enemy', amount: dmg, crit: isSkill, unit: u, hp: Math.max(0, e.hp), maxHp: e.maxHp });
    if (e.hp <= 0) {
      e.hp = 0; e.alive = false;
      onEnemyDead();
    }
  }

  /* ---------- 敵方行動 ---------- */
  function enemyAct() {
    const e = B.enemy;
    const alive = B.units.filter((u) => u.alive);
    if (!alive.length) return;
    const taunters = alive.filter((u) => u.taunt > 0);
    const target = taunters.length ? taunters[0] : alive[Math.floor(Math.random() * alive.length)];
    if (target.taunt > 0) target.taunt--;
    const dmg = calcDamage(e.atk, target.def, 0.9, 1.1);
    let left = dmg;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, left);
      target.shield -= absorbed; left -= absorbed;
      if (absorbed > 0) emit('absorb', { unit: target, amount: absorbed });
    }
    target.hp -= left;
    emit('hit', { side: 'team', unit: target, amount: left, maxHp: target.maxHp, hp: Math.max(0, target.hp) });
    if (target.hp <= 0) {
      target.hp = 0; target.alive = false;
      emit('down', { unit: target });
    }
  }

  /* ---------- 擊殺結算 ---------- */
  function onEnemyDead() {
    const s = State.data;
    if (B.mode === 'hunt') {
      const beast = B.huntBeast;
      const ring = State.newRing(beast.tier);
      s.ringBag.push(ring);
      s.cd[beast.id] = Date.now() + beast.cdSec * 1000;
      s.stats.hunts++;
      emit('huntWin', { beast, ring });
      backToFarm();
      return;
    }

    const isBoss = B.mode === 'boss';
    const r = CFG.killReward(s.stage);
    const coinGain = isBoss ? r.coins * 8 : r.coins;
    const expGain = isBoss ? r.exp * 8 : r.exp;
    State.addCoins(coinGain);
    const expRes = State.addExp(s, expGain);
    s.stats.kills++;
    if (!isBoss && s.kills < CFG.BASE_KILLS_PER_STAGE) s.kills++;

    emit('kill', {
      stage: s.stage, boss: isBoss, coins: coinGain, exp: expGain,
      kills: s.kills, levelUps: expRes.levelUps || 0,
    });
    if (expRes.levelUps) emit('levelup', { level: s.level });

    if (isBoss) {
      s.stage++;
      s.bestStage = Math.max(s.bestStage, s.stage);
      s.kills = 0;
      B.mode = 'farm';
      emit('stageClear', { stage: s.stage });
    } else if (s.kills >= CFG.BASE_KILLS_PER_STAGE && !B.pendingBoss) {
      B.pendingBoss = true;
      emit('bossReady', { stage: s.stage });
    }

    // 每個小怪回復 12% 生命，避免放置久了全滅
    B.units.forEach((u) => {
      if (u.alive) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.12);
    });
    spawnEnemy(B.mode === 'boss' ? 'boss' : 'farm');
  }

  /* ---------- 傷害公式 ---------- */
  function calcDamage(atk, def, lo, hi) {
    const base = atk * (lo + Math.random() * (hi - lo)) - def * 0.4;
    const crit = Math.random() < 0.1;
    const dmg = Math.max(1, Math.round(base * (crit ? 1.8 : 1)));
    return crit ? dmg : dmg;
  }

  function snapshot() {
    return {
      mode: B.mode,
      units: B.units.map((u) => ({ ...u })),
      enemy: B.enemy ? { ...B.enemy } : null,
      pendingBoss: B.pendingBoss,
      kills: State.data.kills,
      needed: CFG.BASE_KILLS_PER_STAGE,
      stage: State.data.stage,
    };
  }

  global.Battle = {
    init, start, stop, refreshTeam, challengeBoss, hunt, backToFarm, reviveTeam,
    on, snapshot,
    get state() { return B; },
  };
})(window);
