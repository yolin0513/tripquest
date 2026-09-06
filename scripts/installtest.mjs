// 「加到主畫面」的偵測與引導（npm run installtest）
//
// 這支測的是使用者實際回報的那條路：
//   在 Safari 點旅伴的連結 → 加入 → 加到主畫面 → 從主畫面打開 → **旅程不見了**
//
// 根因（Apple WWDC23 官方說法）：iPhone 的主畫面 App 與 Safari 儲存空間是分開的；
// 而且主畫面圖示打開的是 manifest 的 start_url（'./'），不是那個帶邀請碼的網址。
// Android 的 WebAPK 則跟瀏覽器共用 Chrome profile，所以同一條路不會出事。
//
// 自動化測得到的：UA 判斷、standalone 判斷、畫面上出現哪些引導、
// 步驟教學的內容、剪貼簿補救、「不要再提醒」有沒有記住。
// 測不到的（要真機）：Safari 的分享選單長怎樣、iOS 真的裝起來之後的儲存區行為、
// beforeinstallprompt 真的跳出系統對話框。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5301, API = 8797;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1500);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const eq = (g, w, m) => (g === w ? ok(m) : fail(m, `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  iosLine: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.5.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidLine: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.5.0',
};

// standalone 模擬：iOS 看 navigator.standalone，其他看 display-mode media query。
// 兩個都要蓋，因為程式兩個都判斷。
const STANDALONE_PATCH = `(() => {
  Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode:\\s*standalone/.test(q)
    ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
    : mm(q));
})();`;

const dev = async (ua, { standalone = false, clipboard = '' } = {}) => {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 390, height: 844 });
  await pg.setUserAgent(ua);
  pg.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  if (standalone) await pg.evaluateOnNewDocument(STANDALONE_PATCH);
  // 無頭 Chrome 沒有真的剪貼簿，也不會有 iOS 那顆「貼上」確認鈕 —— 這裡只驗流程接得上
  await pg.evaluateOnNewDocument(`(() => {
    const text = ${JSON.stringify(clipboard)};
    let written = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => ({
        readText: async () => text,
        writeText: async (t) => { written = t; window.__written = t; },
      }),
    });
    void written;
  })();`);
  await pg.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await pg.waitForSelector('.hero');
  await pg.evaluate((u) => { (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url: u }); })(); }, `http://localhost:${API}`);
  return pg;
};
const txt = (pg) => pg.evaluate(() => document.body.innerText);
const has = async (pg, s) => (await txt(pg)).includes(s);
const clickText = (pg, sel, t) => pg.evaluate((a, x) => {
  const e = [...document.querySelectorAll(a)].find((z) => (z.textContent || '').includes(x));
  if (e) e.click();
  return !!e;
}, sel, t);

