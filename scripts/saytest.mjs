// 吉祥物講一句（v1.87.0；Yolin：「吉祥物對話框可以實際放進 App 了」）從使用者的入口驗（npm run saytest；會開瀏覽器）
//
// 涵蓋的程式：js/says.js（誰講、講什麼、關掉記哪一個鍵）、js/views/trip.js（主頁放哪、一次最多一句、天氣那一句跟天氣條一起放）、
//   js/ui.js（慶祝畫面放那一句）、js/addphoto.js（完成任務 → 照片上探頭的那一隻講）、js/glyphs.js（吉祥物、減少動態效果）、
//   js/peeks.js、js/weather.js（dayAlert：跟天氣條同一個判斷）、css/style.css（.say、.say-pk、say-in）
// 每句誰說、什麼時機觸發的表在 docs/STATUS.md 的 v1.87.0。
//
// 驗什麼（每一種時機都驗「該講時講」與「不該講時不講」）：
//   S0  純函式的邊界（中午 12 點、別天、下雨／下雪、出發那天）——只是補充，使用者的路在下面
//   出發當天早上（時區撥到當地 9 點）：主頁「今天是第 1 天」下面雪納瑞講一句；今天也會下雨，但一次只講一句（出發優先）；
//     那一句跟著版面排、不疊在別的區塊上；✕ 至少 44×44；出場只動 opacity／transform；
//     按 ✕ → 這趟不再講出發那一句、換天氣那一句（今天可能會下雨）；下雨那一句關掉 → 同一天不再講；
//     出發日改成明天、明天會下雨 → 照樣講「出發那天可能會下雨」（天氣那兩句照哪一天記）
//   出發當天下午（撥到 15 點）：不講出發那一句；沒下雨下雪也不講天氣那一句（主頁一句都沒有）
//   還沒出發、出發那天會下雪：山雀講「出發那天可能會下雪」
//   旅程結束：「旅程結束了」那張卡下面白熊講一句；關掉之後這趟不再講
//   完成任務：慶祝畫面照片上探頭的那一隻旁邊講一句（390／360／320 寬都在畫面裡、不疊到標題、說明、照片、吉祥物）；
//     全部拍完講另一句；夜市那一站、最後一個任務（S18）：探頭的是夜市那一張——五張裡邊線以上最矮、照片上面原本留的空間最少，
//     全部拍完那一句排成三行、上面那一行又最寬，最可能碰到字（龍山寺那張是預設圖、留得最多，原本只驗它，
//     「有那一句時多留空間」拿掉也照樣綠）
//   減少動態效果（系統設定）：照樣講、不動（主頁、慶祝畫面都是）
//
// 時區用 emulateTimezone 撥（不在 App 裡留測試開關，共用慣例 §5.13）。不打真網路（§5.6）：Open-Meteo 回自己造的預報，其餘外站 503。
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5847;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const soft = (p) => p.then(() => true, () => false);
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photoPath = join(mkdtempSync(join(tmpdir(), 'tq-say-')), 'p.png');
writeFileSync(photoPath, PNG);
const GPS = { latitude: 23.456789, longitude: 120.987654, accuracy: 10 };   // 合成的定位

// 撥到當地幾點：回一個 Etc/GMT±N 時區（分鐘照實際的走）
function tzAt(hour) {
  let off = hour - new Date().getUTCHours();
  while (off > 14) off -= 24;
  while (off < -12) off += 24;
  return off === 0 ? 'Etc/GMT' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}
const dateIn = (tz, n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + n * 86400000));

// 造一份 Open-Meteo 預報（日期照那個時區算）：wet＝{ 第幾天（今天＝0）: 'rain'｜'snow' }，其餘晴
function fakeForecast(tz, wet) {
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [],
    precipitation_probability_max: [], snowfall_sum: [], wind_speed_10m_max: [] };
  for (let i = -2; i < 16; i++) {
    const w = wet[i];
    daily.time.push(dateIn(tz, i));
    daily.weather_code.push(w === 'rain' ? 63 : w === 'snow' ? 73 : 1);
    daily.temperature_2m_max.push(w === 'snow' ? 2 : 22);
    daily.temperature_2m_min.push(w === 'snow' ? -3 : 16);
    daily.precipitation_sum.push(w === 'rain' ? 12 : w === 'snow' ? 3 : 0);
    daily.precipitation_probability_max.push(w === 'rain' ? 80 : w === 'snow' ? 70 : 10);
    daily.snowfall_sum.push(w === 'snow' ? 3.5 : 0);
    daily.wind_speed_10m_max.push(10);
  }
  return { elevation: 40, timezone: tz, current: { temperature_2m: 20, weather_code: 1 }, daily };
}

