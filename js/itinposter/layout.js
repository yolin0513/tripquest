// 行程海報（v1.88.0）的版面——純函式：模型＋選項 → 每一張「畫什麼」的清單（ops）。不碰 canvas、不碰 DOM。
// 字寬由呼叫的一方量（measure(text, size, weight) → px）：畫的時候用 canvas 的 measureText，node 的測試給近似值。
// 每一張另外回傳 boxes（站牌框、面板、色帶、吉祥物、對話框…的外框）：scripts/itinposterlayouttest.mjs 驗彼此不重疊、不出界。
//
// 兩種版型 × 兩種張數（決定與替代方案見 docs/STATUS.md 的 v1.88.0）：
//   route 路線圖（海報範例 3、4 那一型，拿掉地理）：一條彎曲的路從 START 走到 GOAL，每天一個站、站牌框左右交錯；
//         下面「必吃清單」（每項標 DAYn）、「小提醒」（天氣預報）。路是示意的，不照真的方位與距離（沒有地圖資料、不抓圖磚）。
//   band  分天色帶（範例 2 那一型，改成依天分帶——範例是依地區分，我們沒有可靠的地區資料）：每天一條色帶，
//         左邊「DAY N」標籤，帶裡的站用虛線箭頭串起來，有選怎麼去就寫在箭頭上；必吃寫在那一天的帶子裡；
//         第一天那一隻旁邊講一句（只講數得出來的：幾天幾夜、幾個地方）。
//   one   全部一張：寬固定，高度跟著天數長（長圖；存 PDF 就是一頁長頁，不切、不硬縮進 A4）
//   day   每天一張：每一張至少 A4 的比例，站多就往下長
// 每一天一個顏色（範例 3、4）；顏色只分天，不代表類別。
// 放不下的不默默消失：截斷的地方寫「還有 N 站／項／天」；名字太長的截成「…」（ops 的 full 留著原字，測試拿來核對來源）。
// 不出現模型以外的資料：字只有模型裡的字、數字，和固定的幾個標題（必吃清單、小提醒、START、GOAL…）。
//
// v1.89（Yolin 看 v1.88.0 實機：「太素了」，選乙；決定見 docs/STATUS.md 的 v1.89）：
//   每天一隻探頭的吉祥物（js/peeks.js 的圖；哪一隻由模型照可信資料挑，day.peek），手掌扣在那一天的框的上緣——
//   路線圖全部一張是站牌框、色帶是那一天的色帶、路線圖每天一張是第一站的卡；角落那一隻拿掉。
//   每天一張：站卡寫真資料（使用者填的時間、推算的「約幾點到」、停留多久、車程「約 N 分」），站距收緊、不再拉長填滿 A4，
//   空出來的高度給那一天的吉祥物放大（頁面照樣至少 A4，不因為站少就變短）。

import { peekGeom } from '../peeks.js';

export const PW = 1240;           // 寬（A4 在 150dpi 的寬度）
export const A4H = 1754;          // 每天一張的最小高度（A4 比例）
export const M = 56;              // 左右邊界
export const FRAME_STOPS = 4;     // 路線圖・全部一張：一個站牌框最多列幾站
export const BAND_STOPS = 12;     // 色帶：一天最多畫幾站
export const FOOD_MAX = 12;       // 必吃清單最多幾項
export const TIP_MAX = 6;         // 小提醒最多幾天
export const DAY_COLORS = ['#c9423c', '#d06a1c', '#a87a08', '#36884a', '#1b8282', '#3566b8', '#7350b8', '#b8467f'];
export const INK = '#2f2c2a';
export const SUB = '#6b6258';
export const PAPER = '#fbf6ec';
export const ROAD = '#e0d3ba';
// 探頭的吉祥物多大（px）：rise＝邊線以上最多多高、w＝最寬多寬（每一張圖的比例不同，同一個高度下烤串那張最寬，兩個上限取先碰到的）
export const PEEK_ALL = { rise: 170, w: 250 };        // 全部一張：每天的站牌框、色帶上那一隻
export const PEEK_DAY = { min: 200, max: 440 };      // 每天一張：放得進 A4 的最大那一個，介於 min 與 max 之間

// 一隻探頭圖畫多大：k＝每一個畫布單位幾 px；w、rise、sink（邊線以下伸進框裡多深）都是 px
export function peekSize(kind, maxRise, maxW) {
  const g = peekGeom(kind);
  const k = Math.min(maxRise / g.rise, maxW / g.w);
  return { k, w: g.w * k, rise: g.rise * k, sink: g.sink * k };
}
// 每天一張那一隻的高：plan(rise) 回 { h, … }（照這個高排出來整頁多高，吉祥物越高、頁面越高）。取放得進 A4 的最大那一個
// （最多 PEEK_DAY.max）——不會只為了吉祥物讓頁面多出 A4 一截；縮到 PEEK_DAY.min 還放不進，就照 min、頁面往下長（站多的那天）。
// 用二分找：手掌伸進框裡的深度也跟著吉祥物變大，「差多少就加多少」會超出 A4 幾 px
function fitPeek(plan) {
  const top = plan(PEEK_DAY.max);
  if (top.h <= A4H) return top;
  let lo = PEEK_DAY.min, hi = PEEK_DAY.max;
  if (plan(lo).h > A4H) return plan(lo);
  while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if (plan(mid).h <= A4H) lo = mid; else hi = mid; }
  return plan(lo);
}

