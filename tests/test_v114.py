#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.14.0 測試：星級上限 5 → 10（傳承不再是終點）、靈獸 5 → 10

跑法：/usr/bin/python3 tests/test_v114.py
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
PORT = 8793
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
        ok("版本 ≥ 1.14.0", tuple(int(x) for x in ver.split(".")) >= (1, 14, 0), ver)

        # ---------- 星級上限 10 ----------
        caps = page.evaluate("({starMax: CFG.STAR_MAX, inheritCap: CFG.INHERIT.starCap})")
        ok("星級上限 10、傳承上限同步", caps["starMax"] == 10 and caps["inheritCap"] == 10,
           json.dumps(caps, ensure_ascii=False))

        cost = page.evaluate("""(() => {
            const rows = [];
            for (let st = 3; st <= 9; st++) rows.push({ st, bones: CFG.starUpBones(st), coins: CFG.starUpCoin(st) });
            return rows;
        })()""")
        bones = [r["bones"] for r in cost]
        coins = [r["coins"] for r in cost]
        ok("升星成本遞增（3★→10★）", bones == sorted(bones) and coins == sorted(coins) and bones[-1] > bones[0],
           json.dumps(cost, ensure_ascii=False))
        ok("5★ 之後每星需求跳一階（5→6:3、6→7:6、9→10:15）",
           cost[2]["bones"] == 3 and cost[3]["bones"] == 6 and cost[-1]["bones"] == 15,
           f"5→6={cost[2]['bones']} 骨, 6→7={cost[3]['bones']} 骨, 9→10={cost[-1]['bones']} 骨")

        # ---------- 星級倍率（5★ 1.7、10★ 3.23 左右） ----------
        mul = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: 3, level: 100, rings: [], bone: null, ascend: 0 }));
            s.slots = 5; s.team = ['haotian'];
            const soul = s.souls.find(x => x.id === 'haotian');
            const at3 = S.soulStats(soul).atk;
            soul.star = 5; const at5 = S.soulStats(soul).atk;
            soul.star = 10; const at10 = S.soulStats(soul).atk;
            return { at3, at5, at10, r5: at5 / at3, r10: at10 / at3 };
        })()""")
        ok("5★ 約 1.7 倍", abs(mul["r5"] - 1.7) < 0.02, f"×{mul['r5']:.2f}")
        ok("10★ 約 3.2 倍（非爆炸成長）", 3.0 < mul["r10"] < 3.5, f"×{mul['r10']:.2f}")

        # ---------- 升星可以升到 10 ----------
        up = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            const soul = s.souls.find(x => x.id === 'haotian');
            soul.star = 9;
            s.coins = 999999;
            // 給足靈骨
            s.bones = [];
            for (let i = 0; i < 40; i++) s.bones.push({ uid: 'b' + i, id: 'giant' });
            const r = S.starUp('haotian');
            const info = S.starUpInfo(soul);
            return { r, star: soul.star, maxed: info.maxed };
        })()""")
        ok("9★ → 10★ 可以升、之後判定滿星",
           up["r"]["ok"] and up["star"] == 10 and up["maxed"] is True, json.dumps(up, ensure_ascii=False))

        # ---------- 傳承到 10★ ----------
        inh = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.cores = 500;
            const from = s.souls.find(x => x.id === 'seagod');
            const to = s.souls.find(x => x.id === 'nether');
            from.star = 10; to.star = 9;
            const info = S.inheritInfo('seagod', 'nether');
            const r = S.inheritStar('seagod', 'nether');
            const after = { from: from.star, to: to.star, cores: s.cores };
            const capped = S.inheritInfo('seagod', 'nether');
            return { cost: info.cost, r, after, cappedOk: capped.ok, reason: capped.reason };
        })()""")
        ok("9★ 目標可傳承（成本 6×9=54 核）", inh["cost"] == 54 and inh["r"]["ok"],
           json.dumps(inh["after"], ensure_ascii=False))
        ok("傳承後目標 10★、再傳被擋", inh["after"]["to"] == 10 and inh["cappedOk"] is False,
           inh["reason"])

        # ---------- 靈獸 10 隻、每階 2 隻 ----------
        beasts = page.evaluate("CFG.BEASTS.map(b => ({id:b.id, tier:b.tier, el:b.element, req:b.reqLevel}))")
        ok("靈獸 10 隻", len(beasts) == 10, str(len(beasts)))
        tiers = {}
        for b in beasts:
            tiers[b["tier"]] = tiers.get(b["tier"], 0) + 1
        ok("每個階級各 2 隻", all(v == 2 for v in tiers.values()) and len(tiers) == 5,
           json.dumps(tiers, ensure_ascii=False))
        elems = {b["el"] for b in beasts}
        ok("靈獸元素多樣（同階不同元素）", len(elems) >= 3, str(sorted(elems)))

        cx = page.evaluate("State.codexInfo()")
        expect = page.evaluate("CFG.SOULS.length + CFG.BONES.length + CFG.RING_TIERS.length + CFG.BEASTS.length")
        ok("圖鑑總數跟著長（35）", cx["total"] == expect and cx["total"] == 35, f"total={cx['total']}")

        # ---------- 每隻靈獸都能打（老虎機式驗證資料完整） ----------
        broken = page.evaluate("""(() => CFG.BEASTS.filter(b =>
            !b.name || !b.tier || !b.element || !b.hp || !b.cdSec || !CFG.TIER_BY_KEY[b.tier] ||
            !CFG.BEAST_BY_ID[b.id]).map(b => b.id))()""")
        ok("10 隻靈獸資料完整（階級/元素/血量/冷卻）", broken == [], str(broken))

        # ---------- UI ----------
        page.evaluate("__game.switchTab('hunt')")
        time.sleep(0.6)
        ui = page.evaluate("""(() => ({
            cards: document.querySelectorAll('#beastList .card').length,
            elite: document.querySelectorAll('#beastList [data-elite]').length,
            text: document.querySelector('#beastList .card').innerText.replace(/\\n/g, ' | ').slice(0, 90)
        }))()""")
        ok("獵靈頁 10 張卡、10 顆精英鈕", ui["cards"] == 10 and ui["elite"] == 10,
           f"cards={ui['cards']} elite={ui['elite']}")

        page.evaluate("__game.switchTab('souls')")
        time.sleep(0.5)
        star = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls.find(x => x.id === 'haotian').star = 8;
            __game.renderAll();
            const card = document.querySelector('#soulList .card');
            return card.innerText.replace(/\\n/g, ' | ').slice(0, 80);
        })()""")
        ok("8★ 顯示成 ★×8（不是 8 顆星擠爆版面）", "★×8" in star, star)

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
