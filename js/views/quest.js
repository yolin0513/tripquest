import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, promptDialog, KIND_META } from '../ui.js';
import { navigate } from '../router.js';
import { blobURL } from '../photos.js';
import { addPhotoButtons } from '../addphoto.js';
import { openTagger } from '../phototag.js';
import { refImageFor } from '../enrich.js';
import { themeForSpot, loadThemes } from '../theme.js';
import { paintRef } from './trip.js';

export default async function quest(questId) {
  const q = store.get(questId);
  if (!q) { navigate('/', { replace: true }); return; }
  const spot = store.get(q.spotId);
  const t = store.get(q.tripId);
  const km = KIND_META[q.kind] || KIND_META.thing;
  await loadThemes().catch(() => {});          // 佔位圖要用主題色

  setTop({
    title: spot?.name || '任務',
    action: { icon: '✏️', label: '編輯', onClick: () => editQuest(questId) },
  });

  const subs = store.submissionsOf(questId);
  const members = store.membersOf(t.groupId);
  const done = subs.length > 0;

  // 這裡的大圖是「要拍的東西長怎樣」的參考圖，所以不用使用者自己拍的（自己的照片在下面的格子裡）
  const heroPhoto = h('div', { class: 'quest-focus-photo' }, h('span', { class: 'qf-emoji' }, km.icon));
  paintRef(heroPhoto, refImageFor(q, spot, null), spot ? (spot.theme || themeForSpot(spot)) : 'journey', q.spotId);

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

    addPhotoButtons(q.tripId, questId, { onDone: () => quest(questId) }),
    members.length > 1
      ? h('p', { class: 'form-hint center' }, '加完照片後，可以到「照片」那一頁標記照片裡有誰。')
      : null,
    h('p', { class: 'form-hint center' }, '照片只存在這支手機，會自動縮小、不會上傳。'),
  ));

  await paintGrid(grid, questId, q.tripId);
}

async function paintGrid(grid, questId, tripId) {
  const subs = store.submissionsOf(questId);
  const multi = (() => {
    const t = store.get(tripId);
    return t ? store.membersOf(t.groupId).length > 1 : false;
  })();
  grid.replaceChildren();
  for (const sub of subs) {
    const url = await blobURL(sub.thumbHash || sub.photoHash);
    const tag = store.photoTag(sub);
    const shooter = tag.photographerId ? store.getRaw(tag.photographerId) : null;
    const names = tag.subjectIds.map((id) => store.getRaw(id)?.displayName).filter(Boolean);
    const likes = store.reactionsOf(sub.id).length;
    const cap = names.length
      ? '📸 ' + names.join('、')
      : (shooter?.displayName || sub.byDevice || '未指定');
    const untagged = multi && !store.isPhotoTagged(sub);
    grid.append(h('figure', { class: 'photo-cell' },
      h('img', {
        src: url, alt: store.photoCaption(sub) || '', loading: 'lazy',
        onclick: async () => { if (await openTagger(tripId, sub.id, subs)) quest(questId); },
      }),
      untagged ? h('span', { class: 'untag-dot' }, '未標記') : null,
      likes ? h('span', { class: 'mini-likes' }, '❤️ ' + likes) : null,
      h('figcaption', {}, cap),
    ));
  }
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
