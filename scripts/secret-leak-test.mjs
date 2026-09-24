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
  await aikeys.setTripKey(tid, { key: fakeA, mapsKey: fakeG, capUsd: 5 });
  await aikeys.addUsage(tid, 12345);

  // 這台手機的預設金鑰（匯入行程表用的那支）—— 它跟每趟的金鑰放在同一個 store，
  // 所以下面每一條匯出路徑的斷言同時也在保護它。
  await aikeys.setDeviceKey({ key: fakeA, capUsd: 3 });
  const dev = await aikeys.getDeviceKey();
  const deviceStored = !!(dev && dev.key === fakeA);

  // 建第二趟，驗證 adoptDeviceKey 是「複製」不是「共用」：各自算各自的額度
  const tid2 = uuid();
  await store.put({ id: tid2, type: 'trip', groupId: gid, title: '第二趟', region: '台北', country: 'TW', aiEnabled: true, createdByDevice: identity.myDeviceId() });
  await aikeys.adoptDeviceKey(tid2);
  const t2 = await aikeys.getTripKey(tid2);
  await aikeys.addUsage(tid2, 99);
  const devAfter = await aikeys.getDeviceKey();
  const adopted = !!(t2 && t2.key === fakeA && t2.capUsd === 3);
  const isolated = (devAfter.usedMicroUsd || 0) === (dev.usedMicroUsd || 0);

  // 已經有自己金鑰的旅程，不可以被預設金鑰覆蓋
  const noOverwrite = (await aikeys.adoptDeviceKey(tid)) === false;

  // sanity：確定真的存進去了
  const back = await aikeys.getTripKey(tid);
  const stored = back && back.key === fakeA && back.mapsKey === fakeG;

  // 各匯出路徑
  const hits = {};
  // 每一條匯出路徑都要真的跑到：丟錯＝這條路沒掃到，要記下來、算失敗，不能當成「無金鑰」
  // （2026-09-24 盤點實測：原本兩個空 catch，shareURL 丟錯時照樣印「shareURL 皆無金鑰」）
  const scanned = [], skipped = {};
  const detect = (s) => s.includes('sk-ant-') || s.includes('AIza') || s.includes(fakeA) || s.includes(fakeG);
  // 掃描式自己的對照組：四種金鑰形狀各一段合成樣本必須抓到、乾淨的字串必須不抓到（同一個 detect）。
  // 2026-09-24 盤點實測：原本把掃描式弄壞，真的洩漏也照樣全綠——沒有任何東西會發現掃描式壞了。
  const ctrl = {
    'sk-ant- 字首': detect('{"k":"sk-ant-' + 'x'.repeat(20) + '"}'),
    'AIza 字首': detect('key=AIza' + 'y'.repeat(35)),
    '假 Anthropic 金鑰全文': detect(JSON.stringify({ v: fakeA.slice(0) })),
    '假 Google 金鑰全文': detect(JSON.stringify({ v: fakeG.slice(0) })),
    '乾淨的字串不算': !detect('{"title":"祕鑰測試","region":"台北"}'),
  };
  const scan = (label, str) => {
    const s = String(str);
    if (!s) { skipped[label] = '取到空的'; return; }
    scanned.push(label);
    if (detect(s)) hits[label] = true;
  };
  const tryScan = async (label, get) => { try { scan(label, await get()); } catch (e) { skipped[label] = String(e).slice(0, 120); } };

  await tryScan('exportRecords', () => JSON.stringify(store.exportRecords()));
  await tryScan('exportGroup', () => JSON.stringify(store.exportGroup(gid)));
  await tryScan('exportBundle', async () => blobText(await share.exportBundle(tid)));
  await tryScan('exportCard', async () => JSON.stringify(await identity.exportCard()));
  await tryScan('encodeCard', async () => identity.encodeCard(await identity.exportCard()));

  // 邀請連結
  await tryScan('shareURL', () => share.shareURL(tid));

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

  return { stored, hits, swBad, deviceStored, adopted, isolated, noOverwrite, scanned, skipped, ctrl };

  async function blobText(b) { return await b.text(); }
}, FAKE_ANTHROPIC, FAKE_GOOGLE);

