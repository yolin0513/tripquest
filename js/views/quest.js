import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, promptDialog, celebrate, modal, KIND_META } from '../ui.js';
import { navigate } from '../router.js';
import { importPhoto, blobURL } from '../photos.js';
import { ensureMember } from '../claim.js';
import { newlyEarned } from '../badges.js';

export default async function quest(questId) {
  const q = store.get(questId);
  if (!q) { navigate('/', { replace: true }); return; }
  const spot = store.get(q.spotId);
  const t = store.get(q.tripId);
  const km = KIND_META[q.kind] || KIND_META.thing;

  setTop({
    title: spot?.name || '任務',
    action: { icon: '✏️', label: '編輯', onClick: () => editQuest(questId) },
  });

  const subs = store.submissionsOf(questId);
  const members = store.membersOf(t.groupId);
  const done = subs.length > 0;

  const heroPhoto = h('div', { class: 'quest-focus-photo' }, h('span', { class: 'qf-emoji' }, km.icon));
  if (spot?.heroHash) blobURL(spot.heroHash).then((u) => { if (u) { heroPhoto.style.backgroundImage = `url("${u}")`; heroPhoto.classList.add('has-img'); } });

  const grid = h('div', { class: 'photo-grid' });

  render(h('div', { class: 'page' },
    h('div', { class: 'quest-focus' },
      heroPhoto,
      h('span', { class: 'tag quest-focus-kind' }, `${km.icon} ${km.label}`),
      h('h2', {}, q.title),
      q.hint ? h('p', { class: 'qf-hint' }, q.hint) : null,
    ),

    done ? h('div', { class: 'section-label' }, `已完成 · ${subs.length} 張照片`) : null,
    grid,

    photoButton(t, q, spot, members),
    h('p', { class: 'form-hint center' }, '照片只存在這支手機，會自動縮小、不會上傳。'),
  ));

  await paintGrid(grid, questId);
}

function photoButton(trip, q, spot, members) {
  // 拍照（叫相機）與從相簿選（不加 capture）各一個 input，共用同一套處理
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true });
  const libInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  camInput.addEventListener('change', () => onPick(camInput));
  libInput.addEventListener('change', () => onPick(libInput));

  async function onPick(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;

    // 「我是誰」：每個旅程問一次就記住
    let memberId;
    if (members.length <= 1) {
      memberId = members[0]?.id || null;
      if (memberId) store.setActiveMember(trip.id, memberId);
    } else {
      memberId = await ensureMember(trip.id);
      if (!memberId) return;
    }

    // 代拍 / 入鏡標記（多人才問，可略過）
    let attr = { forMemberId: null, subjectIds: null };
    if (members.length > 1) attr = await askAttribution(members, memberId);

    const wasDone = store.isQuestDone(q.id);
    const prog0 = store.tripProgress(trip.id);

    const prog = h('div', { class: 'upload-prog' }, `處理中 0/${files.length}…`);
    document.querySelector('.page')?.append(prog);
    let ok = 0; let lastSub = null;
    for (const f of files) {
      try {
        lastSub = await importPhoto(f, {
          tripId: trip.id, questId: q.id, memberId, allowGeo: !!trip.allowGeo,
          forMemberId: attr.forMemberId, subjectIds: attr.subjectIds,
        });
        ok++;
        prog.textContent = `處理中 ${ok}/${files.length}…`;
      } catch (e) { console.error(e); toast('一張照片處理失敗'); }
    }
    prog.remove();
    if (!ok) { toast('沒有成功加入照片'); return; }

    const prog1 = store.tripProgress(trip.id);
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
      if (res === 'album') { await showNewBadges(trip.id, attr.forMemberId || memberId); return navigate(`/trip/${trip.id}/album`); }
      if (res === 'people') { await showNewBadges(trip.id, attr.forMemberId || memberId); return navigate(`/trip/${trip.id}/people`); }
    } else {
      toast(`已加入 ${ok} 張`);
    }
    // 代拍者與被幫的人都檢查新徽章
    await showNewBadges(trip.id, memberId);
    if (attr.forMemberId && attr.forMemberId !== memberId) await showNewBadges(trip.id, attr.forMemberId);
    void prog0;
    quest(q.id);
  }

  const doneNow = store.isQuestDone(q.id);
  return h('div', { class: 'big-shot-btn' },
    camInput, libInput,
    h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => camInput.click() },
      doneNow ? '📷 再拍一張' : '📷 拍照'),
    h('button', { class: 'btn btn-soft btn-block btn-big', style: 'margin-top:10px', onclick: () => libInput.click() },
      '🖼️ 從相簿選（可多張）'),
  );
}