// 一個獨立的瀏覽情境：時區、（可選）系統的減少動態效果、預報（state.wet 可以中途換）
async function open(tz, wet, { reduce = false } = {}) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['geolocation']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateTimezone(tz);
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setGeolocation(GPS);
  const state = { wet };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(ORIGIN) || /^(data|blob):/.test(u)) { req.continue().catch(() => {}); return; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/.test(u)) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeForecast(tz, state.wet)) }).catch(() => {});
      return;
    }
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await soft(page.waitForSelector('.hero', { timeout: 20000 }));
  return { ctx, page, state };
}

// 造一趟（內建景點庫的景點，有座標、天氣條才會出來）。one＝true：只留一個任務（全部拍完那一句用）
const makeTrip = (page, title, start, end, items, one = false) => page.evaluate(async (ttl, s0, e0, its, one) => {
  const s = await import('./js/store.js');
  const { uuid } = await import('./js/ids.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const g = uuid(), t = uuid(), m = uuid();
  await s.put({ id: g, type: 'group', name: 'g' });
  await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
  await s.put({ id: t, type: 'trip', groupId: g, title: ttl, region: '台北', allowWiki: false, startDate: s0, endDate: e0 });
  const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items: its.map((x) => ({ ...x, region: '台北' })) });
  for (const x of spots) await s.put(x);
  for (const x of (one ? quests.slice(0, 1) : quests)) await s.put(x);
  // 這支手機是誰：先選好（加照片時才不會先跳「這是誰的手機」）
  await (await import('./js/claim.js')).claim(t, m);
  return { t, spots: spots.length, quests: one ? 1 : quests.length };
}, title, start, end, items, one);

// 首頁點旅程卡進主頁（使用者的路；導覽進主頁才會淡入）。wx＝true：等天氣條（有提示那一行）出來，「沒講天氣那一句」才不是還沒載完
async function openTrip(page, title, wx = true) {
  await page.evaluate(() => localStorage.removeItem('tripquest.wx'));
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  if (!await soft(page.waitForSelector('.trip-card', { timeout: 15000 }))) return false;
  if (!await tap(page, '.trip-card', title)) return false;
  if (!await soft(page.waitForSelector('.trip-home', { timeout: 15000 }))) return false;
  if (wx && !await soft(page.waitForSelector('.trip-home .wx-slot .wx-strip .wx-strip-tip', { timeout: 20000 }))) { console.log(`  [等不到天氣條] 「${title}」`); return false; }
  await sleep(300);
  return true;
}
// 底部分頁換過去再換回主頁（使用者的路；主頁整頁重新畫一次）
async function backToHome(page, wx = true) {
  if (!await tap(page, '#tabbar a.tab', '任務')) return false;
  if (!await soft(page.waitForSelector('.qcollapse', { timeout: 15000 }))) return false;
  await page.evaluate(() => localStorage.removeItem('tripquest.wx'));
  if (!await tap(page, '#tabbar a.tab', '主頁')) return false;
  if (!await soft(page.waitForSelector('.trip-home', { timeout: 15000 }))) return false;
  if (wx && !await soft(page.waitForSelector('.trip-home .wx-slot .wx-strip .wx-strip-tip', { timeout: 20000 }))) return false;
  await sleep(300);
  return true;
}

