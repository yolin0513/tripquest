// 移除旅程只影響這台裝置（npm run removetest，v1.62）——三代理必修項逐條釘住：
//   · 移除完全不外送：伺服器記錄數與 seq 不變、另一台的資料一筆都沒少
//   · 本機清乾淨：記錄、照片 blob、待送佇列、同步游標、localStorage 旗標
//   · 不會被同步拉回來（含「移除當下正好有一輪 drain 在跑」的競態）
//   · 還有照片沒上傳時擋下來（那些照片只有這台有）
//   · 之後從「已移除的旅程 → 加回來」能拿回全部內容
//   · 日常的刪景點／撤照片照樣同步（沒有被誤擋）

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5675, API = 8831;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  return page;
}
const serverState = async (page, gid, secret) => page.evaluate(async (o) => {
  const sync = await import('./js/sync.js');
  const res = await sync.adapterForGroup(o.gid, o.secret).pull(0);
  const live = (res.records || []).filter((r) => !r.deleted);
  return {
    seq: res.seq, total: (res.records || []).length,
    trips: live.filter((r) => r.type === 'trip').length,
    spots: live.filter((r) => r.type === 'spot').length,
    subs: live.filter((r) => r.type === 'submission').length,
    tombs: (res.records || []).filter((r) => r.deleted).length,
    retractions: (res.records || []).filter((r) => r.type === 'retraction').length,
  };
}, { gid, secret });

