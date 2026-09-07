// 回憶影片 —— 做得像一支能拿給家人看的短片
//   片頭 → 每天的日期字卡 → 照片（Ken Burns + 多種轉場 + 地點/人物/日期字幕）→ 路線地圖 → 片尾
//   配樂：程序生成（依段落換編制）或使用者自選的音樂檔，混進錄影的音軌
//   交付：① 相簿（App 內看 / 分享網址 / 單檔 HTML）② 影片檔（偵測到 MediaRecorder 才提供）
//   不用 ffmpeg.wasm（25MB+、GitHub Pages 無法送 COOP/COEP、手機記憶體不足）
//
// 三個實測後才知道的重點，改動時請不要弄回去：
//
// 1) **照片交界不可以重新淡入**。舊版每張照片在自己的段落開頭都跑一次 fade-in，
//    但上一段的最後 0.8 秒已經把它疊上來、疊到全不透明了 —— 於是每 3.4 秒畫面
//    就會「掉到全黑再亮回來」閃一下。實測 canvas 中央像素亮度：t=8.8 是 122，
//    t=8.9 掉到 43。現在改成「進場動畫由前一段負責，自己只在前面不是照片時才淡入」。
//
// 2) **不要把所有照片一次解碼進記憶體**。一張 1600×1067 解碼後是 6.5MB RGBA，
//    60 張就 390MB，170 張（10 分鐘的片長）超過 1GB —— 手機瀏覽器在錄到後段時
//    被記憶體壓垮，錄出來的檔案結尾（地圖、片尾）就被截掉。使用者回報的
//    「最後的路線回顧只出現不到一秒」最可能是這個。現在只留一個滑動視窗。
//
// 3) **9:16 的畫面不可以無腦 cover 裁切**。4:3 的橫幅照片 cover 進 9:16 只剩 42%
//    的畫面，人臉幾乎一定被切掉。長寬比差太多時改成完整放進畫面、背景用同一張
//    照片糊化填滿（不需要任何額外套件）。

import * as store from './store.js';
import * as db from './db.js';
import { blobURL } from './photos.js';
import { createMusic, musicFromFile } from './music.js';
import { aiPayload } from './aicontent.js';

const W = 1080, H = 1920;
const FRAME_AR = W / H;

const T_INTRO = 3.6;
const T_DAY = 2.4;
const T_OUTRO = 4.6;
const T_TRANS = 0.85;          // 轉場長度
const T_IN = 0.6;              // 從字卡進到第一張照片的淡入

const BG = '#0f1523';
const FONT = '"Noto Sans TC", system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';

// 長度選項。預設精華版——理由寫在 views/album.js 的說明文案裡。
export const LENGTHS = {
  short: { key: 'short', label: '精華版', targetSec: 165, photoDur: 2.9 },
  full: { key: 'full', label: '完整版', targetSec: null, photoDur: 3.3 },
};
export const DEFAULT_LENGTH = 'short';

// 地圖段隨景點數變長，但有上下限。舊版固定 5.5 秒，在一支 10 分鐘的片子裡
// 只佔 0.9%，等於看完一路辛苦的照片後路線一閃就沒了。
export function mapDur(n) { return Math.max(6.5, Math.min(13, 5 + n * 0.55)); }

// ---------- 收集 & 分組 ----------
export function collectSlides(tripId) {
  const subs = store.submissionsOfTrip(tripId);
  const seen = new Set();
  const out = [];
  for (const s of subs) {
    const key = s.photoHash || s.thumbHash;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const quest = store.getRaw(s.questId);
    const spot = quest ? store.getRaw(quest.spotId) : null;
    const tag = store.photoTag(s);
    const member = tag.photographerId ? store.getRaw(tag.photographerId) : null;
    out.push({
      subId: s.id,
      hash: s.photoHash, thumbHash: s.thumbHash || null,
      caption: tag.caption || '',
      questTitle: quest?.title || '', questSource: quest?.source || '',
      spotName: spot?.name || '',
      day: spot?.day || 1, spotOrder: spot?.order ?? 0, spotId: spot?.id || 'x',
      memberName: member?.displayName || '',
      memberId: tag.photographerId || s.memberId || null,
      likes: store.reactionsOf(s.id).length,
      takenAt: s.takenAt || s.createdAt,
    });
  }
  // 依「天 → 景點順序 → 拍攝時間」排，影片才會一天講完再換下一天
  out.sort((a, b) => a.day - b.day || a.spotOrder - b.spotOrder || a.takenAt - b.takenAt);
  return out;
}

// 精華版：挑得出「這趟最值得看的幾張」，而且每個景點、每個人都要出現到。
// 分數只是排序用的，真正的保障是「每個景點至少一張、每個人至少一張」。
export function pickHighlights(slides, limit) {
  if (!limit || slides.length <= limit) return slides;
  const score = (s) => s.likes * 3
    + (String(s.caption).trim() ? 2 : 0)
    + (s.questSource === 'must' ? 2 : 0)
    + (s.thumbHash ? 0.2 : 0);
  const keep = new Set();
  const bestOf = (keyFn) => {
    const groups = new Map();
    for (const s of slides) {
      const k = keyFn(s);
      if (k == null) continue;
      const cur = groups.get(k);
      if (!cur || score(s) > score(cur)) groups.set(k, s);
    }
    for (const s of groups.values()) keep.add(s.subId);
  };
  bestOf((s) => s.spotId);        // 每個景點的代表照
  bestOf((s) => s.memberId);      // 每個人至少入鏡一次
  const rest = slides.filter((s) => !keep.has(s.subId)).sort((a, b) => score(b) - score(a));
  for (const s of rest) {
    if (keep.size >= limit) break;
    keep.add(s.subId);
  }
  const out = slides.filter((s) => keep.has(s.subId));
  // 保障用的那幾張可能已經超過上限；超過就照分數砍到剛好，但順序仍回到時間軸
  if (out.length > limit) {
    const cut = new Set(out.slice().sort((a, b) => score(b) - score(a)).slice(0, limit).map((s) => s.subId));
    return out.filter((s) => cut.has(s.subId));
  }
  return out;
}

function tripStats(tripId) {
  const spots = store.spotsOf(tripId);
  const subs = store.submissionsOfTrip(tripId);
  const members = store.membersOf(store.get(tripId).groupId);
  const photos = new Set(subs.map((s) => s.photoHash || s.thumbHash)).size;
  return { spots: spots.length, photos, members: members.length,
    reactions: subs.reduce((n, s) => n + store.reactionsOf(s.id).length, 0) };
}

// ---------- 影像：滑動視窗，不一次全部解碼 ----------
const AHEAD = 4;      // 預先載入幾張
const BEHIND = 1;     // 播過幾張之後釋放

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('圖片載入失敗'));
    im.src = url;
  });
}

class FrameStore {
  constructor(slides) {
    this.slides = slides;
    this.imgs = new Map();       // index → HTMLImageElement
    this.jobs = new Map();       // index → Promise
    this.failed = new Set();
  }
  get length() { return this.slides.length; }
  has(i) { return this.imgs.has(i); }
  get(i) { return this.imgs.get(i) || null; }

