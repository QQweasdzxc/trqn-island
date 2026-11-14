# TRQN 美島 · 3D 試玩

夕陽 voxel 浮島的真 3D 試玩版：自由環繞、縮放、點景點飛入，以及逐站導覽（自動帶看、上一個／下一個／暫停／結束、進度條、探索提示）。鳥瞰與清單模式備用。

左上角「入口」面板有兩個普通外連：學習島、TF（`main.js` 的 `ENTRIES` 設定網址；純 `<a target="_blank" rel="noopener">` 跳轉，無 iframe、無預載）。

這是獨立原型：不接正式資料、不連動任何正式服務。全部場景為程式生成，無外部素材；僅 bundled Three.js（r160，MIT，見 LICENSE）。

## 本機預覽

```
python3 -m http.server 8123
# 打開 http://127.0.0.1:8123/
```

## GitHub Pages 部署

倉庫 Settings → Pages → Branch 選 `main` / root，網址會是 `https://<帳號>.github.io/<倉庫名>/`。

## 測試用 URL 參數

- `?shot=stop1` … `?shot=stop5`：直接跳到導覽第 N 站
- `?shot=top`：鳥瞰；`?shot=list`：清單
- `&noanim=1`：關閉飛入動畫（截圖用）
- `?selftest=1`：在頁面尾端輸出 13 項互動自測結果（marker 點擊、飛行、導覽自動/暫停/繼續/上下站/結束、鳥瞰、清單、入口連結）

## 檔案

- `index.html` — UI（繁中）：標題、入口面板、模式切換、導覽卡、清單抽屜
- `main.js` — 場景：voxel 島、燈塔、TRQN 字牌、小屋、棧道、帆船、瀑布、雲海、夕陽海面；導覽狀態機；`ENTRIES` 入口設定
- `three.module.min.js`、`OrbitControls.js` — Three.js r160（MIT）
