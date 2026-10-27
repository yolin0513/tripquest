// 行程頁的出發倒數、日期列、時間軸（npm run itinviewtest；會開瀏覽器）
//
// 涵蓋的程式：js/views/trip.js、js/views/home.js、js/tripday.js、js/glyphs.js、js/app.js、css/style.css
//
// v1.74.11 新增。計算本身（第幾天、預設選哪天、倒數的字）由 tripdaytest 驗（秒級）；這支驗使用者看到的：
//   C1 還沒出發：行程頁頂端寫「還有 N 天出發」，首頁那張旅程卡也寫；N 是自己造的日期算出來的
//   C2 沒設出發日／進行中／已結束：行程頁與首頁卡都**沒有**倒數（不顯示 0、不猜）
//   S1 日期列：每一天一格、一直看得到（黏在標題列下面，捲到時間軸很下面也還在畫面上）
//   S2 點日期列的某一天：只顯示那一天，其他天 display:none；那一格標成選中、aria-pressed
//   S3 只有一天的旅程：沒有日期列（只有一格沒東西可切）
//   S4 天數很多（15 天）：每一格都在、選中那格捲進日期列看得到的範圍；記下一個畫面看得到幾格（回報用，不設門檻）
//   S5 天的標題不再是按鈕（天不收合；收起來就是空白）
//   T1 時間軸：有填時間的那一站在軸上寫幾點；沒填的那一站時間欄是空的（不補猜的時間）
//   第 1 批（2026-10-27）——每一條都用 seen()：捲到畫面中間、沒被蓋住、對比 ≥ 4.5，才算「看得到」：
//   B1 日期列每格看得到日期＋週幾，今天那格寫「今天 週X」，第三行看得到當天第一站
//   B2 當日標題卡看得到「第一站 → 最後一站」
//   B3 時間軸開頭看得到「同行夥伴」（不是「今日」）和旅伴名字；沒有旅伴就不放這一列
//   B4 進行中、看今天：現在這一站之後的換虛線框、字淡一點但對比照樣 ≥ 4.5
//   B5 看的不是今天、還沒出發：什麼都不淡化
//   G1 紙飛機（原創圖形，js/glyphs.js）停在選中那天的正上方、不蓋到那格的字；點別天就跟過去
//   G2 頁首標題左邊看得到背包，標題字照樣看得到
// 入口：首頁點旅程卡進行程頁；日期列用滑鼠點。情境（日期、時間）一律自己造，不靠今天是哪天。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5235;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

async function device() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 780 });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  return { ctx, page };
}

// startOffset：出發日相對今天差幾天（null＝不設日期）。spots：[[天, 名稱, 開始時間或 '']…]
async function seed(page, { title, startOffset, dayCount, spots, members }) {
  return page.evaluate(async (cfg) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const iso = (d) => {
      const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + d);
      const p = (n) => String(n).padStart(2, '0');
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    };
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    // 合成的旅伴名字（測試資料，不是真人）
    let ct = 1;
    for (const nm of cfg.members || []) await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: nm, createdAt: ct++ });
    const dates = cfg.startOffset == null ? {} : { startDate: iso(cfg.startOffset), endDate: iso(cfg.startOffset + cfg.dayCount - 1) };
    await s.put({ id: tid, type: 'trip', groupId: gid, title: cfg.title, allowWiki: false, ...dates });
    let order = 0;
    for (const [day, name, startTime] of cfg.spots) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day, order: order++, ...(startTime ? { startTime } : {}) });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: name + '任務', kind: 'thing', order: 0 });
    }
    return tid;
  }, { title, startOffset, dayCount, spots, members });
}

