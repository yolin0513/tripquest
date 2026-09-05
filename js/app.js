// 進入點：註冊 SW、初始化 store、掛路由、管理頂列

import { route, setNotFound, startRouter, navigate, currentRoute, back, resetHistory } from './router.js';
import * as store from './store.js';
import { mount, h, toast } from './ui.js';
import { apply as applyPrefs } from './prefs.js';
import { initIdentity } from './identity.js';

const view = document.getElementById('view');
const backBtn = document.getElementById('backBtn');
const topTitle = document.getElementById('topTitle');
const topActionBtn = document.getElementById('topActionBtn');

let _action = null;
backBtn.addEventListener('click', () => {
  const r = currentRoute();
  // 「主畫面」（旅程首頁、照片牆 / 分帳 / 回顧分頁、設定）按返回 → 一步跳回「我的旅程」；
  // 其他都是小功能頁（景點、任務、海報、天氣、回顧影片、求助…），返回 = 回上一個實際畫面。
  if (r && isMainScreen(r.path)) { resetHistory('/'); return; }
  back(fallbackFor(r));
});

function isMainScreen(p) {
  if (p === '/' || p === '/settings') return true;
  if (/^\/trip\/[^/]+$/.test(p)) return true;                       // 旅程首頁（任務清單）
  if (/^\/trip\/[^/]+\/(people|expenses|memories)$/.test(p)) return true;  // 底部分頁
  return false;
}
topActionBtn.addEventListener('click', () => { if (_action) _action.onClick(); });

