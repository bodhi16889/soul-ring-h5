#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.13.0 測試：傳承 / 深林層數 / 元素組合羈絆

跑法：/usr/bin/python3 tests/test_v113.py
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
PORT = 8792
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

        _v = page.evaluate("CFG.VERSION")
        ok("版本 ≥ 1.13.0", tuple(int(x) for x in _v.split(".")) >= (1, 13, 0), _v)

        # ---------- 傳承 ----------
        inh = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: x.star, level: 1, rings: [], bone: null, ascend: 0 }));
            s.slots = 5; s.cores = 100;
            const from = s.souls.find(x => x.id === 'seagod');   // ★5
            const to = s.souls.find(x => x.id === 'nether');     // ★4
            const before = { from: from.star, to: to.star, cores: s.cores };
            const same = S.inheritInfo('seagod', 'seagod');
            const r1 = S.inheritStar('seagod', 'nether');
            const after = { from: from.star, to: to.star, cores: s.cores };
            // 目標已滿星（v1.14.0 上限是 10★，先把目標推到頂）
            to.star = CFG.STAR_MAX;
            const capped = S.inheritInfo('seagod', 'nether');
            // 來源在 3★ 時不可再被挖
            const low = s.souls.find(x => x.id === 'sausage');   // ★2
            const lowInfo = S.inheritInfo('sausage', 'haotian');
            return {before, same: same.reason, r1, after, capped: capped.ok, cappedReason: capped.reason,
                    lowOk: lowInfo.ok, lowReason: lowInfo.reason};
        })()""")
        ok("來源與目標相同 → 擋下", inh["same"] == "same", inh["same"])
        ok("傳承成功：來源 ★5→★4、目標 ★4→★5", inh["r1"]["ok"] and inh["after"]["from"] == 4 and inh["after"]["to"] == 5,
           json.dumps(inh["after"], ensure_ascii=False))
        ok("傳承扣獸核（★4 目標 → 24 核）", inh["before"]["cores"] - inh["after"]["cores"] == 24,
           f"{inh['before']['cores']} → {inh['after']['cores']}")
        ok("目標滿星後不可再傳承", inh["capped"] is False and inh["cappedReason"] == "capped", inh["cappedReason"])
        ok("來源低於 3★ 不能挖", inh["lowOk"] is False and inh["lowReason"] == "source", inh["lowReason"])

        # 傳承真的影響戰力
        pw = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            const to = s.souls.find(x => x.id === 'haotian');
            const before = S.soulStats(to).atk;
            to.star = 5;
            const after = S.soulStats(to).atk;
            return {before, after};
        })()""")
        ok("星級提升讓戰力上升", pw["after"] > pw["before"], f"{pw['before']} → {pw['after']}")

        # ---------- 元素組合羈絆 ----------
        combos = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: x.star, level: 1, rings: [], bone: null, ascend: 0 }));
            s.slots = 5;
            s.team = ['fox', 'phoenix'];          // 風 + 火 → 燎原（SPD +12%）
            const windFire = S.combosInfo();
            s.team = ['phoenix', 'bluemoss'];     // 火 + 木 → 焚林（ATK +10%）
            const fireWood = S.combosInfo();
            s.team = ['seagod', 'phoenix'];       // 水 + 火 → 蒸騰（獸核 +1）
            const waterFire = S.combosInfo();
            s.team = ['haotian'];                 // 土 only → 無組合
            const none = S.combosInfo();
            return {windFire, fireWood, waterFire, none};
        })()""")
        ok("風＋火 → 燎原（SPD ×1.12）",
           any(c["id"] == "blaze" for c in combos["windFire"]["active"])
           and abs(combos["windFire"]["stat"]["spd"] - 1.12) < 1e-9,
           json.dumps(combos["windFire"]["stat"], ensure_ascii=False))
        ok("火＋木 → 焚林（ATK ×1.10）",
           abs(combos["fireWood"]["stat"]["atk"] - 1.10) < 1e-9,
           json.dumps(combos["fireWood"]["stat"], ensure_ascii=False))
        ok("水＋火 → 蒸騰（獸核 +1）", combos["waterFire"]["stat"]["core"] == 1,
           json.dumps(combos["waterFire"]["stat"], ensure_ascii=False))
        ok("單一元素沒有組合", combos["none"]["active"] == [], str(len(combos["none"]["active"])))

        # combo 進戰力（風火 vs 只有風）
        spd = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.team = ['fox'];
            const solo = S.soulStats(s.souls.find(x => x.id === 'fox')).spd;
            s.team = ['fox', 'phoenix'];
            const combo = S.soulStats(s.souls.find(x => x.id === 'fox')).spd;
            s.team = ['fox'];
            return {solo, combo};
        })()""")
        ok("組合羈絆讓速度上升", spd["combo"] > spd["solo"], f"{spd['solo']} → {spd['combo']}")

        # ---------- 深林層數 ----------
        dep = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.depth = {};
            const d0 = S.depthInfo('baboon');
            S.depthPlus('baboon'); S.depthPlus('baboon'); S.depthPlus('baboon');
            const d3 = S.depthInfo('baboon');
            for (let i = 0; i < 2; i++) S.depthPlus('baboon');   // 到 5 層
            const d5 = S.depthInfo('baboon');
            return {d0, d3, d5};
        })()""")
        ok("深林第 0 層：獸核 ×1、無加環", dep["d0"]["depth"] == 0 and dep["d0"]["coreMul"] == 1
           and dep["d0"]["bonusRing"] is False, json.dumps(dep["d0"], ensure_ascii=False))
        ok("第 3 層：獸核 ×2", dep["d3"]["coreMul"] == 2, json.dumps(dep["d3"], ensure_ascii=False))
        ok("第 5 層：觸發額外靈環", dep["d5"]["bonusRing"] is True and dep["d5"]["depth"] == 5,
           json.dumps(dep["d5"], ensure_ascii=False))

        # 真的打一場：獸核要隨層數變多
        page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 40; s.coins = 99999;
            s.souls = CFG.SOULS.map(x => ({ id: x.id, star: x.star, level: 40, rings: [], bone: null, ascend: 0 }));
            s.team = ['haotian', 'seagod', 'phoenix']; s.slots = 5;
            s.cd = {}; s.cores = 0; s.ringBag = []; s.depth = { baboon: 2 };   // 已 2 層 → 下次是第 3 層
            __game.Battle.init();
        })()""")
        page.evaluate("__game.Battle.hunt('baboon')")
        page.wait_for_function("__game.Battle.state.mode !== 'hunt' && __game.State.data.depth.baboon >= 3", timeout=60000)
        after = page.evaluate("({cores: State.data.cores, depth: State.data.depth.baboon, bag: State.data.ringBag.length})")
        ok("狩獵後層數 +1、獸核依層數加成（3 層 ×2）",
           after["depth"] == 3 and after["cores"] >= 2, json.dumps(after, ensure_ascii=False))

        # ---------- UI ----------
        page.evaluate("__game.switchTab('souls')")
        time.sleep(0.5)
        ui1 = page.evaluate("""(() => ({
            inheritBtns: document.querySelectorAll('#soulList [data-act=inherit]').length,
            slot: document.getElementById('slotInfo').textContent
        }))()""")
        ok("靈印頁有傳承按鈕、羈絆列", ui1["inheritBtns"] >= 1, f"btns={ui1['inheritBtns']} slot={ui1['slot'][:40]}")

        page.evaluate("__game.switchTab('hunt')")
        time.sleep(0.6)
        ui2 = page.evaluate("""(() => ({
            text: document.querySelector('#beastList .card').innerText.replace(/\\n/g, ' | ')
        }))()""")
        ok("獵靈卡顯示深林層數", "Deep grove" in ui2["text"] or "深林" in ui2["text"], ui2["text"][:120])

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
