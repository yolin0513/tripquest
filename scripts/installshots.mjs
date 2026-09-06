// 「加到主畫面」引導的截圖（node scripts/installshots.mjs）
// 用不同 UA 與 standalone 模擬，拍出各平台實際會看到的畫面。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../screenshots/_install', import.meta.url));
const WEB = 5311, API = 8798;
await mkdir(OUT, { recursive: true });
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1500);

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosLine: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.5.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
};
const STANDALONE = `Object.defineProperty(window.navigator,'standalone',{get:()=>true,configurable:true});
const mm=window.matchMedia.bind(window);
window.matchMedia=(q)=>(/display-mode:\\s*standalone/.test(q)?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:mm(q));`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let n = 0;
const shot = async (pg, name) => {
  await sleep(350);
  const f = `${OUT}/v1.39-${String(++n).padStart(2, '0')}-${name}.png`;
  await pg.screenshot({ path: f });
  console.log('✓ ' + f.split(/[\\/]/).pop());
};
const dev = async (ua, { standalone = false, clipboard = '' } = {}) => {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await pg.setUserAgent(ua);
  if (standalone) await pg.evaluateOnNewDocument(STANDALONE);
  await pg.evaluateOnNewDocument(`Object.defineProperty(navigator,'clipboard',{configurable:true,get:()=>({readText:async()=>${JSON.stringify(clipboard)},writeText:async()=>{}})});`);
  await pg.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await pg.waitForSelector('.hero');
  await pg.evaluate((u) => { (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url: u }); })(); }, `http://localhost:${API}`);
  return pg;
};
const click = (pg, sel, t) => pg.evaluate((a, x) => {
  const e = [...document.querySelectorAll(a)].find((z) => (z.textContent || '').includes(x));
  if (e) e.click();
  return !!e;
}, sel, t);

try {
  const host = await dev(UA.androidChrome);
  const invite = await host.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { shareURL } = await import('./js/share.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '宜蘭家族', syncSecret: 'c'.repeat(32) });
    await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭遊', region: '宜蘭', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, region: '宜蘭', items: [{ name: '羅東夜市', day: 1 }, { name: '太平山', day: 2 }, { name: '礁溪溫泉', day: 2 }] });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    await (await import('./js/outbox.js')).drain({ force: true });
    return await shareURL(tid);
  });
  const hash = '#' + invite.split('#')[1];
  await host.close();

  // ① iPhone Safari 點連結：邀請頁（引導還沒跳）
  {
    const pg = await dev(UA.iosSafari);
    await pg.evaluate(() => localStorage.setItem('tripquest.installGuide', 'off'));   // 先擋掉自動跳，拍底下的頁面
    await pg.goto(`http://localhost:${WEB}/${hash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.join-install', { timeout: 15000 });
    await shot(pg, 'ios-invite-page');
    await pg.close();
  }

  // ② iPhone Safari：自動跳出的加到主畫面教學
  {
    const pg = await dev(UA.iosSafari);
    await pg.goto(`http://localhost:${WEB}/${hash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.ig-step', { timeout: 15000 });
    await shot(pg, 'ios-guide');
    await pg.close();
  }

  // ③ 從 LINE 點進來：請他改用 Safari
  {
    const pg = await dev(UA.iosLine);
    await pg.goto(`http://localhost:${WEB}/${hash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.ig-step', { timeout: 15000 });
    await shot(pg, 'line-open-in-safari');
    await pg.close();
  }

  // ④ Android：加入是主要動作，安裝只是順便
  {
    const pg = await dev(UA.androidChrome);
    await pg.goto(`http://localhost:${WEB}/${hash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.hero', { timeout: 15000 });
    await sleep(1500);
    await shot(pg, 'android-invite-page');
    await pg.evaluate(async () => { (await import('./js/views/installguide.js')).openInstallGuide({}); });
    await pg.waitForSelector('.ig-step', { timeout: 8000 });
    await shot(pg, 'android-guide');
    await pg.close();
  }

  // ⑤ 裝好後從主畫面打開、一個旅程都沒有
  {
    const pg = await dev(UA.iosSafari, { standalone: true, clipboard: invite });
    await pg.goto(`http://localhost:${WEB}/#/`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.join-hint', { timeout: 15000 });
    await shot(pg, 'standalone-empty');

    await click(pg, 'button', '貼上邀請連結');
    await pg.waitForSelector('.modal-card', { timeout: 8000 });
    await shot(pg, 'standalone-clipboard');

    await click(pg, '.modal-actions .btn', '就是它');
    await pg.waitForFunction(() => location.hash.startsWith('#/trip/'), { timeout: 30000 });
    await sleep(1200);
    await shot(pg, 'standalone-joined');
    await pg.close();
  }
} finally {
  await browser.close();
  web.kill();
  api.kill();
}
console.log(`\n共 ${n} 張，輸出到 screenshots/_install/`);
