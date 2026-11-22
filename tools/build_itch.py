#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打 itch.io 用的 HTML5 包：與 GamePix 版同一套原始碼，差別只在「不接 GamePix SDK」。

為什麼要另出一包（不是直接用 GamePix 的 ZIP）：
1. GamePix SDK 只能在 GamePix Player 內跑；在 itch 上載入別家廣告 SDK 違反雙方條款，
   而且 gamepix.js 的 boot() 會主動注入 SDK，所以必須整支移除（ui.js 的呼叫都有 `if (global.GP)` 保護）。
2. itch 的 iframe 尺寸由頁面設定（預設 960×600 橫式），直式遊戲要標成「不嵌入頁面」或直式尺寸；
   移除 SDK 後不影響任何版面。

驗證（任一不過就非 0 結束）：
  - ZIP 根目錄有 index.html
  - 只含遊戲本體（不含 README / tests / tools / artifacts / .git / gamepix 素材）
  - **零外部網址**（itch 不需要任何 SDK）
  - 不含 alert( / confirm( / prompt( / gtag / analytics
  - 不含 GamePix 任何字樣（避免誤載入 SDK 或審核誤會）

用法：/usr/bin/python3 tools/build_itch.py [--out dist/spirit-ring-idle-itch.zip]
"""
import argparse
import hashlib
import io
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 與 GamePix 版相同的來源，但排除 js/gamepix.js
INCLUDE = ['index.html', 'css/style.css', 'js/config.js', 'js/state.js',
           'js/battle.js', 'js/ui.js', 'js/i18n.js', 'js/sfx.js']
# 只擋「真的會載入 GamePix SDK」的字樣；註解提到 GamePix 不影響（CSS 註解會寫到 SDK 注入的樣式）
FORBIDDEN = [r'\balert\s*\(', r'\bconfirm\s*\(', r'\bprompt\s*\(', r'gtag\s*\(',
             r'googletagmanager', r'google-analytics',
             r'gamepix\.sdk\.js', r'integration\.gamepix\.com',
             r'<script[^>]*gamepix']
URL_RE = re.compile(r'https?://([^/"\'\s]+)')


def transform(rel, text):
    """把 GamePix 專屬的標籤與註解拿掉，其餘原樣保留。"""
    if rel != 'index.html':
        return text
    out = []
    skip_sdk_comment = False
    for line in text.splitlines():
        s = line.strip()
        # <head> 的 GamePix SDK 區塊（含兩行註解）
        if 'GamePix SDK v3' in s or s.startswith('<!-- GamePix SDK'):
            skip_sdk_comment = True
            continue
        if skip_sdk_comment:
            if s.startswith('載入失敗'):
                continue
            skip_sdk_comment = False
            if s.startswith('-->'):
                continue
        if 'GamePixConfig' in s or 'gamepix.sdk.js' in s:
            continue
        if 'js/gamepix.js' in s:
            continue
        out.append(line)
    return "\n".join(out) + ("\n" if text.endswith("\n") else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='dist/spirit-ring-idle-itch.zip')
    args = ap.parse_args()
    out_path = os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    problems = []
    payload = {}
    for rel in INCLUDE:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            problems.append(f'缺少 {rel}')
            continue
        text = io.open(path, encoding='utf-8').read()
        text = transform(rel, text)
        for pat in FORBIDDEN:
            if re.search(pat, text, re.I):
                problems.append(f'{rel} 命中禁用樣式 {pat}')
        for host in URL_RE.findall(text):
            problems.append(f'{rel} 含外部網址 {host}')
        payload[rel] = text

    if 'index.html' not in payload:
        problems.append('缺少 index.html')

    if problems:
        print('✗ 檢查未通過：', file=sys.stderr)
        for p in problems:
            print('  -', p, file=sys.stderr)
        return 1

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in INCLUDE:
            z.writestr(rel, payload[rel])
    data = buf.getvalue()
    with open(out_path, 'wb') as fh:
        fh.write(data)

    print(f'OK  {os.path.relpath(out_path, ROOT)}')
    print(f'    {len(data):,} bytes · sha256 {hashlib.sha256(data).hexdigest()[:16]} · {len(INCLUDE)} entries')
    for rel in INCLUDE:
        print(f'    - {rel}  ({len(payload[rel]):,} chars)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
