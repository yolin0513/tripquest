// 行程海報 —— canvas 2D。
// 3 代理一致：canvas 2D 是唯一 rasterizer；照片只從 IndexedDB blob 畫（不 taint）。
// P1 版型（docs/DESIGN_海報重做.md）：固定 4:5 1080×1350，封面一張＋每天一張；每一區固定高度，版面由 layout.js 的純函式決定，
// 這支只負責把那份版面畫出來——畫的這一半不自己決定要放什麼（postertruthtest P9 守：不讀類別名、不讀 emoji）。

import * as store from '../store.js';
import { spotTimes } from '../spottime.js';
import { blobURL } from '../photos.js';
import { clip } from './text.js';
import { PRESETS, CJK_STACK, styleFor } from './presets.js';
import * as deco from './deco.js';
import { loadThemes, trustedTheme, trustedThemeOf, themeMeta } from '../theme.js';
import { loadPlaceLookup, placeLookupSync } from '../quests/generate.js';
import { aiPayload } from '../aicontent.js';
import { hashHue } from '../ids.js';
import { nth } from '../ui.js';
import { pagesFrom, PW, PH } from './layout.js';

const PAD = 60;

// ---------- 模型 ----------
export function buildModel(tripId) {
  const trip = store.get(tripId);
  return modelFrom({
    trip, spots: store.spotsOf(tripId), members: store.membersOf(trip.groupId),
    aiTx: aiPayload(tripId, 'tripText') || {}, questsOf: store.questsOf, submissionsOf: store.submissionsOf,
    lookup: placeLookupSync(),
  });
}

// 純函式（scripts/postertruthtest.mjs、posterlayouttest.mjs 直接餵合成行程）。
// 海報**一律不印類別**（Dispatch 2026-10-27 裁定，連可信的也不印）：沒有主題章、沒有主題插圖、沒有每站 emoji。
// 主題只拿來決定配色，而且用可信類別（trustedTheme／trustedThemeOf：從景點庫重算，不看存著的 theme）；
// 拿不到就是 null、配色退回中性。lookup 沒給（景點庫沒載好）→ 全部 null。
// 每站介紹（blurb）不進模型：P1 版型不印（設計稿第 1 節第 5、9 項）。
export function modelFrom({ trip, spots, members, aiTx = {}, questsOf, submissionsOf, lookup = null }) {
  const pickPhotoHash = (spot) => {
    // 使用者拍的（該景點任一任務的第一張）→ 景點示意圖
    for (const q of questsOf(spot.id)) {
      const sub = submissionsOf(q.id)[0];
      if (sub) return { hash: sub.thumbHash || sub.photoHash, user: true };
    }
    if (spot.heroHash) return { hash: spot.heroHash, user: false };
    return null;
  };
  const byDay = new Map();
  const byDaySpots = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) { byDay.set(d, []); byDaySpots.set(d, []); }
    byDaySpots.get(d).push(s);
    byDay.get(d).push({
      name: s.name,
      startTime: spotTimes(s).startTime, endTime: spotTimes(s).endTime,
      photoHash: pickPhotoHash(s),
      region: s.region || '',
      theme: trustedTheme(s, lookup).key,
    });
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0])
    .map(([day, items]) => ({
      day, region: items[0]?.region || trip.region || '', items,
      theme: trustedThemeOf(byDaySpots.get(day), lookup),
      aiLine: (aiTx.dayLines && aiTx.dayLines[day]) || '',
    }));
  return {
    title: trip.title || '我們的旅程',
    dateRange: [trip.startDate, trip.endDate].filter(Boolean).join(' – '),
    startDate: trip.startDate || '',
    people: members.length, spotCount: spots.length, dayCount: days.length,
    // 照片數：數出來的（每站每個任務的提交）；頭像：跟行程頁同一套（名字首字＋hashHue）
    photoCount: spots.reduce((n, s) => n + questsOf(s.id).reduce((k, q) => k + submissionsOf(q.id).length, 0), 0),
    members: members.map((mb) => ({ name: mb.displayName || mb.name || '?', hue: hashHue(mb.id || '') })),
    tripTheme: trustedThemeOf(spots, lookup),
    subtitle: aiTx.subtitle || '',
    aiText: !!(aiTx.subtitle || (aiTx.dayLines && Object.keys(aiTx.dayLines).length)) || spots.some((s) => s.aiBlurb),
    days,
  };
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
// 版面上用得到的照片（封面 C4、每天 D2／D3）一次載好；key 是雜湊
async function loadPageImages(pages) {
  const imgs = new Map();
  for (const pg of pages) {
    for (const b of pg.blocks) {
      for (const ph of [b.photo, ...(b.photos || [])]) {
        if (ph && ph.hash && !imgs.has(ph.hash)) imgs.set(ph.hash, await loadImg(ph.hash));
      }
    }
  }
  return imgs;
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

// ---------- 繪製 ----------
const F = (weight, size) => `${weight} ${size}px ${CJK_STACK}`;
const DISP = (p, weight, size) => `${weight} ${size}px ${p.displayFont}, ${CJK_STACK}`;

// 一頁：底色 → 每一區照 layout 給的 y／h 畫，不超出自己那一區（clip 到區塊範圍）
async function drawPage(canvas, page, preset, imgs, seedKey) {
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext('2d');
  const p = styleFor(preset, themeMeta(page.theme));
  const rnd = deco.mulberry32(deco.hashStr(seedKey));
  paintPaper(ctx, p, rnd);
  ctx.textBaseline = 'alphabetic';
  for (const b of page.blocks) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, b.y, PW, b.h); ctx.clip();
    const fn = BLOCKS[b.id];
    if (fn) fn(ctx, p, b, imgs, rnd);
    ctx.restore();
  }
}

