// 淺色「和紙」主題從使用者的入口驗（npm run washitest；會開瀏覽器）
//
// 涵蓋的程式：css/style.css、js/prefs.js、js/views/settings.js、js/boot-theme.js
//
// 樣式表的靜態對比由 palettetest 驗（秒級）；那支看不到「這條規則實際疊在什麼上面」。
// 這支驗瀏覽器**實際算出來**的顏色：每一個畫面上看得到的字，對它實際的底（往上找到不透明的底，
// 半透明的一層層疊上去）算對比，≥ 4.5。入口走使用者的路：底部分頁「⚙️ 設定」→「畫面顏色」點「淺色（和紙）」。
//
//   W1 沒選過 → 和紙（2026-11-13 起預設改成和紙；<html> 有 data-theme=washi、底 #fffcf6、網址列 #fffcf6）
//   W9 設定頁點「深色」→ 立刻換成深色；重開仍是深色；<body> 出現那一刻就沒有 data-theme（選深色的人不先閃白）
//   W2 設定頁點「淺色（和紙）」→ 立刻換：data-theme=washi、底 #fffcf6、網址列顏色 #fffcf6、那顆按鈕選中
//   W3 重開 App 仍是和紙
//   W7 第一個畫面就是和紙，不先閃一下深色：<body> 剛被插進來的那一刻，<html> 就已經有 data-theme=washi
//      （prefs.js 的 apply() 在 app.js 這個 module 裡，要等整頁解析完才跑；靠的是 head 裡同步執行的 boot-theme.js）。
//      對照組：W9 那次載入（選了深色）同一個時刻記到的是「沒有 data-theme」
//   W4 和紙下逐頁掃字的對比（首頁、旅程頁、設定頁、建立頁）：掃到的字 > 0、全部 ≥ 4.5；
//      底是圖片的跳過、印出跳過幾個（不是 0 也不算錯，但要看得到）
//   W5 舊版存的偏好（2026-11-12 拿掉高對比與特大字之後）：設定頁沒有「高對比模式」、字體大小只剩「標準／大」；
//      手機裡存著舊版的 contrast=high＋fs=xl＋和紙，重開 App：照樣是和紙（底不是純白）、沒有 data-contrast、
//      特大對應成大（data-fs=l、字級 134%）、設定頁選中的是「大」；存的資料裡 contrast 被拿掉
//      （原本的 W5「和紙＋高對比」2026-11-12 隨高對比模式拿掉）
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
  // 2026-11-13 第二段：新的「行程」分頁也掃（旅途資訊卡、每天的行程）
  await clickText(page, 'a.tab', '行程');
  await page.waitForSelector('.info-card', { timeout: 15000 }); await sleep(700);
  s = await scan(page); yes(s.n > 0 && s.bad.length === 0, report(`${tag} 行程頁`, s));
  // 行程是底部分頁（主畫面）：按左上返回要一步回「我的旅程」，跟任務分頁一樣（2026-11-13 第一版漏了，返回只退回任務頁）
  await clickText(page, '#backBtn', '‹');
  const home = await page.waitForFunction(() => (location.hash === '#/' || location.hash === '') && document.querySelector('.trip-card'), { timeout: 5000 }).then(() => true, () => false);
  yes(home, `${tag} 行程分頁按左上返回 → 一步回「我的旅程」（實得 ${await page.evaluate(() => location.hash || '（空）')}）`);
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

  // ---- W1 沒選過 → 和紙（2026-11-13 起預設；原本沒選過是深色） ----
  const bt1 = await bodyTheme(page);
  yes(bt1 === 'washi', `W7 沒選過時，<body> 出現那一刻就已經是和紙（實得 ${bt1}）`);
  let t = await theme(page);
  yes(t.attr === 'washi' && t.bg === 'rgb(255, 252, 246)' && t.meta === '#fffcf6', `W1 沒選過是和紙（data-theme ${t.attr}、底 ${t.bg}、網址列 ${t.meta}）`);

  // ---- W9 選深色：立刻換、重開仍是深色、第一個畫面不先閃白（這一次記到的「沒有 data-theme」也是 W7 的對照組） ----
  yes(await toSettings(page), 'W9 從底部分頁「⚙️ 設定」進設定頁');
  yes(await clickText(page, '.theme-seg button', '深色'), 'W9 點「畫面顏色」的「深色」');
  await sleep(200);
  t = await theme(page);
  yes(t.attr === null && t.bg === 'rgb(15, 21, 35)' && t.meta === '#0f1523', `W9 立刻換成深色（data-theme ${t.attr}、底 ${t.bg}、網址列 ${t.meta}）`);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');
  t = await theme(page);
  yes(t.attr === null && t.bg === 'rgb(15, 21, 35)' && t.meta === '#0f1523', `W9 重開仍是深色（data-theme ${t.attr}、底 ${t.bg}、網址列 ${t.meta}）`);
  const bt9 = await bodyTheme(page);
  yes(bt9 === null, `W7 對照組：選了深色的人重開時，<body> 出現那一刻沒有 data-theme、不先閃白（實得 ${bt9}）`);

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

  // ---- W10（2026-11-13 第二段）今天主角卡、拍照解任務、頁首有字的按鈕：從首頁點進行程（使用者的路） ----
  yes(await toHome(page), 'W10 回「我的旅程」');
  await clickText(page, '.trip-card', '和紙測試');
  await page.waitForSelector('.today-card', { timeout: 15000 }); await sleep(700);
  const tc = await page.evaluate(() => {
    const c = document.querySelector('.today-card'); const tm = c.querySelector('.today-time');
    const b = document.getElementById('topActionBtn'); const br = b.getBoundingClientRect();
    return { label: c.querySelector('.today-label')?.textContent, time: tm?.textContent || '', fs: tm ? parseFloat(getComputedStyle(tm).fontSize) : 0,
      root: parseFloat(getComputedStyle(document.documentElement).fontSize), nav: !!c.querySelector('.nextstn-btn, .nextstn-plain'),
      shot: c.querySelector('.today-shot')?.textContent || '', top: b.textContent, aria: b.getAttribute('aria-label'), bw: br.width, bh: br.height };
  });
  yes(tc.label === '下一站' && tc.time === '09:30' && tc.fs >= tc.root * 1.6 - 0.01,
    `W10 今天主角卡：「${tc.label} ${tc.time}」、時間是大字（${tc.fs}px＝字級的 ${(tc.fs / tc.root).toFixed(2)} 倍，要 ≥ 1.6）`);
  // 2026-11-13 第四段之二：「拍照解任務」前面的 📸 換成相機圖示（svg，沒有字）——圖示本身由 peektest P7 驗
  yes(tc.nav && tc.shot.startsWith('拍照解任務'), `W10 卡裡有帶路，還有「${tc.shot}」`);
  yes(tc.top === '⚙️設定' && tc.aria === '旅程設定' && tc.bw >= 56 && tc.bh >= 44,
    `W10 頁首右上是有字的按鈕「${tc.top}」（讀出「${tc.aria}」、${Math.round(tc.bw)}×${Math.round(tc.bh)}，觸控 ≥ 44 沒動）`);
  // 造情境：日期列換到第 2 天、甲一（第 1 天、下一站）收起來 → 點「拍照解任務」要換回第 1 天、展開甲一、捲到看得到
  const spotState = () => page.evaluate(() => {
    const q = [...document.querySelectorAll('.qcollapse')].find((x) => x.textContent.includes('甲一'));
    const r = q?.getBoundingClientRect();
    const se = document.scrollingElement;
    return { day: document.querySelector('.daycollapse.open')?.dataset.day, open: !!q?.classList.contains('open'), top: r ? Math.round(r.top) : null, h: r ? Math.round(r.height) : 0,
      y: Math.round(se.scrollTop), maxY: Math.round(se.scrollHeight - window.innerHeight) };
  });
  await page.evaluate(() => { const q = [...document.querySelectorAll('.qcollapse')].find((x) => x.textContent.includes('甲一')); if (q?.classList.contains('open')) q.querySelector('.qc-toggle').click(); });
  await clickText(page, '.daystrip .ds-day', '第 2 天');
  await sleep(600);
  const pre10 = await spotState();
  yes(pre10.day === '2' && pre10.open === false, `W10 前置：日期列在第 2 天、甲一收起來（第 ${pre10.day} 天、展開＝${pre10.open}）`);
  await clickText(page, '.today-shot', '拍照解任務');
  await sleep(1200);
  const post10 = await spotState();
  // 「捲到」＝那一站的頂在日期列下方附近（≤ 260px），或頁面已經捲到底、不能再往下
  yes(post10.day === '1' && post10.open && post10.h > 0 && post10.top >= 0 && (post10.top <= 260 || post10.y >= post10.maxY - 2),
    `W10 點「拍照解任務」→ 換回第 1 天、甲一展開、捲到那一站（第 ${post10.day} 天、展開＝${post10.open}、離頂 ${post10.top}px、捲動 ${post10.y}／最多 ${post10.maxY}）`);

  // ---- W5 舊版存的偏好（2026-11-12 拿掉高對比與特大字之後；原本的「和紙＋高對比」隨模式拿掉） ----
  yes(await toSettings(page), 'W5 進設定頁');
  const st = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('label.switch-row')].map((x) => x.textContent),
    fsBtns: [...document.querySelectorAll('.seg:not(.theme-seg) button')].map((b) => b.textContent.trim()),
  }));
  // 「沒有」要先有母體：開關列一個都找不到時，「沒有高對比」恆真
  yes(st.rows.length > 0 && !st.rows.some((x) => x.includes('高對比')), `W5 設定頁沒有「高對比模式」（掃了 ${st.rows.length} 個開關列）`);
  yes(st.fsBtns.join('｜') === '標準｜大', `W5 字體大小只剩「標準／大」（實得 ${st.fsBtns.join('／') || '沒找到'}）`);
  // 造情境：舊版的人手機裡存著「和紙＋高對比＋特大」（舊版的設定頁存的就是這三個鍵與值）
  const old = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('tripquest.prefs') || '{}');
    localStorage.setItem('tripquest.prefs', JSON.stringify({ ...p, theme: 'washi', contrast: 'high', fs: 'xl' }));
    return JSON.parse(localStorage.getItem('tripquest.prefs'));
  });
  yes(old.contrast === 'high' && old.fs === 'xl' && old.theme === 'washi', `W5 前置：手機裡存的是舊版的偏好（contrast ${old.contrast}、fs ${old.fs}、theme ${old.theme}）`);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card');
  t = await theme(page);
  const de = await page.evaluate(() => ({
    contrast: document.documentElement.dataset.contrast ?? null,
    fs: document.documentElement.dataset.fs ?? null,
    px: getComputedStyle(document.documentElement).fontSize,
  }));
  yes(t.attr === 'washi' && t.bg === 'rgb(255, 252, 246)' && de.contrast === null,
    `W5 舊版開過高對比的人重開：照樣是和紙、底不是純白、沒有 data-contrast（底 ${t.bg}、data-contrast ${de.contrast}）`);
  yes(de.fs === 'l' && de.px === '21.44px', `W5 舊版選特大的人重開：對應成「大」（data-fs ${de.fs}、字級 ${de.px}，應為 l／21.44px）`);
  yes(await toSettings(page), 'W5 重開後進設定頁');
  const onFs = await page.evaluate(() => document.querySelector('.seg:not(.theme-seg) button.on')?.textContent.trim() ?? null);
  yes(onFs === '大', `W5 設定頁字體大小選中的是「大」（實得 ${onFs}）`);
  yes(await clickText(page, '.seg:not(.theme-seg) button', '標準'), 'W5 點字體大小「標準」');
  await sleep(200);
  const after = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('tripquest.prefs') || '{}'), px: getComputedStyle(document.documentElement).fontSize }));
  yes(!('contrast' in after.s) && after.s.fs === 'm' && after.px === '18.88px',
    `W5 改過一次設定之後，存的資料裡沒有 contrast、字級回標準（存的鍵 ${Object.keys(after.s).join('、')}、字級 ${after.px}）`);

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
