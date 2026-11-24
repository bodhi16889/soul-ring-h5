#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.17.0 測試：商店 / 套裝羈絆 / 成就 40 / QoL（自動升星、抽到里程）

跑法：/usr/bin/python3 tests/test_v117.py
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
PORT = 8796
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
        ok("版本 ≥ 1.17.0", tuple(int(x) for x in ver.split(".")) >= (1, 17, 0), ver)

        # ---------- 成就 40 ----------
        ach = page.evaluate("""(() => {
            const A = CFG.ACHIEVEMENTS;
            const ids = A.map(a => a.id);
            const missingTest = A.filter(a => typeof a.test !== 'function').map(a => a.id);
            const s = { bestStage: 0, souls: [], team: [], bones: [], ringBag: [], relics: [],
                        cores: 0, ticketPulls: 0, coins: 0, tickets: 0, marks: 0, rebirths: 0,
                        codex: {}, spire: {}, stats: {} };
            const falseAtStart = A.filter(a => a.test(s)).map(a => a.id);
            return {count: A.length, dup: ids.length - new Set(ids).size, missingTest, falseAtStart};
        })()""")
        ok("成就 40 項、id 不重複、每項都有測試函式",
           ach["count"] == 40 and ach["dup"] == 0 and ach["missingTest"] == [],
           json.dumps({k: ach[k] for k in ("count", "dup")}, ensure_ascii=False))
        ok("全新狀態不會誤解鎖任何成就", ach["falseAtStart"] == [], str(ach["falseAtStart"]))

        prog = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.ach = { unlocked: {} };
            s.bestStage = 800; s.rebirths = 200; s.marks = 500;
            s.souls = [{ id:'haotian', star:10, level:100, rings:[], ascend:5 }];
            s.team = ['haotian'];
            s.relics = CFG.RELICS.map(r => r.id); s.cores = 120; s.ticketPulls = 100;
            s.coins = 1000000; s.tickets = 25;
            s.codex = { souls:{a:1,b:1,c:1,d:1}, bones:{a:1}, rings:{a:1}, beasts:{a:1} };
            s.spire = { best: 100, day: '', used: 0 };
            s.stats = { kills: 100000, hunts: 100, pulls: 100, inherits: 5, weeklyClaims: 9, dungeons: 10 };
            s.ringBag = [{ uid:'r1', tier:'red', element:'fire', affix:{key:'crit',val:0.03} }];
            const got = S.checkAchievements().length;
            return {got, count: S.achCount(), mul: +S.achMul().toFixed(3)};
        })()""")
        ok("達標後大量成就解鎖（≥ 25 項）", prog["got"] >= 25 and prog["count"] >= 25,
           json.dumps(prog, ensure_ascii=False))
        ok("成就加成是乘算（每項 +0.5%）",
           abs(prog["mul"] - (1 + 0.005 * prog["count"])) < 0.002, f"mul={prog['mul']}")

        # ---------- 商店 ----------
        shop = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.shop = { day: '', bought: {} }; s.cores = 200; s.diamonds = 1000; s.coins = 100000;
            s.tickets = 0; s.rerolls = 0;
            const list = S.shopInfo();
            const beforeCores = s.cores;
            const b1 = S.shopBuy('ticket2');
            const afterCores = s.cores, tickets = s.tickets;
            const b2 = S.shopBuy('ticket2');      // 第二次（庫存 2）
            const b3 = S.shopBuy('ticket2');      // 第三次 → 售完
            const rr = S.shopBuy('reroll2');
            return {n: list.length, b1, afterCores, beforeCores, tickets, b2ok: b2.ok, b3: b3.msg,
                    rerolls: s.rerolls, rrOk: rr.ok};
        })()""")
        ok("商店 6 格、可買、扣對貨幣",
           shop["n"] == 6 and shop["b1"]["ok"] and shop["tickets"] == 2
           and shop["beforeCores"] - shop["afterCores"] == 24,
           json.dumps({"n": shop["n"], "tickets": shop["tickets"]}, ensure_ascii=False))
        ok("庫存用完擋下（第二件成功、第三件售完）",
           shop["b2ok"] is True and shop["b3"] in ("今日已售完", "Sold out today"), str(shop["b3"]))
        ok("重鑄券可以買", shop["rrOk"] and shop["rerolls"] == 2, f"rerolls={shop['rerolls']}")

        reroll = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.ringBag = [{ uid:'x1', tier:'red', element:'fire', equipped:null, affix:null }];
            s.rerolls = 1; s.cores = 0;
            const r = S.rerollAffix('x1');
            return {r, rerolls: s.rerolls, cores: s.cores};
        })()""")
        ok("重鑄優先消耗重鑄券（不扣獸核）",
           reroll["r"]["ok"] and reroll["r"]["usedTicket"] is True and reroll["cores"] == 0,
           json.dumps(reroll["r"], ensure_ascii=False))

        # ---------- 套裝羈絆 ----------
        setb = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = CFG.SOULS.map(x => ({ id:x.id, star:3, level:10, rings:[], bone:null, ascend:0 }));
            s.slots = 5;
            s.team = ['fox', 'phoenix', 'bluemoss'];      // 風火木
            const mixed = S.setInfo();
            s.team = ['fox', 'nether', 'thunder'];        // 三隻風
            const tri = S.setInfo();
            const windSoul = s.souls.find(x => x.id === 'fox');
            const withSet = S.soulStats(windSoul).spd;
            s.team = ['fox'];
            const noSet = S.soulStats(windSoul).spd;
            return {mixedActive: mixed.active, triActive: tri.active, withSet, noSet};
        })()""")
        ok("三隻不同元素不觸發套裝", setb["mixedActive"] == [], str(setb["mixedActive"]))
        ok("三隻同元素觸發套裝（風 → SPD）", setb["triActive"] == ["wind"], str(setb["triActive"]))
        ok("套裝讓該元素武魂速度上升", setb["withSet"] > setb["noSet"],
           f"{setb['noSet']} → {setb['withSet']}")

        # ---------- QoL：自動升星 ----------
        auto = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.settings.autoStar = true;
            s.souls = [{ id:'haotian', star:3, level:10, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian'];
            s.coins = 100000;
            s.bones = [];
            for (let i = 0; i < 10; i++) s.bones.push({ uid:'b'+i, id:'giant' });
            const r1 = S.autoStarUp();
            const star1 = s.souls[0].star;
            s.settings.autoStar = false;
            const r2 = S.autoStarUp();
            s.settings.autoStar = true;
            return {ok1: !!r1, star1, off: r2 === null};
        })()""")
        ok("自動升星會升一顆星", auto["ok1"] and auto["star1"] == 4, json.dumps(auto, ensure_ascii=False))
        ok("關掉自動升星就不動作", auto["off"] is True, str(auto["off"]))

        # ---------- 一鍵抽到里程 ----------
        pu = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.tickets = 9; s.diamonds = 0; s.ticketPulls = 3; s.milestoneAt = 0;
            s.relics = []; s.freeTenUsed = true;
            const need = CFG.RELIC.every - (s.ticketPulls % CFG.RELIC.every);
            return {need, tickets: s.tickets};
        })()""")
        page.evaluate("__game.switchTab('gacha')")
        time.sleep(0.5)
        page.click("#btnPullUntil")
        time.sleep(1.2)
        after = page.evaluate("({pulls: State.data.ticketPulls, relics: State.data.relics.length, tickets: State.data.tickets})")
        ok("一鍵抽到里程：補 7 抽、發 1 件靈寶",
           after["pulls"] == 10 and after["relics"] == 1 and after["tickets"] == 2,
           json.dumps(after, ensure_ascii=False))

        # ---------- UI ----------
        page.evaluate("__game.switchTab('gacha')")
        time.sleep(0.5)
        ui = page.evaluate("""(() => ({
            shop: !!document.getElementById('shopBox'),
            rows: document.querySelectorAll('#shopBox [data-shop]').length,
            pullBtn: !!document.getElementById('btnPullUntil')
        }))()""")
        ok("覺醒頁有商店（6 列）與一鍵抽里程按鈕", ui["shop"] and ui["rows"] == 6 and ui["pullBtn"],
           json.dumps(ui, ensure_ascii=False))

        cjk = page.evaluate("""(() => {
            const bad = [];
            const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            let n;
            while ((n = w.nextNode())) {
                const t = n.nodeValue.trim();
                if (/[\\u3400-\\u9fff]/.test(t) && t !== '中文') bad.push(t.slice(0, 24));
            }
            return bad.slice(0, 8);
        })()""")
        ok("英文模式沒有殘留中文", not cjk, str(cjk))
        ok("沒有 pageerror", len(errs) == 0, str(errs[:2]))
        browser.close()

    print(f"\n{'='*46}\n{len(PASS)} PASS / {len(FAIL)} FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
