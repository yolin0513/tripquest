// 分帳 —— 記一筆、看總覽、看「誰該給誰多少」。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, modal, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';
import { avatar } from '../ui.js';
import { loadCurrencies, currencyInfo, currencyForCountry, getRates, fmtMoney } from '../fx.js';
import { tripExpenses, saveExpense, deleteExpense, settleTrip, CATEGORIES, categoryOf, sharePerMember } from '../expenses.js';

export default async function expenses(tripId) {
  const trip = store.get(tripId);
  if (!trip) { navigate('/', { replace: true }); return; }
  setTop({ title: '分帳', action: { icon: '＋', label: '記一筆', onClick: () => openEdit(tripId, null) } });
  await loadCurrencies();

  const members = store.membersOf(trip.groupId);
  if (members.length < 1) {
    render(h('div', { class: 'empty' }, h('p', {}, '先在「旅程設定」加旅伴，才能分帳。')));
    return;
  }

  const base = trip.baseCurrency || currencyForCountry(trip.country) || 'TWD';
  const list = tripExpenses(tripId);

  const page = h('div', { class: 'page' });
  render(page);

  if (!list.length) {
    page.append(
      h('div', { class: 'empty' },
        h('div', { class: 'empty-emoji' }, '💰'),
        h('p', {}, '還沒有任何花費'),
        h('p', { class: 'muted sm' }, '誰付了錢就記一筆，最後自動算出誰要還誰。')),
      h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => openEdit(tripId, null) }, '＋ 記第一筆'),
    );
    return;
  }

  const rates = await getRates();
  const s = settleTrip(tripId, base, rates);

  const nameOf = (id) => (members.find((m) => m.id === id) || {}).displayName || '（未指定）';

  // ---- 總覽 ----
  page.append(h('div', { class: 'exp-summary' },
    h('div', { class: 'exp-total' },
      h('span', { class: 'muted sm' }, `共 ${s.count} 筆・以${currencyInfo(base).name}計`),
      h('div', { class: 'exp-total-num' }, fmtMoney(s.totals.grand, base)),
      h('div', { class: 'muted sm' }, members.length ? `每人平均 ${fmtMoney(s.totals.grand / members.length, base)}` : ''),
    ),
    s.missingRate ? h('p', { class: 'form-hint' }, '⚠ 有幣別查不到匯率，換算可能不準。') : null,
    rates ? h('p', { class: 'form-hint' }, `匯率更新：${fmtFxDate(rates.updatedAt)}${rates.stale ? '（離線快取）' : ''}`) : null,
  ));

  // ---- 結清方案 ----
  page.append(h('div', { class: 'section-label' }, '結清方案（最少轉帳）'));
  if (!s.transfers.length) {
    page.append(h('div', { class: 'card about' }, h('p', { class: 'sm' }, '目前大家打平，不用還來還去 🎉')));
  } else {
    page.append(h('div', { class: 'stack' }, ...s.transfers.map((t) =>
      h('div', { class: 'exp-settle' },
        avatar(nameOf(t.from), hashHue(t.from)),
        h('span', { class: 'exp-settle-txt' },
          h('b', {}, nameOf(t.from)), ' 給 ', h('b', {}, nameOf(t.to))),
        h('span', { class: 'exp-settle-amt' }, fmtMoney(t.amount, base)),
      ))));
  }

  // ---- 每個人 ----
  page.append(h('div', { class: 'section-label' }, '每個人'));
  page.append(h('div', { class: 'stack' }, ...members.map((m) => {
    const bal = s.balances[m.id] || 0;
    const paid = s.totals.byMember[m.id] || 0;
    return h('div', { class: 'exp-person' },
      avatar(m.displayName, hashHue(m.id)),
      h('div', { class: 'exp-person-main' },
        h('div', { style: 'font-weight:700' }, m.displayName),
        h('div', { class: 'muted sm' }, `付了 ${fmtMoney(paid, base)}`)),
      h('div', { class: 'exp-person-bal ' + (bal > 0.5 ? 'pos' : bal < -0.5 ? 'neg' : '') },
        Math.abs(bal) < 0.5 ? '打平' : (bal > 0 ? `應收 ${fmtMoney(bal, base)}` : `應付 ${fmtMoney(-bal, base)}`)),
    );
  })));

  // ---- 明細 ----
  page.append(h('div', { class: 'section-label' }, '明細'));
  page.append(h('div', { class: 'stack' }, ...list.map((e) => {
    const cat = categoryOf(e.category);
    const partN = (e.participants || []).length;
    return h('button', { class: 'exp-item', onclick: () => openEdit(tripId, e) },
      h('span', { class: 'exp-item-cat' }, cat.emoji),
      h('span', { class: 'exp-item-main' },
        h('span', { class: 'exp-item-title' }, e.title),
        h('span', { class: 'muted sm' }, `${nameOf(e.payerId)} 付 · ${partN} 人分`)),
      h('span', { class: 'exp-item-amt' }, fmtMoney(e.amount, e.currency)),
    );
  })));

  page.append(h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:16px', onclick: () => changeBase(tripId, base) }, `顯示幣別：${base}（點這裡換）`));
}

async function changeBase(tripId, cur) {
  const C = await loadCurrencies();
  const actions = C.list.map((c) => ({ label: `${c.code}　${c.name}`, value: c.code }));
  actions.push({ label: '取消', value: null });
  const pick = await modal({ title: '用哪個幣別顯示總帳？', actions });
  if (pick) { await store.patch(tripId, { baseCurrency: pick }); toast('已切換'); expenses(tripId); }
}

