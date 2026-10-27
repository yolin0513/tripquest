// TripQuest 的兩個原創圖形（Yolin 2026-10-27 核准；草圖 docs/sketches/原創圖形草圖.svg 的 A／B）。
// **就這兩個，不要加第三個**——做完看效果再談。
//
//   紙飛機（日期軸的標記，停在選中那一天上面、機頭朝右＝下一天）：兩個三角形＋一條折線。
//   背包（頁首的 App 識別，標題左邊）：一條圓弧提把＋圓角矩形本體＋一條圓弧上蓋線＋圓角矩形前口袋。
//
// 為什麼它跟任何授權角色都沒有關聯：只用三角形、圓角矩形、圓弧、直線這幾種幾何形，
// **沒有臉、沒有眼睛嘴巴、沒有手腳身體**——不擬人，就不會被讀成某個角色或吉祥物；也沒有任何文字或商標。
// 形狀是照草圖自己畫的座標，不是從任何圖庫或角色描下來的。
//
// 顏色不寫死：線條用 --text、色塊用 --primary／--accent／--ok（CSS 的 .gl-* 類別），
// 深色與和紙主題各自套自己的值。純裝飾，一律 aria-hidden；意思由旁邊的字（「第 N 天」、標題）講。
// 輸入全是本檔的常數字串（同 install.js 的圖示），不接任何外來資料。

const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox, cls, inner, w, hgt) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('width', String(w));
  el.setAttribute('height', String(hgt));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('class', cls);
  el.innerHTML = inner;
  return el;
}

export function paperPlane(w = 30) {
  return svg('-3 -3 62 52', 'gl gl-plane',
    '<polygon class="gl-paper" points="0,22 56,0 30,46"/>'
    + '<polygon class="gl-wing" points="30,46 26,30 56,0"/>'
    + '<line class="gl-fold" x1="26" y1="30" x2="0" y2="22"/>',
    w, Math.round(w * 52 / 62));
}

export function backpack(hgt = 26) {
  return svg('0 0 56 64', 'gl gl-pack',
    '<path class="gl-strap" d="M14 10 Q14 2 22 2 H34 Q42 2 42 10"/>'
    + '<rect class="gl-body" x="4" y="10" width="48" height="50" rx="14"/>'
    + '<path class="gl-flap" d="M4 26 Q28 36 52 26"/>'
    + '<rect class="gl-pocket" x="16" y="38" width="24" height="15" rx="5"/>',
    Math.round(hgt * 56 / 64), hgt);
}
