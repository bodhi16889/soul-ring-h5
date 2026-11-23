#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 CrazyGames 包壓成「單一 HTML 檔」（CrazyGames 後台不收 ZIP，手機上也只能一次選一個檔）。

CrazyGames 上傳欄位的原文錯誤訊息：
    "Archive files are not supported, please drag and drop the files directly in the upload zone."

桌面可以拖整個資料夾，手機幾乎不可能 → 所以把 css/ 與 js/ 全部內嵌成一支 index.html。
外部只剩 CrazyGames SDK（這個本來就要在 <head> 靜態載入）。

用法：
  /usr/bin/python3 tools/build_crazy_single.py
  → dist/spirit-ring-idle-crazygames-single.html

驗證（一定要跑，內嵌很容易踩到 </script> 或字串轉義）：
  tests/test_crazy_single.py（mock SDK，確認還是能玩、provider 是 crazy）
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from build_crazygames import transform, INCLUDE  # noqa: E402

OUT = os.path.join(ROOT, "dist", "spirit-ring-idle-crazygames-single.html")


def read(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def main() -> int:
    html = transform("index.html", read("index.html"))

    # 1) CSS 內嵌
    css = read("css/style.css")
    if "</style" in css.lower():
        print("✗ style.css 含 </style>，不能直接內嵌", file=sys.stderr)
        return 1
    html = html.replace('<link rel="stylesheet" href="css/style.css" />',
                        "<style>\n" + css + "\n</style>")
    html = html.replace('<link rel="stylesheet" href="css/style.css">',
                        "<style>\n" + css + "\n</style>")

    # 2) JS 依序內嵌（<script src="js/x.js"></script>）
    def inline(m):
        src = m.group(1)
        code = read(src)
        if "</script" in code.lower():
            raise SystemExit(f"✗ {src} 內含 </script>，需先轉義才能內嵌")
        return "<script>\n" + code + "\n</script>"

    html, n = re.subn(r'<script src="(js/[^"]+)"></script>', inline, html)
    if n < 5:
        print(f"✗ 只內嵌了 {n} 個 js，可能路徑不符", file=sys.stderr)
        return 1

    # 2.5) 拔掉 PWA：單檔版沒有 manifest／sw.js，留著只會在 console 噴 404
    html = re.sub(r'<link rel="manifest"[^>]*>\s*', '', html)
    html = re.sub(r'<link rel="apple-touch-icon"[^>]*>\s*', '', html)
    html = re.sub(r'<meta name="apple-mobile-web-app[^>]*>\s*', '', html)
    html = re.sub(r'<script>\s*/\* PWA[\s\S]*?</script>\s*', '', html)

    # 3) 殘留檢查：不能還有本機相對資源引用
    left = re.findall(r'(?:src|href)="(?!#|https?:|data:)([^"]+)"', html)
    left = [x for x in left if not x.startswith('#')]
    if left:
        print(f"✗ 還有未內嵌的相對路徑：{left}", file=sys.stderr)
        return 1

    ext = re.findall(r'https?://([^/"\'\s]+)', html)
    bad = sorted({h for h in ext if h != 'sdk.crazygames.com'})
    if bad:
        print(f"✗ 出現未允許的外部網址：{bad}", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(html)
    size = os.path.getsize(OUT)
    print(f"OK  {os.path.relpath(OUT, ROOT)}")
    print(f"    {size:,} bytes · 內嵌 {n} 個 js ＋ 1 個 css · 外部只剩 sdk.crazygames.com")
    return 0


if __name__ == "__main__":
    sys.exit(main())
