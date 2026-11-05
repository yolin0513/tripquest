// 總覽地圖：整趟行程的所有天畫在同一張真實地圖上（2026-11-05，Yolin 選 A：「總覽／每一天」分開看）。
// 每一天一個顏色；同一天的站用直線虛線連起來（不是實際路線），**天與天之間不連線**——
// 我們不知道晚上住哪、隔天從哪出發，連起來就是猜。圖釘只寫「第幾天」（數字），站名在地圖下的天數列裡。
// 點天數列的一天 → 切到那一天（跟日期列點那天一樣）；點圖釘 → 也切到那一天。
// 沒網路、圖磚全部載不到 → 不畫示意圖（整趟的範圍可能跨城市，示意圖讀不出來），改成寫明＋照樣列出天數。
import { h } from './ui.js';
import { tileMap } from './tilemap.js';
import { hasPos } from './daymap.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
// 每天的顏色：白字放在上面要讀得清楚（palettetest 驗對比），相鄰兩天色相差得開；超過 8 天循環
export const DAY_COLORS = ['#c2185b', '#1565c0', '#2e7d32', '#bf360c', '#6a1b9a', '#00838f', '#5d4037', '#37474f'];
export const dayColor = (d) => DAY_COLORS[(d - 1) % DAY_COLORS.length];

// byDay：Map(第幾天 → 當天依序的景點)；dayNums：要列的天（已排序）
export function overviewModel(byDay, dayNums) {
  const days = dayNums.map((d) => {
    const spots = byDay.get(d) || [];
    const placed = spots.map((s, i) => ({ id: s.id, n: i + 1, name: s.name || '（沒有名字）', lat: Number(s.lat), lng: Number(s.lng), ok: hasPos(s) })).filter((x) => x.ok);
    return { d, total: spots.length, placed, color: dayColor(d) };
  });
  return { days, any: days.some((x) => x.placed.length > 0) };
}

export function tripOverviewMap(byDay, dayNums, { onPickDay = () => {}, label = (d) => `第 ${d} 天` } = {}) {
  const m = overviewModel(byDay, dayNums);
  const wrap = h('div', { class: 'daymap is-real is-overview' });
  const list = h('div', { class: 'om-days', role: 'group', 'aria-label': '選一天看那一天的地圖' },
    ...m.days.map((x) => h('button', { class: 'om-day' + (x.placed.length ? '' : ' is-empty'), type: 'button', dataset: { day: String(x.d) }, onclick: () => onPickDay(x.d) },
      h('span', { class: 'om-day-dot', style: `background:${x.color}`, 'aria-hidden': 'true' }, String(x.d)),
      h('span', { class: 'om-day-t' }, label(x.d)),
      h('span', { class: 'om-day-sub' }, x.placed.length === x.total ? `${x.total} 站` : `${x.total} 站，${x.total - x.placed.length} 站沒有位置`))));
  if (!m.any) {
    wrap.append(h('p', { class: 'om-empty' },'這趟行程的景點都還沒有位置，總覽地圖畫不出來。到景點設定裡補上位置，就會出現在地圖上。'), list);
    return wrap;
  }
  const map = tileMap({ height: 300 });
  const lines = svg('svg', { class: 'rm-lines', 'aria-hidden': 'true' });
  const pinLayer = h('div', { class: 'rm-pins' });
  map.over.append(lines, pinLayer);
  const pins = [], segs = [];
  for (const x of m.days) {
    x.placed.forEach((p, i) => {
      const el = h('button', { class: 'om-pin', type: 'button', style: `--day:${x.color}`, dataset: { day: String(x.d), spot: p.id },
        'aria-label': `${label(x.d)}第 ${p.n} 站 ${p.name}，點了看這一天`, onclick: () => onPickDay(x.d) },
        h('span', { class: 'om-pin-dot' }, String(x.d)));
      pinLayer.append(el);
      pins.push({ p, el });
      if (i > 0) {
        const a = x.placed[i - 1];
        const ln = svg('line', { class: 'om-seg' + (p.n - a.n > 1 ? ' is-gap' : ''), stroke: x.color, 'data-day': x.d });
        lines.append(ln);
        segs.push({ a, b: p, ln });
      }
    });
  }
  map.onRender(() => {
    lines.setAttribute('width', map.el.clientWidth || 340); lines.setAttribute('height', 300);
    for (const { p, el } of pins) { const q = map.project(p.lat, p.lng); el.style.transform = `translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)`; }
    for (const { a, b, ln } of segs) {
      const qa = map.project(a.lat, a.lng), qb = map.project(b.lat, b.lng);
      ln.setAttribute('x1', qa.x.toFixed(1)); ln.setAttribute('y1', qa.y.toFixed(1)); ln.setAttribute('x2', qb.x.toFixed(1)); ln.setAttribute('y2', qb.y.toFixed(1));
    }
  });
  const hint = h('p', { class: 'rm-hint' }, '每一天一個顏色，圖釘上的數字是第幾天。點下面的一天，或點圖釘，就看那一天。');
  const note = h('p', { class: 'dm-note' }, '同一天的站用直線連起來，不是實際走的路線；天與天之間沒有連線。');
  wrap.append(map.el, list, hint, note);
  let fell = false;
  map.onStatus(({ failed, total }) => {
    if (fell || !total || failed < total) return;
    fell = true;
    map.el.replaceWith(h('p', { class: 'rm-offline', role: 'status' }, '目前沒有網路，總覽地圖要有網路才畫得出來。點下面的一天，可以看那一天的示意圖。'));
  });
  map.fit(pins.map(({ p }) => ({ lat: p.lat, lng: p.lng })));
  return wrap;
}
