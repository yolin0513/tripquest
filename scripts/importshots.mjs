// 匯入行程表流程的截圖（node scripts/importshots.mjs）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../screenshots/_import', import.meta.url));
const WEB = 5241;
await mkdir(OUT, { recursive: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
let n = 0;
const shot = async (name) => {
  await sleep(320);
  const f = `${OUT}/v1.36-${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: f });
  console.log('✓ ' + f.split(/[\\/]/).pop());
};
const clickText = (sel, text) => page.evaluate((s, t) => {
  const el = [...document.querySelectorAll(s)].find((x) => (x.textContent || '').includes(t));
  if (el) el.click();
  return !!el;
}, sel, text);

try {
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');
  await page.evaluate(() => {
    document.querySelector('input.field[type=text]').value = '關西家族旅行';
    document.querySelector('details').open = true;
    document.querySelector('details').scrollIntoView({ block: 'center' });
  });
  await shot('advanced');

  await clickText('button', '匯入行程表');
  await page.waitForSelector('.imp-src');
  await shot('source');

  await clickText('.imp-src', '直接打字');
  await page.waitForSelector('textarea.mono');
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].pop();
    ta.value = ['【第1天】大阪',
      '09:00 大阪城 停留2小時',
      '12:00 午餐：道頓堀',
      '14:00 - 16:30 心齋橋商店街',
      '19:00 通天閣',
      '【第2天】京都',
      '09:00 伏見稻荷大社 約1.5小時',
      '11:30 清水寺（搭公車 約20分鐘）',
      '14:00 金閣寺',
      '16:00 錦市場 步行10分鐘',
      '18:30'].join('\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await shot('paste-text');

  await clickText('.modal-actions .btn', '讀讀看');
  await page.waitForSelector('.imp-row');
  await sleep(900);                       // 等策展地點庫比對完，「✓ 認得」才會出現
  await shot('confirm-top');

  // 用比例捲，不要寫死像素 —— 內容不夠長時寫死的數字會直接捲到底，
  // 拍出跟下一張一模一樣的圖
  await page.evaluate(() => {
    const b = document.querySelector('.modal-body');
    b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) * 0.45);
  });
  await shot('confirm-middle');

  await page.evaluate(() => { document.querySelector('.modal-body').scrollTop = 99999; });
  await shot('confirm-unreadable');

  await clickText('.modal-actions .btn', '就這樣建立');
  await page.waitForFunction(() => document.querySelector('.imp-bar') && !document.querySelector('.imp-bar').hidden);
  await page.evaluate(() => document.querySelector('.imp-bar').scrollIntoView({ block: 'center' }));
  await shot('imported-bar');

  await clickText('button.btn-primary', '產生拍照任務');
  await page.waitForFunction(() => location.hash.startsWith('#/trip/'), { timeout: 15000 });
  await sleep(1200);
  await shot('trip-result');

  // 捲到景點清單，看得到匯入的時間標在每個景點上
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.daycollapse')][0];
    if (el && !el.classList.contains('open')) el.querySelector('.dc-head').click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.daycollapse')][0];
    if (el) el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
  });
  await shot('trip-times');

  // 沒金鑰時走照片這條路會看到的說明
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');
  await page.evaluate(async () => {
    const { modal, h } = await import('./js/ui.js');
    // 直接叫出 noKeyHelp 的內容（無頭瀏覽器沒有真的檔案挑選器，繞過選檔那一步）
    modal({
      title: '照片需要文字辨識',
      body: h('div', {},
        h('p', { style: 'margin:0 0 12px' }, '把照片上的字讀出來，有兩個辦法：'),
        h('div', { class: 'imp-note' },
          h('p', { style: 'margin:0 0 6px' }, h('b', {}, '① 用手機內建的（免費、不外傳）')),
          h('p', { class: 'sm', style: 'margin:0 0 4px' }, 'iPhone：打開「照片」→ 點右下角的 ⧉ 文字圖示 → 全選 → 拷貝'),
          h('p', { class: 'sm', style: 'margin:0' }, 'Android：打開「Google 相簿」→ 點「Lens」→ 選取文字 → 複製'),
          h('p', { class: 'sm', style: 'margin:6px 0 0' }, '複製好之後回來選「直接打字或貼上」。')),
        h('p', { class: 'sm muted', style: 'margin:12px 0 0' }, '② 貼一支你自己的 Claude API 金鑰，讓 App 幫你辨識（會把照片傳出去）。')),
      actions: [{ label: '我去複製文字', value: 'manual' }, { label: '貼金鑰', value: 'key', primary: true }],
    });
  });
  await page.waitForSelector('.imp-note');
  await shot('no-key-help');

  await page.evaluate(() => document.querySelector('.modal-overlay').remove());
  await page.evaluate(async () => {
    const { modal, h } = await import('./js/ui.js');
    modal({
      title: '要把它傳給 AI 辨識嗎？',
      body: h('div', {},
        h('p', { style: 'margin:0 0 10px' }, h('b', {}, '1 個檔案：'), '行程表.jpg'),
        h('div', { class: 'imp-note' },
          h('p', { style: 'margin:0 0 6px' }, '📤 內容會傳到 Anthropic 的 Claude 服務辨識文字，用你自己的 API 金鑰。'),
          h('p', { style: 'margin:0 0 6px' }, '🖼️ 照片送出前會重新存一次，拍照地點等隱藏資訊不會跟著送。'),
          h('p', { style: 'margin:0 0 6px' }, '🗑️ 只傳這一次。辨識完 App 不會留下原始檔案。'),
          h('p', { style: 'margin:0' }, '💰 一張行程表大約 US$0.01～0.03，從你的金鑰額度扣。')),
        h('p', { class: 'sm muted', style: 'margin:10px 0 0' }, '不想傳出去的話，可以用手機內建的文字辨識，複製後改用「直接打字」。')),
      actions: [{ label: '不要，改打字', value: false }, { label: '好，開始辨識', value: true, primary: true }],
    });
  });
  await page.waitForSelector('.imp-note');
  await shot('privacy-consent');
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n共 ${n} 張，輸出到 screenshots/_import/`);
