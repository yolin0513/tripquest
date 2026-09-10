// 找附近 —— 停車場 / 廁所 / 便利商店 / 加油站（v1.59；藥局在 SOS 頁，不重複）。
//
// 為什麼是獨立頁、不塞進 SOS：SOS 是「走失、急救」的緊急畫面，人在最慌的
// 時候打開它，不該先滾過停車場跟超商；把生活設施混進去會稀釋它的緊急性。

// 機制（Overpass 免金鑰、雙鏡像、12 秒逾時、離線回快取）跟 SOS 完全共用。
//
// 誠實原則：OSM 的車位數（capacity）是地圖上登記的「總車位」，不是即時剩餘。
// 台灣的即時剩餘車位查過：北市舊的免金鑰 JSON 已停、各縣市格式不一、主要管道
// TDX 要註冊金鑰；日本沒有可靠的免費來源。所以這頁只給靜態資料並講明白，
// 即時資訊列為未來的自帶金鑰選配。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, mount } from '../ui.js';
import { currentPosition, navUrl, fmtDist } from '../geo.js';
import { nearbyLife, LIFE } from '../nearby.js';

export default async function nearbyView(tripId) {
  setTop({ title: '找附近' });
  const spots = tripId ? store.spotsOf(tripId).filter((s) => s.lat != null && s.lng != null) : [];
  const page = h('div', { class: 'page nl' });

  let center = null;                                   // { lat, lng, label }
  let kind = 'parking';
  let gen = 0;                                          // 換分類/換中心時作廢舊查詢

  // ---- 中心：目前位置優先，拿不到就用「現在這一站」，也可手動選景點 ----
  const centerSel = h('select', { class: 'field nl-center', onchange: () => pickCenter(centerSel.value) },
    h('option', { value: 'gps' }, '📍 我的目前位置'),
    ...spots.map((s) => h('option', { value: s.id }, `第 ${s.day || 1} 天 · ${s.name}`)),
  );
  const centerLine = h('p', { class: 'sm muted nl-centerline' }, '正在定位…');

  // ---- 分類大按鈕 ----
  const catBar = h('div', { class: 'nl-cats' });
  const drawCats = () => {
    mount(catBar, ...Object.entries(LIFE).map(([k, m]) =>
      h('button', { class: 'nl-cat' + (k === kind ? ' on' : ''), onclick: () => { kind = k; drawCats(); refresh(); } },
        h('span', { class: 'nl-cat-emoji' }, m.emoji),
        h('span', { class: 'nl-cat-label' }, m.label))));
  };
  drawCats();

  const note = h('div', { class: 'nl-note', hidden: true });
  const listBox = h('div', { class: 'nl-list' });
  page.append(centerSel, centerLine, catBar, note, listBox);
  render(page);

  async function pickCenter(v) {
    if (v === 'gps') {
      centerLine.textContent = '正在定位…（最多約 10 秒）';
      const pos = await currentPosition({ maxAgeMs: 120000 });
      if (pos) {
        center = { lat: pos.lat, lng: pos.lng, label: '目前位置' };
        centerLine.textContent = pos.stale ? '用的是稍早的定位（拿不到新的）' : '以你的目前位置為中心';
      } else if (spots.length) {
        // 沒開定位：退回「現在這一站」（沒有就第一個有座標的景點），並把選單同步過去
        const here = store.getHereSpot(tripId);
        const fb = spots.find((s) => s.id === here) || spots[0];
        centerSel.value = fb.id;
        return pickCenter(fb.id);
      } else {
        center = null;
        centerLine.textContent = '拿不到位置。請開啟定位權限，或先在行程裡加一個有地點的景點。';
        mount(listBox);
        return;
      }
    } else {
      const s = spots.find((x) => x.id === v);
      if (!s) return;
      center = { lat: s.lat, lng: s.lng, label: s.name };
      centerLine.textContent = `以「${s.name}」為中心`;
    }
    refresh();
  }

  async function refresh({ fresh = false } = {}) {
    if (!center) return;
    const my = ++gen;
    const meta = LIFE[kind];
    // 停車場的誠實標示：總車位不是即時剩餘
    if (kind === 'parking') {
      note.hidden = false;
      note.textContent = '🅿️ 車位數是地圖上登記的「總車位」，不是現在剩幾格；收費與否也以現場為準。（即時剩餘車位目前沒有免金鑰的資料來源，先不提供）';
    } else { note.hidden = true; }
    mount(listBox, h('div', { class: 'nl-loading' }, h('div', { class: 'spinner' }), `正在找附近的${meta.label}…`));
    const { results, stale, failed, at } = await nearbyLife(center.lat, center.lng, kind, { fresh });
    if (my !== gen) return;                             // 使用者已經切到別的分類/中心
    if (failed && !results.length) {
      mount(listBox, h('div', { class: 'empty' },
        h('p', {}, navigator.onLine === false ? '現在沒有網路，查不了附近設施。' : '查不到附近設施（服務可能正忙）。'),
        h('button', { class: 'btn btn-soft', onclick: () => refresh({ fresh: true }) }, '再試一次')));
      return;
    }
    const rows = results.slice(0, 15).map((it) => card(it, meta));
    mount(listBox,
      h('p', { class: 'sm muted nl-count' },
        `${meta.radius >= 1000 ? (meta.radius / 1000) + ' 公里' : meta.radius + ' 公尺'}內找到 ${results.length} 個${meta.label}`
        + (results.length > 15 ? '，先列最近 15 個' : '')
        + (stale ? `（離線，這是 ${fmtAge(at)}的結果）` : '')),
      ...(rows.length ? rows : [h('div', { class: 'empty' }, h('p', {}, `這附近查不到${meta.label}——地圖資料可能還沒收錄。`))]),
      h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:6px', onclick: () => refresh({ fresh: true }) }, '🔄 重新整理'),
    );
  }

  function card(it, meta) {
    const chips = [];
    if (it.kind === 'parking') {
      if (it.entrance) chips.push('停車場入口');        // 導航點＝入口，開車最好用
      if (it.cap) chips.push(`總車位 ${it.cap}`);
      if (it.capDis) chips.push(`♿ 無障礙 ${it.capDis} 格`);
      if (it.ptype) chips.push(it.ptype);
      if (it.fee) chips.push(it.fee);
      if (it.customers) chips.push('限顧客');
      // 地圖上只畫了一塊地、什麼都沒填的 —— 排在後面了，但也要講明為什麼它看起來這麼空
      if (it.thin) chips.push('⚠️ 只有位置資料');
    } else if (it.kind === 'toilets') {
      if (it.attached) chips.push('附設廁所');          // 掛在店家/車站上的，不是獨立公廁
      if (it.wheelchair) chips.push('♿ 無障礙');
      if (it.changing) chips.push('🚼 尿布台');
      if (it.fee) chips.push(it.fee);
    } else {
      if (it.h24) chips.push('🕐 24 小時');
    }
    if (!it.h24 && it.hours && it.hours.length <= 30) chips.push(`🕒 ${it.hours}`);
    // 這類設施多半沒有店名——導航一律用座標（家附近同品牌分店太多，用店名會被
    // 地圖帶去別間；這是「地名優先」規則的合理例外）
    return h('div', { class: 'nl-card' },
      h('div', { class: 'nl-card-main' },
        h('div', { class: 'nl-name' }, `${meta.emoji} ${it.name || defName(it.kind)}`),
        h('div', { class: 'nl-dist' }, fmtDist(it.dist)),
        chips.length ? h('div', { class: 'nl-chips' }, ...chips.map((c) => h('span', { class: 'nl-chip' }, c))) : null,
      ),
      h('a', { class: 'btn btn-primary nl-go', href: navUrl(it.lat, it.lng), target: '_blank', rel: 'noopener' }, '🧭 導航'),
    );
  }

  function defName(k) {
    return { parking: '停車場', toilets: '公共廁所', convenience: '便利商店', fuel: '加油站' }[k] || '設施';
  }
  function fmtAge(at) {
    const m = Math.round((Date.now() - at) / 60000);
    return m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`;
  }

  await pickCenter('gps');
}
