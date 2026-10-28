// 旅程頁的折疊預設值 + 自動捲到今天（npm run scrolltest）
//
// 規則：
//   天    —— v1.74.11 起一次只顯示一天（上方日期列）：進行中選今天；還沒出發、已結束都選第 1 天
//            （以前已結束是全收，一次只顯示一天之後全收就是空白）。新打開回到預設，返回才沿用手動點的那天
//   景點  —— 還沒完成的展開、完成的收起；使用者手動選擇優先（存 localStorage）
//   自動捲動 —— 只在進行中、要看的那一站被擋在畫面外、且不是按返回進來時才動；設定可關；
//              尊重「減少動態效果」。日期列黏在標題列下面，被它蓋住也算看不到
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5199;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

// 這一支量的是**動畫幀**，所以一定要把 headless 的節流關掉：預設情況下背景
// renderer 的 requestAnimationFrame 會被降頻，320ms 的動畫只跑得出 2–5 幀，
// 同時跑多個瀏覽器時更嚴重 —— 那是「不像平滑捲動」這條偽失敗的根源。
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
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
    // 分辨「動畫」與「一步到位」不能靠數 scroll 事件 —— 瀏覽器會合併它們，
    // 負載一高就只剩 1 次（實測單獨跑三次得到 5／3／1，門檻卡在雜訊上）。
    // 改成攔 window.scrollTo 數 **App 自己的呼叫**：js/ui.js 的 smoothScrollTo
    // 是 rAF 動畫（320ms、每幀一次），reduce-motion 那條路是單次呼叫。
    // 這個量測跟瀏覽器怎麼合併事件無關。
    window.__calls = [];
    const _scrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...a) => { window.__calls.push(Math.round(performance.now())); return _scrollTo(...a); };
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
  await page.evaluate(() => { window.__scrolls = []; window.__calls = []; }).catch(() => {});
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse');
  await sleep(1400);                       // 天氣 race 700ms + 捲動動畫 320ms，留餘裕
}

// 直接呼叫 js/ui.js 的 smoothScrollTo 並數它自己觸發的 window.scrollTo。
// 數 App 的呼叫而不是瀏覽器的 scroll 事件：後者會被瀏覽器合併，負載一高就只剩 1 次。
// expectInstant 只是用來讓訊息看得懂，判準兩邊一樣。
async function measureScroll(page, expectInstant) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const r = await page.evaluate(async () => {
    const { smoothScrollTo } = await import('./js/ui.js');
    window.__calls = [];
    smoothScrollTo(600);
    await new Promise((res) => setTimeout(res, 900));
    const t = window.__calls || [];
    let best = t.length ? 1 : 0, run = 1;
    for (let i = 1; i < t.length; i++) {
      run = t[i] - t[i - 1] < 100 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return { burst: best, calls: t.length, spanMs: t.length > 1 ? t[t.length - 1] - t[0] : 0, end: Math.round(window.scrollY) };
  });
  void expectInstant;
  return r;
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
  calls: (window.__calls || []).length,
  // 「連續快速呼叫的最長一串」才是動畫的指紋：rAF 的幀間距是 ~16ms，
  // 而各自獨立的單次捲動（例如 router 導航時的 scrollTo(0,0)）之間差上百毫秒。
  // 只看總次數或總跨度會被 router 那一次汙染。
  burst: (() => {
    const t = window.__calls || [];
    let best = t.length ? 1 : 0, run = 1;
    for (let i = 1; i < t.length; i++) {
      run = t[i] - t[i - 1] < 100 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  })(),
  reduceMotion: document.documentElement.classList.contains('reduce-motion'),
}));

const openDays = (s) => s.days.filter((d) => d.open).map((d) => d.day);

