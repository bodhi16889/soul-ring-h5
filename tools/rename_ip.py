#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性去識別化改名：把《斗羅大陸》專有名詞換成原創詞。

用法：/usr/bin/python3 tools/rename_ip.py [--dry]
可重複執行（已改過的詞不會再匹配）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 長的先換，避免「紅靈環」被「靈環」先吃掉
MAP = [
    # 階級（先換長字串）
    ('紅靈環', '紅靈環'),
    ('黑靈環', '黑靈環'),
    ('紫靈環', '紫靈環'),
    ('黃靈環', '黃靈環'),
    ('白靈環', '白靈環'),
    # 靈印／技能
    ('巨靈槌', '巨靈槌'),
    ('巨靈九式', '巨靈九式'),
    ('赤焰鳶', '赤焰鳶'),
    ('焰羽燎原', '焰羽燎原'),
    ('青藤', '青藤'),
    ('藤蔓纏繞', '藤蔓纏繞'),
    ('惑心狐', '惑心狐'),
    ('惑心領域', '惑心領域'),
    ('玄甲龜', '玄甲龜'),
    ('甲冑真身', '甲冑真身'),
    ('鐵背熊', '鐵背熊'),
    ('震山咆哮', '震山咆哮'),
    ('琉璃塔', '琉璃塔'),
    ('琉璃灌頂', '琉璃灌頂'),
    ('甘露囊', '甘露囊'),
    ('甘露回春', '甘露回春'),
    ('幽影貓', '幽影貓'),
    ('影襲爪', '影襲爪'),
    ('怒潮戟', '怒潮戟'),
    ('怒潮席捲', '怒潮席捲'),
    ('無名靈師', '無名靈師'),
    # 場景
    ('青岩學院', '青岩學院'),
    ('幽篁林', '幽篁林'),
    ('鐵砧城', '鐵砧城'),
    ('霜火雙泉', '霜火雙泉'),
    ('潮汐島', '潮汐島'),
    ('靈印城', '靈印城'),
    ('斷刃之城', '斷刃之城'),
    ('裂隙', '裂隙'),
    # 靈獸（保留原創名，只把「年份」欄位換成階級字）
    ('嘯風猿', '嘯風猿'),
    ('纏魂藤蛇', '纏魂藤蛇'),
    ('織影蛛', '織影蛛'),
    ('暗金裂爪熊', '暗金裂爪熊'),
    ('深海巨鯨', '深海巨鯨'),
    # 通用詞（最後才換單詞）
    ('靈印', '靈印'),
    ('靈環', '靈環'),
    ('靈骨', '靈骨'),
    ('靈幣', '靈幣'),
    ('靈獸', '靈獸'),
    ('靈技', '靈技'),
    ('靈力', '靈力'),
    ('靈師', '靈師'),
    ('命印', '命印'),
    ('獵靈', '獵靈'),
]

TARGETS = ['index.html', 'README.md', 'css/style.css']
for sub in ('js', 'tests'):
    d = os.path.join(ROOT, sub)
    if os.path.isdir(d):
        TARGETS += [os.path.join(sub, f) for f in sorted(os.listdir(d))
                    if f.endswith(('.js', '.py', '.css', '.html'))]



def main():
    dry = '--dry' in sys.argv
    total = 0
    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        s = io.open(path, encoding='utf-8').read()
        orig = s
        hits = {}
        for old, new in MAP:
            n = s.count(old)
            if n:
                s = s.replace(old, new)
                hits[old] = n
        if s != orig:
            if not dry:
                io.open(path, 'w', encoding='utf-8').write(s)
            cnt = sum(hits.values())
            total += cnt
            print(f"{'[dry] ' if dry else ''}{rel}: {cnt} 處 " +
                  ", ".join(f"{k}×{v}" for k, v in list(hits.items())[:6]))
    print(f"\n{'（未寫入）' if dry else ''}總計 {total} 處")


if __name__ == '__main__':
    main()
