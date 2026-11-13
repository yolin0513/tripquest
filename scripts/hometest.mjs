// 主頁與回顧搬家（v1.84.0）從使用者的入口驗（npm run hometest；會開瀏覽器）
//
// 涵蓋的程式：js/app.js（底部分頁、返回規則）、js/views/trip.js（itinerary() 的回顧卡 memoriesCard）、css/style.css（.itin-mem、.info-fold）
// 來由：Yolin 2026-11-13「可以 都照建議做」＝docs/DESIGN_主頁規劃.md 第 5 節（示意圖 4、5、6）。
//
//   R 回顧搬進「行程」分頁（示意圖 6）：底部分頁沒有「回顧」；出發前／旅程中回顧是最下面一列；結束日過了排到最上面、
//     旅途資訊收成一列放最下面；只看結束日（全部拍完但還沒結束不換、沒設結束日不換）；
//     點了進回顧頁、底部亮「行程」、返回鍵回行程分頁
//
// 走使用者的路：首頁點旅程卡 → 底部分頁 → 行程分頁裡的那一列／那張卡；不直接 goto 子頁。
// 不打真網路（共用慣例 §5.6）：外站請求一律當場回 503。
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5831;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const soft = (p) => p.then(() => true, () => false);
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

// 旅程層的底部分頁（照順序）
const TRIP_TABS = ['任務', '行程', '照片', '分帳'];

