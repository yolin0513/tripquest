// 每個行程的「自帶金鑰」設定（用在「旅程設定」）：AI（Claude）與地圖（Google）兩張卡。
// 只有行程建立者這台手機看得到金鑰輸入；其他人只看到「由建立者提供」。
//
// 地圖金鑰刻意**獨立於 AI 開關**：想查大眾運輸班次的人不一定想開 AI 加值。
//
// 文案原則（v1.71 使用者回報「太囉嗦」後重寫）：
//   · 「金鑰只存這支手機」這句**整頁只講一次**（keyNotice()，由 trip.js 放在兩張卡下面），
//     不要每張卡、每個對話框各講一次。
//   · 每張卡開頭最多一句話，說「開了會多什麼」，不解釋原理。
//   · 只留「照著做得到」的步驟（去哪申請、要開哪個 API、要加什麼限制）。
//   · v1.71 移除語音（TTS）：Google 金鑰從兩把（語音／地圖）合併成唯一一把。

import * as store from '../store.js';
import { h, toast, modal, confirmDialog } from '../ui.js';
import { myDeviceId } from '../identity.js';
import { getTripKey, setTripKey, clearTripKey, usageOf, looksLikeAnthropicKey, looksLikeGoogleKey, maskKey, MAPS_CAP_DEFAULT } from '../aikeys.js';
import { aiTestKey } from '../ai.js';

export function isTripCreator(trip) {
  if (!trip) return false;
  if (!trip.createdByDevice) return true;        // 舊行程沒記錄 → 放行
  return trip.createdByDevice === myDeviceId();
}

// 整個設定區只出現一次的金鑰提示（trip.js 放在兩張卡的下面）
export function keyNotice() {
  return h('p', { class: 'form-hint' },
    '🔑 金鑰只存在這支手機，不會同步、不會進備份、不會出現在邀請連結。換手機要重新貼。');
}

// 回傳一個會自己更新的節點
export function aiConfigCard(tripId, refresh) {
  const trip = store.get(tripId);
  const card = h('div', { class: 'card about' });
  const creator = isTripCreator(trip);

  const draw = async () => {
    const t = store.get(tripId);
    const on = !!t.aiEnabled;
    const kids = [];

    kids.push(h('p', { class: 'sm muted' },
      creator
        ? '幫沒有內建資料的景點補一句介紹、幫回憶影片寫文案。要自己的 Claude 金鑰。'
        : '這趟的 AI 由建立者提供，你會直接看到成果。'));

    if (creator) {
      kids.push(h('label', { class: 'switch-row' },
        h('div', { style: 'font-weight:700' }, '為這趟開啟'),
        checkbox(on, async (v) => { await store.patch(tripId, { aiEnabled: v }); draw(); })));
    } else {
      kids.push(h('div', { class: 'setting-row' },
        h('span', { style: 'font-weight:700' }, 'AI 加值'),
        h('span', { class: 'tag ' + (on ? 'tag-ok' : 'tag-todo') }, on ? '已開啟' : '未開啟')));
    }

    if (on && creator) {
      const k = await getTripKey(tripId);
      const u = await usageOf(tripId);

      if (k && k.key) {
        kids.push(h('div', { class: 'setting-row' },
          h('div', {}, h('div', { style: 'font-weight:700' }, 'Claude 金鑰'),
            h('div', { class: 'form-hint mono' }, maskKey(k.key))),
          h('button', { class: 'btn btn-soft sm-btn', onclick: () => pasteKey(tripId, 'anthropic', draw) }, '更換')));

        const pct = u && u.capUsd ? Math.min(100, (u.usedUsd / u.capUsd) * 100) : 0;
        kids.push(
          h('div', { class: 'storage-bar', style: 'margin-top:6px' }, h('i', { style: `width:${pct}%` })),
          h('p', { class: 'sm muted' }, `已用 $${(u ? u.usedUsd : 0).toFixed(3)} / 上限 $${(u ? u.capUsd : 2).toFixed(2)}`
            + (u && u.overCap ? '（已達上限，暫停）' : '')),
          h('div', { class: 'key-acts' },
            h('button', { class: 'btn btn-ghost sm-btn', onclick: () => setCap(tripId, draw) }, '調整上限'),
            h('button', { class: 'btn btn-ghost sm-btn', onclick: async () => {
              if (await confirmDialog('清除這台手機上的 Claude 金鑰？\n\n已產生的內容會留著。\n本機刪除不等於停用 —— 擔心外流請到 Anthropic 網站 Delete。',
                { danger: true, okLabel: '清除' })) {
                await clearTripKey(tripId); toast('已清除'); draw();
              }
            } }, '🔑 清除')),
        );
      } else {
        kids.push(h('button', { class: 'btn btn-primary btn-block', onclick: () => pasteKey(tripId, 'anthropic', draw) }, '＋ 貼上 Claude 金鑰'));
        kids.push(h('p', { class: 'form-hint' }, 'console.anthropic.com 申請，建議建專用的一把並設 Billing 上限。'));
      }
    }

    card.replaceChildren(...kids);
  };
  draw();
  return card;
}

