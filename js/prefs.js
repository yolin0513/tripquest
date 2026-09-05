// 顯示偏好：字級、對比。存 localStorage，套在 <html> 上。
// 長輩友善的核心之一——字可以調大、對比可以拉高。

const KEY = 'tripquest.prefs';
const DEFAULTS = { fs: 'm', contrast: 'normal', reduceMotion: false, autoScroll: true };

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
  el.classList.toggle('reduce-motion', !!prefs.reduceMotion ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export const FS_LABELS = { m: '標準', l: '大', xl: '特大' };
