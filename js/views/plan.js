// 總行程編輯 —— 綜觀整趟行程，用拖拉或大按鈕調整「哪天去哪個景點」與當天先後順序。
//
// 兩種操作並存（長輩不必只靠拖拉）：
//   1. 按住 ☰ 拖曳 —— 可跨天、可換順序
//   2. 每個景點的 ▲ ▼（同一天內移動）—— 給不想拖曳的人的替代路徑
// 調整只改 spot 的 day / order，任務與照片掛在 spotId 上，進度完全跟著走。

import { setTop, render } from '../app.js';
import { spotTimes, dayStartOf, DAY_START_DEFAULT } from '../spottime.js';
import { travelMatrix, chainTimes, timeConflicts, suggestOrder, longHaul, fmtMin, fmtRange, fmtDur } from '../route.js';
import { loadThemes } from '../theme.js';
import * as store from '../store.js';
import { h, mount, toast, promptDialog, confirmDialog, modal } from '../ui.js';
import { navigate } from '../router.js';
import { uuid } from '../ids.js';
import { toISO, parseISO } from '../daterange.js';
import { generateForTrip } from '../quests/generate.js';
import { enrichTrip } from '../enrich.js';
import { transitLeg, tzOffsetFor, rfc3339, VEHICLE_EMOJI } from '../transit.js';
import { getMapsKey, mapsBudget, addMapsCalls } from '../aikeys.js';

const dayMS = 86400000;

