// 三樣新紀錄的畫面測試：待買清單、住宿、航班（npm run recordstest；在 test:chain 裡）。
// 涵蓋的程式：js/buylist.js js/views/buy.js js/stays.js js/views/stays.js js/flights.js js/views/flights.js js/views/trip.js js/store.js js/app.js css/style.css
// 從一次性的 _buyshots／_stayshots／_flightshots（被 .gitignore 擋）搬進來：2026-11-06 Dispatch 明早清單第 1 項——
// 三樣只被不會自動跑的腳本驗過（2026-11-06 凌晨實測 10/10、13/13、15/15）。截圖留在一次性腳本，這支只放斷言。
// 走真實入口：行程頁的入口鈕 → 畫面上的按鈕、輸入框、表單；勾選與刪除走畫面上的鈕（確認框也點）。
// 資料合成（2024 年、名稱自編）；航班倒數依手機日期，所以起飛日用「今天 ± N」相對算。外網請求一律攔掉、只計數。
// 合併語意（刪了又回來、舊版 Worker 刪 _f、既有型別寫入 0 次）在 mergetest、真的 Worker 在 workertest，這支不重複。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

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
// 動作列黏在分頁列上方：puppeteer 的 click 先捲、再用捲之前算的座標點，會點到表單本身。照「現在畫面上」的位置用手指點
const tapNow = async (page, sel) => {
  const r = await page.$eval(sel, (b) => { const x = b.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; });
  await page.mouse.click(r.x, r.y);
};
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
const clickModalBtn = (page, text) => page.evaluate((t) => [...document.querySelectorAll('.modal-card .btn')].find((b) => b.textContent === t)?.click(), text);
const backToTrip = async (page, tid, sel) => {
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector(sel, { timeout: 10000 });
  return page.$eval(sel, (e) => e.textContent);
};

// ================= 待買清單 =================
async function buy() {
  console.log('— 待買清單 —');
  const page = await newPage();
  const { tid, mid } = await seedTrip(page, '2024-03-10', '2024-03-11', '小美');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.buy-entry', { timeout: 10000 });
  let entry = await page.$eval('.buy-entry', (e) => e.textContent);
  yes(entry === '🛒 待買清單', `一項都沒有：入口只寫名字、不寫 0 項（${entry}）`);
  await page.click('.buy-entry');
  await page.waitForSelector('.buy-input', { timeout: 8000 });
  const sum0 = await page.$eval('.buy-sum', (e) => e.textContent);
  yes(sum0.startsWith('還沒有要買的東西'), `空的時候照實寫（${sum0}）`);
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
  await page.waitForSelector('.stay-entry', { timeout: 10000 });
  let entry = await page.$eval('.stay-entry', (e) => e.textContent);
  yes(entry === '🏨 住宿', `一間都沒有：入口只寫名字（${entry}）`);
  await page.click('.stay-entry');
  await page.waitForSelector('.stay-addbtn', { timeout: 8000 });
  yes((await page.$eval('.stay-list', (e) => e.textContent)) === '還沒加住宿。', '空的時候照實寫「還沒加住宿」');
  const fill = fillForm(page, '.stay-form');
  // 存完的提示泡泡（2.4 秒）會疊在下一張表單的動作列上：等它消失再點，跟真人一樣
  const save = async () => { await tapNow(page, '.stay-form button[type="submit"]'); await sleep(2700); };
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.stay-card')].map((c) => ({
    id: c.dataset.id, name: c.querySelector('.stay-name').textContent, dates: c.querySelector('.stay-dates').textContent,
    where: c.querySelector('.stay-where')?.textContent || '', out: c.classList.contains('is-out'), addr: c.querySelector('.stay-addr')?.textContent || '' })));
  await page.click('.stay-addbtn'); await sleep(150);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  yes(sw === 390, `住宿表單沒有把頁面撐寬（scrollWidth ${sw}，畫面 390）`);
  const cov = await coveredBy(page, '.stay-form button[type="submit"]');
  yes(cov === '', `住宿表單一打開：「存」看得到、沒被分頁列蓋住（${cov || '沒被蓋'}）`);
  await fill({ name: '海邊民宿（範例）', checkIn: '2024-03-10', checkOut: '2024-03-12', address: '範例縣範例鎮範例路 1 號', note: '訂房代號 ABC123（合成）' });
  await save();
  await page.click('.stay-addbtn'); await sleep(150);
  await fill({ name: '還沒決定的那間' }); await save();
  await page.click('.stay-addbtn'); await sleep(150);
  await fill({ name: '錯的', checkIn: '2024-03-11', checkOut: '2024-03-10' }); await save();
  const err = await page.$eval('.stay-err', (e) => e.textContent);
  yes(err === '退房要比入住晚', `退房早於入住 → 擋下並寫明（${err}）`);
  await tapNow(page, '.stay-actions .btn:not(.btn-primary):not(.btn-danger)'); await sleep(200);
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
  await page.click(`.stay-card[data-id="${o.id}"] .stay-edit`); await sleep(200);
  await tapNow(page, '.stay-actions .btn-danger'); await sleep(200);
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
  await page.waitForSelector('.fl-entry', { timeout: 10000 });
  let entry = await page.$eval('.fl-entry', (e) => e.textContent);
  yes(entry === '✈️ 航班', `一班都沒有：入口只寫名字（${entry}）`);
  await page.click('.fl-entry');
  await page.waitForSelector('.fl-addbtn', { timeout: 8000 });
  yes((await page.$eval('.fl-list', (e) => e.textContent)) === '還沒加航班。', '空的時候照實寫「還沒加航班」');
  const fill = fillForm(page, '.fl-form');
  const save = async () => { await tapNow(page, '.fl-form button[type="submit"]'); await sleep(2700); };
  await page.click('.fl-addbtn'); await sleep(150);
  const cov = await coveredBy(page, '.fl-form button[type="submit"]');
  yes(cov === '', `航班表單一打開：「存」看得到、沒被分頁列蓋住（${cov || '沒被蓋'}）`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  yes(sw === 390, `航班表單沒有把頁面撐寬（scrollWidth ${sw}，畫面 390）`);
  await save();
  const err = await page.$eval('.fl-err', (e) => e.textContent);
  yes(err === '至少填班號或起飛日期', `什麼都沒填 → 擋下並寫明（${err}）`);
  await tapNow(page, '.fl-actions .btn:not(.btn-primary):not(.btn-danger)'); await sleep(200);
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
  const back = C.find((c) => c.no === 'XX 102');
  yes(back?.ends[1] === '抵達日期未填 時間未填', `沒填抵達：寫「日期未填 時間未填」、不從起飛日推（${back?.ends[1]}）`);
  const past = C.find((c) => c.no === 'XX 099');
  yes(past && past.cd === '', `昨天那班：不寫倒數、也不寫「已起飛」（${past?.cd || '空'}）`);
  await page.click(`.fl-card[data-id="${back.id}"] .fl-edit`); await sleep(200);
  await fill({ depDate: iso(1) }); await save();
  C = await cards();
  yes(C.find((c) => c.id === back.id)?.cd === '明天起飛', '修改成明天 → 明天起飛');
  await page.click(`.fl-card[data-id="${past.id}"] .fl-edit`); await sleep(200);
  await tapNow(page, '.fl-actions .btn-danger'); await sleep(200);
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
