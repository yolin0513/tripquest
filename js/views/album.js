import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { createPlayer, buildAlbumPage, recordVideo, videoSupported, collectSlides, estimateDuration } from '../memory.js';
import { downloadBlob, nativeShare } from '../share.js';

const MUSIC_OPTS = [
  { id: 'gentle', label: '🎵 溫柔（推薦）' },
  { id: 'bright', label: '🎶 輕快' },
  { id: 'none', label: '🔇 沒有音樂' },
];

export default async function album(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '回憶影片' });

  const slides = collectSlides(tripId);
  if (!slides.length) {
    render(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '還沒有照片可以做成影片'))));
    return;
  }

  let music = store.getRaw(tripId)?.musicStyle || 'gentle';
  let musicFile = null;

  const canvas = h('canvas', { class: 'album-canvas' });
  const bar = h('div', { class: 'scrub' }, h('i'));
  const barFill = bar.firstChild;
  const playBtn = h('button', { class: 'btn btn-primary btn-block btn-big', onclick: togglePlay }, '▶ 播放預覽');
  const musicPick = h('div', { class: 'music-pick' });
  const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
  const aiNote = h('p', { class: 'form-hint center', hidden: true }, '✨ 片頭片尾、每天的旁白與部分照片字幕由 AI 生成');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]; fileInput.value = '';
    if (!f) return;
    musicFile = f; music = 'file';
    drawMusicPick();
    toast('已選擇：' + f.name);
  });

  function drawMusicPick() {
    musicPick.replaceChildren(
      ...MUSIC_OPTS.map((o) => h('button', {
        class: music === o.id ? 'on' : '',
        onclick: () => { music = o.id; musicFile = null; drawMusicPick(); store.patch(tripId, { musicStyle: o.id }); },
      }, o.label)),
      h('button', { class: music === 'file' ? 'on' : '', onclick: () => fileInput.click() },
        musicFile ? '🎧 ' + musicFile.name : '🎧 用我手機裡的音樂'),
    );
  }
  drawMusicPick();

  render(h('div', { class: 'page' },
    h('div', { class: 'album-frame' }, canvas, bar),
    h('p', { class: 'muted center', style: 'margin:10px 0' },
      `${slides.length} 張照片 · 約 ${Math.round(estimateDuration(tripId))} 秒`),
    playBtn,

    h('div', { class: 'section-label' }, '配樂'),
    musicPick,
    fileInput,

    h('div', { class: 'section-label' }, '匯出'),
    h('button', { class: 'btn btn-soft btn-block btn-big', onclick: doAlbumPage },
      '📄 存成相簿頁（任何手機都能開、可傳給家人）'),
    videoSupported()
      ? h('button', { class: 'btn btn-soft btn-block btn-big', onclick: doVideo }, '🎬 存成影片檔')
      : h('p', { class: 'form-hint' }, '這支手機不支援直接存影片，請用上面的相簿頁（一樣好看、一樣能傳）。'),
    h('p', { class: 'form-hint center' }, '全部都在這支手機裡做好，不會上傳。'),
    aiNote,
    h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:14px', onclick: () => navigate(`/trip/${tripId}/recap`) }, '🎁 看這趟的數字回顧'),
  ));

  let player = null, playing = false, barIv = 0;
  ensurePlayer().then((p) => p.seek(1.4));

  // 有開 AI → 背景自動產生影片文案（片頭片尾、旁白、照片字幕），好了重繪一次
  if (t.aiEnabled) {
    (async () => {
      try {
        const { ensureTripText, ensurePhotoCaptions, aiPayload } = await import('../aicontent.js');
        await Promise.all([ensureTripText(tripId), ensurePhotoCaptions(tripId)]);
        if ((aiPayload(tripId, 'tripText') || aiPayload(tripId, 'photoCaptions'))
          && location.hash.includes(`/trip/${tripId}/album`)) {
          aiNote.hidden = false;
          player = null;                      // 讓 timeline 重建、吃到新文案
          ensurePlayer().then((p) => p.seek(1.4));
        }
      } catch { /* 靜默 */ }
    })();
  }

  async function ensurePlayer() {
    if (!player) player = await createPlayer(canvas, tripId);
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
    await p.play(musicFile ? 'none' : music, () => {
      playing = false; playBtn.textContent = '▶ 重播'; clearInterval(barIv); barFill.style.width = '100%';
    });
  }

  async function doAlbumPage() {
    toast('製作相簿頁中…');
    if (!t.albumMade) store.patch(tripId, { albumMade: true }).catch(() => {});
    const blob = await buildAlbumPage(tripId);
    const file = new File([blob], `${t.title || 'trip'}-相簿.html`, { type: 'text/html' });
    if (await nativeShare({ title: t.title, text: '我們的旅程回憶', files: [file] })) return;
    downloadBlob(blob, file.name);
    toast('已存檔，可用瀏覽器打開或傳給家人');
  }

  async function doVideo() {
    if (playing) { player.stop(); playing = false; }
    const overlay = h('div', { class: 'record-overlay' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'record-pct' }, '準備中…'),
      h('p', { class: 'form-hint' }, '影片是即時錄的，請讓畫面開著、不要鎖螢幕'),
    );
    document.body.append(overlay);
    const pct = overlay.querySelector('.record-pct');
    try {
      const { blob, ext } = await recordVideo(tripId, {
        music: musicFile ? 'none' : music,
        musicFile,
        onProgress: (r) => { pct.textContent = Math.round(r * 100) + '%'; },
      });
      overlay.remove();
      if (!t.albumMade) store.patch(tripId, { albumMade: true }).catch(() => {});
      const file = new File([blob], `${t.title || 'trip'}-回憶.${ext}`, { type: blob.type });
      if (await nativeShare({ title: t.title, text: '我們的旅程回憶', files: [file] })) return;
      downloadBlob(blob, file.name);
      toast(ext === 'webm' ? '已存 .webm（有些相簿 App 需轉檔）' : '已存成影片');
    } catch (e) {
      overlay.remove();
      console.error(e);
      toast('錄製失敗，請改用相簿頁：' + e.message);
    }
  }
}
