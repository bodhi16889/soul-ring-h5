/* ==========================================================================
 * i18n.js — 語系層（GamePix 規則：預設英文，只有明確 ?lang=zh 才給中文）
 *
 * 用法：
 *   T('戰鬥')                  → 'Battle'（查表）
 *   T(`第 ${n} 關`)            → 'Stage n'（查表失敗時套規則）
 *   P(obj, 'name')             → 依語系取 obj.name_en / obj.name
 *
 * 不要在遊戲邏輯裡判斷語系；一律呼叫這裡。
 * ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'soulring.lang';
  var pref = null;
  try { pref = localStorage.getItem(KEY); } catch (e) { pref = null; }
  var m = /[?&]lang=([a-zA-Z-]+)/.exec(location.search || '');
  // 網址參數 > 玩家自己選過的 > 預設英文（GamePix 規則：非支援語系一律英文）
  var LANG = m ? ((m[1] || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en')
               : (pref === 'zh' ? 'zh' : 'en');

  function setLang(lang) {
    try { localStorage.setItem(KEY, lang === 'zh' ? 'zh' : 'en'); } catch (e) {}
    var url = location.pathname + location.search.replace(/[?&]lang=[a-zA-Z-]+/g, '');
    location.replace(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'lang=' +
                     (lang === 'zh' ? 'zh' : 'en'));
  }

  /* ---------- 靜態字串表（中文 → 英文） ---------- */
  var EN = {
    /* 通用 */
    '戰鬥': 'Battle', '靈印': 'Spirits', '靈環': 'Rings', '獵靈': 'Hunt', '覺醒': 'Awaken',
    '設定': 'Settings', '關閉': 'Close', '取消': 'Cancel', '確定': 'OK', '返回': 'Back',
    '戰力': 'Power', '攻擊': 'ATK', '生命': 'HP', '防禦': 'DEF', '速度': 'SPD',
    '等級': 'Lv', '經驗': 'EXP', '靈幣': 'Coins', '鑽石': 'Gems', '覺醒券': 'Tickets',
    '上陣': 'Deploy', '下陣': 'Remove', '上陣中': 'In team', '上陣人數': 'Team size',
    '強攻型': 'Attacker', '控制型': 'Controller', '防禦型': 'Defender', '輔助型': 'Support',
    '無名靈師': 'Nameless Master', '靈師': 'Spirit Master',
    '已達五人小隊上限': 'Team is full (5)',
    '上陣人數越多，掛機收益越高。解鎖需靈幣與等級。':
      'More spirits on the team means more idle income. Unlocking costs coins and levels.',

    /* 戰鬥 */
    '掛機效率': 'Idle rate', '清怪': 'Cleared', '野生靈獸': 'Wild beast',
    '全隊倒下': 'Team wiped', '全隊倒下，2 秒後自動重整': 'Team wiped — regrouping in 2s',
    '境界提升': 'Level up', '靈印重新凝聚，繼續戰鬥': 'Spirits reformed — back in the fight',
    '群攻命中': 'AoE hits',
    '擊殺靈獸': 'Beast slain',
    '等級提升': 'Level up',
    '守關靈獸出現，可以挑戰 BOSS 了': 'Stage boss appeared — ready to challenge',
    '挑戰 BOSS': 'Challenge boss',
    '群攻命中 2 隻靈獸': 'AoE hit 2 beasts',
    '群攻命中 3 隻靈獸': 'AoE hit 3 beasts',

    /* 武魂頁 */
    '魂環槽': 'Ring slots', '靈環槽': 'Ring slots',
    '真身': 'True body', '共鳴': 'Resonance',
    '裝備靈環': 'Equip ring', '換靈骨': 'Swap bone', '裝靈骨': 'Equip bone',
    '卸下': 'Unequip', '升星': 'Star up',
    '靈骨：無': 'Bone: none', '靈骨': 'Spirit bones',
    '未裝備': 'Unequipped', '已裝備': 'Equipped',
    '全屬性': 'All stats',
    '靈骨裝備給靈印：裝備者吃全額加成，同隊其他靈印獲得 30% 光環。靈印升星會消耗未裝備的靈骨。':
      'Soul bones go on a spirit: the holder gets the full bonus, the rest of the team gets a 30% aura. Star-ups consume unequipped bones.',

    /* 轉生 */
    '轉生': 'Rebirth', '命印': 'Marks', '歷史最高': 'Best stage',
    '目前加成': 'Current bonus', '這次轉生可得': 'This rebirth grants',
    '收益': 'Income',
    '轉生會重置等級／關卡／靈幣；靈印、星級、靈骨、靈環、命印都會保留。':
      'Rebirth resets level, stages and coins. Spirits, stars, bones, rings and marks are kept.',

    /* 靈環頁 */
    '背包': 'Bag', '等級上限': 'Level cap', '靈環合成': 'Ring fusion',
    '3 個同階 → 1 個高一階（不會動已裝備的）':
      '3 of a grade → 1 of the next grade (equipped rings are untouched)',
    '一鍵合成（白・黃・紫・黑 全部合到不能再合）':
      'Fuse all (white / yellow / violet / black, as far as possible)',
    '合成': 'Fuse', '被動：純屬性增幅（無靈技）': 'Passive: stats only (no skill)',
    '靈環只能裝在對應靈印身上；每 10 級開 1 個靈環槽（最多 9 格）。3 個同階可合成 1 個更高階。':
      'Rings fit the spirit that dropped them. One slot unlocks every 10 levels (max 9). Fuse 3 of a grade into the next.',
    '白靈環': 'White ring', '黃靈環': 'Yellow ring', '紫靈環': 'Violet ring',
    '黑靈環': 'Black ring', '紅靈環': 'Red ring',
    '風系': 'Wind', '木系': 'Wood', '毒系': 'Poison', '土系': 'Earth', '水系': 'Water',

    /* 獵靈 */
    '掉落': 'Drops', '進入獵殺': 'Hunt', '十年': 'White', '百年': 'Yellow',
    '千年': 'Violet', '萬年': 'Black', '十萬年': 'Red',
    '擊敗靈獸可獲得靈環；年份越高，屬性加成越強。':
      'Beat spirit beasts for rings. Higher grades give stronger bonuses.',
    '嘯風猿': 'Howling Ape', '纏魂藤蛇': 'Tangle Viper', '織影蛛': 'Shade Weaver',
    '暗金裂爪熊': 'Darkgold Clawbear', '深海巨鯨': 'Abyss Whale',
    '幽篁林': 'Hollow Grove', '青岩學院': 'Blue Rock Academy', '鐵砧城': 'Anvil City',
    '霜火雙泉': 'Frostfire Springs', '潮汐島': 'Tidal Isle', '靈印城': 'Spirit City',
    '斷刃之城': 'Broken Blade City', '裂隙': 'The Rift',
    '後山': 'Backhill', '外圍': 'Outskirts', '競技場': 'Arena', '試煉之路': 'Trial Path',
    '擂台': 'Platform', '深淵': 'Abyss',

    /* 抽卡／簽到 */
    '覺醒殿': 'Awaken Shrine', '靈印殿': 'Spirit Shrine',
    '每日簽到': 'Daily check-in', '連續': 'Streak', '領取': 'Claim',
    '覺醒一次': 'Pull ×1', '十連覺醒': 'Pull ×10', '兌換': 'Redeem',
    '機率：靈印 ★5 3% · ★4 12% · ★3 以下 70% · 靈骨 15%（每抽）':
      'Rates per pull: spirit ★5 3% · ★4 12% · ★3 or lower 70% · spirit bone 15%',
    '測試兌換碼：': 'Test codes: ',
    '今日簽到可領取': "Today's check-in is ready",
    '天': 'd', '鑽石': 'Gems', '靈幣3000': '3000 coins', '鑽石120': '120 gems',
    '覺醒券2': '2 tickets', '靈幣12000': '12000 coins', '鑽石500': '500 gems',

    /* 靈印名稱 */
    '巨靈槌': 'Colossus Hammer', '赤焰鳶': 'Ember Kite', '青藤': 'Verdant Vine',
    '惑心狐': 'Heartfox', '玄甲龜': 'Obsidian Turtle', '鐵背熊': 'Ironback Bear',
    '琉璃塔': 'Glazed Pagoda', '甘露囊': 'Dew Pouch', '幽影貓': 'Shadow Cat',
    '怒潮戟': 'Tide Halberd',
    '巨靈九式': 'Ninefold Smash', '焰羽燎原': 'Ember Wings', '藤蔓纏繞': 'Vine Bind',
    '惑心領域': 'Heart Domain', '甲冑真身': 'Ironclad Body', '震山咆哮': 'Mountain Roar',
    '琉璃灌頂': 'Glaze Blessing', '甘露回春': 'Dew Mend', '影襲爪': 'Shadow Claw',
    '怒潮席捲': 'Tide Surge',
    '巨靈九式': 'Ninefold Smash', '焰羽燎原': 'Ember Wings', '藤蔓纏繞': 'Vine Bind',
    '惑心領域': 'Heart Domain', '甲冑真身': 'Ironclad Body', '震山咆哮': 'Mountain Roar',
    '琉璃灌頂': 'Glaze Blessing', '甘露回春': 'Dew Mend', '影襲爪': 'Shadow Claw',
    '怒潮席捲': 'Tide Surge',
    '對全體敵人造成 200% 攻擊傷害': 'Hits every enemy for 200% ATK',
    '對單體造成 200% 傷害並灼燒': '200% damage to one target and burns it',
    '單體 60% 傷害，40% 機率暈眩 1 回合': '60% damage, 40% chance to stun for a turn',
    '全體 45% 傷害，命中者減速 30%': '45% to all, slowing what it hits by 30%',
    '嘲諷 1 回合，全隊獲得護盾': 'Taunts for a turn and shields the team',
    '嘲諷並降低敵方攻擊 20%': 'Taunts and cuts enemy ATK by 20%',
    '全隊攻擊 +40%、回復 25% 生命': 'Team ATK +40% and heals 25% HP',
    '回復生命最低的隊友 40% 生命': 'Heals the weakest ally for 40% HP',
    '對單體造成 230% 傷害': '230% damage to one target',
    '全體 110% 傷害，無視 30% 防禦': '110% to all, ignoring 30% DEF',
    '靈技 · 神滅': 'Skill · Annihilation', '靈技 · 震懾': 'Skill · Dread',
    '靈技 · 千軍': 'Skill · Myriad',
    '外附靈骨': 'Soul Bone', '疾風': 'Gale', '王者': 'King',

    /* 存檔／設定 */
    '自動挑戰 BOSS': 'Auto-challenge boss', '自動獵靈': 'Auto-hunt',
    '自動裝備靈環': 'Auto-equip rings', '自動合成低階環': 'Auto-fuse low rings',
    '匯出存檔碼': 'Export save code', '匯入存檔碼': 'Import save code',
    '版本': 'Version', '最高關卡': 'Best stage',
    '重置全部進度': 'Reset all progress',

    /* 片段（混合字串用；長的先換） */
    '魂': 'S', '裝到': 'Equip to', '券': 'tickets', '標題': 'Title',
    '風': 'Wind', '水': 'Water', '木': 'Wood', '土': 'Earth', '毒': 'Poison',
    '靈印城 · 擂台': 'Spirit City · Platform', '幽篁林': 'Hollow Grove',
    '看廣告領 888 靈幣': 'Watch an ad for 888 coins',
    '測試兌換碼：VIP666、DOULUO888、TANG3': 'Test codes: VIP666, DOULUO888, TANG3',
    '輸入兌換碼': 'Enter code', '領取今日獎勵': "Claim today's reward",
    '廣告載入中…': 'Loading ad…', '獎勵已發放：+888 靈幣': 'Reward granted: +888 coins',
    '廣告未完成，沒有獎勵': 'Ad not completed — no reward',
    '存檔損毀，已建立新檔': 'Save was corrupted — a new one was created',
    '今日簽到可領取 🎁': "Today's check-in is ready 🎁",
    '連續簽到有獎': 'Daily streak rewards',
    '今天已簽到 · 明天再來': 'Checked in today · come back tomorrow',
    '兌換成功：': 'Redeemed: ', '靈師': 'Spirit Master', '屬性共鳴': 'element resonance', '靈技': 'Skill', '靈技：': 'Skill: ', '無靈環': 'No rings',
    '還沒有靈骨。到「覺醒」抽卡有機會抽到靈骨。': 'No soul bones yet. Pull on the Awaken tab for a chance.',
    '還沒有靈環。到「獵靈」擊敗靈獸，就能吸收第一枚靈環。': 'No rings yet. Beat a spirit beast in Hunt to absorb your first ring.',
    '需': 'Needs ',
    '存檔狀態': 'Save status', '還原備份': 'Restore backup', '主檔': 'Main', '備份': 'Backup',
    '正常': 'OK', '損毀': 'corrupt', '無': 'none', '寫入失敗': 'write failed',
    '已停止自動存檔': 'autosave paused', '備份無法還原': 'Backup could not be restored',
    '主存檔損毀，已從備份還原': 'Main save was corrupt — restored from backup',
    '存檔來自較新版本，已停止自動存檔以免覆蓋':
      'Save is from a newer version; autosave paused so it is not overwritten',
    '存檔損毀，已建立新檔（舊檔已保留）': 'Save was corrupt — started fresh (old file kept)', 'BOSS 戰': 'BOSS fight',
    '若靈印頁的靈環槽顯示 /3 或等級上限是 90，代表瀏覽器還在使用舊檔：請開 ?v=2 或清快取。':
      'If the Spirits page still shows /3 ring slots or cap 90, your browser cached an old build: open ?v=2 or clear cache.',
    '存檔會自動保存在這台裝置的瀏覽器；換裝置請用存檔碼。':
      'Progress is saved in this browser. Use a save code to move to another device.', '複製': 'Copy', '匯入': 'Import', '取消': 'Cancel', '儲存': 'Save',
    '確定清除': 'Clear everything', '貼上存檔碼': 'Paste save code', '改暱稱': 'Change name',
    '匯出存檔碼': 'Export save code', '匯入存檔碼': 'Import save code',
    '存檔已匯入': 'Save imported', '已重新開始': 'Started over', '已複製': 'Copied',
    '複製整段文字，貼到新裝置的「匯入存檔碼」。':
      'Copy the whole text and paste it into Import save code on the new device.',
    '貼上存檔碼，會覆蓋目前進度。': 'Paste a save code. It overwrites your current progress.',
    '確定要清空進度嗎？此動作無法復原。': 'Clear all progress? This cannot be undone.', '已複製存檔碼': 'Save code copied',
    '已全選，請長按文字選「拷貝」': 'Selected — long-press and choose Copy',
    '按「複製」後貼到新裝置的「匯入存檔碼」；若沒反應，長按框內文字全選再複製。':
      'Tap Copy, then paste it into Import save code on the new device. If nothing happens, long-press the text and copy it manually.',
    '請長按選取複製': 'Long-press to select and copy', '成就': 'Achievements', '音效': 'Sound', '紀錄': 'Records',
    '最高戰力': 'Best power', '累計擊殺': 'Total kills', '連續簽到': 'Login streak',
    '初入魂道': 'First steps', '站穩腳跟': 'Holding ground',
    '百關之志': 'Hundred stages', '深淵行者': 'Abyss walker', '無盡之路': 'Endless road',
    '第一次轉生': 'First rebirth', '輪迴十次': 'Ten rebirths', '命印百枚': 'Hundred marks',
    '五人小隊': 'Full team', '五星圓滿': 'Five stars', '靈骨收藏家': 'Bone collector',
    '環滿全身': 'Fully ringed', '推進到第 20 關': 'Reach stage 20',
    '推進到第 50 關': 'Reach stage 50', '推進到第 100 關': 'Reach stage 100',
    '推進到第 200 關': 'Reach stage 200', '推進到第 500 關': 'Reach stage 500',
    '完成 1 次轉生': 'Rebirth once', '完成 10 次轉生': 'Rebirth 10 times',
    '累積 100 枚命印': 'Bank 100 marks', '上陣 5 名靈印': 'Field 5 spirits',
    '任一靈印升到 5★': 'Get any spirit to 5★', '持有 5 塊靈骨': 'Hold 5 soul bones',
    '全隊裝備 45 個靈環': 'Equip 45 rings', '每日任務': 'Daily tasks', '每天 0 點重置': 'Resets at midnight',
    '已領': 'Claimed', '沒有這個任務': 'No such task', '今天已領過': 'Already claimed today',
    '任務還沒完成': 'Task not finished', '掛機 10 分鐘': 'Idle for 10 minutes',
    '獵靈 3 次': 'Hunt 3 times', '合成靈環 3 次': 'Fuse rings 3 times', '已達等級上限（玩家等級 +20）': 'Level cap reached (player Lv +20)',
    '沒有這個靈印': 'No such spirit', '爆擊': 'Crit',
    '加成各自乘算：靈環（加法）→ 靈骨 → 命印 → 真身；戰力停住通常代表該轉生了':
      'Bonuses multiply separately: rings (additive) → bones → marks → true body. Marks give crit chance; speed saturates around 617.', '靈幣抽靈骨': 'Spend coins on bones', '抽 1 次': 'Pull ×1',
    '連抽 5 次（逐次計價）': 'Pull ×5 (each priced)', '抽': 'Pull',
    '王者靈骨（全屬性）較稀有；抽越多次單價越高。':
      'King bones (all stats) are rare; the price rises with every pull.',
    '還沒有靈骨。用上面的靈幣抽，或到「覺醒」抽卡。':
      'No bones yet. Buy some with coins above, or pull on the Awaken tab.',
    '靈幣不足': 'Not enough coins', '前往': 'Go', '戰力明細': 'Power breakdown',
    '會重置等級／關卡／靈幣；靈印、星級、靈骨、靈環保留':
      'Resets level, stages and coins. Spirits, stars, bones and rings are kept.',
    '加成各自乘算：靈環（加法）→ 靈骨 → 命印 → 真身；戰力停住通常代表該轉生了':
      'Bonuses multiply separately: rings (additive) → bones → marks → true body. Marks give crit chance; speed saturates around 617.', '關卡清完 · 去打靈環': 'Stage cleared · go hunt rings',
    '卡等': 'Level capped', '卡等自動獵靈': 'Auto-hunt when capped',
    '自動挑戰 BOSS': 'Auto-challenge boss', '自動裝備靈環': 'Auto-equip rings',
    '自動合成低階環': 'Auto-fuse low rings', '關': 'OFF', '開': 'ON',
    '重新開始': 'Start over', '改暱稱': 'Change name', '領取': 'Claim', '★5 滿星': '★5 Max', '滿星': 'Max',
    '靈印重新凝聚，繼續戰鬥': 'Spirits reformed — back in the fight',
  };

  /* ---------- 動態字串規則（順序敏感，長的先） ---------- */
  var AR = [
    [/^環槽 (\d+) 格 \/ 靈印$/, '$1 slots / spirit'],
    [/^已還原備份：第 (\d+) 關$/, 'Backup restored: stage $1'],
    [/^全屬性 \+(\d+(?:\.\d+)?)%$/, 'All stats +$1%'],
    [/^里程碑：第 (\d+) 關 → 獲得 (.+)$/, 'Milestone: stage $1 → $2'],
    [/^里程碑獎勵：(.+)$/, 'Milestone reward: $1'],
    [/^成就解鎖：(.+?)（(.+)）$/, 'Achievement unlocked: $1 ($2)'],
    [/^成就解鎖：(.+)$/, 'Achievement unlocked: $1'],
    [/^領 (\d+) 💎$/, 'Claim $1 💎'],
    [/^任務完成：\+(\d+) 💎$/, 'Task complete: +$1 💎'],
    [/^升級 Lv\.(\d+)（(.+)）$/, 'Level up Lv.$1 ($2)'],
    [/^Lv\.(\d+) 已滿$/, 'Lv.$1 maxed'],
    [/^已抽 (\d+) 次 · 每次必得 1 塊$/, 'Pulled $1 times · 1 bone each'],
    [/^抽到 (\d+) 塊：(.+)$/, 'Got $1 bone(s): $2'],
    [/^本輪推進：\+(\d+) 關（上次轉生在 第 (\d+) 關）$/, 'This run: +$1 stages (last rebirth at stage $2)'],
    [/^要推進到 第 (\d+) 關才能轉生$/, 'Push to stage $1 to rebirth'],
    [/^要推進到 第 (\d+) 關才能轉生（本輪 \+(\d+) 關）$/, 'Push to stage $1 to rebirth (this run: +$2)'],
    [/^可轉生：\+(\d+) 命印（全屬性 \+(\d+)%）$/, 'Rebirth ready: +$1 marks (+$2% all stats)'],
    [/^Challenge boss（(\d+) 秒後自動）$/, 'Challenge boss (auto in $1s)'],
    [/^挑戰 BOSS（(\d+) 秒後自動）$/, 'Challenge boss (auto in $1s)'],
    [/^挑戰第\s*(\d+)\s*關守關靈獸$/, 'Challenging the Stage $1 boss'],
    [/^第\s*(\d+)\s*關守關靈獸$/, 'Stage $1 boss'],
    [/^領取第\s*(\d+)\s*天獎勵（(.+)）$/, "Day $1 reward ($2)"],
    [/^第\s*(\d+)\s*天簽到：(.+)（連續 (\d+) 天）$/, 'Day $1 check-in: $2 (streak $3d)'],
    [/^連續簽到 (\d+) 天$/, 'Streak $1 days'],
    [/^需歷史最高 (\d+) 關$/, 'Best stage $1 required'],
    [/^需 Lv\.(\d+)$/, 'Needs Lv.$1'],
    [/^冷卻 (\d+)s$/, 'Cooldown $1s'],
    [/^([\d.]+) 券 \/ (\d+) 💎$/, '$1 tickets / $2 gems'],
    [/^第\s*(\d+)\s*關$/, 'Stage $1'],
    [/^第\s*(\d+)\s*天$/, 'Day $1'],
    [/^第\s*(\d+)\s*次$/, 'Rebirth #$1'],
    [/^第\s*(\d+)\s*天獎勵（(.+)）$/, 'Day $1 reward ($2)'],
    [/^清怪\s*(\d+)\/(\d+)$/, 'Cleared $1/$2'],
    [/^靈環槽\s*(\d+)\/(\d+)$/, 'Ring slots $1/$2'],
    [/^魂環槽\s*(\d+)\/(\d+)$/, 'Ring slots $1/$2'],
    [/^已裝備\s*(\d+)\/(\d+)$/, 'Equipped $1/$2'],
    [/^上陣\s*(\d+)\s*\/\s*(\d+)$/, 'Team $1/$2'],
    [/^連續\s*(\d+)\s*天$/, 'Streak $1d'],
    [/^背包\s*(\d+)\s*·\s*已裝備\s*(\d+)\s*·\s*等級上限\s*(\d+)$/,
      'Bag $1 · Equipped $2 · Cap $3'],
    [/^攻擊\s*\+(\d+)%\s*·\s*生命\s*\+(\d+)%$/, 'ATK +$1% · HP +$2%'],
    [/^真身\s*\+(\d+)%$/, 'True body +$1%'],
    [/^共鳴\s*(.+?)×(\d+)$/, 'Resonance $1×$2'],
    [/^升星（(\d+)\s*靈骨・(\d+)）$/, 'Star up ($1 bones · $2)'],
    [/^轉生（\+(\d+)\s*命印）$/, 'Rebirth (+$1 marks)'],
    [/^\+(\d+)\s*命印$/, '+$1 marks'],
    [/^（每點全屬性 \+(\d+)%、收益 \+(\d+)%）$/, '(each mark: +$1% all stats, +$2% income)'],
    [/^歷史最高：第\s*(\d+)\s*關（需 (\d+) 關）$/, 'Best stage $1 (needs $2)'],
    [/^目前加成：全屬性 \+(\d+)% · 收益 \+(\d+)%$/, 'Bonus: +$1% all stats · +$2% income'],
    [/^這次轉生可得：$/, 'This rebirth grants:'],
    [/^Lv\.(\d+)（每 10 級開 1 槽）｜(.+)$/, 'Lv.$1 (1 slot / 10 levels) · $2'],
    [/^擊殺靈獸：靈幣 \+(\d+)、經驗 \+(\d+)$/, 'Beast slain: +$1 coins, +$2 EXP'],
    [/^等級提升 → Lv\.(\d+)$/, 'Level up → Lv.$1'],
    [/^靈幣 ([\d.]+)萬\/分 · 經驗 (\d+)\/分$/, '$1M coins/min · $2 EXP/min'],
    [/^群攻命中 (\d+) 隻靈獸$/, 'AoE hit $1 beasts'],
    [/^裝到 (.+)$/, 'Equip to $1'],
    [/^(.+) · 卸下$/, '$1 · unequip'],
    [/^(.+?)（速度 \+(\d+)%）$/, '$1 (SPD +$2%)'],
    [/^(.+?)（(.+)）$/, '$1 ($2)'],
    [/^→ (.+?)（速度 \+(\d+)%）$/, '→ $1 (SPD +$2%)'],
    [/^靈骨：(.+)$/, 'Bone: $1'],
    [/^外附靈骨 · (.+)$/, 'Soul Bone · $1'],
    [/^合共 (\d+) 次$/, '$1 fusions'],
  ];

  var CJK = /[\u3400-\u9fff]/;
  var KEYS = Object.keys(EN).sort(function (a, b) { return b.length - a.length; });
  /* 這些字太容易誤傷（例如「關」出現在守關靈獸、第 12 關），只接受整串完全相符 */
  var WHOLE_ONLY = { '關': 1, '開': 1, '需': 1, '第': 1, '次': 1, '魂': 1 };

  /* 標點與單位換成英文寫法（只做全域替換，不動數字） */
  var PUNCT = [
    [/：/g, ': '], [/、/g, ', '], [/，/g, ', '], [/（/g, ' ('], [/）/g, ')'],
    [/「/g, '"'], [/」/g, '"'], [/・/g, ' / '], [/／/g, '/'],
    [/＋/g, '+'], [/[ 	]{2,}/g, ' '],
  ];

  /* 詞彙替換：把已知中文詞換成英文（長的先換），給「混合字串」用 */
  function phrase(str) {
    var out = str;
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (WHOLE_ONLY[k]) continue;
      if (out.indexOf(k) >= 0) out = out.split(k).join(EN[k]);
    }
    for (var j = 0; j < PUNCT.length; j++) out = out.replace(PUNCT[j][0], PUNCT[j][1]);
    return out;
  }

  function rulePass(str) {
    for (var i = 0; i < AR.length; i++) {
      if (AR[i][0].test(str)) return str.replace(AR[i][0], AR[i][1]);
    }
    return str;
  }

  function T(zh) {
    if (LANG !== 'en' || typeof zh !== 'string') return zh;
    if (EN[zh] != null) return EN[zh];
    var s1 = rulePass(zh);
    if (s1 !== zh) {
      if (!CJK.test(s1)) return s1;
      var s1b = phrase(s1);
      if (!CJK.test(s1b)) return s1b;
      return s1b;
    }
    var s2 = phrase(zh);
    return s2;
  }

  /* 依語系取欄位（name_en / name） */
  function P(obj, field) {
    if (!obj) return '';
    if (LANG === 'en') {
      var v = obj[field + '_en'];
      if (v != null) return v;
    }
    return obj[field] != null ? obj[field] : '';
  }

  /* 數字：中文用 萬/億，英文用 K/M/B */
  function fmt(n) {
    n = Number(n) || 0;
    var neg = n < 0; n = Math.abs(n);
    var out;
    if (LANG === 'en') {
      if (n >= 1e9) out = (n / 1e9).toFixed(1) + 'B';
      else if (n >= 1e6) out = (n / 1e6).toFixed(1) + 'M';
      else if (n >= 1e4) out = (n / 1e3).toFixed(1) + 'K';
      else out = String(Math.round(n));
    } else {
      if (n >= 1e8) out = (n / 1e8).toFixed(2) + '億';
      else if (n >= 1e4) out = (n / 1e4).toFixed(1) + '萬';
      else out = String(Math.round(n));
    }
    return (neg ? '-' : '') + out;
  }

  /* 靜態標記：<span data-i18n="戰鬥"></span> / <input data-i18n-ph="輸入兌換碼"> */
  function applyStatic(root) {
    if (LANG !== 'en') return;
    (root || document).querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      var v = T(k);
      if (v !== k) el.textContent = v;
    });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-ph');
      el.setAttribute('placeholder', T(k));
    });
    (root || document).querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-title');
      el.setAttribute('title', T(k));
    });
  }

  function boot() {
    document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-Hant';
    document.title = 'Spirit Ring Idle';
    applyStatic(document);
  }

  global.I18N = { lang: LANG, T: T, P: P, fmt: fmt, applyStatic: applyStatic, boot: boot, EN: EN, setLang: setLang };
  global.T = T;
  global.P = P;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
