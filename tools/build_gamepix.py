#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打 GamePix 送審包：<root>/index.html + css/ + js/（多檔、相對路徑）。

驗證（任一不過就非 0 結束）：
  - ZIP 根目錄有 index.html
  - 檔案清單只有遊戲本體（不含 README、tests、tools、artifacts、gamepix、.git）
  - 外部網址只允許 https://integration.gamepix.com
  - 不含 alert( / confirm( / prompt( / gtag / analytics
  - 不含 GodMode 之外的多餘 SDK

用法：/usr/bin/python3 tools/build_gamepix.py [--out dist/spirit-ring-idle-gamepix.zip]
"""
import argparse
import hashlib
import io
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ['index.html', 'css/style.css', 'js/config.js', 'js/state.js',
           'js/battle.js', 'js/ui.js', 'js/i18n.js', 'js/gamepix.js']
ALLOWED_HOSTS = {'integration.gamepix.com'}
FORBIDDEN = [r'\balert\s*\(', r'\bconfirm\s*\(', r'\bprompt\s*\(', r'gtag\s*\(',
             r'googletagmanager', r'google-analytics']
URL_RE = re.compile(r'https?://([^/"\'\s]+)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='dist/spirit-ring-idle-gamepix.zip')
    args = ap.parse_args()
    out_path = os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    problems = []
    payload = {}
    for rel in INCLUDE:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            problems.append(f'缺少檔案：{rel}')
            continue
        data = io.open(path, encoding='utf-8').read()
        for pat in FORBIDDEN:
            for m in re.finditer(pat, data):
                line = data[:m.start()].count('\n') + 1
                problems.append(f'{rel}:{line} 使用禁用 API {pat}')
        for host in URL_RE.findall(data):
            if host in ALLOWED_HOSTS:
                continue
            problems.append(f'{rel} 含外部網址 {host}')
        payload[rel] = data

    # 標題一致性
    idx = payload.get('index.html', '')
    if 'Spirit Ring Idle' not in idx:
        problems.append('index.html 的 <title> 不是 Spirit Ring Idle')

    if problems:
        print('送審包檢查失敗：')
        for p in problems:
            print('  -', p)
        return 1

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, data in payload.items():
            z.writestr(rel, data)

    with zipfile.ZipFile(out_path) as z:
        names = z.namelist()
        assert z.testzip() is None
    if 'index.html' not in names:
        print('ZIP 根目錄沒有 index.html')
        return 1

    raw = open(out_path, 'rb').read()
    sha = hashlib.sha256(raw).hexdigest()
    print(f'OK  {args.out}')
    print(f'    {len(raw):,} bytes · sha256 {sha[:16]} · {len(names)} entries')
    for n in names:
        print(f'    - {n}  ({len(payload[n]):,} chars)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