export const colorOf = (day) => DAY_COLORS[(Math.max(1, day) - 1) % DAY_COLORS.length];
export function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 名字太長：截到放得下，結尾「…」
// （留 0.5px：框寬＝字寬＋邊距再減回去，浮點會差一點點，不能因此把剛好放得下的名字截掉——v1.88.0 預覽圖「台北1…」）
export function clipTo(measure, s, maxW, size, weight) {
  if (measure(s, size, weight) <= maxW + 0.5) return s;
  const chars = [...s];
  while (chars.length > 1 && measure(chars.join('') + '…', size, weight) > maxW) chars.pop();
  return chars.join('') + '…';
}

// 一串名字用「、」接起來，放到放不下為止；剩下的寫「還有 N 項」（不截半個名字）
export function listFit(measure, names, maxW, size, weight) {
  for (let k = names.length; k >= 1; k--) {
    const more = names.length - k;
    const t = names.slice(0, k).join('、') + (more ? `，還有 ${more} 項` : '');
    if (measure(t, size, weight) <= maxW) return { text: t, shown: k, more };
  }
  return { text: clipTo(measure, names[0] || '', maxW, size, weight), shown: names.length ? 1 : 0, more: Math.max(0, names.length - 1) };
}

function canvasOps(measure) {
  const ops = [], boxes = [];
  const c = {
    ops, boxes, _measure: measure,
    // day：這個字屬於第幾天（站名、「還有 N 站」帶著，測試逐天數「畫出來的站＋還有 N 站＝那天的站數」）
    text(t, x, y, size, { weight = 400, color = INK, align = 'left', maxW = Infinity, role = 'text', day = null, more = null } = {}) {
      const full = String(t);
      const s = clipTo(measure, full, maxW, size, weight);
      const w = measure(s, size, weight);
      ops.push({ op: 'text', x, y, text: s, full, size, weight, color, align, role, w, day, more });
      return w;
    },
    rect(x, y, w, h, { r = 0, fill = null, stroke = null, lw = 0, dash = null } = {}) { ops.push({ op: 'rect', x, y, w, h, r, fill, stroke, lw, dash }); },
    circle(x, y, r, { fill = null, stroke = null, lw = 0 } = {}) { ops.push({ op: 'circle', x, y, r, fill, stroke, lw }); },
    path(d, { stroke = null, lw = 0, dash = null, fill = null, cap = 'round' } = {}) { ops.push({ op: 'path', d, stroke, lw, dash, fill, cap }); },
    // 探頭的吉祥物：x 是圖的左緣（align 'right' → 右緣）、edgeY 是邊線（對在框的上緣）。
    // 外框兩個：peek＝邊線以上那一塊、peekfoot＝邊線以下伸進框裡的那一條（只有手掌、碗腳；測試驗它在框裡、不蓋到字）
    peek(kind, x, edgeY, maxRise, maxW, { align = 'left', day = null } = {}) {
      const s = peekSize(kind, maxRise, maxW);
      const x0 = align === 'right' ? x - s.w : x;
      ops.push({ op: 'peek', kind, k: s.k, x: x0, y: edgeY - s.rise, w: s.w, h: s.rise + s.sink, edge: edgeY, day });
      boxes.push({ kind: 'peek', x: x0, y: edgeY - s.rise, w: s.w, h: s.rise, peek: kind, day });
      boxes.push({ kind: 'peekfoot', x: x0, y: edgeY, w: s.w, h: s.sink, peek: kind, day });
      return { ...s, x: x0 };
    },
    box(kind, x, y, w, h, extra = {}) { boxes.push({ kind, x, y, w, h, ...extra }); },
    // 膠囊（DAY 1、START…）：回傳寬度
    pill(t, x, y, h, size, fill, { color = '#ffffff', align = 'left', role = 'label', weight = 800 } = {}) {
      const tw = measure(String(t), size, weight);
      const w = tw + h * 0.8;
      const x0 = align === 'center' ? x - w / 2 : x;
      this.rect(x0, y, w, h, { r: h / 2, fill });
      // 上下置中：字框的模型跟測試的檢查器同一個（基線往上 0.88、往下 0.22 個字高），框的中線在基線上方 (0.88－0.22)÷2 個字高
      this.text(t, x0 + w / 2, y + h / 2 + size * (0.88 - 0.22) / 2, size, { weight, color, align: 'center', role });
      return w;
    },
  };
  return c;
}

// ---------- 共用的幾塊 ----------

// 全部一張的標題區：標題、幾天幾夜、日期與旅伴。回傳底部的 y
function bigHeader(c, model, y0) {
  let y = y0;
  c.text(model.title, PW / 2, y + 66, 64, { weight: 800, align: 'center', maxW: PW - 2 * M, role: 'title' });
  y += 96;
  if (model.span) { c.pill(model.span.label, PW / 2, y, 60, 36, INK, { color: PAPER, align: 'center', role: 'span' }); y += 76; }
  const sub = [model.dateRange, model.people ? `旅伴 ${model.people} 人` : ''].filter(Boolean).join('｜');
  if (sub) { c.text(sub, PW / 2, y + 30, 30, { weight: 600, color: SUB, align: 'center', maxW: PW - 2 * M, role: 'sub' }); y += 48; }
  c.box('header', M, y0, PW - 2 * M, y - y0);
  return y;
}

