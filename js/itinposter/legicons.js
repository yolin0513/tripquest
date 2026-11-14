// 行程海報（v1.90）的交通圖示：畫的，不用 emoji（Yolin 看 v1.89.0 選乙，②「路線小圖示」；Dispatch：圖示用畫的）。
// 只有使用者選過的那一段才畫（模型的 leg.mode 來自 legs.js 的 legModeOf）；「其他」沒有圖——配一個就是在猜他搭什麼，
// 跟 legs.js 地圖上用圓點、只寫「其他」同一個理由。
//
// 每一種是幾個形狀，畫在 0～100 的方格裡（版面照要畫的大小縮放）：
//   { d：SVG path（只用 M、L、Q、A、Z 和數字），fill：'col'（那一天的顏色）｜'white'｜'ink'｜null }，每一個都描粗外框（INK）。
// 只用圓角矩形、圓、橢圓、三角形、直線這幾種幾何形；座標是照這幾種形狀自己訂的，不是從任何圖庫、圖示集或 emoji 描的。
// 走路畫兩個腳印（不畫人形）；鐵路是正面的車頭；公車是側面的長方盒＋三格窗；搭車是側面的矮車身；船是帆船；飛機是由上往下看。
// 純資料：不碰 canvas、不碰 DOM；畫的是 draw.js，排位置的是 layout.js。

const circle = (cx, cy, r) => `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
const oval = (cx, cy, rx, ry) => `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
const rrect = (x, y, w, h, r) => `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} `
  + `L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;

export const LEG_GLYPH = {
  walk: [
    { d: oval(32, 50, 12, 17), fill: 'col' }, { d: circle(32, 80, 9), fill: 'col' },
    { d: oval(68, 22, 12, 17), fill: 'col' }, { d: circle(68, 52, 9), fill: 'col' },
  ],
  train: [
    { d: 'M 32 80 L 22 95 M 68 80 L 78 95 M 26 89 L 74 89', fill: null },
    { d: rrect(20, 8, 60, 72, 14), fill: 'col' },
    { d: rrect(29, 18, 42, 24, 6), fill: 'white' },
    { d: circle(35, 62, 6), fill: 'white' }, { d: circle(65, 62, 6), fill: 'white' },
  ],
  bus: [
    { d: rrect(5, 20, 90, 56, 10), fill: 'col' },
    { d: rrect(13, 29, 20, 19, 3), fill: 'white' }, { d: rrect(40, 29, 20, 19, 3), fill: 'white' }, { d: rrect(67, 29, 20, 19, 3), fill: 'white' },
    { d: circle(26, 78, 9), fill: 'ink' }, { d: circle(74, 78, 9), fill: 'ink' },
  ],
  car: [
    { d: 'M 8 70 L 8 56 Q 8 47 18 46 L 30 45 L 40 30 Q 43 26 49 26 L 65 26 Q 71 26 75 31 L 84 45 Q 92 47 92 56 L 92 70 Z', fill: 'col' },
    { d: 'M 41 45 L 48 33 L 64 33 L 70 45 Z', fill: 'white' },
    { d: circle(28, 72, 10), fill: 'ink' }, { d: circle(72, 72, 10), fill: 'ink' },
  ],
  boat: [
    { d: 'M 50 64 L 50 10', fill: null },
    { d: 'M 54 14 L 54 58 L 86 58 Z', fill: 'white' },
    { d: 'M 46 24 L 46 58 L 22 58 Z', fill: 'col' },
    { d: 'M 8 64 L 92 64 L 80 84 L 20 84 Z', fill: 'col' },
    { d: 'M 6 94 Q 17 88 28 94 Q 39 100 50 94 Q 61 88 72 94 Q 83 100 94 94', fill: null },
  ],
  // 機翼、尾翼要寬：30 px 大小時窄翼的顏色只剩一點點（v1.90 第一次量：那一天的顏色只占 2.4%）
  plane: [
    { d: 'M 38 46 L 24 8 L 44 8 L 68 46 Z', fill: 'col' }, { d: 'M 38 54 L 24 92 L 44 92 L 68 54 Z', fill: 'col' },
    { d: 'M 12 46 L 5 24 L 17 24 L 28 46 Z', fill: 'col' }, { d: 'M 12 54 L 5 76 L 17 76 L 28 54 Z', fill: 'col' },
    { d: rrect(8, 42, 86, 16, 8), fill: 'white' },
  ],
};

// 這一種方式有沒有畫的圖（「其他」、認不得的代號都沒有）
export const hasGlyph = (mode) => Object.prototype.hasOwnProperty.call(LEG_GLYPH, mode);
