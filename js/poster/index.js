// 行程海報 —— canvas 2D 手繪水彩風。
// 3 代理一致：canvas 2D 是唯一 rasterizer；裝飾用 Path2D；照片只從 IndexedDB blob 畫（不 taint）。
// 兩段式排版：先量測算高 → 設 canvas 高度 → 畫。輸出長圖 JPEG，行程 ≥3 天則一天一張。

import * as store from '../store.js';
import { blobURL } from '../photos.js';
import * as db from '../db.js';
import { drawParagraph, paragraphHeight, clip } from './text.js';
import { PRESETS, CJK_STACK } from './presets.js';
import * as deco from './deco.js';

const W = 1240;
const MAXH = 8000;
const PAD = 80;

// ---------- 模型 ----------
export function buildModel(tripId) {
  const trip = store.get(tripId);
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(trip.groupId);
  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({
      name: s.name,
      district: s.district || '',
      blurb: s.blurb || s.wikiExtract || bestQuestHint(s.id) || '',
      startTime: s.startTime || '', endTime: s.endTime || '',
      photoHash: pickPhotoHash(s), emoji: s.emoji || '📍',
      region: s.region || '',
    });
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0])
    .map(([day, items]) => ({ day, region: items[0]?.region || trip.region || '', items }));
  return {
    title: trip.title || '我們的旅程',
    dateRange: [trip.startDate, trip.endDate].filter(Boolean).join(' – '),
    people: members.length, spotCount: spots.length, dayCount: days.length,
    days,
  };
}

function bestQuestHint(spotId) {
  const q = store.questsOf(spotId)[0];
  return q?.hint || '';
}
function pickPhotoHash(spot) {
  // 使用者拍的（該景點任一任務的第一張）→ 景點示意圖
  for (const q of store.questsOf(spot.id)) {
    const sub = store.submissionsOf(q.id)[0];
    if (sub) return { hash: sub.thumbHash || sub.photoHash, user: true };
  }
  if (spot.heroHash) return { hash: spot.heroHash, user: false };
  return null;
}

// ---------- 影像 ----------
async function loadImg(hash) {
  if (!hash) return null;
  const url = await blobURL(hash);
  if (!url) return null;
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

async function ensureFont() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([document.fonts.load('700 40px Caveat'), document.fonts.load('600 28px Caveat')]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    }
  } catch { /* 系統字頂著 */ }
}

// ---------- 排版 + 繪製 ----------
function F(preset, weight, size, family) {
  return `${weight} ${size}px ${family || CJK_STACK}`;
}
const DISP = (p, weight, size) => `${weight} ${size}px ${p.displayFont}, ${CJK_STACK}`;

// 量測一天需要的高度
function measureDay(ctx, p, day, isFirst) {
  let h = 0;
  h += isFirst ? 0 : 40;
  h += 120; // day banner
  for (const it of day.items) {
    const rowH = measureRow(ctx, p, it);
    h += rowH + 34;
  }
  h += 30;
  return h;
}
const POLAROID_W = 300;
const TEXT_X = PAD + 78 + 44;
function rowTextWidth(it) {
  return it.photoHash
    ? (W - PAD - POLAROID_W - 28) - TEXT_X   // 文字止於拍立得左緣前
    : W - TEXT_X - PAD;
}
function measureRow(ctx, p, it) {
  const textW = rowTextWidth(it);
  let h = 14;
  if (it.startTime) h += 34;          // 時間標籤
  h += 44;                             // 名稱
  if (it.blurb) h += 20 + paragraphHeight(ctx, it.blurb, textW, F(p, 400, 27), 38, 3);
  h += 6;
  const photoH = it.photoHash ? 306 : 0;
  return Math.max(h, photoH);
}

