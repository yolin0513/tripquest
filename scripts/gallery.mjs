// 產生完整功能截圖集（含示範資料，全部用佔位圖 / 維基百科公開圖，不含任何真實個人照片）。
// 輸出到 screenshots/，檔名見 console。
// 用法：node scripts/gallery.mjs  （或 npm run gallery）
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const PORT = 5196;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore',
});
await sleep(1200);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const shot = (name) => page.screenshot({ path: join(OUT, name + '.png') }).then(() => console.log('  ✓', name + '.png'));
const shotEl = (sel, name) => page.$(sel).then((el) => el.screenshot({ path: join(OUT, name + '.png') })).then(() => console.log('  ✓', name + '.png'));
async function go(hash) { await page.goto('about:blank'); await page.goto(BASE + hash, { waitUntil: 'networkidle0' }); }

// ---------- 塞示範資料 ----------
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

const { tripId } = await page.evaluate(async () => {
  const s = await import('./js/store.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const { uuid } = await import('./js/ids.js');
  const gid = uuid(), tid = uuid();
  await s.put({ id: gid, type: 'group', name: '京都三日遊 旅伴' });
  const members = [];
  for (const n of ['爸', '媽', '我']) { const id = uuid(); members.push(id); await s.put({ id, type: 'member', groupId: gid, displayName: n }); }
  await s.put({ id: tid, type: 'trip', groupId: gid, title: '京都三日遊', startDate: '2026-04-01', endDate: '2026-04-03', region: '京都', allowGeo: false, allowWiki: true });
  const { spots, quests } = await generateForTrip({
    tripId: tid, region: '京都',
    itineraryText: '第1天 清水寺、金閣寺、伏見稻荷大社\n第2天 嵐山竹林、大阪城\n第3天 奈良公園',
  });
  for (const sp of spots) await s.put(sp);
  for (const q of quests) await s.put(q);
  window.__members = members;
  return { tripId: tid };
});

// 景點示意圖（Wikipedia）
await page.evaluate(async (tid) => { await (await import('./js/enrich.js')).enrichTrip(tid, { force: true }); }, tripId);
await sleep(500);

// 產生佔位照片的函式 + 灌入「部分完成」
async function fillPhotos(tid, fraction) {
  return page.evaluate(async (tid, fraction) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const members = s.membersOf(s.get(tid).groupId).map((m) => m.id);
    const make = (hue, label) => {
      const c = document.createElement('canvas'); c.width = 1400; c.height = 1050;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 1400, 1050);
      g.addColorStop(0, `hsl(${hue},58%,54%)`); g.addColorStop(1, `hsl(${(hue + 55) % 360},52%,32%)`);
      x.fillStyle = g; x.fillRect(0, 0, 1400, 1050);
      x.fillStyle = 'rgba(255,255,255,.22)';
      for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(200 + i * 220, 300 + (i % 2) * 400, 120, 0, 7); x.fill(); }
      x.fillStyle = 'rgba(255,255,255,.92)'; x.font = 'bold 84px sans-serif'; x.textAlign = 'center';
      x.fillText(label, 700, 560);
      x.font = '38px sans-serif'; x.fillText('示範佔位圖', 700, 640);
      return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.86));
    };
    const quests = s.questsOfTrip(tid);
    const n = Math.round(quests.length * fraction);
    const existing = new Set(quests.filter(q => s.isQuestDone(q.id)).map(q => q.id));
    let done = existing.size, i = 0;
    for (const q of quests) {
      if (done >= n) break;
      if (existing.has(q.id)) { i++; continue; }
      const blob = await make((i * 41) % 360, q.title.slice(0, 5));
      const sub = await importPhoto(new File([blob], `p${i}.jpg`, { type: 'image/jpeg' }),
        { tripId: tid, questId: q.id, memberId: members[i % members.length], allowGeo: false });
      // 幾張加讚 / 留言
      if (i % 3 === 0) await s.toggleReaction(sub.id, members[(i + 1) % 3], '❤️');
      if (i % 4 === 0) await s.toggleReaction(sub.id, members[(i + 2) % 3], '👍');
      if (i === 0) { await s.addComment(sub.id, members[1], '阿嬤這張拍得真好！'); await s.addComment(sub.id, members[0], '構圖有進步 👍'); }
      if (i === 3) await s.addComment(sub.id, members[2], '這個角度我沒想到');
      done++; i++;
    }
    return done;
  }, tid, fraction);
}

console.log('截圖：');

// ---------- 1. 首頁 ----------
await fillPhotos(tripId, 0.55);
await go('/#/');
await page.waitForSelector('.trip-card');
await shot('01-home');