// 每天一張的標題區：行程名（小）、DAY N＋日期、第一站 → 最後一站。回傳底部的 y
function dayHeader(c, model, d, y0) {
  const col = colorOf(d.day);
  let y = y0;
  c.text(model.title, PW / 2, y + 40, 36, { weight: 700, color: SUB, align: 'center', maxW: PW - 2 * M, role: 'title' });
  y += 64;
  const tag = `DAY ${d.day}`;
  if (d.date) {
    // 膠囊＋日期一起置中（膠囊寬＝字寬＋高度的 0.8，跟 pill 算法一樣）
    const tagW = measureOf(c)(tag, 52, 800) + 72 * 0.8;
    const dateW = measureOf(c)(d.date, 38, 700);
    const x0 = (PW - (tagW + 20 + dateW)) / 2;
    c.pill(tag, x0, y, 72, 52, col, { role: 'daytag' });
    c.text(d.date, x0 + tagW + 20, y + 50, 38, { weight: 700, color: INK, role: 'date' });
  } else {
    c.pill(tag, PW / 2, y, 72, 52, col, { align: 'center', role: 'daytag' });
  }
  y += 92;
  const route = d.stops.length > 1 ? `${d.from} → ${d.to}` : d.from;
  c.text(route, PW / 2, y + 38, 38, { weight: 800, color: col, align: 'center', maxW: PW - 2 * M, role: 'route' });
  y += 62;
  c.box('header', M, y0, PW - 2 * M, y - y0);
  return y;
}
// 置中前要先量寬：拿 canvasOps 建立時存下的 measure
const measureOf = (c) => c._measure;

// 面板高度（先算好，每天一張才知道路要拉多長）
const foodsPanelH = (n) => 84 + Math.ceil(Math.min(n, FOOD_MAX) / 2) * 52 + (n > FOOD_MAX ? 44 : 0) + 18;
const tipsPanelH = (n) => 80 + Math.min(n, TIP_MAX) * 50 + (n > TIP_MAX ? 44 : 0) + 18;

// 必吃清單面板（全寬，兩欄）。items：[{ day, name, at }]；tags：每項前面標 DAYn（每天一張的那一頁都是同一天，不標）。回傳底部的 y
function foodsPanel(c, items, y0, { title = '必吃清單', tags = true } = {}) {
  const x = M, w = PW - 2 * M;
  const shown = items.slice(0, FOOD_MAX);
  const more = items.length - shown.length;
  const rows = Math.ceil(shown.length / 2);
  const h = foodsPanelH(items.length);
  c.rect(x, y0, w, h, { r: 26, fill: '#ffffff', stroke: INK, lw: 3 });
  const hw = c.text(title, x + 30, y0 + 54, 36, { weight: 800, role: 'label' });
  c.text('（景點資料庫整理的）', x + 30 + hw + 12, y0 + 52, 22, { weight: 600, color: SUB, maxW: w - hw - 80, role: 'label' });
  const colW = (w - 60 - 28) / 2;
  shown.forEach((f, i) => {
    const cx = x + 30 + (i % 2) * (colW + 28);
    const cy = y0 + 84 + Math.floor(i / 2) * 52;
    const tw = tags ? c.pill(`DAY${f.day}`, cx, cy + 6, 36, 20, colorOf(f.day), { role: 'daytag' }) + 12 : 0;
    const nameMax = Math.max(80, (colW - tw - 2) * 0.62);
    const nw = c.text(f.name, cx + tw, cy + 34, 26, { weight: 700, maxW: nameMax, role: 'food', day: f.day });
    const rest = colW - tw - nw - 10;
    if (rest > 60) c.text(f.at, cx + tw + nw + 10, cy + 33, 21, { weight: 600, color: SUB, maxW: rest, role: 'at' });
  });
  if (more) c.text(`還有 ${more} 項`, x + 30, y0 + 84 + rows * 52 + 30, 24, { weight: 700, color: SUB, role: 'more', more });
  c.box('panel', x, y0, w, h);
  return y0 + h;
}

// 小提醒（天氣預報）。tips：[{ day, date, icon, text }]；回傳底部的 y
function tipsPanel(c, tips, asOf, y0) {
  const x = M, w = PW - 2 * M;
  const shown = tips.slice(0, TIP_MAX);
  const more = tips.length - shown.length;
  const h = tipsPanelH(tips.length);
  c.rect(x, y0, w, h, { r: 26, fill: '#ffffff', stroke: INK, lw: 3 });
  c.text(`小提醒・天氣預報（${asOf} 查）`, x + 30, y0 + 52, 32, { weight: 800, maxW: w - 60, role: 'label' });
  shown.forEach((t, i) => {
    const cy = y0 + 80 + i * 50;
    const tw = c.pill(`DAY${t.day}`, x + 30, cy + 6, 36, 20, colorOf(t.day), { role: 'daytag' });
    let cx = x + 30 + tw + 12;
    cx += c.text(t.date, cx, cy + 34, 26, { weight: 700, role: 'date' }) + 12;
    if (t.icon) cx += c.text(t.icon, cx, cy + 34, 26, { role: 'wx' }) + 10;
    c.text(t.text, cx, cy + 34, 26, { weight: t.warn ? 800 : 500, color: t.warn ? '#a3332d' : INK, maxW: x + w - 30 - cx, role: 'tip' });
  });
  if (more) c.text(`還有 ${more} 天`, x + 30, y0 + 80 + shown.length * 50 + 30, 24, { weight: 700, color: SUB, role: 'more', more });
  c.box('panel', x, y0, w, h);
  return y0 + h;
}

