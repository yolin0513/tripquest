// 新姿勢補缺口（v1.95.1；Dispatch 2026-11-19 守夜：「補已知缺口那支測試」）從使用者的入口驗（npm run posetest；會開瀏覽器）
//
// 涵蓋的程式：js/views/trip.js（主頁 tripHome 放哪一張、一次只放一張、天氣讓位、按 ✕ 之後；任務頁沒有景點那一格；
//   進度條頭像；行程分頁「行程｜回顧」的頭像）、js/views/expenses.js（棉棉：沒旅伴、還沒有花費、總帳卡；存檔只丟硬幣、換幣別不動）、
//   js/views/people.js（照片頁還沒有照片：鬍鬍揮手）、js/views/join.js（邀請讀不到：湯圓搔頭、不動）、
//   js/peeks.js（pose、cheer 的零件表）、js/ui.js（mountPose）、css/style.css（.pose-host、.tp-bar、.tp-run、.seg-head）
// v1.95.0 推上線時這些新行為沒有專門的斷言（STATUS 寫明是已知缺口，Dispatch 選甲「推完下一件就補」），這支補上。
// 不重複：首頁空白白兔、回顧白熊、設定頁山雀、徽章「太棒了」上的星星由 mascottest 驗；完成任務照片上那五張由 peektest 驗；
//   主頁講一句的位置與 ✕ 由 saytest 驗；「旅程結束了」卡上小鳳的邊線與動畫由 hometest 驗（這支只補縮放）。
//
// 驗什麼（編號 PSnn 一律兩位數：突變的 expect 比訊息開頭，寫成 PS1 會連 PS10～PS19 一起對到）：
//   主頁（時區撥到當地 10 點、晴天）
//     PS01～PS03 旅程第 2 天：下一站卡上是阿灰拿望遠鏡（scout）、整頁只有這一張；邊線對在卡片上緣、不蓋到上一塊；
//                導覽進來慢慢探上來，零件有轉頭（pk-scan）、整隻擺頭（pk-nod）
//     PS04～PS05 天氣讓位：攔住預報 → 先看到阿灰（前置）；放行、今天會下雨 → 下雨那一句的鬍鬍撐傘出來，阿灰被拿掉、卡片的留白也拿掉
//     PS06～PS07 還沒出發（3 天後）：倒數卡與下一站卡同時在（前置）→ 只放倒數卡上的湯圓（perch），下一站卡沒有
//     PS08～PS09 還沒出發、任務全部拍完：倒數卡與「任務全部完成了」卡同時在（前置）→ 只有卡上的小鳳，倒數卡沒有湯圓
//     PS10      還沒出發、沒有景點：倒數卡在（前置）→ 只有「＋ 去安排景點」上的阿灰指路（point），倒數卡沒有湯圓
//     PS11      同一趟的任務頁：「＋ 去安排景點」上的阿灰指路、跳上來
//     PS12      旅程結束：「旅程結束了」卡上的小鳳縮放 ＝ 新姿勢的 0.6（第一版是 0.3）
//   出發當天（時區撥到當地 9 點、15 點）
//     PS13 早上：出發那一句是鬍鬍揮手（hello），下一站卡沒有阿灰（一次只放一張）
//     PS14 按 ✕ 關掉那一句、切到任務分頁再回主頁：下一站卡出現阿灰（v1.95.1 修的不一致——v1.95.0 這時一張都沒有）
//     PS15 下午：沒有出發那一句，下一站卡有阿灰
//   分帳（棉棉）
//     PS16 沒有旅伴：「去旅程設定加旅伴」上棉棉揮手（hi）、跳上來
//     PS17 有旅伴、還沒有花費：「＋ 記第一筆」上棉棉抱錢包（purse）、跳上來
//     PS18 從那顆鈕記一筆、按儲存：總帳卡上的棉棉不再跳，只把硬幣丟進錢包（pk-still＋pk-coin-go；在動的只有硬幣）
//     PS19 換顯示幣別（自己重畫）：棉棉不動
//     PS20 切到主頁再回分帳（導覽進來）：照常跳上來
//   PS21 照片頁還沒有照片：「回任務清單」上鬍鬍揮手（hello）、跳上來
//   行程分頁的頭像
//     PS22 第一次畫：選中的「行程」前面是鷹、「回顧」的熊藏著；沒有冒出來的動畫；兩顆按鈕一樣高、至少 44px
//     PS23 點「回顧」：熊出來、冒一下（seg-pop），鷹藏起來
//     PS24 再點一次「回顧」（已經選中）：不再冒
//   任務頁進度條的山雀頭像
//     PS25 前置：進度 ≥ 0.5，頭像那一層的框照算會超出畫面（不裁的話整頁會橫向捲動——C 場 layouttest 抓到的那種）
//     PS26 頭像的中心落在進度的位置（軌道左右各縮 13px 之後照比例）
//     PS27 整頁沒有橫向捲動
//     PS28 完成一個任務、慶祝畫面按「繼續下一個」：頭像從舊的進度滑到新的進度（tp-slide，起點終點照兩次的進度）
//   PS29 邀請連結讀不到：「回首頁」上湯圓搔頭（puzzle）、不動（錯誤時不跳）
//   PS30 補充（直接呼叫 peeks.js，不是使用者的路）：九張新姿勢 cheer 之後每一張該有的零件都包到了（圖改過、零件對不上時 cheer 只跳上來不報錯）
//
// 時區用 emulateTimezone 撥（不在 App 裡留測試開關，共用慣例 §5.13）。不打真網路（§5.6）：Open-Meteo 回自己造的預報（可以先攔住、再放行），其餘外站 503。
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
// 沒涵蓋（寫明）：減少動態效果時這些圖不動——cheer() 第一行就是 reducedMotion()，跟 peektest、mascottest 驗過的同一個判斷；
//   徽章按鈕上的星星（mascottest M9）；puzzle 在零件表裡本來就沒有，PS29 防的是以後有人替錯誤狀態加上動作。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5849;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const soft = (p) => p.then(() => true, () => false);
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photoPath = join(mkdtempSync(join(tmpdir(), 'tq-pose-')), 'p.png');
writeFileSync(photoPath, PNG);
const GPS = { latitude: 23.456789, longitude: 120.987654, accuracy: 10 };   // 合成的定位

