// 長輩友善的日期範圍選擇
// 點輸入框 → 跳出月曆；點第一下 = 出發日，點第二下 = 回程日，中間範圍會標色。
// 點同一天兩下 = 單日行程。大格子、大箭頭、即時顯示「共 N 天 M 夜」。

import { h } from './ui.js';

const P2 = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`;
export function parseISO(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
const dayMS = 86400000;
const addDays = (iso, n) => toISO(new Date(parseISO(iso).getTime() + n * dayMS));
const mdLabel = (iso) => { const d = parseISO(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; };

// { days, nights } 或 null
export function nightsDays(start, end) {
  const a = parseISO(start);
  if (!a) return null;
  const b = parseISO(end) || a;
  const days = Math.round((b - a) / dayMS) + 1;
  if (days <= 0) return null;
  return { days, nights: days - 1 };
}

export function rangeLabel(start, end) {
  if (!start) return '';
  const nd = nightsDays(start, end);
  const span = (!end || end === start) ? mdLabel(start) : `${mdLabel(start)} – ${mdLabel(end)}`;
  if (!nd) return span;
  return `${span}・共 ${nd.days} 天${nd.nights ? ` ${nd.nights} 夜` : ''}`;
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];

// 開月曆選日期。回傳 Promise<{start,end}|null>
export function pickDateRange({ start = '', end = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    let sel = { start: start || null, end: (start && end) ? end : null };
    const base = parseISO(sel.start) || new Date();
    let view = new Date(base.getFullYear(), base.getMonth(), 1);
    const todayISO = toISO(new Date());

    const grid = h('div', { class: 'cal-grid' });
    const monthTitle = h('div', { class: 'cal-title' });
    const summary = h('div', { class: 'cal-summary' });
    const doneBtn = h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => finish() }, '完成');

    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };

    function finish() {
      if (!sel.start) { close(null); return; }
      close({ start: sel.start, end: sel.end || sel.start });
    }

    function tap(iso) {
      if (!sel.start || (sel.start && sel.end)) sel = { start: iso, end: null };
      else if (iso < sel.start) sel = { start: iso, end: null };
      else sel = { start: sel.start, end: iso };
      draw();
    }

    function draw() {
      monthTitle.textContent = `${view.getFullYear()} 年 ${view.getMonth() + 1} 月`;
      grid.replaceChildren(...WD.map((w) => h('div', { class: 'cal-wd' }, w)));

      const y = view.getFullYear(), m = view.getMonth();
      const lead = new Date(y, m, 1).getDay();
      const total = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < lead; i++) grid.append(h('div', { class: 'cal-cell cal-blank' }));

      for (let d = 1; d <= total; d++) {
        const iso = toISO(new Date(y, m, d));
        const cls = ['cal-cell'];
        const isStart = iso === sel.start;
        const isEnd = sel.end && iso === sel.end;
        const inRange = sel.start && sel.end && iso > sel.start && iso < sel.end;
        if (isStart) cls.push('cal-start');
        if (isEnd) cls.push('cal-end');
        if (isStart && !sel.end) cls.push('cal-single');
        if (inRange) cls.push('cal-mid');
        if (iso === todayISO) cls.push('cal-today');
        grid.append(h('button', {
          class: cls.join(' '), type: 'button',
          'aria-label': `${m + 1} 月 ${d} 日`,
          onclick: () => tap(iso),
        }, String(d)));
      }

      const nd = nightsDays(sel.start, sel.end);
      if (!sel.start) summary.textContent = '請點一下「出發日」';
      else if (!sel.end) summary.textContent = `出發 ${mdLabel(sel.start)}　再點「回程日」（同一天就是單日行程）`;
      else summary.textContent = `${mdLabel(sel.start)} – ${mdLabel(sel.end)}　共 ${nd.days} 天 ${nd.nights} 夜`;
      doneBtn.disabled = !sel.start;
      doneBtn.textContent = sel.start && !sel.end ? '選這一天（單日）' : '完成';
    }

    const hop = (n) => { view = new Date(view.getFullYear(), view.getMonth() + n, 1); draw(); };

    const card = h('div', { class: 'modal-card cal-card', role: 'dialog', 'aria-modal': 'true' },
      h('h2', { class: 'modal-title' }, '選擇日期'),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'cal-arrow', type: 'button', 'aria-label': '上個月', onclick: () => hop(-1) }, '‹'),
        monthTitle,
        h('button', { class: 'cal-arrow', type: 'button', 'aria-label': '下個月', onclick: () => hop(1) }, '›'),
      ),
      grid,
      summary,
      doneBtn,
      h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => close(null) }, '取消'),
    );
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, card);
    root.append(overlay);
    document.addEventListener('keydown', onKey);
    draw();
  });
}

// 給表單用的觸發按鈕。state 是 { start, end } 物件，會就地更新。
export function dateRangeField(state, onChange) {
  const btn = h('button', { type: 'button', class: 'date-range-btn' });
  const paint = () => {
    if (state.start) {
      btn.classList.add('has-val');
      btn.replaceChildren(
        h('span', { class: 'drb-icon' }, '📅'),
        h('span', { class: 'drb-val' }, rangeLabel(state.start, state.end)),
        h('span', { class: 'drb-edit' }, '更改'),
      );
    } else {
      btn.classList.remove('has-val');
      btn.replaceChildren(
        h('span', { class: 'drb-icon' }, '📅'),
        h('span', { class: 'drb-placeholder' }, '點這裡選日期'),
      );
    }
  };
  btn.addEventListener('click', async () => {
    const res = await pickDateRange({ start: state.start, end: state.end });
    if (res) { state.start = res.start; state.end = res.end; paint(); onChange && onChange(res); }
  });
  paint();
  return btn;
}

export { addDays };
