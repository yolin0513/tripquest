// 「這是誰的手機？」—— 加入群組 / 換手機後，點自己的名字把過去的照片認回來。
// 投稿存的是 memberId（不是 deviceId），所以認領只是「本機記住我是誰」+ 一筆 memberClaim。

import { h } from './ui.js';
import * as store from './store.js';
import { uuid } from './ids.js';
import { myDeviceId } from './identity.js';

export function activeMemberId(tripId) {
  const id = store.getActiveMember(tripId);
  return id && store.getRaw(id) ? id : null;
}

// 需要「我是誰」時呼叫；已知就直接回，否則跳選擇畫面。
export async function ensureMember(tripId, { force = false } = {}) {
  if (!force) {
    const cur = activeMemberId(tripId);
    if (cur) return cur;
  }
  const trip = store.get(tripId);
  if (!trip) return null;
  const members = store.membersOf(trip.groupId);
  const picked = await pick(members, { allowAdd: true, groupId: trip.groupId });
  if (!picked) return null;
  await claim(tripId, picked);
  return picked;
}

// 建立者的身分（v1.63）。實機踩到的問題：建立行程的人從來沒走過「這是誰的手機」，
// 所以他沒有 memberClaim ——
//   · 旅伴那邊看到「建立者還沒加入」（資料面沒錯，語意完全錯）
//   · 他的位置永遠傳不出去（updateNow 找不到 activeMemberId 就直接 return）
//   · 他拍的照片也沒有歸屬
// 建立當下就問一次「哪一位是你」，一勞永逸；只有一位成員時直接認領、不打擾。
export async function claimAsCreator(tripId) {
  const trip = store.get(tripId);
  if (!trip) return null;
  if (activeMemberId(tripId)) return activeMemberId(tripId);
  const members = store.membersOf(trip.groupId);
  if (!members.length) return null;
  if (members.length === 1) { await claim(tripId, members[0].id); return members[0].id; }
  return ensureMember(tripId, { force: true });
}

// 舊行程的修復：這台就是建立者的裝置、卻沒有身分 → 進行程頁時補問一次。
// 不用猜是哪一位（猜錯會把照片算到別人頭上），但要主動問，不能只放一顆軟性按鈕
// ——實機就是那顆按鈕被忽略了，結果位置與加入狀態都不對。
export function creatorNeedsClaim(tripId) {
  const trip = store.get(tripId);
  if (!trip || activeMemberId(tripId)) return false;
  if (trip.createdByDevice && trip.createdByDevice !== myDeviceId()) return false;
  if (!trip.createdByDevice) return false;                 // 不是建立者的裝置就不要亂問
  return store.membersOf(trip.groupId).length > 0;
}

export async function claim(tripId, memberId) {
  store.setActiveMember(tripId, memberId);
  const m = store.getRaw(memberId);
  // 一筆 memberClaim（append-only）→ 支援一人多裝置、未來可做冒用防護
  const claimId = `mc:${memberId}:${myDeviceId()}`;
  if (!store.getRaw(claimId)) {
    await store.put({
      id: claimId, type: 'memberClaim', tripId,
      memberId, deviceId: myDeviceId(), claimedAt: Date.now(),
    });
  }
  return m;
}

function pick(members, { allowAdd = false, groupId } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    const list = h('div', { class: 'member-pick' },
      ...members.map((m) => {
        const claims = store.exportRecords().filter((r) => r.type === 'memberClaim' && r.memberId === m.id).length;
        return h('button', { class: 'btn btn-soft btn-block btn-big', onclick: () => done(m.id) },
          m.displayName, claims > 1 ? h('span', { class: 'tag', style: 'margin-left:8px' }, claims + ' 台裝置') : null);
      }),
      allowAdd ? h('button', {
        class: 'btn btn-ghost btn-block', onclick: async () => {
          const { promptDialog } = await import('./ui.js');
          const name = await promptDialog('你的名字', { okLabel: '加入' });
          if (name) { const id = uuid(); await store.put({ id, type: 'member', groupId, displayName: name }); done(id); }
        },
      }, '＋ 我不在名單上') : null,
    );
    const card = h('div', { class: 'modal-card' },
      h('h2', { class: 'modal-title' }, '這是誰的手機？'),
      h('p', { class: 'sm muted', style: 'margin:-6px 0 12px' }, '點自己的名字，過去拍的照片就會認回來。選一次就好。'),
      list,
    );
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, card);
    document.getElementById('modalRoot').append(overlay);
    document.addEventListener('keydown', onKey);
  });
}

export { pick as pickMemberDialog };
