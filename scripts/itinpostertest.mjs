// 行程海報（v1.88.0）從使用者的入口驗（npm run itinpostertest；會開瀏覽器）
//
// 涵蓋的程式：js/views/itinposter.js（那一頁：版型、張數、翻頁、存檔、記住上次選的）、js/itinposter/index.js（收資料、存 PNG／PDF）、
//   js/itinposter/draw.js（畫：canvas 真的字寬、吉祥物）、js/itinposter/layout.js、js/itinposter/model.js、js/pdf.js、
//   js/views/trip.js（行程分頁「行程」那一格的入口）、js/app.js（路由、底部亮哪一格）、js/weather.js（預報）、css/style.css
// 放什麼、排版的算法、PDF 檔的結構在 scripts/itinposterlayouttest.mjs（秒級、近似字寬）；這支用 canvas 真的字寬再驗一次版面，
// 版面與 PDF 的檢查器跟那一支共用（scripts/itinposterlib.mjs），每次先跑那幾支的對照組。
//
// 驗什麼：
//   P0 前置：造好兩趟（一趟 3 天 5 站、4 站對上景點庫、出發日是 2 天後；一趟沒有景點）
//   P1a 從首頁 → 底部「行程」→「行程」那一格 → 按「做成行程海報」進得來；P1b 進去之後底部亮的還是「行程」
//   P2a 沒有景點的一趟沒有那顆按鈕；P2b 直接開海報那一頁寫「還沒有排景點」、沒有預覽
//   P3a 預覽跟成品是同一份（同一份版面另外畫一張，逐像素相同），不是空白；P3b 吉祥物真的畫出來了
//   P4 真的字寬排出來的 4 組（2 版型 × 2 張數）跑 itinposterlayouttest 同一組版面檢查（B1～B11）
//   P5a 天氣預報到了會重畫（小提醒放旅程那幾天）；P5b 查天氣只送目的地的座標與固定參數
//   P6a 換版型、換張數、翻頁的字；P6b 按「下一張」；P6c 離開再進來還是上次選的
//   P7a 存圖片：手機分享得了檔案 → 一次分享全部 PNG；P7b 分享不了 → 下載；檔名、尺寸跟預覽那一份一樣
//   P8a 存 PDF：xref、長度欄位、頁數、每頁比例；P8b 存檔的時候沒有任何對外請求、沒有上傳
//   P9 整段頁面沒有丟出例外
// 不打真網路（共用慣例 §5.6）：Open-Meteo 回自己造的預報，其餘外站 503 並記下來。
// 分享與下載：手機的分享換成記錄用的替身（分享得了／分享不了兩種）；下載攔在 <a download>.click()，記下檔名與內容、
//   不真的寫到磁碟（headless 的下載資料夾可能是使用者自己的「下載」）。這兩個是瀏覽器提供的，不是 App 的程式。
// 時區撥到台北（emulateTimezone），日期照那個時區算，不靠今天是哪天。名字、行程都是造的。
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
// 從入口進不來時，直接開海報那一頁，讓後面的照樣量到（P1a 記成 ✗）——一條突變只紅它自己那一條。
// 突變見 tools/mutations/mut_v188ui.json。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';
import { texts, PAGE_CHECKS, pageListProblems, pdfProblems, layoutControls, pdfControls } from './itinposterlib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5861;
const ORIGIN = `http://localhost:${WEB}`;
const TZ = 'Asia/Taipei';
const TITLE = '合成的台北三日', EMPTY = '合成的空行程', BASE = TITLE;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
// 關掉 2D 畫布的 GPU 加速：畫面上的預覽與另外畫的那一張要用同一套繪製，才能逐像素比。
// 11-14 實測：開著的時候，同一份指令畫兩次，在吉祥物（縮放貼圖）與外框的反鋸齒邊上會有 1～3 個像素各差 1，每次跑不一樣。
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-accelerated-2d-canvas', '--disable-gpu'] });

