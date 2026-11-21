#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把所有中文字串字面值自動包成 T(...)（i18n）。

作法：真正的 JS 字串掃描器（支援巢狀樣板字串 ${...}），只跳過註解。
T() 在中文模式回原字串，所以中文行為不變。

用法：/usr/bin/python3 tools/wrap_i18n.py [--dry] [--file js/ui.js ...]
"""
import argparse
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CJK = re.compile(r'[\u3400-\u9fff]')
DEFAULT_FILES = ['js/ui.js', 'js/battle.js', 'js/state.js']


class Scanner:
    def __init__(self, src):
        self.s = src
        self.n = len(src)
        self.spans = []      # (start, end_exclusive, kind)

    def scan(self):
        self.code(0)
        return self.spans

    def code(self, i, stop_brace=False):
        s, n = self.s, self.n
        depth = 0
        while i < n:
            c = s[i]
            if c == '/' and i + 1 < n and s[i + 1] == '/':
                j = s.find('\n', i)
                i = n if j < 0 else j
                continue
            if c == '/' and i + 1 < n and s[i + 1] == '*':
                j = s.find('*/', i + 2)
                i = n if j < 0 else j + 2
                continue
            if c in '"\'':
                j = self.simple(i)
                self.spans.append((i, j, 'str'))
                i = j
                continue
            if c == '`':
                j = self.tmpl(i)
                self.spans.append((i, j, 'tmpl'))
                i = j
                continue
            if stop_brace:
                if c == '{':
                    depth += 1
                elif c == '}':
                    if depth == 0:
                        return i
                    depth -= 1
            i += 1
        return i

    def simple(self, i):
        s, n = self.s, self.n
        q = s[i]
        j = i + 1
        while j < n:
            c = s[j]
            if c == '\\':
                j += 2
                continue
            if c == q:
                return j + 1
            if c == '\n':
                return j
            j += 1
        return j

    def tmpl(self, i):
        s, n = self.s, self.n
        j = i + 1
        while j < n:
            c = s[j]
            if c == '\\':
                j += 2
                continue
            if c == '`':
                return j + 1
            if c == '$' and j + 1 < n and s[j + 1] == '{':
                j = self.code(j + 2, stop_brace=True) + 1
                continue
            j += 1
        return j


def wrap_all(src):
    """遞迴改寫：回傳 (新程式碼, 包了幾個)。巢狀樣板會被正確處理。"""
    cnt = [0]

    def code(i, stop_brace=False):
        out = []
        n = len(src)
        depth = 0
        while i < n:
            c = src[i]
            if c == '/' and i + 1 < n and src[i + 1] == '/':
                j = src.find('\n', i)
                j = n if j < 0 else j
                out.append(src[i:j]); i = j; continue
            if c == '/' and i + 1 < n and src[i + 1] == '*':
                j = src.find('*/', i + 2)
                j = n if j < 0 else j + 2
                out.append(src[i:j]); i = j; continue
            if c in '"\'':
                j = simple_end(i)
                lit = src[i:j]
                out.append(wrap(lit)); i = j; continue
            if c == '`':
                new, j = tmpl(i)
                out.append(new); i = j; continue
            if stop_brace:
                if c == '{':
                    depth += 1
                elif c == '}':
                    if depth == 0:
                        out.append(c)
                        return ''.join(out), i + 1
                    depth -= 1
            out.append(c); i += 1
        return ''.join(out), i

    def simple_end(i):
        q = src[i]; j = i + 1; n = len(src)
        while j < n:
            if src[j] == '\\':
                j += 2; continue
            if src[j] == q:
                return j + 1
            if src[j] == '\n':
                return j
            j += 1
        return j

    def tmpl(i):
        """回傳 (改寫後的樣板字串, 結束索引)。"""
        n = len(src)
        body = ['`']
        j = i + 1
        while j < n:
            c = src[j]
            if c == '\\':
                body.append(src[j:j + 2]); j += 2; continue
            if c == '`':
                body.append('`'); j += 1; break
            if c == '$' and j + 1 < n and src[j + 1] == '{':
                inner, k = code(j + 2, stop_brace=True)
                body.append('${' + inner.rstrip('}') + '}')
                j = k
                continue
            body.append(c); j += 1
        lit = ''.join(body)
        return wrap(lit), j

    def wrap(lit):
        if not CJK.search(lit):
            return lit
        cnt[0] += 1
        return 'T(' + lit + ')'

    new, _ = code(0)
    return new, cnt[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--file', nargs='*', default=None)
    args = ap.parse_args()
    files = args.file or DEFAULT_FILES
    total = 0
    for rel in files:
        path = os.path.join(ROOT, rel)
        src = io.open(path, encoding='utf-8').read()
        new, c = wrap_all(src)
        if new != src:
            if not args.dry:
                io.open(path, 'w', encoding='utf-8').write(new)
            total += c
            print(f"{'[dry] ' if args.dry else ''}{rel}: 包了 {c} 個字串")
    print(f"總計 {total} 個")


if __name__ == '__main__':
    main()
