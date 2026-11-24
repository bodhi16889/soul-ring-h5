/* ==========================================================================
 * battle.js — ATB 自動戰鬥、技能、關卡推進、獵靈
 * 支援一波 1–3 隻敵人：群攻靈印（強攻系）打全體才有意義。
 * Boss 被動：血量 ≤40% 狂暴一次、每 4 次行動回血 10%。
 * ========================================================================== */
(function (global) {
  'use strict';

  const TICK_MS = 120;
  const ATB_SPEED = 1.35;         // 行動條每秒填充量 = spd/100 * ATB_SPEED（約 0.8 秒出手一次）
  const DT = TICK_MS / 1000;
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
    autoAt: 0,
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
    if (kind === 'spire') {
      const st = State.spireStats(B.spireFloor || 1);
      B.enemies = [{
        id: 'spire' + st.floor, name: T(st.boss ? '塔守' : '塔靈'), emoji: st.boss ? '👹' : '👻',
        maxHp: st.hp, hp: st.hp, atk: st.atk, def: st.def, spd: st.spd,
        gauge: 0, stun: 0, alive: true, boss: st.boss, spire: true, acts: 0, enraged: false,
      }];
      B.spireFloor = st.floor;
      emit('spireWave', { floor: st.floor, boss: st.boss });
      return;
    }
    if (kind === 'dungeon') {
      const d = B.dungeon;
      const team = State.teamStats();
      const units = B.units.filter((u) => u.maxHp > 0);
      const weakest = Math.min.apply(null, units.map((u) => u.maxHp));
      const effDps = Math.max(1, units.reduce((a, u) => a + u.atk * actsPerSec(u.spd) * 0.85, 0));
      const st = CFG.enemyStats(State.data.stage, true);
      const hp = Math.min(Math.round(st.hp * 1.6), Math.round(effDps * CFG.DUNGEON.hpSec));
      const atk = Math.max(1, Math.round(weakest * CFG.DUNGEON.atkCap));
      B.enemies = [{
        id: 'dg_' + (d ? d.id : 'x'), name: T(d ? d.name : '副本'), emoji: d ? d.emoji : '🏰',
        maxHp: hp, hp: hp, atk: atk, def: Math.round(team.atk * 0.08), spd: 92,
        gauge: 0, stun: 0, alive: true, boss: true, dungeon: true, acts: 0, enraged: false,
      }];
      emit('dungeonWave', { id: d ? d.id : null });
      return;
    }
    if (kind === 'hunt') {
      const beast = B.huntBeast;
      /* 靈獸用固定數值（220～16000 血、12～210 攻），但隊伍在前期只有 130 血／16 攻：
         實測打嘯風猿會在全滅邊緣（13 秒打完、剩 1 血），運氣不好就全滅 → 15 秒冷卻 →
         無限重試，靈環永遠拿不到。所以靈獸也要套橡皮筋：
         血量上限 = 隊伍 DPS × 10 秒（穩贏但看得見血條在掉），
         單下傷害上限 = 最脆隊友 6%（至少 16 下才倒，不會在狩獵裡被磨死）。 */
      const units = B.units.filter((u) => u.maxHp > 0);
      const weakest = Math.min.apply(null, units.map((u) => u.maxHp));
      const effDps = Math.max(1, units.reduce((a, u) => a + u.atk * actsPerSec(u.spd) * 0.85, 0));
      const eliteMul = B.huntElite ? CFG.ELITE.hpMul : 1;
      const beastHp = Math.min(beast.hp, Math.round(effDps * 10 * eliteMul));
      const beastAtk = Math.min(beast.atk, Math.max(1, Math.round(weakest * 0.06)));
      B.enemies = [{
        id: beast.id, name: T(beast.name), emoji: beast.emoji,
        maxHp: beastHp, hp: beastHp, atk: beastAtk, def: Math.round(beast.atk * 0.35),
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

    // 橡皮筋：不管關卡多深，怪物數值都不超過「隊伍現況」能處理的量
    const band = CFG.BAND;
    const units = B.units.filter((u) => u.maxHp > 0);
    const weakestHp = Math.min.apply(null, units.map((u) => u.maxHp));
    /* DPS 估算要跟實際戰鬥用同一套公式：
       出手次數用 actsPerSec（飽和曲線）、傷害要扣掉敵人防禦的百分比減傷 */
    let defCap = Math.round(State.teamStats().atk * band.defOfTeamAtk);
    const defMit = 1 - mitigation(defCap, State.data.stage);
    const dps = units.reduce((a, u) => a + u.atk * actsPerSec(u.spd) * 0.85 * defMit, 0);
    const effDps = Math.max(1, dps);
    const baseSec = isBoss ? CFG.bossSecFor(State.data.stage) : CFG.waveSecFor(State.data.stage);
    // 該關「原始血量 ÷ 基準秒數」= 打穿它所需的 DPS；超過就是變強，可以縮短戰鬥時間
    const needDps = Math.max(1, st.hp / baseSec);
    const speedFactor = Math.max(band.speedFloor, Math.min(1, needDps / effDps));
    let hpCap = effDps * baseSec * speedFactor;
    B.lastSpeed = { needDps: Math.round(needDps), dps: Math.round(effDps),
                    factor: +speedFactor.toFixed(2), secs: +(baseSec * speedFactor).toFixed(1) };
    if (isBoss) {
      const fails = Math.min(band.bossFailMax, (State.data.bossFails || {})[State.data.stage] || 0);
      hpCap *= Math.pow(band.bossFailStep, fails);   // 連續失敗會削弱 BOSS，保證推得過去
    }
    // 深度放寬：第 100 關之後，每多 100 關上限 ×1（最多 ×4）
    // 讓關卡數字重新代表難度，不然橡皮筋把每一關都壓成一樣軟
    const depth = Math.max(0, State.data.stage - band.widenFrom);
    const widen = Math.min(band.widenMax, 1 + depth / band.widenPerStage);
    hpCap *= widen;
    defCap *= 1 + (widen - 1) * 0.5;   // 防禦只放寬一半，否則減傷吃掉傷害、戰鬥拖太久
    // 深度只拉長「要打多久」，不提高「會不會被打死」：
    // 攻擊上限不隨深度變動，否則深處 BOSS 會變成必敗（存活時間 < 需要的輸出時間）
    const atkCap = weakestHp * band.atkOfWeakestHp;
    st.hp = Math.max(1, Math.min(st.hp, Math.round(hpCap)));
    st.atk = Math.max(1, Math.min(st.atk, Math.round(atkCap)));
    st.def = Math.max(0, Math.min(st.def, Math.round(defCap)));
    B.enemies = Array.from({ length: n }, (_, i) => {
      const hp = Math.round(st.hp * hpScale);
      return {
        id: 'e' + B.waveNo + '_' + i,
        name: T(n > 1 ? `${st.name} ${i + 1}` : st.name),
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
    if (!B.pendingBoss) return { ok: false, msg: T('先清掉 10 隻小怪') };
    if (!State.teamSouls().length) return { ok: false, msg: T('沒有上陣靈印') };
    B.mode = 'boss';
    B.pendingBoss = false;
    spawnWave('boss');
    reviveTeam(false);
    emit('bossStart', { stage: State.data.stage });
    return { ok: true };
  }

  function hunt(beastId, elite) {
    const beast = CFG.BEAST_BY_ID[beastId];
    if (!beast) return { ok: false, msg: T('找不到靈獸') };
    if (B.mode === 'hunt') return { ok: false, msg: T('正在獵靈中') };
    if (elite) {
      const ei = State.eliteInfo(beastId);
      if (ei.used) return { ok: false, msg: T('今日精英已打過') };
    }
    const next = State.data.cd[beastId] || 0;
    if (Date.now() < next) return { ok: false, msg: T(`冷卻中，還要 ${Math.ceil((next - Date.now()) / 1000)} 秒`) };
    if (State.data.level < beast.reqLevel) return { ok: false, msg: T(`需等級 ${beast.reqLevel} 才能挑戰`) };
    B.huntBeast = beast;
    B.huntElite = !!elite;
    B.huntCounter = State.huntCounter(beastId);
    B.huntCombo = (State.combosInfo().stat.hunt || 1);   // 風潮：風＋水 → 狩獵傷害 +15%
    State.codexMark('beasts', beast.id);
    B.mode = 'hunt';
    spawnWave('hunt');
    reviveTeam(true);            // 獵靈是獨立挑戰，進場回滿血
    emit('huntStart', { beast });
    return { ok: true };
  }

  /* ---------- 無盡深塔 ---------- */
  function spireStart() {
    if (B.mode !== 'farm') return { ok: false, msg: T('戰鬥中無法進入深塔') };
    const use = State.spireUse();
    if (!use.ok) return use;
    B.mode = 'spire';
    B.spireFloor = 1;
    reviveTeam(true);
    spawnWave('spire');
    emit('spireStart', { left: use.left });
    return { ok: true, left: use.left };
  }
  function spireEnd() {
    const cleared = Math.max(0, (B.spireFloor || 1) - 1);
    const r = State.spireReport(cleared);
    B.mode = 'farm';
    B.spireFloor = 0;
    reviveTeam(true);
    spawnWave('farm');
    emit('spireEnd', r);
    return r;
  }

  /* ---------- 每日副本 ---------- */
  function dungeonStart(id) {
    if (B.mode !== 'farm') return { ok: false, msg: T('戰鬥中無法進入副本') };
    const info = State.dungeonInfo().find((x) => x.id === id);
    if (!info) return { ok: false, msg: T('沒有這個副本') };
    if (info.done) return { ok: false, msg: T('今天已打過') };
    B.mode = 'dungeon';
    B.dungeon = CFG.DUNGEONS.find((x) => x.id === id);
    reviveTeam(true);
    spawnWave('dungeon');
    emit('dungeonStart', { id });
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
    B.huntElite = false;
    B.huntCounter = null;
    B.huntCombo = 1;
    reviveTeam(true);   // 獵靈是獨立挑戰：打完不該把傷勢帶回推關（實測會直接全滅）
    spawnWave('farm');
  }

  /* ---------- 主循環 ---------- */
  function tick() {
    if (B.adBreak || (typeof window !== 'undefined' && window.__gpPaused)) return;
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
        if (B.mode === 'boss') {
          const s2 = State.data;
          s2.bossFails = s2.bossFails || {};
          s2.bossFails[s2.stage] = Math.min(CFG.BAND.bossFailMax, (s2.bossFails[s2.stage] || 0) + 1);
          B.pendingBoss = true;        // 復活後直接再挑戰（不用重清小怪）
          B.mode = 'farm';
          spawnWave('farm');
          emit('bossFailed', { stage: s2.stage, fails: s2.bossFails[s2.stage] });
        }
        if (B.mode === 'spire') {
      const cleared = B.spireFloor || 1;
      const rep = State.spireReport(cleared);
      emit('spireClear', { floor: cleared, best: rep.best, newBest: rep.newBest, cores: rep.cores });
      if (cleared % CFG.SPIRE.coreEvery === 0) State.addCores(CFG.SPIRE.coreAmount);
      B.spireFloor = cleared + 1;
      spawnWave('spire');
      return;
    }

    if (B.mode === 'dungeon') {
      const d = B.dungeon;
      const res = State.dungeonClaim(d ? d.id : '');
      B.mode = 'farm';
      B.dungeon = null;
      reviveTeam(true);
      spawnWave('farm');
      emit('dungeonWin', { id: d ? d.id : null, reward: res.ok ? res.reward : null });
      return;
    }

    if (B.mode === 'hunt') {
          const beast = B.huntBeast;
          if (beast) State.data.cd[beast.id] = Date.now() + 15000;   // 失敗冷卻 15 秒
          B.mode = 'farm';
          B.huntBeast = null;
          spawnWave('farm');
          emit('huntLose', { beast });
        }
        emit('revived', {});
      }
      return;
    }

    // 我方行動
    for (const u of B.units) {
      if (!u.alive) continue;
      u.gauge += actsPerSec(u.spd) * DT * rate();
      if (u.gauge < 1) continue;
      u.gauge = 0;
      if (!aliveEnemies().length) break;
      unitAct(u);
      if (!aliveEnemies().length) break;
    }

    maybeAuto();

    // 敵方行動（每隻各自跑行動條）
    for (const e of B.enemies) {
      if (!e.alive) continue;
      e.gauge += actsPerSec(e.spd) * DT * rate();
      if (e.gauge < 1) continue;
      e.gauge = 0;
      if (e.stun > 0) { e.stun--; emit('stun', { who: 'enemy', enemyId: e.id }); continue; }
      if (e.boss) bossAct(e); else enemyAct(e);
    }
  }

  /* ---------- 放置自動化：自動挑戰 BOSS、卡等自動獵靈 ---------- */
  function maybeAuto() {
    const now = Date.now();
    if (now < B.autoAt) return;
    const s = State.data;
    const cfg = s.settings || {};

    /* 卡等時「獵靈」優先於「打 BOSS」：卡等打王沒有任何經驗，先拿環才有成長。
       但「有空格」不等於「卡等」——實測每關都自動跑去獵靈，一次 11 秒、還會被
       嘯風猿打到全滅再等復活，反而把推進卡住。所以要求：BOSS 已經失敗過一次。 */
    const stuck = B.pendingBoss && ((s.bossFails || {})[s.stage] || 0) > 0;
    /* 另一種該去獵靈的情況：身上一個環都沒有（靈環只從獵靈來）。
       兩種情況都只在「這波清完、等 BOSS」的邊界觸發，不要在小怪波中間插隊。 */
    const ringless = (s.ringBag || []).length === 0
      && (s.souls || []).every((x) => !(x.rings || []).length);
    if (cfg.autoHunt !== false && B.mode === 'farm'
        && (stuck || ringless) && State.hasFreeRingSlot()) {
      const ready = CFG.BEASTS.filter((b) => s.level >= b.reqLevel && (s.cd[b.id] || 0) <= now);
      const beast = ready[ready.length - 1];   // 打得到就挑最高階的
      if (beast) {
        /* 直接進獵靈，不要 setTimeout 排隊：
           排 2.5 秒會被「自動打王」的 1.8 秒插隊（實測永遠等不到，玩家 150 秒
           一個靈環都沒有），hunt() 自己就有冷卻與模式檢查。 */
        hunt(beast.id);
        return;
      }
    }

    if (B.pendingBoss && cfg.autoBoss !== false && B.mode === 'farm') {
      B.autoAt = now + CFG.AUTO_BOSS_DELAY;
      setTimeout(() => { if (B.pendingBoss && B.mode === 'farm') challengeBoss(); }, CFG.AUTO_BOSS_DELAY);
    }
  }

  /* ---------- 我方行動 ---------- */
  function unitAct(u) {
    if (u.buffTurns > 0) { u.buffTurns--; if (u.buffTurns === 0) u.buffAtk = 0; }
    if (u.mp >= SKILL_MP) { u.mp = 0; castSkill(u); return; }
    const t = targetEnemy();
    if (!t) return;
    const dmg = calcDamage(u.atk * (1 + u.buffAtk), effDef(t.def), 0.9, 1.1, State.critChance(), State.data.stage);
    hitEnemy(t, dmg, u, false);
    u.mp = Math.min(SKILL_MP, u.mp + MP_PER_ACTION);
  }

  function castSkill(u) {
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
          hitEnemy(e, calcDamage(u.atk * (1 + u.buffAtk) * ringSkill.mult * resoMul, effDef(e.def), 0.95, 1.05, State.critChance(), State.data.stage), u, true);
        }
        if (targets.length > 1) emit('aoe', { count: targets.length });
      } else {
        const t = targetEnemy();
        if (t) {
          hitEnemy(t, calcDamage(u.atk * (1 + u.buffAtk) * ringSkill.mult * resoMul, effDef(t.def), 0.95, 1.05, State.critChance(), State.data.stage), u, true);
          if (Math.random() < (ringSkill.chance || 0) && t.alive) {
            t.stun = Math.max(t.stun, 1);
            emit('stun', { who: 'enemy', enemyId: t.id });
          }
        }
      }
      return;
    }
    emit('skill', { unit: u, role: u.role, name: (CFG.SOUL_BY_ID[u.id] || {}).skillName || T('靈技') });

    if (u.role === 'atk') {
      // 強攻系：全體 200%（多波時才看得出價值）
      const targets = aliveEnemies();
      for (const e of targets) {
        const dmg = calcDamage(u.atk * (1 + u.buffAtk) * 2.0, effDef(e.def), 0.95, 1.05, State.critChance(), State.data.stage);
        hitEnemy(e, dmg, u, true);
      }
      if (targets.length > 1) emit('aoe', { count: targets.length });
    } else if (u.role === 'ctrl') {
      const t = targetEnemy();
      if (t) {
        hitEnemy(t, calcDamage(u.atk * (1 + u.buffAtk) * 1.2, effDef(t.def), 0.95, 1.05, State.critChance(), State.data.stage), u, true);
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
      if (t) hitEnemy(t, calcDamage(u.atk * 0.8, t.def, 0.9, 1.1, State.critChance(), State.data.stage), u, false);
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
    // 五行剋制只作用在狩獵場（主線維持原本節奏，不讓剋制變成推關卡的必要條件）
    if (B.mode === 'spire') {
      const cleared = B.spireFloor || 1;
      const rep = State.spireReport(cleared);
      emit('spireClear', { floor: cleared, best: rep.best, newBest: rep.newBest, cores: rep.cores });
      if (cleared % CFG.SPIRE.coreEvery === 0) State.addCores(CFG.SPIRE.coreAmount);
      B.spireFloor = cleared + 1;
      spawnWave('spire');
      return;
    }

    if (B.mode === 'dungeon') {
      const d = B.dungeon;
      const res = State.dungeonClaim(d ? d.id : '');
      B.mode = 'farm';
      B.dungeon = null;
      reviveTeam(true);
      spawnWave('farm');
      emit('dungeonWin', { id: d ? d.id : null, reward: res.ok ? res.reward : null });
      return;
    }

    if (B.mode === 'hunt') {
      const mul = (B.huntCounter ? B.huntCounter.mult : 1) * (B.huntCombo || 1);
      if (mul !== 1) dmg = Math.max(1, Math.round(dmg * mul));
    }
    enemy.hp -= dmg;
    const leech = State.combatMods ? (State.combatMods().leech || 0) : 0;
    if (leech > 0 && u && u.maxHp > 0) {
      u.hp = Math.min(u.maxHp, u.hp + dmg * leech);
    }
    emit('hit', {
      side: 'enemy', enemyId: enemy.id, amount: dmg, crit: isSkill, unit: u,
      hp: Math.max(0, enemy.hp), maxHp: enemy.maxHp,
    });
    if (enemy.hp <= 0) { enemy.hp = 0; enemy.alive = false; onEnemyDead(enemy); }
  }

  /* ---------- Boss 被動 ---------- */
  function bossAct(e) {
    e.acts++;
    e.heals = e.heals || 0;
    if (!e.enraged && e.hp / e.maxHp <= 0.4) {
      e.enraged = true;
      e.atk = Math.round(e.atk * 1.35);
      emit('bossRage', { name: e.name, enemyId: e.id });
    }
    // 只在血量低於 70% 時、每 5 次行動回 8%：避免低戰力玩家被無限回血鎖死
    if (e.acts % 5 === 0 && e.hp < e.maxHp * 0.7 && e.heals < CFG.BAND.bossHealMax) {
      e.heals++;
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
    const dmg = calcDamage(e.atk, target.def, 0.9, 1.1, CFG.COMBAT.critBase, State.data.level);
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

    if (B.mode === 'spire') {
      const cleared = B.spireFloor || 1;
      const rep = State.spireReport(cleared);
      emit('spireClear', { floor: cleared, best: rep.best, newBest: rep.newBest, cores: rep.cores });
      if (cleared % CFG.SPIRE.coreEvery === 0) State.addCores(CFG.SPIRE.coreAmount);
      B.spireFloor = cleared + 1;
      spawnWave('spire');
      return;
    }

    if (B.mode === 'dungeon') {
      const d = B.dungeon;
      const res = State.dungeonClaim(d ? d.id : '');
      B.mode = 'farm';
      B.dungeon = null;
      reviveTeam(true);
      spawnWave('farm');
      emit('dungeonWin', { id: d ? d.id : null, reward: res.ok ? res.reward : null });
      return;
    }

    if (B.mode === 'hunt') {
      const beast = B.huntBeast;
      const ring = State.newRing(beast.tier, beast.element);
      s.ringBag.push(ring);
      s.cd[beast.id] = Date.now() + beast.cdSec * 1000;
      s.stats.hunts++;
      // 獸核：階級越高越多；精英 ×3；深林層數每 3 層再 ×2、×3…
      const elite = !!B.huntElite;
      const dep = State.depthInfo(beast.id);
      let cores = (CFG.CORE_DROP[beast.tier] || 1) * (elite ? CFG.ELITE.coreMul : 1);
      cores = Math.round(cores * dep.coreMul) + (State.combosInfo().stat.core || 0);
      State.addCores(cores);
      // 深林每 5 層：保證多掉一枚「高一階」靈環（上限紫，避免紅環貶值）
      let bonusRing = null;
      if (dep.bonusRing) {
        const idx = CFG.RING_ORDER.indexOf(beast.tier);
        const nextKey = CFG.RING_ORDER[Math.min(idx + 1, CFG.RING_ORDER.indexOf(CFG.DEPTH.maxBonusRing))];
        if (nextKey && nextKey !== beast.tier) {
          bonusRing = State.newRing(nextKey, beast.element);
          s.ringBag.push(bonusRing);
          State.codexMark('rings', nextKey);
          State.autoEquipBestRing();
        }
      }
      const depth = State.depthPlus(beast.id);
      if (elite) State.eliteMarkUsed(beast.id);
      State.dailyAdd('hunt', 1);
      State.weeklyAdd('hunts', 1);
      emit('huntWin', { beast, ring, cores, elite, depth, bonusRing });
      const auto = State.autoEquipBestRing();
      if (auto) emit('autoRing', { soul: auto.soul, ring: auto.ring });
      const merged = State.mergeLowTiers();
      if (merged && merged.made > 0) emit('autoMerge', { made: merged.made });
      backToFarm();
      return;
    }

    const isBoss = B.mode === 'boss';
    const r = CFG.killReward(s.stage);
    const mul = State.incomeMul();
    const coinGain = Math.round((isBoss ? r.coins * 8 : r.coins) * mul);
    const expGain = Math.round((isBoss ? r.exp * 8 : r.exp) * mul);
    State.addCoins(coinGain);
    const expRes = State.addExp(s, expGain);
    s.stats.kills++;
    if (!isBoss) State.weeklyAdd('kills', 1);
    if (!isBoss && s.kills < CFG.killsPerStage(s.stage)) s.kills++;

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
      if (s.bossFails) delete s.bossFails[s.stage - 1];   // 過了就把失敗紀錄清掉
      B.mode = 'farm';
      emit('stageClear', { stage: s.stage });
      // 里程碑：每 50 關送一個十萬年環
      if (s.stage % CFG.MILESTONE.every === 0) {
        const ring = State.newRing(CFG.MILESTONE.tier, 'water');
        s.ringBag.push(ring);
        emit('milestone', { stage: s.stage, ring });
      }
      spawnWave('farm');
      // 插頁廣告只在關卡之間，且由 GP 自己做冷卻
      if (typeof window !== 'undefined' && window.GP && GP.interstitial) {
        B.adBreak = true;
        GP.interstitial().then(function () { B.adBreak = false; },
                               function () { B.adBreak = false; });
      }
      return;
    }

    // 這一波清完才出下一波；還有敵人就不重生
    if (aliveEnemies().length) return;

    if (s.kills >= CFG.killsPerStage(s.stage) && !B.pendingBoss) {
      B.pendingBoss = true;
      emit('bossReady', { stage: s.stage });
    }
    B.units.forEach((u) => {
      if (u.alive) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.12);
    });
    spawnWave('farm');
  }

  /* ---------- 傷害公式 ---------- */
  /* 速度 → 每秒出手次數：飽和曲線（原本速度 617 之後就完全沒用）
     acts/s = (1/DT) × (1 − e^(−spd/617))，永遠 < 8.33 但不會浪費 */
  /* v1.18.0 倍速：雙方（我方與敵方）用同一個倍率加速 → 戰鬥結果不變，只是省時間 */
  function rate() {
    const sp = ((State.data && State.data.settings) || {}).speed | 0;
    return CFG.SPEEDS.indexOf(sp) >= 0 ? sp : 1;
  }

  function actsPerSec(spd) {
    const maxActs = 1 / DT;
    return maxActs * (1 - Math.exp(-(spd || 0) / CFG.COMBAT.spdK));
  }

  /* 防禦 → 百分比減傷：def / (def + 300 × 等級)，單邊上限 35% */
  function mitigation(def, level) {
    const k = CFG.COMBAT.defK * Math.max(1, level || 1);
    return Math.min(CFG.COMBAT.defCap, (def || 0) / ((def || 0) + k));
  }

  /* 詞條「破防」：玩家造成的傷害對敵方防禦打折（只影響我方輸出） */
  function effDef(def) {
    const pen = State.combatMods ? (State.combatMods().pen || 0) : 0;
    return Math.max(0, (def || 0) * (1 - Math.min(0.5, pen)));
  }

  function calcDamage(atk, def, lo, hi, critChance, defLevel) {
    const raw = atk * (lo + Math.random() * (hi - lo));
    const dmg = raw * (1 - mitigation(def, defLevel));
    const crit = Math.random() < (critChance == null ? CFG.COMBAT.critBase : critChance);
    return Math.max(1, Math.round(dmg * (crit ? CFG.COMBAT.critMult : 1)));
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
      needed: CFG.killsPerStage(State.data.stage),
      stage: State.data.stage,
    };
  }

  global.Battle = {
    spireStart, spireEnd, dungeonStart,
    init, start, stop, refreshTeam, challengeBoss, hunt, backToFarm, reviveTeam,
    on, snapshot, spawnWave, targetEnemy,
    /* 測試用內部鉤子（不影響遊戲流程） */
    unitAct, castSkill, hitEnemy, bossAct, enemyAct,
    actsPerSec, mitigation, calcDamage,
    get state() { return B; },
  };
})(window);
