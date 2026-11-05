// 當日真實地圖（2026-11-05，取代甲的示意插畫；規格 docs/SPEC_真實地圖.md）。
// 底圖是 OpenStreetMap 圖磚（js/tilemap.js）；圖釘＝當天第幾站（沒座標的站跳號、列在圖下）；
// 站與站之間畫**直線**虛線（不是實際路線——我們沒有路線資料）；地圖下一排站名標籤：「全」看整天、點一站看那一站。
// 回放沿用 daymap.js 的 dayPlayer（時鐘只在到站時顯示、沒位置的站停下來寫明）。
// 沒網路、這一天的圖磚一張都載不到 → 整個換成示意圖，並寫明「目前沒有網路」（Yolin 2026-11-05 接受）。
// 🔶 樣式（圖釘卡片、粉紅色、標籤排版）依 Dispatch 轉述、原圖未核；這一版先做骨架與互動，樣式最後定。
import { h } from './ui.js';
import { tileMap } from './tilemap.js';
import { dayMapModel, dayMap, dayPlayer, missingNote } from './daymap.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
export const Z_STOP = 15;                 // 點一站時至少放大到街區級

export function dayRealMap(daySpots, timeOf, opts = {}) {
  const { hasPhoto = () => false, photoOf = null, playKey = '' } = opts;
  const m = dayMapModel(daySpots, timeOf, hasPhoto);
  if (!m.placed.length) return dayMap(daySpots, timeOf, opts);          // 全部沒座標：沿用示意圖那份「畫不出地圖」的說明

  const wrap = h('div', { class: 'daymap is-real', dataset: { sel: '0' } });
  const map = tileMap({ height: 280, onHome: () => select(0, false) });
  const lines = svg('svg', { class: 'rm-lines', 'aria-hidden': 'true' });
  const pinLayer = h('div', { class: 'rm-pins' });
  const cursor = h('div', { class: 'rm-cursor', 'aria-hidden': 'true' });
  cursor.hidden = true;
  map.over.append(lines, pinLayer, cursor);

  // 圖釘：卡片＋編號。卡片裡只放有根據的東西——那一站使用者拍的最新照片；沒有就只放編號（不照名字猜圖示）
  const pins = m.placed.map((p) => {
    const card = h('span', { class: 'rm-pin-card' }, h('span', { class: 'rm-pin-big' }, String(p.n)));
    const el = h('button', { class: 'rm-pin', type: 'button', dataset: { spot: p.id, n: String(p.n) }, 'aria-label': `第 ${p.n} 站 ${p.name}`, onclick: () => select(p.n, true) },
      card, h('span', { class: 'rm-pin-n' }, String(p.n)));
    pinLayer.append(el);
    if (photoOf && hasPhoto(daySpots.find((x) => x.id === p.id))) {
      Promise.resolve(photoOf(daySpots.find((x) => x.id === p.id))).then((url) => {
        if (!url) return;
        card.replaceChildren(h('img', { class: 'rm-pin-photo', src: url, alt: '' }));
        el.classList.add('has-photo');
      }).catch(() => {});
    }
    return { p, el };
  });
  const segs = m.placed.slice(1).map((b, i) => {
    const a = m.placed[i];
    const ln = svg('line', { class: 'rm-seg' + (b.n - a.n > 1 ? ' is-gap' : ''), 'data-from': a.n, 'data-to': b.n });
    lines.append(ln);
    return { a, b, ln };
  });

  let cur = null;                                         // 回放游標的經緯度
  function draw() {
    const w = map.el.clientWidth || 340, hh = 280;
    lines.setAttribute('width', w); lines.setAttribute('height', hh);
    for (const { p, el } of pins) { const q = map.project(p.lat, p.lng); el.style.transform = `translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)`; }
    for (const { a, b, ln } of segs) {
      const qa = map.project(a.lat, a.lng), qb = map.project(b.lat, b.lng);
      ln.setAttribute('x1', qa.x.toFixed(1)); ln.setAttribute('y1', qa.y.toFixed(1)); ln.setAttribute('x2', qb.x.toFixed(1)); ln.setAttribute('y2', qb.y.toFixed(1));
    }
    if (cur) { const q = map.project(cur.lat, cur.lng); cursor.style.transform = `translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)`; }
  }
  map.onRender(draw);

  // 站名標籤列：「全」＋每一站（沒座標的也列，點了不移地圖、改寫明沒有位置）
  const steps = [...m.placed.map((p) => ({ ...p, pin: true })), ...m.missing.map((x) => ({ ...x, pin: false }))].sort((a, b) => a.n - b.n);
  const chip = (n, label, extra = '') => h('button', { class: 'rm-chip' + extra, type: 'button', dataset: { n: String(n) }, 'aria-pressed': 'false', onclick: () => select(n, true) },
    h('span', { class: 'rm-chip-n' }, n ? String(n) : '全'), h('span', { class: 'rm-chip-t' }, label));
  const chips = [chip(0, '整天路線', ' is-all'), ...steps.map((s) => chip(s.n, s.name, s.pin ? '' : ' is-missing'))];
  const strip = h('div', { class: 'rm-strip', role: 'group', 'aria-label': '選一站看地圖' }, ...chips);
  const selNote = h('p', { class: 'rm-selnote', 'aria-live': 'polite' });
  selNote.hidden = true;

  // mark：只改選中的樣子；select：再加上移動地圖
  function mark(n) {
    wrap.dataset.sel = String(n);
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.n === String(n)));
    const s = steps.find((x) => x.n === n);
    for (const { p, el } of pins) { el.classList.toggle('is-sel', p.n === n); el.classList.toggle('is-dim', n !== 0 && !!s?.pin && p.n !== n); }
    selNote.hidden = true;
    if (s && !s.pin) { selNote.textContent = `${s.n}. ${s.name}：這一站沒有位置，地圖上沒畫`; selNote.hidden = false; }
    return s;
  }
  function select(n, fromUser) {
    const s = mark(n);
    if (n === 0) { if (fromUser) map.home(); }
    else if (s && s.pin) map.focus(s.lat, s.lng, Z_STOP);
    remember();
    const on = chips.find((c) => c.dataset.n === String(n));
    // 只橫向捲標籤列，把選中的那顆捲到中間；不用 scrollIntoView（標籤列不完全在畫面上時，它會連整頁一起上下捲、可能把地圖捲到黏住的日期列底下）
    if (on && fromUser) strip.scrollTo({ left: Math.max(0, on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' });
  }
  chips[0].setAttribute('aria-pressed', 'true');

  // 回放：游標用經緯度內插（使用者縮放、拖地圖時照樣跟得上）；標籤列跟著標出目前那一站，但不移動地圖（v1）
  const player = dayPlayer(m, {
    show: (p, dim) => { cur = { lat: p.lat, lng: p.lng }; cursor.hidden = false; cursor.classList.toggle('is-dim', !!dim); draw(); },
    between: (a, b, t) => { cur = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }; cursor.hidden = false; cursor.classList.remove('is-dim'); draw(); },
    onStep: (s) => { for (const c of chips) c.classList.toggle('is-now', !!s && c.dataset.n === String(s.n)); if (!s) { cur = null; cursor.hidden = true; } },
  }, map.el, playKey);

  const hasGap = segs.some((s) => s.b.n - s.a.n > 1);
  const hint = h('p', { class: 'rm-hint' }, '點下面的站名，地圖會移到那一站；點「全」看整天路線。');
  const note = h('p', { class: 'dm-note' }, '線是兩站之間的直線，不是實際走的路線。' + (hasGap ? '淡色細線的兩站中間還有沒位置的站。' : ''));
  wrap.append(map.el, strip, selNote, hint, player, note);
  const miss = missingNote(m);
  if (miss) wrap.append(miss);

  // 沒網路：這一天要的圖磚全部載不到 → 換成示意圖並寫明（看過的圖磚由 Service Worker 留著，那種情況不會走到這裡）
  let fell = false;
  map.onStatus(({ failed, total }) => {
    if (fell || !total || failed < total) return;
    fell = true;
    const alt = dayMap(daySpots, timeOf, opts);
    alt.prepend(h('p', { class: 'rm-offline', role: 'status' }, '目前沒有網路，先顯示示意圖。有網路時看過的地方，之後沒網路也看得到。'));
    wrap.replaceWith(alt);
  });

  map.fit(m.placed.map((p) => ({ lat: p.lat, lng: p.lng })));
  // 行程頁會因為同步進來整頁重畫：同一天重畫出來的地圖，接著用剛剛的視野與選中的那一站（用景點 id 對，站被重排也不會選錯）
  function remember() {
    if (!playKey) return;
    const n = Number(wrap.dataset.sel);
    kept.set(playKey, { selId: n ? steps.find((x) => x.n === n)?.id || '' : '', view: map.view() && { ...map.view() } });
  }
  const saved = playKey && kept.get(playKey);
  if (saved) {
    const s = saved.selId ? steps.find((x) => x.id === saved.selId) : null;
    if (saved.view) map.setView(saved.view);
    mark(s ? s.n : 0);
  }
  map.onRender(remember);
  return wrap;
}
const kept = new Map();          // playKey（行程:第幾天）→ { selId, view }
