#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""產 itch.io 用的封面（630×500）。

不能直接裁 1360×850：兩者長寬比差太多（1.60 vs 1.26），裁下去標題會少字。
所以用同一個版型重新排版：左文右圖、字級與間距按比例縮。

用法：/usr/bin/python3 tools/make_itch_cover.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from make_assets import gradient_bg, glow, rounded_mask, FONT_BOLD, FONT_REG  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

W, H = 630, 500
SHOT = os.path.join(ROOT, "gamepix/assets/screenshots/01-battle.png")
OUT = os.path.join(ROOT, "itch/assets/cover-630x500.png")


def main() -> int:
    base = gradient_bg((W, H)).convert("RGBA")
    base.alpha_composite(glow((W, H), (470, 150), 240, (150, 90, 255), 105))
    base.alpha_composite(glow((W, H), (110, 420), 200, (255, 190, 80), 50))

    # 右側手機截圖（高度 400，寬度依比例）
    shot = Image.open(SHOT).convert("RGB")
    ph = 400
    pw_ = int(shot.width * ph / shot.height)
    shot = shot.resize((pw_, ph), Image.LANCZOS)
    phone = Image.new("RGBA", (pw_ + 10, ph + 10), (0, 0, 0, 0))
    phone.paste(shot, (5, 5))
    phone.putalpha(rounded_mask(phone.size, 16))
    px, py = W - pw_ - 42, (H - ph) // 2
    base.alpha_composite(glow((W, H), (px + pw_ // 2, py + ph // 2), 170, (120, 70, 230), 85))
    frame = Image.new("RGBA", (pw_ + 16, ph + 16), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, frame.width - 1, frame.height - 1], 18,
                                            outline=(255, 255, 255, 60), width=2)
    base.alpha_composite(phone, (px, py))
    base.alpha_composite(frame, (px - 3, py - 3))

    d = ImageDraw.Draw(base)
    f_title = ImageFont.truetype(FONT_BOLD, 50)
    f_sub = ImageFont.truetype(FONT_REG, 19)
    f_bul = ImageFont.truetype(FONT_REG, 16)
    f_small = ImageFont.truetype(FONT_BOLD, 13)

    x = 40
    d.text((x, 96), "SPIRIT RING", font=f_title, fill=(255, 255, 255))
    d.text((x, 150), "IDLE", font=f_title, fill=(255, 205, 90))
    d.text((x, 214), "Idle cultivation RPG", font=f_sub, fill=(198, 178, 255))
    d.text((x, 238), "auto-battle · offline progress", font=f_sub, fill=(198, 178, 255))

    bullets = ["5 spirits auto-fight for you", "9 ring slots per spirit",
               "Fuse 3 rings → next tier", "Rebirth for permanent power"]
    for i, line in enumerate(bullets):
        y = 286 + i * 28
        d.ellipse([x, y + 6, x + 7, y + 13], fill=(255, 205, 90))
        d.text((x + 16, y), line, font=f_bul, fill=(232, 224, 255))

    d.text((x, 430), "FREE · HTML5 · NO INSTALL", font=f_small, fill=(255, 205, 90))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    base.convert("RGB").save(OUT, optimize=True)
    print(f"OK  {os.path.relpath(OUT, ROOT)}  {os.path.getsize(OUT)//1024} KB  {base.size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
