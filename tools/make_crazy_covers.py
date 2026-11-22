#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產 CrazyGames 三張封面（規格：docs.crazygames.com/requirements/game-covers）

  Landscape 16:9  1920×1080
  Portrait  2:3    800×1200
  Square    1:1    800×800

CrazyGames 硬性限制（照 docs，違反會被退）：
  - 封面只能有「遊戲名稱」，不能有其他標語（New / Play now / 免費…）
  - 不能加外框、不能放商店或平台 logo
  - **不要直接放遊戲截圖**（docs 明講：截圖是最偷懶也最沒效果的作法）
  - 不能模糊或像素化

所以這裡用「程序化畫的靈環」當主視覺：五個同心發光環（對應遊戲的五個環階級），
配標題。不需要外部美術資產，也不會把 UI 文字（Team wiped、Watch an ad）帶進封面。

用法：/usr/bin/python3 tools/make_crazy_covers.py
"""
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from make_assets import gradient_bg, glow, FONT_BOLD  # noqa: E402
from PIL import Image, ImageDraw, ImageFont, ImageFilter  # noqa: E402

OUTDIR = os.path.join(ROOT, "crazygames/assets")

# 五個環階級的顏色（跟遊戲內一致：白/黃/紫/黑/紅）
TIER = [
    ("#F2F2F7", 1.00),   # white
    ("#FFD24A", 0.80),   # yellow
    ("#A875FF", 0.62),   # violet
    ("#6E5A96", 0.45),   # black（用暗紫灰才看得出）
    ("#FF5C6C", 0.30),   # red（最內圈最亮）
]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def draw_rings(size, center, base_r, line_w):
    """回傳一張帶發光同心環的 RGBA 圖。"""
    W, H = size
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, (color, scale) in enumerate(TIER):
        r = base_r * scale
        col = hex_rgb(color)
        # 外光
        halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        hd.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                   outline=col + (110,), width=int(line_w * 2.4))
        halo = halo.filter(ImageFilter.GaussianBlur(line_w * 1.6))
        layer.alpha_composite(halo)
        # 主環
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                  outline=col + (235,), width=line_w)

    # 核心光點
    core = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(core)
    cr = base_r * 0.16
    cd.ellipse([center[0] - cr, center[1] - cr, center[0] + cr, center[1] + cr],
               fill=(255, 245, 210, 255))
    core = core.filter(ImageFilter.GaussianBlur(cr * 0.55))
    layer.alpha_composite(core)

    # 星屑（固定種子，重跑結果一致）
    rnd = random.Random(7)
    for _ in range(90):
        ang = rnd.uniform(0, 6.2832)
        rad = rnd.uniform(base_r * 0.25, base_r * 1.55)
        x = center[0] + rad * __import__("math").cos(ang)
        y = center[1] + rad * __import__("math").sin(ang)
        s = rnd.choice([1, 1, 2, 2, 3])
        a = rnd.randint(70, 190)
        d.ellipse([x, y, x + s, y + s], fill=(255, 240, 200, a))
    return layer


def fit_size(draw, text, max_w, start=160, floor=40):
    """回傳能讓 text 寬度 ≤ max_w 的最大字級（避免標題壓到靈環）。"""
    size = start
    while size > floor:
        f = ImageFont.truetype(FONT_BOLD, size)
        if draw.textlength(text, font=f) <= max_w:
            return size
        size -= 2
    return floor


def title_block(draw, x, y, size, two_lines=True):
    f = ImageFont.truetype(FONT_BOLD, size)
    if two_lines:
        draw.text((x, y), "SPIRIT RING", font=f, fill=(255, 255, 255))
        draw.text((x, y + int(size * 1.04)), "IDLE", font=f, fill=(255, 205, 90))
    else:
        draw.text((x, y), "SPIRIT", font=f, fill=(255, 255, 255))
        draw.text((x, y + int(size * 1.04)), "RING", font=f, fill=(255, 255, 255))
        draw.text((x, y + int(size * 2.08)), "IDLE", font=f, fill=(255, 205, 90))


def landscape(W=1920, H=1080):
    base = gradient_bg((W, H)).convert("RGBA")
    base.alpha_composite(glow((W, H), (1440, 520), 560, (120, 70, 230), 120))
    base.alpha_composite(glow((W, H), (280, 900), 440, (255, 180, 70), 38))
    base.alpha_composite(draw_rings((W, H), (1440, 540), 350, 6))
    d = ImageDraw.Draw(base)
    # 文字區的暗部（提高對比，也避免環線穿過字）
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(scrim).rectangle([0, 0, 1010, H], fill=(8, 4, 18, 120))
    scrim = scrim.filter(ImageFilter.GaussianBlur(60))
    base.alpha_composite(scrim)
    size = fit_size(d, "SPIRIT RING", 760, 150)
    title_block(d, 132, 540 - int(size * 1.05), size)
    return base.convert("RGB")


def portrait(W=800, H=1200):
    base = gradient_bg((W, H)).convert("RGBA")
    base.alpha_composite(glow((W, H), (400, 800), 330, (120, 70, 230), 120))
    base.alpha_composite(glow((W, H), (150, 190), 220, (255, 180, 70), 38))
    base.alpha_composite(draw_rings((W, H), (400, 800), 268, 5))
    d = ImageDraw.Draw(base)
    fs = fit_size(d, "SPIRIT RING", 700, 96)
    f = ImageFont.truetype(FONT_BOLD, fs)
    for i, (txt, col) in enumerate([("SPIRIT RING", (255, 255, 255)), ("IDLE", (255, 205, 90))]):
        w = d.textlength(txt, font=f)
        d.text(((W - w) / 2, 92 + i * int(fs * 1.05)), txt, font=f, fill=col)
    return base.convert("RGB")


def square(W=800, H=800):
    base = gradient_bg((W, H)).convert("RGBA")
    base.alpha_composite(glow((W, H), (505, 520), 290, (120, 70, 230), 120))
    base.alpha_composite(glow((W, H), (140, 150), 200, (255, 180, 70), 38))
    base.alpha_composite(draw_rings((W, H), (505, 520), 215, 4))
    d = ImageDraw.Draw(base)
    fs = fit_size(d, "SPIRIT", 300, 78)
    title_block(d, 46, 62, fs, two_lines=False)
    return base.convert("RGB")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    for name, fn in [
        ("cover-landscape-1920x1080.png", landscape),
        ("cover-portrait-800x1200.png", portrait),
        ("cover-square-800x800.png", square),
    ]:
        img = fn()
        path = os.path.join(OUTDIR, name)
        img.save(path, optimize=True)
        print(f"OK  {os.path.relpath(path, ROOT)}  {img.size[0]}×{img.size[1]}  {os.path.getsize(path)//1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
