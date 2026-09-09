// 兩台裝置的即時同步（npm run livesynctest，v1.63）——照使用者實測的情境走一遍，量實際秒數：
//   A 用建立流程開行程 → 分享 → B 加入 → A 停在任務頁不動，多久看到 B？
//   兩台都開位置分享 → 多久互相看得到？
// 這支刻意「不手動戳同步」：全部靠背景排程與開頁觸發，量的就是使用者會感受到的時間。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5679, API = 8835;
const BUDGET = Number(process.env.TQ_BUDGET || 45000);      // 驗收門檻：30 秒內要看到（留裕度）
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

async function device(name, lat, lng) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://localhost:${WEB}`, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setGeolocation({ latitude: lat, longitude: lng });
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  return page;
}

// 等某個條件成立，回傳花了幾秒（不主動觸發同步）
async function waitFor(page, fn, arg, budget = BUDGET) {
  const t0 = Date.now();
  try { await page.waitForFunction(fn, { timeout: budget, polling: 500 }, arg); }
  catch { return null; }
  return (Date.now() - t0) / 1000;
}

try {
  const A = await device('A', 24.6770, 121.7669);
  const B = await device('B', 24.6800, 121.7700);          // 約 380 公尺外

  // ---------- A 建行程（走跟真人一樣的路：建立者也要有 claim）----------
  const setup = await A.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    const today = new Date().toISOString().slice(0, 10);
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭行', region: '宜蘭',
      startDate: today, endDate: today, createdByDevice: myDeviceId(), allowWiki: false });
    const sid = uuid();
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '羅東夜市', emoji: '🏮', day: 1, order: 0 });
    await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: '拍一張', kind: 'thing', order: 0 });
    await ensureGroupSync(gid);
    // 建立流程會替建立者認領身分（v1.63）：多位成員時會跳「哪一位是你？」
    // 不 await —— 下面測試會像真人一樣去點那個選單
    window.__claiming = (async () => (await import('./js/claim.js')).claimAsCreator(tid))();
    return { gid, tid, mA, mB, secret: s.getRaw(gid).syncSecret };
  });
  // 建立者選「這是誰的手機」——真人在建立流程最後會看到這一步
  await A.waitForFunction(() => [...document.querySelectorAll('.modal-card button, .pick-member button')].some((b) => b.textContent.includes('媽媽')), { timeout: 10000 });
  await A.evaluate(() => [...document.querySelectorAll('.modal-card button, .pick-member button')].find((b) => b.textContent.includes('媽媽')).click());
  await A.evaluate(() => window.__claiming);
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  await sleep(600);

  // A 停在任務頁（就像使用者那樣）
  await A.evaluate((o) => { location.hash = '#/trip/' + o.tid; }, setup);
  await A.waitForSelector('.hero', { timeout: 10000 });
  await sleep(500);

  // ---------- 建立者要自動算「已加入」 ----------
  console.log('\n— 建立者的身分 —');
  const creator = await A.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const { activeMemberId } = await import('./js/claim.js');
    return {
      active: activeMemberId(o.tid),
      claims: s.exportRecords().filter((r) => r.type === 'memberClaim' && r.tripId === o.tid).length,
    };
  }, setup);
  yes(creator.active && creator.claims >= 1,
    `建立者一開始就有身分與 claim（active=${!!creator.active}、claims=${creator.claims}）—— 不然旅伴會看到「建立者未加入」，而且他的位置永遠傳不出去`);

  // ---------- B 加入 → A 停在前景不動，多久看到？ ----------
  console.log('\n— B 加入，A 停在任務頁不動 —');
  await B.evaluate(async (o) => {
    const { joinInvite } = await import('./js/share.js');
    const { getConfig } = await import('./js/sync.js');
    const tid = await joinInvite({ kind: 'sync', short: true, groupId: o.gid, secret: o.secret, url: getConfig().url, tripPrefix: o.tid.slice(0, 8) });
    await (await import('./js/claim.js')).claim(tid, o.mB);   // B 選了「爸爸」
  }, setup);

  const tJoin = await waitFor(A, (o) => {
    const btn = [...document.querySelectorAll('.crew-btn, .join-banner')].map((x) => x.textContent).join(' ');
    return btn.includes('2/2') || btn.includes('加入了');
  }, setup);
  yes(tJoin != null, tJoin != null
    ? `A 在前景不動，${tJoin.toFixed(1)} 秒後畫面自己更新成「有人加入」`
    : `A 等了 ${BUDGET / 1000} 秒還是沒看到 B 加入`);

  // ---------- B 看 A 是不是「已加入」 ----------
  const bSeesA = await B.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const claims = s.exportRecords().filter((r) => r.type === 'memberClaim' && r.tripId === o.tid);
    return { aJoined: claims.some((c) => c.memberId === o.mA), total: claims.length };
  }, setup);
  yes(bSeesA.aJoined, `B 那邊看得到「建立者已加入」（claims=${bSeesA.total}）`);

  // ---------- 雙方開位置分享 → 多久互相看到 ----------
  console.log('\n— 位置分享 —');
  for (const [p, o] of [[A, setup], [B, setup]]) {
    await p.evaluate(async (x) => {
      const pos = await import('./js/pos.js');
      await pos.setSharing(x.tid, true);
    }, o);
  }
  // A 開著 SOS 頁等 B 的位置（使用者的實際動作）
  await A.evaluate((o) => { location.hash = '#/trip/' + o.tid + '/sos'; }, setup);
  await A.waitForSelector('.sos-crew', { timeout: 20000 });
  const tPosA = await waitFor(A, () => {
    const t = [...document.querySelectorAll('.sos-crew')].map((x) => x.textContent).join(' ');
    return /公尺|公里/.test(t);
  }, null);
  yes(tPosA != null, tPosA != null
    ? `A 打開 SOS 頁後 ${tPosA.toFixed(1)} 秒看到 B 的位置`
    : `A 等了 ${BUDGET / 1000} 秒仍看不到 B 的位置`);

  await B.evaluate((o) => { location.hash = '#/trip/' + o.tid + '/sos'; }, setup);
  await B.waitForSelector('.sos-crew', { timeout: 20000 });
  const tPosB = await waitFor(B, () => {
    const t = [...document.querySelectorAll('.sos-crew')].map((x) => x.textContent).join(' ');
    return /公尺|公里/.test(t);
  }, null);
  yes(tPosB != null, tPosB != null
    ? `B 打開 SOS 頁後 ${tPosB.toFixed(1)} 秒看到 A 的位置`
    : `B 等了 ${BUDGET / 1000} 秒仍看不到 A 的位置`);

  // ---------- 停在前景不動也要持續收到更新 ----------
  console.log('\n— 前景停留時的持續同步 —');
  await A.evaluate((o) => { location.hash = '#/trip/' + o.tid; }, setup);
  await sleep(800);
  await B.evaluate(async (o) => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    await s.put({ id: uuid(), type: 'spot', tripId: o.tid, name: '太平山', emoji: '⛰️', day: 1, order: 1 });
  }, setup);
  const tSpot = await waitFor(A, () => document.body.textContent.includes('太平山'), null);
  yes(tSpot != null, tSpot != null
    ? `A 停在任務頁不動，旅伴新增的景點 ${tSpot.toFixed(1)} 秒後自己出現（不用重開 App）`
    : `A 停在前景 ${BUDGET / 1000} 秒都沒收到旅伴的新景點`);

  console.log(`\n實測秒數：看到加入 ${tJoin ?? '逾時'}s／看到對方位置 A ${tPosA ?? '逾時'}s・B ${tPosB ?? '逾時'}s／新景點 ${tSpot ?? '逾時'}s`);
  console.log('\n兩台裝置同步測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
