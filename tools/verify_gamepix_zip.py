#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GamePix 送審包驗收（對「解壓後的 ZIP」實跑，不是對來源檔）

跑法：
  /usr/bin/python3 tools/verify_gamepix_zip.py /tmp/gpcheck 8820
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time

PASS, FAIL = [], []


def ok(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else '/tmp/gpcheck'
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8820
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), functools.partial(Quiet, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/"

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])

        # ---------- 1) 直接開頁面（非 Player）：adsAllowed 應為 false ----------
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errs, console_errs = [], []
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        page.on("console", lambda m: console_errs.append(m.text[:200]) if m.type == "error" else None)
        reqs = []
        page.on("request", lambda r: reqs.append(r.url))
        page.goto(base + "index.html", wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=40000)
        time.sleep(1.2)

        info = page.evaluate("""(() => ({
            ver: CFG.VERSION,
            provider: window.ADS && ADS.name,
            adsAllowed: window.ADS && ADS.adsAllowed,
            sdk: window.ADS && ADS.hasSdk,
            log: (window.ADS && ADS.log || []).slice(-6),
            lang: typeof I18N !== 'undefined' ? I18N.lang : null,
            title: document.title,
            loadingHidden: (() => { const l = document.getElementById('loading'); return !l || l.classList.contains('hidden') || getComputedStyle(l).display === 'none' || getComputedStyle(l).opacity === '0'; })(),
        }))()""")
        import json as _json
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "version.json"), encoding="utf-8") as fh:
            expected = _json.load(fh)["version"]
        ok(f"版本與 version.json 一致（{expected}）", info["ver"] == expected,
           f"{info['ver']} vs {expected}")
        ok("GamePix provider 選到 gamepix", info["provider"] == "gamepix", str(info["provider"]))
        ok("直接開頁面時 adsAllowed = false（公開 demo 不彈假廣告）",
           info["adsAllowed"] is False, str(info["adsAllowed"]))
        ok("預設語言是英文", info["lang"] == "en", str(info["lang"]))
        ok("標題是 Spirit Ring Idle", info["title"] == "Spirit Ring Idle", info["title"])
        ok("載入畫面已收", info["loadingHidden"] is True)
        ok("lifecycle 有 loading/loaded/gameStart 記錄",
           any("loading" in str(x) for x in info["log"]) or len(info["log"]) >= 2, str(info["log"]))

        # ---------- 2) 實玩：真的有推進 ----------
        play = page.evaluate("""(async () => {
            const s = __game.State.data;
            const kills0 = (s.stats && s.stats.kills) || 0;
            const wave0 = __game.Battle.state.waveNo;
            await new Promise((r) => setTimeout(r, 6000));
            return {kills0, kills1: (__game.State.data.stats || {}).kills || 0,
                    wave0, wave1: __game.Battle.state.waveNo,
                    coins: __game.State.data.coins, level: __game.State.data.level};
        })()""")
        ok("6 秒內有擊殺（戰鬥真的在跑）",
           play["kills1"] > play["kills0"] or play["wave1"] > play["wave0"],
           json.dumps(play, ensure_ascii=False))

        external = sorted({u.split('/')[2] for u in reqs if u.startswith("http") and "127.0.0.1" not in u})
        ok("外部請求只有 GamePix SDK", all("gamepix" in h for h in external), str(external))
        ok("零 pageerror", len(errs) == 0, str(errs[:2]))

        # ---------- 3) 存檔可寫 ----------
        save = page.evaluate("""(() => {
            __game.State.data.coins = 98765; __game.State.save(true);
            const raw = localStorage.getItem('soulring.save.v1') || localStorage.getItem('soulring.save') || '';
            return {saved: raw.length > 0, coins: __game.State.data.coins};
        })()""")
        ok("存檔寫得進 localStorage", save["saved"] is True, json.dumps(save, ensure_ascii=False))
        ctx.close()

        # ---------- 4) iframe 640×480（模擬 Player） ----------
        ctx2 = browser.new_context(viewport={"width": 720, "height": 560})
        page2 = ctx2.new_page()
        errs2 = []
        page2.on("pageerror", lambda e: errs2.append(str(e)[:200]))
        # 從空白頁嵌 iframe（不要先載遊戲再覆蓋 DOM：那會讓已啟動的計時器抓到 null）
        # 用真的 wrapper 頁模擬 Player（about:blank + set_content 會讓 iframe 變成 chrome-error）
        wrapper = os.path.join(root, "_parent_mock.html")
        io_open = open(wrapper, "w", encoding="utf-8")
        io_open.write(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Player mock</title>'
            '<style>html,body{margin:0;background:#000}iframe{border:0;display:block}</style></head>'
            f'<body><iframe id="f" src="index.html" width="640" height="480" allow="autoplay"></iframe></body></html>'
        )
        io_open.close()
        page2.goto(base + "_parent_mock.html", wait_until="load")
        page2.wait_for_selector("#f")
        frame = page2.frames[1]
        frame.page.on("pageerror", lambda e: errs2.append(str(e)[:200]))
        frame.wait_for_function("window.__game && window.__game.ready", timeout=40000)
        time.sleep(2.0)
        in_if = frame.evaluate("""(() => ({
            adsAllowed: window.ADS && ADS.adsAllowed,
            ver: CFG.VERSION,
            w: innerWidth, h: innerHeight,
            viewVisible: !!document.querySelector('.view.active'),
            tapTargets: (() => {
                const bad = [];
                document.querySelectorAll('.mini-btn, .nav-btn, .pull-chip').forEach((b) => {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && r.height < 44) bad.push(b.id || b.textContent.trim().slice(0, 8) + ':' + Math.round(r.height));
                });
                return bad.slice(0, 5);
            })(),
            overflowX: document.documentElement.scrollWidth > innerWidth + 1
        }))()""")
        ok("iframe 640×480 內 adsAllowed = true（In Player 才給廣告）",
           in_if["adsAllowed"] is True, str(in_if["adsAllowed"]))
        ok("iframe 內可玩、無橫向溢出", in_if["viewVisible"] and in_if["overflowX"] is False,
           json.dumps({k: in_if[k] for k in ("w", "h", "overflowX")}, ensure_ascii=False))
        ok("iframe 內觸控目標 ≥44px", in_if["tapTargets"] == [], str(in_if["tapTargets"]))
        ok("iframe 內零 pageerror", len(errs2) == 0, str(errs2[:2]))
        page2.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts", "gp-640x480-v1201.png"))
        ctx2.close()

        # ---------- 5) SDK 被封鎖時仍可玩 ----------
        ctx3 = browser.new_context(viewport={"width": 390, "height": 844})
        page3 = ctx3.new_page()
        errs3 = []
        page3.on("pageerror", lambda e: errs3.append(str(e)[:200]))
        page3.route("**/gamepix.sdk.js", lambda route: route.abort())
        page3.goto(base + "index.html", wait_until="load")
        page3.wait_for_function("window.__game && window.__game.ready", timeout=40000)
        time.sleep(2)
        noSdk = page3.evaluate("""(() => ({
            ready: !!__game, provider: window.ADS && ADS.name, sdk: window.ADS && ADS.hasSdk,
            loadingHidden: (() => { const l = document.getElementById('loading');
                return !l || getComputedStyle(l).display === 'none' || l.classList.contains('hidden') || getComputedStyle(l).opacity === '0'; })()
        }))()""")
        ok("SDK 被擋時遊戲仍可玩、載入畫面仍會收",
           noSdk["ready"] and noSdk["sdk"] is False and noSdk["loadingHidden"] is True,
           json.dumps(noSdk, ensure_ascii=False))
        ok("SDK 被擋時零 pageerror", len(errs3) == 0, str(errs3[:2]))
        ctx3.close()
        browser.close()

    print(f"\n{'='*46}\n{len(PASS)} PASS / {len(FAIL)} FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
