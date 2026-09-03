import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, toast, confirmDialog, promptDialog, modal, fmtDate, avatar, KIND_META } from '../ui.js';
import { navigate } from '../router.js';
import { uuid, hashHue } from '../ids.js';
import { shareURL, exportBundle, downloadBlob, nativeShare } from '../share.js';
import { generateForTrip, templateQuests, inferType } from '../quests/generate.js';

export default function trip(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }

  setTop({
    title: t.title, action: { icon: '⚙️', label: '行程設定', onClick: () => navigate(`/trip/${tripId}/settings`) },
  });

  const prog = store.tripProgress(tripId);
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(t.groupId);
  const done = prog.total > 0 && prog.done === prog.total;

  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  render(h('div', { class: 'page' },
    h('div', { class: 'trip-head card' },
      h('div', {},
        h('div', { class: 'trip-card-title' }, t.title),
        h('div', { class: 'muted sm' },
          [t.region, t.startDate ? `${fmtDate(t.startDate)}${t.endDate ? '–' + fmtDate(t.endDate) : ''}` : null]
            .filter(Boolean).join(' · ') || '尚未設定日期'),
      ),
      ring(prog.ratio, { size: 64, label: `${prog.done}/${prog.total}` }),
    ),

    members.length ? h('div', { class: 'avatars pad-x' }, ...members.map((m) => avatar(m.displayName, hashHue(m.id)))) : null,

    h('div', { class: 'action-row' },
      h('button', { class: 'btn btn-soft', onclick: () => doShare(tripId) }, '🔗 分享任務給旅伴'),
      h('button', {
        class: 'btn ' + (done ? 'btn-primary' : 'btn-soft is-locked'),
        onclick: () => done ? navigate(`/trip/${tripId}/album`) : toast(`還有 ${prog.total - prog.done} 個任務沒解鎖`),
      }, done ? '🎬 製作回憶影片' : `🔒 回憶影片（${prog.done}/${prog.total}）`),
    ),

    spots.length === 0
      ? h('div', { class: 'empty' }, h('p', {}, '這個行程還沒有景點'),
          h('button', { class: 'btn btn-primary', onclick: () => addSpot(tripId) }, '＋ 新增景點'))
      : h('div', { class: 'stack' }, ...[...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) =>
          h('section', { class: 'day-group' },
            h('h3', { class: 'day-title' }, `第 ${day} 天`),
            ...list.map((s) => spotRow(tripId, s)),
          ))),

    spots.length ? h('button', { class: 'btn btn-ghost btn-block', onclick: () => addSpot(tripId) }, '＋ 新增景點') : null,
  ));
}

function spotRow(tripId, s) {
  const p = store.spotProgress(s.id);
  const quests = store.questsOf(s.id);
  return h('button', {
    class: 'card spot-row', onclick: () => navigate(`/trip/${tripId}/spot/${s.id}`),
  },
    h('div', { class: 'spot-row-main' },
      h('div', { class: 'spot-row-title' }, s.name,
        s.source === 'curated' ? h('span', { class: 'tag tag-curated' }, '精選') : null),
      h('div', { class: 'kind-dots' }, ...quests.slice(0, 6).map((q) =>
        h('span', { class: 'kind-dot' + (store.isQuestDone(q.id) ? ' done' : '') },
          store.isQuestDone(q.id) ? '✓' : (KIND_META[q.kind]?.icon || '•')))),
    ),
    ring(p.ratio, { size: 40, label: `${p.done}/${p.total}` }),
  );
}

// ---------- 分享 ----------
async function doShare(tripId) {
  toast('產生任務代碼中…');
  const url = await shareURL(tripId);
  const shared = await nativeShare({ title: 'TripQuest 任務', text: '一起來解這趟旅程的拍照任務！', url });
  if (shared) return;
  await modal({
    title: '分享任務給旅伴',
    body: h('div', {},
      h('p', { class: 'sm muted' }, '把這個連結傳給旅伴，他們打開就會拿到同一份任務清單，各自拍照解任務。（不含照片）'),
      h('textarea', { class: 'field mono', rows: 4, readonly: true, onclick: (e) => e.target.select() }, url),
      h('button', {
        class: 'btn btn-primary btn-block', onclick: async () => {
          try { await navigator.clipboard.writeText(url); toast('已複製連結'); }
          catch { toast('請長按上方文字複製'); }
        },
      }, '複製連結'),
    ),
    actions: [{ label: '關閉', value: true }],
  });
}

// ---------- 新增 / 編輯景點 ----------
async function addSpot(tripId) {
  const name = await promptDialog('景點名稱', { placeholder: '例：奈良公園', okLabel: '新增' });
  if (!name) return;
  const t = store.get(tripId);
  const spots = store.spotsOf(tripId);
  const maxDay = spots.reduce((m, s) => Math.max(m, s.day || 1), 1);
  const { spots: gs, quests: gq } = await generateForTrip({ tripId, itineraryText: name, region: t.region || '' });
  const spot = gs[0] || { id: uuid(), type: 'spot', tripId, name, day: maxDay, order: spots.length };
  spot.day = maxDay;
  spot.order = spots.length;
  await store.put(spot);
  for (const q of gq) { q.spotId = spot.id; await store.put(q); }
  toast(`已新增「${spot.name}」，${gq.length} 個任務`);
  navigate(`/trip/${tripId}/spot/${spot.id}`);
}

