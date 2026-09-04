// 行程最終回顧 —— 把整趟的數字整理成一份可留念的成果。

import * as store from './store.js';
import { haversine } from './geo.js';
import { creditOf, earnedBadges, BADGES } from './badges.js';
import { KIND_META } from './ui.js';

function retracted() {
  const s = new Set();
  for (const r of store.exportRecords()) if (r.type === 'retraction') s.add(r.submissionId);
  return s;
}

export async function buildRecap(tripId) {
  const trip = store.get(tripId);
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(trip.groupId);
  const quests = store.questsOfTrip(tripId);
  const gone = retracted();
  const subs = store.exportRecords().filter((r) => r.type === 'submission' && r.tripId === tripId && !gone.has(r.id));
  const reactions = store.exportRecords().filter((r) => r.type === 'reaction' && r.tripId === tripId);
  const comments = store.exportRecords().filter((r) => r.type === 'comment' && r.tripId === tripId);

  // 路線距離（依 day/order 連線）
  let distM = 0;
  const withCoord = spots.filter((s) => s.lat != null && s.lng != null);
  for (let i = 1; i < withCoord.length; i++) {
    distM += haversine(
      { lat: withCoord[i - 1].lat, lng: withCoord[i - 1].lng },
      { lat: withCoord[i].lat, lng: withCoord[i].lng });
  }

  // 完成 / 進度
  const questDone = new Map();
  for (const s of subs) {
    if (!questDone.has(s.questId)) questDone.set(s.questId, new Set());
    if (creditOf(s)) questDone.get(s.questId).add(creditOf(s));
  }
  const doneCount = quests.filter((q) => (questDone.get(q.id)?.size || 0) > 0).length;

  // 美食清單：優先「必吃」項（那是實際菜名），不夠再補完成的美食類任務
  const doneFood = quests.filter((q) => q.kind === 'food' && (questDone.get(q.id)?.size || 0) > 0);
  const mustFoods = doneFood.filter((q) => q.source === 'must');
  const foodPick = (mustFoods.length ? mustFoods : doneFood);
  const foods = foodPick.map((q) => {
    const spot = store.getRaw(q.spotId);
    const sub = subs.find((s) => s.questId === q.id);
    return { title: q.title.replace(/^必吃：|^必嚐：/, ''), spot: spot?.name || '', thumbHash: sub?.thumbHash || sub?.photoHash || null };
  });

  // 每個人
  const perMember = members.map((m) => {
    const credited = new Set(subs.filter((s) => creditOf(s) === m.id).map((s) => s.questId));
    const shot = subs.filter((s) => s.memberId === m.id);
    return {
      id: m.id, name: m.displayName,
      done: credited.size,
      shot: shot.length,
      helped: shot.filter((s) => s.forMemberId && s.forMemberId !== m.id).length,
      inPhotos: subs.filter((s) => Array.isArray(s.subjectIds) && s.subjectIds.includes(m.id)).length,
      social: [...reactions, ...comments].filter((r) => r.actorId === m.id).length,
      badges: earnedBadges(tripId, m.id).length,
    };
  });

  // 待最久 / 最多照片的地方
  const spotPhotoCount = {};
  for (const s of subs) {
    const q = store.getRaw(s.questId);
    if (q) spotPhotoCount[q.spotId] = (spotPhotoCount[q.spotId] || 0) + 1;
  }
  let topSpot = null, topN = 0;
  for (const [sid, n] of Object.entries(spotPhotoCount)) if (n > topN) { topN = n; topSpot = store.getRaw(sid); }

  let longestSpot = null, longestMin = 0;
  for (const s of spots) {
    if (s.startTime && s.endTime) {
      const [h1, m1] = s.startTime.split(':').map(Number);
      const [h2, m2] = s.endTime.split(':').map(Number);
      const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins > longestMin) { longestMin = mins; longestSpot = s; }
    }
  }

  // 天氣（過去 → archive；未來/進行中 → forecast）
  let weather = null;
  const coord = withCoord.length
    ? { lat: +(withCoord.reduce((a, s) => a + s.lat, 0) / withCoord.length).toFixed(3),
        lng: +(withCoord.reduce((a, s) => a + s.lng, 0) / withCoord.length).toFixed(3) }
    : null;
  if (coord && trip.startDate) {
    weather = await tripWeather(coord, trip.startDate, trip.endDate || trip.startDate).catch(() => null);
  }

  // 這趟的徽章（全員合計不重複）
  const badgeIds = new Set();
  for (const m of members) for (const b of earnedBadges(tripId, m.id)) badgeIds.add(b.id);
  const tripBadges = BADGES.filter((b) => badgeIds.has(b.id));

  return {
    title: trip.title || '我們的旅程',
    dateRange: [trip.startDate, trip.endDate].filter(Boolean).join(' – '),
    dayCount: new Set(spots.map((s) => s.day || 1)).size || 1,
    spotCount: spots.length,
    questTotal: quests.length,
    doneCount,
    photoCount: subs.length,
    people: members.length,
    distanceKm: Math.round(distM / 100) / 10,
    interactions: reactions.length + comments.length,
    reactions: reactions.length,
    comments: comments.length,
    foods,
    perMember,
    topSpot: topSpot ? { name: topSpot.name, photos: topN } : null,
    longestSpot: longestSpot ? { name: longestSpot.name, mins: longestMin } : null,
    weather,
    tripBadges: tripBadges.map((b) => ({ emoji: b.emoji, name: b.name })),
    region: trip.region || '',
  };
}

async function tripWeather(coord, start, end) {
  const past = new Date(end) < new Date(Date.now() - 86400000);
  const base = past ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const u = new URL(base);
  u.searchParams.set('latitude', coord.lat);
  u.searchParams.set('longitude', coord.lng);
  u.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum');
  u.searchParams.set('timezone', 'auto');
  if (past) { u.searchParams.set('start_date', start); u.searchParams.set('end_date', end); }
  else { u.searchParams.set('forecast_days', '16'); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try { res = await fetch(u, { signal: ctrl.signal }); } finally { clearTimeout(timer); }
  if (!res.ok) return null;
  const d = await res.json();
  const dl = d.daily || {};
  const times = dl.time || [];
  const idx = times.map((t, i) => i).filter((i) => times[i] >= start && times[i] <= end);
  if (!idx.length) return null;
  const maxes = idx.map((i) => dl.temperature_2m_max[i]).filter((x) => x != null);
  const mins = idx.map((i) => dl.temperature_2m_min[i]).filter((x) => x != null);
  const rain = idx.map((i) => dl.precipitation_sum[i] || 0);
  const rainyDays = rain.filter((r) => r >= 1).length;
  return {
    hi: Math.round(Math.max(...maxes)),
    lo: Math.round(Math.min(...mins)),
    rainyDays,
    days: idx.length,
  };
}

export { KIND_META };
