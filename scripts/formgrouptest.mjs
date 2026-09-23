// 「一組控制項不包在 <label> 裡」的真實入口測試（npm run formgrouptest）。
// 涵蓋的程式：js/views/create.js 與 js/views/spot.js 。寫出來是給挑選器認的 ——
// 這支從畫面進去，程式碼裡不會出現那兩個檔名。
//
// 為什麼要有這一支：v1.74.3 之前，三個頁面的 `field()` 把一整排按鈕包進 `<label>`。
// label 會把點擊轉發給裡面第一個可被標記的控制項，兩條路都會中：
//   ① 被點的那顆按鈕重繪後離開 DOM，點擊冒泡到 label 時被轉發給第一顆（分帳的 chip 落回第一個人）；
//   ② 手指落在標題字上，label 直接去點第一顆。
// 分帳表單的那一半在 settletest（T0／T0b）；這一支守另外兩頁：
//   · 建立旅程的「有誰要一起」：第一個控制項是第一位旅伴的「×」——點標題字會把他刪掉；
//   · 景點設定的「幾點到」：兩個下拉＋「清除」鈕，是一組控制項，要唸得出群組名稱。
//
// 點擊一律用 ElementHandle.click()（真的滑鼠：移過去、按下、放開），跟手指是同一條路。

import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const WEB = 5253;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const web = spawn('python', ['-m', 'http.server', String(WEB)], { stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

const byText = async (sel, text) => {
  for (const hd of await page.$$(sel)) {
    if ((await hd.evaluate((e) => e.textContent.trim())) === text) return hd;
  }
  return null;
};
// 找某個欄位標題所屬的那一格（.form-field）與它的標題字
const fieldInfo = (title) => page.evaluate((title) => {
  const lb = [...document.querySelectorAll('.form-label')].find((x) => x.textContent.trim() === title);
  const f = lb && lb.closest('.form-field');
  return f ? { tag: f.tagName.toLowerCase(), role: f.getAttribute('role'), name: f.getAttribute('aria-label') || (f.getAttribute('aria-labelledby') ? document.getElementById(f.getAttribute('aria-labelledby'))?.textContent.trim() : null) } : null;
}, title);

try {
  // ---------- 建立旅程：從首頁的按鈕進去 ----------
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const newBtn = await byText('button', '＋ 建立新旅程');
  yes(!!newBtn, '真實入口：首頁有「＋ 建立新旅程」');
  await newBtn.click();
  await page.waitForFunction(() => location.hash.includes('/new'), { timeout: 8000 });
  await page.waitForSelector('.chip-input');
  await sleep(200);

  const members = () => page.evaluate(() => [...document.querySelectorAll('.chip-input .chip')].map((c) => c.firstChild.textContent.trim()));
  const addName = async (name) => {
    const inp = await page.$('.chip-input + input.field, input[placeholder="打名字後按 Enter"]');
    await inp.click(); await inp.type(name); await page.keyboard.press('Enter'); await sleep(120);
  };
  for (const n of ['阿公', '阿嬤', '小美']) await addName(n);
  const m0 = await members();
  // 表單預設就有一位「我」；再加三位
  yes(m0.join() === '我,阿公,阿嬤,小美', `前置：預設的「我」加上三位旅伴（${m0.join('／')}）`, JSON.stringify(m0));

  // 手指落在「有誰要一起」這幾個字上：不應該刪掉任何人
  const title = await byText('.form-label', '有誰要一起');
  yes(!!title, '前置：找得到「有誰要一起」的標題字');
  await title.click(); await sleep(450);   // 等過刪除鈕的 350ms 防連點
  const m1 = await members();
  yes(m1.join() === m0.join(), '點「有誰要一起」的標題字 → 四位旅伴都還在（第一位的 × 沒有被點到）', JSON.stringify(m1));

  // 點第二位的「×」：只刪他
  await sleep(450);
  const xs = await page.$$('.chip-input .chip-x');
  await xs[2].click(); await sleep(450);
  const m2 = await members();
  yes(m2.join() === '我,阿公,小美', '點「阿嬤」的 × → 只刪阿嬤、其他人都在', JSON.stringify(m2));

  const cf = await fieldInfo('有誰要一起');
  yes(cf && cf.tag !== 'label' && cf.role === 'group' && cf.name === '有誰要一起',
    '「有誰要一起」是一個唸得出名稱的群組、不是 <label>', JSON.stringify(cf));
  // 單一輸入框的欄位維持 <label>（點標題字聚焦輸入框是對的）——對照組
  const tf = await fieldInfo('旅程名稱');
  yes(tf && tf.tag === 'label', '對照：「旅程名稱」（單一輸入框）仍是 <label>', JSON.stringify(tf));

  // ---------- 景點設定：「幾點到」 ----------
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const g = uuid(), tid = uuid(), sid = uuid();
    await s.put({ id: g, type: 'group', name: '家族' });
    await s.put({ id: uuid(), type: 'member', groupId: g, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: g, title: '設定景點的一趟', region: '宜蘭', allowWiki: false, startDate: '2026-10-01', endDate: '2026-10-01' });
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '測試公園', day: 1, order: 0, startMin: 600, stayMin: 60 });
    return { tid, sid };
  });
  // 從調整行程頁的「⚙️ 設定」進去（使用者的路）
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-mini', { timeout: 8000 });
  let gear = null;
  for (const b of await page.$$('.plan-mini')) if ((await b.evaluate((e) => e.textContent)).includes('設定')) { gear = b; break; }
  yes(!!gear, '前置：調整行程頁有這個景點的「⚙️ 設定」');
  await gear.click();
  await page.waitForFunction(() => location.hash.includes('/spot/'), { timeout: 8000 });
  await page.waitForSelector('.spot-time-row');
  await sleep(200);
  const hour = () => page.evaluate(() => document.querySelector('.spot-time select').value);
  yes((await hour()) === '10', `前置：景點原本 10 點到（${await hour()}）`);
  const sf = await fieldInfo('幾點到');
  yes(sf && sf.tag !== 'label' && sf.role === 'group' && sf.name === '幾點到',
    '「幾點到」（兩個下拉＋清除）是一個唸得出名稱的群組、不是 <label>', JSON.stringify(sf));
  const clr = await byText('.spot-time-row button', '清除');
  await clr.click(); await sleep(150);
  yes((await hour()) === '', '點「清除」→ 時間清掉（按鈕本身照常運作）', await hour());
  const nf = await fieldInfo('景點名稱');
  yes(nf && nf.tag === 'label', '對照：「景點名稱」（單一輸入框）仍是 <label>', JSON.stringify(nf));

  console.log('\n表單群組測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
