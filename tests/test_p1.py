#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.11.0 P1 功能測試：離線加倍 / 每週任務 / 圖鑑 / BGM

跑法：/usr/bin/python3 tests/test_p1.py
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
PORT = 8789
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

        ver = page.evaluate("CFG.VERSION")
        ok("版本 ≥ 1.11.0（P1 功能都在）", tuple(int(x) for x in ver.split(".")) >= (1, 11, 0), ver)

        # ---------- 週任務 ----------
        info = page.evaluate("State.weeklyInfo()")
        ok("週任務 3 項、初始皆不可領", len(info) == 3 and not any(t["can"] for t in info),
           json.dumps(info[0], ensure_ascii=False))
        ok("週任務有週 key", bool(page.evaluate("State.data.week.key")),
           page.evaluate("State.data.week.key"))

        got = page.evaluate("""(() => {
            const d0 = State.data.diamonds;
            State.weeklyAdd('kills', 300);
            const t = State.weeklyInfo().find(x => x.id === 'kills');
            const want = t.can;
            const r = State.weeklyClaim('kills');
            return {want, ok: r.ok, gain: State.data.diamonds - d0, reward: r.reward || null,
                    again: State.weeklyClaim('kills')};
        })()""")
        ok("達成 300 擊殺後可領、領 300 💎", got["want"] and got["ok"] and got["gain"] == 300,
           json.dumps(got, ensure_ascii=False))
        ok("同一個週任務不能重複領", got["again"]["ok"] is False, got["again"].get("msg", ""))

        reset = page.evaluate("""(() => {
            State.data.week.key = '1999-W01';
            State.data.week.kills = 999;
            const info = State.weeklyInfo();          // 觸發換週
            return {key: State.data.week.key, kills: State.data.week.kills,
                    claimed: State.data.week.claimed.length,
                    can: info.find(x => x.id === 'kills').can};
        })()""")
        ok("換週會重置進度與已領清單", reset["kills"] == 0 and reset["claimed"] == 0 and not reset["can"],
           json.dumps(reset, ensure_ascii=False))

        # 週任務 UI 有渲染
        page.evaluate("__game.switchTab('gacha')")
        time.sleep(0.4)
        ok("覺醒頁有週任務區塊", page.evaluate("!!document.querySelector('#weeklyBox .merge-row')"),
           page.evaluate("document.getElementById('weeklyBox').innerText.slice(0,60)"))

        # ---------- 圖鑑 ----------
        cx = page.evaluate("""(() => {
            const i = State.codexInfo();
            return {groups: i.groups.length, total: i.total, owned: i.owned,
                    mul: State.codexMul(), bonusPer: CFG.CODEX.bonusPer};
        })()""")
        expect_total = page.evaluate("CFG.SOULS.length + CFG.BONES.length + CFG.RING_TIERS.length + CFG.BEASTS.length")
        ok("圖鑑 4 組、總數 = 武魂+靈骨+環階+靈獸", cx["groups"] == 4 and cx["total"] == expect_total,
           json.dumps(cx, ensure_ascii=False))
        ok("圖鑑初始加成 = 1（尚未收集）", abs(cx["mul"] - (1 + cx["bonusPer"] * cx["owned"])) < 1e-9,
           f"mul={cx['mul']} owned={cx['owned']}")

        mark = page.evaluate("""(() => {
            const before = State.codexInfo().owned;
            State.codexMark('souls', 'phoenix');
            State.codexMark('rings', 'red');
            State.codexMark('beasts', 'whale');
            State.codexMark('souls', 'phoenix');    // 重複不該累加
            const after = State.codexInfo().owned;
            return {before, after, mul: State.codexMul()};
        })()""")
        ok("收集會增加圖鑑件數且重複不重算", mark["after"] - mark["before"] == 3,
           json.dumps(mark, ensure_ascii=False))
        ok("圖鑑加成進到戰力（全屬性乘算）", mark["mul"] > 1, f"mul={mark['mul']}")

        page.evaluate("__game.renderAll()")
        page.click("#btnCodex")
        time.sleep(0.4)
        modal = page.evaluate("""(() => {
            const m = document.getElementById('modal');
            return {hidden: m.classList.contains('hidden'),
                    cells: document.querySelectorAll('.codex-cell').length,
                    on: document.querySelectorAll('.codex-cell.on').length,
                    title: document.getElementById('modalTitle').textContent};
        })()""")
        ok("圖鑑彈窗可開、格子數等於總項目、已收集有標記",
           not modal["hidden"] and modal["cells"] == expect_total and modal["on"] >= 3,
           json.dumps(modal, ensure_ascii=False))
        page.keyboard.press("Escape")

        # ---------- 離線加倍 ----------
        dbl = page.evaluate("""(() => {
            const s = State.data;
            s.pendingOffline = {minutes: 60, coins: 1000, exp: 500, doubled: false, at: Date.now()};
            const c0 = s.coins, lv0 = s.level;
            const r1 = State.claimOfflineDouble();
            const c1 = s.coins;
            const r2 = State.claimOfflineDouble();
            return {r1, c1: c1 - c0, r2, doubled: s.pendingOffline.doubled};
        })()""")
        ok("離線加倍：一鍵入帳 +1000 靈幣",
           dbl["r1"]["ok"] and dbl["c1"] == 1000, json.dumps(dbl["r1"], ensure_ascii=False))
        ok("離線加倍只能用一次", dbl["r2"]["ok"] is False and dbl["doubled"] is True,
           dbl["r2"].get("msg", ""))

        # ---------- BGM ----------
        bgm = page.evaluate("""(() => {
            SFX.bgmSet(true);
            const on = {flag: SFX.bgm, ls: localStorage.getItem('soulring.bgm')};
            SFX.bgmSet(false);
            const off = {flag: SFX.bgm, ls: localStorage.getItem('soulring.bgm')};
            return {on, off};
        })()""")
        ok("BGM 開關可切、偏好寫進 localStorage",
           bgm["on"]["flag"] is True and bgm["on"]["ls"] == "on"
           and bgm["off"]["flag"] is False and bgm["off"]["ls"] == "off",
           json.dumps(bgm, ensure_ascii=False))

        # ---------- 英文殘留（新增的週任務／圖鑑字串）----------
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
        ok("英文模式下新區塊沒有殘留中文", not cjk, str(cjk))

        ok("沒有 pageerror", len(errs) == 0, str(errs[:2]))
        browser.close()

    print(f"\n{'='*46}\n{len(PASS)} PASS / {len(FAIL)} FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
