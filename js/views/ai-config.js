// 每個行程的 AI 設定卡（用在「旅程設定」）。
// 只有行程建立者這台手機看得到金鑰輸入；其他人只看到「AI 由建立者提供」。

import * as store from '../store.js';
import { h, toast, modal, confirmDialog } from '../ui.js';
import { myDeviceId } from '../identity.js';
import { getTripKey, setTripKey, clearTripKey, usageOf, looksLikeAnthropicKey, looksLikeGoogleKey, maskKey } from '../aikeys.js';
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
  const isG = provider === 'google';
  const field = h('input', {
    class: 'field mono', type: 'password', autocomplete: 'off', spellcheck: false,
    placeholder: isG ? 'AIza...' : 'sk-ant-...',
  });
  const pasteBtn = h('button', { class: 'btn btn-soft', type: 'button', onclick: async () => {
    try { field.value = (await navigator.clipboard.readText()).trim(); } catch { toast('請直接長按貼上'); }
  } }, '📋 貼上');
  const status = h('p', { class: 'form-hint' }, '');

  const res = await modal({
    title: isG ? '貼上 Google 語音金鑰' : '貼上 Claude API 金鑰',
    body: h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 10px' },
        '這把鑰匙只會存在這支手機，旅伴看不到，也不會上傳到任何地方。'),
      h('div', { class: 'numpad-row' }, field, pasteBtn),
      status,
      h('p', { class: 'form-hint' }, isG
        ? '在 Google Cloud 建立 API 金鑰，建議加「HTTP 參照網址」限制到你的網站。'
        : 'sk-ant- 開頭那一長串。建議用專用金鑰並在 Billing 設每月上限。'),
    ),
    actions: [{ label: '取消', value: null }, { label: '測試並儲存', value: 'save', primary: true }],
  });
  if (res !== 'save') return;
  const val = field.value.trim();
  if (!val) { toast('沒有貼上東西'); return; }
  if (isG && !looksLikeGoogleKey(val)) { toast('看起來不像 Google 金鑰（AIza 開頭）'); return; }
  if (!isG && !looksLikeAnthropicKey(val)) { toast('看起來不像 Claude 金鑰（sk-ant- 開頭）'); return; }

  toast('測試中…');
  const t = isG ? await aiTestTtsKey(val) : await aiTestKey(val);
  if (!t.ok) { toast(t.message); return; }
  await setTripKey(tripId, isG ? { ttsKey: val } : { key: val });
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