  // 全圖優先，沒有就退縮圖（縮圖是同步一定會到的那一層）。
  // 單張失敗不可以讓整支片子做不出來。
  load(i) {
    if (this.imgs.has(i) || this.failed.has(i)) return Promise.resolve();
    if (this.jobs.has(i)) return this.jobs.get(i);
    const sl = this.slides[i];
    const job = (async () => {
      for (const hash of [sl.hash, sl.thumbHash]) {
        if (!hash) continue;
        try {
          const url = await blobURL(hash);
          if (!url) continue;
          const img = await loadImage(url);
          this.imgs.set(i, img);
          return;
        } catch { /* 換下一個來源 */ }
      }
      this.failed.add(i);
    })();
    this.jobs.set(i, job);
    job.finally(() => this.jobs.delete(i));
    return job;
  }
  prefetch(i) { for (let k = Math.max(0, i); k < Math.min(this.length, i + AHEAD); k++) this.load(k); }
  release(i) {
    for (const k of [...this.imgs.keys()]) {
      if (k < i - BEHIND || k > i + AHEAD + 2) this.imgs.delete(k);
    }
  }
  async ensure(i) { if (i >= 0 && i < this.length && !this.imgs.has(i) && !this.failed.has(i)) await this.load(i); }
  clear() { this.imgs.clear(); }
}

// ---------- 時間軸 ----------
// 轉場：大多數用溶接（看久了最舒服），每四張給一個「重音」換別的，
// 換天也一定換一次。不是為了炫技，是為了讓十分鐘不要看起來都一樣。
const ACCENTS = ['slideLeft', 'zoomThrough', 'slideUp', 'wipeDown'];
export function transitionFor(globalIdx, dayIdx) {
  if (globalIdx % 4 === 3) return ACCENTS[(Math.floor(globalIdx / 4) + dayIdx) % ACCENTS.length];
  return 'dissolve';
}

export async function buildTimeline(tripId, opts = {}) {
  const trip = store.get(tripId);
  const preset = LENGTHS[opts.length] || LENGTHS[DEFAULT_LENGTH];
  const all = collectSlides(tripId);

  const spots = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null);
  const stats = tripStats(tripId);
  const dayCount = new Set(all.map((s) => s.day)).size || 1;
  const tMap = spots.length >= 2 ? mapDur(spots.length) : 0;

  let slides = all;
  if (preset.targetSec) {
    const overhead = T_INTRO + dayCount * T_DAY + tMap + T_OUTRO;
    const budget = Math.max(preset.photoDur * 6, preset.targetSec - overhead);
    slides = pickHighlights(all, Math.max(6, Math.floor(budget / preset.photoDur)));
  }

  // AI 文案（有開 AI 且已快取才有；沒有就整段用不到，字卡照舊）
  const aiTx = aiPayload(tripId, 'tripText') || {};
  const aiCaps = aiPayload(tripId, 'photoCaptions') || {};
  const usesAi = !!(aiTx.videoIntro || aiTx.videoOutro || (aiTx.narration && Object.keys(aiTx.narration).length) || Object.keys(aiCaps).length);
  for (const f of slides) if (!String(f.caption || '').trim() && aiCaps[f.hash]) f.aiCaption = aiCaps[f.hash];

  const frames = new FrameStore(slides);
  slides.forEach((s, i) => { s.index = i; s._panX = i % 2 ? 1 : -1; s._panY = i % 3 ? -1 : 1; s._fit = null; });

  const segs = [];
  segs.push({ kind: 'intro', dur: T_INTRO, trip, stats, line: aiTx.videoIntro || '' });

  const byDay = new Map();
  for (const f of slides) {
    if (!byDay.has(f.day)) byDay.set(f.day, []);
    byDay.get(f.day).push(f);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  let g = 0;
  days.forEach((day, dayIdx) => {
    const dayFrames = byDay.get(day);
    const region = store.spotsOf(tripId).find((s) => s.day === day)?.region || trip.region || '';
    const nar = (aiTx.narration && aiTx.narration[day]) || (aiTx.dayLines && aiTx.dayLines[day]) || '';
    segs.push({ kind: 'day', dur: T_DAY, day, region, count: dayFrames.length, narration: nar });
    dayFrames.forEach((fr, idx) => {
      const next = dayFrames[idx + 1] || null;
      segs.push({
        kind: 'photo', dur: preset.photoDur, frame: fr, next,
        // 第一張要從字卡淡入；其餘由上一段的轉場帶進來，自己不可以再淡一次
        fadeIn: idx === 0,
        trans: next ? transitionFor(g, dayIdx) : null,
      });
      g++;
    });
  });
  if (tMap) segs.push({ kind: 'map', dur: tMap, spots, trip, totalSpots: store.spotsOf(tripId).length });
  segs.push({ kind: 'outro', dur: T_OUTRO, trip, stats, line: aiTx.videoOutro || '', ai: usesAi });

  let acc = 0;
  for (const s of segs) { s.start = acc; acc += s.dur; }

  return {
    segs, total: acc, frames, slides,
    photoCount: slides.length, totalPhotos: all.length,
    trimmed: all.length - slides.length,
    preset,
  };
}

export function estimateDuration(tripId, lengthKey) {
  const preset = LENGTHS[lengthKey] || LENGTHS[DEFAULT_LENGTH];
  const all = collectSlides(tripId);
  const days = new Set(all.map((s) => s.day)).size || 1;
  const spots = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null).length;
  const tMap = spots >= 2 ? mapDur(spots) : 0;
  const overhead = T_INTRO + days * T_DAY + tMap + T_OUTRO;
  const n = preset.targetSec
    ? Math.min(all.length, Math.max(6, Math.floor(Math.max(preset.photoDur * 6, preset.targetSec - overhead) / preset.photoDur)))
    : all.length;
  return { seconds: overhead + n * preset.photoDur, photos: n, total: all.length };
}

// ---------- 文字排版 ----------
// 字卡與字幕在舊版是「量太寬就從尾巴砍字加…」，長一點的景點名／AI 旁白直接被切掉。
// 現在改成：先自動縮字級，縮到下限才換行，行數也放不下才截。
function tokenize(text) {
  const out = [];
  let buf = '';
  for (const ch of String(text)) {
    if (/[A-Za-z0-9'’.\-@#]/.test(ch)) { buf += ch; continue; }
    if (buf) { out.push(buf); buf = ''; }
    out.push(ch);
  }
  if (buf) out.push(buf);
  return out;
}

function wrapLines(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const tk of tokenize(text)) {
    if (tk === '\n') { lines.push(line); line = ''; continue; }
    const cand = line + tk;
    if (line && ctx.measureText(cand).width > maxW) { lines.push(line); line = tk.trim() ? tk : ''; }
    else line = cand;
  }
  if (line.trim() || !lines.length) lines.push(line);
  return lines;
}

export function fitText(ctx, text, { maxW, maxLines = 2, size, min = 26, weight = 400, family = FONT }) {
  const str = String(text || '');
  let s = size;
  while (s >= min) {
    ctx.font = `${weight} ${s}px ${family}`;
    const lines = wrapLines(ctx, str, maxW);
    if (lines.length <= maxLines) return { lines, size: s, lh: Math.round(s * 1.22), family };
    s -= Math.max(2, Math.round(s * 0.07));
  }
  ctx.font = `${weight} ${min}px ${family}`;
  const lines = wrapLines(ctx, str, maxW);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
  }
  return { lines: kept, size: min, lh: Math.round(min * 1.22), family };
}

