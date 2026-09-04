// 斷言：AI 金鑰絕不會出現在任何匯出 / 同步 payload / SW 快取。
// 用法：node scripts/secret-leak-test.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const PORT = 5321;
const BASE = `http://localhost:${PORT}`;
const FAKE_ANTHROPIC = 'sk-ant-api03-' + 'A'.repeat(80);
const FAKE_GOOGLE = 'AIza' + 'B'.repeat(35);

const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await sleep(1200);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

const result = await page.evaluate(async (fakeA, fakeG) => {
  const store = await import('./js/store.js');
  const share = await import('./js/share.js');
  const identity = await import('./js/identity.js');
  const aikeys = await import('./js/aikeys.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const { uuid } = await import('./js/ids.js');

  const gid = uuid(), tid = uuid();
  await store.put({ id: gid, type: 'group', name: 't 旅伴', syncSecret: 'a'.repeat(32) });
  await store.put({ id: uuid(), type: 'member', groupId: gid, displayName: '我' });
  await store.put({ id: tid, type: 'trip', groupId: gid, title: '祕鑰測試', region: '台北', country: 'TW', aiEnabled: true, createdByDevice: identity.myDeviceId() });
  const { spots, quests } = await generateForTrip({ tripId: tid, region: '台北', itineraryText: '台北101' });
  for (const s of spots) await store.put(s);
  for (const q of quests) await store.put(q);

  // 存入假金鑰
  await aikeys.setTripKey(tid, { key: fakeA, ttsKey: fakeG, capUsd: 5 });
  await aikeys.addUsage(tid, 12345);

  // sanity：確定真的存進去了
  const back = await aikeys.getTripKey(tid);
  const stored = back && back.key === fakeA && back.ttsKey === fakeG;

  // 各匯出路徑
  const hits = {};
  const scan = (label, str) => {
    const s = String(str);
    if (s.includes('sk-ant-') || s.includes('AIza') || s.includes(fakeA) || s.includes(fakeG)) hits[label] = true;
  };

  scan('exportRecords', JSON.stringify(store.exportRecords()));
  scan('exportGroup', JSON.stringify(store.exportGroup(gid)));
  try { scan('exportBundle', await blobText(await share.exportBundle(tid))); } catch (e) { hits['exportBundle_err'] = String(e); }
  try { scan('exportCard', JSON.stringify(await identity.exportCard())); } catch (e) { hits['exportCard_err'] = String(e); }
  try { scan('encodeCard', identity.encodeCard(await identity.exportCard())); } catch { /* */ }

  // 邀請連結
  try { scan('shareURL', await share.shareURL(tid)); } catch { /* */ }

  // SW 快取的 key（不該有 api 主機）
  let swBad = [];
  if (self.caches) {
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        if (/anthropic|googleapis/.test(req.url)) swBad.push(req.url);
      }
    }
  }

  return { stored, hits, swBad };

  async function blobText(b) { return await b.text(); }
}, FAKE_ANTHROPIC, FAKE_GOOGLE);

await browser.close();
server.kill();

let ok = true;
if (!result.stored) { console.log('✗ 假金鑰沒有正確存入 tripSecrets'); ok = false; }
const leakKeys = Object.keys(result.hits);
if (leakKeys.length) { console.log('✗ 金鑰洩漏於：', leakKeys.join(', ')); ok = false; }
else console.log('✓ exportRecords / exportGroup / exportBundle / exportCard / encodeCard / shareURL 皆無金鑰');
if (result.swBad.length) { console.log('✗ SW 快取到 API 主機：', result.swBad); ok = false; }
else console.log('✓ SW 快取無 anthropic / googleapis 主機');
if (errs.length) { console.log('✗ pageerror：', errs); ok = false; }

console.log(ok ? '\n祕鑰洩漏測試通過' : '\n祕鑰洩漏測試失敗');
process.exit(ok ? 0 : 1);
