// 主頁與回顧搬家（v1.84.0）從使用者的入口驗（npm run hometest；會開瀏覽器）
//
// 涵蓋的程式：js/app.js（底部分頁、返回規則）、js/views/trip.js（tripHome 主頁、trip() 任務頁、itinerary() 的回顧卡 memoriesCard）、
//   js/views/home.js（旅程卡點下去到主頁）、css/style.css（.trip-home、.th-*、.task-prog、.itin-mem、.info-fold）
// 來由：Yolin 2026-11-13「可以 都照建議做」＝docs/DESIGN_主頁規劃.md 第 5 節（示意圖 4、5、6）。
//
//   H 主頁（示意圖 4、5）：點旅程卡落在主頁、底部第一格「主頁」亮著；旅程中：今天第幾天 → 下一站卡（帶我去）→ 小工具；
//     主頁不放任務的跳轉（沒有拍照解任務、沒有任務列、沒有任務的數字）；還沒出發：出發倒數；結束後：旅程結束了＋去看回顧、
//     沒有下一站與天氣；全部拍完（還沒結束）：任務全部完成了＋去看回顧；沒有景點：去安排景點；
//     主頁的子頁（找附近）底部亮「主頁」、返回回主頁
//   M 舊位置 → 新位置（STATUS 的對照表）：任務頁原本上面那幾塊，每一樣在主頁找得到、任務頁不再有
//     （新旅伴橫幅在 jointest／livesynctest、位置分享在 postest、天氣條的內容在 peektest／photoicontest 驗，都改從主頁讀）
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

// 旅程層的底部分頁（照順序；v1.84.0 最前面加「主頁」、拿掉「回顧」）
const TRIP_TABS = ['主頁', '任務', '行程', '照片', '分帳'];

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

