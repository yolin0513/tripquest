// 緊急求助 —— 走失求助畫面 + 當地緊急電話 + 附近的警局 / 醫院 / 藥局。
// 設計：超大字、可離線（快取最後位置與查詢結果）、給路人 / 警察看也看得懂。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, mount, avatar } from '../ui.js';
import { back } from '../router.js';
import { currentPosition, reverseGeocode, navUrl, mapUrl, fmtDist, lastKnown } from '../geo.js';
import { activeMemberId } from '../claim.js';
import { askShare } from './posconsent.js';
import { nearbyFacilities, KIND } from '../nearby.js';
import * as pos2 from '../pos.js';
import { hashHue } from '../ids.js';
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
  // 定位最久要等約 10 秒。緊急畫面不能只放一顆轉圈圈讓人乾等：
  // 有上次的位置就先顯示（標明是稍早的），沒有的話至少講清楚正在做什麼、要等多久。
  const locLine = h('div', { class: 'sos-loc' },
    h('span', { class: 'muted' }, '📡 正在定位…（最多約 10 秒）'));
  const cachedPos = lastKnown();
  const helpCard = h('div', { class: 'sos-help' },
    h('div', { class: 'sos-help-big' }, '我迷路了'),
    h('div', { class: 'sos-help-sub' },
      h('div', {}, '請幫我打電話給我的家人'),
      h('div', { class: 'sos-help-sub-en' }, 'Please help me call my family')),
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

  // ---- 3. 旅伴在哪（v1.60）----
  // 放在附近設施之前：走失的時候「家人在哪」比「警局在哪」更早需要。
  const crewBox = tripId ? h('div', { class: 'sos-section' }) : null;
  if (crewBox) page.append(crewBox);

  // ---- 4. 附近設施 ----
  const nearbyBox = h('div', { class: 'sos-section' },
    h('h3', {}, '附近的警局 / 醫院 / 藥局'),
    h('p', { class: 'muted', style: 'padding:4px 2px' }, '正在定位、查詢附近設施…'),
  );
  page.append(nearbyBox);

  // 有上次記到的位置就先畫出來，不要讓使用者在緊急時盯著空白等定位
  if (cachedPos) drawLocLine(locLine, { ...cachedPos, stale: true });

  // ---- 定位 → 位置文字 + 附近設施 ----
  const pos = await currentPosition({ maxAgeMs: 120000 });
  if (!pos) {
    mount(locLine, h('span', { class: 'muted' }, '拿不到位置。請開啟定位權限後重新整理。'));
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
  if (crewBox) {
    // 進 SOS 頁就更新一次自己的位置（有開分享才會動），家人那端才看得到新的；
    // 同時立刻拉一次別人的（不然要等下一輪排程，緊急的時候等不起）
    if (tripId) pos2.updateNow(tripId, { force: true, high: true })
      .then(() => import('../outbox.js')).then((o) => o.refreshNow()).catch(() => {});
    drawCrew(crewBox, tripId, trip, pos);
    const off = store.subscribe(() => { if (document.body.contains(crewBox)) drawCrew(crewBox, tripId, trip, pos); });
    window.addEventListener('hashchange', () => { if (!document.body.contains(crewBox)) off(); }, { once: true });
  }
}

// 旅伴的位置：只顯示「最後看到」，不假裝是即時的（PWA 沒有背景定位，
// App 沒開就不會更新 —— 這件事一定要在畫面上講清楚，不然家人會跑去撲空）。
function drawCrew(box, tripId, trip, myPos) {
  const members = trip ? store.membersOf(trip.groupId) : [];
  const me = activeMemberId(tripId);
  const shots = pos2.positionsOf(tripId);
  const sharing = pos2.sharing(tripId);
  const rows = [];
  for (const m of members) {
    if (m.id === me) continue;                          // 自己不用列
    const rec = shots.get(m.id);
    const d = rec ? pos2.describe(rec, myPos) : null;
    rows.push(h('div', { class: 'sos-crew' + (d && d.sos ? ' sos-crew-alert' : '') },
      avatar(m.displayName, hashHue(m.id)),
      h('div', { class: 'sc-main' },
        h('div', { class: 'sc-name' }, m.displayName,
          d && d.sos ? h('span', { class: 'tag tag-er' }, '⚠️ 按了求助') : null),
        d
          ? h('div', { class: 'sc-line' },
              (myPos
                ? (d.coarse ? '大約在附近' : distWord(d.dist))
                : '（先開定位才算得出距離）')
              + ` · 最後看到 ${d.when}（${d.ago}）`
              + (d.stale ? ' · 較舊' : ''))
          : h('div', { class: 'sc-line muted' }, '沒有分享位置'),
      ),
      d ? h('a', { class: 'btn btn-soft sm-btn', href: mapUrl(rec.lat, rec.lng), target: '_blank', rel: 'noopener' }, '🧭') : null,
    ));
  }
  mount(box,
    h('h3', {}, '👨‍👩‍👧 旅伴在哪'),
    rows.length ? h('div', { class: 'stack' }, ...rows)
      : h('p', { class: 'muted sm', style: 'padding:4px 2px' }, '這趟還沒有其他旅伴。'),
    h('p', { class: 'form-hint' },
      '顯示的是對方「最後一次打開 App 時」的位置——手機沒開著就不會更新，不是即時追蹤。'
      + '這個畫面每 20 秒自己更新一次；等不及就按下面的按鈕。'),
    h('button', {
      class: 'btn btn-soft btn-block', style: 'margin-top:6px',
      onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = '更新中…';
        try {
          const o = await import('../outbox.js');
          if (tripId) await pos2.updateNow(tripId, { force: true, high: true }).catch(() => {});
          await o.refreshNow();
        } finally { drawCrew(box, tripId, trip, myPos); }
      },
    }, '🔄 立刻更新旅伴位置'),
    sharing
      ? h('button', {
          class: 'btn btn-soft btn-block', style: 'margin-top:6px',
          onclick: async (e) => { e.currentTarget.disabled = true; await pos2.setSharing(tripId, false); toast('已停止分享，並刪除伺服器上的位置'); drawCrew(box, tripId, trip, myPos); },
        }, '🛑 停止分享我的位置')
      : h('button', {
          class: 'btn btn-soft btn-block', style: 'margin-top:6px',
          onclick: async () => { if (await askShare(tripId, trip)) { await pos2.setSharing(tripId, true); toast('已開始分享'); drawCrew(box, tripId, trip, myPos); } },
        }, '📍 讓家人看到我在哪'),
  );
}

function distWord(m) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} 公尺` : `${(m / 1000).toFixed(1)} 公里`;
}

function drawLocLine(el, pos, geo) {
  const age = Math.round((Date.now() - pos.at) / 60000);
  const coordTxt = `${pos.lat}, ${pos.lng}`;
  // 用 mount（會濾掉 null）——replaceChildren 遇到 null 會把 "null" 這個字串當文字
  // 塞進畫面。還沒查到地址時（離線、反向地理編碼失敗）就會在求助畫面上看到 "nullnull"，
  // 而那正是最需要這個畫面可靠的時候。
  mount(el,
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
      h('div', { class: 'sos-near-name' }, it.name,
        // 三態：OSM 明說有 → 紅標；明說沒有 → 灰標；沒資料 → 什麼都不寫（不裝懂）
        it.er ? h('span', { class: 'tag tag-er' }, '🚨 有急診')
          : it.erNo ? h('span', { class: 'tag tag-todo' }, '沒有急診') : null),
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
