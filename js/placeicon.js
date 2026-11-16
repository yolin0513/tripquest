// 景點類型圖示（v1.92.0；Yolin 2026-11-16：組 A 的 9 張圖示放進 App——「只給對得上景點庫類型的景點用；
// 使用者自己打字新增的景點留白」，用在行程列表、選景點這類 App 畫面，海報先不放）。
//
// 只有兩種來源拿得到圖示：
//   1. 行程裡的一站：要對得回景點庫——跟可信類別同一套檢查（js/theme.js 的 trustedTheme：curated＋placeId、那一筆還在、
//      拿名字再比一次是同一筆、建立時打的字再比一次也是同一筆）。看的是 recheck（這幾步都過了），**不是 key**：
//      景點、打卡兩類在 themes.json 換成中性的 journey，key 是 null，可是景點庫那一筆的 primary 一樣是人工整理的，照樣給圖示。
//      圖示照景點庫那一筆的 primary 挑，**不看存著的 spot.emoji／spot.theme**（存著的有的是照名字猜的，見 theme.js 的說明）。
//   2. 景點庫本身的一筆（建立行程時選景點的清單）：本來就是景點庫，直接看它的 primary。
// 對不上（自己打字新增的、改過名字的、景點庫那筆不見了、景點庫還沒載好）→ null：呼叫端照原本的畫法，不照名字猜。
// 圖檔登記在 media/art/manifest.json；這張表要跟登記一模一樣（scripts/placeicontest.mjs 驗，也驗每一張都列在 sw.js 的 SHELL_ASSETS）。

import { trustedTheme } from './theme.js';

export const PLACE_ICON = Object.freeze({
  sight: './media/art/a/sight.png',
  food: './media/art/a/food.png',
  nightmarket: './media/art/a/nightmarket.png',
  snack: './media/art/a/snack.png',
  checkin: './media/art/a/checkin.png',
  culture: './media/art/a/culture.png',
  nature: './media/art/a/nature.png',
  shopping: './media/art/a/shopping.png',
  view: './media/art/a/view.png',
});

// 景點庫的一筆 → 圖示路徑；primary 不在表上（或沒有）→ null
export function placeIconForEntry(place) {
  const p = place && place.primary;
  return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PLACE_ICON, p) ? PLACE_ICON[p] : null;
}

// 行程裡的一站 → 圖示路徑；對不回景點庫 → null。lookup 由 generate.js 的 loadPlaceLookup() 先載好，主題表由 loadThemes() 先載好；
// 兩樣沒載好，trustedTheme 回 no-lookup（recheck 是 false）→ 這裡也是 null（不另外判斷 lookup，免得兩道守同一件事、拿掉一道不會紅）
export function placeIconForSpot(spot, lookup) {
  const v = trustedTheme(spot, lookup);
  if (!v.recheck) return null;
  return placeIconForEntry(lookup.placeById(v.placeId));
}

// 畫面用的 <img>：裝飾性（名字就在旁邊），alt 空字串、不唸。圖載不到（例：離線快取沒裝好）→ 換回 fallback 那幾個字，
// 不留一個破圖框。大小由 CSS 的 .place-icon 定（跟原本表情符號那一格一樣大，列高不變）。
export function placeIconImg(src, fallback = '📍') {
  const img = document.createElement('img');
  img.className = 'place-icon';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.decoding = 'async';
  img.addEventListener('error', () => img.replaceWith(document.createTextNode(fallback)), { once: true });
  img.src = src;
  return img;
}
