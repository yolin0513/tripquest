// 淺色「和紙」主題從使用者的入口驗（npm run washitest；會開瀏覽器）
//
// 涵蓋的程式：css/style.css、js/prefs.js、js/views/settings.js、js/boot-theme.js
//
// 樣式表的靜態對比由 palettetest 驗（秒級）；那支看不到「這條規則實際疊在什麼上面」。
// 這支驗瀏覽器**實際算出來**的顏色：每一個畫面上看得到的字，對它實際的底（往上找到不透明的底，
// 半透明的一層層疊上去）算對比，≥ 4.5。入口走使用者的路：底部分頁「⚙️ 設定」→「畫面顏色」點「淺色（和紙）」。
//
//   W1 對照組：沒選過 → 深色（<html> 沒有 data-theme、底是 #0f1523）
//   W2 設定頁點「淺色（和紙）」→ 立刻換：data-theme=washi、底 #fffcf6、網址列顏色 #fffcf6、那顆按鈕選中
//   W3 重開 App 仍是和紙
//   W7 第一個畫面就是和紙，不先閃一下深色：<body> 剛被插進來的那一刻，<html> 就已經有 data-theme=washi
//      （prefs.js 的 apply() 在 app.js 這個 module 裡，要等整頁解析完才跑；靠的是 head 裡同步執行的 boot-theme.js）。
//      對照組：W1 那次載入（沒選過）同一個時刻記到的是「沒有 data-theme」
//   W4 和紙下逐頁掃字的對比（首頁、旅程頁、設定頁、建立頁）：掃到的字 > 0、全部 ≥ 4.5；
//      底是圖片的跳過、印出跳過幾個（不是 0 也不算錯，但要看得到）
//   W5 和紙＋高對比：高對比的說明字跟著改成「背景更白、文字更黑」；底變純白；再掃一次
//   W6 切回深色：data-theme 拿掉、網址列顏色回 #0f1523
//   W0 掃描器自己的對照組：在頁面上放一個粉彩字（珊瑚粉 #f2a497 在和紙白上），掃描器必須抓到它
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5237;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

const theme = (page) => page.evaluate(() => ({
  attr: document.documentElement.dataset.theme ?? null,
  bg: getComputedStyle(document.body).backgroundColor,
  meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
}));

// 掃目前畫面上所有看得到的字。回 { n, skipped, bad: [{ text, ratio }] }
const scan = (page) => page.evaluate(() => {
  const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (c, u) => ({ r: c.r * c.a + u.r * (1 - c.a), g: c.g * c.a + u.g * (1 - c.a), b: c.b * c.a + u.b * (1 - c.a), a: 1 });
  // 往上收集底色，直到不透明；碰到底圖就回 null（算不出來）
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return null;
      const c = rgba(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) base = over(c, base);
    return base;
  };
  let n = 0, skipped = 0; const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || r.width === 0 || r.height === 0 || +cs.opacity === 0) continue;
    // 只有表情符號的字不算（字色不影響）
    const t = [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join('').trim();
    if (!/[\p{L}\p{N}]/u.test(t)) continue;
    const bg = bgOf(el);
    if (!bg) { skipped++; continue; }
    let fg = rgba(cs.color); if (!fg) { skipped++; continue; }
    fg = over(fg, bg);
    n++;
    const k = ratio(fg, bg);
    if (k < 4.5) bad.push({ text: t.slice(0, 16), ratio: +k.toFixed(2), cls: el.className?.toString().slice(0, 30) });
  }
  return { n, skipped, bad };
});

