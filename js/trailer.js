// 回顧影片「預告片」風格（v1.97.0；規劃 docs/DESIGN_回顧影片預告片風格.md，Yolin 2026-11-19 第 10 節 1～7 選甲）
//
// 跟原本的風格（js/memory.js 的 buildTimeline／drawAt／createPlayer／recordVideo）是兩條分開的路：
// 原本那條一行都不改（scripts/trailertest.mjs TR09 拿推送過的版本逐格比對）。這裡只借 memory.js 的幾支純函式
// （挑照片、排字、路線版面、標籤、錄影格式），不改它們。
//
// 畫面：直式 1080×1920，上下各 232px 黑邊，中間的畫面 1080×1456（接近 3:4）。照片說明放在下面的黑邊裡。
// 拍點：js/trailerplan.js（畫面與配樂讀同一份）。
//
// 字只有兩種來源（規劃 3.3；TR03 逐字核）：
//   行程資料——年月（開始日期）、地區、人數、天數、行程名稱、群組名稱、旅伴名字、照片說明（使用者寫的）、
//              開始與結束日期、路線段的景點名（照現有路線地圖的規則，對得回景點庫的才放符號）；配樂授權那一行。
//   固定的詞——出品、主演、TripQuest、個人、天、年、月，以及照片不夠時那句說明（MSG_FEW）。
// 不寫季節（南半球的 8 月是冬天）、不寫猜出來的標語（設計原則：猜出來的東西不准變成使用者看得到的字）。
// 所以路線段不用 memory.js 的 drawMap（它會畫「我們走過的地方」、指北針、比例尺、「X一帶」），只借版面與標籤。

import * as store from './store.js';
import { blobURL } from './photos.js';
import { collectSlides, pickHighlights, fitText, computeMapLayout, drawLabel, pickMime } from './memory.js';
import { createMusic, musicFromFile, createTrailerScore } from './music.js';
import { trackMusic, isTrackStyle, musicCredit } from './tracks.js';
import { planTrailer, shotAt, BEAT, MIN_PHOTOS, NEED } from './trailerplan.js';
import { mascot, MASCOT_KINDS } from './glyphs.js';
import { loadThemes } from './theme.js';
import { loadPlaceLookup } from './quests/generate.js';

const W = 1080, H = 1920;
export const BAR = 232;
export const WIN = Object.freeze({ x: 0, y: BAR, w: W, h: H - BAR * 2 });
const WIN_AR = WIN.w / WIN.h;
const FONT = '"Noto Sans TC", system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';
const DIP = 0.15;                       // 切黑：前一張淡到黑 0.15 秒、下一張淡入 0.15 秒
const COLD_BG = '#0d1014';              // 冷開場畫面裡的顏色：比黑邊亮一點，黑邊滑進來才看得到

export const TRAILER_MUSIC = 'trailer';
export const MSG_FEW = `照片少於 ${MIN_PHOTOS} 張，做不出預告片`;
export const DEGRADE_PARTS = Object.freeze(['顆粒', '景深', '調色']);   // 自動降級依序關掉（規劃 4.1）

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function rng(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

// ---------- 選擇存在這支手機（規劃第 7 節選甲：不同步、不動資料結構） ----------
const PREF_KEY = 'tripquest.trailer';
function readPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } }
export function trailerPref(tripId) {
  const p = readPrefs()[tripId] || {};
  return { style: p.style === 'trailer' ? 'trailer' : 'classic', music: typeof p.music === 'string' && p.music ? p.music : TRAILER_MUSIC };
}
export function setTrailerPref(tripId, patch) {
  const all = readPrefs();
  all[tripId] = { ...(all[tripId] || {}), ...patch };
  try { localStorage.setItem(PREF_KEY, JSON.stringify(all)); } catch { /* 無痕模式：只是下次要重選 */ }
}

// ---------- 行程資料 → 字 ----------
export function ymOf(date) {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(date || ''));
  return m ? `${m[1]}年${Number(m[2])}月` : '';
}
function daysOf(trip, slides) {
  const a = Date.parse(trip.startDate || ''), b = Date.parse(trip.endDate || '');
  if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return Math.round((b - a) / 86400000) + 1;
  return slides.reduce((m, s) => Math.max(m, Number(s.day) || 0), 0);
}
const capOf = (s) => String(s?.caption || '').trim();     // 只用使用者寫的說明（不退任務標題、不用 AI 字幕）

function tripTexts(tripId, slides) {
  const trip = store.get(tripId);
  const group = trip.groupId ? store.getRaw(trip.groupId) : null;
  const members = trip.groupId ? store.membersOf(trip.groupId) : [];
  const gname = String(group?.name || '').trim();
  const days = daysOf(trip, slides);
  return {
    ym: ymOf(trip.startDate),
    region: String(trip.region || '').trim(),
    title: String(trip.title || '').trim(),
    studio: `${gname || 'TripQuest'} 出品`,
    members: members.length ? `${members.length} 個人` : '',
    days: days > 0 ? `${days} 天` : '',
    names: members.map((m) => String(m.displayName || '').trim()).filter(Boolean).join('、'),
    range: [trip.startDate, trip.endDate].filter(Boolean).join(' – '),
  };
}

