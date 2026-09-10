import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, fmtBytes, modal } from '../ui.js';
import { navigate } from '../router.js';
import {
  createPlayer, buildAlbumPage, recordVideo, videoSupported,
  collectSlides, estimateDuration, LENGTHS, DEFAULT_LENGTH, ALBUM_INLINE_LIMIT,
} from '../memory.js';
import { STYLES } from '../music.js';
import { TRACKS, CATEGORIES, tracksOfCat, trackById, trackLabel, trackMusic, ensureTrackCached, isTrackStyle, TRACK_LICENSE_URL } from '../tracks.js';
import { downloadBlob, nativeShare } from '../share.js';
import { publishAlbum, unpublishAlbum, albumInfo, canPublish } from '../albumshare.js';
import { exportPhotos, exportSummary } from '../photoexport.js';

const SYNTH_OPTS = [
  { id: 'gentle', label: STYLES.gentle.label },
  { id: 'bright', label: STYLES.bright.label },
  { id: 'cinematic', label: STYLES.cinematic.label },
  { id: 'folk', label: STYLES.folk.label },
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

  let music = store.getRaw(tripId)?.musicStyle || 'track:warm';
  let musicFile = null;
  let length = store.getRaw(tripId)?.videoLength || DEFAULT_LENGTH;

  const canvas = h('canvas', { class: 'album-canvas' });
  // 進度條可以拖：預覽是逐幀繪製（drawAt 是「時間 → 畫面」的純函式），
  // 跳轉就是把時間游標設到那一秒重繪，不用等它從頭播
  const bar = h('div', { class: 'scrub' }, h('i'), h('span', { class: 'scrub-knob' }));
  const barFill = bar.firstChild;
  const knob = bar.lastChild;
  const timeLbl = h('div', { class: 'scrub-time' }, '0:00 / 0:00');
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
    // 照片牆數的是「投稿」、影片數的是「不重複的照片」——同一張圖被重複上傳
    // （或掛到兩個任務）時兩個數字會差開，不講清楚會像「影片漏了我的照片」
    //（實際回報：牆上 174、影片 171，差的 3 張是重複內容）。
    const subCount = store.submissionsOfTrip(tripId).length;
    const dup = Math.max(0, subCount - est[length].total);
    const dupNote = dup ? `（照片共 ${subCount} 張、其中 ${dup} 張內容重複——同一張只放一次）` : '';
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
        ? `從 ${e.total} 張裡挑 ${e.photos} 張——有人按讚、有寫說明、必拍任務的照片優先，且每個景點、每個人都保證出現到；不是每張都會入選。${dupNote}`
        : `這趟的照片不多，精華版一張都不會少。${dupNote}`)
      : `全部 ${e.total} 張不重複的照片都放進去，約 ${mmss(e.seconds)}。${dupNote}影片是即時錄的，所以錄多久就要等多久。`;
    meta.textContent = `${e.photos} 張照片 · 約 ${mmss(e.seconds)}`;
  }

  // ---------- 配樂試聽 ----------
  let preview = null, previewId = null;
  function stopPreview(fast = false) {
    const pv = preview; preview = null;
    const changed = previewId != null; previewId = null;
    if (pv) { try { fast ? pv.stop() : pv.fadeOutStop(0.25); } catch { /* noop */ } }
    if (changed) drawMusicPick();
  }
  async function togglePreview(tk) {
    if (previewId === tk.id) { stopPreview(); return; }
    stopPreview(true);
    if (player?.playing) { player.pause(); clearInterval(barIv); syncBtn(); }
    previewId = tk.id;
    drawMusicPick();
    try {
      const m = await trackMusic(tk.id, { volume: 0.6 });
      if (previewId !== tk.id) { m?.stop(); return; }     // 載入期間使用者已按停
      preview = m;
      await m.start();
    } catch {
      previewId = null; drawMusicPick();
      toast('試聽不了（可能沒網路）。合成音樂不用下載，離線也有。', 4200);
    }
  }

  async function pickTrack(tk) {
    music = 'track:' + tk.id; musicFile = null;
    drawMusicPick();
    store.patch(tripId, { musicStyle: music }).catch(() => {});
    try { await ensureTrackCached(tk.id); }               // 先下載進快取 → 之後離線也能錄
    catch { toast('配樂下載不了（可能沒網路）。錄影時若還是不行，會自動改用合成音樂。', 4600); }
  }

  function showMusicSources() {
    stopPreview();
    const licTag = { ccby: 'CC BY 4.0（片尾標示出處）', cc0: 'CC0（免標示）', pd: '公有領域（免標示）' };
    modal({
      title: '🎼 音樂來源與授權',
      closeX: true,
      body: h('div', { class: 'music-src' },
        h('p', {}, `內建 ${TRACKS.length} 首配樂都是可自由使用的授權：Kevin MacLeod 的 6 首採 CC BY 4.0（影片片尾會自動標示出處）；其餘為 CC0 或公有領域錄音（不需標示，片尾仍會禮貌標出曲名與演奏者）。全部經過響度統一與轉檔。`),
        ...CATEGORIES.map((c) => h('div', {},
          h('p', { style: 'margin:10px 0 2px;font-weight:800' }, `${c.emoji} ${c.label}`),
          h('ul', { style: 'margin:0' }, ...tracksOfCat(c.key).map((tk) =>
            h('li', {}, `${trackLabel(tk)}（${tk.performer || tk.artist}）· ${licTag[tk.lic]}`))),
        )),
        h('p', {}, h('a', { href: TRACK_LICENSE_URL, target: '_blank', rel: 'noopener' }, 'CC BY 授權條款：creativecommons.org/licenses/by/4.0')),
        h('p', {}, '完整逐曲記錄（來源網址、下載日期、修改說明）在專案的 MUSIC_LICENSES.md。'),
        h('p', { class: 'form-hint' }, '小提醒：這些曲子（尤其古典名曲）分享到 YouTube 偶爾會遇到「誤判」的版權聲明 —— 音樂是合法授權的，可以放心申訴。'),
      ),
      actions: [{ label: '知道了', value: true }],
    });
  }

  // 六個情緒分類、畫面永遠六列：每列顯示一首推薦曲，🔁 在同分類內輪替，
  // 想看全部的人展開清單。使用者選過的曲目存在 trip.musicStyle（跨裝置同步）。
  const rot = {};                                     // 分類 → 目前輪到第幾首（本頁狀態）
  let allOpen = false;
  function shownTrack(catKey) {
    const list = tracksOfCat(catKey);
    if (isTrackStyle(music)) {
      const cur = trackById(music.slice(6));
      if (cur && cur.cat === catKey) return cur;      // 選過的要記住：這列顯示所選那首
    }
    return list[(rot[catKey] || 0) % list.length];
  }
  function rotateCat(c) {
    const list = tracksOfCat(c.key);
    const now = shownTrack(c.key);
    const next = list[(list.indexOf(now) + 1) % list.length];
    rot[c.key] = list.indexOf(next);
    stopPreview(true);
    if (isTrackStyle(music) && trackById(music.slice(6))?.cat === c.key) pickTrack(next);
    else drawMusicPick();
  }
  function trackRow(tk, { cat = null, compact = false } = {}) {
    const selected = music === 'track:' + tk.id;
    return h('div', { class: 'mp-row' + (compact ? ' compact' : '') },
      h('button', { class: selected ? 'on' : '', onclick: () => pickTrack(tk) },
        cat ? h('span', { class: 'mp-cat' }, `${cat.emoji} ${cat.label}`) : null,
        h('span', { class: 'mp-title' }, (compact ? (selected ? '✓ ' : '') : '') + trackLabel(tk))),
      cat ? h('button', { class: 'mp-alt', 'aria-label': '換一首', title: '換一首', onclick: () => rotateCat(cat) }, '🔁') : null,
      h('button', {
        class: 'mp-prev' + (previewId === tk.id ? ' on' : ''),
        'aria-label': previewId === tk.id ? '停止試聽' : '試聽',
        onclick: () => togglePreview(tk),
      }, previewId === tk.id ? '⏹' : '▶'),
    );
  }
  function drawMusicPick() {
    const allWrap = h('div', { class: 'mp-all' });
    if (allOpen) {
      for (const c of CATEGORIES) {
        allWrap.append(h('p', { class: 'mp-head' }, `${c.emoji} ${c.label}`));
        for (const tk of tracksOfCat(c.key)) allWrap.append(trackRow(tk, { compact: true }));
      }
    }
    musicPick.replaceChildren(
      h('p', { class: 'mp-head' }, '🎵 內建配樂（真實錄音；第一次點會下載，之後離線也能用）'),
      ...CATEGORIES.map((c) => trackRow(shownTrack(c.key), { cat: c })),
      h('button', {
        class: 'btn btn-ghost btn-block mp-expand',
        onclick: () => { allOpen = !allOpen; stopPreview(true); drawMusicPick(); },
      }, allOpen ? '收起完整曲庫 ▴' : `📚 看完整曲庫（${TRACKS.length} 首）▾`),
      allWrap,
      h('p', { class: 'mp-head' }, '🎛️ 合成音樂（不用下載，離線一定有）'),
      ...SYNTH_OPTS.map((o) => h('button', {
        class: music === o.id ? 'on' : '',
        onclick: () => { music = o.id; musicFile = null; stopPreview(); drawMusicPick(); store.patch(tripId, { musicStyle: o.id }).catch(() => {}); },
      }, o.label)),
      h('button', { class: music === 'file' ? 'on' : '', onclick: () => { stopPreview(); fileInput.click(); } },
        musicFile ? '🎧 ' + musicFile.name : '🎧 用我手機裡的音樂'),
      h('button', {
        class: music === 'none' ? 'on' : '',
        onclick: () => { music = 'none'; musicFile = null; stopPreview(); drawMusicPick(); store.patch(tripId, { musicStyle: 'none' }).catch(() => {}); },
      }, '🔇 沒有音樂'),
      h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:2px', onclick: showMusicSources }, '🎼 音樂來源與授權'),
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
    h('div', { class: 'album-frame' }, canvas, bar, timeLbl),
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

  let player = null, barIv = 0, dragging = false;
  ensurePlayer().then((p) => { p.seek(1.4); updateBar(); });

  // 健檢抓到的 bug：router 沒有 teardown 機制，播放中切到別頁，
  // 計時器繼續跑、配樂繼續響。離開這頁就把播放器整個收掉。
  const stopOnLeave = () => {
    if (location.hash.includes(`/trip/${tripId}/album`)) return;
    window.removeEventListener('hashchange', stopOnLeave);
    clearInterval(barIv);
    if (player) { try { player.destroy(); } catch { /* noop */ } player = null; }
    stopPreview(true);
  };
  window.addEventListener('hashchange', stopOnLeave);

  const fmtT = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  function updateBar() {
    if (!player) return;
    const r = player.duration ? player.time / player.duration : 0;
    barFill.style.width = (r * 100) + '%';
    knob.style.left = `calc(${(r * 100).toFixed(2)}% - 10px)`;
    timeLbl.textContent = `${fmtT(player.time)} / ${fmtT(player.duration)}`;
  }
  function syncBtn() {
    if (!player) { playBtn.textContent = '▶ 播放預覽'; return; }
    if (player.playing) playBtn.textContent = '⏸ 暫停';
    else if (player.time >= player.duration - 0.1) playBtn.textContent = '▶ 重播';
    else playBtn.textContent = player.time > 0.1 ? '▶ 繼續播放' : '▶ 播放預覽';
  }
  async function seekFromEvent(ev) {
    const p = await ensurePlayer();
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    p.seek(ratio * p.duration);
    updateBar(); syncBtn();
  }
  bar.addEventListener('pointerdown', (e) => { dragging = true; try { bar.setPointerCapture(e.pointerId); } catch { /* noop */ } seekFromEvent(e); });
  bar.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
  bar.addEventListener('pointerup', () => { dragging = false; });
  bar.addEventListener('pointercancel', () => { dragging = false; });

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
        // 產不出來（額度用完、沒金鑰、不是建立者…）時，**在這一頁講出來**。
        // 字卡上的是舊文案，使用者是在這裡看到的，不該讓他對著舊句子猜原因。
        const { showAiStaleNote } = await import('./ai-config.js');
        if (location.hash.includes(`/trip/${tripId}/album`)) await showAiStaleNote(tripId);
      } catch { /* 靜默 */ }
    })();
  }

  function resetPlayer() {
    if (player) { try { player.destroy(); } catch { /* noop */ } }
    player = null;
    playBtn.textContent = '▶ 播放預覽';
    clearInterval(barIv);
    barFill.style.width = '0';
    ensurePlayer().then((p) => { p.seek(1.4); updateBar(); });
  }
  async function ensurePlayer() {
    if (!player) player = await createPlayer(canvas, tripId, { length });
    return player;
  }
  async function togglePlay() {
    stopPreview();
    const p = await ensurePlayer();
    if (p.playing) { p.pause(); clearInterval(barIv); updateBar(); syncBtn(); return; }
    clearInterval(barIv);
    barIv = setInterval(updateBar, 100);
    playBtn.textContent = '⏸ 暫停';
    await p.play(musicFile ? 'none' : music, () => {
      clearInterval(barIv); updateBar(); syncBtn();
    });
    syncBtn();
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
    stopPreview();
    if (player?.playing) { player.pause(); clearInterval(barIv); syncBtn(); }
    const est = estimateDuration(tripId, length);
    const overlay = h('div', { class: 'record-overlay' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'record-pct' }, '準備中…'),
      h('p', { class: 'form-hint' }, `影片是即時錄的，大約要 ${mmss(est.seconds)}。請讓畫面開著、不要鎖螢幕。`),
    );
    document.body.append(overlay);
    const pct = overlay.querySelector('.record-pct');
    let recMusic = musicFile ? 'none' : music;
    if (!musicFile && isTrackStyle(recMusic)) {
      try { await ensureTrackCached(recMusic.slice(6)); }
      catch { recMusic = 'gentle'; toast('配樂下載不了（沒網路），這支先用合成音樂。', 4600); }
    }
    try {
      const { blob, ext } = await recordVideo(tripId, {
        length,
        music: recMusic,
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