// 撥到當地幾點：回一個 Etc/GMT±N 時區（同 saytest）
function tzAt(hour) {
  let off = hour - new Date().getUTCHours();
  while (off > 14) off -= 24;
  while (off < -12) off += 24;
  return off === 0 ? 'Etc/GMT' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}
const dateIn = (tz, n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + n * 86400000));

// 造一份 Open-Meteo 預報（同 saytest）：wet＝{ 第幾天（今天＝0）: 'rain'｜'snow' }，其餘晴
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

// 一個獨立的瀏覽情境。state.wet 可以中途換；state.hold 是一個 Promise 時，預報的回應等它放行才送（PS04 天氣讓位用），state.held 數攔了幾個
async function open(tz, wet) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['geolocation']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateTimezone(tz);
  await page.setGeolocation(GPS);
  const state = { wet, hold: null, held: 0 };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(ORIGIN) || /^(data|blob):/.test(u)) { req.continue().catch(() => {}); return; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/.test(u)) {
      const go = () => req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeForecast(tz, state.wet)) }).catch(() => {});
      if (state.hold) { state.held++; state.hold.then(go); } else go();
      return;
    }
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await soft(page.waitForSelector('.hero', { timeout: 20000 }));
  return { ctx, page, state };
}

// 造一趟（內建景點庫的景點，有座標、天氣條才會出來）。
//   member＝false：沒有旅伴（分帳「先加旅伴」那一格）；allDone＝true：每個任務都記成小美拍好了（造狀態，不是被測的路）
const makeTrip = (page, title, start, end, items, { member = true, allDone = false } = {}) => page.evaluate(async (ttl, s0, e0, its, member, allDone) => {
  const s = await import('./js/store.js');
  const { uuid } = await import('./js/ids.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const g = uuid(), t = uuid(), m = uuid();
  await s.put({ id: g, type: 'group', name: 'g' });
  if (member) await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
  await s.put({ id: t, type: 'trip', groupId: g, title: ttl, region: '台北', allowWiki: false, startDate: s0, endDate: e0 });
  let spots = [], quests = [];
  if (its.length) ({ spots, quests } = await generateForTrip({ tripId: t, region: '台北', items: its.map((x) => ({ ...x, region: '台北' })) }));
  for (const x of spots) await s.put(x);
  for (const x of quests) await s.put(x);
  if (allDone && member) for (const q of quests) await s.put({ id: uuid(), type: 'submission', tripId: t, questId: q.id, memberId: m, photoHash: 'h' + q.id, createdAt: Date.now() });
  if (member) await (await import('./js/claim.js')).claim(t, m);
  return { t, spots: spots.length, quests: quests.length };
}, title, start, end, items, member, allDone);

// 首頁點旅程卡進主頁（使用者的路；導覽進主頁才算 fresh）。wx＝true：等天氣條（提示那一行）出來
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
// 點底部分頁（使用者的路），等那一頁的標記出來。text：標記裡還要有這段字——空白頁的按鈕（.page .empty .btn）每一頁都有，
// 只等選擇器的話上一頁就已經成立，還沒換頁就開始量（第一次跑 PS17～PS20 紅、PS11 在主頁上量到同一張圖而假綠，2026-11-19）
async function tab(page, label, mark, text = null) {
  if (!await tap(page, '#tabbar a.tab', label)) return false;
  const ok = await soft(page.waitForFunction((m, t) => [...document.querySelectorAll(m)].some((e) => t == null || e.textContent.includes(t)), { timeout: 15000 }, mark, text));
  if (!ok) console.log(`  [等不到] 分頁「${label}」的 ${mark}${text ? `（含「${text}」）` : ''}：`, await page.evaluate(() => `${location.hash}｜${(document.querySelector('#view, main, body')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200)}`).catch(() => '讀不到'));
  await sleep(300);
  return ok;
}

// 量一張新姿勢：宿主（選擇器＋可選的字）底下直接掛的那一張探頭圖
//   rimGap：邊線（圖底往上 --pk-sink）離宿主外框上緣幾 px（CSS 把邊線放在內距上緣往上 2px＝2px 邊框的外緣）
//   clear：圖頂離上面那一塊（宿主前面最近一個看得到的兄弟，沒有就是父元素內距上緣）的底幾 px——負的＝蓋到上面的字
//   parts：cheer() 包出來的零件（每一個 class 有沒有出現）；hopRun：跳上來那一層身上的動畫段數；names：整張圖上在跑的動畫名字
const PARTS = ['pk-hop', 'pk-grip', 'pk-wave', 'pk-wave-r', 'pk-wave-lines', 'pk-coin', 'pk-flap', 'pk-sway', 'pk-scan', 'pk-nod', 'pk-shine'];
const poseOn = (page, hostSel, text = null) => page.evaluate((hs, text, PARTS) => {
  const host = [...document.querySelectorAll(hs)].find((e) => text == null || e.textContent.includes(text));
  if (!host) return { host: false, found: false };
  host.scrollIntoView({ block: 'center' });
  const hostCls = host.classList.contains('has-peek') && host.classList.contains('pose-host');
  const el = host.querySelector(':scope > svg.gl-peek');
  if (!el) return { host: true, found: false, hostCls };
  const r = el.getBoundingClientRect(), b = host.getBoundingClientRect();
  const sink = parseFloat(el.style.getPropertyValue('--pk-sink'));
  let prev = host.previousElementSibling;
  while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
  const par = host.parentElement;
  const above = prev ? prev.getBoundingClientRect().bottom : par.getBoundingClientRect().top + parseFloat(getComputedStyle(par).paddingTop);
  const vb = el.viewBox && el.viewBox.baseVal;
  const hop = el.querySelector('.pk-hop');
  const anims = el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
  return {
    host: true, found: true, hostCls, kind: el.dataset.peek, pose: el.classList.contains('pose'),
    rimGap: Number.isFinite(sink) ? +(r.bottom - sink - b.top).toFixed(2) : null, sink, clear: +(r.top - above).toFixed(1), prev: prev ? prev.className || prev.tagName : '（父元素上緣）',
    inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
    scale: vb && vb.width ? +(r.width / vb.width).toFixed(3) : null,
    cheer: el.classList.contains('pk-cheer'), soft: el.classList.contains('pk-soft'), still: el.classList.contains('pk-still'), coinGo: el.classList.contains('pk-coin-go'),
    parts: PARTS.filter((c) => el.querySelector('.' + c)),
    hopRun: hop ? hop.getAnimations().length : 0,
    names: [...new Set(anims.map((a) => a.animationName || '?'))],
    hidden: el.getAttribute('aria-hidden') === 'true',
  };
}, hostSel, text, PARTS);
const pb = (p) => !p.host ? '找不到宿主' : !p.found ? `宿主在、沒有圖（宿主留白 class ${p.hostCls}）`
  : `${p.kind}；宿主留白 ${p.hostCls}；邊線差 ${p.rimGap}、離上一塊（${p.prev}）${p.clear}、邊線以下 ${p.sink}px、在畫面裡 ${p.inView}；`
    + `cheer ${p.cheer}${p.soft ? '／soft' : ''}${p.still ? '／still' : ''}${p.coinGo ? '／coin-go' : ''}；零件 ${p.parts.join(' ') || '無'}；跳那層 ${p.hopRun} 段；在跑 ${p.names.join(' ') || '無'}`;
// 幾何：邊線對在宿主上緣（差 ≤ 2.5：沒有邊框的宿主差 2）、不蓋到上一塊、邊線以下 ≤ 12.5px（0.6 × 20 個畫布單位）、整張在畫面裡
const placed = (p) => p.found && p.pose && p.hostCls && p.hidden && p.rimGap != null && Math.abs(p.rimGap) <= 2.5 && p.clear >= -0.5 && p.sink <= 12.5 && p.inView;
// 這一張該有的零件（js/peeks.js 的 CHEER；pk-hop 每一張都有）
const WANT = { hi: ['pk-wave', 'pk-wave-lines'], purse: ['pk-wave', 'pk-coin'], hello: ['pk-wave-r', 'pk-wave-lines'], perch: ['pk-flap'], board: ['pk-sway'],
  scout: ['pk-scan', 'pk-nod'], point: ['pk-wave'], star: ['pk-shine'], puzzle: [] };
const hasParts = (p, kind) => !!p.found && ['pk-hop', ...WANT[kind]].every((c) => p.parts.includes(c));
// 跳上來（導覽進來）：cheer、沒有 still、零件齊、跳那一層真的在動
const hopped = (p, kind, soft = false) => p.found && p.kind === kind && p.cheer && !p.still && p.soft === soft && hasParts(p, kind) && p.hopRun > 0;
// 整頁（主頁）每一張探頭圖：哪一張@掛在哪
const peeksIn = (page, root = '.trip-home') => page.evaluate((root) => [...document.querySelectorAll(`${root} svg.gl-peek`)]
  .map((e) => `${e.dataset.peek}@${e.parentElement.classList[0] || e.parentElement.tagName}`), root);
const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);

