// 回憶影片 —— 做得像一支能拿給家人看的短片
//   片頭 → 每天的日期字卡 → 照片（Ken Burns + 淡入淡出 + 地點/人物/日期字幕）→ 路線地圖 → 片尾
//   配樂：程序生成（輕快 / 溫柔）或使用者自選的音樂檔，混進錄影的音軌
//   交付：① 動態相簿頁（單一 HTML，離線可開、可傳）② 影片檔（偵測到 MediaRecorder 才提供）
//   不用 ffmpeg.wasm（25MB+、GitHub Pages 無法送 COOP/COEP、手機記憶體不足）

import * as store from './store.js';
import * as db from './db.js';
import { blobURL } from './photos.js';
import { createMusic, musicFromFile } from './music.js';

const W = 1080, H = 1920;
const T_INTRO = 3.2;
const T_DAY = 2.2;
const T_PHOTO = 3.4;
const T_FADE = 0.8;
const T_MAP = 5.5;
const T_OUTRO = 4.0;

const BG = '#0f1523';
const FONT = '"Noto Sans TC", system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';

// ---------- 收集 & 分組 ----------
export function collectSlides(tripId) {
  const subs = store.submissionsOfTrip(tripId);
  const seen = new Set();
  const out = [];
  for (const s of subs) {
    if (seen.has(s.photoHash)) continue;
    seen.add(s.photoHash);
    const quest = store.getRaw(s.questId);
    const spot = quest ? store.getRaw(quest.spotId) : null;
    const member = s.memberId ? store.getRaw(s.memberId) : null;
    out.push({
      hash: s.photoHash, caption: s.caption || '',
      questTitle: quest?.title || '', spotName: spot?.name || '',
      day: spot?.day || 1, spotOrder: spot?.order ?? 0, spotId: spot?.id || 'x',
      memberName: member?.displayName || '',
      takenAt: s.takenAt || s.createdAt,
    });
  }
  // 依「天 → 景點順序 → 拍攝時間」排，影片才會一天講完再換下一天
  out.sort((a, b) => a.day - b.day || a.spotOrder - b.spotOrder || a.takenAt - b.takenAt);
  return out;
}

function tripStats(tripId) {
  const spots = store.spotsOf(tripId);
  const subs = store.submissionsOfTrip(tripId);
  const members = store.membersOf(store.get(tripId).groupId);
  const photos = new Set(subs.map((s) => s.photoHash)).size;
  return { spots: spots.length, photos, members: members.length,
    reactions: subs.reduce((n, s) => n + store.reactionsOf(s.id).length, 0) };
}

// ---------- 影像載入 ----------
async function loadImages(slides) {
  return Promise.all(slides.map(async (sl, i) => {
    const url = await blobURL(sl.hash);
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    return { ...sl, img, _panX: i % 2 ? 1 : -1, _panY: i % 3 ? -1 : 1 };
  }));
}

// ---------- 時間軸 ----------
export async function buildTimeline(tripId) {
  const trip = store.get(tripId);
  const rawSlides = collectSlides(tripId);
  const frames = await loadImages(rawSlides);

  const spots = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null);
  const stats = tripStats(tripId);

  const segs = [];
  segs.push({ kind: 'intro', dur: T_INTRO, trip, stats });

  const byDay = new Map();
  for (const f of frames) {
    if (!byDay.has(f.day)) byDay.set(f.day, []);
    byDay.get(f.day).push(f);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  for (const day of days) {
    const dayFrames = byDay.get(day);
    const region = store.spotsOf(tripId).find((s) => s.day === day)?.region || trip.region || '';
    segs.push({ kind: 'day', dur: T_DAY, day, region, count: dayFrames.length });
    dayFrames.forEach((fr, idx) => {
      segs.push({ kind: 'photo', dur: T_PHOTO, frame: fr, next: dayFrames[idx + 1] || null });
    });
  }
  if (spots.length >= 2) segs.push({ kind: 'map', dur: T_MAP, spots, trip });
  segs.push({ kind: 'outro', dur: T_OUTRO, trip, stats });

  // 累積起點
  let acc = 0;
  for (const s of segs) { s.start = acc; acc += s.dur - (s.kind === 'photo' ? 0 : 0); }
  return { segs, total: acc, frames };
}

export function estimateDuration(tripId) {
  const slides = collectSlides(tripId);
  const days = new Set(slides.map((s) => s.day)).size || 1;
  return T_INTRO + days * T_DAY + slides.length * T_PHOTO + T_MAP + T_OUTRO;
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
function clamp01(t) { return Math.max(0, Math.min(1, t)); }

function textCenter(ctx, text, x, y, font, color, maxW) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let s = text;
  if (maxW) { while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -1); if (s !== text) s += '…'; }
  ctx.fillText(s, x, y);
}

