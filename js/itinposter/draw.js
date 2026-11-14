// 行程海報（v1.88.0）的繪製：把 layout.js 排好的 ops 一個一個畫到 canvas。這一支不決定放什麼——放什麼是 model.js、
// 放哪裡是 layout.js；這裡只照做（scripts/itinposterlayouttest.mjs 守：這支不讀模型、不讀類別）。
// 吉祥物（v1.89 起每天一隻、從框的上緣探頭；v1.88.0 角落那一隻拿掉了）用 js/peeks.js 的 peekFlat()——跟 App 的 peek()
// 同一份圖，只是不分上下兩層、不套白邊（理由在 peekFlat 那裡）；照 layout.js 算好的大小（k）產生、轉成圖片再畫，不另外畫一份。
// 全部在手機上畫，不上傳。
import { CJK_STACK } from '../poster/presets.js';
import { peekFlat } from '../peeks.js';
import { PAPER } from './layout.js';

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

// 一張：底色 → ops 照順序畫
export async function drawPoster(canvas, page) {
  canvas.width = page.w;
  canvas.height = page.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, page.w, page.h);
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
    }
    ctx.restore();
  }
}
