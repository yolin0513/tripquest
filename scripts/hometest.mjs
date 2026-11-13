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
//     H9–H11（v1.85.0）：「旅程結束了／任務全部完成了」那張卡上緣是小鳳打領結探頭（邊線對齊、不壓到上面）、
//     一進主頁就慢慢探上來在動；主頁自己重畫（refreshPage）時圖照樣在、停在靜止圖，不會每重畫一次就再跳一次
//   M 舊位置 → 新位置（STATUS 的對照表）：任務頁原本上面那幾塊，每一樣在主頁找得到、任務頁不再有
//     （新旅伴橫幅在 jointest／livesynctest、位置分享在 postest、天氣條的內容在 peektest／photoicontest 驗，都改從主頁讀）
//   R 回顧在「行程」分頁（示意圖 6；v1.86.0 改成最上面一排「行程｜回顧」切換）：底部分頁沒有「回顧」；
//     預設只看結束日——結束日過了亮「回顧」（三張成品卡）、其餘亮「行程」（全部拍完但還沒結束、沒設結束日都是「行程」）；
//     「行程」那一格：沒結束＝旅途資訊在每天的行程前面，結束後＝旅途資訊收成一列放最下面；回顧那一列不在「行程」那一格；
//     點「回顧」看得到那一列（影片什麼時候開放照實寫）；點進回顧頁、底部亮「行程」、返回鍵回行程分頁而且還停在「回顧」；
//     R11：兩格裡沒有多出來的字（原生 append(null) 會寫出「null」，v1.86.0 截圖抓到）
//   N 主頁補內容（v1.86.0）：結束後「這趟的數字」（天數・景點・照片・花費，有才放、不顯示 0；查不到匯率不放花費）、
//     結束卡上不再寫「拍了 N 張照片」；照片列（有照片就有：讚多的先、同讚數新的先，載不到的那張不放，一張都沒有整段不放，
//     點了到照片分頁）；出發前「每天的行程」預覽（最多 5 天、多的寫還有幾天，點了到行程分頁）＋下一班航班（有才放）；
//     N12：數字不從中間斷開（花費自己佔一整列，v1.86.0 截圖抓到 NT$3,6／00.00）
//   C 主頁的新區塊（規劃 5.1，第三個 commit）：下一站卡裡的「今天接下來」（今天、下一站後面還沒拍完的兩站＋整天的行程）、
//     今晚住（今天落在入住～退房之間；地圖帶到地址，沒地址用名稱）、出發前的待買還剩幾項、結束後還有幾筆帳沒結清；
//     每一樣都驗「該出現時出現」與「不該出現時不出現」（帳是背景算的，等算完才判）
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

