# GamePix 送審填表 — Spirit Ring Idle

後台：`https://my.gamepix.com/games/spirit-ring-idle`
**Game Id：`il9S20`**（SDK 的 `aud` 會是 `gpx:game:il9S20`，接 JWT 時對照用）

**本次要送的版本：v1.20.2**（2026-11-24 打包）

| 用途 | 檔案 | 大小 | sha256（前 16 碼） |
|---|---|---|---|
| **Build（ZIP）** | `dist/spirit-ring-idle-gamepix.zip` | **96,274 B** | `2d8ba510102e33f9` |
| Icon | `gamepix/assets/icon-256.png` | 44 KB ｜ 256×256 | — |
| Cover | `gamepix/assets/cover-1360x850.png` | 282 KB ｜ 1360×850 | — |
| Screenshots | `gamepix/assets/screenshots/01-battle … 05-awaken.png` | 5 張 ｜ 1080×1920 | — |

ZIP 內 10 個檔案、`index.html` 在根目錄：

```
index.html  css/style.css
js/{config,state,battle,ui,i18n,ads,ads-gamepix,sfx}.js
```

唯一外部網址：`https://integration.gamepix.com`（SDK）。

---

## 手機下載（Pages 已部署，不必 AirDrop）

```
https://bodhi16889.github.io/soul-ring-h5/dist/spirit-ring-idle-gamepix.zip
https://bodhi16889.github.io/soul-ring-h5/gamepix/assets/icon-256.png
https://bodhi16889.github.io/soul-ring-h5/gamepix/assets/cover-1360x850.png
https://bodhi16889.github.io/soul-ring-h5/gamepix/assets/screenshots/01-battle.png
（02-spirits / 03-rings / 04-rebirth / 05-awaken 同路徑）
```

---

## 1. Info 頁

| 欄位 | 填什麼 | 說明 |
|---|---|---|
| Game Id | `il9S20` | 系統產生，不可改 |
| Title | `Spirit Ring Idle` | 三處逐字一致：後台／遊戲內標題／封面字 |
| Main tag | `rpg`（沒有才用 `casual`） | 別沿用預設 `action`，會進錯分類 |
| Add more tags（最多 4） | `idle`、`casual`、`incremental` | 以清單實際有的為準 |
| Orientation | **`Portrait`** | 本作 9:16；640×480 橫向可玩但選 Portrait 最安全 |
| Desktop Friendly | 勾 | 滑鼠可玩 |
| Mobile Friendly | 勾 | 觸控為主 |
| Allow distribution | 開 | 多通路分潤 |
| Does your game save progress? | **Yes** | 用 `localStorage`（key `soulring.save.v1`） |

> Info 頁兩條紅字（`Please set Game Orientation…`／`Set at least one of the Desktop/Mobile Friendly options`）
> 沒按 **Save** 消掉，後面 Assets／Build 填了也不生效。

## 2. Assets 頁

| 用途 | 規格 | 備註 |
|---|---|---|
| Icon | **256×256**（≤1 MB） | 三層靈環主視覺，無字母；64px 縮圖仍可辨識 |
| Cover | **1360×850**（≤1.5 MB） | 上面的字**只有** `SPIRIT RING IDLE`，無標語／清單／平台字樣 |
| Screenshots | 5 張 **1080×1920** | 直式；不要用 1920×1080（會空白） |

重產指令：`/usr/bin/python3 tools/make_assets.py`（Playwright 實拍 + PIL 合成封面）。

截圖內容：①BOSS 戰（含 Speed／無盡深塔／每日副本按鈕）②靈印頁 ③靈環頁 ④轉生＋命印天賦樹 ⑤覺醒頁＋商店。

## 3. Editorial 頁

**Description（475 字元，限制 100–500）**

```
Spirit Ring Idle is a portrait idle RPG where five spirits fight for you while you are away. Awaken spirits, hunt spirit beasts for rings, fuse three rings into the next tier, and spend marks in a three-branch talent tree after every rebirth. Climb the Endless Spire, clear three daily dungeons, upgrade relics with beast cores and chase a 35-entry codex. Ten-star spirits, element sets, ring affixes and offline progress keep the numbers moving. Free, plays in your browser.
```

**How to Play（498 字元，限制 ≤500）— 整個框覆蓋，不要留後台預填的範例字**

