// 回憶影片 —— 三位架構代理一致方案：
//   主要交付：可分享的「動態相簿頁」（單一 HTML 檔，照片以 data URI 內嵌，CSS 做 Ken Burns + 淡入淡出）
//   加值：偵測到 MediaRecorder 才提供真正的影片檔（.mp4 / .webm），用 canvas.captureStream 即時錄製
//   排除：ffmpeg.wasm（25MB+、GitHub Pages 無法送 COOP/COEP 標頭、手機記憶體不夠）

import * as store from './store.js';
import * as db from './db.js';
import { blobURL } from './photos.js';

const W = 1080, H = 1920;
const PER_SLIDE = 3.2;      // 每張秒數
const FADE = 0.7;           // 交疊淡入秒數

export function collectSlides(tripId) {
  const subs = store.submissionsOfTrip(tripId);
  const seen = new Set();
  const slides = [];
  for (const s of subs) {
    if (seen.has(s.photoHash)) continue;
    seen.add(s.photoHash);
    const quest = store.getRaw(s.questId);
    const spot = quest ? store.getRaw(quest.spotId) : null;
    const member = s.memberId ? store.getRaw(s.memberId) : null;
    slides.push({
      hash: s.photoHash,
      caption: s.caption || '',
      questTitle: quest?.title || '',
      spotName: spot?.name || '',
      memberName: member?.displayName || '',
      takenAt: s.takenAt || s.createdAt,
    });
  }
  return slides;
}

async function loadImages(slides) {
  return Promise.all(slides.map(async (sl) => {
    const url = await blobURL(sl.hash);
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    return { ...sl, img };
  }));
}

// 共用繪製：畫出某個時間點 t（秒）的畫面到 ctx
function drawFrame(ctx, frames, t, trip) {
  ctx.fillStyle = '#0f1523';
  ctx.fillRect(0, 0, W, H);

  const intro = 2.0;
  if (t < intro) {
    drawTitleCard(ctx, trip, Math.min(1, t / 0.6));
    return;
  }
  const tt = t - intro;
  const idx = Math.floor(tt / PER_SLIDE);
  const local = tt - idx * PER_SLIDE;
  const cur = frames[idx];
  const nxt = frames[idx + 1];
  if (!cur) { drawEndCard(ctx, trip, frames.length); return; }

  drawKenBurns(ctx, cur, local / PER_SLIDE, 1);
  if (nxt && local > PER_SLIDE - FADE) {
    const k = (local - (PER_SLIDE - FADE)) / FADE;
    drawKenBurns(ctx, nxt, 0, k);
  }
  drawCaption(ctx, cur, Math.min(1, local / 0.4) * Math.min(1, (PER_SLIDE - local) / 0.4));
}

function coverRect(iw, ih) {
  const scale = Math.max(W / iw, H / ih);
  return { w: iw * scale, h: ih * scale };
}

function drawKenBurns(ctx, frame, p, alpha) {
  const { img } = frame;
  const { w, h } = coverRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const zoom = 1.06 + 0.06 * p;
  const dw = w * zoom, dh = h * zoom;
  const dx = (W - dw) / 2 + (frame._panX || 0) * 30 * p;
  const dy = (H - dh) / 2 + (frame._panY || -1) * 30 * p;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, dx, dy, dw, dh);
  // 底部漸層讓字清楚
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
  g.addColorStop(0, 'rgba(15,21,35,0)');
  g.addColorStop(1, 'rgba(15,21,35,0.82)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.62, W, H * 0.38);
  ctx.restore();
}

function drawCaption(ctx, frame, alpha) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.font = '600 52px "Noto Sans TC", system-ui, sans-serif';
  const line1 = frame.caption || frame.questTitle || '';
  const line2 = [frame.spotName, frame.memberName && '· ' + frame.memberName].filter(Boolean).join(' ');
  if (line1) ctx.fillText(clip(ctx, line1, W - 120), 60, H - 150);
  ctx.font = '400 36px "Noto Sans TC", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  if (line2) ctx.fillText(clip(ctx, line2, W - 120), 60, H - 96);
  ctx.restore();
}

function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function drawTitleCard(ctx, trip, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '700 78px "Noto Sans TC", system-ui, sans-serif';
  ctx.fillText(clip(ctx, trip.title || '我們的旅程', W - 120), W / 2, H / 2 - 20);
  ctx.font = '400 40px "Noto Sans TC", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const range = [trip.startDate, trip.endDate].filter(Boolean).join(' – ');
  if (range) ctx.fillText(range, W / 2, H / 2 + 50);
  ctx.restore();
}

function drawEndCard(ctx, trip, n) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '700 64px "Noto Sans TC", system-ui, sans-serif';
  ctx.fillText('完成 ' + n + ' 個回憶', W / 2, H / 2);
  ctx.font = '400 34px "Noto Sans TC", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('TripQuest', W / 2, H / 2 + 60);
  ctx.restore();
}

export function totalDuration(slideCount) {
  return 2.0 + slideCount * PER_SLIDE + 1.5;
}

