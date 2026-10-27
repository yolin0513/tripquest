// 「減少動態效果」從使用者的入口驗（npm run motiontest；會開瀏覽器）
//
// 涵蓋的程式：css/style.css、js/prefs.js、js/ui.js、js/views/settings.js、js/views/create.js
//
// v1.74.10 以前的缺陷（兩件）：
//   1. 系統設定「減少動態效果」會讓 <html> 加上 reduce-motion，但 CSS 只有照片檢視器那一條認它，
//      完成任務的彈出、撒彩帶、對話框往上滑、折疊展開全部照跑；撒彩帶還會照樣產生 60 片。
//   2. prefs.reduceMotion 存在，設定頁卻沒有開關——使用者改不到，讀程式的人卻會以為功能有了。
// 樣式表的結構由 motioncsstest 驗（秒級）；這支驗瀏覽器**實際算出來**的結果，入口一律走使用者的路：
// 底部分頁「⚙️ 設定」→ 勾開關；首頁「＋ 建立新旅程」→ 沒填名字按「產生拍照任務」；完成任務的慶祝畫面
// 走 ui.js 對外的 celebrate()（拍照流程本身要相機，不在這支的範圍）。
//
//   R1 對照組：沒有任何減少動態的設定 → 彈出動畫 ≥ 0.4 秒、撒彩帶 60 片、折疊有轉場（證明下面的「變成 0」有東西可以變）
//   R2 系統設定減少動態 → 彈出、折疊、對話框的時間都 ≤ 0.01ms；撒彩帶 0 片；載入中的轉圈照轉（登記的例外）
//   R3 系統沒設、在設定頁勾開關 → 立刻生效、重開仍在；取消勾選 → 恢復
//   R4 系統已設時，設定頁講明「手機系統已經設定」（不然勾掉開關畫面照樣不動，使用者會以為開關壞了）；系統沒設時不出現
//   R5 系統設定在 App 開著時被改 → 不用重開就跟著變
//   R6 建立頁沒填名字：減少動態時一步跳到名稱欄（behavior: auto），平常是平滑捲動（smooth）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5233;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const TINY = 0.00001;   // 0.01ms，秒

async function device({ reduce = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 780 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]);
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  return { ctx, page };
}

const hasClass = (page) => page.evaluate(() => document.documentElement.classList.contains('reduce-motion'));

// 打開慶祝畫面（ui.js 對外的 celebrate），量它與幾個探針的實際時間，量完收掉
async function measure(page) {
  return page.evaluate(async () => {
    // 秒數：'0.5s' / '1e-05s' / '0.01ms'，逗號分隔取最大值（App 的 CSP 不准 eval，所以寫在這裡）
    const secs = (v) => Math.max(...String(v).split(',').map((x) => { x = x.trim(); return x.endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x); }));
    const ui = await import('./js/ui.js');
    ui.celebrate({ title: '完成了', lines: ['測試'], actions: [] });
    await new Promise((r) => setTimeout(r, 60));
    const badge = document.querySelector('.celebrate-badge');
    const confetti = document.querySelectorAll('.confetti i').length;
    // 探針：折疊的轉場、對話框往上滑、載入中的轉圈——各放一個、量完拿掉
    const probe = (cls) => { const el = document.createElement('div'); el.className = cls; document.body.append(el); return el; };
    // 「天」從 v1.74.11 起不再折疊，改成日期列換天時淡入（.daycollapse.open .dc-inner 的 dayin）
    const day = probe('daycollapse open'); const dc = document.createElement('div'); dc.className = 'dc-inner'; day.append(dc);
    const qc = probe('qc-body'), sp = probe('spinner');
    const cs = (el) => getComputedStyle(el);
    // 全頁掃一次：所有正在套用動畫的元素（轉圈是登記的例外，另外看）
    const animated = [...document.querySelectorAll('*')].filter((el) => cs(el).animationName !== 'none' && !el.classList.contains('spinner'));
    const out = {
      badgeAnim: badge ? secs(cs(badge).animationDuration) : null,
      badgeDelay: badge ? secs(cs(badge).animationDelay) : null,
      overlayAnim: secs(cs(document.querySelector('.celebrate')).animationDuration),
      confetti,
      dcTrans: secs(cs(dc).animationDuration),
      qcTrans: secs(cs(qc).transitionDuration),
      spinAnim: secs(cs(sp).animationDuration),
      spinCount: cs(sp).animationIterationCount,
      animatedN: animated.length,
      animatedMax: animated.length ? Math.max(...animated.map((el) => secs(cs(el).animationDuration))) : null,
    };
    for (const el of [day, qc, sp]) el.remove();
    document.querySelectorAll('.celebrate, .confetti').forEach((el) => el.remove());
    return out;
  });
}