// 回傳整塊文字的高度，讓呼叫端可以往下接著排
function drawBlock(ctx, fit, x, y, { align = 'center', color = '#fff', weight = 400 } = {}) {
  ctx.font = `${weight} ${fit.size}px ${fit.family || FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  fit.lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * fit.lh));
  return fit.lines.length * fit.lh;
}

function centerText(ctx, text, x, y, opts) {
  const fit = fitText(ctx, text, opts);
  return drawBlock(ctx, fit, x, y, { align: 'center', color: opts.color || '#fff', weight: opts.weight || 400 });
}

// ---------- 繪製 ----------
function bgFill(ctx, shade = 0) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade ? '#141d33' : BG);
  g.addColorStop(1, '#0b1120');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }

// 糊化背景：把照片畫進一張很小的畫布再放大回來。
// 不用 ctx.filter='blur()' —— 各家瀏覽器支援度與效能差很多，這招到處都一樣。
let _blurCv = null;
function blurCanvas() {
  if (!_blurCv) { _blurCv = document.createElement('canvas'); _blurCv.width = 48; _blurCv.height = 85; }
  return _blurCv;
}

export function fitMode(iw, ih) {
  if (!iw || !ih) return 'cover';
  const r = (iw / ih) / FRAME_AR;
  // 長寬比跟畫面差太多就不裁，改成整張放進來、背景糊化填滿。
  // 4:3 橫幅照片 cover 進 9:16 只剩 42% 畫面，人臉幾乎一定被切掉。
  return (r > 1.35 || r < 0.72) ? 'contain' : 'cover';
}

function drawBlurBack(ctx, img) {
  const c = blurCanvas();
  const bc = c.getContext('2d');
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(c.width / iw, c.height / ih);
  bc.clearRect(0, 0, c.width, c.height);
  bc.drawImage(img, (c.width - iw * s) / 2, (c.height - ih * s) / 2, iw * s, ih * s);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, -40, -40, W + 80, H + 80);
  ctx.fillStyle = 'rgba(10,15,28,0.46)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// tf: 轉場給的額外位移／縮放
function drawFrame(ctx, frame, img, p, alpha, tf = null) {
  if (alpha <= 0) return;
  if (!img) { // 這張載入失敗 —— 用底色撐過去，不要黑掉也不要中斷
    ctx.save(); ctx.globalAlpha = alpha; bgFill(ctx, 1); ctx.restore();
    return;
  }
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!frame._fit) frame._fit = fitMode(iw, ih);
  const mode = frame._fit;
  const dxT = tf?.dx || 0, dyT = tf?.dy || 0, sT = tf?.scale || 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (mode === 'contain') {
    drawBlurBack(ctx, img);
    // 放進畫面的那一張只做很輕的推近，不會再裁到人
    const kb = (1 + 0.035 * easeInOut(p)) * sT;
    const scale = Math.min(W / iw, H / ih) * kb;
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, (W - dw) / 2 + dxT, (H - dh) / 2 + dyT, dw, dh);
  } else {
    // Ken Burns 幅度砍小：舊版 1.05→1.17，光是起始的 1.05 就先多裁 5%
    const kb = (1 + 0.055 * easeInOut(p)) * sT;
    const scale = Math.max(W / iw, H / ih) * kb;
    const dw = iw * scale, dh = ih * scale;
    // 直向裁切時把可見範圍往上壓 —— 人臉通常在上半部，切下面比切頭好
    const overflowY = dh - H;
    const bias = overflowY > 2 ? -overflowY * 0.18 : 0;
    const panX = frame._panX * 22 * easeInOut(p);
    const panY = frame._panY * 16 * easeInOut(p);
    ctx.drawImage(img, (W - dw) / 2 + panX + dxT, (H - dh) / 2 + bias + panY + dyT, dw, dh);
  }
  ctx.restore();
}

function drawCaptionBar(ctx, frame, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, H * 0.56, 0, H);
  g.addColorStop(0, 'rgba(11,17,32,0)');
  g.addColorStop(0.5, 'rgba(11,17,32,0.7)');
  g.addColorStop(1, 'rgba(11,17,32,0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.56, W, H * 0.44);

  const title = frame.caption || frame.aiCaption || frame.questTitle || frame.spotName || '';
  const d = new Date(frame.takenAt);
  const sub = [frame.spotName && frame.spotName !== title ? frame.spotName : '',
    frame.memberName ? '· ' + frame.memberName : '',
    isNaN(d) ? '' : `· ${d.getMonth() + 1}/${d.getDate()}`].filter(Boolean).join(' ');

  const PAD = 70, maxW = W - PAD * 2;
  const tf = fitText(ctx, title, { maxW, maxLines: 3, size: 58, min: 34, weight: 700 });
  const sf = sub ? fitText(ctx, sub, { maxW, maxLines: 1, size: 38, min: 26, weight: 400 }) : null;
  // 從底部往上排：行數變多也是往上長，不會被畫面下緣切掉
  const bottom = H - 100;
  const titleBase = bottom - (sf ? sf.lh + 22 : 0) - (tf.lines.length - 1) * tf.lh;
  drawBlock(ctx, tf, PAD, titleBase, { align: 'left', color: '#fff', weight: 700 });
  if (sf) drawBlock(ctx, sf, PAD, bottom, { align: 'left', color: 'rgba(255,255,255,0.82)', weight: 400 });
  ctx.restore();
}

function drawIntro(ctx, seg, t) {
  bgFill(ctx, 1);
  const p = clamp01(t / 0.8);
  const trip = seg.trip;
  ctx.save();
  ctx.globalAlpha = p;
  ctx.fillStyle = 'rgba(79,141,255,0.14)';
  ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, 520 + 60 * easeOut(p), 0, 7); ctx.fill();
  centerText(ctx, '📸', W / 2, H * 0.37, { maxW: W, maxLines: 1, size: 120, min: 120, family: 'sans-serif' });
  let y = H * 0.48;
  y += centerText(ctx, trip.title || '我們的旅程', W / 2, y, { maxW: W - 140, maxLines: 2, size: 88, min: 46, weight: 800 });
  const range = [trip.startDate, trip.endDate].filter(Boolean).join('  –  ');
  if (range) y += centerText(ctx, range, W / 2, y + 30, { maxW: W - 140, maxLines: 1, size: 42, min: 28, color: 'rgba(255,255,255,0.75)' }) + 30;
  const sm = `${seg.stats.members} 個人 · ${seg.stats.spots} 個景點 · ${seg.stats.photos} 張照片`;
  y += centerText(ctx, sm, W / 2, y + 24, { maxW: W - 140, maxLines: 2, size: 38, min: 26, weight: 500, color: 'rgba(255,255,255,0.6)' }) + 24;
  if (seg.line) centerText(ctx, seg.line, W / 2, y + 46, { maxW: W * 0.84, maxLines: 3, size: 40, min: 26, color: 'rgba(255,255,255,0.85)' });
  ctx.restore();
}

function drawDay(ctx, seg, t) {
  bgFill(ctx, 0);
  const p = clamp01(t / 0.5) * clamp01((seg.dur - t) / 0.4);
  ctx.save();
  ctx.globalAlpha = p;
  ctx.strokeStyle = 'rgba(79,141,255,0.9)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(W / 2 - 60, H * 0.39); ctx.lineTo(W / 2 + 60, H * 0.39); ctx.stroke();
  let y = H * 0.48;
  y += centerText(ctx, `第 ${seg.day} 天`, W / 2, y, { maxW: W - 160, maxLines: 1, size: 96, min: 58, weight: 800 });
  if (seg.region) y += centerText(ctx, seg.region, W / 2, y + 26, { maxW: W - 160, maxLines: 1, size: 46, min: 30, color: 'rgba(255,255,255,0.7)' }) + 26;
  if (seg.narration) centerText(ctx, seg.narration, W / 2, y + 48, { maxW: W * 0.82, maxLines: 4, size: 40, min: 26, color: 'rgba(255,255,255,0.85)' });
  ctx.restore();
}

// ---------- 轉場 ----------
// 每一種都在 k=1 時回到「原位、全不透明」，下一段才能無縫接手（見檔頭第 1 點）。
export function transformFor(kind, k) {
  const e = easeInOut(k);
  switch (kind) {
    case 'slideLeft': return { alpha: 1, dx: (1 - e) * W, dy: 0, scale: 1, cur: { dx: -e * W * 0.34 } };
    case 'slideUp': return { alpha: 1, dx: 0, dy: (1 - e) * H, scale: 1, cur: { dy: -e * H * 0.28 } };
    case 'zoomThrough': return { alpha: e, dx: 0, dy: 0, scale: 1 + (1 - e) * 0.28, cur: { scale: 1 + e * 0.12 } };
    case 'wipeDown': return { alpha: 1, dx: 0, dy: 0, scale: 1, wipe: e };
    default: return { alpha: e, dx: 0, dy: 0, scale: 1 };
  }
}

function drawPhotoSeg(ctx, seg, t, frames) {
  bgFill(ctx, 0);
  const p = clamp01(t / seg.dur);
  const img = frames.get(seg.frame.index);

  const transDur = seg.trans ? T_TRANS : 0;
  const inTrans = !!seg.trans && t > seg.dur - transDur;
  const k = inTrans ? clamp01((t - (seg.dur - transDur)) / transDur) : 0;
  const tf = inTrans ? transformFor(seg.trans, k) : null;

  // 自己：只有「前面不是照片」時才淡入
  const selfAlpha = seg.fadeIn ? clamp01(t / T_IN) : 1;
  drawFrame(ctx, seg.frame, img, p, selfAlpha, tf?.cur || null);

  // 字幕在轉場開始前收掉，才不會壓在下一張照片上
  const capAlpha = clamp01((t - 0.3) / 0.4) * clamp01((seg.dur - transDur * 0.55 - t) / 0.45) * selfAlpha;
  drawCaptionBar(ctx, seg.frame, capAlpha);

  if (inTrans && seg.next) {
    const nImg = frames.get(seg.next.index);
    if (tf.wipe != null) {
      ctx.save();
      const cut = tf.wipe * H;
      ctx.beginPath(); ctx.rect(0, 0, W, cut); ctx.clip();
      drawFrame(ctx, seg.next, nImg, 0, 1, null);
      ctx.restore();
      if (cut > 2 && cut < H - 2) {
        ctx.save();
        ctx.globalAlpha = 0.8; ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(0, cut - 3, W, 3);
        ctx.restore();
      }
    } else {
      drawFrame(ctx, seg.next, nImg, 0, tf.alpha, tf);
    }
  }
}

// ---------- 路線地圖 ----------
// 使用者拿實機截圖回報的三個問題，這一版逐一處理：
// 1) 兩個標籤完全重疊糊成一團 → 標籤有碰撞處理：候選位置輪著試、被擠開就畫引線
// 2) 一個遠的點（粉鳥林）把其他點壓成一團 → 密集的一群收成「◯◯一帶（n 個地點）」，
//    旁邊開一個放大圈把那一帶攤開來、各自標名字
// 3) 沒有任何地理參考 → 指北針＋比例尺＋淡格線（不需要外部服務或底圖資料）；
//    另外地圖只畫得出「有座標」的地點（文字匯入的行程很多店家配不到座標），
//    數量落差直接寫在副標，不假裝那就是全部

function rectsHit(a, b, pad = 4) {
  return !(a.x1 + pad < b.x0 || b.x1 + pad < a.x0 || a.y1 + pad < b.y0 || b.y1 + pad < a.y0);
}

// 一組點的標籤擺放：候選位置輪著試，撞到就換，真的沒位置就縮小字再試一輪。
// occupied 會被就地加入新佔的框（點本身的圓也先放進去，標籤才不會壓到點）。
function placeLabels(ctx, items, bounds, occupied) {
  const CAND = [
    { dx: 28, dy: 0, align: 'left' }, { dx: -28, dy: 0, align: 'right' },
    { dx: 28, dy: -38, align: 'left' }, { dx: -28, dy: -38, align: 'right' },
    { dx: 28, dy: 38, align: 'left' }, { dx: -28, dy: 38, align: 'right' },
    { dx: 0, dy: -48, align: 'center' }, { dx: 0, dy: 50, align: 'center' },
    { dx: 34, dy: -76, align: 'left' }, { dx: -34, dy: 76, align: 'right' },
    { dx: 34, dy: 76, align: 'left' }, { dx: -34, dy: -76, align: 'right' },
  ];
  const out = [];
  for (const it of items) {
    let placed = null;
    for (const size of [it.size, Math.round(it.size * 0.8)]) {
      ctx.font = `600 ${size}px ${FONT}`;
      const w = ctx.measureText(it.text).width, hh = size * 1.2;
      for (let ci = 0; ci < CAND.length && !placed; ci++) {
        const c = CAND[ci];
        const ax = it.x + c.dx, ay = it.y + c.dy;
        const x0 = c.align === 'left' ? ax : (c.align === 'right' ? ax - w : ax - w / 2);
        const rect = { x0, y0: ay - hh / 2, x1: x0 + w, y1: ay + hh / 2 };
        if (rect.x0 < bounds.x0 || rect.x1 > bounds.x1 || rect.y0 < bounds.y0 || rect.y1 > bounds.y1) continue;
        if (occupied.some((o) => rectsHit(rect, o))) continue;
        placed = { ...it, size, align: c.align, tx: ax, ty: ay, rect, leader: ci >= 2 };
      }
      if (placed) break;
    }
    if (!placed) {
      // 保底：縮到最小放右邊 —— 寧可貼著別人也不能讓一個地點消失
      const size = Math.round(it.size * 0.72);
      ctx.font = `600 ${size}px ${FONT}`;
      const w = ctx.measureText(it.text).width;
      placed = { ...it, size, align: 'left', tx: it.x + 28, ty: it.y,
        rect: { x0: it.x + 28, y0: it.y - size * 0.6, x1: it.x + 28 + w, y1: it.y + size * 0.6 }, leader: false };
    }
    occupied.push(placed.rect);
    out.push(placed);
  }
  return out;
}

// 版面計算（純函式，測試直接驗「標籤互不重疊、不出界」）。
export function computeMapLayout(ctx, spots, { totalSpots = null } = {}) {
  const box = { x0: 100, y0: 430, x1: W - 100, y1: H - 430 };
  const lats = spots.map((s) => s.lat), lngs = spots.map((s) => s.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2, midLng = (minLng + maxLng) / 2;
  const kx = Math.cos(midLat * Math.PI / 180);           // 經度要乘 cos(緯度)，距離比例才是對的
  const spanX = Math.max((maxLng - minLng) * kx, 0.004) * 1.35;
  const spanY = Math.max(maxLat - minLat, 0.004) * 1.35;
  const scale = Math.min((box.x1 - box.x0) / spanX, (box.y1 - box.y0) / spanY);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const P = (s) => ({ x: cx + (s.lng - midLng) * kx * scale, y: cy - (s.lat - midLat) * scale });

  const pts = spots.map((s, i) => ({ ...P(s), i, name: s.name, emoji: s.emoji || '', region: s.region || '' }));

  // 密集群偵測：一個遠點會把其他點壓成一團 —— 找「最大的一群擠在小圈圈裡的點」
  let cluster = null;
  if (pts.length >= 5) {
    const R = 0.17 * Math.min(box.x1 - box.x0, box.y1 - box.y0);
    let best = null;
    for (const a of pts) {
      const g = pts.filter((b) => Math.hypot(a.x - b.x, a.y - b.y) <= R);
      if (!best || g.length > best.length) best = g;
    }
    if (best && best.length >= 3 && best.length >= Math.ceil(pts.length * 0.5) && pts.length - best.length >= 1) {
      const gx = best.reduce((n, p) => n + p.x, 0) / best.length;
      const gy = best.reduce((n, p) => n + p.y, 0) / best.length;
      const gr = Math.max(46, ...best.map((p) => Math.hypot(p.x - gx, p.y - gy) + 24));
      // 這一帶叫什麼：多數地名的共同開頭（羅東運動公園＋羅東夜市 → 「羅東一帶」）
      // 比 region 準 —— region 是縣市級（宜蘭），寫「宜蘭一帶」等於沒說
      const pre = {};
      for (const p of best) { const k = String(p.name).slice(0, 2); if (k.length === 2) pre[k] = (pre[k] || 0) + 1; }
      const topPre = Object.entries(pre).sort((a, b) => b[1] - a[1])[0];
      const regions = {};
      for (const p of best) if (p.region) regions[p.region] = (regions[p.region] || 0) + 1;
      const area = (topPre && topPre[1] >= Math.ceil(best.length / 2))
        ? topPre[0]
        : (Object.entries(regions).sort((a, b) => b[1] - a[1])[0]?.[0] || '');
      const inSet = new Set(best.map((p) => p.i));

      // 放大圈放在離所有點最遠的角落。半徑不能貪大 —— 實測 310px 的圈會把
      // 遠的那個點整顆吃進圈子裡蓋掉；蓋到點的角落直接重罰
      const ir = Math.min(255, (box.y1 - box.y0) * 0.24);
      const corners = [
        { x: box.x0 + ir + 6, y: box.y0 + ir + 6 }, { x: box.x1 - ir - 6, y: box.y0 + ir + 6 },
        { x: box.x0 + ir + 6, y: box.y1 - ir - 6 }, { x: box.x1 - ir - 6, y: box.y1 - ir - 6 },
      ];
      const corner = corners.map((c) => {
        const d = Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)), Math.hypot(gx - c.x, gy - c.y) - gr);
        return { ...c, d: d < ir + 28 ? d - 5000 : d };   // 會蓋到點 → 打入冷宮
      }).sort((a, b) => b.d - a.d)[0];

      // 群內的點重新投影進放大圈
      const bl = { minLat: Math.min(...best.map((p) => spots[p.i].lat)), maxLat: Math.max(...best.map((p) => spots[p.i].lat)),
        minLng: Math.min(...best.map((p) => spots[p.i].lng)), maxLng: Math.max(...best.map((p) => spots[p.i].lng)) };
      const bmLat = (bl.minLat + bl.maxLat) / 2, bmLng = (bl.minLng + bl.maxLng) / 2;
      const bSpanX = Math.max((bl.maxLng - bl.minLng) * kx, 0.002), bSpanY = Math.max(bl.maxLat - bl.minLat, 0.002);
      const bScale = Math.min(1, 1) * (ir * 1.02) / Math.max(bSpanX, bSpanY);
      const insetPts = best.map((p) => ({
        i: p.i, name: p.name, emoji: p.emoji,
        x: corner.x + (spots[p.i].lng - bmLng) * kx * bScale,
        y: corner.y - (spots[p.i].lat - bmLat) * bScale,
      })).sort((a, b) => a.i - b.i);
      const iBounds = { x0: corner.x - ir + 14, y0: corner.y - ir + 14, x1: corner.x + ir - 14, y1: corner.y + ir - 14 };
      const iOcc = insetPts.map((p) => ({ x0: p.x - 14, y0: p.y - 14, x1: p.x + 14, y1: p.y + 14 }));
      const insetLabels = placeLabels(ctx, insetPts.map((p) => ({ x: p.x, y: p.y, text: `${p.emoji}${p.name}`, size: 26 })), iBounds, iOcc);

      cluster = { x: gx, y: gy, r: gr, count: best.length, inSet,
        label: `${area ? area + '一帶' : '這一帶'}（${best.length} 個地點）`,
        inset: { cx: corner.x, cy: corner.y, r: ir, pts: insetPts, labels: insetLabels } };
    }
  }

  // 主圖標籤：沒被收進群的點 + 群本身的標籤
  const occupied = pts.filter((p) => !cluster?.inSet.has(p.i)).map((p) => ({ x0: p.x - 18, y0: p.y - 18, x1: p.x + 18, y1: p.y + 18 }));
  if (cluster) {
    occupied.push({ x0: cluster.x - cluster.r, y0: cluster.y - cluster.r, x1: cluster.x + cluster.r, y1: cluster.y + cluster.r });
    occupied.push({ x0: cluster.inset.cx - cluster.inset.r, y0: cluster.inset.cy - cluster.inset.r,
      x1: cluster.inset.cx + cluster.inset.r, y1: cluster.inset.cy + cluster.inset.r });
  }
  const bounds = { x0: 30, y0: box.y0 - 60, x1: W - 30, y1: box.y1 + 70 };
  const items = pts.filter((p) => !cluster?.inSet.has(p.i)).map((p) => ({ x: p.x, y: p.y, text: `${p.emoji}${p.name}`, size: 30 }));
  if (cluster) items.push({ x: cluster.x, y: cluster.y - cluster.r - 6, text: cluster.label, size: 32 });
  const labels = placeLabels(ctx, items, bounds, occupied);

  // 比例尺：1 度緯度 ≈ 111.3 公里 → 挑一段畫起來 120–320px 的整數公里
  const kmPerPx = 111.32 / scale;
  let nice = 1;
  for (const k of [0.5, 1, 2, 5, 10, 20, 50, 100, 200]) { if (k / kmPerPx >= 120 && k / kmPerPx <= 340) { nice = k; break; } nice = k; }
  const scaleBar = { x: box.x0, y: box.y1 + 96, w: Math.min(420, nice / kmPerPx), label: `${nice} 公里` };

  const subtitle = totalSpots && totalSpots > spots.length
    ? `這趟 ${totalSpots} 個地點，其中 ${spots.length} 個有地圖位置`
    : `${spots.length} 個地點`;

  return { box, pts, cluster, labels, scaleBar, subtitle, north: { x: box.x1 - 26, y: box.y0 - 44 } };
}

function drawLabel(ctx, L, dotX, dotY) {
  if (L.leader) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    const ex = L.align === 'left' ? L.rect.x0 - 4 : (L.align === 'right' ? L.rect.x1 + 4 : L.tx);
    ctx.beginPath(); ctx.moveTo(dotX, dotY); ctx.lineTo(ex, L.ty); ctx.stroke();
  }
  ctx.font = `600 ${L.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = L.align;
  ctx.textBaseline = 'middle';
  ctx.fillText(L.text, L.tx, L.ty);
  ctx.textBaseline = 'alphabetic';
}

function drawMap(ctx, seg, t) {
  bgFill(ctx, 1);
  const fade = clamp01(t / 0.5) * clamp01((seg.dur - t) / 0.45);
  if (!seg._layout) seg._layout = computeMapLayout(ctx, seg.spots, { totalSpots: seg.totalSpots });
  const L = seg._layout;
  ctx.save();
  ctx.globalAlpha = fade;

  centerText(ctx, '我們走過的地方', W / 2, 210, { maxW: W - 140, maxLines: 2, size: 64, min: 40, weight: 800 });
  centerText(ctx, L.subtitle, W / 2, 310, { maxW: W - 160, maxLines: 1, size: 34, min: 26, color: 'rgba(255,255,255,0.62)' });

  // 淡格線 + 指北針 + 比例尺（沒有底圖，至少要有地理感）
  ctx.strokeStyle = 'rgba(79,141,255,0.10)'; ctx.lineWidth = 1;
  for (let gx = L.box.x0; gx <= L.box.x1 + 1; gx += 160) { ctx.beginPath(); ctx.moveTo(gx, L.box.y0 - 20); ctx.lineTo(gx, L.box.y1 + 20); ctx.stroke(); }
  for (let gy = L.box.y0; gy <= L.box.y1 + 1; gy += 160) { ctx.beginPath(); ctx.moveTo(L.box.x0 - 20, gy); ctx.lineTo(L.box.x1 + 20, gy); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(L.north.x, L.north.y + 16); ctx.lineTo(L.north.x, L.north.y - 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L.north.x - 8, L.north.y - 4); ctx.lineTo(L.north.x, L.north.y - 16); ctx.lineTo(L.north.x + 8, L.north.y - 4); ctx.stroke();
  ctx.font = `700 26px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.textAlign = 'center';
  ctx.fillText('北', L.north.x, L.north.y + 46);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(L.scaleBar.x, L.scaleBar.y - 8); ctx.lineTo(L.scaleBar.x, L.scaleBar.y);
  ctx.lineTo(L.scaleBar.x + L.scaleBar.w, L.scaleBar.y); ctx.lineTo(L.scaleBar.x + L.scaleBar.w, L.scaleBar.y - 8);
  ctx.stroke();
  ctx.font = `600 26px ${FONT}`; ctx.textAlign = 'left';
  ctx.fillText(L.scaleBar.label, L.scaleBar.x + L.scaleBar.w + 14, L.scaleBar.y + 8);

  // 路線動畫：佔前 62%，後面留住讓人看得完
  const runFor = Math.max(2, seg.dur * 0.62);
  const prog = easeOut(clamp01((t - 0.4) / runFor));
  const total = Math.max(1, L.pts.length - 1);
  ctx.strokeStyle = 'rgba(79,141,255,0.9)';
  ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.setLineDash([2, 18]);
  ctx.beginPath();
  for (let i = 0; i < L.pts.length; i++) {
    const p = L.pts[i];
    if (i === 0) { ctx.moveTo(p.x, p.y); continue; }
    const k = clamp01(prog * total - (i - 1));
    if (k <= 0) break;
    const q = L.pts[i - 1];
    ctx.lineTo(q.x + (p.x - q.x) * k, q.y + (p.y - q.y) * k);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 點：群外的畫大點；群收成一個圈
  const appearOf = (i) => clamp01(prog * total - i + 0.5);
  for (const p of L.pts) {
    const a = appearOf(p.i);
    if (a <= 0) continue;
    ctx.globalAlpha = fade * a;
    ctx.fillStyle = '#4f8dff';
    const inCluster = L.cluster?.inSet.has(p.i);
    ctx.beginPath(); ctx.arc(p.x, p.y, inCluster ? 7 : 15, 0, 7); ctx.fill();
  }
  if (L.cluster) {
    const a = Math.max(...[...L.cluster.inSet].map((i) => appearOf(i)));
    if (a > 0) {
      ctx.globalAlpha = fade * a;
      ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(L.cluster.x, L.cluster.y, L.cluster.r, 0, 7); ctx.stroke();
    }
  }
  // 標籤（含碰撞處理後的位置與引線）
  for (const lb of L.labels) {
    // 用標籤錨點對回它的點，決定出現時機（群標籤跟圈一起出現）
    const src = L.pts.find((p) => Math.abs(p.x - lb.x) < 1 && Math.abs(p.y - lb.y) < 1);
    const a = src ? appearOf(src.i) : (L.cluster ? Math.max(...[...L.cluster.inSet].map((i) => appearOf(i))) : 1);
    if (a <= 0) continue;
    ctx.globalAlpha = fade * a;
    drawLabel(ctx, lb, lb.x, lb.y);
  }

  // 放大圈：路線畫得差不多後淡入，把擠成一團的那一帶攤開
  if (L.cluster) {
    const ia = clamp01((prog - 0.55) / 0.3) * fade;
    if (ia > 0) {
      const ins = L.cluster.inset;
      ctx.globalAlpha = ia;
      ctx.strokeStyle = 'rgba(255,209,102,0.55)'; ctx.lineWidth = 3; ctx.setLineDash([6, 10]);
      const dx = ins.cx - L.cluster.x, dy = ins.cy - L.cluster.y, dd = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(L.cluster.x + dx / dd * L.cluster.r, L.cluster.y + dy / dd * L.cluster.r);
      ctx.lineTo(ins.cx - dx / dd * ins.r, ins.cy - dy / dd * ins.r);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0b1220';
      ctx.beginPath(); ctx.arc(ins.cx, ins.cy, ins.r, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(ins.cx, ins.cy, ins.r, 0, 7); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.arc(ins.cx, ins.cy, ins.r - 3, 0, 7); ctx.clip();
      ctx.strokeStyle = 'rgba(79,141,255,0.55)'; ctx.lineWidth = 4; ctx.setLineDash([2, 12]);
      ctx.beginPath();
      ins.pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of ins.pts) {
        ctx.fillStyle = '#4f8dff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.fill();
      }
      for (const lb of ins.labels) drawLabel(ctx, lb, lb.x, lb.y);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawOutro(ctx, seg, t) {
  bgFill(ctx, 1);
  const p = clamp01(t / 0.7);
  ctx.save(); ctx.globalAlpha = p;
  let y = H * 0.39;
  y += centerText(ctx, seg.line || '謝謝這趟旅程', W / 2, y, { maxW: W - 140, maxLines: 3, size: 84, min: 44, weight: 800 });
  const s = seg.stats;
  y += centerText(ctx, `${s.photos} 個回憶 · ${s.spots} 個景點 · ${s.members} 位旅伴`, W / 2, y + 36,
    { maxW: W - 140, maxLines: 2, size: 42, min: 28, color: 'rgba(255,255,255,0.75)' }) + 36;
  if (s.reactions) y += centerText(ctx, `互相按了 ${s.reactions} 個讚 ❤️`, W / 2, y + 22,
    { maxW: W - 140, maxLines: 1, size: 40, min: 26, color: 'rgba(255,255,255,0.6)' }) + 22;
  centerText(ctx, 'TripQuest', W / 2, y + 74,
    { maxW: W - 140, maxLines: 2, size: 34, min: 24, weight: 700, color: 'rgba(255,255,255,0.4)' });
  ctx.restore();
}

function segAt(timeline, gt) {
  let seg = timeline.segs[0];
  for (const s of timeline.segs) { if (gt >= s.start) seg = s; else break; }
  return seg;
}

function drawAt(ctx, timeline, gt) {
  const seg = segAt(timeline, gt);
  const local = gt - seg.start;
  if (seg.kind === 'photo') drawPhotoSeg(ctx, seg, local, timeline.frames);
  else ({ intro: drawIntro, day: drawDay, map: drawMap, outro: drawOutro }[seg.kind] || drawIntro)(ctx, seg, local);
}

// 目前該預先載入哪幾張（滑動視窗的中心）
function frameIndexAt(timeline, gt) {
  const seg = segAt(timeline, gt);
  if (seg.kind === 'photo') return seg.frame.index;
  // 還沒到照片段就先備好第一張；已經過了就維持最後一張
  for (const s of timeline.segs) if (s.kind === 'photo' && s.start >= gt) return s.frame.index;
  return Math.max(0, timeline.frames.length - 1);
}

// ---------- 預覽播放器 ----------
// 使用者回饋：預覽只能從頭看到尾，要確認後段內容很痛苦 → 進度條可以拖。
// 這裡本來就是「給一個時間點、畫一幀」（drawAt 是純函式），所以跳轉只是把
// 時間游標設到那一秒重繪；唯一要照顧的是那一秒的照片可能還沒解碼（滑動視窗），
// seek 會先畫一次（可能暫時用底色）、解碼好再補畫一次。
export async function createPlayer(canvas, tripId, opts = {}) {
  const timeline = await buildTimeline(tripId, opts);
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  await timeline.frames.ensure(0);
  timeline.frames.prefetch(0);

  let iv = 0, pf = 0, playing = false, onEnd = null, music = null, musicStyle = null;
  let offset = 0;                 // 暫停 / 未播時停在哪一秒
  let wall = 0;                   // 播放中：offset 對應的 performance.now()

  const now = () => (playing ? Math.min(timeline.total, offset + (performance.now() - wall) / 1000) : offset);
  const draw = (t) => { try { drawAt(ctx, timeline, t); } catch (e) { console.error(e); } };
  const stopClocks = () => { clearInterval(iv); clearInterval(pf); };

  function tick() {
    if (!playing) return;
    const t = now();
    draw(t);
    if (t >= timeline.total) {
      offset = timeline.total; playing = false;
      stopClocks();
      music?.fadeOutStop(0.8); music = null; musicStyle = null;
      if (onEnd) onEnd();
    }
  }
  function pump() {
    const i = frameIndexAt(timeline, now());
    timeline.frames.prefetch(i);
    timeline.frames.release(i);
    music?.progress(clamp01(now() / timeline.total));
  }
  return {
    duration: timeline.total,
    photoCount: timeline.photoCount,
    totalPhotos: timeline.totalPhotos,
    trimmed: timeline.trimmed,
    get time() { return now(); },
    get playing() { return playing; },
    async play(style, cb) {
      onEnd = cb;
      if (offset >= timeline.total - 0.05) offset = 0;      // 播完再按 = 重播
      const want = style && style !== 'none' ? style : null;
      if (music && musicStyle !== want) { music.stop(); music = null; musicStyle = null; }
      if (!music && want) {
        music = createMusic(want, { duration: timeline.total });
        musicStyle = want;
        music?.progress(clamp01(offset / timeline.total));
        await music?.start().catch(() => {});
      } else if (music) {
        await music.resume?.().catch(() => {});
      }
      playing = true; wall = performance.now();
      stopClocks();
      iv = setInterval(tick, 1000 / 30);
      pf = setInterval(pump, 300);
    },
    pause() {
      if (!playing) return;
      offset = now(); playing = false;
      stopClocks();
      music?.pause?.();
    },
    stop() { playing = false; offset = 0; stopClocks(); music?.stop(); music = null; musicStyle = null; },
    seek(t) {
      offset = Math.max(0, Math.min(timeline.total, t));
      if (playing) wall = performance.now();
      const i = frameIndexAt(timeline, offset);
      timeline.frames.prefetch(i);
      draw(offset);
      timeline.frames.ensure(i).then(() => { if (!playing) draw(offset); });
      music?.progress(clamp01(offset / timeline.total));
    },
    destroy() { this.stop(); timeline.frames.clear(); },
  };
}

// ---------- 錄影 ----------
export function videoSupported() {
  return typeof MediaRecorder !== 'undefined' && !!pickMime();
}
function pickMime() {
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* noop */ }
  }
  return null;
}

// opts: { length, music, musicFile, onProgress }
export async function recordVideo(tripId, opts = {}) {
  const timeline = await buildTimeline(tripId, opts);
  if (!timeline.photoCount) throw new Error('還沒有照片');
  await timeline.frames.ensure(0);
  timeline.frames.prefetch(0);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fps = 25;
  const stream = canvas.captureStream(fps);

  let music = null;
  try {
    if (opts.musicFile) music = await musicFromFile(opts.musicFile);
    else if (opts.music && opts.music !== 'none') music = createMusic(opts.music, { duration: timeline.total });
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

  rec.start(1000);
  await music?.start().catch(() => {});
  const startT = performance.now();
  // 用 async 迴圈而不是 setInterval：需要的那一張還沒解碼好時可以等它，
  // 影片頂多多停一格，不會出現空白畫面。
  for (;;) {
    const t = (performance.now() - startT) / 1000;
    const gt = Math.min(t, timeline.total);
    const i = frameIndexAt(timeline, gt);
    if (!timeline.frames.has(i)) await timeline.frames.ensure(i);
    timeline.frames.prefetch(i);
    timeline.frames.release(i);
    music?.progress(clamp01(gt / timeline.total));
    try { drawAt(ctx, timeline, gt); } catch (e) { console.error('draw', e); }
    if (opts.onProgress) opts.onProgress(clamp01(t / timeline.total));
    if (t >= timeline.total) break;
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  await music?.fadeOutStop(1.0);
  await new Promise((r) => setTimeout(r, 400));
  rec.stop();
  const blob = await done;
  timeline.frames.clear();
  return { blob, ext: blob.type.includes('mp4') ? 'mp4' : 'webm' };
}

// ---------- 相簿內容（App 內檢視 / 分享網址 / 單檔 HTML 共用同一份） ----------
export function albumSlides(tripId) {
  const slides = collectSlides(tripId);
  const aiCaps = aiPayload(tripId, 'photoCaptions') || {};
  for (const s of slides) if (!String(s.caption || '').trim() && aiCaps[s.hash]) s.caption = aiCaps[s.hash];
  return slides;
}

export function albumMeta(tripId) {
  const trip = store.get(tripId);
  return {
    title: trip.title || '我們的旅程',
    range: [trip.startDate, trip.endDate].filter(Boolean).join(' – '),
    stats: tripStats(tripId),
  };
}

// 單檔 HTML：照片用 base64 內嵌。
//
// **這條路有硬限制**：一張 1600px 的照片內嵌後約 300–500KB，實測 40 張就是 46.6MB。
// 一百多張會做出 60–200MB 的單一 HTML —— 電腦打得開，手機常常打不開
// （整份原始碼要進記憶體、屬性字串又是 UTF-16 再翻一倍）。所以：
//   · 內嵌前先縮到長邊 1280、JPEG 0.78，大小砍到約四成
//   · 超過門檻就明講，並建議改用分享網址
export const ALBUM_INLINE_LIMIT = 24 * 1024 * 1024;

async function shrinkForAlbum(blob, maxEdge = 1280) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    if (scale >= 1 && blob.size < 200 * 1024) return blob;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.78));
    return out && out.size < blob.size ? out : blob;
  } catch { return blob; }
}

function b64(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
}

export async function buildAlbumPage(tripId, opts = {}) {
  const slides = albumSlides(tripId);
  const meta = albumMeta(tripId);
  const imgs = [];
  let bytes = 0, missing = 0, i = 0;
  for (const sl of slides) {
    // 全圖沒有就退縮圖 —— 跟照片牆同一個道理，縮圖才是一定同步到的那一層
    const entry = (sl.hash && await db.getBlob(sl.hash)) || (sl.thumbHash && await db.getBlob(sl.thumbHash));
    i++;
    if (!entry) { missing++; continue; }
    const small = await shrinkForAlbum(entry.blob, opts.maxEdge || 1280);
    const uri = await b64(small);
    bytes += uri.length;
    imgs.push({ ...sl, src: uri });
    if (opts.onProgress) opts.onProgress(i / slides.length);
  }
  const html = albumHTML(meta, imgs, { offline: true });
  return { blob: new Blob([html], { type: 'text/html' }), bytes, missing, count: imgs.length };
}

// 共用的相簿 HTML。src 由呼叫端決定（base64 或網址）。
// 分享網址那條路會被 Worker 用 CSP 擋掉所有腳本，所以這裡不能有 <script>；
// 進場動畫改用 CSS 的 animation-timeline，瀏覽器不支援就直接顯示。
export function albumHTML(meta, slides, { offline = false } = {}) {
  let lastDay = 0;
  const body = slides.map((s) => {
    let head = '';
    if (s.day !== lastDay) { lastDay = s.day; head = `<h2 class="day">第 ${s.day} 天</h2>`; }
    const d = new Date(s.takenAt);
    const sub = [s.spotName, s.memberName, isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}`].filter(Boolean).join(' · ');
    const title = s.caption || s.questTitle || s.spotName || '';
    return `${head}<figure class="slide"><img src="${esc(s.src)}" alt="${esc(title)}" loading="lazy" decoding="async">
<figcaption><strong>${esc(title)}</strong><span>${esc(sub)}</span></figcaption></figure>`;
  }).join('\n');

  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)} — TripQuest</title>
