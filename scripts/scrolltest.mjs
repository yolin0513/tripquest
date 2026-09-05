// 旅程頁的折疊預設值 + 自動捲到今天（npm run scrolltest）
//
// 規則：
//   天    —— 進行中只展開今天；還沒出發展開第 1 天；已結束全收
//   景點  —— 還沒完成的展開、完成的收起
//   兩者的使用者手動選擇都優先（存 localStorage）
//   自動捲動 —— 只在進行中、今天那列看不到、且不是按返回進來時才動；設定可關；
//              尊重「減少動態效果」
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5199;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ok = (m) => console.log('✓ ' + m);
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

async function device({ reduceMotion = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 780 });
  if (reduceMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.evaluateOnNewDocument(() => {
    window.__scrolls = [];
    window.addEventListener('scroll', () => window.__scrolls.push(Math.round(window.scrollY)), { passive: true });
  });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  return { ctx, page };
}

// startOffset：出發日相對今天差幾天（-1 = 昨天出發 → 今天是第 2 天）
// complete：[[天, 景點索引], …] 這些景點的任務全部完成
// 刻意不給座標，天氣條就不會出現，測試才不用連外網
async function seed(page, { startOffset, dayCount, spotsPerDay = 2, complete = [] }) {
  return page.evaluate(async (cfg) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const iso = (d) => {
      const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + d);
      const p = (n) => String(n).padStart(2, '0');
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    };
    const gid = uuid(), tid = uuid(), mid = uuid();
    await s.put({ id: gid, type: 'group', name: '捲動測試' });
    await s.put({ id: mid, type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({
      id: tid, type: 'trip', groupId: gid, title: '捲動測試', allowWiki: false,
      startDate: iso(cfg.startOffset), endDate: iso(cfg.startOffset + cfg.dayCount - 1),
    });
    const made = [];
    for (let d = 1; d <= cfg.dayCount; d++) {
      for (let k = 0; k < cfg.spotsPerDay; k++) {
        const sid = uuid();
        await s.put({ id: sid, type: 'spot', tripId: tid, name: `第${d}天景點${k + 1}`, day: d, order: k, emoji: '📍' });
        made.push({ sid, d, k });
        for (let q = 0; q < 3; q++) {
          await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: `D${d}S${k + 1}任務${q + 1}`, kind: 'thing', order: q });
        }
      }
    }
    for (const { sid, d, k } of made) {
      if (!cfg.complete.some(([cd, ck]) => cd === d && ck === k)) continue;
      for (const q of s.questsOf(sid)) {
        await s.addSubmission({ tripId: tid, questId: q.id, memberId: mid, photoHash: 'p' + q.id, thumbHash: 't' + q.id, takenAt: Date.now(), caption: '' });
      }
    }
    return tid;
  }, { startOffset, dayCount, spotsPerDay, complete });
}

async function openTrip(page, tid) {
  await page.goto('about:blank');
  await page.evaluate(() => { window.__scrolls = []; }).catch(() => {});
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse');
  await sleep(1400);                       // 天氣 race 700ms + 捲動動畫 320ms，留餘裕
}

const snapshot = (page) => page.evaluate(() => ({
  days: [...document.querySelectorAll('.daycollapse')].map((el) => ({ day: +el.dataset.day, open: el.classList.contains('open') })),
  spots: [...document.querySelectorAll('.qcollapse')].map((el) => ({
    name: el.querySelector('.qc-name')?.firstChild?.textContent || '',
    done: /完成/.test(el.querySelector('.qc-prog')?.textContent || ''),
    open: el.classList.contains('open'),
  })),
  scrollY: Math.round(window.scrollY),
  scrolls: (window.__scrolls || []).length,
  reduceMotion: document.documentElement.classList.contains('reduce-motion'),
}));

const openDays = (s) => s.days.filter((d) => d.open).map((d) => d.day);

