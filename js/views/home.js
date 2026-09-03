import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, fmtDate, avatar } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';

export default function home() {
  setTop({ title: 'TripQuest', back: false });
  const trips = store.trips();

  render(h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '把旅行變成拍照任務'),
      h('p', { class: 'muted lg' }, '一起完成、一起回味'),
    ),
    trips.length
      ? h('div', { class: 'stack' }, ...trips.map(tripCard))
      : h('div', { class: 'empty' },
          h('div', { class: 'empty-emoji' }, '🧳'),
          h('p', {}, '還沒有旅程'),
          h('p', { class: 'muted sm' }, '按下面的按鈕開一個'),
        ),
    h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => navigate('/new') }, '＋ 建立新旅程'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => navigate('/settings') }, '用代碼加入旅伴的旅程'),
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
      h('div', { class: 'trip-card-title' }, trip.title || '未命名旅程'),
      h('div', { class: 'muted sm' },
        [trip.region, spots.length ? `${spots.length} 個景點` : null,
         trip.startDate ? `${fmtDate(trip.startDate)}${trip.endDate ? '–' + fmtDate(trip.endDate) : ''}` : null]
          .filter(Boolean).join('　')),
      members.length ? h('div', { class: 'avatars' }, ...members.slice(0, 6).map((m) => avatar(m.displayName, hashHue(m.id)))) : null,
    ),
    ring(p.ratio, { size: 60, label: `${p.done}/${p.total}` }),
  );
}
