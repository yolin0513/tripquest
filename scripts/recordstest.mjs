// 三樣新紀錄的畫面測試：待買清單、住宿、航班（npm run recordstest；在 test:chain 裡）。
// 涵蓋的程式：js/buylist.js js/views/buy.js js/stays.js js/views/stays.js js/flights.js js/views/flights.js js/views/trip.js js/store.js js/app.js css/style.css
// 從一次性的 _buyshots／_stayshots／_flightshots（被 .gitignore 擋）搬進來：2026-11-06 Dispatch 明早清單第 1 項——
// 三樣只被不會自動跑的腳本驗過（2026-11-06 凌晨實測 10/10、13/13、15/15）。截圖留在一次性腳本，這支只放斷言。
// 走真實入口：行程頁的入口鈕 → 畫面上的按鈕、輸入框、表單；勾選與刪除走畫面上的鈕（確認框也點）。
// 資料合成（2024 年、名稱自編）；航班倒數依手機日期，所以起飛日用「今天 ± N」相對算。外網請求一律攔掉、只計數。
// 合併語意（刪了又回來、舊版 Worker 刪 _f、既有型別寫入 0 次）在 mergetest、真的 Worker 在 workertest，這支不重複。
// 版面（2026-11-11，Yolin iPhone 實機截圖：日期／時間框撐出卡片、黏底的「存／取消」蓋住「到哪裡」）：見下面「版面」那一段。
// ⚠ 那一段量日期框寬度靠的是「注入模擬 iOS 最小寬度」，不是真機——Chromium 重現不出 iOS 的最小寬度。全綠不等於在 iPhone 上驗過。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { blankTextScan } from './blanktext.mjs';
import { clickText } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5799;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0, blocked = 0;
const yes = (c, m, x) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m + (x ? '｜' + x : '')); } };
const iso = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  page.on('dialog', (d) => d.accept());
  await page.setRequestInterception(true);
  page.on('request', (rq) => { if (new URL(rq.url()).hostname !== 'localhost') { blocked++; return rq.abort(); } rq.continue(); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  return page;
}
// 種一個行程（store.put 是 App 自己的寫入路徑；畫面上建行程有自己的測試）
const seedTrip = (page, a, b, member) => page.evaluate(async (a, b, member) => {
  const s = await import('./js/store.js');
  let k = 0; const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
  const gid = uuid(), tid = uuid(), mid = uuid();
  await s.put({ id: gid, type: 'group', name: '家族' });
  if (member) await s.put({ id: mid, type: 'member', groupId: gid, name: member });
  await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例小旅行', region: '範例', startDate: a, endDate: b });
  await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '甲・車站', emoji: '📍', day: 1, order: 0 });
  return { tid, mid };
}, a, b, member);
// 動作列的鈕一律用 puppeteer 原生的 page.click（它只在鈕不在畫面裡時才捲，捲完照鈕中心點下去）——
// 那正是 2026-11-06 _flightshots 點「存」點到「照片」分頁的點法。動作列黏底那段期間（11-06～11-11）這裡改用「照現在位置點」繞過，
// 拿掉黏底之後改回原生點法：「存」又落到分頁列後面時，這些點擊會點錯、後面的斷言跟著紅。
const fillForm = (page, form) => async (v) => {
  for (const [k, val] of Object.entries(v)) {
    await page.$eval(`${form} input[data-k="${k}"]`, (el, x) => { el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); }, val);
  }
};
// 按鈕中心那一點最上層的元素是不是它自己（不替使用者捲）
const coveredBy = (page, sel) => page.$eval(sel, (b) => {
  const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (y < 0 || y > innerHeight) return '不在畫面內';
  const top = document.elementFromPoint(x, y);
  return top === b || b.contains(top) ? '' : (top?.closest('#tabbar') ? '被分頁列蓋住' : '被 ' + (top?.className || top?.tagName) + ' 蓋住');
});
// ================= 版面：日期／時間框不超出表單、動作列不蓋欄位 =================
// ⚠ 限制：Chromium 重現不出 iOS 日期／時間輸入框的最小寬度（Chromium 會照 width:100% 縮小，iOS 不會），
//   所以這裡靠「注入一條 min-width 模擬 iOS」量，不是在 iPhone 上驗。全綠只代表「iOS 的最小寬度若是這麼寬，也放得下」。
//   模擬值：Yolin 2026-11-11 的截圖（1320px 寬 ÷3＝畫面 440）量到空的日期框約 214px；字高約 19px，推定是標準字級（18.88px）
//   → 214 ÷ 18.88 ≈ 11.33em。大字、特大字「照字級等比放大」是假設，沒在 iPhone 上量過。
// 兩個對照組常駐在這支裡（每次都跑）：
//   舊的兩欄排法＋模擬 → 必須抓到超出（證明檢查抓得到）；
//   舊的兩欄排法、不模擬 → 抓不到。**這一條是文件**：它就是 2026-11-06～11-11 一直沒抓到的原因——Chromium 上量，舊排法看起來正常。
const IOS_MIN_EM = 11.33;
const SIM_IOS = `.stay-form input[type=date], .stay-form input[type=time], .fl-form input[type=date], .fl-form input[type=time] { min-width: ${IOS_MIN_EM}em !important; }`;
const OLD_TWO_COL = '.stay-daterow, .fl-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; gap: 8px !important; }';
const OLD_STICKY = '.fl-actions, .stay-actions { position: sticky !important; bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px) !important; z-index: 5 !important; }';
const setStyle = (page, id, css) => page.evaluate((id, css) => {
  document.getElementById(id)?.remove();
  if (css) { const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.append(s); }
}, id, css);
const MOBILE = (w) => ({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// 表單裡每個看得到的輸入框：左右緣要在表單內緣（扣掉框線與內距）裡面；兩兩不重疊
const formFit = (page, form) => page.$eval(form, (f) => {
  const cs = getComputedStyle(f), r = f.getBoundingClientRect();
  const L = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const R = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
  const ins = [...f.querySelectorAll('input')].filter((i) => i.offsetParent !== null);
  const name = (i) => i.dataset.k || i.type;
  const bad = [];
  for (const i of ins) {
    const b = i.getBoundingClientRect();
    if (b.left < L - 0.5 || b.right > R + 0.5) bad.push(`${name(i)} ${Math.round(b.left)}～${Math.round(b.right)} 超出表單內緣 ${Math.round(L)}～${Math.round(R)}`);
  }
  for (let a = 0; a < ins.length; a++) for (let c = a + 1; c < ins.length; c++) {
    const x = ins[a].getBoundingClientRect(), y = ins[c].getBoundingClientRect();
    if (x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5) bad.push(`${name(ins[a])} 和 ${name(ins[c])} 疊在一起`);
  }
  const d = f.querySelector('input[type=date]');
  return { n: ins.length, bad, minW: d ? parseFloat(getComputedStyle(d).minWidth) || 0 : -1, fpx: d ? parseFloat(getComputedStyle(d).fontSize) : -1 };
});
const FIT_WIDTHS = [320, 360, 390, 430, 440];   // 440＝Yolin 那支（截圖 1320px ÷3）
const FIT_FONTS = ['m', 'l'];   // 2026-11-12 拿掉 'xl'（「特大」從 App 拿掉，樣式表也沒有 xl 那條）
async function fitChecks(page, form, label, nWant) {
  await page.setViewport(MOBILE(390));
  await setStyle(page, 'sim-ios', SIM_IOS); await setStyle(page, 'old-2col', OLD_TWO_COL); await sleep(80);
  let x = await formFit(page, form);
  yes(x.fpx > 0 && Math.abs(x.minW - IOS_MIN_EM * x.fpx) < 1, `${label}前置：模擬 iOS 最小寬度有套上（${Math.round(x.minW)}px，字 ${x.fpx}px）`);
  yes(x.bad.length > 0, `${label}對照組：舊的兩欄排法＋模擬 iOS → 抓得到超出（${x.bad[0] || '沒抓到'}）`);
  await setStyle(page, 'sim-ios', ''); await sleep(80);
  x = await formFit(page, form);
  yes(x.n === nWant && x.bad.length === 0, `${label}對照組：舊的兩欄排法、不模擬 → Chromium 量不出問題（${x.n} 個輸入框、${x.bad.length} 處）——11-06～11-11 沒抓到的原因`, x.bad[0]);
  await setStyle(page, 'old-2col', '');
  await setStyle(page, 'sim-ios', SIM_IOS);
  const bad = []; let combos = 0;
  for (const w of FIT_WIDTHS) for (const fs of FIT_FONTS) {
    await page.setViewport(MOBILE(w));
    await page.evaluate((v) => { if (v === 'm') delete document.documentElement.dataset.fs; else document.documentElement.dataset.fs = v; }, fs);
    await sleep(80);
    const r = await formFit(page, form); combos++;
    if (r.n !== nWant) bad.push(`${w}px／${fs}：只量到 ${r.n} 個輸入框（應為 ${nWant}）`);
    for (const b of r.bad) bad.push(`${w}px／${fs}：${b}`);
  }
  yes(combos === FIT_WIDTHS.length * FIT_FONTS.length && bad.length === 0,
    `${label}日期框不超出表單（模擬 iOS 最小寬度）：${combos} 種寬度×字級都在表單裡、不重疊`, `${bad.length} 處：` + bad.slice(0, 4).join('；'));
  await setStyle(page, 'sim-ios', '');
  await page.evaluate(() => { delete document.documentElement.dataset.fs; });
  await page.setViewport(MOBILE(390)); await sleep(80);
}
// 動作列：從表單上方一路捲到表單底部，每一格量一次「動作列有沒有蓋住任何輸入框」
const barOver = (page, form) => page.$eval(form, (f) => {
  const bar = f.querySelector('.fl-actions, .stay-actions').getBoundingClientRect();
  return [...f.querySelectorAll('input')].filter((i) => {
    const b = i.getBoundingClientRect();
    return b.top < bar.bottom - 0.5 && bar.top < b.bottom - 0.5 && b.left < bar.right - 0.5 && bar.left < b.right - 0.5;
  }).map((i) => i.dataset.k || i.type);
});
async function sweep(page, form) {
  const { top, bottom } = await page.$eval(form, (f) => { const r = f.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; });
  const hit = new Set(); let n = 0;
  for (let y = Math.max(0, top - 844); y <= bottom; y += 80) {
    await page.evaluate((y) => window.scrollTo(0, y), y); await sleep(40);
    n++; for (const k of await barOver(page, form)) hit.add(k);
  }
  return { n, hit: [...hit] };
}
async function barChecks(page, form, label) {
  await setStyle(page, 'old-sticky', OLD_STICKY);
  const c = await sweep(page, form);
  yes(c.n > 3 && c.hit.length > 0, `${label}對照組：動作列改回黏底 → 量得到它蓋住欄位（捲 ${c.n} 格，蓋到 ${c.hit.join('、') || '無'}）`);
  await setStyle(page, 'old-sticky', '');
  const s = await sweep(page, form);
  yes(s.n > 3 && s.hit.length === 0, `${label}捲動途中動作列不蓋任何輸入框（捲 ${s.n} 格，蓋到 ${s.hit.join('、') || '無'}）`);
  // 捲到底：「存」完整露在分頁列上方、中心點最上層是它自己（當初黏底要解的那件事不能回來）
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await sleep(80);
  const r = await page.$eval(`${form} button[type="submit"]`, (b) => {
    const x = b.getBoundingClientRect(), t = document.getElementById('tabbar').getBoundingClientRect();
    return { top: x.top, bottom: x.bottom, tab: t.top };
  });
  const cov = await coveredBy(page, `${form} button[type="submit"]`);
  yes(r.top >= 0 && r.bottom <= r.tab + 0.5 && cov === '', `${label}捲到底：「存」完整露在分頁列上方（存 ${Math.round(r.top)}～${Math.round(r.bottom)}，分頁列從 ${Math.round(r.tab)} 起；${cov || '沒被蓋'}）`);
}
// 空值被印成文字（null／undefined／NaN／[object Object]）：整頁掃一次，空的時候與有資料之後各一次（js/views/trip.js 2026-11-11 那顆 null 的同一族）
const blankOk = async (page, label) => {
  const r = await blankTextScan(page);
  yes(r.ok && r.texts > 0 && r.hits.length === 0,
    `${label}：整頁沒有空值被印成文字（掃了 ${r.texts} 個文字節點、${r.attrs} 個屬性；對照樣本${r.ok ? '全中' : '沒中：' + r.broken.join('、')}）`,
    r.hits.slice(0, 3).map((h) => `${h.where}［${h.kind}］${h.text}`).join('；'));
};
const clickModalBtn = (page, text) => page.evaluate((t) => [...document.querySelectorAll('.modal-card .btn')].find((b) => b.textContent === t)?.click(), text);
// 2026-11-13 三樣入口搬到「行程」分頁（合成一張卡）：從任務頁點底部分頁「行程」進去（使用者的路），不直接 goto
// v1.84.0 起，已結束的行程把「旅途資訊（航班・住宿・待買）」收進預設收著的摺疊區（回顧排最上面）：
// 使用者要先點開那一列才點得到入口（待買、住宿這兩輪造的是 2024 年、已經結束的行程）。點開後等入口真的看得到才往下。
const toItin = async (page, sel) => {
  await page.waitForSelector('#tabbar a.tab', { timeout: 10000 });
  await clickText(page, '#tabbar a.tab', '行程');
  await page.waitForFunction(() => /\/itinerary$/.test(location.hash), { timeout: 10000 });
  // v1.86.0：行程分頁最上面一排「行程｜回顧」，已結束的行程預設亮「回顧」——點「行程」（使用者的路；本來就亮著的話點了也一樣）
  await page.waitForSelector('.itin-seg button', { timeout: 10000 });
  await clickText(page, '.itin-seg button', '行程');
  await page.waitForSelector(sel, { timeout: 10000 });
  const folded = await page.$eval(sel, (e) => { const d = e.closest('details.info-fold'); return !!d && !d.open; });
  if (folded) {
    await clickText(page, 'details.info-fold > summary', '旅途資訊');
    await page.waitForFunction((s) => document.querySelector(s)?.checkVisibility(), { timeout: 5000 }, sel);
  }
};
const backToTrip = async (page, tid, sel) => {
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await toItin(page, sel);
  return page.$eval(sel, (e) => e.textContent);
};

// ================= 待買清單 =================
async function buy() {
  console.log('— 待買清單 —');
  const page = await newPage();
  const { tid, mid } = await seedTrip(page, '2024-03-10', '2024-03-11', '小美');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  // 搬家前置：任務頁真的畫好了（看得到那一站），但已經沒有三樣入口
  // （v1.84.0 起「找附近」也搬去主頁，前置從「看得到找附近」改成「看得到那一站」）
  await page.waitForSelector('.page .qcollapse', { timeout: 10000 }).catch(() => {});
  const onTask = await page.evaluate(() => ({ spots: document.querySelectorAll('.page .qcollapse').length,
    n: document.querySelectorAll('.page .fl-entry, .page .stay-entry, .page .buy-entry').length }));
  yes(onTask.spots > 0 && onTask.n === 0, `任務頁已經沒有航班／住宿／待買入口（那一站畫出來了：${onTask.spots} 站；入口 ${onTask.n} 個）`);
  await toItin(page, '.buy-entry');
  // 進了行程分頁：底部「行程」亮著、「任務」不亮；三樣入口在同一張卡裡（同類合成一張卡）
  const it = await page.evaluate(() => {
    const on = [...document.querySelectorAll('#tabbar a.tab.active')].map((a) => a.textContent.trim());
    const cards = [...new Set(['.fl-entry', '.stay-entry', '.buy-entry'].map((s) => document.querySelector(s)?.closest('.info-card')).filter(Boolean))];
    return { on: on.join(','), cards: cards.length, rows: cards[0] ? cards[0].querySelectorAll('.info-row').length : 0 };
  });
  yes(it.on === '🗓️行程', `行程分頁：底部亮的是「行程」（亮著：${it.on || '沒有'}）`);
  yes(it.cards === 1 && it.rows === 3, `航班／住宿／待買合成一張卡（${it.cards} 張卡、${it.rows} 列）`);
  let entry = await page.$eval('.buy-entry', (e) => e.textContent);
  yes(entry === '🛒 待買清單', `一項都沒有：入口只寫名字、不寫 0 項（${entry}）`);
  await clickText(page, '.buy-entry', '待買清單');   // 像使用者一樣點：已結束的行程摺疊區在頁尾，page.click 會點到蓋在上面的底部分頁列
  await page.waitForSelector('.buy-input', { timeout: 8000 });
  const sum0 = await page.$eval('.buy-sum', (e) => e.textContent);
  yes(sum0.startsWith('還沒有要買的東西'), `空的時候照實寫（${sum0}）`);
  await blankOk(page, '待買清單（空的）');
  const addVia = async (text, how) => {
    await page.click('.buy-input'); await page.type('.buy-input', text);
    if (how === 'enter') await page.keyboard.press('Enter'); else await page.click('.buy-add');
    await sleep(250);
  };
  await addVia('伴手禮（鳳梨酥）', 'btn');
  await addVia('底片 2 捲', 'enter');
  await addVia('防曬乳', 'btn');
  await addVia('   ', 'btn');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.buy-item')].map((li) => ({
    id: li.dataset.id, text: li.querySelector('.buy-text').textContent, done: li.classList.contains('is-done'),
    who: li.querySelector('.buy-who')?.textContent || '', aria: li.querySelector('.buy-check').getAttribute('aria-checked') })));
  let R = await rows();
  yes(R.map((r) => r.text).join('｜') === '伴手禮（鳳梨酥）｜底片 2 捲｜防曬乳', `按鈕與 Enter 都加得上、只打空白的不加、照加入順序（${R.map((r) => r.text).join('｜')}）`);
  // 這支手機還沒選「我是誰」→ 勾了不寫名字。之後每一步都用品項的字找那一列（不用「第幾列」：排序壞了只紅排序那條）
  const byText = (t) => R.find((r) => r.text === t);
  const gift = byText('伴手禮（鳳梨酥）');
  await page.click(`.buy-item[data-id="${gift.id}"] .buy-check`); await sleep(250);
  R = await rows();
  yes(R.at(-1).text === '伴手禮（鳳梨酥）' && R.at(-1).done, `勾了 → 移到最下面、劃掉（最下面是 ${JSON.stringify(R.at(-1))}）`);
  const g = byText('伴手禮（鳳梨酥）');
  yes(g && g.done && g.aria === 'true' && g.who === '', `沒選過我是誰就不寫是誰勾的（${JSON.stringify(g)}）`);
  const gRec = await page.evaluate(async (id) => { const s = await import('./js/store.js'); return s.getRaw(id).doneBy; }, gift.id);
  yes(gRec === null, `資料：沒選過我是誰 → doneBy 存 null，不塞一個猜的人（${JSON.stringify(gRec)}）`);
  // 選了「我是誰」再勾一項 → 寫名字（選人有自己的畫面測試；這裡直接設）
  await page.evaluate(async (tid, mid) => { const s = await import('./js/store.js'); s.setActiveMember(tid, mid); }, tid, mid);
  await page.click(`.buy-item[data-id="${byText('底片 2 捲').id}"] .buy-check`); await sleep(250);
  R = await rows();
  const d2 = R.find((r) => r.text === '底片 2 捲');
  yes(d2?.done && d2.who === '小美 勾的', `選了我是誰之後勾 → 寫「小美 勾的」（${d2?.who}）`);
  const sum = await page.$eval('.buy-sum', (e) => e.textContent);
  yes(sum === '還有 1 項沒買（共 3 項）', `上面寫還剩幾項（${sum}）`);
  await page.click(`.buy-item[data-id="${d2.id}"] .buy-check`); await sleep(250);
  R = await rows();
  yes(!R.find((r) => r.id === d2.id).done && R.find((r) => r.id === d2.id).who === '', '再點一下 → 回到沒買、名字拿掉');
  // 改字：⋯ → 改字 → 輸入 → 存
  const film = R.find((r) => r.text === '底片 2 捲');
  await page.click(`.buy-item[data-id="${film.id}"] .buy-more`); await sleep(200);
  await clickModalBtn(page, '改字'); await sleep(200);
  const editSel = await page.evaluate(() => { const el = document.querySelector('.modal-card input'); return el ? (el.value = '底片 3 捲', el.dispatchEvent(new Event('input', { bubbles: true })), true) : false; });
  yes(editSel, '前置：⋯ → 改字 打開了輸入框');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-card .btn')].find((x) => x.classList.contains('btn-primary')); b?.click(); }); await sleep(300);
  R = await rows();
  yes(R.some((r) => r.id === film.id && r.text === '底片 3 捲'), `改字之後畫面寫新的字（${R.map((r) => r.text).join('｜')}）`);
  // 刪一項：⋯ → 刪除 → 確認
  const sun = R.find((r) => r.text === '防曬乳');
  await page.click(`.buy-item[data-id="${sun.id}"] .buy-more`); await sleep(200);
  await clickModalBtn(page, '刪除'); await sleep(200);
  await clickModalBtn(page, '刪除'); await sleep(300);
  R = await rows();
  yes(R.length === 2 && !R.some((r) => r.text === '防曬乳'), `刪掉防曬乳（剩 ${R.map((r) => r.text).join('｜')}）`);
  const rec = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const r = s.getRaw(id); return { deleted: r.deleted, f: r._f }; }, sun.id);
  yes(rec.deleted === true && rec.f && rec.f.text > 0 && rec.f.done > 0, `資料：刪除是墓碑、_f 有 text／done 兩組（${JSON.stringify(rec)}）`);
  await blankOk(page, '待買清單（有勾、有沒勾、沒寫是誰勾的）');
  entry = await backToTrip(page, tid, '.buy-entry');
  yes(entry === '🛒 待買清單・還有 1 項沒買', `重新載入後回行程頁：入口寫還有幾項（${entry}）`);
  await page.close();
}