async function drawPoster(canvas, model, dayList, preset, seedKey) {
  const ctx = canvas.getContext('2d');
  const p = preset;
  const rnd = deco.mulberry32(deco.hashStr(seedKey));

  // pass 1: 量測
  ctx.textBaseline = 'alphabetic';
  let total = 220; // header
  if (model.dateRange) total += 8;
  dayList.forEach((d, i) => { total += measureDay(ctx, p, d, i === 0); });
  total += 150; // footer
  total = Math.min(total, MAXH);

  canvas.width = W;
  canvas.height = total;

  // 底：紙
  paintPaper(ctx, p, rnd);

  // 邊框裝飾（bunting）
  if (p.decoDensity > 0.4) deco.bunting(ctx, 40, 60, W - 40, 60, p.bunting);

  let y = 150;

  // ---- header ----
  ctx.textAlign = 'center';
  // 標題底的水彩暈
  deco.blob(ctx, W / 2, y - 6, 340, p.blobColors[0], rnd);
  ctx.fillStyle = p.ink;
  ctx.font = DISP(p, 700, 74);
  ctx.fillText(clip(ctx, model.title, W - 200, ctx.font), W / 2, y);
  y += 52;
  ctx.fillStyle = p.sub;
  ctx.font = F(p, 400, 30);
  const sub = [model.dateRange, `${model.people} 人 · ${model.spotCount} 個地方`].filter(Boolean).join('　·　');
  ctx.fillText(sub, W / 2, y);
  y += 46;
  // 分隔手繪線
  wobblyLine(ctx, W / 2 - 140, y, W / 2 + 140, y, p.line, rnd);
  y += 20;

  // ---- days ----
  for (let di = 0; di < dayList.length; di++) {
    const d = dayList[di];
    if (di > 0) y += 40;
    y = await drawDay(ctx, p, d, y, rnd);
  }

  // ---- footer ----
  y = Math.min(y + 40, total - 90);
  ctx.textAlign = 'center';
  deco.sprig(ctx, W / 2 - 90, y + 20, 1.4, -0.3, p.accent);
  deco.sprig(ctx, W / 2 + 90, y + 20, 1.4, 0.3, p.accent);
  ctx.fillStyle = p.ink; ctx.font = DISP(p, 700, 40);
  ctx.fillText('謝謝這趟旅程', W / 2, y);
  ctx.fillStyle = p.sub; ctx.font = F(p, 400, 24);
  ctx.fillText('TripQuest 旅圖任務', W / 2, y + 40);
}

async function drawDay(ctx, p, d, y, rnd) {
  // day banner
  const bandY = y;
  ctx.fillStyle = p.band;
  roundRect(ctx, PAD - 20, bandY - 4, W - (PAD - 20) * 2, 92, 16);
  ctx.fill();
  deco.blob(ctx, PAD + 40, bandY + 44, 90, p.blobColors[1 % p.blobColors.length], rnd);
  ctx.textAlign = 'left';
  ctx.fillStyle = p.accent;
  ctx.font = DISP(p, 700, 56);
  ctx.fillText(`DAY ${d.day}`, PAD + 4, bandY + 58);
  const dw = ctx.measureText(`DAY ${d.day}`).width;
  ctx.fillStyle = p.ink; ctx.font = F(p, 700, 30);
  ctx.fillText(`第 ${cn(d.day)} 天${d.region ? ' · ' + d.region : ''}`, PAD + 24 + dw, bandY + 56);
  y = bandY + 92 + 26;

  // 時間軸直線
  const lineX = PAD + 78;

  for (let ii = 0; ii < d.items.length; ii++) {
    const it = d.items[ii];
    const rowTop = y;
    const rowH = measureRow(ctx, p, it);

    // 連接線
    ctx.strokeStyle = p.line; ctx.lineWidth = 3;
    ctx.setLineDash([2, 10]); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lineX, rowTop - 14);
    ctx.lineTo(lineX, rowTop + rowH + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // 時間點的圓 + emoji
    ctx.fillStyle = p.paper;
    ctx.beginPath(); ctx.arc(lineX, rowTop + 18, 22, 0, 7); ctx.fill();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lineX, rowTop + 18, 22, 0, 7); ctx.stroke();
    ctx.font = '24px ' + CJK_STACK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(it.emoji, lineX, rowTop + 19);
    ctx.textBaseline = 'alphabetic';

    // 時間標籤
    const timeLabel = it.startTime ? (it.endTime ? `${it.startTime}–${it.endTime}` : it.startTime) : '';
    const textX = lineX + 44;
    const textW = rowTextWidth(it);
    let ty = rowTop + 14;
    if (timeLabel) {
      ctx.textAlign = 'left'; ctx.fillStyle = p.accent2;
      ctx.font = DISP(p, 700, 26);
      ctx.fillText(timeLabel, textX, ty + 20);
      ty += 34;
    }
    // 名稱
    ctx.fillStyle = p.ink; ctx.font = F(p, 800, 36); ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, it.name, textW, ctx.font), textX, ty + 30);
    ty += 44;
    // 介紹
    if (it.blurb) {
      ty = drawParagraph(ctx, it.blurb, textX, ty + 30, textW, {
        font: F(p, 400, 27), color: p.sub, lineHeight: 38, maxLines: 3,
      });
    }

    // 拍立得照片（右側，交錯旋轉）
    if (it.img) {
      const rot = ((ii % 2 ? 1 : -1) * (p.polaroid.rotate + rnd() * 3)) * Math.PI / 180;
      polaroid(ctx, it.img, W - PAD - POLAROID_W, rowTop - 6, POLAROID_W, p, rot, it.name);
    }

    // 偶爾放一片葉子
    if (rnd() < 0.35 * p.decoDensity) {
      deco.sprig(ctx, PAD - 30 + rnd() * 20, rowTop + rowH + 10, 1 + rnd(), (rnd() - 0.5), p.accent);
    }

    y = rowTop + rowH + 34;
  }
  return y;
}

