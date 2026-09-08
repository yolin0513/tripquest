// 搜尋景點加入行程（規劃行程・第 1 批）—— 三代理 3:0 決議的主線：
// 搜尋（策展庫優先 → Nominatim 候選清單）→ 挑一個 → 設定第幾天/幾點到/停留 → 加入。
//
// 決議裡的三個原則，改動時不要弄回去：
// 1. **按鈕觸發才查**，不做打字即搜 —— Nominatim 使用規範明文禁止 autocomplete 式查詢。
// 2. **座標跟著候選走**：加入的當下就把候選的座標寫進景點（不繞純文字、不事後重查）。
// 3. **誠實**：這裡的資料是 OpenStreetMap —— 景點很齊、巷弄小店常常查不到，查不到就
//    引導手動輸入，不假裝找得到。
//
// 這一頁是規劃用（年輕人操作），密度可以高；產出給長輩看的行程頁維持既有原則。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { geocodeSearch, geoTypeLabel } from '../geocode.js';
import { searchPlaces, generateForTrip } from '../quests/generate.js';
import { haversine, fmtDist } from '../geo.js';
import { stayOptions, minOfInput } from '../spottime.js';
import { enrichTrip } from '../enrich.js';

export default async function findspot(tripId, query = {}) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '搜尋景點' });

  let day = Math.max(1, parseInt(query.day, 10) || 1);
  // 「幫我規劃」建立的行程可以沒有日期 —— new Date('') 是 Invalid Date，
  // 算出 NaN 天的話「哪一天」下拉會變成空的、加入的景點 day=NaN 在任何頁面
  // 都看不到（實機回報「建好了卻什麼都不能做」的元兇）。每一步都要防 NaN。
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

  render(h('div', { class: 'page compact' },
    h('div', { class: 'fs-bar' }, input, searchBtn),
    h('p', { class: 'form-hint' }, '輸入名稱或地名後按「搜尋」。景點與地標都查得到；巷弄小店在免費地圖上常常沒有，查不到就用下面的手動輸入。'),
    results,
    addedLine,
    h('div', { class: 'row2', style: 'margin-top:18px' },
      h('button', { class: 'btn btn-soft', onclick: () => navigate(`/trip/${tripId}/plan`) }, '✔ 完成，去調整行程'),
      h('button', {
        class: 'btn btn-ghost',
        onclick: () => navigate(`/trip/${tripId}/plan`),   // 手動輸入在調整行程頁的「＋ 加景點」
      }, '改用手動輸入'),
    ),
  ));
  input.focus();

  async function doSearch() {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    searchBtn.disabled = true;
    results.replaceChildren(h('p', { class: 'form-hint center' }, '搜尋中…'));
    try {
      // 策展庫（本機、零成本、有中文介紹）優先，Nominatim 補
      const curated = (await searchPlaces(q).catch(() => []))
        .slice(0, 3)
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ name: p.name, fullName: [p.cityName, p.district].filter(Boolean).join(' '),
          lat: p.lat, lng: p.lng, tag: '📖 景點資料庫', curated: p }));
      const osm = await geocodeSearch(q, { region: t.region || '' });
      if (osm === null && !curated.length) {
        results.replaceChildren(h('div', { class: 'empty' },
          h('p', {}, '沒有網路，搜尋需要連線'),
          h('p', { class: 'form-hint' }, '可以先按「改用手動輸入」把名字打進行程，之後再補位置。')));
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
          h('p', { class: 'form-hint' }, '免費地圖查不到不代表店不存在 —— 換個寫法（去掉分店名）再試，或改用手動輸入。')));
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
      const addBtn = h('button', { class: 'btn btn-primary fs-add', onclick: () => openSettings() }, '＋ 加入');
      const head = h('div', { class: 'fs-head' },
        h('div', { class: 'fs-main' },
          h('div', { class: 'fs-name' }, cand.name),
          h('div', { class: 'fs-meta' }, meta || 'OpenStreetMap'),
        ),
        addBtn);
      row.append(head);

      let panel = null;
      function openSettings() {
        if (panel) { panel.remove(); panel = null; addBtn.textContent = '＋ 加入'; return; }
        addBtn.textContent = '收合';
        const nDays = Math.max(1, totalDays()) + 1;      // 永遠多給一天可選，且絕不為空
        const daySel = h('select', { class: 'field' },
          ...Array.from({ length: nDays }, (_, i) => i + 1).map((d) =>
            h('option', { value: d, selected: d === day }, `第 ${d} 天`)));
        // 空的 time 欄位在 iOS 上是一片空白，看不出可以點 —— 蓋一層「未設定」，
        // 有值就顯示值（欄位文字在沒值時設為透明，Chrome 的 --:-- 也一起蓋掉）
        const timeField = h('input', { class: 'field', type: 'time' });
        const timeHint = h('span', { class: 'fs-time-hint' }, '未設定');
        const syncTime = () => {
          timeField.classList.toggle('hasval', !!timeField.value);
          timeHint.hidden = !!timeField.value;
        };
        timeField.addEventListener('input', syncTime);
        timeField.addEventListener('change', syncTime);
        syncTime();
        const staySel = h('select', { class: 'field' },
          ...stayOptions(60).map((o) => h('option', { value: o.v, selected: o.v === '60' }, o.label)));
        panel = h('div', { class: 'fs-panel' },
          h('div', { class: 'fs-grid' },
            h('label', {}, h('span', { class: 'form-label' }, '哪一天'), daySel),
            h('label', {}, h('span', { class: 'form-label' }, '幾點到'),
              h('span', { class: 'fs-time' }, timeField, timeHint)),
            h('label', {}, h('span', { class: 'form-label' }, '停留多久'), staySel)),
          h('button', {
            class: 'btn btn-primary btn-block',
            onclick: () => addSpot(cand, Math.max(1, parseInt(daySel.value, 10) || day || 1),
              minOfInput(timeField.value), staySel.value ? +staySel.value : null, row),
          }, `加入「${cand.name}」`),
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
    if (!gs.length) { toast('建立失敗，請改用手動輸入'); return; }
    const order = store.spotsOf(tripId).filter((x) => (x.day || 1) === d).length;
    for (const sp of gs) {
      sp.day = d; sp.order = order;
      sp.startMin = startMin; sp.stayMin = stayMin;
      if (sp.lat == null || sp.lng == null) { sp.lat = cand.lat; sp.lng = cand.lng; sp.geoSrc = cand.curated ? 'db' : 'osm'; }
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
    row.classList.add('fs-done');
    row.querySelector('.fs-panel')?.remove();
    const btn = row.querySelector('.fs-add');
    btn.textContent = `✔ 已加入第 ${d} 天`;
    btn.disabled = true;
    toast(`已加入「${cand.name}」`);
  }
}
