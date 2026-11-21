# GamePix 送審填表 — Spirit Ring Idle

後台：`https://my.gamepix.com/games/spirit-ring-idle`
**Game Id：`il9S20`**（SDK 的 `aud` 會是 `gpx:game:il9S20`，接 SDK 時對照用）

狀態（2026-11-21 截圖）：已建立 release，Title 已填，**Orientation 未選 → 表單無法存檔**
（畫面紅字 `Please set Game Orientation and save the form.`、`Set at least one of the Desktop/Mobile Friendly options`）。

---

## 1. Info 頁（畫面這一頁）

| 欄位 | 填什麼 | 說明 |
|---|---|---|
| Game Id | `il9S20` | 系統產生，不可改；接 SDK／驗 JWT 要用 |
| Title | `Spirit Ring Idle` | 三處必須逐字一致：後台／遊戲內標題／封面字 |
| Main tag | `rpg`（沒有這個選項才用 `casual`） | 目前設 `action`，閒置 RPG 掛 action 會被放到錯的分類 |
| Add more tags（最多 4） | `idle`、`casual`、`incremental`、`strategy` | 以清單實際有的為準，優先 idle／casual |
| Orientation | `Portrait`（有 Both 且要搶桌面版位才選 Both） | 本作 9:16；640×480 橫向實測可玩但會被壓扁，選 Portrait 最安全 |
| Allow distribution | 開（綠勾） | 多通路分潤 |
| Desktop Friendly | 勾 | 滑鼠點擊即可玩 |
| Mobile Friendly | 勾 | 觸控為主 |

## 2. Assets 頁

| 用途 | 規格 | 備註 |
|---|---|---|
| Icon | **256×256**（≤ 1 MB，JPG/PNG） | 後台實測規格；64px 縮圖仍要看得出是什麼 |
| Cover | **1360×850**（≤ 1.5 MB） | 後台實測規格；上面的字必須是 `SPIRIT RING IDLE` |
| Screenshots | 3–5 張，**1080×1920** | 直式遊戲不要用 1920×1080（會一片空白） |

> 後台 Assets 頁 2026-11-21 實測就是 `Icon 256×256 / Max 1 MB`、`Cover 1360×850 / Max 1.5 MB`，
> 不要用舊教學的 512×512／1920×1080，尺寸不符不能上傳。

產生指令：`/usr/bin/python3 tools/make_assets.py`（Playwright 拍真畫面 + PIL 合成封面）。

建議截圖內容：①戰鬥（多波小怪）②靈印頁（9 環槽＋真身標記）③靈環頁（合成面板）④轉生卡＋命印 ⑤抽卡 10 連。

## 3. Editorial 頁（文案）

**Short description**

```
Idle cultivation RPG: awaken your spirits, hunt soul beasts for rings, fuse three of a tier into the next, and rebirth for permanent power. Five-spirit auto-battle, nine ring slots per spirit, gacha and endless stages.
```

**Long description**

```
Spirit Ring Idle is a one-thumb idle RPG about turning a single awakened spirit into a five-spirit team that fights for you.

Your team auto-battles through endless stages while you make the real decisions: which spirits to field, when to hunt a soul beast for a new ring, and how to spend your gems.

Every spirit unlocks one ring slot per 10 levels, up to nine. Rings come in five grades — white, yellow, violet, black and red — each adding attack and health, and the higher grades carry their own spirit skill: a group strike, a stun, or a screen-clearing finisher. Stack three rings of the same element on one spirit and the resonance boosts that element's skill by 25%; stack three, six or nine ten-thousand-year rings and the spirit manifests its true body for a flat multiplier on every stat.

Too many low-grade rings? Fuse three of the same grade into one of the next tier, or press one button to fuse everything at once.

Spend coins and gems on spirit upgrades, star-ups, soul bones and a gacha that can drop five-star spirits. Log in daily for a seven-day check-in cycle, and when a run stalls, rebirth: reset your level and stages to bank permanent marks that boost every stat and all income forever.

Easy to learn, offline progress when you close the tab, and a save code you can export to another device.
```

**Instructions**

```
Tap the tabs at the bottom to switch between Battle, Spirits, Rings, Hunt and Awaken.
Combat is automatic — your team attacks on its own.
Spirits tab: spend coins to level up, star up, and equip soul bones.
Hunt tab: fight soul beasts for new rings; each spirit gains one ring slot every 10 levels.
Rings tab: fuse three rings of the same grade into one of the next grade.
Awaken tab: pull new spirits with tickets or gems, redeem codes, and claim the daily check-in.
```

| 欄位 | 值 |
|---|---|
| Age rating | Everyone |
| Languages | English（預設）、Traditional Chinese |

## 4. Build 頁

上傳 `dist/spirit-ring-idle-gamepix.zip`：

- ZIP 根目錄是 `index.html`（可含 `css/`、`js/`，全用相對路徑）
- 唯一允許的外部網址：`https://integration.gamepix.com/sdk/v3/gamepix.sdk.js`
- 不可含：README、測試、`artifacts/`、`.git`、任何 analytics

## 5. 四件必做事項（2026-11-21 全部完成）

1. **去識別化** ✅ 靈印／靈環／靈骨／巨靈槌／赤焰鳶／青藤／玄甲龜／琉璃塔／甘露囊／幽影貓／怒潮戟
   全數換成原創詞（`tools/rename_ip.py`，516 處）。
2. **GamePix SDK v3** ✅ `js/gamepix.js`：手動 lifecycle（loading/loaded/gameStart）、
   `pause/resume`（與 Page Visibility 共用同一個開關、冪等）、插頁只在關卡之間（冷卻 120 秒）、
   獎勵廣告在覺醒頁（「看廣告領 888 靈幣」，冷卻 10 分鐘、可跳過）。
3. **英文預設** ✅ `js/i18n.js`：無 `?lang` 或非中文語系一律英文；`?lang=zh` 才中文。
   數字格式也切換（中文 萬/億、英文 K/M/B）。實測英文模式全站 0 個中文字。
4. **遊戲內標題** ✅ `<title>`、載入畫面 h1、`document.title` 都是 `Spirit Ring Idle`。

## 6. 已驗證的合規事實（本機實測）

- 全檔 0 個外部網址；0 個 `alert(`／`confirm(`／`prompt(` → 符合「No External Links」「No System Popups」
- 640×480 可玩（截圖 `artifacts/gp-640x480.png`）、1920×1080 正常、360×640 正常，console 0 error
- 戰鬥為 DOM/CSS，無 canvas 卡頓問題；存檔單一 key `soulring.save.v1`
