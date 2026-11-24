#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.19.0 測試：靈寶升級 / 離線收益明細 / 自動化優先序

跑法：/usr/bin/python3 tests/test_v119.py
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
PORT = 8798
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
        ok("版本 ≥ 1.19.0", tuple(int(x) for x in ver.split(".")) >= (1, 19, 0), ver)

        # ---------- 靈寶升級 ----------
        relic = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.relics = ['stonecharm'];        // common，atk
            s.relicLv = {}; s.cores = 100;
            const b1 = S.relicBonus().atk;
            const cost1 = S.relicUpCost('stonecharm');
            const up = S.relicUpgrade('stonecharm');
            const b2 = S.relicBonus().atk;
            return {lv: S.relicLevel('stonecharm'), cost1, up, b1: +b1.toFixed(4), b2: +b2.toFixed(4),
                    cores: s.cores};
        })()""")
        ok("靈寶預設 1 級、1→2 成本 4 獸核",
           relic["lv"] == 2 and relic["cost1"] == 4 and relic["cores"] == 96,
           json.dumps({k: relic[k] for k in ("lv", "cost1", "cores")}, ensure_ascii=False))
        ok("升級後加成上升（每級 +30%）",
           relic["b2"] > relic["b1"] and abs(relic["b2"] - relic["b1"] * 1.3) < 1e-6,
           f"{relic['b1']} → {relic['b2']}")

        cap = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.relics = ['stonecharm']; s.relicLv = { stonecharm: 4 }; s.cores = 500;
            const cost4 = S.relicUpCost('stonecharm');     // 4→5 用 4 倍
            const up = S.relicUpgrade('stonecharm');
            const again = S.relicUpgrade('stonecharm');
            const info = S.relicInfo().find((r) => r.id === 'stonecharm');
            return {cost4, up, again: again.ok, lv: S.relicLevel('stonecharm'),
                    cost: S.relicUpCost('stonecharm'), maxed: info.maxed};
        })()""")
        ok("4→5 成本 16 獸核（階梯倍率）", cap["cost4"] == 16 and cap["up"]["cost"] == 16, str(cap["cost4"]))
        ok("滿級 5 級後擋下、成本回 null",
           cap["lv"] == 5 and cap["again"] is False and cap["cost"] is None and cap["maxed"] is True,
           json.dumps({k: cap[k] for k in ("lv", "again", "maxed")}, ensure_ascii=False))

        pct = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.relics = ['jade']; s.relicLv = { jade: 5 }; s.cores = 0;
            const b = S.relicBonus();
            const info = S.relicInfo().find((r) => r.id === 'jade');
            return {hp: +b.hp.toFixed(4), atk: +b.atk.toFixed(4), curPct: info.curPct};
        })()""")
        base = page.evaluate("CFG.RELIC_BY_KEY[CFG.RELICS.find(r=>r.id==='jade').tier].bonus")
        ok("滿級靈寶：主屬性 ×2.2 且額外給全屬性 +2%",
           abs(pct["hp"] - (base * 2.2 + 0.02)) < 1e-6 and abs(pct["atk"] - 0.02) < 1e-6,
           f"base={base} → {json.dumps(pct, ensure_ascii=False)}")

        poor = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.relics = ['stonecharm']; s.relicLv = {}; s.cores = 2;
            const r = S.relicUpgrade('stonecharm');
            const r2 = S.relicUpgrade('nosuchrelic');
            return {poor: r, missing: r2};
        })()""")
        ok("獸核不足不能升級、沒有這件靈寶擋下",
           poor["poor"]["ok"] is False and poor["missing"]["ok"] is False,
           json.dumps({"poor": poor["poor"]["msg"], "missing": poor["missing"]["msg"]}, ensure_ascii=False))

        # ---------- 離線收益明細 ----------
        off = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.level = 5; s.stage = 12; s.marks = 0;
            s.lastSave = Date.now() - 3 * 3600 * 1000;   // 離線 3 小時
            const g = S.offlineGain(s);
            return g;
        })()""")
        ok("離線明細有 5 個可讀欄位（時長/靈幣/經驗/等級/速率）",
           off and off["minutes"] >= 175 and off["coins"] > 0 and off["exp"] > 0
           and "levelBefore" in off and off["coinsPerMin"] > 0,
           json.dumps({k: off[k] for k in ("minutes", "coins", "exp", "levelBefore", "levelAfter", "levels")},
                      ensure_ascii=False))
        ok("離線升級會回報 Lv 前→後與級數",
           off["levelAfter"] >= off["levelBefore"] and off["levels"] == off["levelAfter"] - off["levelBefore"],
           f"Lv{off['levelBefore']} → Lv{off['levelAfter']} (+{off['levels']})")
        ok("未達 1 分鐘不給收益（避免刷頁洗資源）",
           page.evaluate("(() => { const s = State.data; s.lastSave = Date.now(); return State.offlineGain(s) === null; })()") is True)

        # ---------- 自動化優先序（真的看戰鬥模式變化） ----------
        prio = page.evaluate("""(async () => {
            const S = __game.State, s = S.data, B = __game.Battle;
            s.level = 200; s.stage = 5; s.bestStage = 5;
            s.souls = [{ id:'haotian', star:10, level:100, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian']; s.bossFails = {};
            /* 推進優先要看得到「打王」：先給一顆已裝備的靈環，
               否則 ringless（身上沒環）會先觸發獵靈——那是既有且有意的設計。 */
            s.ringBag = [{ uid:'r0', tier:'white', element:'fire', equipped:'haotian' }];
            s.souls[0].rings = ['r0'];
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const run = async (mode) => {
                s.settings.autoPriority = mode;
                s.settings.autoBoss = true; s.settings.autoHunt = true;
                s.cd = {}; CFG.BEASTS.forEach((b) => { s.cd[b.id] = 0; });
                B.init();
                const seen = [];
                const off = B.on((ev) => { if (ev && ev.type) seen.push(ev.type); });
                B.state.pendingBoss = true; B.state.mode = 'farm'; B.state.autoAt = 0;
                await sleep(3200);
                off();
                const r = { mode: B.state.mode,
                            types: seen.filter((x) => x === 'bossStart' || x === 'huntStart') };
                B.state.mode = 'farm'; B.state.pendingBoss = false;
                return r;
            };
            return {boss: await run('boss'), hunt: await run('hunt'), farm: await run('farm')};
        })()""")
        ok("推進優先：3.2 秒內確實發起 BOSS 挑戰",
           any("boss" in x.lower() for x in prio["boss"]["types"]),
           json.dumps(prio["boss"], ensure_ascii=False))
        ok("獵靈優先：3.2 秒內確實發起獵靈",
           any("hunt" in x.lower() for x in prio["hunt"]["types"]),
           json.dumps(prio["hunt"], ensure_ascii=False))
        ok("只推關：3.2 秒內既不開 BOSS 也不開獵靈",
           prio["farm"]["types"] == [] and prio["farm"]["mode"] == "farm",
           json.dumps(prio["farm"], ensure_ascii=False))

        # ---------- UI ----------
        page.evaluate("State.data.relics = ['stonecharm']; State.data.relicLv = {}; State.data.cores = 50; __game.switchTab('gacha')")
        time.sleep(0.5)
        page.evaluate("__game.showRelics ? __game.showRelics() : document.getElementById('btnRelics').click()")
        time.sleep(0.6)
        ui = page.evaluate("""(() => ({
            rows: document.querySelectorAll('[data-relic]').length,
            lvShown: /Lv 1\\/5/.test(document.getElementById('modalBody').innerText),
            cost: document.querySelector('[data-relic]').textContent.trim()
        }))()""")
        ok("靈寶收藏有升級按鈕與 Lv 1/5 顯示",
           ui["rows"] >= 1 and ui["lvShown"], json.dumps(ui, ensure_ascii=False))
        page.click("[data-relic='stonecharm']")
        time.sleep(0.6)
        up = page.evaluate("({lv: State.relicLevel('stonecharm'), cores: State.data.cores})")
        ok("點升級 → Lv2、扣 4 獸核", up["lv"] == 2 and up["cores"] == 46, json.dumps(up, ensure_ascii=False))
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