// ================= 住宿 =================
async function stays() {
  console.log('— 住宿 —');
  const page = await newPage();
  const { tid } = await seedTrip(page, '2024-03-10', '2024-03-12');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await toItin(page, '.stay-entry');
  let entry = await page.$eval('.stay-entry', (e) => e.textContent);
  yes(entry === '🏨 住宿', `一間都沒有：入口只寫名字（${entry}）`);
  await clickText(page, '.stay-entry', '住宿');
  await page.waitForSelector('.stay-addbtn', { timeout: 8000 });
  yes((await page.$eval('.stay-list', (e) => e.textContent)) === '還沒加住宿。', '空的時候照實寫「還沒加住宿」');
  await blankOk(page, '住宿（空的）');
  const fill = fillForm(page, '.stay-form');
  // 存完的提示泡泡（2.4 秒）會疊在下一張表單的動作列上：等它消失再點，跟真人一樣
  const save = async () => { await page.click('.stay-form button[type="submit"]'); await sleep(2700); };
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.stay-card')].map((c) => ({
    id: c.dataset.id, name: c.querySelector('.stay-name').textContent, dates: c.querySelector('.stay-dates').textContent,
    where: c.querySelector('.stay-where')?.textContent || '', out: c.classList.contains('is-out'), addr: c.querySelector('.stay-addr')?.textContent || '' })));
  await page.click('.stay-addbtn'); await sleep(150);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  yes(sw === 390, `住宿表單沒有把頁面撐寬（scrollWidth ${sw}，畫面 390）`);
  // （原本這裡斷言「表單一打開『存』就看得到」——那是黏底的設計，2026-11-11 拿掉黏底，改成下面「捲到底露得出來」）
  await fitChecks(page, '.stay-form', '住宿表單：', 5);
  await barChecks(page, '.stay-form', '住宿表單：');
  // 當初出事的點法：重新打開表單，什麼都不捲，用 puppeteer 原生 click 點「存」→ 要點得到（空的會被擋下並寫明）
  await page.click('.stay-actions .btn:not(.btn-primary):not(.btn-danger)'); await sleep(200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.stay-addbtn'); await sleep(150);
  await page.click('.stay-form button[type="submit"]'); await sleep(300);
  const err0 = await page.$eval('.stay-err', (e) => e.textContent).catch(() => '（表單不見了）');
  const hash0 = await page.evaluate(() => location.hash);
  yes(err0 === '要寫住哪裡' && hash0.endsWith('/stays'), `剛打開就點「存」（原生點法、不先捲）：點得到、空的擋下（${err0}｜${hash0.split('/').pop()}）`);
  await fill({ name: '海邊民宿（範例）', checkIn: '2024-03-10', checkOut: '2024-03-12', address: '範例縣範例鎮範例路 1 號', note: '訂房代號 ABC123（合成）' });
  await save();
  await page.click('.stay-addbtn'); await sleep(150);
  await fill({ name: '還沒決定的那間' }); await save();
  await page.click('.stay-addbtn'); await sleep(150);
  await fill({ name: '錯的', checkIn: '2024-03-11', checkOut: '2024-03-10' }); await save();
  const err = await page.$eval('.stay-err', (e) => e.textContent);
  yes(err === '退房要比入住晚', `退房早於入住 → 擋下並寫明（${err}）`);
  await page.click('.stay-actions .btn:not(.btn-primary):not(.btn-danger)'); await sleep(200);
  await page.click('.stay-addbtn'); await sleep(150);
  await fill({ name: '去年訂的那間', checkIn: '2023-12-30', checkOut: '2023-12-31' }); await save();
  let C = await cards();
  yes(C.length === 3, `前置：存了 3 間、擋下的那間沒存（${C.length}）`);
  const a = C.find((c) => c.name === '海邊民宿（範例）');
  yes(a && a.dates === '3/10（日） 入住 → 3/12（二） 退房・2 晚' && a.where === '行程第 1～2 晚' && !a.out, `兩晚那間：日期、2 晚、行程第 1～2 晚（${a?.dates}｜${a?.where}）`);
  yes(a && a.addr.includes('範例縣範例鎮範例路 1 號') && a.addr.includes('開地圖'), '地址＋開地圖');
  const b = C.find((c) => c.name === '還沒決定的那間');
  yes(b && b.dates === '入住、退房日期還沒填' && b.where === '' && !b.dates.includes('0 晚'), `沒日期那間：寫還沒填、不寫 0 晚、不寫第幾晚（${b?.dates}）`);
  const o = C.find((c) => c.name === '去年訂的那間');
  yes(o && o.where === '不在行程日期內' && o.out, `行程外那間：照實寫不在行程日期內（${o?.where}）`);
  yes(C[C.length - 1].name === '還沒決定的那間', '排序：有入住日的照日期在前、沒日期的在最後');
  await page.click(`.stay-card[data-id="${b.id}"] .stay-edit`); await sleep(200);
  await fill({ checkIn: '2024-03-11', checkOut: '2024-03-12' }); await save();
  C = await cards();
  const b2 = C.find((c) => c.id === b.id);
  yes(b2 && b2.where === '行程第 2 晚' && b2.dates.endsWith('1 晚'), `修改補上日期 → 行程第 2 晚、1 晚（${b2?.dates}｜${b2?.where}）`);
  await blankOk(page, '住宿（有日期、行程外、沒地址的各一間）');
  await page.click(`.stay-card[data-id="${o.id}"] .stay-edit`); await sleep(200);
  await page.click('.stay-actions .btn-danger'); await sleep(200);
  await clickModalBtn(page, '刪除'); await sleep(300);
  C = await cards();
  yes(C.length === 2 && !C.some((c) => c.id === o.id), `刪掉行程外那間（剩 ${C.map((c) => c.name).join('｜')}）`);
  const rec = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const r = s.getRaw(id); return { deleted: r.deleted, f: Object.keys(r._f || {}).sort().join(',') }; }, o.id);
  yes(rec.deleted === true && rec.f === 'addr,dates,name,note', `資料：墓碑、_f 有四組（${JSON.stringify(rec)}）`);
  entry = await backToTrip(page, tid, '.stay-entry');
  yes(entry === '🏨 住宿・2 間', `重新載入後行程頁入口寫 2 間（${entry}）`);
  await page.close();
}

