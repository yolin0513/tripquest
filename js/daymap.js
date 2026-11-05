// 當日示意地圖（2026-11-05 起，參考畫面「手繪當日地圖」）。
// 只畫有座標的景點：圖釘＋依當天順序的虛線＋「時間 名稱」標籤＋遠路段的直線公里數＋指北針＋示意註記。
// 沒座標的站放不上去——**不能讓它靜默消失**（少畫幾站，圖反而更好看，那就是在騙人）：
// 圖釘的編號用「當天第幾站」，缺的站會跳號；圖下另外列出「這幾站沒有位置，沒畫上去」。
// 中間夾著沒位置的站的那一段，不是真的走過的路段：畫成淡的細線、不標公里數（標了就是把兩段當一段）。
// 圖釘有照片就用那一站最新的一張（使用者自己拍的），沒有就是圓點。
// 不照景點名字畫任何地標插圖（照名字畫就是猜，v1.74 原則）；底圖只有通用的紙紋與色塊。
import { h } from './ui.js';
import { reducesMotion } from './prefs.js';
import { legModeOf } from './legs.js';

const W = 340, H = 220, PAD = 34;
export const FS = 14;
export const KM_MIN = 3;          // 直線距離 ≥ 3 公里的路段才標（參考畫面只標遠的那段；近的標了只會擠）
const R_DOT = 11, R_PHOTO = 16;

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
export const hasPos = (s) => Number.isFinite(num(s.lat)) && Number.isFinite(num(s.lng)) && !(num(s.lat) === 0 && num(s.lng) === 0);

// 兩點的大圓距離（公里）
export function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export const kmText = (km) => `直線約 ${km < 10 ? km.toFixed(1).replace(/\.0$/, '') : Math.round(km)} km`;

// 純函式：daySpots 已照當天順序排好；timeOf(s) 回傳開始時間字串（沒填就空字串，不補）。
// hasPhoto(s)：這站有沒有照片（決定圖釘大小，好讓標籤避開）；照片本身由 dayMap 非同步補上。
export function dayMapModel(daySpots, timeOf = () => '', hasPhoto = () => false) {
  const all = daySpots.map((s, i) => ({ id: s.id, n: i + 1, name: s.name || '（沒有名字）', time: timeOf(s) || '', s }));
  const placedRaw = all.filter((x) => hasPos(x.s));
  const missing = all.filter((x) => !hasPos(x.s)).map(({ id, n, name, time }) => ({ id, n, name, time }));
  if (!placedRaw.length) return { placed: [], segs: [], missing, compass: null, w: W, h: H };
  // 等距圓柱投影：經度乘 cos(緯度) 讓東西向不被拉長；北朝上、不照比例尺，只保留相對方位
  const lat0 = placedRaw.reduce((a, x) => a + num(x.s.lat), 0) / placedRaw.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const px = placedRaw.map((x) => ({ ...x, gx: num(x.s.lng) * k, gy: -num(x.s.lat) }));
  const minX = Math.min(...px.map((p) => p.gx)), maxX = Math.max(...px.map((p) => p.gx));
  const minY = Math.min(...px.map((p) => p.gy)), maxY = Math.max(...px.map((p) => p.gy));
  const spanX = maxX - minX, spanY = maxY - minY;
  const sc = Math.min(spanX > 0 ? (W - 2 * PAD) / spanX : Infinity, spanY > 0 ? (H - 2 * PAD) / spanY : Infinity);
  const pins = px.map((p) => ({
    id: p.id, n: p.n, name: p.name, time: p.time, lat: num(p.s.lat), lng: num(p.s.lng),
    r: hasPhoto(p.s) ? R_PHOTO : R_DOT,
    x: Number.isFinite(sc) ? W / 2 + (p.gx - (minX + maxX) / 2) * sc : W / 2,
    y: Number.isFinite(sc) ? H / 2 + (p.gy - (minY + maxY) / 2) * sc : H / 2,
  }));
  // 路段：相鄰兩個「放得上去的」站；中間夾著沒位置的站（編號不連續）就是 gap
  const segs = pins.slice(1).map((b, i) => {
    const a = pins[i];
    const gap = b.n - a.n > 1;
    const km = kmBetween(a, b);
    // 交通方式：只在「中間沒夾站」且到達站記的前一站就是 a 時才算（js/legs.js）。
    // 中間夾著沒位置的站時，a 不是 b 真正的前一站，選的方式屬於另一段 → 不顯示。
    const mode = gap ? null : legModeOf(px[i].s, px[i + 1].s);
    // 字上寫明是哪兩站之間：兩條線靠得近時，光靠位置會被讀成別的路段（第一次截圖實際發生：4→5 的距離貼在第 1 站下面）
    return { from: a.n, to: b.n, mode, x1: a.x, y1: a.y, x2: b.x, y2: b.y, gap, km, kmLabel: !gap && km >= KM_MIN ? `${a.n}→${b.n} ${kmText(km)}` : '' };
  });
  const taken = pins.map((p) => box(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r));
  const placed = placeLabels(pins, taken);
  const segsOut = placeKm(segs, taken);
  const compass = placeCompass(taken);
  return { placed, segs: segsOut, missing, compass, w: W, h: H };
}

