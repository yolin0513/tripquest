// 總行程編輯 —— 綜觀整趟行程，用拖拉或大按鈕調整「哪天去哪個景點」與當天先後順序。
//
// 兩種操作並存（長輩不必只靠拖拉）：
//   1. 按住 ☰ 拖曳 —— 可跨天、可換順序
//   2. 每個景點的 ▲ ▼（同一天內移動）＋「換天」按鈕
// 調整只改 spot 的 day / order，任務與照片掛在 spotId 上，進度完全跟著走。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, promptDialog } from '../ui.js';
import { navigate, back } from '../router.js';
import { uuid } from '../ids.js';
import { toISO, parseISO } from '../daterange.js';
import { generateForTrip } from '../quests/generate.js';
import { enrichTrip } from '../enrich.js';

const dayMS = 86400000;

export default async function plan(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '調整行程' });

  // 明確天數：先用日期推算，之後由「加一天 / 減一天」直接調整
  let explicitDays = 1;
  if (t.startDate && t.endDate) {
    const n = Math.round((parseISO(t.endDate) - parseISO(t.startDate)) / dayMS) + 1;
    if (n > 0) explicitDays = n;
  }
  const maxSpotDay = () => store.spotsOf(tripId).reduce((m, s) => Math.max(m, s.day || 1), 1);
  const totalDays = () => Math.max(explicitDays, maxSpotDay());

  const list = h('div', { class: 'plan-list' });
  render(h('div', { class: 'page' },
    h('p', { class: 'plan-tip' }, '按住 ☰ 可以拖到別天或換順序；也可以用每個景點的 ▲ ▼ 和「換天」。任務和照片會自動跟著搬。'),
    list,
  ));

  // ---------- 日期同步 ----------
  function pushDates() {
    if (!t.startDate) return;
    const end = toISO(new Date(parseISO(t.startDate).getTime() + (totalDays() - 1) * dayMS));
    if (end !== t.endDate) store.patch(tripId, { endDate: end });
  }

  // ---------- 重繪 ----------
  function draw() {
    const spots = store.spotsOf(tripId);
    const days = totalDays();
    list.replaceChildren();

    if (!spots.length) {
      list.append(h('div', { class: 'empty' },
        h('p', {}, '這趟還沒有景點'),
        h('button', { class: 'btn btn-primary', onclick: () => addSpotToDay(1) }, '＋ 新增第一個景點')));
    }

    for (let d = 1; d <= days; d++) {
      const inDay = spots.filter((s) => (s.day || 1) === d);
      list.append(h('div', { class: 'plan-divider', dataset: { day: String(d) } },
        h('span', { class: 'pd-day' }, `第 ${d} 天`),
        h('span', { class: 'pd-count' }, inDay.length ? `${inDay.length} 個景點` : '尚未安排'),
      ));
      if (!inDay.length) {
        list.append(h('div', { class: 'plan-empty', dataset: { day: String(d) } }, '把景點拖來這裡，或按下面的「加景點」'));
      }
      inDay.forEach((s, i) => list.append(rowEl(s, d, i, inDay.length)));
      list.append(h('button', {
        class: 'plan-addspot', dataset: { day: String(d) },
        onclick: () => addSpotToDay(d),
      }, `＋ 加一個景點到第 ${d} 天`));
    }

    list.append(h('div', { class: 'plan-day-tools' },
      h('button', { class: 'btn btn-soft', onclick: addDay }, '＋ 多加一天'),
      h('button', { class: 'btn btn-ghost', onclick: removeLastDay }, '－ 減一天'),
    ));
    list.append(h('button', {
      class: 'btn btn-primary btn-block btn-big', style: 'margin-top:18px',
      onclick: () => back(`/trip/${tripId}`),
    }, '完成，回旅程'));
  }

  function rowEl(s, day, idx, dayLen) {
    const timeTxt = [s.startTime, s.endTime].filter(Boolean).join('–');
    const up = h('button', {
      class: 'plan-arrow', 'aria-label': '往前移', disabled: idx === 0,
      onclick: () => nudge(s, -1),
    }, '▲');
    const down = h('button', {
      class: 'plan-arrow', 'aria-label': '往後移', disabled: idx === dayLen - 1,
      onclick: () => nudge(s, 1),
    }, '▼');

    return h('div', { class: 'plan-row', dataset: { id: s.id } },
      h('button', { class: 'plan-handle', 'aria-label': '拖曳排序' }, '☰'),
      h('div', { class: 'plan-main' },
        h('div', { class: 'plan-name' }, `${s.emoji || '📍'} ${s.name}`),
        timeTxt ? h('div', { class: 'plan-time' }, `🕘 ${timeTxt}`) : null,
        h('div', { class: 'plan-row-actions' },
          h('button', { class: 'plan-mini', onclick: () => moveDay(s) }, '換天'),
          h('button', { class: 'plan-mini', onclick: () => navigate(`/trip/${tripId}/spot/${s.id}`) }, '編輯/刪除'),
        ),
      ),
      h('div', { class: 'plan-updown' }, up, down),
    );
  }

  // ---------- 大按鈕操作 ----------
  async function nudge(s, dir) {
    const inDay = store.spotsOf(tripId).filter((x) => (x.day || 1) === (s.day || 1));
    const i = inDay.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= inDay.length) return;
    await store.patch(inDay[i].id, { order: j });
    await store.patch(inDay[j].id, { order: i });
    draw();
  }

  async function moveDay(s) {
    const target = await chooseDay(s.name, s.day || 1, totalDays());
    if (!target) return;
    if (target > totalDays()) explicitDays = target;
    const endOrder = store.spotsOf(tripId).filter((x) => (x.day || 1) === target && x.id !== s.id).length;
    const from = s.day || 1;
    await store.patch(s.id, { day: target, order: endOrder });
    await renumberDay(from);
    pushDates();
    draw();
    toast(`「${s.name}」移到第 ${target} 天`);
  }

  async function renumberDay(day) {
    const inDay = store.spotsOf(tripId).filter((x) => (x.day || 1) === day);
    for (let i = 0; i < inDay.length; i++) {
      if (inDay[i].order !== i) await store.patch(inDay[i].id, { order: i });
    }
  }

  function addDay() { explicitDays = totalDays() + 1; pushDates(); draw(); toast(`現在共 ${totalDays()} 天`); }
  function removeLastDay() {
    const days = totalDays();
    if (days <= 1) { toast('至少要有一天'); return; }
    if (maxSpotDay() >= days) { toast('最後一天還有景點，先把它們搬走'); return; }
    explicitDays = days - 1;
    pushDates();
    draw();
    toast(`現在共 ${totalDays()} 天`);
  }

  async function addSpotToDay(day) {
    const name = await promptDialog('景點名稱', { placeholder: '例：奈良公園（可用「、」分隔多個）', okLabel: '新增' });
    if (!name) return;
    const { spots: gs, quests: gq } = await generateForTrip({ tripId, itineraryText: name, region: t.region || '' });
    if (!gs.length) { toast('沒抓到景點，換個名字試試'); return; }
    let order = store.spotsOf(tripId).filter((x) => (x.day || 1) === day).length;
    for (const sp of gs) { sp.day = day; sp.order = order++; await store.put(sp); }
    for (const q of gq) await store.put(q);
    if (day > explicitDays) explicitDays = day;
    pushDates();
    enrichTrip(tripId).catch(() => {});
    toast(gs.length > 1 ? `加了 ${gs.length} 個景點` : `已加入「${gs[0].name}」`);
    draw();
  }

  // ---------- 拖曳 ----------
  let drag = null;
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.plan-handle');
    if (!handle) return;
    const row = handle.closest('.plan-row');
    if (!row) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    drag = { row, pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false, ghost: null };
    try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const ghost = row.cloneNode(true);
    ghost.classList.add('plan-ghost');
    Object.assign(ghost.style, {
      position: 'fixed', margin: '0', width: rect.width + 'px',
      left: rect.left + 'px', top: rect.top + 'px', pointerEvents: 'none', zIndex: '200',
    });
    document.body.append(ghost);
    drag.ghost = ghost;
    row.classList.add('is-dragging');
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.dy) + 'px';

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const tgt = under && under.closest('.plan-row, .plan-divider, .plan-empty');
    if (!tgt || tgt === drag.row || !list.contains(tgt)) return;
    const r = tgt.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (tgt.classList.contains('plan-divider')) {
      list.insertBefore(drag.row, after ? tgt.nextSibling : tgt);
    } else {
      list.insertBefore(drag.row, after ? tgt.nextSibling : tgt);
    }
  });

  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost.remove();
    d.row.classList.remove('is-dragging');
    if (d.moved) commitFromDOM();
    else draw();
  }
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);

  async function commitFromDOM() {
    const nodes = [...list.querySelectorAll('.plan-divider, .plan-row')];
    let day = 1, order = 0;
    const updates = [];
    for (const el of nodes) {
      if (el.classList.contains('plan-divider')) { day = +el.dataset.day || 1; order = 0; continue; }
      const id = el.dataset.id;
      const s = store.getRaw(id);
      if (s && (s.day !== day || s.order !== order)) updates.push({ id, day, order });
      order++;
    }
    for (const u of updates) await store.patch(u.id, { day: u.day, order: u.order });
    if (maxSpotDay() > explicitDays) explicitDays = maxSpotDay();
    pushDates();
    draw();
  }

  draw();
}

// 換天的小對話框
function chooseDay(name, current, max) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(0); };
    const grid = h('div', { class: 'day-move-grid' });
    for (let d = 1; d <= max + 1; d++) {
      grid.append(h('button', {
        class: 'btn ' + (d === current ? 'btn-primary' : 'btn-soft'),
        disabled: d === current,
        onclick: () => close(d),
      }, d > max ? '＋ 新的一天' : `第 ${d} 天`));
    }
    const card = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' },
      h('h2', { class: 'modal-title' }, `「${name}」要移到哪一天？`),
      h('p', { class: 'muted sm', style: 'margin:0 0 12px' }, `目前在第 ${current} 天`),
      grid,
      h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px', onclick: () => close(0) }, '取消'),
    );
    const ov = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === ov) close(0); } }, card);
    root.append(ov);
    document.addEventListener('keydown', onKey);
  });
}
