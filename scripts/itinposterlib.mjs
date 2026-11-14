// 行程海報（v1.88.0）測試共用的檢查器（被 scripts/itinposterlayouttest.mjs、scripts/itinpostertest.mjs import，不單獨執行）。
// 兩支用同一組檢查：node 那支用近似字寬排版，瀏覽器那支用 canvas 的 measureText 排版——同一個檢查器、兩種字寬。
// 每一個檢查器都有對照組（layoutControls、pdfControls）：一份一定要被抓到的樣本、一份一定要放行的；
// 用到它的測試**每次先跑對照組**，沒過就停、不採信後面的結果（共用慣例 §5.3）。
import { M, PW, A4H } from '../js/itinposter/layout.js';
import { A4_WIDTH_PT } from '../js/pdf.js';

const EDGE = 2;
export const texts = (pg) => (pg && pg.ops ? pg.ops.filter((o) => o.op === 'text') : []);
export function textBox(o) {
  const left = o.align === 'center' ? o.x - o.w / 2 : o.align === 'right' ? o.x - o.w : o.x;
  return { x: left, y: o.y - o.size * 0.88, w: o.w, h: o.size * 1.1 };
}
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;

// 出界：字與框都在左右邊界以內、上下在頁面裡
export function outOfBounds(pg) {
  const ok = (r) => r.x >= M - EDGE && r.x + r.w <= PW - M + EDGE && r.y >= 0 && r.y + r.h <= pg.h;
  return [...texts(pg).filter((o) => !ok(textBox(o))).map((o) => `字「${o.text}」`), ...pg.boxes.filter((b) => !ok(b)).map((b) => `框 ${b.kind}`)];
}
// 框疊框：stopbox 以外的框兩兩不疊；stopbox 整個在某一條色帶裡、彼此不疊、也不疊到色帶以外的框
export function boxClash(pg) {
  const bad = [];
  const top = pg.boxes.filter((b) => b.kind !== 'stopbox');
  const sb = pg.boxes.filter((b) => b.kind === 'stopbox');
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) if (overlap(top[i], top[j])) bad.push(`${top[i].kind}×${top[j].kind}`);
  sb.forEach((s, i) => {
    if (!top.some((b) => b.kind === 'band' && inside(s, b))) bad.push('stopbox 不在色帶裡');
    for (let j = i + 1; j < sb.length; j++) if (overlap(s, sb[j])) bad.push('stopbox×stopbox');
    for (const b of top) if (b.kind !== 'band' && overlap(s, b)) bad.push(`stopbox×${b.kind}`);
  });
  return bad;
}
// 字疊字
export function textClash(pg) {
  const t = texts(pg).map((o) => ({ o, r: textBox(o) }));
  const bad = [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (overlap(t[i].r, t[j].r)) bad.push(`「${t[i].o.text}」×「${t[j].o.text}」`);
  return bad;
}
// 站名、時間在站牌框（或色帶裡的站框）裡；「還有 N 站」在站牌框或色帶裡
export function strayText(pg) {
  const bad = [];
  for (const o of texts(pg)) {
    const kinds = o.role === 'stop' || o.role === 'time' ? ['frame', 'stopbox'] : o.role === 'more' && o.day != null ? ['frame', 'band'] : null;
    if (kinds && !pg.boxes.some((b) => kinds.includes(b.kind) && inside(textBox(o), b))) bad.push(`${o.role}「${o.text}」`);
  }
  return bad;
}
// 站數母體：days 是這一張應該有的那幾天
export function stopPopulation(pg, days) {
  const got = new Map();
  const bad = [];
  for (const o of texts(pg)) {
    if (o.day == null || (o.role !== 'stop' && o.role !== 'more')) continue;
    if (!got.has(o.day)) got.set(o.day, { names: [], more: 0 });
    if (o.role === 'stop') got.get(o.day).names.push(o.full);
    else {
      got.get(o.day).more += o.more || 0;
      if (o.full !== `還有 ${o.more} 站`) bad.push(`第 ${o.day} 天「${o.full}」跟數字 ${o.more} 對不上`);
    }
  }
  for (const d of days) {
    const g = got.get(d.day) || { names: [], more: 0 };
    const want = d.stops.map((s) => s.name);
    if (g.names.length + g.more !== want.length) bad.push(`第 ${d.day} 天：畫 ${g.names.length}＋還有 ${g.more}≠${want.length}`);
    else if (g.names.some((n, i) => n !== want[i])) bad.push(`第 ${d.day} 天：畫的不是前 ${g.names.length} 站、或順序不對`);
  }
  for (const k of got.keys()) if (!days.some((d) => d.day === k)) bad.push(`多畫了第 ${k} 天`);
  return bad;
}
// 面板上的清單（必吃 role food、天氣 role tip）：畫出來的＋「還有 N 項／天」＝應有的，而且是前幾項、照順序
export function panelPopulation(pg, role, want, unit) {
  const got = texts(pg).filter((o) => o.role === role).map((o) => o.full);
  const moreOps = texts(pg).filter((o) => o.role === 'more' && o.day == null && o.full.endsWith(unit));
  const more = moreOps.reduce((a, o) => a + (o.more || 0), 0);
  const bad = [];
  if (got.length + more !== want.length) bad.push(`畫 ${got.length}＋還有 ${more}≠${want.length}`);
  if (got.some((n, i) => n !== want[i])) bad.push('畫的不是前幾項、或順序不對');
  if (moreOps.some((o) => o.full !== `還有 ${o.more} ${unit}`)) bad.push(`「還有 N ${unit}」的字跟數字對不上`);
  return bad;
}
// 色帶裡的「必吃：」那一行：一天一行，名字照順序、剩下的寫「還有 N 項」，不截半個名字
export function parseFoodLine(full) {
  const [head, tail] = String(full).split('，還有 ');
  const more = tail === undefined ? 0 : /^\d+ 項$/.test(tail) ? Number(tail.split(' ')[0]) : NaN;
  return { names: head.split('、'), more };
}
export function foodLines(pg, days) {
  const lines = texts(pg).filter((o) => o.role === 'foodline');
  const withFood = days.filter((d) => d.foods.length);
  const bad = [];
  if (lines.length !== withFood.length) bad.push(`必吃那一行 ${lines.length} 行≠有必吃的天 ${withFood.length}`);
  withFood.forEach((d, i) => {
    const o = lines[i];
    if (!o) return;
    const p = parseFoodLine(o.full);
    if (p.names.length + p.more !== d.foods.length || p.names.some((n, j) => n !== d.foods[j].name)) bad.push(`第 ${d.day} 天「${o.full}」對不上 ${d.foods.length} 項`);
    if (o.text !== o.full) bad.push(`第 ${d.day} 天的必吃那一行被截掉（${o.text}）`);
  });
  return bad;
}
// 字的來源：模型裡的字、固定的幾個標題、從模型數出來的句子
export function allowedTexts(model, pageText) {
  const A = new Set(['必吃清單', '這天的必吃', '（景點資料庫整理的）', '必吃：', 'START', 'GOAL', 'DAY', 'TripQuest']);
  A.add(model.title);
  if (model.span) A.add(model.span.label);
  A.add([model.dateRange, model.people ? `旅伴 ${model.people} 人` : ''].filter(Boolean).join('｜'));
  A.add(model.span ? `${model.span.label}，${model.placeCount} 個地方！` : `${model.placeCount} 個地方！`);
  if (pageText) A.add(pageText);
  for (const d of model.days) {
    [`DAY ${d.day}`, `DAY${d.day}`, String(d.day), d.date, d.stops.length > 1 ? `${d.from} → ${d.to}` : d.from, `第 ${d.day} 天，${d.placeCount} 個地方！`].forEach((x) => x && A.add(x));
    d.stops.forEach((s, i) => {
      A.add(s.name); A.add(String(i + 1));
      if (s.time) A.add(s.time);
      if (s.leg) { A.add(s.leg.label); if (s.leg.icon) { A.add(s.leg.icon); A.add(`${s.leg.icon} ${s.leg.label}`); } }
    });
    for (const f of d.foods) { A.add(f.name); A.add(f.at); }
  }
  for (const t of model.tips) { A.add(t.date); if (t.icon) A.add(t.icon); A.add(t.text); }
  if (model.tipsAsOf) A.add(`小提醒・天氣預報（${model.tipsAsOf} 查）`);
  return A;
}
export function unsourced(pg, A, foodNames) {
  const isFoodLine = (s) => { const p = parseFoodLine(s); return Number.isInteger(p.more) && p.names.every((n) => foodNames.has(n)); };
  return texts(pg).filter((o) => !(A.has(o.full) || /^還有 \d+ [站項天]$/.test(o.full) || (o.role === 'foodline' && isFoodLine(o.full))))
    .map((o) => `「${o.full}」（${o.role}）`);
}
// 類別：類別名不准單獨出現；emoji 只准交通與天氣的圖示（類別的 emoji、每站 emoji 都不准）
export function categoryLeak(pg, icons, labels) {
  const bad = [];
  for (const o of texts(pg)) {
    let s = o.full;
    for (const ic of icons) s = s.split(ic).join('');
    if (/\p{Extended_Pictographic}/u.test(s)) bad.push(`emoji「${o.full}」`);
    if (labels.has(o.full)) bad.push(`類別名「${o.full}」`);
  }
  return bad;
}

// 一組（一份模型 × 一種版型 × 一種張數）的每一張都跑這幾條；B1、B2 是整組的，其餘逐張。
// x：{ m（模型）, kind, split, pages }；opts：{ icons（交通圖示）, labels（類別名） }
export const PAGE_CHECKS = [
  ['B2', '寬固定、高是有限的數、每天一張至少 A4', (x, pg) => (pg.w === PW && Number.isFinite(pg.h) && pg.h > 0 && (x.split === 'one' || pg.h >= A4H) ? [] : [`${pg.w}×${pg.h}`])],
  ['B3', '字與框不出界', (x, pg) => outOfBounds(pg)],
  ['B4', '框不疊框', (x, pg) => boxClash(pg)],
  ['B5', '字不疊字', (x, pg) => textClash(pg)],
  ['B6', '站名與時間在站牌框裡', (x, pg) => strayText(pg)],
  ['B7', '站數母體：畫出來的站＋還有 N 站＝那天的站數，是前幾站、照順序', (x, pg, i) => stopPopulation(pg, x.split === 'one' ? x.m.days : [x.m.days[i]])],
  ['B8', '必吃母體：畫出來的＋還有 N 項＝應有的，是前幾項、照順序（色帶全部一張看每天那一行）', (x, pg, i) => {
    if (x.kind === 'band' && x.split === 'one') return foodLines(pg, x.m.days);
    return panelPopulation(pg, 'food', (x.split === 'one' ? x.m.foods : x.m.days[i].foods).map((f) => f.name), '項');
  }],
  ['B9', '天氣母體：畫出來的＋還有 N 天＝應有的（每天一張只放那一天）', (x, pg, i) =>
    panelPopulation(pg, 'tip', (x.split === 'one' ? x.m.tips : x.m.tips.filter((t) => t.day === x.m.days[i].day)).map((t) => t.text), '天')],
  ['B10', '字的來源：只有模型裡的字、固定的標題、從模型數出來的句子', (x, pg, i) =>
    unsourced(pg, allowedTexts(x.m, x.split === 'day' ? `第 ${i + 1}／${x.pages.length} 張` : ''), new Set(x.m.days.flatMap((d) => d.foods.map((f) => f.name))))],
  ['B11', '沒有類別名、沒有類別或每站的 emoji（只准交通與天氣圖示）', (x, pg, i, o) => categoryLeak(pg, [...o.icons, ...x.m.tips.map((t) => t.icon).filter(Boolean)], o.labels)],
];
// 張數與標籤：全部一張 → 1 張；每天一張 → 天數張、照天排
export function pageListProblems(x) {
  const want = x.split === 'one' ? [['全部', 0]] : x.m.days.map((d) => [`第${d.day}天`, d.day]);
  const got = x.pages.map((p) => [p.label, p.day]);
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${JSON.stringify(got.map((g) => g[0]))}`];
}

// PDF：xref 的每一個位置、startxref、頁數、長度欄位、頁面比例。
// images：[{ w, h, bytes? }]——有 bytes 就逐位元組比對圖的內容；沒有（從瀏覽器下載來的，不知道 JPEG 的內容）就看開頭 FF D8、結尾 FF D9
export function pdfProblems(u8, images) {
  const s = Buffer.from(u8).toString('latin1');
  const bad = [];
  const n = images.length, size = 3 + 3 * n;
  if (!s.startsWith('%PDF-1.4\n') || !s.endsWith('%%EOF\n')) bad.push('檔頭或檔尾');
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(s);
  const xrefAt = sx ? Number(sx[1]) : -1;
  if (!(xrefAt > 0 && s.startsWith('xref\n', xrefAt))) bad.push('startxref 沒指到 xref');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(Math.max(0, xrefAt)));
  if (!head || Number(head[1]) !== size) bad.push(`xref 的物件數（實得 ${head && head[1]}，應為 ${size}）`);
  else {
    const at = xrefAt + head[0].length;
    for (let k = 0; k < size; k++) {
      const e = s.slice(at + k * 20, at + k * 20 + 20);
      const m = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(e);
      if (!m) { bad.push(`xref 第 ${k} 筆格式`); continue; }
      if (k > 0 && !s.startsWith(`${k} 0 obj\n`, Number(m[1]))) bad.push(`xref 第 ${k} 筆的位置沒指到「${k} 0 obj」`);
    }
  }
  if (!new RegExp(`/Size ${size} /Root 1 0 R`).test(s)) bad.push('trailer 的 /Size');
  const kids = Array.from({ length: n }, (_, i) => `${3 + 3 * i} 0 R`).join(' ');
  if (!s.includes(`/Kids [${kids}] /Count ${n} >>`)) bad.push('頁面樹的 /Kids 或 /Count');
  images.forEach((im, i) => {
    const page = 3 + 3 * i, content = page + 1, img = page + 2;
    const pw = +A4_WIDTH_PT.toFixed(2), ph = +(A4_WIDTH_PT * im.h / im.w).toFixed(2);
    if (!s.includes(`${page} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}]`)) bad.push(`第 ${i + 1} 頁的 MediaBox`);
    const cm = new RegExp(`${content} 0 obj\\n<< /Length (\\d+) >>\\nstream\\n([^\\n]*)\\nendstream`).exec(s);
    if (!cm || Number(cm[1]) !== cm[2].length || cm[2] !== `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`) bad.push(`第 ${i + 1} 頁的內容或它的 /Length`);
    const im0 = s.indexOf(`${img} 0 obj\n`);
    const hdr = im0 >= 0 ? /<< \/Type \/XObject \/Subtype \/Image \/Width (\d+) \/Height (\d+) [^>]*\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/.exec(s.slice(im0)) : null;
    const len = hdr ? Number(hdr[3]) : -1;
    if (!hdr || Number(hdr[1]) !== im.w || Number(hdr[2]) !== im.h || (im.bytes && len !== im.bytes.length)) { bad.push(`第 ${i + 1} 張圖的欄位或 /Length`); return; }
    const start = im0 + hdr.index + hdr[0].length;
    const body = u8.subarray(start, start + len);
    const sameBody = im.bytes ? Buffer.compare(Buffer.from(body), Buffer.from(im.bytes)) === 0
      : body.length > 4 && body[0] === 0xff && body[1] === 0xd8 && body[len - 2] === 0xff && body[len - 1] === 0xd9;
    if (!sameBody || !s.startsWith('\nendstream', start + len)) bad.push(`第 ${i + 1} 張圖的內容`);
  });
  return bad;
}

// ---------------- 對照組 ----------------
// ctl(label, got, want)：呼叫的測試給的斷言函式（印 ✓／✗、記下有沒有全過）
// opts：{ measure, foodEmoji, foodLabel, legText（例「🚘 搭車」）, icons, labels }
export function layoutControls(ctl, { measure, foodEmoji, foodLabel, legText, icons, labels }) {
  const tx = (text, x, y, size, extra = {}) => ({ op: 'text', text, full: text, x, y, size, w: measure(text, size), align: 'left', role: 'text', day: null, more: null, ...extra });
  const page = (ops, boxes, h = 600) => ({ w: PW, h, ops, boxes });
  const fakeDay = (day, names, foods = []) => ({ day, date: '', from: names[0], to: names[names.length - 1], stops: names.map((name) => ({ name, time: '', leg: null })), foods, placeCount: new Set(names).size });
  const first = (arr) => (arr.length ? arr[0] : '');
  ctl('字出界', outOfBounds(page([tx('超出右邊', PW - M - 10, 100, 30)], [])).length, 1);
  ctl('框出界', outOfBounds(page([], [{ kind: 'panel', x: M, y: 500, w: 200, h: 200 }])), ['框 panel']);
  ctl('不出界的放行', outOfBounds(page([tx('好', M + 10, 100, 30)], [{ kind: 'panel', x: M, y: 10, w: 300, h: 200 }])), []);
  ctl('框疊框', boxClash(page([], [{ kind: 'panel', x: 100, y: 100, w: 200, h: 100 }, { kind: 'bubble', x: 250, y: 150, w: 100, h: 100 }])), ['panel×bubble']);
  ctl('站框不在色帶裡', boxClash(page([], [{ kind: 'band', x: 60, y: 0, w: 400, h: 100 }, { kind: 'stopbox', x: 60, y: 200, w: 100, h: 50 }])), ['stopbox 不在色帶裡']);
  ctl('站框在色帶裡、框只相鄰的放行', boxClash(page([], [{ kind: 'band', x: 60, y: 0, w: 400, h: 100 }, { kind: 'stopbox', x: 80, y: 20, w: 100, h: 50 }, { kind: 'panel', x: 60, y: 100, w: 400, h: 50 }])), []);
  ctl('字疊字', textClash(page([tx('甲乙丙', 100, 100, 30), tx('丁戊', 130, 110, 30)], [])).length, 1);
  ctl('字不疊的放行', textClash(page([tx('甲乙丙', 100, 100, 30), tx('丁戊', 100, 160, 30)], [])), []);
  ctl('站名不在站牌框裡', strayText(page([tx('某站', 100, 100, 30, { role: 'stop', day: 1 })], [{ kind: 'frame', x: 300, y: 0, w: 200, h: 200 }])), ['stop「某站」']);
  ctl('站名在站牌框裡的放行', strayText(page([tx('某站', 310, 100, 30, { role: 'stop', day: 1 })], [{ kind: 'frame', x: 300, y: 0, w: 200, h: 200 }])), []);
  const d3 = fakeDay(1, ['甲', '乙', '丙']);
  const st = (n) => tx(n, 0, 0, 20, { role: 'stop', day: 1 });
  ctl('站數：少畫一站又沒寫還有', stopPopulation(page([st('甲'), st('乙')], []), [d3]), ['第 1 天：畫 2＋還有 0≠3']);
  ctl('站數：順序不對', stopPopulation(page([st('乙'), st('甲'), st('丙')], []), [d3]), ['第 1 天：畫的不是前 3 站、或順序不對']);
  ctl('站數：畫兩站＋還有 1 站的放行', stopPopulation(page([st('甲'), st('乙'), tx('還有 1 站', 0, 0, 20, { role: 'more', day: 1, more: 1 })], []), [d3]), []);
  ctl('站數：還有的字跟數字不一樣', first(stopPopulation(page([st('甲'), st('乙'), tx('還有 2 站', 0, 0, 20, { role: 'more', day: 1, more: 1 })], []), [d3])), '第 1 天「還有 2 站」跟數字 1 對不上');
  ctl('面板：少一項沒寫還有', panelPopulation(page([tx('a', 0, 0, 20, { role: 'food' })], []), 'food', ['a', 'b'], '項'), ['畫 1＋還有 0≠2']);
  ctl('面板：畫一項＋還有 1 項的放行', panelPopulation(page([tx('a', 0, 0, 20, { role: 'food' }), tx('還有 1 項', 0, 0, 20, { role: 'more', more: 1 })], []), 'food', ['a', 'b'], '項'), []);
  const abc = [fakeDay(1, ['甲'], [{ name: 'a' }, { name: 'b' }, { name: 'c' }])];
  ctl('必吃那一行少了一項', foodLines(page([tx('a、b', 0, 0, 20, { role: 'foodline' })], []), abc), ['第 1 天「a、b」對不上 3 項']);
  ctl('必吃那一行對得上的放行', foodLines(page([tx('a、b，還有 1 項', 0, 0, 20, { role: 'foodline' })], []), abc), []);
  const ctlModel = { title: '合成', span: { label: '2天1夜' }, dateRange: '', people: 0, placeCount: 1, days: [fakeDay(1, ['甲'])], tips: [], tipsAsOf: '' };
  ctl('沒有來源的字', unsourced(page([tx('好好玩', 0, 0, 20, { role: 'bubble' }), tx('甲', 0, 0, 20, { role: 'stop' })], []), allowedTexts(ctlModel, ''), new Set()), ['「好好玩」（bubble）']);
  ctl('有來源的字放行（站名、固定標題、還有 N 站）', unsourced(page([tx('甲', 0, 0, 20), tx('START', 0, 0, 20), tx('還有 3 站', 0, 0, 20), tx('2天1夜，1 個地方！', 0, 0, 20)], []), allowedTexts(ctlModel, ''), new Set()), []);
  ctl('類別 emoji 接在站名前面', categoryLeak(page([tx(`${foodEmoji} 甲`, 0, 0, 20)], []), icons, labels), [`emoji「${foodEmoji} 甲」`]);
  ctl('類別名', categoryLeak(page([tx(foodLabel, 0, 0, 20)], []), icons, labels), [`類別名「${foodLabel}」`]);
  ctl('交通圖示放行', categoryLeak(page([tx(legText, 0, 0, 20)], []), icons, labels), []);
}

// 參考用的 PDF 產生器：測試自己另外寫一份，不用被測的 pdfFromJpegs——不然 pdf.js 改壞時，壞的會被當成好的樣本、對照組先倒
export function refPdf(images) {
  let s = '%PDF-1.4\n%âãÏÓ\n';
  const off = [];
  const add = (k, body) => { off[k] = s.length; s += `${k} 0 obj\n${body}\nendobj\n`; };
  const n = images.length;
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${n} >>`);
  images.forEach((im, i) => {
    const pw = 595.28, ph = Math.round(595.28 * im.h / im.w * 100) / 100;
    add(3 + 3 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`);
    const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    add(4 + 3 * i, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    add(5 + 3 * i, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n${Buffer.from(im.bytes).toString('latin1')}\nendstream`);
  });
  const size = 3 + 3 * n, at = s.length;
  s += `xref\n0 ${size}\n0000000000 65535 f \n` + off.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  s += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