<style>
 *{box-sizing:border-box;margin:0}
 body{background:#0f1523;color:#fff;font-family:${FONT};-webkit-text-size-adjust:100%}
 header{min-height:92svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;gap:14px}
 header h1{font-size:clamp(30px,8vw,52px);line-height:1.25;overflow-wrap:anywhere}
 header p{opacity:.72;font-size:clamp(15px,4vw,20px)}
 main{max-width:900px;margin:0 auto;padding:0 14px 90px}
 h2.day{font-size:clamp(22px,6vw,32px);margin:40px 0 12px;padding-left:14px;border-left:5px solid #4f8dff}
 .slide{position:relative;margin:16px 0;border-radius:20px;overflow:hidden;background:#151d30}
 .slide img{width:100%;display:block;max-height:78svh;object-fit:contain;background:#0b1120}
 figcaption{padding:14px 18px 18px;display:flex;flex-direction:column;gap:4px;background:linear-gradient(180deg,rgba(11,17,32,.4),rgba(11,17,32,.92))}
 figcaption strong{font-size:clamp(17px,4.6vw,20px);line-height:1.4;overflow-wrap:anywhere}
 figcaption span{font-size:clamp(13px,3.6vw,15px);opacity:.78;overflow-wrap:anywhere}
 footer{text-align:center;padding:48px 24px 90px;opacity:.62;line-height:1.9;font-size:15px}
 @supports (animation-timeline: view()) {
   .slide{animation:rise linear both;animation-timeline:view();animation-range:entry 0% entry 62%}
   @keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
 }
</style></head><body>
<header>
 <h1>${esc(meta.title)}</h1>
 ${meta.range ? `<p>${esc(meta.range)}</p>` : ''}
 <p>${meta.stats.members} 個人 · ${meta.stats.spots} 個景點 · ${slides.length} 張照片</p>
 <p style="opacity:.5;font-size:14px">往下滑 ↓</p>
</header>
<main>
${body}
</main>
<footer>謝謝這趟旅程<br>由 TripQuest 產生${offline ? ' · 這個檔案可離線開啟、直接傳給家人' : ''}</footer>
</body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