// 完成一個任務（任務頁 → 那一站第一列「從相簿選」），等慶祝畫面出來（同 saytest）
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
  return soft(page.waitForSelector('.celebrate', { timeout: 30000 }));
}
// 慶祝畫面：先按指定的那一顆（真的滑鼠），之後跳出來的（新徽章）按「太棒了」
async function finishCelebrations(page, first) {
  let ok = await tap(page, '.celebrate .btn', first);
  for (let k = 0; k < 8; k++) {
    await sleep(500);
    if (!await page.$('.celebrate')) break;
    ok = await tap(page, '.celebrate .btn', '太棒了') && ok;
  }
  await sleep(600);
  return ok && !await page.$('.celebrate');
}

const ITEMS = [{ name: '龍山寺', day: 1 }, { name: '台北101', day: 1 }, { name: '士林夜市', day: 2 }];
const NO = { host: false, found: false };

try {
  // ================= 主頁（當地 10 點、晴天）＋分帳、照片、行程分頁、進度條 =================
  {
    const tz = tzAt(10);
    const { ctx, page, state } = await open(tz, {});
    const T2 = await makeTrip(page, '二日遊', dateIn(tz, -1), dateIn(tz, 1), ITEMS);
    await makeTrip(page, '倒數三天', dateIn(tz, 3), dateIn(tz, 5), ITEMS);
    await makeTrip(page, '全部拍完', dateIn(tz, 3), dateIn(tz, 5), ITEMS, { allDone: true });
    await makeTrip(page, '還沒排景點', dateIn(tz, 3), dateIn(tz, 5), []);
    await makeTrip(page, '已經結束', dateIn(tz, -3), dateIn(tz, -1), ITEMS);
    await makeTrip(page, '沒有旅伴', dateIn(tz, -1), dateIn(tz, 1), [], { member: false });

    // ---- PS01～PS03 第 2 天：下一站卡上的阿灰 ----
    let ok = await openTrip(page, '二日遊');
    let P = ok ? await poseOn(page, '.trip-home .today-card') : NO;
    let L = ok ? await peeksIn(page) : [];
    yes(ok && P.found && P.kind === 'scout' && L.length === 1 && !await has(page, '.trip-home .countdown'),
      `PS01 旅程第 2 天的主頁：下一站卡上是阿灰拿望遠鏡、整頁只有這一張探頭圖（${pb(P)}；整頁 ${L.join('、') || '一張都沒有'}）`);
    yes(placed(P), `PS02 下一站卡上的阿灰：邊線對在卡片上緣、不蓋到上一塊、邊線以下 ≤ 12.5px、整張在畫面裡（${pb(P)}）`);
    yes(hopped(P, 'scout', true), `PS03 下一站卡上的阿灰：導覽進來慢慢探上來（soft），零件有轉頭（pk-scan）與擺頭（pk-nod）（${pb(P)}）`);

    // ---- PS04～PS05 天氣讓位 ----
    let release = () => {};
    state.hold = new Promise((r) => { release = r; });
    state.held = 0;
    state.wet = { 0: 'rain' };
    ok = await openTrip(page, '二日遊', false);
    ok = ok && await soft(page.waitForSelector('.trip-home .today-card.pose-host > svg.gl-peek', { timeout: 10000 }));
    for (let k = 0; k < 50 && !state.held; k++) await sleep(100);
    P = ok ? await poseOn(page, '.trip-home .today-card') : NO;
    const saysBefore = ok ? await page.evaluate(() => document.querySelectorAll('.trip-home .say').length) : -1;
    yes(ok && state.held >= 1 && P.found && P.kind === 'scout' && saysBefore === 0,
      `PS04 前置：預報被攔住（${state.held} 個）時主頁先畫好——下一站卡上是阿灰、還沒有天氣那一句（${pb(P)}；講的句子 ${saysBefore}）`);
    state.hold = null;
    release();
    const rained = ok && await soft(page.waitForSelector('.trip-home .say svg.gl-peek[data-peek="rain"]', { timeout: 15000 }));
    await sleep(300);
    P = rained ? await poseOn(page, '.trip-home .today-card') : NO;
    L = rained ? await peeksIn(page) : [];
    yes(rained && P.host && !P.found && !P.hostCls && L.length === 1 && L[0].startsWith('rain@'),
      `PS05 預報放行、今天會下雨：下雨那一句的鬍鬍撐傘出來，下一站卡上的阿灰拿掉、卡片的留白也拿掉，整頁只剩那一張（${pb(P)}；整頁 ${L.join('、') || '一張都沒有'}）`);
    state.wet = {};

    // ---- PS06～PS07 還沒出發：倒數卡優先 ----
    ok = await openTrip(page, '倒數三天');
    const pre6 = ok && await has(page, '.trip-home .countdown') && await has(page, '.trip-home .today-card');
    yes(pre6, `PS06 前置：還沒出發的主頁倒數卡與下一站卡同時在（倒數卡 ${ok && await has(page, '.trip-home .countdown')}、下一站卡 ${ok && await has(page, '.trip-home .today-card')}）`);
    P = ok ? await poseOn(page, '.trip-home .countdown') : NO;
    let Q = ok ? await poseOn(page, '.trip-home .today-card') : NO;
    L = ok ? await peeksIn(page) : [];
    yes(pre6 && P.kind === 'perch' && placed(P) && hopped(P, 'perch', true) && Q.host && !Q.found && L.length === 1,
      `PS07 倒數卡與下一站卡都在時只放倒數卡：倒數卡上是湯圓坐著（邊線對齊、不蓋字、慢慢探上來、拍翅膀），下一站卡沒有（倒數卡 ${pb(P)}；下一站卡 ${pb(Q)}；整頁 ${L.join('、') || '一張都沒有'}）`);

    // ---- PS08～PS09 還沒出發、全部拍完：卡上的小鳳優先 ----
    ok = await openTrip(page, '全部拍完');
    const pre8 = ok && await has(page, '.trip-home .countdown') && await has(page, '.trip-home .th-end') && !await has(page, '.trip-home .today-card');
    yes(pre8, `PS08 前置：出發前就全部拍完——倒數卡與「任務全部完成了」卡同時在、沒有下一站卡（${ok ? (await page.evaluate(() => [...document.querySelector('.trip-home').children].map((e) => e.classList[0] || e.tagName).join(' '))) : '沒進主頁'}）`);
    P = ok ? await poseOn(page, '.trip-home .countdown') : NO;
    L = ok ? await peeksIn(page) : [];
    yes(pre8 && P.host && !P.found && L.length === 1 && L[0] === 'done@th-end',
      `PS09 「任務全部完成了」卡上已經有小鳳：倒數卡上不放湯圓，整頁只有卡上那一張（倒數卡 ${pb(P)}；整頁 ${L.join('、') || '一張都沒有'}）`);

    // ---- PS10～PS11 還沒排景點 ----
    ok = await openTrip(page, '還沒排景點', false);
    P = ok ? await poseOn(page, '.trip-home .th-empty .btn', '去安排景點') : NO;
    Q = ok ? await poseOn(page, '.trip-home .countdown') : NO;
    L = ok ? await peeksIn(page) : [];
    yes(ok && Q.host && P.kind === 'point' && placed(P) && hopped(P, 'point') && !Q.found && L.length === 1,
      `PS10 還沒出發、沒有景點：倒數卡在（前置），只有「＋ 去安排景點」上的阿灰指路（跳上來、揮翅膀），倒數卡沒有湯圓（按鈕 ${pb(P)}；倒數卡 ${pb(Q)}；整頁 ${L.join('、') || '一張都沒有'}）`);
    // 任務頁：.page 但不是 .trip-home（主頁那一格也是 .empty、按鈕字一樣）
    ok = ok && await tab(page, '任務', '.page:not(.trip-home) > .empty .btn', '去安排景點');
    P = ok ? await poseOn(page, '.page:not(.trip-home) > .empty .btn', '去安排景點') : NO;
    yes(ok && P.kind === 'point' && placed(P) && hopped(P, 'point'),
      `PS11 同一趟的任務頁：「＋ 去安排景點」上的阿灰指路、跳上來（${pb(P)}）`);

    // ---- PS12 旅程結束：卡上小鳳的縮放 ----
    ok = await openTrip(page, '已經結束', false);
    P = ok ? await poseOn(page, '.trip-home .th-end') : NO;
    L = ok ? await peeksIn(page) : [];
    yes(ok && P.kind === 'done' && P.scale != null && Math.abs(P.scale - 0.6) <= 0.01 && L.length === 1,
      `PS12 「旅程結束了」卡上的小鳳：每個畫布單位畫成 0.6px（跟其他新姿勢一樣；第一版 0.3），整頁只有這一張（縮放 ${P.scale}；整頁 ${L.join('、') || '一張都沒有'}）`);

    // ---- PS16 分帳：沒有旅伴 ----
    ok = await openTrip(page, '沒有旅伴', false);
    ok = ok && await tab(page, '分帳', '.page .empty .btn', '加旅伴');
    P = ok ? await poseOn(page, '.page .empty .btn', '加旅伴') : NO;
    yes(ok && P.kind === 'hi' && placed(P) && hopped(P, 'hi'),
      `PS16 分帳、還沒有旅伴：「去旅程設定加旅伴」上棉棉揮手、跳上來（${pb(P)}）`);

    // ---- PS21 照片頁還沒有照片（二日遊，還沒拍任何一張）----
    ok = await openTrip(page, '二日遊');
    ok = ok && await tab(page, '照片', '.page .empty .btn', '回任務清單');
    P = ok ? await poseOn(page, '.page .empty .btn', '回任務清單') : NO;
    yes(ok && P.kind === 'hello' && placed(P) && hopped(P, 'hello'),
      `PS21 照片頁還沒有照片：「回任務清單」上鬍鬍揮手、跳上來（${pb(P)}）`);

    // ---- PS17～PS20 分帳（二日遊，一位旅伴）----
    // 「＋ 記第一筆」不在 .empty 裡：是它後面的兄弟、直接掛在 .page 底下（上一塊＝.empty 那幾行字）
    ok = ok && await tab(page, '分帳', '.page > .btn', '記第一筆');
    P = ok ? await poseOn(page, '.page > .btn', '記第一筆') : NO;
    yes(ok && P.kind === 'purse' && placed(P) && hopped(P, 'purse'),
      `PS17 分帳、還沒有花費：「＋ 記第一筆」上棉棉抱錢包、跳上來（${pb(P)}）`);
    let saved = false;
    if (ok && await tap(page, '.page > .btn', '記第一筆') &&await soft(page.waitForSelector('#modalRoot .exp-form', { timeout: 6000 }))) {
      await sleep(250);
      for (const d of ['1', '2', '0']) {
        for (const k of await page.$$('#modalRoot .numpad-key')) if ((await k.evaluate((e) => e.textContent.trim())) === d) { await k.click(); break; }
      }
      const ti = await page.$('#modalRoot .exp-form input.field[type=text]');
      if (ti) { await ti.click(); await ti.type('午餐'); }
      for (const b of await page.$$('#modalRoot .modal-actions button')) if ((await b.evaluate((e) => e.textContent.trim())) === '儲存') { await b.click(); break; }
      saved = await soft(page.waitForFunction(() => !document.querySelector('#modalRoot .exp-form') && document.querySelector('.exp-summary > svg.gl-peek'), { timeout: 8000 }));
      await sleep(200);
    }
    P = saved ? await poseOn(page, '.exp-summary') : NO;
    yes(saved && P.kind === 'purse' && P.cheer && P.still && P.coinGo && P.hopRun === 0 && P.names.length > 0 && P.names.every((n) => /^pk-(coin|drop)$/.test(n)),
      `PS18 記一筆按儲存：總帳卡上的棉棉不再跳（pk-still），只把硬幣丟進錢包（pk-coin-go；在動的只有硬幣）（${pb(P)}）`);
    let quiet = false;
    const curBefore = saved ? await page.evaluate(() => [...document.querySelectorAll('.page .btn')].find((b) => b.textContent.includes('點這裡換'))?.textContent || '') : '';
    if (saved && await tap(page, '.page .btn', '點這裡換') && await soft(page.waitForSelector('#modalRoot .modal-actions button', { timeout: 6000 }))) {
      const want = curBefore.includes('JPY') ? 'USD' : 'JPY';
      if (await tap(page, '#modalRoot .modal-actions button', want)) {
        quiet = await soft(page.waitForFunction((w) => [...document.querySelectorAll('.page .btn')].some((b) => b.textContent.includes('點這裡換') && b.textContent.includes(w))
          && document.querySelector('.exp-summary > svg.gl-peek'), { timeout: 8000 }, want));
        await sleep(300);
      }
    }
    P = quiet ? await poseOn(page, '.exp-summary') : NO;
    yes(quiet && P.kind === 'purse' && !P.cheer && P.names.length === 0,
      `PS19 換顯示幣別（這一頁自己重畫）：棉棉照樣在、不動（${curBefore.replace(/（.*$/, '') || '沒找到換幣別的鈕'} → 換了 ${quiet}；${pb(P)}）`);
    ok = quiet && await tab(page, '主頁', '.trip-home') && await tab(page, '分帳', '.exp-summary > svg.gl-peek');
    P = ok ? await poseOn(page, '.exp-summary') : NO;
    yes(ok && P.kind === 'purse' && P.cheer && !P.still && !P.coinGo && P.hopRun > 0,
      `PS20 切到主頁再回分帳（導覽進來）：總帳卡上的棉棉照常跳上來（${pb(P)}）`);

    // ---- PS22～PS24 行程分頁「行程｜回顧」的頭像 ----
    ok = await tab(page, '行程', '.itin-seg button.on');
    const seg = () => page.evaluate(() => [...document.querySelectorAll('.itin-seg button')].map((b) => {
      const hd = b.querySelector('.seg-head');
      return { t: b.textContent.trim(), on: b.classList.contains('on'), vis: !!hd && getComputedStyle(hd).display !== 'none' && hd.getBoundingClientRect().width > 0,
        who: hd?.querySelector('svg')?.getAttribute('data-mascot') || null, hid: hd?.getAttribute('aria-hidden') === 'true', pop: !!hd && hd.classList.contains('seg-pop'),
        h: Math.round(b.getBoundingClientRect().height) };
    }));
    const sb = (S) => S.map((s) => `${s.t}${s.on ? '（選中）' : ''}：${s.who}${s.vis ? '看得到' : '藏著'}${s.pop ? '、冒' : ''}、高 ${s.h}`).join('；');
    let S = ok ? await seg() : [];
    const [sp, sm] = [S.find((s) => s.t === '行程'), S.find((s) => s.t === '回顧')];
    yes(ok && sp && sm && sp.on && sp.vis && sp.who === 'hawk' && sp.hid && !sm.on && !sm.vis && sm.who === 'bear' && !sp.pop && !sm.pop && sp.h === sm.h && sp.h >= 44,
      `PS22 行程分頁第一次畫：選中的「行程」前面是鷹、「回顧」的熊藏著、沒有冒出來的動畫、兩顆一樣高且 ≥ 44px（${sb(S)}）`);
    const watchPops = () => page.evaluate(() => {
      window.__pops = [];
      for (const hd of document.querySelectorAll('.itin-seg .seg-head')) {
        new MutationObserver(() => { if (hd.classList.contains('seg-pop')) window.__pops.push(hd.closest('button').textContent.trim()); }).observe(hd, { attributes: true, attributeFilter: ['class'] });
      }
    });
    if (ok) await watchPops();
    const c1 = ok && await tap(page, '.itin-seg button', '回顧');
    await sleep(500);
    S = c1 ? await seg() : [];
    let pops = c1 ? await page.evaluate(() => window.__pops) : [];
    const [sp2, sm2] = [S.find((s) => s.t === '行程'), S.find((s) => s.t === '回顧')];
    yes(c1 && sm2 && sp2 && sm2.on && sm2.vis && !sp2.vis && pops.length === 1 && pops[0] === '回顧',
      `PS23 點「回顧」：熊出來、冒一下（seg-pop 加在回顧那一顆），鷹藏起來（冒過的：${pops.join('、') || '沒有'}；${sb(S)}）`);
    if (c1) await page.evaluate(() => { window.__pops = []; });
    const c2 = c1 && await tap(page, '.itin-seg button', '回顧');
    await sleep(500);
    pops = c2 ? await page.evaluate(() => window.__pops) : ['（沒點到）'];
    S = c2 ? await seg() : [];
    yes(c2 && pops.length === 0 && S.find((s) => s.t === '回顧')?.on,
      `PS24 再點一次已經選中的「回顧」：不再冒（冒過的：${pops.join('、') || '沒有'}；${sb(S)}）`);

    // ---- PS25～PS28 任務頁進度條的山雀頭像（二日遊：只留第二天那一站最後 2 個任務沒拍）----
    // 造進度（前置的資料，不是被測的路）：其餘任務記成小美拍好了，只留第二天那一站（今天）最後 2 個——1 個給 PS28 自己拍、拍完還沒全部完成
    const prog = await page.evaluate(async (t) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const spots = s.spotsOf(t), day2 = spots.find((x) => (x.day || 1) === 2);
      const m = s.membersOf(s.get(t).groupId)[0];
      const quests = spots.flatMap((x) => s.questsOf(x.id));
      const keep = new Set(day2 ? s.questsOf(day2.id).slice(-2).map((q) => q.id) : []);
      for (const q of quests) if (!keep.has(q.id)) await s.put({ id: uuid(), type: 'submission', tripId: t, questId: q.id, memberId: m.id, photoHash: 'h' + q.id, createdAt: Date.now() });
      return { day2: day2 ? day2.name : null, total: quests.length, keep: keep.size };
    }, T2.t).catch((e) => ({ err: String(e) }));
    if (prog.err) console.log('  [造進度失敗]', prog.err);
    ok = !!prog.day2 && prog.keep === 2 && await tab(page, '任務', '.task-prog .tp-bar');
    const bar = () => page.evaluate(() => {
      const title = document.querySelector('.task-prog .tp-title')?.textContent || '';
      const m = /已完成\s*(\d+)\s*\/\s*(\d+)/.exec(title);
      const bar = document.querySelector('.tp-bar'), run = bar?.querySelector('.tp-run'), av = run?.querySelector('svg');
      if (!bar || !run || !av) return { title, found: false };
      const br = bar.getBoundingClientRect(), rr = run.getBoundingClientRect(), ar = av.getBoundingClientRect();
      const tr = bar.querySelector('.progress-track').getBoundingClientRect();
      return {
        found: true, title, ratio: m ? +m[1] / +m[2] : null,
        avX: +(ar.left + ar.width / 2 - br.left).toFixed(2), avY: +(ar.top + ar.height / 2 - (tr.top + tr.height / 2)).toFixed(2), barW: +br.width.toFixed(2),
        runRight: +rr.right.toFixed(1), vw: innerWidth,
        docW: document.documentElement.scrollWidth, cliW: document.documentElement.clientWidth,
        slide: run.classList.contains('tp-slide'), from: run.style.getPropertyValue('--tp-from'), to: run.style.getPropertyValue('--tp-to'),
        anim: getComputedStyle(run).animationName,
      };
    });
    let B = ok ? await bar() : { found: false };
    yes(ok && B.found && B.ratio >= 0.5 && B.ratio < 1 && B.runRight > B.vw,
      `PS25 前置：進度 ≥ 0.5（${B.title || '沒有進度那一行'}），頭像那一層的框照算超出畫面（框右緣 ${B.runRight}、畫面寬 ${B.vw}）——不裁的話整頁會橫向捲動`);
    const wantX = B.found && B.ratio != null ? 13 + B.ratio * (B.barW - 26) : null;
    yes(B.found && wantX != null && Math.abs(B.avX - wantX) <= 1.5 && Math.abs(B.avY) <= 1.5,
      `PS26 頭像的中心落在進度的位置：離軌道左端 ${B.avX}px（應為 13 + ${B.ratio != null ? B.ratio.toFixed(3) : '?'} ×（${B.barW} − 26）＝ ${wantX != null ? wantX.toFixed(2) : '?'}）、上下差 ${B.avY}px`);
    yes(B.found && B.docW <= B.cliW, `PS27 任務頁沒有橫向捲動（整頁內容寬 ${B.docW}、畫面寬 ${B.cliW}）`);
    const fromPct = B.found ? `${(B.ratio * 100).toFixed(2)}%` : null;
    const celeb = ok && await completeOne(page, prog.day2);
    const fin = celeb && await finishCelebrations(page, '繼續下一個');
    B = fin ? await bar() : { found: false };
    const toPct = B.found && B.ratio != null ? `${(B.ratio * 100).toFixed(2)}%` : null;
    yes(fin && B.found && B.slide && B.from === fromPct && B.to === toPct && fromPct !== toPct && B.anim === 'tp-slide',
      `PS28 完成一個任務、按「繼續下一個」：頭像從舊的進度滑到新的進度（${B.title || '沒有進度那一行'}；tp-slide ${B.slide}、起點 ${B.from || '無'}（應為 ${fromPct}）、終點 ${B.to || '無'}（應為 ${toPct}）、動畫 ${B.anim || '無'}）`);
    await ctx.close();
  }

  // ================= 出發當天早上（當地 9 點、晴天）=================
  {
    const tz = tzAt(9);
    const { ctx, page } = await open(tz, {});
    await makeTrip(page, '出發日', dateIn(tz, 0), dateIn(tz, 2), ITEMS);
    let ok = await openTrip(page, '出發日');
    const dep = ok ? await page.evaluate(() => {
      const el = document.querySelector('.trip-home .say');
      const pk = el && el.querySelector('svg.gl-peek');
      return el ? { key: el.dataset.say, kind: pk ? pk.dataset.peek : null } : null;
    }) : null;
    const H = ok ? await page.evaluate((PARTS) => {
      const pk = document.querySelector('.trip-home .say svg.gl-peek');
      return pk ? { cheer: pk.classList.contains('pk-cheer'), soft: pk.classList.contains('pk-soft'), parts: PARTS.filter((c) => pk.querySelector('.' + c)) } : null;
    }, PARTS) : null;
    let Q = ok ? await poseOn(page, '.trip-home .today-card') : NO;
    let L = ok ? await peeksIn(page) : [];
    yes(ok && dep && dep.kind === 'hello' && H && H.cheer && H.soft && ['pk-hop', ...WANT.hello].every((c) => H.parts.includes(c)) && Q.host && !Q.found && L.length === 1,
      `PS13 出發當天早上：出發那一句是鬍鬍揮手（慢慢探上來、揮手、揮動線），下一站卡沒有阿灰、整頁只有這一張（那一句 ${dep ? `${dep.key}／${dep.kind}` : '沒有'}；零件 ${H ? H.parts.join(' ') : '無'}；下一站卡 ${pb(Q)}；整頁 ${L.join('、') || '一張都沒有'}）`);
    let closed = false;
    if (dep && dep.key) {
      const x = await page.$(`.trip-home .say[data-say="${dep.key}"] .say-x`);
      const k = x ? await userClick(page, x, '出發那一句的 ✕') : { ok: false, why: '沒有 ✕' };
      if (!k.ok) console.log('  [點不到]', k.why);
      closed = k.ok && await soft(page.waitForFunction((key) => !document.querySelector(`.trip-home .say[data-say="${key}"]`), { timeout: 5000 }, dep.key));
    }
    ok = closed && await tab(page, '任務', '.qcollapse') && await tab(page, '主頁', '.trip-home .wx-slot .wx-strip .wx-strip-tip');
    Q = ok ? await poseOn(page, '.trip-home .today-card') : NO;
    L = ok ? await peeksIn(page) : [];
    const sayLeft = ok ? await page.evaluate(() => document.querySelectorAll('.trip-home .say').length) : -1;
    yes(ok && sayLeft === 0 && Q.kind === 'scout' && placed(Q) && L.length === 1,
      `PS14 按 ✕ 關掉出發那一句、切到任務分頁再回主頁：那一句不再出現，下一站卡上出現阿灰（按到 ✕ ${closed}；講的句子 ${sayLeft}；下一站卡 ${pb(Q)}；整頁 ${L.join('、') || '一張都沒有'}）`);
    await ctx.close();
  }

  // ================= 出發當天下午（當地 15 點、晴天）=================
  {
    const tz = tzAt(15);
    const { ctx, page } = await open(tz, {});
    await makeTrip(page, '出發日', dateIn(tz, 0), dateIn(tz, 2), ITEMS);
    const ok = await openTrip(page, '出發日');
    const Q = ok ? await poseOn(page, '.trip-home .today-card') : NO;
    const L = ok ? await peeksIn(page) : [];
    const n = ok ? await page.evaluate(() => document.querySelectorAll('.trip-home .say').length) : -1;
    yes(ok && n === 0 && Q.kind === 'scout' && placed(Q) && hopped(Q, 'scout', true) && L.length === 1,
      `PS15 出發當天下午：沒有出發那一句，下一站卡上有阿灰、慢慢探上來（講的句子 ${n}；下一站卡 ${pb(Q)}；整頁 ${L.join('、') || '一張都沒有'}）`);
    await ctx.close();
  }

  // ================= 邀請連結讀不到 =================
  {
    const tz = tzAt(10);
    const { ctx, page } = await open(tz, {});
    await page.goto(`${ORIGIN}/#/join?j=not-an-invite`, { waitUntil: 'networkidle0' }).catch(() => {});
    const ok = await soft(page.waitForFunction(() => [...document.querySelectorAll('.page .empty .btn')].some((b) => b.textContent.includes('回首頁')), { timeout: 15000 }));
    await sleep(400);
    const P = ok ? await poseOn(page, '.page .empty .btn', '回首頁') : NO;
    const msg = ok ? await page.evaluate(() => document.querySelector('.page .empty p')?.textContent || '') : '';
    yes(ok && msg.includes('無法解析') && P.kind === 'puzzle' && placed(P) && !P.cheer && P.names.length === 0 && P.parts.length === 0,
      `PS29 邀請連結讀不到：「回首頁」上湯圓搔頭、不動（錯誤時不跳）（「${msg}」；${pb(P)}）`);

    // ---- PS30 補充：零件表 ----
    const T = await page.evaluate(async (WANT) => {
      const pk = await import('./js/peeks.js');
      const out = {};
      for (const kind of Object.keys(WANT)) {
        const el = pk.pose(kind, 'c');
        const moved = pk.cheer(el);
        out[kind] = { moved, parts: ['pk-hop', ...WANT[kind]].filter((c) => !el.querySelector('.' + c)), cheer: el.classList.contains('pk-cheer') };
      }
      return out;
    }, WANT).catch((e) => ({ err: String(e) }));
    const bad = T.err ? [T.err] : Object.entries(T).filter(([k, v]) => (k === 'puzzle' ? (v.moved || v.cheer) : (!v.moved || v.parts.length))).map(([k, v]) => `${k}：動了 ${v.moved}、缺 ${v.parts.join(' ') || '無'}`);
    yes(!T.err && Object.keys(T).length === 9 && bad.length === 0,
      `PS30 補充（直接呼叫 peeks.js）：九張新姿勢 cheer 之後零件都包到了、puzzle 不動（查了 ${T.err ? 0 : Object.keys(T).length} 張；不對的：${bad.join('；') || '沒有'}）`);
    await ctx.close();
  }
} catch (e) {
  yes(false, `例外：${e && e.stack || e}`);
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過（新姿勢補缺口）` + (process.exitCode ? '，有失敗' : ''));
