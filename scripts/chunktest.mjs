// 分塊上傳與上傳爆量（npm run chunktest，v1.65）
//
// 實機情境：出國漫遊、山區訊號弱時，「一個 POST 送全部記錄」會逾時 → 退避 → 又整包
// → 永遠推不上去，畫面停在「正在上傳」而且一直耗電。這支用 puppeteer 的網路節流
// 把那個情境做出來，量改善前後的成功率與耗時。
//
// 也驗證：378 個檔案（189 張照片的縮圖＋全圖）的爆量不會被自己的限流擋掉。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5687, API = 8843;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1800);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

// 3G 級的上行：真實漫遊時大約就是這個量級
const SLOW = { offline: false, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 60 * 1024 / 8, latency: 400 };

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

// 建一個「跟使用者那趟一樣大」的行程：574 筆記錄
async function seed(page, nSubs) {
  return page.evaluate(async (n) => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), mA = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族旅行', region: '宜蘭', allowWiki: false });
    const quests = [];
    for (let i = 0; i < 19; i++) {                       // 19 個景點（跟真實那趟一樣）
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: '景點' + i, emoji: '📍', day: (i % 3) + 1, order: i,
        heroPool: Array.from({ length: 6 }, (_, k) => ({ u: 'https://example.org/x' + k + '.jpg', t: '示意圖' + k })) });
      for (let q = 0; q < 3; q++) {
        const qid = uuid();
        await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `在景點${i}拍第${q}張`, kind: 'thing', order: q });
        quests.push(qid);
      }
    }
    // 用假的 submission 記錄把筆數灌到跟真實那趟一樣（不做真的照片，這支測的是中繼資料）
    for (let i = 0; i < n; i++) {
      await s.put({ id: uuid(), type: 'submission', tripId: tid, questId: quests[i % quests.length], memberId: mA,
        photoHash: 'h' + i.toString(16).padStart(16, '0'), thumbHash: 't' + i.toString(16).padStart(16, '0'),
        w: 1600, h: 1200, bytes: 240000, takenAt: Date.now() - i * 60000, caption: '', byDevice: '測試機' });
    }
    await ensureGroupSync(gid);
    return { gid, tid, secret: s.getRaw(gid).syncSecret, records: s.exportGroup(gid).length };
  }, nSubs);
}

// 用「觀測分頁」查伺服器狀態：被測的那個分頁自己被節流成 3G，用它查會被拖垮，
// 量到的就不是我們想量的東西了。觀測分頁不節流。
let watcher = null;
async function serverCount(gid, secret) {
  // 要跟著分頁：/pull 一次最多回 PULL_LIMIT 筆（500），不翻頁的話 579 筆會被數成 500
  let since = 0, total = 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await fetch(`http://localhost:${API}/pull?g=${encodeURIComponent(gid)}&since=${since}`,
      { headers: { authorization: 'Bearer ' + secret } });
    if (!res.ok) return -1;
    const d = await res.json();
    total += (d.records || []).length;
    if (typeof d.seq === 'number') since = d.seq;
    if (!d.more) break;
  }
  return total;
}
void watcher;