// 行程分頁（v1.86.0 起最上面一排「行程｜回顧」）：亮的是哪一格、哪一格看得到、各格裡有什麼、旅途資訊在每天的行程前面還是後面
// 看不看得到用 checkVisibility()（藏起來的那一格是 hidden；收起來的 <details> 內容也算看不到）
const itinLayout = (page) => page.evaluate(() => {
  const pg = document.querySelector('.itin-page');
  if (!pg) return null;
  const vis = (el) => !!el && el.checkVisibility();
  const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const seg = pg.querySelector('.itin-seg');
  const on = seg ? [...seg.querySelectorAll('button')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.textContent) : [];
  const plan = pg.querySelector('#itin-pane-plan'), mem = pg.querySelector('#itin-pane-mem');
  const days = plan ? [...plan.querySelectorAll('.daycollapse')] : [];
  const first = days[0], last = days[days.length - 1];
  const top = mem && mem.querySelector('.itin-mem');
  const memRow = mem ? [...mem.querySelectorAll('.itin-mem-row')].find((r) => !r.closest('.itin-mem')) || null : null;
  const info = plan && plan.querySelector('.info-card');
  const fold = info && info.closest('details.info-fold');
  return {
    seg: !!seg, segFirst: !!seg && pg.firstElementChild === seg, on: on.join(), planShown: vis(plan), memShown: vis(mem),
    days: days.length, dayShown: days.some(vis), planRows: plan ? plan.querySelectorAll('.itin-mem, .itin-mem-row').length : 0,
    top: !!top, topShown: vis(top), topCards: top ? [...top.querySelectorAll('.mem-card .mem-card-title')].map((x) => x.textContent) : [],
    memRow: !!memRow, memRowShown: vis(memRow), rowText: memRow ? memRow.textContent : '',
    infoFold: !!fold, infoBeforeDays: before(info, first), infoAfterDays: before(last, info),
    editBeforeDays: before(plan && plan.querySelector('.itin-edit'), first),
    infoRows: info ? info.querySelectorAll('.info-row').length : 0,
    // 兩格底下直接掛著的字（不在任何元素裡）：原生 append(null) 會把 null 寫成「null」兩個字（v1.86.0 截圖抓到，測試原本沒抓到）
    stray: [plan, mem].flatMap((p) => (p ? [...p.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent) : [])),
  };
});
// 點「行程｜回顧」那一排的某一顆（使用者的路），等那一格看得到、有東西
async function segTo(page, label) {
  if (!await tap(page, '.itin-seg button', label)) return false;
  return soft(page.waitForFunction((l) => {
    const b = [...document.querySelectorAll('.itin-seg button')].find((x) => x.textContent === l);
    const p = b && document.getElementById(b.getAttribute('aria-controls'));
    return !!p && p.checkVisibility() && p.childElementCount > 0 && b.getAttribute('aria-selected') === 'true';
  }, { timeout: 15000 }, label));
}
// v1.86.0 主頁補內容：這趟的數字、照片列、每天的行程預覽、航班。背景算的（花費、照片）等算完（data-checked）再讀
const homeExtra = (page) => page.evaluate(async () => {
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await new Promise((r) => setTimeout(r, 50))) {
    const pg = document.querySelector('.trip-home');
    if (!pg) continue;
    const n = pg.querySelector('.th-nums'), s = pg.querySelector('.th-shots-slot');
    if ((!n || n.dataset.checked === '1') && (!s || s.dataset.checked === '1')) break;
  }
  const pg = document.querySelector('.trip-home');
  if (!pg) return null;
  const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  const nums = pg.querySelector('.th-nums'), slot = pg.querySelector('.th-shots-slot'), shots = pg.querySelector('.th-shots');
  const imgs = shots ? [...shots.querySelectorAll('img.th-shot')] : [];
  // 圖要真的解開了才算放上去：等每一張 complete，量它的原始寬度（合成圖的寬度各不相同，用來認是哪一張）
  for (let t0 = Date.now(); imgs.some((i) => !i.complete) && Date.now() - t0 < 5000;) await new Promise((r) => setTimeout(r, 50));
  const plan = pg.querySelector('.th-plan'), fl = pg.querySelector('.th-flight');
  const end = pg.querySelector('.th-end'), tools = pg.querySelector('.th-tools'), card = pg.querySelector('.today-card');
  return {
    nums: nums ? { title: nums.querySelector('.th-sec-t')?.textContent || '', checked: nums.dataset.checked === '1',
      cells: [...nums.querySelectorAll('.thn-cell')].map((c) => `${c.querySelector('.thn-v')?.textContent}｜${c.querySelector('.thn-k')?.textContent}`),
      // 每一格的數字排成幾行（用文字的範圍量：斷成兩行就有兩個框）。v1.86.0 截圖抓到花費從數字中間斷開（NT$3,6／00.00）
      lines: [...nums.querySelectorAll('.thn-v')].map((v) => { const r = document.createRange(); r.selectNodeContents(v); return r.getClientRects().length; }) } : null,
    endStats: end ? end.querySelector('.th-end-s')?.textContent ?? '' : null,
    slot: !!slot, slotChecked: slot ? slot.dataset.checked === '1' : null, slotEmpty: slot ? slot.childElementCount === 0 : null,
    shots: shots ? { title: shots.querySelector('.th-sec-t')?.textContent || '', aria: shots.getAttribute('aria-label') || '',
      widths: imgs.map((i) => i.naturalWidth), visible: shots.checkVisibility() } : null,
    plan: plan ? { title: plan.querySelector('.th-sec-t')?.textContent || '',
      days: [...plan.querySelectorAll('.thp-day')].map((d) => ({ n: d.querySelector('.thp-n')?.textContent || '', d: d.querySelector('.thp-d')?.textContent ?? null, r: d.querySelector('.thp-r')?.textContent || '' })),
      more: plan.querySelector('.thp-more')?.textContent ?? null } : null,
    flight: fl ? fl.textContent : null,
    numsAfterEnd: before(end, nums), numsBeforeTools: before(nums, tools), shotsBeforeTools: before(shots, tools), numsBeforeShots: before(nums, shots),
    planAfterCard: before(card, plan), planBeforeTools: before(plan, tools), flightAfterPlan: before(plan, fl), flightBeforeTools: before(fl, tools),
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
    // C 新區塊（v1.84.0 第三個 commit）
    nextName: card ? card.querySelector('.nextstn-name')?.textContent || '' : '',
    tn: (() => { const tn = card && card.querySelector('.today-next'); return tn ? {
      label: tn.querySelector('.tn-label')?.textContent || '',
      items: [...tn.querySelectorAll('.tn-item')].map((li) => ({ time: li.querySelector('.tn-time')?.textContent || '', name: li.querySelector('.tn-name')?.textContent || '' })),
      all: tn.querySelector('.tn-all')?.textContent || '' } : null; })(),
    stays: [...pg.querySelectorAll('a.th-stay')].map((a) => ({ t: a.querySelector('.th-stay-t')?.textContent || '', s: a.querySelector('.th-stay-s')?.textContent ?? null, href: a.getAttribute('href') || '' })),
    buy: q('.th-buy') ? q('.th-buy').textContent : null,
    moneySlot: !!q('.th-money-slot'), moneyChecked: q('.th-money-slot')?.dataset.checked === '1',
    money: q('.th-money') ? q('.th-money').textContent : null,
    stayAfterCard: before(card, q('a.th-stay')), stayBeforeTools: before(q('a.th-stay'), tools),
    buyAfterCard: before(card, q('.th-buy')), buyBeforeTools: before(q('.th-buy'), tools),
    moneyAfterEnd: before(end, q('.th-money')), moneyBeforeTools: before(q('.th-money'), tools),
  };
});
// v1.85.0：「旅程結束了／任務全部完成了」那張卡上緣的探頭圖（小鳳打領結，js/peeks.js 的 done）。
//   邊線對齊：圖底往上 --pk-sink 就是卡片上緣（差 ≤ 1.5px）；整張在畫面裡；不壓到上一個區塊（沒有上一個區塊就比頁首的底）；
//   動畫：一進主頁就量——有 pk-cheer、慢慢探上來（pk-soft）、有動畫在跑、隔 150ms 量兩次位置不一樣
const endPeek = (page) => page.evaluate(async () => {
  // openTrip 等到的 #view .page 可能還是上一頁：先等主頁真的畫出來（探頭圖跟主頁同一次 drawPage 放上去）
  for (let t0 = Date.now(); !document.querySelector('.trip-home') && Date.now() - t0 < 8000;) await new Promise((r) => setTimeout(r, 50));
  const card = document.querySelector('.trip-home .th-end'), el = card && card.querySelector(':scope > svg.gl-peek');
  if (!card || !el) return { found: false, card: !!card };
  const snap = () => [...el.querySelectorAll('.pk-hop, .pk-wave, .pk-grip, .pk-wave-lines')].map((x) => { const s = getComputedStyle(x); return `${s.transform}|${s.opacity}`; }).join(';');
  const anims = el.getAnimations({ subtree: true });
  const s1 = snap();
  await new Promise((r) => setTimeout(r, 150));
  const s2 = snap();
  const cr = card.getBoundingClientRect(), r = el.getBoundingClientRect();
  const sink = parseFloat(el.style.getPropertyValue('--pk-sink'));
  // 上一個「看得到的」區塊：高度 0 的空格子（天氣抓不到時的 wx-slot）上下間距疊在一起、框落在別人的位置上，但畫面上什麼都沒有，壓不到——跳過、照實印出跳過了誰
  const skipped = [];
  let prev = card.previousElementSibling;
  while (prev && prev.getBoundingClientRect().height === 0) { skipped.push(prev.className || prev.tagName); prev = prev.previousElementSibling; }
  const prevBottom = prev ? prev.getBoundingClientRect().bottom : document.getElementById('topbar').getBoundingClientRect().bottom;
  return {
    found: true, kind: el.getAttribute('data-peek'), cheer: el.classList.contains('pk-cheer'), soft: el.classList.contains('pk-soft'),
    n: anims.length, running: anims.filter((a) => a.playState === 'running').length, moved: s1 !== '' && s1 !== s2,
    edgeGap: Number.isFinite(sink) ? +(r.bottom - sink - cr.top).toFixed(2) : null, above: Math.round(cr.top - r.top),
    inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.width > 0,
    clear: r.top >= prevBottom - 1, prevName: (prev ? (prev.className || prev.tagName) : '頁首') + (skipped.length ? `（跳過高度 0 的 ${skipped.join('、')}）` : ''),
  };
});
const peekOk = (p) => p.found && p.kind === 'done' && p.edgeGap != null && Math.abs(p.edgeGap) <= 1.5 && p.above >= 20 && p.inView && p.clear;
const peekMoving = (p) => p.found && p.cheer && p.soft && p.running >= 1 && p.moved;
const peekBrief = (p) => (p.found ? `${p.kind}；邊線差 ${p.edgeGap}px、露出卡片上緣 ${p.above}px；在畫面裡 ${p.inView}；上一個區塊「${p.prevName}」沒壓到 ${p.clear}；pk-cheer ${p.cheer}、慢慢探 ${p.soft}；動畫 ${p.n} 段、跑著的 ${p.running}；位置變了 ${p.moved}` : `沒有探頭圖${p.card ? '' : '（卡也不在）'}`);

