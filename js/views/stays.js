// 住宿清單頁（#/trip/:id/stays）。資料規矩見 js/stays.js 檔頭。
// 一間一張卡：名稱（大字）、入住→退房＋幾晚、在不在行程裡、地址（可開地圖）、備註；點「修改」改或刪。
// 一間都沒有：一行說明＋「＋ 加一間住宿」，不顯示「0 間」。

import * as store from '../store.js';
import { h, mount, toast, confirmDialog } from '../ui.js';
import { staysOf, nightsOf, tripNights, checkStay, saveStay, removeStay } from '../stays.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const md = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };

export default async function staysView(tripId, { drawPage, setTop }) {
  const t = store.get(tripId);
  setTop({ title: '住宿' });
  if (!t) { drawPage(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '找不到這個旅程')))); return; }
  const page = h('div', { class: 'page stay-page' });
  const listBox = h('div', { class: 'stay-list' });
  const formBox = h('div', { class: 'stay-formbox' });
  const addBtn = h('button', { class: 'btn btn-primary btn-block stay-addbtn', type: 'button', onclick: () => openForm(null) }, '＋ 加一間住宿');
  page.append(listBox, addBtn, formBox, h('p', { class: 'sm muted stay-foot' }, '住宿跟旅伴同步，大家看到的是同一份。'));
  drawPage(page);
  draw();
  const off = store.subscribe(() => { if (!page.isConnected) { off(); return; } if (!formBox.firstChild) draw(); });

  function draw() {
    const items = staysOf(tripId);
    if (!items.length) { mount(listBox, h('p', { class: 'stay-empty' }, '還沒加住宿。')); return; }
    mount(listBox, ...items.map((s) => {
      const n = nightsOf(s);
      const tn = tripNights(s, store.get(tripId) || t);
      const dates = s.checkIn && s.checkOut ? `${md(s.checkIn)} 入住 → ${md(s.checkOut)} 退房`
        : s.checkIn ? `${md(s.checkIn)} 入住・退房日期還沒填`
          : s.checkOut ? `退房 ${md(s.checkOut)}・入住日期還沒填` : '入住、退房日期還沒填';
      const where = tn == null ? '' : (tn.inTrip ? (tn.from === tn.to ? `行程第 ${tn.from} 晚` : `行程第 ${tn.from}～${tn.to} 晚`) : '不在行程日期內');
      return h('article', { class: 'stay-card' + (tn && !tn.inTrip ? ' is-out' : ''), dataset: { id: s.id } },
        h('div', { class: 'stay-head' },
          h('span', { class: 'stay-ic', 'aria-hidden': 'true' }, '🏨'),
          h('h3', { class: 'stay-name' }, s.name),
          h('button', { class: 'btn btn-soft stay-edit', type: 'button', onclick: () => openForm(s) }, '修改')),
        h('p', { class: 'stay-dates' }, dates, n ? h('b', { class: 'stay-n' }, `・${n} 晚`) : null),
        where ? h('p', { class: 'stay-where' + (tn.inTrip ? '' : ' is-out') }, where) : null,
        s.address ? h('p', { class: 'stay-addr' }, '📍 ', s.address, ' ',
          h('a', { class: 'stay-map', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`, target: '_blank', rel: 'noopener' }, '開地圖')) : null,
        s.note ? h('p', { class: 'stay-note' }, s.note) : null);
    }));
  }

  function openForm(existing) {
    const v = existing ? { ...existing } : { name: '', checkIn: '', checkOut: '', address: '', note: '' };
    const inp = (k, label, props = {}) => h('label', { class: 'stay-field' }, h('span', { class: 'stay-label' }, label),
      h('input', { class: 'field', value: v[k] || '', oninput: (e) => { v[k] = e.target.value; }, ...props }));
    const err = h('p', { class: 'stay-err', role: 'alert' });
    addBtn.hidden = true;
    mount(formBox, h('form', { class: 'stay-form', onsubmit: async (e) => {
      e.preventDefault();
      const msg = checkStay(v);
      err.textContent = msg;
      if (msg) return;
      await saveStay(tripId, v, existing);
      toast(existing ? '已更新' : '已加上去');
      close();
    } },
    h('h3', { class: 'stay-form-t' }, existing ? '修改住宿' : '加一間住宿'),
    inp('name', '住哪裡', { placeholder: '飯店或民宿的名字', maxlength: 80, 'data-k': 'name' }),
    h('div', { class: 'stay-daterow' },
      inp('checkIn', '入住', { type: 'date', 'data-k': 'checkIn' }),
      inp('checkOut', '退房', { type: 'date', 'data-k': 'checkOut' })),
    inp('address', '地址（可不填）', { maxlength: 160, 'data-k': 'address' }),
    inp('note', '備註（可不填）', { placeholder: '例如：訂房代號、幾點前入住', maxlength: 200, 'data-k': 'note' }),
    err,
    h('div', { class: 'stay-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, '存'),
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, '取消'),
      existing ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        if (await confirmDialog(`把「${existing.name}」刪掉？`, { danger: true, okLabel: '刪除' })) { await removeStay(existing.id); toast('已刪除'); close(); }
      } }, '刪除') : null)));
    formBox.querySelector('input').focus();
    formBox.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function close() { mount(formBox); addBtn.hidden = false; draw(); }
}
