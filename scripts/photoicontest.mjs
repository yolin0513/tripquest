// 拍照圖示＋出發地座標降精度（2026-11-13 第四段之一）從使用者的入口驗（npm run photoicontest；會開瀏覽器）
//
// 涵蓋的程式：js/glyphs.js（photoIcon）、js/addphoto.js（任務列兩顆、展開後兩顆）、css/style.css（.gl-icon）、
//   js/weather.js（coarse、hereTempNow）
// 第四段拆成兩批（Dispatch 2026-11-13）：Yolin 喜歡相機／相簿圖示，先上線；A2 是隱私修正、不等吉祥物定案，一起上。
// 情境圖與天氣吉祥物要重做整合方式，是另一批、另一支測試。A2 放在這支：它跟圖示同一批上線，
// 驗它要走的路（打開行程 → 天氣條 → 點進天氣頁）跟驗圖示是同一趟。
//
// 不打真網路（共用慣例 §5.6）：Open-Meteo 的請求由本測試回一份自己造的預報（今天下雨、其餘晴天）；其餘外站一律當場回 503。
// 定位：瀏覽器給一個合成的座標（小數 6 位、不是任何人的位置），驗送出去的只剩小數 2 位。
//
//   I1 拍照圖示（和紙、深色各一輪）：任務列兩顆是相機／相簿圖示（不是表情符號）、46×46、讀螢幕的字照舊；
//      展開後兩顆是圖示＋字、圖在字左邊、高 ≥ 44、390 寬時字一行（跟舊版一樣）
//   A2 出發地座標：天氣頁的比較基準真的是手機的定位（前置）；送給 Open-Meteo 的出發地座標只剩小數 2 位
//
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5817;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const soft = (p) => p.then(() => true, () => false);   // 等不到記成 false，不丟例外
// 導覽用的點擊：點不到（clickText 會丟例外點名）記成 false、照樣往下跑，由後面的斷言記 ✗——
// 丟出去會變成「例外」一行、後面的項不印，突變執行器就判成沒跑滿（點名的那句照樣印出來，看得出是哪一顆）
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });

// 合成的定位：小數 6 位；降到小數 2 位應該是 23.46, 120.99
const GPS = { latitude: 23.456789, longitude: 120.987654, accuracy: 10 };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

// 造一份 Open-Meteo 預報：16 天、從今天起，22／16 度；**今天下雨**——天氣頁要有「出門提醒」才會畫出
// 「對照基準：你的位置…」那一句（js/views/weather.js；全部晴天只顯示「天氣還算舒服」、沒有那一句，A2 前置就讀不到：
// 第一次跑撞到）。這支只看請求帶的座標，下雨與否不影響 A2。
function fakeForecast() {
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [],
    precipitation_probability_max: [], snowfall_sum: [], wind_speed_10m_max: [] };
  for (let i = 0; i < 16; i++) {
    daily.time.push(plus(i));
    daily.weather_code.push(i === 0 ? 63 : 1);
    daily.temperature_2m_max.push(22);
    daily.temperature_2m_min.push(16);
    daily.precipitation_sum.push(i === 0 ? 12 : 0);
    daily.precipitation_probability_max.push(i === 0 ? 80 : 10);
    daily.snowfall_sum.push(0);
    daily.wind_speed_10m_max.push(10);
  }
  return { elevation: 40, timezone: 'Asia/Taipei', current: { temperature_2m: 20, weather_code: 1 }, daily };
}

// 回首頁。人已經在首頁時按「我的旅程」不會重畫——測試用程式造的行程就不會出現，
// 所以先到「設定」再回來（跟使用者從別頁回首頁一樣）。旅程頁、天氣頁沒有「我的旅程」分頁：先按頁首的返回鍵（最多 3 下）。
async function toHome(page) {
  for (let k = 0; k < 3; k++) {
    const where = await page.evaluate(() => location.hash);
    if (where === '#/' || where === '' || where === '#/settings') break;
    const hit = await userClick(page, await page.$('#backBtn'), '頁首的返回鍵');
    if (!hit.ok) { console.log('  [點不到]', hit.why); break; }
    await soft(page.waitForFunction((w) => location.hash !== w, { timeout: 10000 }, where));
    await sleep(300);
  }
  if (await page.evaluate(() => location.hash === '#/' || location.hash === '')) {
    await tap(page, 'a.tab', '設定');
    await soft(page.waitForFunction(() => location.hash === '#/settings', { timeout: 15000 }));
  }
  if (!await tap(page, 'a.tab', '我的旅程')) return false;
  const ok = await soft(page.waitForFunction(() => (location.hash === '#/' || location.hash === '') && document.querySelector('.trip-card'), { timeout: 15000 }));
  if (!ok) console.log('  [回不到首頁或沒有旅程卡]');
  return ok;
}