// ================= 航班 =================
async function flights() {
  console.log('— 航班 —');
  const page = await newPage();
  const { tid } = await seedTrip(page, iso(3), iso(6));
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await toItin(page, '.fl-entry');
  let entry = await page.$eval('.fl-entry', (e) => e.textContent);
  yes(entry === '✈️ 航班', `一班都沒有：入口只寫名字（${entry}）`);
  await clickText(page, '.fl-entry', '航班');
  await page.waitForSelector('.fl-addbtn', { timeout: 8000 });
  yes((await page.$eval('.fl-list', (e) => e.textContent)) === '還沒加航班。', '空的時候照實寫「還沒加航班」');
  await blankOk(page, '航班（空的）');
  const fill = fillForm(page, '.fl-form');
  const save = async () => { await page.click('.fl-form button[type="submit"]'); await sleep(2700); };
  await page.click('.fl-addbtn'); await sleep(150);
  // （原本這裡斷言「表單一打開『存』就看得到」——那是黏底的設計，2026-11-11 拿掉黏底，改成下面「捲到底露得出來」）
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  yes(sw === 390, `航班表單沒有把頁面撐寬（scrollWidth ${sw}，畫面 390）`);
  await fitChecks(page, '.fl-form', '航班表單：', 8);
  await barChecks(page, '.fl-form', '航班表單：');
  // 當初出事的情境（2026-11-06 _flightshots）：剛打開表單、什麼都不捲，puppeteer 原生 click 點「存」→ 當時點到了「照片」分頁
  await page.click('.fl-actions .btn:not(.btn-primary):not(.btn-danger)'); await sleep(200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.fl-addbtn'); await sleep(150);
  await save();
  const err = await page.$eval('.fl-err', (e) => e.textContent).catch(() => '（表單不見了）');
  const hash0 = await page.evaluate(() => location.hash);
  yes(err === '至少填班號或起飛日期' && hash0.endsWith('/flights'), `剛打開就點「存」（_flightshots 的點法）：點得到、什麼都沒填 → 擋下並寫明（${err}｜${hash0.split('/').pop()}）`);
  await page.click('.fl-actions .btn:not(.btn-primary):not(.btn-danger)'); await sleep(200);
  await page.click('.fl-addbtn'); await sleep(150);
  await fill({ flightNo: 'XX 101', depDate: iso(3), depTime: '08:30', depPlace: '範例機場 T2', arrDate: iso(3), arrTime: '12:45', arrPlace: '範例國際機場', note: '訂位代號 ZZ9（合成）' }); await save();
  await page.click('.fl-addbtn'); await sleep(150);
  await fill({ flightNo: 'XX 102', depDate: iso(6), depTime: '18:10' }); await save();
  await page.click('.fl-addbtn'); await sleep(150);
  await fill({ flightNo: 'XX 099', depDate: iso(-1) }); await save();
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.fl-card')].map((c) => ({
    id: c.dataset.id, no: c.querySelector('.fl-no').textContent, cd: c.querySelector('.fl-cd')?.textContent || '',
    ends: [...c.querySelectorAll('.fl-end')].map((e) => e.textContent) })));
  let C = await cards();
  yes(C.map((c) => c.no).join(',') === 'XX 099,XX 101,XX 102', `照起飛日期排（${C.map((c) => c.no).join(',')}）`);
  const go = C.find((c) => c.no === 'XX 101');
  yes(go?.cd === '還有 3 天起飛', `三天後那班：還有 3 天起飛（${go?.cd}）`);
  yes(go?.ends[0].includes('08:30') && go.ends[0].includes('範例機場 T2') && go.ends[1].includes('12:45'), `起飛、抵達都照填的寫（${go?.ends.join('｜')}）`);
  // 大數字（2026-11-13 第二段）：起飛時間是大字；沒填的「時間未填」不放大（不把缺的東西做成主角）
  const big = await page.evaluate((id, id2) => {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const t = document.querySelector(`.fl-card[data-id="${id}"] .fl-time`);
    const none = document.querySelector(`.fl-card[data-id="${id2}"] .fl-time-none`);
    return { t: t?.textContent, k: t ? parseFloat(getComputedStyle(t).fontSize) / root : 0,
      none: none?.textContent, kn: none ? parseFloat(getComputedStyle(none).fontSize) / root : 0 };
  }, go?.id, C.find((c) => c.no === 'XX 102')?.id);
  yes(big.t === '08:30' && big.k >= 1.5 && big.none === '時間未填' && big.kn < 1.2,
    `航班大數字：起飛「${big.t}」是字級的 ${big.k.toFixed(2)} 倍（要 ≥ 1.5）；「${big.none}」${big.kn.toFixed(2)} 倍（不放大，< 1.2）`);
  const back = C.find((c) => c.no === 'XX 102');
  yes(back?.ends[1] === '抵達日期未填 時間未填', `沒填抵達：寫「日期未填 時間未填」、不從起飛日推（${back?.ends[1]}）`);
  const past = C.find((c) => c.no === 'XX 099');
  yes(past && past.cd === '', `昨天那班：不寫倒數、也不寫「已起飛」（${past?.cd || '空'}）`);
  await blankOk(page, '航班（有填滿、沒填抵達、昨天的各一班）');
  await page.click(`.fl-card[data-id="${back.id}"] .fl-edit`); await sleep(200);
  await fill({ depDate: iso(1) }); await save();
  C = await cards();
  yes(C.find((c) => c.id === back.id)?.cd === '明天起飛', '修改成明天 → 明天起飛');
  await page.click(`.fl-card[data-id="${past.id}"] .fl-edit`); await sleep(200);
  await page.click('.fl-actions .btn-danger'); await sleep(200);
  await clickModalBtn(page, '刪除'); await sleep(300);
  C = await cards();
  yes(C.length === 2 && !C.some((c) => c.id === past.id), `刪掉昨天那班（剩 ${C.map((c) => c.no).join(',')}）`);
  const rec = await page.evaluate(async (id) => { const s = await import('./js/store.js'); const r = s.getRaw(id); return { deleted: r.deleted, f: Object.keys(r._f || {}).sort().join(',') }; }, past.id);
  yes(rec.deleted === true && rec.f === 'arr,dep,no,note', `資料：墓碑、_f 有四組（${JSON.stringify(rec)}）`);
  entry = await backToTrip(page, tid, '.fl-entry');
  yes(entry === '✈️ 航班・XX 102 明天起飛', `行程頁入口寫下一班的倒數（${entry}）`);
  await page.close();
}

try {
  await buy();
  await stays();
  await flights();
} catch (e) { fail++; console.log('✗ 例外 ' + (e && e.stack || e)); }
finally { await browser.close(); web.kill(); }
console.log(`\n三樣新紀錄：攔掉外網請求 ${blocked} 個`);
console.log(`${pass} 項通過` + (fail ? `，${fail} 項失敗` : ''));
process.exitCode = fail ? 1 : 0;
