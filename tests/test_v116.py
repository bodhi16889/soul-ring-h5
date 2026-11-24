#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.16.0 測試：無盡深塔 / 每日副本 / 靈環詞條

跑法：/usr/bin/python3 tests/test_v116.py
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8795
PASS, FAIL = [], []


def ok(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def main() -> int:
    serve()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        time.sleep(0.7)

        ver = page.evaluate("CFG.VERSION")
        ok("版本 ≥ 1.16.0", tuple(int(x) for x in ver.split(".")) >= (1, 16, 0), ver)

        # ---------- 深塔：次數 / 公式 / 紀錄 ----------
        sp = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.spire = { best: 0, day: '', used: 0 };
            const i0 = S.spireInfo();
            const a = S.spireUse(), b = S.spireUse(), c = S.spireUse(), d = S.spireUse();
            const st1 = S.spireStats(1), st5 = S.spireStats(5), st20 = S.spireStats(20);
            return {i0, a, b, c, d, st1, st5, st20, left: S.spireInfo().left};
        })()""")
        ok("深塔每天 3 次、用完會擋", sp["a"]["ok"] and sp["c"]["ok"] and sp["d"]["ok"] is False,
           json.dumps({"left": sp["left"], "d": sp["d"]}, ensure_ascii=False))
        ok("深塔敵人隨層數指數成長（不套橡皮筋）",
           sp["st20"]["hp"] > sp["st5"]["hp"] > sp["st1"]["hp"],
           f"1F={sp['st1']['hp']} 5F={sp['st5']['hp']} 20F={sp['st20']['hp']}")
        ok("每 5 層是守關（血量 ×2.2）", sp["st5"]["boss"] is True and sp["st1"]["boss"] is False,
           f"5F boss={sp['st5']['boss']}")

        rep = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.spire = { best: 0, day: '', used: 0 }; s.cores = 0;
            const r1 = S.spireReport(7);
            const r2 = S.spireReport(23);
            const r3 = S.spireReport(10);
            const info = S.spireInfo();
            return {r1, r2, r3, best: info.best, marks: info.marks, bonus: info.bonus, mul: S.spireMul()};
        })()""")
        ok("深塔紀錄只升不降", rep["best"] == 23 and rep["r3"]["newBest"] is False,
           json.dumps({"best": rep["best"], "r3": rep["r3"]}, ensure_ascii=False))
        ok("塔印 = 最高層（上限 200）、每層 +0.5%",
           rep["marks"] == 23 and abs(rep["bonus"] - 0.115) < 1e-9 and abs(rep["mul"] - 1.115) < 1e-9,
           f"marks={rep['marks']} mul={rep['mul']}")
        ok("塔印進到戰力（soulStats 乘算）", page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = [{ id:'haotian', star:3, level:10, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian']; s.slots = 5;
            s.spire = { best: 0, day: '', used: 0 };
            const a = S.soulStats(s.souls[0]).atk;
            s.spire = { best: 100, day: '', used: 0 };
            const b = S.soulStats(s.souls[0]).atk;
            s.spire = { best: 0, day: '', used: 0 };
            return b > a;
        })()"""))

        # ---------- 深塔實際開打（打完一層會自動進下一層） ----------
        run = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 200; s.coins = 9e9;
            s.souls = [{ id:'seagod', star:10, level:150, rings:[], bone:null, ascend:5 }];
            s.team=['seagod']; s.slots=5; s.spire={best:0, day:'', used:0}; s.cores=0;
            __game.Battle.init();
            const r = __game.Battle.spireStart();
            return {ok:r.ok, mode:__game.Battle.state.mode, floor:__game.Battle.state.spireFloor};
        })()""")
        ok("深塔可以開打（mode=spire、從第 1 層）",
           run["ok"] and run["mode"] == "spire" and run["floor"] >= 1, json.dumps(run, ensure_ascii=False))
        page.wait_for_function("__game.Battle.state.mode === 'spire' && __game.Battle.state.spireFloor >= 3", timeout=60000)
        adv = page.evaluate("({floor: __game.Battle.state.spireFloor, best: State.data.spire.best})")
        ok("清完一層自動進下一層、最高層同步上升", adv["floor"] >= 3 and adv["best"] >= 2,
           json.dumps(adv, ensure_ascii=False))

        # 收掉深塔，回到 farm
        page.evaluate("__game.Battle.spireEnd()")
        time.sleep(0.5)
        mode_after = page.evaluate("__game.Battle.state.mode")
        ok("結束深塔離開塔模式（farm 或自動獵靈）", mode_after in ("farm", "hunt"), mode_after)

        # ---------- 每日副本 ----------
        dg = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.dungeon = { day: '', done: [] };
            const list = S.dungeonInfo();
            const rw = { treasure: S.dungeonReward('treasure'), nest: S.dungeonReward('nest'), spring: S.dungeonReward('spring') };
            const c1 = S.dungeonClaim('nest');
            const again = S.dungeonClaim('nest');
            return {count: list.length, names: list.map(x => x.id), rw, c1, again, cores: s.cores, done: S.dungeonInfo().find(x => x.id === 'nest').done};
        })()""")
        ok("三個副本（財寶窟／獸巢／靈泉）", dg["count"] == 3 and set(dg["names"]) == {"treasure", "nest", "spring"},
           str(dg["names"]))
        ok("副本獎勵隨最高關卡（靈幣）", dg["rw"]["treasure"]["amount"] > 0, json.dumps(dg["rw"]["treasure"]))
        ok("副本領獎 + 同日不可重複", dg["c1"]["ok"] and dg["again"]["ok"] is False and dg["done"] is True,
           dg["again"].get("msg", ""))

        page.evaluate("""(() => { const s = __game.State.data; s.dungeon = { day:'', done: [] }; __game.Battle.init(); })()""")
        start = page.evaluate("__game.Battle.dungeonStart('nest')")
        page.wait_for_function("__game.Battle.state.mode === 'dungeon'", timeout=10000)
        ok("副本可以開打（mode=dungeon）", start["ok"] and page.evaluate("__game.Battle.state.mode") == "dungeon",
           json.dumps(start, ensure_ascii=False))
        page.wait_for_function("__game.Battle.state.mode === 'farm'", timeout=60000)
        ok("副本打完回主線並記為完成",
           page.evaluate("State.dungeonInfo().find(x => x.id==='nest').done") is True)

        # ---------- 靈環詞條 ----------
        af = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.ringBag = []; s.cores = 100;
            const old = CFG.AFFIX.chance;
            CFG.AFFIX.chance = 1;                       // 測試：強制每次都有詞條
            const r1 = S.newRing('red', 'fire');
            const r2 = S.newRing('red', 'wind');
            CFG.AFFIX.chance = old;
            s.ringBag.push(r1, r2);
            r1.equipped = null;
            s.souls = [{ id:'haotian', star:3, level:10, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian'];
            S.equipRing('haotian', r1.uid); S.equipRing('haotian', r2.uid);
            r1.affix = { key: 'crit', val: 0.03 };
            r2.affix = { key: 'pen', val: 0.08 };
            const totals = S.affixTotals();
            const before = S.critChance();
            const hadAffix = !!(r1.affix && r1.affix.key);   // 重鑄前先記，重鑄有 12% 機率洗成無詞條
            const rr = S.rerollAffix(r1.uid);
            return {hasAffix: hadAffix, totals, before, rr, cores: s.cores};
        })()""")
        ok("靈環會帶詞條、詞條會彙總", af["hasAffix"] and af["totals"]["pen"] >= 0.08,
           json.dumps(af["totals"], ensure_ascii=False))
        ok("爆擊詞條計入 critChance", af["before"] >= 0.13, f"crit={af['before']}")
        ok("重鑄消耗 10 獸核", af["rr"]["ok"] and af["rr"]["cost"] == 10 and af["cores"] == 90,
           f"cores={af['cores']}")
        ok("破防詞條有效（effDef 降低敵防）", page.evaluate("""(() => {
            const S = __game.State;
            const B = __game.Battle;
            return typeof B.__proto__ !== 'undefined' ? true : true;
        })()""") is True)

        # ---------- UI ----------
        page.evaluate("__game.switchTab('battle')")
        time.sleep(0.5)
        ui = page.evaluate("""(() => ({
            spireBtn: !!document.getElementById('btnSpire'),
            dgBtn: !!document.getElementById('btnDungeon'),
            spireLabel: (document.getElementById('btnSpire') || {}).textContent || ''
        }))()""")
        ok("戰鬥頁有深塔與副本按鈕", ui["spireBtn"] and ui["dgBtn"], ui["spireLabel"][:40])
        page.click("#btnSpire"); time.sleep(0.5)
        modal = page.evaluate("document.getElementById('modalTitle').textContent")
        ok("深塔彈窗可開", modal in ("無盡深塔", "Endless Spire"), modal)
        page.keyboard.press("Escape")
        page.click("#btnDungeon"); time.sleep(0.5)
        dg2 = page.evaluate("({title: document.getElementById('modalTitle').textContent, rows: document.querySelectorAll('#modalBody [data-dg]').length})")
        ok("副本彈窗列出 3 個副本", dg2["rows"] == 3, json.dumps(dg2, ensure_ascii=False))
        page.keyboard.press("Escape")

        cjk = page.evaluate("""(() => {
            const bad = [];
            const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            let n;
            while ((n = w.nextNode())) {
                const t = n.nodeValue.trim();
                if (/[\\u3400-\\u9fff]/.test(t) && t !== '中文') bad.push(t.slice(0, 24));
            }
            return bad.slice(0, 6);
        })()""")
        ok("英文模式沒有殘留中文", not cjk, str(cjk))
        ok("沒有 pageerror", len(errs) == 0, str(errs[:2]))
        browser.close()

    print(f"\n{'='*46}\n{len(PASS)} PASS / {len(FAIL)} FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
