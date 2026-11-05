// 航班頁（#/trip/:id/flights）。資料規矩見 js/flights.js 檔頭。
// 一段航程一張卡：班號（大字）＋以天計的倒數；起飛（日期 時間・地點）→ 抵達；備註；「修改」改或刪。
// 時間是機票上印的當地時間，卡片上寫明「當地時間」；倒數旁寫「依這支手機的日期」。

import * as store from '../store.js';
import { h, mount, toast, confirmDialog } from '../ui.js';
import { flightsOf, flightCountdown, checkFlight, saveFlight, removeFlight } from '../flights.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const md = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
const end = (date, time, place) => [date ? md(date) : '日期未填', time || '時間未填'].join(' ') + (place ? `・${place}` : '');

export default async function flightsView(tripId, { drawPage, setTop }) {
  const t = store.get(tripId);
  setTop({ title: '航班' });
  if (!t) { drawPage(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '找不到這個旅程')))); return; }
  const page = h('div', { class: 'page fl-page' });
  const listBox = h('div', { class: 'fl-list' });
  const formBox = h('div', { class: 'fl-formbox' });
  const addBtn = h('button', { class: 'btn btn-primary btn-block fl-addbtn', type: 'button', onclick: () => openForm(null) }, '＋ 加一段航班');
  page.append(listBox, addBtn, formBox,
    h('p', { class: 'sm muted fl-foot' }, '時間照機票上寫的當地時間填。倒數只算天數、依這支手機的日期。航班跟旅伴同步。'));
  drawPage(page);
  draw();
  const off = store.subscribe(() => { if (!page.isConnected) { off(); return; } if (!formBox.firstChild) draw(); });

  function draw() {
    const items = flightsOf(tripId);
    if (!items.length) { mount(listBox, h('p', { class: 'fl-empty' }, '還沒加航班。')); return; }
    mount(listBox, ...items.map((f) => {
      const cd = flightCountdown(f);
      return h('article', { class: 'fl-card', dataset: { id: f.id } },
        h('div', { class: 'fl-head' },
          h('span', { class: 'fl-ic', 'aria-hidden': 'true' }, '✈️'),
          h('h3', { class: 'fl-no' }, f.flightNo || '（沒填班號）'),
          h('button', { class: 'btn btn-soft fl-edit', type: 'button', onclick: () => openForm(f) }, '修改')),
        cd ? h('p', { class: 'fl-cd', role: 'status' }, cd) : null,
        h('div', { class: 'fl-legs' },
          h('p', { class: 'fl-end' }, h('span', { class: 'fl-tag' }, '起飛'), end(f.depDate, f.depTime, f.depPlace)),
          h('p', { class: 'fl-end' }, h('span', { class: 'fl-tag' }, '抵達'), end(f.arrDate, f.arrTime, f.arrPlace))),
        h('p', { class: 'fl-local sm muted' }, '時間是當地時間'),
        f.note ? h('p', { class: 'fl-note' }, f.note) : null);
    }));
  }

  function openForm(existing) {
    const v = existing ? { ...existing } : { flightNo: '', depDate: '', depTime: '', depPlace: '', arrDate: '', arrTime: '', arrPlace: '', note: '' };
    const inp = (k, label, props = {}) => h('label', { class: 'fl-field' }, h('span', { class: 'fl-label' }, label),
      h('input', { class: 'field', value: v[k] || '', oninput: (e) => { v[k] = e.target.value; }, 'data-k': k, ...props }));
    const err = h('p', { class: 'fl-err', role: 'alert' });
    addBtn.hidden = true;
    mount(formBox, h('form', { class: 'fl-form', onsubmit: async (e) => {
      e.preventDefault();
      const msg = checkFlight(v);
      err.textContent = msg;
      if (msg) return;
      await saveFlight(tripId, v, existing);
      toast(existing ? '已更新' : '已加上去');
      close();
    } },
    h('h3', { class: 'fl-form-t' }, existing ? '修改航班' : '加一段航班'),
    inp('flightNo', '班號', { placeholder: '例如 BR 198', maxlength: 20, autocapitalize: 'characters' }),
    h('p', { class: 'fl-sec' }, '起飛（當地時間）'),
    h('div', { class: 'fl-row' }, inp('depDate', '日期', { type: 'date' }), inp('depTime', '時間', { type: 'time' })),
    inp('depPlace', '從哪裡（可不填）', { placeholder: '例如 桃園 T2', maxlength: 60 }),
    h('p', { class: 'fl-sec' }, '抵達（當地時間）'),
    h('div', { class: 'fl-row' }, inp('arrDate', '日期', { type: 'date' }), inp('arrTime', '時間', { type: 'time' })),
    inp('arrPlace', '到哪裡（可不填）', { placeholder: '例如 成田 T1', maxlength: 60 }),
    inp('note', '備註（可不填）', { placeholder: '例如 訂位代號、行李幾公斤', maxlength: 200 }),
    err,
    h('div', { class: 'fl-actions' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, '存'),
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, '取消'),
      existing ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        if (await confirmDialog(`把「${existing.flightNo || '這段航班'}」刪掉？`, { danger: true, okLabel: '刪除' })) { await removeFlight(existing.id); toast('已刪除'); close(); }
      } }, '刪除') : null)));
    formBox.querySelector('input').focus();
    formBox.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function close() { mount(formBox); addBtn.hidden = false; draw(); }
}