// 相簿頁用：做不做得出來、大概多長（不解碼照片）
export function trailerInfo(tripId, { calm = false } = {}) {
  const all = collectSlides(tripId);
  // 這一道與 js/trailerplan.js planTrailer 的 n >= MIN_PHOTOS - 1 互為備援：單獨移除任一道不會讓任何測試紅，移除前要確認另一道仍在
  if (all.length < MIN_PHOTOS) return { ok: false, total: all.length, photos: 0, seconds: 0, reason: MSG_FEW };
  const tx = tripTexts(tripId, all);
  const route = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null).length >= 2;
  const n = Math.min(all.length, NEED) - 1;
  const plan = planTrailer({ n, route, cards: [tx.members && 'members', tx.days && 'days'].filter(Boolean), calm });
  return { ok: !!plan, total: all.length, photos: plan ? plan.photos + 1 : 0, seconds: plan ? plan.total : 0, reason: plan ? '' : MSG_FEW };
}

// ---------- 照片快取（照時間預載；規劃 4.2） ----------
// 原本風格的滑動視窗（先載 4 張、每 300ms 補）撐不住一拍一張的快剪：這裡照「接下來 5 秒會用到的」預載，
// 快剪那 16 張在開始前 8 秒就先解碼成寬 720 的小圖，播完才放掉。
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('圖片載入失敗'));
    im.src = url;
  });
}
async function shrink(img, w = 720) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (iw <= w) return img;
  const h = Math.round(ih * w / iw);
  try { return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' }); }
  catch {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }
}

class TrailerFrames {
  constructor(slides, plan) {
    this.slides = slides;
    this.plan = plan;
    this.imgs = new Map(); this.jobs = new Map(); this.failed = new Set();
    const mont = plan.shots.filter((s) => s.section === 'montage');
    this.small = new Set(mont.map((s) => s.idx));
    this.montT0 = mont.length ? mont[0].t0 : Infinity;
    this.montT1 = mont.length ? mont[mont.length - 1].t0 + mont[mont.length - 1].dur : -Infinity;
  }
  get length() { return this.slides.length; }
  has(i) { return this.imgs.has(i); }
  get(i) { return this.imgs.get(i) || null; }
  load(i) {
    if (i == null || this.imgs.has(i) || this.failed.has(i)) return Promise.resolve();
    if (this.jobs.has(i)) return this.jobs.get(i);
    const sl = this.slides[i];
    const job = (async () => {
      for (const hash of [sl?.hash, sl?.thumbHash]) {
        if (!hash) continue;
        try {
          const url = await blobURL(hash);
          if (!url) continue;
          const img = await loadImage(url);
          this.imgs.set(i, this.small.has(i) ? await shrink(img) : img);
          return;
        } catch { /* 換下一個來源 */ }
      }
      this.failed.add(i);
    })();
    this.jobs.set(i, job);
    job.finally(() => this.jobs.delete(i));
    return job;
  }
  // 第 t 秒時該握著哪幾張：[t − 0.3, t + 5] 會出現的；快剪開始前 8 秒到結束，16 張全部留著
  want(t) {
    const out = new Set();
    for (const s of this.plan.shots) {
      if (s.idx == null) continue;
      if (s.t0 + s.dur >= t - 0.3 && s.t0 <= t + 5) out.add(s.idx);
    }
    if (t >= this.montT0 - 8 && t <= this.montT1) for (const i of this.small) out.add(i);
    return out;
  }
  pump(t) {
    const want = this.want(t);
    for (const i of want) this.load(i);
    for (const k of [...this.imgs.keys()]) {
      if (want.has(k)) continue;
      const im = this.imgs.get(k);
      this.imgs.delete(k);
      try { im?.close?.(); } catch { /* noop */ }
    }
  }
  async ensure(i) { if (i != null && i >= 0 && i < this.length && !this.imgs.has(i) && !this.failed.has(i)) await this.load(i); }
  clear() { for (const im of this.imgs.values()) { try { im?.close?.(); } catch { /* noop */ } } this.imgs.clear(); }
}

// ---------- 吉祥物剪影（出品卡；不用 GPT：App 自己的向量塗黑） ----------
async function buildSilhouettes() {
  try {
    const hgt = 150, w = Math.round(hgt * 212 / 252), gap = 10;
    const kinds = MASCOT_KINDS.slice(0, 6);
    const c = document.createElement('canvas');
    c.width = kinds.length * w + (kinds.length - 1) * gap; c.height = hgt;
    const x = c.getContext('2d');
    let cx = 0;
    for (const k of kinds) {
      const el = mascot(k, hgt);
      el.querySelectorAll('.mc-extra, .mc-shadow').forEach((n) => n.remove());
      const str = new XMLSerializer().serializeToString(el);
      const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str));
      x.drawImage(img, cx, 0, w, hgt);
      cx += w + gap;
    }
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#07080c';
    x.fillRect(0, 0, c.width, c.height);
    return c;
  } catch { return null; }       // 畫不出來：出品卡只放字
}

