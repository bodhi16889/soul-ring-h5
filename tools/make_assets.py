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


def shoot(page, name, setup, wait=1.2, full=False):
    page.evaluate(setup)
    time.sleep(wait)
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
            ("01-battle", "__game.switchTab('battle')", 3.0),
            ("02-spirits", "__game.switchTab('souls')", 1.2),
            ("03-rings", "__game.switchTab('rings')", 1.2),
            ("04-rebirth", "__game.switchTab('souls'); setTimeout(()=>{const b=document.querySelector('#rebirthBox'); if(b) b.scrollIntoView({block:'center'});}, 300)", 1.6),
            ("05-awaken", "__game.switchTab('gacha')", 1.4),
        ]
        for name, setup, wait in shots:
            path = os.path.join(SHOTS, f"{name}.png")
            if skip_existing and os.path.exists(path):
                paths.append(path)
                continue
            paths.append(shoot(p, name, setup, wait))
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

    x = 92
    d.text((x, 150), "SPIRIT RING", font=f_title, fill=(255, 255, 255))
    d.text((x, 250), "IDLE", font=f_title, fill=(255, 205, 90))
    d.text((x, 372), "Idle cultivation RPG · auto-battle", font=f_sub, fill=(198, 178, 255))

    bullets = ["5 spirits auto-fight for you", "9 ring slots per spirit",
               "Fuse 3 rings into the next tier", "Rebirth for permanent power"]
    for i, line in enumerate(bullets):
        y = 448 + i * 46
        d.ellipse([x, y + 10, x + 12, y + 22], fill=(255, 205, 90))
        d.text((x + 26, y), line, font=f_bul, fill=(232, 224, 255))

    d.text((x, 700), "FREE HTML5 · NO INSTALL", font=f_small, fill=(150, 132, 200))
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
    f = ImageFont.truetype(FONT_BOLD, 34)
    txt = "SRI"
    tw = d.textbbox((0, 0), txt, font=f)[2]
    d.text(((S - tw) / 2, 176), txt, font=f, fill=(255, 255, 255))
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
