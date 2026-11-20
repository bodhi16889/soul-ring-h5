#!/usr/bin/env python3
"""魂環覺醒 H5 — 端到端驗證（Playwright）。

驗的是「真的能玩」：自動戰鬥會掉血、升級、獵魂掉魂環、魂環提高等級上限、
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    ART.mkdir(exist_ok=True)
    srv = serve(ROOT, 8771)
    url = "http://127.0.0.1:8771/index.html"

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
        check("標題正確、初始 1 武魂上陣、1 級、上限 10", 
              base["title"] == "魂環覺醒：武魂放置錄" and base["souls"] == 1
              and base["team"] == 1 and base["level"] == 1 and base["cap"] == 10, str(base))
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
        check("擊殺會給魂幣與經驗", after["coins"] > before["coins"] and (after["exp"] > 0 or after["level"] > 1),
              f"coins {before['coins']}->{after['coins']}, exp={after['exp']}, lv={after['level']}")

        # ---------- 3. 升級 ----------
        lv = page.evaluate("""(() => {
          const s = __game.State.data;
          const r = __game.State.addExp(s, 4000);
          return {level: s.level, ups: r.levelUps, capped: r.capped};
        })()""")
        check("經驗足夠會升級，並在 10 級停下（需魂環突破）", lv["level"] == 10 and lv["capped"] is True,
              str(lv))

        # ---------- 4. 獵魂 → 魂環 ----------
        page.evaluate("__game.switchTab('hunt')")
        time.sleep(0.2)
        hunt_ok = page.evaluate("""(() => {
          const r = __game.Battle.hunt('baboon');
          return {ok: r.ok, msg: r.msg || '', mode: __game.Battle.state.mode};
        })()""")
        check("獵魂：可以進入十年魂獸（風狒狒）", hunt_ok["ok"] is True and hunt_ok["mode"] == "hunt", str(hunt_ok))

        # 打快一點：把武魂攻擊拉高，避免測試等太久
        page.evaluate("__game.Battle.state.units.forEach(u => { u.atk = 400; u.spd = 200; })")
        got_ring = False
        try:
            page.wait_for_function("__game.State.data.ringBag.length > 0", timeout=25_000)
            got_ring = True
        except Exception:
            got_ring = False
        ring = page.evaluate("({bag: __game.State.data.ringBag, mode: __game.Battle.state.mode, cd: __game.State.data.cd})")
        check("擊敗魂獸會掉落魂環、並回到掛機", got_ring and ring["mode"] == "farm" and len(ring["bag"]) >= 1,
              str(ring))

        # ---------- 5. 裝備魂環 → 上限提升 ----------
        equip = page.evaluate("""(() => {
          const s = __game.State.data;
          const uid = s.ringBag[0].uid;
          const before = __game.State.levelCap();
          const r = __game.State.equipRing(s.souls[0].id, uid);
          return {ok: r.ok, msg: r.msg || '', before, after: __game.State.levelCap(),
                  equipped: s.souls[0].rings.length};
        })()""")
        check("裝備魂環後等級上限 +10", equip["ok"] is True and equip["after"] == equip["before"] + 10
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
        check("多波：高等關卡會出 1–3 隻魂獸",
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
        check("群攻（強攻系魂技）會同時打到 3 隻", aoe["hits"] == 3, str(aoe))

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
          e.acts = 3; e.hp = 500;              // 下一次是第 4 次行動 → 回血
          const hpBefore = e.hp;
          __game.Battle.bossAct(e);
          return {atk0, atk1, enraged, hpBefore, hpAfter: e.hp, acts: e.acts};
        })()""")
        check("Boss 半血狂暴：攻擊 +35%",
              boss["enraged"] is True and boss["atk1"] == round(boss["atk0"] * 1.35), str(boss))
        check("Boss 每 4 次行動回血 10%",
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
        check("覺醒抽卡：扣券並產出武魂或魂骨",
              pull["ok"] is True and pull["after"]["tickets"] == pull["before"]["tickets"] - 1
              and pull["result"]["kind"] in ("new", "star", "dup", "bone"), str(pull))

        # ---------- 7b. 魂骨：真實加成與升星 ----------
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
        check("魂骨可裝備，並真的提升武魂攻擊（巨力 +14%）",
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
        check("魂骨光環：同隊其他武魂吃到 30% 加成（18% × 30% ≈ +5.4% 生命）",
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
        check("武魂升星：吃掉 1 塊魂骨＋1200 魂幣，星級與屬性提升",
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
        check("舊存檔（魂骨存字串）會自動遷移成 {uid,id}", mig["ok"] and len(mig["bones"]) == 2, str(mig))

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
        check("第 7 天給大獎（萬年魂環＋券 3＋鑽石 888）",
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
        check("離線 2 小時會結算魂幣與經驗", bool(off["g"]) and off["g"]["minutes"] >= 110
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
        check("重新載入後進度保留", kept["coins"] == 777777 and kept["souls"] >= 1, str(kept))

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

        check("整場沒有 console / page error", not errors, str(errors[:5]))
        browser.close()
    srv.shutdown()

    print()
    if FAILS:
        print(f"RESULT: FAIL ({len(FAILS)}: {', '.join(FAILS)})")
        return 1
    print("RESULT: PASS（自動戰鬥 / 多波群攻 / Boss 狂暴回血 / 升級 / 獵魂掉環 / 魂環上限 / 魂骨 / 簽到 / 抽卡 / 兌換碼 / 存檔碼 / 離線收益 / 版面）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