// ---------- 時間軸 ----------
// opts: { calm, music, musicFile }
export async function buildTrailer(tripId, opts = {}) {
  const all = collectSlides(tripId);
  // 這一道與 js/trailerplan.js planTrailer 的 n >= MIN_PHOTOS - 1 互為備援：單獨移除任一道不會讓任何測試紅，移除前要確認另一道仍在
  if (all.length < MIN_PHOTOS) return null;
  const calm = !!opts.calm;
  const picked = pickHighlights(all, NEED);
  // 彩蛋：有說明而且讚最多的那一張；沒有人寫說明就讚最多的那一張（同分取時間早的）
  const withCap = picked.filter((s) => capOf(s));
  const pool = withCap.length ? withCap : picked;
  const egg = pool.reduce((best, s) => (!best || s.likes > best.likes ? s : best), null);
  let seq = picked.filter((s) => s !== egg);

  const coord = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null);
  let layout = null;
  if (coord.length >= 2) {
    await loadThemes().catch(() => {});
    const lookup = await loadPlaceLookup().catch(() => null);
    const mc = document.createElement('canvas').getContext('2d');
    layout = computeMapLayout(mc, coord, { totalSpots: store.spotsOf(tripId).length, lookup });
  }
  const tx = tripTexts(tripId, all);
  const cards = [tx.members && 'members', tx.days && 'days'].filter(Boolean);
  let plan = planTrailer({ n: seq.length, days: seq.map((s) => s.day), route: !!layout, cards, calm });
  if (!plan) return null;
  // 平穩版張數變少：照時間平均挑，不是砍掉最後幾天
  if (plan.photos < seq.length) {
    const k = plan.photos;
    seq = Array.from({ length: k }, (_, i) => seq[Math.round(i * (seq.length - 1) / Math.max(1, k - 1))]);
    plan = planTrailer({ n: seq.length, days: seq.map((s) => s.day), route: !!layout, cards, calm });
  }
  const slides = [...seq.slice(0, plan.photos), egg];
  const eggIdx = slides.length - 1;
  for (const s of plan.shots) if (s.kind === 'egg') s.idx = eggIdx;
  slides.forEach((s, i) => { s._panX = i % 2 ? 1 : -1; s._panY = i % 3 ? -1 : 1; s._wfit = null; s._depth = undefined; s._bk = undefined; });

  // 片名卡的光斑（程式畫的；中間 38%～62% 留給字）
  const r = rng(20261119);
  const bokeh = [];
  while (bokeh.length < 22) {
    const y = r();
    if (y > 0.34 && y < 0.66) continue;
    bokeh.push({ x: r(), y, rad: 40 + r() * 120, a: 0.08 + r() * 0.22, warm: r() < 0.85 });
  }

  return {
    plan, total: plan.total, calm, slides, egg, eggIdx,
    frames: new TrailerFrames(slides, plan),
    tx, layout, bokeh,
    sil: await buildSilhouettes(),
    credit: opts.musicFile ? null : musicCredit(opts.music || null),
    level: Math.max(0, Math.min(3, opts.level || 0)),
  };
}

