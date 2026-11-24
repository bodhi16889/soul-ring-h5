#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產 GamePix 素材：icon 256×256、cover 1360×850、screenshots 1080×1920。

後台實測規格（2026-11-21，my.gamepix.com → Assets）：
  Icon  256×256  ≤ 1 MB   JPG/PNG
  Cover 1360×850 ≤ 1.5 MB  JPG/PNG

用法：/usr/bin/python3 tools/make_assets.py [--port 8772]
"""
import os
import sys
import time
import argparse
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "gamepix", "assets")
SHOTS = os.path.join(OUT, "screenshots")
TITLE = "SPIRIT RING IDLE"

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
if not os.path.exists(FONT_BOLD):
    FONT_BOLD = "/System/Library/Fonts/Helvetica.ttc"
    FONT_REG = FONT_BOLD


def ensure_server(port):
    """本機已經有 http.server 就沿用，否則起一個。"""
    import urllib.request
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=2).read(64)
        return None
    except Exception:
        pass
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        time.sleep(0.15)
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=1).read(64)
            return proc
        except Exception:
            continue
    raise RuntimeError("http.server 起不來")


SEED = """(() => {
  const St = __game.State, s = St.data;
  s.level = 96; s.slots = 5; s.marks = 42; s.rebirths = 4; s.bestStage = 212;
  s.stage = 212; s.coins = 12840000; s.diamonds = 8620; s.tickets = 34;
  const ids = ['haotian','phoenix','turtle','tower','nether'];
  const els = ['poison','water','wind','earth','water'];
  s.souls = ids.map((id, i) => ({id, star: 5, level: 96, rings: [], bone: null}));
  s.team = ids.slice();
  s.ringBag = []; s.bones = [];
  ids.forEach((id, si) => {
    for (let k = 0; k < 9; k++) {
      const r = St.newRing(k < 6 ? 'red' : 'black', els[si]);
      s.ringBag.push(r); St.equipRing(id, r.uid);
    }
  });
  for (let i = 0; i < 8; i++) s.ringBag.push(St.newRing('white', els[i % 5]));
  for (let i = 0; i < 5; i++) s.ringBag.push(St.newRing('yellow', els[i % 5]));
  __game.Battle.init();
  __game.renderAll();
})()"""


def shoot(page, name, setup, wait=1.2, full=False, clean=None):
    page.evaluate(setup)
    time.sleep(wait)
    if clean:
        # 拍照前清掉「瞬時」元素（傷害數字、波次橫幅）：不是改玩法，只是不讓浮動數字擋住畫面
        page.evaluate(clean)
        time.sleep(0.12)
    path = os.path.join(SHOTS, f"{name}.png")
    page.screenshot(path=path, full_page=full)
    return path


def take_screenshots(port, skip_existing=False):
    from playwright.sync_api import sync_playwright
    os.makedirs(SHOTS, exist_ok=True)
    paths = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = b.new_context(viewport={"width": 540, "height": 960}, device_scale_factor=2,
                            is_mobile=True, has_touch=True)
        p = ctx.new_page()
        p.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load")
        p.wait_for_function("window.__game && window.__game.ready", timeout=30000)
        p.evaluate(SEED)

        shots = [
            # 01 用 BOSS 戰（單一敵人）當主視覺：小怪波的 8 隻 AoE 傷害數字會疊在一起
            ("01-battle", "(() => { __game.switchTab('battle'); "
                          "__game.State.data.settings.speed = 1; "
                          "__game.Battle.state.pendingBoss = true; "
                          "__game.Battle.challengeBoss(); })()",
             2.6, False,
             "(() => { __game.Battle.stop(); "
             "const f = document.getElementById('floaters'); if (f) f.innerHTML = ''; })()"),
            ("02-spirits", "__game.switchTab('souls')", 1.2),
            ("03-rings", "__game.switchTab('rings')", 1.2),
            # 轉生頁：把標題列（含「第 N 代」徽章）捲到最上方，否則徽章會被切掉
            ("04-rebirth", "__game.switchTab('souls'); setTimeout(()=>{const h=document.querySelector('#rebirthBox h3'); "
                           "if(h) h.scrollIntoView({block:'start'});}, 300)", 1.8),
            ("05-awaken", "__game.switchTab('gacha')", 1.4),
        ]
        for shot in shots:
            name, setup, wait = shot[0], shot[1], shot[2]
            extra = shot[3:]
            path = os.path.join(SHOTS, f"{name}.png")
            if skip_existing and os.path.exists(path):
                paths.append(path)
                continue
            paths.append(shoot(p, name, setup, wait, *extra))
        b.close()
    return paths


def rounded_mask(size, radius):
    from PIL import Image, ImageDraw
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def gradient_bg(size, top=(24, 12, 44), bottom=(8, 4, 18)):
    from PIL import Image
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize(size)


def glow(size, center, radius, color, alpha=90):
    from PIL import Image, ImageDraw, ImageFilter
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
              fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(radius // 2))


def make_cover(shot_path):
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1360, 850
    base = gradient_bg((W, H)).convert("RGBA")
    base.alpha_composite(glow((W, H), (1020, 300), 460, (150, 90, 255), 110))
    base.alpha_composite(glow((W, H), (250, 700), 380, (255, 190, 80), 55))

    # 右側手機截圖
    shot = Image.open(shot_path).convert("RGB")
    ph = 720
    pw_ = int(shot.width * ph / shot.height)
    shot = shot.resize((pw_, ph), Image.LANCZOS)
    phone = Image.new("RGBA", (pw_ + 16, ph + 16), (0, 0, 0, 0))
    phone.paste(shot, (8, 8))
    phone.putalpha(rounded_mask(phone.size, 26))
    px, py = W - pw_ - 96, (H - ph) // 2
    base.alpha_composite(glow((W, H), (px + pw_ // 2, py + ph // 2), 320, (120, 70, 230), 90))
    frame = Image.new("RGBA", (pw_ + 24, ph + 24), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, frame.width - 1, frame.height - 1], 32,
                                            outline=(255, 255, 255, 60), width=3)
    base.alpha_composite(phone, (px, py))
    base.alpha_composite(frame, (px - 4, py - 4))

    d = ImageDraw.Draw(base)
    f_title = ImageFont.truetype(FONT_BOLD, 96)
    f_sub = ImageFont.truetype(FONT_REG, 34)
    f_bul = ImageFont.truetype(FONT_REG, 30)
    f_small = ImageFont.truetype(FONT_BOLD, 24)

    # GamePix 規則：cover 上的字只能是遊戲名稱（不得有標語／清單／平台字樣）。
    # 只有標題時版面會偏空 → 用大字級＋垂直居中，並加一層柔光暈。
    x = 96
    ty1, ty2 = 300, 412
    d.text((x, ty1), "SPIRIT RING", font=f_title, fill=(255, 255, 255))
    d.text((x, ty2), "IDLE", font=f_title, fill=(255, 205, 90))
    path = os.path.join(OUT, "cover-1360x850.png")
    base.convert("RGB").save(path, "PNG", optimize=True)
    return path


def make_icon():
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    S = 256
    base = gradient_bg((S, S), (46, 22, 84), (12, 6, 26)).convert("RGBA")
    base.alpha_composite(glow((S, S), (128, 128), 108, (170, 110, 255), 130))
    d = ImageDraw.Draw(base)
    # 三層發光靈環
    for r, col, wdt in ((86, (255, 214, 102), 9), (62, (196, 130, 255), 7), (38, (120, 226, 255), 5)):
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([128 - r, 128 - r, 128 + r, 128 + r], outline=col + (255,), width=wdt)
        base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(3)))
        d.ellipse([128 - r, 128 - r, 128 + r, 128 + r], outline=col + (255,), width=max(2, wdt // 3))
    d.ellipse([112, 112, 144, 144], fill=(255, 240, 200, 255))
    # 不放字母縮寫：64px 清單縮圖下「SRI」看不清反而像雜點，環形主視覺本身已足夠辨識
    path = os.path.join(OUT, "icon-256.png")
    base.convert("RGB").save(path, "PNG", optimize=True)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8772)
    ap.add_argument("--reuse", action="store_true", help="沿用已存在的截圖")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    proc = ensure_server(args.port)
    try:
        shots = take_screenshots(args.port, skip_existing=args.reuse)
        cover = make_cover(shots[0])
        icon = make_icon()
    finally:
        if proc:
            proc.terminate()

    from PIL import Image
    print(f"cover : {cover}  {Image.open(cover).size}  {os.path.getsize(cover)//1024} KB")
    print(f"icon  : {icon}  {Image.open(icon).size}  {os.path.getsize(icon)//1024} KB")
    for s in shots:
        print(f"shot  : {s}  {Image.open(s).size}  {os.path.getsize(s)//1024} KB")


if __name__ == "__main__":
    main()