function coverDraw(ctx, img, zoom, panX, panY, alpha) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.max(W / iw, H / ih) * zoom;
  const dw = iw * scale, dh = ih * scale;
  const dx = (W - dw) / 2 + panX;
  const dy = (H - dh) / 2 + panY;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawPhoto(ctx, frame, p, alpha) {
  const zoom = 1.05 + 0.12 * easeOut(p);
  coverDraw(ctx, frame.img, zoom, frame._panX * 40 * p, frame._panY * 40 * p, alpha);
}

function drawCaptionBar(ctx, frame, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, H * 0.60, 0, H);
  g.addColorStop(0, 'rgba(11,17,32,0)');
  g.addColorStop(1, 'rgba(11,17,32,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.60, W, H * 0.40);

  ctx.textAlign = 'left';
  const title = frame.caption || frame.questTitle || frame.spotName;
  const d = new Date(frame.takenAt);
  const sub = [frame.spotName && frame.spotName !== title ? frame.spotName : '',
    frame.memberName ? '· ' + frame.memberName : '',
    isNaN(d) ? '' : `· ${d.getMonth() + 1}/${d.getDate()}`].filter(Boolean).join(' ');
  ctx.font = `700 58px ${FONT}`; ctx.fillStyle = '#fff';
  wrapText(ctx, title, 70, H - 190, W - 140, 66, 2);
  ctx.font = `400 38px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.82)';
  if (sub) ctx.fillText(sub, 70, H - 110);
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
  const chars = [...text];
  let line = '', lines = [];
  for (const c of chars) {
    if (ctx.measureText(line + c).width > maxW) { lines.push(line); line = c; }
    else line += c;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines) lines.push(line);
  lines = lines.slice(0, maxLines);
  if (chars.join('').length > lines.join('').length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, '…');
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
}

function drawIntro(ctx, seg, t) {
  bgFill(ctx, 1);
  const p = clamp01(t / 0.8);
  const trip = seg.trip;
  ctx.save();
  ctx.globalAlpha = p;
  // 裝飾
  ctx.fillStyle = 'rgba(79,141,255,0.14)';
  ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, 520 + 60 * easeOut(p), 0, 7); ctx.fill();
  textCenter(ctx, '📸', W / 2, H * 0.40, '120px sans-serif', '#fff');
  textCenter(ctx, trip.title || '我們的旅程', W / 2, H * 0.52, `800 88px ${FONT}`, '#fff', W - 120);
  const range = [trip.startDate, trip.endDate].filter(Boolean).join('  –  ');
  if (range) textCenter(ctx, range, W / 2, H * 0.58, `400 42px ${FONT}`, 'rgba(255,255,255,0.75)');
  const sm = `${seg.stats.members} 個人 · ${seg.stats.spots} 個景點 · ${seg.stats.photos} 張照片`;
  textCenter(ctx, sm, W / 2, H * 0.64, `500 38px ${FONT}`, 'rgba(255,255,255,0.6)');
  ctx.restore();
}

function drawDay(ctx, seg, t) {
  bgFill(ctx, 0);
  const p = clamp01(t / 0.5) * clamp01((seg.dur - t) / 0.4);
  ctx.save();
  ctx.globalAlpha = p;
  ctx.strokeStyle = 'rgba(79,141,255,0.9)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(W / 2 - 60, H * 0.42); ctx.lineTo(W / 2 + 60, H * 0.42); ctx.stroke();
  textCenter(ctx, `第 ${seg.day} 天`, W / 2, H * 0.5, `800 96px ${FONT}`, '#fff');
  if (seg.region) textCenter(ctx, seg.region, W / 2, H * 0.56, `400 46px ${FONT}`, 'rgba(255,255,255,0.7)');
  ctx.restore();
}

function drawPhotoSeg(ctx, seg, t) {
  bgFill(ctx, 0);
  const p = t / seg.dur;
  const fadeIn = clamp01(t / 0.5);
  drawPhoto(ctx, seg.frame, p, fadeIn);
  // 交疊下一張
  if (seg.next && t > seg.dur - T_FADE) {
    const k = (t - (seg.dur - T_FADE)) / T_FADE;
    drawPhoto(ctx, seg.next, 0, k);
  }
  const capAlpha = clamp01((t - 0.35) / 0.4) * clamp01((seg.dur - t) / 0.5);
  drawCaptionBar(ctx, seg.frame, capAlpha);
}

function drawMap(ctx, seg, t) {
  bgFill(ctx, 1);
  const pts = seg.spots;
  const lats = pts.map((s) => s.lat), lngs = pts.map((s) => s.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * 0.25 || 0.02;
  const padLng = (maxLng - minLng) * 0.25 || 0.02;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  const mx = 150, myTop = 380, myBot = H - 360;
  const X = (lng) => mx + (lng - minLng) / (maxLng - minLng) * (W - 2 * mx);
  const Y = (lat) => myBot - (lat - minLat) / (maxLat - minLat) * (myBot - myTop);

  textCenter(ctx, '我們走過的地方', W / 2, 250, `800 64px ${FONT}`, '#fff');

  const prog = easeOut(clamp01((t - 0.3) / (seg.dur - 1.2)));
  const total = pts.length - 1;
  ctx.strokeStyle = 'rgba(79,141,255,0.9)';
  ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.setLineDash([2, 18]);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = X(pts[i].lng), y = Y(pts[i].lat);
    if (i === 0) { ctx.moveTo(x, y); continue; }
    const seg01 = clamp01(prog * total - (i - 1));
    if (seg01 <= 0) break;
    const px = X(pts[i - 1].lng), py = Y(pts[i - 1].lat);
    ctx.lineTo(px + (x - px) * seg01, py + (y - py) * seg01);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  pts.forEach((s, i) => {
    const appear = clamp01(prog * total - i + 0.5);
    if (appear <= 0) return;
    const x = X(s.lng), y = Y(s.lat);
    ctx.globalAlpha = appear;
    ctx.fillStyle = '#4f8dff';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = i % 2 ? 'left' : 'right';
    ctx.fillText(`${s.emoji || ''}${s.name}`, x + (i % 2 ? 26 : -26), y + 12);
    ctx.globalAlpha = 1;
  });
}

function drawOutro(ctx, seg, t) {
  bgFill(ctx, 1);
  const p = clamp01(t / 0.7);
  ctx.save(); ctx.globalAlpha = p;
  textCenter(ctx, '謝謝這趟旅程', W / 2, H * 0.42, `800 84px ${FONT}`, '#fff', W - 120);
  const s = seg.stats;
  textCenter(ctx, `${s.photos} 個回憶 · ${s.spots} 個景點 · ${s.members} 位旅伴`, W / 2, H * 0.5, `400 42px ${FONT}`, 'rgba(255,255,255,0.75)');
  if (s.reactions) textCenter(ctx, `互相按了 ${s.reactions} 個讚 ❤️`, W / 2, H * 0.55, `400 40px ${FONT}`, 'rgba(255,255,255,0.6)');
  textCenter(ctx, 'TripQuest', W / 2, H * 0.66, `700 40px ${FONT}`, 'rgba(255,255,255,0.4)');
  ctx.restore();
}

function drawAt(ctx, timeline, gt) {
  // 找出目前的 segment
  let seg = timeline.segs[0];
  for (const s of timeline.segs) { if (gt >= s.start) seg = s; else break; }
  const local = gt - seg.start;
  ({ intro: drawIntro, day: drawDay, photo: drawPhotoSeg, map: drawMap, outro: drawOutro }[seg.kind] || drawIntro)(ctx, seg, local);
}

// ---------- 預覽播放器 ----------
export async function createPlayer(canvas, tripId) {
  const timeline = await buildTimeline(tripId);
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  let iv = 0, start = 0, playing = false, onEnd = null, music = null;

  function tick() {
    if (!playing) return;
    const t = (performance.now() - start) / 1000;
    try { drawAt(ctx, timeline, Math.min(t, timeline.total)); } catch (e) { console.error(e); }
    if (t >= timeline.total) { playing = false; clearInterval(iv); music?.fadeOutStop(0.8); if (onEnd) onEnd(); }
  }
  return {
    duration: timeline.total,
    async play(style, cb) {
      onEnd = cb; playing = true; start = performance.now();
      if (style && style !== 'none') { music = createMusic(style); await music?.start().catch(() => {}); }
      clearInterval(iv); iv = setInterval(tick, 1000 / 30);
    },
    stop() { playing = false; clearInterval(iv); music?.stop(); },
    seek(t) { try { drawAt(ctx, timeline, t); } catch (e) { console.error(e); } },
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

// opts: { music: 'gentle'|'bright'|'none', musicFile: File|null, onProgress }
export async function recordVideo(tripId, opts = {}) {
  const timeline = await buildTimeline(tripId);
  if (!timeline.frames.length) throw new Error('還沒有照片');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fps = 25;
  const stream = canvas.captureStream(fps);

  let music = null;
  try {
    if (opts.musicFile) music = await musicFromFile(opts.musicFile);
    else if (opts.music && opts.music !== 'none') music = createMusic(opts.music);
  } catch { music = null; }
  if (music?.stream) for (const tr of music.stream.getAudioTracks()) stream.addTrack(tr);

  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    rec.onerror = (e) => reject(e.error || new Error('錄製失敗'));
  });

  rec.start(200);
  await music?.start().catch(() => {});
  const startT = performance.now();
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const t = (performance.now() - startT) / 1000;
      try { drawAt(ctx, timeline, Math.min(t, timeline.total)); } catch (e) { console.error('draw', e); }
      opts.onProgress && opts.onProgress(Math.min(1, t / timeline.total));
      if (t >= timeline.total) { clearInterval(iv); resolve(); }
    }, 1000 / fps);
  });
  await music?.fadeOutStop(1.0);
  await new Promise((r) => setTimeout(r, 300));
  rec.stop();
  const blob = await done;
  return { blob, ext: blob.type.includes('mp4') ? 'mp4' : 'webm' };
}

// ---------- 動態相簿頁（單一 HTML） ----------
export async function buildAlbumPage(tripId) {
  const trip = store.get(tripId);
  const slides = collectSlides(tripId);
  const stats = tripStats(tripId);
  const imgs = [];
  for (const sl of slides) {
    const entry = await db.getBlob(sl.hash);
    if (!entry) continue;
    const dataURI = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(entry.blob);
    });
    imgs.push({ ...sl, dataURI });
  }
  const range = [trip.startDate, trip.endDate].filter(Boolean).join(' – ');
  let lastDay = 0;
  const body = imgs.map((s) => {
    let dayHead = '';
    if (s.day !== lastDay) { lastDay = s.day; dayHead = `<h2 class="day">第 ${s.day} 天</h2>`; }
    const d = new Date(s.takenAt);
    const meta = [s.spotName, s.memberName, isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}`].filter(Boolean).join(' · ');
    return `${dayHead}<figure class="slide"><img src="${s.dataURI}" alt="${esc(s.questTitle)}" loading="lazy">
      <figcaption><strong>${esc(s.caption || s.questTitle)}</strong><span>${esc(meta)}</span></figcaption></figure>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(trip.title || '旅程回憶')} — TripQuest</title>
<style>
 *{box-sizing:border-box;margin:0}
 body{background:#0f1523;color:#fff;font-family:${FONT}}
 header{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;gap:14px}
 header h1{font-size:clamp(30px,8vw,52px)}
 header p{opacity:.72;font-size:clamp(15px,4vw,20px)}
 .scroll-hint{position:fixed;bottom:16px;left:0;right:0;text-align:center;font-size:14px;opacity:.5;animation:blink 2s infinite}
 @keyframes blink{50%{opacity:.15}}
 main{max-width:900px;margin:0 auto;padding:0 14px 90px}
 h2.day{font-size:clamp(22px,6vw,32px);margin:40px 0 12px;padding-left:14px;border-left:5px solid #4f8dff}
 .slide{position:relative;margin:16px 0;border-radius:20px;overflow:hidden;opacity:0;transform:translateY(28px);transition:opacity .8s,transform .8s}
 .slide.in{opacity:1;transform:none}
 .slide img{width:100%;display:block;aspect-ratio:4/5;object-fit:cover;animation:kb 14s ease-in-out infinite alternate}
 @keyframes kb{from{transform:scale(1.05)}to{transform:scale(1.14)}}
 figcaption{position:absolute;left:0;right:0;bottom:0;padding:48px 20px 18px;display:flex;flex-direction:column;gap:3px;background:linear-gradient(transparent,rgba(11,17,32,.9))}
 figcaption strong{font-size:clamp(17px,4.6vw,20px)}
 figcaption span{font-size:clamp(13px,3.6vw,15px);opacity:.78}
 footer{text-align:center;padding:48px 24px 90px;opacity:.62;line-height:1.9}
</style></head><body>
<header>
 <h1>${esc(trip.title || '我們的旅程')}</h1>
 ${range ? `<p>${esc(range)}</p>` : ''}
 <p>${stats.members} 個人 · ${stats.spots} 個景點 · ${stats.photos} 張照片</p>
 <div class="scroll-hint">往下滑 ↓</div>
</header>
<main>${body}</main>
<footer>謝謝這趟旅程<br>由 TripQuest 產生 · 這個檔案可離線開啟、直接傳給家人</footer>
<script>
 const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in')}),{threshold:.12});
 document.querySelectorAll('.slide').forEach(s=>io.observe(s));
</script></body></html>`;
  return new Blob([html], { type: 'text/html' });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
