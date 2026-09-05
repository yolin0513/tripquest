// 景點 → 主題判定。海報、行程頁、文案語氣都看這支。
// 判定順序：名稱關鍵字（最準）→ 策展 primary/tags → 自由輸入的 inferredType → 預設。
// 主題資料在 data/themes.json，可擴充。

let _themes = null;

export async function loadThemes() {
  if (!_themes) {
    try { _themes = await fetch('./data/themes.json').then((r) => r.json()); }
    catch { _themes = { map: { byName: [], byTag: {}, byType: {}, default: 'journey' }, themes: {} }; }
  }
  return _themes;
}
export function themesSync() { return _themes; }

const _reCache = new Map();
function rx(src) {
  if (!_reCache.has(src)) { try { _reCache.set(src, new RegExp(src)); } catch { _reCache.set(src, null); } }
  return _reCache.get(src);
}

// 單一景點的主題 key
export function themeForSpot(spot, themes = _themes) {
  if (!spot || !themes) return 'journey';
  const map = themes.map || {};
  const name = spot.name || spot.nameLocal || '';

  for (const [src, key] of map.byName || []) {
    const re = rx(src);
    if (re && re.test(name)) return key;
  }
  const cand = [spot.primary, ...(spot.tags || [])].filter(Boolean);
  for (const t of cand) if (map.byTag && map.byTag[t]) return map.byTag[t];
  if (spot.inferredType && map.byType && map.byType[spot.inferredType]) return map.byType[spot.inferredType];
  return map.default || 'journey';
}

// 一天的代表主題：多數決，平手取較「有特色」的（非 journey 優先，再比出現序）
export function themeForDay(spots, themes = _themes) {
  return majorityTheme(spots, themes);
}
export function themeForTrip(spots, themes = _themes) {
  return majorityTheme(spots, themes);
}

function majorityTheme(spots, themes) {
  const list = (spots || []).map((s) => s.theme || themeForSpot(s, themes));
  if (!list.length) return 'journey';
  const count = new Map();
  const firstSeen = new Map();
  list.forEach((k, i) => {
    count.set(k, (count.get(k) || 0) + 1);
    if (!firstSeen.has(k)) firstSeen.set(k, i);
  });
  let best = list[0], bestScore = -Infinity;
  for (const [k, n] of count) {
    // 票數為主；journey 略降權；平手取先出現的
    const score = n - (k === 'journey' ? 0.4 : 0) - firstSeen.get(k) * 0.001;
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}

export function themeMeta(key, themes = _themes) {
  const T = themes && themes.themes;
  return (T && (T[key] || T.journey)) || {
    label: '旅途', emoji: '🧳', voice: 'journey',
    poster: { paper: '#f6efe0', ink: '#4a3f33', sub: '#7d6f5c', line: '#c9b8a0', accent: '#5b8a72', accent2: '#c98a5b', band: '#e8dcc6', blobColors: ['#8fb59c', '#e0b07a', '#a7c4d6'], bunting: ['#e0b07a', '#8fb59c', '#a7c4d6'], polaroidTint: 'rgba(246,239,224,0)', tilt: 6 },
    deco: ['sprig', 'cloud', 'house'], timeline: 'dot',
  };
}

// 沒有示意圖時的佔位圖：用該主題的顏色畫一張簡單插畫。
// 純本機的 data URI —— 不用網路、不占 IndexedDB，離線一樣有。
// 目的不是假裝有照片，而是不要留一塊空白，讓版面看起來像有設計過。
export function themePlaceholder(key, seed = '', { dark = true } = {}) {
  const p = themeMeta(key).poster || {};
  const blobs = (p.blobColors && p.blobColors.length ? p.blobColors : [p.accent, p.accent2, p.band]).filter(Boolean);
  const c = (i) => blobs[i % blobs.length] || '#8fb59c';

  // 用名稱雜湊出一點變化，不同景點的佔位圖不會長得一模一樣
  let n = 0;
  for (const ch of String(seed)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const r = (i, lo, hi) => lo + ((n >> (i * 3)) % 1000) / 1000 * (hi - lo);
  const f = (i, lo, hi) => r(i, lo, hi).toFixed(0);

  // App 是深色的，佔位圖也走深色，不然一片亮色卡在深色清單裡很刺眼
  const base = dark ? '#1b2942' : (p.paper || '#f6efe0');
  const o = dark ? [0.62, 0.5, 0.42, 0.46, 0.32] : [0.55, 0.45, 0.4, 0.75, 0.35];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">
<rect width="400" height="240" fill="${base}"/>
<circle cx="${f(0, 40, 150)}" cy="${f(1, 40, 120)}" r="${f(2, 60, 100)}" fill="${c(0)}" opacity="${o[0]}"/>
<circle cx="${f(3, 250, 370)}" cy="${f(4, 60, 150)}" r="${f(5, 50, 90)}" fill="${c(1)}" opacity="${o[1]}"/>
<circle cx="${f(6, 150, 280)}" cy="${f(7, 150, 220)}" r="${f(0, 45, 80)}" fill="${c(2)}" opacity="${o[2]}"/>
<path d="M0 ${f(1, 150, 190)} Q 100 ${f(2, 130, 175)} 200 ${f(3, 155, 190)} T 400 ${f(4, 150, 185)} V240 H0 Z" fill="${p.band || '#e8dcc6'}" opacity="${o[3]}"/>
<path d="M0 ${f(5, 195, 215)} Q 120 ${f(6, 180, 210)} 240 ${f(7, 195, 215)} T 400 ${f(0, 190, 212)} V240 H0 Z" fill="${p.accent || '#5b8a72'}" opacity="${o[4]}"/>
</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/\n\s*/g, ''));
}

// 給行程頁 / 小標籤用
export function themeLabel(key, themes = _themes) {
  const m = themeMeta(key, themes);
  return `${m.emoji} ${m.label}`;
}
export function themeAccent(key, themes = _themes) {
  return themeMeta(key, themes).poster.accent;
}
