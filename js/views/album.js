import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, fmtBytes } from '../ui.js';
import { navigate } from '../router.js';
import {
  createPlayer, buildAlbumPage, recordVideo, videoSupported,
  collectSlides, estimateDuration, LENGTHS, DEFAULT_LENGTH, ALBUM_INLINE_LIMIT,
} from '../memory.js';
import { STYLES } from '../music.js';
import { downloadBlob, nativeShare } from '../share.js';
import { publishAlbum, unpublishAlbum, albumInfo, canPublish } from '../albumshare.js';
import { exportPhotos, exportSummary } from '../photoexport.js';

const MUSIC_OPTS = [
  { id: 'gentle', label: STYLES.gentle.label + '（推薦）' },
  { id: 'bright', label: STYLES.bright.label },
  { id: 'cinematic', label: STYLES.cinematic.label },
  { id: 'folk', label: STYLES.folk.label },
  { id: 'none', label: '🔇 沒有音樂' },
];

const mmss = (sec) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
};

export default async function album(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '回憶' });

  const slides = collectSlides(tripId);
  if (!slides.length) {
    render(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '還沒有照片可以做成影片'))));
    return;
  }

  let music = store.getRaw(tripId)?.musicStyle || 'gentle';
  let musicFile = null;
  let length = store.getRaw(tripId)?.videoLength || DEFAULT_LENGTH;

  const canvas = h('canvas', { class: 'album-canvas' });
  const bar = h('div', { class: 'scrub' }, h('i'));
  const barFill = bar.firstChild;
  const playBtn = h('button', { class: 'btn btn-primary btn-block btn-big', onclick: togglePlay }, '▶ 播放預覽');
  const lenPick = h('div', { class: 'len-pick' });
  const lenNote = h('p', { class: 'form-hint' });
  const musicPick = h('div', { class: 'music-pick' });
  const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
  const meta = h('p', { class: 'muted center', style: 'margin:10px 0' });
  const shareBox = h('div', { class: 'share-box' });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]; fileInput.value = '';
    if (!f) return;
    musicFile = f; music = 'file';
    drawMusicPick();
    toast('已選擇：' + f.name);
  });

  function drawLenPick() {
    const est = {};
    for (const k of Object.keys(LENGTHS)) est[k] = estimateDuration(tripId, k);
    lenPick.replaceChildren(...Object.values(LENGTHS).map((o) => h('button', {
      class: 'len-btn' + (length === o.key ? ' on' : ''),
      onclick: () => {
        if (length === o.key) return;
        length = o.key;
        store.patch(tripId, { videoLength: o.key }).catch(() => {});
        resetPlayer();
        drawLenPick();
      },
    },
      h('span', { class: 'len-t' }, o.label),
      h('span', { class: 'len-s' }, `${est[o.key].photos} 張 · ${mmss(est[o.key].seconds)}`),
    )));
    const e = est[length];
    lenNote.textContent = length === 'short'
      ? (e.total > e.photos
        ? `從 ${e.total} 張裡挑 ${e.photos} 張，每個景點、每個人都會出現到。這是預設——家人真的會看完的長度。`
        : '這趟的照片不多，精華版一張都不會少。')
      : `全部 ${e.total} 張都放進去，約 ${mmss(e.seconds)}。影片是即時錄的，所以錄多久就要等多久。`;
    meta.textContent = `${e.photos} 張照片 · 約 ${mmss(e.seconds)}`;
  }

  function drawMusicPick() {
    musicPick.replaceChildren(
      ...MUSIC_OPTS.map((o) => h('button', {
        class: music === o.id ? 'on' : '',
        onclick: () => { music = o.id; musicFile = null; drawMusicPick(); store.patch(tripId, { musicStyle: o.id }).catch(() => {}); },
      }, o.label)),
      h('button', { class: music === 'file' ? 'on' : '', onclick: () => fileInput.click() },
        musicFile ? '🎧 ' + musicFile.name : '🎧 用我手機裡的音樂'),
    );
  }

  function drawShare() {
    const info = albumInfo(tripId);
    if (info?.url) {
      shareBox.replaceChildren(
        h('p', { class: 'share-live' }, '✅ 已經有分享網址了'),
        h('div', { class: 'share-url' }, info.url),
        h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => copyLink(info.url) }, '📤 傳給家人'),
        h('div', { class: 'row2' },
          h('button', { class: 'btn btn-soft', onclick: doPublish }, '重新產生'),
          h('button', { class: 'btn btn-ghost', onclick: doUnpublish }, '收回連結'),
        ),
        h('p', { class: 'form-hint' }, '拿到這個網址的人都看得到這些照片，不需要 App、不需要註冊。不想給了就按「收回連結」，網址馬上失效。'),
      );
    } else {
      shareBox.replaceChildren(
        h('button', {
          class: 'btn btn-soft btn-block btn-big',
          disabled: !canPublish(),
          onclick: doPublish,
        }, '🔗 產生分享網址（最推薦）'),
        h('p', { class: 'form-hint' }, canPublish()
          ? '照片放到你自己的雲端空間，家人點網址就能看，手機電腦都不會卡。網址是一長串亂碼，只有你傳給的人才知道；隨時可以收回。'
          : '要先到「設定 → 多人同步」設定好，才能產生分享網址。'),
      );
    }
  }

  // 「進階」收納：分享網址頁本來就能逐張長按存到手機（照片是同網域的一般
  // 圖片網址，iOS / Android 都適用），所以這兩個匯出不再當主要選項。
  // 但不能整個拿掉 —— 單檔相簿是「沒設定同步就沒有分享網址」時唯一的退路，
  // ZIP 匯出是「保留原檔」畫質唯一的出口。
  const advBody = h('div', { class: 'stack', hidden: true },
    h('button', { class: 'btn btn-soft btn-block', onclick: doAlbumPage }, '📄 存成單一相簿檔（離線也能看）'),
    h('button', { class: 'btn btn-soft btn-block', onclick: doExportPhotos }, '📦 匯出全部照片（壓縮檔）'),
    h('p', { class: 'form-hint' }, '平常不需要這兩個：家人打開分享網址後，長按照片就能存到手機。這裡是給沒有網路分享、或想拿原始檔的人用的。'),
  );
  const advToggle = h('button', {
    class: 'btn btn-ghost btn-block',
    onclick: () => { advBody.hidden = !advBody.hidden; advToggle.textContent = advBody.hidden ? '更多儲存方式 ▾' : '更多儲存方式 ▴'; },
  }, '更多儲存方式 ▾');

  render(h('div', { class: 'page' },
    h('div', { class: 'section-label', style: 'margin-top:0' }, '影片'),
    h('div', { class: 'album-frame' }, canvas, bar),
    meta,
    playBtn,

    h('div', { class: 'section-label' }, '影片長度'),
    lenPick,
    lenNote,

    h('div', { class: 'section-label' }, '配樂'),
    musicPick,
    fileInput,

    videoSupported()
      ? h('button', { class: 'btn btn-soft btn-block btn-big', style: 'margin-top:14px', onclick: doVideo }, '🎬 存成影片檔')
      : h('p', { class: 'form-hint' }, '這支手機不支援直接存影片，請用下面的相片分享網址（一樣好看、一樣能傳）。'),
    h('p', { class: 'form-hint center' }, '影片在這支手機裡做好，不會上傳。'),

    h('div', { class: 'section-label', style: 'margin-top:26px' }, '相片'),
    shareBox,
    advToggle,
    advBody,
  ));

  drawLenPick();
  drawMusicPick();
  drawShare();

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
          resetPlayer();
        }
      } catch { /* 靜默 */ }
    })();
  }

  function resetPlayer() {
    if (player) { try { player.destroy(); } catch { /* noop */ } }
    player = null; playing = false;
    playBtn.textContent = '▶ 播放預覽';
    clearInterval(barIv);
    barFill.style.width = '0';
    ensurePlayer().then((p) => p.seek(1.4));
  }
  async function ensurePlayer() {
    if (!player) player = await createPlayer(canvas, tripId, { length });
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

  // ---------- 分享網址 ----------
  async function copyLink(url) {
    if (await nativeShare({ title: t.title, text: '我們的旅程照片', url })) return;
    try { await navigator.clipboard.writeText(url); toast('網址已複製，貼到 LINE 傳給家人'); }
    catch { toast('請長按上面的網址複製'); }
  }

  async function doPublish() {
    const ok = await confirmDialog(
      '要把這趟的照片放到網路上、產生一個可以傳給家人的網址嗎？\n\n' +
      '· 網址是一長串亂碼，猜不到，只有你傳給的人看得到\n' +
      '· 家人不用裝 App、不用註冊\n' +
      '· 隨時可以按「收回連結」讓它失效',
      { okLabel: '產生網址' });
    if (!ok) return;
    const overlay = progressOverlay('正在準備照片…');
    try {
      const r = await publishAlbum(tripId, {
        onProgress: ({ phase, done, total }) => {
          overlay.set(phase === 'upload' ? `上傳照片 ${done}/${total}…` : '做相簿頁…');
        },
      });
      overlay.remove();
      drawShare();
      toast(`好了！${r.photos} 張照片`);
      copyLink(r.url);
    } catch (e) {
      overlay.remove();
      toast('產生失敗：' + e.message, 4200);
    }
  }

  async function doUnpublish() {
    const ok = await confirmDialog('收回之後，之前傳出去的網址就打不開了。要收回嗎？', { danger: true, okLabel: '收回' });
    if (!ok) return;
    await unpublishAlbum(tripId);
    drawShare();
    toast('已收回，網址失效了');
  }

  // ---------- 單檔相簿 ----------
  async function doAlbumPage() {
    const overlay = progressOverlay('製作相簿檔中…');
    try {
      const r = await buildAlbumPage(tripId, { onProgress: (x) => overlay.set(`製作中 ${Math.round(x * 100)}%`) });
      overlay.remove();
      if (!t.albumMade) store.patch(tripId, { albumMade: true }).catch(() => {});
      const big = r.blob.size > ALBUM_INLINE_LIMIT;
      if (big) {
        const go = await confirmDialog(
          `這個相簿檔有 ${fmtBytes(r.blob.size)}，照片太多了。\n\n` +
          '單一檔案太大時，很多手機打不開（電腦可以）。建議改用上面的「產生分享網址」。\n\n' +
          '還是要存嗎？', { okLabel: '還是要存' });
        if (!go) return;
      }
      const file = new File([r.blob], `${t.title || 'trip'}-相簿.html`, { type: 'text/html' });
      if (await nativeShare({ title: t.title, text: '我們的旅程回憶', files: [file] })) return;
      downloadBlob(r.blob, file.name);
      toast(`已存檔（${fmtBytes(r.blob.size)}）`);
    } catch (e) {
      overlay.remove();
      toast('製作失敗：' + e.message);
    }
  }

  // ---------- 匯出全部照片 ----------
  async function doExportPhotos() {
    const s = exportSummary(tripId);
    const lines = [`要匯出這趟的 ${s.total} 張照片嗎？`, ''];
    if (s.compressedOnly) {
      lines.push(`⚠️ 其中 ${s.compressedOnly} 張沒有原始檔`,
        '拍照或從相簿匯入時就已經縮到長邊 1600px 了，原始檔沒有留下來，沒辦法還原成原畫質。',
        '想保留原始檔請到「設定 → 照片品質」打開，之後拍的才會留。', '');
    }
    if (s.withOriginal) lines.push(`✅ ${s.withOriginal} 張有原始檔，會用原始檔匯出`, '');
    if (s.parts > 1) lines.push(`張數多，會分成 ${s.parts} 個壓縮檔，一個一個存。`);
    const ok = await confirmDialog(lines.join('\n'), { okLabel: '開始匯出' });
    if (!ok) return;

    const overlay = progressOverlay('準備中…');
    try {
      const r = await exportPhotos(tripId, {
        onProgress: ({ done, total, part, parts }) => {
          overlay.set(`${done}/${total} 張` + (parts > 1 ? `（第 ${part}/${parts} 包）` : ''));
        },
      });
      overlay.remove();
      if (!r.files.length) { toast('沒有可以匯出的照片'); return; }
      for (const f of r.files) {
        const file = new File([f.blob], f.name, { type: 'application/zip' });
        if (!(await nativeShare({ title: f.name, files: [file] }))) downloadBlob(f.blob, f.name);
        await new Promise((res) => setTimeout(res, 700));   // 連續下載中間留一點時間，手機才接得住
      }
      toast(r.missing
        ? `已匯出 ${r.total - r.missing} 張（${r.missing} 張還沒同步到這台）`
        : `已匯出 ${r.total} 張，共 ${r.files.length} 個檔`, 4000);
    } catch (e) {
      overlay.remove();
      toast('匯出失敗：' + e.message, 4200);
    }
  }

  // ---------- 錄影 ----------
  async function doVideo() {
    if (playing) { player.stop(); playing = false; }
    const est = estimateDuration(tripId, length);
    const overlay = h('div', { class: 'record-overlay' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'record-pct' }, '準備中…'),
      h('p', { class: 'form-hint' }, `影片是即時錄的，大約要 ${mmss(est.seconds)}。請讓畫面開著、不要鎖螢幕。`),
    );
    document.body.append(overlay);
    const pct = overlay.querySelector('.record-pct');
    try {
      const { blob, ext } = await recordVideo(tripId, {
        length,
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
      toast('錄製失敗，請改用分享網址：' + e.message);
    }
  }
}

function progressOverlay(text) {
  const line = h('div', { class: 'record-pct' }, text);
  const el = h('div', { class: 'record-overlay' }, h('div', { class: 'spinner' }), line);
  document.body.append(el);
  return { set: (s) => { line.textContent = s; }, remove: () => el.remove() };
}