// 「使用者看得到」：先像使用者一樣把它捲到畫面中間，再確認
//   ① 在視窗裡、有大小；② 正中央那一點打到的是它自己（沒被黏住的日期列、標題列、底部分頁蓋住）；
//   ③ 沒有被 visibility／opacity 藏起來（往上一路乘 opacity）；④ 字對它實際的底 ≥ 4.5。
// 回 { ok, why, text }。只看「DOM 裡有這個 class」證明不了他看得到（煙霧測試踩過：旗子在視窗外照樣綠）。
const seen = (page, sel) => page.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return { ok: false, why: '找不到', text: null };
  el.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 120));
  const r = el.getBoundingClientRect();
  const text = el.textContent.trim();
  if (r.width < 1 || r.height < 1) return { ok: false, why: `沒有大小 ${r.width}×${r.height}`, text };
  if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return { ok: false, why: `在視窗外 top ${Math.round(r.top)}`, text };
  const hit = document.elementFromPoint(Math.min(innerWidth - 1, r.left + Math.min(r.width / 2, 40)), r.top + r.height / 2);
  if (!hit || !(hit === el || el.contains(hit))) return { ok: false, why: `被蓋住（正中央是 ${hit ? hit.className || hit.tagName : '無'}）`, text };
  let op = 1;
  for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return { ok: false, why: '被藏起來', text }; op *= +cs.opacity; }
  const rgba = (v) => { const m = /rgba?\(([^)]+)\)/.exec(v); if (!m) return null; const [R, G, B, A = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: R, g: G, b: B, a: A }; };
  const over = (c, u) => ({ r: c.r * c.a + u.r * (1 - c.a), g: c.g * c.a + u.g * (1 - c.a), b: c.b * c.a + u.b * (1 - c.a), a: 1 });
  const layers = [];
  for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const c of layers.reverse()) bg = over(c, bg);
  const fg0 = rgba(getComputedStyle(el).color);
  const fg = over({ ...fg0, a: fg0.a * op }, bg);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const k = (Math.max(L(fg), L(bg)) + 0.05) / (Math.min(L(fg), L(bg)) + 0.05);
  if (k < 4.5) return { ok: false, why: `對比 ${k.toFixed(2)} 不到 4.5`, text };
  return { ok: true, why: `看得到、對比 ${k.toFixed(2)}`, text };
}, sel);

// 從首頁點那張旅程卡進去（使用者的路）
async function openFromHome(page, title) {
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');
  const cards = await page.$$('.trip-card');
  for (const c of cards) {
    if ((await c.evaluate((el) => el.querySelector('.trip-card-title')?.textContent)) === title) {
      await c.click();
      await page.waitForSelector('.qcollapse', { timeout: 15000 });
      await sleep(900);
      return true;
    }
  }
  return false;
}
const cardCountdown = (page, title) => page.evaluate((t) => {
  const c = [...document.querySelectorAll('.trip-card')].find((x) => x.querySelector('.trip-card-title')?.textContent === t);
  return c ? (c.querySelector('.trip-card-cd')?.textContent ?? null) : '找不到卡片';
}, title);
const pageCountdown = (page) => page.evaluate(() => document.querySelector('.countdown .cd-big')?.textContent ?? null);
const shownDays = (page) => page.evaluate(() => [...document.querySelectorAll('.daycollapse')]
  .filter((d) => getComputedStyle(d).display !== 'none').map((d) => d.dataset.day));
// 紙飛機在不在第 day 格的正上方：中心落在那格左右之間、底不低於那格的頂（不蓋字）、有大小、在視窗裡
const planeAt = (page, day) => page.evaluate((d) => {
  const pl = document.querySelector('.daystrip .ds-plane svg');
  const c = document.querySelector(`.daystrip .ds-day[data-day="${d}"]`);
  if (!pl || !c) return { ok: false, why: `紙飛機 ${!!pl}、第 ${d} 格 ${!!c}` };
  const a = pl.getBoundingClientRect(), b = c.getBoundingClientRect();
  const mid = (a.left + a.right) / 2;
  const ok = a.width >= 12 && a.height >= 8 && mid > b.left && mid < b.right && a.bottom <= b.top + 1
    && a.left >= 0 && a.right <= innerWidth && getComputedStyle(pl.parentElement).visibility !== 'hidden';
  return { ok, why: `飛機中心 x ${Math.round(mid)}、那格 ${Math.round(b.left)}～${Math.round(b.right)}；飛機底 ${Math.round(a.bottom)}、那格頂 ${Math.round(b.top)}` };
}, day);
const stripCells = (page) => page.evaluate(() => [...document.querySelectorAll('.daystrip .ds-day')]
  .map((c) => ({ day: c.dataset.day, on: c.classList.contains('on'), pressed: c.getAttribute('aria-pressed') })));

