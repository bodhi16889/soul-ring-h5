#!/usr/bin/env python3
"""節奏量測：從全新存檔開始自動玩，記錄升到 Lv10 與拿到第一枚靈環的時間。

    /usr/bin/python3 tests/pacing.py [--limit 300] [--label baseline]

輸出一份 JSON 到 artifacts/pacing-<label>.json，用來 before/after 對照。
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
    ap.add_argument("--limit", type=int, default=360, help="最多量幾秒")
    ap.add_argument("--label", default="run")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    ART.mkdir(exist_ok=True)
    srv = serve(ROOT, 8773)
    url = "http://127.0.0.1:8773/index.html"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed,
                                     args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 420, "height": 860})
        page = ctx.new_page()
        page.goto(url, wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)
        page.evaluate("try { localStorage.clear(); } catch (e) {}")
        page.reload(wait_until="load")
        page.wait_for_function("window.__game && window.__game.ready", timeout=20000)

        t0 = time.time()
        samples = []
        marks = {"lv10": None, "firstRing": None, "lv20": None, "stage10": None}
        ring_done = False

        while time.time() - t0 < args.limit:
            st = page.evaluate("""(() => {
              const s = __game.State.data;
              return {lv: s.level, exp: s.exp, stage: s.stage, kills: s.stats.kills,
                      rings: s.souls.reduce((a, x) => a + x.rings.length, 0),
                      bag: s.ringBag.length, cap: __game.State.levelCap(),
                      mode: __game.Battle.state.mode, coins: s.coins};
            })()""")
            el = round(time.time() - t0, 1)
            samples.append({"t": el, **st})

            if marks["lv10"] is None and st["lv"] >= 10:
                marks["lv10"] = el
            if marks["lv20"] is None and st["lv"] >= 20:
                marks["lv20"] = el
            if marks["stage10"] is None and st["stage"] >= 10:
                marks["stage10"] = el
            if marks["firstRing"] is None and (st["rings"] + st["bag"]) >= 1:
                marks["firstRing"] = el

            # 到達等級上限且還沒有靈環 → 自動去獵靈（模擬新人照提示操作）
            if st["lv"] >= st["cap"] and (st["rings"] + st["bag"]) == 0 and not ring_done \
                    and st["lv"] >= 10:
                hunt = page.evaluate("""(() => {
                  const s = __game.State.data;
                  const beast = __game.CFG.BEASTS.find((b) => s.level >= b.reqLevel);
                  if (!beast) return {ok: false};
                  return __game.Battle.hunt(beast.id);
                })()""")
                ring_done = bool(hunt.get("ok"))
                samples.append({"t": el, "event": "hunt-start", "beast": ring_done})

            if marks["firstRing"] is not None and marks["lv20"] is not None:
                break
            time.sleep(1.0)

        elapsed = round(time.time() - t0, 1)
        summary = {
            "label": args.label,
            "elapsed": elapsed,
            "marks": marks,
            "final": samples[-1] if samples else {},
            "kills_per_min": round(sum(1 for _ in samples), 0) and None,
            "samples": samples[::5],
        }
        if samples:
            k = samples[-1]["kills"] - samples[0]["kills"]
            summary["kills_per_min"] = round(k / max(elapsed, 1) * 60, 1)

        out = ART / f"pacing-{args.label}.json"
        out.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        print(json.dumps({k: summary[k] for k in ("label", "elapsed", "marks", "kills_per_min", "final")},
                         ensure_ascii=False, indent=1))
        print("→", out)
        browser.close()
    srv.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
