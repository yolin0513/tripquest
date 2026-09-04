import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, promptDialog, confirmDialog, KIND_META } from '../ui.js';
import { navigate, back } from '../router.js';
import { uuid } from '../ids.js';
import { blobURL } from '../photos.js';
import { enrichSpot } from '../enrich.js';

export default async function spot(tripId, spotId) {
  const s = store.get(spotId);
  const t = store.get(tripId);
  if (!s || !t) { navigate('/', { replace: true }); return; }

  setTop({
    title: s.name,
    action: { icon: '＋', label: '新增任務', onClick: () => addQuest(tripId, spotId) },
  });

  const quests = store.questsOf(spotId);
  const p = store.spotProgress(spotId);

  const hero = h('div', { class: 'quest-focus-photo' }, h('span', { class: 'qf-emoji' }, s.emoji || '📍'));
  if (s.heroHash) blobURL(s.heroHash).then((u) => { if (u) hero.style.backgroundImage = `url("${u}")`; });

  render(h('div', { class: 'page' },
    hero,
    h('div', { class: 'setting-row' },
      h('div', {},
        h('div', { style: 'font-size:1.2rem;font-weight:800' }, s.name),
        h('div', { class: 'muted sm' }, [s.region, `第 ${s.day || 1} 天`, `${p.done}/${p.total} 完成`].filter(Boolean).join(' · ')),
      ),
      h('button', { class: 'btn btn-soft', onclick: async () => {
        const v = await promptDialog('景點名稱', { value: s.name });
        if (v) { await store.patch(spotId, { name: v, _enriched: false }); enrichSpot(store.getRaw(spotId)); toast('已更新'); spot(tripId, spotId); }
      } }, '改名字'),
    ),

    h('div', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '安排的時間'),
        h('div', { class: 'form-hint' }, '選填。填了行程海報會顯示時間軸（例：11:00–13:00）。')),
      h('div', { style: 'display:flex;gap:6px;align-items:center' },
        timeInput(s.startTime, (v) => store.patch(spotId, { startTime: v })),
        h('span', { class: 'muted' }, '–'),
        timeInput(s.endTime, (v) => store.patch(spotId, { endTime: v })),
      ),
    ),

    h('div', { class: 'section-label' }, '這個景點的任務'),
    h('div', { class: 'stack' }, ...quests.map((q) => questRow(q, tripId, spotId))),

    h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:16px', onclick: () => addQuest(tripId, spotId) }, '＋ 新增任務'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => back(`/trip/${tripId}`) }, '回旅程'),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog(`刪除景點「${s.name}」？它的任務與照片都會刪除。`, { danger: true, okLabel: '刪除' })) {
          for (const q of quests) { for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id); await store.remove(q.id); }
          await store.remove(spotId);
          toast('已刪除');
          navigate(`/trip/${tripId}`, { replace: true });
        }
      } }, '🗑️ 刪除這個景點'),
    ),
  ));
}

function questRow(q, tripId, spotId) {
  const km = KIND_META[q.kind] || KIND_META.thing;
  const done = store.isQuestDone(q.id);
  return h('div', { class: 'card', style: 'align-items:flex-start' },
    h('span', { class: 'quest-icon', style: 'width:44px;height:44px;flex:none;border-radius:12px;background:var(--bg-elev-2);display:grid;place-items:center;font-size:1.3rem' }, done ? '✓' : km.icon),
    h('div', { style: 'flex:1;min-width:0' },
      h('div', { style: 'font-weight:700' }, q.title),
      q.hint ? h('div', { class: 'muted sm' }, q.hint) : null,
      h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        h('button', { class: 'tag', style: 'cursor:pointer', onclick: async () => {
          const title = await promptDialog('任務名稱', { value: q.title });
          if (title === null) return;
          const hint = await promptDialog('提示', { value: q.hint || '', multiline: true });
          await store.patch(q.id, { title: title || q.title, hint: hint ?? q.hint });
          toast('已更新'); spot(tripId, spotId);
        } }, '編輯'),
        h('button', { class: 'tag', style: 'cursor:pointer;color:var(--danger)', onclick: async () => {
          if (await confirmDialog(`刪除任務「${q.title}」？`, { danger: true, okLabel: '刪除' })) {
            for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
            await store.remove(q.id);
            toast('已刪除'); spot(tripId, spotId);
          }
        } }, '刪除'),
      ),
    ),
  );
}

function timeInput(value, onChange) {
  const el = h('input', { type: 'time', class: 'field', style: 'min-height:44px;padding:8px;width:110px', value: value || '' });
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

async function addQuest(tripId, spotId) {
  const title = await promptDialog('要拍什麼？', { placeholder: '例：找到那隻招財貓', okLabel: '下一步' });
  if (!title) return;
  const hint = await promptDialog('提示（可留空）', { placeholder: '拍成怎樣算完成？', multiline: true, okLabel: '新增' }) || '';
  const order = store.questsOf(spotId).length;
  await store.put({ id: uuid(), type: 'quest', tripId, spotId, title, hint, kind: 'custom', source: 'custom', order, refImage: null });
  toast('已新增');
  spot(tripId, spotId);
}