// 主頁上的每一句：講什麼、誰講、放哪（上一個兄弟是誰）、吉祥物 aria-hidden、讀螢幕念得到、✕ 多大、
// 疊不疊到別的區塊（跟 .trip-home 底下其他看得到的區塊、天氣條比框）、是不是跟著版面排（不是浮起來）、動畫
const says = (page) => page.evaluate(() => {
  const pg = document.querySelector('.trip-home');
  if (!pg) return null;
  const OK = new Set(['offset', 'easing', 'composite', 'computedOffset', 'opacity', 'transform']);
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  return [...pg.querySelectorAll('.say')].map((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = el.querySelector('.say-x'), xr = x ? x.getBoundingClientRect() : null;
    const who = el.querySelector('.say-who');
    const prev = el.previousElementSibling;
    // 別的區塊：主頁底下（與天氣那一格裡）除了自己以外、看得到的元素
    const others = [...pg.children, ...pg.querySelectorAll('.wx-slot > *')].filter((o) => o !== el && !o.contains(el) && o.getBoundingClientRect().height > 0);
    const over = others.filter((o) => hit(r, o.getBoundingClientRect())).map((o) => o.className || o.tagName);
    // 那一句自己的動畫（出場那一下）與連吉祥物在內的全部動畫（減少動態效果時要是 0）分開數
    const anims = el.getAnimations();
    const all = el.getAnimations({ subtree: true });
    const props = [...new Set(anims.flatMap((a) => (a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : []).flatMap((k) => Object.keys(k))))];
    // v1.87.1 下雨／下雪那一句：講話的是探頭圖（對話框上緣探頭）。量：哪一張、邊線（圖底往上 --pk-sink）跟對話框外框上緣差幾 px、
    // 圖本身疊不疊到別的區塊（天氣條）、還有沒有左邊那一隻、對話框還有沒有尾巴
    const tx = el.querySelector('.say-text');
    const pk = tx ? tx.querySelector(':scope > svg.gl-peek') : null;
    const pr = pk ? pk.getBoundingClientRect() : null;
    const edgeGap = pk ? Math.round((pr.bottom - parseFloat(pk.style.getPropertyValue('--pk-sink')) - tx.getBoundingClientRect().top) * 100) / 100 : null;
    return {
      peek: pk ? pk.dataset.peek : null, peekHidden: !!pk && pk.getAttribute('aria-hidden') === 'true', peekW: pr ? Math.round(pr.width) : 0, edgeGap,
      peekOver: pk ? others.filter((o) => hit(pr, o.getBoundingClientRect())).map((o) => o.className || o.tagName) : [],
      general: !!el.querySelector('.say-who svg[data-mascot]'), tail: !!tx && getComputedStyle(tx, '::before').content !== 'none',
      key: el.dataset.say, who: el.dataset.who, text: el.querySelector('.say-text')?.textContent || '',
      role: el.querySelector('.say-text')?.getAttribute('role') || null,
      whoHidden: !!who && who.getAttribute('aria-hidden') === 'true' && !!who.querySelector('svg'),
      xLabel: x ? x.getAttribute('aria-label') : null, xw: xr ? Math.round(xr.width) : 0, xh: xr ? Math.round(xr.height) : 0,
      // 上一個兄弟只比第一個 class（「旅程結束了」那張卡掛了探頭圖會多一個 has-peek）
      inWx: !!el.closest('.wx-slot'), prev: prev ? prev.classList[0] || prev.tagName : null,
      pos: getComputedStyle(el).position, over, h: Math.round(r.height),
      sayIn: el.classList.contains('say-in'), anims: anims.length, allAnims: all.length, names: anims.map((a) => a.animationName || '?'), props, badProps: props.filter((p) => !OK.has(p)),
    };
  });
});
const one = (S, key) => (S || []).find((x) => x.key === key) || null;
// 天氣那兩句用「哪一種」找（鍵的寫法是實作；「照哪一天記」由 S8 從使用者看得到的結果驗、鍵的格式由 S0 驗）
const oneKind = (S, kind) => (S || []).find((x) => String(x.key).split(':')[0] === kind) || null;
const brief = (S) => (S ? (S.length ? S.map((x) => `${x.key}／${x.who}「${x.text}」`).join('、') : '一句都沒有') : '沒有主頁');
// 按某一句的 ✕（真的滑鼠點下去），等它不見
async function closeSay(page, key) {
  const x = await page.$(`.trip-home .say[data-say="${key}"] .say-x`);
  const k = x ? await userClick(page, x, `「${key}」那一句的 ✕`) : { ok: false, why: '沒有 ✕' };
  if (!k.ok) { console.log('  [點不到]', k.why); return false; }
  return soft(page.waitForFunction((key) => !document.querySelector(`.trip-home .say[data-say="${key}"]`), { timeout: 5000 }, key));
}
const saidKeys = (page, t) => page.evaluate((t) => { try { return JSON.parse(localStorage.getItem('tripquest.said.' + t) || '[]'); } catch { return null; } }, t);

