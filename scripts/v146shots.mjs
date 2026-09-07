// v1.46 截圖：重整後的「回憶」頁（影片／相片分區、進階收納）、精簡後的最終回顧底部
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_v146/', import.meta.url);
await mkdir(OUT, { recursive: true });
const WEB = 5493;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const shot = async (name) => { await page.screenshot({ path: fileURLToPath(new URL(name + '.png', OUT)) }); console.log('📸', name); };

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), m1 = uuid(), m2 = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: m1, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: m2, type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭三日遊', region: '宜蘭',
      startDate: '2026-08-01', endDate: '2026-08-03', allowWiki: false });
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
      const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 47 % 360},60%,50%)`; x.fillRect(0, 0, 900, 1200);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    const names = ['羅東觀光夜市', '幾米公園'];
    let n = 0;
    for (let k = 0; k < 2; k++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: names[k], emoji: '📍', day: k + 1, order: 0,
        lat: 24.6 + k * 0.08, lng: 121.7 + k * 0.05 });
      for (let j = 0; j < 3; j++) {
        const qid = uuid();
        await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `任務 ${n + 1}`,
          kind: j === 1 ? 'food' : 'thing', order: j, source: j === 1 ? 'must' : 'auto' });
        await importPhoto(new File([await mk(n)], 'p.jpg', { type: 'image/jpeg' }),
          { tripId: tid, questId: qid, memberId: n % 2 ? m2 : m1, allowGeo: false });
        n++;
      }
    }
    return tid;
  });

  // 回憶頁（上：影片區）
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/album`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.len-pick');
  await sleep(1200);
  await shot('01-回憶頁-影片區');
  // 下：相片區 + 進階收納（先收合）
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  await shot('02-回憶頁-相片區-進階收合');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('更多儲存方式'))?.click());
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  await shot('03-回憶頁-相片區-進階展開');

  // 最終回顧底部：只剩「存成圖片 / 分享」
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/recap`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.recap');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(400);
  await shot('04-最終回顧-底部只剩存成圖片');

  // 回顧分頁入口卡
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}/memories`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.mem-card');
  await sleep(300);
  await shot('05-回顧分頁-入口卡改名');

  console.log('\n截圖完成');
} catch (e) {
  console.error('例外：', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
