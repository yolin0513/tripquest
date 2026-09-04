import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, toast, confirmDialog, promptDialog, modal, fmtDate, avatar, KIND_META } from '../ui.js';
import { navigate, back } from '../router.js';
import { uuid, hashHue } from '../ids.js';
import { shareURL, exportBundle, downloadBlob, nativeShare } from '../share.js';
import { generateForTrip, templateQuests, inferType } from '../quests/generate.js';
import { blobURL } from '../photos.js';
import { enrichTrip } from '../enrich.js';
import { activeMemberId, ensureMember } from '../claim.js';

export default async function trip(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }

  setTop({
    title: t.title,
    action: { icon: '⚙️', label: '旅程設定', onClick: () => navigate(`/trip/${tripId}/settings`) },
  });

  const prog = store.tripProgress(tripId);
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(t.groupId);
  const allDone = prog.total > 0 && prog.done === prog.total;

  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  const container = h('div', { class: 'page' },
    h('div', { class: 'progress-banner' },
      h('div', { class: 'pb-text' },
        h('div', { class: 'pb-title' }, allDone ? '全部完成了！🎉' : `已完成 ${prog.done} / ${prog.total}`),
        h('div', { class: 'pb-sub' }, allDone ? '可以做回憶影片了' : (prog.done === 0 ? '開始拍第一張吧' : '繼續加油！')),
        h('div', { class: 'progress-track' }, h('i', { style: `width:${Math.round(prog.ratio * 100)}%` })),
      ),
      ring(prog.ratio, { size: 64, label: `${prog.done}/${prog.total}` }),
    ),

    members.length ? h('div', { class: 'avatars pad-x', style: 'margin:12px 0' },
      ...members.map((m) => avatar(m.displayName, hashHue(m.id)))) : null,

    // 同步的旅程、還沒說「我是誰」→ 提示（點一下就好，非強制）
    (store.getRaw(t.groupId)?.syncSecret && !activeMemberId(tripId) && members.length > 1)
      ? h('button', {
          class: 'btn btn-soft btn-block', style: 'border-color:var(--primary)',
          onclick: async () => { await ensureMember(tripId, { force: true }); trip(tripId); },
        }, '👋 告訴大家你是誰（拍照前先選一次）')
      : null,

    h('div', { class: 'stack', style: 'margin-top:6px' },
      h('button', { class: 'btn btn-soft btn-block btn-big', onclick: () => navigate(`/trip/${tripId}/people`) },
        '📸 看照片牆 / 幫旅伴按讚'),
      h('button', {
        class: 'btn btn-block btn-big ' + (allDone ? 'btn-primary' : 'btn-soft is-locked'),
        onclick: () => allDone ? navigate(`/trip/${tripId}/album`) : toast(`還有 ${prog.total - prog.done} 個任務就能做影片`),
      }, allDone ? '🎬 製作回憶影片' : `🔒 回憶影片（還差 ${prog.total - prog.done} 個）`),
      h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/poster`) }, '🎨 做一張行程海報'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => doShare(tripId) }, '🔗 把任務分享給旅伴'),
    ),
  );

  if (spots.length === 0) {
    container.append(h('div', { class: 'empty' }, h('p', {}, '這個旅程還沒有景點'),
      h('button', { class: 'btn btn-primary', onclick: () => addSpot(tripId) }, '＋ 新增景點')));
  } else {
    for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      const sec = h('section', { class: 'day-group' }, h('h3', { class: 'day-title' }, `第 ${day} 天`));
      for (const s of list) {
        sec.append(h('div', { class: 'section-label', style: 'margin:16px 2px 8px;display:flex;justify-content:space-between;align-items:center' },
          h('span', {}, `${s.emoji || '📍'} ${s.name}`),
          h('button', {
            class: 'tag', style: 'cursor:pointer',
            onclick: () => navigate(`/trip/${tripId}/spot/${s.id}`),
          }, '編輯'),
        ));
        for (const q of store.questsOf(s.id)) sec.append(questBigCard(q, s));
      }
      container.append(sec);
    }
    container.append(h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:20px', onclick: () => addSpot(tripId) }, '＋ 新增景點'));
  }

  render(container);

  // 背景補景點示意圖，回來後重繪一次
  if (t.allowWiki !== false && spots.some((s) => !s._enriched)) {
    enrichTrip(tripId).then(() => {
      if (location.hash.includes(`/trip/${tripId}`) && !location.hash.includes('/spot/')) trip(tripId);
    }).catch(() => {});
  }
}

function questBigCard(q, spot) {
  const done = store.isQuestDone(q.id);
  const subs = store.submissionsOf(q.id);
  const km = KIND_META[q.kind] || KIND_META.thing;
  const likeCount = subs.reduce((n, s) => n + store.reactionsOf(s.id).length, 0);

  const photo = h('div', { class: 'qbig-photo' + (spot.heroHash ? ' has-img' : '') },
    h('span', { class: 'qbig-emoji' }, km.icon),
    done ? h('span', { class: 'qbig-check' }, '✓') : null,
  );
  if (spot.heroHash) blobURL(spot.heroHash).then((u) => { if (u) photo.style.backgroundImage = `url("${u}")`; });
  else if (subs[0]) blobURL(subs[0].thumbHash).then((u) => { if (u) { photo.style.backgroundImage = `url("${u}")`; photo.classList.add('has-img'); } });

  return h('button', {
    class: 'qbig' + (done ? ' done' : ''),
    onclick: () => navigate(`/quest/${q.id}`),
  },
    photo,
    h('div', { class: 'qbig-body' },
      h('div', { class: 'qbig-title' }, q.title),
      q.hint ? h('div', { class: 'qbig-hint' }, q.hint) : null,
      h('div', { class: 'qbig-foot' },
        h('span', { class: 'tag' }, km.label),
        h('span', { class: 'qbig-status' }, done ? `✓ 完成（${subs.length} 張）` : '還沒拍'),
        likeCount ? h('span', { class: 'qbig-likes' }, '❤️ ' + likeCount) : null,
      ),
    ),
  );
}

// ---------- 分享 ----------
async function doShare(tripId) {
  toast('產生分享連結中…');
  const url = await shareURL(tripId);
  if (await nativeShare({ title: 'TripQuest 拍照任務', text: '一起來完成這趟旅程的拍照任務！', url })) return;
  await modal({
    title: '分享給旅伴',
    body: h('div', {},
      h('p', { class: 'sm muted' }, '把連結傳給旅伴，他們打開就有一樣的任務清單。（不含照片）'),
      h('textarea', { class: 'field mono', rows: 4, readonly: true, onclick: (e) => e.target.select() }, url),
      h('button', {
        class: 'btn btn-primary btn-block', onclick: async () => {
          try { await navigator.clipboard.writeText(url); toast('已複製'); } catch { toast('請長按上面文字複製'); }
        },
      }, '複製連結'),
    ),
    actions: [{ label: '關閉', value: true }],
  });
}

// ---------- 新增景點 ----------
async function addSpot(tripId) {
  const name = await promptDialog('景點名稱', { placeholder: '例：奈良公園', okLabel: '新增' });
  if (!name) return;
  const t = store.get(tripId);
  const spots = store.spotsOf(tripId);
  const maxDay = spots.reduce((m, s) => Math.max(m, s.day || 1), 1);
  const { spots: gs, quests: gq } = await generateForTrip({ tripId, itineraryText: name, region: t.region || '' });
  const spot = gs[0] || { id: uuid(), type: 'spot', tripId, name, day: maxDay, order: spots.length };
  spot.day = maxDay; spot.order = spots.length;
  await store.put(spot);
  for (const q of gq) { q.spotId = spot.id; await store.put(q); }
  toast(`已新增「${spot.name}」`);
  enrichTrip(tripId).catch(() => {});
  navigate(`/trip/${tripId}`);
}

// ---------- 旅程設定 ----------
export function settings(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '旅程設定' });

  const geoToggle = h('input', { type: 'checkbox', checked: !!t.allowGeo });
  geoToggle.addEventListener('change', async () => {
    await store.patch(tripId, { allowGeo: geoToggle.checked });
    if (!geoToggle.checked) {
      // 關閉時，把已存的座標清掉（回頭尊重意願）
      let n = 0;
      for (const sub of store.submissionsOfTrip(tripId)) {
        if (sub.gps) { const raw = store.getRaw(sub.id); raw.gps = null; const { putRecord } = await import('../db.js'); await putRecord(raw); n++; }
      }
      toast(n ? `已停止記錄位置，並清除 ${n} 張既有座標` : '已停止記錄位置');
    } else {
      toast('之後匯入的照片會記錄位置（只存本機、約 110 公尺精度）');
    }
  });

  const wikiToggle = h('input', { type: 'checkbox', checked: t.allowWiki !== false });
  wikiToggle.addEventListener('change', async () => {
    await store.patch(tripId, { allowWiki: wikiToggle.checked });
    toast(wikiToggle.checked ? '會抓景點示意圖' : '已關閉');
    if (wikiToggle.checked) enrichTrip(tripId).catch(() => {});
  });

  render(h('div', { class: 'page form' },
    settingRow('旅程名稱', h('button', { class: 'btn btn-soft', onclick: async () => {
      const v = await promptDialog('旅程名稱', { value: t.title });
      if (v) { store.patch(tripId, { title: v }); toast('已更新'); settings(tripId); }
    } }, '改名字')),

    settingRow('旅伴', memberEditor(tripId, t.groupId)),

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '景點示意圖'),
        h('div', { class: 'form-hint' }, '從維基百科抓一張「要拍的東西長怎樣」的參考圖（只送景點名稱、抓回後可離線看）。')),
      wikiToggle),

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '記錄照片位置'),
        h('div', { class: 'form-hint' }, '預設關閉。開啟後之後匯入的照片會保留 GPS（只存本機，用於相簿地圖）。照片一律不會上傳。')),
      geoToggle),

    settingRow('重新產生任務', h('button', { class: 'btn btn-soft', onclick: () => regenerate(tripId) }, '補齊')),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        toast('打包中…');
        const blob = await exportBundle(tripId);
        downloadBlob(blob, `${t.title || 'trip'}.tripquest.json`);
      } }, '⬇️ 匯出完整備份（含照片）'),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog(`確定刪除「${t.title}」？照片也會一起刪掉，無法復原。`, { danger: true, okLabel: '刪除' })) {
          for (const q of store.questsOfTrip(tripId)) for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
          for (const s of store.spotsOf(tripId)) await store.remove(s.id);
          for (const q of store.questsOfTrip(tripId)) await store.remove(q.id);
          await store.remove(tripId);
          toast('已刪除');
          navigate('/', { replace: true });
        }
      } }, '🗑️ 刪除這個旅程'),
    ),
  ));
}

function settingRow(label, control) {
  return h('div', { class: 'setting-row' }, h('span', { style: 'font-weight:700' }, label), control);
}

function memberEditor(tripId, groupId) {
  const wrap = h('div', { class: 'chip-input' });
  const draw = () => {
    wrap.replaceChildren(
      ...store.membersOf(groupId).map((m) => h('span', { class: 'chip' }, m.displayName,
        h('button', { class: 'chip-x', onclick: async () => {
          const used = store.submissionsOfTrip(tripId).some((s) => s.memberId === m.id);
          if (used && !await confirmDialog(`${m.displayName} 已有照片，移除後那些照片會標為「未指定」。要繼續嗎？`)) return;
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
  if (!await confirmDialog('會依現有景點補上任務。你改過或自訂的不會動，重複的不會重加。')) return;
  let added = 0;
  for (const s of store.spotsOf(tripId)) {
    if (s.source === 'curated') continue;
    const existing = store.questsOf(s.id);
    const fresh = templateQuests(s.name, s.inferredType || inferType(s.name));
    for (const q of fresh) {
      if (existing.some((e) => e.title === q.title)) continue;
      await store.put({ id: uuid(), type: 'quest', tripId, spotId: s.id, title: q.title, hint: q.hint, kind: q.kind, source: 'template', order: existing.length + added, refImage: null });
      added++;
    }
  }
  toast(added ? `補了 ${added} 個任務` : '沒有可補的');
  navigate(`/trip/${tripId}`, { replace: true });
}
