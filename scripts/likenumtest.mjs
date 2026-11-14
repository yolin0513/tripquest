// 讚數＝按著讚的不同的人數（npm run likenumtest；在 test:chain 裡）。資料全是合成的。
// 涵蓋的程式：js/likes.js js/store.js js/views/people.js js/viewer.js js/views/quest.js js/views/trip.js js/memory.js js/recap.js js/views/recap.js
//
// ⚠ 這支是**刻意反轉**的（v1.76.0，2026-11-10）：v1.75.0 的版本斷言「畫面上不准有讚數」（當時取消讚不會同步，數字不可信，
//   2026-11-09 止血）。同步修好之後（投票 (c)、Yolin 2026-11-10 選 C：「讚數是很重要的指標」），改成斷言「數字等於不同的按讚人數」。
//   這不是退步——但反轉時守備範圍不能變小，所以下面這些「不該有數字」的地方照樣守著：
//   · 行程頁任務列只標「我按過」、不放數字（Yolin 2026-11-10 第 4 題）
//   · 0 個讚不寫「0」（同上）
//   · 影片片尾不印「N 個讚」
//   · 照片上有舊式 reaction 時不顯示數字（Dispatch 2026-11-10 的過渡規則，拿掉條件見 js/likes.js）
// 期望值全部寫死（不呼叫 likeSummary 算——那會變成拿實作跟自己比）。
//
// 情境（甲是「我」）：
//   A 三人按：甲❤️ 乙👍 丙❤️，丁按過又收回（紀錄 4 筆、人數 3）→ 寫 3、我按 ❤️
//   B 沒人按：乙按過又收回（紀錄 1 筆、人數 0）→ 不寫數字、不標
//   C 只有舊讚：乙兩筆舊式 reaction → 不寫數字、不標（「我按過」只看新的 like）
//   D 舊讚＋新讚：乙一筆舊式＋丙❤️、甲👍 → 不寫數字；標我按的 👍
//   E 只有新讚、別人按：乙❤️ → 寫 1、不亮我的鈕
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { blankTextScan } from './blanktext.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5795;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const yes = (c, m) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m); } };
const page = await browser.newPage();
const J = (x) => JSON.stringify(x);
const same = (a, b) => J([...a].sort()) === J([...b].sort());
const NAMES = ['A三人按', 'B沒人按', 'C只有舊讚', 'D舊讚加新讚', 'E只有新讚'];
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => { fail++; console.log('✗ pageerror ' + e.message); });
  await page.setRequestInterception(true);
  page.on('request', (rq) => { const u = new URL(rq.url()); if (u.hostname !== 'localhost') return rq.abort(); rq.continue(); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const ids = await page.evaluate(async (NAMES) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { claim } = await import('./js/claim.js');
    const gid = uuid(), tid = uuid();
    const [me, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
    await s.put({ id: gid, type: 'group', name: '範例家族' });
    for (const [id, n] of [[me, '甲'], [b, '乙'], [c, '丙'], [d, '丁']]) await s.put({ id, type: 'member', groupId: gid, displayName: n });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例小旅行', region: '宜蘭', startDate: '2024-03-10', endDate: '2024-03-11', allowWiki: false });
    await claim(tid, me);
    const quests = [];
    for (const [i, name] of NAMES.entries()) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day: 1, order: i });
      const qid = uuid();
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `拍下 ${name}`, kind: 'thing', order: 0 });
      quests.push(qid);
    }
    const mk = (i) => { const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const x = cv.getContext('2d'); x.fillStyle = `hsl(${i * 70},60%,50%)`; x.fillRect(0, 0, 640, 480); return new Promise((r) => cv.toBlob(r, 'image/jpeg')); };
    for (const [i, q] of quests.entries()) await importPhoto(new File([await mk(i)], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: q, memberId: b, allowGeo: false });
    const sub = quests.map((q) => s.submissionsOf(q)[0].id);
    // like 照真實的寫法造：toggleReaction（按同一個表情兩次＝收回）
    const press = (k, who, emo) => s.toggleReaction(sub[k], who, emo);
    await press(0, me, '❤️'); await press(0, b, '👍'); await press(0, c, '❤️'); await press(0, d, '❤️'); await press(0, d, '❤️');
    await press(1, b, '❤️'); await press(1, b, '❤️');
    // 舊式 reaction：v1.75.0 以前的手機寫的形狀（隨機 id、一人可能好幾筆）
    const legacy = (k, who) => s.put({ id: uuid(), type: 'reaction', tripId: tid, submissionId: sub[k], actorId: who, emoji: '❤️', createdAt: Date.now() });
    await legacy(2, b); await legacy(2, b);
    await legacy(3, b); await press(3, c, '❤️'); await press(3, me, '👍');
    await press(4, b, '❤️');
    const recs = s.exportRecords();
    const nrec = sub.map((id) => recs.filter((r) => r.submissionId === id && (r.type === 'like' || r.type === 'reaction')).length);
    return { tid, quests, sub, nrec };
  }, NAMES);
  // 前置：紀錄筆數 ≠ 人數（數字若是從筆數算的，畫面會跟期望不一樣）
  yes(J(ids.nrec) === J([4, 1, 2, 3, 1]), `前置：五張照片的紀錄筆數 ${J(ids.nrec)}＝[4,1,2,3,1]，期望人數 A3 B0 E1——A、B 的筆數≠人數`);

  // ---------- 相簿格狀 ----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pg-grid .pg-cell', { timeout: 10000 });
  await sleep(500);
  const g = await page.evaluate(() => ({ cells: document.querySelectorAll('.pg-cell').length, marks: [...document.querySelectorAll('.pg-likes')].map((x) => x.textContent.trim()) }));
  yes(g.cells === 5 && same(g.marks, ['❤️ 3', '👍', '❤️ 1']), `相簿：標記正好是 ❤️ 3（A）、👍（D 有舊讚只標我按的）、❤️ 1（E）（${g.cells} 張、${J(g.marks)}）`);

  // ---------- 動態 ----------
  for (const b of await page.$$('.wall-mode')) if ((await b.evaluate((e) => e.textContent)).includes('動態')) { await b.click(); break; }
  await page.waitForSelector('.feed-item .react-btn', { timeout: 8000 });
  await sleep(400);
  const feed = () => page.evaluate(() => [...document.querySelectorAll('.feed-item')].map((it) => ({
    spot: it.querySelector('.fi-what')?.textContent || '',
    btns: [...it.querySelectorAll('.react-btn')].map((x) => x.textContent.trim()),
    on: [...it.querySelectorAll('.react-btn.on')].map((x) => x.textContent.trim()),
    cnt: [...it.querySelectorAll('.react-count')].map((x) => x.textContent.trim()) })));
  const f = await feed();
  const fBy = (k) => f.find((x) => x.spot.includes(NAMES[k])) || {};
  yes(f.length === 5 && same(f.flatMap((x) => x.cnt), ['3 人按讚', '1 人按讚']) && J(fBy(0).cnt) === J(['3 人按讚']) && J(fBy(4).cnt) === J(['1 人按讚']),
    `動態：A 寫「3 人按讚」、E 寫「1 人按讚」，其他三則不寫（${J(f.map((x) => x.cnt))}）`);
  yes(f.length === 5 && f.every((x) => x.btns.length === 4 && x.btns.every((t) => !/\d/.test(t))), `動態：表情鈕本身不寫數字（${f.length} 則）`);
  yes(J(fBy(0).on) === J(['❤️']) && J(fBy(3).on) === J(['👍']) && fBy(2).on?.length === 0 && fBy(4).on?.length === 0,
    `動態：亮的鈕只看新的 like（A ❤️、D 👍；C 只有舊讚不亮、E 別人按不亮）（${J(f.map((x) => x.on))}）`);
  // v1.87.1（2026-11-14 Yolin 實機截圖）：沒有人數要寫的那幾則，表情列右邊多一個純文字「null」——原生 replaceChildren 收到 null。
  // 為什麼上面幾條沒抓到：它們只數 .react-btn／.react-count，那個 null 是兩者之外的文字節點。
  // 前置：「不寫人數」的那幾則要在（B、C、D 三則）——不然量不到會出事的情境。表情列的子節點要剛好是 4 顆鈕（＋有人數才有的那一個），
  // 再整個畫面掃一次空值印成字（scripts/blanktext.mjs，含對照樣本）。
  const rows = await page.evaluate(() => [...document.querySelectorAll('.feed-item .fi-actions')].map((r) => ({
    kids: r.childNodes.length, btns: r.querySelectorAll(':scope > .react-btn').length, cnt: r.querySelectorAll(':scope > .react-count').length,
    stray: [...r.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data) })));
  const noCnt = rows.filter((r) => r.cnt === 0).length;
  const blankF = await blankTextScan(page, '#view');
  yes(rows.length === 5 && noCnt === 3 && rows.every((r) => r.btns === 4 && r.kids === 4 + r.cnt && r.stray.length === 0)
    && blankF.ok && blankF.texts > 0 && blankF.hits.length === 0,
    `動態表情列沒有空值印成字：不寫人數的 ${noCnt} 則（應為 3）表情列只有 4 顆鈕、沒有多出來的字（${J(rows.map((r) => r.stray))}）；`
    + `整個畫面掃了 ${blankF.texts} 個文字節點、${blankF.attrs} 個屬性，空值 ${blankF.hits.length} 處（對照樣本${blankF.ok ? '全中' : '沒中：' + blankF.broken.join('、')}）`,
    blankF.hits.slice(0, 3).map((h) => `${h.where}［${h.kind}］${h.text}`).join('；'));

  // ---------- 動態：從畫面按——按讚、換表情、收回（Yolin 2026-11-10 第 3 題）----------
  const clickE = async (emo) => {
    for (const it of await page.$$('.feed-item')) {
      if (!(await it.evaluate((e, n) => (e.querySelector('.fi-what')?.textContent || '').includes(n), NAMES[4]))) continue;
      for (const btn of await it.$$('.react-btn')) if ((await btn.evaluate((e) => e.textContent.trim())) === emo) { await btn.click(); break; }
    }
    await sleep(400);
    const e = (await feed()).find((x) => x.spot.includes(NAMES[4])) || {};
    return { on: e.on, cnt: e.cnt };
  };
  const e1 = await clickE('❤️');
  yes(J(e1) === J({ on: ['❤️'], cnt: ['2 人按讚'] }), `動態按讚：E 按 ❤️ → 亮 ❤️、2 人（${J(e1)}）`);
  const e2 = await clickE('👍');
  yes(J(e2) === J({ on: ['👍'], cnt: ['2 人按讚'] }), `動態換表情：按著 ❤️ 按 👍 → 換成 👍、人數不變 2 人（${J(e2)}）`);
  const e3 = await clickE('👍');
  yes(J(e3) === J({ on: [], cnt: ['1 人按讚'] }), `動態收回：再按 👍 → 不亮、剩 1 人（${J(e3)}）`);

  // ---------- 檢視器 ----------
  const viewerCount = async (k) => {
    for (const it of await page.$$('.feed-item')) {
      if (!(await it.evaluate((e, n) => (e.querySelector('.fi-what')?.textContent || '').includes(n), NAMES[k]))) continue;
      await (await it.$('.fi-photo-btn')).click(); break;
    }
    await page.waitForSelector('.pv .pv-react', { timeout: 8000 });
    await sleep(300);
    const r = await page.evaluate(() => ({ cnt: [...document.querySelectorAll('.pv-react-count')].map((x) => x.textContent.trim()),
      btn: [...document.querySelectorAll('.pv-react')].map((x) => x.textContent.trim()) }));
    await page.evaluate(() => document.querySelector('.pv-close').click());
    await sleep(300);
    return r;
  };
  const vA = await viewerCount(0), vB = await viewerCount(1), vD = await viewerCount(3);
  yes(J(vA.cnt) === J(['3 人按讚']) && vA.btn.every((t) => !/\d/.test(t)), `檢視器：A 寫「3 人按讚」、鈕不寫數字（${J(vA)}）`);
  yes(vB.cnt.length === 0 && vD.cnt.length === 0, `檢視器：B（0 人）與 D（有舊讚）不寫人數（B ${J(vB.cnt)}、D ${J(vD.cnt)}）`);

  // ---------- 任務頁（一頁一張照片，對得到是哪一張）----------
  const questMarks = async (q) => {
    await page.goto(`http://localhost:${WEB}/#/quest/${q}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.photo-cell', { timeout: 8000 });
    return page.evaluate(() => [...document.querySelectorAll('.photo-cell .mini-likes')].map((x) => x.textContent.trim()));
  };
  const qm = [];
  for (const q of ids.quests) qm.push(await questMarks(q));
  yes(J(qm[0]) === J(['❤️ 3']) && J(qm[4]) === J(['❤️ 1']), `任務頁·只有新讚：A 寫 ❤️ 3、E 寫 ❤️ 1（${J([qm[0], qm[4]])}）`);
  yes(J(qm[2]) === J([]), `任務頁·只有舊讚：C 不寫數字、不標（${J(qm[2])}）`);
  yes(J(qm[3]) === J(['👍']), `任務頁·舊讚加新讚：D 不寫數字，只標我按的 👍（${J(qm[3])}）`);
  yes(J(qm[1]) === J([]), `任務頁·0 個讚：B 不寫「0」、不標（${J(qm[1])}）`);

  // ---------- 0 個讚不寫「0」（三個畫面合起來；前置：上面各畫面確實有讀到讚的元素）----------
  const allMarks = [...g.marks, ...f.flatMap((x) => x.cnt), ...vA.cnt, ...qm.flat()];
  yes(allMarks.length >= 8 && allMarks.every((t) => !/(^|\D)0(\D|$)/.test(t)), `0 個讚不寫「0」：讀到 ${allMarks.length} 個讚的字，沒有一個寫 0（${J(allMarks)}）`);

  // ---------- 行程頁任務列：只標我按過、不放數字 ----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.daycollapse.open .qcollapse .qline-sub', { timeout: 10000 });
  await sleep(1500);
  const lines = await page.evaluate(() => [...document.querySelectorAll('.qline-sub')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const hearts = lines.filter((t) => t.includes('❤️'));
  yes(lines.length === 5 && hearts.length === 2, `行程頁：5 個任務裡只有我按著讚的 A、D 有 ❤️（${J(lines)}）`);
  yes(hearts.length === 2 && hearts.every((t) => !/❤️\s*\d/.test(t) && !t.includes('人按讚')), `行程頁：❤️ 後面沒有數字（${J(hearts)}）`);

  // ---------- 回顧：行程裡有舊式讚 → 「次互動」不顯示（數不準就不給數字）----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/recap`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.recap-nums .recap-num', { timeout: 10000 });
  const labels = await page.evaluate(() => [...document.querySelectorAll('.recap-num-l')].map((x) => x.textContent.trim()));
  yes(labels.includes('張照片') && !labels.includes('次互動'), `回顧：行程裡有舊式讚 → 不顯示「次互動」（前置：有「張照片」；${J(labels)}）`);

  // ---------- 影片片尾（畫在 canvas 上，這裡只能查原始碼）----------
  const mem = fs.readFileSync(path.join(ROOT, 'js/memory.js'), 'utf8');
  yes(mem.includes('個回憶') && !mem.includes('個讚'), '影片片尾的文字（前置：同一段的「個回憶」在）沒有「N 個讚」');
} catch (e) { fail++; console.log('✗ 例外 ' + (e && e.stack || e)); }
finally { await browser.close(); web.kill(); }
console.log(`\n讚數＝按讚人數：${pass} 項通過、${fail} 項失敗`);
process.exitCode = fail ? 1 : 0;
