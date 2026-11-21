#!/usr/bin/env python3
"""靈環背包模型（equipped 標記）— UI 與測試同步。"""
import io, os

# ---------- ui.js ----------
p = os.path.expanduser('~/work/soul-ring-h5/js/ui.js')
s = io.open(p, encoding='utf-8').read()


def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:70])
    s = s.replace(old, new)


rep("""  function pickRingFor(soulId) {
    const s = State.data;
    if (!s.ringBag.length) return toast('背包沒有靈環，去獵靈取得');
    const body = s.ringBag.map((r) => {""",
    """  function pickRingFor(soulId) {
    const free = State.freeRings();
    if (!free.length) return toast('背包沒有靈環，去獵靈取得');
    const body = free.map((r) => {""")

rep("""    $('#ringCount').textContent = `背包 ${s.ringBag.length} · 已裝備 ${equipped} · 等級上限 ${State.levelCap()}`;""",
    """    $('#ringCount').textContent = `背包 ${State.freeRings().length} · 已裝備 ${equipped} · 等級上限 ${State.levelCap()}`;""")

rep("""    if (!s.ringBag.length && !equipped) {""",
    """    if (!s.ringBag.length) {""")

rep("""    const bagHtml = s.ringBag.map((r) => {""",
    """    const bagHtml = State.freeRings().map((r) => {""")

io.open(p, 'w', encoding='utf-8').write(s)

# ---------- tests/smoke.py ----------
p = os.path.expanduser('~/work/soul-ring-h5/tests/smoke.py')
s = io.open(p, encoding='utf-8').read()

old = '''        ring = page.evaluate("({bag: __game.State.data.ringBag, mode: __game.Battle.state.mode, cd: __game.State.data.cd})")
        check("擊敗靈獸會掉落靈環、並回到掛機", got_ring and ring["mode"] == "farm" and len(ring["bag"]) >= 1,
              str(ring))'''
new = '''        ring = page.evaluate("""({
          bag: __game.State.freeRings().length,
          all: __game.State.data.ringBag.length,
          equipped: __game.State.data.souls.reduce((a, x) => a + x.rings.length, 0),
          mode: __game.Battle.state.mode,
        })""")
        check("擊敗靈獸會掉落靈環（自動裝備或進背包）、並回到掛機",
              got_ring and ring["mode"] == "farm" and ring["all"] >= 1
              and (ring["bag"] + ring["equipped"]) >= 1, str(ring))'''
assert s.count(old) == 1
s = s.replace(old, new)

old = '''        equip = page.evaluate("""(() => {
          const s = __game.State.data;
          const uid = s.ringBag[0].uid;
          const before = __game.State.levelCap();
          const r = __game.State.equipRing(s.souls[0].id, uid);
          return {ok: r.ok, msg: r.msg || '', before, after: __game.State.levelCap(),
                  equipped: s.souls[0].rings.length};
        })()""")'''
new = '''        equip = page.evaluate("""(() => {
          const s = __game.State.data;
          // 先全部卸下，確認「裝備後才 +10」
          s.souls.forEach((x) => x.rings.slice().forEach((uid) => __game.State.unequipRing(x.id, uid)));
          const before = __game.State.levelCap();
          const uid = __game.State.freeRings()[0].uid;
          const r = __game.State.equipRing(s.souls[0].id, uid);
          return {ok: r.ok, msg: r.msg || '', before, after: __game.State.levelCap(),
                  equipped: s.souls[0].rings.length};
        })()""")'''
assert s.count(old) == 1
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched ui + tests')