// 頁尾：左邊 TripQuest，右邊第幾張（多張時）
function footer(c, h, pageText) {
  c.text('TripQuest', M, h - 40, 26, { weight: 800, color: SUB, role: 'foot' });
  if (pageText) c.text(pageText, PW - M, h - 40, 24, { weight: 700, color: SUB, align: 'right', role: 'foot' });
}

// 吉祥物講一句：對話框在牠左邊、尾巴朝右指向牠。x1＝對話框連尾巴的右緣、cy＝對話框的中線
const BUBBLE_H = 84;
const bubbleW = (c, line) => measureOf(c)(line, 32, 800) + 64 + 30;
function bubble(c, line, x1, cy) {
  const tw = Math.min(measureOf(c)(line, 32, 800), x1 - M - 30 - 64);
  const bw = tw + 64, bh = BUBBLE_H;
  const bx = x1 - 30 - bw, by = cy - bh / 2;
  c.rect(bx, by, bw, bh, { r: 30, fill: '#ffffff', stroke: INK, lw: 3 });
  c.path(`M ${bx + bw - 2} ${by + 30} L ${bx + bw + 30} ${by + 46} L ${bx + bw - 2} ${by + 58}`, { fill: '#ffffff', stroke: INK, lw: 3, cap: 'round' });
  c.text(line, bx + 32, by + 54, 32, { weight: 800, maxW: tw, role: 'bubble' });
  c.box('bubble', bx, by, bw + 30, bh);
}

// 起點、終點的牌子
function flag(c, t, x, y) {
  const w = c.pill(t, x, y - 23, 46, 24, INK, { color: PAPER, align: 'center', role: 'label' });
  c.box('flag', x - w / 2, y - 23, w, 46);
}

// 一條從上到下的彎路：點跟點之間用垂直切線的三次曲線接（S 形）。回傳 path 的 d
function roadPath(points) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dy = (b.y - a.y) / 2;
    d += ` C ${a.x} ${a.y + dy} ${b.x} ${b.y - dy} ${b.x} ${b.y}`;
  }
  return d;
}
function drawRoad(c, points) {
  const d = roadPath(points);
  c.path(d, { stroke: ROAD, lw: 46 });
  c.path(d, { stroke: '#ffffff', lw: 5, dash: [18, 16] });
  // 方向：每一段中間一個往下的箭頭（三次曲線在 t＝0.5 剛好是兩端的中點）
  for (let i = 1; i < points.length; i++) {
    const mx = (points[i - 1].x + points[i].x) / 2, my = (points[i - 1].y + points[i].y) / 2;
    c.path(`M ${mx - 11} ${my - 7} L ${mx} ${my + 5} L ${mx + 11} ${my - 7}`, { stroke: '#ffffff', lw: 6 });
  }
}

// ---------- 路線圖 ----------
const FW = 440;                       // 站牌框寬
const LX = M, RX = PW - M - FW;       // 左框、右框的 x
const SXL = 566, SXR = 674, CX = 620; // 站點（靠左框／靠右框）、路的中線

// 站牌框：最上面留 22 給吉祥物伸進來的手掌（PEEK_ALL 下最深的是烤串那張，不到 19），再放 DAY 膠囊
function frameH(d) {
  const rows = Math.min(d.stops.length, FRAME_STOPS);
  return 124 + rows * 38 + (d.stops.length > FRAME_STOPS ? 38 : 0) + 20;
}

