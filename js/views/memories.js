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

  // 使用者是從這一頁進去看影片的 —— 文案的更新也要在這裡就開始跑，
  // 不然他點進相簿才開始產，字卡上還是舊句子。
  // 內容沒變就是純快取查詢，不會打 API、不會花錢（v1.72.1）。
  if (t.aiEnabled) {
    import('../aicontent.js').then(({ warmTripContent }) => warmTripContent(tripId)).catch(() => {});
  }
  setTop({ title: '回顧與成就' });

  const prog = store.tripProgress(tripId);
  const allDone = prog.total > 0 && prog.done === prog.total;
  const ended = tripEnded(t);
  const ready = allDone || ended;

  const me = activeMemberId(tripId) || (store.membersOf(t.groupId)[0] || {}).id;
  const myBadges = me ? earnedBadges(tripId, me).length : 0;

  render(h('div', { class: 'page' },
    // v1.57.3 排版（使用者回饋）：
    //   · 一進來第一畫面就要看到「可以按的成果入口」——長輩不捲動就看不到下面。
    //     順序：影片相簿 → 海報 → 最終回顧（入口都有一致的卡片外觀＋›），
    //     「大家的表現」（資訊區）與徽章往下放。
    //   · 資訊區（大家一起完成了）用平底、無邊框、無箭頭 —— 跟「可按的入口」
    //     視覺上分開，之間有分節標題當分隔。
    h('div', { class: 'hero hero-tight' },
      h('h2', {}, ready ? '這趟的回顧' : '旅程進行中'),
      h('p', { class: 'muted' }, ready
        ? '把照片與數字整理成可以留念、分享的東西。'
        : `完成 ${prog.done} / ${prog.total} 個任務。全部完成或回程日過了，就能做影片與回顧。`),
    ),

    h('div', { class: 'section-label' }, '🎁 留念與分享'),
    bigCard('🎬', '回憶影片與相簿',
      ready ? '做成短片，或產生一個給家人看的相簿網址' : `還差 ${prog.total - prog.done} 個任務就能做`,
      ready ? () => navigate(`/trip/${tripId}/album`) : () => toast(`還有 ${prog.total - prog.done} 個任務`),
      ready),
    bigCard('🎨', '行程海報', '把行程排成一張手繪水彩風的長圖，傳 LINE 或列印',
      () => navigate(`/trip/${tripId}/poster`), true),
    bigCard('🎁', '最終回顧',
      ready ? '走了多遠、吃了哪些、每個人的貢獻…一份成果報告' : '旅程結束後才會有完整數字',
      ready ? () => navigate(`/trip/${tripId}/recap`) : () => toast('旅程結束後再回來看'),
      ready),

    h('div', { class: 'section-label', style: 'margin-top:22px' }, '👣 大家的表現'),
    teamProgress(tripId, t),
    bigCard('🏅', '成就徽章', me ? `你已解鎖 ${myBadges} / ${BADGES.length} 個` : '看看大家的徽章',
      () => navigate(`/trip/${tripId}/badges`), true),
  ));
}

// 每個人的進度（歸屬一律走照片標記，改標記後回到這頁就是新數字）。
// 零成員或還沒有任務就不畫。
function teamProgress(tripId, t) {
  const members = store.membersOf(t.groupId);
  const prog = store.tripProgress(tripId);
  if (!members.length || !prog.total) return null;
  const allSubs = store.submissionsOfTrip(tripId);
  // 資訊區：跟「可按的入口卡」長得明確不一樣（平底、無邊框、無 ›），這裡沒有東西能按
  const wrap = h('div', { class: 'team-progress info-block' },
    h('div', { class: 'ib-head' }, `一起完成了 ${prog.done} / ${prog.total} 個任務`));
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
