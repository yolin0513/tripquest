// 行程海報（v1.88.0）的繪製：把 layout.js 排好的 ops 一個一個畫到 canvas。這一支不決定放什麼——放什麼是 model.js、
// 放哪裡是 layout.js；這裡只照做（scripts/itinposterlayouttest.mjs 守：這支不讀模型、不讀類別）。
// 吉祥物（v1.89 起每天一隻、從框的上緣探頭；v1.88.0 角落那一隻拿掉了）用 js/peeks.js 的 peekFlat()——跟 App 的 peek()
// 同一份圖，只是不分上下兩層、不套白邊（理由在 peekFlat 那裡）；照 layout.js 算好的大小（k）產生、轉成圖片再畫，不另外畫一份。
// 全部在手機上畫，不上傳。
// v1.90：先鋪背景紋理（page.bg：規則的小圓點格子，標題區與頁尾不鋪），再照 ops 畫——框、膠囊、色帶都蓋在點的上面；
// 交通圖示（legicon）照 legicons.js 的形狀畫（不是字、不是 emoji）；路旁的裝飾（deco）只有星星、圓點、短線三種形狀。
import { CJK_STACK } from '../poster/presets.js';
import { peekFlat } from '../peeks.js';
import { PAPER, INK } from './layout.js';
import { LEG_GLYPH } from './legicons.js';

export const font = (weight, size) => `${weight} ${size}px ${CJK_STACK}`;

// 量字寬（給 layout 排版用）：跟畫的時候同一種字、同一個 measureText，排的跟畫的才一樣寬
export function canvasMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  return (text, size, weight = 400) => {
    const k = `${weight}|${size}|${text}`;
    let v = cache.get(k);
    if (v == null) {
      ctx.font = font(weight, size);
      v = ctx.measureText(String(text)).width;
      cache.set(k, v);
    }
    return v;
  };
}

// 探頭圖：照要畫的大小產生（k＝每一個畫布單位幾 px），不拿小圖放大（SVG 轉成的圖放大會糊）。
// 沒有白邊：海報是米色紙底，跟 App 的和紙主題一樣不畫白邊（css 的 html[data-theme="washi"] .gl-peek .mc-fig）。
// 動作線那一層（.mc-extra）照畫：和紙主題也畫它（App 裡只有深色主題由 css 藏起來）。
const _peeks = new Map();
function peekImage(kind, k) {
  const key = `${kind}|${k}`;
  if (!_peeks.has(key)) {
    _peeks.set(key, new Promise((res) => {
      const el = peekFlat(kind, k);
      const xml = new XMLSerializer().serializeToString(el);
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => { _peeks.delete(key); res(null); };   // 這次載不到：不畫牠，下次再試
      im.src = url;
    }));
  }
  return _peeks.get(key);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function strokeIt(ctx, o, p) {
  if (!o.stroke || !o.lw) return;
  ctx.lineWidth = o.lw;
  ctx.strokeStyle = o.stroke;
  ctx.setLineDash(o.dash || []);
  if (p) ctx.stroke(p); else ctx.stroke();
}

// 背景紋理：第 j 列 y＝step/2＋j·step、x＝step/2＋i·step（奇數列再加 step/2），每一格一顆半徑 r 的點。
// 點的外框碰到 clear 裡任何一塊（標題區、頁尾）就不畫那一顆。沒有 bg 就只有紙色
export function drawBackground(ctx, page) {
  const bg = page.bg;
  if (!bg || bg.kind !== 'dots') return;
  const { step, r, color, clear = [] } = bg;
  const hit = (x, y) => clear.some((q) => x + r > q.x && x - r < q.x + q.w && y + r > q.y && y - r < q.y + q.h);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let j = 0, y = step / 2; y - r < page.h; j++, y += step) {
    for (let x = step / 2 + (j % 2 ? step / 2 : 0); x - r < page.w; x += step) {
      if (hit(x, y)) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

// 交通圖示：0～100 方格裡的形狀縮放到 s 見方；col＝那一天的顏色、white、ink 三種填色，每一個形狀描 INK 外框
const GLYPH_FILL = { white: '#ffffff', ink: INK };
function drawLegIcon(ctx, o) {
  const shapes = LEG_GLYPH[o.mode];
  if (!shapes) return;
  ctx.translate(o.x, o.y);
  ctx.scale(o.s / 100, o.s / 100);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  for (const sh of shapes) {
    const p = new Path2D(sh.d);
    if (sh.fill) { ctx.fillStyle = sh.fill === 'col' ? o.color : GLYPH_FILL[sh.fill]; ctx.fill(p); }
    ctx.stroke(p);
  }
}

// 路旁的裝飾：星星（五角、實心）、圓點、短線（沿著路的方向）
function drawDeco(ctx, o) {
  ctx.fillStyle = o.color;
  ctx.strokeStyle = o.color;
  if (o.shape === 'star') {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? o.r * 0.45 : o.r, t = -Math.PI / 2 + k * Math.PI / 5;
      if (k) ctx.lineTo(o.x + rr * Math.cos(t), o.y + rr * Math.sin(t)); else ctx.moveTo(o.x + rr * Math.cos(t), o.y + rr * Math.sin(t));
    }
    ctx.closePath();
    ctx.fill();
  } else if (o.shape === 'dot') {
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.55, 0, Math.PI * 2); ctx.fill();
  } else if (o.shape === 'dash') {
    const dx = Math.cos(o.a) * o.r, dy = Math.sin(o.a) * o.r;
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(o.x - dx, o.y - dy); ctx.lineTo(o.x + dx, o.y + dy); ctx.stroke();
  }
}

// 一張：底色 → 背景紋理 → ops 照順序畫
export async function drawPoster(canvas, page) {
  canvas.width = page.w;
  canvas.height = page.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, page.w, page.h);
  drawBackground(ctx, page);
  const pks = page.ops.filter((o) => o.op === 'peek');
  const pimgs = await Promise.all(pks.map((o) => peekImage(o.kind, o.k)));
  for (const o of page.ops) {
    ctx.save();
    if (o.op === 'rect') {
      roundRect(ctx, o.x, o.y, o.w, o.h, o.r || 0);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      strokeIt(ctx, o);
    } else if (o.op === 'circle') {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      strokeIt(ctx, o);
    } else if (o.op === 'path') {
      const p = new Path2D(o.d);
      ctx.lineCap = o.cap || 'round';
      ctx.lineJoin = 'round';
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(p); }
      strokeIt(ctx, o, p);
    } else if (o.op === 'text') {
      ctx.font = font(o.weight, o.size);
      ctx.fillStyle = o.color;
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(o.text, o.x, o.y);
    } else if (o.op === 'peek') {
      const im = pimgs[pks.indexOf(o)];
      if (im) ctx.drawImage(im, o.x, o.y, o.w, o.h);
    } else if (o.op === 'legicon') {
      drawLegIcon(ctx, o);
    } else if (o.op === 'deco') {
      drawDeco(ctx, o);
    }
    ctx.restore();
  }
}