const BLOCKS = {
  // 封面
  C1(ctx, p, b) {
    drawBackpack(ctx, PAD, b.y + 30, 54, p);
    ctx.textAlign = 'left'; ctx.fillStyle = p.ink; ctx.font = DISP(p, 700, 44);
    ctx.fillText(b.brand, PAD + 66, b.y + 76);
  },
  C2(ctx, p, b) {
    ctx.textAlign = 'center';
    ctx.fillStyle = p.band;
    roundRect(ctx, PAD, b.y + 14, PW - PAD * 2, 110, 26); ctx.fill();
    ctx.strokeStyle = p.ink; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = p.ink; ctx.font = F(800, 64);
    ctx.fillText(clip(ctx, b.title, PW - PAD * 2 - 60, ctx.font), PW / 2, b.y + 92);
    if (b.dateRange) {
      ctx.fillStyle = p.sub; ctx.font = F(500, 30);
      ctx.fillText(b.dateRange, PW / 2, b.y + 170);
    }
  },
  C3(ctx, p, b) {
    ctx.textAlign = 'center'; ctx.fillStyle = p.ink; ctx.font = F(600, 32);
    ctx.fillText(clip(ctx, b.text, PW - PAD * 2, ctx.font), PW / 2, b.y + 42);
  },
  C4: photoBlock,
  C5(ctx, p, b) {
    const n = b.stats.length, gap = 24, w = (PW - PAD * 2 - gap * (n - 1)) / n;
    b.stats.forEach((st, i) => {
      const x = PAD + i * (w + gap);
      ctx.fillStyle = p.band; roundRect(ctx, x, b.y + 20, w, 110, 22); ctx.fill();
      ctx.strokeStyle = p.ink; ctx.lineWidth = 3; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = p.ink; ctx.font = F(800, 52);
      ctx.fillText(String(st.value), x + w / 2, b.y + 82);
      ctx.fillStyle = p.sub; ctx.font = F(500, 24);
      ctx.fillText(st.unit, x + w / 2, b.y + 116);
    });
  },
  C6(ctx, p, b) {
    ctx.textAlign = 'left'; ctx.fillStyle = p.sub; ctx.font = F(700, 26);
    ctx.fillText(b.heading, PAD, b.y + 34);
    let x = PAD;
    for (const c of b.chips) {
      ctx.fillStyle = `hsl(${c.hue}, 55%, 40%)`;   // 夠深，白字才讀得清楚
      ctx.beginPath(); ctx.arc(x + 32, b.y + 82, 32, 0, 7); ctx.fill();
      ctx.strokeStyle = p.ink; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = F(800, 30);
      ctx.fillText((c.name || '?').trim().slice(0, 1).toUpperCase(), x + 32, b.y + 93);
      x += 80;
    }
    if (b.more) {
      ctx.textAlign = 'left'; ctx.fillStyle = p.ink; ctx.font = F(700, 28);
      ctx.fillText(`＋${b.more} 位`, x + 6, b.y + 92);
    }
  },
  C7: footerWave,

  // 每天
  D1(ctx, p, b) {
    ctx.textAlign = 'left';
    ctx.font = DISP(p, 700, 56);
    const tw = ctx.measureText(b.dayTag).width + 40;
    ctx.fillStyle = p.accent; roundRect(ctx, PAD, b.y + 30, tw, 70, 20); ctx.fill();
    ctx.strokeStyle = p.ink; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = p.paper; ctx.fillText(b.dayTag, PAD + 20, b.y + 84);
    if (b.date) {
      ctx.fillStyle = p.ink; ctx.font = F(700, 34);
      ctx.fillText(b.date, PAD + tw + 24, b.y + 78);
    }
    ctx.fillStyle = p.ink; ctx.font = F(700, 34);
    ctx.fillText(clip(ctx, b.route, PW - PAD * 2, ctx.font), PAD, b.y + 148);
  },
  D2: photoBlock,
  D3(ctx, p, b, imgs) {
    const gap = 24, w = (PW - PAD * 2 - gap) / 2, h = b.h - 30;
    b.photos.forEach((ph, i) => framedPhoto(ctx, p, imgs.get(ph.hash), PAD + i * (w + gap), b.y + 14, w, h, ph.tag));
  },
  D4(ctx, p, b) {
    ctx.textAlign = 'left'; ctx.fillStyle = p.ink; ctx.font = F(600, 30);
    ctx.fillText(clip(ctx, b.text, PW - PAD * 2, ctx.font), PAD, b.y + 46);
  },
  D5(ctx, p, b) {
    const x = PAD + 18, top = b.y + 22, rowH = 30;
    const lines = b.rows.length + (b.more ? 1 : 0);
    ctx.strokeStyle = p.line; ctx.lineWidth = 3; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + (lines - 1) * rowH); ctx.stroke(); ctx.setLineDash([]);
    b.rows.forEach((r, i) => {
      const yy = top + i * rowH;
      ctx.fillStyle = p.paper; ctx.beginPath(); ctx.arc(x, yy, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = p.accent; ctx.lineWidth = 3; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = F(700, 26);
      let tx = x + 26;
      if (r.time) { ctx.fillStyle = p.accent2; ctx.fillText(r.time, tx, yy + 9); tx += 96; }
      ctx.fillStyle = p.ink;
      ctx.fillText(clip(ctx, r.name, PW - PAD - tx, ctx.font), tx, yy + 9);
    });
    if (b.more) {
      ctx.textAlign = 'left'; ctx.fillStyle = p.sub; ctx.font = F(700, 26);
      ctx.fillText(b.moreText, x + 26, top + b.rows.length * rowH + 9);
    }
  },
  D6(ctx, p, b, imgs, rnd) {
    footerWave(ctx, p, b, imgs, rnd);
    ctx.textAlign = 'right'; ctx.fillStyle = p.sub; ctx.font = F(600, 24);
    ctx.fillText(b.pageText, PW - PAD, b.y + 34);
  },
};