try {
  const { ctx, page } = await device();
  const sp3 = [[1, '甲一', '09:30'], [1, '甲二', ''], [2, '乙一', '10:00'], [2, '乙二', ''], [3, '丙一', '']];
  await seed(page, { title: '五天後出發', startOffset: 5, dayCount: 3, spots: sp3 });
  await seed(page, { title: '明天出發', startOffset: 1, dayCount: 3, spots: sp3 });
  await seed(page, { title: '沒設日期', startOffset: null, dayCount: 3, spots: sp3 });
  await seed(page, { title: '進行中', startOffset: -1, dayCount: 3, spots: sp3, members: ['小藍', '小綠'] });
  await seed(page, { title: '已結束', startOffset: -10, dayCount: 3, spots: sp3 });
  await seed(page, { title: '一天', startOffset: -30, dayCount: 1, spots: [[1, '單一', '']] });
  const many = [];
  for (let d = 1; d <= 15; d++) many.push([d, `第${d}站`, '']);
  await seed(page, { title: '十五天', startOffset: -3, dayCount: 15, spots: many });

  // ---- C1／C2 首頁卡 ----
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');
  yes((await cardCountdown(page, '五天後出發')) === '還有 5 天出發', `C1 首頁卡：五天後出發 → 「還有 5 天出發」（實得 ${await cardCountdown(page, '五天後出發')}）`);
  yes((await cardCountdown(page, '明天出發')) === '明天出發', `C1 首頁卡：明天出發 → 「明天出發」（實得 ${await cardCountdown(page, '明天出發')}）`);
  for (const t of ['沒設日期', '進行中', '已結束']) {
    yes((await cardCountdown(page, t)) === null, `C2 首頁卡：${t} → 沒有倒數（實得 ${await cardCountdown(page, t)}）`);
  }

  // ---- C1／C2 行程頁 ----
  yes(await openFromHome(page, '五天後出發'), 'C1 從首頁點「五天後出發」進行程頁');
  yes((await pageCountdown(page)) === '還有 5 天出發', `C1 行程頁頂端：「還有 5 天出發」（實得 ${await pageCountdown(page)}）`);
  const stB = await page.evaluate(() => [document.querySelectorAll('.tl-item').length, document.querySelectorAll('.tl-past, .tl-now, .tl-next').length]);
  yes(stB[0] > 0 && stB[1] === 0, `B5 還沒出發（${stB[0]} 站）→ 不分已到／未到（實得 ${stB[1]} 站有狀態）`);
  yes(!(await page.$('.tl-crew')), 'B3 沒有旅伴的旅程 → 不放「同行夥伴」那一列（不放一個空的標題）');
  for (const t of ['沒設日期', '進行中', '已結束']) {
    yes(await openFromHome(page, t), `C2 從首頁點「${t}」進行程頁`);
    yes((await pageCountdown(page)) === null, `C2 行程頁：${t} → 沒有倒數（實得 ${await pageCountdown(page)}）`);
  }

  // ---- S1／S2／S5／T1 進行中（今天第 2 天）----
  yes(await openFromHome(page, '進行中'), 'S1 從首頁點「進行中」進行程頁');
  let cells = await stripCells(page);
  yes(cells.map((c) => c.day).join() === '1,2,3', `S1 日期列三天各一格（實得 ${cells.map((c) => c.day).join() || '無'}）`);
  yes(cells.filter((c) => c.on).map((c) => c.day).join() === '2', 'S1 預設選中今天（第 2 天）');
  yes((await shownDays(page)).join() === '2', `S1 只顯示第 2 天（實得 ${(await shownDays(page)).join() || '無'}）`);
  const head = await page.evaluate(() => {
    const hd = document.querySelector('.daycollapse.open .dc-head');
    return hd ? { tag: hd.tagName, hasChev: !!hd.querySelector('.dc-chev') } : null;
  });
  yes(!!head && head.tag !== 'BUTTON' && !head.hasChev, `S5 天的標題不是按鈕、沒有展開箭頭（${JSON.stringify(head)}）`);

  // ---- 第 1 批：B1–B5（今天是「進行中」的第 2 天；現在這一站＝今天第一個沒拍完的「乙一」）----
  const WK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const dayOf = (off) => { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + off); return x; };
  const wk1 = WK[dayOf(-1).getDay()], wk2 = WK[dayOf(0).getDay()];
  let v = await seen(page, '.daystrip .ds-day[data-day="1"] .ds-sub');
  yes(v.ok && v.text.endsWith(wk1), `B1 日期列第 1 天那格看得到日期與「${wk1}」（${v.why}；字「${v.text}」）`);
  v = await seen(page, '.daystrip .ds-day[data-day="2"] .ds-sub');
  yes(v.ok && v.text === `今天 ${wk2}`, `B1 第 2 天（今天）那格寫「今天 ${wk2}」（${v.why}；字「${v.text}」）`);
  v = await seen(page, '.daystrip .ds-day[data-day="2"] .ds-first');
  yes(v.ok && v.text === '乙一', `B1 第 2 天那格看得到當天第一站「乙一」（${v.why}；字「${v.text}」）`);
  v = await seen(page, '.daycollapse.open .dc-route');
  yes(v.ok && v.text === '乙一 → 乙二', `B2 當日標題卡看得到「乙一 → 乙二」（${v.why}；字「${v.text}」）`);
  v = await seen(page, '.daycollapse.open .tl-crew-label');
  yes(v.ok && v.text === '同行夥伴', `B3 時間軸開頭看得到「同行夥伴」——不是「今日同行夥伴」（${v.why}；字「${v.text}」）`);
  const chips = await page.evaluate(() => [...document.querySelectorAll('.daycollapse.open .tl-chip-name')].map((x) => x.textContent));
  v = await seen(page, '.daycollapse.open .tl-chip-name');
  yes(v.ok && chips.join() === '小藍,小綠', `B3 兩位旅伴的名字看得到（${v.why}；實得 ${chips.join() || '無'}）`);
  const st = await page.evaluate(() => [...document.querySelectorAll('.daycollapse.open .tl-item')].map((li) => ({
    name: li.querySelector('.qc-name')?.firstChild?.textContent || '',
    s: ['tl-past', 'tl-now', 'tl-next'].find((c) => li.classList.contains(c)) || '',
    border: getComputedStyle(li.querySelector('.qcollapse')).borderTopStyle,
  })));
  yes(st.length === 2 && st[0].name === '乙一' && st[0].s === 'tl-now' && st[1].name === '乙二' && st[1].s === 'tl-next',
    `B4 今天：乙一是現在、乙二是未到（${JSON.stringify(st)}）`);
  yes(st[1] && st[1].border === 'dashed' && st[0] && st[0].border !== 'dashed', `B4 未到那一站換成虛線框、現在那一站不是（${st.map((x) => x.border).join('／')}）`);
  v = await seen(page, '.daycollapse.open .tl-next .qc-name');
  yes(v.ok && v.text.startsWith('乙二'), `B4 未到的「乙二」淡化了但字照樣看得清楚（對比 ≥ 4.5）（${v.why}）`);

  // ---- G1／G2 兩個原創圖形（js/glyphs.js）----
  const g1 = await planeAt(page, 2);
  yes(g1.ok, `G1 紙飛機停在選中那天（第 2 天）的正上方、看得到、沒蓋到那格的字（${g1.why}）`);
  const g2 = await page.evaluate(() => {
    const pk = document.querySelector('#topTitle svg.gl-pack');
    const tx = document.querySelector('#topTitle .top-title-text');
    if (!pk || !tx) return { ok: false, why: `背包 ${!!pk}、標題字 ${!!tx}` };
    const a = pk.getBoundingClientRect(), b = tx.getBoundingClientRect();
    const ok = a.width >= 12 && a.height >= 12 && a.top >= 0 && a.bottom <= document.getElementById('topbar').getBoundingClientRect().bottom && a.right <= b.left + 1;
    return { ok, why: `背包 ${Math.round(a.width)}×${Math.round(a.height)}、右緣 ${Math.round(a.right)}、標題字左緣 ${Math.round(b.left)}` };
  });
  yes(g2.ok, `G2 頁首看得到背包，在標題字左邊、不疊在字上（${g2.why}）`);
  v = await seen(page, '#topTitle .top-title-text');
  yes(v.ok && v.text === '進行中', `G2 加了背包之後，標題字照樣看得到（${v.why}；字「${v.text}」）`);

  const cell3 = await page.$('.daystrip .ds-day[data-day="3"]');
  yes(!!cell3, 'S2 日期列有第 3 天那一格');
  if (cell3) { await cell3.click(); await sleep(800); }
  const g3 = await planeAt(page, 3);
  yes(g3.ok, `G1 點第 3 天 → 紙飛機跟著到第 3 天上方（${g3.why}）`);
  cells = await stripCells(page);
  yes((await shownDays(page)).join() === '3', `S2 點第 3 天 → 只顯示第 3 天（實得 ${(await shownDays(page)).join() || '無'}）`);
  yes(cells.filter((c) => c.on).map((c) => c.day).join() === '3' && cells.find((c) => c.day === '3').pressed === 'true'
    && cells.find((c) => c.day === '2').pressed === 'false', 'S2 第 3 天那格選中（aria-pressed=true），第 2 天不再選中');
  const st3 = await page.evaluate(() => document.querySelectorAll('.daycollapse.open .tl-past, .daycollapse.open .tl-now, .daycollapse.open .tl-next').length);
  const n3 = await page.evaluate(() => document.querySelectorAll('.daycollapse.open .tl-item').length);
  yes(n3 > 0 && st3 === 0, `B5 看的不是今天（第 3 天、${n3} 站）→ 不分已到／未到、什麼都不淡化（實得 ${st3} 站有狀態）`);

  // 回第 1 天看時間軸
  await (await page.$('.daystrip .ds-day[data-day="1"]')).click();
  await sleep(400);
  const tl = await page.evaluate(() => [...document.querySelectorAll('.daycollapse.open .tl-item')].map((li) => ({
    name: li.querySelector('.qc-name')?.firstChild?.textContent || '', time: li.querySelector('.tl-time')?.textContent ?? null,
    dot: !!li.querySelector('.tl-dot'),
  })));
  yes(tl.length === 2, `T1 第 1 天的時間軸有 2 站（實得 ${tl.length}）`);
  yes(tl.find((x) => x.name === '甲一')?.time === '09:30', `T1 有填時間的「甲一」寫 09:30（實得 ${JSON.stringify(tl.find((x) => x.name === '甲一'))}）`);
  yes(tl.find((x) => x.name === '甲二')?.time === '', `T1 沒填時間的「甲二」時間欄是空的，不補猜的時間（實得 ${JSON.stringify(tl.find((x) => x.name === '甲二'))}）`);
  yes(tl.length > 0 && tl.every((x) => x.dot), 'T1 每一站在軸上都有一個點');

  // S1 黏住：捲到最下面，日期列還在畫面上、在標題列底下
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(300);
  const stick = await page.evaluate(() => {
    const r = document.querySelector('.daystrip').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), topbar: document.getElementById('topbar').offsetHeight, y: Math.round(window.scrollY) };
  });
  yes(stick.y > 0 && stick.top >= stick.topbar - 2 && stick.top <= stick.topbar + 2, `S1 捲到最下面（scrollY ${stick.y}）日期列還黏在標題列下面（top ${stick.top}、標題列高 ${stick.topbar}）`);

  // ---- S3 一天 ----
  yes(await openFromHome(page, '一天'), 'S3 從首頁點「一天」進行程頁');
  yes((await stripCells(page)).length === 0 && !(await page.$('.daystrip')), 'S3 只有一天 → 沒有日期列');
  yes((await shownDays(page)).join() === '1', 'S3 那一天照樣顯示');

  // ---- S4 十五天（今天第 4 天）----
  yes(await openFromHome(page, '十五天'), 'S4 從首頁點「十五天」進行程頁');
  await sleep(600);
  const fit = await page.evaluate(() => {
    const tr = document.querySelector('.daystrip .ds-track').getBoundingClientRect();
    const cs = [...document.querySelectorAll('.daystrip .ds-day')];
    const vis = cs.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= tr.left - 1 && r.right <= tr.right + 1; });
    const on = cs.find((c) => c.classList.contains('on'));
    const r = on && on.getBoundingClientRect();
    return { n: cs.length, visible: vis.length, onDay: on && on.dataset.day, onInView: !!r && r.left >= tr.left - 1 && r.right <= tr.right + 1,
      scrollable: document.querySelector('.daystrip .ds-track').scrollWidth > document.querySelector('.daystrip .ds-track').clientWidth };
  });
  yes(fit.n === 15, `S4 十五天：日期列 15 格都在（實得 ${fit.n}）`);
  yes(fit.onDay === '4' && fit.onInView, `S4 選中今天（第 4 天）那一格，而且捲進日期列看得到的範圍（${JSON.stringify(fit)}）`);
  yes(fit.scrollable, 'S4 塞不下時日期列可以橫向捲');
  console.log(`  （回報用、不設門檻）390px 寬的畫面一次看得到 ${fit.visible} 格／共 ${fit.n} 格`);

  await ctx.close();
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
