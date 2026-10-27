// 顯示偏好：字級、對比。存 localStorage，套在 <html> 上。
// 長輩友善的核心之一——字可以調大、對比可以拉高。

const KEY = 'tripquest.prefs';
const DEFAULTS = { fs: 'm', contrast: 'normal', theme: 'dark', reduceMotion: false, autoScroll: true, keepOriginal: false };
// 和紙主題的底色；網址列／狀態列的顏色（theme-color）要跟著換，不然上面一條深藍。
const THEME_BG = { dark: '#0f1523', washi: '#fffcf6' };

let prefs = load();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 無痕模式 */ }
}

export function getPrefs() { return { ...prefs }; }

export function setPref(k, v) {
  prefs[k] = v;
  save();
  apply();
}

export function apply() {
  const el = document.documentElement;
  el.dataset.fs = prefs.fs === 'm' ? '' : prefs.fs;
  if (!prefs.fs || prefs.fs === 'm') delete el.dataset.fs;
  el.dataset.contrast = prefs.contrast === 'high' ? 'high' : '';
  if (prefs.contrast !== 'high') delete el.dataset.contrast;
  const washi = prefs.theme === 'washi';
  if (washi) el.dataset.theme = 'washi'; else delete el.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[washi ? 'washi' : 'dark']);
  el.classList.toggle('reduce-motion', reducesMotion());
}

// 「減少動態效果」：系統設定或設定頁的開關，任一個說要就要。
// 系統那一邊 App 改不了，所以設定頁的開關只能「加上去」，關掉它不會蓋過系統設定。
export function systemReducesMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
export function reducesMotion() { return !!prefs.reduceMotion || systemReducesMotion(); }

// App 開著時系統設定被改：跟著變，不用重開
if (typeof window !== 'undefined') {
  try { window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply); } catch { /* 舊瀏覽器沒有 addEventListener */ }
}

export const FS_LABELS = { m: '標準', l: '大', xl: '特大' };
export const THEME_LABELS = { dark: '深色', washi: '淺色（和紙）' };