try {
  // ================= A. 旅程進行中（昨天出發 → 今天是第 2 天）=================
  const A = await device();
  const tidA = await seed(A.page, { startOffset: -1, dayCount: 3 });
  await openTrip(A.page, tidA);
  const a = await snapshot(A.page);

  if (JSON.stringify(openDays(a)) === '[2]') ok('進行中：只展開今天（第 2 天），其他天收合');
  else fail('進行中展開的天數不對：' + JSON.stringify(openDays(a)));

  if (a.spots.length === 6 && a.spots.every((x) => x.open)) ok('沒完成的景點全部展開');
  else fail('景點展開狀態不對：' + JSON.stringify(a.spots));

  // 自動捲動：今天那列本來在畫面外，應該被帶到頂列下方
  const pos = await A.page.evaluate(() => {
    const head = document.querySelector('.daycollapse[data-day="2"] .dc-head');
    const topH = document.getElementById('topbar').offsetHeight;
    return { top: Math.round(head.getBoundingClientRect().top), topH: Math.round(topH), y: Math.round(window.scrollY) };
  });
  if (pos.y > 100) ok(`進行中：自動捲到今天（捲了 ${pos.y}px）`);
  else fail('沒有自動捲動：scrollY=' + pos.y);
  if (pos.top >= pos.topH - 4 && pos.top <= pos.topH + 40) ok(`停在「第 2 天」標題列（距頂列 ${pos.top - pos.topH}px），看得到自己在哪一天`);
  else fail(`停的位置不對：標題列 top=${pos.top}、頂列高 ${pos.topH}`);
  // 瀏覽器會合併 scroll 事件，取樣數不等於實際幀數；這裡只要能跟「一步到位」區分開就好
  if (a.scrolls >= 3) ok(`用平滑捲動（${a.scrolls} 次取樣）`);
  else fail('不像平滑捲動，取樣只有 ' + a.scrolls);

  // ================= B. 還沒出發 =================
  const B = await device();
  const tidB = await seed(B.page, { startOffset: 2, dayCount: 3 });
  await openTrip(B.page, tidB);
  const b = await snapshot(B.page);
  if (JSON.stringify(openDays(b)) === '[1]') ok('還沒出發：只展開第 1 天');
  else fail('還沒出發展開的天數不對：' + JSON.stringify(openDays(b)));
  if (b.scrollY === 0) ok('還沒出發：不自動捲動');
  else fail('還沒出發卻捲了：' + b.scrollY);

  // ================= C. 旅程已結束 =================
  const C = await device();
  const tidC = await seed(C.page, { startOffset: -6, dayCount: 3 });
  await openTrip(C.page, tidC);
  const c = await snapshot(C.page);
  if (openDays(c).length === 0) ok('已結束：所有天都收合');
  else fail('已結束卻有展開的天：' + JSON.stringify(openDays(c)));
  if (c.scrollY === 0) ok('已結束：不自動捲動');
  else fail('已結束卻捲了：' + c.scrollY);

  // ================= D. 完成的景點收合、沒完成的展開 =================
  const D = await device();
  const tidD = await seed(D.page, { startOffset: -1, dayCount: 3, complete: [[2, 0]] });
  await openTrip(D.page, tidD);
  const d = await snapshot(D.page);
  const doneSpot = d.spots.find((x) => x.done);
  const undoneToday = d.spots.filter((x) => !x.done && x.name.startsWith('第2天'));
  if (doneSpot && !doneSpot.open) ok(`完成的景點預設收合（${doneSpot.name}）`);
  else fail('完成的景點沒收合：' + JSON.stringify(doneSpot));
  if (undoneToday.length && undoneToday.every((x) => x.open)) ok('同一天還沒完成的景點仍然展開');
  else fail('沒完成的景點沒展開：' + JSON.stringify(undoneToday));

  // ================= E. 使用者手動的選擇優先 =================
  await D.page.evaluate(() => {
    document.querySelector('.daycollapse[data-day="1"] .dc-head').click();   // 手動展開第 1 天
    document.querySelector('.daycollapse[data-day="2"] .dc-head').click();   // 手動收合今天
  });
  await sleep(200);
  await openTrip(D.page, tidD);
  const e = await snapshot(D.page);
  if (JSON.stringify(openDays(e)) === '[1]') ok('重新進入：照使用者手動的選擇（展開第 1 天、收合今天）');
  else fail('沒有記住手動選擇：' + JSON.stringify(openDays(e)));

  // 手動展開一個「已完成」的景點，重進仍是展開的
  await D.page.evaluate(() => {
    const sec = [...document.querySelectorAll('.qcollapse')].find((el) => /完成/.test(el.querySelector('.qc-prog')?.textContent || ''));
    sec?.querySelector('.qc-toggle')?.click();
  });
  await sleep(200);
  await openTrip(D.page, tidD);
  const e2 = await snapshot(D.page);
  const reopened = e2.spots.find((x) => x.done);
  if (reopened && reopened.open) ok('手動展開的「已完成」景點，重進仍展開');
  else fail('手動展開沒被記住：' + JSON.stringify(reopened));

  // ================= E2. 「全部展開 / 全部收合」要兩層一起 =================
  const E2 = await device();
  const tidE2 = await seed(E2.page, { startOffset: -1, dayCount: 3, complete: [[1, 0]] });
  await openTrip(E2.page, tidE2);
  await E2.page.evaluate(() => [...document.querySelectorAll('.day-tool-btn')].find((b) => b.textContent.includes('全部展開')).click());
  await sleep(250);
  const allOpen = await snapshot(E2.page);
  if (allOpen.days.every((d) => d.open) && allOpen.spots.every((s) => s.open)) ok(`全部展開：${allOpen.days.length} 天、${allOpen.spots.length} 個景點都展開`);
  else fail('全部展開沒有兩層一起：' + JSON.stringify({ days: openDays(allOpen), spots: allOpen.spots.map((s) => s.open) }));

  await E2.page.evaluate(() => [...document.querySelectorAll('.day-tool-btn')].find((b) => b.textContent.includes('全部收合')).click());
  await sleep(250);
  const allShut = await snapshot(E2.page);
  if (allShut.days.every((d) => !d.open) && allShut.spots.every((s) => !s.open)) ok('全部收合：兩層都收合');
  else fail('全部收合沒有兩層一起：' + JSON.stringify({ days: openDays(allShut), spots: allShut.spots.map((s) => s.open) }));

  // 收合後重進，狀態要留著（不會被預設值蓋回去）
  await openTrip(E2.page, tidE2);
  const afterReload = await snapshot(E2.page);
  if (afterReload.days.every((d) => !d.open) && afterReload.spots.every((s) => !s.open)) ok('全部收合後重新進入：仍是收合的（沒有被預設值蓋掉）');
  else fail('全部收合的狀態沒留住：' + JSON.stringify({ days: openDays(afterReload), spots: afterReload.spots.map((s) => s.open) }));

  // 再單獨點開一個景點，只有它變（記憶不會互相污染）
  await E2.page.evaluate(() => {
    document.querySelector('.daycollapse[data-day="1"] .dc-head').click();
    document.querySelectorAll('.qcollapse')[0].querySelector('.qc-toggle').click();
  });
  await sleep(200);
  await openTrip(E2.page, tidE2);
  const oneOpen = await snapshot(E2.page);
  if (oneOpen.spots.filter((s) => s.open).length === 1 && oneOpen.spots[0].open) ok('全部收合後單獨點開一個景點：只有那一個是展開的');
  else fail('個別選擇被污染：' + JSON.stringify(oneOpen.spots.map((s) => s.open)));

  // ================= F. 按返回回來：不捲動、還原原本位置 =================
  const F = await device();
  const tidF = await seed(F.page, { startOffset: -1, dayCount: 3 });
  await openTrip(F.page, tidF);
  await F.page.evaluate(() => window.scrollTo(0, 1500));
  await sleep(300);
  const parked = await F.page.evaluate(() => Math.round(window.scrollY));
  await F.page.evaluate((tid) => { location.hash = `#/trip/${tid}/people`; }, tidF);
  await F.page.waitForSelector('.people-row');
  await sleep(400);
  await F.page.evaluate(() => history.back());
  await F.page.waitForSelector('.daycollapse');
  await sleep(1400);
  const f = await F.page.evaluate(() => Math.round(window.scrollY));
  if (Math.abs(f - parked) <= 40) ok(`按返回回到旅程頁：還原原本的位置（${parked} → ${f}），沒有自己亂跳`);
  else fail(`返回後位置跑掉：原本 ${parked}、回來 ${f}`);

  // 底部分頁繞一圈再回任務頁（任務→照片→分帳→任務）。這不會被 history 認成 back，
  // 但對使用者來說一樣是「回到剛剛那一頁」，不該又自己捲一次。
  await F.page.evaluate(() => window.scrollTo(0, 900));
  await sleep(300);
  const parked2 = await F.page.evaluate(() => Math.round(window.scrollY));
  await F.page.evaluate((tid) => { location.hash = `#/trip/${tid}/people`; }, tidF);
  await F.page.waitForSelector('.people-row');
  await sleep(300);
  await F.page.evaluate((tid) => { location.hash = `#/trip/${tid}/expenses`; }, tidF);
  await sleep(600);
  await F.page.evaluate((tid) => { location.hash = `#/trip/${tid}`; }, tidF);
  await F.page.waitForSelector('.daycollapse');
  await sleep(1400);
  const f2 = await F.page.evaluate(() => Math.round(window.scrollY));
  if (Math.abs(f2 - parked2) <= 40) ok(`底部分頁繞一圈回來：還原位置（${parked2} → ${f2}），沒有重新捲動`);
  else fail(`分頁切回來位置跑掉：原本 ${parked2}、回來 ${f2}`);

  // ================= G. 設定關掉就不捲 =================
  const G = await device();
  const tidG = await seed(G.page, { startOffset: -1, dayCount: 3 });
  await G.page.evaluate(async () => { (await import('./js/prefs.js')).setPref('autoScroll', false); });
  await openTrip(G.page, tidG);
  const g = await snapshot(G.page);
  if (g.scrollY === 0) ok('設定關掉「自動捲到今天」後就不捲了');
  else fail('關掉了還是捲：' + g.scrollY);

  // ================= H. 減少動態效果：直接跳，不做動畫 =================
  const H = await device({ reduceMotion: true });
  const tidH = await seed(H.page, { startOffset: -1, dayCount: 3 });
  await openTrip(H.page, tidH);
  const hh = await snapshot(H.page);
  if (hh.reduceMotion) ok('系統偏好「減少動態效果」有被讀到');
  else fail('沒偵測到 reduce-motion');
  if (hh.scrollY > 100) ok(`減少動態效果：還是會帶到今天（${hh.scrollY}px）`);
  else fail('reduce-motion 下沒捲動：' + hh.scrollY);
  if (hh.scrolls <= 2) ok(`減少動態效果：一步到位、沒有動畫（${hh.scrolls} 幀）`);
  else fail(`reduce-motion 下仍有動畫：${hh.scrolls} 幀`);

  console.log('\n折疊與自動捲動測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