// ---------- 2-3. 建立行程：階層選景點 ----------
await go('/#/new');
await page.waitForSelector('.pick-big');
await page.evaluate(() => { const f = document.querySelector('input[type=text]'); if (f) f.value = '京都家族旅行'; });
await shot('02-create-hierarchy');
// 台灣 → 北部 → 台北
const clickText = (t) => page.evaluate((t) => {
  [...document.querySelectorAll('.pick-big,.crumb-btn,.chip-sm')].find(b => b.textContent.trim().includes(t))?.click();
}, t);
await clickText('日本'); await sleep(150);
await clickText('關西'); await sleep(150);
await clickText('京都'); await sleep(700);
// 點幾個景點
await page.evaluate(() => {
  [...document.querySelectorAll('.place-card')].slice(0, 3).forEach(c => c.click());
});
await page.evaluate(() => document.querySelector('.place-card')?.scrollIntoView({ block: 'start' }));
await sleep(300);
await shot('03-create-places');

// ---------- 27. 日期選擇（月曆連點起訖） ----------
await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.date-range-btn')?.click(); });
await page.waitForSelector('.cal-grid');
await sleep(200);
await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cal-cell:not(.cal-blank)')];
  cells[9]?.click();
  cells[11]?.click();
});
await sleep(250);
await shot('27-date-picker');
await page.evaluate(() => [...document.querySelectorAll('.modal-card .btn')].find(b => b.textContent.includes('完成'))?.click());
await sleep(150);

// ---------- 4. 行程總覽（含底部分頁列）----------
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.qbig');
await shot('04-trip-overview');

// ---------- 28. 底部分頁列 —— 旅程層 ----------
await shotEl('#tabbar', '28-tabbar-trip');

// ---------- 29. 「回顧」分頁 ----------
await go(`/#/trip/${tripId}/memories`);
await page.waitForSelector('.mem-card');
await sleep(200);
await shot('29-memories');

// ---------- 5. 任務大圖卡（展開一天 + 一個景點）----------
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.daycollapse');
await page.evaluate(() => {
  const d1 = document.querySelector('.daycollapse[data-day="1"]');
  if (d1 && !d1.classList.contains('open')) d1.querySelector('.dc-head').click();
});
await sleep(400);
await page.evaluate(() => {
  const sc = document.querySelector('.daycollapse.open .qcollapse');
  if (sc && !sc.classList.contains('open')) sc.querySelector('.qc-toggle').click();
});
await sleep(400);
await page.evaluate(() => document.querySelector('.daycollapse.open .qcollapse.open')?.scrollIntoView({ block: 'start' }));
await sleep(300);
await shot('05-task-cards');

// ---------- 26. 任務清單：天 + 景點 兩層折疊 ----------
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.daycollapse');
await page.evaluate(() => {
  const d1 = document.querySelector('.daycollapse[data-day="1"]');
  if (d1 && !d1.classList.contains('open')) d1.querySelector('.dc-head').click();
});
await sleep(400);
await page.evaluate(() => document.querySelector('.day-tools')?.scrollIntoView({ block: 'start' }));
await sleep(300);
await shot('26-tasks-collapsed');

// ---------- 25. 總行程編輯（拖拉 + 大按鈕）----------
await go(`/#/trip/${tripId}/plan`);
await page.waitForSelector('.plan-row');
await page.evaluate(() => window.scrollTo(0, 120));
await sleep(300);
await shot('25-plan-editor');

// ---------- 6. 任務詳情 ----------
const questId = await page.evaluate(async (tid) => {
  const s = await import('./js/store.js');
  const spot = s.spotsOf(tid)[0];
  return s.questsOf(spot.id).find(q => !s.isQuestDone(q.id))?.id || s.questsOf(spot.id)[0].id;
}, tripId);
await go(`/#/quest/${questId}`);
await page.waitForSelector('.quest-focus');
await sleep(400);
await page.evaluate(() => document.querySelector('.big-shot-btn')?.scrollIntoView({ block: 'center' }));
await sleep(200);
await shot('06-quest-detail');

// ---------- 7. 完成任務的慶祝 ----------
await page.evaluate(async () => {
  const { celebrate } = await import('./js/ui.js');
  celebrate({
    title: '完成一個任務！',
    lines: ['「清水舞台」搞定', '進度 12 / 20'],
    actions: [{ label: '繼續下一個', value: 'stay', primary: true }, { label: '看看大家', value: 'people' }],
  });
});
await sleep(700);
await shot('07-celebrate');
await page.evaluate(() => { document.querySelector('.celebrate')?.remove(); document.querySelector('.confetti')?.remove(); });

// ---------- 8-9. 照片牆 ----------
await go(`/#/trip/${tripId}/people`);
await page.waitForSelector('.people-row');
await sleep(400);
await shot('08-people-progress');
// 捲到「有留言 + 有讚」的那則動態
await page.evaluate(() => {
  const c = document.querySelector('.fi-comment');
  const item = c ? c.closest('.feed-item') : document.querySelector('.feed-item');
  if (item) { item.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }
});
await sleep(400);
await shot('09-people-feed');