```
Your team fights on its own; you make the build decisions.
Battle: tap Speed for 2x/3x.
Awaken: pull with tickets or gems, buy in the daily shop, claim the free ten-pull.
Spirits: equip rings into 9 slots, level up, raise stars to 10, ascend with cores.
Rings: fuse 3 of a tier into the next; reroll affixes.
Hunt beasts for rings and cores.
Rebirth resets level but keeps spirits, rings, stars and marks; spend marks on talents.
Spire and daily dungeons give tower marks, coins, cores and tickets.
```

| Age rating | Everyone |
|---|---|
| Languages | English（預設）、Traditional Chinese |

## 4. Build 頁

上傳 `dist/spirit-ring-idle-gamepix.zip` → 存檔 → **Publish**。

- 檔案大小要顯示 **96,274 B**（不是就是傳到舊檔；必要時改名再傳）
- 不要傳 GitHub 的 Download ZIP（會多一層 `xxx-main/`，報 `No index.html found in the main root`）
- 不要在 Finder 對資料夾按「壓縮」

---

## 5. 這包裝了什麼（v1.20.2）

- 5 隻靈印自動戰鬥、9 個靈環槽、靈環合成（3 同階 → 1 高一階）
- 武魂 15 隻、元素羈絆、套裝（同元素 3 隻）、覺醒階 5 級
- 星級上限 10★、武魂傳承、靈獸 10 隻（含每日精英）
- 轉生（命印）＋ **命印天賦樹**（3 分支 × 3 節點 × 5 級，可用獸核重置）
- **無盡深塔**（每日 3 次、不套橡皮筋）、**每日副本 ×3**、**靈環詞條**（爆擊／吸血／破防／迅捷）
- **商店**（每日 6 格）、**靈寶 12 件可升 5 級**、圖鑑 35、成就 40
- **戰鬥倍速 ×1/×2/×3**（敵我同步加速，結果不變）
- 離線收益明細（經驗上限 Lv80）、每日任務、每週任務、簽到

## 6. 合規實測（對解壓後的 ZIP 跑）

| 檢查 | 結果 |
|---|---|
| SDK 在 `<head>`、早於所有遊戲 JS | ✅ |
| `GamePixConfig = { lifecycle:'manual' }` 在 SDK 之前 | ✅ |
| `loading → loaded → gameStart` 都呼叫 | ✅（log：sdk present / events bound / gameStart） |
| `pause`/`resume` 註冊、音訊一起暫停 | ✅ |
| 廣告只在關卡之間；`adsAllowed` 直開頁面 false、iframe 640×480 true | ✅ |
| 640×480 可玩、無橫向溢出、觸控目標 ≥44px（導覽列原本 38px 已修） | ✅ |
| 外部請求只有 `integration.gamepix.com` | ✅ |
| 無系統彈窗／Quit／「請旋轉裝置」／analytics | ✅ |
| 預設語言英文、`<title>` 與 Title 一致 | ✅ |
| SDK 被封鎖時仍可玩、載入畫面仍會收 | ✅ |
| 解壓後實跑：擊殺有推進、存檔可寫、pageerror 0 | ✅ |

驗證腳本（17 項，對解壓後的 ZIP）：

```bash
cd ~/work/soul-ring-h5
/usr/bin/python3 tools/build_gamepix.py
rm -rf /tmp/gpcheck && mkdir -p /tmp/gpcheck
unzip -q dist/spirit-ring-idle-gamepix.zip -d /tmp/gpcheck
/usr/bin/python3 tools/verify_gamepix_zip.py /tmp/gpcheck 8840
```

## 7. 去識別化（已完成，改版時勿回退）

靈印／靈環／靈骨／巨靈槌／赤焰鳶／青藤／玄甲龜／琉璃塔／甘露囊／幽影貓／怒潮戟
全部原創詞（`tools/rename_ip.py`，516 處）。新增武魂／靈獸／靈環命名時沿用同一原則：
不要出現既有作品的專屬角色名＋專屬武器名＋專屬組織名組合。

## 8. 助手到這裡為止

GamePix 沒有公開上傳 API，登入態與 Build 覆蓋只能由你操作：

1. 手機**橫向**開 `https://my.gamepix.com`（直向只會看到「請旋轉」splash）
2. 下載上面的 ZIP → Build 頁覆蓋上傳
3. Info 兩條紅字按 Save → Editorial 覆蓋兩段文案 → Publish
4. 回報後台原話（In Review／Approved／退回原因），我依原文修正

送審後可用後台確認的四項：Status、最新 build 時間、Publish 是否已按、Review notes。