// ---- 斷言：每一條有固定的編號與說明（突變的 expect 對開頭）；細節放括號裡 ----
const LBL = Object.fromEntries([
  'P0 前置：造好兩趟（一趟 3 天 5 站、4 站對上景點庫、出發日是 2 天後；一趟沒有景點）',
  'P1a 從首頁 → 底部「行程」→「行程」那一格 → 按「做成行程海報」進得來、預覽畫出來了',
  'P1b 進了海報那一頁，底部亮的還是「行程」、只亮一格',
  'P2a 沒有景點的一趟：「行程」那一格沒有「做成行程海報」（前置：那一格有內容）',
  'P2b 沒有景點的一趟直接開海報那一頁：寫「還沒有排景點」、沒有預覽',
  'P3a 預覽跟成品是同一份：畫面上的預覽跟同一份版面另外畫的一張逐像素相同，而且不是空白',
  'P3b 吉祥物真的畫出來了（吉祥物那一格裡跟底色不同的像素超過 5%）',
  'P5a 天氣預報到了會重畫：小提醒放旅程那 3 天、寫哪天查的；預覽換成有預報的那一份（比沒預報的高）',
  'P5b 查天氣只送目的地的座標與固定參數（沒有行程名稱、景點名稱）',
  'P6a 換成「分天色帶」「每天一張」：預覽跟著換、選中的格子標 aria-checked、翻頁寫「第1天 / 共 3 張」',
  'P6b 按「下一張」：換到第 2 天那一張，跟成品同一份',
  'P6c 離開再從行程分頁進來：還是上次選的「分天色帶」「每天一張」',
  'P7a 存成圖片（手機分享得了檔案）：一次分享全部 PNG，檔名照天、尺寸跟預覽那一份一樣，沒有另外下載',
  'P7b 存成圖片（分享不了檔案）：改成下載，張數、檔名、尺寸一樣',
  'P8a 存成 PDF：下載一個 PDF，頁數對、xref 與長度欄位都對、每頁照那一張的比例',
  'P8b 存圖片、存 PDF 的時候沒有任何對外的請求，也沒有任何上傳（POST／PUT）',
  'P9 整段頁面沒有丟出例外',
].map((s) => [s.slice(0, s.indexOf(' ')), s]));
const B1_LABEL = '張數與標籤：全部一張 → 1 張；每天一張 → 天數張、照天排';
for (const [code, label] of [['B1', B1_LABEL], ...PAGE_CHECKS]) LBL[`P4-${code}`] = `P4-${code} ${label}（真的字寬）`;

let pass = 0;
const said = new Set();
const say = (code, cond, detail = '', extra = '') => {
  said.add(code);
  const m = LBL[code] + (detail ? `（${detail}）` : '');
  if (cond) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 900) : '')); if (process.exitCode !== 4) process.exitCode = 1; }
};
// 一段：裡面丟例外 → 這一段還沒判的每一條記成 ✗（說明照舊，突變的 expect 照樣對得到）
async function section(codes, fn) {
  try { await fn(); } catch (e) { for (const c of codes) if (!said.has(c)) say(c, false, `沒跑到：${e && e.message}`); }
  for (const c of codes) if (!said.has(c)) say(c, false, '這一段沒有判定這一條——測試寫錯');
}
const soft = (p) => p.then(() => true, () => false);
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 近似字寬：只給版面檢查器的對照組用（對照組驗的是檢查器的邏輯，不是排版）
const measure = (t, size, weight = 400) => [...String(t)].reduce((a, ch) => a + (ch.codePointAt(0) < 0x2e80 ? size * 0.58 : size), 0) * (weight >= 700 ? 1.03 : 1);

// PNG 的寬高（IHDR）；不是 PNG → null
function pngDims(head) {
  const u = Uint8Array.from(head || []);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (u.length < 24 || sig.some((b, i) => u[i] !== b) || String.fromCharCode(...u.subarray(12, 16)) !== 'IHDR') return null;
  const dv = new DataView(u.buffer);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

// 自己造的 Open-Meteo 預報：今天前一天到之後 14 天，台北時區的日期；旅程第 2 天（今天 +3）下雨，其餘晴
const dateIn = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + n * 86400000));
function fakeForecast() {
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [],
    precipitation_probability_max: [], snowfall_sum: [], wind_speed_10m_max: [] };
  for (let i = -1; i < 15; i++) {
    const wet = i === 3;
    daily.time.push(dateIn(i));
    daily.weather_code.push(wet ? 63 : 1);
    daily.temperature_2m_max.push(24);
    daily.temperature_2m_min.push(17);
    daily.precipitation_sum.push(wet ? 12 : 0);
    daily.precipitation_probability_max.push(wet ? 80 : 10);
    daily.snowfall_sum.push(0);
    daily.wind_speed_10m_max.push(10);
  }
  return { elevation: 20, timezone: TZ, current: { temperature_2m: 22, weather_code: 1 }, daily };
}

