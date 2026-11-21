#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抽出遊戲所有看得到的字串（zh 模式），產生 i18n 對照表草稿。

用法：/usr/bin/python3 tools/collect_strings.py [--port 8772] [--out gamepix/strings.json]
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CJK = "/[\\u3400-\\u9fff]/"


def ensure_server(port):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=2).read(64)
        return None
    except Exception:
        pass
    proc = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        time.sleep(0.15)
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=1).read(64)
            return proc
        except Exception:
            continue
    raise RuntimeError("server failed")


DUMP = """((lang) => {
  const out = [];
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) {
      const s = n.nodeValue.replace(/\\s+/g, ' ').trim();
      if (s && CJK.test(s)) out.push(s);
    }
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach((el) => {
      ['placeholder', 'title', 'aria-label'].forEach((a) => {
        const v = el.getAttribute(a);
        if (v && CJK.test(v)) out.push('@' + a + ':' + v);
      });
    });
  };
  walk(document.body);
  return out;
})"""

STATE = """(() => {
  const St = __game.State, s = St.data;
  s.level = 96; s.slots = 5; s.marks = 42; s.rebirths = 4; s.bestStage = 212;
  s.stage = 212; s.coins = 12840000; s.diamonds = 8620; s.tickets = 34;
  const ids = ['haotian','phoenix','bluemoss','turtle','tower','nether','seagod','fox','bear','sausage'];
  s.souls = ids.slice(0, 5).map((id) => ({id, star: 3, level: 96, rings: [], bone: null}));
  s.souls[1].star = 5;   // 滿星按鈕文案
  s.team = s.souls.map((x) => x.id);
  s.ringBag = []; s.bones = [];
  s.souls.forEach((soul) => {
    for (let k = 0; k < 9; k++) {
      const r = St.newRing(['white','yellow','violet','black','red'][k % 5], 'wind');
      s.ringBag.push(r); St.equipRing(soul.id, r.uid);
    }
  });
  for (let i = 0; i < 8; i++) s.ringBag.push(St.newRing('white', 'poison'));
  s.bones = [{uid:'b1', id:'wind'}, {uid:'b2', id:'king'}];
  if (s.souls[0]) s.souls[0].bone = s.bones[0].uid;
  __game.Battle.init();
  __game.renderAll();
})()"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8772)
    ap.add_argument("--out", default="gamepix/strings.json")
    ap.add_argument("--lang", default="zh", choices=["zh", "en"])
    args = ap.parse_args()
    proc = ensure_server(args.port)
    seen = {}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
            p = b.new_context(viewport={"width": 420, "height": 900}).new_page()
            url = f"http://127.0.0.1:{args.port}/index.html?v={int(time.time())}" + ("" if args.lang == "en" else "&lang=zh")
            p.goto(url, wait_until="load")
            p.wait_for_function("window.__game && window.__game.ready", timeout=30000)
            p.evaluate(STATE)

            def grab(step):
                got = p.evaluate(DUMP.replace("CJK", CJK))
                for s in got:
                    seen.setdefault(s, set()).add(step)

            def tabs(step):
                for tab in ("battle", "souls", "rings", "hunt", "gacha"):
                    p.evaluate(f"__game.switchTab('{tab}')")
                    time.sleep(0.4)
                    grab(step + ":" + tab)

            tabs("endgame")

            # 全新存檔（空狀態文案不一樣）
            p.evaluate("localStorage.clear()")
            p.reload(wait_until="load")
            p.wait_for_function("window.__game && window.__game.ready", timeout=30000)
            time.sleep(1.0)
            tabs("fresh")

            # 彈窗：設定、存檔碼、兌換碼
            for js in ("__game.openModal('settings')", "__game.openModal('save')",
                       "__game.openModal('codes')", "__game.openModal('help')"):
                try:
                    p.evaluate(js)
                    time.sleep(0.35)
                    grab("modal")
                    p.evaluate("__game.closeModal()")
                except Exception:
                    pass

            # 戰鬥跑一段，抓 log / 飄字 / banner
            p.evaluate("__game.switchTab('battle')")
            time.sleep(3.0)
            grab("battle-log")
            b.close()
    finally:
        if proc:
            proc.terminate()

    out = {k: len(v) for k, v in sorted(seen.items(), key=lambda kv: -len(kv[1]))}
    path = os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"count": len(out), "strings": out}, open(path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"{len(out)} 條字串 → {path}")
    for s in list(out)[:10]:
        print(" ", s)


if __name__ == "__main__":
    main()
