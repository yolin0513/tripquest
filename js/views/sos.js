// 緊急求助 —— 走失求助畫面 + 當地緊急電話 + 附近的警局 / 醫院 / 藥局。
// 設計：超大字、可離線（快取最後位置與查詢結果）、給路人 / 警察看也看得懂。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { back } from '../router.js';
import { currentPosition, reverseGeocode, navUrl, mapUrl, fmtDist } from '../geo.js';
import { nearbyFacilities, KIND } from '../nearby.js';
import { loadEmergency, emergencyFor, countryOfTrip, getContacts } from '../emergency.js';

export default async function sos(tripId) {
  setTop({ title: '緊急求助' });
  await loadEmergency().catch(() => {});

  const trip = tripId ? store.get(tripId) : null;
  // 國家：行程 → 上一個行程 → 反向地理編碼
  let country = countryOfTrip(trip);
  if (!country) {
    for (const t of store.trips()) { country = countryOfTrip(t); if (country) break; }
  }

  const page = h('div', { class: 'page sos' });
  render(page);

  // ---- 1. 走失求助卡 ----
  const companions = await collectCompanions(trip);
  const locLine = h('div', { class: 'sos-loc' }, h('span', { class: 'spinner' }));
  const helpCard = h('div', { class: 'sos-help' },
    h('div', { class: 'sos-help-big' }, '我迷路了'),
    h('div', { class: 'sos-help-sub' }, '請幫我打電話給我的家人 · Please help me call my family'),
    companions.length
      ? h('div', { class: 'sos-people' }, ...companions.map((c) =>
          h('a', { class: 'sos-person', href: c.phone ? `tel:${c.phone.replace(/\s/g, '')}` : null },
            h('span', { class: 'sos-person-name' }, c.name + (c.relation ? `（${c.relation}）` : '')),
            h('span', { class: 'sos-person-phone' }, c.phone || '未填電話'),
            c.phone ? h('span', { class: 'sos-call' }, '📞 撥號') : null)))
      : h('p', { class: 'sos-none' }, '還沒有可聯絡的人。到「設定 → 緊急聯絡人」或這趟旅程的旅伴清單裡填上電話。'),
    h('div', { class: 'sos-loc-wrap' },
      h('div', { class: 'sos-loc-title' }, '📍 我現在的位置'),
      locLine),
  );
  page.append(helpCard);

  // ---- 2. 當地緊急電話 ----
  const em = emergencyFor(country);
  page.append(h('div', { class: 'sos-section' },
    h('h3', {}, `${em.name}的緊急電話`),
    h('div', { class: 'sos-tel-grid' },
      telBtn('🚓 報警', em.police || em.all),
      telBtn('🚑 救護 / 火警', em.fire || em.ambulance || em.all),
      em.tourist ? telBtn('🧭 旅客服務專線', em.tourist) : null,
      em.coastguard ? telBtn('⛵ 海巡', em.coastguard) : null,
    ),
    em.isGeneric
      ? h('p', { class: 'form-hint' }, `找不到這個國家的確切號碼，先給你通用的 ${em.all}。${em.note || ''}`)
      : (em.note ? h('p', { class: 'form-hint' }, em.note) : null),
    em.touristNote ? h('p', { class: 'form-hint' }, `旅客專線：${em.touristNote}`) : null,
  ));

  // ---- 3. 附近設施 ----
  const nearbyBox = h('div', { class: 'sos-section' },
    h('h3', {}, '附近的警局 / 醫院 / 藥局'),
    h('div', { class: 'center-fill', style: 'min-height:80px' }, h('div', { class: 'spinner' })),
  );
  page.append(nearbyBox);

  // ---- 定位 → 位置文字 + 附近設施 ----
  const pos = await currentPosition({ maxAgeMs: 120000 });
  if (!pos) {
    locLine.replaceChildren(h('span', { class: 'muted' }, '拿不到位置。請開啟定位權限後重新整理。'));
    nearbyBox.lastChild.replaceWith(h('p', { class: 'muted' }, '需要定位才能查附近設施。'));
  } else {
    drawLocLine(locLine, pos);
    reverseGeocode(pos.lat, pos.lng).then((g) => {
      if (g) {
        if (!country && g.country) { country = g.country; /* 已畫過的電話區塊不重繪，下次進來會對 */ }
        drawLocLine(locLine, pos, g);
      }
    }).catch(() => {});
    drawNearby(nearbyBox, pos);
  }
}