// ---------- 繪製 ----------
function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.max(0, px).toFixed(1)}px`; }

// 置中畫一段字（y 是整塊的中線）；回傳高度
function text(ctx, str, x, y, { size, min = 24, weight = 700, maxW = 900, maxLines = 1, color = '#fff', alpha = 1, em = 0, align = 'center' }) {
  if (!str || alpha <= 0.003) return 0;
  ctx.save();
  ctx.globalAlpha *= alpha;
  setSpacing(ctx, em * size);
  const fit = fitText(ctx, str, { maxW, maxLines, size, min, weight, family: FONT });
  ctx.font = `${weight} ${fit.size}px ${FONT}`;
  setSpacing(ctx, em * fit.size);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  const h0 = (fit.lines.length - 1) * fit.lh;
  fit.lines.forEach((ln, i) => ctx.fillText(ln, x, y - h0 / 2 + i * fit.lh));
  ctx.restore();
  return fit.lines.length * fit.lh;
}

function winFit(iw, ih) {
  if (!iw || !ih) return 'cover';
  const r = (iw / ih) / WIN_AR;
  return (r > 1.35 || r < 0.72) ? 'contain' : 'cover';
}

// cover 的位置（推鏡、平移、往上偏——人臉通常在上半部）
function coverRect(iw, ih, kb, panX, panY) {
  const s = Math.max(WIN.w / iw, WIN.h / ih) * kb;
  const dw = iw * s, dh = ih * s;
  const over = dh - WIN.h * kb;
  const bias = over > 2 ? -over * 0.18 : 0;
  return { x: WIN.x + (WIN.w - dw) / 2 + panX, y: WIN.y + (WIN.h - dh) / 2 + bias + panY, w: dw, h: dh };
}

// 縮小再放大＝糊化（不用 ctx.filter：各家瀏覽器支援度與效能差很多）
function tinyCover(img, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const s = Math.max(w / iw, h / ih);
  x.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
  return c;
}
// 景深（假的）：同一張照片糊化、中間挖一個漸層的洞，疊在上面——四周糊、中間清楚。每換一張照片做一次。
function depthOf(slide, img) {
  if (slide._depth !== undefined) return slide._depth;
  try {
    const tiny = tinyCover(img, 27, 36);
    const d = document.createElement('canvas'); d.width = 108; d.height = 146;
    const x = d.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(tiny, 0, 0, 108, 146);
    x.globalCompositeOperation = 'destination-out';
    const g = x.createRadialGradient(54, 62, 22, 54, 62, 84);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 108, 146);
    slide._depth = d;
  } catch { slide._depth = null; }
  return slide._depth;
}
function backdropOf(slide, img) {
  if (slide._bk !== undefined) return slide._bk;
  try { slide._bk = tinyCover(img, 27, 36); } catch { slide._bk = null; }
  return slide._bk;
}

function fillWin(ctx, color) { ctx.fillStyle = color; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h); }

function drawPhoto(ctx, tl, slide, img, p, k0, k1, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!img) { fillWin(ctx, '#161a22'); ctx.restore(); return; }   // 這張載入失敗：底色撐過去，不中斷
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!slide._wfit) slide._wfit = winFit(iw, ih);
  const e = easeInOut(clamp01(p));
  const kb = tl.calm ? 1 : k0 + (k1 - k0) * e;
  const panX = tl.calm ? 0 : slide._panX * 18 * e;
  const panY = tl.calm ? 0 : slide._panY * 12 * e;
  if (slide._wfit === 'contain') {
    const bk = backdropOf(slide, img);
    if (bk) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bk, WIN.x - 30, WIN.y - 30, WIN.w + 60, WIN.h + 60);
      ctx.fillStyle = 'rgba(8,10,16,0.5)'; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    }
    const s = Math.min(WIN.w / iw, WIN.h / ih) * (1 + (kb - 1) * 0.5);       // 放進畫面的照片推得比較輕，不會再裁到人
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, WIN.x + (WIN.w - dw) / 2, WIN.y + (WIN.h - dh) / 2, dw, dh);
  } else {
    const r = coverRect(iw, ih, kb, panX, panY);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    if (tl.level < 2) {
      const d = depthOf(slide, img);
      if (d) {
        const rw = WIN.w * kb, rh = WIN.h * kb;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = alpha * 0.9;
        ctx.drawImage(d, WIN.x + (WIN.w - rw) / 2 + panX, WIN.y + (WIN.h - rh) / 2 + panY, rw, rh);
      }
    }
  }
  ctx.restore();
}

// 調色：只用混合模式疊幾層全畫面的顏色，不逐像素運算（規劃 3.5）
function gradeWin(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const g = ctx.createLinearGradient(0, WIN.y, 0, WIN.y + WIN.h);
  g.addColorStop(0, 'rgba(18,96,120,0.55)'); g.addColorStop(1, 'rgba(255,168,92,0.45)');
  fillWin(ctx, g);
  ctx.globalCompositeOperation = 'saturation';
  fillWin(ctx, 'rgba(128,128,128,0.22)');
  ctx.globalCompositeOperation = 'source-over';
  const cy = WIN.y + WIN.h / 2;
  const v = ctx.createRadialGradient(W / 2, cy, WIN.h * 0.3, W / 2, cy, WIN.h * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
  fillWin(ctx, v);
  ctx.restore();
}

// 顆粒：一塊 256×256 的雜訊（固定種子），每一格換位置平鋪。平穩版不動（frameNo 固定 0）。
let _grainTile = null;
function grainTile() {
  if (_grainTile) return _grainTile;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const im = x.createImageData(256, 256);
  const r = rng(7919);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = 128 + Math.round((r() - 0.5) * 110);
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  _grainTile = c;
  return c;
}
function grainWin(ctx, frameNo) {
  const pat = ctx.createPattern(grainTile(), 'repeat');
  const ox = (frameNo * 97) % 256, oy = (frameNo * 59) % 256;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.12;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(WIN.x + ox, WIN.y + oy, WIN.w, WIN.h);
  ctx.restore();
}

function drawCold(ctx, tl, shot, lt) {
  fillWin(ctx, COLD_BG);
  let lines = [tl.tx.ym, tl.tx.region].filter(Boolean);
  if (!lines.length) lines = [tl.tx.title].filter(Boolean);
  if (!lines.length) return;
  const part = shot.dur / lines.length;
  const k = Math.min(lines.length - 1, Math.floor(lt / part));
  const l2 = lt - k * part;
  const a = Math.min(clamp01(l2 / 0.6), clamp01((part - l2) / 0.45));
  text(ctx, lines[k], W / 2, WIN.y + WIN.h * 0.5, { size: 76, min: 40, weight: 700, maxW: 940, color: '#e9e9e9', alpha: a, em: 0.18 });
}

function drawStudio(ctx, tl, shot, lt) {
  const top = WIN.y, band = WIN.y + WIN.h * 0.72;
  const sky = ctx.createLinearGradient(0, top, 0, band);
  sky.addColorStop(0, '#141c34'); sky.addColorStop(0.55, '#5b4a6e'); sky.addColorStop(0.82, '#c98478'); sky.addColorStop(1, '#f3b46a');
  ctx.fillStyle = sky; ctx.fillRect(WIN.x, top, WIN.w, band - top);
  const glow = ctx.createRadialGradient(W / 2, band, 10, W / 2, band, 560);       // 逆光
  glow.addColorStop(0, 'rgba(255,214,150,0.75)'); glow.addColorStop(1, 'rgba(255,170,110,0)');
  ctx.fillStyle = glow; ctx.fillRect(WIN.x, top, WIN.w, band - top);
  ctx.fillStyle = '#0b0b10'; ctx.fillRect(WIN.x, band, WIN.w, WIN.y + WIN.h - band);   // 平塗的暗帶，剪影站在上面
  if (tl.sil) ctx.drawImage(tl.sil, (W - tl.sil.width) / 2, band - tl.sil.height + 6);
  const a = Math.min(clamp01((lt - 0.2) / 0.5), clamp01((shot.dur - lt) / 0.35));
  text(ctx, tl.tx.studio, W / 2, WIN.y + WIN.h * 0.3, { size: 60, min: 32, weight: 700, maxW: 920, color: '#fff', alpha: a, em: 0.12 });
  const blackA = Math.max(1 - clamp01(lt / 0.3), 1 - clamp01((shot.dur - lt) / 0.3));
  if (blackA > 0) { ctx.save(); ctx.globalAlpha = blackA; fillWin(ctx, '#000'); ctx.restore(); }
}

function drawCard(ctx, tl, shot, lt) {
  fillWin(ctx, '#07090d');
  const str = shot.card === 'members' ? tl.tx.members : tl.tx.days;
  const a = Math.min(clamp01(lt / 0.35), clamp01((shot.dur - lt) / 0.35));
  const sc = tl.calm ? 1 : 1 + 0.05 * easeOut(clamp01(lt / shot.dur));    // 平穩版：字只淡入淡出，不縮放
  ctx.save();
  ctx.translate(W / 2, WIN.y + WIN.h / 2); ctx.scale(sc, sc);
  text(ctx, str, 0, 0, { size: 132, min: 60, weight: 800, maxW: 900, color: '#f4f4f4', alpha: a, em: 0.06 });
  ctx.restore();
}

function drawRoute(ctx, tl, shot, lt) {
  fillWin(ctx, '#0b1120');
  const L = tl.layout;
  if (!L) return;
  const s = 0.74;
  const fade = Math.min(clamp01(lt / 0.3), clamp01((shot.dur - lt) / 0.3));
  const prog = clamp01(lt / (shot.dur * 0.75));
  const total = Math.max(1, L.pts.length - 1);
  const appear = (i) => clamp01(prog * total - i + 0.5);
  ctx.save();
  ctx.translate((W - W * s) / 2, WIN.y + (WIN.h - H * s) / 2);
  ctx.scale(s, s);
  ctx.globalAlpha = fade;
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.setLineDash([18, 14]);
  ctx.beginPath();
  L.pts.forEach((p, i) => {
    if (i === 0) { ctx.moveTo(p.x, p.y); return; }
    const kk = clamp01(prog * total - (i - 1));
    if (kk <= 0) return;
    const q = L.pts[i - 1];
    ctx.lineTo(q.x + (p.x - q.x) * kk, q.y + (p.y - q.y) * kk);
  });
  ctx.stroke(); ctx.setLineDash([]);
  for (const p of L.pts) {
    const a = appear(p.i);
    if (a <= 0) continue;
    ctx.globalAlpha = fade * a; ctx.fillStyle = '#4f8dff';
    ctx.beginPath(); ctx.arc(p.x, p.y, L.cluster?.inSet.has(p.i) ? 9 : 14, 0, 7); ctx.fill();
  }
  // 景點名照現有地圖的規則（標籤、符號、碰撞）；「X一帶（N 個地點）」那顆是從名字推的，不放
  for (const lb of L.overview.labels) {
    if (L.cluster && lb.text === L.cluster.label) continue;
    const src = L.pts.find((p) => Math.abs(p.x - lb.x) < 1 && Math.abs(p.y - lb.y) < 1);
    const a = src ? appear(src.i) : 0;
    if (a <= 0) continue;
    ctx.globalAlpha = fade * a;
    drawLabel(ctx, lb, lb.x, lb.y);
  }
  ctx.restore();
}

function drawTitle(ctx, tl, shot, lt) {
  fillWin(ctx, '#120d0a');
  const e = easeOut(clamp01(lt / shot.dur));
  const sc = tl.calm ? 1 : 1 + 0.03 * e;
  ctx.save();
  ctx.translate(W / 2, WIN.y + WIN.h / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -(WIN.y + WIN.h / 2));
  for (const b of tl.bokeh) {
    const x = WIN.x + b.x * WIN.w, y = WIN.y + b.y * WIN.h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, b.rad);
    g.addColorStop(0, b.warm ? `rgba(255,196,120,${b.a})` : `rgba(190,210,255,${b.a})`);
    g.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = g; ctx.fillRect(x - b.rad, y - b.rad, b.rad * 2, b.rad * 2);
  }
  ctx.restore();
  const a = Math.min(clamp01(lt / 0.8), clamp01((shot.dur - lt) / 0.6));
  const main = tl.tx.title || tl.tx.ym;
  if (!main) return;
  // 字距慢慢收緊（平穩版固定）。字級只算一次：字距收緊的過程中字不可以忽大忽小
  if (!tl._titleFit) {
    setSpacing(ctx, 0);
    tl._titleFit = fitText(ctx, main, { maxW: 760, maxLines: 2, size: 92, min: 44, weight: 800, family: FONT });
    ctx.font = `800 ${tl._titleFit.size}px ${FONT}`;
    const wMax = Math.max(...tl._titleFit.lines.map((l) => ctx.measureText(l).width));
    const chars = Math.max(1, ...tl._titleFit.lines.map((l) => [...l].length));
    tl._titleEm = Math.max(0.06, Math.min(0.32, (940 - wMax) / (chars * tl._titleFit.size)));
  }
  const fit = tl._titleFit;
  const em = tl.calm ? 0.06 : tl._titleEm + (0.06 - tl._titleEm) * easeOut(clamp01(lt / (shot.dur * 0.9)));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `800 ${fit.size}px ${FONT}`;
  setSpacing(ctx, em * fit.size);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cy = WIN.y + WIN.h * 0.5, h0 = (fit.lines.length - 1) * fit.lh;
  fit.lines.forEach((ln, i) => ctx.fillText(ln, W / 2, cy - h0 / 2 + i * fit.lh));
  ctx.restore();
  if (tl.tx.title && tl.tx.ym) text(ctx, tl.tx.ym, W / 2, cy + h0 / 2 + fit.lh * 0.5 + 56, { size: 40, min: 28, weight: 500, color: '#d9cdbf', alpha: a, em: 0.2 });
}

function drawEnd(ctx, tl, shot, lt) {
  const a = Math.min(clamp01(lt / 0.5), clamp01((shot.dur - lt) / 0.8));
  let y = WIN.y + WIN.h * 0.3;
  if (tl.tx.names) {
    text(ctx, '主演', W / 2, y, { size: 34, min: 26, weight: 500, color: '#9a9a9a', alpha: a, em: 0.3 });
    y += 70;
    const h = text(ctx, tl.tx.names, W / 2, y + 40, { size: 52, min: 30, weight: 700, maxW: 900, maxLines: 3, color: '#f0f0f0', alpha: a, em: 0.04 });
    y += 40 + h / 2 + 50;
  }
  if (tl.tx.range) text(ctx, tl.tx.range, W / 2, y + 20, { size: 36, min: 26, weight: 500, color: '#bdbdbd', alpha: a, em: 0.06 });
  text(ctx, 'TripQuest', W / 2, WIN.y + WIN.h * 0.84, { size: 30, min: 24, weight: 700, color: '#7a7a7a', alpha: a, em: 0.2 });
}

// 第 t 秒的畫面（純函式：同一份時間軸、同一個 t、同一個降級等級，畫出來一定一樣）
export function drawTrailerAt(ctx, tl, t) {
  const tt = Math.max(0, Math.min(tl.total - 1e-6, t));
  const shot = shotAt(tl.plan, tt);
  const lt = tt - shot.t0;
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = shot.kind === 'cold' ? COLD_BG : '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h); ctx.clip();
  let caption = '', capA = 0, grade = false, grain = true;
  if (shot.kind === 'cold') drawCold(ctx, tl, shot, lt);
  else if (shot.kind === 'studio') { drawStudio(ctx, tl, shot, lt); grade = true; }
  else if (shot.kind === 'card') drawCard(ctx, tl, shot, lt);
  else if (shot.kind === 'route') drawRoute(ctx, tl, shot, lt);
  else if (shot.kind === 'title') { drawTitle(ctx, tl, shot, lt); grade = true; }
  else if (shot.kind === 'end') { drawEnd(ctx, tl, shot, lt); grain = false; }
  else if (shot.kind === 'black') grain = false;
  else if (shot.kind === 'photo' || shot.kind === 'egg') {
    const slide = tl.slides[shot.idx];
    const img = tl.frames.get(shot.idx);
    let a = 1, k0 = 1, k1 = 1;
    if (shot.kind === 'egg') a = Math.min(clamp01(lt / 0.4), clamp01((shot.dur - lt) / 0.6));   // 彩蛋：停住
    else {
      [k0, k1] = shot.section === 'build' ? [1.0, 1.08] : shot.section === 'accel' ? [1.04, 1.12] : [1.0, 1.03];
      if (shot.dip) a = Math.min(clamp01(lt / DIP), clamp01((shot.dur - lt) / DIP));
      if (shot.blackTail && lt >= shot.dur - BEAT) a = 1 - clamp01((lt - (shot.dur - BEAT)) / DIP);   // 換天：最後一拍是黑的
    }
    drawPhoto(ctx, tl, slide, img, lt / shot.dur, k0, k1, a);
    grade = true;
    if (shot.section !== 'montage') { caption = capOf(slide); capA = a * clamp01((lt - DIP) / 0.25); }
  }
  if (grade && tl.level < 3) gradeWin(ctx);
  if (grain && tl.level < 1) grainWin(ctx, tl.calm ? 0 : Math.floor(tt * 25));
  // 白閃：一般版偶數張的下拍（每 2 拍最多一次）；平穩版的拍點表裡沒有 flash
  if (shot.flash && !tl.calm && lt < 0.16) {
    ctx.save(); ctx.globalAlpha = lt < 0.04 ? 1 : 1 - clamp01((lt - 0.04) / 0.12); fillWin(ctx, '#fff'); ctx.restore();
  }
  ctx.restore();
  // 黑邊：冷開場從畫面外滑進來（平穩版直接出現）；照片說明放在下面的黑邊裡
  const bh = shot.kind === 'cold' && !tl.calm ? BAR * easeOut(clamp01(lt / 1.2)) : BAR;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, bh);
  ctx.fillRect(0, H - bh, W, bh);
  if (caption && capA > 0) text(ctx, caption, W / 2, H - BAR / 2, { size: 40, min: 26, weight: 500, maxW: 940, maxLines: 2, color: '#f2f2f2', alpha: capA });
  if (shot.kind === 'end' && tl.credit) {
    const a = Math.min(clamp01(lt / 0.5), clamp01((shot.dur - lt) / 0.8));
    // 授權標示：影片會被單獨分享，片尾是唯一跟著影片走的出處（同原本的風格）
    text(ctx, tl.credit.line1, W / 2, H - BAR / 2 - (tl.credit.line2 ? 22 : 0), { size: 26, min: 18, weight: 400, maxW: 990, color: '#8c8c8c', alpha: a });
    if (tl.credit.line2) text(ctx, tl.credit.line2, W / 2, H - BAR / 2 + 24, { size: 22, min: 16, weight: 400, maxW: 990, color: '#777777', alpha: a });
  }
  ctx.restore();
}

// ---------- 自動降級（規劃 4.1） ----------
// 最近 1 秒平均一格畫超過 30ms：依序關掉顆粒 → 景深 → 調色。控制器跟繪製分開：繪製只看 tl.level。
export class DegradeMeter {
  constructor({ limitMs = 30, windowMs = 1000, minSamples = 8, level = 0 } = {}) {
    this.limit = limitMs; this.win = windowMs; this.min = minSamples; this.level = level; this.samples = [];
  }
  // 回傳 null（沒變）或 { level, off: ['顆粒', …] }
  record(ms, at) {
    this.samples.push([at, ms]);
    while (this.samples.length && this.samples[0][0] < at - this.win) this.samples.shift();
    if (this.level >= 3 || this.samples.length < this.min) return null;
    const avg = this.samples.reduce((n, s) => n + s[1], 0) / this.samples.length;
    if (avg <= this.limit) return null;
    this.level++;
    this.samples = [];
    return { level: this.level, off: DEGRADE_PARTS.slice(0, this.level) };
  }
}
export const degradeNote = (off) => `這支手機比較慢，已關掉${off.join('、')}`;

// ---------- 時鐘（規劃 3.4：用預告片配樂時畫面看音訊時鐘） ----------
// music 要有 running()／time()；音訊時鐘沒在走就看牆上時鐘。播放中音訊時鐘停住超過半秒 → 改看牆上時鐘、從停住的地方接著走
// （不這樣做，錄影迴圈會永遠等不到片尾）。now 可以換（測試傳假的時鐘）。
export function makeClock(total, { now = () => performance.now(), stallMs = 500 } = {}) {
  let audio = null, offset = 0, wall = 0, lastA = 0, lastW = 0;
  return {
    begin(at, music) {
      offset = at; wall = now(); lastA = at; lastW = wall;
      audio = music && typeof music.running === 'function' && music.running() ? music : null;
    },
    now() {
      const w = now();
      if (audio) {
        const a = audio.time();
        if (a > lastA + 1e-4) { lastA = a; lastW = w; return Math.min(total, a); }
        if (w - lastW <= stallMs) return Math.min(total, lastA);
        audio = null; offset = lastA; wall = w;
      }
      return Math.min(total, offset + (w - wall) / 1000);
    },
    get audio() { return !!audio; },
  };
}

async function musicForTrailer(style, tl) {
  if (!style || style === 'none') return null;
  if (style === TRAILER_MUSIC) return createTrailerScore(tl.plan);
  if (isTrackStyle(style)) return await trackMusic(style.slice(6));
  return createMusic(style, { duration: tl.total });
}

function photoIdxAt(tl, t) {
  const s = shotAt(tl.plan, Math.max(0, Math.min(tl.total - 1e-6, t)));
  return s.idx ?? null;
}

// ---------- 預覽播放器（介面同 memory.js 的 createPlayer） ----------
// opts: { calm, level, onDegrade(info) }
export async function createTrailerPlayer(canvas, tripId, opts = {}) {
  const tl = await buildTrailer(tripId, opts);
  if (!tl) throw new Error(MSG_FEW);
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  tl.frames.pump(0);
  await tl.frames.ensure(tl.plan.shots.find((s) => s.idx != null)?.idx);

  const clock = makeClock(tl.total);
  const meter = new DegradeMeter({ level: tl.level });
  let iv = 0, pf = 0, playing = false, onEnd = null, music = null, musicStyle = null, playGen = 0, offset = 0;
  const now = () => (playing ? clock.now() : offset);
  const draw = (t, measure) => {
    const t0 = performance.now();
    try { drawTrailerAt(ctx, tl, t); } catch (e) { console.error(e); }
    if (!measure) return;
    const ch = meter.record(performance.now() - t0, performance.now());
    if (ch) { tl.level = ch.level; try { opts.onDegrade?.(ch); } catch { /* noop */ } }
  };
  const stopClocks = () => { clearInterval(iv); clearInterval(pf); };
  function tick() {
    if (!playing) return;
    const t = now();
    draw(t, true);
    if (t >= tl.total) {
      offset = tl.total; playing = false;
      stopClocks();
      music?.fadeOutStop(0.8); music = null; musicStyle = null;
      if (onEnd) onEnd();
    }
  }
  function pump() { tl.frames.pump(now()); music?.progress?.(clamp01(now() / tl.total)); }
  return {
    style: 'trailer',
    calm: tl.calm,
    duration: tl.total,
    photoCount: tl.slides.length,
    plan: tl.plan,
    get level() { return tl.level; },
    get time() { return now(); },
    get playing() { return playing; },
    get audioClock() { return playing && clock.audio; },
    async play(style, cb) {
      onEnd = cb;
      if (offset >= tl.total - 0.05) offset = 0;
      const want = style && style !== 'none' ? style : null;
      const gen = ++playGen;
      if (music && musicStyle !== want) { music.stop(); music = null; musicStyle = null; }
      tl.credit = musicCredit(want);
      if (!music && want) {
        const m = await musicForTrailer(want, tl).catch(() => null);
        if (gen !== playGen) { try { m?.stop(); } catch { /* noop */ } return; }
        music = m; musicStyle = want;
        music?.progress?.(clamp01(offset / tl.total));
        music?.seek?.(offset);
        await music?.start().catch(() => {});
        if (gen !== playGen) { try { music?.stop(); } catch { /* noop */ } music = null; musicStyle = null; return; }
      } else if (music) {
        await music.resume?.().catch(() => {});
        if (gen !== playGen) { music?.pause?.(); return; }
      }
      playing = true;
      clock.begin(offset, musicStyle === TRAILER_MUSIC ? music : null);
      stopClocks();
      iv = setInterval(tick, 1000 / 30);
      pf = setInterval(pump, 250);
    },
    pause() {
      playGen++;
      if (!playing) return;
      offset = now(); playing = false;
      stopClocks();
      music?.pause?.();
    },
    stop() { playGen++; playing = false; offset = 0; stopClocks(); music?.stop(); music = null; musicStyle = null; },
    seek(t) {
      offset = Math.max(0, Math.min(tl.total, t));
      music?.seek?.(offset);
      if (playing) clock.begin(offset, musicStyle === TRAILER_MUSIC ? music : null);
      tl.frames.pump(offset);
      draw(offset, false);
      const i = photoIdxAt(tl, offset);
      tl.frames.ensure(i).then(() => { if (!playing) draw(offset, false); });
      music?.progress?.(clamp01(offset / tl.total));
    },
    // 測試與截圖用：等第 t 秒那一張解碼好再畫（不播放、不計時）
    async drawAt(t) {
      offset = Math.max(0, Math.min(tl.total, t));
      tl.frames.pump(offset);
      await tl.frames.ensure(photoIdxAt(tl, offset));
      draw(offset, false);
    },
    destroy() { this.stop(); tl.frames.clear(); },
  };
}

// ---------- 錄影 ----------
// opts: { calm, music, musicFile, level, onProgress, onDegrade }
export async function recordTrailer(tripId, opts = {}) {
  const tl = await buildTrailer(tripId, opts);
  if (!tl) throw new Error(MSG_FEW);
  tl.frames.pump(0);
  await tl.frames.ensure(tl.plan.shots.find((s) => s.idx != null)?.idx);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fps = 25;
  const stream = canvas.captureStream(fps);

  let music = null;
  try {
    if (opts.musicFile) music = await musicFromFile(opts.musicFile);
    else music = await musicForTrailer(opts.music, tl);
  } catch { music = null; }
  if (music?.stream) for (const tr of music.stream.getAudioTracks()) stream.addTrack(tr);

  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_600_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    rec.onerror = (e) => reject(e.error || new Error('錄製失敗'));
  });

  const meter = new DegradeMeter({ level: tl.level });
  const clock = makeClock(tl.total);
  rec.start(1000);
  await music?.start().catch(() => {});
  clock.begin(0, !opts.musicFile && opts.music === TRAILER_MUSIC ? music : null);
  for (;;) {
    const gt = clock.now();
    const i = photoIdxAt(tl, gt);
    if (i != null && !tl.frames.has(i)) await tl.frames.ensure(i);
    tl.frames.pump(gt);
    const t0 = performance.now();
    try { drawTrailerAt(ctx, tl, gt); } catch (e) { console.error('draw', e); }
    const ch = meter.record(performance.now() - t0, performance.now());
    if (ch) { tl.level = ch.level; try { opts.onDegrade?.(ch); } catch { /* noop */ } }
    if (opts.onProgress) opts.onProgress(clamp01(gt / tl.total));
    if (gt >= tl.total) break;
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  await music?.fadeOutStop(1.0);
  await new Promise((r) => setTimeout(r, 400));
  rec.stop();
  const blob = await done;
  tl.frames.clear();
  return { blob, ext: blob.type.includes('mp4') ? 'mp4' : 'webm', level: tl.level, calm: tl.calm };
}