function routeAll(model, measure) {
  const c = canvasOps(measure);
  let y = bigHeader(c, model, 36);
  const n = model.days.length;
  const sz = model.days.map((d) => peekSize(d.peek, PEEK_ALL.rise, PEEK_ALL.w));
  // 同一邊上下兩個框相隔 2G：中間要放得下下面那一框上的吉祥物（邊線以上那一塊），再留 40
  const G = Math.max(150, Math.ceil((Math.max(...model.days.map(frameH)) + Math.max(...sz.map((s) => s.rise)) + 40) / 2));
  // 第一個框的上緣在 top＋70：上面要放得下第一天那一隻，離標題區 24
  const top = Math.max(y + 46, Math.ceil(y + 24 + sz[0].rise - 70));
  const st = model.days.map((d, i) => ({ x: i % 2 === 0 ? SXL : SXR, y: top + 118 + i * G, left: i % 2 === 0, d }));
  const goalY = st[n - 1].y + 118;
  drawRoad(c, [{ x: CX, y: top }, ...st, { x: CX, y: goalY }]);
  flag(c, 'START', CX, top);
  flag(c, 'GOAL', CX, goalY);
  let bottom = goalY + 23;
  for (const s of st) {
    const d = s.d, col = colorOf(d.day), fh = frameH(d);
    const fx = s.left ? LX : RX, fy = s.y - 48;
    // 站點與連到框的虛線
    if (s.left) c.path(`M ${LX + FW} ${s.y} L ${s.x - 30} ${s.y}`, { stroke: col, lw: 4, dash: [8, 8] });
    else c.path(`M ${s.x + 30} ${s.y} L ${RX} ${s.y}`, { stroke: col, lw: 4, dash: [8, 8] });
    c.circle(s.x, s.y, 30, { fill: col, stroke: '#ffffff', lw: 5 });
    c.text(String(d.day), s.x, s.y + 11, 30, { weight: 900, color: '#ffffff', align: 'center', role: 'daynum' });
    // 站牌框，和那一天的吉祥物：站在框的外側那一端（離路遠的那一邊），手掌扣在框的上緣
    c.rect(fx, fy, FW, fh, { r: 22, fill: '#ffffff', stroke: col, lw: 4 });
    c.peek(d.peek, s.left ? fx + 22 : fx + FW - 22, fy, PEEK_ALL.rise, PEEK_ALL.w, { align: s.left ? 'left' : 'right', day: d.day });
    const pw = c.pill(`DAY ${d.day}`, fx + 20, fy + 22, 50, 30, col, { role: 'daytag' });
    if (d.date) c.text(d.date, fx + 20 + pw + 14, fy + 58, 26, { weight: 700, color: SUB, maxW: FW - pw - 54, role: 'date' });
    const route = d.stops.length > 1 ? `${d.from} → ${d.to}` : d.from;
    c.text(route, fx + 22, fy + 110, 28, { weight: 800, color: col, maxW: FW - 44, role: 'route' });
    const rows = d.stops.slice(0, FRAME_STOPS);
    rows.forEach((sp, k) => {
      const by = fy + 124 + 30 + k * 38;
      c.circle(fx + 32, by - 9, 6, { fill: col });
      let tx = fx + 48;
      if (sp.time) tx += c.text(sp.time, tx, by, 24, { weight: 700, color: SUB, role: 'time', day: d.day }) + 10;
      c.text(sp.name, tx, by, 26, { weight: 600, maxW: fx + FW - 20 - tx, role: 'stop', day: d.day });
    });
    const more = d.stops.length - rows.length;
    if (more > 0) c.text(`還有 ${more} 站`, fx + 48, fy + 124 + 30 + rows.length * 38, 24, { weight: 700, color: SUB, role: 'more', day: d.day, more });
    c.box('frame', fx, fy, FW, fh, { day: d.day });
    bottom = Math.max(bottom, fy + fh);
  }
  y = bottom + 44;
  if (model.foods.length) y = foodsPanel(c, model.foods, y) + 30;
  if (model.tips.length) y = tipsPanel(c, model.tips, model.tipsAsOf, y) + 30;
  const h = y + 64;
  footer(c, h, '');
  return { w: PW, h, ops: c.ops, boxes: c.boxes };
}

// 每天一張的站卡：上面一行時間（使用者填的「幾點到」；沒填、推得出來就寫「約 HH:MM 到」）、站名、下面一行停留多久——
// 模型裡有才寫，沒有的那一行不留空。pad＝卡片頂上多留的高度（站著吉祥物的那一張，手掌伸進來的深度）
const cardTop = (sp) => sp.time || sp.eta;
const routeCardH = (sp, pad = 0) => pad + 18 + (cardTop(sp) ? 32 : 0) + 42 + (sp.stay ? 32 : 0) + 16;
function routeCard(c, sp, bx, by, w, pad, day) {
  let ty = by + pad + 18;
  if (sp.time) { c.text(sp.time, bx + 24, ty + 24, 24, { weight: 700, color: SUB, role: 'time', day }); ty += 32; }
  else if (sp.eta) { c.text(sp.eta, bx + 24, ty + 24, 24, { weight: 700, color: SUB, role: 'eta', day }); ty += 32; }
  c.text(sp.name, bx + 24, ty + 34, 32, { weight: 800, maxW: w - 48, role: 'stop', day });
  ty += 42;
  if (sp.stay) c.text(sp.stay, bx + 24, ty + 26, 22, { weight: 600, color: SUB, role: 'stay', day });
}
// 兩站之間怎麼去：圖示、方式、路線服務算的「約 N 分」（有才寫）
const legText = (leg) => [leg.icon, leg.label, leg.dur].filter(Boolean).join(' ');

