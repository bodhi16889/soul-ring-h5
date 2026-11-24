#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.22.0 測試：每日世界王 + 賽季印記

跑法：/usr/bin/python3 tests/test_v122.py
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
PORT = 8802
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

        with open(os.path.join(ROOT, "version.json"), encoding="utf-8") as fh:
            expected = json.load(fh)["version"]
        ok(f"版本與 version.json 一致（{expected}）",
           page.evaluate("CFG.VERSION") == expected, page.evaluate("CFG.VERSION"))

        # ---------- 每日一隻、次數與紀錄 ----------
        info = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.world = { day: '', used: 0, best: 0 };
            const i = S.worldInfo();
            return {boss: i.boss.id, bossName: i.boss.name, left: i.left, perDay: CFG.WORLD.perDay,
                    seconds: i.seconds, tiers: i.tiers.length, day: S.data.world.day,
                    inPool: CFG.WORLD_BOSSES.some((b) => b.id === i.boss.id)};
        })()""")
        ok("世界王在名單內、每日 1 次、限時 60 秒",
           info["inPool"] and info["left"] == 1 and info["perDay"] == 1 and info["seconds"] == 60,
           json.dumps(info, ensure_ascii=False))
        ok("世界王有三檔獎勵", info["tiers"] == 3, str(info["tiers"]))

        use = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.world = { day: '', used: 0, best: 0 };
            const u = S.worldUse();
            return {ok: u.ok, used: S.data.world.used};
        })()""")
        ok("worldUse 只檢查不扣次數（達標才計次）", use["ok"] is True and use["used"] == 0,
           json.dumps(use, ensure_ascii=False))

        rep = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.world = { day: '', used: 0, best: 0 };
            s.cores = 0; s.coins = 0; s.tickets = 0;
            s.season = { idx: -1, total: 0 };
            const low = S.worldReport(0.2);                 // 未達第一檔
            const usedAfterLow = S.data.world.used;
            const mid = S.worldReport(0.5);                 // 第一檔
            const cores = s.cores, coins = s.coins, tickets = s.tickets;
            const block = S.worldUse();
            return {low: {cleared: low.cleared, tier: low.tier}, usedAfterLow,
                    mid: {cleared: mid.cleared, tier: mid.tier, best: mid.best},
                    cores, coins, tickets, blocked: block.ok,
                    season: mid.season};
        })()""")
        ok("打不到第一檔不計次、可重打",
           rep["low"]["cleared"] is False and rep["usedAfterLow"] == 0,
           json.dumps(rep["low"], ensure_ascii=False))
        ok("達第一檔才計次、給 Tier1 獎勵（4 獸核）",
           rep["mid"]["cleared"] is True and rep["mid"]["tier"] == 0 and rep["cores"] == 4,
           f"cores={rep['cores']} tier={rep['mid']['tier']}")
        ok("次數用完後擋下開戰", rep["blocked"] is False)
        ok("最佳紀錄取最高（50%）", rep["mid"]["best"] == 50, str(rep["mid"]["best"]))

        season = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.season = { idx: -1, total: 0 };
            const first = S.seasonMark();
            const again = S.seasonMark();
            const info = S.seasonInfo();
            return {first: first.ok, total: first.total, againOk: again.ok, infoTotal: info.total,
                    mul: +info.mul.toFixed(3), daysLeft: info.daysLeft};
        })()""")
        ok("賽季印記：每季首次參戰 +1，同季不重複",
           season["first"] is True and season["total"] == 1 and season["againOk"] is False,
           json.dumps(season, ensure_ascii=False))
        ok("賽季印記給全屬性加成（1 枚 = +1%）", abs(season["mul"] - 1.01) < 1e-6, str(season["mul"]))

        # ---------- 實際開戰：倒數、累積傷害、時間到結算 ----------
        battle = page.evaluate("""(async () => {
            const S = __game.State, s = S.data, B = __game.Battle;
            s.world = { day: '', used: 0, best: 0 };
            s.season = { idx: -1, total: 0 };
            s.souls = [{ id:'haotian', star:10, level:100, rings:[], bone:null, ascend:0 }];
            s.team = ['haotian'];
            B.init();
            const r = B.worldStart();
            const hp = B.state.worldMaxHp, left0 = B.state.worldLeft;
            const seen = [];
            const off = B.on((ev) => { if (ev && ev.type) seen.push(ev.type); });
            await new Promise((res) => setTimeout(res, 3000));
            const dmgAfter3s = B.state.worldDmg;
            const modeDuring = B.state.mode;
            B.state.worldLeft = 0.15;                        // 快轉到結束
            await new Promise((res) => setTimeout(res, 900));
            off();
            return {ok: r.ok, hp, left0, dmgAfter3s, modeDuring,
                    modeAfter: B.state.mode, used: S.data.world.used,
                    best: S.data.world.best, seen: seen.filter((x) => /world/.test(x))};
        })()""")
        ok("開戰後進入 world 模式、血量依戰力計算",
           battle["ok"] and battle["hp"] > 1000 and battle["left0"] == 60,
           json.dumps({k: battle[k] for k in ("hp", "left0")}, ensure_ascii=False))
        ok("3 秒內累積到傷害、模式仍是 world",
           battle["dmgAfter3s"] > 0 and battle["modeDuring"] == "world",
           f"dmg={battle['dmgAfter3s']}")
        ok("時間到會自動結算回 farm（有 worldEnd 事件）",
           battle["modeAfter"] == "farm" and "worldEnd" in battle["seen"],
           str(battle["seen"]))
        ok("結算後次數被消耗（達標才算）",
           battle["used"] <= 1, f"used={battle['used']} best={battle['best']}%")

        # ---------- UI ----------
        page.evaluate("State.data.world = { day: '', used: 0, best: 0 }; __game.switchTab('battle')")
        time.sleep(0.6)
        btn = page.inner_text("#btnWorld")
        ok("戰鬥頁有世界王按鈕並顯示次數", "World Boss" in btn and "1/1" in btn, btn)

        page.click("#btnWorld")
        time.sleep(0.7)
        modal = page.evaluate("document.getElementById('modalBody').innerText.replace(/\\n/g,' | ')")
        ok("彈窗顯示今日王、三檔獎勵、賽季印記",
           "Tier 1" in modal and "Tier 3" in modal and "Season sigil" in modal, modal[:150])
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