// 大照片區（C4、D2）：有照片就置中裁；示意圖貼標籤；都沒有 → 大色塊＋站名，不放任何像照片的東西
function photoBlock(ctx, p, b, imgs) {
  const x = PAD, y = b.y + 10, w = PW - PAD * 2, h = b.h - 20;
  const img = b.photo ? imgs.get(b.photo.hash) : null;
  if (img) { framedPhoto(ctx, p, img, x, y, w, h, b.photo.tag); return; }
  ctx.fillStyle = p.band; roundRect(ctx, x, y, w, h, 28); ctx.fill();
  ctx.strokeStyle = p.ink; ctx.lineWidth = 4; ctx.stroke();
  if (b.fallback) {
    ctx.textAlign = 'center'; ctx.fillStyle = p.ink; ctx.font = F(800, 56);
    ctx.fillText(clip(ctx, b.fallback, w - 80, ctx.font), PW / 2, y + h / 2 + 20);
  }
}

// 粗框圓角照片，置中裁（不猜主體在哪）；tag 有字就貼左上角標籤
function framedPhoto(ctx, p, img, x, y, w, h, tag) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 24); ctx.clip();
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(w / iw, h / ih);
    ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
  } else {
    ctx.fillStyle = p.band; ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  roundRect(ctx, x, y, w, h, 24);
  ctx.strokeStyle = p.ink; ctx.lineWidth = 4; ctx.stroke();
  if (tag) {
    ctx.font = F(700, 24);
    const tw = ctx.measureText(tag).width + 28;
    ctx.fillStyle = p.paper; roundRect(ctx, x + 16, y + 16, tw, 40, 12); ctx.fill();
    ctx.strokeStyle = p.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = p.ink; ctx.textAlign = 'left'; ctx.fillText(tag, x + 30, y + 45);
  }
}

function footerWave(ctx, p, b) {
  ctx.strokeStyle = p.line; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let xx = 0; xx <= PW; xx += 6) ctx.lineTo(xx, b.y + 56 + Math.sin(xx / 30) * 8);
  ctx.stroke();
}

