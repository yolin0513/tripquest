// 成就徽章牆 —— 每個人各自的徽章，已達成上色、未達成灰底加提示。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue, uuid } from '../ids.js';
import { avatar } from '../ui.js';
import { BADGES, earnedBadges, statsFor } from '../badges.js';
import { activeMemberId } from '../claim.js';

export default async function badges(tripId) {
  const trip = store.get(tripId);
  if (!trip) { navigate('/', { replace: true }); return; }
  setTop({ title: '成就徽章' });

  const members = store.membersOf(trip.groupId);
  if (!members.length) { render(h('div', { class: 'empty' }, h('p', {}, '先加旅伴。'))); return; }

  let who = activeMemberId(tripId) || members[0].id;

  const page = h('div', { class: 'page' });
  render(page);

  const draw = () => {
    const earned = earnedBadges(tripId, who);
    const earnedIds = new Set(earned.map((b) => b.id));
    const s = statsFor(tripId, who);
    const member = members.find((m) => m.id === who);

    page.replaceChildren(
      // 成員切換
      members.length > 1
        ? h('div', { class: 'badge-who' }, ...members.map((m) =>
            h('button', {
              class: 'badge-who-btn' + (m.id === who ? ' on' : ''),
              onclick: () => { who = m.id; draw(); },
            }, avatar(m.displayName, hashHue(m.id)), h('span', {}, m.displayName))))
        : null,

      h('div', { class: 'badge-count' }, `${member?.displayName || ''}　已解鎖 ${earned.length} / ${BADGES.length}`),

      // 這趟小統計
      h('div', { class: 'badge-stats' },
        stat('完成任務', s.doneCount),
        stat('幫別人拍', s.forOthersCount),
        stat('入鏡照片', s.inPhotosCount),
        stat('按讚留言', s.socialCount),
      ),

      h('div', { class: 'badge-grid' }, ...BADGES.map((b) => {
        const got = earnedIds.has(b.id);
        return h('div', { class: 'badge-card' + (got ? ' got' : '') },
          h('div', { class: 'badge-emoji' }, got ? b.emoji : '🔒'),
          h('div', { class: 'badge-name' }, b.name),
          h('div', { class: 'badge-desc' }, b.desc),
        );
      })),

      h('p', { class: 'form-hint' }, '徽章依實際拍照、代拍、互動自動解鎖，達成時會跳出慶祝。'),
    );
  };
  draw();
}

function stat(label, n) {
  return h('div', { class: 'badge-stat' }, h('b', {}, String(n)), h('span', {}, label));
}

void uuid;