// 緊急求助浮動鈕：任何畫面都能一鍵進入（在 SOS 畫面本身則隱藏）
const sosFab = document.getElementById('sosFab');
if (sosFab) {
  sosFab.addEventListener('click', () => {
    const r = currentRoute();
    const m = r && r.path.match(/^\/trip\/([^/]+)/);
    navigate(m ? `/trip/${m[1]}/sos` : '/sos');
  });
  const syncFab = () => {
    const p = (location.hash.replace(/^#/, '') || '/').split('?')[0];
    sosFab.hidden = /\/sos$/.test(p);
  };
  window.addEventListener('hashchange', syncFab);
  syncFab();
}

// 只有「直接深連結進來、沒有可退歷史」時才會用到：退去合理的上一層
function fallbackFor(r) {
  if (!r) return '/';
  const p = r.path;
  if (p.startsWith('/quest/')) {
    const q = store.getRaw(r.params.id);
    return q ? `/trip/${q.tripId}` : '/';
  }
  const m = p.match(/^\/trip\/([^/]+)\//);
  if (m) return `/trip/${m[1]}`;
  return '/';
}

export function setTop({ title, back = true, action = null }) {
  topTitle.textContent = title || 'TripQuest';
  document.title = title ? `${title}｜TripQuest` : 'TripQuest 旅圖任務';
  backBtn.hidden = !back;
  _action = action;
  if (action) {
    topActionBtn.hidden = false;
    topActionBtn.textContent = action.icon || '＋';
    topActionBtn.setAttribute('aria-label', action.label || '');
  } else {
    topActionBtn.hidden = true;
  }
}

export function render(node) {
  mount(view, node);
}
export function renderLoading() {
  mount(view, h('div', { class: 'center-fill' }, h('div', { class: 'spinner' })));
}

// ---- 底部功能列（依所在位置切換：首頁層 vs 旅程層）----
const tabbar = document.getElementById('tabbar');

function currentPath() { return (location.hash.replace(/^#/, '') || '/').split('?')[0]; }

function tripIdOfPath(p) {
  let m = p.match(/^\/trip\/([^/]+)/);
  if (m) return m[1];
  m = p.match(/^\/quest\/([^/]+)/);
  if (m) { const q = store.getRaw(m[1]); return q ? q.tripId : null; }
  return null;
}

function tabItem(icon, label, href, active) {
  return h('a', { class: 'tab' + (active ? ' active' : ''), href: '#' + href },
    h('span', { class: 'ti' }, icon), h('span', {}, label));
}

function renderTabs() {
  if (!tabbar) return;
  const p = currentPath();
  const tid = tripIdOfPath(p);

  if (tid && store.get(tid)) {
    const base = `/trip/${tid}`;
    const isTasks = p === base || /^\/trip\/[^/]+\/(plan|poster|weather|spot)/.test(p) || p.startsWith('/quest/');
    const isPhotos = p === `${base}/people`;
    const isSplit = p === `${base}/expenses`;
    const isMem = /^\/trip\/[^/]+\/(memories|album|badges|recap)$/.test(p);
    mount(tabbar,
      tabItem('📋', '任務', base, isTasks),
      tabItem('📸', '照片', `${base}/people`, isPhotos),
      tabItem('💰', '分帳', `${base}/expenses`, isSplit),
      tabItem('🎁', '回顧', `${base}/memories`, isMem),
    );
  } else {
    mount(tabbar,
      tabItem('🗺️', '我的旅程', '/', p === '/' || p === '/new' || p === '/join'),
      tabItem('⚙️', '設定', '/settings', p === '/settings'),
    );
  }
}
window.addEventListener('hashchange', renderTabs);

// ---- 路由表 ----
route('/', async () => (await import('./views/home.js')).default());
route('/new', async () => (await import('./views/create.js')).default());
route('/join', async ({ query }) => (await import('./views/join.js')).default(query));
// fresh 只有「真的導覽到這一頁」時才是 true —— 頁面內部自己重繪（補完景點圖、AI 文案
// 回來）不算，不然畫面會在使用者看到一半時又自己捲一次。
route('/trip/:id', async ({ params, fresh }) => (await import('./views/trip.js')).default(params.id, { fresh }));
route('/trip/:id/settings', async ({ params }) => (await import('./views/trip.js')).settings(params.id));
route('/trip/:id/people', async ({ params }) => (await import('./views/people.js')).default(params.id));
route('/trip/:id/album', async ({ params }) => (await import('./views/album.js')).default(params.id));
route('/trip/:id/poster', async ({ params }) => (await import('./views/poster.js')).default(params.id));
route('/trip/:id/plan', async ({ params }) => (await import('./views/plan.js')).default(params.id));
route('/trip/:id/sos', async ({ params }) => (await import('./views/sos.js')).default(params.id));
route('/sos', async () => (await import('./views/sos.js')).default(null));
route('/trip/:id/weather', async ({ params }) => (await import('./views/weather.js')).default(params.id));
route('/trip/:id/expenses', async ({ params }) => (await import('./views/expenses.js')).default(params.id));
route('/trip/:id/badges', async ({ params }) => (await import('./views/badges.js')).default(params.id));
route('/trip/:id/recap', async ({ params }) => (await import('./views/recap.js')).default(params.id));
route('/trip/:id/memories', async ({ params }) => (await import('./views/memories.js')).default(params.id));
route('/trip/:id/spot/:spotId', async ({ params }) => (await import('./views/spot.js')).default(params.id, params.spotId));
route('/quest/:id', async ({ params }) => (await import('./views/quest.js')).default(params.id));
route('/settings', async () => (await import('./views/settings.js')).default());
setNotFound(() => { navigate('/', { replace: true }); });

// ---- 啟動 ----
(async function boot() {
  applyPrefs();
  renderLoading();
  await store.init();
  await initIdentity();       // 讓裝置身分與 localStorage / IndexedDB 一致
  startRouter();
  renderTabs();

  // 離線同步佇列：網路一好就自動補傳 / 補收
  import('./outbox.js').then((o) => o.startAutoDrain()).catch(() => {});

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw && nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('已更新，下次開啟生效');
            }
          });
        });
      }).catch(() => {});
    });
  }
})();