// 原創背包（js/glyphs.js 的 backpack，同一組形狀換成 canvas 畫）
function drawBackpack(ctx, x, y, hgt, p) {
  const s = hgt / 64;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineWidth = 4; ctx.strokeStyle = p.ink; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D('M14 10 Q14 2 22 2 H34 Q42 2 42 10'));
  ctx.fillStyle = p.accent; roundRect(ctx, 4, 10, 48, 50, 14); ctx.fill(); ctx.stroke();
  ctx.stroke(new Path2D('M4 26 Q28 36 52 26'));
  ctx.fillStyle = p.paper; roundRect(ctx, 16, 38, 24, 15, 5); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function paintPaper(ctx, p, rnd) {
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, PW, PH);
  if (!p.paperTexture) return;
  const dark = p.paperTexture === 'dark';
  ctx.save();
  ctx.globalAlpha = dark ? 0.05 : 0.06;
  ctx.strokeStyle = dark ? '#ffffff' : '#8a7355';
  ctx.lineWidth = 1;
  for (let i = 0; i < PH / 3; i++) {
    const yy = rnd() * PH;
    ctx.beginPath(); ctx.moveTo(rnd() * PW, yy); ctx.lineTo(rnd() * PW, yy + (rnd() - 0.5) * 40); ctx.stroke();
  }
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
function cn(n) { return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n] || String(n); }

// ---------- 對外 API ----------
export function presetList() {
  return Object.values(PRESETS).map((p) => ({ id: p.id, label: p.label }));
}

// 每一張的名字（檔名、預覽的翻頁列共用）
function pageLabel(model, page) {
  return page.kind === 'cover' ? `${model.title}-封面` : `${model.title}-第${cn(page.day)}天`;
}

// 產生（回傳 [{ blob, ext, label }]）：封面一張＋每天一張。
export async function renderPoster(tripId, { presetId = 'watercolor', onProgress } = {}) {
  const preset = PRESETS[presetId] || PRESETS.watercolor;
  await ensureFont();
  await loadThemes();
  await loadPlaceLookup().catch(() => {});   // 可信類別（只用在配色）要從景點庫重算；載不到 → 配色中性
  await warmPosterAi(tripId);
  const model = buildModel(tripId);
  if (!model.days.length) throw new Error('這個行程還沒有景點');

  const pages = posterPages(model);
  onProgress && onProgress('載入照片…');
  const imgs = await loadPageImages(pages);

  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress && onProgress(`繪製第 ${i + 1}/${pages.length} 張…`);
    const canvas = document.createElement('canvas');
    await drawPage(canvas, pages[i], preset, imgs, tripId + ':' + presetId + ':' + i);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    out.push({ blob, ext: 'jpg', label: pageLabel(model, pages[i]) });
  }
  return out;
}

// 有開 AI 才在背景把海報 / 影片共用的文案產一產（有快取就秒回）。
// export 出去讓 poster.js 在背景先呼叫，好了再重畫一次預覽；export 本身會等它。
export async function warmPosterAi(tripId) {
  const trip = store.get(tripId);
  if (!trip || !trip.aiEnabled) return false;
  try {
    const { ensureTripText, ensureSpotBlurbs } = await import('../aicontent.js');
    const [a, b] = await Promise.all([ensureTripText(tripId), ensureSpotBlurbs(tripId)]);
    return !!(a || b);
  } catch { return false; }
}

// 匯出與預覽共用同一份版面——預覽跟成品不一樣就是騙人。
export function posterPages(model) {
  return pagesFrom(model);
}

// 預覽用：畫到指定 canvas —— 不等 AI，用現有快取。page 指定看第幾張，回傳頁數讓 UI 放「上一張/下一張」。
export async function renderPreview(canvas, tripId, presetId, page = 0) {
  const preset = PRESETS[presetId] || PRESETS.watercolor;
  await ensureFont();
  await loadThemes();
  await loadPlaceLookup().catch(() => {});   // 預覽跟成品要一樣：同樣先載好景點庫
  const model = buildModel(tripId);
  const pages = posterPages(model);
  const gi = Math.max(0, Math.min(pages.length - 1, page));
  const imgs = await loadPageImages([pages[gi]]);
  await drawPage(canvas, pages[gi], preset, imgs, tripId + ':' + presetId + ':' + gi);
  return {
    pages: pages.length, page: gi,
    label: pages[gi].kind === 'cover' ? '封面' : nth(pages[gi].day, '天'),
  };
}
