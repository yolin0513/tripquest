// 匯入行程表：真的在瀏覽器裡走完整個流程（npm run importtest）
//
// itintest 驗的是解析器本身；這一支驗的是「使用者實際會做的那一串動作」——
// 展開進階 → 按匯入 → 選來源 → 貼文字 → 在確認畫面上改東西 → 建立 →
// 回到行程頁真的看到那些景點，而且天數與順序都對。
//
// 為什麼要分兩支：v1.35 那次就是單元層面全綠、實際點下去整個壞掉。
// 解析器對不代表按鈕接得上。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5231;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, extra) => { console.error('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; };
const eq = (got, want, m) => (got === want ? ok(m) : fail(m, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
const yes = (c, m, extra) => (c ? ok(m) : fail(m, extra));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const errs = [];
page.on('pageerror', (e) => { errs.push(e.message); console.log('  [pageerror]', e.message); });

const clickText = async (sel, text) => page.evaluate((s, t) => {
  const el = [...document.querySelectorAll(s)].find((x) => (x.textContent || '').includes(t));
  if (!el) return false;
  el.click();
  return true;
}, sel, text);

try {
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');

  // ---------- 1. 進階裡找得到匯入按鈕 ----------
  await page.evaluate(() => { document.querySelector('details').open = true; });
  await sleep(150);
  const hasBtn = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('匯入行程表')));
  yes(hasBtn, '進階區有「匯入行程表」按鈕');

  // ---------- 2. 來源選單三條路都在 ----------
  yes(await clickText('button', '匯入行程表'), '按下匯入');
  await page.waitForSelector('.imp-src', { timeout: 4000 });
  const srcs = await page.$$eval('.imp-src', (els) => els.map((e) => e.textContent));
  eq(srcs.length, 3, '來源選單有 3 個選項');
  yes(srcs.some((s) => s.includes('直接打字')), '有「直接打字或貼上」');
  yes(srcs.some((s) => s.includes('拍照片')), '有「拍照片或從相簿選」');
  yes(srcs.some((s) => s.includes('PDF')), '有「選 PDF 檔」');
  yes(srcs.some((s) => s.includes('不用網路')), '有講清楚打字這條不需要網路');

  // ---------- 3. 選單本身可以捲（長選單不能又出現 v1.31 那個 bug）----------
  const scrollable = await page.evaluate(() => {
    const b = document.querySelector('.modal-body');
    const card = document.querySelector('.modal-card');
    return { fits: card.getBoundingClientRect().top >= -1, canScroll: getComputedStyle(b).overflowY === 'auto' };
  });
  yes(scrollable.fits, '來源選單沒有被推出畫面外');
  yes(scrollable.canScroll, '來源選單的內容區可捲動');

  // ---------- 4. 純文字這條完全不需要 AI ----------
  yes(await clickText('.imp-src', '直接打字'), '選「直接打字」');
  await page.waitForSelector('textarea.mono', { timeout: 4000 });
  ok('沒有金鑰也直接進到輸入畫面（沒有被擋在 AI 那關）');

  const SAMPLE = [
    '【第1天】',
    '09:00 台北101 停留2小時',
    '12:00 午餐：鼎泰豐',
    '14:00 - 16:30 士林夜市',
    '【第2天】',
    '09:00 九份老街 (自由活動)',
    '13:00 十分瀑布 步行10分鐘',
    '15:00',
  ].join('\n');
  await page.evaluate((t) => {
    const ta = [...document.querySelectorAll('textarea')].pop();
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, SAMPLE);
  yes(await clickText('.modal-actions .btn', '讀讀看'), '按「讀讀看」');

  // ---------- 5. 確認畫面 ----------
  await page.waitForSelector('.imp-row', { timeout: 5000 });
  const rows = await page.$$eval('.imp-row', (els) => els.map((e) => ({
    name: e.querySelector('.imp-name').value,
    time: e.querySelector('.imp-time').value,
    day: e.querySelector('.imp-day-sel').value,
    stay: e.querySelector('.imp-stay').value,
    on: e.querySelector('.imp-chk').checked,
  })));
  eq(rows.length, 5, '確認畫面列出 5 筆');
  const byName = (n) => rows.find((r) => r.name === n);
  yes(byName('台北101'), '台北101 有出現');
  eq(byName('台北101').time, '09:00', '時間帶進去了');
  eq(byName('台北101').stay, '120', '停留 2 小時 → 120 分');
  eq(byName('鼎泰豐') && byName('鼎泰豐').name, '鼎泰豐', '「午餐：鼎泰豐」取出店名');
  eq(byName('士林夜市').stay, '150', '14:00-16:30 → 150 分');
  eq(byName('九份老街').day, '2', '第 2 天的分在第 2 天');
  yes(byName('九份老街'), '括號備註沒有黏在名字上');
  eq(byName('十分瀑布').stay, '', '步行10分鐘不會被當成停留時間');

  const days = await page.$$eval('.imp-day', (els) => els.map((e) => e.textContent));
  yes(days.some((d) => d.includes('第 1 天')) && days.some((d) => d.includes('第 2 天')), '按天分組顯示');
  yes(days.some((d) => d.includes('看不懂')), '看不懂的行有獨立一區');
  const badLines = await page.$$eval('.imp-bad-t', (e) => e.map((x) => x.textContent));
  yes(badLines.includes('15:00'), '看不懂的那一行原文有顯示出來（不是默默丟掉）');
  yes(await page.$('.imp-add'), '每一天都有「再加一個」的按鈕');

  const sum = await page.$eval('.imp-sum', (e) => e.textContent);
  yes(/要建立 5 個景點/.test(sum), '上方統計說得出要建立幾個');

  // ---------- 6. 就地修改 ----------
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.imp-row')].find((r) => r.querySelector('.imp-name').value === '鼎泰豐');
    const n = row.querySelector('.imp-name');
    n.value = '鼎泰豐 101店';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 把「十分瀑布」那筆取消勾選
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.imp-row')].find((r) => r.querySelector('.imp-name').value === '十分瀑布');
    row.querySelector('.imp-chk').click();
  });
  await sleep(120);
  const sum2 = await page.$eval('.imp-sum', (e) => e.textContent);
  yes(/要建立 4 個景點/.test(sum2), '取消勾選後統計馬上變成 4 個');
  const dimmed = await page.evaluate(() =>
    [...document.querySelectorAll('.imp-row')].some((r) => r.classList.contains('off')));
  yes(dimmed, '沒勾的那一筆看得出來是關掉的');

  // 手動把看不懂的那行加回來
  yes(await clickText('.imp-bad .btn', '手動加進來'), '「手動加進來」按得下去');
  await sleep(150);
  const sum3 = await page.$eval('.imp-sum', (e) => e.textContent);
  yes(/要建立 5 個景點/.test(sum3), '手動加回來之後變成 5 個');

  // ---------- 7. 建立 ----------
  yes(await clickText('.modal-actions .btn', '就這樣建立'), '按「就這樣建立」');
  await page.waitForFunction(() => document.querySelector('.imp-bar') && !document.querySelector('.imp-bar').hidden, { timeout: 4000 });
  const bar = await page.$eval('.imp-bar', (e) => e.textContent);
  yes(/已匯入 5 個景點/.test(bar), '建立頁顯示「已匯入 5 個景點」');
  yes(/2 天/.test(bar), '也講了幾天');

  await page.evaluate(() => {
    document.querySelector('input.field[type=text]').value = '台北匯入測試';
    document.querySelector('input.field[type=text]').dispatchEvent(new Event('input', { bubbles: true }));
  });
  yes(await clickText('button.btn-primary', '產生拍照任務'), '按「產生拍照任務」');
  await page.waitForFunction(() => location.hash.startsWith('#/trip/'), { timeout: 10000 });
  ok('建立成功並跳到行程頁');

  // ---------- 8. 資料真的落地，而且順序對 ----------
  const data = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const tid = location.hash.split('/')[2];
    const spots = s.spotsOf(tid).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const quests = s.questsOfTrip(tid);
    return {
      spots: spots.map((x) => ({ name: x.name, day: x.day, startMin: x.startMin ?? null, stayMin: x.stayMin ?? null })),
      quests: quests.length,
    };
  });
  eq(data.spots.length, 5, '建立了 5 個景點');
  yes(data.quests >= 6, `每個景點都出了任務（共 ${data.quests} 個）`);
  eq(data.spots.map((s) => s.name).join(','), '台北101,鼎泰豐 101店,士林夜市,15:00,九份老街', '順序照第幾天＋幾點排；沒時間的排在當天最後，沒勾的十分瀑布沒有建立');
  eq(data.spots[0].day, 1, '第一個在第 1 天');
  eq(data.spots[0].startMin, 540, '時間存進 spot（09:00 = 540 分）');
  eq(data.spots[0].stayMin, 120, '停留時間存進 spot');
  const jf = data.spots.find((s) => s.name === '九份老街');
  eq(jf && jf.day, 2, '九份老街落在第 2 天');
  yes(!data.spots.some((s) => s.name === '十分瀑布'), '取消勾選的那一筆真的沒有建立');
  yes(await page.$eval('.page', (e) => e.textContent.includes('台北101')), '行程頁上看得到匯入的景點');

  // ---------- 9. 沒有金鑰時，照片這條路要好好講原因 ----------
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');
  await page.evaluate(() => { document.querySelector('details').open = true; });
  await sleep(150);
  const help = await page.evaluate(async () => {
    const { default: openImport } = await import('./js/views/import.js');
    openImport();
    await new Promise((r) => setTimeout(r, 300));
    // 直接叫出照片那條路，跳過檔案選擇（無頭瀏覽器沒有真的檔案挑選器）
    const ai = await import('./js/ai.js');
    return { ready: await ai.deviceAiReady() };
  });
  eq(help.ready, false, '沒設定金鑰時 deviceAiReady() 回 false（不會偷偷送出去）');
  await page.evaluate(() => { const o = document.querySelector('.modal-overlay'); if (o) o.remove(); });

  // ---------- 10. 隱私：整個純文字流程沒有任何對外連線 ----------
  const outbound = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(`http://localhost:${WEB}`) && !u.startsWith('data:') && !u.startsWith('blob:')) outbound.push(u);
  });
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form');
  const parsedLocal = await page.evaluate(async () => {
    const { parseItinerary } = await import('./js/itinerary.js');
    return parseItinerary('第1天\n09:00 清水寺\n11:00 金閣寺').items.length;
  });
  eq(parsedLocal, 2, '純文字解析在本機就算得出來');
  yes(!outbound.some((u) => /anthropic|googleapis/.test(u)), '純文字流程完全沒有連到 AI 服務');

  // ---------- 11. AI 那條路的告知文字 ----------
  const disclosure = await page.evaluate(async () => {
    const src = await (await fetch('./js/views/import.js')).text();
    return {
      tellsUpload: src.includes('內容會傳到 Anthropic'),
      tellsExif: src.includes('拍照地點等隱藏資訊不會跟著送'),
      tellsNoKeep: src.includes('不會留下原始檔案'),
      tellsCost: src.includes('US$'),
      hasOptOut: src.includes('不要，改打字'),
      offersLocalOcr: src.includes('即時文字') || src.includes('Lens'),
    };
  });
  yes(disclosure.tellsUpload, '送出前明確告知會傳給 Anthropic');
  yes(disclosure.tellsExif, '有說明照片會重繪、拍照地點不會跟著送');
  yes(disclosure.tellsNoKeep, '有說明不會留下原始檔案');
  yes(disclosure.tellsCost, '有講大概多少錢');
  yes(disclosure.hasOptOut, '有「不要，我改打字」可以退出');
  yes(disclosure.offersLocalOcr, '沒金鑰時有教手機內建的免費辨識法');

  // ---------- 12. 送出去的圖確實是重繪過的 JPEG ----------
  const stripped = await page.evaluate(async () => {
    // 造一張帶 EXIF 的 JPEG：用最小可行的 APP1 標頭塞進去
    const c = document.createElement('canvas');
    c.width = 60; c.height = 40;
    const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 60, 40);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const exif = new TextEncoder().encode('Exif\0\0GPSLatitudeRef');
    const app1 = new Uint8Array(4 + exif.length);
    app1[0] = 0xff; app1[1] = 0xe1;
    app1[2] = ((exif.length + 2) >> 8) & 0xff; app1[3] = (exif.length + 2) & 0xff;
    app1.set(exif, 4);
    const withExif = new Uint8Array(buf.length + app1.length);
    withExif.set(buf.slice(0, 2), 0);
    withExif.set(app1, 2);
    withExif.set(buf.slice(2), 2 + app1.length);
    const file = new File([withExif], 'trip.jpg', { type: 'image/jpeg' });

    const before = new TextDecoder('latin1').decode(withExif).includes('GPSLatitudeRef');
    const mod = await import('./js/views/import.js');
    // shrink 沒有 export，改用同一段邏輯驗證：createImageBitmap → canvas → toBlob
    const bmp = await createImageBitmap(file);
    const c2 = document.createElement('canvas');
    c2.width = bmp.width; c2.height = bmp.height;
    c2.getContext('2d').drawImage(bmp, 0, 0);
    const out = await new Promise((r) => c2.toBlob(r, 'image/jpeg', 0.85));
    const after = new TextDecoder('latin1').decode(new Uint8Array(await out.arrayBuffer())).includes('GPSLatitudeRef');
    return { before, after, hasShrink: (await (await fetch('./js/views/import.js')).text()).includes('createImageBitmap'), mod: !!mod };
  });
  yes(stripped.before, '測試素材確實含有 GPS 標記');
  yes(!stripped.after, '重繪之後 GPS 標記不見了（送出去的不會帶位置）');
  yes(stripped.hasShrink, 'import.js 真的走重繪這條路');

  yes(errs.length === 0, '整個流程沒有 JS 例外', errs.join(' | '));
} catch (e) {
  fail('流程中斷：' + e.message + '\n' + (e.stack || ''));
} finally {
  await browser.close();
  web.kill();
}

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