function routeDay(model, d, idx, total, measure) {
  const c = canvasOps(measure);
  const col = colorOf(d.day);
  let y = dayHeader(c, model, d, 30);
  const n = d.stops.length;
  const LW = 440, PEEK_W = LW - 40;   // 吉祥物站在第一站的卡上，不超出卡（右邊就是路）
  const tip = model.tips.filter((t) => t.day === d.day);
  const after = 44 + (d.foods.length ? foodsPanelH(d.foods.length) + 30 : 0) + (tip.length ? tipsPanelH(tip.length) + 30 : 0) + 64;
  // 站距照最小的排（v1.88.0 站少的那天會把路拉長填滿 A4，留下一大片空白）。頁面還有空：先把吉祥物放大（最多 PEEK_DAY.max），
  // 放到最大（或被寬度卡住）還有空，平均加進幾段之間的空白（airOf）；站多就照最小站距、頁面往下長
  const plan = (rise) => {
    const s = peekSize(d.peek, rise, PEEK_W);
    const pad = Math.ceil(s.sink) + 8;
    const hs = d.stops.map((sp, i) => routeCardH(sp, i === 0 ? pad : 0));
    const G = Math.max(124, Math.ceil((Math.max(...hs) + 26) / 2));
    // 第一站的卡頂（吉祥物的邊線）在 top＋118－卡高／2：上面要放得下吉祥物、離標題區 24
    const top = Math.max(y + 46, Math.ceil(y + 24 + s.rise - 118 + hs[0] / 2));
    return { s, pad, hs, G, top, h: top + 118 + (n - 1) * G + 118 + 23 + after };
  };
  const p = fitPeek(plan);
  const air = airOf(p.h, 1 + (d.foods.length ? 1 : 0) + (tip.length ? 1 : 0));
  const { pad, hs, G } = p, top = p.top + air;
  const st = d.stops.map((sp, i) => ({ x: i % 2 === 0 ? SXL : SXR, y: top + 118 + i * G, left: i % 2 === 0, sp, i }));
  const goalY = st[n - 1].y + 118;
  drawRoad(c, [{ x: CX, y: top }, ...st, { x: CX, y: goalY }]);
  flag(c, 'START', CX, top);
  flag(c, 'GOAL', CX, goalY);
  let bottom = goalY + 23;
  for (const s of st) {
    const sp = s.sp, bh = hs[s.i];
    const bx = s.left ? LX : RX, by = s.y - bh / 2;
    if (s.left) c.path(`M ${LX + LW} ${s.y} L ${s.x - 24} ${s.y}`, { stroke: col, lw: 4, dash: [8, 8] });
    else c.path(`M ${s.x + 24} ${s.y} L ${RX} ${s.y}`, { stroke: col, lw: 4, dash: [8, 8] });
    c.circle(s.x, s.y, 24, { fill: col, stroke: '#ffffff', lw: 5 });
    c.text(String(s.i + 1), s.x, s.y + 9, 24, { weight: 900, color: '#ffffff', align: 'center', role: 'stopnum' });
    c.rect(bx, by, LW, bh, { r: 20, fill: '#ffffff', stroke: col, lw: 4 });
    // 那一天的吉祥物：站在第一站的卡上（卡的左邊那一端），手掌扣在卡的上緣
    if (s.i === 0) c.peek(d.peek, bx + 20, by, p.s.rise, PEEK_W, { day: d.day });
    routeCard(c, sp, bx, by, LW, s.i === 0 ? pad : 0, d.day);
    c.box('frame', bx, by, LW, bh, { day: d.day });
    bottom = Math.max(bottom, by + bh);
    // 兩站之間怎麼去（使用者選過才寫）：放在路的中間那一段上
    if (s.i > 0 && sp.leg) {
      const my = (st[s.i - 1].y + s.y) / 2;
      const w = c.pill(legText(sp.leg), CX, my - 20, 40, 22, '#ffffff', { color: INK, align: 'center', role: 'leg', weight: 700 });
      c.box('leg', CX - w / 2, my - 20, w, 40);
    }
  }
  y = bottom + 44;
  if (d.foods.length) y = foodsPanel(c, d.foods, y + air, { title: '這天的必吃', tags: false }) + 30;
  if (tip.length) y = tipsPanel(c, tip, model.tipsAsOf, y + air) + 30;
  const h = Math.max(A4H, y + 64);
  footer(c, h, `第 ${idx + 1}／${total} 張`);
  return { w: PW, h, ops: c.ops, boxes: c.boxes };
}

// 每天一張：吉祥物放到最大還不到 A4，剩下的高度平均加進 n 段之間的空白（標題與吉祥物之間、站與面板、面板與面板之間），
// 每段最多 AIR_MAX；再剩下的留在最下面（不把站距拉開——v1.88.0 那樣留下一大片空白）
const AIR_MAX = 120;
const airOf = (h, n) => (h < A4H ? Math.min(AIR_MAX, Math.floor((A4H - h) / n)) : 0);

