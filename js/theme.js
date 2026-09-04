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

// 給行程頁 / 小標籤用
export function themeLabel(key, themes = _themes) {
  const m = themeMeta(key, themes);
  return `${m.emoji} ${m.label}`;
}
export function themeAccent(key, themes = _themes) {
  return themeMeta(key, themes).poster.accent;
}
