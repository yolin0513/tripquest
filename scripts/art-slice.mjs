// 生圖素材：把一張 N×N 的格子圖（預設 3×3 九宮格）切成一格一張（2026-11-16；流程見 docs/ART_生圖素材.md 第 9 節）
//
// 用法：node scripts/art-slice.mjs <格子圖> <輸出資料夾（要不存在或是空的）> [--grid 3（2～6）] [--names a,b,…（N×N 個英數字暫定名）] [--tol 48]
// 輸出：每一格一張 PNG（主體＋四周留白、方形、底色保留，給 art-keyout.mjs 去背）＋ _sheet.png（總表，標編號與暫定名）；
//       有壞格時另有 _missing.txt（點名哪幾格、為什麼），總表上那幾格畫叉、標 BAD。
//
// 做法（偵測間隔、不寫死座標）：
//   1. 從圖最外兩圈量底色（各通道中位數），邊框九成以上要跟它差不到 tol，不然「底色不純」停下。
//   2. 先切列：整列（幾乎）都是底色的橫線連成的一段叫「間隔」；不碰上下邊的間隔裡挑最寬的 N−1 段，各取中線切開。
//   3. 再在每一列裡各自找欄（同樣挑最寬的 N−1 段直向間隔）——模型常把各列排歪，不要求直向間隔整張上下貫通。
//      挑「最寬」不挑「最前面」：一格裡如果是兩塊分開的東西，它們中間的縫也是一段間隔，但比格子之間的窄。
//   4. 每一格量主體的外框：碰到格子邊（離邊不到 MIN_MARGIN）就是可能被切到；主體像素太少就是空格。
// 好的格照切、壞的格點名（Dispatch 2026-11-16 定；格子變多時一格出錯就整張丟掉太浪費）：
//   - 整張停、一個檔都不寫：底色不純、列數不對、橫向間隔太窄——連格子在哪都定不出來。
//   - 只標那一格：空格、碰到邊。只標那一整列：那一列找不到 N−1 段直向間隔（格數不對）或直向間隔太窄——那一列的欄定不出來。
//   - 每一格都壞也是一個檔都不寫。
//   先寫暫存資料夾、全部寫完才搬過去。
// 已知限制：--grid 設得比實際少（4×4 的圖用 --grid 3）不一定擋得下——多出來的間隔會被當成「一格裡兩塊東西的縫」，
//   可能切出一格兩個東西；靠總表逐格看。設得比實際多會擋在「列數不對」。
// 門檻都是「待驗」：照合成樣本訂的；組 A 第一次試作（3×3）沒有誤擋，見文件第 11 節。
//
// 每次執行先跑合成對照組（同一段程式；樣本先寫成 PNG 再從檔案讀回來，走真的讀檔路徑）：
//   全部放行（還要逐格核對顏色、照位置）：S1a 各列欄位錯開（整張沒有上下貫通的直向間隔）；S1b 一格裡是兩塊分開的東西；
//           S2 底色有雜訊；S2b 橫向間隔的每一條線上都有 1 個雜點（一條線容許少量雜點）；
//           S2c 空白處一對上下排的雜點（找直向間隔時零星雜點不算一段主體）；S2e 同一件事的橫向版；
//           S2d 格子邊上一個雜點（算主體外框時也不算）；S9 4×4 整齊版面（--grid 4）
//   只標壞格、其餘照切（好的格也核對顏色）：S3 第 1 列兩格黏在一起→第 1～3 格「格數不對」；S4 第 9 格碰到圖邊→「碰到邊」；
//           S7 第 5 格只有一條細線→「空格」；S10 4×4 第 2 列兩格黏在一起→第 5～8 格「格數不對」
//   整張擋、各擋在自己那一關：S5 底色是漸層→底色不純；S6 上下兩列黏在一起→列數不對；S8 間隔只有 2px→間隔太窄；
//           S11 3×3 的圖用 --grid 4 切→列數不對
//   任何一個判錯（包括擋了、但擋的理由或格子不對）就印「✗ 對照 …」、回 9、不處理真的圖。
// 回傳：0 全部切好；4 有壞格（好的照切、壞的寫在 _missing.txt）；2 用法錯；3 這張圖不能切（寫明哪一關）；9 對照組沒全對；1 其他錯誤。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharp, readRGBA, writePNG, borderBg, makeIsBg, hex, commitDir, freshDir, makeSheet } from './art-lib.mjs';

