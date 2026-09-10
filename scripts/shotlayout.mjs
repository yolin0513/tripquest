// 版面掃描找到的問題，逐一拍照存證（npm run shotlayout）。
//
// 為什麼要有這一支：最近好幾次「斷言全綠但畫面壞掉」。掃描器給的是數字，
// 數字說 343 > 320，但要確認那是不是真的難看、修完是不是真的好看，得看圖。
// TQ_SHOT_TAG=before / after 決定檔名，同一組場景拍兩次好對照。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5711;
const TAG = process.env.TQ_SHOT_TAG || 'after';
const OUT = path.join(ROOT, 'screenshots', '_layout', TAG);
fs.mkdirSync(OUT, { recursive: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(700);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const db = await import('./js/db.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族小旅行（三天兩夜）', region: '宜蘭',
      country: 'TW', startDate: '2026-10-01', endDate: '2026-10-03', aiEnabled: false,
      createdByDevice: myDeviceId(), baseCurrency: 'TWD' });
    await s.put({ id: me, type: 'member', tripId: tid, groupId: gid, displayName: '阿嬤' });
    const names = [['國立傳統藝術中心宜蘭園區', 1], ['蘭陽博物館', 1], ['礁溪溫泉公園森林風呂', 2]];
    for (let i = 0; i < names.length; i++) {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name: names[i][0], emoji: '📍',
        day: names[i][1], order: i, lat: 24.67 + i * 0.01, lng: 121.76,
        startMin: i === 0 ? 9 * 60 : undefined, stayMin: 60 });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: id, order: 0, source: 'template',
        title: `拍下 ${names[i][0]} 最有代表性的一幕`, hint: '站遠一點，把整體帶進畫面。' });
    }
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    await db.putBlob({ hash: 'h1', blob: new Blob([png], { type: 'image/png' }), w: 1, h: 1, bytes: png.length, kind: 'photo' });
    await s.put({ id: uuid(), type: 'expense', tripId: tid, groupId: gid, title: '晚餐（羅東夜市三攤）',
      amount: 1250, currency: 'TWD', payerId: me, at: Date.now(), category: 'food', shareIds: [me] });
    return { tid };
  });

  // 掃描器點名的六個場景，用它報問題的那個寬度與字級
  const SCENES = [
    ['海報-下一張溢出', `/trip/${ids.tid}/poster`, 320, 'xl', null],
    ['分帳-溢出', `/trip/${ids.tid}/expenses`, 320, 'xl', null],
    ['緊急求助-按鈕折行', `/trip/${ids.tid}/sos`, 320, 'm', null],
    ['調整行程-觸控區', `/trip/${ids.tid}/plan`, 320, 'm', null],
    ['建立行程-刪除鈕', '/new', 320, 'm', null],
    ['日期選擇對話框', `/trip/${ids.tid}/settings`, 320, 'xl',
      () => [...document.querySelectorAll('.setting-row')].find((r) => r.textContent.includes('旅程日期'))?.querySelector('button')?.click()],
  ];

  for (const [name, route, w, fs2, open] of SCENES) {
    await page.setViewport({ width: w, height: 844, deviceScaleFactor: 2 });
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#${route}`, { waitUntil: 'networkidle0' }).catch(() => {});
    await page.evaluate((v) => { document.documentElement.dataset.fs = v; }, fs2);
    await page.waitForSelector('.page, .hero', { timeout: 12000 }).catch(() => {});
    await sleep(900);
    if (open) { await page.evaluate(open).catch(() => {}); await sleep(600); }
    const over = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth > de.clientWidth + 1 ? `${de.scrollWidth}>${de.clientWidth}` : '';
    });
    await page.screenshot({ path: path.join(OUT, `${name}-${w}-${fs2}.png`) });
    console.log(`  ${name}（${w}px/${fs2}）${over ? '橫向溢出 ' + over : 'ok'}`);
  }
  console.log(`\n截圖在 screenshots/_layout/${TAG}/`);
} finally {
  await browser.close();
  web.kill();
}
