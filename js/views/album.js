import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { createPlayer, buildAlbumPage, recordVideo, videoSupported, collectSlides } from '../memory.js';
import { downloadBlob, nativeShare } from '../share.js';

export default async function album(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '回憶影片' });

  const slides = collectSlides(tripId);
  if (!slides.length) {
    render(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '還沒有照片可以做成影片'))));
    return;
  }

  const canvas = h('canvas', { class: 'album-canvas' });
  const playBtn = h('button', { class: 'btn btn-primary btn-block', onclick: togglePlay }, '▶ 播放預覽');
  const bar = h('div', { class: 'scrub' }, h('div', { class: 'scrub-fill' }));
  const barFill = bar.firstChild;

  render(h('div', { class: 'page album-page' },
    h('div', { class: 'album-frame' }, canvas, bar),
    h('p', { class: 'muted sm center' }, `${slides.length} 張照片 · 約 ${Math.round((2 + slides.length * 3.2 + 1.5))} 秒`),
    playBtn,

    h('div', { class: 'section-label' }, '匯出'),
    h('button', { class: 'btn btn-soft btn-block', onclick: doAlbumPage }, '📄 下載動態相簿頁（HTML，任何裝置都能開）'),
    videoSupported()
      ? h('button', { class: 'btn btn-soft btn-block', onclick: doVideo }, '🎬 錄成影片檔')
      : h('p', { class: 'form-hint' }, '這個瀏覽器不支援直接錄影片，請用上方的相簿頁（一樣可以分享、也很好看）。'),
    h('p', { class: 'form-hint center' }, '影片 / 相簿都在手機本機產生，不會上傳。'),
  ));

  let player = null;
  let playing = false;
  let barIv = 0;

  // 進頁就先畫出封面 / 第一張，不要留黑畫面
  ensurePlayer().then((p) => p.seek(1.2));

  async function ensurePlayer() {
    if (!player) { player = await createPlayer(canvas, tripId); }
    return player;
  }
  async function togglePlay() {
    const p = await ensurePlayer();
    if (playing) { p.stop(); playing = false; playBtn.textContent = '▶ 播放預覽'; clearInterval(barIv); return; }
    playing = true; playBtn.textContent = '⏸ 暫停';
    const start = performance.now();
    clearInterval(barIv);
    barIv = setInterval(() => {
      barFill.style.width = Math.min(100, ((performance.now() - start) / 1000 / p.duration) * 100) + '%';
    }, 100);
    p.play(() => { playing = false; playBtn.textContent = '▶ 重播'; clearInterval(barIv); barFill.style.width = '100%'; });
  }

  async function doAlbumPage() {
    toast('產生相簿頁中…');
    const blob = await buildAlbumPage(tripId);
    const file = new File([blob], `${t.title || 'trip'}-相簿.html`, { type: 'text/html' });
    if (await nativeShare({ title: t.title, text: '我們的旅程回憶', files: [file] })) return;
    downloadBlob(blob, file.name);
    toast('已下載，可直接用瀏覽器開啟或傳給朋友');
  }

  async function doVideo() {
    const overlay = h('div', { class: 'record-overlay' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'record-pct' }, '準備中…'),
      h('p', { class: 'form-hint' }, '錄製是即時進行的，請讓畫面保持開著'),
    );
    document.body.append(overlay);
    const pct = overlay.querySelector('.record-pct');
    try {
      const { blob, ext } = await recordVideo(tripId, { onProgress: (r) => { pct.textContent = Math.round(r * 100) + '%'; } });
      overlay.remove();
      const file = new File([blob], `${t.title || 'trip'}-回憶.${ext}`, { type: blob.type });
      if (await nativeShare({ title: t.title, text: '我們的旅程回憶', files: [file] })) return;
      downloadBlob(blob, file.name);
      toast(ext === 'webm' ? '已下載 .webm（部分 App 需轉檔才能播）' : '已下載影片');
    } catch (e) {
      overlay.remove();
      console.error(e);
      toast('錄製失敗，請改用相簿頁：' + e.message);
    }
  }
}
