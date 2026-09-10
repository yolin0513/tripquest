// 每個行程的「自帶金鑰」設定卡（用在「旅程設定」）：AI（Claude／Google 語音）與
// 地圖（Google Routes）兩張。只有行程建立者這台手機看得到金鑰輸入；
// 其他人只看到「由建立者提供」。
//
// 地圖金鑰刻意**獨立於 AI 開關**：想查大眾運輸班次的人不一定想開 AI 加值。

import * as store from '../store.js';
import { h, toast, modal, confirmDialog } from '../ui.js';
import { myDeviceId } from '../identity.js';
import { getTripKey, setTripKey, clearTripKey, usageOf, looksLikeAnthropicKey, looksLikeGoogleKey, maskKey, MAPS_CAP_DEFAULT } from '../aikeys.js';
import { aiTestKey, aiTestTtsKey } from '../ai.js';

export function isTripCreator(trip) {
  if (!trip) return false;
  if (!trip.createdByDevice) return true;        // 舊行程沒記錄 → 放行
  return trip.createdByDevice === myDeviceId();
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
      'AI 可以幫沒有內建資料的景點補一句在地介紹、幫回憶影片寫旁白。' +
      (creator ? '要用的話，貼上你自己的 API 金鑰（只存這台手機，旅伴看不到）。' : '這趟的 AI 由建立者提供，你會直接看到成果。')));

    // 開關（建立者才能改；同步旗標）
    if (creator) {
      kids.push(h('label', { class: 'switch-row' },
        h('div', {}, h('div', { style: 'font-weight:700' }, '為這趟開啟 AI 加值'),
          h('div', { class: 'form-hint' }, '預設關閉。關閉時一切照舊、不會有任何花費。')),
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
          h('div', {}, h('div', { style: 'font-weight:700' }, '文字金鑰（Claude）'),
            h('div', { class: 'form-hint mono' }, maskKey(k.key))),
          h('button', { class: 'btn btn-soft sm-btn', onclick: () => pasteKey(tripId, 'anthropic', draw) }, '更換')));

        // 用量
        const pct = u && u.capUsd ? Math.min(100, (u.usedUsd / u.capUsd) * 100) : 0;
        kids.push(
          h('div', { class: 'storage-bar', style: 'margin-top:6px' }, h('i', { style: `width:${pct}%` })),
          h('p', { class: 'sm muted' }, `這台手機這趟已用約 $${(u ? u.usedUsd : 0).toFixed(3)} / 上限 $${(u ? u.capUsd : 2).toFixed(2)}`
            + (u && u.overCap ? '（已達上限，AI 暫停）' : '')),
          h('button', { class: 'btn btn-ghost sm-btn', onclick: () => setCap(tripId, draw) }, '調整上限'),
        );

        // TTS（選用）
        kids.push(h('div', { class: 'setting-row' },
          h('div', {}, h('div', { style: 'font-weight:700' }, '語音金鑰（Google，選用）'),
            h('div', { class: 'form-hint mono' }, k.ttsKey ? maskKey(k.ttsKey) : '未設定（旁白就用文字，不唸出來）')),
          h('button', { class: 'btn btn-soft sm-btn', onclick: () => pasteKey(tripId, 'google', draw) }, k.ttsKey ? '更換' : '貼上')));

        kids.push(h('button', {
          class: 'btn btn-danger btn-block', style: 'margin-top:10px',
          onclick: async () => {
            if (await confirmDialog('清除這個行程的 AI 金鑰？\n\n已經產生的介紹句、旁白會留著。\n提醒：本機刪除不等於停用金鑰——若擔心外流，請也到 Anthropic 網站把這把金鑰停用（Delete）。', { danger: true, okLabel: '清除金鑰' })) {
              await clearTripKey(tripId); toast('已清除'); draw();
            }
          },
        }, '🔑 清除這個行程的金鑰'));
      } else {
        kids.push(h('button', { class: 'btn btn-primary btn-block', onclick: () => pasteKey(tripId, 'anthropic', draw) }, '＋ 貼上我的 Claude API 金鑰'));
        kids.push(h('p', { class: 'form-hint' }, '還沒有金鑰？到 console.anthropic.com 申請，建議建一把「專用」的、在 Billing 設每月上限（例如 US$5）。'));
      }

      kids.push(h('p', { class: 'form-hint' }, '⚠ 金鑰只存在這支手機的瀏覽器，不會同步、不會進備份、不會出現在邀請連結。換手機要重新貼。'));
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

