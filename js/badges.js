// 成就徽章 —— 依實際行為推導（不落地），新達成時慶祝一次。

import * as store from './store.js';
import * as db from './db.js';
import { myDeviceId } from './identity.js';

// 一張投稿的「完成歸屬」：代拍就算幫的人完成
export function creditOf(sub) { return sub.forMemberId || sub.memberId || null; }

function retractedSet() {
  const s = new Set();
  for (const r of store.exportRecords()) if (r.type === 'retraction') s.add(r.submissionId);
  return s;
}

// 建立某趟旅程 + 某成員的統計脈絡
export function statsFor(tripId, memberId) {
  const trip = store.get(tripId);
  const gone = retractedSet();
  const subs = store.exportRecords().filter((r) => r.type === 'submission' && r.tripId === tripId && !gone.has(r.id));
  const quests = store.questsOfTrip(tripId);
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(trip ? trip.groupId : '');

  const questCredit = new Map(); // questId -> Set(memberId)
  for (const s of subs) {
    const c = creditOf(s);
    if (!c) continue;
    if (!questCredit.has(s.questId)) questCredit.set(s.questId, new Set());
    questCredit.get(s.questId).add(c);
  }
  const doneByMe = quests.filter((q) => questCredit.get(q.id)?.has(memberId));
  const mySubs = subs.filter((s) => s.memberId === memberId);
  const forOthers = mySubs.filter((s) => s.forMemberId && s.forMemberId !== memberId);
  const inPhotos = subs.filter((s) => Array.isArray(s.subjectIds) && s.subjectIds.includes(memberId));

  // 同一天完成數
  const byDay = {};
  for (const q of doneByMe) {
    const s = subs.find((x) => x.questId === q.id && creditOf(x) === memberId);
    const d = new Date(s?.takenAt || s?.createdAt || Date.now()).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const maxInDay = Math.max(0, ...Object.values(byDay));

  const foodQuests = quests.filter((q) => q.kind === 'food');
  const foodDone = foodQuests.filter((q) => questCredit.get(q.id)?.has(memberId));

  const tripProg = store.tripProgress(tripId);
  const socialCount = store.exportRecords().filter((r) =>
    (r.type === 'reaction' || r.type === 'comment') && r.tripId === tripId && r.actorId === memberId).length;

  const day1 = trip && trip.startDate;
  const earlyBird = doneByMe.some((q) => {
    const s = subs.find((x) => x.questId === q.id && creditOf(x) === memberId);
    if (!s || !day1) return false;
    return new Date(s.takenAt || s.createdAt).toISOString().slice(0, 10) === day1;
  });
  const nightOwl = mySubs.some((s) => {
    const hr = new Date(s.takenAt || s.createdAt).getHours();
    return hr >= 19 || hr <= 4;
  });

  // 全員貢獻
  const contributors = new Set();
  for (const set of questCredit.values()) for (const m of set) contributors.add(m);
  const everyoneIn = members.length > 0 && members.every((m) => contributors.has(m.id));

  return {
    trip, members,
    doneCount: doneByMe.length,
    maxInDay,
    foodTotal: foodQuests.length, foodDone: foodDone.length,
    forOthersCount: forOthers.length,
    inPhotosCount: inPhotos.length,
    tripComplete: tripProg.total > 0 && tripProg.done === tripProg.total,
    contributed: doneByMe.length > 0,
    socialCount,
    earlyBird, nightOwl, everyoneIn,
    albumMade: !!(trip && trip.albumMade),
    posterMade: !!(trip && trip.posterMade),
  };
}

// 這台裝置參與過幾趟（有投稿的旅程數）
export function tripsJoinedCount() {
  const dev = myDeviceId();
  const set = new Set();
  for (const r of store.exportRecords()) {
    if (r.type === 'submission' && r.deviceId === dev && r.tripId) set.add(r.tripId);
  }
  return set.size;
}

export const BADGES = [
  { id: 'first', emoji: '🎬', name: '初次登場', desc: '完成第一個拍照任務', check: (s) => s.doneCount >= 1 },
  { id: 'daily3', emoji: '☀️', name: '一日三響', desc: '同一天完成 3 個以上的任務', check: (s) => s.maxInDay >= 3 },
  { id: 'foodie', emoji: '🍜', name: '美食獵人', desc: '完成這趟所有「美食」類任務', check: (s) => s.foodTotal >= 2 && s.foodDone >= s.foodTotal },
  { id: 'helper', emoji: '🎁', name: '神隊友', desc: '幫別人代拍過照片', check: (s) => s.forOthersCount >= 1 },
  { id: 'helper5', emoji: '🤝', name: '最佳攝影師', desc: '幫別人代拍 5 張以上', check: (s) => s.forOthersCount >= 5 },
  { id: 'earlybird', emoji: '🐓', name: '早鳥', desc: '出發第一天就完成任務', check: (s) => s.earlyBird },
  { id: 'nightowl', emoji: '🌙', name: '夜貓子', desc: '拍過晚上（19 點後）的照片', check: (s) => s.nightOwl },
  { id: 'star', emoji: '🌟', name: '眾星拱月', desc: '被標記在 5 張以上的照片裡', check: (s) => s.inPhotosCount >= 5 },
  { id: 'social', emoji: '💬', name: '應援團', desc: '幫旅伴按讚或留言 10 次以上', check: (s) => s.socialCount >= 10 },
  { id: 'everyone', emoji: '👨‍👩‍👧', name: '全家福', desc: '這趟每個人都有貢獻照片', check: (s) => s.everyoneIn },
  { id: 'clear', emoji: '🏆', name: '全員通關', desc: '這趟所有任務都完成了', check: (s) => s.tripComplete && s.contributed },
  { id: 'director', emoji: '🎞️', name: '大導演', desc: '做過這趟的回憶影片', check: (s) => s.albumMade },
  { id: 'poster', emoji: '🎨', name: '海報設計師', desc: '做過這趟的行程海報', check: (s) => s.posterMade },
  { id: 'veteran', emoji: '🧳', name: '旅行常客', desc: '參與過 3 趟以上的旅程', global: true, check: () => tripsJoinedCount() >= 3 },
];

export function earnedBadges(tripId, memberId) {
  const s = statsFor(tripId, memberId);
  return BADGES.filter((b) => { try { return b.check(s); } catch { return false; } });
}

// 新達成的徽章（會記進 meta，下次不再重複慶祝）
export async function newlyEarned(tripId, memberId) {
  if (!memberId) return [];
  const seen = (await db.metaGet('badgesSeen')) || {};
  const earned = earnedBadges(tripId, memberId);
  const fresh = [];
  let changed = false;
  for (const b of earned) {
    const key = b.global ? `g:${b.id}` : `${tripId}:${memberId}:${b.id}`;
    if (!seen[key]) { seen[key] = Date.now(); fresh.push(b); changed = true; }
  }
  if (changed) await db.metaSet('badgesSeen', seen);
  return fresh;
}
