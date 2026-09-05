// 景點頁 —— 這是「做事」的頁面，唯一該做的事就是加照片。
// 任務的編輯 / 刪除已移到「調整每天的行程」（管理集中在那裡，長輩日常不會進去），
// 因為實測長輩看到任務旁的「編輯」會下意識按下去，以為那是加照片的入口。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, promptDialog, confirmDialog, KIND_META } from '../ui.js';
import { navigate, back } from '../router.js';
import { blobURL } from '../photos.js';
import { enrichSpot, refImageFor } from '../enrich.js';
import { themeForSpot, loadThemes } from '../theme.js';
import { paintRef } from './trip.js';
import { mapsDirUrl } from '../maps.js';
import { addPhotoButtons } from '../addphoto.js';
import { openTagger } from '../phototag.js';

export default async function spot(tripId, spotId) {
  const s = store.get(spotId);
  const t = store.get(tripId);
  if (!s || !t) { navigate('/', { replace: true }); return; }
  await loadThemes().catch(() => {});          // 佔位圖要用主題色

  setTop({ title: s.name });

  const quests = store.questsOf(spotId);
  const p = store.spotProgress(spotId);
  const refresh = () => spot(tripId, spotId);

  const hero = h('div', { class: 'quest-focus-photo' }, h('span', { class: 'qf-emoji' }, s.emoji || '📍'));
  paintRef(hero, refImageFor(null, s, null), s.theme || themeForSpot(s), s.id);

  render(h('div', { class: 'page' },
    hero,
    h('div', { style: 'margin:12px 2px' },
      h('div', { style: 'font-size:1.2rem;font-weight:800' }, s.name),
      h('div', { class: 'muted sm' }, [s.region, `第 ${s.day || 1} 天`, `${p.done}/${p.total} 完成`].filter(Boolean).join(' · ')),
    ),

    s.blurb ? h('p', { class: 'spot-blurb' }, s.blurb,
      s.aiBlurb ? h('span', { class: 'ai-mark', title: '這句由 AI 生成' }, ' ✨') : null) : null,

    mapButtons(s),

    h('div', { class: 'section-label' }, '這個景點的任務'),
    quests.length
      ? h('div', { class: 'stack' }, ...quests.map((q) => questRow(q, tripId, spotId, refresh)))
      : h('p', { class: 'muted' }, '這個景點還沒有任務。可以到「調整每天的行程」新增。'),

    h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:16px', onclick: () => back(`/trip/${tripId}`) }, '回旅程'),

    manageBox(s, tripId, spotId, quests),
  ));
}

// 一列任務：上面是「拍什麼」，下面就是兩顆加照片的按鈕。沒有別的東西可以按錯。
function questRow(q, tripId, spotId, refresh) {
  const km = KIND_META[q.kind] || KIND_META.thing;
  const subs = store.submissionsOf(q.id);
  const done = subs.length > 0;

  const thumbs = h('div', { class: 'qrow-thumbs' });
  for (const sub of subs.slice(-4)) {
    const im = h('img', {
      alt: '', loading: 'lazy',
      onclick: async () => { if (await openTagger(tripId, sub.id, subs)) refresh(); },
    });
    blobURL(sub.thumbHash || sub.photoHash).then((u) => { if (u) im.src = u; });
    thumbs.append(im);
  }

  return h('div', { class: 'qrow' + (done ? ' done' : '') },
    h('div', { class: 'qrow-head' },
      h('span', { class: 'qrow-icon' }, done ? '✓' : km.icon),
      h('div', { class: 'qrow-main' },
        h('div', { class: 'qrow-title' }, q.title),
        q.hint ? h('div', { class: 'muted sm' }, q.hint) : null,
        h('div', { class: 'qrow-status' + (done ? ' is-done' : '') },
          done ? `已加入 ${subs.length} 張照片` : '還沒有照片'),
      ),
    ),
    done ? thumbs : null,
    addPhotoButtons(tripId, q.id, { compact: true, onDone: refresh }),
  );
}

// 管理用的東西全部收在這裡，預設收合，長輩不會誤觸
function manageBox(s, tripId, spotId, quests) {
  const body = h('div', { class: 'manage-body', hidden: true },
    h('div', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '景點名稱'),
        h('div', { class: 'form-hint' }, s.name)),
      h('button', { class: 'btn btn-soft', onclick: async () => {
        const v = await promptDialog('景點名稱', { value: s.name });
        if (v) { await store.patch(spotId, { name: v, _enrichV: 0, _noHero: false }); enrichSpot(store.getRaw(spotId)); toast('已更新'); spot(tripId, spotId); }
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

    h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:12px', onclick: () => navigate(`/trip/${tripId}/plan`) },
      '📅 改任務、加任務（在「調整每天的行程」裡）'),

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
  );

  const head = h('button', { class: 'manage-head', onclick: () => {
    body.hidden = !body.hidden;
    head.lastChild.textContent = body.hidden ? '▸' : '▾';
  } }, h('span', {}, '⚙️ 這個景點的設定'), h('span', { class: 'dc-chev' }, '▸'));

  return h('section', { class: 'manage-box' }, head, body);
}

function mapButtons(s) {
  const dir = mapsDirUrl(s);
  if (!dir) return null;
  return h('a', {
    class: 'btn btn-primary btn-block btn-big', style: 'margin-top:12px; text-decoration:none',
    href: dir, target: '_blank', rel: 'noopener',
  }, `🧭 用地圖帶我去「${s.name}」`);
}

function timeInput(value, onChange) {
  const el = h('input', { type: 'time', class: 'field', style: 'min-height:44px;padding:8px;width:110px', value: value || '' });
  el.addEventListener('change', () => onChange(el.value));
  return el;
}
