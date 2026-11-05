// 當日示意地圖（2026-11-05 起，參考畫面「手繪當日地圖」的第一版）。
// 只畫有座標的景點：圖釘＋依當天順序的虛線＋「時間 名稱」標籤。
// 沒座標的站放不上去——**不能讓它靜默消失**（少畫幾站，圖反而更好看，那就是在騙人）：
// 圖釘的編號用「當天第幾站」，缺的站會跳號；圖下另外列出「這幾站沒有位置，沒畫上去」。
// 不照景點名字畫任何地標插圖（照名字畫就是猜，v1.74 原則）；底圖只有通用的紙紋與色塊。
import { h } from './ui.js';

const W = 340, H = 220, PAD = 34;

const hasPos = (s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))
  && !(Number(s.lat) === 0 && Number(s.lng) === 0) && s.lat !== null && s.lng !== null && s.lat !== '' && s.lng !== '';

// 純函式：daySpots 已照當天順序排好；timeOf(s) 回傳開始時間字串（沒填就空字串，不補）。
export function dayMapModel(daySpots, timeOf = () => '') {
  const all = daySpots.map((s, i) => ({ id: s.id, n: i + 1, name: s.name || '（沒有名字）', time: timeOf(s) || '', s }));
  const placed = all.filter((x) => hasPos(x.s));
  const missing = all.filter((x) => !hasPos(x.s)).map(({ id, n, name }) => ({ id, n, name }));
  if (!placed.length) return { placed: [], missing, w: W, h: H };
  // 等距圓柱投影：經度乘 cos(緯度) 讓東西向不被拉長；不照比例尺，只保留相對方位
  const lat0 = placed.reduce((a, x) => a + Number(x.s.lat), 0) / placed.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const px = placed.map((x) => ({ ...x, gx: Number(x.s.lng) * k, gy: -Number(x.s.lat) }));
  const minX = Math.min(...px.map((p) => p.gx)), maxX = Math.max(...px.map((p) => p.gx));
  const minY = Math.min(...px.map((p) => p.gy)), maxY = Math.max(...px.map((p) => p.gy));
  const spanX = maxX - minX, spanY = maxY - minY;
  const sc = Math.min(spanX > 0 ? (W - 2 * PAD) / spanX : Infinity, spanY > 0 ? (H - 2 * PAD) / spanY : Infinity);
  const out = px.map((p) => ({
    id: p.id, n: p.n, name: p.name, time: p.time,
    x: Number.isFinite(sc) ? W / 2 + (p.gx - (minX + maxX) / 2) * sc : W / 2,
    y: Number.isFinite(sc) ? H / 2 + (p.gy - (minY + maxY) / 2) * sc : H / 2,
  }));
  return { placed: placeLabels(out), missing, w: W, h: H };
}

// 標籤位置：每個依序試「右、左、上、下」，挑第一個不出框、不壓到別的標籤與圖釘的；都不行就挑重疊最少的。
// 字寬用估的（中日文一個字＝字級、英數約 0.58 倍）；實際有沒有疊到，截圖腳本在瀏覽器裡用 getBBox 量。
export const FS = 14;
const textW = (s) => [...s].reduce((a, c) => a + (c.codePointAt(0) > 255 ? FS : FS * 0.58), 0);
const overlap = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
function placeLabels(pins) {
  const R = 11, taken = pins.map((p) => ({ x1: p.x - R, y1: p.y - R, x2: p.x + R, y2: p.y + R }));
  return pins.map((p) => {
    const text = `${p.time ? p.time + ' ' : ''}${p.name}`;
    const w = textW(text), hgt = FS + 4;
    const cands = [
      { anchor: 'start', lx: p.x + R + 5, ly: p.y + FS / 2 - 2 },
      { anchor: 'end', lx: p.x - R - 5, ly: p.y + FS / 2 - 2 },
      { anchor: 'middle', lx: p.x, ly: p.y - R - 6 },
      { anchor: 'middle', lx: p.x, ly: p.y + R + FS + 3 },
    ].map((c) => {
      const x1 = c.anchor === 'start' ? c.lx : c.anchor === 'end' ? c.lx - w : c.lx - w / 2;
      const box = { x1, y1: c.ly - FS, x2: x1 + w, y2: c.ly - FS + hgt };
      const out = box.x1 < 2 || box.x2 > W - 2 || box.y1 < 2 || box.y2 > H - 2;
      const ov = taken.reduce((a, t) => a + overlap(box, t), 0);
      return { ...c, box, score: (out ? 1e6 : 0) + ov };
    });
    const best = cands.reduce((a, c) => (c.score < a.score ? c : a));
    taken.push(best.box);
    return { ...p, label: text, lx: best.lx, ly: best.ly, anchor: best.anchor };
  });
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) if (c != null) el.append(c);
  return el;
};

export function dayMap(daySpots, timeOf) {
  const m = dayMapModel(daySpots, timeOf);
  const missNote = m.missing.length
    ? h('div', { class: 'dm-missing' },
      h('span', { class: 'dm-missing-label' }, m.placed.length ? '這幾站沒有位置，沒畫上去：' : '這天的景點都沒有位置，畫不出地圖：'),
      h('span', { class: 'dm-missing-list' }, m.missing.map((x) => `${x.n}. ${x.name}`).join('、')))
    : null;
  if (!m.placed.length) return h('div', { class: 'daymap is-empty' }, missNote);

  const pts = m.placed.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const g = svg('svg', { class: 'dm-svg', viewBox: `0 0 ${m.w} ${m.h}`, role: 'img',
    'aria-label': `當天路線示意圖：${m.placed.map((p) => `${p.n}. ${p.name}`).join('、')}` });
  // 底：通用的紙紋色塊（不畫任何地標）
  g.append(svg('rect', { class: 'dm-bg', x: 0, y: 0, width: m.w, height: m.h, rx: 16 }));
  g.append(svg('path', { class: 'dm-deco', d: `M0 ${m.h * 0.78} Q ${m.w * 0.25} ${m.h * 0.7} ${m.w * 0.5} ${m.h * 0.8} T ${m.w} ${m.h * 0.76} L ${m.w} ${m.h} L 0 ${m.h} Z` }));
  if (m.placed.length > 1) g.append(svg('polyline', { class: 'dm-route', points: pts }));
  // 先畫全部圖釘、再畫全部標籤：標籤永遠在圖釘上面，不會被下一站的圓點蓋住
  for (const p of m.placed) {
    g.append(svg('g', { class: 'dm-pin', 'data-spot': p.id },
      svg('circle', { class: 'dm-pin-dot', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 11 }),
      svg('text', { class: 'dm-pin-n', x: p.x.toFixed(1), y: (p.y + 4).toFixed(1), 'text-anchor': 'middle' }, String(p.n))));
  }
  for (const p of m.placed) {
    g.append(svg('text', { class: 'dm-label', 'data-spot': p.id, x: p.lx.toFixed(1), y: p.ly.toFixed(1), 'text-anchor': p.anchor }, p.label));
  }
  return h('div', { class: 'daymap' }, g, missNote);
}