// ---------- 10. 全部解鎖 ----------
await fillPhotos(tripId, 1);
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.qbig.done');
await shot('10-trip-all-done');

// ---------- 11. 回憶影片：製作介面 ----------
await go(`/#/trip/${tripId}/album`);
await page.waitForSelector('.album-canvas');
await sleep(1400);
await page.evaluate(() => { const l = [...document.querySelectorAll('.section-label')].find(e => e.textContent.includes('配樂')); l?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -120); });
await sleep(300);
await shot('11-album-controls');

// ---------- 12-16. 回憶影片代表幀 ----------
const times = await page.evaluate(async (tid) => {
  const m = await import('./js/memory.js');
  const tl = await m.buildTimeline(tid);
  const pick = {};
  for (const kind of ['intro', 'day', 'photo', 'map', 'outro']) {
    const seg = tl.segs.find(s => s.kind === kind);
    if (seg) pick[kind] = seg.start + seg.dur * 0.5;
  }
  const c = document.querySelector('.album-canvas');
  window.__player = await m.createPlayer(c, tid);
  return pick;
}, tripId);
const frameNames = { intro: '12-video-intro', day: '13-video-dayCard', photo: '14-video-photo', map: '15-video-routeMap', outro: '16-video-outro' };
for (const [kind, t] of Object.entries(times)) {
  await page.evaluate((t) => window.__player.seek(t), t);
  await sleep(200);
  await shotEl('.album-canvas', frameNames[kind]);
}

// ---------- 17. 設定 ----------
await go('/#/settings');
await page.waitForSelector('.seg');
await shot('17-settings');

// ---------- 18. 多人同步設定 ----------
await page.evaluate(() => { document.querySelector('.section-label:nth-of-type(3)') || 0; window.scrollTo(0, 0); });
await page.evaluate(() => {
  const lbl = [...document.querySelectorAll('.section-label')].find(e => e.textContent.includes('多人同步'));
  lbl?.scrollIntoView();
});
await sleep(300);
await shot('18-settings-sync');

// ---------- 19. 特大字 ----------
await page.evaluate(async () => { (await import('./js/prefs.js')).setPref('fs', 'xl'); });
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.qbig');
await shot('19-font-xl');

// ---------- 20. 高對比（維持特大字關掉、開高對比）----------
await page.evaluate(async () => { const p = await import('./js/prefs.js'); p.setPref('fs', 'm'); p.setPref('contrast', 'high'); });
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.qbig');
await shot('20-high-contrast');
await page.evaluate(async () => { (await import('./js/prefs.js')).setPref('contrast', 'normal'); });

// ---------- 21. 分享代碼 ----------
await go(`/#/trip/${tripId}`);
await page.waitForSelector('.qbig');
await page.evaluate(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch {} });
await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('分享給旅伴'))?.click(); });
await page.waitForSelector('.modal-card textarea', { timeout: 8000 });
await sleep(500);
await shot('21-share-code');

// ---------- 22. 加入群組 ----------
const shareUrl = await page.evaluate(async (tid) => (await import('./js/share.js')).shareURL(tid), tripId);
const code = shareUrl.split('d=')[1];
await go(`/#/join?d=${code}`);
await page.waitForSelector('.hero');
await sleep(300);
await shot('22-join');

// ---------- 23. 行程海報 ----------
// 給景點填時間，海報才有時間軸
await page.evaluate(async (tid) => {
  const s = await import('./js/store.js');
  const sp = s.spotsOf(tid);
  const tt = [['09:00', '11:30'], ['12:30', '14:00'], ['15:00', ''], ['09:30', '12:00'], ['13:30', ''], ['16:00', ''], ['10:00', '']];
  for (let i = 0; i < sp.length; i++) if (tt[i]) await s.patch(sp[i].id, { startTime: tt[i][0], endTime: tt[i][1] });
}, tripId);
await go(`/#/trip/${tripId}/poster`);
await page.waitForSelector('.poster-canvas');
await sleep(3000); // 等字型 + 首次繪製
await shot('23-poster-page');
// 直接輸出成品大圖
const posterOut = await page.evaluate(async (tid) => {
  const P = await import('./js/poster/index.js');
  const res = await P.renderPoster(tid, { presetId: 'watercolor' });
  return { count: res.length, dataUrl: await blobToDataUrl(res[0].blob), w: 1240 };
  async function blobToDataUrl(b) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
}, tripId);
if (posterOut.dataUrl) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(OUT, '24-poster-output.jpg'), Buffer.from(posterOut.dataUrl.split(',')[1], 'base64'));
  console.log('  ✓ 24-poster-output.jpg（' + posterOut.count + ' 張其一）');
}

await browser.close();
server.kill();
console.log('\n完成，輸出於 screenshots/');
