// 邀請摘要：從一個群組的全部記錄現算「點連結的人連線前想知道的事」。
// Worker（workers/worker.mjs）與 LAN server（server/index.mjs）共用——跟 merge.js
// 一樣「多處同一份」的原則；純函式、無 IO。祕鑰驗證在呼叫端做。
// 只回「加入之後本來就會看到」的欄位，不多不少。
export function inviteSummary(records, tripPrefix = '') {
  const live = (records || []).filter((r) => r && !r.deleted);
  const trips = live.filter((r) => r.type === 'trip');
  if (!trips.length) return null;                     // 資料還沒推上來：呼叫端回 404，客戶端會退避重試
  const pfx = String(tripPrefix || '').slice(0, 8);
  const trip = (pfx && trips.find((t) => String(t.id).startsWith(pfx)))
    || trips.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  const spots = live.filter((r) => r.type === 'spot' && r.tripId === trip.id)
    .sort((a, b) => (a.day || 1) - (b.day || 1) || (a.order || 0) - (b.order || 0));
  const quests = live.filter((r) => r.type === 'quest' && r.tripId === trip.id);
  const members = live.filter((r) => r.type === 'member');
  const grp = live.find((r) => r.type === 'group');
  return {
    tripId: trip.id,
    title: trip.title || '行程',
    groupName: (grp && grp.name) || '旅伴',
    dates: [trip.startDate || '', trip.endDate || ''],
    spots: spots.length, quests: quests.length, members: members.length,
    who: members.slice(0, 4).map((m) => m.displayName).filter(Boolean),
    preview: spots.slice(0, 12).map((s) => ({ n: s.name, d: s.day || 1 })),
  };
}
