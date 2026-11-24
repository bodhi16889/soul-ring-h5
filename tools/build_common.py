# -*- coding: utf-8 -*-
"""建置共用：把 PWA 專屬的 HTML 片段從平台包裡拿掉。

為什麼：`manifest.webmanifest`、`sw.js`、`pwa/` 只存在 GitHub Pages 版。
GamePix / CrazyGames / itch 的包不含這些檔，若 index.html 仍引用，
平台 iframe 內會出現 404 與 console 錯誤（送審會被挑）。

service worker 本身在別的網域不會註冊（index.html 有 hostname 判斷），
但 `<link rel="manifest">` 是靜態的，一定會被瀏覽器抓 → 所以直接移除。
"""
import re

_PATTERNS = [
    r'<link rel="manifest"[^>]*>\s*',
    r'<link rel="apple-touch-icon"[^>]*>\s*',
    r'<meta name="apple-mobile-web-app[^>]*>\s*',
    r'<script>\s*/\* PWA[\s\S]*?</script>\s*',
    r'<script>\s*/\* 版本看門狗[\s\S]*?</script>\s*',
]


def strip_pwa(html: str) -> str:
    for pat in _PATTERNS:
        html = re.sub(pat, '', html)
    return html
