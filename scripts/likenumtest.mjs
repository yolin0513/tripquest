// 讚只顯示「我按了沒」、不顯示數字（npm run likenumtest；在 test:chain 裡）。資料全是合成的。
// 涵蓋的程式：js/views/people.js js/viewer.js js/views/quest.js js/views/trip.js js/memory.js
// 為什麼（2026-11-09 Yolin 授權止血）：取消讚不會同步，同一人在別人手機上可能變成好幾筆，畫面上的數字會越算越多。
// 徹底修（同步規則）要投票，排後面；這一步只是不再把不可信的數字給人看。
// 情境：照片 A 只有別人按（同一人 2 筆，就是偏多的那個形狀），照片 B 我按過＋別人也按。
// 判準：看得到「我按過」的標記、看不到任何讚數；只有別人按的那張不標。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5795;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const yes = (c, m) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m); } };
const page = await browser.newPage();
const hasDigit = (t) => /\d/.test(t);
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  await page.setRequestInterception(true);
  page.on('request', (rq) => { const u = new URL(rq.url()); if (u.hostname !== 'localhost') return rq.abort(); rq.continue(); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { claim } = await import('./js/claim.js');
    const gid = uuid(), tid = uuid(), me = uuid(), other = uuid();
    await s.put({ id: gid, type: 'group', name: '範例家族' });
    await s.put({ id: me, type: 'member', groupId: gid, displayName: '甲' });
    await s.put({ id: other, type: 'member', groupId: gid, displayName: '乙' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例小旅行', region: '宜蘭', startDate: '2024-03-10', endDate: '2024-03-11', allowWiki: false });
    await claim(tid, me);
    const quests = [];
    for (const [i, name] of ['只有別人按', '我也按了'].entries()) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day: 1, order: i });
      const qid = uuid();
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `拍下 ${name}`, kind: 'thing', order: 0 });
      quests.push(qid);
    }
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 120},60%,50%)`; x.fillRect(0, 0, 640, 480); return new Promise((r) => c.toBlob(r, 'image/jpeg')); };
    for (const [i, q] of quests.entries()) await importPhoto(new File([await mk(i)], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: q, memberId: other, allowGeo: false });
    const subOf = (q) => s.submissionsOf(q)[0];
    const react = (sub, actor) => s.put({ id: uuid(), type: 'reaction', tripId: tid, submissionId: sub.id, actorId: actor, emoji: '❤️', createdAt: Date.now() });
    // 同一人 2 筆：取消讚沒同步時別人手機上就是這個樣子
    await react(subOf(quests[0]), other); await react(subOf(quests[0]), other);
    await react(subOf(quests[1]), other); await react(subOf(quests[1]), me);
    return { tid, quests, n: [s.reactionsOf(subOf(quests[0]).id).length, s.reactionsOf(subOf(quests[1]).id).length] };
  });
  yes(ids.n[0] === 2 && ids.n[1] === 2, `前置：兩張照片的紀錄各有 2 筆（${ids.n}）——數字如果還在，畫面會寫 2`);

  // ---------- 相簿格狀 ----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pg-grid .pg-cell', { timeout: 10000 });
  await sleep(500);
  const g = await page.evaluate(() => ({ cells: document.querySelectorAll('.pg-cell').length, marks: [...document.querySelectorAll('.pg-likes')].map((x) => x.textContent) }));
  yes(g.cells === 2 && g.marks.length === 1 && g.marks[0].includes('❤️'), `相簿：2 張裡只有我按過的那張有標記（${g.cells} 張、標記 ${JSON.stringify(g.marks)}）`);
  yes(g.marks.length === 1 && !hasDigit(g.marks[0]), `相簿：標記不寫數字（${JSON.stringify(g.marks)}）`);

  // ---------- 動態 ----------
  for (const b of await page.$$('.wall-mode')) if ((await b.evaluate((e) => e.textContent)).includes('動態')) { await b.click(); break; }
  await page.waitForSelector('.feed-item .react-btn', { timeout: 8000 });
  await sleep(400);
  const f = await page.evaluate(() => ({ btns: [...document.querySelectorAll('.feed-item .react-btn')].map((x) => x.textContent.trim()), on: document.querySelectorAll('.feed-item .react-btn.on').length }));
  yes(f.btns.length === 8 && f.on === 1, `動態：2 則 × 4 顆鈕，我按過的亮 1 顆（${f.btns.length} 顆、亮 ${f.on}）`);
  yes(f.btns.length === 8 && f.btns.every((t) => !hasDigit(t)), `動態：每顆鈕都不寫數字（${JSON.stringify(f.btns)}）`);

  // ---------- 任務頁 ----------
  const questMarks = async (q) => {
    await page.goto(`http://localhost:${WEB}/#/quest/${q}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.photo-cell', { timeout: 8000 });
    return page.evaluate(() => [...document.querySelectorAll('.photo-cell .mini-likes')].map((x) => x.textContent));
  };
  const q0 = await questMarks(ids.quests[0]), q1 = await questMarks(ids.quests[1]);
  yes(q0.length === 0, `任務頁：只有別人按的照片沒有標記（${JSON.stringify(q0)}）`);
  yes(q1.length === 1 && q1[0].includes('❤️') && !hasDigit(q1[0]), `任務頁：我按過的照片有標記、不寫數字（${JSON.stringify(q1)}）`);

  // ---------- 行程頁任務列 ----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse.open .qcollapse .qline-sub', { timeout: 10000 });
  await sleep(1500);
  const lines = await page.evaluate(() => [...document.querySelectorAll('.qline-sub')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  yes(lines.length === 2 && lines.filter((t) => t.includes('❤️')).length === 1, `行程頁：2 個任務裡只有我按過的那個有 ❤️（${JSON.stringify(lines)}）`);
  const heart = lines.find((t) => t.includes('❤️')) || '';
  yes(heart !== '' && !/❤️\s*\d/.test(heart), `行程頁：❤️ 後面沒有數字（${heart}）`);

  // ---------- 影片片尾（畫在 canvas 上，這裡只能查原始碼）----------
  const mem = fs.readFileSync(path.join(ROOT, 'js/memory.js'), 'utf8');
  yes(mem.includes('個回憶') && !mem.includes('個讚'), '影片片尾的文字（前置：同一段的「個回憶」在）沒有「N 個讚」');
} catch (e) { fail++; console.log('✗ 例外 ' + (e && e.stack || e)); }
finally { await browser.close(); web.kill(); }
console.log(`\n讚不顯示數字：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
