// 顯示偏好：字級、主題。存 localStorage，套在 <html> 上。
// 2026-11-12 起拿掉「特大」字級與「高對比模式」（Yolin：放棄長輩那條路，改做年輕人會喜歡的介面）。
// 舊版存過的值照下面 normFs／load 往下對應，不讓任何人打開 App 時畫面壞掉：
//   特大（xl）→ 大（l）：選特大的人要的是大字，給他剩下最大的那一段，不是退回標準
//   contrast（高對比）→ 不再讀、下次存檔時從存的資料裡拿掉
// 這兩條都只動這支手機的顯示偏好，不碰任何行程資料。

const KEY = 'tripquest.prefs';
const DEFAULTS = { fs: 'm', theme: 'dark', reduceMotion: false, autoScroll: true, keepOriginal: false };
// 和紙主題的底色；網址列／狀態列的顏色（theme-color）要跟著換，不然上面一條深藍。
const THEME_BG = { dark: '#0f1523', washi: '#fffcf6' };

export const FS_LABELS = { m: '標準', l: '大' };
const FS_FALLBACK = { xl: 'l' };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function normFs(v) { return own(FS_LABELS, v) ? v : (own(FS_FALLBACK, v) ? FS_FALLBACK[v] : 'm'); }

let prefs = load();

function load() {
  let p;
  try { p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { p = { ...DEFAULTS }; }
  p.fs = normFs(p.fs);
  delete p.contrast;
  return p;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 無痕模式 */ }
}

export function getPrefs() { return { ...prefs }; }

export function setPref(k, v) {
  prefs[k] = k === 'fs' ? normFs(v) : v;
  save();
  apply();
}

export function apply() {
  const el = document.documentElement;
  if (prefs.fs === 'm') delete el.dataset.fs; else el.dataset.fs = prefs.fs;
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

export const THEME_LABELS = { dark: '深色', washi: '淺色（和紙）' };