// ---------- 記一筆 / 編輯 ----------
async function openEdit(tripId, existing) {
  const trip = store.get(tripId);
  const members = store.membersOf(trip.groupId);
  const C = await loadCurrencies();
  const guess = trip.baseCurrency || currencyForCountry(trip.country) || 'TWD';

  const st = existing ? { ...existing } : {
    tripId, groupId: trip.groupId, title: '', category: 'food',
    amount: 0, currency: guess, payerId: members[0]?.id || '',
    participants: members.map((m) => m.id), shares: null,
  };
  let amountStr = existing ? String(existing.amount || '') : '';

  const amountEl = h('div', { class: 'numpad-display' }, amountStr || '0');
  const curBtn = h('button', { class: 'btn btn-soft', onclick: async () => {
    const actions = C.list.map((c) => ({ label: `${c.symbol} ${c.code} ${c.name}`, value: c.code }));
    actions.push({ label: '取消', value: null });
    const pk = await modal({ title: '幣別', actions });
    if (pk) { st.currency = pk; curBtn.textContent = pk; }
  } }, st.currency);

  const titleEl = h('input', { class: 'field', type: 'text', maxlength: 40, placeholder: '這筆是什麼？例：晚餐、計程車', value: st.title });

  const catRow = h('div', { class: 'quick-pick' });
  const drawCat = () => catRow.replaceChildren(...CATEGORIES.map((c) =>
    h('button', { class: (st.category === c.id ? 'on ' : '') + 'chip-sm', onclick: () => { st.category = c.id; drawCat(); } }, `${c.emoji} ${c.label}`)));
  drawCat();

  const payRow = h('div', { class: 'quick-pick' });
  const drawPay = () => payRow.replaceChildren(...members.map((m) =>
    h('button', { class: (st.payerId === m.id ? 'on ' : '') + 'chip-sm', onclick: () => { st.payerId = m.id; drawPay(); } }, m.displayName)));
  drawPay();

  const partWrap = h('div', { class: 'stack' });
  st.participants = st.participants || members.map((m) => m.id);
  st.shares = st.shares || null;
  const drawParts = () => {
    partWrap.replaceChildren(...members.map((m) => {
      const on = st.participants.includes(m.id);
      const w = st.shares ? (st.shares[m.id] ?? '') : '';
      return h('label', { class: 'exp-part' + (on ? ' on' : '') },
        h('input', { type: 'checkbox', checked: on, onchange: (ev) => {
          if (ev.target.checked) { if (!st.participants.includes(m.id)) st.participants.push(m.id); }
          else st.participants = st.participants.filter((x) => x !== m.id);
          drawParts();
        } }),
        h('span', { class: 'exp-part-name' }, m.displayName),
        st.shares ? h('input', {
          class: 'field exp-share', type: 'number', min: 0, step: 1, value: w, placeholder: '份',
          oninput: (ev) => { st.shares[m.id] = Number(ev.target.value) || 0; },
        }) : null,
      );
    }));
  };
  drawParts();

  const splitToggle = h('button', { class: 'btn btn-ghost btn-block', onclick: () => {
    if (st.shares) { st.shares = null; }
    else { st.shares = {}; for (const m of members) st.shares[m.id] = st.participants.includes(m.id) ? 1 : 0; }
    splitToggle.textContent = st.shares ? '改回平均分攤' : '改成自訂比例（填份數）';
    drawParts();
  } }, '改成自訂比例（填份數）');

  const numpad = bigNumpad({
    onKey: (k) => {
      if (k === 'del') amountStr = amountStr.slice(0, -1);
      else if (k === '.') { if (!amountStr.includes('.')) amountStr = (amountStr || '0') + '.'; }
      else { if (amountStr === '0') amountStr = k; else amountStr = (amountStr + k).slice(0, 12); }
      amountEl.textContent = amountStr || '0';
    },
  });

  const body = h('div', { class: 'exp-form' },
    h('div', { class: 'numpad-row' }, curBtn, amountEl),
    numpad,
    field('這筆是什麼', titleEl),
    field('分類', catRow),
    field('誰付的', payRow),
    field('分給誰', h('div', {}, partWrap, splitToggle)),
  );

  const res = await modal({
    title: existing ? '編輯這筆' : '記一筆花費',
    body,
    actions: [
      ...(existing ? [{ label: '刪除', value: 'del', danger: true }] : []),
      { label: '取消', value: null },
      { label: '儲存', value: 'save', primary: true },
    ],
  });

  if (res === 'del') {
    if (await confirmDialog('刪除這筆花費？', { danger: true, okLabel: '刪除' })) { await deleteExpense(existing.id); toast('已刪除'); expenses(tripId); }
    return;
  }
  if (res !== 'save') return;
  const amt = parseFloat(amountStr) || 0;
  if (amt <= 0) { toast('金額要大於 0'); return; }
  if (!st.participants.length) { toast('至少選一個人分'); return; }
  await saveExpense({ ...st, id: existing?.id, amount: amt, title: titleEl.value.trim() });
  toast('已記錄');
  expenses(tripId);
}

function field(label, control) {
  return h('label', { class: 'form-field' }, h('span', { class: 'form-label' }, label), control);
}

function fmtFxDate(s) {
  const d = new Date(s);
  if (isNaN(d)) return s || '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 大鍵盤
function bigNumpad({ onKey }) {
  const wrap = h('div', { class: 'numpad' });
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  for (const k of keys) {
    wrap.append(h('button', {
      class: 'numpad-key' + (k === 'del' ? ' numpad-del' : ''), type: 'button',
      onclick: () => onKey(k),
    }, k === 'del' ? '⌫' : k));
  }
  return wrap;
}