// 每一頁一開就裝好：分享的替身、下載攔截、比對畫面的兩個小工具（對照組與檢查走同一份）
function initHooks() {
  window.__shareMode = 'none'; window.__shared = []; window.__dl = [];
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const rec = async (blob, name) => {
    const u = new Uint8Array(await blob.arrayBuffer());
    return { name, type: blob.type, size: u.length, head: Array.from(u.subarray(0, 32)), b64: /\.pdf$/.test(name) ? b64(u) : '' };
  };
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, writable: true,
    value(d) { return window.__shareMode === 'ok' && !!(d && d.files && d.files.length); } });
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true, writable: true,
    async value(d) {
      if (window.__shareMode !== 'ok') throw new DOMException('這次不分享', 'NotAllowedError');
      const files = await Promise.all((d.files || []).map((f) => rec(f, f.name)));
      window.__shared.push({ title: d.title, text: d.text, files });
    } });
  // 記住 blob 網址對到哪一個 Blob：開了請求攔截之後 fetch(blob:) 會回「Failed to fetch」（11-14 實測），所以不去 fetch、直接讀這一份
  const blobs = new Map();
  const mkURL0 = URL.createObjectURL;
  URL.createObjectURL = function (o) { const u = mkURL0.call(URL, o); if (o instanceof Blob) blobs.set(u, o); return u; };
  const click0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && /^blob:/.test(this.href)) {
      const r = { name: this.download, done: false };
      window.__dl.push(r);
      const b0 = blobs.get(this.href);
      (b0 ? Promise.resolve(b0) : Promise.reject(new Error('這個 blob 網址不是 createObjectURL 做的'))).then((b) => rec(b, r.name))
        .then((x) => Object.assign(r, x, { done: true }), (e) => Object.assign(r, { done: true, err: String(e) }));
      return undefined;
    }
    return click0.call(this);
  };
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  window.__ck = {
    // 兩張 canvas 有幾個像素不一樣（RGB 任一不同就算）；大小不一樣回 -1
    diff(a, b) {
      if (a.width !== b.width || a.height !== b.height) return -1;
      const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let n = 0;
      for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n++;
      return n;
    },
    // 不一樣的前幾個像素：座標與兩邊的 RGB（只給失敗訊息用，判定不看它）
    where(a, b, max = 4) {
      if (a.width !== b.width || a.height !== b.height) return [];
      const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      const out = [];
      for (let i = 0; i < x.length && out.length < max; i += 4) {
        if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) {
          const p = i / 4;
          out.push(`(${p % a.width},${Math.floor(p / a.width)}) ${x[i]},${x[i + 1]},${x[i + 2]}≠${y[i]},${y[i + 1]},${y[i + 2]}`);
        }
      }
      return out;
    },
    // 一格裡跟底色不一樣的像素占幾成（三個顏色差的和 > 40 才算）
    inkRatio(cv, box, paper) {
      const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
      const x1 = Math.min(cv.width, Math.round(box.x + box.w)), y1 = Math.min(cv.height, Math.round(box.y + box.h));
      if (x1 <= x0 || y1 <= y0) return 0;
      const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const [pr, pg, pb] = hex(paper);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - pr) + Math.abs(d[i + 1] - pg) + Math.abs(d[i + 2] - pb) > 40) n++;
      return n / (d.length / 4);
    },
  };
}

const net = { outside: [], writes: [], meteo: [] };
const pageErrors = [];
async function open() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror]', e.message); });
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateTimezone(TZ);
  await page.evaluateOnNewDocument(initHooks);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url(), m = req.method();
    if (!/^(GET|HEAD|OPTIONS)$/.test(m)) net.writes.push(`${m} ${u}`);
    if (u.startsWith(ORIGIN) || /^(data|blob):/.test(u)) { req.continue().catch(() => {}); return; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/.test(u)) {
      net.meteo.push(u);
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeForecast()) }).catch(() => {});
      return;
    }
    net.outside.push(u);
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await soft(page.waitForSelector('.hero', { timeout: 20000 }));
  return page;
}

// 從首頁一路點到海報那一頁（使用者的路）。進不來就直接開那一頁（讓後面的照樣量到），回傳進不來的理由
async function enterPoster(page, title, tid) {
  let why = '';
  const ok = await (async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    if (!await soft(page.waitForSelector('.trip-card', { timeout: 15000 }))) { why = '首頁沒有旅程卡'; return false; }
    if (!await tap(page, '.trip-card', title)) { why = '點不到旅程卡'; return false; }
    if (!await soft(page.waitForSelector('.trip-home', { timeout: 15000 }))) { why = '沒進到主頁'; return false; }
    if (!await tap(page, '#tabbar a.tab', '行程')) { why = '點不到底部「行程」'; return false; }
    if (!await soft(page.waitForSelector('.itin-page .itin-seg', { timeout: 15000 }))) { why = '沒進到行程分頁'; return false; }
    if (!await tap(page, '.itin-seg button', '行程')) { why = '點不到「行程」那一格'; return false; }
    if (!await soft(page.waitForSelector('#itin-pane-plan .itin-edit', { visible: true, timeout: 15000 }))) { why = '「行程」那一格沒有內容'; return false; }
    const btn = await page.$('#itin-pane-plan .itin-poster-btn');
    if (!btn) { why = '「行程」那一格沒有「做成行程海報」'; return false; }
    const k = await userClick(page, btn, '「做成行程海報」');
    if (!k.ok) { why = k.why; return false; }
    return true;
  })().catch((e) => { why = String(e && e.message); return false; });
  if (!ok) await page.evaluate((t) => { location.hash = `#/trip/${t}/itinposter`; }, tid);
  const drawn = await soft(page.waitForFunction(() => {
    const c = document.querySelector('.poster-canvas');
    return !!c && c.dataset.page != null && c.width > 0;
  }, { timeout: 20000 }));
  await sleep(300);
  const st = await page.evaluate(() => ({ hash: location.hash, active: [...document.querySelectorAll('#tabbar a.tab.active')].map((a) => a.textContent.trim()) }));
  return { ok, why, drawn, ...st };
}

