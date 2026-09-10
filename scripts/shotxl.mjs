// 特大字級下的實機跑版對照（npm run shotxl）。
// TQ_SHOT_TAG=before / after 決定檔名，同一組場景拍兩次好對照。
//
// 為什麼要有這一支：使用者用特大字級實測回報的三個跑版，我的 204 組合掃描
// 一個都沒報（重疊檢查沒實作、測試資料太小、任務列只掃到收合狀態）。
// 數字修好了還要看圖 —— 這一輪就是這樣才確定「❤️ 2」真的不再被按鈕蓋住。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAG = process.env.TQ_SHOT_TAG || 'after';
const OUT = path.join(ROOT, 'screenshots', '_layout', TAG);
fs.mkdirSync(OUT, { recursive: true });
const WEB = 5761;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 使用者的真實規模：51 個任務、每張照片有讚、四個人。小資料量驗不到擠壓。
  const tid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const db = await import('./js/db.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族小旅行', region: '宜蘭',
      startDate: '2026-09-05', endDate: '2026-09-07' });
    for (const n of ['阿嬤', '爸爸', '媽媽', '小明']) {
      await s.put({ id: n === '阿嬤' ? me : uuid(), type: 'member', tripId: tid, groupId: gid, displayName: n });
    }
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    await db.putBlob({ hash: 'h1', blob: new Blob([png], { type: 'image/png' }), w: 1, h: 1, bytes: png.length, kind: 'photo' });
    const names = ['國立傳統藝術中心宜蘭園區', '蘭陽博物館', '頭城老街', '礁溪溫泉公園', '甕窯雞', '羅東夜市', '幾米公園', '金車水產'];
    let q = 0;
    for (let i = 0; i < names.length; i++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: names[i], emoji: '📍',
        day: (i % 3) + 1, order: i, lat: 24.6 + i * 0.12, lng: 121.7 + i * 0.05 });
      for (let k = 0; k < (i < 3 ? 7 : 6); k++) {
        const qid = uuid();
        await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, order: k, title: `拍下 ${names[i]} 最有代表性的一幕` });
        const subid = uuid();
        await s.put({ id: subid, type: 'submission', tripId: tid, questId: qid, memberId: me,
          photoHash: 'h1', thumbHash: 'h1', createdAt: Date.now() - q * 60000 });
        for (let r = 0; r <= q % 3; r++) {
          await s.put({ id: uuid(), type: 'reaction', tripId: tid, submissionId: subid, actorId: uuid(), emoji: '❤️', createdAt: Date.now() });
        }
        q++;
      }
    }
    return tid;
  });

  const shot = async (name, hash, sel, expand) => {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#${hash}`, { waitUntil: 'networkidle0' }).catch(() => {});
    await page.evaluate(() => { document.documentElement.dataset.fs = 'xl'; });
    await page.waitForSelector('.page', { timeout: 12000 }).catch(() => {});
    await sleep(1600);
    if (expand) {
      for (let k = 0; k < 2; k++) {
        await page.evaluate(() => {
          document.querySelectorAll('.daycollapse:not(.open) .dc-head, .qcollapse:not(.open) .qc-toggle').forEach((b) => b.click());
        }).catch(() => {});
        await sleep(500);
      }
    }
    const el = sel ? await page.$(sel) : null;
    if (el) await el.scrollIntoView().catch(() => {});
    await sleep(400);
    const f = path.join(OUT, `${name}.png`);
    if (el) await el.screenshot({ path: f }); else await page.screenshot({ path: f });
    console.log('  ' + f);
  };

  await shot('回顧-日期與統計格-390-xl', `/trip/${tid}/recap`, '.recap-head', false);
  await shot('回顧-統計格-390-xl', `/trip/${tid}/recap`, '.recap-nums', false);
  await shot('任務列-愛心數-390-xl', `/trip/${tid}`, '.qcollapse', true);
  console.log(`\n截圖在 screenshots/_layout/${TAG}/`);
} finally { await browser.close(); web.kill(); }
