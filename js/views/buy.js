// 待買清單頁（#/trip/:id/buy）。資料規矩見 js/buylist.js 檔頭。
// 畫面：最上面一個輸入框＋「加上去」；底下一項一列，左邊大勾選框、中間品項、右邊「⋯」改字／刪除。
// 沒買的在上、買了的在下（劃掉、淡一點）；勾的人有選過「我是誰」才寫「媽媽勾的」。
// 一項都沒有：一行說明＋輸入框，不顯示「0 項」。

import * as store from '../store.js';
import { h, mount, toast, confirmDialog, promptDialog, modal } from '../ui.js';
import { activeMemberId } from '../claim.js';
import { buysOf, addBuy, setBuyDone, setBuyText, removeBuy } from '../buylist.js';

export default async function buyView(tripId, { drawPage, setTop }) {
  const t = store.get(tripId);
  setTop({ title: '待買清單' });
  if (!t) { drawPage(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '找不到這個旅程')))); return; }

  const page = h('div', { class: 'page buy-page' });
  const input = h('input', { class: 'field buy-input', type: 'text', placeholder: '要買什麼？', maxlength: 80,
    'aria-label': '新增要買的東西', enterkeyhint: 'done',
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } } });
  const addBtn = h('button', { class: 'btn btn-primary buy-add', type: 'button', onclick: () => add() }, '＋ 加上去');
  const summary = h('p', { class: 'buy-sum', role: 'status' });
  const listBox = h('ul', { class: 'buy-list' });
  page.append(
    h('div', { class: 'buy-addrow' }, input, addBtn),
    summary, listBox,
    h('p', { class: 'sm muted buy-foot' }, '清單跟旅伴同步，大家看到的是同一份。'),
  );
  drawPage(page);
  draw();

  // 旅伴那邊勾了、同步進來 → 重畫清單（頁面還在才畫）
  const off = store.subscribe(() => { if (!page.isConnected) { off(); return; } draw(); });

  async function add() {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    await addBuy(tripId, v);
    input.value = '';
    input.focus();
    draw();
  }

  function whoName(memberId) {
    if (!memberId) return '';
    const m = store.getRaw(memberId);
    return m && m.name ? m.name : '';
  }

  function draw() {
    const items = buysOf(tripId);
    const left = items.filter((x) => !x.done).length;
    summary.textContent = items.length === 0 ? '還沒有要買的東西，在上面打字加上去。'
      : (left === 0 ? `全部買齊了（${items.length} 項）` : `還有 ${left} 項沒買（共 ${items.length} 項）`);
    mount(listBox, ...items.map((it) => {
      const who = it.done ? whoName(it.doneBy) : '';
      return h('li', { class: 'buy-item' + (it.done ? ' is-done' : ''), dataset: { id: it.id } },
        h('button', {
          class: 'buy-check', type: 'button', role: 'checkbox', 'aria-checked': String(!!it.done),
          'aria-label': `${it.text}：${it.done ? '已買，點一下改回沒買' : '還沒買，點一下打勾'}`,
          onclick: async () => { await setBuyDone(it.id, !it.done, activeMemberId(tripId)); draw(); },
        }, it.done ? '✓' : ''),
        h('div', { class: 'buy-body' },
          h('span', { class: 'buy-text' }, it.text),
          who ? h('span', { class: 'buy-who' }, `${who} 勾的`) : null),
        h('button', { class: 'buy-more', type: 'button', 'aria-label': `${it.text}：改字或刪除`, onclick: () => more(it) }, '⋯'));
    }));
  }

  async function more(it) {
    const act = await modal({
      title: it.text,
      body: '',
      actions: [{ label: '改字', value: 'edit' }, { label: '刪除', value: 'del', danger: true }, { label: '取消', value: null }],
    });
    if (act === 'edit') {
      const v = await promptDialog('改成什麼？', { value: it.text, okLabel: '存' });
      if (v != null && String(v).trim()) { await setBuyText(it.id, v); draw(); }
    } else if (act === 'del') {
      if (await confirmDialog(`把「${it.text}」從清單刪掉？`, { danger: true, okLabel: '刪除' })) { await removeBuy(it.id); toast('已刪除'); draw(); }
    }
  }
}
