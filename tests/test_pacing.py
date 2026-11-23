#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.10.0 回歸測試：新手節奏（①②③）＋ PWA（④）

跑法：/usr/bin/python3 tests/test_pacing.py
需要：playwright（既有 smoke.py 已用同一套）
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
PORT = 8788

PASS, FAIL = [], []


def ok(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> int:
    serve()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        time.sleep(1.0)

        # ---- ① 每關小怪數 ----
        k = page.evaluate("""(() => [1,5,6,10,11,30].map(s => CFG.killsPerStage(s)))()""")
        ok("① killsPerStage 前 5 關 4 隻 / 6–10 關 6 隻 / 之後 8 隻",
           k == [4, 4, 6, 6, 8, 8], str(k))

        # ---- ② 每波秒數 ----
        w = page.evaluate("""(() => [1,10,11,25,26].map(s => CFG.waveSecFor(s)))()""")
        ok("② waveSecFor 前 10 關 1.5 / 25 關前 2.0 / 之後 2.5",
           w == [1.5, 1.5, 2.0, 2.0, 2.5], str(w))

        # ---- ③ 靈印升級成本 ----
        c = page.evaluate("""(() => [1,5,10,11,20].map(l => CFG.soulLevelCost(l)))()""")
        ok("③ 靈印成本 1 級 150、10 級 420、11 級起 15×Lv^1.9 且單調遞增",
           c[0] == 150 and c[2] == 420 and c[3] == 1428 and c == sorted(c), str(c))

        # ---- 戰鬥進度條吃新的擊殺數 ----
        need = page.evaluate("Battle.snapshot().needed")
        ok("① 關卡進度需求在第 1 關是 4", need == 4, str(need))

        # ---- ④ 免費十連（要先切到覺醒頁）----
        page.evaluate("__game.switchTab('gacha')")
        time.sleep(0.3)
        btn = page.evaluate("document.getElementById('btnPull10').textContent")
        ok("④ 十連按鈕顯示免費（未使用時）", "First 10-pull" in btn, btn)
        before = page.evaluate("({souls: State.data.souls.length, bones: State.data.bones.length})")
        page.click("#btnPull10")
        time.sleep(0.6)
        after = page.evaluate("({souls: State.data.souls.length, bones: State.data.bones.length,"
                              " used: State.data.freeTenUsed, pulls: State.data.stats.pulls})")
        gained = (after["souls"] - before["souls"]) + (after["bones"] - before["bones"])
        ok("④ 免費十連送出 10 抽", after["pulls"] >= 10 and gained >= 0, f"pulls={after['pulls']}")
        ok("④ 免費十連標記已使用", after["used"] is True, str(after["used"]))
        again = page.evaluate("State.pullTenFree()")
        ok("④ 免費十連不能重複領", again["ok"] is False, again.get("msg", ""))
        btn2 = page.evaluate("document.getElementById('btnPull10').textContent")
        ok("④ 用過之後按鈕恢復成券／鑽價格", "Pull ×10" in btn2, btn2)
        ok("免費十連不扣券（3 → 3）", page.evaluate("State.data.tickets") == 3,
           str(page.evaluate("State.data.tickets")))

        # ---- ④ PWA ----
        man = page.evaluate("""async () => {
          const r = await fetch('manifest.webmanifest');
          const j = await r.json();
          return {status: r.status, name: j.name, icons: (j.icons||[]).length,
                  display: j.display, maskable: (j.icons||[]).some(i => i.purpose === 'maskable')};
        }""")
        ok("④ manifest 可讀（3 個圖示、standalone、含 maskable）",
           man["status"] == 200 and man["icons"] == 3 and man["display"] == "standalone"
           and man["maskable"], json.dumps(man, ensure_ascii=False))
        sw = page.evaluate("""async () => {
          const r = await fetch('sw.js');
          const t = await r.text();
          return {status: r.status, bytes: t.length, hasCache: t.includes('soulring-')};
        }""")
        ok("④ sw.js 可讀且含快取版本", sw["status"] == 200 and sw["hasCache"], json.dumps(sw))
        regs = page.evaluate("""async () => {
          const rs = await navigator.serviceWorker.getRegistrations();
          return rs.map(r => r.active ? r.active.scriptURL.split('/').pop() : (r.installing ? 'installing' : 'waiting'));
        }""")
        ok("④ localhost 上 SW 註冊成功", any("sw.js" in r or r in ("installing", "waiting") for r in regs),
           str(regs))
        icons = page.evaluate("""async () => {
          const out = [];
          for (const u of ['pwa/icon-192.png','pwa/icon-512.png','pwa/icon-maskable-512.png']) {
            const r = await fetch(u, {method:'GET'});
            out.push([u, r.status, +(r.headers.get('content-length')||0)]);
          }
          return out;
        }""")
        ok("④ 三個圖示都 200", all(i[1] == 200 for i in icons), json.dumps(icons))

        ok("沒有 pageerror", len(errs) == 0, str(errs[:2]))
        browser.close()

    print(f"\n{'='*46}\n{PASS.__len__()} PASS / {FAIL.__len__()} FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