// ---------- 擺位（字寬用估的；實際有沒有疊到，截圖腳本在瀏覽器裡用 getBBox 量） ----------
const box = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const textW = (s, fs = FS) => [...s].reduce((a, c) => a + (c.codePointAt(0) > 255 ? fs : fs * 0.58), 0);
const overlap = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
const outside = (b) => b.x1 < 2 || b.x2 > W - 2 || b.y1 < 2 || b.y2 > H - 2;
const pick = (cands, taken) => cands.map((c) => ({ ...c, score: (outside(c.box) ? 1e6 : 0) + taken.reduce((a, t) => a + overlap(c.box, t), 0) }))
  .reduce((a, c) => (c.score < a.score ? c : a));
const textBox = (anchor, lx, ly, w, fs = FS) => {
  const x1 = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
  return box(x1, ly - fs, x1 + w, ly + 4);
};

// 標籤：每個依序試「右、左、上、下」，挑第一個不出框、不壓到別的標籤與圖釘的；都不行就挑重疊最少的
function placeLabels(pins, taken) {
  return pins.map((p) => {
    const text = `${p.time ? p.time + ' ' : ''}${p.name}`;
    const w = textW(text);
    const best = pick([
      { anchor: 'start', lx: p.x + p.r + 5, ly: p.y + FS / 2 - 2 },
      { anchor: 'end', lx: p.x - p.r - 5, ly: p.y + FS / 2 - 2 },
      { anchor: 'middle', lx: p.x, ly: p.y - p.r - 6 },
      { anchor: 'middle', lx: p.x, ly: p.y + p.r + FS + 3 },
    ].map((c) => ({ ...c, box: textBox(c.anchor, c.lx, c.ly, w) })), taken);
    taken.push(best.box);
    return { ...p, label: text, lx: best.lx, ly: best.ly, anchor: best.anchor };
  });
}

// 公里數：放在路段中點的兩側（垂直方向推開），挑不壓到別人的那一側
const KM_FS = 12;
function placeKm(segs, taken) {
  return segs.map((s) => {
    if (!s.kmLabel) return s;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
    const nx = -(s.y2 - s.y1) / len, ny = (s.x2 - s.x1) / len;
    const w = textW(s.kmLabel, KM_FS);
    // 沿線段試中點、三分之一、三分之二，每個點往兩側推開兩種距離（中點剛好有別站的圖釘時才找得到空位）
    const cands = [];
    for (const t of [0.5, 0.35, 0.65]) for (const d of [16, -16, 30, -30]) {
      const lx = s.x1 + (s.x2 - s.x1) * t + nx * d, ly = s.y1 + (s.y2 - s.y1) * t + ny * d + KM_FS / 2 - 2;
      cands.push({ lx, ly, box: textBox('middle', lx, ly, w, KM_FS) });
    }
    const best = pick(cands, taken);
    taken.push(best.box);
    return { ...s, kx: best.lx, ky: best.ly };
  });
}