// 設定頁的入口只在「我的旅程」那一層的底部分頁上；在旅程裡，底部分頁換成這一趟的任務／照片／分帳／回顧，
// 要先按左上角返回回「我的旅程」（使用者實際的路）。原本直接找「設定」分頁，在旅程頁找不到、錯誤被吞掉、等 30 秒逾時。
async function toSettings(page) {
  if (await page.evaluate(() => /^#\/trip\//.test(location.hash))) {
    await clickText(page, '#backBtn', '‹');
    await page.waitForFunction(() => (location.hash === '#/' || location.hash === '') && document.querySelector('a.tab'));
  }
  const ok = await clickText(page, 'a.tab', '設定');
  await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('.theme-seg'));
  return ok;
}
async function toHome(page) {
  const ok = await clickText(page, 'a.tab', '我的旅程');
  await page.waitForFunction(() => (location.hash === '#/' || location.hash === '') && document.querySelector('.trip-card'));
  return ok;
}
const report = (label, s) => `${label}：掃了 ${s.n} 個字、跳過 ${s.skipped} 個（底是圖片）、不到 4.5 的 ${s.bad.length} 個${s.bad.length ? '：' + s.bad.map((b) => `「${b.text}」${b.ratio}（${b.cls}）`).join('｜') : ''}`;

async function scanPages(page, tag) {
  yes(await toHome(page), `${tag} 從底部分頁回「我的旅程」`);
  let s = await scan(page); yes(s.n > 0 && s.bad.length === 0, report(`${tag} 首頁`, s));
  await clickText(page, '.trip-card', '和紙測試');
  await page.waitForSelector('.qcollapse', { timeout: 15000 }); await sleep(700);
  // 打開第一個景點，裡面的任務字也要掃到
  await clickText(page, '.qc-toggle', '甲一'); await sleep(400);
  s = await scan(page); yes(s.n > 0 && s.bad.length === 0, report(`${tag} 旅程頁`, s));
  yes(await toSettings(page), `${tag} 進設定頁`);
  s = await scan(page); yes(s.n > 0 && s.bad.length === 0, report(`${tag} 設定頁`, s));
  yes(await toHome(page), `${tag} 回首頁`);
  await clickText(page, 'a, button', '建立新旅程'); await sleep(600);
  s = await scan(page); yes(s.n > 0 && s.bad.length === 0, report(`${tag} 建立頁`, s));
}

