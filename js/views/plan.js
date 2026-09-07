// 總行程編輯 —— 綜觀整趟行程，用拖拉或大按鈕調整「哪天去哪個景點」與當天先後順序。
//
// 兩種操作並存（長輩不必只靠拖拉）：
//   1. 按住 ☰ 拖曳 —— 可跨天、可換順序
//   2. 每個景點的 ▲ ▼（同一天內移動）—— 給不想拖曳的人的替代路徑
// 調整只改 spot 的 day / order，任務與照片掛在 spotId 上，進度完全跟著走。

import { setTop, render } from '../app.js';
import { spotTimes } from '../spottime.js';
import * as store from '../store.js';
import { h, mount, toast, promptDialog, confirmDialog } from '../ui.js';
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
  // 路線圖只畫得出有座標的景點 —— 文字匯入的行程大多沒有。這顆把缺的補起來：
  // 先用照片 GPS（有開定位才有），再用 OpenStreetMap 查地名（App 的天氣/SOS
  // 本來就用它做反向查詢）。查到的存進景點並同步，全群組只要有人查過一次。
  const missingGeo = store.spotsOf(tripId).filter((x) => x.lat == null || x.lng == null).length;
  const geoBtn = missingGeo ? h('button', {
    class: 'btn btn-soft btn-block',
    style: 'margin-bottom:10px',
    onclick: async () => {
      const go = await confirmDialog(
        `有 ${missingGeo} 個景點還沒有地圖位置（路線圖上看不到它們）。

`
        + '要自動查出來嗎？會把這些景點的「名稱」送到 OpenStreetMap 的免費地圖服務查座標'
        + '（不會送出照片或任何個人資料）。查到的會存進行程、同步給旅伴。',
        { okLabel: '開始查詢' });
      if (!go) return;
      const line = h('div', { class: 'record-pct' }, '查詢中…');
      const ov = h('div', { class: 'record-overlay' }, h('div', { class: 'spinner' }), line,
        h('p', { class: 'form-hint' }, '一秒查一個（地圖服務的規定），請稍等一下'));
      document.body.append(ov);
      try {
        const { fillTripCoords } = await import('../geocode.js');
        const r = await fillTripCoords(tripId, {
          onProgress: ({ done, total, found }) => { line.textContent = `查詢中 ${done}/${total}（找到 ${found} 個）`; },
        });
        ov.remove();
        toast(r.found ? `找到 ${r.found} 個位置${r.still ? `，還有 ${r.still} 個查不到` : ''}` : '這次沒有查到新的位置', 4200);
        plan(tripId);
      } catch (e) { ov.remove(); toast('查詢失敗：' + e.message); }
    },
  }, `📍 自動找出景點位置（還有 ${missingGeo} 個沒有）`) : null;

  render(h('div', { class: 'page' },
    h('p', { class: 'plan-tip' }, '按住 ☰ 拖曳可以換順序，同一天內換前後也可以用 ▲ ▼。'),
    geoBtn,
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
    const tm = spotTimes(s);
    const timeTxt = [tm.startTime, tm.endTime].filter(Boolean).join('–');
    const up = h('button', {
      class: 'plan-arrow', 'aria-label': '往前移', disabled: idx === 0,
      onclick: () => nudge(s, -1),
    }, '▲');
    const down = h('button', {
      class: 'plan-arrow', 'aria-label': '往後移', disabled: idx === dayLen - 1,
      onclick: () => nudge(s, 1),
    }, '▼');

    const box = h('div', { class: 'plan-quests', hidden: true });
    // 兩顆等寬、圖示在前、數字用固定寬度的小標籤 —— 不然「改任務（3）」跟
    // 「景點設定」長度不一樣，一排看起來歪歪的
    const count = h('span', { class: 'plan-mini-n' });
    const toggle = h('button', {
      class: 'plan-mini', onclick: () => { box.hidden = !box.hidden; label(); },
    });
    const label = () => {
      const n = store.questsOf(s.id).length;
      toggle.replaceChildren(
        h('span', { class: 'plan-mini-ic' }, box.hidden ? '✏️' : '▾'),
        h('span', { class: 'plan-mini-t' }, box.hidden ? '任務' : '收起'),
        count,
      );
      count.textContent = String(n);
    };
    fillQuestBox(box, s, label);
    label();

    return h('div', { class: 'plan-row', dataset: { id: s.id } },
      h('div', { class: 'plan-row-top' },
        h('button', { class: 'plan-handle', 'aria-label': '拖曳排序' }, '☰'),
        h('div', { class: 'plan-main' },
          h('div', { class: 'plan-name' }, `${s.emoji || '📍'} ${s.name}`),
          timeTxt ? h('div', { class: 'plan-time' }, `🕘 ${timeTxt}`) : null,
          h('div', { class: 'plan-row-actions' },
            toggle,
            h('button', { class: 'plan-mini', onclick: () => navigate(`/trip/${tripId}/spot/${s.id}`) },
              h('span', { class: 'plan-mini-ic' }, '⚙️'),
              h('span', { class: 'plan-mini-t' }, '設定'),
              h('span', { class: 'plan-mini-n', hidden: true })),
          ),
        ),
        h('div', { class: 'plan-updown' }, up, down),
      ),
      box,
    );
  }

  // 任務層級的編輯 / 刪除 / 新增 —— 景點頁把這些拿掉了（長輩會誤按），全部集中到這裡。
  // 只重繪這一塊，不整頁重畫，不然每改一筆展開的任務清單就收起來了。
  function fillQuestBox(box, s, onCountChange) {
    const redraw = () => { fillQuestBox(box, s, onCountChange); onCountChange(); };
    const qs = store.questsOf(s.id);
    mount(box,
      ...(qs.length ? qs.map((q) => {
        const n = store.submissionsOf(q.id).length;
        return h('div', { class: 'pq-row' },
          h('div', { class: 'pq-main' },
            h('div', { class: 'pq-title' }, q.title),
            q.hint ? h('div', { class: 'muted sm' }, q.hint) : null,
            n ? h('div', { class: 'muted sm' }, `已有 ${n} 張照片`) : null,
          ),
          h('div', { class: 'pq-btns' },
            h('button', { class: 'tag-btn', onclick: async () => {
              const title = await promptDialog('任務名稱', { value: q.title });
              if (title === null) return;
              const hint = await promptDialog('提示（可留空）', { value: q.hint || '', multiline: true });
              await store.patch(q.id, { title: title || q.title, hint: hint ?? q.hint });
              toast('已更新'); redraw();
            } }, '編輯'),
            h('button', { class: 'tag-btn danger', onclick: async () => {
              const msg = n ? `刪除任務「${q.title}」？它的 ${n} 張照片也會一起刪除。` : `刪除任務「${q.title}」？`;
              if (!await confirmDialog(msg, { danger: true, okLabel: '刪除' })) return;
              for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
              await store.remove(q.id);
              toast('已刪除'); redraw();
            } }, '刪除'),
          ),
        );
      }) : [h('p', { class: 'muted sm', style: 'margin:4px 2px 10px' }, '這個景點還沒有任務')]),
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        const title = await promptDialog('要拍什麼？', { placeholder: '例：找到那隻招財貓', okLabel: '下一步' });
        if (!title) return;
        const hint = await promptDialog('提示（可留空）', { placeholder: '拍成怎樣算完成？', multiline: true, okLabel: '新增' }) || '';
        await store.put({
          id: uuid(), type: 'quest', tripId, spotId: s.id, title, hint,
          kind: 'custom', source: 'custom', order: store.questsOf(s.id).length, refImage: null,
        });
        toast('已新增'); redraw();
      } }, '＋ 新增任務'),
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
  // 邊緣自動捲動：手指停在畫面上下緣就持續捲，越靠邊越快。
  // 「換天」按鈕是在這個機制補上之後才拿掉的 —— 沒有它，跨天拖曳只是看起來能做。
  const EDGE = 96;              // 距離上下緣多少 px 內開始捲
  const MAX_SPEED = 30;         // 每一幀最多捲幾 px（約 1800px/s）
  let drag = null;
  let raf = null;

  function autoScrollTick() {
    if (!drag) { raf = null; return; }
    const y = drag.lastY;
    const top = document.getElementById('topbar')?.offsetHeight || 0;
    const bottom = window.innerHeight - (document.getElementById('tabbar')?.offsetHeight || 0);
    let dy = 0;
    if (y < top + EDGE) dy = -MAX_SPEED * Math.min(1, (top + EDGE - y) / EDGE);
    else if (y > bottom - EDGE) dy = MAX_SPEED * Math.min(1, (y - (bottom - EDGE)) / EDGE);
    if (dy) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) {
        drag.ghost.style.top = (drag.lastY - drag.dy) + 'px';
        placeAt(drag.lastX, drag.lastY);       // 捲動之後底下換人了，要重新判斷位置
      }
    }
    raf = requestAnimationFrame(autoScrollTick);
  }

  // 把被拖的那一列插到目前手指下方那個位置
  function placeAt(x, y) {
    if (!drag) return;
    const under = document.elementFromPoint(x, y);
    const tgt = under && under.closest('.plan-row, .plan-divider, .plan-empty');
    if (!tgt || tgt === drag.row || !list.contains(tgt)) return;
    const r = tgt.getBoundingClientRect();
    const after = y > r.top + r.height / 2;
    list.insertBefore(drag.row, after ? tgt.nextSibling : tgt);
  }
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
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    row.classList.add('is-dragging');
    if (!raf) raf = requestAnimationFrame(autoScrollTick);
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    placeAt(e.clientX, e.clientY);
  });

  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
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

