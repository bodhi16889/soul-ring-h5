#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.21.0 測試：印記（無上限成長）、天賦上限隨轉生、世代標示

跑法：/usr/bin/python3 tests/test_v121.py
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
PORT = 8801
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

        import json as _json
        with open(os.path.join(ROOT, "version.json"), encoding="utf-8") as fh:
            expected = _json.load(fh)["version"]
        ok(f"版本與 version.json 一致（{expected}）",
           page.evaluate("CFG.VERSION") == expected, page.evaluate("CFG.VERSION"))

        # ---------- 印記：由既有計數推導、無上限 ----------
        sig = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            const out = {};
            s.bestStage = 0; s.ticketPulls = 0;   out.zero = S.sigilInfo();
            s.bestStage = 250;                     out.stage250 = S.sigilInfo();
            s.bestStage = 10000;                   out.stage10000 = S.sigilInfo();
            s.ticketPulls = 120;                   out.pull120 = S.sigilInfo();   // 剛收齊 12 件
            s.ticketPulls = 150;                   out.pull150 = S.sigilInfo();   // 多 3 次里程
            s.ticketPulls = 5000;                  out.pull5000 = S.sigilInfo();
            return out;
        })()""")
        ok("沒有戰績就沒有印記", sig["zero"]["stage"] == 0 and sig["zero"]["awaken"] == 0,
           json.dumps(sig["zero"], ensure_ascii=False))
        ok("每 10 關 +1 枚戰績印記（250 關 → 25 枚、+5.0%）",
           sig["stage250"]["stage"] == 25 and abs(sig["stage250"]["stagePct"] - 0.05) < 1e-9,
           json.dumps(sig["stage250"], ensure_ascii=False))
        ok("戰績印記沒有上限（10000 關 → 1000 枚）",
           sig["stage10000"]["stage"] == 1000, str(sig["stage10000"]["stage"]))
        ok("靈寶收齊（120 抽）時覺醒印記仍是 0",
           sig["pull120"]["awaken"] == 0, str(sig["pull120"]["awaken"]))
        ok("收齊後每多一次里程 +1 枚（150 抽 → 3 枚、+0.9%）",
           sig["pull150"]["awaken"] == 3 and abs(sig["pull150"]["awakenPct"] - 0.009) < 1e-9,
           json.dumps(sig["pull150"], ensure_ascii=False))
        ok("覺醒印記沒有上限（5000 抽 → 488 枚）",
           sig["pull5000"]["awaken"] == 488, str(sig["pull5000"]["awaken"]))

        # ---------- 印記真的進戰力（乘算層） ----------
        power = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = [{ id:'haotian', star:3, level:10, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian'];
            s.bestStage = 0; s.ticketPulls = 0; s.ach = { unlocked: {} };
            const p0 = S.teamStats().atk;
            s.bestStage = 500;                    // +50 枚 → +10%
            const sigMul = S.sigilInfo().mul;
            const p1 = S.teamStats().atk;
            s.ticketPulls = 220;                  // 10 枚覺醒 → +3%
            const p2 = S.teamStats().atk;
            return {p0, p1, p2, sigMul: +sigMul.toFixed(4), ach: S.achCount(),
                    r1: +(p1 / p0).toFixed(4), r2: +(p2 / p1).toFixed(4)};
        })()""")
        # 註：升到 500 關會同時解鎖關卡類成就（每項 +0.5%），所以實際倍率會略高於印記層
        ok("戰績印記確實進戰力（印記層 ×1.10，含同期解鎖的成就略高）",
           power["r1"] >= power["sigMul"] and power["r1"] <= power["sigMul"] * 1.06,
           f"印記 ×{power['sigMul']} → 實測 ×{power['r1']}（成就 {power['ach']} 項）")
        ok("覺醒印記是另一層乘算（10 枚 ≈ ×1.03）",
           1.02 <= power["r2"] <= 1.04, f"×{power['r2']}")

        # ---------- 天賦上限隨轉生 ----------
        caps = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            const out = {};
            s.rebirths = 0;  out.r0 = S.talentMaxLevel();
            s.rebirths = 1;  out.r1 = S.talentMaxLevel();
            s.rebirths = 2;  out.r2 = S.talentMaxLevel();
            s.rebirths = 20; out.r20 = S.talentMaxLevel();
            s.rebirths = 5000; out.r5000 = S.talentMaxLevel();
            return out;
        })()""")
        ok("0 次轉生 → 天賦上限 5 級", caps["r0"] == 5, str(caps["r0"]))
        ok("每 2 次轉生 +1 級（2 次 → 6、20 次 → 15）",
           caps["r2"] == 6 and caps["r20"] == 15, json.dumps(caps, ensure_ascii=False))
        ok("上限有防溢位硬蓋（5000 次 → 99）", caps["r5000"] == 99, str(caps["r5000"]))

        learn = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.talents = {}; s.marks = 30; s.rebirths = 0;
            for (let i = 0; i < 9; i++) S.learnTalent('atkP');
            const at5 = S.talentLevel('atkP');
            const blocked = S.learnTalent('atkP');
            s.rebirths = 2;                       // 上限變 6
            const after = S.learnTalent('atkP');
            return {at5, blockedOk: blocked.ok, afterOk: after.ok, lv: S.talentLevel('atkP')};
        })()""")
        ok("沒轉生時天賦卡在 5 級", learn["at5"] == 5 and learn["blockedOk"] is False,
           json.dumps(learn, ensure_ascii=False))
        ok("轉生 2 次後可再點到 6 級（轉生解鎖更多升級）",
           learn["afterOk"] is True and learn["lv"] == 6, str(learn["lv"]))

        # ---------- UI：世代標示 + 印記區塊 ----------
        page.evaluate("""(() => {
            const s = State.data;
            s.rebirths = 11; s.bestStage = 640; s.ticketPulls = 260; s.marks = 20;
            s.talents = {}; __game.switchTab('souls');
        })()""")
        time.sleep(0.8)
        ui = page.evaluate("""(() => {
            const box = document.getElementById('rebirthBox');
            const t = box.innerText;
            return {
                gen: /Gen 12/.test(t),
                rebirths: /11 rebirths/.test(t),
                cap: /Talent node cap/.test(t),
                sigils: /Sigils/.test(t),
                stageSigil: /Stage sigils/.test(t),
                awakenSigil: /Awaken sigils/.test(t),
                badge: !!box.querySelector('.rb-gen'),
                badgeText: (box.querySelector('.rb-gen') || {}).textContent,
            };
        })()""")
        ok("轉生頁顯示「第 N 代」（Gen 12）", ui["gen"] and ui["badge"] and ui["badgeText"] == "Gen 12",
           json.dumps({k: ui[k] for k in ("gen", "badgeText")}, ensure_ascii=False))
        ok("轉生頁顯示累積轉生次數", ui["rebirths"] is True)
        ok("轉生頁顯示天賦節點上限", ui["cap"] is True)
        ok("轉生頁有印記區塊（戰績／覺醒）",
           ui["sigils"] and ui["stageSigil"] and ui["awakenSigil"], json.dumps(ui, ensure_ascii=False))

        # setLang 會 location.replace()（真的換頁），所以不能在同一個 evaluate 裡來回切
        page.evaluate("I18N.setLang('zh')")
        page.wait_for_load_state("load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        time.sleep(0.8)
        page.evaluate("(() => { const s = State.data; s.rebirths = 11; s.bestStage = 640; "
                      "s.ticketPulls = 260; s.marks = 20; s.talents = {}; __game.switchTab('souls'); })()")
        time.sleep(0.7)
        zh = page.evaluate("""(() => ({
            gen: (document.querySelector('.rb-gen') || {}).textContent,
            hasZh: /第 12 代/.test(document.getElementById('rebirthBox').innerText)
        }))()""")
        ok("中文模式顯示「第 12 代」", zh["gen"] == "第 12 代" and zh["hasZh"] is True,
           json.dumps(zh, ensure_ascii=False))

        page.evaluate("I18N.setLang('en')")
        page.wait_for_load_state("load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        time.sleep(0.8)
        page.evaluate("__game.switchTab('souls')")
        time.sleep(0.6)

        time.sleep(0.4)
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
