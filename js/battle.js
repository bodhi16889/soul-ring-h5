/* ==========================================================================
 * battle.js — ATB 自動戰鬥、技能、關卡推進、獵魂
 * 支援一波 1–3 隻敵人：群攻武魂（強攻系）打全體才有意義。
 * Boss 被動：血量 ≤40% 狂暴一次、每 4 次行動回血 10%。
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
    enemies: [],
    ticker: 0,
    huntBeast: null,
    pendingBoss: false,
    autoReviveAt: 0,
    waveNo: 0,
  };

  /* 舊介面：Battle.state.enemy / snapshot().enemy 仍回傳「第一隻活著的敵人」 */
  Object.defineProperty(B, 'enemy', {
    get() {
      const alive = B.enemies.filter((e) => e.alive);
      return alive[0] || B.enemies[0] || null;
    },
  });

  const listeners = new Set();
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(type, data) {
    const ev = Object.assign({ type, at: Date.now() }, data || {});
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

  /* ---------- 建立敵人（一波 1–3 隻）---------- */
  function waveSize(kind) {
    if (kind === 'boss' || kind === 'hunt') return 1;
    const stage = State.data.stage;
    if (stage < 3) return 1;
    const r = Math.random();
    if (stage < 8) return r < 0.75 ? 1 : 2;
    return r < 0.5 ? 1 : (r < 0.85 ? 2 : 3);
  }

  function spawnWave(kind) {
    B.waveNo++;
    if (kind === 'hunt') {
      const beast = B.huntBeast;
      B.enemies = [{
        id: beast.id, name: beast.name, emoji: beast.emoji,
        maxHp: beast.hp, hp: beast.hp, atk: beast.atk, def: Math.round(beast.atk * 0.35),
        spd: 88, gauge: 0, stun: 0, alive: true, boss: true, hunt: true, acts: 0, enraged: false,
      }];
      return;
    }
    const isBoss = kind === 'boss';
    const st = CFG.enemyStats(State.data.stage, isBoss);
    const n = waveSize(kind);
    // 多隻時單隻較弱（總血量約 1.3 倍），才不會讓群攻變成唯一解
    const hpScale = isBoss ? 1 : (n > 1 ? 0.66 : 1);
    const atkScale = isBoss ? 1 : (n > 1 ? 0.8 : 1);
    B.enemies = Array.from({ length: n }, (_, i) => {
      const hp = Math.round(st.hp * hpScale);
      return {
        id: 'e' + B.waveNo + '_' + i,
        name: n > 1 ? `${st.name} ${i + 1}` : st.name,
        emoji: st.emoji,
        maxHp: hp, hp,
        atk: Math.round(st.atk * atkScale),
        def: st.def,
        spd: st.spd + i * 3,
        gauge: Math.random() * 0.25,
        stun: 0, alive: true, boss: !!st.boss, acts: 0, enraged: false,
      };
    });
  }

  function aliveEnemies() { return B.enemies.filter((e) => e.alive); }

  /* 自動戰鬥聚焦：打血最少的（清怪最快） */
  function targetEnemy() {
    const alive = aliveEnemies();
    if (!alive.length) return null;
    let best = alive[0];
    for (const e of alive) if (e.hp < best.hp) best = e;
    return best;
  }

  /* ---------- 對外操作 ---------- */
  function init() {
    buildTeam();
    B.mode = 'farm';
    B.pendingBoss = false;
    if (!aliveEnemies().length) spawnWave('farm');
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
    spawnWave('boss');
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
    spawnWave('hunt');
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
    spawnWave('farm');
  }

  /* ---------- 主循環 ---------- */
  function tick() {
    if (!B.enemies.length) spawnWave(B.mode === 'hunt' ? 'hunt' : (B.mode === 'boss' ? 'boss' : 'farm'));

    // 全滅 → 2 秒後自動復活（放置遊戲不要卡死）
    if (!B.units.some((u) => u.alive)) {
      if (!B.autoReviveAt) {
        B.autoReviveAt = Date.now() + 2000;
        emit('wipe', { mode: B.mode });
      }
      if (Date.now() >= B.autoReviveAt) {
        B.autoReviveAt = 0;
        reviveTeam(true);
        if (B.mode === 'boss') { B.mode = 'farm'; spawnWave('farm'); }
        if (B.mode === 'hunt') { B.mode = 'farm'; B.huntBeast = null; spawnWave('farm'); }
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
      if (!aliveEnemies().length) break;
      unitAct(u);
      if (!aliveEnemies().length) break;
    }

    // 敵方行動（每隻各自跑行動條）
    for (const e of B.enemies) {
      if (!e.alive) continue;
      e.gauge += (e.spd / 100) * ATB_SPEED;
      if (e.gauge < 1) continue;
      e.gauge = 0;
      if (e.stun > 0) { e.stun--; emit('stun', { who: 'enemy', enemyId: e.id }); continue; }
      if (e.boss) bossAct(e); else enemyAct(e);
    }
  }

  /* ---------- 我方行動 ---------- */
  function unitAct(u) {
    if (u.buffTurns > 0) { u.buffTurns--; if (u.buffTurns === 0) u.buffAtk = 0; }
    if (u.mp >= SKILL_MP) { u.mp = 0; castSkill(u); return; }
    const t = targetEnemy();
    if (!t) return;
    const dmg = calcDamage(u.atk * (1 + u.buffAtk), t.def, 0.9, 1.1);
    hitEnemy(t, dmg, u, false);
    u.mp = Math.min(SKILL_MP, u.mp + MP_PER_ACTION);
  }

  function castSkill(u) {
    emit('skill', { unit: u, role: u.role, name: (CFG.SOUL_BY_ID[u.id] || {}).skillName || '魂技' });

    if (u.role === 'atk') {
      // 強攻系：全體 200%（多波時才看得出價值）
      const targets = aliveEnemies();
      for (const e of targets) {
        const dmg = calcDamage(u.atk * (1 + u.buffAtk) * 2.0, e.def, 0.95, 1.05);
        hitEnemy(e, dmg, u, true);
      }
      if (targets.length > 1) emit('aoe', { count: targets.length });
    } else if (u.role === 'ctrl') {
      const t = targetEnemy();
      if (t) {
        hitEnemy(t, calcDamage(u.atk * (1 + u.buffAtk) * 1.2, t.def, 0.95, 1.05), u, true);
        if (Math.random() < 0.45 && t.alive) {
          t.stun = Math.max(t.stun, 1);
          emit('stun', { who: 'enemy', enemyId: t.id });
        }
      }
    } else if (u.role === 'def') {
      const shield = Math.round(u.maxHp * 0.22);
      B.units.forEach((x) => { if (x.alive) x.shield += shield; });
      u.taunt = 2;
      emit('shield', { unit: u, shield });
      const t = targetEnemy();
      if (t) hitEnemy(t, calcDamage(u.atk * 0.8, t.def, 0.9, 1.1), u, false);
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

  function hitEnemy(enemy, dmg, u, isSkill) {
    if (!enemy || !enemy.alive) return;
    enemy.hp -= dmg;
    emit('hit', {
      side: 'enemy', enemyId: enemy.id, amount: dmg, crit: isSkill, unit: u,
      hp: Math.max(0, enemy.hp), maxHp: enemy.maxHp,
    });
    if (enemy.hp <= 0) { enemy.hp = 0; enemy.alive = false; onEnemyDead(enemy); }
  }

  /* ---------- Boss 被動 ---------- */
  function bossAct(e) {
    e.acts++;
    if (!e.enraged && e.hp / e.maxHp <= 0.4) {
      e.enraged = true;
      e.atk = Math.round(e.atk * 1.35);
      emit('bossRage', { name: e.name, enemyId: e.id });
    }
    // 只在血量低於 70% 時、每 5 次行動回 8%：避免低戰力玩家被無限回血鎖死
    if (e.acts % 5 === 0 && e.hp < e.maxHp * 0.7) {
      const heal = Math.round(e.maxHp * 0.08);
      e.hp = Math.min(e.maxHp, e.hp + heal);
      emit('bossHeal', { name: e.name, enemyId: e.id, amount: heal, hp: e.hp, maxHp: e.maxHp });
      return;
    }
    enemyAct(e);
  }

  /* ---------- 敵方行動 ---------- */
  function enemyAct(e) {
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
    if (left > 0) {
      emit('hit', { side: 'team', unit: target, amount: left, maxHp: target.maxHp, hp: Math.max(0, target.hp) });
    }
    if (target.hp <= 0) {
      target.hp = 0; target.alive = false;
      emit('down', { unit: target });
    }
  }

  /* ---------- 擊殺結算 ---------- */
  function onEnemyDead(enemy) {
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
      left: aliveEnemies().length, enemyId: enemy && enemy.id,
    });
    if (expRes.levelUps) emit('levelup', { level: s.level });

    if (isBoss) {
      s.stage++;
      s.bestStage = Math.max(s.bestStage, s.stage);
      s.kills = 0;
      B.mode = 'farm';
      emit('stageClear', { stage: s.stage });
      spawnWave('farm');
      return;
    }

    // 這一波清完才出下一波；還有敵人就不重生
    if (aliveEnemies().length) return;

    if (s.kills >= CFG.BASE_KILLS_PER_STAGE && !B.pendingBoss) {
      B.pendingBoss = true;
      emit('bossReady', { stage: s.stage });
    }
    B.units.forEach((u) => {
      if (u.alive) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.12);
    });
    spawnWave('farm');
  }

  /* ---------- 傷害公式 ---------- */
  function calcDamage(atk, def, lo, hi) {
    const base = atk * (lo + Math.random() * (hi - lo)) - def * 0.4;
    const crit = Math.random() < 0.1;
    return Math.max(1, Math.round(base * (crit ? 1.8 : 1)));
  }

  function snapshot() {
    const alive = aliveEnemies();
    return {
      mode: B.mode,
      units: B.units.map((u) => ({ ...u })),
      enemies: B.enemies.map((e) => ({ ...e })),
      enemy: alive[0] ? { ...alive[0] } : (B.enemies[0] ? { ...B.enemies[0] } : null),
      pendingBoss: B.pendingBoss,
      kills: State.data.kills,
      needed: CFG.BASE_KILLS_PER_STAGE,
      stage: State.data.stage,
    };
  }

  global.Battle = {
    init, start, stop, refreshTeam, challengeBoss, hunt, backToFarm, reviveTeam,
    on, snapshot, spawnWave, targetEnemy,
    /* 測試用內部鉤子（不影響遊戲流程） */
    unitAct, castSkill, hitEnemy, bossAct, enemyAct,
    get state() { return B; },
  };
})(window);