// 指北針：右上、左上、右下、左下，挑空的那個角
function placeCompass(taken) {
  const S = 30;
  const best = pick([[W - S - 8, 8], [8, 8], [W - S - 8, H - S - 8], [8, H - S - 8]]
    .map(([x, y]) => ({ x, y, box: box(x, y, x + S, y + S) })), taken);
  taken.push(best.box);
  return { x: best.x, y: best.y, s: S };
}

// ---------- 畫 ----------
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) if (c != null) el.append(c);
  return el;
};
const f1 = (v) => v.toFixed(1);

// photoOf(s)：回傳 Promise<string>，那一站最新照片的網址（拿不到回空字串，圖釘維持圓點）。
// playKey：同一天的固定代號（行程＋第幾天）；播放中整頁重畫時，新的播放器靠它接著播。
// 沒座標的站列在圖下（示意圖與真實地圖共用）
export function missingNote(m) {
  return m.missing.length
    ? h('div', { class: 'dm-missing' },
      h('span', { class: 'dm-missing-label' }, m.placed.length ? '這幾站沒有位置，沒畫上去：' : '這天的景點都沒有位置，畫不出地圖：'),
      h('span', { class: 'dm-missing-list' }, m.missing.map((x) => `${x.n}. ${x.name}`).join('、')))
    : null;
}
export function dayMap(daySpots, timeOf, { hasPhoto = () => false, photoOf = null, playKey = '' } = {}) {
  const m = dayMapModel(daySpots, timeOf, hasPhoto);
  const missNote = missingNote(m);
  if (!m.placed.length) return h('div', { class: 'daymap is-empty' }, missNote);

  const g = svg('svg', { class: 'dm-svg', viewBox: `0 0 ${m.w} ${m.h}`, role: 'img',
    'aria-label': `當天路線示意圖：${m.placed.map((p) => `${p.n}. ${p.name}`).join('、')}` });
  const defs = svg('defs');
  g.append(defs);
  // 底：通用的紙紋色塊（不畫任何地標）
  g.append(svg('rect', { class: 'dm-bg', x: 0, y: 0, width: m.w, height: m.h, rx: 16 }));
  g.append(svg('path', { class: 'dm-deco', d: `M0 ${m.h * 0.78} Q ${m.w * 0.25} ${m.h * 0.7} ${m.w * 0.5} ${m.h * 0.8} T ${m.w} ${m.h * 0.76} L ${m.w} ${m.h} L 0 ${m.h} Z` }));
  for (const s of m.segs) {
    g.append(svg('line', { class: 'dm-seg' + (s.gap ? ' is-gap' : ''), x1: f1(s.x1), y1: f1(s.y1), x2: f1(s.x2), y2: f1(s.y2), 'data-from': s.from, 'data-to': s.to }));
  }
  // 指北針：北朝上（投影本來就是北朝上）
  if (m.compass) {
    const { x, y, s } = m.compass, cx = x + s / 2, cy = y + s / 2;
    g.append(svg('g', { class: 'dm-compass', 'aria-hidden': 'true' },
      svg('circle', { class: 'dm-compass-ring', cx, cy, r: s / 2 - 1 }),
      svg('path', { class: 'dm-compass-n', d: `M ${cx} ${y + 5} L ${cx + 5} ${cy + 1} L ${cx - 5} ${cy + 1} Z` }),
      svg('text', { class: 'dm-compass-t', x: cx, y: cy + 11, 'text-anchor': 'middle' }, '北')));
  }
  // 先畫全部圖釘、再畫全部字：字永遠在圖釘上面，不會被下一站蓋住
  for (const p of m.placed) {
    const pin = svg('g', { class: 'dm-pin', 'data-spot': p.id },
      svg('circle', { class: 'dm-pin-dot', cx: f1(p.x), cy: f1(p.y), r: p.r }),
      svg('text', { class: 'dm-pin-n', x: f1(p.x), y: f1(p.y + 4), 'text-anchor': 'middle' }, String(p.n)));
    g.append(pin);
    if (photoOf && p.r === R_PHOTO) {
      const s = daySpots.find((x) => x.id === p.id);
      Promise.resolve(photoOf(s)).then((url) => {
        if (!url) return;                                   // 拿不到就維持圓點＋編號（不留白）
        const cid = 'dmc-' + p.id;
        defs.append(svg('clipPath', { id: cid }, svg('circle', { cx: f1(p.x), cy: f1(p.y), r: p.r - 2 })));
        const img = svg('image', { class: 'dm-pin-photo', href: url, x: f1(p.x - p.r), y: f1(p.y - p.r), width: p.r * 2, height: p.r * 2,
          preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${cid})` });
        const badge = svg('g', { class: 'dm-pin-badge' },
          svg('circle', { class: 'dm-pin-dot', cx: f1(p.x + p.r - 3), cy: f1(p.y - p.r + 3), r: 8 }),
          svg('text', { class: 'dm-pin-n is-small', x: f1(p.x + p.r - 3), y: f1(p.y - p.r + 6.5), 'text-anchor': 'middle' }, String(p.n)));
        pin.replaceChildren(svg('circle', { class: 'dm-pin-ring', cx: f1(p.x), cy: f1(p.y), r: p.r }), img, badge);
        pin.classList.add('has-photo');
      }).catch(() => {});                                    // 照片讀失敗：照樣是圓點，地圖其他部分不受影響
    }
  }
  for (const s of m.segs) {
    if (s.kmLabel) g.append(svg('text', { class: 'dm-km', x: f1(s.kx), y: f1(s.ky), 'text-anchor': 'middle', 'data-from': s.from, 'data-to': s.to }, s.kmLabel));
  }
  // 回放的游標：在圖釘上面、字下面
  const cursor = svg('circle', { class: 'dm-cursor', cx: -100, cy: -100, r: 22, 'aria-hidden': 'true' });
  g.append(cursor);
  for (const p of m.placed) {
    g.append(svg('text', { class: 'dm-label', 'data-spot': p.id, x: f1(p.lx), y: f1(p.ly), 'text-anchor': p.anchor }, p.label));
  }
  const hasGap = m.segs.some((s) => s.gap);
  const put = (x, y, dim) => { cursor.setAttribute('cx', f1(x)); cursor.setAttribute('cy', f1(y)); cursor.classList.toggle('is-dim', !!dim); };
  const player = dayPlayer(m, {
    show: (p, dim) => put(p.x, p.y, dim),
    between: (a, b, t) => put(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, false),
  }, g, playKey);
  const note = h('p', { class: 'dm-note' },
    `示意圖：方位照實、比例不照實。標的公里數是兩站之間的直線距離（${KM_MIN} 公里以上才標），不是實際路程。`
    + (hasGap ? '淡色細線的兩站中間還有沒位置的站，所以不標距離。' : ''));
  return h('div', { class: 'daymap' }, g, player, note, missNote);
}

// ---------- 當日回放（乙） ----------
// 照當天順序一站一站走：每一站都停（包括沒位置的站）；移動中不顯示時鐘。
// 規矩：時鐘**只在到站時**顯示那一站使用者填的時間，沒填就不顯示——兩站之間的時刻是算出來的，顯示它就是編造。
// 沒位置的站：不默默跳過。停在那一步、跟別站停一樣久，大字寫「這一站沒有位置，地圖上沒畫」；游標留在上一站、變淡。
// 狀態寫在 data-step（第幾站）、data-phase（idle／stop／missing／move／done）上，測試照這個讀。
export const PLAY_MS = { stop: 1800, move: 1200 };
// ad（游標怎麼畫，示意圖與真實地圖各給一份）：show(站, 變淡?)、between(上一站, 這一站, 0~1)、onStep?(站或 null)。
// g：判斷「還在不在畫面上」用的元素。
export function dayPlayer(m, ad, g, playKey) {
  const byN = new Map([...m.placed.map((p) => [p.n, { ...p, pin: true }]), ...m.missing.map((x) => [x.n, { ...x, pin: false }])]);
  const steps = [...byN.keys()].sort((a, b) => a - b).map((n) => byN.get(n));
  const total = steps.length;
  const clock = h('span', { class: 'dm-clock' });
  const where = h('span', { class: 'dm-where' }, '按「播放」，照當天的順序走一遍');
  const prog = h('span', { class: 'dm-prog' }, `共 ${total} 站`);
  const btn = h('button', { class: 'btn dm-play', type: 'button' }, '▶ 播放');
  const box = h('div', { class: 'dm-player', dataset: { phase: 'idle', step: '0' }, 'aria-live': 'polite' },
    btn, h('div', { class: 'dm-now' }, clock, where), prog);

  let i = -1, timer = 0, playing = false, last = null;   // last：上一個放得上地圖的站（游標停的地方）
  const set = (phase, step, clk, text) => {
    box.dataset.phase = phase; box.dataset.step = String(step);
    clock.textContent = clk; clock.hidden = !clk; where.textContent = text;
    prog.textContent = step ? `第 ${step} / ${total} 站` : `共 ${total} 站`;
  };
  const step = (s) => { if (ad.onStep) ad.onStep(s); };
  const stop = (done) => {
    playing = false; clearTimeout(timer); timer = 0;
    if (playKey) live.delete(playKey);
    btn.textContent = done ? '↺ 再播一次' : '▶ 繼續';
    if (done) { set('done', total, '', '這一天走完了'); i = -1; last = null; step(null); }
  };
  // 不在畫面上了（整頁重畫、換頁）：這一份就停，但**不清掉**進度——重畫出來的新播放器會接著播
  const alive = () => { if (g.isConnected) return true; playing = false; clearTimeout(timer); return false; };
  const arrive = () => {
    const s = steps[i];
    if (playKey) live.set(playKey, { n: s.n, total, at: Date.now() });
    if (s.pin) { ad.show(s, false); last = s; set('stop', s.n, s.time, `${s.n}. ${s.name}`); }
    else {
      if (last) ad.show(last, true);
      set('missing', s.n, s.time, `${s.n}. ${s.name}\n這一站沒有位置，地圖上沒畫`);
    }
    step(s);
    timer = setTimeout(next, PLAY_MS.stop);
  };
  const next = () => {
    if (!alive()) return;
    if (!playing) return stop(false);
    i += 1;
    if (i >= total) return stop(true);
    const s = steps[i];
    // 移動：只有「上一個放得上的站」到「這一個放得上的站」才畫移動；減少動態效果時直接跳
    if (s.pin && last && !reducesMotion()) {
      set('move', s.n, '', `往第 ${s.n} 站`);
      const from = last;
      const t0 = performance.now();
      const tick = (now) => {
        if (!playing || !alive()) return;
        const t = Math.min(1, (now - t0) / PLAY_MS.move);
        ad.between(from, s, t);
        if (t < 1) requestAnimationFrame(tick); else arrive();
      };
      requestAnimationFrame(tick);
    } else arrive();
  };
  btn.addEventListener('click', () => {
    if (playing) return stop(false);
    playing = true; btn.textContent = '❚❚ 暫停';
    const ph = box.dataset.phase;
    if (ph === 'stop' || ph === 'missing') { timer = setTimeout(next, PLAY_MS.stop); return; }   // 停在站上暫停：繼續就往下一站
    if (ph === 'move') i -= 1;                                  // 移動中暫停：從上一站重新走到同一站
    next();
  });
  // 接著播：同一天、剛剛（10 秒內）還在播、站數沒變 → 從那一站重新到站（不重放移動）
  const saved = playKey && live.get(playKey);
  if (saved && saved.total === total && Date.now() - saved.at < RESUME_MS) {
    const k = steps.findIndex((s) => s.n === saved.n);
    if (k >= 0) {
      setTimeout(() => {
        if (!g.isConnected) return;
        playing = true; btn.textContent = '❚❚ 暫停';
        i = k; last = steps.slice(0, k).reverse().find((s) => s.pin) || null;
        if (last) ad.show(last, false);
        arrive();
      }, 0);
    }
  }
  return box;
}
const live = new Map();          // playKey → { n：播到第幾站, total, at }
const RESUME_MS = 10000;
