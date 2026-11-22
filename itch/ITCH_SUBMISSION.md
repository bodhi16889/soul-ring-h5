# itch.io 上架（Spirit Ring Idle）

> 這份是 **itch 專用包**，與 GamePix 包同一套原始碼，差別只在「不接 GamePix SDK」。
> GamePix SDK 只能在 GamePix Player 內執行；在 itch 上載入別家廣告 SDK 兩邊條款都不允許。

## 一、上傳檔案

```
dist/spirit-ring-idle-itch.zip
  8 個檔案 · index.html 在根目錄 · 零外部網址
  不含 js/gamepix.js（已從 index.html 移除引用）
```

重新打包：`/usr/bin/python3 tools/build_itch.py`
（會自動驗證：根目錄有 index.html、零外部網址、無 alert/confirm/prompt/gtag、無 GamePix SDK 字樣）

## 二、itch 頁面欄位（照填）

| 欄位 | 值 |
|---|---|
| Title | **Spirit Ring Idle** |
| Project URL | `spirit-ring-idle`（產生 `<你的帳號>.itch.io/spirit-ring-idle`） |
| Classification | **Game** |
| Kind of project | **HTML** |
| Pricing | **No payments**（先免費）或「$0 or donate」 |
| Uploads | 上傳 `spirit-ring-idle-itch.zip`，勾 **「This file will be played in the browser」** |
| Embed | 建議 **不勾「Embed in page」**（直式遊戲在 960×600 的 iframe 裡會很小） |
| Mobile friendly | ✔ 勾（本作支援觸控，viewport-fit=cover 已處理瀏海） |
| Orientation | 直式（Portrait） |
| Fullscreen button | ✔ 勾（讓玩家能全螢幕玩） |
| Cover image | `itch/assets/cover-630x500.png`（630×500，116 KB） |
| Screenshots | `gamepix/assets/screenshots/01-battle.png` … `05-*.png`（1080×1920，至少 3 張） |
| Genre | **Simulation** 或 **Strategy** |
| Tags | `idle` `incremental` `auto-battler` `rpg` `clicker` `cultivation` `pixel-art` `html5` `singleplayer` |
| Inputs | Mouse ✔、Touch ✔、Keyboard ✘ |
| Accessibility | 可勾「Subtitles」不用；其他留空 |

### 說明文字（直接貼）

**Short description（一句話）**
```
An idle cultivation RPG: five spirits auto-battle, you fuse rings and rebirth for permanent power.
```

**Description**
```
Five spirits fight for you — you spend the loot.

Awaken spirits, hunt beasts for rings, fuse three rings of the same tier into the next tier,
and rebirth when progress stalls to earn permanent Marks. Nine ring slots per spirit,
element resonance, and true-body bonuses stack: every system multiplies instead of adding,
so the numbers actually move.

Features
- Auto-battle that keeps running while you're away (up to 12 hours of offline progress)
- 9 ring slots per spirit, 5 ring tiers, 3-level fusion
- Element resonance and true-body bonuses
- Rebirth (prestige) with permanent Marks and deeper stages
- Daily quests, achievements, milestones, and a records wall
- WebAudio sound effects with an on/off switch — no audio files to download
- Runs entirely in the browser. Nothing to install.

Made with vanilla JavaScript and zero build step. Save codes let you move progress between devices.

Thanks for playing — feedback on pacing (is it too slow around stage 100?) is very welcome.
```

**Controls（itch 的 "Controls" 欄位）**
```
Everything is tap / click. Use the bottom tabs to switch between Battle, Spirits, Rings, Hunt and Awaken.
```

## 三、上架流程（5 分鐘）

1. 登入 itch.io → **Dashboard → Create new project**
2. 依上表填 Title / URL / Classification / Kind of project = **HTML**
3. **Uploads**：上傳 ZIP → 勾「This file will be played in the browser」
4. **Embed options**：確認「Embed in page」未勾、勾「Fullscreen button」與「Mobile friendly」
5. 上傳 Cover 與 Screenshots，貼上 Description
6. Visibility 先設 **Draft → 自己開連結測試 → 改 Restricted/Public**
7. 發佈後用 `https://<帳號>.itch.io/spirit-ring-idle` 實測一次（手機也要）

## 四、發佈後要驗的事

- [ ] 直式畫面在 itch 的 iframe / fullscreen 都正常（本機已用 960×600、1280×800、390×844 驗過）
- [ ] 載入畫面會消失（itch 版沒有 SDK，靠 `hideLoading()` 收尾）
- [ ] 存檔會寫進 localStorage，重整後進度還在
- [ ] 沒有任何外部請求（本機實測 0 筆）
- [ ] 手機開啟後底部頁籤不會被瀏海遮住

## 五、與 GamePix 版的差異（只有三處）

| 差異 | GamePix | itch |
|---|---|---|
| GamePix SDK | `<head>` 靜態載入 | **完全移除** |
| 廣告 | `adsAllowed` 在 Player 內為 true | 無廣告（`GP` 不存在） |
| 載入畫面收尾 | `GP.loaded()` | `hideLoading()`（ui.js 的 else 分支） |

其餘（存檔、i18n、音效、成就、靈環、轉生）完全相同；本機 109 項測試仍全過。