async function clickText(page, selector, text) {
  const hs = await page.$$(selector);
  for (const hd of hs) {
    const t = await hd.evaluate((el) => el.textContent);
    if (t.includes(text)) { await hd.click(); return true; }
  }
  return false;
}

// 設定頁「減少動態效果」那一列：{ row, box, hint }
async function motionRow(page) {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('label.switch-row')].find((r) => r.textContent.includes('減少動態效果'));
    if (!row) return null;
    const box = row.querySelector('input[type=checkbox]');
    return { checked: box ? box.checked : null, text: row.textContent };
  });
}
// 用滑鼠點那個勾選框（真的點擊，不是改 checked）
async function clickBox(page) {
  const hd = await page.evaluateHandle(() => [...document.querySelectorAll('label.switch-row')]
    .find((x) => x.textContent.includes('減少動態效果'))?.querySelector('input[type=checkbox]') || null);
  const el = hd.asElement();
  if (!el) return false;
  await el.click();
  await sleep(100);
  return true;
}
async function toSettings(page) {
  const ok = await clickText(page, 'a.tab', '設定');
  await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('label.switch-row'));
  return ok;
}
const SYS_HINT = '手機系統已經設定';

try {
  // ---- R1 對照組 ----
  {
    const { ctx, page } = await device();
    yes(!(await hasClass(page)), 'R1 沒有任何設定時 <html> 沒有 reduce-motion');
    const m = await measure(page);
    yes(m.badgeAnim >= 0.4, `R1 對照組：完成畫面的勾勾彈出 ${m.badgeAnim} 秒（≥ 0.4）`);
    yes(m.confetti === 60, `R1 對照組：撒彩帶 ${m.confetti} 片（= 60）`);
    yes(m.dcTrans >= 0.2 && m.qcTrans >= 0.2, `R1 對照組：換天的淡入／景點的折疊轉場 ${m.dcTrans}／${m.qcTrans} 秒（≥ 0.2）`);
    yes(m.animatedN > 0 && m.animatedMax >= 0.1, `R1 對照組：全頁正在套用動畫的元素 ${m.animatedN} 個、最長 ${m.animatedMax} 秒`);
    await ctx.close();
  }

  // ---- R2 系統設定減少動態 ----
  {
    const { ctx, page } = await device({ reduce: true });
    yes(await hasClass(page), 'R2 系統設定減少動態 → <html> 有 reduce-motion');
    const m = await measure(page);
    yes(m.badgeAnim != null && m.badgeAnim <= TINY && m.badgeDelay === 0, `R2 完成畫面的勾勾：${m.badgeAnim} 秒、延遲 ${m.badgeDelay}（≤ 0.01ms、0）`);
    yes(m.overlayAnim <= TINY, `R2 完成畫面的淡入：${m.overlayAnim} 秒（≤ 0.01ms）`);
    yes(m.confetti === 0, `R2 撒彩帶：${m.confetti} 片（= 0，連產生都不產生）`);
    yes(m.dcTrans <= TINY && m.qcTrans <= TINY, `R2 換天的淡入／景點的折疊轉場：${m.dcTrans}／${m.qcTrans} 秒（≤ 0.01ms）`);
    yes(m.animatedN > 0 && m.animatedMax <= TINY, `R2 全頁正在套用動畫的元素 ${m.animatedN} 個（> 0）、最長 ${m.animatedMax} 秒（≤ 0.01ms）`);
    yes(m.spinAnim >= 1 && m.spinCount === 'infinite', `R2 載入中的轉圈照轉（登記的例外）：${m.spinAnim} 秒、${m.spinCount}`);

    // ---- R4 系統已設時設定頁講明 ----
    yes(await toSettings(page), 'R4 從底部分頁「⚙️ 設定」進設定頁');
    const row = await motionRow(page);
    yes(!!row && row.text.includes(SYS_HINT), `R4 系統已設：設定頁那一列講明「${SYS_HINT}」（${row ? '有這一列' : '沒有這一列'}）`);
    await ctx.close();
  }

  // ---- R3 設定頁的開關 ----
  {
    const { ctx, page } = await device();
    yes(await toSettings(page), 'R3 從底部分頁「⚙️ 設定」進設定頁');
    let row = await motionRow(page);
    yes(!!row && row.checked === false, `R3 設定頁有「減少動態效果」開關、預設沒勾（${row ? 'checked=' + row.checked : '沒有這一列'}）`);
    yes(!!row && !row.text.includes(SYS_HINT), 'R4 反向：系統沒設時不講「手機系統已經設定」');
    yes(await clickBox(page), 'R3 點得到那個開關');
    yes(await hasClass(page), 'R3 勾開關 → 立刻有 reduce-motion（不用重開）');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tripquest.prefs') || '{}').reduceMotion);
    yes(saved === true, `R3 存進偏好：reduceMotion=${saved}`);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#app');
    yes(await hasClass(page), 'R3 重開之後仍然有 reduce-motion');
    const m = await measure(page);
    yes(m.confetti === 0 && m.badgeAnim <= TINY, `R3 勾了開關的慶祝畫面：撒彩帶 ${m.confetti} 片、勾勾 ${m.badgeAnim} 秒`);
    await page.waitForFunction(() => document.querySelector('label.switch-row'));
    row = await motionRow(page);
    yes(!!row && row.checked === true, `R3 重開後開關顯示為已勾（checked=${row && row.checked}）`);
    yes(await clickBox(page), 'R3 再點一次那個開關');
    yes(!(await hasClass(page)), 'R3 取消勾選 → reduce-motion 拿掉');
    await ctx.close();
  }

  // ---- R5 系統設定被改 ----
  {
    const { ctx, page } = await device();
    yes(!(await hasClass(page)), 'R5 開頭：系統沒設、沒有 reduce-motion');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await sleep(200);
    yes(await hasClass(page), 'R5 App 開著時系統改成減少動態 → 不用重開就有 reduce-motion');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await sleep(200);
    yes(!(await hasClass(page)), 'R5 改回來 → reduce-motion 拿掉');
    await ctx.close();
  }

  // ---- R6 建立頁沒填名字 ----
  for (const reduce of [false, true]) {
    const { ctx, page } = await device({ reduce });
    await page.evaluate(() => {
      window.__siv = [];
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (o) { window.__siv.push(o && typeof o === 'object' ? o.behavior || '' : String(o)); return orig.call(this, o); };
    });
    const a = await clickText(page, 'button', '建立新旅程');
    await page.waitForFunction(() => location.hash === '#/new');
    await sleep(200);
    const b = await clickText(page, 'button', '產生拍照任務');
    await sleep(200);
    const calls = await page.evaluate(() => window.__siv);
    const want = reduce ? 'auto' : 'smooth';
    yes(a && b && calls.length === 1 && calls[0] === want,
      `R6 ${reduce ? '減少動態' : '平常'}：沒填名字按「產生拍照任務」→ 捲到名稱欄用 ${want}（實際 ${JSON.stringify(calls)}）`);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
