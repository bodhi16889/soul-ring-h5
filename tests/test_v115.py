#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.15.0 測試：覺醒里程（每 10 次券抽一件靈寶）／靈寶限量 12 件／階級隨能力提升

跑法：/usr/bin/python3 tests/test_v115.py
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
PORT = 8794
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
        ok("版本 ≥ 1.15.0", tuple(int(x) for x in ver.split(".")) >= (1, 15, 0), ver)

        # ---------- 資料完整性 ----------
        data = page.evaluate("""(() => ({
            tiers: CFG.RELIC_TIERS.length,
            relics: CFG.RELICS.length,
            every: CFG.RELIC.every,
            ids: CFG.RELICS.map(r => r.id),
            bad: CFG.RELICS.filter(r => !r.name || !CFG.RELIC_BY_KEY[r.tier] ||
                 ['atk','hp','def','spd','all'].indexOf(r.stat) < 0).map(r => r.id)
        }))()""")
        ok("12 件靈寶、5 個階級、每 10 抽一件",
           data["relics"] == 12 and data["tiers"] == 5 and data["every"] == 10,
           json.dumps({k: data[k] for k in ("relics", "tiers", "every")}, ensure_ascii=False))
        ok("靈寶資料完整（有階級與屬性）", data["bad"] == [], str(data["bad"]))
        ok("靈寶 id 不重複", len(set(data["ids"])) == 12, str(len(set(data["ids"]))))

        # ---------- 里程：每 10 次券抽觸發 ----------
        ms = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.tickets = 100; s.ticketPulls = 0; s.relics = []; s.milestoneAt = 0;
            const granted = [];
            for (let i = 0; i < 9; i++) {
              const r = S.pullOnce(true);
              if (r.milestone) granted.push(r.milestone);
            }
            const before10 = {pulls: s.ticketPulls, relics: s.relics.length, granted: granted.length};
            const r10 = S.pullOnce(true);
            const after10 = {pulls: s.ticketPulls, relics: s.relics.length,
                             kind: r10.milestone ? r10.milestone.kind : null};
            // 第 11 抽不該再給
            const r11 = S.pullOnce(true);
            const after11 = {relics: s.relics.length, milestone: !!r11.milestone};
            return {before10, after10, after11};
        })()""")
        ok("前 9 抽不觸發里程", ms["before10"]["pulls"] == 9 and ms["before10"]["relics"] == 0
           and ms["before10"]["granted"] == 0, json.dumps(ms["before10"], ensure_ascii=False))
        ok("第 10 抽獲得靈寶", ms["after10"]["pulls"] == 10 and ms["after10"]["relics"] == 1
           and ms["after10"]["kind"] == "relic", json.dumps(ms["after10"], ensure_ascii=False))
        ok("第 11 抽不再重複發", ms["after11"]["relics"] == 1 and ms["after11"]["milestone"] is False,
           json.dumps(ms["after11"], ensure_ascii=False))

        # ---------- 鑽石抽不計入里程（使用者要求：覺醒券抽到一定數） ----------
        dia = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.diamonds = 100000; s.ticketPulls = 5; s.milestoneAt = 0; s.relics = [];
            const r = S.pullOnce(false);
            return {pulls: s.ticketPulls, milestone: !!r.milestone};
        })()""")
        ok("鑽石抽不計入覺醒里程", dia["pulls"] == 5 and dia["milestone"] is False,
           json.dumps(dia, ensure_ascii=False))

        # ---------- 限量：只會拿到沒有的，集滿改給獸核 ----------
        limit = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.relics = []; s.cores = 0; s.ticketPulls = 0; s.milestoneAt = 0; s.tickets = 999;
            const seen = [];
            let coins = 0;
            for (let i = 0; i < 130; i++) {
              const r = S.pullOnce(true);
              if (r.milestone) {
                if (r.milestone.kind === 'relic') seen.push(r.milestone.relic.id);
                else coins += r.milestone.cores;
              }
            }
            return {owned: s.relics.length, unique: new Set(s.relics).size,
                    dup: seen.length - new Set(seen).size, coresAfter: s.cores, coins};
        })()""")
        ok("130 抽只能集滿 12 件、不會重複", limit["owned"] == 12 and limit["unique"] == 12
           and limit["dup"] == 0, json.dumps(limit, ensure_ascii=False))
        ok("集滿後里程改給獸核", limit["coresAfter"] >= 30, f"cores={limit['coresAfter']}")

        # ---------- 能力越高，階級權重越偏頂 ----------
        w = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            const set = (stage, reb, marks) => { s.bestStage = stage; s.rebirths = reb; s.marks = marks;
              return S.relicMilestoneInfo().weights; };
            const low = set(5, 0, 0);
            const mid = set(300, 3, 20);
            const high = set(900, 20, 200);
            return {low, mid, high};
        })()""")
        ok("新手權重偏凡品", w["low"]["common"] > w["low"]["legend"] * 5, json.dumps(w["low"]))
        ok("能力提升 → 高階權重上升",
           w["high"]["legend"] > w["mid"]["legend"] > w["low"]["legend"]
           and w["high"]["epic"] > w["low"]["epic"], json.dumps({"low": w["low"]["legend"],
                                                                  "mid": w["mid"]["legend"],
                                                                  "high": w["high"]["legend"]}))

        # ---------- 靈寶真的加戰力 ----------
        bonus = page.evaluate("""(() => {
            const S = __game.State, s = S.data;
            s.souls = [{ id: 'haotian', star: 3, level: 50, rings: [], bone: null, ascend: 0 }];
            s.team = ['haotian']; s.slots = 5; s.relics = [];
            const before = S.soulStats(s.souls[0]).atk;
            s.relics = ['dragonbone'];                    // 地品 ATK +11%
            const afterAtk = S.soulStats(s.souls[0]).atk;
            s.relics = ['mirror'];                        // 天品 all +16%
            const afterAll = S.soulStats(s.souls[0]).atk;
            return {before, afterAtk, afterAll, bonus: S.relicBonus()};
        })()""")
        ok("地品靈寶（龍脊骨）提升攻擊", bonus["afterAtk"] > bonus["before"],
           f"{bonus['before']} → {bonus['afterAtk']}")
        ok("天品靈寶（太虛鏡）全屬性 +16%", bonus["afterAll"] > bonus["afterAtk"],
           f"{bonus['afterAtk']} → {bonus['afterAll']}")
        ok("relicBonus 計算正確（天品 all 給四項 0.16）",
           abs(bonus["bonus"]["atk"] - 0.16) < 1e-9 and abs(bonus["bonus"]["spd"] - 0.16) < 1e-9,
           json.dumps(bonus["bonus"]))

        # ---------- UI ----------
        page.evaluate("__game.switchTab('gacha')")
        time.sleep(0.6)
        ui = page.evaluate("""(() => {
            const box = document.getElementById('relicBox');
            return {has: !!box, text: box ? box.innerText.replace(/\\n/g, ' | ').slice(0, 120) : '',
                    btn: !!document.getElementById('btnRelics')};
        })()""")
        ok("覺醒頁有里程區塊與收藏按鈕", ui["has"] and ui["btn"], ui["text"][:90])

        page.click("#btnRelics")
        time.sleep(0.5)
        modal = page.evaluate("""(() => ({
            title: document.getElementById('modalTitle').textContent,
            cells: document.querySelectorAll('.codex-cell').length,
            on: document.querySelectorAll('.codex-cell.on').length
        }))()""")
        ok("靈寶收藏彈窗 12 格", modal["cells"] == 12, json.dumps(modal, ensure_ascii=False))
        page.keyboard.press("Escape")

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