// 海報那一頁現在的狀態：版型、張數、第幾張、選中的格子、翻頁那一列
const segState = (page) => page.evaluate(() => {
  const cv = document.querySelector('.poster-canvas');
  const on = (key) => [...document.querySelectorAll(`.ip-seg[data-key="${key}"] button`)].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent);
  const pager = document.querySelector('.pager');
  const btn = (t) => [...document.querySelectorAll('.pager-btn')].find((b) => b.textContent.includes(t));
  const vis = (el) => !!el && el.checkVisibility({ visibilityProperty: true });
  return {
    kind: cv && cv.dataset.kind, split: cv && cv.dataset.split, page: cv && cv.dataset.page,
    kindOn: on('kind'), splitOn: on('split'), pagerShown: vis(pager),
    label: (document.querySelector('.pager-lbl') || {}).textContent || '', prev: vis(btn('前一張')), next: vis(btn('下一張')),
  };
});
const waitShown = (page, kind, split, pg = '0') => soft(page.waitForFunction((k, s, p) => {
  const c = document.querySelector('.poster-canvas');
  return !!c && c.dataset.kind === k && c.dataset.split === s && c.dataset.page === p;
}, { timeout: 15000 }, kind, split, pg)).then(async (x) => { await sleep(400); return x; });