try {
  // ================= A. 旅程進行中（昨天出發 → 今天是第 2 天）=================
  // v1.74.11 起一次只顯示一天（上方日期列）。「自動捲到今天」對應成兩步：
  //   ① 日期列自動選中今天那一格（不必捲，日期列一直看得到）
  //   ② 那一天的時間軸裡，「現在這一站」在畫面外 → 捲到看得到它
  const A = await device();
  const tidA = await seed(A.page, { startOffset: -1, dayCount: 3, spotsPerDay: 6 });
  await openTrip(A.page, tidA);
  const a = await snapshot(A.page);

  if (JSON.stringify(openDays(a)) === '[2]') ok('進行中：只顯示今天（第 2 天），其他天藏起來');
  else fail('進行中顯示的天數不對：' + JSON.stringify(openDays(a)));
  const stripA = await A.page.evaluate(() => {
    const track = document.querySelector('.daystrip .ds-track');
    const tr = track && track.getBoundingClientRect();
    return [...document.querySelectorAll('.daystrip .ds-day')].map((c) => {
      const r = c.getBoundingClientRect();
      return { day: +c.dataset.day, on: c.classList.contains('on'), today: c.classList.contains('is-today'),
        inView: !!tr && r.left >= tr.left - 1 && r.right <= tr.right + 1 && r.top >= 0 };
    });
  });
  if (stripA.length === 3 && stripA.filter((c) => c.on).map((c) => c.day).join() === '2' && stripA.find((c) => c.day === 2).today && stripA.find((c) => c.day === 2).inView)
    ok('進行中：日期列三天都在、自動選中今天（第 2 天）那一格、標著今天、而且在日期列看得到的範圍裡');
  else fail('日期列不對：' + JSON.stringify(stripA));

  // v1.42：只展開「現在這一站」（今天第一個未完成的），不再把當天全部未完成的打開 ——
  // 使用者實機回報「第二天的全部任務都是展開的」就是舊行為造成的
  const openNames = a.spots.filter((x) => x.open).map((x) => x.name);
  if (a.spots.length === 18 && openNames.length === 1 && openNames[0] === '第2天景點1') {
    ok(`只展開今天第一個未完成的景點（${openNames[0]}），其他收合`);
  } else fail('景點展開狀態不對：' + JSON.stringify(a.spots));

  // ②：現在這一站指定成今天「第一個在畫面外的站」→ 要捲到看得到它。
  // 不用最後一站：2026-10-28 時間軸改窄、頁面變矮之後，最後一站捲不到日期列下面（被文件底卡住，
  // scrollY 停在最大值），停的位置剛好跟正確答案一樣，「沒把日期列算進去」那條突變就紅不起來了。
  await A.page.evaluate(async (t) => {
    const s = await import('./js/store.js');
    const ids = new Set(s.spotsOf(t).filter((x) => x.day === 2).map((x) => x.id));
    const secs = [...document.querySelectorAll('.daycollapse.open .qcollapse')].filter((x) => ids.has(x.dataset.spot));
    const pick = secs.find((x) => x.getBoundingClientRect().top + window.scrollY > window.innerHeight + 40) || secs[secs.length - 1];
    await s.setHereSpot(t, pick.dataset.spot, null);
  }, tidA);
  await openTrip(A.page, tidA);
  const pos = await A.page.evaluate(() => {
    const sec = [...document.querySelectorAll('.daycollapse.open .qcollapse')].find((x) => x.classList.contains('is-here'));
    const head = sec && sec.querySelector('.qc-head');
    const stripB = document.querySelector('.daystrip').getBoundingClientRect().bottom;
    const tabH = document.getElementById('tabbar').offsetHeight;
    const r = head ? head.getBoundingClientRect() : null;
    const dh = document.querySelector('.daycollapse.open .dc-head');
    const d = dh ? dh.getBoundingClientRect() : null;
    return { has: !!head, top: r ? Math.round(r.top) : null, bottom: r ? Math.round(r.bottom) : null,
      dayTop: d ? Math.round(d.top) : null, dayBottom: d ? Math.round(d.bottom) : null,
      topbarH: document.getElementById('topbar').offsetHeight,
      maxY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      docTop: r ? Math.round(r.top + window.scrollY) : null,
      stripB: Math.round(stripB), limit: Math.round(window.innerHeight - tabH), vh: window.innerHeight, y: Math.round(window.scrollY) };
  });
  // 前置：那一站在文件裡的位置真的在第一個畫面以下（否則「有捲」證明不了什麼）
  if (pos.has && pos.docTop > pos.vh) ok(`前置：現在這一站在第一個畫面以下（文件位置 ${pos.docTop}px > 畫面高 ${pos.vh}px）`);
  else fail('前置不成立：現在這一站本來就在第一個畫面裡，或找不到它：' + JSON.stringify(pos));
  // 前置：沒被文件底卡住（卡住的話停在哪裡由頁面長度決定，不是由 App 算的目標決定，下一條就驗不到東西）
  if (pos.y < pos.maxY - 4) ok(`前置：捲動沒有被文件底卡住（scrollY ${pos.y} < 最大 ${pos.maxY}）`);
  else fail(`前置不成立：捲到文件底了（scrollY ${pos.y}、最大 ${pos.maxY}），停的位置驗不出 App 算得對不對`);
  if (pos.y > 100) ok(`進行中：自動捲到現在這一站（捲了 ${pos.y}px）`);
  else fail('沒有自動捲動：scrollY=' + pos.y);
  if (pos.top >= pos.stripB - 4 && pos.bottom <= pos.limit) ok(`停的位置看得到那一站：在日期列下面、底部分頁上面（top ${pos.top}、日期列底 ${pos.stripB}、可見下緣 ${pos.limit}）`);
  else fail(`停的位置不對（被日期列蓋住或在畫面外）：${JSON.stringify(pos)}`);
  // App 捲的目標有兩種：天的標題（那一站跟著看得到時）或那一站本身。上一條只驗那一站，
  // 捲到天的標題時被日期列蓋住的是天的標題——要嘛完整露出在日期列下面，要嘛整個捲過標題列上面。
  if (pos.dayTop !== null && (pos.dayTop >= pos.stripB - 4 || pos.dayBottom <= pos.topbarH + 2)) ok(`天的標題列沒被日期列蓋住（top ${pos.dayTop}、日期列底 ${pos.stripB}）`);
  else fail(`天的標題列被日期列蓋住：${JSON.stringify(pos)}`);  // 判準是「App 呼叫了 window.scrollTo 幾次、跨了多久」，不是 scroll 事件的取樣數
  //（後者會被瀏覽器合併，負載一高就只剩 1 次 —— 那是 v1.73.2 之前的偽失敗來源）。
  // smoothScrollTo 是 320ms 的 rAF 動畫，一定不只一次呼叫、一定跨得過 0 毫秒。
  // 「捲動是平滑的」要在頁面靜下來之後量：開頁當下 smoothScrollTo 的第一個 rAF
  // 常常已經超過 320ms 的動畫長度，p 直接等於 1、動畫塌成單幀 —— 那不是產品問題，
  // 是量測時機不對（v1.73.2 之前這條靠數 scroll 事件，偽失敗率約 1/3）。
  const smooth = await measureScroll(A.page, false);
  if (smooth.burst >= 3) ok(`用平滑捲動（連續 ${smooth.burst} 幀、跨 ${smooth.spanMs}ms）`);
  else fail(`不像平滑捲動：最長連續 ${smooth.burst} 幀、跨 ${smooth.spanMs}ms`);

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
  // v1.74.11：以前是全部收合；一次只顯示一天之後收合就是空白，改成從第 1 天看起
  if (JSON.stringify(openDays(c)) === '[1]') ok('已結束：顯示第 1 天（不是一片空白）');
  else fail('已結束顯示的天數不對：' + JSON.stringify(openDays(c)));
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
  const openToday = undoneToday.filter((x) => x.open);
  if (openToday.length === 1) ok(`同一天只展開第一個還沒完成的（${openToday[0].name}），其餘收合`);
  else fail('同一天展開的數量不對：' + JSON.stringify(undoneToday));

  // ================= E. 使用者手動的選擇優先 =================
  // v1.74.11：點日期列換天當場生效；但「新打開這趟行程」是「帶我到今天」，一律回到今天
  //（返回才沿用剛剛點的那天，那條在 collapsetest 驗）
  await D.page.evaluate(() => document.querySelector('.daystrip .ds-day[data-day="1"]').click());
  await sleep(200);
  const e0 = await snapshot(D.page);
  if (JSON.stringify(openDays(e0)) === '[1]') ok('點日期列的第 1 天：當場換成顯示第 1 天');
  else fail('點日期列沒換天：' + JSON.stringify(openDays(e0)));
  await openTrip(D.page, tidD);
  const e = await snapshot(D.page);
  if (JSON.stringify(openDays(e)) === '[2]') ok('新打開這趟行程：回到今天（第 2 天），不沿用上次點的第 1 天');
  else fail('新打開沒有回到今天：' + JSON.stringify(openDays(e)));

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

  // ================= E2. 「全部展開 / 全部收合」 =================
  // v1.74.11 起只管景點：天一次只顯示一天，不再跟著展開／收合（收合天就是空白）
  const E2 = await device();
  const tidE2 = await seed(E2.page, { startOffset: -1, dayCount: 3, complete: [[1, 0]] });
  await openTrip(E2.page, tidE2);
  await E2.page.evaluate(() => [...document.querySelectorAll('.day-tool-btn')].find((b) => b.textContent.includes('全部展開')).click());
  await sleep(250);
  const allOpen = await snapshot(E2.page);
  if (JSON.stringify(openDays(allOpen)) === '[2]' && allOpen.spots.every((s) => s.open)) ok(`全部展開：${allOpen.spots.length} 個景點都展開，天照樣只顯示今天`);
  else fail('全部展開不對：' + JSON.stringify({ days: openDays(allOpen), spots: allOpen.spots.map((s) => s.open) }));

  await E2.page.evaluate(() => [...document.querySelectorAll('.day-tool-btn')].find((b) => b.textContent.includes('全部收合')).click());
  await sleep(250);
  const allShut = await snapshot(E2.page);
  if (JSON.stringify(openDays(allShut)) === '[2]' && allShut.spots.every((s) => !s.open)) ok('全部收合：景點都收合，今天那一天照樣看得到（不是空白）');
  else fail('全部收合不對：' + JSON.stringify({ days: openDays(allShut), spots: allShut.spots.map((s) => s.open) }));

  // 收合後重進，狀態要留著（不會被預設值蓋回去）
  await openTrip(E2.page, tidE2);
  const afterReload = await snapshot(E2.page);
  if (afterReload.spots.every((s) => !s.open)) ok('全部收合後重新進入：景點仍是收合的（沒有被預設值蓋掉）');
  else fail('全部收合的狀態沒留住：' + JSON.stringify({ days: openDays(afterReload), spots: afterReload.spots.map((s) => s.open) }));

  // 再單獨點開一個景點，只有它變（記憶不會互相污染）
  await E2.page.evaluate(() => {
    document.querySelector('.daystrip .ds-day[data-day="1"]').click();
    document.querySelectorAll('.qcollapse')[0].querySelector('.qc-toggle').click();
  });
  await sleep(200);
  await openTrip(E2.page, tidE2);
  const oneOpen = await snapshot(E2.page);
  if (oneOpen.spots.filter((s) => s.open).length === 1 && oneOpen.spots[0].open) ok('全部收合後單獨點開一個景點：只有那一個是展開的');
  else fail('個別選擇被污染：' + JSON.stringify(oneOpen.spots.map((s) => s.open)));

  // ================= F. 按返回回來：不捲動、還原原本位置 =================
  const F = await device();
  // 一次只顯示一天（v1.74.11）之後頁面變短：每天 6 站才捲得到 1500
  const tidF = await seed(F.page, { startOffset: -1, dayCount: 3, spotsPerDay: 6 });
  await openTrip(F.page, tidF);
  await F.page.evaluate(() => window.scrollTo(0, 1500));
  await sleep(300);
  const parked = await F.page.evaluate(() => Math.round(window.scrollY));
  await F.page.evaluate((tid) => { location.hash = `#/trip/${tid}/people`; }, tidF);
  await F.page.waitForSelector('.wall-modes, .empty');
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
  await F.page.waitForSelector('.wall-modes, .empty');
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
  const tidH = await seed(H.page, { startOffset: -1, dayCount: 3, spotsPerDay: 6 });
  // 現在這一站指定成今天最後一站：一定在畫面外，才量得到「還是會帶過去」（同 A 的前置）
  await H.page.evaluate(async (t) => {
    const s = await import('./js/store.js');
    const last = s.spotsOf(t).filter((x) => x.day === 2).sort((x, y) => x.order - y.order).pop();
    await s.setHereSpot(t, last.id, null);
  }, tidH);
  await openTrip(H.page, tidH);
  const hh = await snapshot(H.page);
  if (hh.reduceMotion) ok('系統偏好「減少動態效果」有被讀到');
  else fail('沒偵測到 reduce-motion');
  if (hh.scrollY > 100) ok(`減少動態效果：還是會帶到今天（${hh.scrollY}px）`);
  else fail('reduce-motion 下沒捲動：' + hh.scrollY);
  // 同樣改用「App 的呼叫次數」：reduce-motion 那條路是 window.scrollTo(0, top) 單次呼叫，
  // 沒有 rAF 迴圈，所以跨度必為 0。用 scroll 事件數量的話，這一條在快機器上也會誤判。
  // 同一支函式、同樣的量法，只有 reduce-motion 這個差別 —— 兩條斷言互為對照組。
  const instant = await measureScroll(H.page, true);
  if (instant.burst <= 1) ok(`減少動態效果：一步到位、沒有動畫（最長連續 ${instant.burst} 幀）`);
  else fail(`reduce-motion 下仍有動畫：最長連續 ${instant.burst} 幀`);

  // ================= 底部分頁：再按一次回到最上面 =================
  const T = await device();
  // 照片牆要有東西才捲得動，所以先讓幾個景點有照片
  const tidT = await seed(T.page, { startOffset: -1, dayCount: 3, spotsPerDay: 6, complete: [[1, 0], [1, 1], [1, 2], [2, 0]] });
  await openTrip(T.page, tidT);

  await T.page.evaluate(() => window.scrollTo(0, 1200));
  await sleep(400);
  const parkedT = await T.page.evaluate(() => Math.round(window.scrollY));
  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.classList.contains('active')).click());
  await sleep(900);
  const toTop = await T.page.evaluate(() => Math.round(window.scrollY));
  if (parkedT > 500 && toTop === 0) ok(`已經在這一頁時再按同一個分頁 → 回到最上面（${parkedT} → ${toTop}）`);
  else fail(`沒有回到最上面：${parkedT} → ${toTop}`);

  const before2 = await T.page.evaluate(() => Math.round(window.scrollY));
  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.classList.contains('active')).click());
  await sleep(600);
  const after2 = await T.page.evaluate(() => ({ y: Math.round(window.scrollY), hash: location.hash }));
  if (before2 === 0 && after2.y === 0 && after2.hash.includes(`/trip/${tidT}`)) ok('已經在最上面時再按：什麼都不做，也不會跳走');
  else fail('在最上面按了卻有動作：' + JSON.stringify(after2));

  await T.page.evaluate(() => window.scrollTo(0, 900));
  await sleep(400);
  const keep = await T.page.evaluate(() => Math.round(window.scrollY));
  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.textContent.includes('照片')).click());
  await T.page.waitForSelector('.wall-modes, .empty');
  await sleep(700);
  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.textContent.includes('任務')).click());
  await T.page.waitForSelector('.qline');
  await sleep(1500);
  const backY = await T.page.evaluate(() => Math.round(window.scrollY));
  if (Math.abs(backY - keep) <= 40) ok(`切到別的分頁再切回來：還原上次的位置（${keep} → ${backY}），不是跳到頂端`);
  else fail(`切回來位置不對：${keep} → ${backY}`);

  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.textContent.includes('照片')).click());
  await T.page.waitForSelector('.wall-modes, .empty');
  await sleep(900);
  await T.page.evaluate(() => window.scrollTo(0, 600));
  await sleep(400);
  const pParked = await T.page.evaluate(() => Math.round(window.scrollY));
  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.classList.contains('active')).click());
  await sleep(900);
  const pTop = await T.page.evaluate(() => Math.round(window.scrollY));
  // v1.57.2 進度區移到回顧後照片頁變短，捲不到 600 —— 只要真的有捲動且回到頂端就算對
  if (pParked > 100 && pTop === 0) ok(`照片分頁也一樣（${pParked} → ${pTop}）`);
  else fail(`照片分頁不一致：${pParked} → ${pTop}`);

  await T.page.goto('about:blank');
  await T.page.goto(`http://localhost:${WEB}/#/settings`, { waitUntil: 'networkidle0' });
  await T.page.waitForSelector('.page');
  await sleep(600);
  await T.page.evaluate(() => window.scrollTo(0, 700));
  await sleep(400);
  const sParked = await T.page.evaluate(() => Math.round(window.scrollY));
  await T.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.classList.contains('active')).click());
  await sleep(900);
  const sTop = await T.page.evaluate(() => Math.round(window.scrollY));
  if (sParked > 200 && sTop === 0) ok(`首頁層的分頁（設定）也一樣（${sParked} → ${sTop}）`);
  else fail(`設定頁不一致：${sParked} → ${sTop}`);

  const R2 = await device({ reduceMotion: true });
  const tidR2 = await seed(R2.page, { startOffset: -1, dayCount: 3, spotsPerDay: 6 });
  await openTrip(R2.page, tidR2);
  await R2.page.evaluate(() => { window.scrollTo(0, 1200); window.__scrolls = []; });
  await sleep(400);
  await R2.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].find((a) => a.classList.contains('active')).click());
  await sleep(800);
  const rr = await R2.page.evaluate(() => ({ y: Math.round(window.scrollY), n: (window.__scrolls || []).length }));
  if (rr.y === 0 && rr.n <= 2) ok(`減少動態效果：一步跳到最上面、沒有動畫（${rr.n} 次取樣）`);
  else fail('reduce-motion 行為不對：' + JSON.stringify(rr));

  await R2.page.evaluate(async (t) => {
    const s = await import('./js/store.js');
    const list = s.spotsOf(t);
    await s.setHereSpot(t, list[list.length - 1].id, null);
  }, tidR2);
  await openTrip(R2.page, tidR2);
  const stillAuto = await R2.page.evaluate(() => Math.round(window.scrollY));
  if (stillAuto > 100) ok(`沒有干擾原本的自動捲動（打開行程仍捲到指定那一站，${stillAuto}px）`);
  else fail('自動捲動被影響了：' + stillAuto);
  // 這裡「現在這一站」在第 3 天、今天是第 2 天——兩者不同天，正是「照日期找」會找到隱藏那天的情境
  const r2v = await R2.page.evaluate(() => {
    const shown = [...document.querySelectorAll('.daycollapse.open')].map((e) => e.dataset.day);
    const hd = document.querySelector('.daycollapse.open .qcollapse.is-here .qc-head');
    const sb = document.querySelector('.daystrip').getBoundingClientRect().bottom;
    const tabH = document.getElementById('tabbar').offsetHeight;
    const r = hd && hd.getBoundingClientRect();
    return { shown, has: !!r, top: r ? Math.round(r.top) : null, bottom: r ? Math.round(r.bottom) : null, sb: Math.round(sb), limit: window.innerHeight - tabH };
  });
  if (r2v.shown.join() === '3' && r2v.has && r2v.top >= r2v.sb - 4 && r2v.bottom <= r2v.limit)
    ok('現在這一站不在今天（第 3 天 vs 今天第 2 天）：顯示第 3 天，捲完那一站看得到、沒被日期列蓋住');
  else fail('現在這一站不在今天時捲錯地方：' + JSON.stringify(r2v));

  // ================= 底部分頁導覽：完整矩陣 =================
  // v1.35 出過大包：判斷「已經在這一頁」用了 active（＝在這個分頁的「區域」裡），
  // 結果在景點頁／任務詳情按「任務」會被 preventDefault 擋掉，人困在子頁面出不來。
  // 所以這裡不是測捲動，而是測最基本的一件事：按了分頁有沒有真的切過去。
  const N = await device();
  const tidN = await seed(N.page, { startOffset: -1, dayCount: 2, spotsPerDay: 2, complete: [[1, 0]] });
  const ids = await N.page.evaluate(async (t) => {
    const s = await import('./js/store.js');
    const sp = s.spotsOf(t)[0];
    return { spot: sp.id, quest: s.questsOf(sp.id)[0].id };
  }, tidN);

  const marker = () => N.page.evaluate(() => ({
    hash: location.hash,
    what: document.querySelector('.qline') ? '任務清單'
      : document.querySelector('.qrow') ? '景點頁'
      : document.querySelector('.quest-focus') ? '任務詳情'
      : document.querySelector('.wall-modes, .wall-bar') ? '照片牆'
      : document.querySelector('.exp-summary, .exp-total, .exp-form, .exp-item, .numpad') ? '分帳'
      : document.querySelector('.mem-card') ? '回顧'
      : document.querySelector('.hero') ? '我的旅程'
      : document.querySelector('.seg') ? '設定' : '?',
  }));
  const goHash = async (hash) => {
    await N.page.goto('about:blank');
    await N.page.goto(`http://localhost:${WEB}/${hash}`, { waitUntil: 'networkidle0' });
    await sleep(1300);
  };
  const tapTab = async (name) => {
    await N.page.evaluate((n) => {
      const el = [...document.querySelectorAll('#tabbar .tab')].find((a) => a.textContent.includes(n));
      if (el) el.click();
    }, name);
    await sleep(1300);
    return marker();
  };

  // 旅程層：6 個起點 × 4 顆分頁
  const tripStarts = [
    ['任務清單', `#/trip/${tidN}`],
    ['照片牆', `#/trip/${tidN}/people`],
    ['分帳', `#/trip/${tidN}/expenses`],
    ['回顧', `#/trip/${tidN}/memories`],
    ['景點頁', `#/trip/${tidN}/spot/${ids.spot}`],
    ['任務詳情', `#/quest/${ids.quest}`],
  ];
  // 網址才是「有沒有真的切過去」的鐵證；內容標記另外檢查（分帳頁沒資料時是空狀態，
  // 沒有可靠的標記，所以那一頁只驗網址）
  const wantHash = {
    任務: `#/trip/${tidN}`, 照片: `#/trip/${tidN}/people`,
    分帳: `#/trip/${tidN}/expenses`, 回顧: `#/trip/${tidN}/memories`,
  };
  const wantWhat = { 任務: '任務清單', 照片: '照片牆', 回顧: '回顧' };
  let bad = [];
  for (const [from, hash] of tripStarts) {
    for (const tab of ['任務', '照片', '分帳', '回顧']) {
      await goHash(hash);
      const got = await tapTab(tab);
      if (got.hash !== wantHash[tab]) bad.push(`${from} →按「${tab}」→ 網址是 ${got.hash}`);
      else if (wantWhat[tab] && got.what !== wantWhat[tab]) bad.push(`${from} →按「${tab}」→ 畫面是 ${got.what}`);
    }
  }
  if (!bad.length) ok(`旅程層分頁導覽完整矩陣 ${tripStarts.length}×4＝24 種組合都正確切換`);
  else fail(`分頁導覽壞了 ${bad.length} 種：` + bad.join(' ｜ '));

  // 首頁層：2 個起點 × 2 顆分頁
  bad = [];
  for (const [from, hash] of [['我的旅程', '#/'], ['設定', '#/settings']]) {
    for (const [tab, expect] of [['我的旅程', '我的旅程'], ['設定', '設定']]) {
      await goHash(hash);
      const got = await tapTab(tab);
      if (got.what !== expect) bad.push(`${from} →按「${tab}」→ 竟然是 ${got.what}`);
    }
  }
  if (!bad.length) ok('首頁層分頁導覽 2×2＝4 種組合都正確');
  else fail('首頁層分頁壞了：' + bad.join('、'));

  // 「已在該分頁再按一次」不可以把導覽擋掉 —— 只在網址完全相同時才算
  await goHash(`#/trip/${tidN}/spot/${ids.spot}`);
  const tabState = await N.page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')]
    .map((a) => a.textContent.replace(/[^一-龥]/g, '') + (a.classList.contains('active') ? '*' : '')));
  const backToList = await tapTab('任務');
  if (/任務\*/.test(tabState.join('')) && backToList.what === '任務清單') {
    ok('在景點頁時「任務」雖然是亮的，按下去仍然回得到任務清單（不是只捲動）');
  } else fail(`景點頁回不去：${JSON.stringify(tabState)} → ${backToList.what}`);


  console.log('\n折疊與自動捲動測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
