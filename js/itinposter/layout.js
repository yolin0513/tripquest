// 行程海報（v1.88.0）的版面——純函式：模型＋選項 → 每一張「畫什麼」的清單（ops）。不碰 canvas、不碰 DOM。
// 字寬由呼叫的一方量（measure(text, size, weight) → px）：畫的時候用 canvas 的 measureText，node 的測試給近似值。
// 每一張另外回傳 boxes（站牌框、面板、色帶、吉祥物、對話框…的外框）：scripts/itinposterlayouttest.mjs 驗彼此不重疊、不出界。
//
// 兩種版型 × 兩種張數（決定與替代方案見 docs/STATUS.md 的 v1.88.0）：
//   route 路線圖（海報範例 3、4 那一型，拿掉地理）：一條彎曲的路從 START 走到 GOAL，每天一個站、站牌框左右交錯；
//         下面「必吃清單」（每項標 DAYn）、「小提醒」（天氣預報）。路是示意的，不照真的方位與距離（沒有地圖資料、不抓圖磚）。
//   band  分天色帶（範例 2 那一型，改成依天分帶——範例是依地區分，我們沒有可靠的地區資料）：每天一條色帶，
//         左邊「DAY N」標籤，帶裡的站用虛線箭頭串起來，有選怎麼去就寫在箭頭上；必吃寫在那一天的帶子裡；
//         吉祥物在最下面講一句（只講數得出來的：幾天幾夜、幾個地方）。
//   one   全部一張：寬固定，高度跟著天數長（長圖；存 PDF 就是一頁長頁，不切、不硬縮進 A4）
//   day   每天一張：每一張至少 A4 的比例，站多就往下長
// 每一天一個顏色（範例 3、4）；顏色只分天，不代表類別。
// 放不下的不默默消失：截斷的地方寫「還有 N 站／項／天」；名字太長的截成「…」（ops 的 full 留著原字，測試拿來核對來源）。
// 不出現模型以外的資料：字只有模型裡的字、數字，和固定的幾個標題（必吃清單、小提醒、START、GOAL…）。

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
export const MASCOT_RATIO = 212 / 252;   // 吉祥物圖的寬高比（js/glyphs.js 的 MASCOT_VB）

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
    mascot(kind, x, y, h) { ops.push({ op: 'mascot', kind, x, y, h, w: Math.round(h * MASCOT_RATIO) }); boxes.push({ kind: 'mascot', x, y, w: Math.round(h * MASCOT_RATIO), h }); },
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
const MASCOT_H = 176;

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