// S7 的同一組量法：任務列兩顆圖示鈕＋展開後兩顆有字的按鈕
// v1.84.0 起點旅程卡先到主頁：任務列在底部分頁「任務」（使用者的路：點那一格）
async function toTasks(page) {
  if (!await tap(page, '#tabbar a.tab', '任務')) return false;
  return soft(page.waitForSelector('.qline .addphoto-icons .apx-cam', { timeout: 15000 }));
}

async function photoButtons(page, tag) {
  const ic = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.qline')].find((r) => r.getBoundingClientRect().height > 0 && r.querySelector('.addphoto-icons .apx-cam'));
    if (!row) return null;
    row.scrollIntoView({ block: 'center' });
    const one = (b) => {
      if (!b) return null;
      const r = b.getBoundingClientRect(), s = b.querySelector('svg.gl-icon'), sr = s && s.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute('aria-label') || '', text: b.textContent.trim(),
        icon: s ? s.getAttribute('data-icon') : null, iw: sr ? Math.round(sr.width) : 0, aria: s ? s.getAttribute('aria-hidden') : null,
        inside: !!sr && sr.left >= r.left && sr.right <= r.right && sr.top >= r.top && sr.bottom <= r.bottom,
        shown: !!s && getComputedStyle(s).display !== 'none' };
    };
    return { id: row.dataset.quest, cam: one(row.querySelector('.apx-cam')), lib: one(row.querySelector('.apx-lib')) };
  });
  const okIcon = (b, kind, re) => b && b.icon === kind && b.shown && b.aria === 'true' && b.text === '' && re.test(b.label) && b.w >= 44 && b.h >= 44 && b.inside && b.iw >= 28;
  const d = (b) => (b ? `${b.icon || '沒有圖示'}、${b.w}×${b.h}、圖 ${b.iw}、字「${b.text}」、讀「${b.label}」` : '沒找到');
  yes(!!ic && okIcon(ic.cam, 'cam', /^(拍照|再拍一張)$/) && okIcon(ic.lib, 'lib', /^從相簿選$/),
    `${tag} I1 任務列兩顆：相機／相簿圖示、不是表情符號、觸控 ≥ 44、讀螢幕的字照舊（拍照：${d(ic && ic.cam)}；相簿：${d(ic && ic.lib)}）`);

  // 展開那一列（點任務標題那一行）→ 兩顆有字的按鈕
  let big = null;
  if (ic) {
    const head = await page.$(`.qline[data-quest="${ic.id}"] .qline-head`);
    const hit = await userClick(page, head, '任務標題那一行');
    if (!hit.ok) console.log('  [點不到]', hit.why);
    if (hit.ok && await soft(page.waitForSelector(`.qline[data-quest="${ic.id}"].open .addphoto-row .btn`, { timeout: 8000 }))) {
      await sleep(400);
      big = await page.evaluate((id) => [...document.querySelectorAll(`.qline[data-quest="${id}"] .addphoto-row .btn`)].map((b) => {
        const r = b.getBoundingClientRect(), s = b.querySelector('svg.gl-icon'), sr = s && s.getBoundingClientRect();
        const words = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        const range = document.createRange();
        const tn = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        let textLeft = null, lines = 0;
        if (tn) { range.selectNodeContents(tn); textLeft = range.getBoundingClientRect().left; lines = range.getClientRects().length; }
        return { icon: s ? s.getAttribute('data-icon') : null, words, h: Math.round(r.height), iw: sr ? Math.round(sr.width) : 0,
          before: !!sr && textLeft != null && sr.right <= textLeft + 1, lines };
      }), ic.id);
    }
  }
  // 字一行：390 寬時舊版（表情符號）兩顆都是一行、高 56；圖示 28 的第一版把「從相簿選」擠成兩行、高 87（2026-11-13 截圖量到）
  const okBig = (b, kind, re) => b && b.icon === kind && re.test(b.words) && b.h >= 44 && b.iw >= 20 && b.before && b.lines === 1;
  const db = (b) => (b ? `${b.icon || '沒有圖示'}＋「${b.words}」、高 ${b.h}、圖 ${b.iw}、圖在字左邊 ${b.before}、字 ${b.lines} 行` : '沒找到');
  yes(!!big && big.length === 2 && okBig(big[0], 'cam', /^(拍照|再拍一張)$/) && okBig(big[1], 'lib', /^從相簿選/),
    `${tag} I1 展開後兩顆：圖示＋字、圖在字左邊、高 ≥ 44、390 寬時字不被擠成兩行（${big ? big.map(db).join('；') : '沒展開'}）`);
}

async function newPage(ctx) {
  await ctx.overridePermissions(ORIGIN, ['geolocation']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844 });
  await page.setGeolocation(GPS);
  return page;
}

