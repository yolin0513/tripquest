// 搜尋景點加入行程（規劃行程）—— 三代理 3:0 決議的主線：
// 搜尋（策展庫優先 → Nominatim 候選清單）→ 挑一個 → 設定第幾天/幾點到/停留 → 加入。
//
// 原則（改動時不要弄回去）：
// 1. **按鈕觸發才查**，不做打字即搜 —— Nominatim 使用規範明文禁止 autocomplete 式查詢。
// 2. **座標跟著候選走**：加入的當下就把候選的座標寫進景點（不繞純文字、不事後重查）。
// 3. **誠實**：景點很齊、巷弄小店常常查不到 —— 查不到就引導「手動輸入」，不假裝找得到。
// 4. **手動輸入就在這一頁**（v1.51.4 起）：調整行程頁的手動加景點入口已移除，
//    這裡的手動卡是唯一的手動路徑，必須能設天/時間/停留，不能是死路。
// 5. **「幾點到」不用原生 time input**：iOS 上空值會被畫成「當下時間」（實機截圖
//    看到「下午3:01」），使用者沒動它也像選了。改成 時/分 兩個下拉，預設「未設定」，
//    **沒動就存 null**（測試在資料面釘著）。
//
// 這一頁是規劃用（年輕人操作），密度可以高；產出給長輩看的行程頁維持既有原則。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, modal } from '../ui.js';
import { navigate } from '../router.js';
import { geocodeSearch, geoTypeLabel } from '../geocode.js';
import { searchPlaces, generateForTrip } from '../quests/generate.js';
import { haversine, fmtDist } from '../geo.js';
import { stayOptions } from '../spottime.js';
import { enrichTrip } from '../enrich.js';

