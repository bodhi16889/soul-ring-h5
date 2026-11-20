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
  let enemyEl = null;
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
    if (res.corrupted) toast('存檔損毀，已建立新檔');

    setInterval(() => { State.save(); renderTop(); }, 5000);
    setInterval(() => { if (tab === 'hunt') renderHunt(); }, 1000);
    window.addEventListener('beforeunload', () => State.save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) State.save(true); });

    requestAnimationFrame(loop);
    global.__game = {
      get ready() { return true; },
      State, Battle, CFG,
      switchTab, openModal, closeModal,
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

    const bossBtn = $('#bossBtn');
    bossBtn.disabled = !snap.pendingBoss;
    bossBtn.textContent = snap.pendingBoss ? '挑戰 BOSS' : `清怪 ${snap.kills}/${snap.needed}`;

    renderTeam(snap.units);
    renderEnemy(snap.enemy);
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

  function renderEnemy(e) {
    const row = $('#enemyRow');
    if (!e) { row.innerHTML = ''; enemyEl = null; return; }
    if (!enemyEl || enemyEl.dataset.id !== e.id) {
      row.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'unit enemy';
      el.dataset.id = e.id;
      el.innerHTML = `
        <div class="name" style="font-size:10px">${e.name}</div>
        <div class="body">${e.emoji}</div>
        <div class="bars"><div class="bar hp"><i></i></div></div>`;
      row.appendChild(el);
      enemyEl = el;
    }
    $('.bar.hp > i', enemyEl).style.width = Math.max(0, (e.hp / e.maxHp) * 100) + '%';
    enemyEl.classList.toggle('dead', !e.alive);
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
        </div>
        <div class="acts">
          <button class="mini-btn ${inTeam ? 'ghost' : 'primary'}" data-act="team" data-id="${soul.id}">
            ${inTeam ? '下陣' : '上陣'}
          </button>
          <button class="mini-btn" data-act="ring" data-id="${soul.id}">裝備魂環</button>
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
    const s = State.data;
    if (!s.ringBag.length) return toast('背包沒有魂環，去獵魂取得');
    const body = s.ringBag.map((r) => {
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

  /* ================= 魂環 ================= */
  function bindRings() { /* 由 renderRings 綁定 */ }

  function renderRings() {
    const s = State.data;
    const equipped = s.souls.reduce((a, x) => a + x.rings.length, 0);
    $('#ringCount').textContent = `背包 ${s.ringBag.length} · 已裝備 ${equipped} · 等級上限 ${State.levelCap()}`;

    if (!s.ringBag.length && !equipped) {
      $('#ringList').innerHTML = `<div class="card"><div class="hint">還沒有魂環。到「獵魂」擊敗魂獸，就能吸收第一枚魂環。</div></div>`;
      return;
    }

    const bagHtml = s.ringBag.map((r) => {
      const t = CFG.TIER_BY_KEY[r.tier];
      return `<div class="card compact">
        <div class="row1"><span class="ring-dot ${t.css}"></span><b>${t.name}</b>
        <span class="hint">攻擊 +${Math.round(t.atk * 100)}% · 生命 +${Math.round(t.hp * 100)}%</span></div>
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
    $('#huntHint').textContent = `目前等級 ${s.level} / 上限 ${State.levelCap()}`;
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
      const label = r.kind === 'bone' ? `${r.name}（魂骨）`
        : r.kind === 'star' ? `${r.name} ★${r.star}（升星）`
        : r.kind === 'dup' ? `${r.name}（重複 → +${r.diamonds}💎）`
        : `${r.name} ★${r.star}`;
      return `<span class="pull-chip ${cls}">${label}</span>`;
    }).join('');
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
    renderRings();
    renderHunt();
    renderGacha();
  }

  /* ================= 戰鬥事件 → 畫面 ================= */
  function onBattleEvent(ev) {
    switch (ev.type) {
      case 'hit': {
        const target = ev.side === 'enemy' ? $('#enemyRow .unit') : $(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`);
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
      case 'shield':
        floatNum($(`#teamRow .unit:nth-child(${unitIndex(ev.unit) + 1})`), '護盾', 'skill');
        break;
      case 'skill': {
        ringFx(ev.unit);
        banner(ev.name);
        break;
      }
      case 'kill':
        addLog(`擊殺${ev.boss ? '守關魂獸' : '魂獸'}：魂幣 +${fmt(ev.coins)}、經驗 +${fmt(ev.exp)}`, ev.boss ? 'c-gold' : '');
        break;
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
    const host = $('#floaters');
    if (!host) return;
    const hr = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'float-num ' + (cls || '');
    span.textContent = text;
    span.style.left = (r.left - hr.left + r.width / 2) + 'px';
    span.style.top = (r.top - hr.top - 8) + 'px';
    host.appendChild(span);
    setTimeout(() => span.remove(), 900);
  }

  function ringFx(unit) {
    const fx = $('#ringFx');
    if (!fx) return;
    const role = (unit && unit.role) || 'atk';
    const color = role === 'ctrl' ? '#b06bff' : role === 'def' ? '#6ea8ff' : role === 'sup' ? '#57d98b' : '#ffd93d';
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
      <div style="margin-top:8px">存檔會自動保存在這台裝置的瀏覽器；換裝置請用存檔碼。</div>
      <div class="acts" style="display:flex;gap:8px;margin-top:10px">
        <button class="mini-btn" id="btnExport">匯出存檔碼</button>
        <button class="mini-btn" id="btnImport">匯入存檔碼</button>
      </div>
      <div class="acts" style="display:flex;gap:8px;margin-top:8px">
        <button class="mini-btn ghost" id="btnRename">改暱稱</button>
        <button class="mini-btn ghost" id="btnReset">重新開始</button>
      </div>`,
      [{ text: '關閉', kind: '' }]);

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
