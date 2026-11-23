#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產 PWA 圖示（192 / 512 / maskable 512）。

沿用封面那組「五個環階級」的視覺語言，純符號、不放文字。
maskable 版本把圖形縮到 60% 並填滿底色，避免被 Android 的圓形遮罩切到。

用法：/usr/bin/python3 tools/make_pwa_icons.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from make_assets import gradient_bg, glow, FONT_BOLD  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
import make_crazy_covers as covers  # noqa: E402

OUTDIR = os.path.join(ROOT, "pwa")


def icon(size, maskable=False):
    img = gradient_bg((size, size)).convert("RGBA")
    img.alpha_composite(glow((size, size), (size * 0.5, size * 0.52), size * 0.45,
                            (120, 70, 230), 120))
    base_r = size * (0.30 if maskable else 0.40)
    img.alpha_composite(covers.draw_rings((size, size), (size // 2, int(size * 0.52)),
                                          base_r, max(2, size // 110)))
    # 不加文字：Arial 等拉丁字型沒有 CJK，會變豆腐方塊；
    # 而且 CrazyGames / 全球商店的圖示以符號傳達更安全。
    return img.convert("RGB")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    jobs = [("icon-192.png", 192, False),
            ("icon-512.png", 512, False),
            ("icon-maskable-512.png", 512, True)]
    for name, size, maskable in jobs:
        path = os.path.join(OUTDIR, name)
        icon(size, maskable).save(path, optimize=True)
        print(f"OK  pwa/{name}  {size}×{size}  {os.path.getsize(path)//1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
