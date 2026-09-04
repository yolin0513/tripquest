// 回顧與成就 —— 回憶影片 / 成就徽章 / 最終回顧 的入口頁（底部「回顧」分頁）。
// 旅程進行中：成就可以先看，影片與最終回顧等全部完成或旅程結束後才開放。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { earnedBadges, BADGES } from '../badges.js';
import { activeMemberId } from '../claim.js';

function tripEnded(t) {
  if (!t.endDate) return false;
  return new Date(t.endDate + 'T23:59:59') < new Date();
}

export default async function memories(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '回顧與成就' });

  const prog = store.tripProgress(tripId);
  const allDone = prog.total > 0 && prog.done === prog.total;
  const ended = tripEnded(t);
  const ready = allDone || ended;

  const me = activeMemberId(tripId) || (store.membersOf(t.groupId)[0] || {}).id;
  const myBadges = me ? earnedBadges(tripId, me).length : 0;

  render(h('div', { class: 'page' },
    h('div', { class: 'hero', style: 'padding-bottom:8px' },
      h('h2', {}, ready ? '這趟的回顧' : '旅程進行中'),
      h('p', { class: 'muted' }, ready
        ? '把這趟的照片與數字整理成可以留念、可以分享的東西。'
        : `目前完成 ${prog.done} / ${prog.total} 個任務。全部完成（或回程日過了）之後，這裡會有回憶影片和最終回顧。`),
    ),

    // 成就徽章 —— 隨時可看
    bigCard('🏅', '成就徽章', me ? `你已解鎖 ${myBadges} / ${BADGES.length} 個` : '看看大家的徽章',
      () => navigate(`/trip/${tripId}/badges`), true),

    // 回憶影片
    bigCard('🎬', '回憶影片',
      ready ? '把照片做成一支有片頭、路線地圖、配樂的短片' : `還差 ${prog.total - prog.done} 個任務就能做`,
      ready ? () => navigate(`/trip/${tripId}/album`) : () => toast(`還有 ${prog.total - prog.done} 個任務`),
      ready),

    // 最終回顧
    bigCard('🎁', '最終回顧',
      ready ? '走了多遠、吃了哪些、每個人的貢獻…整理成一份成果報告' : '旅程結束後才會有完整數字',
      ready ? () => navigate(`/trip/${tripId}/recap`) : () => toast('旅程結束後再回來看'),
      ready),

    // 行程海報（不分階段，屬於「留念」）
    bigCard('🎨', '行程海報', '把行程排成一張手繪水彩風的長圖，傳 LINE 或列印',
      () => navigate(`/trip/${tripId}/poster`), true),
  ));
}

function bigCard(emoji, title, sub, onClick, enabled) {
  return h('button', {
    class: 'mem-card' + (enabled ? '' : ' is-locked'),
    onclick: onClick,
  },
    h('span', { class: 'mem-card-emoji' }, enabled ? emoji : '🔒'),
    h('span', { class: 'mem-card-body' },
      h('span', { class: 'mem-card-title' }, title),
      h('span', { class: 'mem-card-sub' }, sub),
    ),
    h('span', { class: 'mem-card-arrow' }, '›'),
  );
}
