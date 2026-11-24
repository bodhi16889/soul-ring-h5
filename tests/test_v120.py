#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.20.0 測試：離線經驗上限（等級上限 × 80%）

跑法：/usr/bin/python3 tests/test_v120.py
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
PORT = 8799
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
        ok("版本 ≥ 1.20.0", tuple(int(x) for x in ver.split(".")) >= (1, 20, 0), ver)

        cfg = page.evaluate("({max: CFG.levelCap(0), ratio: CFG.OFFLINE.levelCapRatio})")
        ok("設定：等級上限 100、離線比值 0.8 → 離線上限 Lv80",
           cfg["max"] == 100 and cfg["ratio"] == 0.8, json.dumps(cfg))

        # ---------- 長離線：會被 80% 上限擋住 ----------
        longrun = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 12; s.exp = 0; s.stage = 30; s.marks = 0;
            s.souls = [{ id:'haotian', star:3, level:12, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian'];
            s.lastSave = Date.now() - 3 * 3600 * 1000;
            const g = S.offlineGain(s);
            return {lvBefore: g.levelBefore, lvAfter: g.levelAfter, exp: g.exp, raw: g.rawExp,
                    capped: g.expCapped, capLv: g.expCapLv, coins: g.coins, levels: g.levels};
        })()""")
        ok("3 小時離線不會衝到滿級（停在 Lv80）",
           longrun["lvAfter"] == 80, json.dumps(longrun, ensure_ascii=False))
        ok("離線經驗被上限截斷（實給 < 原始）",
           longrun["capped"] is True and longrun["exp"] < longrun["raw"],
           f"{longrun['exp']} / raw {longrun['raw']}")
        ok("上限層級回報 Lv80", longrun["capLv"] == 80, str(longrun["capLv"]))
        ok("靈幣不受經驗上限影響（照給）", longrun["coins"] > 0, str(longrun["coins"]))

        # ---------- 短離線：不觸發上限 ----------
        short = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 12; s.exp = 0; s.stage = 3;
            s.lastSave = Date.now() - 2 * 60 * 1000;
            const g = S.offlineGain(s);
            return {capped: g.expCapped, exp: g.exp, raw: g.rawExp, lv: g.levelAfter};
        })()""")
        ok("短離線（2 分）不觸發上限、經驗等於原始",
           short["capped"] is False and short["exp"] == short["raw"],
           json.dumps(short, ensure_ascii=False))

        # ---------- 已在 80% 以上：完全不給經驗 ----------
        above = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 90; s.exp = 0; s.stage = 60;
            s.lastSave = Date.now() - 2 * 3600 * 1000;
            const g = S.offlineGain(s);
            return {exp: g.exp, capped: g.expCapped, lv: g.levelAfter, coins: g.coins};
        })()""")
        ok("Lv90 離線：經驗 0、但靈幣照給",
           above["exp"] == 0 and above["capped"] is True and above["coins"] > 0,
           json.dumps(above, ensure_ascii=False))

        # ---------- 邊界：剛好停在 80、不會多升 ----------
        edge = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 79; s.exp = 0; s.stage = 40;
            s.lastSave = Date.now() - 30 * 60 * 1000;
            const g = S.offlineGain(s);
            return {lv: g.levelAfter, capped: g.expCapped, exp: g.exp};
        })()""")
        ok("Lv79 出發不會超過 Lv80", edge["lv"] == 80, json.dumps(edge, ensure_ascii=False))

        # ---------- UI：明細要顯示上限 ----------
        page.evaluate("""(() => {
            const s = State.data;
            s.level = 12; s.exp = 0; s.stage = 30;
            s.lastSave = Date.now() - 3 * 3600 * 1000;
            State.offlineGain(s);
            __game.showOffline(State.data.pendingOffline);
        })()""")
        time.sleep(0.6)
        modal = page.evaluate("document.getElementById('modalBody').innerText.replace(/\\n/g,' | ')")
        ok("明細沒有重複的 Lv（等級標籤本身就是 Lv）", "Lv Lv" not in modal, modal[:80])
        ok("離線明細看得到「離線經驗上限 Lv 80」",
           "Lv 80" in modal and ("Offline EXP cap" in modal or "離線經驗上限" in modal), modal[:160])
        page.keyboard.press("Escape")
        time.sleep(0.3)

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
