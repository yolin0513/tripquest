// 內建配樂曲庫 —— 21 首，六個情緒分類，介面永遠六列。
//
// 授權（兩輪三代理獨立查證，各 3:0 通過；完整記錄在 repo 的 MUSIC_LICENSES.md）：
//   · CC BY 4.0 ×6：Kevin MacLeod（incompetech.com）。片尾兩行標示（曲名/作者/
//     授權短網址/經轉檔）——CC BY 的要求，跟著影片走。規模維持六首，不再擴大。
//   · CC0 / 公有領域 ×15：古典（Open Goldberg、Open WTC、Musopen Symphony、
//     US Air Force Band、Commons CC0）與現代 CC0（Komiku、Loyalty Freak Music）。
//     法律上零標示義務；片尾仍標一行「曲名 — 演奏/作者」以示尊重。
//   · 第二輪投票抓掉一首：Clair de Lune（Goedhart）—— Commons 的 PD 模板只涵蓋
//     「樂曲」，錄音本身是 CC BY 3.0（樂曲公有領域 ≠ 錄音公有領域）。已依
//     「CC BY 不再擴大」原則換成 Ishizaka 的 WTC 前奏曲（CC0）。
//
// 存放與快取：
//   · 音檔在使用者自己的 Cloudflare R2（bucket key: music/v1/<id>.mp3），
//     由同步 Worker 的 GET /music/<id>.mp3 公開供裝（唯讀、白名單檔名、無列舉）。
//     曲庫再大也不進 repo、不肥大部署與預快取。
//   · 選了才下載；下載後寫進 Cache API 的 tq-music-v1（跨版本保留）→ 離線可用。
//   · 退路：R2 取不到 → 呼叫端退回程式合成並明講（album.js）；playful 一首
//     保留在 repo（./media/music/）當離線最終保底。
//
// 響度：全部經兩段式 EBU R128 loudnorm（I=-16 LUFS, TP=-1.5）——不同來源不會忽大忽小。

const R2_BASE = (typeof window !== 'undefined' && window.__TQ_MUSIC_ENDPOINT)
  || 'https://tripquest.yolin0513.workers.dev/music/';

export const CATEGORIES = [
  { key: 'warm',      label: '溫暖懷舊', emoji: '🌤️' },
  { key: 'travel',    label: '輕快旅行', emoji: '🚌' },
  { key: 'lyric',     label: '抒情',     emoji: '💛' },
  { key: 'family',    label: '活潑家庭', emoji: '🦆' },
  { key: 'classical', label: '古典',     emoji: '🎻' },
  { key: 'jaunty',    label: '俏皮輕鬆', emoji: '🎈' },
];

// lic: 'ccby'（需標示）| 'cc0' | 'pd'（零義務，片尾禮貌標一行）
export const TRACKS = [
  // — 溫暖懷舊 —
  { id: 'warm',       cat: 'warm', title: 'Wholesome', artist: 'Kevin MacLeod (incompetech.com)', lic: 'ccby', mb: 4.3 },
  { id: 'porch',      cat: 'warm', title: 'Porch Swing Days', artist: 'Kevin MacLeod (incompetech.com)', lic: 'ccby', mb: 2.5 },
  { id: 'ko-village', cat: 'warm', title: 'Le Grand Village', artist: 'Komiku', lic: 'cc0', mb: 1.9 },
  // — 輕快旅行 —
  { id: 'travel',      cat: 'travel', title: 'Carefree', artist: 'Kevin MacLeod (incompetech.com)', lic: 'ccby', mb: 3.2 },
  { id: 'ko-horizon',  cat: 'travel', title: "Fouler l'horizon", artist: 'Komiku', lic: 'cc0', mb: 2.3 },
  { id: 'ko-montagne', cat: 'travel', title: 'La montagne', artist: 'Komiku', lic: 'cc0', mb: 3.1 },
  // — 抒情 —
  { id: 'tender',    cat: 'lyric', title: 'Heartwarming', artist: 'Kevin MacLeod (incompetech.com)', lic: 'ccby', mb: 0.8 },
  { id: 'ko-barque', cat: 'lyric', title: 'Barque sur le lac', artist: 'Komiku', lic: 'cc0', mb: 3.4 },
  { id: 'ko-bleu',   cat: 'lyric', title: 'Bleu', artist: 'Komiku', lic: 'cc0', mb: 3.3 },
  // — 活潑家庭 —
  { id: 'playful',      cat: 'family', title: 'Fluffing a Duck', artist: 'Kevin MacLeod (incompetech.com)', lic: 'ccby', mb: 0.8, local: true },
  { id: 'ko-tournesol', cat: 'family', title: 'Champ de tournesol', artist: 'Komiku', lic: 'cc0', mb: 2.3 },
  { id: 'lf-picnic',    cat: 'family', title: 'Go to the Picnic', artist: 'Loyalty Freak Music', lic: 'cc0', mb: 2.4 },
  // — 古典（錄音本身皆 CC0/PD，逐一查證過）—
  { id: 'cl-aria',    cat: 'classical', title: '郭德堡變奏曲：詠嘆調', composer: '巴哈', performer: 'Kimiko Ishizaka', lic: 'cc0', mb: 3.0 },
  { id: 'cl-prelude', cat: 'classical', title: '平均律：C 大調前奏曲', composer: '巴哈', performer: 'Kimiko Ishizaka', lic: 'cc0', mb: 1.6 },
  { id: 'cl-morning', cat: 'classical', title: '皮爾金：晨歌', composer: '葛利格', performer: 'Musopen Symphony', lic: 'pd', mb: 2.7 },
  { id: 'cl-anitra',  cat: 'classical', title: '皮爾金：安妮特拉之舞', composer: '葛利格', performer: 'Musopen Symphony', lic: 'pd', mb: 3.0 },
  { id: 'cl-flowers', cat: 'classical', title: '胡桃鉗：花之圓舞曲', composer: '柴可夫斯基', performer: 'US Air Force Band', lic: 'pd', mb: 5.2 },
  { id: 'cl-gymno',   cat: 'classical', title: '第一號吉諾佩第', composer: '薩提', performer: 'Teknopazzo', lic: 'cc0', mb: 2.0 },
  // — 俏皮輕鬆 —
  { id: 'jaunty',      cat: 'jaunty', title: 'Wallpaper', artist: 'Kevin MacLeod (incompetech.com)', lic: 'ccby', mb: 3.1 },
  { id: 'lf-sweetsun', cat: 'jaunty', title: 'Sweet Sun', artist: 'Loyalty Freak Music', lic: 'cc0', mb: 1.7 },
  { id: 'lf-yippee',   cat: 'jaunty', title: 'Yippee !', artist: 'Loyalty Freak Music', lic: 'cc0', mb: 1.9 },
];