function checkbox(checked, onChange) {
  const el = h('input', { type: 'checkbox', checked });
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

// ---------- 地圖加值（Google，v1.68；v1.71 合併成唯一一把 Google 金鑰）----------
export function mapsConfigCard(tripId) {
  const card = h('div', { class: 'card about' });
  const creator = isTripCreator(store.get(tripId));

  const draw = async () => {
    const kids = [];
    kids.push(h('p', { class: 'sm muted' },
      creator
        ? '開了會多兩個功能：行程頁的「🚆 大眾運輸」查實際班次，找附近的停車場可以用 Google 再查一次。'
        : '這趟由建立者提供。'));
    if (!creator) { card.replaceChildren(...kids); return; }

    const k = await getTripKey(tripId);
    const u = await usageOf(tripId);
    if (k && k.mapsKey) {
      kids.push(h('div', { class: 'setting-row' },
        h('div', {}, h('div', { style: 'font-weight:700' }, 'Google 金鑰'),
          h('div', { class: 'form-hint mono' }, maskKey(k.mapsKey))),
        h('button', { class: 'btn btn-soft sm-btn', onclick: () => pasteKey(tripId, 'maps', draw) }, '更換')));
      const used = u ? u.mapsUsed : 0, cap = u ? u.mapsCap : MAPS_CAP_DEFAULT;
      kids.push(
        h('div', { class: 'storage-bar', style: 'margin-top:6px' },
          h('i', { style: `width:${Math.min(100, cap ? (used / cap) * 100 : 0)}%` })),
        // 用次數不用美金：免費額度是「每月幾千次」，換算成美金永遠是 $0，講了等於沒講
        h('p', { class: 'sm muted' }, `這個月 ${used} / ${cap} 次`
          + (used >= cap ? '（已達上限，這個月先停）' : '')),
        h('div', { class: 'key-acts' },
          h('button', { class: 'btn btn-ghost sm-btn', onclick: () => setMapsCap(tripId, draw) }, '調整上限'),
          h('button', { class: 'btn btn-ghost sm-btn', onclick: async () => {
            if (await confirmDialog('清除這台手機上的 Google 金鑰？\n\n大眾運輸會停用，開車估算照舊。', { danger: true, okLabel: '清除' })) {
              await setTripKey(tripId, { mapsKey: '' }); toast('已清除'); draw();
            }
          } }, '🔑 清除')),
      );
    } else {
      kids.push(h('button', { class: 'btn btn-primary btn-block', onclick: () => pasteKey(tripId, 'maps', draw) },
        '＋ 貼上 Google 金鑰'));
      kids.push(h('p', { class: 'form-hint' }, '沒有也照常用，只是沒有大眾運輸班次。'));
    }
    card.replaceChildren(...kids);
  };
  draw();
  return card;
}

// ---------- 貼上金鑰 ----------
async function pasteKey(tripId, provider, refresh) {
  const isMaps = provider === 'maps';
  const field = h('input', {
    class: 'field mono', type: 'password', autocomplete: 'off', spellcheck: false,
    placeholder: isMaps ? 'AIza...' : 'sk-ant-...',
  });
  const pasteBtn = h('button', { class: 'btn btn-soft', type: 'button', onclick: async () => {
    try { field.value = (await navigator.clipboard.readText()).trim(); } catch { toast('請直接長按貼上'); }
  } }, '📋 貼上');

  // 這裡不再重複「只存這支手機」—— 設定頁底下已經講過一次了
  const res = await modal({
    title: isMaps ? '貼上 Google 金鑰' : '貼上 Claude 金鑰',
    body: h('div', {},
      h('div', { class: 'numpad-row' }, field, pasteBtn),
      h('p', { class: 'form-hint' }, isMaps
        ? 'Google Cloud 要先啟用 Routes API 與 Places API (New)，並把金鑰的「HTTP 參照網址」限制到這個網站。'
        : 'sk-ant- 開頭那一長串。'),
    ),
    actions: [{ label: '取消', value: null }, { label: '測試並儲存', value: 'save', primary: true }],
  });
  if (res !== 'save') return;
  const val = field.value.trim();
  if (!val) { toast('沒有貼上東西'); return; }
  if (isMaps && !looksLikeGoogleKey(val)) { toast('看起來不像 Google 金鑰（AIza 開頭）'); return; }
  if (!isMaps && !looksLikeAnthropicKey(val)) { toast('看起來不像 Claude 金鑰（sk-ant- 開頭）'); return; }

  toast('測試中…');
  const t = isMaps ? await (await import('../transit.js')).testMapsKey(val) : await aiTestKey(val);
  if (!t.ok) { toast(t.message); return; }
  await setTripKey(tripId, isMaps ? { mapsKey: val } : { key: val });
  toast(t.message);
  refresh();
}

async function setCap(tripId, refresh) {
  const { promptDialog } = await import('../ui.js');
  const u = await usageOf(tripId);
  const v = await promptDialog('AI 每月上限（美金）', { value: String(u ? u.capUsd : 2) });
  if (v === null) return;
  const n = Math.max(0.5, Math.min(50, parseFloat(v) || 2));
  await setTripKey(tripId, { capUsd: n });
  toast(`上限設為 $${n.toFixed(2)}`);
  refresh();
}

async function setMapsCap(tripId, refresh) {
  const { promptDialog } = await import('../ui.js');
  const u = await usageOf(tripId);
  const v = await promptDialog('每月最多查幾次？', {
    value: String(u ? u.mapsCap : MAPS_CAP_DEFAULT),
    hint: 'Google 每月有數千次免費額度。這個上限是防止程式跑迴圈的保險絲，不是預算。',
  });
  if (v === null) return;
  const n = Math.max(10, Math.min(5000, parseInt(v, 10) || MAPS_CAP_DEFAULT));
  await setTripKey(tripId, { mapsCap: n });
  toast(`上限設為 ${n} 次`);
  refresh();
}