function polaroid(ctx, img, x, y, w, p, rot, caption) {
  const b = p.polaroid.border, bottom = p.polaroid.bottom;
  const imgW = w - b * 2;
  const imgH = imgW * 0.82;
  const h = imgH + b * 2 + bottom;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rot);
  // 陰影
  ctx.shadowColor = p.polaroid.shadow;
  ctx.shadowBlur = 22; ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#fdfcf8';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowColor = 'transparent';
  // 照片（cover-fit）
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.max(imgW / iw, imgH / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.save();
  ctx.beginPath(); ctx.rect(-w / 2 + b, -h / 2 + b, imgW, imgH); ctx.clip();
  ctx.drawImage(img, -w / 2 + b + (imgW - dw) / 2, -h / 2 + b + (imgH - dh) / 2, dw, dh);
  ctx.restore();
  // 底下手寫標籤
  if (bottom > 10) {
    ctx.fillStyle = '#6b5b47';
    ctx.font = `600 24px ${p.displayFont}, ${CJK_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(clip(ctx, caption, imgW, ctx.font), 0, -h / 2 + b + imgH + 32);
  }
  ctx.restore();
}

// ---------- 底紋 ----------
function paintPaper(ctx, p, rnd) {
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!p.paperTexture) return;
  const dark = p.paperTexture === 'dark';
  // 纖維雜訊
  ctx.save();
  ctx.globalAlpha = dark ? 0.05 : 0.06;
  for (let i = 0; i < ctx.canvas.height / 3; i++) {
    ctx.strokeStyle = dark ? '#ffffff' : '#8a7355';
    ctx.lineWidth = 1;
    const yy = rnd() * ctx.canvas.height;
    ctx.beginPath();
    ctx.moveTo(rnd() * W, yy);
    ctx.lineTo(rnd() * W, yy + (rnd() - 0.5) * 40);
    ctx.stroke();
  }
  ctx.restore();
  // 角落淡暈
  ctx.save();
  ctx.globalAlpha = 0.08;
  const g = ctx.createRadialGradient(W / 2, ctx.canvas.height / 2, W / 3, W / 2, ctx.canvas.height / 2, W);
  g.addColorStop(0, 'transparent');
  g.addColorStop(1, dark ? '#000' : '#7a6448');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, ctx.canvas.height);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wobblyLine(ctx, x1, y, x2, _y2, color, rnd) {
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const x = x1 + (x2 - x1) * (i / seg);
    const yy = y + (rnd() - 0.5) * 4;
    if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();
}
function cn(n) { return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n] || String(n); }

// ---------- 對外 API ----------
export function presetList() {
  return Object.values(PRESETS).map((p) => ({ id: p.id, label: p.label }));
}

// 產生（回傳 [{ blob, ext, label }]）。行程 ≥3 天 → 一天一張。
export async function renderPoster(tripId, { presetId = 'watercolor', onProgress } = {}) {
  const preset = PRESETS[presetId] || PRESETS.watercolor;
  await ensureFont();
  const model = buildModel(tripId);
  if (!model.days.length) throw new Error('這個行程還沒有景點');

  // 預載所有圖
  onProgress && onProgress('載入照片…');
  for (const d of model.days) {
    for (const it of d.items) {
      it.img = it.photoHash ? await loadImg(it.photoHash.hash) : null;
    }
  }

  const groups = model.dayCount >= 3
    ? model.days.map((d) => [d])
    : [model.days];

  const out = [];
  for (let gi = 0; gi < groups.length; gi++) {
    onProgress && onProgress(groups.length > 1 ? `繪製第 ${gi + 1}/${groups.length} 張…` : '繪製中…');
    const canvas = document.createElement('canvas');
    await drawPoster(canvas, model, groups[gi], preset, tripId + ':' + presetId + ':' + gi);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
    out.push({
      blob, ext: 'jpg',
      label: groups.length > 1 ? `${model.title}-第${cn(groups[gi][0].day)}天` : model.title,
    });
  }
  return out;
}

// 預覽用：畫到指定 canvas（單張、全部天數擠一起、縮小）
export async function renderPreview(canvas, tripId, presetId) {
  const preset = PRESETS[presetId] || PRESETS.watercolor;
  await ensureFont();
  const model = buildModel(tripId);
  for (const d of model.days) for (const it of d.items) it.img = it.photoHash ? await loadImg(it.photoHash.hash) : null;
  await drawPoster(canvas, model, model.days.slice(0, 2), preset, tripId + ':' + presetId + ':prev');
}

void db;