// 幫誰拍 / 照片裡有誰
async function askAttribution(members, myId) {
  let forId = null;
  const subjects = new Set();
  const forRow = h('div', { class: 'quick-pick' });
  const subRow = h('div', { class: 'quick-pick' });
  const drawFor = () => forRow.replaceChildren(
    h('button', { class: (forId === null ? 'on ' : '') + 'chip-sm', onclick: () => { forId = null; drawFor(); } }, '就是我拍的'),
    ...members.filter((m) => m.id !== myId).map((m) =>
      h('button', { class: (forId === m.id ? 'on ' : '') + 'chip-sm', onclick: () => { forId = m.id; drawFor(); } }, '幫 ' + m.displayName)),
  );
  const drawSub = () => subRow.replaceChildren(...members.map((m) =>
    h('button', {
      class: (subjects.has(m.id) ? 'on ' : '') + 'chip-sm',
      onclick: () => { subjects.has(m.id) ? subjects.delete(m.id) : subjects.add(m.id); drawSub(); },
    }, m.displayName)));
  drawFor(); drawSub();

  const res = await modal({
    title: '這張照片…（可略過）',
    body: h('div', {},
      h('div', { class: 'form-label' }, '是幫誰拍的？'),
      forRow,
      h('div', { class: 'form-label', style: 'margin-top:14px' }, '照片裡有誰？'),
      subRow,
    ),
    actions: [{ label: '略過', value: 'skip' }, { label: '好了', value: 'ok', primary: true }],
  });
  if (res === 'skip') return { forMemberId: null, subjectIds: null };
  return { forMemberId: forId, subjectIds: subjects.size ? [...subjects] : null };
}

async function showNewBadges(tripId, memberId) {
  try {
    const fresh = await newlyEarned(tripId, memberId);
    const member = store.getRaw(memberId);
    for (const b of fresh) {
      await celebrate({
        title: `解鎖新徽章！`,
        lines: [`${b.emoji}　${b.name}`, b.desc + (member ? `（${member.displayName}）` : '')],
        actions: [{ label: '太棒了', value: 'ok', primary: true }],
      });
    }
  } catch (e) { console.warn('badge', e); }
}

async function paintGrid(grid, questId) {
  const subs = store.submissionsOf(questId);
  grid.replaceChildren();
  for (const sub of subs) {
    const url = await blobURL(sub.thumbHash || sub.photoHash);
    const member = sub.memberId ? store.getRaw(sub.memberId) : null;
    const forM = sub.forMemberId ? store.getRaw(sub.forMemberId) : null;
    const likes = store.reactionsOf(sub.id).length;
    const cap = forM
      ? `${member?.displayName || '旅伴'} 幫 ${forM.displayName} 拍`
      : (member?.displayName || sub.byDevice || '未指定');
    grid.append(h('figure', { class: 'photo-cell' },
      h('img', { src: url, alt: sub.caption || '', loading: 'lazy', onclick: () => viewPhoto(sub) }),
      likes ? h('span', { class: 'mini-likes' }, '❤️ ' + likes) : null,
      h('figcaption', {}, cap),
    ));
  }
}

async function viewPhoto(sub) {
  const { modal } = await import('../ui.js');
  const url = await blobURL(sub.photoHash);
  const member = sub.memberId ? store.getRaw(sub.memberId) : null;
  await modal({
    body: h('div', { class: 'photo-view' },
      h('img', { src: url, alt: '' }),
      h('div', {},
        h('div', { style: 'font-weight:700' }, member?.displayName || sub.byDevice || '未指定'),
        sub.caption ? h('div', { class: 'muted sm' }, sub.caption) : null,
        sub.gps ? h('div', { class: 'form-hint' }, `📍 ${sub.gps.lat}, ${sub.gps.lng}`) : null,
      ),
      h('div', { class: 'photo-view-actions' },
        h('button', { class: 'btn btn-soft', onclick: async () => {
          const c = await promptDialog('照片說明', { value: sub.caption || '', multiline: true });
          if (c !== null) { await patchSub(sub.id, { caption: c }); toast('已更新'); close(); quest(sub.questId); }
        } }, '✏️ 說明'),
        h('button', { class: 'btn btn-danger', onclick: async () => {
          if (await confirmDialog('刪除這張照片？', { danger: true, okLabel: '刪除' })) {
            await store.deleteSubmission(sub.id);
            toast('已刪除'); close(); quest(sub.questId);
          }
        } }, '🗑️ 刪除'),
      ),
    ),
    actions: [{ label: '關閉', value: true }],
  });
  function close() { document.querySelector('.modal-overlay')?.remove(); }
}

async function patchSub(id, changes) {
  const raw = store.getRaw(id);
  if (!raw) return;
  Object.assign(raw, changes);
  const { putRecord } = await import('../db.js');
  await putRecord(raw);
}

async function editQuest(questId) {
  const q = store.getRaw(questId);
  const title = await promptDialog('任務名稱', { value: q.title });
  if (title === null) return;
  const hint = await promptDialog('提示', { value: q.hint || '', multiline: true });
  await store.patch(questId, { title: title || q.title, hint: hint ?? q.hint });
  toast('已更新');
  quest(questId);
}