export const TRACK_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const trackById = (id) => TRACKS.find((t) => t.id === id) || null;
export const tracksOfCat = (cat) => TRACKS.filter((t) => t.cat === cat);
export const isTrackStyle = (s) => typeof s === 'string' && s.startsWith('track:');

const MUSIC_CACHE = 'tq-music-v1';

function trackUrl(t) {
  if (t.local) return new URL('../media/music/' + t.id + '.mp3', import.meta.url).href;
  return R2_BASE + t.id + '.mp3';
}

async function trackBuffer(id) {
  const t = trackById(id);
  if (!t) throw new Error('沒有這首：' + id);
  const url = trackUrl(t);
  let res = null;
  try { res = await (await caches.open(MUSIC_CACHE)).match(url); } catch { /* 無 Cache API 就直接抓 */ }
  if (!res) {
    // 逾時 25 秒：掛住的下載會讓「準備中…」覆蓋層永遠轉；斷開讓呼叫端退回合成音樂
    const to = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(25000) : undefined;
    res = await fetch(url, { signal: to });
    if (!res.ok) throw new Error('下載失敗 ' + res.status);
    try { await (await caches.open(MUSIC_CACHE)).put(url, res.clone()); } catch { /* noop */ }
  }
  return await res.arrayBuffer();
}

// 先下載＋進快取（選曲時呼叫 → 之後離線也能用）
export async function ensureTrackCached(id) { await trackBuffer(id); }

// 回傳與 createMusic / musicFromFile 同介面的配樂物件：
// {stream, start, progress, pause, resume, fadeOutStop, stop}
// 循環播放（影片比曲長就從頭接續），結尾淡出由呼叫端的 fadeOutStop 處理。
export async function trackMusic(id, { volume = 0.7 } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const data = await trackBuffer(id);
  const ctx = new Ctx();
  try { await ctx.suspend(); } catch { /* noop */ }   // 解碼要一兩秒，期間不該算「在響」；start() 會 resume
  const buf = await ctx.decodeAudioData(data);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  const dest = ctx.createMediaStreamDestination();
  src.connect(gain); gain.connect(dest); gain.connect(ctx.destination);
  let started = false;
  return {
    stream: dest.stream,
    style: 'track:' + id,
    duration: buf.duration,
    async start() { if (ctx.state === 'suspended') await ctx.resume(); if (!started) { src.start(); started = true; } },
    progress() { /* 真實曲目不做段落編排 */ },
    async pause() { try { await ctx.suspend(); } catch { /* noop */ } },
    async resume() { try { await ctx.resume(); } catch { /* noop */ } },
    async fadeOutStop(sec = 1.2) {
      try {
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + sec);
      } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, sec * 1000 + 100));
      try { src.stop(); } catch { /* noop */ }
      try { await ctx.close(); } catch { /* noop */ }
    },
    stop() { try { src.stop(); } catch { /* noop */ } try { ctx.close(); } catch { /* noop */ } },
  };
}

// 顯示用：一首曲子的完整名（分類頁與清單用）
export function trackLabel(t) {
  return t.composer ? `${t.title} — ${t.composer}` : t.title;
}

// 片尾標示 —— 只標實際用到的那一首：
//   CC BY：曲名/作者/授權短網址/經轉檔（授權要求，兩行）
//   CC0/PD：零義務，禮貌標一行「曲名 — 演奏者」（作曲者含在曲名裡）
export function musicCredit(style) {
  if (!isTrackStyle(style)) return null;
  const t = trackById(style.slice(6));
  if (!t) return null;
  if (t.lic === 'ccby') {
    return {
      line1: `音樂：${t.title} — ${t.artist}`,
      line2: 'Creative Commons BY 4.0 · creativecommons.org/licenses/by/4.0 · 經轉檔',
    };
  }
  const who = t.performer ? `${t.composer} 曲，${t.performer} 演奏` : t.artist;
  return { line1: `音樂：${t.title} — ${who}`, line2: null };
}