// 合成的「JPEG」：開頭 FF D8、結尾 FF D9，中間是固定的數列（PDF 檢查器不解碼，只看頭尾與長度）
export const fakeJpeg = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i === 0 || i === n - 2 ? 0xff : i === 1 ? 0xd8 : i === n - 1 ? 0xd9 : (i * 31 + seed) & 255));
export const PDF_IMGS = [{ bytes: fakeJpeg(1000, 7), w: 1240, h: 1754 }, { bytes: fakeJpeg(1500, 11), w: 1240, h: 3001 }];
export function pdfControls(ctl) {
  const good = refPdf(PDF_IMGS);
  ctl('PDF：好的放行', pdfProblems(good, PDF_IMGS), []);
  ctl('PDF：不給圖的內容、只看頭尾也放行', pdfProblems(good, PDF_IMGS.map(({ w, h }) => ({ w, h }))), []);
  const s = good.toString('latin1');
  const at = s.lastIndexOf('xref\n0 ') + 'xref\n0 '.length;
  const e1 = s.indexOf('\n', at) + 1 + 20;           // 第 1 筆（物件 1）
  const shifted = Buffer.from(s.slice(0, e1) + String(Number(s.slice(e1, e1 + 10)) + 1).padStart(10, '0') + s.slice(e1 + 10), 'latin1');
  ctl('PDF：xref 位置差一個位元組', pdfProblems(shifted, PDF_IMGS), ['xref 第 1 筆的位置沒指到「1 0 obj」']);
  ctl('PDF：圖的長度欄位寫錯', pdfProblems(Buffer.from(s.replace('/Length 1000 >>', '/Length 1001 >>'), 'latin1'), PDF_IMGS), ['第 1 張圖的欄位或 /Length']);
  const noEoi = Buffer.from(good); noEoi[s.indexOf('endstream', s.indexOf('/Length 1000 >>')) - 2] = 0x00;
  ctl('PDF：只看頭尾時，結尾不是 FF D9', pdfProblems(noEoi, PDF_IMGS.map(({ w, h }) => ({ w, h }))), ['第 1 張圖的內容']);
}
