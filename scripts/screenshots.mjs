// Puppeteer 冒煙測試 + 產生 README 用截圖
// 用法：node scripts/screenshots.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('..', import.meta.url),
  stdio: 'ignore',
});
await sleep(1200);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const shot = (name) => page.screenshot({ path: join(OUT, name + '.png') });
// hash-only 變化不會觸發真正導覽，所以每次先回空白再進目標
async function go(hash) {
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
}
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('✓ ' + msg);

try {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero', { timeout: 5000 });
  await shot('01-home-empty');
  ok('首頁載入');

  // 建立行程（直接呼叫模組，跳過逐欄輸入）
  const tripId = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const groupId = uuid(), tripId = uuid();
    await s.put({ id: groupId, type: 'group', name: '京都 旅伴', joinCode: '' });
    await s.put({ id: uuid(), type: 'member', groupId, displayName: '我' });
    await s.put({ id: uuid(), type: 'member', groupId, displayName: '小明' });
    await s.put({ id: uuid(), type: 'member', groupId, displayName: '阿華' });
    await s.put({ id: tripId, type: 'trip', groupId, title: '京都三日遊', startDate: '2026-04-01', endDate: '2026-04-03', region: '京都', allowGeo: false });
    const { spots, quests } = await generateForTrip({ tripId, itineraryText: '第1天 清水寺、金閣寺、伏見稻荷大社\n第2天 嵐山竹林、大阪城、道頓堀\n第3天 奈良公園', region: '京都' });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    return tripId;
  });
  ok('產生行程與任務');

  await go(`/#/new`);
  await page.waitForSelector('.form');
  await shot('02-create');

  await go(`/#/trip/${tripId}`);
  await page.waitForSelector('.spot-row');
  await shot('03-trip-overview');
  ok('行程總覽');

  const spotId = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    return s.spotsOf(tid)[0].id;
  }, tripId);
  await go(`/#/trip/${tripId}/spot/${spotId}`);
  await page.waitForSelector('.quest-card');
  await shot('04-spot');
  ok('景點任務列表');

  const questId = await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    return s.questsOf(sid)[0].id;
  }, spotId);
  await go(`/#/quest/${questId}`);
  await page.waitForSelector('.quest-hero');
  await shot('05-quest-empty');
  ok('任務詳情');

  // 灌入合成照片解鎖全部任務
  await page.evaluate(async (tid) => {
    const { importPhoto } = await import('./js/photos.js');
    const s = await import('./js/store.js');
    const members = s.membersOf(s.get(tid).groupId);
    const make = (hue) => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 1600, 1200); g.addColorStop(0, `hsl(${hue},65%,55%)`); g.addColorStop(1, `hsl(${(hue + 70) % 360},60%,32%)`);
      x.fillStyle = g; x.fillRect(0, 0, 1600, 1200); x.fillStyle = 'rgba(255,255,255,.85)'; x.font = 'bold 160px sans-serif'; x.fillText('✶', 700, 680);
      return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.9)); };
    let i = 0;
    for (const q of s.questsOfTrip(tid)) {
      const blob = await make((i * 33) % 360);
      await importPhoto(new File([blob], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: members[i % members.length].id, allowGeo: false });
      i++;
    }
  }, tripId);
  ok('灌入 ' + '合成照片');

  await go(`/#/quest/${questId}`);
  await page.waitForSelector('.photo-cell');
  await shot('06-quest-done');

  await go(`/#/trip/${tripId}`);
  await page.waitForSelector('.spot-row');
  await shot('07-trip-complete');

  await go(`/#/trip/${tripId}/album`);
  await page.waitForSelector('.album-canvas');
  await page.evaluate(() => document.querySelector('.album-canvas').scrollIntoView());
  await sleep(500);
  await shot('08-album');
  ok('回憶影片頁');

  // 相簿頁產生
  const albumOk = await page.evaluate(async (tid) => {
    const m = await import('./js/memory.js');
    const blob = await m.buildAlbumPage(tid);
    const txt = await blob.text();
    return blob.size > 5000 && txt.includes('data:image/jpeg;base64') && (txt.match(/class="slide"/g) || []).length > 0;
  }, tripId);
  if (albumOk) ok('動態相簿頁產生'); else fail('動態相簿頁產生失敗');

  // 錄影（feature-detect；headless swiftshader 下可能不支援，僅在支援時驗證）
  const vid = await page.evaluate(async (tid) => {
    const m = await import('./js/memory.js');
    if (!m.videoSupported()) return { skipped: true };
    try {
      const { blob, ext } = await m.recordVideo(tid, { onProgress: () => {} });
      return { ok: true, ext, bytes: blob.size };
    } catch (e) { return { ok: false, err: String(e.message) }; }
  }, tripId);
  if (vid.skipped) ok('錄影：此環境不支援，略過（正式手機上會提供）');
  else if (vid.ok && vid.bytes > 1000) ok(`錄影：${vid.ext} ${(vid.bytes / 1024 | 0)}KB`);
  else fail('錄影失敗：' + JSON.stringify(vid));

  await go(`/#/settings`);
  await page.waitForSelector('.storage-box');
  await shot('09-settings');

  // 分享代碼往返
  const roundTrip = await page.evaluate(async (tid) => {
    const share = await import('./js/share.js');
    const store = await import('./js/store.js');
    const url = await share.shareURL(tid);
    const code = url.split('d=')[1];
    const newTid = await share.importShareCode(code);
    return { urlLen: url.length, spots: store.spotsOf(newTid).length };
  }, tripId);
  if (roundTrip.spots === 7) ok(`分享代碼往返（${roundTrip.urlLen} 字元、7 景點）`); else fail('分享代碼往返：' + JSON.stringify(roundTrip));

  // join 深連結畫面
  const code = await page.evaluate(async (tid) => {
    const share = await import('./js/share.js');
    return (await share.shareURL(tid)).split('d=')[1];
  }, tripId);
  await go(`/#/join?d=${code}`);
  await page.waitForSelector('.hero');
  const joinText = await page.evaluate(() => document.querySelector('.hero').innerText);
  if (joinText.includes('邀請你加入')) ok('join 深連結畫面'); else fail('join 畫面：' + joinText);
  await shot('10-join');

} catch (e) {
  fail('例外：' + e.stack);
} finally {
  if (errors.length) { console.error('主控台錯誤：\n' + errors.join('\n')); process.exitCode = 1; }
  else ok('無主控台錯誤');
  await browser.close();
  server.kill();
  console.log('\n截圖輸出：screenshots/');
}