// 完成一個任務（任務頁 → 那一站第一列「從相簿選」），等慶祝畫面出來、那一句淡入完再量
async function completeOne(page, spot) {
  if (!await tap(page, '#tabbar a.tab', '任務')) return false;
  if (!await soft(page.waitForSelector('.qcollapse', { timeout: 15000 }))) return false;
  const isOpen = (n) => [...document.querySelectorAll('.qcollapse.open .qc-toggle')].some((b) => b.textContent.includes(n));
  if (!await page.evaluate(isOpen, spot)) await tap(page, '.qc-toggle', spot);
  if (!await soft(page.waitForFunction(isOpen, { timeout: 8000 }, spot))) return false;
  const id = await page.evaluate((n) => {
    const c = [...document.querySelectorAll('.qcollapse.open')].find((x) => x.querySelector('.qc-toggle')?.textContent.includes(n));
    return c?.querySelector('.qline:not(.done)')?.dataset.quest || null;
  }, spot);
  if (!id) return false;
  const inputs = await page.$$(`.qline[data-quest="${id}"] .addphoto-icons input[type=file]`);
  if (inputs.length < 2) return false;
  await inputs[1].uploadFile(photoPath);            // [0]=拍照 [1]=從相簿選
  if (!await soft(page.waitForSelector('.celebrate', { timeout: 30000 }))) return false;
  await sleep(1600);   // 探頭的那一隻跳上來（.6 秒）＋那一句等 .7 秒再淡入（.35 秒）
  return true;
}
// 慶祝畫面那一句：在照片那一塊裡、在探頭的那一隻右邊、整句在畫面裡、不疊到標題／說明／照片／吉祥物
const celebSay = (page) => page.evaluate(() => {
  const c = document.querySelector('.celebrate');
  if (!c) return { found: false, celeb: false };
  const el = c.querySelector('.celebrate-shot > .say-pk');
  if (!el) return { found: false, celeb: true, ttl: c.querySelector('h2')?.textContent || '' };
  const r = el.getBoundingClientRect();
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const pk = c.querySelector('.celebrate-shot > svg.gl-peek'), pr = pk ? pk.getBoundingClientRect() : null;
  const others = [c.querySelector('h2'), ...c.querySelectorAll(':scope > p'), c.querySelector('.celebrate-shot > img'), pk].filter(Boolean);
  const anims = el.getAnimations();
  const OK = new Set(['offset', 'easing', 'composite', 'computedOffset', 'opacity', 'transform']);
  const props = [...new Set(anims.flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k))))];
  const lines = (() => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; })();
  // 離上面的字多遠（只印、不斷言）：那一句上緣 − 標題／說明裡最下面那一個的下緣
  const above = [c.querySelector('h2'), ...c.querySelectorAll(':scope > p')].filter(Boolean).map((o) => o.getBoundingClientRect().bottom);
  return {
    found: true, celeb: true, text: el.textContent, role: el.getAttribute('role'), ttl: c.querySelector('h2')?.textContent || '',
    peek: pk ? pk.getAttribute('data-peek') : null, gap: above.length ? Math.round(r.top - Math.max(...above)) : null,
    inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 0,
    over: others.filter((o) => hit(r, o.getBoundingClientRect())).map((o) => o.tagName.toLowerCase() + (o.className && typeof o.className === 'string' ? '.' + o.className.split(' ')[0] : '')),
    rightOfPeek: !!pr && r.left >= pr.right - 1, w: Math.round(r.width), lines, vw: innerWidth,
    sayIn: el.classList.contains('say-in'), anims: anims.length, badProps: props.filter((p) => !OK.has(p)),
  };
});
// 最多 4 行：讀得下去（正常最多 4 行＝320 寬、夜市那一張、全部拍完；第一版寬度跟著照片算是 8 行、一兩個字一行）。
// 照片上面留多高改成量了再設（ui.js 的 roomForSay）之後，排成 8 行也不會疊到上面的字——只看「疊不疊到」就抓不到字直排。
const celebOk = (s, text) => s.found && s.text === text && s.role === 'status' && s.inView && s.over.length === 0 && s.rightOfPeek && s.lines <= 4;
const celebBrief = (s) => (s.found ? `「${s.text}」寬 ${s.w}px、${s.lines} 行、在畫面裡 ${s.inView}、在探頭那隻右邊 ${s.rightOfPeek}、疊到 ${s.over.join('、') || '沒有'}` : s.celeb ? `慶祝畫面（${s.ttl}）上沒有那一句` : '沒有慶祝畫面');
async function clearCelebrations(page, max = 10) {
  for (let k = 0; k < max; k++) {
    if (!await page.$('.celebrate')) break;
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.celebrate .btn')];
      (btns.find((b) => /繼續|太棒/.test(b.textContent)) || btns[0])?.click();
    });
    await sleep(350);
  }
}

const ITEMS = [{ name: '龍山寺', day: 1 }, { name: '台北101', day: 1 }, { name: '士林夜市', day: 2 }];

