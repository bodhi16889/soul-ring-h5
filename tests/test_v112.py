#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.12.0 測試：靈印（元素／羈絆／覺醒階）＋ 獵靈（獸核／精英／五行剋制）

跑法：/usr/bin/python3 tests/test_v112.py
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
PORT = 8790
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
        time.sleep(0.8)

        _v = page.evaluate("CFG.VERSION")
        ok("版本 ≥ 1.12.0", tuple(int(x) for x in _v.split(".")) >= (1, 12, 0), _v)

        # ---------- 武魂 15 隻、每隻都有元素 ----------
        souls = page.evaluate("CFG.SOULS.map(s => ({id:s.id, el:s.element, name:s.name}))")
        ok("武魂 15 隻", len(souls) == 15, str(len(souls)))
        ok("每隻武魂都有元素", all(s["el"] for s in souls),
           str([s["id"] for s in souls if not s["el"]]))
        ok("五種元素都有武魂", len({s["el"] for s in souls}) == 5,
           str(sorted({s["el"] for s in souls})))

        # ---------- 羈絆 ----------
        bond = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: x.star, level: 1, rings: [], bone: null, ascend: 0 }));
            s.slots = 5;
            s.team = ['haotian', 'bear'];          // 兩隻土
            const same = S.bondInfo();
            s.team = ['haotian', 'phoenix', 'bluemoss'];   // 三種元素
            const tri = S.bondInfo();
            s.team = ['haotian'];
            const single = S.bondInfo();
            return {same, tri: {kinds: tri.kinds, tri: tri.tri}, single: {strong: single.strong, tri: single.tri}};
        })()""")
        ok("同元素 2 隻 → 該元素進入 strong", bond["same"]["strong"] == ["earth"],
           json.dumps(bond["same"], ensure_ascii=False))
        ok("三種元素 → tri 成立", bond["tri"]["tri"] is True and bond["tri"]["kinds"] == 3,
           json.dumps(bond["tri"], ensure_ascii=False))
        ok("單隻不觸發羈絆", bond["single"]["strong"] == [] and not bond["single"]["tri"],
           json.dumps(bond["single"], ensure_ascii=False))

        # 羈絆真的進戰力（同元素隊友 → 該武魂 atk 變高）
        power = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.team = ['haotian'];
            const solo = S.soulStats(s.souls.find(x => x.id === 'haotian')).atk;
            s.team = ['haotian', 'bear'];      // 同為土
            const paired = S.soulStats(s.souls.find(x => x.id === 'haotian')).atk;
            s.team = ['haotian'];
            return {solo, paired};
        })()""")
        ok("羈絆讓戰力上升（+12%）", power["paired"] > power["solo"],
           f"solo={power['solo']} paired={power['paired']}")

        # ---------- 覺醒階 ----------
        asc = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            const soul = s.souls.find(x => x.id === 'haotian');
            soul.level = 50; s.cores = 100;
            const low = S.ascendInfo('haotian');           // 等級不足
            soul.level = 100;
            const atk0 = S.soulStats(soul).atk;
            const r1 = S.ascendSoul('haotian');
            const atk1 = S.soulStats(soul).atk;
            const coresAfter = s.cores;
            // 一路升到頂
            for (let i = 0; i < 10; i++) S.ascendSoul('haotian');
            const capped = S.ascendInfo('haotian');
            return {lowOk: low.can, lowLevelOk: low.levelOk, r1, atk0, atk1, coresAfter,
                    stage: capped.stage, maxed: capped.maxed, atkMax: S.soulStats(soul).atk};
        })()""")
        ok("未滿 100 級不能覺醒", asc["lowOk"] is False and asc["lowLevelOk"] is False,
           json.dumps({k: asc[k] for k in ("lowOk", "lowLevelOk")}, ensure_ascii=False))
        ok("滿級＋獸核 → 覺醒成功並扣核", asc["r1"]["ok"] and asc["r1"]["stage"] == 1 and asc["coresAfter"] == 96,
           json.dumps(asc["r1"], ensure_ascii=False))
        ok("覺醒提升戰力", asc["atk1"] > asc["atk0"], f"{asc['atk0']} → {asc['atk1']}")
        ok("覺醒最多 5 階", asc["stage"] == 5 and asc["maxed"] is True, f"stage={asc['stage']}")

        # ---------- 五行剋制 ----------
        cnt = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: x.star, level: 1, rings: [], bone: null, ascend: 0 }));
            s.slots = 5;
            s.team = ['fox'];                       // 風
            const vsEarth = S.huntCounter('darkbear');   // 土 → 風剋土 = strong
            const vsFire = S.huntCounter('baboon');      // 風 vs 風 = neutral
            s.team = ['phoenix'];                   // 火
            const vsWood = S.huntCounter('mandala');     // 火剋木 = strong
            const vsWater = S.huntCounter('whale');      // 水剋火 = weak
            return {vsEarth, vsFire, vsWood, vsWater};
        })()""")
        ok("風剋土 → +25%", cnt["vsEarth"]["kind"] == "strong" and abs(cnt["vsEarth"]["mult"] - 1.25) < 1e-9,
           json.dumps(cnt["vsEarth"], ensure_ascii=False))
        ok("同元素 → 中立", cnt["vsFire"]["kind"] == "neutral", json.dumps(cnt["vsFire"], ensure_ascii=False))
        ok("火剋木 → +25%", cnt["vsWood"]["kind"] == "strong", json.dumps(cnt["vsWood"], ensure_ascii=False))
        ok("水剋火 → -10%", cnt["vsWater"]["kind"] == "weak" and abs(cnt["vsWater"]["mult"] - 0.9) < 1e-9,
           json.dumps(cnt["vsWater"], ensure_ascii=False))

        # ---------- 獵靈：獸核掉落 + 精英 ----------
        page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 40; s.coins = 99999;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: x.star, level: 40, rings: [], bone: null, ascend: 0 }));
            s.team = ['haotian', 'seagod', 'phoenix']; s.slots = 5;
            s.cd = {}; s.cores = 0; s.ringBag = [];
            __game.Battle.init();
        })()""")
        page.evaluate("__game.Battle.hunt('baboon')")
        page.wait_for_function("__game.Battle.state.mode !== 'hunt' && __game.State.data.cores > 0", timeout=60000)
        after = page.evaluate("({cores: State.data.cores, hunts: State.data.stats.hunts, bag: State.data.ringBag.length})")
        ok("普通獵靈掉獸核（白環 +1）且拿到靈環",
           after["cores"] >= 1 and after["bag"] >= 1, json.dumps(after, ensure_ascii=False))

        page.evaluate("State.data.cd = {}")
        page.evaluate("__game.Battle.hunt('baboon', true)")
        page.wait_for_function("__game.Battle.state.mode !== 'hunt'", timeout=60000)
        elite = page.evaluate("""(() => ({cores: State.data.cores, used: State.eliteInfo('baboon').used,
            again: __game.Battle.hunt('baboon', true)}))()""")
        ok("精英靈獸給 3 倍獸核", elite["cores"] >= 4, f"cores={elite['cores']}")
        ok("精英每日只能一次", elite["used"] is True and elite["again"]["ok"] is False,
           elite["again"].get("msg", ""))

        # ---------- 圖鑑納入新武魂 ----------
        cx = page.evaluate("State.codexInfo()")
        ok("圖鑑總數納入新武魂（30）", cx["total"] == 30, f"total={cx['total']}")

        # ---------- UI 有元素/覺醒/精英 ----------
        page.evaluate("__game.switchTab('souls')")
        time.sleep(0.5)
        ui1 = page.evaluate("""(() => {
            const card = document.querySelector('#soulList .card');
            return {hasAscendBtn: !!document.querySelector('#soulList [data-act=ascend]'),
                    text: card ? card.innerText.slice(0, 120) : ''};
        })()""")
        ok("靈印卡有覺醒按鈕", ui1["hasAscendBtn"] is True, ui1["text"][:60])

        page.evaluate("__game.switchTab('hunt')")
        time.sleep(0.6)
        ui2 = page.evaluate("""(() => ({
            eliteBtns: document.querySelectorAll('#beastList [data-elite]').length,
            hint: document.getElementById('huntHint').textContent,
            text: document.querySelector('#beastList .card').innerText.replace(/\\n/g, ' | ').slice(0, 140)
        }))()""")
        ok("獵靈卡有精英按鈕（5 隻靈獸）", ui2["eliteBtns"] == 5, str(ui2["eliteBtns"]))
        ok("獵靈頁顯示獸核數量", "Beast cores" in ui2["hint"] or "獸核" in ui2["hint"], ui2["hint"][-60:])

        # ---------- 英文無殘留 ----------
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