await browser.close();
server.kill();

let ok = true;
if (!result.stored) { console.log('✗ 假金鑰沒有正確存入 tripSecrets'); ok = false; }
if (!result.deviceStored) { console.log('✗ 裝置預設金鑰沒有正確存入'); ok = false; } else console.log('✓ 裝置預設金鑰存在同一個 tripSecrets store（匯出保證自動涵蓋）');
if (!result.adopted) { console.log('✗ adoptDeviceKey 沒有把金鑰與上限複製給新旅程'); ok = false; } else console.log('✓ 新旅程複製到預設金鑰與花費上限');
if (!result.isolated) { console.log('✗ 新旅程的花費算到預設金鑰頭上了（應該各自獨立）'); ok = false; } else console.log('✓ 每趟各自記帳，不共用額度');
if (!result.noOverwrite) { console.log('✗ 已有金鑰的旅程被預設金鑰覆蓋'); ok = false; } else console.log('✓ 已有自己金鑰的旅程不會被覆蓋');
const ctrlBad = Object.entries(result.ctrl || {}).filter(([, v]) => !v).map(([k]) => k);
if (!result.ctrl || Object.keys(result.ctrl).length !== 5) { console.log('✗ 掃描式的對照組沒有跑（檢查器壞了）'); ok = false; }
else if (ctrlBad.length) { console.log('✗ 掃描式的對照組沒過：' + ctrlBad.join('、') + '——掃描式壞了，下面「無金鑰」的結論不算數'); ok = false; }
else console.log('✓ 掃描式的對照組：四種金鑰形狀都抓得到、乾淨的字串不會被誤抓');
const leakKeys = Object.keys(result.hits);
const skippedKeys = Object.keys(result.skipped);
const EXPECTED = ['exportRecords', 'exportGroup', 'exportBundle', 'exportCard', 'encodeCard', 'shareURL'];
if (skippedKeys.length) {
  // 情境壞了：沒掃到的路徑不准被算進「無金鑰」
  for (const k of skippedKeys) console.log(`✗ ${k} 沒有掃到（${result.skipped[k]}）——這一條路徑有沒有金鑰不知道`);
  ok = false;
}
if (leakKeys.length) { console.log('✗ 金鑰洩漏於：', leakKeys.join(', ')); ok = false; }
// 肯定句只在每一條路徑都真的掃到、而且都沒命中時才印，而且只列真的掃到的
const missing = EXPECTED.filter((k) => !result.scanned.includes(k) && !(k in result.skipped));
if (missing.length) { console.log('✗ 掃到的路徑少於預期（沒丟錯、也沒掃到）：' + missing.join(', ')); ok = false; }
// 情境（兩把假金鑰真的存進去了）沒造出來時，「無金鑰」恆真——不准印肯定句
// （2026-09-24 T13 成對驗：只讓金鑰沒存進去，前置紅了、後面卻照樣印「皆無金鑰」）
const situationOk = result.stored && result.deviceStored;
if (!situationOk) console.log('✗ 假金鑰沒存進去，沒有東西可以漏——下面不下「無金鑰」的結論');
if (situationOk && !ctrlBad.length && result.ctrl && !leakKeys.length && !skippedKeys.length && !missing.length) {
  console.log(`✓ ${result.scanned.join(' / ')} 皆無金鑰（${result.scanned.length} 條路徑都真的掃到）`);
}
if (result.swBad.length) { console.log('✗ SW 快取到 API 主機：', result.swBad); ok = false; }
else console.log('✓ SW 快取無 anthropic / googleapis 主機');
if (errs.length) { console.log('✗ pageerror：', errs); ok = false; }

console.log(ok ? '\n祕鑰洩漏測試通過' : '\n祕鑰洩漏測試失敗');
process.exit(ok ? 0 : 1);
