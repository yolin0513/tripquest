// 位置分享的同意畫面（v1.60）——三代理一致要求：開啟前要把五件事講清楚。
// 這不是法律免責文，是長輩看得懂的白話：誰看得到、看到什麼、多久、怎麼關、關了會怎樣。
import { h, modal } from '../ui.js';
import * as store from '../store.js';

export async function askShare(tripId, trip) {
  const members = trip ? store.membersOf(trip.groupId).map((m) => m.displayName).filter(Boolean) : [];
  const range = trip && trip.startDate
    ? (trip.endDate && trip.endDate !== trip.startDate ? `${trip.startDate} ～ ${trip.endDate}` : trip.startDate)
    : '這趟旅程期間';
  const ok = await modal({
    title: '📍 讓家人看到我在哪',
    body: h('div', { class: 'pc' },
      h('p', { class: 'pc-lead' }, '走失的時候，家人可以看到你最後在哪裡。開之前先講清楚五件事：'),
      row('誰看得到', members.length ? members.join('、') + '（拿到這趟旅程邀請連結的人）' : '拿到這趟旅程邀請連結的人'),
      row('看得到什麼', '你最後一次打開 App 時的位置與時間（大約十公尺內），不是你走過的路線'),
      row('多久', `只有 ${range}，之後自動停止；伺服器上的位置最多留兩天就會自己刪掉`),
      row('怎麼關', '隨時可以關：這一頁的開關，或緊急求助頁的「停止分享我的位置」'),
      row('關了會怎樣', '立刻停止上傳，伺服器上你的位置馬上刪除；家人的手機下一次連上網就看不到了'),
      h('p', { class: 'form-hint', style: 'margin-top:10px' },
        '手機沒有打開 App 的時候不會更新位置（這是手機的限制）——所以家人看到的是「最後看到」，不是即時追蹤。'),
    ),
    actions: [{ label: '先不要', value: false }, { label: '好，開始分享', value: true, primary: true }],
  });
  return !!ok;
}

function row(k, v) {
  return h('div', { class: 'pc-row' }, h('div', { class: 'pc-k' }, k), h('div', { class: 'pc-v' }, v));
}
