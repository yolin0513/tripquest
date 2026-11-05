// 小型圖磚地圖（2026-11-05，3 代理投票 2:1「自己寫」，見 docs/VOTE_2026-11-05_地圖顯示.md）。
// 範圍鎖死（投票的守法）：整數縮放層級、北朝上、不旋轉、不慣性；縮放只用按鈕（雙指縮放第二版）；
// **單指上下滑照樣捲頁面**（touch-action: pan-y），拖地圖用雙指或滑鼠。超出這些就重開投票、改用函式庫。
//
// 圖磚：OpenStreetMap 官方圖磚。條款（operations.osmfoundation.org/policies/tiles/）要點：
// 著作權字樣要看得到、不能藏；遵守快取標頭；**禁止預先下載區域**——所以這裡只載「現在畫面上要的」那幾張，
// 而且要等地圖捲進畫面才載（不看的那天不抓）。測試用 window.__TQ_TILE_URL 換成本機假圖（同 __TQ_GEO_ENDPOINT 的慣例）。
import { h } from './ui.js';

export const TILE = 256;
export const Z_MIN = 2, Z_MAX = 18, Z_ONE = 15, Z_FIT_MAX = 16;
const tileURL = () => (typeof window !== 'undefined' && window.__TQ_TILE_URL) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// ---------- 純函式：Web Mercator（世界座標＝第 z 層的像素） ----------
export const worldSize = (z) => TILE * 2 ** z;
export function toWorld(lat, lng, z) {
  const s = worldSize(z);
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const r = (la * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * s, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s };
}
export function fromWorld(x, y, z) {
  const s = worldSize(z);
  const lng = (x / s) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / s))) * 180) / Math.PI;
  return { lat, lng };
}
// 把所有點框進 w×h（留 pad）的最大整數層級；只有一點用 Z_ONE
export function fitView(pts, w, h, pad = 36) {
  if (!pts.length) return null;
  let z = pts.length === 1 ? Z_ONE : Z_FIT_MAX;
  if (pts.length > 1) {
    for (; z > Z_MIN; z--) {
      const ws = pts.map((p) => toWorld(p.lat, p.lng, z));
      const sx = Math.max(...ws.map((p) => p.x)) - Math.min(...ws.map((p) => p.x));
      const sy = Math.max(...ws.map((p) => p.y)) - Math.min(...ws.map((p) => p.y));
      if (sx <= w - 2 * pad && sy <= h - 2 * pad) break;
    }
  }
  // 中心取世界座標的外框中點（Mercator 下緯度的中點不是畫面的中點）
  const ws = pts.map((p) => toWorld(p.lat, p.lng, z));
  return { z, cx: (Math.min(...ws.map((p) => p.x)) + Math.max(...ws.map((p) => p.x))) / 2, cy: (Math.min(...ws.map((p) => p.y)) + Math.max(...ws.map((p) => p.y))) / 2 };
}
// 畫面要的圖磚：x 方向繞回、y 超出世界的不要
export function tilesFor(view, w, h) {
  const n = 2 ** view.z;
  const left = view.cx - w / 2, top = view.cy - h / 2;
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + w - 1) / TILE);
  const y0 = Math.max(0, Math.floor(top / TILE)), y1 = Math.min(n - 1, Math.floor((top + h - 1) / TILE));
  const out = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    out.push({ z: view.z, x: ((tx % n) + n) % n, y: ty, left: tx * TILE - left, top: ty * TILE - top });
  }
  return out;
}