// ---------- 分天色帶 ----------
// 一條色帶：左邊標籤（tab＝true）＋帶子裡的站與虛線箭頭＋必吃那一行。回傳底部的 y
function band(c, d, y0, { tab = true, nameSize = 28 } = {}) {
  const m = measureOf(c);
  const col = colorOf(d.day);
  const TAB = tab ? 170 : 0;
  const x0 = M + TAB + 28, x1 = PW - M - 26;
  const anyTime = d.stops.some((s) => s.time);
  const boxH = anyTime ? nameSize + 50 : nameSize + 30;
  const rowH = boxH + 30;
  const shown = d.stops.slice(0, BAND_STOPS);
  const more = d.stops.length - shown.length;
  const GAP = 74;
  // 先排位置
  const place = [];
  let cx = x0, row = 0;
  shown.forEach((sp, i) => {
    const nameW = Math.min(m(sp.name, nameSize, 700), 380);
    const timeW = sp.time ? m(sp.time, 20, 700) : 0;
    const bw = Math.max(nameW, timeW) + 36;
    if (i > 0 && cx + GAP + bw > x1) { row++; cx = x0 + 40; }
    else if (i > 0) cx += GAP;
    place.push({ sp, x: cx, row, w: bw, nameMax: Math.max(nameW, timeW) });
    cx += bw;
  });
  let moreRow = row, moreX = cx + 20;
  const moreText = more ? `還有 ${more} 站` : '';
  if (more && moreX + m(moreText, 24, 700) > x1) { moreRow = row + 1; moreX = x0 + 40; }
  const rows = Math.max(row, moreRow) + 1;
  const foodLine = d.foods.length ? listFit(m, d.foods.map((f) => f.name), x1 - x0 - 90, 24, 600) : null;
  const h = Math.max(tab ? 190 : 0, 26 + rows * rowH + (foodLine ? 46 : 0) + 14);
  // 底與標籤
  c.rect(M, y0, PW - 2 * M, h, { r: 26, fill: tint(col, 0.12), stroke: col, lw: 3 });
  if (tab) {
    c.rect(M, y0, TAB, h, { r: 26, fill: col });
    c.text('DAY', M + TAB / 2, y0 + 50, 26, { weight: 800, color: '#ffffff', align: 'center', role: 'label' });
    c.text(String(d.day), M + TAB / 2, y0 + 120, 66, { weight: 900, color: '#ffffff', align: 'center', role: 'daynum' });
    if (d.date) c.text(d.date, M + TAB / 2, y0 + 160, 22, { weight: 700, color: '#ffffff', align: 'center', maxW: TAB - 16, role: 'date' });
  }
  // 站與箭頭
  const yRow = (r) => y0 + 26 + r * rowH;
  place.forEach((p, i) => {
    const by = yRow(p.row);
    if (i > 0) {
      const prev = place[i - 1];
      const ay = by + boxH / 2;
      const ax0 = p.row === prev.row ? prev.x + prev.w + 8 : x0 - 4;
      const ax1 = p.x - 8;
      c.path(`M ${ax0} ${ay} L ${ax1 - 4} ${ay}`, { stroke: col, lw: 4, dash: [9, 8] });
      c.path(`M ${ax1 - 14} ${ay - 9} L ${ax1} ${ay} L ${ax1 - 14} ${ay + 9}`, { stroke: col, lw: 4 });
      if (p.sp.leg) {
        const t = p.sp.leg.icon || p.sp.leg.label;
        c.text(t, (ax0 + ax1) / 2, ay - 14, p.sp.leg.icon ? 26 : 18, { weight: 700, align: 'center', maxW: ax1 - ax0, role: 'leg' });
      }
      // 換行時，上一行最後一站後面也拉一段出去，看得出是接到下一行
      if (p.row !== prev.row) {
        const py = yRow(prev.row) + boxH / 2;
        c.path(`M ${prev.x + prev.w + 8} ${py} L ${Math.min(x1, prev.x + prev.w + 46)} ${py}`, { stroke: col, lw: 4, dash: [9, 8] });
      }
    }
    c.rect(p.x, by, p.w, boxH, { r: 16, fill: '#ffffff', stroke: col, lw: 3 });
    if (p.sp.time) c.text(p.sp.time, p.x + 18, by + 28, 20, { weight: 700, color: SUB, role: 'time', day: d.day });
    c.text(p.sp.name, p.x + 18, by + boxH - 16, nameSize, { weight: 700, maxW: p.nameMax, role: 'stop', day: d.day });
    c.box('stopbox', p.x, by, p.w, boxH);
  });
  if (more) c.text(moreText, moreX, yRow(moreRow) + boxH / 2 + 9, 24, { weight: 700, color: SUB, role: 'more', day: d.day, more });
  if (foodLine) {
    const fy = y0 + 26 + rows * rowH + 22;
    const lw = c.text('必吃：', x0, fy, 24, { weight: 800, color: col, role: 'label' });
    c.text(foodLine.text, x0 + lw + 4, fy, 24, { weight: 600, maxW: x1 - x0 - lw - 4, role: 'foodline' });
  }
  c.box('band', M, y0, PW - 2 * M, h, { day: d.day });
  return y0 + h;
}

function bandAll(model, measure) {
  const c = canvasOps(measure);
  const n = model.days.length;
  const sz = model.days.map((d) => peekSize(d.peek, PEEK_ALL.rise, PEEK_ALL.w));
  // 每一條色帶右上角站一隻（那一天的吉祥物），上面要留牠的高度；第一天那一隻旁邊講一句（只講數得出來的）
  let y = bigHeader(c, model, 36) + 24 + Math.ceil(sz[0].rise);
  const line = model.span ? `${model.span.label}，${model.placeCount} 個地方！` : `${model.placeCount} 個地方！`;
  const PX = PW - M - 40;   // 吉祥物的右緣
  bubble(c, line, PX - sz[0].w - 16, y - Math.min(sz[0].rise, BUBBLE_H + 40) / 2 - 10);
  model.days.forEach((d, i) => {
    const bottom = band(c, d, y);
    c.peek(d.peek, PX, y, PEEK_ALL.rise, PEEK_ALL.w, { align: 'right', day: d.day });
    const gap = i < n - 1 ? Math.max(44, Math.ceil(sz[i + 1].rise) + 24) : 44;
    if (i < n - 1) {
      // 天跟天之間：標籤底下一個往下的虛線箭頭（下一條色帶上面要站吉祥物，間隔變大，箭頭跟著拉長）
      const ax = M + 85, col = colorOf(d.day);
      c.path(`M ${ax} ${bottom + 6} L ${ax} ${bottom + gap - 10}`, { stroke: col, lw: 4, dash: [6, 6] });
      c.path(`M ${ax - 9} ${bottom + gap - 18} L ${ax} ${bottom + gap - 6} L ${ax + 9} ${bottom + gap - 18}`, { stroke: col, lw: 4 });
    }
    y = bottom + gap;
  });
  if (model.tips.length) y = tipsPanel(c, model.tips, model.tipsAsOf, y) + 30;
  const h = y + 64;
  footer(c, h, '');
  return { w: PW, h, ops: c.ops, boxes: c.boxes };
}

