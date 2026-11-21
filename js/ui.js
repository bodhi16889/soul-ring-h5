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
  function boot() {
    if (global.GP) { GP.boot(); GP.loading(20); }
    const res = State.load();
    bindNav();
    bindTop();
    bindBattle();
    bindSouls();
    bindRings();
    bindHunt();
    bindGacha();

    Battle.on(onBattleEvent);
    Battle.init();
    renderAll();
    if (global.GP) { GP.loading(85); GP.loaded(); }

    if (res.offline) showOffline(res.offline);
    const ci = State.checkinInfo();
    if (ci.canCheck) setTimeout(() => toast(T('今日簽到可領取 🎁')), 1400);
    if (res.corrupted) toast(T('存檔損毀，已建立新檔'));

    setInterval(() => { State.save(); renderTop(); }, 5000);
    setInterval(() => { if (tab === 'hunt') renderHunt(); }, 1000);
    window.addEventListener('beforeunload', () => State.save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) State.save(true); });

    requestAnimationFrame(loop);
    global.__game = {
      get ready() { return true; },
      State, Battle, CFG,
      switchTab, openModal, closeModal, renderAll,
      checkinInfo: () => State.checkinInfo(),
      get tab() { return tab; },
    };
  }

  /* ================= 導覽 ================= */
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
    $('#slotInfo').textContent = T(`上陣 ${s.team.length} / ${s.slots}`);
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
          <span class="star">${'★'.repeat(soul.star || 3)}</span>
          <span class="tag" style="color:${CFG.ROLE_COLOR[base.role]}">${roleName(base.role)}</span>
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
            ${info.maxed ? T('★5 滿星') : T(`升星（${info.bones} 靈骨・${fmt(info.coins)}）`)}
          </button>
          <button class="mini-btn ghost" data-act="bone" data-id="${soul.id}">${bone ? T('換靈骨') : T('裝靈骨')}</button>
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
    $$('#soulList [data-act="bone"]').forEach((b) => {
      b.addEventListener('click', () => pickBoneFor(b.dataset.id));
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
      </button>`;
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
        <span class="tag" style="color:${CFG.ELEMENT_COLOR[r.element] || '#fff'}">${el}系</span>
        <span class="hint">攻擊 +${Math.round(t.atk * 100)}% · 生命 +${Math.round(t.hp * 100)}%</span></div>
        ${sk ? T(`<div class="hint" style="margin-top:4px">${sk.label}（${sk.type === 'aoe' ? T('群體') : T('震懾')} ×${sk.mult}${sk.chance ? T(`，${Math.round(sk.chance * 100)}% 暈眩`) : ''}）</div>`) : T('<div class="hint" style="margin-top:4px">被動：純屬性增幅（無靈技）</div>')}
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
    const slotLine = State.teamSouls().map((x) => `${(CFG.SOUL_BY_ID[x.id] || {}).name} ${x.rings.length}/${State.ringSlotsOf(x)}`).join(' · ');
    $('#huntHint').textContent = T(`Lv.${s.level}（每 10 級開 1 槽）｜${slotLine}`);
    const html = CFG.BEASTS.map((b) => {
      const t = CFG.TIER_BY_KEY[b.tier];
      const cdLeft = Math.max(0, Math.ceil(((s.cd[b.id] || 0) - Date.now()) / 1000));
      const locked = s.level < b.reqLevel;
      const busy = Battle.state.mode === 'hunt';
      return T(`<div class="card">
        <div class="row1">
          <span style="font-size:20px">${b.emoji}</span>
          <b>${T(b.name)}</b>
          <span class="ring-dot ${t.css}"></span>
          <span class="hint">${T(b.year)}</span>
          ${locked ? `<span class="tag">${T(`需 Lv.${b.reqLevel}`)}</span>` : ''}
        </div>
        <div class="stats">
          <span>${T('生命')} <b>${fmt(b.hp)}</b></span>
          <span>${T('攻擊')} <b>${fmt(b.atk)}</b></span>
          <span>${T('掉落')} <b>${T(t.name)}</b></span>
        </div>
        <div class="acts">
          <button class="mini-btn primary" data-hunt="${b.id}" ${locked || cdLeft > 0 || busy ? 'disabled' : ''}>
            ${cdLeft > 0 ? T(`冷卻 ${cdLeft}s`) : busy ? T('獵靈中…') : T('進入獵殺')}
          </button>
        </div>
      </div>`);
    }).join('');
    $('#beastList').innerHTML = html;
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
    $('#btnPull10').addEventListener('click', () => doPull(10));
    $('#btnCode').addEventListener('click', () => {
      const r = State.redeem($('#codeInput').value);
      if (!r.ok) return toast(r.msg);
      $('#codeInput').value = '';
      State.save(true);
      toast(T('兌換成功：') + r.msg);
      renderAll();
    });
  }

  function doPull(times) {
    const s = State.data;
    const useTicket = times === 10
      ? s.tickets >= CFG.PULL10_COST_TICKET
      : s.tickets >= CFG.PULL_COST_TICKET;
    const results = [];
    for (let i = 0; i < times; i++) {
      const r = State.pullOnce(useTicket);
      if (!r.ok) { if (i === 0) toast(r.msg); break; }
      results.push(r.result);
    }
    if (!results.length) return;
    s.stats.pulls += results.length;
    State.save(true);
    Battle.refreshTeam();
    renderAll();
    $('#pullResult').innerHTML = results.map((r) => {
      const cls = r.star >= 5 ? 's5' : r.star >= 4 ? 's4' : '';
      const label = r.kind === 'bone' ? T(`${r.name}（${r.desc || T('靈骨')}）`)
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

  function renderGacha() {
    const s = State.data;
    $('#ticketInfo').textContent = T(`覺醒券 ${s.tickets} · 鑽石 ${fmt(s.diamonds)}`);
    $('#btnPull1').textContent = T(`覺醒一次（${CFG.PULL_COST_TICKET} 券 / ${CFG.PULL_COST_DIAMOND} 💎）`);
    $('#btnPull10').textContent = T(`十連覺醒（${CFG.PULL10_COST_TICKET} 券 / ${CFG.PULL10_COST_DIAMOND} 💎）`);
    $('#btnPull1').disabled = s.tickets < CFG.PULL_COST_TICKET && s.diamonds < CFG.PULL_COST_DIAMOND;
    $('#btnPull10').disabled = s.tickets < CFG.PULL10_COST_TICKET && s.diamonds < CFG.PULL10_COST_DIAMOND;
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

  function renderAll() {
    renderTop();
    renderBattle();
    renderSouls();
    renderBones();
    renderRebirth();
    renderRebirthHint();
    renderRings();
    renderHunt();
    renderCheckin();
    renderGacha();
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
        addLog(T(`${ev.name} 進入狂暴（攻擊 +35%）`), 'c-bad');
        break;
      case 'bossHeal': {
        const el = enemyEls.get(ev.enemyId);
        if (el) floatNum(el, '+' + fmt(ev.amount), 'heal');
        addLog(T(`${ev.name} 回復 10% 生命`), 'c-bad');
        break;
      }
      case 'shield':
        floatNum($(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`), T('護盾'), 'skill');
        break;
      case 'skill': {
        ringFx(ev.unit, ev.element);
        banner(ev.resonance ? T(`${ev.name} · 共鳴`) : ev.name);
        if (ev.ring) addLog(T(`${ev.name}${ev.resonance ? T('（屬性共鳴 +25%）') : ''}`), 'c-purple');
        break;
      }
      case 'kill': {
        const left = ev.left
          ? (I18N.lang === 'en' ? ` (${ev.left} left)` : `（剩 ${ev.left} 隻）`)
          : '';
        addLog(T(`擊殺${ev.boss ? T('守關靈獸') : T('靈獸')}${left}：靈幣 +${fmt(ev.coins)}、經驗 +${fmt(ev.exp)}`),
          ev.boss ? 'c-gold' : '');
        break;
      }
      case 'levelup':
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
        banner(T('通關'));
        addLog(T(`第 ${ev.stage} 關開啟，掛機效率提升`), 'c-ok');
        break;
      case 'huntStart':
        banner(T('獵靈'));
        addLog(T(`進入 ${ev.beast.name} 的領域（${ev.beast.year}）`), 'c-purple');
        break;
      case 'autoMerge':
        addLog(T(`自動合成 ${ev.made} 次低階靈環（3 個 → 1 個高一階）`), 'c-ok');
        break;
      case 'autoRing': {
        const t = CFG.TIER_BY_KEY[ev.ring.tier];
        addLog(T(`已自動裝備 ${t ? t.name : T('靈環')} → 等級上限 ${State.levelCap()}`), 'c-ok');
        break;
      }
      case 'huntLose':
        addLog(T(`獵靈失敗：${ev.beast ? ev.beast.name : T('靈獸')} 太強，15 秒後可再試（先去升級或補靈骨）`), 'c-bad');
        break;
      case 'huntWin': {
        const t = CFG.TIER_BY_KEY[ev.ring.tier];
        banner(T('吸收靈環'));
        addLog(T(`擊敗 ${ev.beast.name}，吸收 ${t.name}！`), 'c-gold');
        toast(T(`獲得 ${t.name}`));
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
  }
  function closeModal() { $('#modal').classList.add('hidden'); }

  function showOffline(g) {
    const h = Math.floor(g.minutes / 60), m = g.minutes % 60;
    openModal(T('離線收益'), T(`
      <div>離線 <b>${h > 0 ? h + T(' 小時 ') : ''}${m} 分</b>${g.capped ? T('（已達 12 小時上限）') : ''}</div>
      <div style="margin-top:8px">靈幣 <b class="c-gold">+${fmt(g.coins)}</b></div>
      <div>經驗 <b class="c-ok">+${fmt(g.exp)}</b></div>
      <div class="hint" style="margin-top:8px">掛機效率會隨關卡提升</div>`),
      [{ text: T('領取'), kind: 'primary', onClick: () => { closeModal(); State.save(true); renderAll(); } }]);
  }

  function showMenu() {
    const s = State.data;
    openModal(T('設定'), T(`
      <div>靈師：<b>${s.name}</b></div>
      <div>最高關卡：<b>${s.bestStage}</b> · 等級 <b>${s.level}</b> / ${State.levelCap()}</div>
      <div>版本：<b>v${CFG.VERSION}</b> · 環槽 ${State.ringSlotsOf(s.souls[0])} 格 / 靈印</div>
      <div style="margin-top:8px">${T('戰力明細')}：${T('攻擊')} <b>${fmt(State.teamStats().atk)}</b> ·
        ${T('生命')} <b>${fmt(State.teamStats().hp)}</b> ·
        ${T('防禦')} <b>${fmt(State.teamStats().def)}</b> ·
        ${T('速度')} <b>${State.teamStats().spd}</b></div>
      <div class="hint" style="margin-top:4px">${T('加成各自乘算：靈環（加法）→ 靈骨 → 命印 → 真身；戰力停住通常代表該轉生了')}</div>
      <div class="hint" style="margin-top:4px">若靈印頁的靈環槽顯示 /3 或等級上限是 90，代表瀏覽器還在使用舊檔：請開 <b>?v=2</b> 或清快取。</div>
      <div style="margin-top:8px">存檔會自動保存在這台裝置的瀏覽器；換裝置請用存檔碼。</div>
      <div class="acts" style="display:flex;gap:8px;margin-top:10px">
        <button class="mini-btn ${I18N.lang === 'en' ? 'primary' : ''}" id="btnLangEn">English</button>
        <button class="mini-btn ${I18N.lang === 'zh' ? 'primary' : ''}" id="btnLangZh">中文</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn" id="btnAutoMerge">自動合成低階環：${(s.settings.autoMerge === false) ? T('關') : T('開')}</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn" id="btnAutoBoss">自動挑戰 BOSS：${s.settings.autoBoss === false ? T('關') : T('開')}</button>
        <button class="mini-btn" id="btnAutoHunt">卡等自動獵靈：${s.settings.autoHunt === false ? T('關') : T('開')}</button>
        <button class="mini-btn" id="btnAutoRing">自動裝備靈環：${s.settings.autoRing === false ? T('關') : T('開')}</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn" id="btnExport">匯出存檔碼</button>
        <button class="mini-btn" id="btnImport">匯入存檔碼</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn ghost" id="btnRename">改暱稱</button>
        <button class="mini-btn ghost" id="btnReset">重新開始</button>
      </div>`),
      [{ text: T('關閉'), kind: '' }]);

    $('#btnLangEn').addEventListener('click', () => I18N.setLang('en'));
    $('#btnLangZh').addEventListener('click', () => I18N.setLang('zh'));

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
        <div class="hint">複製整段文字，貼到新裝置的「匯入存檔碼」。</div>
        <textarea id="expArea" readonly>${code}</textarea>`),
        [{ text: T('關閉'), kind: '' }, { text: T('複製'), kind: 'primary', onClick: () => {
          const ta = $('#expArea'); ta.select();
          try { document.execCommand('copy'); toast(T('已複製')); } catch (e) { toast(T('請長按選取複製')); }
        } }]);
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
