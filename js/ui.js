/* ==========================================================================
 * ui.js — 渲染、互動、飄字、靈環光效、存檔流程
 * ========================================================================== */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function fmt(n) {
    return I18N.fmt(n);   // 中文用萬/億，英文用 K/M/B
  }
  const roleName = (r) => CFG.ROLE_LABEL[r] || T('未知');

  let tab = 'battle';
  let lastSnapKey = '';
  let unitEls = new Map();     // id -> element
  let enemyEls = new Map();    // id -> element（一波可能 1–3 隻）
  let toastTimer = 0;

  /* ================= 初始化 ================= */
  /* 載入畫面收尾：沒有 GamePix SDK 的版本（itch）也要走這條 */
  function hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
    const bar = document.getElementById('loadingBar');
    if (bar) bar.style.width = '100%';
  }

  function boot() {
    if (global.GP) { GP.boot(); GP.loading(20); }
    const res = State.load();
    bindNav();
    bindCodex();
    const spdBtn = $('#btnSpeed');
    if (spdBtn) spdBtn.addEventListener('click', () => {
      const list = CFG.SPEEDS;
      const cur = (State.data.settings || {}).speed | 0 || 1;
      const next = list[(list.indexOf(cur) + 1) % list.length];
      State.data.settings.speed = next;
      State.save(true);
      renderSpeed();
      toast(`${T('倍速')} ×${next}`);
    });
    const bs = $('#btnSpire'); if (bs) bs.addEventListener('click', showSpire);
    const bd = $('#btnDungeon'); if (bd) bd.addEventListener('click', showDungeons);
    bindTop();
    bindBattle();
    bindSouls();
    bindRings();
    bindHunt();
    bindGacha();

    Battle.on(onBattleEvent);
    Battle.init();
    renderAll();
    if (global.GP) {
      GP.loading(85);
      GP.loaded().then(function () { GP.gameStart(); });   // 開場即自動戰鬥＝gameplay 開始
    } else {
      hideLoading();                                        // 沒有 SDK（例：itch 版）也要關掉載入畫面
    }

    if (res.offline) showOffline(res.offline);
    const ci = State.checkinInfo();
    if (ci.canCheck) setTimeout(() => toast(T('今日簽到可領取 🎁')), 1400);
    if (res.restored) toast(T('主存檔損毀，已從備份還原'));
    if (res.newer) toast(T('存檔來自較新版本，已停止自動存檔以免覆蓋'));
    if (res.corrupted) toast(T('存檔損毀，已建立新檔（舊檔已保留）'));

    setInterval(() => {
      State.save();
      renderTop();
      State.dailyAdd('idle', 5 / 60);      // 掛機分鐘（每日任務）
      const asi = State.autoStarUp();
      if (asi) { State.save(true); Battle.refreshTeam(); renderAll(); }
      checkAch();
    }, 5000);
    setInterval(() => { if (tab === 'hunt') renderHunt(); }, 1000);
    document.addEventListener('keydown', modalKeydown);
    window.addEventListener('beforeunload', () => State.save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) State.save(true); });

    requestAnimationFrame(loop);
    global.__game = {
      get ready() { return true; },
      State, Battle, CFG,
      switchTab, openModal, closeModal, renderAll,
      showOffline, showRelics, showCodex,   // 測試與除錯用：直接開對應視窗
      checkinInfo: () => State.checkinInfo(),
      get tab() { return tab; },
    };
  }

  /* ================= 導覽 ================= */
  function bindCodex() {
    const b = $('#btnCodex');
    if (b) b.addEventListener('click', showCodex);
  }

  function bindNav() {
    $$('.nav-btn').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
  }
  function switchTab(name) {
    tab = name;
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    renderAll();
  }

  function bindTop() {
    $('#btnMenu').addEventListener('click', showMenu);
  }

  /* ================= 戰鬥畫面 ================= */
  function bindBattle() {
    $('#bossBtn').addEventListener('click', () => {
      const r = Battle.challengeBoss();
      if (!r.ok) toast(r.msg);
    });
  }

  function renderSpeed() {
    const btn = $('#btnSpeed');
    if (!btn) return;
    const cur = (State.data.settings || {}).speed | 0 || 1;
    btn.textContent = `${T('倍速')} ×${cur}`;
    btn.classList.toggle('primary', cur > 1);
  }

  function renderSpireBtn() {
    const b = $('#btnSpire');
    if (!b) return;
    const info = State.spireInfo();
    const label = I18N.lang === 'en'
      ? `Endless Spire (${info.left}/${info.perDay})`
      : `無盡深塔（${info.left}/${info.perDay}）`;
    b.textContent = label;
    b.disabled = info.left <= 0;
  }

  function renderBattle() {
    const snap = Battle.snapshot();
    $('#stageName').textContent = T(CFG.areaFor(snap.stage)) + (snap.mode === 'boss' ? ' · BOSS' : '');
    const lbl = $('#stageLabel');
    if (lbl) {
      lbl.innerHTML = I18N.lang === 'en'
        ? `Stage <b id="stageNum">${snap.stage}</b>`
        : `第 <b id="stageNum">${snap.stage}</b> 關`;
    } else {
      $('#stageNum').textContent = snap.stage;
    }
    $('#progText').textContent = `${Math.min(snap.kills, snap.needed)} / ${snap.needed}`;
    $('#progBar').style.width = Math.min(100, (snap.kills / snap.needed) * 100) + '%';

    const rate = CFG.offlinePerMinute(snap.stage);
    $('#rateText').textContent = I18N.lang === 'en'
      ? `${fmt(rate.coins)} coins/min · ${fmt(rate.exp)} EXP/min`
      : T(`靈幣 ${fmt(rate.coins)}/分 · 經驗 ${fmt(rate.exp)}/分`);

    const capped = State.atCap();
    const bossBtn = $('#bossBtn');
    bossBtn.disabled = !snap.pendingBoss;
    bossBtn.textContent = snap.pendingBoss
      ? T(`挑戰 BOSS（${Math.round((CFG.AUTO_BOSS_DELAY || 1800) / 1000)} 秒後自動）`)
      : capped ? T(`關卡清完 · 去打靈環`) : T(`清怪 ${snap.kills}/${snap.needed}`);

    renderTeam(snap.units);
    renderEnemies(snap.enemies || [], snap.mode);
  }

  function renderTeam(units) {
    const row = $('#teamRow');
    // 以 id 建立／更新，避免每幀重建造成 CSS 動畫被打斷
    const ids = units.map((u) => u.id).join(',');
    if (row.dataset.ids !== ids) {
      row.innerHTML = '';
      unitEls.clear();
      row.dataset.ids = ids;
      units.forEach((u) => {
        const el = document.createElement('div');
        el.className = 'unit';
        el.innerHTML = `
          <div class="bars">
            <div class="bar hp"><i></i></div>
            <div class="bar mp"><i></i></div>
          </div>
          <div class="body">${u.emoji}</div>
          <div class="name">${T(u.name)}</div>`;
        row.appendChild(el);
        unitEls.set(u.id, el);
      });
    }
    units.forEach((u) => {
      const el = unitEls.get(u.id);
      if (!el) return;
      el.classList.toggle('dead', !u.alive);
      $('.bar.hp > i', el).style.width = Math.max(0, (u.hp / u.maxHp) * 100) + '%';
      $('.bar.mp > i', el).style.width = Math.min(100, (u.mp / 100) * 100) + '%';
    });
  }

  function renderEnemies(list, mode) {
    const row = $('#enemyRow');
    const key = list.map((e) => e.id).join(',');
    if (row.dataset.ids !== key) {
      row.innerHTML = '';
      enemyEls.clear();
      row.dataset.ids = key;
      list.forEach((e) => {
        const el = document.createElement('div');
        el.className = 'unit enemy' + (mode === 'boss' || e.boss ? ' bossUnit' : '');
        el.dataset.id = e.id;
        el.innerHTML = `
          <div class="name" style="font-size:9px">${T(e.name)}</div>
          <div class="body">${e.emoji}</div>
          <div class="bars"><div class="bar hp"><i></i></div></div>`;
        row.appendChild(el);
        enemyEls.set(e.id, el);
      });
    }
    list.forEach((e) => {
      const el = enemyEls.get(e.id);
      if (!el) return;
      $('.bar.hp > i', el).style.width = Math.max(0, (e.hp / e.maxHp) * 100) + '%';
      el.classList.toggle('dead', !e.alive);
    });
  }

  /* ================= 靈印 ================= */
  function bindSouls() {
    $('#btnExpandSlot').addEventListener('click', () => {
      const r = State.expandSlot();
      if (!r.ok) return toast(r.msg);
      Battle.refreshTeam();
      State.save(true);
      toast(T(`陣容擴充到 ${r.slots} 人`));
      renderAll();
    });
  }

  function renderSouls() {
    const s = State.data;
    const bond = State.bondInfo();
    const bondBits = [];
    if (bond.strong.length) bondBits.push(bond.strong.map((el) => `${T(CFG.ELEMENT_LABEL[el])}×${bond.counts[el]}`).join(' '));
    if (bond.tri) bondBits.push(T('三元素'));
    const combos = State.combosInfo();
    if (combos.active.length) bondBits.push(combos.active.map((c) => T(c.name)).join(' · '));
    const sets = State.setInfo();
    if (sets.active.length) bondBits.push(T('套裝') + ' ' + sets.active.map((el) => T(CFG.ELEMENT_LABEL[el])).join('/'));
    const bondTxt = bondBits.length
      ? ` · ${T('羈絆')} ${bondBits.join(' / ')}${bond.tri ? ` +${Math.round(bond.triBonus * 100)}%` : ''}`
      : '';
    $('#slotInfo').textContent = T(`上陣 ${s.team.length} / ${s.slots}`) + bondTxt;
    const list = $('#soulList');
    list.innerHTML = s.souls.map((soul) => {
      const base = CFG.SOUL_BY_ID[soul.id] || {};
      const st = State.soulStats(soul);
      const inTeam = s.team.includes(soul.id);
      const slots = State.ringSlotsOf(soul);
      const bone = State.boneOf(soul);
      const info = State.starUpInfo(soul);
      const tb = State.trueBodyOf(soul);
      const reso = State.resonanceOf(soul);
      const lvInfo = State.soulLevelInfo(soul.id);
      const rings = soul.rings.map((uid) => {
        const r = s.ringBag.find((x) => x.uid === uid);
        const t = r ? CFG.TIER_BY_KEY[r.tier] : null;
        return `<span class="ring-dot ${t ? t.css : 't-white'}"></span>`;
      }).join('') || `<span class="hint">${T('無靈環')}</span>`;
      return T(`<div class="card" data-soul="${soul.id}">
        <div class="row1">
          <span style="font-size:20px">${base.emoji || '❔'}</span>
          <b>${base.name || soul.id}</b>
          <span class="hint">Lv.${soul.level || 1}</span>
          <span class="star">${(soul.star || 3) > 5 ? `★×${soul.star}` : '★'.repeat(soul.star || 3)}</span>
          <span class="tag" style="color:${CFG.ROLE_COLOR[base.role]}">${roleName(base.role)}</span>
          <span class="tag" style="color:${CFG.ELEMENT_COLOR[base.element] || '#aaa'}">${base.element ? T(CFG.ELEMENT_LABEL[base.element]) : ''}</span>
          <span class="tag ${inTeam ? 'on' : ''}">${inTeam ? T('上陣中') : T('待命')}</span>
        </div>
        <div class="stats">
          <span>攻擊 <b>${fmt(st.atk)}</b></span>
          <span>生命 <b>${fmt(st.hp)}</b></span>
          <span>防禦 <b>${fmt(st.def)}</b></span>
        </div>
        <div class="row1" style="margin-top:6px;font-size:11px;color:var(--muted)">
          靈環槽 ${soul.rings.length}/${slots} ${rings}
          ${tb.bonus ? T(`<span class="tag on">真身 +${Math.round(tb.bonus * 100)}%</span>`) : ''}
          ${reso ? `<span class="tag on">${T('共鳴')} ${T(CFG.ELEMENT_LABEL[reso.element])}×${reso.count}</span>` : ''}
          ${(soul.ascend || 0) > 0 ? `<span class="tag on">${T('覺醒階')} ${soul.ascend}</span>` : ''}
        </div>
        <div class="row1" style="margin-top:4px;font-size:11px;color:var(--muted)">
          ${bone ? `<span class="bone ${bone.css}"></span> ${T(bone.name)}（${T(bone.desc)}）` : T('靈骨：無')}
        </div>
        <div class="acts">
          <button class="mini-btn ${inTeam ? 'ghost' : 'primary'}" data-act="team" data-id="${soul.id}">
            ${inTeam ? T('下陣') : T('上陣')}
          </button>
          <button class="mini-btn" data-act="ring" data-id="${soul.id}">裝備靈環</button>
          <button class="mini-btn ${info.canAfford ? 'primary' : ''}" data-act="star" data-id="${soul.id}"
            ${info.maxed || !info.canAfford ? 'disabled' : ''}>
            ${info.maxed ? T(`★${CFG.STAR_MAX} 滿星`) : T(`升星 ★${info.star}→★${info.star + 1}（${info.bones} 靈骨・${fmt(info.coins)}）`)}
          </button>
          ${(() => {
            const ai = State.ascendInfo(soul.id);
            if (!ai) return '';
            const label = ai.maxed ? T('覺醒滿階')
              : T(`覺醒 ${ai.stage}→${ai.stage + 1}（${ai.cost} 核）`);
            return `<button class="mini-btn ${ai.can ? 'primary' : ''}" data-act="ascend" data-id="${soul.id}"
              ${ai.can ? '' : 'disabled'}>${label}</button>`;
          })()}
          <button class="mini-btn ${lvInfo.can ? 'primary' : ''}" data-act="lvup" data-id="${soul.id}"
            ${lvInfo.can ? '' : 'disabled'}>
            ${lvInfo.maxed ? T(`Lv.${lvInfo.level} 已滿`) : T(`升級 Lv.${lvInfo.level}（${fmt(lvInfo.cost)}）`)}
          </button>
          <button class="mini-btn ghost" data-act="bone" data-id="${soul.id}">${bone ? T('換靈骨') : T('裝靈骨')}</button>
          ${(soul.star || 3) > CFG.INHERIT.minStar
            ? `<button class="mini-btn" data-act="inherit" data-id="${soul.id}">${T('傳承星級')}</button>`
            : ''}
        </div>
      </div>`);
    }).join('');

    $$('#soulList [data-act="team"]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.toggleTeam(b.dataset.id);
        if (!r.ok) return toast(r.msg);
        Battle.refreshTeam();
        State.save(true);
        renderAll();
      });
    });
    $$('#soulList [data-act="ring"]').forEach((b) => {
      b.addEventListener('click', () => pickRingFor(b.dataset.id));
    });
    $$('#soulList [data-act="star"]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.starUp(b.dataset.id);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
        toast(T(`升星成功 → ★${r.star}（消耗 ${r.eaten} 塊靈骨）`));
      });
    });
    $$('#soulList [data-act="lvup"]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.soulLevelUp(b.dataset.id);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
      });
    });
    $$('#soulList [data-act="bone"]').forEach((b) => {
      b.addEventListener('click', () => pickBoneFor(b.dataset.id));
    });
    $$('#soulList [data-act="inherit"]').forEach((b) => {
      b.addEventListener('click', () => pickInheritTarget(b.dataset.id));
    });
    $$('#soulList [data-act="ascend"]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.ascendSoul(b.dataset.id);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
        toast(T(`覺醒成功 → 第 ${r.stage} 階`));
        if (global.SFX) SFX.clear();
      });
    });

    const btn = $('#btnExpandSlot');
    if (s.slots >= 5) {
      btn.textContent = T('已達五人小隊上限');
      btn.disabled = true;
    } else {
      btn.disabled = false;
      btn.textContent = I18N.lang === 'en'
        ? `Expand team → ${s.slots + 1} (${fmt(State.slotNextCost())} coins · Lv ${State.slotNextLevel()})`
        : T(`擴充陣容 → ${s.slots + 1} 人（${fmt(State.slotNextCost())} 靈幣 · 等級 ${State.slotNextLevel()}）`);
    }
  }

  function pickRingFor(soulId) {
    const free = State.freeRings();
    if (!free.length) return toast(T('背包沒有靈環，去獵靈取得'));
    const body = free.map((r) => {
      const t = CFG.TIER_BY_KEY[r.tier];
      return T(`<div class="card compact">
        <div class="row1"><span class="ring-dot ${t.css}"></span><b>${T(t.name)}</b>
        <span class="hint">攻擊 +${Math.round(t.atk * 100)}% · 生命 +${Math.round(t.hp * 100)}%</span></div>
        <div class="acts"><button class="mini-btn primary" data-uid="${r.uid}">裝上去</button></div>
      </div>`);
    }).join('');
    openModal(T('選擇靈環'), body, [{ text: T('取消'), kind: '' }]);
    $$('#modalBody [data-uid]').forEach((b) => {
      b.addEventListener('click', () => {
        const res = State.equipRing(soulId, b.dataset.uid);
        closeModal();
        if (!res.ok) return toast(res.msg);
        State.save(true);
        renderAll();
        toast(T('靈環已裝備'));
      });
    });
  }

  function pickBoneFor(soulId) {
    const soul = State.data.souls.find((x) => x.id === soulId);
    const has = soul && soul.bone;
    const free = State.freeBones();
    if (!has && !free.length) return toast(T('沒有可裝備的靈骨，去靈印殿抽卡'));
    const rows = free.map((item) => {
      const b = CFG.BONE_BY_ID[item.id];
      return T(`<div class="card compact">
        <div class="row1"><span class="bone ${b.css}"></span><b>${T(b.name)}</b>
        <span class="hint">${b.desc}</span></div>
        <div class="acts"><button class="mini-btn primary" data-bone="${item.uid}">裝備</button></div>
      </div>`);
    }).join('');
    const offBtn = has ? T(`<div class="acts" style="margin-top:6px">
        <button class="mini-btn ghost" id="btnUnequipBone">卸下目前靈骨</button></div>`) : '';
    openModal(T('靈骨'), rows + offBtn || T('<div class="hint">沒有靈骨</div>'), [{ text: T('關閉'), kind: '' }]);
    $$('#modalBody [data-bone]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.equipBone(soulId, b.dataset.bone);
        closeModal();
        if (!r.ok) return toast(r.msg);
        State.save(true); Battle.refreshTeam(); renderAll();
        toast(T('靈骨已裝備（裝備者全額、同隊 30% 光環）'));
      });
    });
    const off = $('#btnUnequipBone');
    if (off) off.addEventListener('click', () => {
      State.unequipBone(soulId); closeModal();
      State.save(true); Battle.refreshTeam(); renderAll();
    });
  }

  function showSpire() {
    const info = State.spireInfo();
    const next = State.spireStats(info.best + 1);
    openModal(T('無盡深塔'), T(`
      <div class="hint">${T('每天 3 次，從第 1 層連打到全滅；敵人用固定公式，不套橡皮筋')}</div>
      <div class="stats" style="margin-top:8px">
        <span>${T('最高層')} <b>${info.best}</b></span>
        <span>${T('塔印')} <b>${info.marks}</b></span>
        <span>${T('全屬性')} <b>+${(info.bonus * 100).toFixed(1)}%</b></span>
      </div>
      <div class="hint" style="margin-top:8px">${T('下一層')}：${T('生命')} ${fmt(next.hp)} · ${T('攻擊')} ${fmt(next.atk)}${next.boss ? ' · BOSS' : ''}</div>
      <div class="hint">${T('每')} 10 ${T('層')} → +${CFG.SPIRE.coreAmount} ${T('獸核')}</div>`),
      [{ text: T('進入深塔'), kind: 'primary', onClick: () => {
          const r = Battle.spireStart();
          if (!r.ok) { toast(r.msg); return; }
          closeModal(); switchTab('battle'); renderAll();
          toast(T('深塔挑戰開始'));
        } },
       { text: T('關閉'), kind: '' }]);
  }

  function showDungeons() {
    const list = State.dungeonInfo();
    const rows = list.map((d) => `<div class="merge-row">
        <span class="mr-name">${d.emoji} ${T(d.name)}</span>
        <span class="hint">${T(d.desc)}</span>
        <button class="mini-btn ${d.done ? '' : 'primary'}" data-dg="${d.id}" ${d.done ? 'disabled' : ''}>
          ${d.done ? T('今日已完成') : T('挑戰')}
        </button>
      </div>`).join('');
    openModal(T('每日副本'), T(`
      <div class="hint">${T('每天各 1 次，獎勵隨最高關卡提升')}</div>${rows}`),
      [{ text: T('關閉'), kind: '' }]);
    $$('#modalBody [data-dg]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = Battle.dungeonStart(b.dataset.dg);
        if (!r.ok) return toast(r.msg);
        closeModal(); switchTab('battle'); renderAll();
        toast(T('副本挑戰開始'));
      });
    });
  }

  /* 傳承：選一個目標把一顆星轉過去（來源不可低於 3★、目標不可超過 5★） */
  function pickInheritTarget(fromId) {
    const s = State.data;
    const rows = s.souls.filter((x) => x.id !== fromId).map((x) => {
      const base = CFG.SOUL_BY_ID[x.id] || {};
      const info = State.inheritInfo(fromId, x.id);
      const label = !info.ok
        ? (info.reason === 'capped' ? T('已滿星') : T('不可傳承'))
        : T(`${info.cost} 核`);
      return `<button class="mini-btn ${info.ok && info.can ? 'primary' : ''}" data-inherit="${x.id}"
        ${info.ok && info.can ? '' : 'disabled'}>
        ${base.emoji || ''} ${T(base.name || x.id)} ★${x.star || 3} · ${label}
      </button>`;
    }).join('');
    openModal(T('傳承星級'), T(`
      <div class="hint">${T('把一顆星從這隻武魂轉給另一隻（來源不可低於 3★、目標上限 5★），消耗獸核')}</div>
      <div class="acts" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${rows}</div>
      <div class="hint" style="margin-top:8px">${T('獸核')}：${s.cores || 0}</div>`),
      [{ text: T('取消'), kind: '' }]);
    $$('#modalBody [data-inherit]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.inheritStar(fromId, b.dataset.inherit);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        closeModal();
        renderAll();
        toast(T(`傳承完成：來源 ${r.fromStar}★ → 目標 ${r.toStar}★（-${r.cost} 核）`));
        if (global.SFX) SFX.unlock();
      });
    });
  }

  function renderBones() {
    const s = State.data;
    const free = State.freeBones();
    $('#boneCount').textContent = T(`未裝備 ${free.length} · 已裝備 ${State.equippedBones()}`);

    const cost = CFG.coinPullCost(s.bonePulls || 0);
    const cost5 = Array.from({ length: 5 }, (_, i) => CFG.coinPullCost((s.bonePulls || 0) + i))
      .reduce((a, b) => a + b, 0);
    const shop = `<div class="merge-box">
      <div class="merge-head"><b>${T('靈幣抽靈骨')}</b>
        <span class="hint">${T(`已抽 ${s.bonePulls || 0} 次 · 每次必得 1 塊`)}</span></div>
      <div class="merge-row">
        <span class="mr-name">${T('抽 1 次')}</span>
        <span class="mr-count">${fmt(cost)} ${T('靈幣')}</span>
        <button class="mini-btn" id="btnBonePull1" ${s.coins >= cost ? '' : 'disabled'}>${T('抽')}</button>
      </div>
      <div class="merge-row">
        <span class="mr-name">${T('連抽 5 次（逐次計價）')}</span>
        <span class="mr-count">${fmt(cost5)} ${T('靈幣')}</span>
        <button class="mini-btn" id="btnBonePull5" ${s.coins >= cost5 ? '' : 'disabled'}>${T('抽')}</button>
      </div>
      <div class="hint" style="margin-top:6px">${T('王者靈骨（全屬性）較稀有；抽越多次單價越高。')}</div>
    </div>`;

    const bindPull = () => {
      const run = (n) => {
        const r = State.coinBonePull(n);
        if (!r.ok) return toast(r.msg || T('靈幣不足'));
        State.save(true);
        renderAll();
        const names = r.got.map((g) => T(g.name)).join('、');
        toast(T(`抽到 ${r.got.length} 塊：${names}`));
      };
      const b1 = $('#btnBonePull1'); if (b1) b1.addEventListener('click', () => run(1));
      const b5 = $('#btnBonePull5'); if (b5) b5.addEventListener('click', () => run(5));
    };

    if (!s.bones.length) {
      $('#boneList').innerHTML = shop + `<div class="card"><div class="hint">${T('還沒有靈骨。用上面的靈幣抽，或到「覺醒」抽卡。')}</div></div>`;
      bindPull();
      return;
    }
    const equippedHtml = s.souls.filter((x) => x.bone).map((soul) => {
      const b = State.boneOf(soul);
      const base = CFG.SOUL_BY_ID[soul.id];
      if (!b) return '';
      return T(`<div class="card compact">
        <div class="row1"><span class="bone ${b.css}"></span><b>${T(b.name)}</b>
        <span class="hint">→ ${T(base.name)}（${T(b.desc)}）</span></div>
        <div class="acts"><button class="mini-btn ghost" data-unbone="${soul.id}">卸下</button></div>
      </div>`);
    }).join('');
    const freeHtml = free.map((item) => {
      const b = CFG.BONE_BY_ID[item.id];
      return T(`<div class="card compact">
        <div class="row1"><span class="bone ${b.css}"></span><b>${T(b.name)}</b>
        <span class="hint">${b.desc}</span></div>
        <div class="acts">
          ${s.souls.map((soul) => T(`<button class="mini-btn" data-eqbone="${item.uid}" data-soul="${soul.id}">
            裝到 ${(CFG.SOUL_BY_ID[soul.id] || {}).name}</button>`)).join('')}
        </div>
      </div>`);
    }).join('');
    $('#boneList').innerHTML = shop + equippedHtml + freeHtml;
    bindPull();
    $$('#boneList [data-eqbone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = State.equipBone(btn.dataset.soul, btn.dataset.eqbone);
        if (!r.ok) return toast(r.msg);
        State.save(true); Battle.refreshTeam(); renderAll();
        toast(T('靈骨已裝備'));
      });
    });
    $$('#boneList [data-unbone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        State.unequipBone(btn.dataset.unbone);
        State.save(true); Battle.refreshTeam(); renderAll();
      });
    });
  }

  function renderRebirthHint() {
    const box = $('#rebirthHint');
    if (!box) return;
    const info = State.rebirthInfo();
    if (!info.can || info.gain <= 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const pct = Math.round(CFG.REBIRTH.perMark.atk * 100 * info.gain);
    box.classList.remove('hidden');
    box.innerHTML = `<div>${T(`可轉生：+${info.gain} 命印（全屬性 +${pct}%）`)}
      <br><span style="opacity:.8">${T('會重置等級／關卡／靈幣；靈印、星級、靈骨、靈環保留')}</span></div>
      <button class="go" id="btnGoRebirth">${T('前往')}</button>`;
    const go = $('#btnGoRebirth');
    if (go) go.addEventListener('click', () => {
      const card = $('#rebirthBox');
      if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  function renderRebirth() {
    const box = $('#rebirthBox');
    if (!box) return;
    const info = State.rebirthInfo();
    const pm = CFG.REBIRTH.perMark;
    box.innerHTML = `
      <h3><span>🌀 ${T('轉生')} · ${T('命印')} <span class="rb-mark">${info.marks}</span></span>
          <span class="hint">${T(`第 ${info.rebirths + 1} 次`)}</span></h3>
      <div class="rb-line">${T(`歷史最高：第 ${info.bestStage} 關（需 ${info.minStage} 關）`)}</div>
      <div class="rb-line">${T(`本輪推進：+${info.deep} 關（上次轉生在 第 ${info.lastBest || info.minStage} 關）`)}</div>
      <div class="rb-line">${T(`目前加成：全屬性 +${Math.round(pm.atk * 100 * info.marks)}% · 收益 +${Math.round(pm.income * 100 * info.marks)}%`)}</div>
      <div class="rb-line">${T('這次轉生可得：')}<b style="color:var(--gold)">${T(`+${info.gain} 命印`)}</b>${T('（每點全屬性 +6%、收益 +4%）')}</div>
      <div class="rb-line" style="opacity:.75">${T('轉生會重置等級／關卡／靈幣；靈印、星級、靈骨、靈環、命印都會保留。')}</div>
      <button id="btnRebirth" class="wide-btn ${info.can ? '' : ''}" ${info.can ? '' : 'disabled'}>
        ${info.can ? T(`轉生（+${info.gain} 命印）`) : T(`要推進到 第 ${info.needStage} 關才能轉生`)}
      </button>
      ${talentHtml()}`;
    const btn = $('#btnRebirth');
    if (btn) btn.addEventListener('click', () => {
      if (!info.can) return toast(T(`要推進到 第 ${info.needStage} 關才能轉生（本輪 +${info.deep} 關）`));
      if (btn.dataset.armed === '1') { doRebirthNow(); return; }
      btn.dataset.armed = '1';
      btn.classList.add('armed');
      btn.textContent = T('再按一次確認轉生（會重置本輪）');
      clearTimeout(renderRebirth._t);
      renderRebirth._t = setTimeout(() => {
        if (btn.isConnected) { btn.dataset.armed = ''; btn.classList.remove('armed'); renderRebirth(); }
      }, 4000);
    });
    bindTalents();
  }

  /* 命印天賦樹：3 分支 × 3 節點 × 5 級；投入的命印不再給「每點 +6% 全屬性」 */
  function talentHtml() {
    const t = State.talentInfo();
    const rows = t.branches.map((b) => {
      const nodes = b.nodes.map((nd) => {
        const pct = Math.round(nd.per * 100);
        const cur = nd.level ? `+${Math.round(nd.per * nd.level * 100)}%` : T('未投入');
        const canAdd = nd.level < nd.max && t.unspent > 0;
        return `<div class="merge-row">
          <span class="mr-name">${T(nd.name)} <span class="hint">${T(nd.label)} +${pct}%/Lv</span></span>
          <span class="hint">${nd.level}/${nd.max} · ${cur}</span>
          <button class="mini-btn ${canAdd ? 'primary' : ''}" data-talent="${nd.id}" ${canAdd ? '' : 'disabled'}>
            ${nd.level >= nd.max ? T('已滿級') : T('投入')}
          </button>
        </div>`;
      }).join('');
      return `<div class="merge-head" style="margin-top:6px"><b>${T(b.name)}</b></div>${nodes}`;
    }).join('');
    return `<div class="checkin-box" style="margin-top:8px">
      <div class="merge-head"><b>${T('命印天賦')}</b>
        <span class="hint">${T('未投入')} ${t.unspent} / ${t.total} · ${T('每點全屬性 +6%')}</span></div>
      <div class="hint" style="margin:4px 0 6px">${T('投入天賦的命印改給該節點效果，不再給每點 +6% 全屬性。')}</div>
      ${rows}
      <button class="mini-btn" id="btnResetTalent" ${t.spent > 0 ? '' : 'disabled'}>
        ${T('重置天賦')}（${t.resetCores} ${T('獸核')}${t.spent ? ` · ${T('退還')} ${t.spent}` : ''}）
      </button>
    </div>`;
  }

  function bindTalents() {
    $$('#rebirthBox [data-talent]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.learnTalent(b.dataset.talent);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderRebirth();
        toast(`${T(r.node.name)} → Lv${r.level}`);
      });
    });
    const rb = $('#btnResetTalent');
    if (rb) rb.addEventListener('click', () => {
      if (rb.dataset.armed === '1') {
        const r = State.resetTalents();
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderRebirth();
        return toast(`${T('已重置，退還')} ${r.refunded} ${T('命印')}`);
      }
      rb.dataset.armed = '1';
      rb.textContent = T('再按一次確認重置');
      setTimeout(() => { rb.dataset.armed = ''; renderRebirth(); }, 4000);
    });
  }

  function doRebirthNow() {
    const r = State.doRebirth();
    if (!r.ok) return toast(r.msg);
    Battle.init();
    renderAll();
    banner(T('轉生'));
    toast(T(`轉生完成：命印 +${r.gain}（累計 ${r.marks}）`));
  }

  /* ================= 靈環 ================= */
  function bindRings() { /* 由 renderRings 綁定 */ }

  function renderRings() {
    const s = State.data;
    const equipped = s.souls.reduce((a, x) => a + x.rings.length, 0);
    $('#ringCount').textContent = T(`背包 ${State.freeRings().length} · 已裝備 ${equipped} · 等級上限 ${State.levelCap()}`);

    if (!s.ringBag.length) {
      $('#ringList').innerHTML = `<div class="card"><div class="hint">${T('還沒有靈環。到「獵靈」擊敗靈獸，就能吸收第一枚靈環。')}</div></div>`;
      return;
    }

    const bagHtml = State.freeRings().map((r) => {
      const t = CFG.TIER_BY_KEY[r.tier];
      const sk = CFG.RING_SKILL[r.tier];
      const el = CFG.ELEMENT_LABEL[r.element] || '';
      return T(`<div class="card compact">
        <div class="row1"><span class="ring-dot ${t.css}"></span><b>${T(t.name)}</b>
        <span class="tag" style="color:${CFG.ELEMENT_COLOR[r.element] || '#fff'}">${I18N.lang === 'en' ? el : el + '系'}</span>
        <span class="hint">攻擊 +${Math.round(t.atk * 100)}% · 生命 +${Math.round(t.hp * 100)}%</span></div>
        ${sk ? `<div class="hint" style="margin-top:4px">${T(sk.label)} · ${sk.type === 'aoe' ? T('群體') : T('震懾')} ×${sk.mult}${sk.chance ? ` · ${Math.round(sk.chance * 100)}% ${T('暈眩')}` : ''}</div>` : T('<div class="hint" style="margin-top:4px">被動：純屬性增幅（無靈技）</div>')}
        <div class="acts">
          ${s.souls.map((soul) => {
            const base = CFG.SOUL_BY_ID[soul.id] || { name: soul.id };
            return T(`<button class="mini-btn" data-eq="${r.uid}" data-soul="${soul.id}">裝到 ${base.name}</button>`);
          }).join('')}
        </div>
      </div>`);
    }).join('');

    const equippedHtml = s.souls.filter((x) => x.rings.length).map((soul) => {
      const base = CFG.SOUL_BY_ID[soul.id] || { name: soul.id };
      return T(`<div class="card">
        <div class="row1"><b>${base.name}</b><span class="hint">已裝備 ${soul.rings.length}/${State.ringSlotsOf(soul)}</span></div>
        <div class="acts">
          ${soul.rings.map((uid) => {
            const r = s.ringBag.find((x) => x.uid === uid) || { tier: 'white' };
            const t = CFG.TIER_BY_KEY[r.tier] || CFG.RING_TIERS[0];
            return T(`<button class="mini-btn" data-un="${uid}" data-soul="${soul.id}">
              <span class="ring-dot ${t.css}" style="display:inline-block;vertical-align:-1px"></span> ${t.name} · 卸下</button>`);
          }).join('')}
        </div>
      </div>`);
    }).join('');

    const info = State.mergeInfo();
    const mergeRows = CFG.RING_ORDER.slice(0, -1).map((tier) => {
      const t = CFG.TIER_BY_KEY[tier];
      const m = info[tier];
      return T(`<div class="merge-row">
        <span class="ring-dot ${t.css}"></span>
        <span class="mr-name">${t.name}</span>
        <span class="mr-count">${m.count} / ${CFG.RING_MERGE_COUNT}</span>
        <button class="mini-btn" data-merge="${tier}" ${m.can ? '' : 'disabled'}>合成</button>
      </div>`);
    }).join('');
    const mergeBox = T(`<div class="merge-box">
      <div class="merge-head"><b>靈環合成</b><span class="hint">3 個同階 → 1 個高一階（不會動已裝備的）</span></div>
      ${mergeRows}
      <button id="btnMergeAll" class="wide-btn small" style="margin-top:8px">一鍵合成（白・黃・紫・黑 全部合到不能再合）</button>
    </div>`);

    $('#ringList').innerHTML = mergeBox + (equippedHtml || '') + bagHtml;
    $$('#ringList [data-merge]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.mergeRings(b.dataset.merge);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        renderAll();
        toast(T(`合成成功：${CFG.TIER_BY_KEY[r.nextTier].name}`));
      });
    });
    const allBtn = $('#btnMergeAll');
    if (allBtn) allBtn.addEventListener('click', () => {
      const r = State.mergeAll();
      if (!r.ok) return toast(T('沒有可合成的靈環（每階需 3 個）'));
      State.save(true);
      renderAll();
      toast(T(`一鍵合成：${r.made} 次，剩餘背包 ${r.free} 個`));
    });

    $$('#ringList [data-eq]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.equipRing(b.dataset.soul, b.dataset.eq);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
        toast(T('靈環已裝備，等級上限提升'));
      });
    });
    $$('#ringList [data-un]').forEach((b) => {
      b.addEventListener('click', () => {
        State.unequipRing(b.dataset.soul, b.dataset.un);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
      });
    });
  }

  /* ================= 獵靈 ================= */
  function bindHunt() { /* 由 renderHunt 綁定 */ }

  function renderHunt() {
    const s = State.data;
    const slotLine = State.teamSouls()
      .map((x) => `${T((CFG.SOUL_BY_ID[x.id] || {}).name || x.id)} ${x.rings.length}/${State.ringSlotsOf(x)}`).join(' · ');
    $('#huntHint').textContent = 'Lv.' + s.level + ' · ' + T('每 10 級開 1 槽') + ' · ' + slotLine
      + ' · ' + T('獸核') + ' ' + (s.cores || 0);
    const html = CFG.BEASTS.map((b) => {
      const t = CFG.TIER_BY_KEY[b.tier];
      const cdLeft = Math.max(0, Math.ceil(((s.cd[b.id] || 0) - Date.now()) / 1000));
      const locked = s.level < b.reqLevel;
      const busy = Battle.state.mode === 'hunt';
      const cnt = State.huntCounter(b.id);
      const elKey = b.element;
      const cntTag = cnt.kind === 'strong' ? `<span class="tag on">${T('剋制 +25%')}</span>`
        : cnt.kind === 'weak' ? `<span class="tag">${T('被剋 -10%')}</span>` : '';
      const ei = State.eliteInfo(b.id);
      const dep = State.depthInfo(b.id);
      return T(`<div class="card">
        <div class="row1">
          <span style="font-size:20px">${b.emoji}</span>
          <b>${T(b.name)}</b>
          <span class="ring-dot ${t.css}"></span>
          <span class="hint">${T(b.year)}</span>
          <span class="tag" style="color:${CFG.ELEMENT_COLOR[elKey] || '#aaa'}">${T(CFG.ELEMENT_LABEL[elKey] || '')}</span>
          ${cntTag}
          ${locked ? `<span class="tag">${T(`需 Lv.${b.reqLevel}`)}</span>` : ''}
        </div>
        <div class="stats">
          <span>${T('生命')} <b>${fmt(b.hp)}</b></span>
          <span>${T('攻擊')} <b>${fmt(b.atk)}</b></span>
          <span>${T('掉落')} <b>${T(t.name)}</b></span>
          <span>${T('獸核')} <b>+${Math.round((CFG.CORE_DROP[b.tier] || 1) * dep.coreMul)}</b></span>
          <span>${T('深林')} <b>${dep.depth} ${T('層')}</b></span>
        </div>
        <div class="acts">
          <button class="mini-btn primary" data-hunt="${b.id}" ${locked || cdLeft > 0 || busy ? 'disabled' : ''}>
            ${cdLeft > 0 ? T(`冷卻 ${cdLeft}s`) : busy ? T('獵靈中…') : T('進入獵殺')}
          </button>
          <button class="mini-btn ${(!ei.used && !locked && cdLeft === 0 && !busy) ? 'primary' : ''}" data-elite="${b.id}"
            ${(!ei.used && !locked && cdLeft === 0 && !busy) ? '' : 'disabled'}>
            ${ei.used ? T('今日精英已打') : T(`精英（×${ei.coreMul} 核）`)}
          </button>
        </div>
      </div>`);
    }).join('');
    $('#beastList').innerHTML = html;
    $$('#beastList [data-elite]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = Battle.hunt(btn.dataset.elite, true);
        if (!r.ok) return toast(r.msg);
        switchTab('battle');
        toast(T('精英靈獸出現，獸核與靈環加倍'));
      });
    });
    $$('#beastList [data-hunt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = Battle.hunt(btn.dataset.hunt);
        if (!r.ok) return toast(r.msg);
        switchTab('battle');
        toast(T('進入靈獸領域，擊敗牠即可吸收靈環'));
      });
    });
  }

  /* ================= 覺醒抽卡 ================= */
  function bindGacha() {
    const pu = $('#btnPullUntil');
    if (pu) pu.addEventListener('click', pullUntilMilestone);
    const rw = $('#btnRewardAd');
    if (rw) {
      rw.addEventListener('click', () => {
        if (!global.GP || !GP.reward) return;
        rw.disabled = true;
        const label = rw.textContent;
        rw.textContent = T('廣告載入中…');
        GP.reward().then((r) => {
          rw.disabled = false;
          rw.textContent = label;
          if (r && r.success) {
            State.addCoins(888);
            State.save(true);
            renderTop();
            toast(T('獎勵已發放：+888 靈幣'));
          } else {
            toast(T('廣告未完成，沒有獎勵'));
          }
        }, () => { rw.disabled = false; rw.textContent = label; });
      });
    }

    $('#btnCheckin').addEventListener('click', () => {
      const r = State.checkIn();
      if (!r.ok) return toast(r.msg);
      State.save(true);
      renderAll();
      toast(T(`第 ${r.dayIndex} 天簽到：${r.reward.label}（連續 ${r.streak} 天）`));
      banner(T(`連續簽到 ${r.streak} 天`));
    });
    $('#btnPull1').addEventListener('click', () => doPull(1));
    $('#btnPull10').addEventListener('click', () => {
      if (!State.data.freeTenUsed) return doPullFree();
      doPull(10);
    });
    $('#btnCode').addEventListener('click', () => {
      const r = State.redeem($('#codeInput').value);
      if (!r.ok) return toast(r.msg);
      $('#codeInput').value = '';
      State.save(true);
      toast(T('兌換成功：') + r.msg);
      renderAll();
    });
  }

  /* 一鍵抽到下一次里程（先券、再鑽，最多 10 抽） */
  function pullUntilMilestone() {
    const s = State.data;
    const need = CFG.RELIC.every - ((s.ticketPulls || 0) % CFG.RELIC.every);
    let done = 0;
    const milestones = [];
    for (let i = 0; i < need; i++) {
      let useTicket = s.tickets >= CFG.PULL_COST_TICKET;
      if (!useTicket && s.diamonds < CFG.PULL_COST_DIAMOND) break;
      const r = State.pullOnce(useTicket);
      if (!r.ok) break;
      done++;
      if (r.milestone) milestones.push(r.milestone);
    }
    if (!done) return toast(T('券與鑽石都不足'));
    State.save(true);
    Battle.refreshTeam();
    renderAll();
    toast(T(`已抽 ${done} 次`));
    milestones.forEach((m) => {
      if (m.kind === 'relic') {
        const t = CFG.RELIC_BY_KEY[m.relic.tier];
        toast(`${T('覺醒里程獎勵')}：${T(m.relic.name)}（${T(t.name)} +${Math.round(t.bonus * 100)}%）`);
      } else {
        toast(`${T('靈寶已全收集')}：+${m.cores} ${T('獸核')}`);
      }
    });
  }

  function doPull(times) {
    const s = State.data;
    const useTicket = times === 10
      ? s.tickets >= CFG.PULL10_COST_TICKET
      : s.tickets >= CFG.PULL_COST_TICKET;
    const results = [];
    const milestones = [];
    for (let i = 0; i < times; i++) {
      const r = State.pullOnce(useTicket);
      if (!r.ok) { if (i === 0) toast(r.msg); break; }
      results.push(r.result);
      if (r.milestone) milestones.push(r.milestone);
    }
    if (!results.length) return;
    s.stats.pulls += results.length;
    State.save(true);
    Battle.refreshTeam();
    renderAll();
    renderPullResults(results);
    milestones.forEach((m) => {
      if (m.kind === 'relic') {
        const t = CFG.RELIC_BY_KEY[m.relic.tier];
        toast(`${T('覺醒里程獎勵')}：${T(m.relic.name)}（${T(t.name)} +${Math.round(t.bonus * 100)}%）`);
        addLog(`${T('覺醒里程')} ${m.at} · ${T('獲得靈寶')} ${T(m.relic.name)}（${T(t.name)}）`, 'c-gold');
        if (global.SFX) SFX.clear();
      } else {
        toast(`${T('靈寶已全收集')}：+${m.cores} ${T('獸核')}`);
        addLog(`${T('覺醒里程')} ${m.at} · ${T('靈寶已全收集')} +${m.cores} ${T('獸核')}`, 'c-gold');
      }
    });
    if (milestones.length) { State.save(true); renderAll(); }
  }

  function doPullFree() {
    const res = State.pullTenFree();
    if (!res.ok) { toast(res.msg); return; }
    State.save(true);
    Battle.refreshTeam();
    renderAll();
    toast(T('免費十連已領取'));
    renderPullResults(res.results);
    (res.milestones || []).forEach((m) => {
      if (m.kind === 'relic') {
        const t = CFG.RELIC_BY_KEY[m.relic.tier];
        toast(`${T('覺醒里程獎勵')}：${T(m.relic.name)}（${T(t.name)} +${Math.round(t.bonus * 100)}%）`);
      } else {
        toast(`${T('靈寶已全收集')}：+${m.cores} ${T('獸核')}`);
      }
    });
    renderAll();
  }

  function renderPullResults(results) {
    $('#pullResult').innerHTML = results.map((r) => {
      const cls = r.star >= 5 ? 's5' : r.star >= 4 ? 's4' : '';
      const label = r.kind === 'bone' ? `${T(r.name)}（${T(r.desc || '靈骨')}）`
        : r.kind === 'star' ? T(`${r.name} ★${r.star}（升星）`)
        : r.kind === 'dup' ? T(`${r.name}（重複 → +${r.diamonds}💎）`)
        : `${r.name} ★${r.star}`;
      return `<span class="pull-chip ${cls}">${label}</span>`;
    }).join('');
  }

  function renderCheckin() {
    const info = State.checkinInfo();
    const cells = CFG.CHECKIN.map((r) => {
      const isToday = info.canCheck && r.day === info.dayIndex;
      const done = !info.canCheck ? r.day <= info.dayIndex : r.day < info.dayIndex;
      const big = r.day === 7 ? ' big' : '';
      return T(`<div class="ci-cell${done ? ' done' : ''}${isToday ? ' today' : ''}${big}" title="${r.label}">
        <div class="d">${T(`第${r.day}天`)}</div>
        <div class="e">${r.emoji}</div>
        <div class="l">${T(r.label.replace(/\s/g, ''))}</div>
      </div>`);
    }).join('');
    $('#checkinGrid').innerHTML = cells;
    $('#streakInfo').textContent = info.streak > 0 ? T(`連續 ${info.streak} 天`) : T('連續簽到有獎');
    const btn = $('#btnCheckin');
    btn.disabled = !info.canCheck;
    btn.textContent = info.canCheck
      ? T(`領取第 ${info.dayIndex} 天獎勵（${info.reward.label}）`)
      : T(`今天已簽到 · 明天再來`);
    const dot = $('#checkinDot');
    if (dot) dot.classList.toggle('hidden', !info.canCheck);
    return info;
  }

  /* 複製存檔碼：clipboard API → execCommand → 手動長按 */
  function copySaveCode() {
    const ta = $('#expArea');
    if (!ta) return;
    const text = ta.value;
    const done = () => toast(T('已複製存檔碼'));
    const fallback = () => {
      try {
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        if (document.execCommand && document.execCommand('copy')) return done();
      } catch (e) { /* 繼續往下 */ }
      toast(T('已全選，請長按文字選「拷貝」'));
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
      return;
    }
    fallback();
  }

  function renderDaily() {
    const box = $('#dailyBox');
    if (!box) return;
    const tasks = State.dailyInfo();
    const rows = tasks.map((t) => `<div class="merge-row">
        <span class="mr-name">${T(t.label)}</span>
        <span class="mr-count">${Math.min(t.need, t.done)} / ${t.need}</span>
        <button class="mini-btn ${t.can ? 'primary' : ''}" data-daily="${t.id}"
          ${t.can ? '' : 'disabled'}>
          ${t.claimed ? T('已領') : T(`領 ${t.reward.diamonds} 💎`)}
        </button>
      </div>`).join('');
    box.innerHTML = `<div class="merge-head"><b>${T('每日任務')}</b>
        <span class="hint">${T('每天 0 點重置')}</span></div>${rows}`;
    $$('#dailyBox [data-daily]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.dailyClaim(b.dataset.daily);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        renderAll();
        toast(T(`任務完成：+${r.reward.diamonds} 💎`));
      });
    });
  }

  let achAt = 0;
  function checkAch() {
    const now = Date.now();
    if (now - achAt < 3000) return;
    achAt = now;
    const fresh = State.checkAchievements();
    if (fresh.length) {
      State.save(true);
      if (global.SFX) SFX.unlock();
      fresh.forEach((a) => addLog(T(`成就解鎖：${a.name}（${a.desc}）`), 'c-gold'));
      toast(T(`成就解鎖：${fresh[0].name}`));
      renderAch();
    }
  }

  function renderAch() {
    const box = $('#achBox');
    if (!box) return;
    const list = State.achList();
    const got = list.filter((a) => a.unlocked).length;
    const pct = Math.round(State.achCount() * CFG.ACH_BONUS * 1000) / 10;
    const rows = list.map((a) => `<div class="merge-row">
        <span class="mr-name">${a.unlocked ? '✅' : '⬜'} ${T(a.name)}</span>
        <span class="mr-count">${T(a.desc)}</span>
      </div>`).join('');
    box.innerHTML = `<div class="merge-head"><b>${T('成就')}</b>
        <span class="hint">${got} / ${list.length} · ${T(`全屬性 +${pct}%`)}</span></div>${rows}`;
  }

  function renderGacha() {
    const s = State.data;
    renderDaily();
    renderAch();
    $('#ticketInfo').textContent = T(`覺醒券 ${s.tickets} · 鑽石 ${fmt(s.diamonds)}`);
    $('#btnPull1').textContent = T(`覺醒一次（${CFG.PULL_COST_TICKET} 券 / ${CFG.PULL_COST_DIAMOND} 💎）`);
    $('#btnPull10').textContent = s.freeTenUsed
      ? T(`十連覺醒（${CFG.PULL10_COST_TICKET} 券 / ${CFG.PULL10_COST_DIAMOND} 💎）`)
      : T('首次十連（免費）');
    $('#btnPull1').disabled = s.tickets < CFG.PULL_COST_TICKET && s.diamonds < CFG.PULL_COST_DIAMOND;
    $('#btnPull10').disabled = s.freeTenUsed
      && s.tickets < CFG.PULL10_COST_TICKET && s.diamonds < CFG.PULL10_COST_DIAMOND;
  }

  /* ================= 頂部 / 全部 ================= */
  function renderTop() {
    const s = State.data;
    $('#playerName').textContent = s.name;
    $('#coins').textContent = fmt(s.coins);
    $('#diamonds').textContent = fmt(s.diamonds);
    const mk = $('#marks');
    if (mk) {
      mk.textContent = s.marks > 0 ? `🌀${s.marks}` : '';
      mk.style.display = s.marks > 0 ? '' : 'none';
    }
    const p = State.power();
    const el = $('#power');
    if (el.textContent !== String(p)) {
      el.textContent = fmt(p);
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 180);
    }
  }

  const STAT_LABEL = { atk: '攻擊', hp: '生命', def: '防禦', spd: '速度', all: '全屬性' };
  const PRIORITY_LABEL = { boss: '推進', hunt: '獵靈', farm: '推關' };

  function renderShop() {
    const box = $('#shopBox');
    if (!box) return;
    const list = State.shopInfo();
    const rows = list.map((it) => {
      const cost = Object.keys(it.cost).map((c) => {
        const n = it.cost[c];
        return c === 'cores' ? `${n} ${T('獸核')}` : c === 'diamonds' ? `${n} 💎` : `${fmt(n)} ${T('靈幣')}`;
      }).join(' + ');
      return `<div class="merge-row">
        <span class="mr-name">${T(it.name)}</span>
        <span class="hint">${cost} · ${T('剩')} ${it.left}</span>
        <button class="mini-btn ${it.can ? 'primary' : ''}" data-shop="${it.id}" ${it.can ? '' : 'disabled'}>
          ${it.left <= 0 ? T('售完') : T('購買')}
        </button>
      </div>`;
    }).join('');
    box.innerHTML = `<div class="merge-head"><b>${T('商店')}</b>
        <span class="hint">${T('每日 0 點補貨')} · ${T('重鑄券')} ${State.data.rerolls || 0}</span></div>${rows}`;
    $$('#shopBox [data-shop]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.shopBuy(b.dataset.shop);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        renderAll();
        toast(T(`購買成功：`) + T(r.item.name));
      });
    });
  }

  function renderRelic() {
    const box = $('#relicBox');
    if (!box) return;
    const info = State.relicMilestoneInfo();
    const owned = State.relicCount();
    const w = info.weights;
    const odds = CFG.RELIC_TIERS.map((t) => {
      const tot = Object.keys(w).reduce((a, k) => a + w[k], 0) || 1;
      return `${T(t.name)} ${Math.round((w[t.key] / tot) * 100)}%`;
    }).join(' · ');
    box.innerHTML = T(`<div class="merge-head"><b>覺醒里程</b>
        <span class="hint">${info.have} / ${info.need} ${T('抽')}</span></div>
      <div class="stats">
        <span>靈寶 <b>${owned} / ${info.all}</b></span>
        <span>再 ${info.nextIn} 抽 <b>得一件</b></span>
      </div>
      <div class="hint" style="margin-top:6px">${T('機率隨戰績提升')}：${odds}</div>
      <button class="wide-btn small" id="btnRelics" style="margin-top:8px">${T('靈寶收藏')}</button>`);
    const b = $('#btnRelics');
    if (b) b.addEventListener('click', showRelics);
  }

  function relicRowsHtml() {
    const list = State.relicInfo();
    return CFG.RELIC_TIERS.map((t) => {
      const items = list.filter((r) => r.tier === t.key);
      const rows = items.map((r) => {
        if (!r.owned) {
          return `<div class="merge-row"><span class="mr-name">❔ ${T('未解鎖')}</span>
            <span class="hint">${T('覺醒里程可得')}</span><span></span></div>`;
        }
        const can = !r.maxed && (State.data.cores | 0) >= (r.cost || 0);
        return `<div class="merge-row">
          <span class="mr-name">🔮 ${T(r.name)} <span class="hint">Lv ${r.level}/${r.max}</span></span>
          <span class="hint">+${r.curPct}% ${T(STAT_LABEL[r.stat] || r.stat)}</span>
          <button class="mini-btn ${can ? 'primary' : ''}" data-relic="${r.id}" ${can ? '' : 'disabled'}>
            ${r.maxed ? T('已滿級') : `${T('升級')} · ${r.cost} ${T('獸核')}`}
          </button>
        </div>`;
      }).join('');
      return `<div class="codex-group"><div class="merge-head">
          <b style="color:${t.color}">${T(t.name)} +${Math.round(t.bonus * 100)}%</b></div>${rows}</div>`;
    }).join('');
  }

  function showRelics() {
    const info = State.relicMilestoneInfo();
    openModal(T('靈寶收藏'), `
      <div class="hint">${T('每 10 次覺醒抽得一件（券或鑽都算），12 件限量、各只能拿一次')}</div>
      <div class="hint">${T('目前進度')} ${info.have}/${info.need} · ${T('已收集')} ${info.owned}/${info.all}</div>
      <div class="hint" style="margin-top:6px">${T('升級只吃獸核：每級 +30%，滿級再給全屬性 +2%')}</div>
      ${relicRowsHtml()}`,
      [{ text: T('關閉'), kind: 'primary' }]);
    bindRelicUpgrade();
  }

  function bindRelicUpgrade() {
    $$('[data-relic]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.relicUpgrade(b.dataset.relic);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
        toast(`${T('靈寶升級')} → Lv ${r.level}`);
        showRelics();          // 重畫收藏視窗
      });
    });
  }

  function renderWeekly() {
    const box = $('#weeklyBox');
    if (!box) return;
    const tasks = State.weeklyInfo();
    const rows = tasks.map((t) => `<div class="merge-row">
        <span class="mr-name">${T(t.label)}</span>
        <span class="mr-count">${Math.min(t.need, t.done)} / ${t.need}</span>
        <button class="mini-btn ${t.can ? 'primary' : ''}" data-weekly="${t.id}"
          ${t.can ? '' : 'disabled'}>
          ${t.claimed ? T('已領') : T(`領 ${t.reward.diamonds} 💎`)}
        </button>
      </div>`).join('');
    box.innerHTML = `<div class="merge-head"><b>${T('每週任務')}</b>
        <span class="hint">${T('週一 0 點重置')}</span></div>${rows}`;
    $$('#weeklyBox [data-weekly]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.weeklyClaim(b.dataset.weekly);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        renderAll();
        toast(T(`任務完成：+${r.reward.diamonds} 💎`));
        if (global.SFX) SFX.unlock();
      });
    });
  }

  function renderCodex() {
    const el = $('#codexInfo');
    if (!el) return;
    const info = State.codexInfo();
    el.textContent = `${info.owned} / ${info.total} · +${(info.bonus * 100).toFixed(1)}%`;
  }

  function showCodex() {
    const info = State.codexInfo();
    const blocks = info.groups.map((g) => `<div class="codex-group">
        <div class="merge-head"><b>${T(g.label)}</b><span class="hint">${g.got} / ${g.all}</span></div>
        <div class="codex-grid">${g.items.map((it) => `<span class="codex-cell ${it.owned ? 'on' : ''}">
            <i>${it.owned ? it.emoji : '❔'}</i><b>${it.owned ? T(it.name) : T('未解鎖')}</b></span>`).join('')}</div>
      </div>`).join('');
    openModal(T('圖鑑'), T(`
      <div class="hint">${T('已收集')} ${info.owned} / ${info.total} · ${T('全屬性')} +${(info.bonus * 100).toFixed(1)}%</div>
      ${blocks}`),
      [{ text: T('關閉'), kind: 'primary' }]);
  }

  function renderAll() {
    renderTop();
    renderSpireBtn();
    renderSpeed();
    renderBattle();
    renderSouls();
    renderBones();
    renderRebirth();
    renderRebirthHint();
    renderRings();
    renderHunt();
    renderCheckin();
    renderGacha();
    renderWeekly();
    renderCodex();
    renderRelic();
    renderShop();
  }

  /* ================= 戰鬥事件 → 畫面 ================= */
  function onBattleEvent(ev) {
    switch (ev.type) {
      case 'hit': {
        const target = ev.side === 'enemy'
          ? (enemyEls.get(ev.enemyId) || $('#enemyRow .unit'))
          : $(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`);
        if (target) {
          target.classList.add('hit');
          setTimeout(() => target.classList.remove('hit'), 180);
          floatNum(target, '-' + fmt(ev.amount), ev.crit ? 'crit' : '');
        }
        break;
      }
      case 'heal':
        floatNum($(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`), '+' + fmt(ev.amount), 'heal');
        break;
      case 'stun':
        if (ev.who === 'enemy') banner(T('纏繞！'));
        break;
      case 'aoe':
        addLog(T(`群攻命中 ${ev.count} 隻靈獸`), 'c-purple');
        break;
      case 'bossRage':
        banner(T('狂暴'));
        addLog(`${T(ev.name)} · ${T('狂暴（攻擊 +35%）')}`, 'c-bad');
        break;
      case 'bossHeal': {
        const el = enemyEls.get(ev.enemyId);
        if (el) floatNum(el, '+' + fmt(ev.amount), 'heal');
        addLog(`${T(ev.name)} · ${T('回復 10% 生命')}`, 'c-bad');
        break;
      }
      case 'shield':
        floatNum($(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`), T('護盾'), 'skill');
        break;
      case 'milestone': {
        const mt = CFG.TIER_BY_KEY[ev.ring.tier];
        addLog(`${T('里程碑')}：${T('第關')} ${ev.stage} · ${T('獲得')} ${T(mt.name)}`, 'c-gold');
        toast(`${T('里程碑獎勵')}：${T(mt.name)}`);
        if (global.SFX) SFX.unlock();
        break;
      }
      case 'skill': {
        ringFx(ev.unit, ev.element);
        banner(ev.resonance ? `${T(ev.name)} · ${T('共鳴')}` : T(ev.name));
        if (ev.ring) addLog(`${T(ev.name)}${ev.resonance ? T('（屬性共鳴 +25%）') : ''}`, 'c-purple');
        break;
      }
      case 'kill': {
        if (global.SFX) SFX.kill();
        checkAch();
        const left = ev.left
          ? (I18N.lang === 'en' ? ` (${ev.left} left)` : `（剩 ${ev.left} 隻）`)
          : '';
        addLog(`${T('擊殺')}${ev.boss ? T('守關靈獸') : T('靈獸')}${left} · ${T('靈幣')} +${fmt(ev.coins)} · ${T('經驗')} +${fmt(ev.exp)}`,
          ev.boss ? 'c-gold' : '');
        break;
      }
      case 'levelup':
        if (global.SFX) SFX.levelup();
        banner(T('境界提升'));
        addLog(T(`等級提升 → Lv.${ev.level}`), 'c-ok');
        break;
      case 'bossReady':
        addLog(T('守關靈獸出現，可以挑戰 BOSS 了'), 'c-gold');
        break;
      case 'bossStart':
        banner(T('BOSS 戰'));
        addLog(T(`挑戰第 ${ev.stage} 關守關靈獸`), 'c-purple');
        break;
      case 'stageClear':
        if (global.SFX) SFX.clear();
        banner(T('通關'));
        addLog(`${T('第關')} ${ev.stage} ${T('關開啟')} · ${T('掛機效率提升')}`, 'c-ok');
        break;
      case 'huntStart':
        banner(T('獵靈'));
        addLog(`${T('進入靈獸領域')}：${T(ev.beast.name)}${I18N.lang === 'en' ? '' : `（${ev.beast.year}）`}`, 'c-purple');
        break;
      case 'autoMerge':
        addLog(T(`自動合成 ${ev.made} 次低階靈環（3 個 → 1 個高一階）`), 'c-ok');
        break;
      case 'autoRing': {
        const t = CFG.TIER_BY_KEY[ev.ring.tier];
        addLog(`${T('已自動裝備')} ${t ? T(t.name) : T('靈環')} · ${T('等級上限')} ${State.levelCap()}`, 'c-ok');
        break;
      }
      case 'huntLose':
        addLog(T(`獵靈失敗：${ev.beast ? ev.beast.name : T('靈獸')} 太強，15 秒後可再試（先去升級或補靈骨）`), 'c-bad');
        break;
      case 'spireClear': {
        addLog(`${T('深塔')} ${T('第關')} ${ev.floor} ${T('層')}${ev.newBest ? ' · ' + T('新紀錄') : ''}`, ev.boss ? 'c-gold' : 'c-purple');
        if (ev.floor % 10 === 0) toast(`${T('深塔')} ${ev.floor} ${T('層')} → +${CFG.SPIRE.coreAmount} ${T('獸核')}`);
        renderAll();
        break;
      }
      case 'spireEnd': {
        banner(T('深塔結束'));
        toast(`${T('抵達')} ${ev.floor} ${T('層')} · ${T('最高')} ${ev.best}`);
        addLog(`${T('深塔結束')} · ${T('抵達')} ${ev.floor} ${T('層')} · ${T('最高')} ${ev.best}${ev.cores ? ` · ${T('獸核')} +${ev.cores}` : ''}`, 'c-gold');
        State.save(true);
        renderAll();
        break;
      }
      case 'dungeonWin': {
        const rw = ev.reward;
        const txt = rw ? (rw.stat === 'coins' ? `${T('靈幣')} +${fmt(rw.amount)}`
          : rw.stat === 'cores' ? `${T('獸核')} +${rw.amount}`
          : `${T('覺醒券')} +${rw.amount}`) : T('沒有獎勵');
        banner(T('副本完成'));
        addLog(`${T('副本完成')} · ${txt}`, 'c-gold');
        toast(txt);
        State.save(true);
        renderAll();
        break;
      }
      case 'dungeonLose': {
        toast(T('副本失敗，明天再來'));
        renderAll();
        break;
      }
      case 'huntWin': {
        const t = CFG.TIER_BY_KEY[ev.ring.tier];
        banner(T('吸收靈環'));
        addLog(`${T('擊敗')} ${T(ev.beast.name)} · ${T('吸收')} ${T(t.name)} · ${T('獸核')} +${ev.cores || 0} · ${T('深林')} ${ev.depth || 1} ${T('層')}`, 'c-gold');
        if (ev.bonusRing) {
          const bt = CFG.TIER_BY_KEY[ev.bonusRing.tier];
          addLog(`${T('深林獎勵')} · ${T('額外')} ${T(bt.name)}`, 'c-purple');
        }
        toast(`${T('獲得')} ${T(t.name)}`);
        State.save(true);
        renderAll();
        break;
      }
      case 'wipe':
        banner(T('全隊倒下'));
        addLog(T('全隊倒下，2 秒後自動重整'), 'c-bad');
        break;
      case 'revived':
        addLog(T('靈印重新凝聚，繼續戰鬥'), 'c-ok');
        break;
      default: break;
    }
  }

  function unitIndex(unit) {
    if (!unit) return 0;
    const i = Battle.state.units.findIndex((u) => u.id === unit.id);
    return i < 0 ? 0 : i;
  }

  function floatNum(el, text, cls) {
    if (!el) return;
    if (typeof text === 'string' && /^[-+]?0$/.test(text)) return;   // 護盾吃滿的 0 不顯示
    const host = $('#floaters');
    if (!host) return;
    while (host.children.length > 11) host.removeChild(host.firstChild);
    const hr = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'float-num ' + (cls || '');
    span.textContent = text;
    span.style.left = (r.left - hr.left + r.width / 2 + (Math.random() * 18 - 9)) + 'px';
    span.style.top = (r.top - hr.top - 8) + 'px';
    host.appendChild(span);
    setTimeout(() => span.remove(), 900);
  }

  function ringFx(unit, element) {
    const fx = $('#ringFx');
    if (!fx) return;
    const role = (unit && unit.role) || 'atk';
    const color = (element && CFG.ELEMENT_COLOR[element])
      || (role === 'ctrl' ? '#b06bff' : role === 'def' ? '#6ea8ff' : role === 'sup' ? '#57d98b' : '#ffd93d');
    fx.style.setProperty('--ring', color);
    fx.classList.remove('on');
    void fx.offsetWidth;
    fx.classList.add('on');
    setTimeout(() => fx.classList.remove('on'), 950);
  }

  let bannerTimer = 0;
  function banner(text) {
    const el = $('#battleBanner');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 900);
  }

  function addLog(text, cls) {
    const log = $('#log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = cls || '';
    div.textContent = text;
    log.appendChild(div);
    while (log.children.length > 40) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 220);
    }, 1600);
  }

  /* ================= 主渲染循環 ================= */
  let lastBattleRender = 0;
  function loop(ts) {
    if (tab === 'battle' && ts - lastBattleRender > 90) {
      lastBattleRender = ts;
      renderBattle();
      renderTop();
    }
    requestAnimationFrame(loop);
  }

  /* ================= 彈窗 ================= */
  function openModal(title, bodyHtml, buttons) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    const btns = $('#modalBtns');
    btns.innerHTML = '';
    (buttons || [{ text: T('關閉'), kind: '' }]).forEach((b) => {
      const el = document.createElement('button');
      el.textContent = b.text;
      if (b.kind === 'primary') el.className = 'primary';
      el.addEventListener('click', () => { if (b.onClick) b.onClick(); else closeModal(); });
      btns.appendChild(el);
    });
    $('#modal').classList.remove('hidden');
    // 無障礙：開窗先把焦點放進窗內，關窗還原（鍵盤／輔助技術才走得完流程）
    lastFocus = document.activeElement;
    const first = $('#modalBody').querySelector('button, textarea, input') || btns.querySelector('button');
    if (first) { try { first.focus(); } catch (e) {} }
  }

  /* Tab 鎖在彈窗內、Esc 關窗 */
  function modalKeydown(e) {
    const modal = $('#modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(modal.querySelectorAll('button, textarea, input, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  let lastFocus = null;
  function closeModal() {
    $('#modal').classList.add('hidden');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  function showOffline(g) {
    const h = Math.floor(g.minutes / 60), m = g.minutes % 60;
    const lvLine = g.levels > 0
      ? `<div>${T('等級')} <b class="c-ok">${g.levelBefore} → ${g.levelAfter}</b> <span class="hint">(+${g.levels})</span></div>`
      : `<div>${T('等級')} <b>${g.levelAfter}</b> <span class="hint">${T('（未升級）')}</span></div>`;
    openModal(T('離線收益'), T(`
      <div>${T('離線')} <b>${h > 0 ? h + ' ' + T('小時') + ' ' : ''}${m} ${T('分')}</b>${g.capped ? T('（已達 12 小時上限）') : ''}</div>
      <div style="margin-top:8px">靈幣 <b class="c-gold">+${fmt(g.coins)}</b>
        <span class="hint">(${fmt(g.coinsPerMin)} / ${T('分')})</span></div>
      <div>經驗 <b class="c-ok">+${fmt(g.exp)}</b>
        <span class="hint">(${fmt(g.expPerMin)} / ${T('分')})</span></div>
      ${g.expCapped ? `<div class="hint">${T('離線經驗上限')}：Lv ${g.expCapLv}${g.rawExp > g.exp ? `（${T('原始')} +${fmt(g.rawExp)}）` : ''}</div>` : ''}
      ${lvLine}
      <div class="hint" style="margin-top:8px">${T('掛機效率會隨關卡提升')} · ${T('目前第')} ${g.stage} ${T('關')}</div>`),
      [
        { text: T('看廣告 ×2'), kind: '', onClick: () => {
          if (!global.GP || !GP.reward) { toast(T('這裡沒有廣告可用')); return; }
          GP.reward().then((r) => {
            if (!r || !r.success) { toast(T('廣告未完成')); return; }
            const d = State.claimOfflineDouble();
            if (!d.ok) { toast(d.msg); return; }
            State.save(true);
            renderAll();
            toast(`${T('離線收益加倍')}：+${fmt(d.coins)} ${T('靈幣')}`);
          }, () => toast(T('廣告未完成')));
        } },
        { text: T('領取'), kind: 'primary', onClick: () => { closeModal(); State.save(true); renderAll(); } },
      ]);
  }

  /* 存檔狀態一行字：主檔 / 備份 / 備份時間 / 寫入錯誤 */
  function saveStatusLine() {
    const st = State.saveStatus();
    const map = { ok: T('正常'), corrupt: T('損毀'), missing: T('無') };
    let txt = `${T('主檔')} ${map[st.main]} · ${T('備份')} ${map[st.bak]}`;
    if (st.bak === 'ok' && st.bakTime) {
      const d = new Date(st.bakTime);
      const p2 = (n) => ('0' + n).slice(-2);
      txt += `（${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}）`;
    }
    if (st.lastError) txt += ` · ${T('寫入失敗')}`;
    if (st.blocked) txt += ` · ${T('已停止自動存檔')}`;
    return txt;
  }

  function showMenu() {
    const s = State.data;
    openModal(T('設定'), T(`
      <div>靈師：<b>${s.name}</b></div>
      <div>最高關卡：<b>${s.bestStage}</b> · 等級 <b>${s.level}</b> / ${State.levelCap()}</div>
      <div>${T('版本')}：<b>v${CFG.VERSION}</b> · ${T(`環槽 ${State.ringSlotsOf(s.souls[0])} 格 / 靈印`)}</div>
      <div style="margin-top:8px">${T('戰力明細')}：${T('攻擊')} <b>${fmt(State.teamStats().atk)}</b> ·
        ${T('生命')} <b>${fmt(State.teamStats().hp)}</b> ·
        ${T('防禦')} <b>${fmt(State.teamStats().def)}</b> ·
        ${T('速度')} <b>${State.teamStats().spd}</b> ·
        ${T('爆擊')} <b>${Math.round(State.critChance() * 100)}%</b></div>
      <div class="hint" style="margin-top:4px">${T('加成各自乘算：靈環（加法）→ 靈骨 → 命印 → 真身；戰力停住通常代表該轉生了')}</div>
      <div class="hint" style="margin-top:4px">${T('若靈印頁的靈環槽顯示 /3 或等級上限是 90，代表瀏覽器還在使用舊檔：請開 ?v=2 或清快取。')}</div>
      <div style="margin-top:8px">${T('存檔會自動保存在這台裝置的瀏覽器；換裝置請用存檔碼。')}</div>
      <div class="hint" style="margin-top:6px">${T('存檔狀態')}：${saveStatusLine()}</div>
      ${State.saveStatus().bak === 'ok' ? `<button class="btn btn-ghost" id="btnRestoreBak" style="margin-top:6px">${T('還原備份')}</button>` : ''}
      <div style="margin-top:10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px">
        <b style="font-size:12px;color:#c9a4ff">${T('紀錄')}</b>
        <div class="hint" style="margin-top:4px">
          ${T('最高關卡')} <b>${s.bestStage}</b> ·
          ${T('最高戰力')} <b>${fmt((s.stats && s.stats.bestPower) || State.power())}</b> ·
          ${T('轉生')} <b>${s.rebirths || 0}</b> ·
          ${T('命印')} <b>${s.marks || 0}</b><br>
          ${T('累計擊殺')} <b>${fmt((s.stats && s.stats.kills) || 0)}</b> ·
          ${T('獵靈')} <b>${(s.stats && s.stats.hunts) || 0}</b> ·
          ${T('連續簽到')} <b>${(s.checkin && s.checkin.streak) || 0}</b> ${T('天')} ·
          ${T('成就')} <b>${State.achCount()} / ${CFG.ACHIEVEMENTS.length}</b>
        </div>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:10px">
        <button class="mini-btn" id="btnSfx">${T('音效')}${I18N.lang === 'en' ? ': ' : '：'}${(global.SFX && SFX.enabled) ? T('開') : T('關')}</button>
        <button class="mini-btn" id="btnBgm">${T('音樂')}${I18N.lang === 'en' ? ': ' : '：'}${(global.SFX && SFX.bgm) ? T('開') : T('關')}</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn ${I18N.lang === 'en' ? 'primary' : ''}" id="btnLangEn">English</button>
        <button class="mini-btn ${I18N.lang === 'zh' ? 'primary' : ''}" id="btnLangZh">中文</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn" id="btnAutoMerge">自動合成低階環：${(s.settings.autoMerge === false) ? T('關') : T('開')}</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn" id="btnAutoBoss">自動挑戰 BOSS：${s.settings.autoBoss === false ? T('關') : T('開')}</button>
        <button class="mini-btn" id="btnAutoHunt">卡等自動獵靈：${s.settings.autoHunt === false ? T('關') : T('開')}</button>
        <button class="mini-btn" id="btnAutoRing">自動裝備靈環：${s.settings.autoRing === false ? T('關') : T('開')}</button>
        <button class="mini-btn" id="btnAutoStar">自動升星：${(s.settings || {}).autoStar === false ? T('關') : T('開')}</button>
        <button class="mini-btn" id="btnPriority">${T('優先')}：${T(PRIORITY_LABEL[(s.settings || {}).autoPriority || 'boss'])}</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn" id="btnExport">匯出存檔碼</button>
        <button class="mini-btn" id="btnImport">匯入存檔碼</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn ghost" id="btnRename">改暱稱</button>
        <button class="mini-btn ghost" id="btnReset">重新開始</button>
      </div>`),
      [{ text: T('關閉'), kind: '' }]);

    $('#btnSfx').addEventListener('click', () => {
      if (!global.SFX) return;
      SFX.setEnabled(!SFX.enabled);
      $('#btnSfx').textContent = `${T('音效')}：${SFX.enabled ? T('開') : T('關')}`;
      if (SFX.enabled) SFX.tap();
    });
    const bgmBtn = $('#btnBgm');
    if (bgmBtn) bgmBtn.addEventListener('click', () => {
      if (!global.SFX) return;
      SFX.bgmSet(!SFX.bgm);
      bgmBtn.textContent = `${T('音樂')}${I18N.lang === 'en' ? ': ' : '：'}${SFX.bgm ? T('開') : T('關')}`;
    });
    const prioBtn = $('#btnPriority');
    if (prioBtn) prioBtn.addEventListener('click', () => {
      const list = ['boss', 'hunt', 'farm'];
      const cur = (State.data.settings || {}).autoPriority || 'boss';
      const next = list[(list.indexOf(cur) + 1) % list.length];
      State.data.settings.autoPriority = next;
      State.save(true);
      prioBtn.textContent = `${T('優先')}：${T(PRIORITY_LABEL[next])}`;
      toast(`${T('優先')}：${T(PRIORITY_LABEL[next])}`);
    });
    const autoStarBtn = $('#btnAutoStar');
    if (autoStarBtn) autoStarBtn.addEventListener('click', () => {
      const s2 = State.data;
      s2.settings.autoStar = s2.settings.autoStar === false;   // 切換
      State.save(true);
      autoStarBtn.textContent = `${T('自動升星')}：${s2.settings.autoStar ? T('開') : T('關')}`;
    });
    $('#btnLangEn').addEventListener('click', () => I18N.setLang('en'));
    $('#btnLangZh').addEventListener('click', () => I18N.setLang('zh'));
    const rb = $('#btnRestoreBak');
    if (rb) rb.addEventListener('click', () => {
      const r = State.restoreBackup();
      if (r.ok) { closeModal(); toast(T(`已還原備份：第 ${r.stage} 關`)); renderAll(); }
      else toast(T('備份無法還原'));
    });

    $('#btnAutoMerge').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoMerge = st.autoMerge === false;
      State.save(true);
      $('#btnAutoMerge').textContent = T(`自動合成低階環：${st.autoMerge ? T('開') : T('關')}`);
      toast(T(`自動合成 ${st.autoMerge ? T('已開啟（只合十年/百年）') : T('已關閉')}`));
    });

    $('#btnAutoBoss').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoBoss = st.autoBoss === false;
      State.save(true);
      $('#btnAutoBoss').textContent = T(`自動挑戰 BOSS：${st.autoBoss ? T('開') : T('關')}`);
      toast(T(`自動挑戰 BOSS ${st.autoBoss ? T('已開啟') : T('已關閉')}`));
    });
    $('#btnAutoHunt').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoHunt = st.autoHunt === false;
      State.save(true);
      $('#btnAutoHunt').textContent = T(`卡等自動獵靈：${st.autoHunt ? T('開') : T('關')}`);
      toast(T(`卡等自動獵靈 ${st.autoHunt ? T('已開啟') : T('已關閉')}`));
    });

    $('#btnAutoRing').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoRing = st.autoRing === false;
      State.save(true);
      $('#btnAutoRing').textContent = T(`自動裝備靈環：${st.autoRing ? T('開') : T('關')}`);
      toast(T(`自動裝備靈環 ${st.autoRing ? T('已開啟') : T('已關閉')}`));
    });

    $('#btnExport').addEventListener('click', () => {
      const code = State.exportCode();
      openModal(T('匯出存檔碼'), T(`
        <div class="hint">${T('按「複製」後貼到新裝置的「匯入存檔碼」；若沒反應，長按框內文字全選再複製。')}</div>
        <textarea id="expArea" readonly rows="6">${code}</textarea>`),
        [{ text: T('關閉'), kind: '' }, { text: T('複製'), kind: 'primary', onClick: () => copySaveCode() }]);
      const ta = $('#expArea');
      if (ta) { ta.focus(); try { ta.select(); } catch (e) {} }
    });

    $('#btnImport').addEventListener('click', () => {
      openModal(T('匯入存檔碼'), T(`
        <div class="hint">貼上存檔碼，會覆蓋目前進度。</div>
        <textarea id="impArea" placeholder="貼上存檔碼"></textarea>`),
        [{ text: T('取消'), kind: '' }, { text: T('匯入'), kind: 'primary', onClick: () => {
          const r = State.importCode($('#impArea').value);
          if (!r.ok) return toast(r.msg);
          closeModal(); Battle.init(); renderAll(); toast(T('存檔已匯入'));
        } }]);
    });

    $('#btnRename').addEventListener('click', () => {
      openModal(T('改暱稱'), `<input id="nameInput" maxlength="10" value="${s.name}" style="width:100%;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#fff">`,
        [{ text: T('取消'), kind: '' }, { text: T('儲存'), kind: 'primary', onClick: () => {
          const v = ($('#nameInput').value || '').trim().slice(0, 10);
          if (v) { State.data.name = v; State.save(true); renderTop(); }
          closeModal();
        } }]);
    });

    $('#btnReset').addEventListener('click', () => {
      openModal(T('重新開始'), T('<div>確定要清空進度嗎？此動作無法復原。</div>'), [
        { text: T('取消'), kind: '' },
        { text: T('確定清除'), kind: 'primary', onClick: () => {
          State.reset(); closeModal(); Battle.init(); renderAll(); toast(T('已重新開始'));
        } },
      ]);
    });
  }

  /* ================= 啟動 ================= */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
