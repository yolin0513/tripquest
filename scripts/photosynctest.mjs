// 旅伴上傳的照片在別台顯示不出來（npm run photosynctest）
//
// 使用者實機回報：照片牆篩選在「山風民宿hillstay」，三則「媽媽 拍的」貼文
// 有標題、有反應鈕、有留言框，**照片本身完全沒有出現** —— 連佔位或載入中都沒有。
//
// 重現後確認是兩層問題疊起來：
//   ① 照片牆去要 `sub.photoHash`（**全圖**）。但同步的分層設計是「縮圖全部立即
//      同步、全圖延遲抓」（outbox.js 開頭就寫了）。媽媽那 2MB 的全圖還卡在上傳
//      佇列或上傳失敗時，記錄已經同步過去了，全圖卻還不存在 → 抓不到。
//   ② 抓不到時 `blobURL()` 回空字串，`<img src="">` 在畫面上是 **0px**。
//      沒有破圖、沒有替代文字 —— 使用者看到的就是「照片消失了」。
//
// 這支把兩件事都釘住，而且是用「媽媽上傳、爸爸檢視」的真實兩台裝置流程。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5351, API = 8801;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1500);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const eq = (g, w, m) => (g === w ? ok(m) : fail(m, `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const dev = async (name) => {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 390, height: 844 });
  pg.on('pageerror', (e) => { console.log(`  [${name} pageerror]`, e.message); process.exitCode = 1; });
  await pg.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await pg.waitForSelector('.hero');
  await pg.evaluate((u) => { (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url: u }); })(); }, `http://localhost:${API}`);
  return pg;
};
const drain = (pg) => pg.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
const wallState = (pg) => pg.evaluate(() => [...document.querySelectorAll('.feed-item')].map((it) => {
  const img = it.querySelector('.fi-photo');
  const st = it.querySelector('.ph-state');
  return {
    who: (it.querySelector('.fi-who') || {}).textContent || '',
    imgShown: !!img && !img.hidden && Math.round(img.getBoundingClientRect().height) > 20,
    imgH: img ? Math.round(img.getBoundingClientRect().height) : 0,
    src: img ? (img.getAttribute('src') || '') : '',
    stateShown: !!st && !st.hidden,
    stateText: st && !st.hidden ? st.innerText.replace(/\s+/g, ' ').trim() : '',
    hasRetry: !!it.querySelector('.ph-retry'),
  };
}));