// 查到的大眾運輸班次只放在記憶體裡（key：tripId:day → { legs: Map(spotId → 結果) }）。
// **不寫進記錄**，理由跟 v1.67 的時刻表一樣（三代理 3:0）：這是推導值，而且每台裝置
// 查到的班次可能不同（查詢時間不同、金鑰只有建立者有）。寫進去會讓機器算的東西
// 偽裝成使用者的資料，還會在同步管道裡製造永不停止的雜訊。
// 真正的快取在 transit.js（IndexedDB，24 小時），那一層是為了不重複燒 Google 額度。
const TRANSIT = new Map();
const tKey = (tripId, day) => `${tripId}:${day}`;

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
  let hasMapsKey = false;
  getMapsKey(tripId).then((k) => {
    if (!k || hasMapsKey) return;
    hasMapsKey = true;
    draw();                        // 金鑰讀出來才知道要不要畫那顆按鈕
  }).catch(() => {});

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
      // 同一個動作不要在同一頁出現兩次：加景點／搜尋的入口就在下面第 1 天那一組，
      // 空狀態只說明、不再放重複按鈕（實機回報上下兩組一模一樣）
      list.append(h('div', { class: 'empty' },
        h('p', {}, '這趟還沒有景點 —— 按下面的「🔍 搜尋景點加入」開始（查不到的店，搜尋頁裡可以手動輸入）')));
    }

    for (let d = 1; d <= days; d++) {
      const inDay = spots.filter((s) => (s.day || 1) === d);
      list.append(h('div', { class: 'plan-divider', dataset: { day: String(d) } },
        h('span', { class: 'pd-day' }, `第 ${d} 天`),
        h('span', { class: 'pd-count' }, inDay.length ? `${inDay.length} 個景點` : '尚未安排'),
        inDay.length >= 3 ? h('button', {
          class: 'btn btn-soft pd-opt',
          onclick: () => suggestDay(d),
        }, '✨ 排順序') : null,
        // 沒有地圖金鑰時這顆完全不出現 —— 不給看得到按不了的東西
        (hasMapsKey && inDay.length >= 2) ? h('button', {
          class: 'btn btn-soft pd-opt pd-transit', dataset: { day: String(d) },
          onclick: () => runTransit(d),
        }, '🚆 大眾運輸') : null,
      ));
      if (!inDay.length) {
        list.append(h('div', { class: 'plan-empty', dataset: { day: String(d) } }, '把景點拖來這裡，或按下面的「搜尋景點加入」'));
      }
      inDay.forEach((s, i) => list.append(rowEl(s, d, i, inDay.length)));
      // 手動輸入的入口收進搜尋頁（那裡有完整的名稱/天/時間/停留與「查不到」退路），
      // 這裡一天只留一顆，不再兩顆功能重疊
      list.append(h('button', {
        class: 'plan-addspot', dataset: { day: String(d) },
        onclick: () => navigate(`/trip/${tripId}/findspot?day=${d}`),
      }, `🔍 搜尋景點加入第 ${d} 天`));
    }

    annotateTravel().catch(() => {});

    // 天數控制一列（文字等長：加一天／減一天）；匯出獨立一列滿版。
    // 「開車/步行」切換已移除 —— 混合交通（大眾運輸為主）下兩個選項都是假精度，
    // 移動時間一律標「粗略估計」並在說明講清楚不含大眾運輸。
    list.append(h('div', { class: 'plan-day-tools' },
      h('button', { class: 'btn btn-soft', onclick: addDay }, '＋ 加一天'),
      h('button', { class: 'btn btn-ghost', onclick: removeLastDay }, '－ 減一天'),
    ));
    list.append(h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:8px', onclick: exportText }, '📤 匯出成文字'));
    list.append(h('button', {
      class: 'btn btn-primary btn-block btn-big', style: 'margin-top:18px',
      onclick: () => navigate(`/trip/${tripId}`),      // 同上：寫「回旅程」就要真的回旅程頁
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

    // 📌 上移到名稱同一列（名稱左、釘住右）—— 動作列剩兩顆同列，整張卡壓扁，
    // 一個畫面能看到更多景點（實機回報卡太高）
    const pinBtn = h('button', {
      class: 'plan-mini plan-pin compact' + (s.pinned ? ' on' : ''),
      title: '釘住（排順序時不移動）', 'aria-label': s.pinned ? '取消釘住' : '釘住',
      onclick: async () => { await store.patch(s.id, { pinned: !s.pinned }); draw(); },
    }, '📌');

    return h('div', { class: 'plan-row', dataset: { id: s.id } },
      h('div', { class: 'plan-row-top' },
        h('button', { class: 'plan-handle', 'aria-label': '拖曳排序' }, '☰'),
        h('div', { class: 'plan-main' },
          h('div', { class: 'plan-name-row' },
            h('div', { class: 'plan-name' }, `${s.emoji || '📍'} ${s.name}`),
            pinBtn),
          timeTxt ? h('div', { class: 'plan-time' }, `🕘 ${timeTxt}`) : null,
          h('div', { class: 'plan-eta', hidden: true }),
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

  // ---------- 移動時間與時刻鏈（規劃第 2 批） ----------
  // 一天一個 OSRM /table 矩陣請求（FOSSGIS），之後拖拉重排全部從快取算；
  // 失敗或沒座標退回直線×係數。UI 一律「約」，估算來源標得更明白。
  // 交通切換移除後內部一律用 drive 估（排序看的是相對距離，模式不影響結論）
  function dayMode() { return 'drive'; }

  async function dayMatrix(inDay) {
    const mode = dayMode();
    const coordIdx = [];
    const pts = [];
    inDay.forEach((sp, i) => { if (sp.lat != null && sp.lng != null) { coordIdx.push(i); pts.push({ lat: sp.lat, lng: sp.lng }); } });
    let sub = null;
    if (pts.length >= 2) sub = await travelMatrix(pts, mode);
    const n = inDay.length;
    const sec = Array.from({ length: n }, () => Array(n).fill(null));
    if (sub) {
      coordIdx.forEach((gi, a) => coordIdx.forEach((gj, b) => { sec[gi][gj] = sub.sec[a][b]; }));
    }
    return { sec, src: sub ? sub.src : 'est', full: pts.length === n && n >= 2 };
  }

  // 「先用 X 推算」的 X：90 → 「1 小時 30 分」。fmtDur 吃的是秒。
  const fmtStay = (min) => (Number.isFinite(min) ? fmtDur(min * 60) : '1 小時');

  async function annotateTravel() {
    // 類別停留時間要讀 data/themes.json。這一頁原本沒載主題資料，
    // 不載的話 stayForSpot 會靜默退回 60，整個對照表等於沒作用。
    await loadThemes().catch(() => {});
    list.querySelectorAll('.plan-conflict').forEach((x) => x.remove());
    const mode = dayMode();
    const spots = store.spotsOf(tripId);
    const days = totalDays();
    let anyEst = false, anyOsrm = false;
    for (let d = 1; d <= days; d++) {
      const inDay = spots.filter((x) => (x.day || 1) === d).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!inDay.length) continue;
      const m = await dayMatrix(inDay);
      if (m.src === 'est') anyEst = true; else anyOsrm = true;
      const chain = chainTimes(inDay, m, mode);
      chain.forEach((c, i) => {
        const row = list.querySelector(`.plan-row[data-id="${c.id}"]`);
        if (!row) return;
        // 兩點之間的移動小標（插在這一列前面）
        row.querySelector('.plan-travel-note')?.remove();
        if (i > 0 && c.longHaul) {
          // 跨區：開車估算沒有意義（北海道到京都是搭飛機/新幹線），明講、不給數字
          row.prepend(h('div', { class: 'plan-travel-note far' },
            c.longHaul.crossSea
              ? `✈️ 跨海移動（直線約 ${c.longHaul.km} 公里）— 開車到不了，交通方式請自行安排`
              : `✈️ 跨區移動（直線約 ${c.longHaul.km} 公里）— 通常搭飛機或高鐵／新幹線，交通請自行安排`));
        } else if (i > 0 && c.travel != null) {
          const tr = (TRANSIT.get(tKey(tripId, d)) || { legs: new Map() }).legs.get(c.id);
          if (tr) {
            // 大眾運輸是「實際班次」，開車是「估算」—— 兩個要看得出差別，不能混成一句
            const bits = [`🚆 大眾運輸 ${fmtDur(tr.sec)}`];
            if (tr.transfers > 0) bits.push(`轉乘 ${tr.transfers} 次`);
            if (tr.walkSec > 60) bits.push(`走路 ${fmtDur(tr.walkSec)}`);
            const note = h('div', { class: 'plan-travel-note transit' }, bits.join('・'));
            for (const ln of tr.lines.slice(0, 3)) {
              const emo = VEHICLE_EMOJI[ln.vehicle] || '🚌';
              const seg = [ln.name, ln.from && ln.to ? `${ln.from} → ${ln.to}` : '', ln.depart ? `${ln.depart} 發車` : '']
                .filter(Boolean).join('・');
              if (seg) note.append(h('div', { class: 'plan-transit-line' }, `${emo} ${seg}`));
            }
            note.append(h('div', { class: 'plan-transit-drive' }, `（開車估算 ${fmtDur(c.travel)}）`));
            row.prepend(note);
          } else {
            row.prepend(h('div', { class: 'plan-travel-note' }, `↓ 移動約 ${fmtDur(c.travel)}`));
          }
        }
        const eta = row.querySelector('.plan-eta');
        if (!eta) return;
        const bits = [];
        if (c.arrive != null && !c.fixed) {
          bits.push(c.leave != null ? `約 ${fmtRange(c.arrive, c.leave)}` : `約 ${fmtMin(c.arrive)} 到`);
        }
        // 遲到分軟硬（v1.67，三代理一致要求）：這個數字只要上游用過任何估算就不該當警告。
        // 車程可能是直線 ×1.4 猜的、上一站的停留可能是我們自己猜的 60 分 ——
        // 拿這種數字對長輩說「你趕不上」，錯一次他以後就不看了。
        if (c.late > 0) {
          const dur = c.late >= 60 ? fmtDur(c.late * 60) : c.late + ' 分';
          bits.push(c.lateSoft ? `可能有點趕（推算晚 ${dur}，含估算）` : `⚠ 比預定晚 ${dur}`);
        }
        if (c.stayAssumed) bits.push(`（停留未設，先用 ${fmtStay(c.stayUsed)}推算）`);
        eta.textContent = bits.join('　');
        eta.hidden = !bits.length;
        eta.classList.toggle('warn', c.late > 0 && !c.lateSoft);
      });

      // 使用者自己填的時間互相矛盾 —— 這一條完全不看車程與假設停留，所以永遠報得起。
      // 貼在「比較晚的那一站」上，位置就在使用者心裡那張行程表的正確位置。
      for (const cf of timeConflicts(inDay)) {
        const row = list.querySelector(`.plan-row[data-id="${cf.id}"]`);
        const eta = row && row.querySelector('.plan-eta');
        if (!eta) continue;
        const who = cf.prevName ? `「${cf.prevName}」` : '前一站';
        const el = h('div', { class: 'plan-conflict', 'data-for': cf.id },
          cf.kind === 'order'
            ? `⚠️ 這一站訂 ${fmtMin(cf.at)}，比排在前面的${who} ${fmtMin(cf.prevAt)} 還早 —— 順序可能排反了`
            : `⚠️ ${who} ${fmtMin(cf.prevAt)} 停到 ${fmtMin(cf.prevEnd)}，但這一站訂 ${fmtMin(cf.at)}`);
        eta.after(el);
      }
    }
    // 大眾運輸用了假設的出發時間 → 講出來，不要讓人以為那是他自己設的
    list.querySelectorAll('.plan-transit-note').forEach((x) => x.remove());
    for (let d = 1; d <= days; d++) {
      const st = TRANSIT.get(tKey(tripId, d));
      if (!st || !st.legs.size) continue;
      const div = list.querySelector(`.plan-divider[data-day="${d}"]`);
      if (!div) continue;
      const msgs = [`🚆 班次是 ${st.date} 查到的實際時刻（Google）`];
      if (st.assumedStart) msgs.push(`這一天沒有設定時間，從早上 ${Math.floor(DAY_START_DEFAULT / 60)} 點開始推算`);
      if (st.tz.guessed) msgs.push('⚠ 認不出這趟的時區，用了這支手機的時區 —— 時間可能差幾小時');
      div.after(h('div', { class: 'plan-transit-note' }, msgs.join('。')));
    }

    const note = list.querySelector('.plan-src-note');
    note?.remove();
    if (anyEst || anyOsrm) {
      list.append(h('p', { class: 'form-hint plan-src-note' },
        `移動時間是${anyEst && !anyOsrm ? '用直線距離' : '依開放路網（OSRM）'}粗略估計的，`
        + '不含大眾運輸、等車與塞車時間，僅供排順序參考。'));
    }
  }

  // 「🚆 大眾運輸」：一段一段序列查 Google Routes。
  //
  // 為什麼不能一次查一整天：大眾運輸的答案取決於幾點出發，而第 n+1 段的出發時間
  // 要等第 n 段查完才知道。所以只能接力，也因此要花好幾秒 —— 這是使用者按下去
  // 才做的事，不是背景自動跑的（開車估算才是背景跑的那個）。
  async function runTransit(d) {
    const btn = list.querySelector(`.pd-transit[data-day="${d}"]`);
    const setLabel = (x) => { if (btn) btn.textContent = x; };
    const t2 = store.get(tripId);
    const inDay = store.spotsOf(tripId).filter((x) => (x.day || 1) === d)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const pairs = [];
    for (let i = 1; i < inDay.length; i++) {
      const a = inDay[i - 1], b = inDay[i];
      if (a.lat != null && b.lat != null && !longHaul(a, b)) pairs.push([a, b, i]);
    }
    if (!pairs.length) { toast('這一天沒有可以查的路段（要有座標、而且不是跨區移動）'); return; }

    if (!t2.startDate) { toast('這趟還沒有日期 —— 大眾運輸要知道是哪一天才查得到班次'); return; }
    const date = toISO(new Date(parseISO(t2.startDate).getTime() + (d - 1) * dayMS));

    const budget = await mapsBudget(tripId);
    if (budget.noKey) { toast('還沒設定地圖金鑰'); return; }
    if (!budget.ok) {
      toast(`這個月的查詢次數用完了（${budget.used}/${budget.cap}）—— 可以到旅程設定調高上限`);
      return;
    }
    if (budget.used + pairs.length > budget.cap) {
      const go = await confirmDialog(
        `這一天要查 ${pairs.length} 段，但這個月只剩 ${Math.max(0, budget.cap - budget.used)} 次額度。\n\n`
        + '要先到旅程設定調高上限嗎？', { okLabel: '還是先查', cancelLabel: '先不要' });
      if (!go) return;
    }

    const key = await getMapsKey(tripId);
    const first = inDay.find((x) => x.lat != null) || inDay[0];
    const tz = tzOffsetFor(first.lat, first.lng, t2.country);

    // 出發時刻：照 v1.67 的時刻鏈推。當天完全沒有人填「幾點到」時，用早上 9 點當
    // 起點並在畫面上講出來 —— 不講的話使用者會以為那是他自己設的。
    const m = await dayMatrix(inDay);
    let chain = chainTimes(inDay, m, dayMode());
    const assumedStart = chain[0].arrive == null;
    if (assumedStart) {
      const seed = inDay.map((x, i) => (i === 0 ? { ...x, startMin: dayStartOf(t2, d) } : x));
      chain = chainTimes(seed, m, dayMode());
    }

    const entry = { legs: new Map(), assumedStart, tz, date, at: Date.now() };
    TRANSIT.set(tKey(tripId, d), entry);

    let done = 0, calls = 0, firstErr = '';
    let clock = chain[0].leave;                       // 目前這一刻（分鐘，可跨日）
    for (const [a, b, i] of pairs) {
      setLabel(`查詢中… ${done + 1}/${pairs.length}`);
      const departMin = Number.isFinite(clock) ? clock : (chain[i - 1].leave ?? dayStartOf(t2, d));
      const at = rfc3339(date, departMin, tz.offset);
      if (!at) break;
      if (new Date(at).getTime() < Date.now()) {
        firstErr = '這一天已經過了（或時間已經過去）—— 大眾運輸只查得到未來的班次';
        break;
      }
      const r = await transitLeg(a, b, at, key);
      if (!r.cached) calls++;
      if (r.ok) {
        entry.legs.set(b.id, { ...r, departMin });
        // 下一段從「這一段到站 + 這一站的停留」開始
        const stay = chain[i].stayUsed ?? 60;
        clock = departMin + Math.round(r.sec / 60) + stay;
      } else {
        if (!firstErr) firstErr = transitErr(r.reason);
        if (r.reason === 'key' || r.reason === 'quota' || r.reason === 'network') break;
        clock = null;                                  // 這一段沒查到，後面的推算就不準了
      }
      done++;
    }
    if (calls) await addMapsCalls(tripId, calls);
    setLabel('🚆 大眾運輸');
    if (!entry.legs.size) { toast(firstErr || '這一天查不到大眾運輸班次'); TRANSIT.delete(tKey(tripId, d)); }
    else if (firstErr) toast(`查到 ${entry.legs.size} 段；其餘：${firstErr}`);
    await annotateTravel().catch(() => {});
  }

  function transitErr(reason) {
    return ({
      key: '金鑰被拒 —— 請到旅程設定確認 Routes API 已啟用、參照網址限制允許這個網站',
      quota: 'Google 說太頻繁了，等一下再試',
      network: '連不上 Google（可能沒有網路）',
      badtime: '這個時間查不到（多半是出發時間已經過去）',
      none: '這一段查不到大眾運輸路線（可能沒有班次或距離太近）',
    })[reason] || '查詢失敗（' + reason + '）';
  }

  // 「✨ 排順序」：最近鄰 + 2-opt，📌 不動；永遠先預覽、按套用才寫入
  async function suggestDay(d) {
    const inDay = store.spotsOf(tripId).filter((x) => (x.day || 1) === d).sort((a, b) => (a.order || 0) - (b.order || 0));
    const noCoord = inDay.filter((x) => x.lat == null || x.lng == null).length;
    if (noCoord) {
      toast(`還有 ${noCoord} 個景點沒有座標 —— 先按「📍 自動找出景點位置」再排`, 4200);
      return;
    }
    const m = await dayMatrix(inDay);
    const r = suggestOrder(inDay, { sec: m.sec });
    if (!r.changed) { toast('目前的順序已經很順了，不用改'); return; }
    const seq = r.order.map((i) => inDay[i]);
    // 跨區段的「開車時間」不算進總移動（算了只會誤導）；另外提醒這天可能太滿
    const legStats = (ord) => {
      let sec = 0, far = 0;
      for (let i = 1; i < ord.length; i++) {
        const t = m.sec[ord[i - 1]][ord[i]];
        if (longHaul(inDay[ord[i - 1]], inDay[ord[i]], t)) far++;
        else sec += t || 0;
      }
      return { sec, far };
    };
    const sb = legStats(inDay.map((_, i) => i)), sa = legStats(r.order);
    const ok = await modal({
      title: `第 ${d} 天的建議順序`,
      body: h('div', {},
        h('p', { class: 'sm muted', style: 'margin:0 0 8px' },
          sa.far
            ? `跨區以外的移動約 ${fmtDur(sa.sec)}（粗略估計，另有 ${sa.far} 段跨區移動未計）`
            : `總移動約 ${fmtDur(sb.sec)} → ${fmtDur(sa.sec)}（粗略估計）`),
        sa.far ? h('p', { class: 'plan-eta warn', style: 'margin:0 0 8px' },
          '⚠ 這一天有跨區移動，可能安排得太滿 —— 交通方式與時間請自行確認。') : null,
        h('ol', { class: 'opt-list' }, ...seq.map((sp) => h('li', {},
          `${sp.pinned ? '📌 ' : ''}${sp.emoji || '📍'} ${sp.name}`))),
        h('p', { class: 'form-hint' }, '📌 釘住的位置不會動。套用後還是可以拖拉調整。'),
      ),
      actions: [
        { label: '先不要', value: false },
        { label: '套用這個順序', value: true, primary: true },
      ],
    });
    if (!ok) return;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].order !== i) await store.patch(seq[i].id, { order: i });
    }
    toast('已套用，時間有衝突的會標 ⚠');
    draw();
  }

  // 匯出成 itinerary.js 一定解析得回來的純文字（分享/備份用；round-trip 有測試釘著）
  async function exportText() {
    const { exportItineraryText } = await import('../itinexport.js');
    const text = exportItineraryText(tripId);
    const { nativeShare } = await import('../share.js');
    if (await nativeShare({ title: t.title, text })) return;
    try { await navigator.clipboard.writeText(text); toast('已複製行程文字，可以貼到 LINE 或備忘錄'); }
    catch {
      const { modal } = await import('../ui.js');
      modal({ title: '行程文字', body: h('textarea', { class: 'field', rows: 12 }, text), actions: [{ label: '關閉', value: true }] });
    }
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

