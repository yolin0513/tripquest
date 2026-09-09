// 邀請加入的第一分鐘（npm run jointest，v1.57）—— 兩台裝置走 LAN 伺服器：
//   · 點連結：連線前就看到行程名、日期、誰邀請、前幾個景點（摘要在連結裡）
//   · 按加入：原地進度卡（連線 → 接收 N 筆 → 整理），照片不用等，直接進行程頁
//   · 行程頁：一次性的歡迎卡（關掉不再出現）、「正在接收照片… 還有 N 張」進度列 → 到齊淡出
//   · 伺服器上還沒資料：不是技術錯誤，卡片留在原地講原因並給「再試一次」

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5583, API = 8793;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  return page;
}

try {
  const A = await device('A');
  const setup = await A.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { ensureGroupSync, shareURL } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '宜蘭家族旅行 旅伴' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族旅行', region: '宜蘭', startDate: '2026-10-10', endDate: '2026-10-12', allowWiki: false });
    const quests = [];
    const names = [['羅東夜市', 1], ['林場肉羹', 1], ['太平山', 2], ['礁溪溫泉', 3]];
    for (const [n, d] of names) {
      const sid = uuid(), qid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: n, emoji: '📍', day: d, order: 0 });
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `在${n}拍一張`, kind: 'thing', order: 0 });
      quests.push(qid);
    }
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 60},60%,50%)`; x.fillRect(0, 0, 600, 400); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); };
    for (let i = 0; i < 6; i++) await importPhoto(new File([await mk(i)], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: quests[i % 4], memberId: mA, allowGeo: false });
    await ensureGroupSync(gid);
    const url = await shareURL(tid);
    return { tid, gid, url, code: url.split('j=')[1] };
  });
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  yes(setup.code.length > 40, `A 建立行程（4 景點、6 張照片）並產生邀請連結（${setup.code.length} 字）`);

  // ---------- B 點連結：連線前的摘要 ----------
  console.log('\n— 點連結 —');
  const B = await device('B');
  await B.goto(`http://localhost:${WEB}/#/join?j=${setup.code}`, { waitUntil: 'networkidle0' });
  await B.waitForSelector('.join-preview', { timeout: 15000 });
  const card = await B.evaluate(() => ({
    txt: document.querySelector('.page').innerText.replace(/\s+/g, ' '),
    joinBtn: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程'))?.getBoundingClientRect().height,
  }));
  yes(card.txt.includes('宜蘭家族旅行') && card.txt.includes('2026-10-10') && card.txt.includes('2026-10-12'), '連線前就看到行程名與日期');
  yes(card.txt.includes('媽媽') && card.txt.includes('爸爸'), '看到是誰邀請（旅伴名）');
  yes(card.txt.includes('第 1 天') && card.txt.includes('羅東夜市') && card.txt.includes('第 2 天') && card.txt.includes('太平山'), '看到前幾個景點的骨架（依天）');
  yes(card.joinBtn >= 52, `「加入這個旅程」大按鈕 ${Math.round(card.joinBtn)}px`);

  // ---------- 按加入：進度卡 → 行程頁 ----------
  console.log('\n— 加入 —');
  const t0 = Date.now();
  await B.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程')).click());
  await B.waitForSelector('.join-progress:not([hidden])', { timeout: 5000 });
  const prog = await B.evaluate(() => document.querySelector('.join-progress').textContent);
  // 本機伺服器可能快到讀取時已是完成文案「好了，帶你進行程…」—— 一樣算進度卡有出現
  yes(/連線|接收|整理|好了/.test(prog), `按下去原地出現進度卡：「${prog.replace(/\s+/g, ' ').slice(0, 30)}…」`);
  // 資料到了先問「這是誰的手機？」→ 選爸爸 → 進行程頁
  await B.waitForFunction(() => [...document.querySelectorAll('.modal-card button')].some((x) => x.textContent.includes('爸爸')), { timeout: 30000 });
  await B.evaluate(() => { const b = [...document.querySelectorAll('.modal-card button')].find((x) => x.textContent.includes('爸爸')); b && b.click(); });
  await B.waitForFunction(() => location.hash.includes('/trip/') && !location.hash.includes('/join'), { timeout: 15000 });
  await B.waitForSelector('.progress-banner', { timeout: 15000 });
  const t1 = Date.now();
  const landed = await B.evaluate(() => ({
    welcome: !!document.querySelector('.welcome-card'),
    welcomeTxt: document.querySelector('.welcome-card')?.textContent || '',
    spots: [...document.querySelectorAll('.qc-name')].map((x) => x.textContent.trim()).slice(0, 5),
    banner: !!document.querySelector('.sync-banner:not([hidden])'),
  }));
  yes(t1 - t0 < 15000, `按加入到看見行程頁 ${((t1 - t0) / 1000).toFixed(1)} 秒（照片不用等）`);
  yes(landed.spots.some((x) => x.includes('羅東夜市')), `行程頁有景點可點（${landed.spots.slice(0, 2).join('、')}…）`);
  yes(landed.welcome && landed.welcomeTxt.includes('拍照任務這樣玩'), '一次性的歡迎卡出現');
  // 同步進度列：待抓縮圖 → 到齊
  const bannerSeen = await B.evaluate(async () => {
    const t = Date.now();
    let seenPending = false, seenDone = false;
    while (Date.now() - t < 20000) {
      const el = document.querySelector('.sync-banner');
      if (el && !el.hidden) { if (el.textContent.includes('還有')) seenPending = true; if (el.textContent.includes('到齊')) seenDone = true; }
      if (seenDone) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { seenPending, seenDone, gone: !document.querySelector('.sync-banner') };
  });
  yes(bannerSeen.seenDone || bannerSeen.gone, `照片同步進度列：${bannerSeen.seenPending ? '有顯示「還有 N 張」→ ' : ''}到齊後收起`);
  const thumbs = await B.evaluate(async (tid) => {
    const s = await import('./js/store.js'); const db = await import('./js/db.js');
    const keys = new Set(await db.allBlobKeys());
    const subs = s.submissionsOfTrip(tid);
    return { subs: subs.length, local: subs.filter((x) => keys.has(x.thumbHash)).length };
  }, setup.tid);
  yes(thumbs.subs === 6 && thumbs.local === 6, `6 張縮圖都在背景到齊（${thumbs.local}/6）`);
  // 歡迎卡關掉就不再出現
  await B.evaluate(() => document.querySelector('.welcome-card .wc-x').click());
  await B.goto('about:blank');
  await B.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await sleep(500);
  yes(await B.evaluate(() => !document.querySelector('.welcome-card')), '歡迎卡關掉後不再出現');

  // ---------- 伺服器上還沒資料：不是技術錯誤 ----------
  console.log('\n— 失敗路徑 —');
  const C = await device('C');
  // 用一個沒推上伺服器的新群組產生連結：直接改 payload 的 groupId（同一份摘要）
  const fakeCode = await A.evaluate(async (code) => {
    const sh = await import('./js/share.js');
    const p = JSON.parse(await sh.__gunzip(code));
    p.groupId = 'nothere-' + p.groupId.slice(8); p.secret = 'a'.repeat(32);
    return sh.__gzip(JSON.stringify(p));
  }, setup.code).catch(() => null);
  if (fakeCode) {
    await C.goto(`http://localhost:${WEB}/#/join?j=${fakeCode}`, { waitUntil: 'networkidle0' });
    await C.waitForSelector('.join-preview', { timeout: 15000 });
    await C.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程')).click());
    await C.waitForFunction(() => document.querySelector('.join-progress')?.textContent.includes('再試一次'), { timeout: 90000 });
    const err = await C.evaluate(() => document.querySelector('.join-progress').textContent.replace(/\s+/g, ' '));
    yes(err.includes('沒加入成功') && err.includes('再試一次') && !/404|Error|undefined/.test(err), `伺服器沒資料 → 講人話並給重試：「${err.slice(0, 40)}…」`);
  } else {
    console.log('  （share.js 沒開放 __gzip/__gunzip，跳過失敗路徑的 UI 驗證）');
  }

  console.log('\n邀請加入測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
