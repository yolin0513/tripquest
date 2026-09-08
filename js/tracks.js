// 內建配樂 —— Kevin MacLeod（incompetech.com）的 CC BY 4.0 曲目。
//
// 授權（三代理獨立查證，3:0 通過，2026-09-08）：
//   · incompetech 全站音樂採 Creative Commons BY 4.0：允許商用、再散布、修改，
//     條件是標示作者、曲名、授權連結、註明修改。出處：
//     https://incompetech.com/music/royalty-free/faq.html
//   · 本 App 的標示：影片片尾（musicCredit，含授權短網址）＋ 回憶頁「音樂來源
//     與授權」說明 ＋ repo 內 MUSIC_LICENSES.md（逐曲 ISRC、來源、下載日、修改）。
//   · 檔案有修改：重新轉檔（320kbps → ~115kbps VBR）、去尾端靜音；
//     mp3 的 ID3 標籤保留作者與授權資訊。
//   · 排除過的來源：Pixabay（禁止獨立再散布）、Bensound（自有限制授權）、
//     YouTube 匯入（違反 ToS 且無授權）—— 不要加回來。
//
// 快取：sw.js 把 /media/music/ 導進獨立的 MUSIC_CACHE（cache-first、跨版本保留，
// 檔名即版本）；這裡另外直接寫同一個 cache，涵蓋 SW 還沒接管的第一次載入。

export const TRACKS = [
  { id: 'warm',    file: 'warm.mp3',    title: 'Wholesome',        mood: '溫暖懷舊', emoji: '🌤️', mb: 4.3 },
  { id: 'travel',  file: 'travel.mp3',  title: 'Carefree',         mood: '輕快旅行', emoji: '🚌', mb: 3.2 },
  { id: 'porch',   file: 'porch.mp3',   title: 'Porch Swing Days', mood: '悠閒午後', emoji: '🪑', mb: 2.7 },
  { id: 'tender',  file: 'tender.mp3',  title: 'Heartwarming',     mood: '抒情溫馨', emoji: '💛', mb: 0.9 },
  { id: 'playful', file: 'playful.mp3', title: 'Fluffing a Duck',  mood: '活潑家庭', emoji: '🦆', mb: 0.9 },
  { id: 'jaunty',  file: 'jaunty.mp3',  title: 'Wallpaper',        mood: '俏皮輕鬆', emoji: '🎈', mb: 3.3 },
];

export const TRACK_ARTIST = 'Kevin MacLeod (incompetech.com)';
export const TRACK_LICENSE = 'CC BY 4.0';
export const TRACK_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const trackById = (id) => TRACKS.find((t) => t.id === id) || null;
export const isTrackStyle = (s) => typeof s === 'string' && s.startsWith('track:');

const MUSIC_CACHE = 'tq-music-v1';

function trackUrl(t) {
  return new URL('../media/music/' + t.file, import.meta.url).href;
}

async function trackBuffer(id) {
  const t = trackById(id);
  if (!t) throw new Error('沒有這首：' + id);
  const url = trackUrl(t);
  let res = null;
  try { res = await (await caches.open(MUSIC_CACHE)).match(url); } catch { /* 無 Cache API 就直接抓 */ }
  if (!res) {
    res = await fetch(url);
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

// 片尾的授權標示 —— CC BY 4.0 要求：作者、曲名、授權連結、註明修改。
// 影片會被單獨分享出去（LINE/YouTube），片尾是唯一跟著影片走的標示，不能省。
export function musicCredit(style) {
  if (!isTrackStyle(style)) return null;
  const t = trackById(style.slice(6));
  if (!t) return null;
  return {
    line1: `音樂：${t.title} — ${TRACK_ARTIST}`,
    line2: 'Creative Commons BY 4.0 · creativecommons.org/licenses/by/4.0 · 經轉檔',
  };
}