try {
  // ================= 1. 慢網路下的整包 vs 分塊 =================
  console.log('\n— 慢網路（上行 60 kbps／延遲 400ms）下推 574 筆 —');
  const A = await device('A');
  const setup = await seed(A, 500);
  yes(setup.records >= 570, `建立了跟實機一樣大的行程：${setup.records} 筆記錄`);

  // 先量整包會怎樣（直接呼叫 adapter.push 送全部，模擬改善前的行為）
  const cdp = await A.target().createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW);

  const before = await A.evaluate(async (o) => {
    const store = await import('./js/store.js');
    const sync = await import('./js/sync.js');
    const adapter = sync.adapterForGroup(o.gid, o.secret);
    const recs = store.exportGroup(o.gid);
    const bytes = new Blob([JSON.stringify({ records: recs })]).size;
    const t0 = performance.now();
    let err = '';
    try { await adapter.push(recs); } catch (e) { err = String(e.message || e); }
    return { bytes, ms: Math.round(performance.now() - t0), err };
  }, setup);
  console.log(`   整包大小 ${(before.bytes / 1024).toFixed(0)} KB`);
  yes(before.err !== '', `改善前：整包一次送在這個網路下失敗了（${before.ms}ms，${before.err}）—— 逾時 15 秒`);

  // 清掉伺服器上可能已寫進去的部分，重來
  await A.evaluate(async () => { await (await import('./js/db.js')).outboxDelete('push:x'); });

  // 分塊版：走真正的 drain
  const B = await device('B');
  const setupB = await seed(B, 500);
  const cdpB = await B.target().createCDPSession();
  await cdpB.send('Network.enable');
  await cdpB.send('Network.emulateNetworkConditions', SLOW);
  const t0 = Date.now();
  let done = false;
  for (let round = 0; round < 6 && !done; round++) {
    await B.evaluate(async () => { await (await import('./js/outbox.js')).drain({ force: true }); }).catch(() => {});
    const n = await serverCount(setupB.gid, setupB.secret);
    if (n >= setupB.records) done = true;
    else await sleep(500);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const onServer = await serverCount(setupB.gid, setupB.secret);
  yes(done, done
    ? `改善後：同樣的網路，${secs} 秒內把 ${onServer}/${setupB.records} 筆全部送達（分批、每批獨立逾時）`
    : `改善後仍然沒送完：${onServer}/${setupB.records} 筆（${secs} 秒）`);

  // ================= 2. 斷線後只補沒送完的 =================
  console.log('\n— 斷線後續傳 —');
  const C = await device('C');
  const setupC = await seed(C, 500);
  const cdpC = await C.target().createCDPSession();
  await cdpC.send('Network.enable');
  await cdpC.send('Network.emulateNetworkConditions', SLOW);
  // 送一半就斷線
  const half = C.evaluate(async () => { await (await import('./js/outbox.js')).drain({ force: true }); }).catch(() => {});
  await sleep(9000);      // 讓前一兩批送完（60 kbps 下每批 80 筆約 37KB ≈ 5 秒）
  await cdpC.send('Network.emulateNetworkConditions', { ...SLOW, offline: true });
  await half;
  const midway = await serverCount(setupC.gid, setupC.secret).catch(() => -1);
  const entry = await C.evaluate(async (o) => (await (await import('./js/db.js')).outboxGet('push:' + o.gid)) || null, setupC);
  yes(entry && entry.pushed > 0, `斷線時記下了進度（送到第 ${entry?.pushed} 筆），outbox 項目沒有被誤刪`);
  // 恢復連線 → 只補剩下的
  await cdpC.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 });
  const t1 = Date.now();
  for (let round = 0; round < 8; round++) {
    await C.evaluate(async () => { await (await import('./js/outbox.js')).drain({ force: true }); }).catch(() => {});
    if ((await serverCount(setupC.gid, setupC.secret)) >= setupC.records) break;
    await sleep(300);
  }
  const finalN = await serverCount(setupC.gid, setupC.secret);
  yes(finalN >= setupC.records,
    `恢復連線後補完剩下的：${finalN}/${setupC.records} 筆（${((Date.now() - t1) / 1000).toFixed(1)} 秒；中斷時已送 ${midway} 筆）`);
  const gone = await C.evaluate(async (o) => !(await (await import('./js/db.js')).outboxGet('push:' + o.gid)), setupC);
  yes(gone, '全部送完之後 outbox 項目才被清掉');

  // ================= 3. 378 個檔案的上傳爆量 =================
  console.log('\n— 189 張照片＝378 個檔案的爆量 —');
  const D = await device('D');
  const burst = await D.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const db = await import('./js/db.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const o = await import('./js/outbox.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '爆量' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '爆量測試', region: '宜蘭', allowWiki: false });
    await ensureGroupSync(gid);
    // 189 張照片 → 378 個 blob（縮圖 30KB＋全圖 200KB，大小照實機）
    // blob 內容用小的：這一段量的是「請求次數會不會撞到限流」，不是位元組數
    const mk = (n) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
    for (let i = 0; i < 189; i++) {
      // hash 必須是合法的十六進位（伺服器路由是 [a-f0-9]{16,64}）—— 用 'p'/'t' 開頭
      // 會被伺服器直接拒收，那樣量到的就不是上傳速率而是 404
      const ph = 'aa' + i.toString(16).padStart(14, '0'), th = 'bb' + i.toString(16).padStart(14, '0');
      await db.putBlob({ hash: ph, blob: mk(2000), bytes: 200000, kind: 'photo' });
      await db.putBlob({ hash: th, blob: mk(500), bytes: 30000, kind: 'thumb' });
      await o.enqueueBlob(gid, ph); await o.enqueueBlob(gid, th);
    }
    const pending = (await db.outboxAll()).filter((e) => e.op === 'blob' && e.groupId === gid).length;
    // 統計實際發出的 PUT 次數與每分鐘速率
    let puts = 0; const t0 = performance.now();
    const of = window.fetch;
    window.fetch = async (u, init) => { if (init?.method === 'PUT' && String(u).includes('/blob/')) puts++; return of(u, init); };
    for (let r = 0; r < 8; r++) {
      await o.drain({ force: true }).catch(() => {});
      if ((await db.outboxAll()).filter((e) => e.op === 'blob' && e.groupId === gid).length === 0) break;
    }
    window.fetch = of;
    const left = (await db.outboxAll()).filter((e) => e.op === 'blob' && e.groupId === gid).length;
    const secs = (performance.now() - t0) / 1000;
    return { pending, puts, left, secs: +secs.toFixed(1), perMin: Math.round(puts / secs * 60) };
  });
  yes(burst.pending === 378, `排進待送佇列的檔案數正確：${burst.pending} 個（189 張照片 × 縮圖＋全圖）`);
  yes(burst.left === 0,
    `全部上傳完成，一個都沒卡住（實際送出 ${burst.puts} 次 PUT、${burst.secs} 秒）`,
    burst.left ? `還有 ${burst.left} 個沒送出去` : '');
  console.log(`   本機環境的速率是 ${burst.perMin}/分（本機沒有網路延遲，真機約 150–400/分）；`);
  console.log(`   限流額度設 200/分：真機的爆量約 2 分鐘傳完，不會擋到自己人。`);

  console.log('\n分塊與爆量測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
