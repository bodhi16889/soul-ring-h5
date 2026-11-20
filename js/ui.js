/* ==========================================================================
 * ui.js — 渲染、互動、飄字、魂環光效、存檔流程
 * ========================================================================== */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function fmt(n) {
    n = Math.floor(n || 0);
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '萬';
    return String(n);
  }
  const roleName = (r) => CFG.ROLE_LABEL[r] || '未知';

  let tab = 'battle';
  let lastSnapKey = '';
  let unitEls = new Map();     // id -> element
  let enemyEls = new Map();    // id -> element（一波可能 1–3 隻）
  let toastTimer = 0;

  /* ================= 初始化 ================= */
  function boot() {
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

    if (res.offline) showOffline(res.offline);
    const ci = State.checkinInfo();
    if (ci.canCheck) setTimeout(() => toast('今日簽到可領取 🎁'), 1400);
    if (res.corrupted) toast('存檔損毀，已建立新檔');

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
    $('#stageName').textContent = CFG.areaFor(snap.stage) + (snap.mode === 'boss' ? ' · BOSS' : '');
    $('#stageNum').textContent = snap.stage;
    $('#progText').textContent = `${Math.min(snap.kills, snap.needed)} / ${snap.needed}`;
    $('#progBar').style.width = Math.min(100, (snap.kills / snap.needed) * 100) + '%';

    const rate = CFG.offlinePerMinute(snap.stage);
    $('#rateText').textContent = `魂幣 ${fmt(rate.coins)}/分 · 經驗 ${fmt(rate.exp)}/分`;

    const capped = State.atCap();
    const bossBtn = $('#bossBtn');
    bossBtn.disabled = !snap.pendingBoss;
    bossBtn.textContent = snap.pendingBoss
      ? `挑戰 BOSS（${Math.round((CFG.AUTO_BOSS_DELAY || 1800) / 1000)} 秒後自動）`
      : capped ? `卡等 ${snap.kills}/${snap.needed} · 去打魂環` : `清怪 ${snap.kills}/${snap.needed}`;

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
          <div class="name">${u.name}</div>`;
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
          <div class="name" style="font-size:9px">${e.name}</div>
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

  /* ================= 武魂 ================= */
  function bindSouls() {
    $('#btnExpandSlot').addEventListener('click', () => {
      const r = State.expandSlot();
      if (!r.ok) return toast(r.msg);
      Battle.refreshTeam();
      State.save(true);
      toast(`陣容擴充到 ${r.slots} 人`);
      renderAll();
    });
  }

  function renderSouls() {
    const s = State.data;
    $('#slotInfo').textContent = `上陣 ${s.team.length} / ${s.slots}`;
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
      }).join('') || '<span class="hint">無魂環</span>';
      return `<div class="card" data-soul="${soul.id}">
        <div class="row1">
          <span style="font-size:20px">${base.emoji || '❔'}</span>
          <b>${base.name || soul.id}</b>
          <span class="hint">Lv.${soul.level || 1}</span>
          <span class="star">${'★'.repeat(soul.star || 3)}</span>
          <span class="tag" style="color:${CFG.ROLE_COLOR[base.role]}">${roleName(base.role)}</span>
          <span class="tag ${inTeam ? 'on' : ''}">${inTeam ? '上陣中' : '待命'}</span>
        </div>
        <div class="stats">
          <span>攻擊 <b>${fmt(st.atk)}</b></span>
          <span>生命 <b>${fmt(st.hp)}</b></span>
          <span>防禦 <b>${fmt(st.def)}</b></span>
        </div>
        <div class="row1" style="margin-top:6px;font-size:11px;color:var(--muted)">
          魂環槽 ${soul.rings.length}/${slots} ${rings}
          ${tb.bonus ? `<span class="tag on">真身 +${Math.round(tb.bonus * 100)}%</span>` : ''}
          ${reso ? `<span class="tag on">共鳴 ${CFG.ELEMENT_LABEL[reso.element]}×${reso.count}</span>` : ''}
        </div>
        <div class="row1" style="margin-top:4px;font-size:11px;color:var(--muted)">
          ${bone ? `<span class="bone ${bone.css}"></span> ${bone.name}（${bone.desc}）` : '魂骨：無'}
        </div>
        <div class="acts">
          <button class="mini-btn ${inTeam ? 'ghost' : 'primary'}" data-act="team" data-id="${soul.id}">
            ${inTeam ? '下陣' : '上陣'}
          </button>
          <button class="mini-btn" data-act="ring" data-id="${soul.id}">裝備魂環</button>
          <button class="mini-btn ${info.canAfford ? 'primary' : ''}" data-act="star" data-id="${soul.id}"
            ${info.maxed || !info.canAfford ? 'disabled' : ''}>
            ${info.maxed ? '★5 滿星' : `升星（${info.bones} 魂骨・${fmt(info.coins)}）`}
          </button>
          <button class="mini-btn ghost" data-act="bone" data-id="${soul.id}">${bone ? '換魂骨' : '裝魂骨'}</button>
        </div>
      </div>`;
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
        toast(`升星成功 → ★${r.star}（消耗 ${r.eaten} 塊魂骨）`);
      });
    });
    $$('#soulList [data-act="bone"]').forEach((b) => {
      b.addEventListener('click', () => pickBoneFor(b.dataset.id));
    });

    const btn = $('#btnExpandSlot');
    if (s.slots >= 5) {
      btn.textContent = '已達五人小隊上限';
      btn.disabled = true;
    } else {
      btn.disabled = false;
      btn.textContent = `擴充陣容 → ${s.slots + 1} 人（${fmt(State.slotNextCost())} 魂幣 · 等級 ${State.slotNextLevel()}）`;
    }
  }

  function pickRingFor(soulId) {
    const free = State.freeRings();
    if (!free.length) return toast('背包沒有魂環，去獵魂取得');
    const body = free.map((r) => {
      const t = CFG.TIER_BY_KEY[r.tier];
      return `<div class="card compact">
        <div class="row1"><span class="ring-dot ${t.css}"></span><b>${t.name}</b>
        <span class="hint">攻擊 +${Math.round(t.atk * 100)}% · 生命 +${Math.round(t.hp * 100)}%</span></div>
        <div class="acts"><button class="mini-btn primary" data-uid="${r.uid}">裝上去</button></div>
      </div>`;
    }).join('');
    openModal('選擇魂環', body, [{ text: '取消', kind: '' }]);
    $$('#modalBody [data-uid]').forEach((b) => {
      b.addEventListener('click', () => {
        const res = State.equipRing(soulId, b.dataset.uid);
        closeModal();
        if (!res.ok) return toast(res.msg);
        State.save(true);
        renderAll();
        toast('魂環已裝備');
      });
    });
  }

  function pickBoneFor(soulId) {
    const soul = State.data.souls.find((x) => x.id === soulId);
    const has = soul && soul.bone;
    const free = State.freeBones();
    if (!has && !free.length) return toast('沒有可裝備的魂骨，去武魂殿抽卡');
    const rows = free.map((item) => {
      const b = CFG.BONE_BY_ID[item.id];
      return `<div class="card compact">
        <div class="row1"><span class="bone ${b.css}"></span><b>${b.name}</b>
        <span class="hint">${b.desc}</span></div>
        <div class="acts"><button class="mini-btn primary" data-bone="${item.uid}">裝備</button></div>
      </div>`;
    }).join('');
    const offBtn = has ? `<div class="acts" style="margin-top:6px">
        <button class="mini-btn ghost" id="btnUnequipBone">卸下目前魂骨</button></div>` : '';
    openModal('魂骨', rows + offBtn || '<div class="hint">沒有魂骨</div>', [{ text: '關閉', kind: '' }]);
    $$('#modalBody [data-bone]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.equipBone(soulId, b.dataset.bone);
        closeModal();
        if (!r.ok) return toast(r.msg);
        State.save(true); Battle.refreshTeam(); renderAll();
        toast('魂骨已裝備（裝備者全額、同隊 30% 光環）');
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
    $('#boneCount').textContent = `未裝備 ${free.length} · 已裝備 ${State.equippedBones()}`;
    if (!s.bones.length) {
      $('#boneList').innerHTML = `<div class="card"><div class="hint">還沒有魂骨。到「覺醒」抽卡有機會抽到魂骨。</div></div>`;
      return;
    }
    const equippedHtml = s.souls.filter((x) => x.bone).map((soul) => {
      const b = State.boneOf(soul);
      const base = CFG.SOUL_BY_ID[soul.id];
      if (!b) return '';
      return `<div class="card compact">
        <div class="row1"><span class="bone ${b.css}"></span><b>${b.name}</b>
        <span class="hint">→ ${base.name}（${b.desc}）</span></div>
        <div class="acts"><button class="mini-btn ghost" data-unbone="${soul.id}">卸下</button></div>
      </div>`;
    }).join('');
    const freeHtml = free.map((item) => {
      const b = CFG.BONE_BY_ID[item.id];
      return `<div class="card compact">
        <div class="row1"><span class="bone ${b.css}"></span><b>${b.name}</b>
        <span class="hint">${b.desc}</span></div>
        <div class="acts">
          ${s.souls.map((soul) => `<button class="mini-btn" data-eqbone="${item.uid}" data-soul="${soul.id}">
            裝到 ${(CFG.SOUL_BY_ID[soul.id] || {}).name}</button>`).join('')}
        </div>
      </div>`;
    }).join('');
    $('#boneList').innerHTML = equippedHtml + freeHtml;
    $$('#boneList [data-eqbone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = State.equipBone(btn.dataset.soul, btn.dataset.eqbone);
        if (!r.ok) return toast(r.msg);
        State.save(true); Battle.refreshTeam(); renderAll();
        toast('魂骨已裝備');
      });
    });
    $$('#boneList [data-unbone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        State.unequipBone(btn.dataset.unbone);
        State.save(true); Battle.refreshTeam(); renderAll();
      });
    });
  }

  function renderRebirth() {
    const box = $('#rebirthBox');
    if (!box) return;
    const info = State.rebirthInfo();
    const pm = CFG.REBIRTH.perMark;
    box.innerHTML = `
      <h3><span>🌀 轉生 · 魂印 <span class="rb-mark">${info.marks}</span></span>
          <span class="hint">第 ${info.rebirths + 1} 次</span></h3>
      <div class="rb-line">歷史最高：第 <b>${info.bestStage}</b> 關（需 ${info.minStage} 關）</div>
      <div class="rb-line">目前加成：全屬性 +${Math.round(pm.atk * 100 * info.marks)}% · 收益 +${Math.round(pm.income * 100 * info.marks)}%</div>
      <div class="rb-line">這次轉生可得：<b style="color:var(--gold)">+${info.gain} 魂印</b>（每點全屬性 +6%、收益 +4%）</div>
      <div class="rb-line" style="opacity:.75">轉生會重置等級／關卡／魂幣／魂環；武魂、星級、魂骨、魂印會保留。</div>
      <button id="btnRebirth" class="wide-btn ${info.can ? '' : ''}" ${info.can ? '' : 'disabled'}>
        ${info.can ? `轉生（+${info.gain} 魂印）` : `需歷史最高 ${info.minStage} 關`}
      </button>`;
    const btn = $('#btnRebirth');
    if (btn) btn.addEventListener('click', () => {
      if (!info.can) return toast(`歷史最高關卡需達 ${info.minStage} 關`);
      if (btn.dataset.armed === '1') { doRebirthNow(); return; }
      btn.dataset.armed = '1';
      btn.classList.add('armed');
      btn.textContent = '再按一次確認轉生（會重置本輪）';
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
    banner('轉生');
    toast(`轉生完成：魂印 +${r.gain}（累計 ${r.marks}）`);
  }

  /* ================= 魂環 ================= */
  function bindRings() { /* 由 renderRings 綁定 */ }

  function renderRings() {
    const s = State.data;
    const equipped = s.souls.reduce((a, x) => a + x.rings.length, 0);
    $('#ringCount').textContent = `背包 ${State.freeRings().length} · 已裝備 ${equipped} · 等級上限 ${State.levelCap()}`;

    if (!s.ringBag.length) {
      $('#ringList').innerHTML = `<div class="card"><div class="hint">還沒有魂環。到「獵魂」擊敗魂獸，就能吸收第一枚魂環。</div></div>`;
      return;
    }

    const bagHtml = State.freeRings().map((r) => {
      const t = CFG.TIER_BY_KEY[r.tier];
      const sk = CFG.RING_SKILL[r.tier];
      const el = CFG.ELEMENT_LABEL[r.element] || '';
      return `<div class="card compact">
        <div class="row1"><span class="ring-dot ${t.css}"></span><b>${t.name}</b>
        <span class="tag" style="color:${CFG.ELEMENT_COLOR[r.element] || '#fff'}">${el}系</span>
        <span class="hint">攻擊 +${Math.round(t.atk * 100)}% · 生命 +${Math.round(t.hp * 100)}%</span></div>
        ${sk ? `<div class="hint" style="margin-top:4px">魂技：${sk.label}（${sk.type === 'aoe' ? '群體' : '震懾'} ×${sk.mult}）</div>` : '<div class="hint" style="margin-top:4px">被動：純屬性增幅</div>'}
        <div class="acts">
          ${s.souls.map((soul) => {
            const base = CFG.SOUL_BY_ID[soul.id];
            return `<button class="mini-btn" data-eq="${r.uid}" data-soul="${soul.id}">裝到 ${base.name}</button>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    const equippedHtml = s.souls.filter((x) => x.rings.length).map((soul) => {
      const base = CFG.SOUL_BY_ID[soul.id];
      return `<div class="card">
        <div class="row1"><b>${base.name}</b><span class="hint">已裝備 ${soul.rings.length}/${State.ringSlotsOf(soul)}</span></div>
        <div class="acts">
          ${soul.rings.map((uid) => {
            const r = s.ringBag.find((x) => x.uid === uid) || { tier: 'white' };
            const t = CFG.TIER_BY_KEY[r.tier] || CFG.RING_TIERS[0];
            return `<button class="mini-btn" data-un="${uid}" data-soul="${soul.id}">
              <span class="ring-dot ${t.css}" style="display:inline-block;vertical-align:-1px"></span> ${t.name} · 卸下</button>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    $('#ringList').innerHTML = (equippedHtml || '') + bagHtml;
    $$('#ringList [data-eq]').forEach((b) => {
      b.addEventListener('click', () => {
        const r = State.equipRing(b.dataset.soul, b.dataset.eq);
        if (!r.ok) return toast(r.msg);
        State.save(true);
        Battle.refreshTeam();
        renderAll();
        toast('魂環已裝備，等級上限提升');
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

  /* ================= 獵魂 ================= */
  function bindHunt() { /* 由 renderHunt 綁定 */ }

  function renderHunt() {
    const s = State.data;
    const slotLine = State.teamSouls().map((x) => `${(CFG.SOUL_BY_ID[x.id] || {}).name} ${x.rings.length}/${State.ringSlotsOf(x)}`).join(' · ');
    $('#huntHint').textContent = `Lv.${s.level}（每 10 級開 1 槽）｜${slotLine}`;
    const html = CFG.BEASTS.map((b) => {
      const t = CFG.TIER_BY_KEY[b.tier];
      const cdLeft = Math.max(0, Math.ceil(((s.cd[b.id] || 0) - Date.now()) / 1000));
      const locked = s.level < b.reqLevel;
      const busy = Battle.state.mode === 'hunt';
      return `<div class="card">
        <div class="row1">
          <span style="font-size:20px">${b.emoji}</span>
          <b>${b.name}</b>
          <span class="ring-dot ${t.css}"></span>
          <span class="hint">${b.year}</span>
          ${locked ? `<span class="tag">需 Lv.${b.reqLevel}</span>` : ''}
        </div>
        <div class="stats">
          <span>生命 <b>${fmt(b.hp)}</b></span>
          <span>攻擊 <b>${fmt(b.atk)}</b></span>
          <span>掉落 <b>${t.name}</b></span>
        </div>
        <div class="acts">
          <button class="mini-btn primary" data-hunt="${b.id}" ${locked || cdLeft > 0 || busy ? 'disabled' : ''}>
            ${cdLeft > 0 ? `冷卻 ${cdLeft}s` : busy ? '獵魂中…' : '進入獵殺'}
          </button>
        </div>
      </div>`;
    }).join('');
    $('#beastList').innerHTML = html;
    $$('#beastList [data-hunt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = Battle.hunt(btn.dataset.hunt);
        if (!r.ok) return toast(r.msg);
        switchTab('battle');
        toast('進入魂獸領域，擊敗牠即可吸收魂環');
      });
    });
  }

  /* ================= 覺醒抽卡 ================= */
  function bindGacha() {
    $('#btnCheckin').addEventListener('click', () => {
      const r = State.checkIn();
      if (!r.ok) return toast(r.msg);
      State.save(true);
      renderAll();
      toast(`第 ${r.dayIndex} 天簽到：${r.reward.label}（連續 ${r.streak} 天）`);
      banner(`連續簽到 ${r.streak} 天`);
    });
    $('#btnPull1').addEventListener('click', () => doPull(1));
    $('#btnPull10').addEventListener('click', () => doPull(10));
    $('#btnCode').addEventListener('click', () => {
      const r = State.redeem($('#codeInput').value);
      if (!r.ok) return toast(r.msg);
      $('#codeInput').value = '';
      State.save(true);
      toast('兌換成功：' + r.msg);
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
      const label = r.kind === 'bone' ? `${r.name}（${r.desc || '魂骨'}）`
        : r.kind === 'star' ? `${r.name} ★${r.star}（升星）`
        : r.kind === 'dup' ? `${r.name}（重複 → +${r.diamonds}💎）`
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
      return `<div class="ci-cell${done ? ' done' : ''}${isToday ? ' today' : ''}${big}" title="${r.label}">
        <div class="d">第${r.day}天</div>
        <div class="e">${r.emoji}</div>
        <div class="l">${r.label.replace(/\s/g, '')}</div>
      </div>`;
    }).join('');
    $('#checkinGrid').innerHTML = cells;
    $('#streakInfo').textContent = info.streak > 0 ? `連續 ${info.streak} 天` : '連續簽到有獎';
    const btn = $('#btnCheckin');
    btn.disabled = !info.canCheck;
    btn.textContent = info.canCheck
      ? `領取第 ${info.dayIndex} 天獎勵（${info.reward.label}）`
      : `今天已簽到 · 明天再來`;
    const dot = $('#checkinDot');
    if (dot) dot.classList.toggle('hidden', !info.canCheck);
    return info;
  }

  function renderGacha() {
    const s = State.data;
    $('#ticketInfo').textContent = `覺醒券 ${s.tickets} · 鑽石 ${fmt(s.diamonds)}`;
    $('#btnPull1').textContent = `覺醒一次（${CFG.PULL_COST_TICKET} 券 / ${CFG.PULL_COST_DIAMOND} 💎）`;
    $('#btnPull10').textContent = `十連覺醒（${CFG.PULL10_COST_TICKET} 券 / ${CFG.PULL10_COST_DIAMOND} 💎）`;
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
        if (ev.who === 'enemy') banner('纏繞！');
        break;
      case 'aoe':
        addLog(`群攻命中 ${ev.count} 隻魂獸`, 'c-purple');
        break;
      case 'bossRage':
        banner('狂暴');
        addLog(`${ev.name} 進入狂暴（攻擊 +35%）`, 'c-bad');
        break;
      case 'bossHeal': {
        const el = enemyEls.get(ev.enemyId);
        if (el) floatNum(el, '+' + fmt(ev.amount), 'heal');
        addLog(`${ev.name} 回復 10% 生命`, 'c-bad');
        break;
      }
      case 'shield':
        floatNum($(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`), '護盾', 'skill');
        break;
      case 'skill': {
        ringFx(ev.unit, ev.element);
        banner(ev.resonance ? `${ev.name} · 共鳴` : ev.name);
        if (ev.ring) addLog(`魂環魂技：${ev.name}${ev.resonance ? '（屬性共鳴 +25%）' : ''}`, 'c-purple');
        break;
      }
      case 'kill': {
        const left = ev.left ? `（剩 ${ev.left} 隻）` : '';
        addLog(`擊殺${ev.boss ? '守關魂獸' : '魂獸'}${left}：魂幣 +${fmt(ev.coins)}、經驗 +${fmt(ev.exp)}`,
          ev.boss ? 'c-gold' : '');
        break;
      }
      case 'levelup':
        banner('境界提升');
        addLog(`等級提升 → Lv.${ev.level}`, 'c-ok');
        break;
      case 'bossReady':
        addLog('守關魂獸出現，可以挑戰 BOSS 了', 'c-gold');
        break;
      case 'bossStart':
        banner('BOSS 戰');
        addLog(`挑戰第 ${ev.stage} 關守關魂獸`, 'c-purple');
        break;
      case 'stageClear':
        banner('通關');
        addLog(`第 ${ev.stage} 關開啟，掛機效率提升`, 'c-ok');
        break;
      case 'huntStart':
        banner('獵魂');
        addLog(`進入 ${ev.beast.name} 的領域（${ev.beast.year}）`, 'c-purple');
        break;
      case 'autoRing': {
        const t = CFG.TIER_BY_KEY[ev.ring.tier];
        addLog(`已自動裝備 ${t ? t.name : '魂環'} → 等級上限 ${State.levelCap()}`, 'c-ok');
        break;
      }
      case 'huntLose':
        addLog(`獵魂失敗：${ev.beast ? ev.beast.name : '魂獸'} 太強，15 秒後可再試（先去升級或補魂骨）`, 'c-bad');
        break;
      case 'huntWin': {
        const t = CFG.TIER_BY_KEY[ev.ring.tier];
        banner('吸收魂環');
        addLog(`擊敗 ${ev.beast.name}，吸收 ${t.name}！`, 'c-gold');
        toast(`獲得 ${t.name}`);
        State.save(true);
        renderAll();
        break;
      }
      case 'wipe':
        banner('全隊倒下');
        addLog('全隊倒下，2 秒後自動重整', 'c-bad');
        break;
      case 'revived':
        addLog('武魂重新凝聚，繼續戰鬥', 'c-ok');
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
    (buttons || [{ text: '關閉', kind: '' }]).forEach((b) => {
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
    openModal('離線收益', `
      <div>離線 <b>${h > 0 ? h + ' 小時 ' : ''}${m} 分</b>${g.capped ? '（已達 12 小時上限）' : ''}</div>
      <div style="margin-top:8px">魂幣 <b class="c-gold">+${fmt(g.coins)}</b></div>
      <div>經驗 <b class="c-ok">+${fmt(g.exp)}</b></div>
      <div class="hint" style="margin-top:8px">掛機效率會隨關卡提升</div>`,
      [{ text: '領取', kind: 'primary', onClick: () => { closeModal(); State.save(true); renderAll(); } }]);
  }

  function showMenu() {
    const s = State.data;
    openModal('設定', `
      <div>魂師：<b>${s.name}</b></div>
      <div>最高關卡：<b>${s.bestStage}</b> · 等級 <b>${s.level}</b> / ${State.levelCap()}</div>
      <div>版本：<b>v${CFG.VERSION}</b> · 環槽 ${State.ringSlotsOf(s.souls[0])} 格 / 武魂</div>
      <div class="hint" style="margin-top:4px">若武魂頁的魂環槽顯示 /3 或等級上限是 90，代表瀏覽器還在使用舊檔：請開 <b>?v=2</b> 或清快取。</div>
      <div style="margin-top:8px">存檔會自動保存在這台裝置的瀏覽器；換裝置請用存檔碼。</div>
      <div class="acts" style="display:flex;gap:8px;margin-top:10px">
        <button class="mini-btn" id="btnAutoBoss">自動挑戰 BOSS：${s.settings.autoBoss === false ? '關' : '開'}</button>
        <button class="mini-btn" id="btnAutoHunt">卡等自動獵魂：${s.settings.autoHunt === false ? '關' : '開'}</button>
        <button class="mini-btn" id="btnAutoRing">自動裝備魂環：${s.settings.autoRing === false ? '關' : '開'}</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn" id="btnExport">匯出存檔碼</button>
        <button class="mini-btn" id="btnImport">匯入存檔碼</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn ghost" id="btnRename">改暱稱</button>
        <button class="mini-btn ghost" id="btnReset">重新開始</button>
      </div>`,
      [{ text: '關閉', kind: '' }]);

    $('#btnAutoBoss').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoBoss = st.autoBoss === false;
      State.save(true);
      $('#btnAutoBoss').textContent = `自動挑戰 BOSS：${st.autoBoss ? '開' : '關'}`;
      toast(`自動挑戰 BOSS ${st.autoBoss ? '已開啟' : '已關閉'}`);
    });
    $('#btnAutoHunt').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoHunt = st.autoHunt === false;
      State.save(true);
      $('#btnAutoHunt').textContent = `卡等自動獵魂：${st.autoHunt ? '開' : '關'}`;
      toast(`卡等自動獵魂 ${st.autoHunt ? '已開啟' : '已關閉'}`);
    });

    $('#btnAutoRing').addEventListener('click', () => {
      const st = State.data.settings;
      st.autoRing = st.autoRing === false;
      State.save(true);
      $('#btnAutoRing').textContent = `自動裝備魂環：${st.autoRing ? '開' : '關'}`;
      toast(`自動裝備魂環 ${st.autoRing ? '已開啟' : '已關閉'}`);
    });

    $('#btnExport').addEventListener('click', () => {
      const code = State.exportCode();
      openModal('匯出存檔碼', `
        <div class="hint">複製整段文字，貼到新裝置的「匯入存檔碼」。</div>
        <textarea id="expArea" readonly>${code}</textarea>`,
        [{ text: '關閉', kind: '' }, { text: '複製', kind: 'primary', onClick: () => {
          const ta = $('#expArea'); ta.select();
          try { document.execCommand('copy'); toast('已複製'); } catch (e) { toast('請長按選取複製'); }
        } }]);
    });

    $('#btnImport').addEventListener('click', () => {
      openModal('匯入存檔碼', `
        <div class="hint">貼上存檔碼，會覆蓋目前進度。</div>
        <textarea id="impArea" placeholder="貼上存檔碼"></textarea>`,
        [{ text: '取消', kind: '' }, { text: '匯入', kind: 'primary', onClick: () => {
          const r = State.importCode($('#impArea').value);
          if (!r.ok) return toast(r.msg);
          closeModal(); Battle.init(); renderAll(); toast('存檔已匯入');
        } }]);
    });

    $('#btnRename').addEventListener('click', () => {
      openModal('改暱稱', `<input id="nameInput" maxlength="10" value="${s.name}" style="width:100%;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#fff">`,
        [{ text: '取消', kind: '' }, { text: '儲存', kind: 'primary', onClick: () => {
          const v = ($('#nameInput').value || '').trim().slice(0, 10);
          if (v) { State.data.name = v; State.save(true); renderTop(); }
          closeModal();
        } }]);
    });

    $('#btnReset').addEventListener('click', () => {
      openModal('重新開始', '<div>確定要清空進度嗎？此動作無法復原。</div>', [
        { text: '取消', kind: '' },
        { text: '確定清除', kind: 'primary', onClick: () => {
          State.reset(); closeModal(); Battle.init(); renderAll(); toast('已重新開始');
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