// 結束後的「帳沒結清」是背景算的：等那一格算完（data-checked）再讀，才分得出「沒出現」與「還沒算完」
async function homeAfterMoney(page) {
  await soft(page.waitForFunction(() => { const s = document.querySelector('.trip-home .th-money-slot'); return !!document.querySelector('.trip-home') && (!s || s.dataset.checked === '1'); }, { timeout: 15000 }));
  return homeLayout(page);
}
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
    const mk = async (title, startDate, endDate, items, done, group = g, extra = {}) => {
      const t = uuid();
      await s.put({ id: t, type: 'trip', groupId: group, title, region: '台北', allowWiki: false, startDate, ...(endDate ? { endDate } : {}), ...extra });
      if (!items.length) return { t, spots: [], quests: [] };
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items });
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
      if (done) for (const q of quests) await s.put({ id: uuid(), type: 'submission', tripId: t, questId: q.id, memberId: m, photoHash: 'h', createdAt: Date.now() });
      return { t, spots, quests };
    };
    const spotOf = (r, name) => r.spots.find((x) => x.name.includes(name) || name.includes(x.name));
    const finish = async (r, name) => { const sp = spotOf(r, name); for (const q of r.quests.filter((x) => x.spotId === sp.id)) await s.put({ id: uuid(), type: 'submission', tripId: r.t, questId: q.id, memberId: m, photoHash: 'h', createdAt: Date.now() }); };
    const stay = (t, name, checkIn, checkOut, address = '') => s.put({ type: 'stay', tripId: t, name, checkIn, checkOut, address, note: '' });
    const buy = (t, text, done) => s.put({ type: 'buy', tripId: t, text, done, doneBy: null });
    const spend = (t, group, payerId, amount, currency, participants) => s.put({ id: uuid(), type: 'expense', tripId: t, groupId: group, title: '一筆花費', category: 'other',
      amount, currency, payerId, participants, shares: null, note: '', day: null, createdAt: Date.now() });

    // H還沒出發：三站都在第 1 天（還沒出發＝沒有「今天」→ 不出「今天接下來」）；待買三項、一項買好了
    const hPre = await mk('H還沒出發', D.p3, D.p5, [{ name: '象山', day: 1 }, { name: '龍山寺', day: 1 }, { name: '台北101', day: 1 }], false);
    await buy(hPre.t, '轉接頭', false); await buy(hPre.t, '雨傘', false); await buy(hPre.t, '護照影本', true);
    await mk('H沒有景點', D.m1, D.p1, [], false);
    const hCrew = await mk('H旅伴', D.m1, D.p1, [{ name: '象山', day: 1 }], false, g2);
    await stay(hCrew.t, 'C民宿', D.m1, D.p1);                        // 今晚住、沒填地址 → 用名稱帶路

    // ---- C 主頁的新區塊（自己造的名字與地址，不是真的行程）----
    // C今天六站：今天第 2 天；第 1 天象山拍完了；今天六站，台北101 拍完了 → 下一站龍山寺、後面還沒拍完的是士林夜市、中正紀念堂、永康街（只放兩站）
    const c6 = await mk('C今天六站', D.m1, D.p1, [{ name: '象山', day: 1 }, { name: '龍山寺', day: 2 }, { name: '台北101', day: 2 },
      { name: '士林夜市', day: 2 }, { name: '中正紀念堂', day: 2 }, { name: '永康街', day: 2 }], false);
    await finish(c6, '象山'); await finish(c6, '台北101');
    for (const [name, min] of [['龍山寺', 540], ['台北101', 660], ['士林夜市', 840], ['中正紀念堂', 960], ['永康街', 1080]]) await s.patch(spotOf(c6, name).id, { startMin: min });
    await stay(c6.t, 'C旅店甲', D.m1, D.p1, '合成市示範路 1 號');     // 今晚住
    await stay(c6.t, 'C旅店乙', D.p1, D.p3, '合成市示範路 2 號');     // 明天才入住
    await stay(c6.t, 'C旅店丙', D.m1, null, '合成市示範路 3 號');     // 只填入住日（昨天）→ 只有昨天算
    await buy(c6.t, '充電線', false);                                 // 旅程中 → 主頁不放待買
    const g3 = uuid(), a3 = uuid(), b3 = uuid();
    await s.put({ id: g3, type: 'group', name: 'g3' });
    await s.put({ id: a3, type: 'member', groupId: g3, displayName: '阿土' });
    await s.put({ id: b3, type: 'member', groupId: g3, displayName: '阿金' });
    await spend(c6.t, g, m, 500, 'TWD', [m]);                         // 旅程沒結束 → 主頁不放帳
    const cBuy = await mk('C都買好了', D.p3, D.p5, [{ name: '象山', day: 1 }], false);
    await buy(cBuy.t, '轉接頭', true);
    // 結束後的帳：阿土付 300 兩人分 → 阿金欠 150（1 筆）；結清的；有一筆查不到匯率的（日圓，外站一律 503）
    const cOwe = await mk('C帳沒清', D.m10, D.m9, [{ name: '象山', day: 1 }], false, g3, { baseCurrency: 'TWD' });
    await spend(cOwe.t, g3, a3, 300, 'TWD', [a3, b3]);
    await stay(cOwe.t, 'C旅店丁', D.m1, D.p1, '合成市示範路 4 號');   // 日期蓋到今天，但旅程結束了 → 不出「今晚住」
    const cEven = await mk('C帳結清', D.m10, D.m9, [{ name: '象山', day: 1 }], false, g3, { baseCurrency: 'TWD' });
    await spend(cEven.t, g3, a3, 200, 'TWD', [a3, b3]); await spend(cEven.t, g3, b3, 200, 'TWD', [a3, b3]);
    const cFx = await mk('C匯率查不到', D.m10, D.m9, [{ name: '象山', day: 1 }], false, g3, { baseCurrency: 'TWD' });
    await spend(cFx.t, g3, a3, 300, 'TWD', [a3, b3]); await spend(cFx.t, g3, b3, 1000, 'JPY', [a3, b3]);
    await mk('R旅程中', D.m1, D.p1, [{ name: '龍山寺', day: 1 }, { name: '台北101', day: 2 }, { name: '士林夜市', day: 3 }], false);
    await mk('R全部拍完', D.m1, D.p1, [{ name: '中正紀念堂', day: 1 }, { name: '永康街', day: 2 }], true);
    await mk('R已結束', D.m10, D.m9, [{ name: '象山', day: 1 }, { name: '龍山寺', day: 2 }], false);
    await mk('R沒結束日', D.m1, null, [{ name: '台北101', day: 1 }, { name: '士林夜市', day: 2 }], false);

    // ---- N 主頁補內容（v1.86.0；合成的名字與照片，不是真的行程）----
    // 照片是當場畫的小方塊（寬度各不相同，用寬度認是哪一張），存進本機的圖庫；'n缺' 那張沒有存圖（＝還沒同步下來、載不到）
    const db = await import('./js/db.js');
    const png = (w) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#c96'; x.fillRect(0, 0, w, 8); c.toBlob(res, 'image/png'); });
    const photo = async (hash, w) => { const b = await png(w); await db.putBlob({ hash, blob: b, w, h: 8, bytes: b.size, kind: 'photo' }); };
    const gN = uuid(), n1 = uuid(), n2 = uuid();
    await s.put({ id: gN, type: 'group', name: 'gN' });
    await s.put({ id: n1, type: 'member', groupId: gN, displayName: '小N' });
    await s.put({ id: n2, type: 'member', groupId: gN, displayName: '小M' });
    const shot = async (r, hash, at) => { const id = uuid(); await s.put({ id, type: 'submission', tripId: r.t, questId: r.quests[0].id, memberId: n1, photoHash: hash, thumbHash: hash, createdAt: at }); return id; };
    // N結束有照片：兩天、兩站、一筆 1200 元的花費；四張照片——讚數 2（載不到）、1（最舊）、0（較新）、0（最舊的那張 0 讚）
    const nEnd = await mk('N結束有照片', D.m10, D.m9, [{ name: '象山', day: 1 }, { name: '龍山寺', day: 2 }], false, gN, { baseCurrency: 'TWD' });
    await photo('n甲', 8); await photo('n乙', 9); await photo('n丙', 10);
    const T0 = Date.now() - 86400000;
    await shot(nEnd, 'n甲', T0 + 1000);
    await shot(nEnd, 'n乙', T0 + 2000);
    const sC = await shot(nEnd, 'n丙', T0);
    const sD = await shot(nEnd, 'n缺', T0 + 3000);
    await s.toggleReaction(sC, n1, '❤️');
    await s.toggleReaction(sD, n1, '❤️'); await s.toggleReaction(sD, n2, '❤️');
    await spend(nEnd.t, gN, n1, 1200, 'TWD', [n1, n2]);
    // N旅程中有照片：旅程中、一張照片（寬 11）
    const nRun = await mk('N旅程中有照片', D.m1, D.p1, [{ name: '象山', day: 1 }], false, gN);
    await photo('n丁', 11); await shot(nRun, 'n丁', T0);
    // N七天：還沒出發、七天各一站（站名自己造的，不用景點庫）
    const t7 = uuid();
    await s.put({ id: t7, type: 'trip', groupId: g, title: 'N七天', allowWiki: false, startDate: D.p3, endDate: D.p9 });
    for (let d = 1; d <= 7; d++) await s.put({ id: uuid(), type: 'spot', tripId: t7, name: `N站${d}`, emoji: '📍', day: d, order: d });
    // C都買好了（還沒出發）加一班航班
    await s.put({ id: uuid(), type: 'flight', tripId: cBuy.t, flightNo: 'ZZ123', depDate: D.p3, createdAt: Date.now() });
  }, { m1: plus(-1), p1: plus(1), m10: plus(-10), m9: plus(-9), p3: plus(3), p5: plus(5), p9: plus(9) });

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
  const pkEnd = hk ? await endPeek(page) : { found: false };   // 一進主頁就量（探上來＋揮翅膀大約 2 秒）
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
  const pkAll = hk ? await endPeek(page) : { found: false };
  H = hk ? await homeLayout(page) : null;
  yes(!!H && H.end === '🎉 任務全部完成了' && H.endGo === '去看回顧與回憶影片' && !H.card && H.day === '今天是第 2 天' && H.near,
    `H6 全部拍完但還沒結束：沒有下一站，換成「${H ? H.end : '沒讀到'}」＋「${H ? H.endGo : ''}」（${JSON.stringify(H && { card: H.card, day: H.day, near: H.near })}）`);
  // H9／H10（v1.85.0）：那張卡上緣是小鳳打領結探頭、一進主頁就慢慢探上來在動
  yes(peekOk(pkEnd) && peekMoving(pkEnd),
    `H9 結束後「旅程結束了」那張卡：小鳳打領結從卡片上緣探頭（邊線對齊、整張在畫面裡、不壓到上面）、一進主頁就慢慢探上來在動（${peekBrief(pkEnd)}）`);
  yes(peekOk(pkAll) && peekMoving(pkAll),
    `H10 全部拍完「任務全部完成了」那張卡：小鳳打領結從卡片上緣探頭、一進主頁就慢慢探上來在動（${peekBrief(pkAll)}）`);
  // H11：主頁自己重畫（router 對外的 refreshPage——現在在哪一站變了、AI 文案回來時走這條）不是導覽：圖照樣在、停在靜止圖，不會再跳一次
  const again = hk ? await page.evaluate(async () => {
    const old = document.querySelector('.trip-home');
    (await import('./js/router.js')).refreshPage();
    const t0 = Date.now();
    while (document.querySelector('.trip-home') === old && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
    const el = document.querySelector('.trip-home .th-end > svg.gl-peek');
    return { redrawn: document.querySelector('.trip-home') !== old, found: !!el, cheer: el ? el.classList.contains('pk-cheer') : null, n: el ? el.getAnimations({ subtree: true }).length : null };
  }) : { redrawn: false, found: false };
  yes(again.redrawn && again.found && again.cheer === false && again.n === 0,
    `H11 主頁自己重畫時探頭圖照樣在、停在靜止圖（不會每重畫一次就再跳一次）（重畫了 ${again.redrawn}；圖 ${again.found}；pk-cheer ${again.cheer}；動畫 ${again.n} 段）`);

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
  yes(!!L && L.segFirst && L.on === '行程' && L.planShown && !L.memShown && L.days >= 1 && L.dayShown && L.planRows === 0
    && L.infoBeforeDays && !L.infoFold && L.editBeforeDays,
    `R2 旅程中：最上面一排「行程｜回顧」、預設亮「行程」；「行程」那一格是旅途資訊 → 調整每天的行程 → 每天的行程，裡面沒有回顧；「回顧」那一格藏著（${JSON.stringify(L)}）`);
  ok = ok && await segTo(page, '回顧');
  L = ok ? await itinLayout(page) : null;
  yes(!!L && L.on === '回顧' && L.memShown && !L.planShown && L.memRowShown && !L.top
    && /回顧與成就/.test(L.rowText) && /影片與最終回顧旅程結束後開放/.test(L.rowText),
    `R3 點「回顧」：看得到那一列「回顧與成就」與「影片與最終回顧旅程結束後開放」、「行程」那一格藏起來（「${L ? L.rowText : '沒讀到'}」；${JSON.stringify(L && { on: L.on, memShown: L.memShown, planShown: L.planShown, top: L.top })}）`);
  ok = ok && await tap(page, '.itin-mem-row', '回顧與成就');
  ok = ok && await soft(page.waitForFunction(() => /\/memories$/.test(location.hash) && document.querySelector('.mem-card'), { timeout: 15000 }));
  const memTabs = ok ? await tabState(page) : [];
  const memCards = ok ? await page.evaluate(() => [...document.querySelectorAll('.mem-card .mem-card-title')].map((x) => x.textContent)) : [];
  yes(ok && memCards.includes('成就徽章') && memCards.includes('回憶影片與相簿') && memTabs.find((x) => x.on)?.name === '行程',
    `R8 點那一列進到回顧頁（卡片：${memCards.join('、') || '沒讀到'}）、底部亮的是「行程」（${memTabs.filter((x) => x.on).map((x) => x.name).join('、') || '沒有'}）`);
  const hb = ok ? await userClick(page, await page.$('#backBtn'), '頁首的返回鍵') : { ok: false };
  const backTo = hb.ok && await soft(page.waitForFunction(() => /\/itinerary$/.test(location.hash) && document.querySelector('.itin-page'), { timeout: 15000 }));
  L = backTo ? await itinLayout(page) : null;
  yes(backTo && !!L && L.on === '回顧' && L.memRowShown,
    `R9 回顧頁按返回 → 回到行程分頁、還停在「回顧」那一格（${await page.evaluate(() => location.hash.replace(/[A-Za-z0-9-]{20,}/, '…'))}；${JSON.stringify(L && { on: L.on, memRowShown: L.memRowShown })}）`);

  // R全部拍完：還沒結束就照舊預設「行程」
  ok = await openTrip(page, 'R全部拍完');
  ok = ok && await tabTo(page, '行程', '.itin-page');
  L = ok ? await itinLayout(page) : null;
  const allDoneDefault = !!L && L.on === '行程' && L.planShown && L.planRows === 0;
  ok = ok && await segTo(page, '回顧');
  const L4 = ok ? await itinLayout(page) : null;
  yes(allDoneDefault && !!L4 && L4.memRowShown && !L4.top && /回憶影片可以做了/.test(L4.rowText),
    `R4 全部拍完但旅程還沒結束：預設照舊亮「行程」（${JSON.stringify(L && { on: L.on, planShown: L.planShown, planRows: L.planRows })}）；點「回顧」是那一列、寫「回憶影片可以做了」（「${L4 ? L4.rowText : '沒讀到'}」）`);

  // R已結束：預設亮「回顧」（三張成品卡）、「行程」那一格藏著；點「行程」→ 每天的行程、旅途資訊收成一列放最下面
  ok = await openTrip(page, 'R已結束');
  ok = ok && await tabTo(page, '行程', '.itin-page');
  L = ok ? await itinLayout(page) : null;
  const want = ['回憶影片與相簿', '最終回顧', '行程海報'];
  yes(!!L && L.segFirst && L.on === '回顧' && L.memShown && L.topShown && want.every((w) => L.topCards.includes(w)) && !L.memRow && !L.planShown && !L.dayShown,
    `R5 結束日過了：預設亮「回顧」、三張成品卡看得到；每天的行程藏著（${JSON.stringify(L && { on: L.on, memShown: L.memShown, topShown: L.topShown, topCards: L.topCards, memRow: L.memRow, planShown: L.planShown, dayShown: L.dayShown })}）`);
  ok = ok && await segTo(page, '行程');
  L = ok ? await itinLayout(page) : null;
  // 收起來時看不到三列；點那一列打開才看得到（使用者的路）。
  // 看不看得到用 checkVisibility()：新版 Chrome 收起來的 <details> 內容是 content-visibility:hidden，getClientRects 照樣有框（第一次跑撞到）
  const shut = ok ? await page.evaluate(() => { const i = document.querySelector('.info-fold .info-row'); return !!i && !i.closest('details').open && !i.checkVisibility(); }) : false;
  const opened = ok && await tap(page, '.info-fold-sum', '旅途資訊');
  const vis = opened ? await page.evaluate(() => [...document.querySelectorAll('.info-fold .info-row')].filter((r) => r.checkVisibility()).map((r) => r.textContent)) : [];
  yes(!!L && L.on === '行程' && L.planShown && !L.memShown && L.dayShown && L.planRows === 0 && L.editBeforeDays
    && L.infoFold && L.infoAfterDays && !L.infoBeforeDays && shut && vis.length === 3,
    `R6 點「行程」：調整每天的行程 → 每天的行程、裡面沒有回顧；旅途資訊收成一列放最下面（在每天的行程後面、預設收著 ${shut}）、點開看得到三列（${vis.join('／') || '沒有'}；${JSON.stringify(L && { on: L.on, planShown: L.planShown, dayShown: L.dayShown, planRows: L.planRows, editBeforeDays: L.editBeforeDays })}）`);
  // 兩格都建過了（R5 預設回顧、R6 點了行程）才算數
  yes(!!L && L.planShown && L.days >= 1 && L.top && L.stray.length === 0,
    `R11 結束後兩格裡沒有多出來的字（例：null）（多出來的：${L ? JSON.stringify(L.stray) : '沒讀到'}；行程那一格 ${L ? L.days : 0} 天、回顧那一格有成品卡 ${L ? L.top : '?'}）`);
  const toAlbum = ok && await segTo(page, '回顧') && await tap(page, '.itin-mem .mem-card', '回憶影片與相簿')
    && await soft(page.waitForFunction(() => /\/album$/.test(location.hash), { timeout: 15000 }));
  const albumTabs = toAlbum ? await tabState(page) : [];
  yes(toAlbum && albumTabs.find((x) => x.on)?.name === '行程',
    `R10 結束後切回「回顧」點「回憶影片與相簿」到相簿頁、底部亮的是「行程」（${albumTabs.filter((x) => x.on).map((x) => x.name).join('、') || '沒到或沒有'}）`);

  // R沒結束日：預設「行程」
  ok = await openTrip(page, 'R沒結束日');
  ok = ok && await tabTo(page, '行程', '.itin-page');
  L = ok ? await itinLayout(page) : null;
  const noEndPlan = !!L && L.on === '行程' && L.planShown && L.planRows === 0 && L.infoBeforeDays;
  ok = ok && await segTo(page, '回顧');
  const L7 = ok ? await itinLayout(page) : null;
  yes(noEndPlan && !!L7 && L7.memRowShown && !L7.top,
    `R7 沒設結束日：預設亮「行程」（${JSON.stringify(L && { on: L.on, planShown: L.planShown, planRows: L.planRows, infoBeforeDays: L.infoBeforeDays })}）；「回顧」那一格是那一列、不是三張成品卡（${JSON.stringify(L7 && { memRowShown: L7.memRowShown, top: L7.top })}）`);

  // ================= C 主頁的新區塊（今天接下來、今晚住、待買、帳沒結清）=================
  console.log('\n— C 主頁的新區塊 —');
  let ck = await openTrip(page, 'C今天六站');
  let C = ck ? await homeLayout(page) : null;
  const tnNames = C && C.tn ? C.tn.items.map((x) => x.name) : [];
  yes(!!C && /龍山寺/.test(C.nextName) && !!C.tn && C.tn.label === '今天接下來' && C.tn.items.length === 2
    && /士林夜市/.test(tnNames[0] || '') && C.tn.items[0].time === '14:00' && /中正紀念堂/.test(tnNames[1] || '') && C.tn.items[1].time === '16:00'
    && !tnNames.some((n) => /台北101|永康街|龍山寺/.test(n)),
    `C1 旅程中、下一站在今天：下一站卡（${C ? C.nextName || '沒有' : '沒讀到'}）裡有「今天接下來」——後面還沒拍完的兩站（${C && C.tn ? C.tn.items.map((x) => `${x.time} ${x.name}`).join('／') : '沒有'}）；拍完的台北101、第三站永康街不放`);
  ck = ck && await tap(page, '.today-next .tn-all', '整天的行程')
    && await soft(page.waitForFunction(() => /\/itinerary$/.test(location.hash) && document.querySelector('.itin-page'), { timeout: 15000 }));
  const tnOn = ck ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  yes(ck && tnOn.join() === '行程', `C2 點「整天的行程 ›」到行程分頁、底部亮「行程」（${tnOn.join('、') || '沒到'}）`);

  // 不出現的兩種：還沒出發（沒有「今天」）、下一站不在今天
  hk = await openTrip(page, 'H還沒出發');
  const cPre = hk ? await homeLayout(page) : null;
  hk = await openTrip(page, 'R旅程中');
  const cOther = hk ? await homeLayout(page) : null;
  yes(!!cPre && cPre.card && /^還有 \d+ 天出發$/.test(cPre.cd || '') && cPre.tn === null && !!cOther && cOther.card && cOther.day === '今天是第 2 天' && /龍山寺/.test(cOther.nextName) && cOther.tn === null,
    `C3 不出「今天接下來」：還沒出發（${cPre ? cPre.cd : '沒讀到'}，第 1 天有三站，下一站 ${cPre ? cPre.nextName : ''}）；下一站在第 1 天、今天是第 2 天（下一站 ${cOther ? cOther.nextName : '沒讀到'}）`);

  // 今晚住
  ck = await openTrip(page, 'C今天六站');
  C = ck ? await homeLayout(page) : null;
  const stayHref = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('合成市示範路 1 號');
  yes(!!C && C.stays.length === 1 && C.stays[0].t === '🛏️ 今晚住：C旅店甲' && C.stays[0].s === '合成市示範路 1 號' && C.stays[0].href === stayHref
    && C.stayAfterCard && C.stayBeforeTools,
    `C4 今晚住：今天落在入住～退房之間的那一間（${C ? C.stays.map((x) => `${x.t}｜${x.s}`).join('／') || '沒有' : '沒讀到'}）、點了用地圖帶到地址；明天才入住的、只填入住日（昨天）的不算；在下一站卡後面、小工具前面（${JSON.stringify(C && { stayAfterCard: C.stayAfterCard, stayBeforeTools: C.stayBeforeTools, hrefOk: C.stays[0]?.href === stayHref })}）`);
  hk = await openTrip(page, 'H旅伴');
  const cNoAddr = hk ? await homeLayout(page) : null;
  const nameHref = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('C民宿');
  yes(!!cNoAddr && cNoAddr.stays.length === 1 && cNoAddr.stays[0].t === '🛏️ 今晚住：C民宿' && cNoAddr.stays[0].s === null && cNoAddr.stays[0].href === nameHref,
    `C5 今晚住沒填地址：不寫地址那一行、用名稱帶路（${cNoAddr ? JSON.stringify(cNoAddr.stays.map((x) => ({ t: x.t, s: x.s, hrefOk: x.href === nameHref }))) : '沒讀到'}）`);

  // 待買（出發前）
  hk = await openTrip(page, 'H還沒出發');
  const cB = hk ? await homeLayout(page) : null;
  yes(!!cB && cB.buy === '🛒 待買還有 2 項沒買' && cB.buyAfterCard && cB.buyBeforeTools,
    `C6 出發前：「${cB ? cB.buy || '沒有' : '沒讀到'}」（三項裡一項買好了）、在下一站卡後面、小工具前面（${JSON.stringify(cB && { buyAfterCard: cB.buyAfterCard, buyBeforeTools: cB.buyBeforeTools })}）`);
  hk = hk && await tap(page, '.trip-home .th-buy', '待買還有')
    && await soft(page.waitForFunction(() => /\/buy$/.test(location.hash) && document.querySelector('.buy-input'), { timeout: 15000 }));
  const buyOn = hk ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  yes(hk && buyOn.join() === '行程', `C7 點了到待買清單、底部亮「行程」（${buyOn.join('、') || '沒到'}）`);
  hk = await openTrip(page, 'C都買好了');
  const cAllBought = hk ? await homeLayout(page) : null;
  yes(!!C && C.card && C.buy === null && !!cAllBought && /^還有 \d+ 天出發$/.test(cAllBought.cd || '') && cAllBought.buy === null,
    `C8 不放待買：旅程中（C今天六站有一項沒買：${C ? C.buy || '沒有' : '沒讀到'}）、出發前但全買好了（${cAllBought ? cAllBought.buy || '沒有' : '沒讀到'}）`);

  // 帳沒結清（結束後）
  ck = await openTrip(page, 'C帳沒清');
  C = ck ? await homeAfterMoney(page) : null;
  yes(!!C && C.moneyChecked && C.money === '💰 還有 1 筆帳沒結清' && C.moneyAfterEnd && C.moneyBeforeTools && C.stays.length === 0 && C.end === '🎁 旅程結束了',
    `C9 結束後帳還沒清：「${C ? C.money || '沒有' : '沒讀到'}」、在旅程結束卡後面、小工具前面；住宿日期蓋到今天也不出「今晚住」（旅程結束了；今晚住 ${C ? C.stays.length : '?'} 張）`);
  ck = ck && await tap(page, '.trip-home .th-money', '帳沒結清')
    && await soft(page.waitForFunction(() => /\/expenses$/.test(location.hash), { timeout: 15000 }));
  const moneyOn = ck ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  yes(ck && moneyOn.join() === '分帳', `C10 點了到分帳頁、底部亮「分帳」（${moneyOn.join('、') || '沒到'}）`);
  const noMoney = [];
  for (const title of ['C帳結清', 'C匯率查不到', 'R已結束']) {
    const okT = await openTrip(page, title);
    const X = okT ? await homeAfterMoney(page) : null;
    noMoney.push({ title, slot: !!X && X.moneySlot, checked: !!X && X.moneyChecked, money: X ? X.money : '沒讀到' });
  }
  yes(noMoney.length === 3 && noMoney.every((x) => x.slot && x.checked && x.money === null),
    `C11 結束後不放帳（算完了才判）：結清了、有一筆查不到匯率（算不準）、沒有花費（${JSON.stringify(noMoney)}）`);
  hk = await openTrip(page, 'C今天六站');
  const cRun = hk ? await homeLayout(page) : null;
  yes(!!cRun && cRun.card && !cRun.moneySlot && cRun.money === null,
    `C12 旅程還沒結束：主頁不放帳（C今天六站有一筆只算自己的花費；帳那一格 ${cRun ? cRun.moneySlot : '沒讀到'}）`);

  // ================= N 主頁補內容（v1.86.0）=================
  console.log('\n— N 主頁補內容 —');
  const money = await page.evaluate(async () => { const fx = await import('./js/fx.js'); await fx.loadCurrencies(); return [fx.fmtMoney(1200, 'TWD'), fx.fmtMoney(400, 'TWD')]; });
  // N結束有照片：這趟的數字、照片列
  let nk = await openTrip(page, 'N結束有照片');
  let N = nk ? await homeExtra(page) : null;
  const wantCells = ['2｜天', '2｜個景點', '4｜張照片', `${money[0]}｜花費`];
  yes(!!N && !!N.nums && N.nums.checked && N.nums.title === '這趟的數字' && JSON.stringify(N.nums.cells) === JSON.stringify(wantCells) && money[0].includes('1,200')
    && N.numsAfterEnd && N.numsBeforeTools,
    `N1 結束後「這趟的數字」：兩天、兩站、四張照片、花費 ${money[0]}（實得 ${N && N.nums ? N.nums.cells.join('／') : '沒有'}）；在旅程結束卡後面、小工具前面（${JSON.stringify(N && { numsAfterEnd: N.numsAfterEnd, numsBeforeTools: N.numsBeforeTools })}）`);
  yes(!!N && !!N.nums && N.nums.lines.length === 4 && N.nums.lines.every((n) => n === 1),
    `N12 這趟的數字每一格的數字都在同一行、不從中間斷開（390px 寬；各格幾行 ${N && N.nums ? JSON.stringify(N.nums.lines) : '沒讀到'}）`);
  yes(!!N && typeof N.endStats === 'string' && /^完成 \d+ \/ \d+ 個任務$/.test(N.endStats) && !N.endStats.includes('照片'),
    `N1 結束卡上只留任務數、不再寫「拍了 N 張照片」（同一個數字不講兩次；「${N ? N.endStats : '沒讀到'}」）`);
  yes(!!N && !!N.shots && N.shots.visible && N.shots.title === '📸 這趟的照片' && JSON.stringify(N.shots.widths) === '[10,9,8]'
    && N.shots.aria.includes('共 4 張') && N.numsBeforeShots && N.shotsBeforeTools,
    `N2 照片列：讚多的先（1 讚那張）、同讚數新的先；2 讚但載不到的那張不放（寬度順序 ${N && N.shots ? JSON.stringify(N.shots.widths) : '沒有'}，要 [10,9,8]；標題「${N && N.shots ? N.shots.title : ''}」；在這趟的數字後面、小工具前面）`);
  nk = nk && await tap(page, '.trip-home .th-shots', '這趟的照片')
    && await soft(page.waitForFunction(() => /\/people$/.test(location.hash), { timeout: 15000 }));
  const shotOn = nk ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  yes(nk && shotOn.join() === '照片', `N3 點照片列到照片分頁、底部亮「照片」（${shotOn.join('、') || '沒到'}）`);

  // 有才放：沒照片沒花費（R已結束）、查不到匯率（C匯率查不到）對照全部台幣（C帳結清）
  nk = await openTrip(page, 'R已結束');
  N = nk ? await homeExtra(page) : null;
  yes(!!N && !!N.nums && N.nums.checked && JSON.stringify(N.nums.cells) === JSON.stringify(['2｜天', '2｜個景點']) && N.slotChecked && N.slotEmpty && !N.shots,
    `N4 結束後沒照片、沒花費：數字只有天數與景點（${N && N.nums ? N.nums.cells.join('／') : '沒有'}）、不放 0 張照片與 0 元；照片列不放（算完了 ${N ? N.slotChecked : '?'}、空的 ${N ? N.slotEmpty : '?'}）`);
  nk = await openTrip(page, 'C匯率查不到');
  const nFx = nk ? await homeExtra(page) : null;
  nk = await openTrip(page, 'C帳結清');
  const nEven = nk ? await homeExtra(page) : null;
  yes(!!nFx && !!nFx.nums && nFx.nums.checked && JSON.stringify(nFx.nums.cells) === JSON.stringify(['2｜天', '1｜個景點'])
    && !!nEven && !!nEven.nums && nEven.nums.checked && JSON.stringify(nEven.nums.cells) === JSON.stringify(['2｜天', '1｜個景點', `${money[1]}｜花費`]),
    `N5 有一筆查不到匯率（日圓）→ 不放花費（${nFx && nFx.nums ? nFx.nums.cells.join('／') : '沒有'}）；對照：全部台幣的那一趟放（${nEven && nEven.nums ? nEven.nums.cells.join('／') : '沒有'}）`);

  // 照片列：載不到就不放（R全部拍完的照片都沒有存圖）；旅程中有照片就有（N旅程中有照片）；旅程中沒照片不放、沒有數字與預覽（R旅程中）
  nk = await openTrip(page, 'R全部拍完');
  N = nk ? await homeExtra(page) : null;
  yes(!!N && N.slot && N.slotChecked && N.slotEmpty && !N.shots && !N.nums && !N.plan,
    `N6 全部拍完但照片都載不到：照片列整段不放（算完了 ${N ? N.slotChecked : '?'}、空的 ${N ? N.slotEmpty : '?'}）；還沒結束、沒有這趟的數字（${N ? !!N.nums : '?'}）`);
  nk = await openTrip(page, 'N旅程中有照片');
  N = nk ? await homeExtra(page) : null;
  yes(!!N && !!N.shots && JSON.stringify(N.shots.widths) === '[11]' && !N.nums && !N.plan && !N.flight,
    `N7 旅程中有照片：照片列在（寬度 ${N && N.shots ? JSON.stringify(N.shots.widths) : '沒有'}）；旅程中不放這趟的數字、行程預覽、航班（${JSON.stringify(N && { nums: !!N.nums, plan: !!N.plan, flight: N.flight })}）`);
  nk = await openTrip(page, 'R旅程中');
  N = nk ? await homeExtra(page) : null;
  yes(!!N && N.slotChecked && N.slotEmpty && !N.nums && !N.plan && !N.flight,
    `N11 旅程中沒照片：照片列不放、沒有數字、預覽、航班（${JSON.stringify(N && { slotChecked: N.slotChecked, slotEmpty: N.slotEmpty, nums: !!N.nums, plan: !!N.plan, flight: N.flight })}）`);

  // 出發前：每天的行程預覽＋航班
  const md = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getMonth() + 1}/${d.getDate()}`; };
  // 要的路線從資料讀（第 1 天排第一與最後的站名），不從畫面的函式算
  const preNames = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const rec = s.exportRecords().find((r) => r.type === 'trip' && r.title === 'H還沒出發');
    return rec ? s.spotsOf(rec.id).filter((x) => (x.day || 1) === 1).map((x) => x.name) : [];
  });
  nk = await openTrip(page, 'H還沒出發');
  N = nk ? await homeExtra(page) : null;
  const wantRoute = preNames.length > 1 ? `${preNames[0]} → ${preNames[preNames.length - 1]}` : null;
  yes(preNames.length === 3 && !!N && !!N.plan && N.plan.title === '🗺️ 每天的行程' && N.plan.days.length === 1
    && N.plan.days[0].n === '第 1 天' && N.plan.days[0].d === md(3) && N.plan.days[0].r === wantRoute && N.plan.more === null
    && N.planAfterCard && N.planBeforeTools && N.flight === null && !N.nums,
    `N8 出發前：「每天的行程」預覽一列「${N && N.plan ? N.plan.days.map((d) => `${d.n} ${d.d} ${d.r}`).join('／') : '沒有'}」（要「第 1 天 ${md(3)} ${wantRoute}」）、在下一站卡後面、小工具前面；沒有航班就不放航班（${N ? N.flight : '?'}）`);
  nk = nk && await tap(page, '.trip-home .th-plan', '每天的行程')
    && await soft(page.waitForFunction(() => /\/itinerary$/.test(location.hash) && document.querySelector('.itin-page'), { timeout: 15000 }));
  const planOn = nk ? (await tabState(page)).filter((x) => x.on).map((x) => x.name) : [];
  L = nk ? await itinLayout(page) : null;
  yes(nk && planOn.join() === '行程' && !!L && L.on === '行程' && L.dayShown,
    `N8 點預覽到行程分頁、底部亮「行程」、那一排亮「行程」、看得到每天的行程（${planOn.join('、') || '沒到'}；${JSON.stringify(L && { on: L.on, dayShown: L.dayShown })}）`);
  nk = await openTrip(page, 'N七天');
  N = nk ? await homeExtra(page) : null;
  yes(!!N && !!N.plan && N.plan.days.map((d) => d.n).join() === '第 1 天,第 2 天,第 3 天,第 4 天,第 5 天' && N.plan.days.map((d) => d.r).join() === 'N站1,N站2,N站3,N站4,N站5'
    && N.plan.days[4].d === md(7) && N.plan.more === '還有 2 天 ›',
    `N9 七天的旅程：預覽只列前 5 天、多的寫「還有 2 天」（${N && N.plan ? N.plan.days.map((d) => `${d.n}｜${d.d}｜${d.r}`).join('／') : '沒有'}；${N && N.plan ? N.plan.more : ''}）`);
  nk = await openTrip(page, 'C都買好了');
  N = nk ? await homeExtra(page) : null;
  yes(!!N && N.flight === '✈️ 航班・ZZ123 還有 3 天起飛' && N.flightAfterPlan && N.flightBeforeTools,
    `N10 出發前有航班：「${N ? N.flight || '沒有' : '沒讀到'}」、在行程預覽後面、小工具前面（${JSON.stringify(N && { flightAfterPlan: N.flightAfterPlan, flightBeforeTools: N.flightBeforeTools })}）`);

  console.log('\n主頁與回顧測試結束');
} catch (e) {
  console.log('✗ 例外：' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
