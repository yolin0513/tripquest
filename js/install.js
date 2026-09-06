// 「把 App 加到主畫面」的偵測與引導。
//
// 為什麼這件事這麼重要（實測與 Apple 官方說法都確認過）：
//
//   iPhone 的主畫面 App 與 Safari **儲存空間是分開的**。Apple 在 WWDC23
//   〈What's new in web apps〉講得很直白：「Home Screen web apps have a
//   standalone, app-like experience on iOS, with separate cookies and storage
//   from the browser.」所以在 Safari 裡加入旅程（資料寫進 Safari 的 IndexedDB）
//   之後再把網頁加到主畫面，從主畫面打開時是另一個儲存區 —— 旅程當然不見了。
//
//   而且主畫面圖示打開的是 manifest 的 start_url（我們是 './'），不是當初那個
//   帶邀請碼的網址，所以連「重新加入一次」的機會都沒有。
//
//   Android 相反：WebAPK 跑在同一個 Chrome profile，儲存空間是共用的，
//   所以在瀏覽器加入之後裝起來，旅程還在。這也是為什麼這個問題只在 iPhone 上發生。
//
// 「每張邀請一份動態 manifest」這條路走不通，實測結論：
//   · 執行期換掉 <link rel="manifest"> 的 href，Chrome **會**重新讀（同源可行）
//   · 但 blob: 與 data: 都被本站的 CSP 擋掉 —— default-src 'self' 會當成
//     manifest-src 的 fallback，Chrome 訊息明講這件事
//   · GitHub Pages 是靜態的，產不出每張邀請專屬的同源 manifest
//   所以改走「引導在前、貼上補救在後」，見 views/join.js 與 views/home.js。

const KEY = 'tripquest.installGuide';

export function isStandalone() {
  try {
    if (window.navigator.standalone === true) return true;          // iOS
    return ['standalone', 'fullscreen', 'minimal-ui']
      .some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
  } catch { return false; }
}

// 回傳 { os, browser, inApp, canInstall }
export function platform() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ 的 Safari 會自稱 Macintosh，要靠觸控點數認出來
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  const os = (/iPad|iPhone|iPod/.test(ua) || iPadOS) ? 'ios' : (/Android/.test(ua) ? 'android' : 'other');

  // App 內建瀏覽器（LINE、FB、IG…）多半**不能**加到主畫面 —— 台灣的長輩
  // 十之八九是從 LINE 點連結進來的，不認出這一種，教學會教到完全做不到的動作。
  let inApp = '';
  if (/\bLine\//i.test(ua)) inApp = 'LINE';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) inApp = 'Facebook';
  else if (/Instagram/i.test(ua)) inApp = 'Instagram';
  else if (/MicroMessenger/i.test(ua)) inApp = '微信';
  else if (os === 'ios' && !/Safari/.test(ua)) inApp = '其他 App';

  let browser = 'other';
  if (os === 'ios') {
    if (/CriOS/.test(ua)) browser = 'chrome';
    else if (/FxiOS/.test(ua)) browser = 'firefox';
    else if (/EdgiOS/.test(ua)) browser = 'edge';
    else if (!inApp) browser = 'safari';
  } else if (os === 'android') {
    browser = /Chrome/.test(ua) ? 'chrome' : 'other';
  }
  // iOS 只有 Safari 能加到主畫面；Chrome / Firefox / Edge on iOS 都不行
  // （它們的 UA 裡也有 "Safari/604.1"，不能只用那個字串判斷）
  const canInstall = os === 'ios' ? (browser === 'safari' && !inApp) : !inApp;

  // 給引導畫面用的稱呼：「你現在是用 XXX 在看」
  const NAMES = { chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge', safari: 'Safari' };
  const label = inApp || NAMES[browser] || '這個瀏覽器';
  return { os, browser, inApp, canInstall, label };
}

// ---- Android：接住系統的安裝事件 ----
let deferred = null;
let installed = false;
const listeners = new Set();
const fire = () => listeners.forEach((f) => { try { f(); } catch { /* noop */ } });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // 不讓 Chrome 用自己的小橫幅，我們要用大按鈕
  deferred = e;
  fire();
});
window.addEventListener('appinstalled', () => { installed = true; deferred = null; fire(); });

export function canPromptInstall() { return !!deferred; }
export function onInstallState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function wasInstalled() { return installed; }

// 回傳 'accepted' | 'dismissed' | null（沒有可用的事件）
export async function promptInstall() {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    fire();
    return outcome;
  } catch { fire(); return null; }
}

// ---- 「不要再提醒我」----
export function guideDismissed() {
  try { return localStorage.getItem(KEY) === 'off'; } catch { return false; }
}
export function dismissGuide() {
  try { localStorage.setItem(KEY, 'off'); } catch { /* noop */ }
}
export function resetGuide() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

// 要不要主動跳引導：已經是 App 了、或使用者說過不要，就別煩他
export function shouldOfferInstall() {
  return !isStandalone() && !guideDismissed() && !installed;
}

// ---- 圖示（畫出來，不依賴外部圖檔）----
function shareIcon(size = 30) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M12 3l4 4-1.4 1.4L13 6.8V15h-2V6.8L9.4 8.4 8 7l4-4z" fill="currentColor"/>'
    + '<path d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8h-2v8H7v-8H5z" fill="currentColor"/>';
  return svg;
}
function dotsIcon(size = 26) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/>';
  return svg;
}
function plusBoxIcon(size = 26) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return svg;
}
export const ICONS = { shareIcon, dotsIcon, plusBoxIcon };