try {
  // ---------- A 建行程、灌照片；B 加入 ----------
  const A = await device('A');
  const setup = await A.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族旅行', region: '宜蘭', allowWiki: false });
    const quests = [];
    for (const n of ['羅東夜市', '太平山', '礁溪溫泉']) {
      const sid = uuid(), qid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: n, emoji: '📍', day: 1, order: 0 });
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `在${n}拍一張`, kind: 'thing', order: 0 });
      quests.push(qid);
    }
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 53},60%,50%)`; x.fillRect(0, 0, 400, 300); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); };
    for (let i = 0; i < 6; i++) await importPhoto(new File([await mk(i)], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: quests[i % 3], memberId: mA, allowGeo: false });
    await ensureGroupSync(gid);
    return { gid, tid, mA, mB, secret: s.getRaw(gid).syncSecret };
  });
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  await sleep(800);

  const B = await device('B');
  await B.evaluate(async (o) => {
    const { joinInvite } = await import('./js/share.js');
    const { getConfig } = await import('./js/sync.js');
    await joinInvite({ kind: 'sync', short: true, groupId: o.gid, secret: o.secret, url: getConfig().url, tripPrefix: o.tid.slice(0, 8) });
  }, setup);
  const before = await serverState(A, setup.gid, setup.secret);
  const bBefore = await B.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return { spots: s.spotsOf(o.tid).length, subs: s.submissionsOfTrip(o.tid).length };
  }, setup);
  yes(before.trips === 1 && before.spots === 3 && before.subs === 6 && bBefore.spots === 3 && bBefore.subs === 6,
    `起點：伺服器 1 行程/3 景點/6 照片，B 也拿到（${bBefore.spots} 景點、${bBefore.subs} 照片）`);

  // ---------- 未上傳擋門 ----------
  console.log('\n— 還有照片沒上傳時擋下來 —');
  const blocked = await B.evaluate(async (o) => {
    const db = await import('./js/db.js');
    await db.outboxPut({ id: 'blob:' + o.gid + ':fakehash', op: 'blob', groupId: o.gid, hash: 'fakehash', nextAt: 0 });
    const outbox = await import('./js/outbox.js');
    return (await outbox.pendingOf(o.gid)).total;
  }, setup);
  yes(blocked === 1, '待送佇列有東西時 pendingOf 抓得到（UI 會擋住移除）');
  await B.evaluate(async (o) => { await (await import('./js/db.js')).outboxDelete('blob:' + o.gid + ':fakehash'); }, setup);

  // ---------- B 從 UI 移除 ----------
  console.log('\n— B 移除（走真的按鈕）—');
  await B.evaluate((o) => { location.hash = '#/trip/' + o.tid + '/settings'; }, setup);
  await B.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('從我的手機移除')), { timeout: 10000 });
  const btnTxt = await B.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('從我的手機移除')).textContent);
  yes(btnTxt.includes('從我的手機移除'), `按鈕文字講清楚範圍：「${btnTxt.trim()}」`);
  await B.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('從我的手機移除')).click());
  await B.waitForSelector('.modal-card', { timeout: 8000 });
  const dlg = await B.evaluate(() => document.querySelector('.modal-card').innerText.replace(/\s+/g, ' '));
  yes(dlg.includes('其他旅伴') && dlg.includes('不受影響') && dlg.includes('加回來'),
    `對話框說明正確：「${dlg.slice(0, 46)}…」`);
  await B.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.trim() === '移除').click());
  await B.waitForFunction(() => location.hash === '#/' || location.hash === '', { timeout: 15000 });
  await sleep(1200);

  // ---------- 伺服器與 A 完全不受影響 ----------
  console.log('\n— 伺服器與旅伴不受影響 —');
  const after = await serverState(A, setup.gid, setup.secret);
  yes(after.trips === 1 && after.spots === 3 && after.subs === 6,
    `伺服器資料一筆沒少（${after.trips} 行程 / ${after.spots} 景點 / ${after.subs} 照片）`);
  yes(after.tombs === before.tombs && after.retractions === 0,
    `沒有多出任何墓碑或撤回記錄（墓碑 ${after.tombs}、retraction ${after.retractions}）`);
  yes(after.seq === before.seq, `伺服器 seq 沒動（${before.seq} → ${after.seq}）—— 完全沒有推送`);
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  const aAfter = await A.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return { spots: s.spotsOf(o.tid).length, subs: s.submissionsOfTrip(o.tid).length, trip: !!s.get(o.tid) };
  }, setup);
  yes(aAfter.trip && aAfter.spots === 3 && aAfter.subs === 6, 'A 那台同步後依然完整（3 景點、6 照片）');

  // ---------- B 本機清乾淨 ----------
  console.log('\n— B 本機清乾淨 —');
  const bClean = await B.evaluate(async (o) => {
    const db = await import('./js/db.js');
    const s = await import('./js/store.js');
    const recs = (await db.allRecords()).filter((r) => r.id === o.gid || r.groupId === o.gid || r.tripId === o.tid);
    const mem = s.exportRecords({ all: true }).filter((r) => r.id === o.gid || r.groupId === o.gid || r.tripId === o.tid);
    const ob = (await db.outboxAll()).filter((e) => e.groupId === o.gid || e.id === 'push:' + o.gid);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.includes(o.tid)) keys.push(k); }
    return {
      dbRecords: recs.length, memRecords: mem.length, outbox: ob.length,
      blobs: (await db.allBlobKeys()).length, cursor: await db.metaGet('seq:' + o.gid),
      lsKeys: keys, kept: ((await db.metaGet('removedGroups')) || []).length,
    };
  }, setup);
  yes(bClean.dbRecords === 0 && bClean.memRecords === 0, `記錄清光（IndexedDB ${bClean.dbRecords}、記憶體 ${bClean.memRecords}）`);
  yes(bClean.blobs === 0, `照片 blob 清光（${bClean.blobs}）`);
  yes(bClean.outbox === 0, '待送佇列清光（不然 drain 會每 2 秒空轉）');
  yes(!bClean.cursor, `同步游標歸零（${bClean.cursor}）—— 不然日後還原只會拿到殘缺的一半`);
  yes(bClean.lsKeys.length === 0, `localStorage 旗標清光（${bClean.lsKeys.join(',') || '無殘留'}）`);
  yes(bClean.kept === 1, '祕鑰留在本機 meta，之後可以「加回來」');

  // ---------- 不會被同步拉回來（含競態） ----------
  console.log('\n— 不會長回來 —');
  await B.evaluate(async () => {
    const outbox = await import('./js/outbox.js');
    for (let i = 0; i < 3; i++) await outbox.drain({ force: true });
  });
  await sleep(1500);
  const bRevive = await B.evaluate(async (o) => {
    const s = await import('./js/store.js'); const db = await import('./js/db.js');
    return {
      mem: s.exportRecords({ all: true }).filter((r) => r.id === o.gid || r.groupId === o.gid || r.tripId === o.tid).length,
      db: (await db.allRecords()).filter((r) => r.id === o.gid || r.groupId === o.gid || r.tripId === o.tid).length,
      trips: s.trips().length,
    };
  }, setup);
  yes(bRevive.mem === 0 && bRevive.db === 0 && bRevive.trips === 0,
    `連跑三輪同步之後仍然沒有長回來（記憶體 ${bRevive.mem}、IndexedDB ${bRevive.db}、首頁 ${bRevive.trips} 個旅程）`);

  // A 這時候改東西 + 加照片 → B 仍然不該拿到
  await A.evaluate(async (o) => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const sp = s.spotsOf(o.tid)[0];
    await s.patch(sp.id, { name: '羅東夜市（改過）' });
    await s.put({ id: uuid(), type: 'spot', tripId: o.tid, name: '新景點', emoji: '📍', day: 2, order: 0 });
    await (await import('./js/outbox.js')).drain({ force: true });
  }, setup);
  await sleep(600);
  await B.evaluate(async () => { await (await import('./js/outbox.js')).drain({ force: true }); });
  await sleep(800);
  const bStill = await B.evaluate(async (o) => (await import('./js/store.js')).exportRecords({ all: true })
    .filter((r) => r.id === o.gid || r.groupId === o.gid || r.tripId === o.tid).length, setup);
  yes(bStill === 0, '旅伴那邊繼續編輯，也不會把移除掉的旅程推回 B');

  // ---------- 加回來 ----------
  console.log('\n— 加回來 —');
  await B.evaluate((o) => { location.hash = '#/settings'; }, setup);
  await B.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('加回來')), { timeout: 10000 });
  await B.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加回來')).click());
  await B.waitForFunction(() => location.hash.includes('/trip/'), { timeout: 40000 });
  await sleep(1500);
  const bBack = await B.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const t = s.trips()[0];
    return { trips: s.trips().length, spots: t ? s.spotsOf(t.id).length : 0, subs: t ? s.submissionsOfTrip(t.id).length : 0,
      kept: ((await (await import('./js/db.js')).metaGet('removedGroups')) || []).length };
  }, setup);
  yes(bBack.trips === 1 && bBack.spots === 4 && bBack.subs === 6,
    `加回來拿到完整內容（${bBack.spots} 景點含 A 新加的、${bBack.subs} 照片）`);
  yes(bBack.kept === 0, '加回來之後就從「已移除」清單消失');

  // ---------- 日常刪除照樣同步（沒被誤擋） ----------
  console.log('\n— 日常刪除不受影響 —');
  await A.evaluate(async (o) => {
    const s = await import('./js/store.js');
    await s.remove(s.spotsOf(o.tid).find((x) => x.name === '新景點').id);
    await (await import('./js/outbox.js')).drain({ force: true });
  }, setup);
  await sleep(700);
  await B.evaluate(async () => { await (await import('./js/outbox.js')).drain({ force: true }); });
  await sleep(900);
  const bAfterDel = await B.evaluate(async () => {
    const s = await import('./js/store.js');
    const t = s.trips()[0];
    return t ? s.spotsOf(t.id).length : -1;
  });
  yes(bAfterDel === 3, `A 刪掉一個景點仍然同步得過去（B 剩 ${bAfterDel} 個景點）—— 沒有把日常刪除一起擋掉`);


  // ---------- v1.73.1：「再也送不出去」的東西不能靜默 ----------
  //
  // v1.64 那條「4xx 無限重試且使用者永遠看不到」只落地了前半（標 dead、不再排程）。
  // 後半（讓使用者看到）寫好了 deadCount() 卻零個呼叫端，而且三個計數器對 dead
  // 的處理互相矛盾：進度列含 dead（永遠顯示「正在上傳」），移除守衛不含 dead
  // （直接放行 → 只存在這台的照片被硬刪）。兩邊都錯，方向還相反。
  console.log('\n— 永久失敗的上傳（v1.73.1）—');
  const D = await device('dead');   // device() 回的就是 page
  const dg = await D.evaluate(async () => {
    const s2 = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const db = await import('./js/db.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s2.put({ id: gid, type: 'group', name: 'g', syncSecret: 'sekret-dead-1234567890' });
    await s2.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭' });
    await s2.put({ id: me, type: 'member', tripId: tid, groupId: gid, displayName: '阿嬤' });
    const q = uuid();
    await s2.put({ id: q, type: 'quest', tripId: tid, order: 0, title: 't' });
    await s2.put({ id: uuid(), type: 'submission', tripId: tid, questId: q, memberId: me,
      photoHash: 'deadhash', thumbHash: 'deadhash', createdAt: Date.now() });
    // 一張 413 一直傳不上去的照片：直接把 outbox 項目設成 dead（跟真的失敗完後一樣）
    await db.outboxPut({ id: `blob:${gid}:deadhash`, op: 'blob', groupId: gid, hash: 'deadhash',
      tries: 3, nextAt: Number.MAX_SAFE_INTEGER, dead: true, lastError: 'blob 413' });
    return { gid, tid };
  });

  const dst = await D.evaluate(async (g) => {
    const o = await import('./js/outbox.js');
    const [st, pend, cnt] = [await o.syncStatus(g.tid), await o.pendingOf(g.gid), await o.pendingCount()];
    // total 會有 1 個正常的 push 項目（種資料時 store.put 排的），那是對的。
    // 這裡要驗的是「dead 的那張照片有沒有從『待上傳』裡拿掉、有沒有另外報出來」。
    return { uploads: st.uploads, stDead: st.dead, why: st.deadWhy,
      pendDead: pend.dead, pendBlobs: pend.blobs, cntBlobs: cnt.blobs, cntDead: cnt.dead };
  }, dg);
  yes(dst.uploads === 0 && dst.stDead === 1,
    `進度列不再謊稱「正在上傳」（uploads=${dst.uploads}，另外報 dead=${dst.stDead}）`,
    JSON.stringify(dst));
  yes(/太大/.test(dst.why),
    `原因翻成使用者看得懂的話：「${dst.why}」（不是「blob 413」）`, dst.why);
  yes(dst.pendDead === 1 && dst.pendBlobs === 0,
    `移除守衛看得到永久失敗的照片（dead=${dst.pendDead}，不再算進「等上傳」的 ${dst.pendBlobs}）—— 以前 pendingOf 排除 dead 直接放行`,
    JSON.stringify(dst));
  yes(dst.cntBlobs === 0 && dst.cntDead === 1,
    `設定頁的「還有 N 張照片正在上傳」會歸零、另外標永久失敗（blobs=${dst.cntBlobs} / dead=${dst.cntDead}）`,
    JSON.stringify(dst));

  // 死掉的 push 項目以前會讓那個群組**再也不會同步**（enqueuePush 撞到就 return）
  const revive = await D.evaluate(async (g) => {
    const db = await import('./js/db.js');
    const o = await import('./js/outbox.js');
    await db.outboxPut({ id: 'push:' + g.gid, op: 'push', groupId: g.gid, tries: 5,
      nextAt: Number.MAX_SAFE_INTEGER, dead: true, lastError: 'push 400' });
    const s2 = await import('./js/store.js');
    await s2.patch(g.tid, { title: '宜蘭三日' });     // 使用者又改了一次
    await new Promise((r) => setTimeout(r, 300));
    const e = await db.outboxGet('push:' + g.gid);
    return { dead: !!(e && e.dead), nextAt: e && e.nextAt, exists: !!e };
  }, dg);
  yes(revive.exists && !revive.dead && revive.nextAt === 0,
    '使用者再編輯一次，死掉的 push 項目會復活（內容變了就值得再試）—— 以前它會永遠卡住這個群組',
    JSON.stringify(revive));

  // 推送途中的編輯：以前 enqueuePush 撞到在途項目就 return，推完又把項目刪掉 → 編輯消失
  const dirty = await D.evaluate(async (g) => {
    const db = await import('./js/db.js');
    const o = await import('./js/outbox.js');
    await db.outboxPut({ id: 'push:' + g.gid, op: 'push', groupId: g.gid, tries: 0, nextAt: 0, pushed: 40 });
    await o.enqueuePush(g.gid);                       // 推送進行中又有人改東西
    const e = await db.outboxGet('push:' + g.gid);
    return { dirty: !!(e && e.dirty) };
  }, dg);
  yes(dirty.dirty,
    '推送途中的編輯會標記 dirty（推完不刪項目、下一輪重推）—— 以前那些編輯永遠不會同步出去',
    JSON.stringify(dirty));

  console.log('\n移除旅程測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
