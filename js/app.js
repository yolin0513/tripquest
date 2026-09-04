// 進入點：註冊 SW、初始化 store、掛路由、管理頂列

import { route, setNotFound, startRouter, navigate, currentRoute } from './router.js';
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
  const fb = r?.query?.from || backTargetFor(r);
  navigate(fb);
});
topActionBtn.addEventListener('click', () => { if (_action) _action.onClick(); });

function backTargetFor(r) {
  if (!r) return '/';
  const p = r.path;
  if (p.startsWith('/quest/')) {
    const q = store.getRaw(r.params.id);
    return q ? `/trip/${q.tripId}/spot/${q.spotId}` : '/';
  }
  const m = p.match(/^\/trip\/([^/]+)\/spot\//);
  if (m) return `/trip/${m[1]}`;
  if (p.startsWith('/trip/')) return '/';
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

function syncTabs() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const active = path === '/settings' ? 'settings' : 'home';
  document.querySelectorAll('#tabbar .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === active);
  });
}
window.addEventListener('hashchange', syncTabs);

// ---- 路由表 ----
route('/', async () => (await import('./views/home.js')).default());
route('/new', async () => (await import('./views/create.js')).default());
route('/join', async ({ query }) => (await import('./views/join.js')).default(query));
route('/trip/:id', async ({ params }) => (await import('./views/trip.js')).default(params.id));
route('/trip/:id/settings', async ({ params }) => (await import('./views/trip.js')).settings(params.id));
route('/trip/:id/people', async ({ params }) => (await import('./views/people.js')).default(params.id));
route('/trip/:id/album', async ({ params }) => (await import('./views/album.js')).default(params.id));
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
  syncTabs();

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
