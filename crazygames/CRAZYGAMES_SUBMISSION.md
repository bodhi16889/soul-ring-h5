# CrazyGames 送審包（Spirit Ring Idle）

> 規格來源：`docs.crazygames.com/requirements/game-covers` 與 `/requirements/technical`、
> `/requirements/ads`、`/sdk/intro`。所有尺寸與限制都是官方原文，不是二手整理。

## 一、要上傳的東西

| 項目 | 檔案 | 規格 |
|---|---|---|
| 遊戲 ZIP | `dist/spirit-ring-idle-crazygames.zip` | index.html 在根目錄，SDK 只有 `sdk.crazygames.com` |
| 橫式封面 | `crazygames/assets/cover-landscape-1920x1080.png` | **1920×1080（16:9）** 必填 |
| 直式封面 | `crazygames/assets/cover-portrait-800x1200.png` | **800×1200（2:3）** 必填 |
| 方形封面 | `crazygames/assets/cover-square-800x800.png` | **800×800（1:1）** 必填 |
| 預覽影片（橫） | **尚未製作** | 15–20 秒、1080p 16:9、無聲、無黑邊、開頭用靜態封面 |
| 預覽影片（直） | **尚未製作** | 15–20 秒、1080p 2:3、無聲 |

封面規則（違反會被退，逐條對照過）：

```
✅ 只放遊戲名稱「SPIRIT RING IDLE」
✅ 三張視覺一致（同一組靈環主視覺、同一配色）
❌ 不能有其他文字（New / Play now / 免費 / 標語）
❌ 不能加外框、不能放平台或商店 logo
❌ 不要直接用遊戲截圖（docs 明講這是最弱作法）
❌ 不能模糊或像素化
```

重新產生：`/usr/bin/python3 tools/make_crazy_covers.py`
（程序化畫五個環階級的同心發光環，不需要外部美術素材；標題自動縮字避免壓到主視覺。）

## 二、技術檢查（在送審前自己先過）

| 檢查 | 本作狀態 |
|---|---|
| SDK 在遊戲程式之前載入 | ✅ `<head>` 靜態載入 `crazygames-sdk-v3.js` |
| `await SDK.init()` 後才呼叫其他 API | ✅ `js/ads-crazy.js` 的 `ensure()` |
| `loadingStart()` / `loadingStop()` | ✅ init 後送出、`loaded()` 收尾 |
| `gameplayStart()` / `gameplayStop()` | ✅ 開場一次、廣告期間 stop/start |
| 中場廣告只在自然斷點 | ✅ 只在關卡之間（120 秒冷卻，SDK 另有 3 分鐘節流） |
| 獎勵廣告要玩家主動點 | ✅ 只出現在覺醒頁的按鈕 |
| 廣告不影響遊戲進行 | ✅ `adStarted` → `gp:pause`（音效同時 suspend） |
| 手機可玩 | ✅ viewport-fit=cover、觸控目標 44px、字級 ≥12px |
| 外部網址只有 SDK | ✅ 建置時檢查，非 `sdk.crazygames.com` 一律不過 |

## 三、頁面欄位（照填）

```
Title              Spirit Ring Idle
Genre              .io / Idle  → 選 Idle（分類以他們後台清單為準）
Controls           Mouse + Touch（單指點擊）
Orientation        Portrait
Technology         HTML5
Description        （用 itch 那份英文描述，去掉最後那句 pacing 回饋）
```

## 四、剩下的工作

1. **預覽影片**（兩支）：docs 寫「mandatory」。作法：用 Playwright 錄 15–20 秒真實遊玩
   （開場 → 戰鬥 → 靈環合成 → 覺醒），輸出 1080p；橫式與直式各一支，開頭放對應封面。
2. **QA 問卷**：後台會問暴力／賭博轉蛋／多人／廣告類型。本作：無暴力、**有轉蛋機制（抽靈印）**、
   單人、只有廣告（無內購）——轉蛋那一題要誠實勾，CrazyGames 允許但會看是否誤導未成年人。
3. **送審後**：他們會人工玩 10–15 分鐘，重點看前 3 分鐘能不能上手、有沒有引導。
   本作開場 30 秒內就會自動開打、有 toast 提示，這點沒問題。

## 五、與 GamePix 包的三處差異

| | GamePix 包 | CrazyGames 包 |
|---|---|---|
| SDK | `integration.gamepix.com` | `sdk.crazygames.com` |
| Provider | `js/ads-gamepix.js` | `js/ads-crazy.js` |
| 生命週期 | `lifecycle.loading/loaded/gameStart` | `init` → `loadingStart/Stop` → `gameplayStart` |

其餘檔案完全相同（同一份遊戲原始碼），`tests/test_crazy_adapter.py` 7 項契約測試已過。
