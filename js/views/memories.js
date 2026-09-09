// 回顧與成就 —— 回憶影片 / 成就徽章 / 最終回顧 的入口頁（底部「回顧」分頁）。
// 旅程進行中：成就可以先看，影片與最終回顧等全部完成或旅程結束後才開放。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { earnedBadges, BADGES, creditOf, shooterOf, subjectsOf, helpedOthers } from '../badges.js';
import { avatar } from '../ui.js';
import { hashHue } from '../ids.js';
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

    // 大家的進度（v1.57.2 從照片頁移來 —— 進度屬於「回顧」的語意，照片頁只留照片）。
    // 放在頂端說明之後、徽章之前：先看整體與每個人做了多少，再往下是徽章與成果。
    teamProgress(tripId, t),

    // 成就徽章 —— 隨時可看
    bigCard('🏅', '成就徽章', me ? `你已解鎖 ${myBadges} / ${BADGES.length} 個` : '看看大家的徽章',
      () => navigate(`/trip/${tripId}/badges`), true),

    // 回憶影片
    bigCard('🎬', '回憶影片與相簿',
      ready ? '做成短片，或產生一個給家人看的相簿網址' : `還差 ${prog.total - prog.done} 個任務就能做`,
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

// 每個人的進度（歸屬一律走照片標記，改標記後回到這頁就是新數字）。
// 零成員或還沒有任務就不畫 —— 頂端的 hero 已經講了整體狀態，不用再空一塊。
function teamProgress(tripId, t) {
  const members = store.membersOf(t.groupId);
  const prog = store.tripProgress(tripId);
  if (!members.length || !prog.total) return null;
  const allSubs = store.submissionsOfTrip(tripId);
  const wrap = h('div', { class: 'team-progress' },
    h('div', { class: 'section-label' }, `👣 大家一起完成了 ${prog.done} / ${prog.total}`));
  for (const m of members) {
    const credited = new Set(allSubs.filter((s) => creditOf(s) === m.id).map((s) => s.questId));
    const shot = allSubs.filter((s) => shooterOf(s) === m.id);
    const forOthers = shot.filter((s) => helpedOthers(s, m.id)).length;
    const inPhotos = allSubs.filter((s) => subjectsOf(s).includes(m.id)).length;
    const ratio = prog.total ? credited.size / prog.total : 0;
    const bCount = earnedBadges(tripId, m.id).length;
    wrap.append(h('div', { class: 'people-row' },
      avatar(m.displayName, hashHue(m.id)),
      h('div', { class: 'pr-main' },
        h('div', { class: 'pr-name' }, m.displayName, bCount ? h('span', { class: 'pr-badges' }, `🏅${bCount}`) : null),
        h('div', { class: 'pr-count' },
          `完成 ${credited.size} 個任務 · 拍 ${shot.length} 張`
          + (forOthers ? ` · 幫拍 ${forOthers}` : '')
          + (inPhotos ? ` · 入鏡 ${inPhotos}` : '')),
        h('div', { class: 'pr-mini-track' }, h('i', { style: `width:${Math.round(ratio * 100)}%` })),
      ),
    ));
  }
  return wrap;
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