// 造行程：用內建景點庫出任務（跟使用者從清單選景點一樣走 generateForTrip）
const makeTrip = (page, title, start, end, region, names) => page.evaluate(async (ttl, s0, e0, rg, ns) => {
  const s = await import('./js/store.js');
  const { uuid } = await import('./js/ids.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const g = uuid(), t = uuid(), m = uuid();
  await s.put({ id: g, type: 'group', name: 'g' });
  await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
  await s.put({ id: t, type: 'trip', groupId: g, title: ttl, region: rg, allowWiki: false, startDate: s0, endDate: e0 });
  const { spots, quests } = await generateForTrip({ tripId: t, region: rg, items: ns.map((name) => ({ name, region: rg, day: 1 })) });
  for (const x of spots) await s.put(x);
  for (const x of quests) await s.put(x);
  return spots.map((x) => `${x.name}:${x.source}`);
}, title, start, end, region, names);

async function washiRound() {
  console.log('\n— 和紙（I1、A2）—');
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  const wxUrls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (/^(http:\/\/localhost[:/]|data:|blob:)/.test(u)) { req.continue().catch(() => {}); return; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/.test(u)) {
      wxUrls.push(u);
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeForecast()) }).catch(() => {});
      return;
    }
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero');
    const made = await makeTrip(page, '拍照圖示測試', plus(0), plus(1), '宜蘭', ['頭城老街']);
    yes(made.length === 1 && made[0].endsWith(':curated'), `前置：那一站對上內建景點庫（${made.join('、')}）`);

    // 首頁 → 點旅程卡 → 等天氣條出來（天氣條會查一次出發地＝手機的定位）
    await page.evaluate(() => localStorage.removeItem('tripquest.wx'));
    let opened = await toHome(page) && await tap(page, '.trip-card', '拍照圖示測試');
    opened = opened && await soft(page.waitForSelector('.wx-strip .wx-strip-tip', { timeout: 20000 }));
    if (!opened) console.log('  [等不到天氣條]');
    await sleep(500);

    // ---- I1 拍照圖示（和紙）：v1.84.0 起天氣條在主頁、任務在「任務」分頁——點過去看任務列 ----
    await toTasks(page);
    await photoButtons(page, '［和紙］');

    // ---- A2 回主頁、點天氣條進天氣頁 ----
    const back = opened && await tap(page, '#tabbar a.tab', '主頁') && await soft(page.waitForSelector('.trip-home .wx-strip', { timeout: 20000 }));
    const w = back && await tap(page, '.wx-strip', '') && await soft(page.waitForSelector('.wx-advice', { timeout: 20000 }));
    const base = await page.evaluate(() => document.querySelector('.wx-advice .form-hint')?.textContent || '');
    yes(w && /你的位置/.test(base), `A2 前置：天氣頁的比較基準是手機的定位（「${base}」）`);
    // 座標在合成定位附近的請求，全部只能是小數 2 位；至少要有一個（前置證明定位真的用上了，不然 0 個也會「全部是小數 2 位」）
    const near = wxUrls.map((u) => new URL(u).searchParams).map((q) => ({ lat: q.get('latitude'), lng: q.get('longitude') }))
      .filter((c) => Math.abs(+c.lat - GPS.latitude) < 0.05 && Math.abs(+c.lng - GPS.longitude) < 0.05);
    yes(near.length >= 1 && near.every((c) => c.lat === '23.46' && c.lng === '120.99'),
      `A2 送給 Open-Meteo 的出發地座標只剩小數 2 位（定位給 ${GPS.latitude}, ${GPS.longitude}；送出去的 ${near.map((c) => `${c.lat},${c.lng}`).join('／') || '沒有'}；天氣請求共 ${wxUrls.length} 個）`);
  } catch (e) {
    yes(false, `［和紙］ 例外：${e && e.stack || e}`);
  } finally {
    await ctx.close();
  }
}

async function darkRound() {
  console.log('\n— 深色（I1）—');
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (/^(http:\/\/localhost[:/]|data:|blob:)/.test(u)) { req.continue().catch(() => {}); return; }
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero');
    await tap(page, 'a.tab', '設定');
    await soft(page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('.theme-seg'), { timeout: 15000 }));
    await tap(page, '.theme-seg button', '深色');
    await soft(page.waitForFunction(() => document.documentElement.dataset.theme === undefined, { timeout: 5000 }));
    const attr = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
    yes(attr === null, `［深色］ 前置：這一輪真的是深色（data-theme=${attr}）`);
    await makeTrip(page, '深色圖示測試', plus(0), plus(1), '宜蘭', ['頭城老街']);
    await toHome(page);
    await tap(page, '.trip-card', '深色圖示測試');
    await soft(page.waitForSelector('.trip-home', { timeout: 15000 }));
    await toTasks(page);
    await sleep(500);
    await photoButtons(page, '［深色］');
  } catch (e) {
    yes(false, `［深色］ 例外：${e && e.stack || e}`);
  } finally {
    await ctx.close();
  }
}

try {
  await washiRound();
  await darkRound();
  console.log('\n拍照圖示測試結束');
} catch (e) {
  yes(false, '例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