// ---------- 行程設定 ----------
export function settings(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '行程設定' });

  const geoToggle = h('input', { type: 'checkbox', checked: !!t.allowGeo });
  geoToggle.addEventListener('change', () => {
    store.patch(tripId, { allowGeo: geoToggle.checked });
    toast(geoToggle.checked ? '之後匯入的照片會記錄 GPS 位置' : '已停止記錄照片位置');
  });

  const wikiToggle = h('input', { type: 'checkbox', checked: !!t.allowWiki });
  wikiToggle.addEventListener('change', () => {
    store.patch(tripId, { allowWiki: wikiToggle.checked });
    toast(wikiToggle.checked ? '景點頁會嘗試從維基百科抓參考照片' : '已關閉維基百科查詢');
  });

  render(h('div', { class: 'page form' },
    settingRow('行程名稱', h('button', { class: 'btn btn-soft', onclick: async () => {
      const v = await promptDialog('行程名稱', { value: t.title });
      if (v) { store.patch(tripId, { title: v }); toast('已更新'); settings(tripId); }
    } }, '重新命名')),

    settingRow('旅伴', memberEditor(t.groupId)),

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', {}, '記錄照片拍攝位置'),
        h('div', { class: 'form-hint' }, '預設關閉。開啟後，之後匯入的照片會保留 GPS 座標（僅存在本機，用於相簿地圖）。照片本身一律不會上傳。')),
      geoToggle),

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', {}, '維基百科參考照片'),
        h('div', { class: 'form-hint' }, '預設關閉。開啟後，非精選景點會向 zh.wikipedia.org 查詢一張示意圖與座標（只送景點名稱）。')),
      wikiToggle),

    settingRow('重新產生任務', h('button', { class: 'btn btn-soft', onclick: () => regenerate(tripId) }, '依目前景點重出')),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        toast('打包中…可能要幾秒');
        const blob = await exportBundle(tripId);
        downloadBlob(blob, `${t.title || 'trip'}.tripquest.json`);
      } }, '⬇️ 匯出完整備份（含照片）'),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog(`確定刪除「${t.title}」？照片也會一併刪除，無法復原。`, { danger: true, okLabel: '刪除' })) {
          for (const q of store.questsOfTrip(tripId)) {
            for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
          }
          for (const s of store.spotsOf(tripId)) await store.remove(s.id);
          for (const q of store.questsOfTrip(tripId)) await store.remove(q.id);
          await store.remove(tripId);
          toast('已刪除');
          navigate('/', { replace: true });
        }
      } }, '🗑️ 刪除這個行程'),
    ),
  ));
}

function settingRow(label, control) {
  return h('div', { class: 'setting-row' }, h('span', {}, label), control);
}

function memberEditor(groupId) {
  const wrap = h('div', { class: 'chip-input' });
  const draw = () => {
    const members = store.membersOf(groupId);
    wrap.replaceChildren(
      ...members.map((m) => h('span', { class: 'chip' }, m.displayName,
        h('button', { class: 'chip-x', onclick: async () => {
          if (store.submissionsOfTrip(store.trips().find((x) => x.groupId === groupId)?.id || '').some((s) => s.memberId === m.id)) {
            if (!await confirmDialog(`${m.displayName} 已有照片投稿，移除後那些照片會標為「未指定」。要繼續嗎？`)) return;
          }
          await store.remove(m.id);
          draw();
        } }, '×'))),
      h('button', { class: 'chip chip-add', onclick: async () => {
        const name = await promptDialog('旅伴名字', { okLabel: '加入' });
        if (name) { await store.put({ id: uuid(), type: 'member', groupId, displayName: name }); draw(); }
      } }, '＋ 加人'),
    );
  };
  draw();
  return wrap;
}

async function regenerate(tripId) {
  if (!await confirmDialog('會依現有景點名稱重新出題。你自訂或編輯過的任務會保留，重複的不會重加。')) return;
  const t = store.get(tripId);
  let added = 0;
  for (const s of store.spotsOf(tripId)) {
    const existing = store.questsOf(s.id);
    if (s.source === 'curated') continue;
    const type = s.inferredType || inferType(s.name);
    const fresh = templateQuests(s.name, type);
    for (const q of fresh) {
      if (existing.some((e) => e.title === q.title)) continue;
      await store.put({ id: uuid(), type: 'quest', tripId, spotId: s.id, title: q.title, hint: q.hint, kind: q.kind, source: 'template', order: existing.length + added, refImage: null });
      added++;
    }
  }
  toast(added ? `新增了 ${added} 個任務` : '沒有可補的任務');
  void t;
  navigate(`/trip/${tripId}`);
}
