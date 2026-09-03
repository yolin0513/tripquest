import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, fmtDate, avatar } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';

export default function home() {
  setTop({ title: 'TripQuest', back: false });
  const trips = store.trips();

  const list = trips.length
    ? h('div', { class: 'stack' }, ...trips.map(tripCard))
    : emptyState();

  render(h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '把每趟旅行變成一場拍照任務'),
      h('p', { class: 'muted' }, '共建行程 → 系統出題 → 蒐集照片 → 全部解鎖做成回憶影片'),
    ),
    list,
    h('button', { class: 'btn btn-primary btn-block', onclick: () => navigate('/new') }, '＋ 建立新行程'),
    h('button', {
      class: 'btn btn-ghost btn-block',
      onclick: () => navigate('/settings'),
    }, '用任務代碼加入朋友的行程'),
  ));
}

function tripCard(trip) {
  const p = store.tripProgress(trip.id);
  const members = store.membersOf(trip.groupId);
  const spots = store.spotsOf(trip.id);
  return h('button', {
    class: 'card trip-card', onclick: () => navigate(`/trip/${trip.id}`),
  },
    h('div', { class: 'trip-card-main' },
      h('div', { class: 'trip-card-title' }, trip.title || '未命名行程'),
      h('div', { class: 'muted sm' },
        [trip.region, spots.length ? `${spots.length} 個景點` : null,
         (trip.startDate ? `${fmtDate(trip.startDate)}${trip.endDate ? '–' + fmtDate(trip.endDate) : ''}` : null)]
          .filter(Boolean).join(' · ')),
      members.length ? h('div', { class: 'avatars' }, ...members.slice(0, 5).map((m) => avatar(m.displayName, hashHue(m.id)))) : null,
    ),
    ring(p.ratio, { size: 52, label: `${p.done}/${p.total}` }),
  );
}

function emptyState() {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-emoji' }, '🧳'),
    h('p', {}, '還沒有行程'),
    h('p', { class: 'muted sm' }, '建立一個，把出遊清單貼進來就會自動出任務'),
  );
}
