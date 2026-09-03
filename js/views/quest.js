import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, promptDialog, modal, KIND_META } from '../ui.js';
import { navigate } from '../router.js';
import { importPhoto, blobURL } from '../photos.js';

export default async function quest(questId) {
  const q = store.get(questId);
  if (!q) { navigate('/', { replace: true }); return; }
  const spot = store.get(q.spotId);
  const t = store.get(q.tripId);
  const km = KIND_META[q.kind] || KIND_META.thing;

  setTop({
    title: spot?.name || '任務',
    action: { icon: '✏️', label: '編輯任務', onClick: () => editQuest(questId) },
  });

  const subs = store.submissionsOf(questId);
  const members = store.membersOf(t.groupId);
  const done = subs.length > 0;

  const grid = h('div', { class: 'photo-grid' });
  render(h('div', { class: 'page' },
    h('div', { class: 'quest-hero card' + (done ? ' quest-done' : '') },
      h('div', { class: 'quest-hero-top' },
        h('span', { class: 'quest-icon big' }, done ? '✓' : km.icon),
        h('span', { class: 'tag' }, km.label),
      ),
      h('h2', { class: 'quest-hero-title' }, q.title),
      q.hint ? h('p', { class: 'muted' }, q.hint) : null,
      q.refImage ? h('img', { class: 'ref-img', src: q.refImage, alt: '參考', loading: 'lazy' }) : null,
    ),

    h('div', { class: 'section-label' }, done ? `已完成 · ${subs.length} 張照片` : '還沒有人拍到，快去解鎖！'),
    grid,

    addButton(t, questId, members),
  ));

  await paintGrid(grid, questId);
}

function addButton(trip, questId, members) {
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true });
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;

    let memberId = members[0]?.id || null;
    if (members.length > 1) {
      memberId = await pickMember(members);
      if (memberId === undefined) return;
    }

    const prog = h('div', { class: 'upload-prog' }, `處理中 0/${files.length}`);
    document.querySelector('.page')?.append(prog);
    let ok = 0;
    for (const f of files) {
      try {
        await importPhoto(f, { tripId: trip.id, questId, memberId, allowGeo: !!trip.allowGeo });
        ok++;
        prog.textContent = `處理中 ${ok}/${files.length}`;
      } catch (e) {
        console.error(e);
        toast('一張照片處理失敗：' + e.message);
      }
    }
    prog.remove();
    toast(ok ? `已加入 ${ok} 張，任務解鎖！` : '沒有成功加入照片');
    quest(questId);
  });

  return h('div', {},
    input,
    h('button', { class: 'btn btn-primary btn-block', onclick: () => input.click() }, '📷 拍照 / 選照片上傳'),
    h('p', { class: 'form-hint center' }, '照片只會存在這支手機，經壓縮後預設清除位置等資訊，不會上傳。'),
  );
}

function pickMember(members) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(undefined); };
    const card = h('div', { class: 'modal-card' },
      h('h2', { class: 'modal-title' }, '這張是誰拍的？'),
      h('div', { class: 'member-pick' },
        ...members.map((m) => h('button', { class: 'btn btn-soft btn-block', onclick: () => done(m.id) }, m.displayName)),
        h('button', { class: 'btn btn-ghost btn-block', onclick: () => done(null) }, '未指定'),
      ),
    );
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) done(undefined); } }, card);
    document.getElementById('modalRoot').append(overlay);
    document.addEventListener('keydown', onKey);
  });
}

async function paintGrid(grid, questId) {
  const subs = store.submissionsOf(questId);
  grid.replaceChildren();
  for (const sub of subs) {
    const url = await blobURL(sub.thumbHash || sub.photoHash);
    const member = sub.memberId ? store.getRaw(sub.memberId) : null;
    const cell = h('figure', { class: 'photo-cell' },
      h('img', { src: url, alt: sub.caption || '', loading: 'lazy', onclick: () => viewPhoto(sub) }),
      h('figcaption', {}, member?.displayName || sub.byDevice || '未指定'),
    );
    grid.append(cell);
  }
}

async function viewPhoto(sub) {
  const url = await blobURL(sub.photoHash);
  const member = sub.memberId ? store.getRaw(sub.memberId) : null;
  await modal({
    body: h('div', { class: 'photo-view' },
      h('img', { src: url, alt: '' }),
      h('div', { class: 'photo-view-meta' },
        h('div', {}, member?.displayName || sub.byDevice || '未指定'),
        sub.caption ? h('div', { class: 'muted sm' }, sub.caption) : null,
        sub.gps ? h('div', { class: 'form-hint' }, `📍 ${sub.gps.lat}, ${sub.gps.lng}`) : null,
      ),
      h('div', { class: 'photo-view-actions' },
        h('button', { class: 'btn btn-soft', onclick: async () => {
          const c = await promptDialog('照片說明', { value: sub.caption || '', multiline: true });
          if (c !== null) { await patchSub(sub.id, { caption: c }); toast('已更新'); close(); quest(sub.questId); }
        } }, '✏️ 加說明'),
        h('button', { class: 'btn btn-danger', onclick: async () => {
          if (await confirmDialog('刪除這張照片？', { danger: true, okLabel: '刪除' })) {
            await store.deleteSubmission(sub.id);
            toast('已刪除');
            close();
            quest(sub.questId);
          }
        } }, '🗑️ 刪除'),
      ),
    ),
    actions: [{ label: '關閉', value: true }],
  });
  function close() { document.querySelector('.modal-overlay')?.remove(); }
}

async function patchSub(id, changes) {
  // 投稿理論上不可變，但「說明」是純顯示欄位，v1 直接就地改；v2 同步時屬 LWW 欄位
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