const GRID_MIN = 2, GRID_MAX = 6;
const UNIFORM = 0.9;            // 邊框要有九成跟底色相同
const LINE_TOL = 0.005;         // 一條線上容許的雜點：線長的 0.5%（至少 1 點）——還算「間隔」那一條
const NOISE_MASS = 0.0002;      // 連在一起的非間隔線，點數加起來不到整片面積的這個比例（至少 8 點）＝雜點，當成間隔
const EMPTY = 0.005;            // 主體像素不到格子面積的這個比例＝空格
const minGutter = (len) => Math.max(4, Math.round(len * 0.01));
const minMargin = (cell) => Math.max(3, Math.round(cell * 0.02));
const lineTol = (len) => Math.max(1, Math.floor(len * LINE_TOL));

function runs(flags) {
  const out = [];
  let a = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (a < 0) a = i; } else if (a >= 0) { out.push({ a, b: i }); a = -1; }
  }
  return out;
}
// counts＝一串線（橫的或直的）上各有幾個非底色的點；lineLen＝一條線多長；tolPerLine＝一條線容許幾個雜點
// 回傳每一條線是不是「間隔」。連在一起的非間隔線叫一段；整段點數加起來太少（零星雜點）也當成間隔——
// 不然空白處兩個上下排的雜點就會把「圖邊到第一個主體」那一片切成一段不碰邊、又比真的格間隔寬的「間隔」。
function gutterFlags(counts, lineLen, tolPerLine) {
  const flags = counts.map((v) => v <= tolPerLine);
  const minMass = Math.max(8, Math.round(lineLen * counts.length * NOISE_MASS));
  for (const r of runs(flags.map((f) => !f))) {
    let m = 0;
    for (let i = r.a; i < r.b; i++) m += counts[i];
    if (m < minMass) for (let i = r.a; i < r.b; i++) flags[i] = true;
  }
  return flags;
}
// 在一串「這條線是不是間隔」裡挑 n−1 刀：只看不碰兩端的間隔，挑最寬的
function pickCuts(flags, minG, n) {
  const inner = runs(flags).filter((r) => r.a > 0 && r.b < flags.length);
  if (inner.length < n - 1) return { err: 'count', found: inner.length };
  const pick = [...inner].sort((p, q) => (q.b - q.a) - (p.b - p.a)).slice(0, n - 1).sort((p, q) => p.a - q.a);
  const narrow = pick.find((r) => r.b - r.a < minG);
  if (narrow) return { err: 'narrow', w: narrow.b - narrow.a };
  return { cuts: pick.map((r) => Math.round((r.a + r.b) / 2)), widths: pick.map((r) => r.b - r.a) };
}

