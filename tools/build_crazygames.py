#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打 CrazyGames 用的 HTML5 包。

與 GamePix 包的差異：
1. `<head>` 改放 CrazyGames SDK v3（`https://sdk.crazygames.com/crazygames-sdk-v3.js`）
   並在它之前設 `window.ADS_PROVIDER = 'crazy'`（讓 js/ads.js 選對 provider）。
2. 打包 `js/ads.js` + `js/ads-crazy.js`（不含 ads-gamepix.js）。
3. 其餘完全相同（同一份遊戲原始碼）。

CrazyGames 送審要求（照 docs/requirements 整理）：
- SDK 必須在遊戲程式之前載入並 `await SDK.init()`
- 開場要 loadingStart()／載入完成 loadingStop()（本作的 ads-crazy.js 已處理）
- gameplayStart() 在真正開始玩時呼叫（本作在 boot 完成後）
- 中場廣告只在自然斷點（本作在關卡之間），rewarded 只在玩家明確點擊
- CrazyGames 自己會節流中場廣告（最快 3 分鐘一次）

用法：/usr/bin/python3 tools/build_crazygames.py [--out dist/spirit-ring-idle-crazygames.zip]
"""
import argparse
import hashlib
import io
import os
import re
import sys
import zipfile

from build_common import strip_pwa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ['index.html', 'css/style.css', 'js/config.js', 'js/state.js',
           'js/battle.js', 'js/ui.js', 'js/i18n.js', 'js/ads.js', 'js/ads-crazy.js', 'js/sfx.js']
ALLOWED_HOSTS = {'sdk.crazygames.com'}
FORBIDDEN = [r'\balert\s*\(', r'\bconfirm\s*\(', r'\bprompt\s*\(', r'gtag\s*\(',
             r'googletagmanager', r'google-analytics',
             r'gamepix\.sdk\.js', r'integration\.gamepix\.com']
URL_RE = re.compile(r'https?://([^/"\'\s]+)')

CPP_SDK = ('<script>window.ADS_PROVIDER = \'crazy\';</script>\n'
           '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>')


def transform(rel, text):
    """把 GamePix 的 SDK 區塊換成 CrazyGames 的（只動 index.html）。"""
    if rel != 'index.html':
        return text
    text = strip_pwa(text)
    out = []
    skip = False
    for line in text.splitlines():
        s = line.strip()
        if 'GamePix SDK v3' in s or s.startswith('<!-- GamePix SDK'):
            skip = True
            out.append('<!-- CrazyGames SDK v3：必須早於遊戲任何 JS，且要 await SDK.init() -->')
            out.append(CPP_SDK)
            continue
        if skip:
            if s.startswith('載入失敗') or s.startswith('-->'):
                continue
            skip = False
            if s.startswith('-->'):
                continue
        if 'GamePixConfig' in s or 'gamepix.sdk.js' in s:
            continue
        if 'js/ads-gamepix.js' in s:
            out.append('<script src="js/ads-crazy.js"></script>')
            continue
        out.append(line)
    return "\n".join(out) + ("\n" if text.endswith("\n") else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='dist/spirit-ring-idle-crazygames.zip')
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
        text = transform(rel, io.open(path, encoding='utf-8').read())
        for pat in FORBIDDEN:
            if re.search(pat, text, re.I):
                problems.append(f'{rel} 命中禁用樣式 {pat}')
        for host in URL_RE.findall(text):
            if host not in ALLOWED_HOSTS:
                problems.append(f'{rel} 含未允許的外部網址 {host}')
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
    open(out_path, 'wb').write(data)

    print(f'OK  {os.path.relpath(out_path, ROOT)}')
    print(f'    {len(data):,} bytes · sha256 {hashlib.sha256(data).hexdigest()[:16]} · {len(INCLUDE)} entries')
    for rel in INCLUDE:
        print(f'    - {rel}  ({len(payload[rel]):,} chars)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