async function pasteKey(tripId, provider, refresh) {
  const isMaps = provider === 'maps';
  const isG = provider === 'google' || isMaps;
  const field = h('input', {
    class: 'field mono', type: 'password', autocomplete: 'off', spellcheck: false,
    placeholder: isG ? 'AIza...' : 'sk-ant-...',
  });
  const pasteBtn = h('button', { class: 'btn btn-soft', type: 'button', onclick: async () => {
    try { field.value = (await navigator.clipboard.readText()).trim(); } catch { toast('請直接長按貼上'); }
  } }, '📋 貼上');
  const status = h('p', { class: 'form-hint' }, '');

  const res = await modal({
    title: isMaps ? '貼上 Google 地圖金鑰' : (isG ? '貼上 Google 語音金鑰' : '貼上 Claude API 金鑰'),
    body: h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 10px' },
        '這把鑰匙只會存在這支手機，旅伴看不到，也不會上傳到任何地方。'),
      h('div', { class: 'numpad-row' }, field, pasteBtn),
      status,
      h('p', { class: 'form-hint' }, isMaps
        ? '在 Google Cloud 啟用「Routes API」與「Places API (New)」後建立金鑰，並加「HTTP 參照網址」限制到這個網站。'
          + '如果你的語音金鑰同一個專案、也啟用了 Routes API，貼同一把就可以。'
        : (isG
          ? '在 Google Cloud 建立 API 金鑰，建議加「HTTP 參照網址」限制到你的網站。'
          : 'sk-ant- 開頭那一長串。建議用專用金鑰並在 Billing 設每月上限。')),
    ),
    actions: [{ label: '取消', value: null }, { label: '測試並儲存', value: 'save', primary: true }],
  });
  if (res !== 'save') return;
  const val = field.value.trim();
  if (!val) { toast('沒有貼上東西'); return; }
  if (isG && !looksLikeGoogleKey(val)) { toast('看起來不像 Google 金鑰（AIza 開頭）'); return; }
  if (!isG && !looksLikeAnthropicKey(val)) { toast('看起來不像 Claude 金鑰（sk-ant- 開頭）'); return; }

  toast('測試中…');
  const t = isMaps ? await (await import('../transit.js')).testMapsKey(val)
    : (isG ? await aiTestTtsKey(val) : await aiTestKey(val));
  if (!t.ok) { toast(t.message); return; }
  await setTripKey(tripId, isMaps ? { mapsKey: val } : (isG ? { ttsKey: val } : { key: val }));
  toast(t.message);
  refresh();
}

async function setCap(tripId, refresh) {
  const { promptDialog } = await import('../ui.js');
  const u = await usageOf(tripId);
  const v = await promptDialog('這個行程的 AI 每月上限（美金）', { value: String(u ? u.capUsd : 2) });
  if (v === null) return;
  const n = Math.max(0.5, Math.min(50, parseFloat(v) || 2));
  await setTripKey(tripId, { capUsd: n });
  toast(`上限設為 $${n.toFixed(2)}`);
  refresh();
}

// ---------- 地圖加值（Google Routes，v1.68）----------
// 跟 AI 加值分開：這裡不需要 Claude 金鑰、也不看 aiEnabled 開關。
export function mapsConfigCard(tripId) {
  const card = h('div', { class: 'card about' });
  const creator = isTripCreator(store.get(tripId));

  const draw = async () => {
    const kids = [];
    kids.push(h('p', { class: 'sm muted' },
      '開啟後：「調整行程」每一天多一顆「🚆 大眾運輸」（實際班次、轉乘、步行時間）；'
      + '「找附近 → 停車場」多一顆「🔍 用 Google 再查一次」。'
      + (creator ? '' : '這趟由建立者提供。')));
    if (!creator) { card.replaceChildren(...kids); return; }

    const k = await getTripKey(tripId);
    const u = await usageOf(tripId);
    if (k && k.mapsKey) {
      kids.push(h('div', { class: 'setting-row' },
        h('div', {}, h('div', { style: 'font-weight:700' }, '地圖金鑰（Google）'),
          h('div', { class: 'form-hint mono' }, maskKey(k.mapsKey))),
        h('button', { class: 'btn btn-soft sm-btn', onclick: () => pasteKey(tripId, 'maps', draw) }, '更換')));
      const used = u ? u.mapsUsed : 0, cap = u ? u.mapsCap : MAPS_CAP_DEFAULT;
      kids.push(
        h('div', { class: 'storage-bar', style: 'margin-top:6px' },
          h('i', { style: `width:${Math.min(100, cap ? (used / cap) * 100 : 0)}%` })),
        // 用次數不用美金：免費額度是「每月幾千次」，換算成美金永遠是 $0，講了等於沒講
        h('p', { class: 'sm muted' }, `這個月已查 ${used} 次 / 上限 ${cap} 次`
          + (used >= cap ? '（已達上限，這個月先停）' : '')
          + '。Google 每月有數千次免費額度，這個上限是防止程式跑迴圈用的保險絲。'),
        h('button', { class: 'btn btn-ghost sm-btn', onclick: () => setMapsCap(tripId, draw) }, '調整上限'),
        h('button', { class: 'btn btn-danger btn-block', style: 'margin-top:10px', onclick: async () => {
          if (await confirmDialog('清除這個行程的地圖金鑰？\n\n大眾運輸查詢會停用，開車估算照舊。', { danger: true, okLabel: '清除' })) {
            await setTripKey(tripId, { mapsKey: '' }); toast('已清除'); draw();
          }
        } }, '🔑 清除地圖金鑰'));
    } else {
      kids.push(h('button', { class: 'btn btn-primary btn-block', onclick: () => pasteKey(tripId, 'maps', draw) },
        '＋ 貼上我的 Google 地圖金鑰'));
      kids.push(h('p', { class: 'form-hint' },
        '沒有金鑰也完全不影響 —— 移動時間照樣用開放路網（OSRM）估算，只是沒有大眾運輸班次。'));
    }
    kids.push(h('p', { class: 'form-hint' }, '⚠ 金鑰只存在這支手機的瀏覽器，不會同步、不會進備份、不會出現在邀請連結。'));
    card.replaceChildren(...kids);
  };
  draw();
  return card;
}

async function setMapsCap(tripId, refresh) {
  const { promptDialog } = await import('../ui.js');
  const u = await usageOf(tripId);
  const v = await promptDialog('這個行程每月最多查幾次大眾運輸？', { value: String(u ? u.mapsCap : MAPS_CAP_DEFAULT) });
  if (v === null) return;
  const n = Math.max(10, Math.min(5000, parseInt(v, 10) || MAPS_CAP_DEFAULT));
  await setTripKey(tripId, { mapsCap: n });
  toast(`上限設為 ${n} 次`);
  refresh();
}
