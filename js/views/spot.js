// 景點設定頁 —— 只做四件事：改名字、幾點到、停留多久、刪掉它。
//
// 這頁本來還有示意圖、介紹文字、「用地圖帶我去」、任務清單與加照片按鈕。
// 全部拿掉了，因為那些在別的地方都已經有，而且更靠近使用者真正在做事的地方：
//   · 任務與加照片 → 行程頁的任務列（v1.41 起收合狀態就有 📷🖼️）
//   · 地圖         → 景點標題列右邊的 🗺️ 圖示
//   · 加任務／改任務 → 「調整每天的行程」的「✏️ 改任務」（有新增、編輯、刪除）
// 同一件事散在兩三個地方，長輩只會更難找。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, modal, promptDialog, confirmDialog } from '../ui.js';
import { navigate, back } from '../router.js';
import { enrichSpot } from '../enrich.js';
import { spotTimes, stayOptions } from '../spottime.js';

export default async function spot(tripId, spotId) {
  const s = store.get(spotId);
  const t = store.get(tripId);
  if (!s || !t) { navigate('/', { replace: true }); return; }

  setTop({ title: '景點設定' });

  const quests = store.questsOf(spotId);
  const photoCount = quests.reduce((n, q) => n + store.submissionsOf(q.id).length, 0);
  const tm = spotTimes(s);

  const nameField = h('input', {
    class: 'field', type: 'text', value: s.name || '', maxlength: 40, placeholder: '景點名稱',
  });

  // 「幾點到」跟搜尋頁同一套：時/分 雙下拉，預設「未設定」→ 沒動就存 null。
  // iOS 的原生 time input 在空值時會把「當下時間」畫在欄位上（v1.51.5 修過搜尋頁，
  // 這頁是同族問題）。匯入的時間可能是 13:05 這種不在固定選項裡的分鐘，補成選項。
  const curH = Number.isFinite(tm.startMin) ? Math.floor(tm.startMin / 60) : null;
  const curM = Number.isFinite(tm.startMin) ? tm.startMin % 60 : null;
  const minOpts = [...new Set([0, 5, 10, 15, 20, 30, 40, 45, 50, ...(curM != null ? [curM] : [])])].sort((a, b) => a - b);
  const hourSel = h('select', { class: 'field' },
    h('option', { value: '', selected: curH == null }, '未設定'),
    ...Array.from({ length: 24 }, (_, hh) => h('option', { value: hh, selected: hh === curH }, `${hh} 時`)));
  const minSel = h('select', { class: 'field', disabled: curH == null },
    ...minOpts.map((mm) => h('option', { value: mm, selected: mm === (curM ?? 0) }, `${String(mm).padStart(2, '0')} 分`)));
  hourSel.addEventListener('change', () => { minSel.disabled = hourSel.value === ''; });
  const pickedMin = () => (hourSel.value === '' ? null : (+hourSel.value) * 60 + (+minSel.value || 0));

  // 位置：路線圖靠這個。查不到的店家可以手動貼 Google 地圖連結或座標。
  const posLine = h('div', { class: 'form-hint', style: 'margin:2px 0 8px' });
  const drawPos = () => {
    const cur = store.getRaw(spotId);
    posLine.textContent = cur.lat != null
      ? `已有位置（${{ photo: '來自照片', osm: '地名查詢', manual: '手動設定' }[cur.geoSrc] || '景點資料庫'}）`
      : '還沒有位置 —— 路線圖上看不到這個點';
  };
  const posBtns = h('div', { class: 'row2', style: 'margin-bottom:4px' },
    h('button', { class: 'btn btn-soft', onclick: async () => {
      toast('查詢中…');
      try {
        const { locateSpot } = await import('../geocode.js');
        const cur = store.getRaw(spotId);
        const r = await locateSpot(cur, { region: t.region || '' });
        if (!r) { toast('查不到這個名字的位置，可以改用「貼座標」'); return; }
        await store.patch(spotId, { lat: r.lat, lng: r.lng, geoSrc: r.src });
        drawPos(); toast('找到了，已存位置');
      } catch (e) { toast('查詢失敗：' + e.message); }
    } }, '🔍 查位置'),
    h('button', { class: 'btn btn-soft', onclick: async () => {
      const v = await promptDialog('貼上座標（例如 24.677, 121.767）或 Google 地圖的連結：', { placeholder: '24.677, 121.767' });
      if (!v) return;
      const { parseCoordInput } = await import('../geocode.js');
      const c = parseCoordInput(v);
      if (!c) { toast('看不懂這個內容 —— 要有「緯度, 經度」兩個數字'); return; }
      await store.patch(spotId, { lat: c.lat, lng: c.lng, geoSrc: 'manual' });
      drawPos(); toast('已存位置');
    } }, '📋 貼座標'),
  );
  const posClear = h('button', { class: 'btn btn-ghost btn-block', onclick: async () => {
    if (!(await confirmDialog('要清掉這個景點的位置嗎？路線圖上會看不到它。', { danger: true, okLabel: '清除' }))) return;
    await store.patch(spotId, { lat: null, lng: null, geoSrc: null });
    drawPos(); toast('已清除位置');
  } }, '清除位置');
  drawPos();
  const stayField = h('select', { class: 'field spot-stay' },
    ...stayOptions(tm.stayMin).map((o) =>
      h('option', { value: o.v, selected: String(tm.stayMin || '') === o.v }, o.label)));

  const save = async () => {
    const name = nameField.value.trim();
    if (!name) { toast('名字不能空白'); nameField.focus(); return; }
    const startMin = pickedMin();
    const stayMin = stayField.value ? parseInt(stayField.value, 10) : null;
    const renamed = name !== s.name;
    await store.patch(spotId, {
      name,
      startMin, stayMin,
      // 舊的字串欄位清掉，只留一套，免得海報／回顧讀到過期的值
      startTime: '', endTime: '',
      // 改了名字就重新去找示意圖（原本那張是照舊名字抓的）
      ...(renamed ? { _enrichV: 0, _noHero: false } : {}),
    });
    if (renamed) enrichSpot(store.getRaw(spotId)).catch(() => {});
    // 改了時間 → 檢查有沒有任務跟新時段不合（例：改成早上、任務卻是「夜裡點燈」）。
    // 已拍照片的任務絕不動；使用者不換也尊重（提示一次，不強迫）。
    if (startMin !== tm.startMin || stayMin !== tm.stayMin) {
      await offerTimeFixQuests();
    }
    toast('已儲存');
    back(`/trip/${tripId}/plan`);
  };

  async function offerTimeFixQuests() {
    try {
      const { timeWindow, phraseOk } = await import('../quests/compose.js');
      const cur = store.getRaw(spotId);
      const win = timeWindow(cur);
      const clash = store.questsOf(spotId).filter((q) =>
        q.when && !phraseOk({ when: q.when }, win) && !store.submissionsOf(q.id).length);
      if (!clash.length) return;
      const ok = await confirmDialog(
        `有 ${clash.length} 個任務跟新的時間不太合（例如「${clash[0].title}」）。要換成合適時段的任務嗎？

已拍照片的任務不會動。`,
        { okLabel: '幫我換' });
      if (!ok) return;
      const { themedQuestsForSpot } = await import('../quests/generate.js');
      const fresh = await themedQuestsForSpot(cur, tripId);   // cur 已帶新時間 → 句型已過濾
      const keep = new Set(store.questsOf(spotId).map((q) => q.title));
      let i = 0;
      for (const q of clash) await store.remove(q.id);
      for (const nq of fresh) {
        if (i >= clash.length) break;
        if (keep.has(nq.title)) continue;
        const { uuid } = await import('../ids.js');
        await store.put({
          id: uuid(), type: 'quest', tripId, spotId,
          title: nq.title, hint: nq.hint, kind: nq.kind || 'view',
          source: 'template', when: nq.when || null, order: clash[i].order ?? 0, refImage: null,
        });
        i++;
      }
      toast('已換上合適時段的任務');
    } catch { /* 換不成就算了，儲存本身不受影響 */ }
  }

  const del = async () => {
    const lines = [`「${s.name}」會從行程裡移除。`];
    if (quests.length) lines.push(`連同 ${quests.length} 個拍照任務`);
    if (photoCount) lines.push(`以及已經拍的 ${photoCount} 張照片`);
    lines.push(quests.length || photoCount ? '一起刪掉，而且救不回來。' : '這個景點還沒有任務或照片。');
    const ok = await modal({
      title: '要刪掉這個景點嗎？',
      body: h('div', {},
        h('div', { class: 'del-warn' },
          h('p', { style: 'margin:0 0 6px;font-weight:800' }, lines[0]),
          ...lines.slice(1).map((x) => h('p', { style: 'margin:0 0 4px' }, x))),
        photoCount
          ? h('p', { class: 'sm muted', style: 'margin:12px 0 0' },
            '想留照片的話，先到「照片」那一頁看過再刪。')
          : null,
      ),
      actions: [
        { label: '不要，我再想想', value: false },
        { label: photoCount ? `還是刪掉（含 ${photoCount} 張照片）` : '刪掉', value: true, danger: true },
      ],
    });
    if (!ok) return;
    for (const q of quests) {
      for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
      await store.remove(q.id);
    }
    await store.remove(spotId);
    toast('已刪除');
    navigate(`/trip/${tripId}/plan`, { replace: true });
  };

  render(h('div', { class: 'page form compact' },
    field('景點名稱', nameField),
    field('幾點到', h('div', { class: 'spot-time-row' },
      h('div', { class: 'fs-hm spot-time' }, hourSel, minSel),
      h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { hourSel.value = ''; minSel.disabled = true; },
      }, '清除'))),
    field('停留多久', stayField),
    h('div', { class: 'form-field' },
      h('span', { class: 'form-label' }, '地圖位置'),
      posLine, posBtns, posClear),

    h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:18px', onclick: save }, '儲存'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => back(`/trip/${tripId}/plan`) }, '取消'),

    h('div', { class: 'danger-zone', style: 'margin-top:22px' },
      h('button', { class: 'btn btn-danger btn-block', onclick: del }, '🗑️ 刪除這個景點'),
    ),
  ));
}

function field(label, control) {
  return h('label', { class: 'form-field' }, h('span', { class: 'form-label' }, label), control);
}
