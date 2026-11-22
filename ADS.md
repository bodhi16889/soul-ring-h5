# 廣告／平台 SDK 分層（ads layer）

同一份遊戲要上多個通路，SDK 的差異只允許存在 `js/ads-*.js` 裡；遊戲程式一律只認 `window.ADS`。

```
js/ads.js           門面：載入條、遮罩、廣告冷卻、暫停狀態、事件派送（gp:pause / gp:resume）
js/ads-gamepix.js   GamePix SDK v3 provider
js/ads-crazy.js     CrazyGames SDK v3 provider
（itch 版不打包任何 ads 檔；ui.js 走 hideLoading() 分支）
```

## 對外介面（`window.ADS`，同時是 `window.GP` 的別名）

| 成員 | 型別 | 說明 |
|---|---|---|
| `boot()` | void | 初始化 provider（GamePix 綁 pause/resume；CrazyGames 叫 `SDK.init()`） |
| `loading(pct)` | void | 0–100，只前進不後退 |
| `loaded()` | Promise | 收尾載入畫面；SDK 有對應 API 就等它 |
| `gameStart()` | void | 真正開始玩（GamePix `lifecycle.gameStart`／CrazyGames `gameplayStart`） |
| `interstitial()` | Promise\<{success}\> | 中場廣告（冷卻 120 秒，SDK 自己也會節流） |
| `reward()` | Promise\<{success}\> | 獎勵廣告（冷卻 600 秒，必須玩家點擊） |
| `happy(t)` / `sad(t)` | void | 遊戲時刻訊號（CrazyGames 只有 `happytime`） |
| `setPaused(v)` | void | 冪等；觸發 `gp:pause` / `gp:resume`（音效掛在這兩個事件） |
| `paused` / `adsAllowed` / `hasSdk` / `log` / `name` / `state` | getter | 診斷用 |

## 三個建置產物

| 指令 | 產物 | 內容差異 |
|---|---|---|
| `python3 tools/build_gamepix.py` | `dist/spirit-ring-idle-gamepix.zip` | `<head>` 靜態 GamePix SDK ＋ `ads.js` ＋ `ads-gamepix.js` |
| `python3 tools/build_crazygames.py` | `dist/spirit-ring-idle-crazygames.zip` | `<head>` 靜態 CrazyGames SDK ＋ `ADS_PROVIDER='crazy'` ＋ `ads.js` ＋ `ads-crazy.js` |
| `python3 tools/build_itch.py` | `dist/spirit-ring-idle-itch.zip` | 完全不含廣告層（零外部網址） |

## 加一個新通路（例：GameDistribution / Y8）

1. 新檔 `js/ads-{name}.js`，註冊到 `window.ADS_PROVIDERS[name]`，實作
   `id / hasSdk / adsAllowed / init / loading / loaded / gameStart / interstitial / reward / happy / sad / paused`。
2. `tools/build_{name}.py`：複製 `build_crazygames.py`，把 head 的 SDK 換成對方網址、
   `ADS_PROVIDER` 換名字、`INCLUDE` 換成對應的 provider 檔。
3. 選 provider：`window.ADS_PROVIDER`（建置時寫死）→ `?ads=name`（本機測試）→ host 自動判斷。
4. 契約測試：複製 `tests/test_crazy_adapter.py`，把 mock SDK 換成對方的 API，
   斷言「初始化 → loading 開始/結束 → gameplay 開始 → 廣告 request 類型」。

## 已知差異（照 docs 實作，不是猜的）

- **GamePix v3**：`lifecycle.{loading,loaded,gameStart}`、`ads.{interstitial,reward}`、`events.on('pause'|'resume')`；
  `firstInteraction` 由 SDK 自己偵測，不需呼叫。
- **CrazyGames v3**：必須 `await SDK.init()` **之後**才能呼叫其他 API（先呼叫會噴
  `CrazySDK is not initialized yet`）；`loadingStart/loadingStop`（v2 的 `sdkGameLoadingStart` 已移除）；
  `ad.requestAd('midgame'|'rewarded', {adStarted, adError, adFinished})` 是 callback 式，不是 Promise。
- **itch**：不需要任何 SDK；但要注意 `load()` 收尾不能依賴 SDK（本作用 `hideLoading()`）。