// 吉祥物在右下角講一句（對話框在牠左邊）。回傳底部的 y
function mascotSays(c, kind, line, y0) {
  const mh = MASCOT_H, mw = Math.round(mh * MASCOT_RATIO);
  const mx = PW - M - mw;
  c.mascot(kind, mx, y0, mh);
  const m = measureOf(c);
  const tw = Math.min(m(line, 32, 800), mx - M - 120);
  const bw = tw + 64, bh = 84;
  const bx = mx - 34 - bw, by = y0 + 36;
  c.rect(bx, by, bw, bh, { r: 30, fill: '#ffffff', stroke: INK, lw: 3 });
  // 尾巴指向吉祥物
  c.path(`M ${bx + bw - 2} ${by + 30} L ${bx + bw + 30} ${by + 46} L ${bx + bw - 2} ${by + 58}`, { fill: '#ffffff', stroke: INK, lw: 3, cap: 'round' });
  c.text(line, bx + 32, by + 54, 32, { weight: 800, maxW: tw, role: 'bubble' });
  c.box('bubble', bx, by, bw + 30, bh);
  return y0 + mh;
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

function frameH(d) {
  const rows = Math.min(d.stops.length, FRAME_STOPS);
  return 120 + rows * 38 + (d.stops.length > FRAME_STOPS ? 38 : 0) + 20;
}

function routeAll(model, measure) {
  const c = canvasOps(measure);
  let y = bigHeader(c, model, 36);
  const n = model.days.length;
  const G = Math.max(150, Math.ceil((Math.max(...model.days.map(frameH)) + 30) / 2));
  const top = y + 46;
  const st = model.days.map((d, i) => ({ x: i % 2 === 0 ? SXL : SXR, y: top + 118 + i * G, left: i % 2 === 0, d }));
  const goalY = st[n - 1].y + 118;
  c.mascot('schnauzer', RX + 90, top - 26, 170);
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
    // 站牌框
    c.rect(fx, fy, FW, fh, { r: 22, fill: '#ffffff', stroke: col, lw: 4 });
    const pw = c.pill(`DAY ${d.day}`, fx + 20, fy + 18, 50, 30, col, { role: 'daytag' });
    if (d.date) c.text(d.date, fx + 20 + pw + 14, fy + 54, 26, { weight: 700, color: SUB, maxW: FW - pw - 54, role: 'date' });
    const route = d.stops.length > 1 ? `${d.from} → ${d.to}` : d.from;
    c.text(route, fx + 22, fy + 106, 28, { weight: 800, color: col, maxW: FW - 44, role: 'route' });
    const rows = d.stops.slice(0, FRAME_STOPS);
    rows.forEach((sp, k) => {
      const by = fy + 120 + 30 + k * 38;
      c.circle(fx + 32, by - 9, 6, { fill: col });
      let tx = fx + 48;
      if (sp.time) tx += c.text(sp.time, tx, by, 24, { weight: 700, color: SUB, role: 'time', day: d.day }) + 10;
      c.text(sp.name, tx, by, 26, { weight: 600, maxW: fx + FW - 20 - tx, role: 'stop', day: d.day });
    });
    const more = d.stops.length - rows.length;
    if (more > 0) c.text(`還有 ${more} 站`, fx + 48, fy + 120 + 30 + rows.length * 38, 24, { weight: 700, color: SUB, role: 'more', day: d.day, more });
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

function routeDay(model, d, idx, total, measure) {
  const c = canvasOps(measure);
  const col = colorOf(d.day);
  let y = dayHeader(c, model, d, 30);
  const n = d.stops.length;
  const LW = 440;
  const lh = (sp) => (sp.time ? 96 : 68);
  const tip = model.tips.filter((t) => t.day === d.day);
  // 站少的那天把路拉長、填滿 A4（站距最多 240）；站多就照最小站距排、頁面往下長
  const Gmin = Math.max(124, Math.ceil((Math.max(...d.stops.map(lh)) + 26) / 2));
  const top = y + 46;
  const after = 44 + (d.foods.length ? foodsPanelH(d.foods.length) + 30 : 0) + (tip.length ? tipsPanelH(tip.length) + 30 : 0) + 64;
  const room = A4H - after - (top + 118) - 118 - 23;
  const G = n > 1 ? Math.min(240, Math.max(Gmin, Math.floor(room / (n - 1)))) : Gmin;
  const st = d.stops.map((sp, i) => ({ x: i % 2 === 0 ? SXL : SXR, y: top + 118 + i * G, left: i % 2 === 0, sp, i }));
  const goalY = st[n - 1].y + 118;
  c.mascot('schnauzer', RX + 90, top - 26, 170);
  drawRoad(c, [{ x: CX, y: top }, ...st, { x: CX, y: goalY }]);
  flag(c, 'START', CX, top);
  flag(c, 'GOAL', CX, goalY);
  let bottom = goalY + 23;
  for (const s of st) {
    const sp = s.sp, bh = lh(sp);
    const bx = s.left ? LX : RX, by = s.y - bh / 2;
    if (s.left) c.path(`M ${LX + LW} ${s.y} L ${s.x - 24} ${s.y}`, { stroke: col, lw: 4, dash: [8, 8] });
    else c.path(`M ${s.x + 24} ${s.y} L ${RX} ${s.y}`, { stroke: col, lw: 4, dash: [8, 8] });
    c.circle(s.x, s.y, 24, { fill: col, stroke: '#ffffff', lw: 5 });
    c.text(String(s.i + 1), s.x, s.y + 9, 24, { weight: 900, color: '#ffffff', align: 'center', role: 'stopnum' });
    c.rect(bx, by, LW, bh, { r: 20, fill: '#ffffff', stroke: col, lw: 4 });
    if (sp.time) c.text(sp.time, bx + 24, by + 36, 24, { weight: 700, color: SUB, role: 'time', day: d.day });
    c.text(sp.name, bx + 24, by + bh - 22, 32, { weight: 800, maxW: LW - 48, role: 'stop', day: d.day });
    c.box('frame', bx, by, LW, bh);
    bottom = Math.max(bottom, by + bh);
    // 兩站之間怎麼去（使用者選過才寫）：放在路的中間那一段上
    if (s.i > 0 && sp.leg) {
      const my = (st[s.i - 1].y + s.y) / 2;
      const t = sp.leg.icon ? `${sp.leg.icon} ${sp.leg.label}` : sp.leg.label;
      const w = c.pill(t, CX, my - 20, 40, 22, '#ffffff', { color: INK, align: 'center', role: 'leg', weight: 700 });
      c.box('leg', CX - w / 2, my - 20, w, 40);
    }
  }
  y = bottom + 44;
  if (d.foods.length) y = foodsPanel(c, d.foods, y, { title: '這天的必吃', tags: false }) + 30;
  if (tip.length) y = tipsPanel(c, tip, model.tipsAsOf, y) + 30;
  const h = Math.max(A4H, y + 64);
  footer(c, h, `第 ${idx + 1}／${total} 張`);
  return { w: PW, h, ops: c.ops, boxes: c.boxes };
}

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
  let y = bigHeader(c, model, 36) + 34;
  model.days.forEach((d, i) => {
    const bottom = band(c, d, y);
    if (i < model.days.length - 1) {
      // 天跟天之間：標籤底下一個往下的虛線箭頭
      const ax = M + 85, col = colorOf(d.day);
      c.path(`M ${ax} ${bottom + 6} L ${ax} ${bottom + 34}`, { stroke: col, lw: 4, dash: [6, 6] });
      c.path(`M ${ax - 9} ${bottom + 26} L ${ax} ${bottom + 38} L ${ax + 9} ${bottom + 26}`, { stroke: col, lw: 4 });
    }
    y = bottom + 44;
  });
  if (model.tips.length) y = tipsPanel(c, model.tips, model.tipsAsOf, y) + 30;
  const line = model.span ? `${model.span.label}，${model.placeCount} 個地方！` : `${model.placeCount} 個地方！`;
  y = mascotSays(c, 'schnauzer', line, y) + 20;
  const h = y + 64;
  footer(c, h, '');
  return { w: PW, h, ops: c.ops, boxes: c.boxes };
}

// 每天一張的色帶：一整頁只有這一天，站改成由上往下排（橫排會在 A4 上留一大片空白）；
// 站少的那天把站距拉開、填滿 A4（最多 170），站多就照最小站距、頁面往下長。必吃只放下面的面板（不在帶子裡重複）。
function bandDay(model, d, idx, total, measure) {
  const c = canvasOps(measure);
  const col = colorOf(d.day);
  let y = dayHeader(c, model, d, 30) + 30;
  const tip = model.tips.filter((t) => t.day === d.day);
  const n = d.stops.length;
  const anyTime = d.stops.some((s) => s.time);
  const BH = 80, PAD = 30, TIMEW = anyTime ? 124 : 0;
  const after = 40 + (d.foods.length ? foodsPanelH(d.foods.length) + 30 : 0) + (tip.length ? tipsPanelH(tip.length) + 30 : 0) + MASCOT_H + 20 + 64;
  const room = A4H - after - y - 2 * PAD - n * BH;
  const gap = n > 1 ? Math.min(170, Math.max(58, Math.floor(room / (n - 1)))) : 0;
  const bandH = 2 * PAD + n * BH + (n - 1) * gap;
  c.rect(M, y, PW - 2 * M, bandH, { r: 26, fill: tint(col, 0.12), stroke: col, lw: 3 });
  const bx = M + 34, bw = PW - 2 * M - 68;
  d.stops.forEach((sp, i) => {
    const by = y + PAD + i * (BH + gap);
    if (i > 0) {
      const ax = bx + 40, ay0 = by - gap + 8, ay1 = by - 8;
      c.path(`M ${ax} ${ay0} L ${ax} ${ay1 - 4}`, { stroke: col, lw: 4, dash: [8, 7] });
      c.path(`M ${ax - 10} ${ay1 - 14} L ${ax} ${ay1} L ${ax + 10} ${ay1 - 14}`, { stroke: col, lw: 4 });
      if (sp.leg) c.text(sp.leg.icon ? `${sp.leg.icon} ${sp.leg.label}` : sp.leg.label, ax + 26, (ay0 + ay1) / 2 + 9, 26, { weight: 700, role: 'leg' });
    }
    c.rect(bx, by, bw, BH, { r: 18, fill: '#ffffff', stroke: col, lw: 3 });
    c.circle(bx + 40, by + BH / 2, 21, { fill: col });
    c.text(String(i + 1), bx + 40, by + BH / 2 + 8, 22, { weight: 900, color: '#ffffff', align: 'center', role: 'stopnum' });
    let tx = bx + 80;
    if (anyTime) {
      if (sp.time) c.text(sp.time, tx, by + BH / 2 + 10, 28, { weight: 700, color: SUB, role: 'time', day: d.day });
      tx += TIMEW;
    }
    c.text(sp.name, tx, by + BH / 2 + 12, 36, { weight: 800, maxW: bx + bw - 24 - tx, role: 'stop', day: d.day });
    c.box('stopbox', bx, by, bw, BH);
  });
  c.box('band', M, y, PW - 2 * M, bandH, { day: d.day });
  y += bandH + 40;
  if (d.foods.length) y = foodsPanel(c, d.foods, y, { title: '這天的必吃', tags: false }) + 30;
  if (tip.length) y = tipsPanel(c, tip, model.tipsAsOf, y) + 30;
  y = mascotSays(c, 'schnauzer', `第 ${d.day} 天，${d.placeCount} 個地方！`, y) + 20;
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