// 主頁上有什麼、照什麼順序（只讀 .trip-home 裡面）
const homeLayout = (page) => page.evaluate(() => {
  const pg = document.querySelector('.trip-home');
  if (!pg) return null;
  const q = (s) => pg.querySelector(s);
  const btns = [...pg.querySelectorAll('button, a')].map((b) => b.textContent.trim());
  const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const day = q('.th-day'), cd = q('.countdown'), card = q('.today-card'), tools = q('.th-tools'), end = q('.th-end');
  return {
    day: day ? day.querySelector('.th-day-n')?.textContent || '' : null,
    cd: cd ? cd.querySelector('.cd-big')?.textContent || '' : null,
    card: !!card, go: !!card && [...card.querySelectorAll('a, button')].some((b) => b.textContent.includes('帶我去')),
    end: end ? end.querySelector('.th-end-t')?.textContent || '' : null,
    endStats: end ? end.querySelector('.th-end-s')?.textContent || '' : null,
    endGo: end ? end.querySelector('.th-end-go')?.textContent || '' : null,
    empty: !!q('.th-empty'), plan: btns.some((t) => t.includes('去安排景點')),
    near: !!tools && [...tools.querySelectorAll('button')].some((b) => b.textContent.includes('找附近')),
    crew: !!(tools && tools.querySelector('.crew-btn')), photos: !!q('.th-photos'), wx: !!q('.wx-slot'),
    nudge: !!q('.claim-nudge'),
    shot: btns.some((t) => t.includes('拍照解任務')), qline: pg.querySelectorAll('.qline, .qcollapse').length,
    prog: !!q('.task-prog') || /已完成 \d+ \/ \d+/.test(pg.textContent),
    dayBeforeCard: before(day, card), cdBeforeCard: before(cd, card), cardBeforeTools: before(card, tools), endBeforeTools: before(end, tools),
  };
});
// 任務頁上還有沒有原本那幾塊（只讀 #view .page；搬走的東西一樣一樣數）
const taskPageLeftovers = (page) => page.evaluate(() => {
  const pg = document.querySelector('#view .page');
  if (!pg || pg.classList.contains('trip-home')) return null;
  const has = (s) => !!pg.querySelector(s);
  const btn = (t) => [...pg.querySelectorAll('button, a')].some((b) => b.textContent.includes(t));
  const left = {
    倒數: has('.countdown'), 進度卡: has('.progress-banner'), 新旅伴橫幅: has('.join-banner'), 旅伴列: has('.crew-btn'),
    還看不到你: has('.claim-nudge'), 位置分享: has('.pos-banner'), 回顧大按鈕: btn('回顧'), 主角卡: has('.today-card, .nextstn'),
    找附近: btn('找附近'), 天氣條: has('.wx-slot, .wx-strip'),
  };
  const prog = pg.querySelector('.task-prog .tp-title');
  return { left, found: Object.keys(left).filter((k) => left[k]), spots: pg.querySelectorAll('.qcollapse').length, prog: prog ? prog.textContent : null };
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
    // 同步的群組、兩位旅伴、這支手機還沒選「我是誰」→ 主頁該出「旅伴還看不到你」（syncSecret 是自己造的字，不連任何伺服器；
    // 寫成 repeat 跟其他測試一樣——寫成一整串字面，推送前自查的 secret 規則會擋，2026-11-13 第一次推 v1.84.0 時撞到）
    const g2 = uuid();
    await s.put({ id: g2, type: 'group', name: 'g2', syncSecret: 'h'.repeat(32) });
    await s.put({ id: uuid(), type: 'member', groupId: g2, displayName: '阿明' });
    await s.put({ id: uuid(), type: 'member', groupId: g2, displayName: '阿華' });
    const mk = async (title, startDate, endDate, items, done, group = g) => {
      const t = uuid();
      await s.put({ id: t, type: 'trip', groupId: group, title, region: '台北', allowWiki: false, startDate, ...(endDate ? { endDate } : {}) });
      if (!items.length) return;
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items });
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
      if (done) for (const q of quests) await s.put({ id: uuid(), type: 'submission', tripId: t, questId: q.id, memberId: m, photoHash: 'h', createdAt: Date.now() });
    };
    await mk('H還沒出發', D.p3, D.p5, [{ name: '象山', day: 1 }], false);
    await mk('H沒有景點', D.m1, D.p1, [], false);
    await mk('H旅伴', D.m1, D.p1, [{ name: '象山', day: 1 }], false, g2);
    await mk('R旅程中', D.m1, D.p1, [{ name: '龍山寺', day: 1 }, { name: '台北101', day: 2 }, { name: '士林夜市', day: 3 }], false);
    await mk('R全部拍完', D.m1, D.p1, [{ name: '中正紀念堂', day: 1 }, { name: '永康街', day: 2 }], true);
    await mk('R已結束', D.m10, D.m9, [{ name: '象山', day: 1 }, { name: '龍山寺', day: 2 }], false);
    await mk('R沒結束日', D.m1, null, [{ name: '台北101', day: 1 }, { name: '士林夜市', day: 2 }], false);
  }, { m1: plus(-1), p1: plus(1), m10: plus(-10), m9: plus(-9), p3: plus(3), p5: plus(5) });

  // ================= H 主頁 =================
  console.log('\n— H 主頁 —');
  // R旅程中（昨天出發、明天回來＝今天第 2 天）
  let hk = await openTrip(page, 'R旅程中');
  const hHash = await page.evaluate(() => location.hash);
  const hTabs = hk ? await tabState(page) : [];
  yes(hk && /^#\/trip\/[^/]+\/home$/.test(hHash) && !!await page.$('.trip-home') && hTabs[0]?.name === '主頁' && hTabs[0]?.on
    && hTabs.filter((x) => x.on).length === 1,
    `H1 點旅程卡落在主頁（${hHash.replace(/[A-Za-z0-9-]{20,}/, '…')}）、底部第一格「主頁」亮著（${hTabs.map((x) => (x.on ? `［${x.name}］` : x.name)).join('、') || '沒讀到'}）`);
  let H = hk ? await homeLayout(page) : null;
  yes(!!H && H.day === '今天是第 2 天' && H.cd === null && H.card && H.go && H.dayBeforeCard && H.cardBeforeTools && H.near && H.crew,
    `H2 旅程中：今天是第幾天 → 下一站卡（帶我去）→ 小工具（找附近、旅伴），沒有出發倒數（${JSON.stringify(H && { day: H.day, cd: H.cd, card: H.card, go: H.go, dayBeforeCard: H.dayBeforeCard, cardBeforeTools: H.cardBeforeTools, near: H.near, crew: H.crew })}）`);
  yes(!!H && H.card && !H.shot && H.qline === 0 && !H.prog,
    `H3 主頁不放任務的跳轉：沒有「拍照解任務」、沒有任務列、沒有「已完成 X / Y」（下一站卡在才算數；${JSON.stringify(H && { card: H.card, shot: H.shot, qline: H.qline, prog: H.prog })}）`);

  // ---- M 舊位置 → 新位置（同一趟：主頁找得到 → 任務頁不再有）----
  console.log('\n— M 舊位置 → 新位置 —');
  yes(!!H && H.card && H.go && H.crew && H.near && H.wx && /^今天是第 \d+ 天$/.test(H.day || ''),
    `M1 主頁找得到：主角卡（下一站、帶我去）、旅伴列、找附近、天氣條的位置、今天第幾天（${JSON.stringify(H && { card: H.card, go: H.go, crew: H.crew, near: H.near, wx: H.wx, day: H.day })}）`);
  hk = hk && await tabTo(page, '任務', '.qcollapse');
  const T = hk ? await taskPageLeftovers(page) : null;
  yes(!!T && T.spots > 0 && /^已完成 \d+ \/ \d+$/.test(T.prog || '') && T.found.length === 0 && Object.keys(T.left).length === 10,
    `M2 任務頁只做任務：一行進度「${T ? T.prog : '沒讀到'}」＋各站（${T ? T.spots : 0} 站）；原本上面那 ${T ? Object.keys(T.left).length : 0} 塊都不在（還在的：${T ? T.found.join('、') || '無' : '沒讀到'}）`);

  // H旅伴：同步的群組、這支手機還沒選「我是誰」→ 「旅伴還看不到你」在主頁、任務頁沒有
  hk = await openTrip(page, 'H旅伴');
  H = hk ? await homeLayout(page) : null;
  const nudgeBtn = hk ? await page.evaluate(() => [...document.querySelectorAll('.trip-home .claim-nudge button')].map((b) => b.textContent).join('')) : '';
  hk = hk && await tabTo(page, '任務', '.qcollapse');
  const T2 = hk ? await taskPageLeftovers(page) : null;
  yes(!!H && H.nudge && nudgeBtn === '選擇我是誰' && !!T2 && T2.spots > 0 && !T2.left['還看不到你'],
    `M3 「旅伴還看不到你」在主頁最上面（按鈕「${nudgeBtn || '沒有'}」）、任務頁沒有（任務頁 ${T2 ? T2.spots : 0} 站、還看不到你 ${T2 ? T2.left['還看不到你'] : '沒讀到'}）`);

  // H還沒出發
  hk = await openTrip(page, 'H還沒出發');
  H = hk ? await homeLayout(page) : null;
  yes(!!H && /^還有 \d+ 天出發$/.test(H.cd || '') && H.day === null && H.card && H.go && H.cdBeforeCard && H.near,
    `H4 還沒出發：最上面是出發倒數（「${H ? H.cd : '沒讀到'}」）、沒有「今天是第幾天」、下一站卡照樣在、找附近在（${JSON.stringify(H && { day: H.day, card: H.card, cdBeforeCard: H.cdBeforeCard, near: H.near })}）`);

  // R已結束（10 天前出發、9 天前回來）
  hk = await openTrip(page, 'R已結束');
  H = hk ? await homeLayout(page) : null;
  yes(!!H && H.end === '🎁 旅程結束了' && /^完成 0 \/ \d+ 個任務$/.test(H.endStats || '') && H.endGo === '去看回顧與回憶影片'
    && !H.card && !H.wx && H.day === null && H.cd === null && H.photos && H.near && H.endBeforeTools,
    `H5 結束後：「${H ? H.end : '沒讀到'}」＋「${H ? H.endStats : ''}」＋「${H ? H.endGo : ''}」；沒有下一站、天氣、第幾天、倒數；小工具有看大家的照片、找附近（${JSON.stringify(H && { card: H.card, wx: H.wx, day: H.day, cd: H.cd, photos: H.photos, near: H.near })}）`);
  const toMem = hk && await tap(page, '.th-end-go', '去看回顧')
    && await soft(page.waitForFunction(() => /\/memories$/.test(location.hash) && document.querySelector('.mem-card'), { timeout: 15000 }));
  const memOn = toMem ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  yes(toMem && memOn.join() === '行程', `H5 結束後點「去看回顧與回憶影片」到回顧頁、底部亮「行程」（${memOn.join('、') || '沒到'}）`);

  // R全部拍完（還沒結束）：下一站卡換成「任務全部完成了」
  hk = await openTrip(page, 'R全部拍完');
  H = hk ? await homeLayout(page) : null;
  yes(!!H && H.end === '🎉 任務全部完成了' && H.endGo === '去看回顧與回憶影片' && !H.card && H.day === '今天是第 2 天' && H.near,
    `H6 全部拍完但還沒結束：沒有下一站，換成「${H ? H.end : '沒讀到'}」＋「${H ? H.endGo : ''}」（${JSON.stringify(H && { card: H.card, day: H.day, near: H.near })}）`);

  // H沒有景點
  hk = await openTrip(page, 'H沒有景點');
  H = hk ? await homeLayout(page) : null;
  yes(!!H && H.empty && H.plan && !H.card && !H.end && H.near,
    `H7 沒有景點：「這個旅程還沒有景點」＋「＋ 去安排景點」、沒有下一站卡、找附近照樣在（${JSON.stringify(H && { empty: H.empty, plan: H.plan, card: H.card, end: H.end, near: H.near })}）`);

  // 主頁的子頁：找附近 → 底部亮「主頁」→ 返回回主頁
  hk = await openTrip(page, 'R旅程中');
  hk = hk && await tap(page, '.th-tools button', '找附近')
    && await soft(page.waitForFunction(() => /\/nearby$/.test(location.hash), { timeout: 15000 }));
  const nearOn = hk ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  const hb2 = hk ? await userClick(page, await page.$('#backBtn'), '頁首的返回鍵') : { ok: false };
  const backHome = hb2.ok && await soft(page.waitForFunction(() => /\/home$/.test(location.hash) && document.querySelector('.trip-home'), { timeout: 15000 }));
  yes(hk && nearOn.join() === '主頁' && backHome,
    `H8 主頁點「找附近」→ 找附近頁、底部亮「主頁」（${nearOn.join('、') || '沒到'}）→ 按返回回到主頁（${backHome}）`);

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