try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 780 });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '和紙測試', allowWiki: false });
    let order = 0;
    for (const [day, name] of [[1, '甲一'], [1, '甲二'], [2, '乙一']]) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day, order: order++, startTime: '09:30' });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: name + '任務', kind: 'thing', order: 0 });
    }
  });
  // W7 用：之後每一次載入，<body> 一出現就記下 <html> 當下的 data-theme（只記第一次）
  await page.evaluateOnNewDocument(() => {
    const rec = () => {
      if ('__bodyTheme' in window || !document.body) return;
      window.__bodyTheme = document.documentElement.dataset.theme ?? null;
    };
    new MutationObserver(rec).observe(document, { childList: true, subtree: true });
  });
  const bodyTheme = (page) => page.evaluate(() => ('__bodyTheme' in window ? window.__bodyTheme : '（沒記到）'));
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');

  // ---- W8 共用的 clickText 自己的對照組：找不到、被蓋住，都要丟例外並點名是哪一個（不能回 false 讓呼叫的地方吞掉） ----
  {
    let msg = '（沒丟例外）';
    try { await clickText(page, 'a.tab', '不存在的分頁'); } catch (e) { msg = e.message; }
    yes(/^找不到「不存在的分頁」（a\.tab）——當時在 #\//.test(msg), `W8 找不到 → 丟例外、點名「不存在的分頁」與當時的頁面（${msg}）`);
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'w8cover'; d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:transparent'; document.body.append(d); });
    msg = '（沒丟例外）';
    try { await clickText(page, 'a.tab', '設定'); } catch (e) { msg = e.message; }
    await page.evaluate(() => document.getElementById('w8cover')?.remove());
    yes(/^點不到「設定」（a\.tab）（被蓋住：中心那一點是 div#w8cover）/.test(msg), `W8 被蓋住 → 丟例外、點名「設定」與蓋住它的元素，而且沒按下去（${msg}）`);
    const h = await page.evaluate(() => location.hash || '#/');
    yes(h === '#/', `W8 被蓋住時沒有按下去（還在 ${h}）`);
  }

  // ---- W1 對照組 ----
  const bt1 = await bodyTheme(page);
  yes(bt1 === null, `W7 對照組：沒選過時，<body> 出現那一刻沒有 data-theme（實得 ${bt1}）`);
  let t = await theme(page);
  yes(t.attr === null && t.bg === 'rgb(15, 21, 35)' && t.meta === '#0f1523', `W1 沒選過是深色（data-theme ${t.attr}、底 ${t.bg}、網址列 ${t.meta}）`);

  // ---- W2 設定頁點「淺色（和紙）」 ----
  yes(await toSettings(page), 'W2 從底部分頁「⚙️ 設定」進設定頁');
  yes(await clickText(page, '.theme-seg button', '淺色'), 'W2 點「畫面顏色」的「淺色（和紙）」');
  await page.waitForSelector('.theme-seg button.on');
  t = await theme(page);
  yes(t.attr === 'washi' && t.bg === 'rgb(255, 252, 246)' && t.meta === '#fffcf6', `W2 立刻換成和紙（data-theme ${t.attr}、底 ${t.bg}、網址列 ${t.meta}）`);
  const onBtn = await page.evaluate(() => document.querySelector('.theme-seg button.on')?.dataset.themePick);
  yes(onBtn === 'washi', `W2 選中的是「淺色（和紙）」那顆（實得 ${onBtn}）`);

  // ---- W0 掃描器自己的對照組 ----
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'w0'; p.textContent = '粉彩字樣本'; p.style.color = '#f2a497'; document.querySelector('.page').prepend(p); });
  const s0 = await scan(page);
  yes(s0.bad.some((b) => b.text === '粉彩字樣本'), `W0 掃描器抓得到放上去的粉彩字（${s0.bad.map((b) => b.text).join('、') || '沒抓到'}）`);
  await page.evaluate(() => document.getElementById('w0')?.remove());

  // ---- W3 重開 ----
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');
  t = await theme(page);
  yes(t.attr === 'washi' && t.bg === 'rgb(255, 252, 246)', `W3 重開仍是和紙（data-theme ${t.attr}、底 ${t.bg}）`);
  const bt3 = await bodyTheme(page);
  yes(bt3 === 'washi', `W7 重開時 <body> 出現那一刻就已經是和紙，不先閃深色（實得 ${bt3}）`);

  // ---- W4 逐頁掃 ----
  await scanPages(page, 'W4 和紙');

  // ---- W5 和紙＋高對比 ----
  yes(await toSettings(page), 'W5 進設定頁');
  const hint = await page.evaluate(() => [...document.querySelectorAll('label.switch-row')].find((x) => x.textContent.includes('高對比模式'))?.textContent || '');
  yes(hint.includes('背景更白、文字更黑'), `W5 和紙下高對比的說明是「背景更白、文字更黑」（${hint.includes('背景更深') ? '還寫著背景更深' : hint.slice(0, 20)}）`);
  const box = await page.evaluateHandle(() => [...document.querySelectorAll('label.switch-row')].find((x) => x.textContent.includes('高對比模式'))?.querySelector('input[type=checkbox]') || null);
  if (box.asElement()) { await box.asElement().click(); await sleep(200); }
  t = await theme(page);
  yes(t.attr === 'washi' && t.bg === 'rgb(255, 255, 255)', `W5 和紙＋高對比：底變純白（${t.bg}）`);
  await scanPages(page, 'W5 和紙＋高對比');

  // ---- W6 切回深色 ----
  yes(await toSettings(page), 'W6 進設定頁');
  yes(await clickText(page, '.theme-seg button', '深色'), 'W6 點「深色」');
  await sleep(200);
  t = await theme(page);
  yes(t.attr === null && t.meta === '#0f1523', `W6 切回深色（data-theme ${t.attr}、網址列 ${t.meta}）`);
  await ctx.close();
} catch (e) {
  yes(false, '執行中斷：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
