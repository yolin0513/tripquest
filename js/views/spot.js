import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, toast, promptDialog, confirmDialog, KIND_META } from '../ui.js';
import { navigate } from '../router.js';
import { uuid } from '../ids.js';
import { enrichSpotFromWiki } from '../quests/generate.js';

export default async function spot(tripId, spotId) {
  const s = store.get(spotId);
  const t = store.get(tripId);
  if (!s || !t) { navigate('/', { replace: true }); return; }

  setTop({
    title: s.name,
    action: { icon: '＋', label: '新增任務', onClick: () => addQuest(tripId, spotId) },
  });

  const p = store.spotProgress(spotId);
  const quests = store.questsOf(spotId);

  const wikiBox = h('div', { class: 'wiki-box', hidden: true });

  render(h('div', { class: 'page' },
    h('div', { class: 'spot-hero card' },
      h('div', {},
        h('div', { class: 'trip-card-title' }, s.name),
        h('div', { class: 'muted sm' }, [s.region, `第 ${s.day || 1} 天`].filter(Boolean).join(' · ')),
      ),
      ring(p.ratio, { size: 56, label: `${p.done}/${p.total}` }),
    ),
    wikiBox,
    quests.length
      ? h('div', { class: 'stack' }, ...quests.map((q) => questCard(q)))
      : h('div', { class: 'empty' }, h('p', {}, '這個景點還沒有任務'),
          h('button', { class: 'btn btn-primary', onclick: () => addQuest(tripId, spotId) }, '＋ 新增任務')),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => addQuest(tripId, spotId) }, '＋ 自訂任務'),
  ));

  // 可選：維基百科補圖（需在行程設定開啟）
  if (t.allowWiki && s.source !== 'curated' && !s._wikiTried) {
    store.patch(spotId, { _wikiTried: true });
    const info = await enrichSpotFromWiki(s);
    if (info && info.thumb) {
      wikiBox.hidden = false;
      wikiBox.append(
        h('img', { src: info.thumb, alt: s.name, loading: 'lazy' }),
        h('div', { class: 'wiki-text' },
          h('p', { class: 'sm' }, info.extract || ''),
          h('span', { class: 'form-hint' }, '參考圖 · 維基百科'),
        ),
      );
      if (info.lat && !s.lat) store.patch(spotId, { lat: info.lat, lng: info.lng });
    }
  }
}

function questCard(q) {
  const done = store.isQuestDone(q.id);
  const subs = store.submissionsOf(q.id);
  const km = KIND_META[q.kind] || KIND_META.thing;
  return h('button', {
    class: 'card quest-card' + (done ? ' quest-done' : ''),
    onclick: () => navigate(`/quest/${q.id}`),
  },
    h('div', { class: 'quest-icon' }, done ? '✓' : km.icon),
    h('div', { class: 'quest-main' },
      h('div', { class: 'quest-title' }, q.title),
      h('div', { class: 'quest-hint sm muted' }, q.hint),
      h('div', { class: 'quest-meta' },
        h('span', { class: 'tag' }, km.label),
        subs.length ? h('span', { class: 'tag tag-ok' }, `${subs.length} 張` ) : h('span', { class: 'tag tag-todo' }, '待拍'),
      ),
    ),
    h('span', { class: 'chev' }, '›'),
  );
}

async function addQuest(tripId, spotId) {
  const title = await promptDialog('任務名稱', { placeholder: '例：找到那隻招財貓', okLabel: '下一步' });
  if (!title) return;
  const hint = await promptDialog('提示（可留空）', { placeholder: '要拍成怎樣才算完成？', multiline: true, okLabel: '新增' }) || '';
  const order = store.questsOf(spotId).length;
  await store.put({ id: uuid(), type: 'quest', tripId, spotId, title, hint, kind: 'custom', source: 'custom', order, refImage: null });
  toast('已新增任務');
  navigate(`/trip/${tripId}/spot/${spotId}`);
  void confirmDialog;
}
