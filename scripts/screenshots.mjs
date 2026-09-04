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
const OUT = fileURLToPath(new URL('../screenshots/_smoke/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'ignore',
});
await sleep(1200);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const shot = (name) => page.screenshot({ path: join(OUT, name + '.png') });
async function go(hash) { await page.goto('about:blank'); await page.goto(BASE + hash, { waitUntil: 'networkidle0' }); }
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('✓ ' + m);

try {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero', { timeout: 5000 });
  await shot('01-home-empty');
  ok('首頁');

  const tripId = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '京都家族旅行 旅伴' });
    for (const n of ['爸', '媽', '阿嬤', '我']) await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: n });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '京都家族旅行', startDate: '2026-04-01', endDate: '2026-04-03', region: '京都', allowGeo: false, allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, itineraryText: '第1天 清水寺、金閣寺、伏見稻荷大社\n第2天 嵐山竹林、大阪城\n第3天 奈良公園', region: '京都' });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    return tid;
  });
  ok('產生行程與任務');

  await go('/#/new');
  await page.waitForSelector('.quick-pick');
  await shot('02-create');

  await go(`/#/trip/${tripId}`);
  await page.waitForSelector('.qbig');
  await shot('03-trip');
  ok('行程總覽（大任務卡）');

  const spotId = await page.evaluate(async (tid) => (await import('./js/store.js')).spotsOf(tid)[0].id, tripId);
  const questId = await page.evaluate(async (sid) => (await import('./js/store.js')).questsOf(sid)[0].id, spotId);
  await go(`/#/quest/${questId}`);
  await page.waitForSelector('.quest-focus');
  await shot('04-quest');
  ok('任務詳情（大拍照鈕）');

  // 灌照片 + 讚 + 留言
  await page.evaluate(async (tid) => {
    const { importPhoto } = await import('./js/photos.js');
    const s = await import('./js/store.js');
    const members = s.membersOf(s.get(tid).groupId);
    const make = (hue, label) => { const c = document.createElement('canvas'); c.width = 1400; c.height = 1050; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 1400, 1050); g.addColorStop(0, `hsl(${hue},60%,52%)`); g.addColorStop(1, `hsl(${(hue + 50) % 360},55%,30%)`);
      x.fillStyle = g; x.fillRect(0, 0, 1400, 1050); x.fillStyle = 'rgba(255,255,255,.9)'; x.font = 'bold 90px sans-serif'; x.textAlign = 'center'; x.fillText(label, 700, 560);
      return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.88)); };
    let i = 0;
    for (const q of s.questsOfTrip(tid)) {
      const blob = await make((i * 37) % 360, q.title.slice(0, 4));
      const sub = await importPhoto(new File([blob], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: members[i % members.length].id, allowGeo: false });
      if (i < 6) await s.toggleReaction(sub.id, members[(i + 1) % members.length].id, '❤️');
      if (i === 0) await s.addComment(sub.id, members[2].id, '阿嬤拍得真好！');
      i++;
    }
  }, tripId);
  ok('灌入合成照片 + 讚 + 留言');

  await go(`/#/trip/${tripId}/people`);
  await page.waitForSelector('.people-row');
  await shot('05-people');
  ok('照片牆 / 按讚留言');

  await go(`/#/quest/${questId}`);
  await page.waitForSelector('.photo-cell');
  await shot('06-quest-done');

  await go(`/#/trip/${tripId}`);
  await page.waitForSelector('.qbig.done');
  await shot('07-trip-done');

  await go(`/#/trip/${tripId}/album`);
  await page.waitForSelector('.album-canvas');
  await sleep(800);
  await shot('08-album');
  ok('回憶影片頁');

  // 時間軸 + 相簿頁
  const tl = await page.evaluate(async (tid) => {
    const m = await import('./js/memory.js');
    const timeline = await m.buildTimeline(tid);
    const album = await m.buildAlbumPage(tid);
    const txt = await album.text();
    return {
      kinds: [...new Set(timeline.segs.map(s => s.kind))],
      total: Math.round(timeline.total),
      albumKB: Math.round(album.size / 1024),
      days: (txt.match(/class="day"/g) || []).length,
      hasImg: /data:image\/(jpeg|webp|png);base64/.test(txt),
    };
  }, tripId);
  if (tl.hasImg && tl.days === 3 && tl.kinds.includes('map') && tl.kinds.includes('intro') && tl.kinds.includes('outro'))
    ok(`時間軸 [${tl.kinds.join(',')}] ${tl.total}s · 相簿頁 ${tl.albumKB}KB / ${tl.days} 天`);
  else fail('時間軸 / 相簿頁：' + JSON.stringify(tl));

  // 錄影（含程序配樂）
  const vid = await page.evaluate(async (tid) => {
    const m = await import('./js/memory.js');
    if (!m.videoSupported()) return { skipped: true };
    try {
      const { blob, ext } = await m.recordVideo(tid, { music: 'gentle', onProgress: () => {} });
      const hasAudio = blob.size > 20000;
      return { ok: true, ext, kb: Math.round(blob.size / 1024), hasAudio };
    } catch (e) { return { ok: false, err: String(e.message) }; }
  }, tripId);
  if (vid.skipped) ok('錄影：此環境不支援，略過（手機上會提供）');
  else if (vid.ok && vid.kb > 30) ok(`錄影：${vid.ext} ${vid.kb}KB`);
  else fail('錄影：' + JSON.stringify(vid));

  await go('/#/settings');
  await page.waitForSelector('.seg');
  await shot('09-settings');

  // 字級切換
  await page.evaluate(async () => { (await import('./js/prefs.js')).setPref('fs', 'xl'); });
  await go(`/#/trip/${tripId}`);
  await page.waitForSelector('.qbig');
  await shot('10-trip-xl-font');
  const fsAttr = await page.evaluate(() => document.documentElement.dataset.fs);
  if (fsAttr === 'xl') ok('字級切換（特大）'); else fail('字級切換：' + fsAttr);
  await page.evaluate(async () => { (await import('./js/prefs.js')).setPref('fs', 'm'); });

  // 分享代碼往返
  const rt = await page.evaluate(async (tid) => {
    const share = await import('./js/share.js');
    const store = await import('./js/store.js');
    const url = await share.shareURL(tid);
    const newTid = await share.importShareCode(url.split('d=')[1]);
    return { urlLen: url.length, spots: store.spotsOf(newTid).length };
  }, tripId);
  if (rt.spots === 6) ok(`分享代碼往返（${rt.urlLen} 字元）`); else fail('分享代碼：' + JSON.stringify(rt));

} catch (e) {
  fail('例外：' + e.stack);
} finally {
  if (errors.length) { console.error('主控台錯誤：\n' + errors.join('\n')); process.exitCode = 1; }
  else ok('無主控台錯誤');
  await browser.close();
  server.kill();
  console.log('\n截圖輸出：screenshots/_smoke/（完整功能截圖集請用 npm run gallery）');
}