// ---- 即時播放（app 內預覽用）----
export async function createPlayer(canvas, tripId) {
  const trip = store.get(tripId);
  const slides = collectSlides(tripId);
  const frames = await loadImages(slides);
  frames.forEach((f, i) => { f._panX = (i % 2 ? 1 : -1); f._panY = (i % 3 ? -1 : 1); });
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  const dur = totalDuration(frames.length);
  let iv = 0, start = 0, playing = false, onEnd = null;

  function tick() {
    if (!playing) return;
    const t = (performance.now() - start) / 1000;
    try { drawFrame(ctx, frames, t, trip); } catch (e) { console.error(e); }
    if (t >= dur) { playing = false; clearInterval(iv); if (onEnd) onEnd(); }
  }
  return {
    duration: dur,
    frameCount: frames.length,
    play(cb) { onEnd = cb; playing = true; start = performance.now(); clearInterval(iv); iv = setInterval(tick, 1000 / 30); },
    stop() { playing = false; clearInterval(iv); },
    seek(t) { try { drawFrame(ctx, frames, t, trip); } catch (e) { console.error(e); } },
    _frames: frames, _trip: trip,
  };
}

// ---- 錄成影片檔（加值功能）----
export function videoSupported() {
  if (typeof MediaRecorder === 'undefined') return false;
  return pickMime() != null;
}
function pickMime() {
  const cands = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of cands) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* noop */ }
  }
  return null;
}

export async function recordVideo(tripId, { onProgress } = {}) {
  const trip = store.get(tripId);
  const slides = collectSlides(tripId);
  if (!slides.length) throw new Error('還沒有照片');
  const frames = await loadImages(slides);
  frames.forEach((f, i) => { f._panX = (i % 2 ? 1 : -1); f._panY = (i % 3 ? -1 : 1); });

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fps = 24;
  const stream = canvas.captureStream(fps);
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const dur = totalDuration(frames.length);
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => {
      const type = mime.split(';')[0];
      resolve(new Blob(chunks, { type }));
    };
    rec.onerror = (e) => reject(e.error || new Error('錄製失敗'));
  });

  rec.start(250);
  const start = performance.now();
  // 用 setInterval 而非 rAF 驅動：即使畫面被其他視窗遮住也會繼續推進，錄製一定會跑完。
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      let t = (performance.now() - start) / 1000;
      try { drawFrame(ctx, frames, t, trip); } catch (e) { console.error('drawFrame', e); }
      if (onProgress) onProgress(Math.min(1, t / dur));
      if (t >= dur) { clearInterval(iv); resolve(); }
    }, 1000 / 30);
  });
  // 多補一點時間確保最後一格進 encoder
  await new Promise((r) => setTimeout(r, 400));
  rec.stop();
  const blob = await done;
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  return { blob, ext };
}

// ---- 動態相簿頁（主要交付）----
export async function buildAlbumPage(tripId) {
  const trip = store.get(tripId);
  const slides = collectSlides(tripId);
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
  const slidesHTML = imgs.map((s, i) => `
    <figure class="slide" style="--i:${i}">
      <img src="${s.dataURI}" alt="${escapeHtml(s.questTitle)}" loading="lazy">
      <figcaption>
        <strong>${escapeHtml(s.caption || s.questTitle)}</strong>
        <span>${escapeHtml([s.spotName, s.memberName && '· ' + s.memberName].filter(Boolean).join(' '))}</span>
      </figcaption>
    </figure>`).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(trip.title || '旅程回憶')} — TripQuest 相簿</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{background:#0f1523;color:#fff;font-family:"Noto Sans TC",system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif}
  header{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:12px}
  header h1{font-size:clamp(28px,7vw,46px)}
  header p{opacity:.7}
  .hint{position:fixed;bottom:14px;left:0;right:0;text-align:center;font-size:13px;opacity:.5;animation:blink 2s infinite}
  @keyframes blink{50%{opacity:.15}}
  main{max-width:900px;margin:0 auto;padding:0 12px 80px}
  .slide{position:relative;margin:14px 0;border-radius:18px;overflow:hidden;opacity:0;transform:translateY(24px) scale(.98);transition:opacity .8s,transform .8s}
  .slide.in{opacity:1;transform:none}
  .slide img{width:100%;display:block;aspect-ratio:9/13;object-fit:cover;animation:kb 12s ease-in-out infinite alternate}
  @keyframes kb{from{transform:scale(1.04)}to{transform:scale(1.12)}}
  figcaption{position:absolute;left:0;right:0;bottom:0;padding:44px 18px 16px;display:flex;flex-direction:column;gap:2px;
    background:linear-gradient(transparent,rgba(15,21,35,.85))}
  figcaption strong{font-size:18px}
  figcaption span{font-size:13px;opacity:.75}
  footer{text-align:center;padding:40px 20px 80px;opacity:.6}
</style></head><body>
<header>
  <h1>${escapeHtml(trip.title || '我們的旅程')}</h1>
  ${range ? `<p>${escapeHtml(range)}</p>` : ''}
  <p>${imgs.length} 個回憶 · TripQuest</p>
  <div class="hint">往下滑 ↓</div>
</header>
<main>${slidesHTML}</main>
<footer>由 TripQuest 產生 · 這個檔案可離線開啟、直接傳給朋友</footer>
<script>
  const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in')})},{threshold:.15});
  document.querySelectorAll('.slide').forEach(s=>io.observe(s));
</script>
</body></html>`;
  return new Blob([html], { type: 'text/html' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
