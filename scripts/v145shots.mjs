// v1.45 截圖：回憶影片頁（長度／配樂／分享網址／匯出）、設定的「照片品質」、影片實際畫面
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_v145/', import.meta.url);
const WEB = 5481, API = 8801;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const shot = async (name) => { await page.screenshot({ path: fileURLToPath(new URL(name + '.png', OUT)) }); console.log('📸', name); };

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate((u) => { (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url: u }); })(); }, `http://localhost:${API}`);

  // 三天、六個景點、兩個人、22 張各種長寬比的照片（讓精華版真的有東西可挑）
  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭三日遊', region: '宜蘭',
      startDate: '2026-08-01', endDate: '2026-08-03', allowWiki: false, endedAt: Date.now() });
    const SHAPES = [[900, 1600], [1600, 1200], [1200, 1600], [1400, 1400]];
    const mk = (i) => {
      const [w, hh] = SHAPES[i % SHAPES.length];
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w, hh);
      g.addColorStop(0, `hsl(${(i * 53) % 360},62%,60%)`); g.addColorStop(1, `hsl(${(i * 53 + 70) % 360},55%,30%)`);
      x.fillStyle = g; x.fillRect(0, 0, w, hh);
      // 畫一張「臉」在上半部，看得出有沒有被裁掉
      x.fillStyle = '#ffe0c2'; x.beginPath(); x.arc(w * 0.5, hh * 0.32, Math.min(w, hh) * 0.14, 0, 7); x.fill();
      x.fillStyle = '#333'; x.beginPath(); x.arc(w * 0.46, hh * 0.30, 8, 0, 7); x.arc(w * 0.54, hh * 0.30, 8, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.font = `${Math.round(w / 9)}px sans-serif`; x.textAlign = 'center';
      x.fillText(`${w}×${hh}`, w / 2, hh * 0.85);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    };
    const names = ['羅東觀光夜市', '幾米公園', '太平山國家森林遊樂區', '見晴懷古步道', '礁溪溫泉公園', '火山爆發雞礁溪總店'];
    let n = 0;
    for (let d = 1; d <= 3; d++) for (let k = 0; k < 2; k++) {
      const sid = uuid(), idx = (d - 1) * 2 + k;
      await s.put({ id: sid, type: 'spot', tripId: tid, name: names[idx], emoji: '📍', day: d, order: k,
        lat: 24.55 + d * 0.09 + k * 0.03, lng: 121.68 + k * 0.08 + d * 0.02 });
      for (let j = 0; j < (idx === 2 ? 5 : 3) && n < 22; j++) {
        const qid = uuid();
        await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid,
          title: j === 0 ? `${names[idx]}的招牌畫面，跟大家一起入鏡` : `任務 ${n + 1}`, kind: j === 1 ? 'food' : 'thing', order: j });
        await importPhoto(new File([await mk(n)], 'p.jpg', { type: 'image/jpeg' }),
          { tripId: tid, questId: qid, memberId: n % 2 ? mB : mA, allowGeo: false });
        n++;
      }
    }
    return tid;
  });

  // ---------- 回憶影片頁 ----------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/album`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.len-pick');
  await sleep(1500);
  await shot('01-回憶影片頁-預設精華版');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
  await sleep(300);
  await shot('02-長度與配樂選項');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  await shot('03-傳給家人看與存到手機');

  // 產生分享網址（走本機測試伺服器）
  await page.evaluate(async (tid) => (await import('./js/albumshare.js')).publishAlbum(tid), tid);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/album`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.share-url');
  await page.evaluate(() => document.querySelector('.share-box').scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot('04-已有分享網址');

  // 公開相簿頁本身（家人看到的樣子）
  const url = await page.evaluate(async (tid) => (await import('./js/albumshare.js')).albumInfo(tid).url, tid);
  const pub = await browser.newPage();
  await pub.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await pub.goto(url, { waitUntil: 'networkidle0' });
  await pub.screenshot({ path: fileURLToPath(new URL('05-家人打開的相簿網址-封面.png', OUT)) });
  await pub.evaluate(() => window.scrollTo(0, 900));
  await sleep(600);
  await pub.screenshot({ path: fileURLToPath(new URL('06-家人打開的相簿網址-照片.png', OUT)) });
  console.log('📸 05/06 公開相簿');
  await pub.close();

  // ---------- 設定：照片品質 ----------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/settings`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.switch-row');
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.section-label')].find((x) => x.textContent === '照片品質');
    el?.scrollIntoView({ block: 'start' });
  });
  await sleep(400);
  await shot('07-設定-照片品質-保留原檔');

  // ---------- 影片實際畫面 ----------
  const frames = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const c = document.createElement('canvas');
    const p = await mem.createPlayer(c, tid, { length: 'short' });
    const t = await mem.buildTimeline(tid, { length: 'short' });
    const photos = t.segs.filter((s) => s.kind === 'photo');
    // 先把要拍的那幾張都抓進來
    for (const i of [0, 1, 2, 3, 4, 5]) await t.frames.ensure(i);
    // 用 timeline 的 frames 直接畫（player 有自己的 timeline，這裡自己再建一個一致的）
    const draw = async (gt) => { p.seek(gt); await new Promise((r) => setTimeout(r, 700)); p.seek(gt); return c.toDataURL('image/png'); };
    // photos[1] 是 1600×1200 的橫式（SHAPES[1]）
    const accent = photos.find((s) => s.trans && s.trans !== 'dissolve') || photos[3];
    const map = t.segs.find((s) => s.kind === 'map');
    const out = {};
    out.intro = await draw(1.6);
    out.day = await draw(t.segs[1].start + 1.0);
    out.portrait = await draw(photos[0].start + 1.4);
    out.landscape = await draw(photos[1].start + 1.4);
    out.transition = await draw(accent.start + accent.dur - 0.42);
    out.transName = accent.trans;
    out.map = map ? await draw(map.start + map.dur * 0.7) : null;
    out.outro = await draw(t.total - 2.2);
    out.mapDur = map?.dur; out.total = t.total; out.photos = t.photoCount; out.all = t.totalPhotos;
    p.destroy();
    return out;
  }, tid);
  for (const [k, v] of Object.entries(frames)) {
    if (typeof v !== 'string' || !v.startsWith('data:')) continue;
    const label = { intro: '08-影片-片頭', day: '09-影片-日期字卡', portrait: '10-影片-直式照片滿版',
      landscape: '11-影片-橫式照片不裁人-糊化背景', transition: `12-影片-轉場-${frames.transName}`,
      map: '13-影片-路線地圖', outro: '14-影片-片尾' }[k];
    await writeFile(fileURLToPath(new URL(label + '.png', OUT)), Buffer.from(v.split(',')[1], 'base64'));
    console.log('📸', label);
  }
  console.log(`  精華版 ${frames.photos}/${frames.all} 張 · 全長 ${Math.round(frames.total)}s · 地圖 ${frames.mapDur}s`);

  console.log('\n截圖完成');
} catch (e) {
  console.error('例外：', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill(); api.kill();
}