function drawLocLine(el, pos, geo) {
  const age = Math.round((Date.now() - pos.at) / 60000);
  const coordTxt = `${pos.lat}, ${pos.lng}`;
  el.replaceChildren(
    geo && geo.short ? h('div', { class: 'sos-addr' }, geo.short) : null,
    geo && geo.display ? h('div', { class: 'sos-addr-full' }, geo.display) : null,
    h('div', { class: 'sos-coord' }, coordTxt,
      pos.stale ? h('span', { class: 'tag tag-todo' }, `${age} 分鐘前的位置`) : null),
    h('div', { class: 'sos-loc-btns' },
      h('a', { class: 'btn btn-soft', href: mapUrl(pos.lat, pos.lng), target: '_blank', rel: 'noopener' }, '🗺️ 打開地圖'),
      h('button', {
        class: 'btn btn-soft',
        onclick: async () => {
          try { await navigator.clipboard.writeText(`${geo && geo.display ? geo.display + '\n' : ''}${coordTxt}\nhttps://maps.google.com/?q=${coordTxt}`); toast('已複製位置'); }
          catch { toast('長按座標可複製'); }
        },
      }, '📋 複製位置'),
    ),
  );
}

async function drawNearby(box, pos) {
  const spot = box.lastChild;
  const { results, stale, failed } = await nearbyFacilities(pos.lat, pos.lng);
  const groups = ['police', 'hospital', 'pharmacy'];
  const wrap = h('div', {});
  if (failed && !results.length) {
    spot.replaceWith(h('p', { class: 'muted' }, '查不到附近設施（可能是離線或服務忙碌）。可先用上面的緊急電話。'));
    return;
  }
  for (const g of groups) {
    const items = results.filter((r) => r.kind === g).slice(0, 4);
    const meta = KIND[g];
    wrap.append(h('div', { class: 'sos-near-group' },
      h('div', { class: 'sos-near-head' }, `${meta.emoji} ${meta.label}`),
      items.length
        ? h('div', { class: 'stack' }, ...items.map((it) => nearItem(it)))
        : h('p', { class: 'muted sm', style: 'padding:4px 2px' }, '附近沒有資料'),
    ));
  }
  wrap.append(h('p', { class: 'form-hint' },
    `資料來源 OpenStreetMap，可能不完整或有誤，請以現場為準。${stale ? '（目前顯示的是先前快取）' : ''}`));
  wrap.append(h('button', {
    class: 'btn btn-ghost btn-block',
    onclick: async () => {
      const busy = h('div', { class: 'center-fill', style: 'min-height:60px' }, h('div', { class: 'spinner' }));
      wrap.replaceWith(box._nb = busy);
      await nearbyFacilities(pos.lat, pos.lng, { fresh: true });
      busy.replaceWith(box._nb = h('div', {}));
      drawNearby2(box._nb, pos);
    },
  }, '🔄 重新查詢'));
  spot.replaceWith(wrap);
  box._nb = wrap;
}

// 重新查詢後只重畫清單容器
async function drawNearby2(container, pos) {
  const { results, stale } = await nearbyFacilities(pos.lat, pos.lng);
  const frag = h('div', {});
  for (const g of ['police', 'hospital', 'pharmacy']) {
    const items = results.filter((r) => r.kind === g).slice(0, 4);
    const meta = KIND[g];
    frag.append(h('div', { class: 'sos-near-group' },
      h('div', { class: 'sos-near-head' }, `${meta.emoji} ${meta.label}`),
      items.length ? h('div', { class: 'stack' }, ...items.map((it) => nearItem(it)))
        : h('p', { class: 'muted sm', style: 'padding:4px 2px' }, '附近沒有資料')));
  }
  frag.append(h('p', { class: 'form-hint' }, `資料來源 OpenStreetMap。${stale ? '（快取）' : '已更新'}`));
  container.replaceWith(frag);
}

function nearItem(it) {
  const tel = (it.phone || '').replace(/[\s-]/g, '');
  return h('div', { class: 'sos-near-item' },
    h('div', { class: 'sos-near-main' },
      h('div', { class: 'sos-near-name' }, it.name),
      h('div', { class: 'muted sm' }, [fmtDist(it.dist), it.addr].filter(Boolean).join(' · ')),
    ),
    h('div', { class: 'sos-near-acts' },
      tel ? h('a', { class: 'btn btn-soft sm-btn', href: `tel:${tel}` }, '📞') : null,
      h('a', { class: 'btn btn-soft sm-btn', href: navUrl(it.lat, it.lng, it.name), target: '_blank', rel: 'noopener' }, '🧭'),
    ),
  );
}

function telBtn(label, number) {
  if (!number) return null;
  return h('a', { class: 'btn btn-danger sos-tel', href: `tel:${String(number).replace(/[\s-]/g, '')}` },
    h('span', { class: 'sos-tel-label' }, label),
    h('span', { class: 'sos-tel-num' }, number));
}

async function collectCompanions(trip) {
  const out = [];
  const seen = new Set();
  if (trip) {
    for (const m of store.membersOf(trip.groupId)) {
      const key = (m.displayName || '') + (m.phone || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: m.displayName || '旅伴', phone: m.phone || '', relation: '' });
    }
  }
  for (const c of await getContacts()) {
    const key = (c.name || '') + (c.phone || '');
    if (seen.has(key) || !c.phone) continue;
    seen.add(key);
    out.push(c);
  }
  // 有電話的排前面
  return out.sort((a, b) => (b.phone ? 1 : 0) - (a.phone ? 1 : 0));
}
