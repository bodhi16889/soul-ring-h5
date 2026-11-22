#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CrazyGames adapter 契約測試（不需要真的 CrazyGames 帳號）。

做法：真的跑 tools/build_crazygames.py 產包 → 解壓 → 起本機 server →
用 route 攔截 SDK 網址換成 mock → 斷言呼叫序列與廣告回傳值。

用法：/usr/bin/python3 tests/test_crazy_adapter.py
"""
from __future__ import annotations

import functools
import http.server
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import zipfile

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8791

MOCK_SDK = """
window.__cgCalls = [];
window.CrazyGames = { SDK: {
  environment: 'crazygames',
  init: function(){ window.__cgCalls.push('init'); return Promise.resolve(); },
  game: {
    loadingStart: function(){ window.__cgCalls.push('loadingStart'); },
    loadingStop: function(){ window.__cgCalls.push('loadingStop'); },
    gameplayStart: function(){ window.__cgCalls.push('gameplayStart'); },
    gameplayStop: function(){ window.__cgCalls.push('gameplayStop'); },
    happytime: function(){ window.__cgCalls.push('happytime'); }
  },
  ad: { requestAd: function(type, cb){
    window.__cgCalls.push('requestAd:' + type);
    setTimeout(function(){ cb.adStarted(); }, 10);
    setTimeout(function(){ cb.adFinished(); }, 30);
  } }
} };
"""

fails = []


def check(name, ok, detail=""):
    print(("[PASS] " if ok else "[FAIL] ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(name)


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="cgtest-")
    try:
        # 1) 用真實 builder 產包
        r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_crazygames.py"),
                            "--out", os.path.join(tmp, "cg.zip")],
                           capture_output=True, text=True, cwd=ROOT)
        check("build_crazygames.py 成功產包", r.returncode == 0, r.stdout.strip().splitlines()[0] if r.stdout else r.stderr[:120])

        unz = os.path.join(tmp, "site")
        os.makedirs(unz, exist_ok=True)
        zipfile.ZipFile(os.path.join(tmp, "cg.zip")).extractall(unz)
        check("ZIP 內有 index.html 且無 GamePix 檔案",
              os.path.exists(os.path.join(unz, "index.html"))
              and not os.path.exists(os.path.join(unz, "js", "ads-gamepix.js")), "")

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=unz)
        socketserver.TCPServer.allow_reuse_address = True
        httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        time.sleep(0.6)

        with sync_playwright() as pw:
            b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
            ctx = b.new_context(viewport={"width": 640, "height": 800})
            p = ctx.new_page()
            p.route("**/crazygames-sdk-v3.js",
                    lambda route: route.fulfill(status=200, content_type="application/javascript", body=MOCK_SDK))
            errs = []
            p.on("pageerror", lambda e: errs.append(str(e)[:150]))
            p.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            p.wait_for_function("window.__game && window.__game.ready", timeout=30000)
            time.sleep(1.0)

            state = p.evaluate("""({
              name: window.ADS ? ADS.name : null,
              allowed: window.ADS ? ADS.adsAllowed : null,
              started: window.ADS ? ADS.state.started : null,
              hidden: document.getElementById('loading').classList.contains('hidden'),
              calls: window.__cgCalls
            })""")
            check("選到 crazy provider 且載入畫面已收尾",
                  state["name"] == "crazy" and state["hidden"] is True and state["started"] is True, str(state))
            check("啟動序列：init → loadingStart → loadingStop → gameplayStart",
                  state["calls"] == ["init", "loadingStart", "loadingStop", "gameplayStart"], str(state["calls"]))

            rw = p.evaluate("(async () => await ADS.reward())()")
            time.sleep(0.15)
            calls_after = p.evaluate("window.__cgCalls")
            check("reward() 回 success 且送出 requestAd:rewarded ＋ 廣告期間 gameplayStop/Start",
                  rw == {"success": True} and "requestAd:rewarded" in calls_after
                  and calls_after.count("gameplayStop") >= 1, f"{rw} {calls_after[-4:]}")

            it = p.evaluate("(async () => await ADS.interstitial())()")
            time.sleep(0.15)
            calls2 = p.evaluate("window.__cgCalls")
            check("interstitial() 回 success 且送出 requestAd:midgame",
                  it == {"success": True} and "requestAd:midgame" in calls2, f"{it}")
            check("整個流程沒有 pageerror", not errs, str(errs[:2]))
            b.close()
        httpd.shutdown()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if fails:
        print(f"RESULT: FAIL ({len(fails)}: {', '.join(fails)})")
        return 1
    print("RESULT: PASS（CrazyGames adapter 契約測試）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