// 每天一張的色帶：一整頁只有這一天，站由上往下排（橫排會在 A4 上留一大片空白）。必吃只放下面的面板（不在帶子裡重複）。
// 站卡：站名，下面一行時間（使用者填的，或推算的「約 HH:MM 到」）與停留多久；兩站之間寫怎麼去與車程。
// 站距收緊（v1.88.0 站少的那天會把站距拉開填滿 A4，留下一大片空白）；空出來的高度給色帶上那一隻吉祥物放大
// （最多 PEEK_DAY.max），旁邊講一句「第 N 天，K 個地方！」。站多就照最小站距、頁面往下長。
const bandCardH = (sp) => (sp.time || sp.eta || sp.stay ? 118 : 80);
const bandGap = (sp) => (sp.leg ? 58 : 30);
function bandDay(model, d, idx, total, measure) {
  const c = canvasOps(measure);
  const col = colorOf(d.day);
  let y = dayHeader(c, model, d, 30) + 24;
  const tip = model.tips.filter((t) => t.day === d.day);
  const line = `第 ${d.day} 天，${d.placeCount} 個地方！`;
  const PX = PW - M - 40;                                         // 吉祥物的右緣
  const PEEK_W = Math.min(560, PX - (M + 20 + bubbleW(c, line) + 24));
  const cards = d.stops.map(bandCardH);
  const gaps = d.stops.map((sp, i) => (i > 0 ? bandGap(sp) : 0));
  const after = 40 + (d.foods.length ? foodsPanelH(d.foods.length) + 30 : 0) + (tip.length ? tipsPanelH(tip.length) + 30 : 0) + 64;
  const plan = (rise) => {
    const s = peekSize(d.peek, rise, PEEK_W);
    const padT = Math.max(30, Math.ceil(s.sink) + 14);           // 色帶上緣到第一張卡：吉祥物的手掌伸進來的深度＋14
    const bandH = padT + 30 + cards.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
    return { s, padT, bandH, h: y + Math.ceil(s.rise) + bandH + after };
  };
  const p = fitPeek(plan);
  const air = airOf(p.h, 1 + (d.foods.length ? 1 : 0) + (tip.length ? 1 : 0));
  const { s, padT, bandH } = p;
  y += air + Math.ceil(s.rise);
  c.rect(M, y, PW - 2 * M, bandH, { r: 26, fill: tint(col, 0.12), stroke: col, lw: 3 });
  c.peek(d.peek, PX, y, s.rise, PEEK_W, { align: 'right', day: d.day });
  bubble(c, line, PX - s.w - 16, y - Math.min(s.rise, BUBBLE_H + 80) / 2 - 10);
  const bx = M + 34, bw = PW - 2 * M - 68;
  let by = y + padT;
  d.stops.forEach((sp, i) => {
    const BH = cards[i], gap = gaps[i];
    by += gap;
    if (i > 0) {
      const ax = bx + 40, ay0 = by - gap + 8, ay1 = by - 8;
      c.path(`M ${ax} ${ay0} L ${ax} ${ay1 - 4}`, { stroke: col, lw: 4, dash: [8, 7] });
      c.path(`M ${ax - 10} ${ay1 - 14} L ${ax} ${ay1} L ${ax + 10} ${ay1 - 14}`, { stroke: col, lw: 4 });
      if (sp.leg) c.text(legText(sp.leg), ax + 26, (ay0 + ay1) / 2 + 9, 26, { weight: 700, role: 'leg' });
    }
    c.rect(bx, by, bw, BH, { r: 18, fill: '#ffffff', stroke: col, lw: 3 });
    c.circle(bx + 40, by + BH / 2, 21, { fill: col });
    c.text(String(i + 1), bx + 40, by + BH / 2 + 8, 22, { weight: 900, color: '#ffffff', align: 'center', role: 'stopnum' });
    const tx = bx + 80;
    if (BH === 80) c.text(sp.name, tx, by + BH / 2 + 12, 36, { weight: 800, maxW: bx + bw - 24 - tx, role: 'stop', day: d.day });
    else {
      c.text(sp.name, tx, by + 50, 36, { weight: 800, maxW: bx + bw - 24 - tx, role: 'stop', day: d.day });
      let sx = tx;
      if (sp.time) sx += c.text(sp.time, sx, by + 94, 26, { weight: 700, color: SUB, role: 'time', day: d.day }) + 28;
      else if (sp.eta) sx += c.text(sp.eta, sx, by + 94, 26, { weight: 700, color: SUB, role: 'eta', day: d.day }) + 28;
      if (sp.stay) c.text(sp.stay, sx, by + 94, 26, { weight: 600, color: SUB, maxW: bx + bw - 24 - sx, role: 'stay', day: d.day });
    }
    c.box('stopbox', bx, by, bw, BH);
    by += BH;
  });
  c.box('band', M, y, PW - 2 * M, bandH, { day: d.day });
  y += bandH + 40;
  if (d.foods.length) y = foodsPanel(c, d.foods, y + air, { title: '這天的必吃', tags: false }) + 30;
  if (tip.length) y = tipsPanel(c, tip, model.tipsAsOf, y + air) + 30;
  const h = Math.max(A4H, y + 64);
  footer(c, h, `第 ${idx + 1}／${total} 張`);
  return { w: PW, h, ops: c.ops, boxes: c.boxes };
}

// 對外：每一張的 { w, h, ops, boxes, label, day }。kind：'route'｜'band'；split：'one'｜'day'
export function posterPages(model, { kind = 'route', split = 'one' } = {}, measure) {
  if (!model || !model.days.length) return [];
  if (split === 'day') {
    const total = model.days.length;
    return model.days.map((d, i) => ({
      ...(kind === 'band' ? bandDay(model, d, i, total, measure) : routeDay(model, d, i, total, measure)),
      label: `第${d.day}天`, day: d.day,
    }));
  }
  return [{ ...(kind === 'band' ? bandAll(model, measure) : routeAll(model, measure)), label: '全部', day: 0 }];
}