// 回傳 ok:false＝整張不能切（定不出格子）；ok:true＝格子定出來了，壞的格帶 err（{ kind, msg }），好的格帶 bb／margins
export function slicePlan(img, { tol, n = 3 }) {
  const bg = borderBg(img, tol);
  if (bg.uniform < UNIFORM) return { ok: false, kind: '底色不純', msg: `邊框只有 ${Math.round(bg.uniform * 100)}% 跟底色 ${bg.color ? hex(bg.color) : '透明'} 相同（要 90% 以上）：底色不是一整片同色，或有東西大面積碰到圖邊`, bg };
  const isBg = makeIsBg(img, bg, tol);
  const rowN = [];
  for (let y = 0; y < img.h; y++) { let k = 0; for (let x = 0; x < img.w; x++) if (!isBg((y * img.w + x) * 4)) k++; rowN.push(k); }
  const rc = pickCuts(gutterFlags(rowN, img.w, lineTol(img.w)), minGutter(img.h), n);
  if (rc.err === 'count') return { ok: false, kind: '列數不對', msg: `只找到 ${rc.found} 段橫向間隔（要 ${n - 1} 段）：上下兩列可能黏在一起，或 --grid 設錯`, bg };
  if (rc.err === 'narrow') return { ok: false, kind: '間隔太窄', msg: `橫向間隔只有 ${rc.w}px（至少 ${minGutter(img.h)}）`, bg };
  const ys = [0, ...rc.cuts, img.h];
  const cells = [];
  for (let r = 0; r < n; r++) {
    const y0 = ys[r], y1 = ys[r + 1], bh = y1 - y0;
    const colN = [];
    for (let x = 0; x < img.w; x++) { let k = 0; for (let y = y0; y < y1; y++) if (!isBg((y * img.w + x) * 4)) k++; colN.push(k); }
    const cc = pickCuts(gutterFlags(colN, bh, lineTol(bh)), minGutter(img.w), n);
    if (cc.err) {
      // 這一列的欄定不出來：整列的格都標壞（共用同一個理由），其他列照常
      const err = cc.err === 'count'
        ? { kind: '格數不對', msg: `第 ${r + 1} 列只找到 ${cc.found} 段直向間隔（要 ${n - 1} 段）：可能有一格是空的、或兩格黏在一起` }
        : { kind: '間隔太窄', msg: `第 ${r + 1} 列的直向間隔只有 ${cc.w}px（至少 ${minGutter(img.w)}）` };
      for (let c = 0; c < n; c++) cells.push({ r, c, y0, y1, err });
      continue;
    }
    const xs = [0, ...cc.cuts, img.w];
    for (let c = 0; c < n; c++) cells.push({ r, c, x0: xs[c], x1: xs[c + 1], y0, y1 });
  }
  for (const [k, cell] of cells.entries()) {
    if (cell.err) continue;
    const { x0, x1, y0, y1 } = cell;
    const colN = new Array(x1 - x0).fill(0), rowN = new Array(y1 - y0).fill(0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!isBg((y * img.w + x) * 4)) { colN[x - x0]++; rowN[y - y0]++; }
    const area = (x1 - x0) * (y1 - y0);
    // 主體外框：一個點也算（不放過邊上的細線），但零星雜點那幾段不算
    const gx = gutterFlags(colN, y1 - y0, 0), gy = gutterFlags(rowN, x1 - x0, 0);
    const cx = colN.map((v, i) => (gx[i] ? -1 : i)).filter((i) => i >= 0), cy = rowN.map((v, i) => (gy[i] ? -1 : i)).filter((i) => i >= 0);
    const total = cx.reduce((s, i) => s + colN[i], 0);
    if (total < EMPTY * area || !cx.length || !cy.length) { cell.err = { kind: '空格', msg: `第 ${k + 1} 格（第 ${cell.r + 1} 列第 ${cell.c + 1} 格）主體只有 ${total} 像素（格子 ${area} 像素）` }; continue; }
    const bb = { x0: x0 + cx[0], x1: x0 + cx[cx.length - 1] + 1, y0: y0 + cy[0], y1: y0 + cy[cy.length - 1] + 1 };
    const m = { 左: bb.x0 - x0, 右: x1 - bb.x1, 上: bb.y0 - y0, 下: y1 - bb.y1 };
    const need = minMargin(Math.min(x1 - x0, y1 - y0));
    const bad = Object.entries(m).filter(([, v]) => v < need);
    if (bad.length) { cell.err = { kind: '碰到邊', msg: `第 ${k + 1} 格（第 ${cell.r + 1} 列第 ${cell.c + 1} 格）主體離格子${bad.map(([s, v]) => `${s}邊 ${v}px`).join('、')}（至少 ${need}）：可能被切到` }; continue; }
    Object.assign(cell, { bb, margins: m, total });
  }
  return { ok: true, n, bg, cells, rowCuts: rc };
}