try {
  // ---------- 媽媽的手機：建行程、拍三張 ----------
  const mom = await dev('媽媽');
  const setup = await mom.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const gid = uuid(), tid = uuid(), mMom = uuid(), mDad = uuid();
    await s.put({ id: gid, type: 'group', name: '家族', syncSecret: 'e'.repeat(32) });
    await s.put({ id: mMom, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mDad, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭遊', region: '宜蘭', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, region: '宜蘭', items: [{ name: '山風民宿hillstay', day: 1 }] });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    return { gid, tid, mMom, qs: s.questsOf(spots[0].id).map((q) => q.id) };
  });
  const subs = await mom.evaluate(async (st) => {
    const { importPhoto } = await import('./js/photos.js');
    const mk = (hue) => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
      const x = c.getContext('2d'); x.fillStyle = `hsl(${hue},60%,50%)`; x.fillRect(0, 0, 1200, 900);
      for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(hue + i) % 360},70%,${30 + (i % 50)}%)`; x.fillRect(Math.random() * 1200, Math.random() * 900, 30, 30); }
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    };
    const out = [];
    for (let i = 0; i < 3; i++) {
      const blob = await mk(i * 100);
      const sub = await importPhoto(new File([blob], `p${i}.jpg`, { type: 'image/jpeg' }),
        { tripId: st.tid, questId: st.qs[i % st.qs.length], memberId: st.mMom });
      out.push({ thumb: sub.thumbHash, photo: sub.photoHash });
    }
    return out;
  }, setup);
  eq(subs.length, 3, '媽媽拍了 3 張');

  // ---------- 情境 A：全圖上傳失敗，只有縮圖與記錄上得去 ----------
  // 真實情境：2MB 的全圖在行動網路上傳失敗／還排在佇列，30KB 縮圖與記錄早就過去了。
  console.log('\n— 情境 A：全圖還沒上傳（縮圖已到）—');
  const fullHashes = subs.map((s) => s.photo);
  await mom.setRequestInterception(true);
  let blockFull = true;
  mom.on('request', (r) => {
    const u = r.url();
    if (blockFull && r.method() === 'PUT' && u.includes('/blob/') && fullHashes.some((h) => u.includes(h))) {
      r.abort().catch(() => {}); return;
    }
    r.continue().catch(() => {});
  });
  const t1 = await drain(mom);
  yes(t1.uploaded === 3 && t1.failed === 3, `媽媽：縮圖 3 張上傳成功、全圖 3 張失敗（${JSON.stringify(t1)}）`);

  const dad = await dev('爸爸');
  await dad.evaluate(async (st) => {
    const s = await import('./js/store.js');
    await s.put({ id: st.gid, type: 'group', name: '家族', syncSecret: 'e'.repeat(32) });
  }, setup);
  await drain(dad);
  const have = await dad.evaluate(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const list = s.exportRecords().filter((r) => r.type === 'submission');
    const keys = new Set(await db.allBlobKeys());
    return {
      records: list.length,
      thumbs: list.filter((x) => keys.has(x.thumbHash)).length,
      fulls: list.filter((x) => keys.has(x.photoHash)).length,
    };
  });
  eq(have.records, 3, '爸爸：3 筆投稿記錄都同步過來了');
  eq(have.thumbs, 3, '爸爸：3 張縮圖也拿到了');
  eq(have.fulls, 0, '爸爸：全圖一張都沒有（正是使用者遇到的狀態）');

  await dad.goto(`http://localhost:${WEB}/#/trip/${setup.tid}/people`, { waitUntil: 'networkidle0' });
  await dad.waitForSelector('.feed-item', { timeout: 20000 });
  await sleep(2500);
  const wallA = await wallState(dad);
  eq(wallA.length, 3, '照片牆列出 3 則');
  yes(wallA.every((w) => w.imgShown), `三張照片都顯示得出來（高度 ${wallA.map((w) => w.imgH).join('/')}px）`,
    JSON.stringify(wallA));
  yes(wallA.every((w) => w.src.startsWith('blob:')), '用的是本機的縮圖（不是空 src）');
  yes(wallA.every((w) => !w.stateShown), '不會多顯示一塊沒必要的狀態');

  // ---------- 情境 B：連縮圖都還沒到 ----------
  console.log('\n— 情境 B：連縮圖都還沒到 —');
  const dad2 = await dev('爸爸2');
  // 讓這台什麼 blob 都抓不到（模擬旅伴的手機還沒把任何東西傳上去）
  await dad2.setRequestInterception(true);
  let blockAll = true;
  dad2.on('request', (r) => {
    if (blockAll && r.method() === 'GET' && r.url().includes('/blob/')) { r.abort().catch(() => {}); return; }
    r.continue().catch(() => {});
  });
  await dad2.evaluate(async (st) => {
    const s = await import('./js/store.js');
    await s.put({ id: st.gid, type: 'group', name: '家族', syncSecret: 'e'.repeat(32) });
  }, setup);
  await drain(dad2);
  await dad2.goto(`http://localhost:${WEB}/#/trip/${setup.tid}/people`, { waitUntil: 'networkidle0' });
  await dad2.waitForSelector('.feed-item', { timeout: 20000 });
  await sleep(3000);
  const wallB = await wallState(dad2);
  yes(wallB.length === 3, '照片牆仍然列出 3 則（記錄有就要看得到）');
  yes(wallB.every((w) => w.stateShown), '每一則都明白說出照片的狀態，不是一片空白');
  yes(wallB.every((w) => /還沒傳過來/.test(w.stateText)), `狀態文字：「${wallB[0] && wallB[0].stateText}」`);
  yes(wallB.every((w) => w.hasRetry), '每一則都有「重新下載」可以按');
  yes(wallB.every((w) => !w.imgShown), '沒有留下 0px 的隱形 <img>');

  // ---------- 重試：blob 到了之後按重試就出現 ----------
  console.log('\n— 重試 —');
  blockAll = false;                      // 網路好了
  await dad2.evaluate(() => document.querySelector('.ph-retry').click());
  await dad2.waitForFunction(() => {
    const img = document.querySelector('.feed-item .fi-photo');
    return img && !img.hidden && img.getBoundingClientRect().height > 20;
  }, { timeout: 25000 }).then(() => ok('按「重新下載」之後照片就出現了')).catch(() => fail('按了重試照片還是沒出來'));

  // ---------- 自動補上：不用重開頁面 ----------
  const dad3 = await dev('爸爸3');
  await dad3.setRequestInterception(true);
  let block3 = true;
  dad3.on('request', (r) => {
    if (block3 && r.method() === 'GET' && r.url().includes('/blob/')) { r.abort().catch(() => {}); return; }
    r.continue().catch(() => {});
  });
  await dad3.evaluate(async (st) => {
    const s = await import('./js/store.js');
    await s.put({ id: st.gid, type: 'group', name: '家族', syncSecret: 'e'.repeat(32) });
  }, setup);
  await drain(dad3);
  await dad3.goto(`http://localhost:${WEB}/#/trip/${setup.tid}/people`, { waitUntil: 'networkidle0' });
  await dad3.waitForSelector('.ph-state', { timeout: 20000 });
  await sleep(1500);
  block3 = false;
  await drain(dad3);                     // 背景同步跑一輪（照片其實是這樣到的）
  await dad3.waitForFunction(() => {
    const img = document.querySelector('.feed-item .fi-photo');
    return img && !img.hidden && img.getBoundingClientRect().height > 20;
  }, { timeout: 25000 }).then(() => ok('背景同步把照片拉回來之後，畫面自己補上（不用重開頁面）'))
    .catch(() => fail('背景同步完成後畫面沒有自己補上'));

  // ---------- 標記畫面也不能是空白 ----------
  console.log('\n— 標記畫面 —');
  const taggerOk = await dad.evaluate(async () => {
    const src = await (await fetch('./js/phototag.js')).text();
    return /thumbHash \|\| sub\.photoHash/.test(src);
  });
  yes(taggerOk, '標記畫面也改成縮圖優先（原本只認全圖，一樣會空白）');

  // ---------- 任務詳情頁不再有重複的加照片按鈕 ----------
  console.log('\n— 任務詳情頁 —');
  const qid = await dad.evaluate(async (st) => {
    const s = await import('./js/store.js');
    return s.exportRecords().find((r) => r.type === 'submission').questId;
  }, setup);
  await dad.goto(`http://localhost:${WEB}/#/quest/${qid}`, { waitUntil: 'networkidle0' });
  await dad.waitForSelector('.page', { timeout: 15000 });
  await sleep(1200);
  const qv = await dad.evaluate(() => {
    const btns = [...document.querySelectorAll('.page button')].map((b) => b.textContent.trim());
    return {
      addPhoto: btns.filter((t) => /拍照|從相簿選|再拍一張/.test(t)),
      hint: document.body.innerText.includes('回上一頁'),
      cells: document.querySelectorAll('.photo-cell').length,
      photosShown: [...document.querySelectorAll('.photo-cell img')].filter((i) => !i.hidden && i.getBoundingClientRect().height > 20).length,
    };
  });
  eq(qv.addPhoto.length, 0, '照片下方不再有「拍照 / 從相簿選 / 再拍一張」（上一層的任務列已經有了）');
  yes(qv.hint, '有一句話告訴他要補拍就回上一頁那一列按');
  yes(qv.cells > 0 && qv.photosShown === qv.cells, `照片格照樣顯示得出來（${qv.photosShown}/${qv.cells}）`);

  console.log('\n照片同步顯示測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
  api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