try {
  // ---------- 1. 平台判斷 ----------
  console.log('— 認得出使用者拿什麼在看 —');
  for (const [name, ua, want] of [
    ['iPhone Safari', UA.iosSafari, { os: 'ios', browser: 'safari', inApp: '', canInstall: true }],
    ['iPhone 的 Chrome', UA.iosChrome, { os: 'ios', browser: 'chrome', inApp: '', canInstall: false }],
    ['iPhone 的 LINE', UA.iosLine, { os: 'ios', browser: 'other', inApp: 'LINE', canInstall: false }],
    ['Android Chrome', UA.androidChrome, { os: 'android', browser: 'chrome', inApp: '', canInstall: true }],
    ['Android 的 LINE', UA.androidLine, { os: 'android', browser: 'chrome', inApp: 'LINE', canInstall: false }],
  ]) {
    const pg = await dev(ua);
    const got = await pg.evaluate(async () => (await import('./js/install.js')).platform());
    const same = ['os', 'browser', 'inApp', 'canInstall'].every((k) => got[k] === want[k]);
    yes(same, `${name} → ${JSON.stringify(got)}`, `want=${JSON.stringify(want)}`);
    await pg.close();
  }

  // ---------- 2. standalone 偵測 ----------
  console.log('\n— 已經是主畫面 App 就別再教他裝 —');
  {
    const web1 = await dev(UA.iosSafari);
    eq(await web1.evaluate(async () => (await import('./js/install.js')).isStandalone()), false, 'Safari 裡：不是 standalone');
    await web1.close();
    const app1 = await dev(UA.iosSafari, { standalone: true });
    eq(await app1.evaluate(async () => (await import('./js/install.js')).isStandalone()), true, '主畫面 App：是 standalone');
    eq(await app1.evaluate(async () => (await import('./js/install.js')).shouldOfferInstall()), false, '主畫面 App：不再提議安裝');
    await app1.close();
  }

  // ---------- 3. 造一個真的邀請 ----------
  const host = await dev(UA.androidChrome);
  const invite = await host.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { shareURL } = await import('./js/share.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '宜蘭家族', syncSecret: 'b'.repeat(32) });
    await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭遊', region: '宜蘭', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, region: '宜蘭', items: [{ name: '羅東夜市', day: 1 }, { name: '太平山', day: 2 }] });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    const { drain } = await import('./js/outbox.js');
    await drain({ force: true });
    return await shareURL(tid);
  });
  yes(/[?&#].*j=/.test(invite), `產生邀請連結（${invite.length} 字元）`);
  const inviteHash = '#' + invite.split('#')[1];

  // ---------- 4. iPhone Safari 點連結：先教裝，再讓他選 ----------
  console.log('\n— iPhone Safari 點邀請連結 —');
  {
    const pg = await dev(UA.iosSafari);
    await pg.goto(`http://localhost:${WEB}/${inviteHash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.join-install', { timeout: 15000 });
    yes(await has(pg, '旅伴邀請你加入'), 'iPhone：先看得到是誰邀請、什麼行程');
    yes(await has(pg, '宜蘭遊'), 'iPhone：行程名稱有出現');
    yes(await has(pg, '主畫面的 App 跟 Safari 的資料是分開的'), 'iPhone：講清楚為什麼要先裝');
    yes(await has(pg, '① 教我加到主畫面'), 'iPhone：安裝是第一順位、主要按鈕');
    yes(await has(pg, '② 我只想在 Safari 用，直接加入'), 'iPhone：仍然可以直接加入（不強迫）');
    const cls = await pg.$$eval('button', (els) => els.map((e) => ({ t: e.textContent.trim().slice(0, 12), c: e.className })));
    const guide = cls.find((x) => x.t.includes('① 教我'));
    const plainJoin = cls.find((x) => x.t.includes('② 我只想'));
    yes(guide && guide.c.includes('btn-primary'), 'iPhone：安裝按鈕是主色大按鈕');
    yes(plainJoin && !plainJoin.c.includes('btn-primary'), 'iPhone：直接加入是次要樣式');

    // 自動跳出的引導
    await pg.waitForSelector('.ig-step', { timeout: 8000 });
    ok('iPhone：第一次點連結會自動跳出引導（不用自己找）');
    const g = await txt(pg);
    yes(g.includes('分享'), '教學：教他按分享');
    yes(g.includes('加入主畫面'), '教學：教他找「加入主畫面」');
    yes(g.includes('新增'), '教學：教他按「新增」');
    yes(g.includes('貼上邀請連結'), '教學：講了裝好之後要做什麼');
    const svgs = await pg.$$eval('.ig-ic svg, .ig-ic .ig-emoji', (e) => e.length);
    yes(svgs >= 3, `教學：每一步都有圖示（${svgs} 個）`);
    const copied = await pg.evaluate(() => window.__written || '');
    yes(copied.includes('j='), '教學跳出時順便把邀請連結複製起來了');

    // 「不要再提醒」
    yes(await clickText(pg, '.modal-actions .btn', '不要再提醒'), '有「不要再提醒」可以按');
    await sleep(300);
    eq(await pg.evaluate(async () => (await import('./js/install.js')).guideDismissed()), true, '按了之後記住了');
    await pg.goto(`http://localhost:${WEB}/${inviteHash}`, { waitUntil: 'networkidle0' });
    await sleep(1600);
    eq(await pg.$('.ig-step'), null, '重新進來不會再自動跳（不吵人）');
    await pg.close();
  }

  // ---------- 5. iPhone 的 LINE：要先請他換 Safari ----------
  console.log('\n— 從 LINE 點進來 —');
  {
    const pg = await dev(UA.iosLine);
    await pg.goto(`http://localhost:${WEB}/${inviteHash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.ig-step', { timeout: 15000 });
    const g = await txt(pg);
    yes(g.includes('LINE'), 'LINE：認出是 LINE 裡面開的');
    yes(g.includes('沒辦法把 App 加到主畫面'), 'LINE：直說在這裡做不到');
    yes(g.includes('Safari'), 'LINE：請他改用 Safari 開');
    yes(!g.includes('按最下面正中央的「分享」'), 'LINE：不會教他按一個根本不存在的按鈕');
    await pg.close();
  }

  // ---------- 6. Android：加入照樣安全，不要拿 iPhone 那套嚇他 ----------
  console.log('\n— Android Chrome 點邀請連結 —');
  {
    const pg = await dev(UA.androidChrome);
    await pg.goto(`http://localhost:${WEB}/${inviteHash}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.hero', { timeout: 15000 });
    await sleep(1800);
    yes(!(await has(pg, '資料是分開的')), 'Android：不會說「資料是分開的」（那是 iPhone 的事）');
    eq(await pg.$('.join-install'), null, 'Android：不強迫先安裝');
    yes(await has(pg, '加入這個旅程'), 'Android：加入仍然是主要按鈕');
    yes(await has(pg, '順便把 App 放到主畫面'), 'Android：安裝變成順便做的事');
    eq(await pg.$('.ig-step'), null, 'Android：不自動跳教學（沒有非做不可的理由）');
    await pg.close();
  }

  // ---------- 7. 裝好之後打開是空的 → 直接給貼上入口 ----------
  console.log('\n— 從主畫面打開、一個旅程都沒有 —');
  {
    const pg = await dev(UA.iosSafari, { standalone: true, clipboard: invite });
    await pg.goto(`http://localhost:${WEB}/#/`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.join-hint', { timeout: 10000 });
    yes(await has(pg, '旅伴給你邀請連結了嗎'), '空的主畫面 App：最上面就問他有沒有邀請連結');
    yes(await has(pg, '在瀏覽器裡加入的旅程不會跟著進來'), '空的主畫面 App：解釋了為什麼是空的');
    const btns = await pg.$$eval('button', (els) => els.map((e) => ({ t: e.textContent.trim(), c: e.className })));
    const paste = btns.find((b) => b.t === '貼上邀請連結');
    const create = btns.find((b) => b.t.includes('建立新旅程'));
    yes(paste && paste.c.includes('btn-primary'), '空的主畫面 App：「貼上邀請連結」是主按鈕');
    yes(create && !create.c.includes('btn-primary'), '空的主畫面 App：「建立新旅程」退成次要');
    yes(!(await has(pg, '把 TripQuest 放到主畫面')), '空的主畫面 App：不會再叫他安裝一次');

    // 剪貼簿裡就是那條邀請 → 一路加入成功
    await clickText(pg, 'button', '貼上邀請連結');
    await pg.waitForSelector('.modal-card', { timeout: 8000 });
    yes(await has(pg, '找到一個邀請連結'), '剪貼簿有連結時直接問「是不是這個」');
    await clickText(pg, '.modal-actions .btn', '就是它');
    await pg.waitForFunction(() => location.hash.startsWith('#/trip/'), { timeout: 30000 });
    ok('按兩下就加入成功（不用自己貼）');
    const got = await pg.evaluate(async () => {
      const s = await import('./js/store.js');
      const t = s.trips();
      return { n: t.length, title: t[0] && t[0].title, spots: s.spotsOf(location.hash.split('/')[2]).length };
    });
    eq(got.n, 1, '主畫面 App 裡真的有了這個旅程');
    eq(got.title, '宜蘭遊', '旅程名稱正確');
    yes(got.spots >= 2, `景點也拉下來了（${got.spots} 個）`);

    // 回首頁不該再看到那個提示
    await pg.goto(`http://localhost:${WEB}/#/`, { waitUntil: 'networkidle0' });
    await sleep(600);
    eq(await pg.$('.join-hint'), null, '已經有旅程之後提示就收起來');
    await pg.close();
  }

  // ---------- 8. 剪貼簿是空的 → 退回讓他自己貼 ----------
  {
    const pg = await dev(UA.iosSafari, { standalone: true, clipboard: '' });
    await pg.goto(`http://localhost:${WEB}/#/`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.join-hint', { timeout: 10000 });
    await clickText(pg, 'button', '貼上邀請連結');
    await pg.waitForSelector('.modal-card textarea, .modal-card input', { timeout: 8000 });
    yes(await has(pg, '貼上邀請連結'), '剪貼簿沒東西時退回手動貼上，不會卡住');
    await pg.close();
  }

  // ---------- 9. manifest ----------
  console.log('\n— manifest —');
  {
    const pg = await dev(UA.androidChrome);
    const m = await pg.evaluate(() => fetch('./manifest.webmanifest').then((r) => r.json()));
    eq(m.start_url, './', 'manifest 的 start_url 是根目錄（所以邀請碼一定會掉，補救流程是必要的）');
    yes(!!m.id, `manifest 有固定的 id（"${m.id}"）—— 之後就算改 start_url 也不會被當成另一個 App`);
    await pg.close();
  }

  await host.close();
  console.log('\n加到主畫面測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
  api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