async function toHome(page) {
  for (let k = 0; k < 4; k++) {
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
  return soft(page.waitForFunction(() => (location.hash === '#/' || location.hash === '') && document.querySelector('.trip-card'), { timeout: 15000 }));
}

// 首頁點旅程卡進去（進去落在哪一頁由 app 決定，這裡只等網址換成這一趟）
async function openTrip(page, title) {
  if (!await toHome(page)) return false;
  if (!await tap(page, '.trip-card', title)) return false;
  return soft(page.waitForFunction(() => /^#\/trip\/[^/]+/.test(location.hash) && document.querySelector('#view .page'), { timeout: 15000 }));
}
async function tabTo(page, name, sel) {
  if (!await tap(page, '#tabbar .tab', name)) return false;
  return soft(page.waitForSelector(sel, { timeout: 15000 }));
}
const tabState = (page) => page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')]
  .map((a) => ({ name: a.textContent.replace(/[^一-龥]/g, ''), on: a.classList.contains('active') })));

// 行程分頁上回顧的位置：回顧卡／那一列在每天的行程前面還是後面、旅途資訊在哪
const itinLayout = (page) => page.evaluate(() => {
  const pg = document.querySelector('.itin-page');
  if (!pg) return null;
  const days = [...pg.querySelectorAll('.daycollapse')];
  const first = days[0], last = days[days.length - 1];
  const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const top = pg.querySelector('.itin-mem');
  const rows = [...pg.querySelectorAll('.itin-mem-row')].filter((r) => !r.closest('.itin-mem'));
  const info = pg.querySelector('.info-card');
  const fold = info && info.closest('details.info-fold');
  return {
    days: days.length,
    top: !!top, topBeforeDays: before(top, first),
    topCards: top ? [...top.querySelectorAll('.mem-card .mem-card-title')].map((x) => x.textContent) : [],
    rows: rows.length, rowAfterDays: rows.length === 1 && before(last, rows[0]), rowText: rows[0] ? rows[0].textContent : '',
    infoFold: !!fold, infoBeforeDays: before(info, first), infoAfterDays: before(last, info),
    infoRows: info ? info.querySelectorAll('.info-row').length : 0,
  };
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith(ORIGIN) ? r.continue() : r.respond({ status: 503, contentType: 'text/plain', body: '' })));
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero', { timeout: 20000 });

  // 四趟：旅程中、旅程中但全部拍完、已經結束、沒設結束日（地點都是內建景點庫的，任務照內建資料出）
  await page.evaluate(async (D) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const g = uuid(), m = uuid();
    await s.put({ id: g, type: 'group', name: 'g' });
    await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
    const mk = async (title, startDate, endDate, items, done) => {
      const t = uuid();
      await s.put({ id: t, type: 'trip', groupId: g, title, region: '台北', allowWiki: false, startDate, ...(endDate ? { endDate } : {}) });
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items });
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
      if (done) for (const q of quests) await s.put({ id: uuid(), type: 'submission', tripId: t, questId: q.id, memberId: m, photoHash: 'h', createdAt: Date.now() });
    };
    await mk('R旅程中', D.m1, D.p1, [{ name: '龍山寺', day: 1 }, { name: '台北101', day: 2 }, { name: '士林夜市', day: 3 }], false);
    await mk('R全部拍完', D.m1, D.p1, [{ name: '中正紀念堂', day: 1 }, { name: '永康街', day: 2 }], true);
    await mk('R已結束', D.m10, D.m9, [{ name: '象山', day: 1 }, { name: '龍山寺', day: 2 }], false);
    await mk('R沒結束日', D.m1, null, [{ name: '台北101', day: 1 }, { name: '士林夜市', day: 2 }], false);
  }, { m1: plus(-1), p1: plus(1), m10: plus(-10), m9: plus(-9) });

  // ================= R 回顧搬進「行程」分頁 =================
  console.log('\n— R 回顧搬進「行程」分頁 —');
  // R旅程中：底部分頁、最下面一列、點進去、返回
  let ok = await openTrip(page, 'R旅程中');
  const tabs = ok ? await tabState(page) : [];
  yes(tabs.map((x) => x.name).join('、') === TRIP_TABS.join('、') && !tabs.some((x) => x.name === '回顧'),
    `R1 旅程層的底部分頁是「${TRIP_TABS.join('、')}」、沒有「回顧」（讀到：${tabs.map((x) => x.name).join('、') || '沒讀到'}）`);
  ok = ok && await tabTo(page, '行程', '.itin-page');
  let L = ok ? await itinLayout(page) : null;
  yes(!!L && L.days >= 1 && !L.top && L.rows === 1 && L.rowAfterDays && L.infoBeforeDays && !L.infoFold,
    `R2 旅程中：回顧是最下面一列（在每天的行程後面）、上面沒有回顧卡、旅途資訊照舊在最上面（${JSON.stringify(L)}）`);
  yes(!!L && /回顧與成就/.test(L.rowText) && /影片與最終回顧旅程結束後開放/.test(L.rowText),
    `R3 旅程中那一列寫「回顧與成就」與「影片與最終回顧旅程結束後開放」（「${L ? L.rowText : '沒讀到'}」）`);
  ok = ok && await tap(page, '.itin-mem-row', '回顧與成就');
  ok = ok && await soft(page.waitForFunction(() => /\/memories$/.test(location.hash) && document.querySelector('.mem-card'), { timeout: 15000 }));
  const memTabs = ok ? await tabState(page) : [];
  const memCards = ok ? await page.evaluate(() => [...document.querySelectorAll('.mem-card .mem-card-title')].map((x) => x.textContent)) : [];
  yes(ok && memCards.includes('成就徽章') && memCards.includes('回憶影片與相簿') && memTabs.find((x) => x.on)?.name === '行程',
    `R8 點那一列進到回顧頁（卡片：${memCards.join('、') || '沒讀到'}）、底部亮的是「行程」（${memTabs.filter((x) => x.on).map((x) => x.name).join('、') || '沒有'}）`);
  const hb = ok ? await userClick(page, await page.$('#backBtn'), '頁首的返回鍵') : { ok: false };
  const backTo = hb.ok && await soft(page.waitForFunction(() => /\/itinerary$/.test(location.hash) && document.querySelector('.itin-page'), { timeout: 15000 }));
  yes(backTo, `R9 回顧頁按返回 → 回到行程分頁（${await page.evaluate(() => location.hash.replace(/[A-Za-z0-9-]{20,}/, '…'))}）`);

  // R全部拍完：還沒結束就不換位置
  ok = await openTrip(page, 'R全部拍完');
  ok = ok && await tabTo(page, '行程', '.itin-page');
  L = ok ? await itinLayout(page) : null;
  yes(!!L && !L.top && L.rows === 1 && L.rowAfterDays && /回憶影片可以做了/.test(L.rowText),
    `R4 全部拍完但旅程還沒結束：回顧照樣在最下面一列（不排到最上面）、寫「回憶影片可以做了」（${JSON.stringify(L)}）`);

  // R已結束：排到最上面、旅途資訊收成一列放最下面
  ok = await openTrip(page, 'R已結束');
  ok = ok && await tabTo(page, '行程', '.itin-page');
  L = ok ? await itinLayout(page) : null;
  const want = ['回憶影片與相簿', '最終回顧', '行程海報'];
  yes(!!L && L.top && L.topBeforeDays && want.every((w) => L.topCards.includes(w)) && L.rows === 0,
    `R5 結束日過了：回顧卡排在最上面（在每天的行程前面）、三張成品卡（${JSON.stringify(L && { top: L.top, topBeforeDays: L.topBeforeDays, topCards: L.topCards, rows: L.rows })}）`);
  // 收起來時看不到三列；點那一列打開才看得到（使用者的路）。
  // 看不看得到用 checkVisibility()：新版 Chrome 收起來的 <details> 內容是 content-visibility:hidden，getClientRects 照樣有框（第一次跑撞到）
  const shut = ok ? await page.evaluate(() => { const i = document.querySelector('.info-fold .info-row'); return !!i && !i.closest('details').open && !i.checkVisibility(); }) : false;
  const opened = ok && await tap(page, '.info-fold-sum', '旅途資訊');
  const vis = opened ? await page.evaluate(() => [...document.querySelectorAll('.info-fold .info-row')].filter((r) => r.checkVisibility()).map((r) => r.textContent)) : [];
  yes(!!L && L.infoFold && L.infoAfterDays && !L.infoBeforeDays && shut && vis.length === 3,
    `R6 結束日過了：旅途資訊收成一列放最下面（在每天的行程後面、預設收著 ${shut}）、點開看得到三列（${vis.join('／') || '沒有'}）`);
  const toAlbum = ok && await tap(page, '.itin-mem .mem-card', '回憶影片與相簿')
    && await soft(page.waitForFunction(() => /\/album$/.test(location.hash), { timeout: 15000 }));
  const albumTabs = toAlbum ? await tabState(page) : [];
  yes(toAlbum && albumTabs.find((x) => x.on)?.name === '行程',
    `R10 結束後點「回憶影片與相簿」到相簿頁、底部亮的是「行程」（${albumTabs.filter((x) => x.on).map((x) => x.name).join('、') || '沒到或沒有'}）`);

  // R沒結束日：不換位置
  ok = await openTrip(page, 'R沒結束日');
  ok = ok && await tabTo(page, '行程', '.itin-page');
  L = ok ? await itinLayout(page) : null;
  yes(!!L && !L.top && L.rows === 1 && L.rowAfterDays && L.infoBeforeDays,
    `R7 沒設結束日：回顧一直在最下面一列（${JSON.stringify(L && { top: L.top, rows: L.rows, rowAfterDays: L.rowAfterDays })}）`);

  console.log('\n主頁與回顧測試結束');
} catch (e) {
  console.log('✗ 例外：' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
