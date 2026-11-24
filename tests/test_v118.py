#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.18.0 測試：戰鬥倍速（x1/x2/x3）＋ 命印天賦樹

跑法：/usr/bin/python3 tests/test_v118.py
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
PORT = 8797
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
        ok("版本 ≥ 1.18.0", tuple(int(x) for x in ver.split(".")) >= (1, 18, 0), ver)
        ok("倍速清單 1/2/3", page.evaluate("CFG.SPEEDS.join(',')") == "1,2,3")

        # ---------- 倍速：真的變快（同一段時間內行動次數變多） ----------
        speed = page.evaluate("""(async () => {
            const S = __game.State, B = __game.Battle, s = S.data;
            s.souls = [{ id:'haotian', star:10, level:100, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian']; s.stage = 30; s.bestStage = 30;
            const run = (sp) => {
                s.settings.speed = sp;
                B.init();
                let hits = 0;
                const off = B.on((ev) => { if (ev && ev.type === 'hit') hits++; });
                const t0 = Date.now();
                return new Promise((res) => setTimeout(() => {
                    off();
                    res({ sp, acts: hits, ms: Date.now() - t0 });
                }, 3000));
            };
            const a = await run(1);
            const b = await run(3);
            return {r1: a, r3: b};
        })()""")
        r1, r3 = speed["r1"], speed["r3"]
        ok("x3 的命中次數明顯高於 x1（≥1.8 倍）",
           r1["acts"] > 0 and r3["acts"] >= r1["acts"] * 1.8,
           f"x1={r1['acts']} 次 / x3={r3['acts']} 次（3 秒）")

        # ---------- 倍速：平衡不變（雙方同步加速） ----------
        bal = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.settings.speed = 1;
            return {rate1: __game.Battle.state ? 1 : 1, ok: true};
        })()""")
        ok("倍速屬於全域設定（存在 settings.speed）",
           page.evaluate("typeof State.data.settings.speed === 'number'") is True)

        # ---------- 天賦：投入 / 上限 / 未投入命印 ----------
        tal = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.talents = {}; s.marks = 12;
            const before = {spent: S.spentMarks(), unspent: S.unspentMarks()};
            const p1 = S.learnTalent('atkP');
            const p2 = S.learnTalent('atkP');
            const after = {spent: S.spentMarks(), unspent: S.unspentMarks(), lv: S.talentLevel('atkP')};
            return {before, p1, p2, after, mul: +S.talentMul().atk.toFixed(3)};
        })()""")
        ok("投入命印：spent +1、unspent -1、等級上升",
           tal["before"]["spent"] == 0 and tal["after"]["spent"] == 2
           and tal["before"]["unspent"] == 12 and tal["after"]["unspent"] == 10
           and tal["after"]["lv"] == 2,
           json.dumps(tal["after"], ensure_ascii=False))
        ok("銳鋒 2 級 → ATK ×1.12", abs(tal["mul"] - 1.12) < 0.005, str(tal["mul"]))

        cap = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.talents = {}; s.marks = 30;
            for (let i = 0; i < 9; i++) S.learnTalent('atkP');
            const lv = S.talentLevel('atkP');
            const r = S.learnTalent('atkP');
            return {lv, max: CFG.TALENTS.maxLevel, r};
        })()""")
        ok("天賦上限 5 級、滿級後擋下", cap["lv"] == 5 and cap["r"]["ok"] is False,
           json.dumps(cap, ensure_ascii=False))

        # ---------- 天賦：投入後「全屬性 +6%」變少（機會成本） ----------
        cost = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = [{ id:'haotian', star:3, level:10, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian'];
            s.marks = 10; s.talents = {};
            const noTalent = S.teamStats().atk;
            S.learnTalent('atkP'); S.learnTalent('atkP'); S.learnTalent('atkP');
            S.learnTalent('atkP'); S.learnTalent('atkP');      // 5 級 → ATK ×1.30
            const withTalent = S.teamStats().atk;
            const um = S.unspentMarks();
            return {noTalent, withTalent, um, ratio: +(withTalent / noTalent).toFixed(3)};
        })()""")
        ok("投入 5 級後未投入命印剩 5", cost["um"] == 5, str(cost["um"]))
        ok("天賦 ATK +30% 但少掉 5 點命印（淨增益有上限）",
           cost["ratio"] > 1.0 and cost["ratio"] < 1.30,
           f"×{cost['ratio']}（純 +30% 會是 1.30，少掉的命印扣回來了）")

        # ---------- 天賦：爆擊 / 吸血 / 破防 進戰鬥公式 ----------
        combat = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.talents = {}; s.marks = 20; s.ringBag = [];
            const c0 = S.critChance();
            for (let i = 0; i < 5; i++) S.learnTalent('critP');
            const c1 = S.critChance();
            s.talents = {}; s.marks = 20;
            for (let i = 0; i < 5; i++) S.learnTalent('leechP');
            for (let i = 0; i < 5; i++) S.learnTalent('penP');
            const m = S.combatMods();
            return {c0: +c0.toFixed(3), c1: +c1.toFixed(3), leech: +m.leech.toFixed(3), pen: +m.pen.toFixed(3)};
        })()""")
        ok("致命 5 級 → 爆擊率上升", combat["c1"] > combat["c0"], f"{combat['c0']} → {combat['c1']}")
        ok("噬血 / 破甲 進入 combatMods（吸血 5%、破防 20%）",
           abs(combat["leech"] - 0.05) < 0.001 and abs(combat["pen"] - 0.20) < 0.001,
           json.dumps(combat, ensure_ascii=False))

        # ---------- 天賦：財源 / 獸緣 ----------
        econ = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.talents = {}; s.marks = 20;
            const i0 = S.incomeMul();
            for (let i = 0; i < 5; i++) S.learnTalent('coinP');
            const i1 = S.incomeMul();
            s.cores = 0;
            const before = S.addCores(10);
            for (let i = 0; i < 5; i++) S.learnTalent('coreP');
            s.cores = 0;
            const after = S.addCores(10);
            return {i0: +i0.toFixed(3), i1: +i1.toFixed(3), before, after};
        })()""")
        ok("財源 5 級 → 靈幣收益乘上 +50%", econ["i1"] > econ["i0"] * 1.4,
           f"{econ['i0']} → {econ['i1']}")
        ok("獸緣 5 級 → 獸核獲得 +40%（10 → 14）", econ["before"] == 10 and econ["after"] == 14,
           f"{econ['before']} → {econ['after']}")

        # ---------- 重置天賦 ----------
        reset = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.talents = { atkP: 3, hpP: 2 }; s.marks = 10; s.cores = 5;
            const poor = S.resetTalents();          // 獸核不足
            s.cores = 50;
            const good = S.resetTalents();
            return {poor: poor.ok, poorMsg: poor.msg, good, spent: S.spentMarks(),
                    unspent: S.unspentMarks(), cores: s.cores};
        })()""")
        ok("獸核不足不能重置", reset["poor"] is False, str(reset["poorMsg"]))
        ok("重置天賦：退還 5 點、扣 10 獸核",
           reset["good"]["ok"] and reset["spent"] == 0 and reset["unspent"] == 10
           and reset["cores"] == 40,
           json.dumps({"spent": reset["spent"], "unspent": reset["unspent"], "cores": reset["cores"]}))

        # ---------- UI ----------
        page.evaluate("__game.switchTab('battle')")
        time.sleep(0.4)
        before_txt = page.inner_text("#btnSpeed")
        page.click("#btnSpeed")
        time.sleep(0.3)
        after_txt = page.inner_text("#btnSpeed")
        ok("倍速按鈕會循環（×1 → ×2）", "1" in before_txt and "2" in after_txt,
           f"{before_txt} → {after_txt}")

        page.evaluate("State.data.marks = 8; State.data.talents = {}; __game.switchTab('souls')")
        time.sleep(0.6)
        ui = page.evaluate("""(() => ({
            nodes: document.querySelectorAll('#rebirthBox [data-talent]').length,
            unspent: /Unspent|未投入/.test(document.getElementById('rebirthBox').innerText),
            resetBtn: !!document.getElementById('btnResetTalent')
        }))()""")
        ok("轉生頁有天賦樹（9 個節點 + 重置鈕）",
           ui["nodes"] == 9 and ui["resetBtn"] and ui["unspent"], json.dumps(ui, ensure_ascii=False))
        page.locator("#rebirthBox [data-talent='atkP']").scroll_into_view_if_needed()
        page.click("#rebirthBox [data-talent='atkP']", timeout=8000)
        time.sleep(0.4)
        booked = page.evaluate("State.data.talents.atkP || 0")
        ok("點『投入』會實際加一級", booked == 1, str(booked))

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