// 畫面上的預覽是哪一份：用同一份版面（有預報、沒預報各一份）另外畫一張，逐像素比；也量吉祥物那一格
const matchShown = (page, tid) => page.evaluate(async (tid) => {
  const ip = await import('./js/itinposter/index.js');
  const { PAPER } = await import('./js/itinposter/layout.js');
  const cv = document.querySelector('.poster-canvas');
  const kind = cv.dataset.kind, split = cv.dataset.split, idx = Number(cv.dataset.page);
  const f = await ip.tripForecast(tid);
  const out = { kind, split, idx, w: cv.width, h: cv.height, variants: [] };
  for (const [name, fc] of [['有預報', f], ['沒預報', null]]) {
    const m = await ip.gatherModel(tid, { forecast: fc });
    const pages = ip.renderPages(m, { kind, split });
    const pg = pages[idx];
    const off = document.createElement('canvas');
    if (pg) await ip.drawPoster(off, pg);
    const diff = pg ? window.__ck.diff(off, cv) : -1;
    out.variants.push({ name, n: pages.length, dims: pages.map((p) => [p.w, p.h]), labels: pages.map((p) => p.label), diff,
      where: diff > 0 && diff < 1000 ? window.__ck.where(off, cv).map((s) => {
        const [x, y] = s.slice(1, s.indexOf(')')).split(',').map(Number);
        const inBox = pg.boxes.filter((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h).map((b) => b.kind);
        return `${s} 落在［${inBox.join('、') || '沒有框'}］`;
      }) : [],
      tips: m.tips.length, mascots: pg ? pg.boxes.filter((b) => b.kind === 'mascot') : [] });
  }
  const hit = out.variants.find((v) => v.diff === 0) || null;
  out.match = hit ? hit.name : '';
  out.ink = window.__ck.inkRatio(cv, { x: 0, y: 0, w: cv.width, h: cv.height }, PAPER);
  out.mascotInk = hit ? hit.mascots.map((b) => +window.__ck.inkRatio(cv, b, PAPER).toFixed(3)) : [];
  return out;
}, tid);
const variantOf = (c) => (c && c.variants.find((v) => v.name === c.match)) || null;

let S = null;            // 造好的資料
let P3 = null;           // 第一次進來時預覽是哪一份（P5a 用）
let page = null;
let shownBefore = null;  // P6 之後、存檔之前，預覽是哪一份（P7、P8 跟它比）

try {
  page = await open();
  // ================= 對照組（先跑；任何一個沒過就停、不採信後面的結果） =================
  let ctlOk = true;
  const ctl = (label, got, want) => {
    const good = same(got, want);
    if (good) { pass++; console.log(`✓ 對照組（${label}）`); }
    else { console.log(`✗ 對照組（${label}）\n   實得 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`); }
    ctlOk = ctlOk && good;
  };
  const env = await page.evaluate(async () => {
    const { LEG_ICON, LEG_LABEL } = await import('./js/legs.js');
    const th = await (await import('./js/theme.js')).loadThemes();
    return { icons: Object.values(LEG_ICON).filter(Boolean), labels: Object.values(th.themes).map((t) => t.label),
      foodEmoji: th.themes.food.emoji, foodLabel: th.themes.food.label, legText: `${LEG_ICON.car} ${LEG_LABEL.car}` };
  });
  const LABELS = new Set(env.labels);
  layoutControls(ctl, { measure, foodEmoji: env.foodEmoji, foodLabel: env.foodLabel, legText: env.legText, icons: env.icons, labels: LABELS });
  pdfControls(ctl);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 44, 0, 0, 0, 200, 8, 6, 0, 0, 0];
  ctl('PNG 尺寸：合成的 300×200 檔頭', pngDims(sig), { w: 300, h: 200 });
  ctl('PNG 尺寸：檔頭不是 PNG', pngDims([0, ...sig.slice(1)]), null);
  ctl('畫面比對：一樣的兩張 0 個像素不同、改一個像素抓到 1 個、大小不同回 -1', await page.evaluate(() => {
    const mk = (w = 20) => { const c = document.createElement('canvas'); c.width = w; c.height = 20; const x = c.getContext('2d'); x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, w, 20); x.fillStyle = '#333'; x.fillRect(5, 5, 6, 6); return c; };
    const a = mk(), b = mk(), c = mk();
    const cx = c.getContext('2d'); cx.fillStyle = '#ff0000'; cx.fillRect(15, 15, 1, 1);
    return { same: window.__ck.diff(a, b), one: window.__ck.diff(a, c), size: window.__ck.diff(a, mk(21)) };
  }), { same: 0, one: 1, size: -1 });
  ctl('墨水比例：一格裡只有底色是 0、畫一塊 50×50 是 0.25', await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d');
    x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, 200, 200);
    const box = { x: 50, y: 50, w: 100, h: 100 };
    const blank = window.__ck.inkRatio(c, box, '#fbf6ec');
    x.fillStyle = '#333'; x.fillRect(60, 60, 50, 50);
    return { blank, drawn: window.__ck.inkRatio(c, box, '#fbf6ec') };
  }), { blank: 0, drawn: 0.25 });
  await page.evaluate(() => Promise.allSettled([fetch('https://ctl.invalid/x'), fetch('/ctl-post', { method: 'POST', body: 'x' })]));
  await sleep(300);
  ctl('網路紀錄：外站與上傳都記得到', { outside: net.outside.filter((u) => u.includes('ctl.invalid')).length, writes: net.writes.filter((w) => /^POST .*\/ctl-post$/.test(w)).length }, { outside: 1, writes: 1 });
  ctl('下載攔截：記得到檔名、大小、種類', await page.evaluate(async () => {
    window.__dl = [];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['abc'], { type: 'text/plain' })); a.download = 'ctl.txt';
    document.body.append(a); a.click(); a.remove();
    for (let i = 0; i < 60 && !(window.__dl[0] && window.__dl[0].done); i++) await new Promise((r) => setTimeout(r, 50));
    const d = window.__dl[0]; window.__dl = [];
    return d ? { name: d.name, size: d.size, type: d.type, ...(d.err ? { err: d.err } : {}) } : null;
  }), { name: 'ctl.txt', size: 3, type: 'text/plain' });
  net.outside.length = 0; net.writes.length = 0;
  if (!ctlOk) {
    console.log('✗ 對照組沒過——檢查器壞了，不採信下面的結果');
    process.exitCode = 4;
    throw new Error('對照組沒過');
  }

  // ================= P0 造資料 =================
  await section(['P0'], async () => {
    S = await page.evaluate(async (tz) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const { generateForTrip } = await import('./js/quests/generate.js');
      const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + n * 86400000));
      const g = uuid(), t = uuid(), e = uuid();
      await s.put({ id: g, type: 'group', name: 'g' });
      let ct = 1;
      for (const nm of ['小美', '阿明', '小華']) await s.put({ id: uuid(), type: 'member', groupId: g, displayName: nm, createdAt: ct++ });   // 合成的名字
      await s.put({ id: t, type: 'trip', groupId: g, title: '合成的台北三日', region: '台北', allowWiki: false, startDate: day(2), endDate: day(4) });
      await s.put({ id: e, type: 'trip', groupId: g, title: '合成的空行程', region: '台北', allowWiki: false, startDate: day(10), endDate: day(11) });
      const items = [[1, '士林夜市'], [1, '巷口麵店'], [1, '饒河街觀光夜市'], [2, '九份老街'], [3, '士林夜市']].map(([d, name]) => ({ name, day: d, region: '台北' }));
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items });
      const shilin = spots.find((x) => x.day === 1 && x.placeId === 'taipei-shilin-nm');
      const alley = spots.find((x) => x.name === '巷口麵店');
      if (alley) { alley.startMin = 570; if (shilin) { alley.legFrom = shilin.id; alley.legMode = 'car'; } }
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
      return { t, e, n: spots.length, curated: spots.filter((x) => x.source === 'curated').length, xy: spots.filter((x) => x.lat != null && x.lng != null).length,
        start: day(2), today: day(0), alleyAuto: !!alley && alley.source !== 'curated', emptySpots: s.spotsOf(e).length };
    }, TZ);
    say('P0', S.n === 5 && S.curated === 4 && S.xy >= 4 && S.alleyAuto && S.start === dateIn(2) && S.today === dateIn(0) && S.emptySpots === 0,
      `${S.n} 站、${S.curated} 站對上景點庫、${S.xy} 站有座標、出發日 ${S.start}；空的那一趟 ${S.emptySpots} 站`);
  });

  // ================= P1 入口 =================
  await section(['P1a', 'P1b'], async () => {
    const r = await enterPoster(page, TITLE, S.t);
    say('P1a', r.ok && r.drawn && r.hash === `#/trip/${S.t}/itinposter`, r.ok ? `網址 ${r.hash.replace(S.t, '<這一趟>')}` : `進不來：${r.why}`);
    say('P1b', r.drawn && r.active.length === 1 && r.active[0].includes('行程'), `亮的是 ${JSON.stringify(r.active)}`);
  });

  // ================= P3 預覽＝成品、吉祥物 =================
  await section(['P3a', 'P3b'], async () => {
    // 等天氣預報到了、重畫完（預覽的高變成有預報那一份的高）；等不到就照當下的比（P5a 會記）
    const wantH = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const cv = document.querySelector('.poster-canvas');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      return ip.renderPages(m, { kind: cv.dataset.kind, split: cv.dataset.split })[Number(cv.dataset.page)].h;
    }, S.t);
    await soft(page.waitForFunction((h) => { const c = document.querySelector('.poster-canvas'); return !!c && c.height === h; }, { timeout: 12000 }, wantH));
    await sleep(400);
    const c = await matchShown(page, S.t);
    say('P3a', c.match !== '' && c.ink > 0.05,
      `${c.kind}/${c.split} 第 ${c.idx + 1} 張 ${c.w}×${c.h}；${c.match ? `跟「${c.match}」那一份逐像素相同` : `兩份都不同：${c.variants.map((v) => `${v.name} ${v.diff}${v.where.length ? `〔另畫≠預覽：${v.where.join('；')}〕` : ''}`).join('、')}`}；跟底色不同的占 ${c.ink.toFixed(2)}`);
    say('P3b', c.mascotInk.length >= 1 && c.mascotInk.every((r) => r > 0.05), `吉祥物 ${c.mascotInk.length} 隻，那一格跟底色不同的占 ${c.mascotInk.join('、')}`);
    P3 = c;
  });

  // ================= P4 真的字寬排出來的版面 =================
  const P4CODES = ['P4-B1', ...PAGE_CHECKS.map(([code]) => `P4-${code}`)];
  await section(P4CODES, async () => {
    const R = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      return { m, sets: [['route', 'one'], ['route', 'day'], ['band', 'one'], ['band', 'day']].map(([kind, split]) => ({ kind, split, pages: ip.renderPages(m, { kind, split }) })) };
    }, S.t);
    const sets = R.sets.map((x) => ({ ...x, m: R.m }));
    const all = sets.flatMap((x) => x.pages.map((pg, i) => ({ x, pg, i })));
    const nText = all.reduce((a, p) => a + texts(p.pg).length, 0);
    const where = `${sets.length} 組、${all.length} 張、${nText} 個字`;
    const b1 = sets.flatMap((x) => pageListProblems(x).map((b) => `${x.kind}/${x.split}：${b}`));
    say('P4-B1', all.length > 0 && b1.length === 0, where, b1.join('\n   '));
    const OPTS = { icons: env.icons, labels: LABELS };
    for (const [code, , fn] of PAGE_CHECKS) {
      const bad = [];
      for (const p of all) {
        let r;
        try { r = fn(p.x, p.pg, p.i, OPTS); } catch (e) { r = [`檢查時例外：${e.message}`]; }
        for (const b of r) bad.push(`${p.x.kind}/${p.x.split} 第 ${p.i + 1} 張：${b}`);
      }
      say(`P4-${code}`, all.length > 0 && nText > 0 && bad.length === 0, where, bad.slice(0, 8).join('\n   '));
    }
  });

  // ================= P5 天氣預報 =================
  await section(['P5a', 'P5b'], async () => {
    const r = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const f = await ip.tripForecast(tid);
      const mF = await ip.gatherModel(tid, { forecast: f }), m0 = await ip.gatherModel(tid, { forecast: null });
      const { destCoords } = await import('./js/views/weather.js');
      return { stale: f ? f.stale : null, tips: mF.tips, asOf: mF.tipsAsOf, tips0: m0.tips.length,
        hF: ip.renderPages(mF, { kind: 'route', split: 'one' })[0].h, h0: ip.renderPages(m0, { kind: 'route', split: 'one' })[0].h, dc: destCoords(tid) };
    }, S.t);
    const [, mo, dd] = dateIn(0).split('-').map(Number);
    const c = P3 || { match: '', kind: '', split: '' };
    say('P5a', r.stale === false && r.tips.length === 3 && same(r.tips.map((x) => x.day), [1, 2, 3]) && r.tips.filter((x) => x.warn).length === 1 && r.tips[1].warn
      && r.asOf === `${mo}/${dd}` && r.tips0 === 0 && r.hF > r.h0 && c.kind === 'route' && c.split === 'one' && c.match === '有預報',
      `小提醒 ${r.tips.length} 天（${r.tips.map((x) => x.text).join('｜')}；${r.asOf} 查）；預覽是「${c.match || '都不是'}」那一份；高 有預報 ${r.hF}、沒預報 ${r.h0}`);
    const KEYS = ['current', 'daily', 'forecast_days', 'latitude', 'longitude', 'timezone'];
    const bad = [];
    let hitDest = 0;
    for (const u of net.meteo) {
      const q = new URL(u).searchParams;
      const keys = [...new Set([...q.keys()])].sort();
      if (!same(keys, KEYS)) bad.push(`參數 ${keys.join(',')}`);
      if (r.dc && Number(q.get('latitude')) === r.dc.lat && Number(q.get('longitude')) === r.dc.lng) hitDest++;
    }
    say('P5b', net.meteo.length > 0 && hitDest > 0 && bad.length === 0, `查了 ${net.meteo.length} 次、${hitDest} 次是這趟的目的地座標`, bad.join('；'));
  });

  // ================= P6 換版型、翻頁、記住上次選的 =================
  await section(['P6a', 'P6b', 'P6c'], async () => {
    await tap(page, '.ip-seg[data-key="kind"] button', '分天色帶');
    await waitShown(page, 'band', 'one');
    await tap(page, '.ip-seg[data-key="split"] button', '每天一張');
    await waitShown(page, 'band', 'day');
    const a = await segState(page);
    const ca = await matchShown(page, S.t);
    const va = variantOf(ca);
    say('P6a', a.kind === 'band' && a.split === 'day' && same(a.kindOn, ['分天色帶']) && same(a.splitOn, ['每天一張']) && a.pagerShown
      && a.label.includes('第1天') && /共 3\s張/.test(a.label) && !a.prev && a.next && !!va && va.n === 3,
      `${a.kind}/${a.split}；選中 ${a.kindOn}、${a.splitOn}；翻頁「${a.label}」；前一張 ${a.prev ? '看得到' : '藏起來'}、下一張 ${a.next ? '看得到' : '藏起來'}；預覽${va ? `跟「${va.name}」第 1 張相同` : '跟成品不同'}`);
    await tap(page, '.pager-btn', '下一張');
    await waitShown(page, 'band', 'day', '1');
    const b = await segState(page);
    const cb = await matchShown(page, S.t);
    say('P6b', b.page === '1' && b.label.includes('第2天') && b.prev && b.next && cb.idx === 1 && !!variantOf(cb),
      `第 ${Number(b.page) + 1} 張「${b.label}」；${variantOf(cb) ? '跟成品同一份' : `跟成品不同（${cb.variants.map((v) => `${v.name} ${v.diff}`).join('、')}）`}`);
    const re = await enterPoster(page, TITLE, S.t);
    const c = await segState(page);
    const saved = await page.evaluate((t) => localStorage.getItem('tripquest.itinPoster.' + t), S.t);
    say('P6c', re.drawn && c.kind === 'band' && c.split === 'day' && c.page === '0' && same(c.kindOn, ['分天色帶']) && same(c.splitOn, ['每天一張']),
      `再進來是 ${c.kind}/${c.split} 第 ${Number(c.page) + 1} 張；這支手機記的是 ${saved}${re.ok ? '' : `；（從入口進不來：${re.why}）`}`);
    // 確保情境：存檔那幾條在「分天色帶・每天一張」上做（「沒記住上次選的」那條突變不連帶別條）
    if (c.kind !== 'band') { await tap(page, '.ip-seg[data-key="kind"] button', '分天色帶'); await sleep(600); }
    if (c.split !== 'day') { await tap(page, '.ip-seg[data-key="split"] button', '每天一張'); await sleep(600); }
    await waitShown(page, 'band', 'day');
  });

  // ================= P7、P8 存檔 =================
  await section(['P7a', 'P7b', 'P8a', 'P8b'], async () => {
    shownBefore = await matchShown(page, S.t);
    const v = variantOf(shownBefore);
    const dims = v ? v.dims : [];
    const names = dims.length > 1 ? (v ? v.labels : []).map((l) => `${BASE}-行程海報-${l}.png`) : [`${BASE}-行程海報.png`];
    const pngOk = (files) => files.length === dims.length && files.every((f, i) => f.name === names[i] && f.type === 'image/png' && same(pngDims(f.head), { w: dims[i][0], h: dims[i][1] }));
    const show = (files) => files.map((f) => `${f.name} ${JSON.stringify(pngDims(f.head))}`).join('、');
    net.outside.length = 0; net.writes.length = 0;

    await page.evaluate(() => { window.__shareMode = 'ok'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-png', '存成圖片');
    await soft(page.waitForFunction(() => window.__shared.length > 0 || window.__dl.length > 0, { timeout: 60000 }));
    await sleep(1500);
    const a = await page.evaluate(() => ({ shared: window.__shared, dl: window.__dl.map((d) => d.name) }));
    const fa = a.shared.length === 1 ? a.shared[0].files : [];
    say('P7a', !!v && dims.length === 3 && a.shared.length === 1 && pngOk(fa) && a.dl.length === 0,
      `分享 ${a.shared.length} 次、${fa.length} 個檔：${show(fa)}；另外下載 ${a.dl.length} 個；預覽那一份 ${dims.map((d) => d.join('×')).join('、')}`);

    await page.evaluate(() => { window.__shareMode = 'none'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-png', '存成圖片');
    await soft(page.waitForFunction((n) => window.__dl.length >= n && window.__dl.every((d) => d.done), { timeout: 60000 }, Math.max(1, dims.length)));
    await sleep(800);
    const b = await page.evaluate(() => ({ shared: window.__shared.length, dl: window.__dl.map((d) => ({ name: d.name, type: d.type, head: d.head })) }));
    say('P7b', !!v && b.shared === 0 && pngOk(b.dl), `下載 ${b.dl.length} 個：${show(b.dl)}`);

    await page.evaluate(() => { window.__shareMode = 'ok'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-pdf', '存成 PDF');
    await soft(page.waitForFunction(() => window.__dl.some((d) => d.done && /\.pdf$/.test(d.name)), { timeout: 60000 }));
    await sleep(500);
    const p = await page.evaluate(() => ({ shared: window.__shared.length, dl: window.__dl.map((d) => ({ name: d.name, type: d.type, size: d.size, b64: d.b64 })) }));
    const pdf = p.dl.length === 1 ? Buffer.from(p.dl[0].b64 || '', 'base64') : Buffer.alloc(0);
    const pbad = pdf.length ? pdfProblems(pdf, dims.map(([w, h]) => ({ w, h }))) : ['沒有 PDF'];
    say('P8a', !!v && dims.length === 3 && p.shared === 0 && p.dl.length === 1 && p.dl[0].name === `${BASE}-行程海報.pdf` && p.dl[0].type === 'application/pdf' && pbad.length === 0,
      `下載 ${p.dl.map((d) => `${d.name}（${d.type}，${d.size} 位元組）`).join('、') || '沒有'}；${dims.length} 頁`, pbad.join('；'));
    say('P8b', net.outside.length === 0 && net.writes.length === 0, `存了 3 次：對外 ${net.outside.length} 個、上傳 ${net.writes.length} 個`, [...net.outside, ...net.writes].join('；'));
  });

  // ================= P2 沒有景點的一趟 =================
  await section(['P2a', 'P2b'], async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await soft(page.waitForSelector('.trip-card', { timeout: 15000 }));
    let pre = await tap(page, '.trip-card', EMPTY);
    pre = pre && await soft(page.waitForSelector('.trip-home', { timeout: 15000 }));
    pre = pre && await tap(page, '#tabbar a.tab', '行程');
    pre = pre && await soft(page.waitForSelector('.itin-page .itin-seg', { timeout: 15000 }));
    pre = pre && await tap(page, '.itin-seg button', '行程');
    pre = pre && await soft(page.waitForSelector('#itin-pane-plan .itin-edit', { visible: true, timeout: 15000 }));
    const a = await page.evaluate(() => ({ btn: !!document.querySelector('#itin-pane-plan .itin-poster-btn'), edit: (document.querySelector('#itin-pane-plan .itin-edit') || {}).textContent || '' }));
    say('P2a', pre && !a.btn && a.edit.includes('去安排景點'), `「行程」那一格：${pre ? `有「${a.edit}」` : '沒進到'}、${a.btn ? '有' : '沒有'}海報按鈕`);
    await page.evaluate((t) => { location.hash = `#/trip/${t}/itinposter`; }, S.e);
    await soft(page.waitForFunction(() => /還沒有排景點/.test((document.querySelector('.page .empty') || {}).textContent || ''), { timeout: 15000 }));
    const b = await page.evaluate(() => ({ text: (document.querySelector('.page .empty') || {}).textContent || '', canvas: !!document.querySelector('.poster-canvas'), hash: location.hash }));
    say('P2b', b.text.includes('這趟還沒有排景點') && !b.canvas && b.hash.endsWith('/itinposter'), `寫「${b.text.slice(0, 20)}」、${b.canvas ? '有' : '沒有'}預覽`);
  });

  await section(['P9'], async () => { say('P9', pageErrors.length === 0, `${pageErrors.length} 個`, pageErrors.join('；')); });
} catch (e) {
  if (process.exitCode !== 4) { console.log('✗ 測試本身出錯：' + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode === 4 ? '，對照組沒過' : process.exitCode ? '，有失敗' : ''));
