#!/usr/bin/env python3
"""靈環覺醒 H5 — 端到端驗證（Playwright）。

驗的是「真的能玩」：自動戰鬥會掉血、升級、獵靈掉靈環、靈環提高等級上限、
BOSS 推進關卡、抽卡與兌換碼、存檔碼往返、離線收益、直式版面。

    /usr/bin/python3 tests/smoke.py [--headed]
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "artifacts"
FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILS.append(label)
    return ok


def serve(directory: Path, port: int) -> socketserver.TCPServer:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a, **k: None

    class Q(socketserver.TCPServer):
        allow_reuse_address = True

    srv = Q(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


CFG_STARTLV = 5   # CFG.REBIRTH.startLevelPerRebirth（每次轉生後起始等級 +5）


def weigh_ok(w):
    """3 次失敗應為 0.82^3≈0.551（允許 ±0.03）。"""
    return 0.51 <= w["ratio"] <= 0.60


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    ART.mkdir(exist_ok=True)
    srv = serve(ROOT, 8771)
    url = "http://127.0.0.1:8771/index.html?lang=zh"   # 既有斷言用中文；英文模式另有專段

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed,
                                     args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 420, "height": 860}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(url, wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        page.evaluate("try { localStorage.clear(); } catch (e) {}")
        page.reload(wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        # 手動斷言期間關掉自動節奏，避免背景自己切 BOSS／獵靈
        page.evaluate("__game.State.data.settings = {autoBoss:false, autoHunt:false};"
                      " __game.State.save(true)")
        time.sleep(0.5)

        # ---------- 1. 基本結構 ----------
        base = page.evaluate("""({
          tabs: document.querySelectorAll('.nav-btn').length,
          views: document.querySelectorAll('.view').length,
          title: document.title,
          souls: __game.State.data.souls.length,
          team: __game.State.data.team.length,
          level: __game.State.data.level,
          cap: __game.State.levelCap(),
          power: __game.State.power(),
          stage: __game.State.data.stage,
        })""")
        check("五個頁籤與五個視圖都在", base["tabs"] == 5 and base["views"] == 5, str(base))
        check("標題固定為 Spirit Ring Idle（中英一致）、初始 1 靈印上陣、1 級、等級上限 100",
              base["title"] == "Spirit Ring Idle" and base["souls"] == 1
              and base["team"] == 1 and base["level"] == 1 and base["cap"] == 100, str(base))
        check("開局有戰力", base["power"] > 0, f"power={base['power']}")
        check("沒有 console / page error", not errors, str(errors[:3]))

        # ---------- 2. 自動戰鬥 ----------
        before = page.evaluate("""({
          hp: __game.Battle.state.enemy ? __game.Battle.state.enemy.hp : -1,
          coins: __game.State.data.coins,
          kills: __game.State.data.stats.kills,
          exp: __game.State.data.exp,
        })""")
        time.sleep(3.0)
        after = page.evaluate("""({
          hp: __game.Battle.state.enemy ? __game.Battle.state.enemy.hp : -1,
          maxHp: __game.Battle.state.enemy ? __game.Battle.state.enemy.maxHp : 0,
          coins: __game.State.data.coins,
          kills: __game.State.data.stats.kills,
          exp: __game.State.data.exp,
          level: __game.State.data.level,
        })""")
        progressed = (after["kills"] > before["kills"]) or (after["hp"] < before["hp"]) or (after["hp"] == after["maxHp"] and after["kills"] > 0)
        check("自動戰鬥：不打也會掉血／擊殺", progressed,
              f"hp {before['hp']} -> {after['hp']}, kills {before['kills']} -> {after['kills']}")
        check("擊殺會給靈幣與經驗", after["coins"] > before["coins"] and (after["exp"] > 0 or after["level"] > 1),
              f"coins {before['coins']}->{after['coins']}, exp={after['exp']}, lv={after['level']}")

        # ---------- 3. 升級 ----------
        lv = page.evaluate("""(() => {
          const s = __game.State.data;
          const r = __game.State.addExp(s, 4000);
          return {level: s.level, ups: r.levelUps, capped: r.capped, cap: __game.State.levelCap()};
        })()""")
        check("經驗足夠會連續升級，上限固定 100（靈環不再卡等）",
              lv["level"] >= 15 and lv["ups"] >= 14 and lv["capped"] is False and lv["cap"] == 100,
              str(lv))

        # ---------- 4. 獵靈 → 靈環 ----------
        page.evaluate("__game.switchTab('hunt')")
        time.sleep(0.2)
        hunt_ok = page.evaluate("""(() => {
          const r = __game.Battle.hunt('baboon');
          return {ok: r.ok, msg: r.msg || '', mode: __game.Battle.state.mode};
        })()""")
        check("獵靈：可以進入十年靈獸（嘯風猿）", hunt_ok["ok"] is True and hunt_ok["mode"] == "hunt", str(hunt_ok))

        # 打快一點：把靈印攻擊拉高，避免測試等太久
        page.evaluate("__game.Battle.state.units.forEach(u => { u.atk = 400; u.spd = 200; })")
        got_ring = False
        try:
            page.wait_for_function("__game.State.data.ringBag.length > 0", timeout=25_000)
            got_ring = True
        except Exception:
            got_ring = False
        ring = page.evaluate("""({
          bag: __game.State.freeRings().length,
          all: __game.State.data.ringBag.length,
          equipped: __game.State.data.souls.reduce((a, x) => a + x.rings.length, 0),
          mode: __game.Battle.state.mode,
        })""")
        check("擊敗靈獸會掉落靈環（自動裝備或進背包）、並回到掛機",
              got_ring and ring["mode"] == "farm" and ring["all"] >= 1
              and (ring["bag"] + ring["equipped"]) >= 1, str(ring))

        # ---------- 5. 裝備靈環 → 上限提升 ----------
        equip = page.evaluate("""(() => {
          const s = __game.State.data;
          // 先全部卸下，確認「裝備後才 +10」
          s.souls.forEach((x) => x.rings.slice().forEach((uid) => __game.State.unequipRing(x.id, uid)));
          const before = __game.State.levelCap();
          const uid = __game.State.freeRings()[0].uid;
          const r = __game.State.equipRing(s.souls[0].id, uid);
          return {ok: r.ok, msg: r.msg || '', before, after: __game.State.levelCap(),
                  equipped: s.souls[0].rings.length};
        })()""")
        check("裝備靈環：等級上限維持 100，改由環槽（每 10 級 1 格）限制",
              equip["ok"] is True and equip["after"] == 100
              and equip["equipped"] == 1, str(equip))

        # ---------- 6. BOSS 推進關卡 ----------
        page.evaluate("__game.switchTab('battle')")
        page.evaluate("__game.State.data.kills = 10; __game.Battle.state.pendingBoss = false;")
        page.evaluate("__game.State.data.kills = 10")
        # 觸發 bossReady（正常是擊殺第 10 隻時設定）
        page.evaluate("__game.Battle.state.pendingBoss = true")
        started = page.evaluate("(() => { const r = __game.Battle.challengeBoss(); return {ok: r.ok, mode: __game.Battle.state.mode}; })()")
        check("BOSS 按鈕：清完小怪後可以挑戰", started["ok"] is True and started["mode"] == "boss", str(started))
        page.evaluate("__game.Battle.state.enemy.hp = 1")
        try:
            page.wait_for_function("__game.State.data.stage >= 2", timeout=20_000)
        except Exception:
            pass
        stage = page.evaluate("({stage: __game.State.data.stage, best: __game.State.data.bestStage, mode: __game.Battle.state.mode})")
        check("擊敗 BOSS 進到下一關、回到掛機", stage["stage"] >= 2 and stage["best"] >= 2 and stage["mode"] == "farm",
              str(stage))

        # ---------- 6b. 多波小怪 + 群攻 + Boss 被動 ----------
        wave = page.evaluate("""(() => {
          const St = __game.State, B = __game.Battle.state;
          St.data.stage = 12;
          const sizes = [];
          for (let i = 0; i < 24; i++) { __game.Battle.spawnWave('farm'); sizes.push(B.enemies.length); }
          return {sizes, max: Math.max(...sizes), min: Math.min(...sizes)};
        })()""")
        check("多波：高等關卡會出 1–3 隻靈獸",
              wave["max"] >= 2 and wave["min"] >= 1, str(wave))

        aoe = page.evaluate("""(() => {
          const B = __game.Battle.state;
          B.mode = 'farm';
          B.enemies = [0,1,2].map((i) => ({
            id: 'aoe' + i, name: '群怪' + i, emoji: '🦟',
            maxHp: 900, hp: 900, atk: 1, def: 0, spd: 1,
            gauge: 0, stun: 0, alive: true, boss: false, acts: 0, enraged: false,
          }));
          const u = B.units.find((x) => x.role === 'atk') || B.units[0];
          u.role = 'atk'; u.atk = 120; u.mp = 100;
          const before = B.enemies.map((e) => e.hp);
          __game.Battle.castSkill(u);
          const after = B.enemies.map((e) => e.hp);
          return {before, after, hits: after.filter((hp, i) => hp < before[i]).length};
        })()""")
        check("群攻（強攻系靈技）會同時打到 3 隻", aoe["hits"] == 3, str(aoe))

        respawn = page.evaluate("""(() => {
          const B = __game.Battle.state;
          B.mode = 'farm';
          B.enemies = [0,1,2].map((i) => ({
            id: 'w' + i, name: '群怪' + i, emoji: '🦟',
            maxHp: 500, hp: 500, atk: 1, def: 0, spd: 1,
            gauge: 0, stun: 0, alive: true, boss: false, acts: 0, enraged: false,
          }));
          __game.Battle.hitEnemy(B.enemies[0], 99999, {}, false);
          return {count: B.enemies.length, alive: B.enemies.filter((e) => e.alive).length};
        })()""")
        check("打死一隻不會馬上補滿整波（要清完才出下一波）",
              respawn["count"] == 3 and respawn["alive"] == 2, str(respawn))

        boss = page.evaluate("""(() => {
          const B = __game.Battle.state;
          B.mode = 'boss';
          B.enemies = [{
            id: 'bossX', name: '測試守關獸', emoji: '👹',
            maxHp: 1000, hp: 300, atk: 100, def: 0, spd: 1,
            gauge: 0, stun: 0, alive: true, boss: true, acts: 0, enraged: false,
          }];
          const e = B.enemies[0];
          const atk0 = e.atk;
          __game.Battle.bossAct(e);            // hp 30% → 狂暴
          const enraged = e.enraged, atk1 = e.atk;
          e.acts = 4; e.hp = 500;              // 下一次是第 5 次行動 → 回血（血量 50% < 70%）
          const hpBefore = e.hp;
          __game.Battle.bossAct(e);
          return {atk0, atk1, enraged, hpBefore, hpAfter: e.hp, acts: e.acts};
        })()""")
        check("Boss 半血狂暴：攻擊 +35%",
              boss["enraged"] is True and boss["atk1"] == round(boss["atk0"] * 1.35), str(boss))
        check("Boss 低於 70% 血時每 5 次行動回血 8%",
              boss["hpAfter"] > boss["hpBefore"], f"{boss['hpBefore']} -> {boss['hpAfter']}")

        # ---------- 7. 抽卡 ----------
        page.evaluate("__game.switchTab('gacha')")
        pull = page.evaluate("""(() => {
          const s = __game.State.data;
          s.tickets = 12; s.diamonds = 2000;
          const before = {tickets: s.tickets, souls: s.souls.length};
          const r = __game.State.pullOnce(true);
          return {ok: r.ok, result: r.result, before, after: {tickets: s.tickets, souls: s.souls.length}};
        })()""")
        check("覺醒抽卡：扣券並產出靈印或靈骨",
              pull["ok"] is True and pull["after"]["tickets"] == pull["before"]["tickets"] - 1
              and pull["result"]["kind"] in ("new", "star", "dup", "bone"), str(pull))

        # ---------- 7b. 靈骨：真實加成與升星 ----------
        bone = page.evaluate("""(() => {
          const s = __game.State.data;
          s.bones = [{uid:'t1', id:'giant'}, {uid:'t2', id:'life'}, {uid:'t3', id:'wind'}];
          s.souls.forEach(x => { x.bone = null; });
          s.team = [s.souls[0].id];
          s.souls[0].star = 3;
          const before = __game.State.soulStats(s.souls[0]);
          const eq = __game.State.equipBone(s.souls[0].id, 't1');
          const after = __game.State.soulStats(s.souls[0]);
          return {eq, before, after, free: __game.State.freeBones().length,
                  equipped: __game.State.equippedBones()};
        })()""")
        check("靈骨可裝備，並真的提升靈印攻擊（巨力 +14%）",
              bone["eq"]["ok"] is True and bone["after"]["atk"] > bone["before"]["atk"]
              and abs(bone["after"]["atk"] / bone["before"]["atk"] - 1.14) < 0.05
              and bone["free"] == 2 and bone["equipped"] == 1,
              f"atk {bone['before']['atk']} -> {bone['after']['atk']}")

        aura = page.evaluate("""(() => {
          const s = __game.State.data;
          if (s.souls.length < 2) s.souls.push({id:'turtle', star:3, level:1, rings:[], bone:null});
          s.slots = 2; s.team = [s.souls[0].id, s.souls[1].id];
          s.souls[1].bone = null;
          s.souls[0].bone = null;                       // 先拔掉，量基準值
          const before = __game.State.soulStats(s.souls[1]);
          __game.State.equipBone(s.souls[0].id, 't2');  // 第一位裝「生命 +18%」
          const after = __game.State.soulStats(s.souls[1]);
          return {beforeHp: before.hp, afterHp: after.hp,
                  hostHp: __game.State.soulStats(s.souls[0]).hp};
        })()""")
        check("靈骨光環：同隊其他靈印吃到 30% 加成（18% × 30% ≈ +5.4% 生命）",
              aura["afterHp"] > aura["beforeHp"]
              and abs(aura["afterHp"] / aura["beforeHp"] - 1.054) < 0.02, str(aura))

        star = page.evaluate("""(() => {
          const s = __game.State.data;
          s.souls[0].star = 3; s.souls[0].bone = null;
          s.bones = [{uid:'a', id:'giant'}, {uid:'b', id:'life'}];
          s.coins = 100000;
          const info = __game.State.starUpInfo(s.souls[0]);
          const atk3 = __game.State.soulStats(s.souls[0]).atk;
          const r = __game.State.starUp(s.souls[0].id);
          const atk4 = __game.State.soulStats(s.souls[0]).atk;
          const after = {star: s.souls[0].star, bones: s.bones.length, coins: s.coins};
          // 再升一次（4→5 需 2 塊，現在只剩 1 塊）
          const r2 = __game.State.starUp(s.souls[0].id);
          return {info, r, after, atk3, atk4, r2};
        })()""")
        check("靈印升星：吃掉 1 塊靈骨＋1200 靈幣，星級與屬性提升",
              star["r"]["ok"] is True and star["after"]["star"] == 4
              and star["after"]["bones"] == 1 and star["after"]["coins"] == 100000 - 1200
              and star["atk4"] > star["atk3"], f"{star['after']} atk {star['atk3']}->{star['atk4']}")
        check("升星素材不足會被擋下", star["r2"]["ok"] is False, str(star["r2"]))

        migrate = page.evaluate("""(() => {
          const raw = JSON.parse(localStorage.getItem('soulring.save.v1'));
          raw.bones = ['giant', 'wind'];        // 舊版：純 id 字串
          localStorage.setItem('soulring.save.v1', JSON.stringify(raw));
          __game.State.data.bones = ['giant', 'wind'];   // beforeunload 會用記憶體覆寫
          return true;
        })()""")
        page.reload(wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        mig = page.evaluate("""({
          bones: __game.State.data.bones,
          ok: __game.State.data.bones.every(b => b.uid && b.id),
        })""")
        check("舊存檔（靈骨存字串）會自動遷移成 {uid,id}", mig["ok"] and len(mig["bones"]) == 2, str(mig))

        # ---------- 8. 兌換碼 ----------
        code1 = page.evaluate("(() => { const r = __game.State.redeem('VIP666'); return {r, diamonds: __game.State.data.diamonds, tickets: __game.State.data.tickets}; })()")
        check("兌換碼 VIP666：發鑽石與覺醒券", code1["r"]["ok"] is True and code1["diamonds"] > 2000, str(code1))
        code2 = page.evaluate("(() => { const r = __game.State.redeem('vip666'); return r; })()")
        check("同一組兌換碼不能重複領", code2["ok"] is False, str(code2))
        code3 = page.evaluate("(() => __game.State.redeem('NOPE'))()")
        check("無效兌換碼會被拒絕", code3["ok"] is False, str(code3))

        # ---------- 8b. 每日簽到（7 天一輪）----------
        ci = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.checkin = { lastDay: '', streak: 0, total: 0 };
          const d0 = new Date(2026, 0, 10, 12, 0, 0);
          const coins0 = s.coins;
          const r1 = St.checkIn(d0);
          const again = St.checkIn(d0);                      // 同一天不能領第二次
          const r2 = St.checkIn(new Date(2026, 0, 11, 12));  // 隔天連續
          const r3 = St.checkIn(new Date(2026, 0, 12, 12));
          const r4 = St.checkIn(new Date(2026, 0, 15, 12));  // 斷簽後重來
          return {r1, again, r2, r3, r4, coins: s.coins - coins0,
                  checkin: {...s.checkin}};
        })()""")
        check("簽到：第一天可領、同一天不能再領",
              ci["r1"]["ok"] is True and ci["r1"]["dayIndex"] == 1
              and ci["again"]["ok"] is False and ci["coins"] >= 3000, f"{ci['r1']} / {ci['again']}")
        check("連續簽到 streak 會累加（第 2、3 天）",
              ci["r2"]["streak"] == 2 and ci["r2"]["dayIndex"] == 2
              and ci["r3"]["streak"] == 3 and ci["r3"]["dayIndex"] == 3, f"{ci['r2']} / {ci['r3']}")
        check("斷簽後 streak 重置為 1", ci["r4"]["streak"] == 1 and ci["r4"]["ok"] is True, str(ci["r4"]))

        day7 = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.checkin = { lastDay: St.dayKey(new Date(2026, 0, 20, 12)), streak: 6, total: 6 };
          const rings0 = s.ringBag.length, tickets0 = s.tickets, dia0 = s.diamonds;
          const r = St.checkIn(new Date(2026, 0, 21, 12));
          return {r, rings: s.ringBag.length - rings0, tickets: s.tickets - tickets0,
                  diamonds: s.diamonds - dia0,
                  tier: s.ringBag[s.ringBag.length - 1] && s.ringBag[s.ringBag.length - 1].tier};
        })()""")
        check("第 7 天給大獎（黑靈環＋券 3＋鑽石 888）",
              day7["r"]["dayIndex"] == 7 and day7["rings"] == 1
              and day7["tickets"] == 3 and day7["diamonds"] == 888 and day7["tier"] == "black",
              str(day7))

        ui_ci = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.checkin = { lastDay: '', streak: 0, total: 0 };   // 回到可領狀態
          __game.renderAll();
          const info = __game.checkinInfo();
          return {
            cells: document.querySelectorAll('.ci-cell').length,
            today: document.querySelectorAll('.ci-cell.today').length,
            btn: document.getElementById('btnCheckin').textContent.trim(),
            disabled: document.getElementById('btnCheckin').disabled,
            dot: !document.getElementById('checkinDot').classList.contains('hidden'),
            canCheck: info.canCheck,
          };
        })()""")
        check("簽到 UI：7 格、今日高亮、按鈕可領、頁籤紅點",
              ui_ci["cells"] == 7 and ui_ci["today"] == 1 and ui_ci["disabled"] is False
              and ui_ci["dot"] is True and "第 1 天" in ui_ci["btn"], str(ui_ci))

        page.evaluate("__game.State.checkIn(); __game.State.save(true)")
        page.reload(wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        ci_kept = page.evaluate("""({
          checkin: __game.State.data.checkin,
          canCheck: __game.checkinInfo().canCheck,
          btnDisabled: document.getElementById('btnCheckin').disabled,
        })""")
        check("簽到狀態會存檔，當天重載後不能再領",
              ci_kept["checkin"]["total"] >= 1 and ci_kept["canCheck"] is False
              and ci_kept["btnDisabled"] is True, str(ci_kept))

        # ---------- 9. 存檔碼往返 ----------
        roundtrip = page.evaluate("""(() => {
          const s = __game.State.data;
          s.coins = 123456; s.diamonds = 999;
          const code = __game.State.exportCode();
          s.coins = 0;
          const r = __game.State.importCode(code);
          return {ok: r.ok, coins: __game.State.data.coins, diamonds: __game.State.data.diamonds, len: code.length};
        })()""")
        check("存檔碼匯出／匯入可還原進度", roundtrip["ok"] is True and roundtrip["coins"] == 123456
              and roundtrip["diamonds"] == 999 and roundtrip["len"] > 50, str(roundtrip))

        # ---------- 10. 離線收益 ----------
        off = page.evaluate("""(() => {
          const s = __game.State.data;
          s.stage = 5; s.coins = 0; s.exp = 0; s.level = 1;
          s.lastSave = Date.now() - 2 * 3600 * 1000;      // 2 小時前
          const g = __game.State.offlineGain(s);
          return {g, coins: s.coins, exp: s.exp};
        })()""")
        check("離線 2 小時會結算靈幣與經驗", bool(off["g"]) and off["g"]["minutes"] >= 110
              and off["coins"] > 0 and off["g"]["coins"] > 0, json.dumps(off, ensure_ascii=False)[:200])

        cap_off = page.evaluate("""(() => {
          const s = __game.State.data;
          s.lastSave = Date.now() - 30 * 3600 * 1000;     // 30 小時前
          const g = __game.State.offlineGain(s);
          return {minutes: g.minutes, capped: g.capped};
        })()""")
        check("離線收益上限 12 小時", cap_off["capped"] is True and cap_off["minutes"] <= 720, str(cap_off))

        # ---------- 11. 自動存檔 / 重載保留 ----------
        page.evaluate("__game.State.data.coins = 777777; __game.State.save(true)")
        page.reload(wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        kept = page.evaluate("({coins: __game.State.data.coins, souls: __game.State.data.souls.length})")
        check("重新載入後進度保留", kept["coins"] >= 777777 and kept["souls"] >= 1, str(kept))

        # ---------- 11b. 放置自動化：自動 BOSS／卡等自動獵靈 ----------
        auto_boss = page.evaluate("""(() => new Promise((resolve) => {
          const St = __game.State, B = __game.Battle.state;
          St.data.settings = {autoBoss: true, autoHunt: false};
          St.data.stage = 3; St.data.kills = 0;
          B.mode = 'farm';
          __game.Battle.spawnWave('farm');
          B.pendingBoss = true;
          const t0 = Date.now();
          const iv = setInterval(() => {
            if (B.mode === 'boss') { clearInterval(iv); resolve({ok: true, ms: Date.now() - t0}); }
            else if (Date.now() - t0 > 5000) { clearInterval(iv); resolve({ok: false, mode: B.mode}); }
          }, 100);
        }))()""")
        check("自動挑戰 BOSS：清完小怪後會自己進 BOSS 戰",
              auto_boss["ok"] is True and auto_boss.get("ms", 9999) < 3500, str(auto_boss))

        auto_hunt = page.evaluate("""(() => new Promise((resolve) => {
          const St = __game.State, B = __game.Battle.state;
          St.data.settings = {autoBoss: false, autoHunt: true};
          St.data.level = 10; St.data.exp = 0;
          St.data.ringBag = []; St.data.souls.forEach((x) => { x.rings = []; });
          St.data.cd = {};
          B.mode = 'farm'; B.huntBeast = null;
          __game.Battle.spawnWave('farm');
          const t0 = Date.now();
          const iv = setInterval(() => {
            if (B.mode === 'hunt') { clearInterval(iv); resolve({ok: true, ms: Date.now() - t0}); }
            else if (Date.now() - t0 > 6000) { clearInterval(iv); resolve({ok: false, mode: B.mode}); }
          }, 100);
        }))()""")
        check("卡等自動獵靈：等級到上限會自己進靈獸戰",
              auto_hunt["ok"] is True and auto_hunt.get("ms", 9999) < 9000, str(auto_hunt))

        prio = page.evaluate("""(() => new Promise((resolve) => {
          const St = __game.State, B = __game.Battle.state;
          St.data.settings = {autoBoss: true, autoHunt: true};
          St.data.level = 10; St.data.exp = 0;
          St.data.ringBag = []; St.data.souls.forEach((x) => { x.rings = []; });
          St.data.cd = {};
          B.mode = 'farm'; B.huntBeast = null;
          __game.Battle.spawnWave('farm');
          B.pendingBoss = true;          // 同時有待挑戰的 BOSS
          const t0 = Date.now();
          const iv = setInterval(() => {
            if (B.mode === 'hunt') { clearInterval(iv); resolve({ok: true, mode: B.mode}); }
            else if (B.mode === 'boss') { clearInterval(iv); resolve({ok: false, mode: B.mode}); }
            else if (Date.now() - t0 > 8000) { clearInterval(iv); resolve({ok: false, mode: B.mode}); }
          }, 100);
        }))()""")
        check("卡等時獵靈優先於打 BOSS（先拿環才有成長）", prio["ok"] is True, str(prio))

        page.evaluate("__game.State.data.settings = {autoBoss:false, autoHunt:false};"
                      " __game.State.save(true); __game.Battle.init()")

        # ---------- 11c. 節奏參數護欄（避免之後調平衡又回到卡等）----------
        pace = page.evaluate("""({
          expTo10: [1,2,3,4,5,6,7,8,9].reduce((a, l) => a + __game.CFG.expNeed(l), 0),
          perStage: __game.CFG.BASE_KILLS_PER_STAGE,
          autoBossMs: __game.CFG.AUTO_BOSS_DELAY,
          expPerKill1: __game.CFG.killReward(1).exp,
          baboonHp: __game.CFG.BEAST_BY_ID.baboon.hp,
        })""")
        check("前期節奏：Lv10 需求 < 1200 經驗、每關 8 隻、首隻靈獸 ≤ 260 血",
              pace["expTo10"] < 1200 and pace["perStage"] == 8
              and pace["expPerKill1"] >= 10 and pace["baboonHp"] <= 260
              and 1000 <= pace["autoBossMs"] <= 3000, str(pace))

        # ---------- 11d. 轉生（命印）與無限關卡 ----------
        gate = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.bestStage = 12; s.level = 12; s.marks = 0; s.rebirths = 0;
          const info = St.rebirthInfo();
          const r = St.doRebirth();
          return {gain: info.gain, can: info.can, ok: r.ok, msg: r.msg,
                  bestStage: s.bestStage, level: s.level};
        })()""")
        check("轉生條件：歷史最高未達 20 關會被擋下",
              gate["can"] is False and gate["ok"] is False and gate["gain"] == 0, str(gate))

        reb = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.bestStage = 30; s.level = 30; s.stage = 30; s.coins = 9999;
          s.ringBag = [{uid:'rx', tier:'violet', name:'紫靈環', equipped:null}];
          s.souls[0].rings = []; s.souls[0].level = 30;
          const star0 = s.souls[0].star;
          const atk0 = St.soulStats(s.souls[0]).atk;
          const info = St.rebirthInfo();
          const r = St.doRebirth();
          const atk1 = St.soulStats(s.souls[0]).atk;
          return {info, r, star0, star1: s.souls[0].star, atk0, atk1,
                  level: s.level, stage: s.stage, coins: s.coins, rings: s.ringBag.length,
                  bestStage: s.bestStage, marks: s.marks, rebirths: s.rebirths};
        })()""")
        check("轉生：命印增加、等級/關卡/靈幣歸零、靈環保留、最高關卡保留",
              reb["r"]["ok"] is True and reb["marks"] == reb["info"]["gain"] and reb["marks"] >= 5
              and reb["level"] == 1 + CFG_STARTLV and reb["stage"] == 1 and reb["coins"] == 0
              and reb["rings"] == 1 and reb["bestStage"] == 30 and reb["rebirths"] == 1, str(reb))
        check("轉生保留靈印與星級", reb["star0"] == reb["star1"], f"{reb['star0']} → {reb['star1']}")

        perm = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          const mk = s.marks;
          const st = St.teamStats();
          return {marks: mk, income: St.incomeMul(), power: St.power(),
                  bonusPct: Math.round(CFG.REBIRTH.perMark.atk * 100 * mk)};
        })()""")
        check("命印是永久加成：收益倍率 > 1、戰力重算",
              perm["marks"] >= 5 and perm["income"] > 1 and perm["power"] > 0
              and perm["bonusPct"] >= 30, str(perm))

        inf = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.stage = 120;
          const a = __game.CFG.enemyStats(120, false);
          const b = __game.CFG.enemyStats(400, false);
          return {a, b, area1: __game.CFG.areaFor(1), area120: __game.CFG.areaFor(120),
                  area500: __game.CFG.areaFor(500),
                  kills120: __game.CFG.killReward(120)};
        })()""")
        check("無限關卡：第 120、400 關數值仍可算、地圖名循環、難度不失控",
              inf["b"]["hp"] > inf["a"]["hp"] and inf["b"]["hp"] < 1e15
              and inf["area120"] != inf["area1"] and inf["area500"] != ""
              and inf["kills120"]["exp"] > 0,
              f"hp {inf['a']['hp']:.3g} → {inf['b']['hp']:.3g}, {inf['area1']} / {inf['area120']} / {inf['area500']}")

        page.evaluate("__game.Battle.init(); __game.renderAll()")
        rb_ui = page.evaluate("""({
          box: !!document.getElementById('rebirthBox'),
          text: (document.getElementById('rebirthBox') || {}).textContent || '',
          marks: (document.getElementById('marks') || {}).textContent,
        })""")
        check("轉生 UI：靈印頁有轉生卡、頂部顯示命印", rb_ui["box"] and "命印" in rb_ui["text"]
              and rb_ui["marks"] not in (None, "", "0"), str(rb_ui)[:160])

        # ---------- 11d-2. 抽卡走到靈骨分支不會炸 ----------
        bone_pull = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          const rnd = Math.random;
          Math.random = () => 0.01;          // 強制走「靈骨」分支
          const before = s.bones.length;
          let out;
          try { out = St.pullOnce(true); } catch (e) { out = { error: String(e) }; }
          Math.random = rnd;
          return {ok: out.ok, kind: out.result && out.result.kind,
                  gained: s.bones.length - before, err: out.error || null};
        })()""")
        check("抽卡抽到靈骨不會丟錯（PULL_BONES 存在）",
              bone_pull["ok"] is True and bone_pull["kind"] == "bone"
              and bone_pull["gained"] == 1 and bone_pull["err"] is None, str(bone_pull))

        # ---------- 11e. Stage 2：9 環槽 / 靈環技能 / 共鳴 / 靈印真身 ----------
        slots = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          const out = {};
          [1, 9, 10, 25, 50, 100].forEach((lv) => {
            s.level = lv;
            out['lv' + lv] = St.ringSlotsOf(s.souls[0]);
          });
          return out;
        })()""")
        check("環槽：每 10 級開 1 格、上限 9（Lv9=0、Lv10=1、Lv100=9）",
              slots["lv1"] == 0 and slots["lv9"] == 0 and slots["lv10"] == 1
              and slots["lv25"] == 2 and slots["lv50"] == 5 and slots["lv100"] == 9, str(slots))

        ring_skill = page.evaluate("""(() => {
          const St = __game.State, B = __game.Battle.state, s = St.data;
          s.level = 60;
          s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
          const soul = s.souls[0];
          const r = St.newRing('violet', 'poison');
          s.ringBag.push(r);
          St.equipRing(soul.id, r.uid);
          B.mode = 'farm';
          B.enemies = [0,1,2].map((i) => ({ id: 'sk' + i, name: '怪' + i, emoji: '🦟',
            maxHp: 9000, hp: 9000, atk: 1, def: 0, spd: 1, gauge: 0, stun: 0,
            alive: true, boss: false, acts: 0, enraged: false }));
          __game.Battle.init();
          const u = B.units[0];
          u.atk = 100; u.mp = 100;
          const before = B.enemies.map((e) => e.hp);
          const events = [];
          const off = __game.Battle.on((ev) => { if (ev.type === 'skill') events.push(ev); });
          __game.Battle.castSkill(u);
          off();
          const after = B.enemies.map((e) => e.hp);
          return {before, after, hits: after.filter((hp, i) => hp < before[i]).length,
                  ev: events[0] || null, skill: St.ringSkillOf(soul)};
        })()""")
        check("靈環技能：千年環給群體靈技，一擊打到全部敵人",
              ring_skill["hits"] == 3 and ring_skill["ev"]["ring"] is True
              and ring_skill["skill"]["type"] == "aoe", str(ring_skill)[:200])

        reso = page.evaluate("""(() => {
          const St = __game.State, B = __game.Battle.state, s = St.data;
          const rnd = Math.random;
          Math.random = () => 0.5;      // 固定傷害浮動與暴擊，讓倍率可精確比較
          const run = (rings) => {
            s.level = 60;
            s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
            const soul = s.souls[0];
            rings.forEach((el) => {
              const r = St.newRing('violet', el);
              s.ringBag.push(r); St.equipRing(soul.id, r.uid);
            });
            B.enemies = [{ id: 'r1', name: 'x', emoji: '🦟', maxHp: 1e9, hp: 1e9,
              atk: 1, def: 0, spd: 1, gauge: 0, stun: 0, alive: true, boss: false, acts: 0, enraged: false }];
            __game.Battle.init();
            const u = B.units[0]; u.atk = 100; u.mp = 100;
            const hp0 = B.enemies[0].hp;
            __game.Battle.castSkill(u);
            return hp0 - B.enemies[0].hp;
          };
          // 對照組：同樣 3 個千年環，但元素不同 → 沒有共鳴
          const mixed = run(['poison', 'wood', 'wind']);
          const same = run(['poison', 'poison', 'poison']);
          Math.random = rnd;
          return {mixed, same, ratio: +(same / mixed).toFixed(3),
                  reso: St.resonanceOf(s.souls[0])};
        })()""")
        check("屬性共鳴：3 個同系靈環 → 靈技傷害 ×1.25（同年份對照）",
              reso["reso"] and reso["reso"]["count"] == 3
              and abs(reso["ratio"] - 1.25) < 0.01, str(reso))

        body = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.level = 90;
          s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
          const soul = s.souls[0];
          ['black','black','black'].forEach((tier, i) => {
            const r = St.newRing(tier, i % 2 ? 'earth' : 'water');
            s.ringBag.push(r); St.equipRing(soul.id, r.uid);
          });
          const tb = St.trueBodyOf(soul);
          // 用「暫時關掉真身加成」當對照組，才不會把靈環本身的 +150% 算進去
          const saved = CFG.TRUE_BODY[0].mult;
          CFG.TRUE_BODY[0].mult = 0;
          const atk0 = St.soulStats(soul).atk;
          CFG.TRUE_BODY[0].mult = saved;
          const atk1 = St.soulStats(soul).atk;
          return {atk0, atk1, tb, bonus: saved, ratio: +(atk1 / atk0).toFixed(3)};
        })()""")
        check("靈印真身：3 個黑靈環 → 全屬性 +15%（已驗加成確實生效）",
              body["tb"]["high"] == 3 and body["tb"]["bonus"] == 0.15
              and body["bonus"] == 0.15 and 1.12 <= body["ratio"] <= 1.20, str(body))

        # ---------- 11f. 靈環合成（3 個同階 → 1 個高一階）----------
        merge1 = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.level = 60; s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
          ['white','white','white'].forEach((t, i) => s.ringBag.push(St.newRing(t, i === 0 ? 'poison' : 'wind')));
          const before = {bag: s.ringBag.length, white: St.freeRings().filter(r => r.tier === 'white').length};
          const r = St.mergeRings('white');
          return {before, r: {ok: r.ok, next: r.nextTier, el: r.element},
                  bag: s.ringBag.length, yellow: s.ringBag.filter(x => x.tier === 'yellow').length,
                  left: s.ringBag.filter(x => x.tier === 'white').length};
        })()""")
        check("合成：3 個十年環 → 1 個百年環（保留多數元素）",
              merge1["r"]["ok"] is True and merge1["r"]["next"] == "yellow"
              and merge1["yellow"] == 1 and merge1["left"] == 0
              and merge1["r"]["el"] == "wind" and merge1["bag"] == 1, str(merge1))

        merge2 = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
          s.ringBag.push(St.newRing('white','wind'), St.newRing('white','wind'));
          const few = St.mergeRings('white');
          s.ringBag.push(St.newRing('red','water'), St.newRing('red','water'), St.newRing('red','water'));
          const top = St.mergeRings('red');
          return {few: {ok: few.ok, msg: few.msg}, top: {ok: top.ok, msg: top.msg}};
        })()""")
        check("合成：不足 3 個會被擋、十萬年環不能合成",
              merge2["few"]["ok"] is False and merge2["top"]["ok"] is False, str(merge2))

        merge3 = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.level = 60; s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
          for (let i = 0; i < 9; i++) s.ringBag.push(St.newRing('white', 'wind'));
          const before = St.freeRings().length;
          const all = St.mergeAll();
          // 已裝備的環不能被合成吃掉
          const eqRing = St.newRing('violet', 'water');
          s.ringBag.push(eqRing); St.equipRing(s.souls[0].id, eqRing.uid);
          const bagBefore = s.ringBag.length;
          for (let i = 0; i < 3; i++) s.ringBag.push(St.newRing('white', 'wind'));
          St.mergeAll();
          return {before, all: {ok: all.ok, made: all.made},
                  white: s.ringBag.filter(r => r.tier === 'white' && !r.equipped).length,
                  yellow: s.ringBag.filter(r => r.tier === 'yellow').length,
                  violet: s.ringBag.filter(r => r.tier === 'violet').length,
                  stillEquipped: s.souls[0].rings.length,
                  equippedViolet: s.ringBag.filter(r => r.equipped && r.tier === 'violet').length,
                  bagBefore};
        })()""")
        check("一鍵合成：9 個白 → 3 黃 → 1 紫；已裝備的不會被吃掉",
              merge3["all"]["ok"] is True and merge3["all"]["made"] == 4
              and merge3["white"] == 0 and merge3["yellow"] == 1 and merge3["violet"] == 2
              and merge3["stillEquipped"] == 1 and merge3["equippedViolet"] == 1, str(merge3))

        auto_m = page.evaluate("""(() => {
          const St = __game.State, s = St.data;
          s.settings = {autoBoss:false, autoHunt:false, autoRing:true, autoMerge:true};
          s.level = 60; s.ringBag = []; s.souls.forEach((x) => { x.rings = []; });
          for (let i = 0; i < 3; i++) s.ringBag.push(St.newRing('white', 'wind'));
          const r = St.mergeLowTiers();
          s.settings.autoMerge = false;
          for (let i = 0; i < 3; i++) s.ringBag.push(St.newRing('white', 'wind'));
          const r2 = St.mergeLowTiers();
          return {on: r.made, off: r2.made, yellow: s.ringBag.filter(x => x.tier === 'yellow').length};
        })()""")
        check("自動合成：預設開啟、關掉後不再合成",
              auto_m["on"] == 1 and auto_m["off"] == 0 and auto_m["yellow"] >= 1, str(auto_m))

        page.evaluate("__game.State.data.settings = {autoBoss:false, autoHunt:false, autoRing:true, autoMerge:true};"
                      " __game.State.save(true)")

        # ---------- 11g. 難度橡皮筋：深關卡不再永久卡死 ----------
        page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.level=100; s.slots=5; s.marks=0; s.stage=62; s.bestStage=62;
          s.settings={autoBoss:true, autoHunt:false, autoRing:true, autoMerge:true};
          const ids=['haotian','phoenix','turtle','tower','nether'];
          s.souls=ids.map(id=>({id, star:4, level:100, rings:[], bone:null}));
          s.team=ids.slice(); s.ringBag=[]; s.bones=[]; s.bossFails={};
          s.kills = CFG.BASE_KILLS_PER_STAGE;
          ids.forEach(id=>{ for(let k=0;k<9;k++){ const r=St.newRing('red','water'); s.ringBag.push(r); St.equipRing(id,r.uid);} });
          __game.Battle.init(); __game.renderAll();
          __game.Battle.state.pendingBoss = true;
          __game.Battle.challengeBoss();
        })()""")
        start_stage = page.evaluate("__game.State.data.stage")
        time.sleep(40)
        prog = page.evaluate("""(() => {
          const s=__game.State.data, B=__game.Battle.state;
          return {stage:s.stage, fails:(s.bossFails||{})[62]||0,
                  alive:B.units.filter(u=>u.alive).length};
        })()""")
        check("第 62 關（深關卡）40 秒內推得過去，不再無限卡關",
              prog["stage"] > start_stage, str(prog))

        weaken = page.evaluate("""(() => {
          const St=__game.State, B=__game.Battle.state, s=St.data;
          s.stage = 500;
          const spawn = (fails) => {
            s.bossFails = {500: fails};
            B.mode='farm'; B.pendingBoss = true;
            __game.Battle.challengeBoss();
            return Math.round(B.enemies[0].maxHp);
          };
          const base = spawn(0);
          const weak = spawn(3);
          s.bossFails = {};
          return {base, weak, ratio:+(weak/base).toFixed(3)};
        })()""")
        check("BOSS 連續失敗會削弱（第 500 關：3 次失敗 → 血量上限約 ×0.55）",
              weigh_ok(weaken), str(weaken))

        # ---------- 11h. 命印乘算 + 可轉生提示（戰力不再被靈環稀釋）----------
        markmul = page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          const build=(marks)=>{
            s.level=100; s.slots=5; s.marks=marks; s.stage=79; s.bestStage=79;
            const ids=['haotian','phoenix','turtle','tower','nether'];
            s.souls=ids.map(id=>({id, star:4, level:100, rings:[], bone:null}));
            s.team=ids.slice(); s.ringBag=[]; s.bones=[];
            ids.forEach(id=>{ for(let k=0;k<9;k++){ const r=St.newRing('red','water'); s.ringBag.push(r); St.equipRing(id,r.uid);} });
            return St.power();
          };
          const base = build(0), m25 = build(25);
          return {base, m25, ratio:+(m25/base).toFixed(2)};
        })()""")
        check("命印獨立乘算：25 點 → 戰力 ×2.5（不再被靈環 +3600% 稀釋）",
              abs(markmul["ratio"] - 2.5) <= 0.05, str(markmul))

        hint = page.evaluate("""(() => {
          __game.renderAll();
          const el = document.getElementById('rebirthHint');
          return {visible: el && !el.classList.contains('hidden'),
                  text: el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : ''};
        })()""")
        check("靈印頁出現「可轉生」提示條（戰力停住時給出口）",
              hint["visible"] is True and "命印" in hint["text"], str(hint))
        page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.marks=0; s.stage=1; s.bestStage=1; s.level=1;
          s.souls=[{id:'haotian', star:3, level:1, rings:[], bone:null}];
          s.team=['haotian']; s.ringBag=[]; s.bones=[];
          __game.Battle.init(); __game.renderAll();
        })()""")

        # ---------- 11i. 觸控捲動（GamePix SDK 會注入 touch-action:none）----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844},
                                   is_mobile=True, has_touch=True)
        mp = mctx.new_page()
        mp.goto(f"http://127.0.0.1:8771/index.html?v=touch{int(time.time())}", wait_until="load")
        mp.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        try:
            mp.wait_for_function("typeof window.GamePix !== 'undefined'", timeout=15000)
        except Exception:
            pass
        time.sleep(1.0)
        mp.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.level=100; s.slots=5;
          const ids=['haotian','fox','bear','turtle','tower'];
          s.souls=ids.map(id=>({id, star:5, level:90, rings:[], bone:null}));
          s.team=ids.slice(); s.ringBag=[]; s.bones=[];
          ids.forEach(id=>{ for(let k=0;k<9;k++){ const r=St.newRing('red','water'); s.ringBag.push(r); St.equipRing(id,r.uid);} });
          __game.renderAll(); __game.switchTab('souls');
        })()""")
        time.sleep(0.5)
        touch = mp.evaluate("""(() => {
          const v = document.querySelector('.view.active');
          return {ta: getComputedStyle(v).touchAction, scrollable: v.scrollHeight > v.clientHeight};
        })()""")
        cdp = mctx.new_cdp_session(mp)

        def _drag(y0, y1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 195, "y": y0}]})
            for i in range(1, 11):
                cdp.send("Input.dispatchTouchEvent",
                         {"type": "touchMove", "touchPoints": [{"x": 195, "y": y0 + (y1 - y0) * i / 10}]})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

        t0 = mp.evaluate("document.querySelector('.view.active').scrollTop")
        _drag(700, 300)
        time.sleep(0.5)
        t1 = mp.evaluate("document.querySelector('.view.active').scrollTop")
        check("手機可以上下滑動（SDK 注入 touch-action:none 已被覆蓋）",
              touch["ta"] == "pan-y" and touch["scrollable"] is True and t1 > t0 + 100,
              f"{touch} scrollTop {t0} → {t1}")
        mctx.close()

        # ---------- 11i-2. 轉生新規則：只能靠「本輪推進」換命印 ----------
        rbnew = page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.marks=1000; s.rebirths=50; s.level=100;
          s.bestStage=104; s.lastRebirthBest=104;
          const atRecord = St.rebirthInfo();
          s.bestStage=200;
          const pushed = St.rebirthInfo();
          const before = s.marks;
          const r = St.doRebirth();
          const afterLast = s.lastRebirthBest;
          return {atRecord:{can:atRecord.can, gain:atRecord.gain, need:atRecord.needStage},
                  pushed:{can:pushed.can, gain:pushed.gain, deep:pushed.deep},
                  gained: s.marks - before, afterLast, bestAfter: s.bestStage};
        })()""")
        check("轉生必須刷新紀錄：停在同一關卡不能再轉（need = 紀錄+1）",
              rbnew["atRecord"]["can"] is False and rbnew["atRecord"]["gain"] == 0
              and rbnew["atRecord"]["need"] == 105, str(rbnew["atRecord"]))
        check("轉生收益依本輪推進（104→200 = deep 96 → +24 命印 = 19 + 等級5）",
              rbnew["pushed"]["can"] is True and rbnew["pushed"]["gain"] == 24
              and rbnew["pushed"]["deep"] == 96, str(rbnew["pushed"]))
        check("轉生後把本輪紀錄歸零（lastRebirthBest = 當下最高關卡）",
              rbnew["gained"] == 24 and rbnew["afterLast"] == 200, str(rbnew))

        migrate_rb = page.evaluate("""(() => {
          const St=__game.State;
          const old = {v:1, bestStage: 150, marks: 10, level: 40,
                       souls:[{id:'haotian', star:3, level:40, rings:[]}], team:['haotian']};
          const m = St.migrate(old);
          return {lastRebirthBest: m.lastRebirthBest, bestStage: m.bestStage,
                  hasField: 'lastRebirthBest' in m};
        })()""")
        check("舊存檔遷移：lastRebirthBest 自動補成現有最高關卡（不會白送一波）",
              migrate_rb["hasField"] is True and migrate_rb["lastRebirthBest"] == 150
              and migrate_rb["bestStage"] == 150, str(migrate_rb))

        widen = page.evaluate("""(() => {
          const St=__game.State, B=__game.Battle.state, s=St.data;
          s.level=100; s.slots=5; s.marks=0; s.bestStage=400; s.lastRebirthBest=0;
          const ids=['haotian','phoenix','turtle','tower','nether'];
          s.souls=ids.map(id=>({id, star:4, level:100, rings:[], bone:null}));
          s.team=ids.slice(); s.ringBag=[]; s.bones=[];
          ids.forEach(id=>{ for(let k=0;k<9;k++){ const r=St.newRing('red','water'); s.ringBag.push(r); St.equipRing(id,r.uid);} });
          __game.Battle.init();
          const boss = (stage) => { s.stage=stage; s.bossFails={}; B.mode='farm'; B.pendingBoss=true;
                                    __game.Battle.challengeBoss(); return Math.round(B.enemies[0].maxHp); };
          const at104 = boss(104), at400 = boss(400);
          return {at104, at400, ratio:+(at400/at104).toFixed(2)};
        })()""")
        check("深度放寬：第 400 關 BOSS 血量上限明顯高於第 104 關（深度＝難度）",
              widen["ratio"] >= 1.25, str(widen))

        # ---------- 11j. 靈幣抽靈骨（靈幣出口）----------
        bonepull = page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.coins = 100000; s.bonePulls = 0; s.bones = [];
          const c0 = CFG.coinPullCost(0), c1 = CFG.coinPullCost(1), c20 = CFG.coinPullCost(20);
          const r1 = St.coinBonePull(1);
          const ids = ['wind','giant','life','armor','king'];
          return {c0, c1, c20, ok: r1.ok, paid: r1.paid, n: r1.got.length,
                  inSet: ids.indexOf(r1.got[0].id) >= 0, pulls: s.bonePulls,
                  bones: s.bones.length, coins: s.coins};
        })()""")
        check("靈幣抽靈骨：每次必得 1 塊、成本隨次數遞增（2000 → 2700 → 80 萬）",
              bonepull["c0"] == 2000 and bonepull["c1"] == 2700 and bonepull["c20"] > 700000
              and bonepull["ok"] is True and bonepull["n"] == 1 and bonepull["inSet"] is True
              and bonepull["pulls"] == 1 and bonepull["bones"] == 1
              and bonepull["coins"] == 100000 - bonepull["paid"], str(bonepull))

        broke = page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.coins = 100; s.bonePulls = 5; s.bones = [];
          const r = St.coinBonePull(1);
          const multi = St.coinBonePull(5);
          return {single: {ok: r.ok, msg: r.msg}, multi: {ok: multi.ok},
                  bones: s.bones.length, coins: s.coins, pulls: s.bonePulls};
        })()""")
        check("靈幣不足時擋下、不扣幣也不給靈骨",
              broke["single"]["ok"] is False and broke["multi"]["ok"] is False
              and broke["bones"] == 0 and broke["coins"] == 100 and broke["pulls"] == 5, str(broke))

        partial = page.evaluate("""(() => {
          const St=__game.State, s=St.data;
          s.coins = CFG.coinPullCost(0) + CFG.coinPullCost(1) + 10; s.bonePulls = 0; s.bones = [];
          const r = St.coinBonePull(5);
          return {ok: r.ok, got: r.got.length, pulls: s.bonePulls, coins: s.coins};
        })()""")
        check("連抽錢不夠時只完成付得起的次數（不會扣到負數）",
              partial["ok"] is True and partial["got"] == 2 and partial["pulls"] == 2
              and partial["coins"] >= 0, str(partial))

        # ---------- 12. 版面 ----------
        page.wait_for_selector("#stage", state="visible", timeout=5000)
        layout = page.evaluate("""({
          appW: document.getElementById('app').getBoundingClientRect().width,
          innerW: innerWidth,
          scrollW: document.documentElement.scrollWidth,
          stageH: document.getElementById('stage').getBoundingClientRect().height,
          navH: document.getElementById('nav').getBoundingClientRect().height,
          tabVisible: !!document.querySelector('.view.active'),
        })""")
        check("直式版面：內容不超出視窗、舞台與導覽都在",
              layout["appW"] <= layout["innerW"] + 1 and layout["scrollW"] <= layout["innerW"] + 1
              and layout["stageH"] > 150 and layout["navH"] > 40 and layout["tabVisible"], str(layout))

        # 頁籤切換
        for t in ("souls", "rings", "hunt", "gacha", "battle"):
            page.click(f'.nav-btn[data-tab="{t}"]')
            time.sleep(0.15)
        cur = page.evaluate("__game.tab")
        check("五個頁籤都能切換", cur == "battle", f"tab={cur}")

        # ---------- 13. 截圖 ----------
        time.sleep(1.2)
        page.screenshot(path=str(ART / "soulring-battle.png"))
        page.click('.nav-btn[data-tab="hunt"]')
        time.sleep(0.4)
        page.screenshot(path=str(ART / "soulring-hunt.png"))
        page.click('.nav-btn[data-tab="gacha"]')
        time.sleep(0.4)
        page.screenshot(path=str(ART / "soulring-gacha.png"))
        page.click('.nav-btn[data-tab="souls"]')
        time.sleep(0.4)
        page.screenshot(path=str(ART / "soulring-souls.png"))

        desktop = browser.new_context(viewport={"width": 1280, "height": 900})
        dp = desktop.new_page()
        dp.goto(url, wait_until="load")
        dp.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        time.sleep(0.6)
        dw = dp.evaluate("document.getElementById('app').getBoundingClientRect().width")
        check("桌機：介面鎖在 480px 內並置中", 470 <= dw <= 481, f"app width={dw}")
        dp.screenshot(path=str(ART / "soulring-desktop.png"))
        desktop.close()

        # ---------- 13. 英文預設 / GamePix 合規 ----------
        en = browser.new_context(viewport={"width": 420, "height": 900}, locale="zh-TW").new_page()
        en_errs = []
        en.on("pageerror", lambda e: en_errs.append(str(e)))
        # 故意用中文系統語系開「沒有 ?lang」的網址：預設必須是英文
        en.goto(f"http://127.0.0.1:8771/index.html?v=en{int(time.time())}", wait_until="load")
        en.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        time.sleep(2.5)
        lang = en.evaluate("({lang: document.documentElement.lang, title: document.title, "
                           "tab: document.querySelector('.nav-btn b').textContent})")
        check("預設英文（中文系統語系也一樣）、標題固定 Spirit Ring Idle",
              lang["lang"] == "en" and lang["title"] == "Spirit Ring Idle"
              and lang["tab"] == "Battle", str(lang))

        for tab in ("battle", "souls", "rings", "hunt", "gacha"):
            en.evaluate(f"__game.switchTab('{tab}')")
            time.sleep(0.5)
            cjk = en.evaluate("""(() => {
              const bad = [];
              const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
              let n;
              while ((n = w.nextNode())) {
                const t = n.nodeValue.trim();
                if (/[\\u3400-\\u9fff]/.test(t)) bad.push(t.slice(0, 30));
              }
              return bad;
            })()""")
            check(f"英文模式：{tab} 頁沒有殘留中文", not cjk, str(cjk[:5]))

        gpx = en.evaluate("""({
          hasGP: typeof GP !== 'undefined',
          adsAllowed: GP.adsAllowed,
          hasSdk: GP.hasSdk,
          loading: document.getElementById('loading').classList.contains('hidden'),
          fmt15k: I18N.fmt(15000),
          fmtZh: (I18N.lang === 'en'),
        })""")
        check("GamePix 包裝層：本機不開廣告、載入畫面已收起、數字用 K/M/B",
              gpx["hasGP"] is True and gpx["adsAllowed"] is False
              and gpx["loading"] is True and gpx["fmt15k"] == "15.0K", str(gpx))

        ad = en.evaluate("GP.interstitial().then(r => r)")
        check("沒有 SDK／非 Player 時插頁廣告安全失敗（遊戲不中斷）",
              isinstance(ad, dict) and ad.get("success") is False, str(ad))

        paused = en.evaluate("""(() => {
          const before = __game.Battle.state.units[0].gauge;
          GP.setPaused(true);
          const flag = window.__gpPaused === true;
          GP.setPaused(false);
          return {flag, off: window.__gpPaused === false};
        })()""")
        check("pause/resume 冪等（SDK 與分頁切換共用同一個開關）",
              paused["flag"] is True and paused["off"] is True, str(paused))
        # 語言切換：設定頁按鈕會寫入偏好並重載
        en.click('#btnMenu')
        time.sleep(0.4)
        has_btns = en.evaluate("!!document.getElementById('btnLangZh') && !!document.getElementById('btnLangEn')")
        en.click('#btnLangZh')
        en.wait_for_load_state('load')
        en.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        time.sleep(0.6)
        zh_state = en.evaluate("""({lang: document.documentElement.lang,
          tab: document.querySelector('.nav-btn b').textContent,
          pref: localStorage.getItem('soulring.lang')})""")
        check("設定頁可切換中文：寫入偏好、重新載入後變中文",
              has_btns and zh_state["lang"] == "zh-Hant"
              and zh_state["tab"] == "戰鬥" and zh_state["pref"] == "zh", str(zh_state))

        en.click('#btnMenu')
        time.sleep(0.4)
        en.click('#btnLangEn')
        en.wait_for_load_state('load')
        en.wait_for_function('window.__game && window.__game.ready', timeout=30000)
        time.sleep(0.6)
        back = en.evaluate("""({lang: document.documentElement.lang,
          tab: document.querySelector('.nav-btn b').textContent,
          pref: localStorage.getItem('soulring.lang')})""")
        check("再切回 English：介面回到英文、偏好記為 en",
              back["lang"] == "en" and back["tab"] == "Battle"
              and back["pref"] == "en", str(back))

        check("英文模式沒有 console / page error", not en_errs, str(en_errs[:3]))
        en.screenshot(path=str(ART / "soulring-en.png"))
        en.close()

        check("整場沒有 console / page error", not errors, str(errors[:5]))
        browser.close()
    srv.shutdown()

    print()
    if FAILS:
        print(f"RESULT: FAIL ({len(FAILS)}: {', '.join(FAILS)})")
        return 1
    print("RESULT: PASS（自動戰鬥 / 多波群攻 / Boss 狂暴回血 / 自動 BOSS 與獵靈 / 升級節奏 / 靈環 / 靈骨 / 簽到 / 抽卡 / 兌換碼 / 存檔碼 / 離線收益 / 版面）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