// 一行摘要（對照組比對用）：整張不能切＝那一關的名字；全部好＝'ok'；有壞格＝「理由@格號,格號」，理由照第一次出現的順序、以「；」分開
export function planSummary(plan) {
  if (!plan.ok) return plan.kind;
  const groups = new Map();
  plan.cells.forEach((c, k) => { if (c.err) { if (!groups.has(c.err.kind)) groups.set(c.err.kind, []); groups.get(c.err.kind).push(k + 1); } });
  return groups.size ? [...groups].map(([kind, ks]) => `${kind}@${ks.join(',')}`).join('；') : 'ok';
}

// 一格輸出：主體外框四周留白、補成方形；超出格子的部分填底色（不把隔壁格的東西帶進來）
export function cropCell(img, cell, bg) {
  const { bb } = cell, bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  const pad = Math.round(Math.max(bw, bh) * 0.08) + 2, S = Math.max(bw, bh) + pad * 2;
  const ox = bb.x0 - Math.round((S - bw) / 2), oy = bb.y0 - Math.round((S - bh) / 2);
  const d = Buffer.alloc(S * S * 4);
  const fill = bg.kind === 'alpha' ? [0, 0, 0, 0] : [...bg.color, 255];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const sx = ox + x, sy = oy + y, o = (y * S + x) * 4;
    if (sx >= cell.x0 && sx < cell.x1 && sy >= cell.y0 && sy < cell.y1) img.d.copy(d, o, (sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4);
    else { d[o] = fill[0]; d[o + 1] = fill[1]; d[o + 2] = fill[2]; d[o + 3] = fill[3]; }
  }
  return { w: S, h: S, d };
}