export default async function findspot(tripId, query = {}) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '搜尋景點' });

  let day = Math.max(1, parseInt(query.day, 10) || 1);
  // 「幫我規劃」建立的行程可以沒有日期 —— new Date('') 是 Invalid Date，
  // 每一步都要防 NaN（實機回報過「建好了卻什麼都不能做」）。
  function tripDays() {
    if (!t.startDate || !t.endDate) return 1;
    const n = Math.round((new Date(t.endDate) - new Date(t.startDate)) / 86400000) + 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  const totalDays = () => {
    const ds = store.spotsOf(tripId).map((s) => s.day).filter((x) => Number.isFinite(x) && x > 0);
    return Math.max(day, tripDays(), ...(ds.length ? ds : [1]));
  };
  const centroid = () => {
    const has = store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null);
    if (!has.length) return null;
    return { lat: has.reduce((n, s) => n + s.lat, 0) / has.length, lng: has.reduce((n, s) => n + s.lng, 0) / has.length };
  };

  const input = h('input', {
    class: 'field', type: 'search', placeholder: '例：清水寺、林場肉羹、羅東夜市',
    enterkeyhint: 'search',
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  const searchBtn = h('button', { class: 'btn btn-primary', onclick: doSearch }, '🔍 搜尋');
  const results = h('div', { class: 'fs-results' });
  const addedLine = h('p', { class: 'form-hint center', hidden: true });
  let addedCount = 0;

  // ---------- 手動輸入：彈窗（常駐卡展開後關不掉、還會殘留 —— 實機回報） ----------
  function openManual(prefill = '') {
    let closeFn = null;
    const manualName = h('input', { class: 'field', type: 'text', maxlength: 40, placeholder: '地點名稱', value: prefill });
    const panel = settingsPanel(
      async (d, startMin, stayMin) => {
        const name = manualName.value.trim();
        if (!name) { toast('先填地點名稱'); manualName.focus(); return; }
        await addSpot({ name, manual: true }, d, startMin, stayMin, null);
        closeFn?.(true);                       // 加入成功就收起，回到搜尋頁原狀
      },
      () => `加入「${manualName.value.trim() || '這個地點'}」`,
    );
    modal({
      title: '✍️ 手動輸入地點',
      closeX: true,
      expose: (c) => { closeFn = c; },
      body: h('div', { class: 'fs-manual' },
        h('p', { class: 'fs-meta', style: 'margin:0 0 8px' }, '免費地圖查不到的店也能加。之後可以在「調整行程」按「自動找出景點位置」補座標。'),
        manualName,
        panel),
      actions: [{ label: '取消', value: null }],
    });
  }
  const manualToggle = h('button', {
    class: 'btn btn-ghost btn-block', style: 'margin-top:10px',
    onclick: () => openManual(),
  }, '✍️ 查不到嗎？手動輸入地點');

  render(h('div', { class: 'page compact' },
    h('div', { class: 'fs-bar' }, input, searchBtn),
    h('p', { class: 'form-hint' }, '輸入名稱或地名後按「搜尋」。景點與地標都查得到；巷弄小店在免費地圖上常常沒有，查不到就用手動輸入。'),
    results,
    addedLine,
    manualToggle,
    h('button', {
      class: 'btn btn-soft btn-block', style: 'margin-top:12px',
      onclick: () => navigate(`/trip/${tripId}/plan`),
    }, '✔ 完成'),
  ));
  input.focus();

  // 共用的設定版面：「哪一天／停留多久」一列（兩個 select 窄螢幕也安全），
  // 「幾點到」自己一整列（iOS 原生 time input 的實際寬度壓不進三欄 —— 重疊回報過兩次）。
  function settingsPanel(onAdd, labelFn) {
    const nDays = Math.max(1, totalDays()) + 1;
    const daySel = h('select', { class: 'field' },
      ...Array.from({ length: nDays }, (_, i) => i + 1).map((d) =>
        h('option', { value: d, selected: d === day }, `第 ${d} 天`)));
    const staySel = h('select', { class: 'field' },
      ...stayOptions(60).map((o) => h('option', { value: o.v, selected: o.v === '60' }, o.label)));
    // 時/分 雙下拉：預設「未設定」→ 沒動就存 null（不會把當下時間當成使用者的選擇）
    const hourSel = h('select', { class: 'field' },
      h('option', { value: '', selected: true }, '未設定'),
      ...Array.from({ length: 24 }, (_, hh) => h('option', { value: hh }, `${hh} 時`)));
    const minSel = h('select', { class: 'field', disabled: true },
      ...[0, 5, 10, 15, 20, 30, 40, 45, 50].map((mm) =>
        h('option', { value: mm, selected: mm === 0 }, `${String(mm).padStart(2, '0')} 分`)));
    hourSel.addEventListener('change', () => { minSel.disabled = hourSel.value === ''; });
    const pickedMin = () => (hourSel.value === '' ? null : (+hourSel.value) * 60 + (+minSel.value || 0));
    const addBtn = h('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => {
        addBtn.textContent = labelFn();
        onAdd(Math.max(1, parseInt(daySel.value, 10) || day || 1),
          pickedMin(), staySel.value ? +staySel.value : null);
      },
    }, labelFn());
    return h('div', { class: 'fs-panel' },
      h('div', { class: 'fs-grid2' },
        h('label', {}, h('span', { class: 'form-label' }, '哪一天'), daySel),
        h('label', {}, h('span', { class: 'form-label' }, '停留多久'), staySel)),
      h('label', { class: 'fs-timerow' },
        h('span', { class: 'form-label' }, '幾點到'),
        h('span', { class: 'fs-hm' }, hourSel, minSel)),
      addBtn,
    );
  }

  async function doSearch() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    searchBtn.disabled = true;
    results.replaceChildren(h('p', { class: 'form-hint center' }, '搜尋中…'));
    try {
      // 策展庫（本機、零成本、有中文介紹）優先，Nominatim 補
      const curated = (await searchPlaces(q).catch(() => []))
        .filter((p) => p.lat != null && p.lng != null)
        .slice(0, 3)
        .map((p) => ({ name: p.name, fullName: [p.cityName, p.district].filter(Boolean).join(' '),
          lat: p.lat, lng: p.lng, tag: '📖 景點資料庫', curated: p }));
      const osm = await geocodeSearch(q, { region: t.region || '' });
      if (osm === null && !curated.length) {
        results.replaceChildren(h('div', { class: 'empty' },
          h('p', {}, '沒有網路，搜尋需要連線'),
          h('button', { class: 'btn btn-primary', style: 'margin-top:8px', onclick: () => openManual(q) },
            `✍️ 手動輸入「${q}」`)));
        return;
      }
      // 去重：同名且距離 <300m 視為同一個
      const list = [...curated];
      for (const o of (osm || [])) {
        const dup = list.some((x) => x.name === o.name && haversine(x, o) < 300);
        if (!dup) list.push({ ...o, tag: geoTypeLabel(o.cls, o.type) });
      }
      if (!list.length) {
        results.replaceChildren(h('div', { class: 'empty' },
          h('p', {}, `找不到「${q}」`),
          h('p', { class: 'form-hint' }, '免費地圖查不到不代表店不存在 —— 換個寫法（去掉分店名）再試，或直接手動輸入。'),
          h('button', { class: 'btn btn-primary', style: 'margin-top:8px', onclick: () => openManual(q) },
            `✍️ 手動輸入「${q}」`)));
        return;
      }
      drawResults(list);
    } finally { searchBtn.disabled = false; }
  }

  function drawResults(list) {
    const c = centroid();
    results.replaceChildren(...list.map((cand) => {
      const dist = c ? haversine(c, cand) : null;
      const meta = [cand.tag, cand.fullName, dist != null ? `離行程約 ${fmtDist(dist)}` : '']
        .filter(Boolean).join('｜');
      const row = h('div', { class: 'fs-row' });
      const addBtn = h('button', { class: 'btn btn-primary fs-add', onclick: () => togglePanel() }, '＋ 加入');
      const head = h('div', { class: 'fs-head' },
        h('div', { class: 'fs-main' },
          h('div', { class: 'fs-name' }, cand.name),
          h('div', { class: 'fs-meta' }, meta || 'OpenStreetMap'),
        ),
        addBtn);
      row.append(head);

      let panel = null;
      function togglePanel() {
        if (panel) { panel.remove(); panel = null; addBtn.textContent = '＋ 加入'; return; }
        addBtn.textContent = '收合';
        panel = settingsPanel(
          (d, startMin, stayMin) => addSpot(cand, d, startMin, stayMin, row),
          () => `加入「${cand.name}」`,
        );
        row.append(panel);
      }
      return row;
    }));
  }

  async function addSpot(cand, d, startMin, stayMin, row) {
    day = d;
    // 走既有的產生流程（配任務、配主題）；座標以使用者挑的候選為準寫進去
    const { spots: gs, quests: gq } = await generateForTrip({
      tripId, region: t.region || '',
      items: [{ name: cand.name, day: d, startMin, stayMin }],
    });
    if (!gs.length) { toast('建立失敗，換個名字再試一次'); return; }
    const order = store.spotsOf(tripId).filter((x) => (x.day || 1) === d).length;
    for (const sp of gs) {
      sp.day = d; sp.order = order;
      sp.startMin = startMin; sp.stayMin = stayMin;
      if ((sp.lat == null || sp.lng == null) && cand.lat != null) {
        sp.lat = cand.lat; sp.lng = cand.lng; sp.geoSrc = cand.curated ? 'db' : 'osm';
      }
      await store.put(sp);
    }
    for (const q of gq) await store.put(q);
    // 行程日期不夠長就順手延長（沿用 plan.js 的規則）
    if (t.startDate) {
      const need = new Date(new Date(t.startDate).getTime() + (Math.max(d, totalDays()) - 1) * 86400000)
        .toISOString().slice(0, 10);
      if (!t.endDate || need > t.endDate) store.patch(tripId, { endDate: need }).catch(() => {});
    }
    enrichTrip(tripId).catch(() => {});
    addedCount++;
    addedLine.hidden = false;
    addedLine.textContent = `已加入 ${addedCount} 個景點，可以繼續搜尋下一個`;
    if (row) {
      row.classList.add('fs-done');
      row.querySelector('.fs-panel')?.remove();
      const btn = row.querySelector('.fs-add');
      if (btn) { btn.textContent = `✔ 已加入第 ${d} 天`; btn.disabled = true; }
    }
    toast(cand.manual
      ? `已加入「${cand.name}」（沒有座標，之後可按「自動找出位置」補）`
      : `已加入「${cand.name}」`);
  }
}
