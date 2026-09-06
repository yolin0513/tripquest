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
import { h, toast, modal } from '../ui.js';
import { navigate, back } from '../router.js';
import { enrichSpot } from '../enrich.js';
import { spotTimes, stayOptions, minOfInput } from '../spottime.js';

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

  // 時間與停留沿用匯入流程那一套（原生時間選擇器 ＋ 下拉，非預設值也補成選項）
  const timeField = h('input', { class: 'field spot-time', type: 'time', value: tm.startTime });
  const stayField = h('select', { class: 'field spot-stay' },
    ...stayOptions(tm.stayMin).map((o) =>
      h('option', { value: o.v, selected: String(tm.stayMin || '') === o.v }, o.label)));

  const save = async () => {
    const name = nameField.value.trim();
    if (!name) { toast('名字不能空白'); nameField.focus(); return; }
    const startMin = minOfInput(timeField.value);
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
    toast('已儲存');
    back(`/trip/${tripId}/plan`);
  };

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
    field('幾點到', h('div', { class: 'spot-time-row' }, timeField,
      h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { timeField.value = ''; },
      }, '清除'))),
    field('停留多久', stayField),

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