// ---------- 元件 ----------
// opts.height：地圖高（px）。回傳 { el, project, fit, focus, zoomBy, onRender, onStatus, home }。
export function tileMap({ height = 260, onHome = null } = {}) {
  const tiles = h('div', { class: 'tm-tiles', 'aria-hidden': 'true' });
  const over = h('div', { class: 'tm-over' });
  const btn = (cls, label, txt, fn) => h('button', { class: 'tm-btn ' + cls, type: 'button', 'aria-label': label, title: label, onclick: fn }, txt);
  const ctrls = h('div', { class: 'tm-ctrls' },
    btn('tm-zin', '放大', '＋', () => zoomBy(1)),
    btn('tm-zout', '縮小', '－', () => zoomBy(-1)),
    btn('tm-home', '回到整天路線', '⌂', () => { home(); if (onHome) onHome(); }));
  const attr = h('div', { class: 'tm-attr' }, '© ',
    h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap'), ' contributors');
  const el = h('div', { class: 'tm', style: `height:${height}px` }, tiles, over, ctrls, attr);

  let view = null, homeView = null, homePts = [], started = false, gen = 0;
  const renderFns = [], statusFns = [];
  const imgs = new Map();                                   // key → img（重畫時沿用，不重抓）
  const size = () => ({ w: el.clientWidth || 340, h: height });

  function render() {
    if (!view) return;
    const { w, h: hh } = size();
    if (started) {
      const want = tilesFor(view, w, hh);
      const keep = new Set();
      const g = ++gen;
      let loaded = 0, failed = 0;
      const report = () => { if (g === gen) for (const f of statusFns) f({ loaded, failed, total: want.length }); };
      for (const t of want) {
        const key = `${t.z}/${t.x}/${t.y}`;
        keep.add(key);
        let im = imgs.get(key);
        if (!im) {
          im = h('img', { class: 'tm-tile', alt: '', crossorigin: 'anonymous' });   // CORS 回應：Service Worker 才存得到讀得到標頭的那份（實測 OSM 有回 CORS）
          im.dataset.state = 'loading';
          im.addEventListener('load', () => { im.dataset.state = 'ok'; });
          im.addEventListener('error', () => { im.dataset.state = 'err'; });
          im.src = tileURL().replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
          imgs.set(key, im); tiles.append(im);
        }
        im.style.transform = `translate(${Math.round(t.left)}px,${Math.round(t.top)}px)`;
        const st = im.dataset.state;
        if (st === 'ok') loaded++; else if (st === 'err') failed++;
        else {
          const done = (ok) => { ok ? loaded++ : failed++; report(); };
          im.addEventListener('load', () => done(true), { once: true });
          im.addEventListener('error', () => done(false), { once: true });
        }
      }
      for (const [k, im] of imgs) if (!keep.has(k)) { im.remove(); imgs.delete(k); }
      report();
    }
    for (const f of renderFns) f();
  }
  let raf = 0;
  const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // 世界座標 → 容器內像素
  function project(lat, lng) {
    if (!view) return { x: -999, y: -999 };
    const { w, h: hh } = size();
    const p = toWorld(lat, lng, view.z);
    return { x: p.x - view.cx + w / 2, y: p.y - view.cy + hh / 2 };
  }
  function setView(v) { view = { z: Math.max(Z_MIN, Math.min(Z_MAX, v.z)), cx: v.cx, cy: v.cy }; el.dataset.z = String(view.z); render(); }
  function fit(pts) {
    homePts = pts;
    const { w, h: hh } = size();
    homeView = fitView(pts, w, hh);
    if (homeView) setView(homeView);
  }
  const home = () => fit(homePts);
  function focus(lat, lng, z) {
    const zz = Math.max(view ? view.z : Z_ONE, z || Z_ONE);
    const p = toWorld(lat, lng, zz);
    setView({ z: zz, cx: p.x, cy: p.y });
  }
  function zoomBy(d) {
    if (!view) return;
    const z = Math.max(Z_MIN, Math.min(Z_MAX, view.z + d));
    if (z === view.z) return;
    const k = 2 ** (z - view.z);
    setView({ z, cx: view.cx * k, cy: view.cy * k });
  }

  // 拖：滑鼠一指、觸控兩指（單指觸控交給頁面捲動）
  const ptrs = new Map();
  let lastMid = null;
  const mid = () => { const a = [...ptrs.values()]; return { x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length }; };
  const dragging = () => [...ptrs.values()].some((p) => p.mouse) || ptrs.size >= 2;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tm-ctrls, .tm-attr, button, a')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' });
    if (dragging()) { lastMid = mid(); try { el.setPointerCapture(e.pointerId); } catch { /* 有些環境不支援 */ } }
  });
  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!dragging() || !view || !lastMid) return;
    const m = mid();
    view.cx -= m.x - lastMid.x; view.cy -= m.y - lastMid.y;
    lastMid = m;
    el.classList.add('is-dragging');
    later();
  });
  const up = (e) => { ptrs.delete(e.pointerId); lastMid = dragging() ? mid() : null; if (!dragging()) el.classList.remove('is-dragging'); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  // 捲進畫面才開始抓圖磚（不看的那天不抓；OSM 條款也要求只抓需要的）
  const start = () => { if (started) return; started = true; render(); };
  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); start(); } });
    io.observe(el);
  } else start();
  // 寬度變了（轉向、第一次排版）就重畫
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (homeView && view && homeView.z === view.z && homeView.cx === view.cx) home(); else render(); }).observe(el);

  return {
    el, over, project, fit, focus, zoomBy, home, setView,
    view: () => view,
    onRender: (f) => renderFns.push(f),
    onStatus: (f) => statusFns.push(f),
  };
}
