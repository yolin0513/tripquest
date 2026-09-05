// 照片牆的排序／篩選，以及「現在這一站」（npm run walltest）
//
// 「帶我去下一站」原本機械式地找第一個未完成的景點。實際使用時，人到了景點常常
// 不會當下就拍照，那個景點就一直算沒完成 —— 於是它永遠指著同一個地方。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5214, API = 8794;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ok = (m) => console.log('✓ ' + m);
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

const go = async (hash) => {
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}${hash}`, { waitUntil: 'networkidle0' });
};

try {
  // 3 個景點、各 2 個任務；只有第 1 個景點有照片（第 2、3 個都還沒完成）
  const setup = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '小美' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭兩日遊', region: '宜蘭', allowWiki: false });
    const mk = (hue) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = `hsl(${hue},60%,50%)`; x.fillRect(0, 0, 400, 300); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };

    const spots = [];
    const names = [['羅東夜市', 1], ['幾米公園', 1], ['太平山', 2]];
    for (let i = 0; i < names.length; i++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: names[i][0], emoji: '📍', day: names[i][1], order: i });
      const qs = [];
      for (let k = 0; k < 2; k++) {
        const qid = uuid();
        await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `${names[i][0]}任務${k + 1}`, kind: 'thing', order: k });
        qs.push(qid);
      }
      spots.push({ sid, qs, name: names[i][0] });
    }
    // 第 1 個景點：兩個任務都拍好（完成）；第 2 個景點只拍 1 張
    let hue = 0;
    for (const q of spots[0].qs) {
      await importPhoto(new File([await mk(hue += 40)], 'a.jpg', { type: 'image/jpeg' }),
        { tripId: tid, questId: q, memberId: mA, allowGeo: false });
    }
    await importPhoto(new File([await mk(hue += 40)], 'b.jpg', { type: 'image/jpeg' }),
      { tripId: tid, questId: spots[1].qs[0], memberId: mB, allowGeo: false });
    return { tid, spots: spots.map((x) => ({ id: x.sid, name: x.name })) };
  });
  ok('建立測試行程（3 景點：第 1 個完成、第 2 個一半、第 3 個沒開始）');

  // ================= 「現在這一站」 =================
  await go(`/#/trip/${setup.tid}`);
  await page.waitForSelector('.qbig');
  await sleep(500);
  const auto = await page.evaluate(() => ({
    name: document.querySelector('.nextstn-name')?.textContent || '',
    label: document.querySelector('.nextstn-btn span, .nextstn-plain span')?.textContent || '',
    hasSwitch: !!document.querySelector('.nextstn-switch'),
  }));
  if (auto.name.includes('幾米公園')) ok(`沒指定時照舊：指向第一個未完成的（${auto.name.trim()}）`);
  else fail('自動判斷不對：' + JSON.stringify(auto));
  if (auto.hasSwitch) ok('旁邊有「換一站」可以切換');
  else fail('沒有「換一站」按鈕');

  // 手動指定第 3 個景點（太平山）—— 明明還沒輪到，但人已經先過去了
  await page.evaluate(() => document.querySelector('.nextstn-switch').click());
  await page.waitForSelector('.here-pick');
  const pickCount = await page.evaluate(() => document.querySelectorAll('.here-pick').length);
  if (pickCount === 3) ok(`「換一站」列出全部 ${pickCount} 個景點`);
  else fail('選單裡的景點數不對：' + pickCount);
  const tooSmall = await page.evaluate(() => [...document.querySelectorAll('.here-pick')].filter((b) => b.getBoundingClientRect().height < 44).length);
  if (tooSmall === 0) ok('選單的按鈕觸控區 ≥ 44px');
  else fail(`${tooSmall} 顆太小`);

  await page.evaluate(() => [...document.querySelectorAll('.here-pick')].find((b) => b.textContent.includes('太平山')).click());
  await sleep(700);
  const manual = await page.evaluate(() => ({
    name: document.querySelector('.nextstn-name')?.textContent || '',
    hereTag: !!document.querySelector('.qcollapse.is-here .qc-here'),
    openSpots: [...document.querySelectorAll('.qcollapse')].filter((e) => e.classList.contains('open'))
      .map((e) => e.querySelector('.qc-name')?.firstChild?.textContent),
    openDays: [...document.querySelectorAll('.daycollapse')].filter((e) => e.classList.contains('open')).map((e) => e.dataset.day),
  }));
  if (manual.name.includes('太平山')) ok(`指定之後「帶我去」改指向使用者選的那一站（${manual.name.trim()}）`);
  else fail('指定後沒有改變：' + JSON.stringify(manual));
  if (manual.hereTag) ok('那個景點標示「📍 現在這一站」');
  else fail('沒有標示現在這一站');
  if (manual.openSpots.length === 1 && manual.openSpots[0] === '太平山') ok('只展開指定的那個景點，其他收合');
  else fail('展開的景點不對：' + JSON.stringify(manual.openSpots));
  if (manual.openDays.length === 1 && manual.openDays[0] === '2') ok('只展開它所在的那一天（第 2 天）');
  else fail('展開的天數不對：' + JSON.stringify(manual.openDays));

  // 重開行程頁，狀態要留著
  await go(`/#/trip/${setup.tid}`);
  await page.waitForSelector('.qbig');
  await sleep(1500);
  const again = await page.evaluate(() => ({
    name: document.querySelector('.nextstn-name')?.textContent || '',
    openSpots: [...document.querySelectorAll('.qcollapse.open')].map((e) => e.querySelector('.qc-name')?.firstChild?.textContent),
    scrollY: Math.round(window.scrollY),
  }));
  if (again.name.includes('太平山') && again.openSpots.length === 1 && again.openSpots[0] === '太平山') {
    ok('下次打開這趟行程：仍然預設展開指定的那一站');
  } else fail('重開後沒維持：' + JSON.stringify(again));
  if (again.scrollY > 100) ok(`自動捲到指定的那一站（捲了 ${again.scrollY}px）`);
  else fail('沒有捲到指定的那一站：' + again.scrollY);

  // 完成之後要自動放手，不能把人困在手動狀態
  await page.evaluate(async (s) => {
    const st = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const spot = st.spotsOf(s.tid).find((x) => x.name === '太平山');
    const mem = st.membersOf(st.get(s.tid).groupId)[0];
    const mk = (hue) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = `hsl(${hue},60%,50%)`; x.fillRect(0, 0, 400, 300); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    let hue = 200;
    for (const q of st.questsOf(spot.id)) {
      await importPhoto(new File([await mk(hue += 30)], 'c.jpg', { type: 'image/jpeg' }),
        { tripId: s.tid, questId: q.id, memberId: mem.id, allowGeo: false });
    }
  }, setup);
  await go(`/#/trip/${setup.tid}`);
  await page.waitForSelector('.qbig');
  await sleep(500);
  const advanced = await page.evaluate(async (tid) => {
    const st = await import('./js/store.js');
    return { here: st.getHereSpot(tid), name: document.querySelector('.nextstn-name')?.textContent || '' };
  }, setup.tid);
  if (!advanced.here) ok('指定的景點完成後，手動狀態自動失效（不會被困住）');
  else fail('完成後仍卡在手動狀態：' + JSON.stringify(advanced));
  if (advanced.name.includes('幾米公園')) ok(`自動往下推進到還沒完成的那一站（${advanced.name.trim()}）`);
  else fail('沒有往下推進：' + JSON.stringify(advanced));

  // ================= 照片牆的排序與篩選 =================
  await go(`/#/trip/${setup.tid}/people`);
  await page.waitForSelector('.wall-chips');
  await sleep(1200);

  const wall = await page.evaluate(() => ({
    sorts: [...document.querySelectorAll('.wall-chips')][0] ? [...document.querySelectorAll('.wall-chips')][0].querySelectorAll('.wall-chip').length : 0,
    activeSort: [...document.querySelectorAll('.wall-chip.on')].map((b) => b.textContent)[0] || '',
    spotChips: [...document.querySelectorAll('.wall-chip')].filter((b) => /（\d+）/.test(b.textContent)).map((b) => b.textContent),
    small: [...document.querySelectorAll('.wall-chip')].filter((b) => b.getBoundingClientRect().height < 44).length,
    items: document.querySelectorAll('.feed-item').length,
  }));
  if (wall.sorts === 4) ok('排序有 4 種（最新／最舊／照行程順序／照人分）');
  else fail('排序選項數不對：' + wall.sorts);
  if (/最新的在前/.test(wall.activeSort)) ok('預設是「最新的在前」');
  else fail('預設排序不對：' + wall.activeSort);
  if (wall.small === 0) ok('排序與篩選的按鈕觸控區 ≥ 44px');
  else fail(`${wall.small} 顆太小`);
  if (wall.spotChips.some((t) => /羅東夜市（2）/.test(t)) && wall.spotChips.some((t) => /幾米公園（1）/.test(t))) {
    ok('景點篩選顯示每個景點的張數：' + wall.spotChips.filter((t) => !/全部/.test(t)).join('、'));
  } else fail('景點張數不對：' + JSON.stringify(wall.spotChips));

  // 排序真的有效
  const order = async () => page.evaluate(() => [...document.querySelectorAll('.feed-item .fi-what')].map((e) => e.textContent).filter((t) => t.includes('任務')));
  const newest = await order();
  await page.evaluate(() => [...document.querySelectorAll('.wall-chip')].find((b) => b.textContent.includes('最舊的在前')).click());
  await page.waitForSelector('.feed-item');
  await sleep(1200);
  const oldest = await order();
  const reversed = newest.length > 1 && newest.length === oldest.length
    && newest.every((x, i) => x === oldest[oldest.length - 1 - i]);
  if (reversed) ok(`切換「最舊的在前」後順序真的顛倒（${newest.length} 張，第一張 ${newest[0]} → ${oldest[0]}）`);
  else fail(`排序沒作用：新→${JSON.stringify(newest)} 舊→${JSON.stringify(oldest)}`);

  // 篩選景點
  await page.evaluate(() => [...document.querySelectorAll('.wall-chip')].find((b) => /羅東夜市（2）/.test(b.textContent)).click());
  await page.waitForSelector('.feed-item');
  await sleep(1200);
  const only = await page.evaluate(() => ({
    items: document.querySelectorAll('.feed-item').length,
    label: [...document.querySelectorAll('.section-label')].map((e) => e.textContent).find((t) => t.includes('符合的照片')) || '',
  }));
  const total = newest.length;
  if (only.items === 2 && only.label.includes(`2 / ${total}`)) ok(`只看羅東夜市：剩 2 張，標題顯示「${only.label}」`);
  else fail(`景點篩選不對（全部應為 ${total} 張）：` + JSON.stringify(only));

  // 選擇要記住
  await go(`/#/trip/${setup.tid}/people`);
  await page.waitForSelector('.wall-chips');
  await sleep(1200);
  const remembered = await page.evaluate(() => ({
    items: document.querySelectorAll('.feed-item').length,
    on: [...document.querySelectorAll('.wall-chip.on')].map((b) => b.textContent),
  }));
  if (remembered.items === 2 && remembered.on.some((t) => /羅東夜市/.test(t)) && remembered.on.some((t) => /最舊的在前/.test(t))) {
    ok('下次進來維持上次的排序與篩選');
  } else fail('沒記住：' + JSON.stringify(remembered));

  // 未標記篩選與既有提示並存
  const coexist = await page.evaluate(() => ({
    cta: !!document.querySelector('.untag-cta'),
    chip: [...document.querySelectorAll('.wall-chip')].some((b) => /只看未標記/.test(b.textContent)),
  }));
  if (coexist.cta && coexist.chip) ok('「還有 N 張沒標記」的提示與「只看未標記」篩選並存');
  else fail('未標記提示/篩選不對：' + JSON.stringify(coexist));

  await page.evaluate(() => [...document.querySelectorAll('.wall-chip')].find((b) => /只看未標記/.test(b.textContent)).click());
  await page.waitForSelector('.wall-chips');
  await sleep(1200);
  const untag = await page.evaluate(() => ({
    items: document.querySelectorAll('.feed-item').length,
    dots: document.querySelectorAll('.untag-dot').length,
  }));
  if (untag.items > 0 && untag.items === untag.dots) ok(`「只看未標記」有效：${untag.items} 張，每張都有未標記角標`);
  else fail('未標記篩選不對：' + JSON.stringify(untag));

  // ================= 「現在這一站」要同步給整個群組 =================
  // 兩個獨立 context 當兩台手機，走真的同步伺服器
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

  const A = await dev('A');
  const shared = await A.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '同行團' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '奶奶' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '同步測試', region: '宜蘭', allowWiki: false });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: ['第一站', '第二站', '第三站'][i], emoji: '📍', day: 1, order: i });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: `任務${i + 1}`, kind: 'thing', order: 0 });
      ids.push(sid);
    }
    await ensureGroupSync(gid);
    s.setActiveMember(tid, mA);
    return { tid, gid, spots: ids, mA, mB };
  });
  await drain(A);

  const invite = await A.evaluate(async (tid) => (await import('./js/share.js')).shareURL(tid), shared.tid);
  const B = await dev('B');
  await B.evaluate(async (c) => { await (await import('./js/share.js')).joinInvite(c); }, invite.split('j=')[1]);
  await B.evaluate(async (m) => { (await import('./js/store.js')).setActiveMember(m.tid, m.mB); }, shared);
  ok('兩台裝置加入同一個群組');

  // A 指定第三站
  await A.evaluate(async (m) => {
    const s = await import('./js/store.js');
    await s.setHereSpot(m.tid, m.spots[2], { id: m.mA, name: '阿明' });
  }, shared);
  await drain(A);
  await drain(B);

  const onB = await B.evaluate(async (m) => {
    const s = await import('./js/store.js');
    const rec = s.hereRecord(m.tid);
    return { here: s.getHereSpot(m.tid), by: rec && rec.byMemberId, name: rec && (s.getRaw(rec.byMemberId)?.displayName || rec.byName) };
  }, shared);
  if (onB.here === shared.spots[2]) ok('A 指定的「現在這一站」同步到了 B');
  else fail('沒同步過去：' + JSON.stringify(onB));
  if (onB.name === '阿明') ok(`B 看得到是誰改的（${onB.name}）`);
  else fail('沒帶設定者：' + JSON.stringify(onB));

  // B 的畫面上要顯示「阿明 把大家帶到這裡」
  await B.goto('about:blank');
  await B.goto(`http://localhost:${WEB}/#/trip/${shared.tid}`, { waitUntil: 'networkidle0' });
  await B.waitForSelector('.nextstn');
  await sleep(600);
  const byLine = await B.evaluate(() => document.querySelector('.nextstn-by')?.textContent || '');
  if (/阿明.*把大家帶到這裡/.test(byLine)) ok(`B 的畫面顯示「${byLine}」`);
  else fail('沒顯示是誰改的：' + byLine);

  // B 改成第二站 → 後寫入者為準，A 也要跟著變
  await B.evaluate(async (m) => {
    const s = await import('./js/store.js');
    await s.setHereSpot(m.tid, m.spots[1], { id: m.mB, name: '奶奶' });
  }, shared);
  await drain(B);
  await drain(A);
  const onA = await A.evaluate(async (m) => {
    const s = await import('./js/store.js');
    const rec = s.hereRecord(m.tid);
    const all = s.exportRecords().filter((r) => r.type === 'here' && r.tripId === m.tid);
    return { here: s.getHereSpot(m.tid), by: rec && rec.byName, records: all.length };
  }, shared);
  if (onA.here === shared.spots[1]) ok('B 改了之後 A 也跟著變（後寫入者為準）');
  else fail('沒有以後寫入者為準：' + JSON.stringify(onA));
  if (onA.records === 1) ok('整個群組只有一筆「現在這一站」記錄（不會各自長一筆打架）');
  else fail(`有 ${onA.records} 筆記錄`);

  // 完成之後自動往下推進 —— 而且不可以寫入（否則多台裝置會互相覆蓋）
  const before = await A.evaluate(async (m) => {
    const s = await import('./js/store.js');
    return s.getRaw('here:' + m.tid).updatedAt;
  }, shared);
  await A.evaluate(async (m) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    c.getContext('2d').fillRect(0, 0, 300, 200);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    for (const q of s.questsOf(m.spots[1])) {
      await importPhoto(new File([blob], 'x.jpg', { type: 'image/jpeg' }), { tripId: m.tid, questId: q.id, memberId: m.mA, allowGeo: false });
    }
  }, shared);
  const syncAdv = await A.evaluate(async (m) => {
    const s = await import('./js/store.js');
    return { here: s.getHereSpot(m.tid), updatedAt: s.getRaw('here:' + m.tid).updatedAt };
  }, shared);
  if (syncAdv.here === null) ok('指定的那一站完成後自動失效，兩台都會照順序往下推進');
  else fail('完成後沒推進：' + JSON.stringify(syncAdv));
  if (syncAdv.updatedAt === before) ok('自動推進是「推導」出來的、沒有寫入 —— 不會多台裝置互相覆蓋');
  else fail('自動推進竟然寫入了，會造成同步風暴');

  // 離線也要先在本機生效
  await B.setOfflineMode(true);
  await B.evaluate(async (m) => {
    const s = await import('./js/store.js');
    await s.setHereSpot(m.tid, m.spots[0], { id: m.mB, name: '奶奶' });
  }, shared);
  const offlineNow = await B.evaluate(async (m) => (await import('./js/store.js')).getHereSpot(m.tid), shared);
  if (offlineNow === shared.spots[0]) ok('離線時先在本機生效');
  else fail('離線設定失敗：' + offlineNow);
  await B.setOfflineMode(false);
  await B.waitForFunction(() => navigator.onLine === true, { timeout: 10000 });
  const pushed = await drain(B);
  const pulled = await drain(A);
  const healed = await A.evaluate(async (m) => {
    const s = await import('./js/store.js');
    const rec = s.getRaw('here:' + m.tid);
    return { here: s.getHereSpot(m.tid), spotId: rec && rec.spotId, want: m.spots[0] };
  }, shared);
  if (healed.here === shared.spots[0]) ok('恢復連線後自動同步出去，A 也看到了');
  else fail(`恢復連線後沒同步：${JSON.stringify(healed)} push=${JSON.stringify(pushed)} pull=${JSON.stringify(pulled)}`);

  console.log('\n照片牆與「現在這一站」測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
