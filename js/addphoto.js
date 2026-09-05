// 「加入照片」—— 任務頁與景點頁共用同一套流程。
//
// 刻意做成兩顆按鈕（拍照 / 從相簿選）而不是一顆再跳選單：長輩少按一層，
// 而且每顆按鈕的字就直接說明它會做什麼，不必先猜。
//
// 上傳時不問「照片裡有誰」—— 一次選多張時那個問題會被統一套用到每一張而標錯
// （第一張全家福、第二張只有弟弟，弟弟那張也被標成全家）。改成事後用 phototag.js 標。

import * as store from './store.js';
import { h, toast, celebrate } from './ui.js';
import { navigate } from './router.js';
import { importPhoto, blobURL } from './photos.js';
import { ensureMember } from './claim.js';
import { newlyEarned } from './badges.js';

export function addPhotoButtons(tripId, questId, { compact = false, onDone } = {}) {
  // 拍照（叫相機）與從相簿選（不加 capture）各一個 input，共用同一套處理
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true });
  const libInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  camInput.addEventListener('change', () => onPick(camInput));
  libInput.addEventListener('change', () => onPick(libInput));

  async function onPick(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;

    const trip = store.get(tripId);
    const q = store.get(questId);
    if (!trip || !q) return;
    const members = store.membersOf(trip.groupId);

    // 「這支手機是誰的」：一趟問一次就記住。這跟「照片裡有誰」是兩回事，後者已改成事後標記。
    let memberId;
    if (members.length <= 1) {
      memberId = members[0]?.id || null;
      if (memberId) store.setActiveMember(tripId, memberId);
    } else {
      memberId = await ensureMember(tripId);
      if (!memberId) return;
    }

    const wasDone = store.isQuestDone(questId);
    const prog = h('div', { class: 'upload-prog' }, `處理中 0/${files.length}…`);
    document.querySelector('.page')?.append(prog);

    let ok = 0; let lastSub = null;
    for (const f of files) {
      try {
        lastSub = await importPhoto(f, { tripId, questId, memberId, allowGeo: !!trip.allowGeo });
        ok++;
        prog.textContent = `處理中 ${ok}/${files.length}…`;
      } catch (e) { console.error(e); toast('一張照片處理失敗'); }
    }
    prog.remove();
    if (!ok) { toast('沒有成功加入照片'); return; }

    const prog1 = store.tripProgress(tripId);
    if (!wasDone) {
      const allDone = prog1.done === prog1.total;
      const url = lastSub ? await blobURL(lastSub.thumbHash) : null;
      const res = await celebrate({
        title: allDone ? '全部完成啦！🎉' : '完成一個任務！',
        lines: allDone
          ? [`${prog1.total} 個任務全部達成`, '可以來做回憶影片了']
          : [`「${q.title}」搞定`, `進度 ${prog1.done} / ${prog1.total}`],
        photoURL: url,
        actions: allDone
          ? [{ label: '🎬 去做回憶影片', value: 'album', primary: true }, { label: '看看大家', value: 'people' }]
          : [{ label: '繼續下一個', value: 'stay', primary: true }, { label: '看看大家', value: 'people' }],
      });
      await showNewBadges(tripId, memberId);
      if (res === 'album') return navigate(`/trip/${tripId}/album`);
      if (res === 'people') return navigate(`/trip/${tripId}/people`);
    } else {
      toast(`已加入 ${ok} 張`);
      await showNewBadges(tripId, memberId);
    }

    if (onDone) onDone();
  }

  const done = store.isQuestDone(questId);
  const cls = compact ? 'btn' : 'btn btn-block btn-big';
  return h('div', { class: compact ? 'addphoto-row' : 'big-shot-btn' },
    camInput, libInput,
    h('button', { class: `${cls} btn-primary`, onclick: () => camInput.click() },
      done ? '📷 再拍一張' : '📷 拍照'),
    h('button', {
      class: `${cls} btn-soft`, style: compact ? '' : 'margin-top:10px',
      onclick: () => libInput.click(),
    }, compact ? '🖼️ 從相簿選' : '🖼️ 從相簿選（可多張）'),
  );
}

export async function showNewBadges(tripId, memberId) {
  try {
    const fresh = await newlyEarned(tripId, memberId);
    const member = store.getRaw(memberId);
    for (const b of fresh) {
      await celebrate({
        title: '解鎖新徽章！',
        lines: [`${b.emoji}　${b.name}`, b.desc + (member ? `（${member.displayName}）` : '')],
        actions: [{ label: '太棒了', value: 'ok', primary: true }],
      });
    }
  } catch (e) { console.warn('badge', e); }
}