// ---------- 合成對照組 ----------
const MAG = [255, 0, 255], INK = [47, 44, 42];
const FILLS = [[242, 164, 151], [246, 210, 122], [185, 218, 165], [170, 211, 231], [210, 195, 231], [236, 230, 222], [251, 249, 245], [120, 170, 90], [90, 140, 200]];
// 4×4 用的 16 色：三個色階（70／160／240）排列組合，跳過接近洋紅與接近墨色的兩個；兩兩至少差 90，逐格核對不會認錯
const FILLS16 = [];
for (const r of [70, 160, 240]) for (const g of [70, 160, 240]) for (const b of [70, 160, 240]) {
  if ((r === 240 && g === 70 && b === 240) || (r === 70 && g === 70 && b === 70)) continue;
  if (FILLS16.length < 16) FILLS16.push([r, g, b]);
}
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvas(w, h, bgAt, noise = 0, seed = 7) {
  const d = Buffer.alloc(w * h * 4), rnd = lcg(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = bgAt(x, y), o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) d[o + k] = Math.max(0, Math.min(255, Math.round(c[k] + (noise ? (rnd() * 2 - 1) * noise : 0))));
    d[o + 3] = 255;
  }
  return { w, h, d };
}
function put(img, x, y, c) { if (x < 0 || y < 0 || x >= img.w || y >= img.h) return; const o = (y * img.w + x) * 4; img.d[o] = c[0]; img.d[o + 1] = c[1]; img.d[o + 2] = c[2]; img.d[o + 3] = 255; }
function disc(img, cx, cy, r, fill) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const dd = Math.hypot(x - cx, y - cy); if (dd <= r) put(img, x, y, dd > r - 4 ? INK : fill); } }
function box(img, x0, y0, x1, y1, c) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(img, x, y, c); }
// 版面：600×600、半徑 50 的圓。整齊版面三列三欄的圓心都在 100／300／500，間隔 99px。
// 每個樣本只放它要打的那一種狀況，其餘一律用整齊版面——樣本之間不共用零件（共用慣例 §5.3），
// 拆掉哪一道擋，就只有打那一道的樣本會紅。
const ROW_Y = [100, 300, 500];
const ALIGNED = [[100, 300, 500], [100, 300, 500], [100, 300, 500]];
const STAGGER = [[80, 300, 520], [190, 380, 530], [110, 250, 470]];   // 各列錯開：整張沒有上下貫通的直向間隔
const SHIFTED = [[210, 380, 530], [210, 380, 530], [210, 380, 530]];  // 左邊空白 160px，比兩段真的直向間隔（69、49）都寬
const GREY = [128, 128, 128];
function goodGrid({ cols = ALIGNED, rows = ROW_Y, noise = 0, twoBlob = false, mutate } = {}) {
  const img = canvas(600, 600, () => MAG, noise);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const k = r * 3 + c, x = cols[r][c], y = rows[r];
    if (mutate && mutate(img, r, c, x, y)) continue;
    if (twoBlob && k === 6) { disc(img, x - 28, y, 22, FILLS[k]); disc(img, x + 28, y, 22, FILLS[k]); }   // 第 7 格：兩塊分開的東西（中間 11px 的縫）
    else disc(img, x, y, 50, FILLS[k]);
  }
  return img;
}
// 4×4：800×800、半徑 50 的圓，圓心在 100／300／500／700，間隔 99px
const AT4 = [100, 300, 500, 700];
function goodGrid4({ mutate } = {}) {
  const img = canvas(800, 800, () => MAG);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (mutate && mutate(img, r, c, AT4[c], AT4[r])) continue;
    disc(img, AT4[c], AT4[r], 50, FILLS16[r * 4 + c]);
  }
  return img;
}
// [編號, 名稱, 預期摘要（planSummary 的格式）, 產生器, 格數]
const SAMPLES = [
  ['S1a', '各列欄位錯開', 'ok', () => goodGrid({ cols: STAGGER }), 3],
  ['S1b', '一格裡是兩塊分開的東西', 'ok', () => goodGrid({ twoBlob: true }), 3],
  ['S2', '底色有雜訊（±12）', 'ok', () => goodGrid({ noise: 12 }), 3],
  // 兩條橫向間隔裡（離圓 2px 起）每一條線上各 1 個雜點，x 每條都不同（263 跟 600 互質），所以任何一條直線上也最多 1 個。
  // 這些雜點也落在格子裡，算主體外框時要靠「零星雜點不算」——這一點跟 S2d 共用，照實寫（拆不開：格子鋪滿整張圖）
  ['S2b', '橫向間隔的每一條線上都有 1 個雜點', 'ok', () => { const g = goodGrid(); for (const [a, b] of [[153, 248], [353, 448]]) for (let y = a; y < b; y++) put(g, (y * 263) % 600, y, GREY); return g; }, 3],
  // 左邊空白處一對上下排的雜點：那一條直線有 2 點，超過一條線容許的 1 點；不濾掉，「圖邊到第一個主體」就變成一段最寬的「間隔」
  ['S2c', '空白處有一對上下排的雜點', 'ok', () => { const g = goodGrid({ cols: SHIFTED }); put(g, 60, 280, GREY); put(g, 60, 320, GREY); return g; }, 3],
  // S2c 的橫向版：上面空白處一排 4 個雜點（一條橫線容許 3 點），找橫向間隔時要濾掉
  ['S2e', '上面空白處有一排雜點', 'ok', () => { const g = goodGrid({ rows: SHIFTED[0] }); for (const x of [270, 290, 310, 330]) put(g, x, 60, GREY); return g; }, 3],
  // 第 1 格裡、離切線 2px 的單一雜點：算主體外框時不濾掉，就會判成主體碰到格子下緣
  ['S2d', '格子邊上有一個雜點', 'ok', () => { const g = goodGrid(); put(g, 100, 198, GREY); return g; }, 3],
  ['S3', '第 1 列兩格黏在一起', '格數不對@1,2,3', () => { const g = goodGrid(); box(g, 140, 95, 260, 105, FILLS[0]); return g; }, 3],
  ['S4', '第 9 格碰到圖邊', '碰到邊@9', () => goodGrid({ mutate: (g, r, c, x, y) => (r === 2 && c === 2 ? (disc(g, 562, y, 50, FILLS[8]), true) : false) }), 3],
  ['S5', '底色是漸層', '底色不純', () => { const g = canvas(600, 600, (x) => [255, Math.round(x / 4), 255 - Math.round(x / 4)]); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) disc(g, ALIGNED[r][c], ROW_Y[r], 50, FILLS[r * 3 + c]); return g; }, 3],
  ['S6', '上下兩列黏在一起', '列數不對', () => { const g = goodGrid(); box(g, 95, 140, 105, 260, FILLS[0]); return g; }, 3],
  ['S7', '第 5 格只有一條細線', '空格@5', () => goodGrid({ mutate: (g, r, c, x, y) => (r === 1 && c === 1 ? (box(g, x - 1, y - 20, x + 1, y + 20, INK), true) : false) }), 3],
  ['S8', '間隔只有 2px', '間隔太窄', () => { const g = canvas(600, 600, () => MAG); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(g, 20 + c * 188, 20 + r * 188, 20 + c * 188 + 186, 20 + r * 188 + 186, FILLS[r * 3 + c]); return g; }, 3],
  ['S9', '4×4 整齊版面', 'ok', () => goodGrid4(), 4],
  ['S10', '4×4 第 2 列兩格黏在一起', '格數不對@5,6,7,8', () => { const g = goodGrid4(); box(g, 140, 295, 260, 305, FILLS16[4]); return g; }, 4],
  ['S11', '3×3 的圖用 4×4 切', '列數不對', () => goodGrid(), 4],
];
// 一格的主要顏色是不是預期的那一個（好的格核對位置用）
function hasColor(img, c) {
  let k = 0, all = 0;
  for (let i = 0; i < img.d.length; i += 4) {
    const dd = Math.max(Math.abs(img.d[i] - MAG[0]), Math.abs(img.d[i + 1] - MAG[1]), Math.abs(img.d[i + 2] - MAG[2]));
    if (dd <= 48) continue;
    all++;
    if (Math.max(Math.abs(img.d[i] - c[0]), Math.abs(img.d[i + 1] - c[1]), Math.abs(img.d[i + 2] - c[2])) <= 24) k++;
  }
  return all > 0 && k / all >= 0.3;
}
const showSummary = (s) => (s === 'ok' ? '全部放行' : s);
export async function selfControls(sharp, tol) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-slice-ctl-'));
  let bad = 0;
  try {
    for (const [id, name, want, make, n] of SAMPLES) {
      const f = path.join(dir, `${id}.png`);
      await writePNG(sharp, make(), f);
      const img = await readRGBA(sharp, f);
      const plan = slicePlan(img, { tol, n });
      const got = planSummary(plan);
      const good = plan.ok ? plan.cells.map((cell, k) => [cell, k]).filter(([cell]) => !cell.err) : [];
      let note = plan.ok ? `${n}×${n}：好的 ${good.length} 格` : plan.msg;
      let pass = got === want;
      if (pass && plan.ok) {
        const fills = n === 4 ? FILLS16 : FILLS;
        const wrong = good.filter(([cell, k]) => !hasColor(cropCell(img, cell, plan.bg), fills[k])).map(([, k]) => k + 1);
        if (plan.cells.length !== n * n || wrong.length) { pass = false; note += `；顏色對不上的格：${wrong.join('、') || `（格數不是 ${n * n}）`}`; }
        else note += '、顏色照位置都對';
      }
      if (!pass) bad++;
      console.log(`${pass ? '✓' : '✗'} 對照 ${id} ${name}：預期「${showSummary(want)}」，實得「${showSummary(got)}」（${note}）`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return bad;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  const [input, out] = pos;
  const tol = Number(opt('--tol', 48)), n = Number(opt('--grid', 3));
  if (!input || !out || !(tol > 0 && tol < 128) || !Number.isInteger(n) || n < GRID_MIN || n > GRID_MAX) {
    console.log(`用法：node scripts/art-slice.mjs <格子圖> <輸出資料夾> [--grid 3（${GRID_MIN}～${GRID_MAX}）] [--names a,b,…] [--tol 48]`); return 2;
  }
  const total = n * n;
  const names = (opt('--names', '') || Array.from({ length: total }, (_, i) => `cell-${i + 1}`).join(',')).split(',').map((s) => s.trim());
  if (names.length !== total || new Set(names).size !== total || names.some((s) => !/^[a-z0-9-]+$/.test(s))) { console.log(`✗ --names 要 ${total} 個不重複的英數字名稱（小寫、可用 -）`); return 2; }
  const sharp = await loadSharp();
  console.log(`— 合成對照組（每次先跑；tol ${tol}）—`);
  const bad = await selfControls(sharp, tol);
  if (bad) { console.log(`✗ 對照組有 ${bad} 個判錯，不處理真的圖`); return 9; }
  console.log(`— 真的圖（${n}×${n}）—`);
  const img = await readRGBA(sharp, input);
  const plan = slicePlan(img, { tol, n });
  console.log(`圖 ${img.w}×${img.h}；底色 ${plan.bg.kind === 'alpha' ? '透明' : hex(plan.bg.color)}（邊框 ${Math.round(plan.bg.uniform * 1000) / 10}% 相同）`);
  if (!plan.ok) { console.log(`✗ ${plan.kind}：${plan.msg}；一個檔都沒寫`); return 3; }
  console.log(`橫向間隔寬 ${plan.rowCuts.widths.join('、')}px`);
  const missing = plan.cells.map((cell, k) => [cell, k]).filter(([cell]) => cell.err);
  if (missing.length === total) {
    for (const [cell, k] of missing) console.log(`  ${k + 1}. ${names[k]}：${cell.err.kind}：${cell.err.msg}`);
    console.log(`✗ ${total} 格全部不能切；一個檔都沒寫`);
    return 3;
  }
  freshDir(out);
  fs.rmdirSync(out);
  const tmp = `${out}.tmp-${process.pid}`;
  fs.mkdirSync(tmp, { recursive: true });
  const items = [];
  for (const [k, cell] of plan.cells.entries()) {
    if (cell.err) {
      items.push({ name: names[k], missing: true });
      console.log(`✗ ${k + 1}. ${names[k]}：${cell.err.kind}：${cell.err.msg}；這一格沒寫`);
      continue;
    }
    const crop = cropCell(img, cell, plan.bg);
    const f = path.join(tmp, `${names[k]}.png`);
    await writePNG(sharp, crop, f);
    items.push({ name: names[k], file: f });
    const m = cell.margins;
    console.log(`  ${k + 1}. ${names[k]}：主體 ${cell.bb.x1 - cell.bb.x0}×${cell.bb.y1 - cell.bb.y0}、輸出 ${crop.w}×${crop.h}；離格子邊 左${m.左} 右${m.右} 上${m.上} 下${m.下}`);
  }
  if (missing.length) {
    const lines = missing.map(([cell, k]) => `${k + 1}. ${names[k]}（第 ${cell.r + 1} 列第 ${cell.c + 1} 格）：${cell.err.kind}：${cell.err.msg}`);
    fs.writeFileSync(path.join(tmp, '_missing.txt'), `這幾格不能切、沒有寫出檔案（共 ${missing.length} 格，全部 ${total} 格）：\n${lines.join('\n')}\n`);
  }
  await makeSheet(sharp, items, path.join(tmp, '_sheet.png'), { cols: n });
  commitDir(tmp, out);
  if (missing.length) {
    console.log(`✗ 切好 ${total - missing.length} 格、${missing.length} 格不能切（見 _missing.txt 與總表上標 BAD 的格）→ ${out}`);
    return 4;
  }
  console.log(`切好 ${total} 格＋總表 _sheet.png → ${out}（暫定名照位置給的，逐格看過才算數）`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.log('✗ 錯誤：', e.message); process.exitCode = 1; });
}