try {
  // ================= S0 純函式的邊界（補充；使用者的路在下面）=================
  {
    const { ctx, page } = await open(tzAt(9), {});
    const r = await page.evaluate(async () => {
      const s = await import('./js/says.js');
      const d = (h, m = 0) => new Date(2026, 4, 10, h, m);
      const trip = { startDate: '2026-05-10' };
      const alert = (kind, date) => ({ kind, day: { date } });
      return {
        am: s.departLine(trip, d(11, 59))?.text || null, noon: s.departLine(trip, d(12, 0)), other: s.departLine({ startDate: '2026-05-11' }, d(9)),
        rainT: s.weatherLine(alert('rain', '2026-05-10'), '2026-05-10'), rainD: s.weatherLine(alert('rain', '2026-05-12'), '2026-05-10'),
        snowT: s.weatherLine(alert('snow', '2026-05-10'), '2026-05-10'), none: s.weatherLine(null, '2026-05-10'),
        endF: s.endLine(false), endT: s.endLine(true), done1: s.doneLine(false), doneAll: s.doneLine(true),
      };
    });
    yes(r.am === '今天出發！東西都帶齊了嗎？' && r.noon === null && r.other === null
      && r.rainT?.key === 'rain:2026-05-10' && r.rainT.who === 'schnauzer' && r.rainT.text === '今天可能會下雨，傘帶了嗎？'
      && r.rainD?.key === 'rain:2026-05-12' && r.rainD.text === '出發那天可能會下雨，傘先放進行李吧！'
      && r.snowT?.key === 'snow:2026-05-10' && r.snowT.who === 'tit' && r.snowT.text === '今天可能會下雪，穿暖一點、走路慢慢來！' && r.none === null
      && r.endF === null && r.endT?.who === 'bear' && r.endT.text === '這趟旅程結束了，辛苦啦！'
      && r.done1 === '下一個也一起拍吧！' && r.doneAll === '全部拍完了，辛苦啦！',
      `S0 純函式：11:59 講、12:00 不講、別天不講；下雨／下雪照「哪一天」記鍵、今天和出發那天兩種說法；沒有提醒不講；結束與完成兩句（${JSON.stringify(r)}）`);
    await ctx.close();
  }

  // ================= 出發當天早上（當地 9 點；今天會下雨）=================
  console.log('\n— 出發當天早上 —');
  {
    const tz = tzAt(9);
    const { ctx, page, state } = await open(tz, { 0: 'rain' });
    const today = dateIn(tz, 0), tomorrow = dateIn(tz, 1);
    const { t } = await makeTrip(page, '今天出發', today, dateIn(tz, 1), ITEMS);
    const ok1 = await openTrip(page, '今天出發');
    const S = ok1 ? await says(page) : null;
    const dep = one(S, 'depart');
    const wxKind = await page.evaluate(() => document.querySelector('.trip-home .wx-strip-tip')?.getAttribute('data-wx') || null);
    const day = await page.evaluate(() => document.querySelector('.trip-home .th-day-n')?.textContent || '');
    yes(!!dep && dep.who === 'schnauzer' && dep.text === '今天出發！東西都帶齊了嗎？' && dep.prev === 'th-day' && dep.role === 'status' && dep.whoHidden && day === '今天是第 1 天',
      `S1 出發當天早上：主頁「${day || '沒讀到'}」下面，雪納瑞講「今天出發！東西都帶齊了嗎？」（${dep ? `${dep.who}「${dep.text}」、上一個是 ${dep.prev}、role=${dep.role}、吉祥物 aria-hidden ${dep.whoHidden}` : brief(S)}）`);
    yes(!!S && S.length === 1 && !!dep && wxKind === 'rain',
      `S2 主頁一次最多一句：今天會下雨（天氣條提示 ${wxKind || '沒有'}），但只講出發那一句（主頁上：${brief(S)}）`);
    yes(!!dep && dep.over.length === 0 && dep.pos === 'static' && dep.h > 0,
      `S3 不擋操作：那一句跟著版面排（position ${dep ? dep.pos : '—'}），不疊在別的區塊上（疊到：${dep ? dep.over.join('、') || '沒有' : '—'}）`);
    yes(!!dep && dep.xLabel === '關掉這句話' && dep.xw >= 44 && dep.xh >= 44,
      `S4 可以關：✕ 讀螢幕念「${dep ? dep.xLabel : '—'}」、${dep ? `${dep.xw}×${dep.xh}` : '—'}（至少 44×44）`);
    yes(!!dep && dep.sayIn && dep.anims >= 1 && dep.badProps.length === 0 && dep.names.every((n) => n === 'say-in'),
      `S5 出場只動 opacity／transform：導覽進主頁時淡入（say-in ${dep ? dep.sayIn : '—'}、動畫 ${dep ? dep.anims : 0} 段：${dep ? dep.names.join('、') : '—'}；用到的屬性以外的：${dep ? dep.badProps.join('、') || '沒有' : '—'}）`);

    // 按 ✕ → 不見；換一頁再回主頁 → 出發那一句不再講，輪到天氣那一句
    const closed = ok1 && !!dep && await closeSay(page, 'depart');
    const keys1 = await saidKeys(page, t);
    const ok2 = closed && await backToHome(page);
    const S2 = ok2 ? await says(page) : null;
    const rain = oneKind(S2, 'rain');
    yes(closed && (keys1 || []).includes('depart') && !one(S2, 'depart') && !!rain && rain.who === 'schnauzer' && rain.text === '今天可能會下雨，傘帶了嗎？' && rain.inWx && rain.prev === 'wx-strip' && S2.length === 1,
      `S6 按 ✕ 關掉出發那一句 → 這趟不再講；換一頁再回主頁，輪到天氣條下面那一句（記下的：${JSON.stringify(keys1)}；主頁上：${brief(S2)}${rain ? `；在天氣那一格 ${rain.inWx}、上一個 ${rain.prev}` : ''}）`);
    yes(!!rain && rain.over.length === 0 && rain.pos === 'static',
      `S6b 天氣那一句也不疊在別的區塊上（疊到：${rain ? rain.over.join('、') || '沒有' : '—'}）`);
    // v1.87.1（Yolin 看 v1.87.0 實機）：下雨那一句要配撐傘的那一隻（天氣頁那一張探頭圖），不是一般那一隻。
    // 期望（2026-11-14 事前寫）：對話框上緣探頭的是 rain（鬍鬍撐傘）、aria-hidden；邊線對在對話框外框上緣（差 ≤ 1px）；
    // 圖不疊到天氣條；沒有左邊那一隻；對話框沒有尾巴。出發那一句（S1）照舊是左邊那一隻、沒有探頭圖。
    yes(!!rain && rain.peek === 'rain' && rain.peekHidden && rain.peekW > 0 && rain.edgeGap != null && Math.abs(rain.edgeGap) <= 1
      && rain.peekOver.length === 0 && !rain.general && !rain.tail && !!dep && dep.peek === null && dep.general,
      `S6c 下雨那一句：撐傘的那一隻從對話框上緣探頭（${rain ? `探頭圖 ${rain.peek || '沒有'}、寬 ${rain.peekW}px、邊線差 ${rain.edgeGap}px、疊到 ${rain.peekOver.join('、') || '沒有'}、左邊那一隻 ${rain.general}、尾巴 ${rain.tail}` : '—'}；出發那一句：探頭圖 ${dep ? dep.peek : '—'}、左邊那一隻 ${dep ? dep.general : '—'}）`);
    const closed2 = !!rain && await closeSay(page, rain.key);
    const ok3 = closed2 && await backToHome(page);
    const S3 = ok3 ? await says(page) : null;
    const tip3 = await page.evaluate(() => document.querySelector('.trip-home .wx-strip-tip')?.getAttribute('data-wx') || null);
    yes(closed2 && !!S3 && S3.length === 0 && tip3 === 'rain',
      `S7 下雨那一句關掉 → 同一天不再講（天氣條照樣寫會下雨：${tip3 || '沒有'}；主頁上：${brief(S3)}）`);
    // 出發日改成明天、明天會下雨：還沒出發 → 看出發那天 → 那一天的鍵沒關過，照樣講
    state.wet = { 1: 'rain' };
    await page.evaluate(async (t, a, b) => { const s = await import('./js/store.js'); await s.patch(t, { startDate: a, endDate: b }); }, t, tomorrow, dateIn(tz, 2));
    const ok4 = await backToHome(page);
    const S4 = ok4 ? await says(page) : null;
    const rain2 = oneKind(S4, 'rain');
    yes(!!rain2 && rain2.text === '出發那天可能會下雨，傘先放進行李吧！' && S4.length === 1,
      `S8 天氣那一句照「哪一天」記：今天的關掉了，出發日改成明天、明天會下雨 → 照樣講（主頁上：${brief(S4)}）`);
    await ctx.close();
  }

  // ================= 出發當天下午（當地 15 點；晴）=================
  console.log('\n— 出發當天下午 —');
  {
    const tz = tzAt(15);
    const { ctx, page } = await open(tz, {});
    await makeTrip(page, '今天下午出發', dateIn(tz, 0), dateIn(tz, 1), ITEMS);
    const ok = await openTrip(page, '今天下午出發');
    const S = ok ? await says(page) : null;
    const day = await page.evaluate(() => document.querySelector('.trip-home .th-day-n')?.textContent || '');
    const tip = await page.evaluate(() => document.querySelector('.trip-home .wx-strip-tip')?.getAttribute('data-wx') || null);
    yes(ok && day === '今天是第 1 天' && tip === null && !!S && S.length === 0,
      `S9 出發當天下午（12 點以後）不講出發那一句；沒下雨下雪也不講天氣那一句（「${day || '沒讀到'}」、天氣條提示 ${tip || '沒有'}；主頁上：${brief(S)}）`);
    await ctx.close();
  }

  // ================= 還沒出發、出發那天會下雪 =================
  console.log('\n— 還沒出發、出發那天會下雪 —');
  {
    const tz = tzAt(15);
    const { ctx, page } = await open(tz, { 2: 'snow' });
    await makeTrip(page, '後天出發', dateIn(tz, 2), dateIn(tz, 3), ITEMS);
    const ok = await openTrip(page, '後天出發');
    const S = ok ? await says(page) : null;
    const snow = oneKind(S, 'snow');
    yes(!!snow && snow.who === 'tit' && snow.text === '出發那天可能會下雪，保暖的衣服記得帶！' && snow.inWx && S.length === 1,
      `S10 還沒出發、出發那天會下雪：天氣條下面山雀講「出發那天可能會下雪，保暖的衣服記得帶！」（主頁上：${brief(S)}）`);
    // v1.87.1：下雪那一句配天氣頁那一張踩雪板的（期望事前寫：snow、邊線差 ≤ 1px、不疊、沒有左邊那一隻、沒有尾巴）
    yes(!!snow && snow.peek === 'snow' && snow.peekHidden && snow.peekW > 0 && snow.edgeGap != null && Math.abs(snow.edgeGap) <= 1
      && snow.peekOver.length === 0 && !snow.general && !snow.tail,
      `S10b 下雪那一句：踩雪板的那一隻從對話框上緣探頭（${snow ? `探頭圖 ${snow.peek || '沒有'}、寬 ${snow.peekW}px、邊線差 ${snow.edgeGap}px、疊到 ${snow.peekOver.join('、') || '沒有'}、左邊那一隻 ${snow.general}、尾巴 ${snow.tail}` : '—'}）`);
    await ctx.close();
  }

  // ================= 旅程結束 =================
  console.log('\n— 旅程結束 —');
  {
    const tz = tzAt(15);
    const { ctx, page } = await open(tz, {});
    const { t } = await makeTrip(page, '上個月去的', dateIn(tz, -11), dateIn(tz, -9), ITEMS);
    const ok = await openTrip(page, '上個月去的', false);
    const S = ok ? await says(page) : null;
    const end = one(S, 'end');
    yes(!!end && end.who === 'bear' && end.text === '這趟旅程結束了，辛苦啦！' && end.prev === 'th-end' && S.length === 1 && end.over.length === 0,
      `S11 旅程結束：「旅程結束了」那張卡下面白熊講「這趟旅程結束了，辛苦啦！」、不疊在別的區塊上（主頁上：${brief(S)}${end ? `；上一個 ${end.prev}；疊到 ${end.over.join('、') || '沒有'}` : ''}）`);
    const closed = !!end && await closeSay(page, 'end');
    const ok2 = closed && await backToHome(page, false);
    const S2 = ok2 ? await says(page) : null;
    const card = await page.evaluate(() => !!document.querySelector('.trip-home .th-end'));
    yes(closed && card && !!S2 && S2.length === 0 && (await saidKeys(page, t) || []).includes('end'),
      `S12 結束那一句關掉之後這趟不再講（卡照樣在 ${card}；主頁上：${brief(S2)}）`);
    await ctx.close();
  }

  // ================= 完成任務（慶祝畫面）=================
  console.log('\n— 完成任務 —');
  {
    const tz = tzAt(15);
    const { ctx, page } = await open(tz, {});
    // 今天出發（今天是第 1 天：任務頁打開就是第 1 天、龍山寺在上面）；下午 3 點，主頁不講出發那一句
    await makeTrip(page, '旅程中', dateIn(tz, 0), dateIn(tz, 1), ITEMS);
    const ok = await openTrip(page, '旅程中') && await completeOne(page, '龍山寺');
    const c390 = ok ? await celebSay(page) : { found: false, celeb: false };
    yes(celebOk(c390, '下一個也一起拍吧！'),
      `S13 完成任務：慶祝畫面照片上探頭的那一隻旁邊講「下一個也一起拍吧！」——在牠右邊、整句在畫面裡、不疊到標題、說明、照片、吉祥物（390 寬：${celebBrief(c390)}）`);
    yes(c390.found && c390.sayIn && c390.anims >= 1 && c390.badProps.length === 0,
      `S13b 慶祝畫面那一句出場只動 opacity／transform（say-in ${c390.sayIn}、動畫 ${c390.anims} 段、其他屬性：${(c390.badProps || []).join('、') || '沒有'}）`);
    // 窄螢幕：慶祝畫面開著換寬度（照片寬 62vw、那一句最寬到螢幕右邊留 12px）
    const narrow = [];
    for (const w of [360, 320]) {
      await page.setViewport({ width: w, height: 740 });
      await sleep(400);
      narrow.push([w, await celebSay(page)]);
    }
    await page.setViewport({ width: 390, height: 844 });
    yes(narrow.every(([, s]) => celebOk(s, '下一個也一起拍吧！')),
      `S14 窄螢幕照樣在畫面裡、不疊到別的東西（${narrow.map(([w, s]) => `${w} 寬：${celebBrief(s)}`).join('；')}）`);
    await clearCelebrations(page);
    // 全部拍完：只有一個任務的一趟
    await makeTrip(page, '只拍一張', dateIn(tz, 0), dateIn(tz, 1), [{ name: '龍山寺', day: 1 }], true);
    const okA = await openTrip(page, '只拍一張') && await completeOne(page, '龍山寺');
    const cAll = okA ? await celebSay(page) : { found: false, celeb: false };
    yes(celebOk(cAll, '全部拍完了，辛苦啦！'), `S15 全部拍完：慶祝畫面那一句是「全部拍完了，辛苦啦！」（${celebBrief(cAll)}）`);
    await clearCelebrations(page);
    // 夜市那一站、這趟最後一個任務：探頭的是夜市那一張（js/peeks.js 的 THEME_PEEK），邊線以上最矮 → 照片上面原本留的空間最少；
    // 全部拍完那一句排成三行，上面那一行是較寬的「可以來做回憶影片了」——靠「有那一句時照片上面多留空間」才不碰到它。
    // （慶祝畫面置中排、每一行只有字那麼寬：「下一個」那一句上面是很窄的「進度 N / M」，垂直疊到也碰不到字，所以不用那一句）
    await makeTrip(page, '夜市', dateIn(tz, 0), dateIn(tz, 1), [{ name: '士林夜市', day: 1 }], true);
    const okN = await openTrip(page, '夜市') && await completeOne(page, '士林夜市');
    const nm = [];
    if (okN) {
      for (const [w, hh] of [[390, 844], [360, 740], [320, 740]]) {
        await page.setViewport({ width: w, height: hh });
        await sleep(400);
        nm.push([w, await celebSay(page)]);
      }
    }
    await page.setViewport({ width: 390, height: 844 });
    yes(nm.length === 3 && nm.every(([, s]) => s.found && s.peek === 'grill'),
      `S18 前置：夜市那一站完成任務，照片上探頭的是夜市那一張（${nm.map(([w, s]) => `${w}：${s.found ? s.peek : '沒有那一句'}`).join('、') || '沒進到慶祝畫面'}）`);
    yes(nm.length === 3 && nm.every(([, s]) => celebOk(s, '全部拍完了，辛苦啦！')),
      `S18 夜市那一張、全部拍完（照片上面原本留的空間最少、上面那一行最寬）：三種寬那一句都在畫面裡、不疊到標題、說明、照片、吉祥物（${nm.map(([w, s]) => `${w} 寬：${celebBrief(s)}、離上面的字 ${s.gap ?? '—'}px`).join('；') || '沒進到慶祝畫面'}）`);
    await clearCelebrations(page);
    await ctx.close();
  }

  // ================= 減少動態效果（系統設定）=================
  console.log('\n— 減少動態效果 —');
  {
    const tz = tzAt(15);
    const { ctx, page } = await open(tz, {}, { reduce: true });
    const rm = await page.evaluate(() => document.documentElement.classList.contains('reduce-motion'));
    await makeTrip(page, '結束了（不動）', dateIn(tz, -11), dateIn(tz, -9), ITEMS);
    const ok = await openTrip(page, '結束了（不動）', false);
    const S = ok ? await says(page) : null;
    const end = one(S, 'end');
    yes(rm && !!end && !end.sayIn && end.allAnims === 0,
      `S16 減少動態效果：主頁照樣講（${brief(S)}），但不動（<html> reduce-motion ${rm}；say-in ${end ? end.sayIn : '—'}、連吉祥物在內的動畫 ${end ? end.allAnims : '—'} 段）`);
    await makeTrip(page, '旅程中（不動）', dateIn(tz, 0), dateIn(tz, 1), ITEMS);
    const okC = await openTrip(page, '旅程中（不動）') && await completeOne(page, '龍山寺');
    const c = okC ? await celebSay(page) : { found: false, celeb: false };
    yes(rm && celebOk(c, '下一個也一起拍吧！') && !c.sayIn && c.anims === 0,
      `S17 減少動態效果：慶祝畫面那一句照樣在、不動（${celebBrief(c)}；say-in ${c.sayIn}、動畫 ${c.anims} 段）`);
    await clearCelebrations(page);
    await ctx.close();
  }
} catch (e) {
  yes(false, `例外：${e && e.stack || e}`);
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n吉祥物講一句：${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
