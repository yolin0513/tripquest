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
  await sleep(450);                       // 等 slideup 動畫跑完再量位置
  const pickCount = await page.evaluate(() => document.querySelectorAll('.here-pick').length);
  if (pickCount === 3) ok(`「換一站」列出全部 ${pickCount} 個景點`);
  else fail('選單裡的景點數不對：' + pickCount);
  const tooSmall = await page.evaluate(() => [...document.querySelectorAll('.here-pick')].filter((b) => b.getBoundingClientRect().height < 44).length);
  if (tooSmall === 0) ok('選單的按鈕觸控區 ≥ 44px');
  else fail(`${tooSmall} 顆太小`);
  const noCounts = await page.evaluate(() => [...document.querySelectorAll('.here-pick')]
    .every((b) => !/完成|任務|\d+\s*\/\s*\d+/.test(b.textContent)));
  if (noCounts) ok('選單裡不顯示任務數量，畫面乾淨');
  else fail('選單裡還有任務數量');

  // 內容比螢幕高時要捲得動（原本卡片沒有 max-height，會往上長到螢幕外、怎麼滑都沒反應）
  const scrollOK = await page.evaluate(() => {
    const card = document.querySelector('.modal-card');
    const bodyEl = card.querySelector('.modal-body');
    const picks = [...document.querySelectorAll('.here-pick')];
    const fits = card.getBoundingClientRect().top >= -1 && card.getBoundingClientRect().bottom <= window.innerHeight + 1;
    // 每個選項都要能靠捲動看到
    const reachable = picks.every((el) => {
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
      return r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
    });
    return { fits, reachable, scrollable: bodyEl.scrollHeight > bodyEl.clientHeight + 1 };
  });
  if (scrollOK.fits) ok('對話框不會超出螢幕');
  else fail('對話框超出螢幕');
  if (scrollOK.reachable) ok('選單裡每個景點都能捲到、點得到');
  else fail('有選項捲不到');

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => [...document.querySelectorAll('.here-pick')].find((b) => b.textContent.includes('太平山')).click());
  await sleep(1600);
  const afterPickScroll = await page.evaluate(() => Math.round(window.scrollY));
  if (afterPickScroll === 0) ok('選完下一站的當下不會自動捲走（接著要點導航）');
  else fail('選完就自己捲走了：' + afterPickScroll);
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
  if (again.scrollY > 100) ok(`重新打開時自動捲動（捲了 ${again.scrollY}px）`);
  else fail('重新打開沒有自動捲動：' + again.scrollY);
  // 捲動目標應該是「那一站所屬的那一天」的標題列，而且那一站要看得到
  const target = await page.evaluate(() => {
    const topH = document.getElementById('topbar').offsetHeight;
    const tabH = document.getElementById('tabbar').offsetHeight;
    const dayHead = document.querySelector('.daycollapse[data-day="2"] .dc-head');
    const spotHead = [...document.querySelectorAll('.qcollapse')]
      .find((e) => e.querySelector('.qc-name')?.firstChild?.textContent === '太平山')?.querySelector('.qc-head');
    const d = dayHead.getBoundingClientRect(), q = spotHead.getBoundingClientRect();
    return {
      dayTop: Math.round(d.top), topH: Math.round(topH),
      spotVisible: q.top >= topH && q.bottom <= window.innerHeight - tabH,
    };
  });
  if (target.dayTop >= target.topH - 4 && target.dayTop <= target.topH + 40) ok(`捲到「第 2 天」的標題列（距頂列 ${target.dayTop - target.topH}px）`);
  else fail(`捲動目標不是那一天的標題列：${JSON.stringify(target)}`);
  if (target.spotVisible) ok('那一站也在畫面內，打開行程就直接看到要去的那一站');
  else fail('捲完之後那一站還是看不到');

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

  // ================= 使用者實測踩到的：選一個「已經拍完」的景點 =================
  // v1.31 的規則是「完成就自動放手」，結果使用者挑一個已經拍完的地方（想再回去、
  // 或人就站在那裡要導航）時，設定會被默默忽略，畫面看起來就像按了沒反應。
  const D = await dev('D');
  const dz = await D.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: mid, type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '已完成景點', region: '宜蘭', allowWiki: false });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: `站${i + 1}`, emoji: '📍', day: 1, order: i });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: `任務${i}`, kind: 'thing', order: 0 });
      ids.push(sid);
    }
    const mk = () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      c.getContext('2d').fillRect(0, 0, 300, 200); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    for (const q of s.questsOf(ids[0])) {
      await importPhoto(new File([await mk()], 'x.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: mid, allowGeo: false });
    }
    s.setActiveMember(tid, mid);
    await s.setHereSpot(tid, ids[0], { id: mid, name: '阿明' });     // 指定已經拍完的「站1」
    return { tid, done: ids[0], next: ids[1] };
  });
  const doneCase = await D.evaluate(async (z) => {
    const s = await import('./js/store.js');
    return { here: s.getHereSpot(z.tid), want: z.done };
  }, dz);
  if (doneCase.here === dz.done) ok('指定一個「已經拍完」的景點：會照使用者的選擇，不會被默默忽略');
  else fail('選了已完成的景點卻被忽略：' + JSON.stringify(doneCase));

  // 但「設定之後才完成」仍然要自動往下推進（不能因此困住）
  await D.evaluate(async (z) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    await s.setHereSpot(z.tid, z.next, null);
    const mk = () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      c.getContext('2d').fillRect(0, 0, 300, 200); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    const mem = s.membersOf(s.get(z.tid).groupId)[0];
    for (const q of s.questsOf(z.next)) {
      await importPhoto(new File([await mk()], 'y.jpg', { type: 'image/jpeg' }), { tripId: z.tid, questId: q.id, memberId: mem.id, allowGeo: false });
    }
  }, dz);
  const stillAdvances = await D.evaluate(async (z) => (await import('./js/store.js')).getHereSpot(z.tid), dz);
  if (stillAdvances === null) ok('「設定之後才完成」的仍然自動往下推進（不會被困住）');
  else fail('設定後完成卻沒推進：' + stillAdvances);

  // ================= 旅程已結束／還沒出發，一樣要能指定與捲動 =================
  for (const [label, offset] of [['已結束（回程日過了）', -14], ['還沒出發', 7]]) {
    const E = await dev('E');
    const ez = await E.evaluate(async (off) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const iso = (d) => { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + d);
        const q = (n) => String(n).padStart(2, '0');
        return `${x.getFullYear()}-${q(x.getMonth() + 1)}-${q(x.getDate())}`; };
      const gid = uuid(), tid = uuid();
      await s.put({ id: gid, type: 'group', name: 'g' });
      await s.put({ id: tid, type: 'trip', groupId: gid, title: '日期測試', region: '宜蘭', allowWiki: false, startDate: iso(off), endDate: iso(off + 2) });
      const ids = [];
      for (let i = 0; i < 6; i++) {
        const sid = uuid();
        await s.put({ id: sid, type: 'spot', tripId: tid, name: `站${i + 1}`, emoji: '📍', day: Math.floor(i / 2) + 1, order: i });
        for (let k = 0; k < 2; k++) await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: `t${i}-${k}`, kind: 'thing', order: k });
        ids.push(sid);
      }
      return { tid, last: ids[5] };
    }, offset);

    await E.goto('about:blank');
    await E.goto(`http://localhost:${WEB}/#/trip/${ez.tid}`, { waitUntil: 'networkidle0' });
    await E.waitForSelector('.qbig');
    await sleep(1200);
    const hasSwitch = await E.evaluate(() => !!document.querySelector('.nextstn-switch'));
    if (hasSwitch) ok(`${label}：仍然有「帶我去下一站」與「換一站」`);
    else fail(`${label}：按鈕整個不見了，根本沒辦法指定`);

    await E.evaluate(async (z) => {
      const s = await import('./js/store.js');
      await s.setHereSpot(z.tid, z.last, null);
    }, ez);
    await E.goto('about:blank');
    await E.goto(`http://localhost:${WEB}/#/trip/${ez.tid}`, { waitUntil: 'networkidle0' });
    await E.waitForSelector('.qbig');
    await sleep(1800);
    const r = await E.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      openDays: [...document.querySelectorAll('.daycollapse.open')].map((e) => e.dataset.day),
    }));
    if (r.scrollY > 100 && r.openDays.length === 1 && r.openDays[0] === '3') ok(`${label}：重新打開仍會展開第 3 天並捲到位（${r.scrollY}px）`);
    else fail(`${label}：沒有捲動或展開錯誤：${JSON.stringify(r)}`);
  }

  // ================= 照片牆的排序與篩選 =================
  await go(`/#/trip/${setup.tid}/people`);
  await page.waitForSelector('.wall-bar');
  await sleep(1200);

  const wall = await page.evaluate(() => {
    const bar = document.querySelector('.wall-bar');
    const ctls = [...document.querySelectorAll('.wall-ctl')];
    return {
      hasBar: !!bar,
      barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
      ctlCount: ctls.length,
      filterLabel: document.querySelector('.wall-ctl .wall-ctl-label')?.textContent || '',
      small: ctls.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length,
      chipsGone: document.querySelectorAll('.wall-chips').length === 0,
    };
  });
  if (wall.hasBar && wall.ctlCount === 2 && wall.chipsGone) ok('控制項壓成一行（景點下拉 + 排序圖示），不再是一整排 chips');
  else fail('控制項沒有壓成一行：' + JSON.stringify(wall));
  if (wall.barHeight <= 60) ok(`控制列只佔 ${wall.barHeight}px（一行）`);
  else fail('控制列太高：' + wall.barHeight);
  if (wall.small === 0) ok('下拉與排序圖示的觸控區 ≥ 44px');
  else fail(`${wall.small} 顆太小`);
  if (wall.filterLabel === '全部照片') ok('預設顯示「全部照片」');
  else fail('預設篩選標籤不對：' + wall.filterLabel);

  await page.evaluate(() => document.querySelector('.wall-ctl-icon').click());
  await page.waitForSelector('.pick-row');
  await sleep(450);
  const sortMenu = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pick-row').length,
    current: document.querySelector('.pick-row.on')?.textContent || '',
    small: [...document.querySelectorAll('.pick-row')].filter((b) => b.getBoundingClientRect().height < 44).length,
    fits: (() => { const c = document.querySelector('.modal-card').getBoundingClientRect(); return c.top >= -1 && c.bottom <= window.innerHeight + 1; })(),
  }));
  if (sortMenu.rows === 4) ok('排序選單有 4 種（最新／最舊／照行程順序／照人分）');
  else fail('排序選項數不對：' + sortMenu.rows);
  if (/最新的在前/.test(sortMenu.current)) ok('預設是「最新的在前」');
  else fail('預設排序不對：' + sortMenu.current);
  if (sortMenu.small === 0 && sortMenu.fits) ok('排序選單的選項夠大、不會超出螢幕');
  else fail('排序選單有問題：' + JSON.stringify(sortMenu));
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === '取消').click());
  await sleep(300);

  await page.evaluate(() => document.querySelector('.wall-ctl').click());
  await page.waitForSelector('.pick-row');
  await sleep(450);
  const filterMenu = await page.evaluate(() => [...document.querySelectorAll('.pick-row')]
    .map((r) => `${r.querySelector('.pick-row-label').textContent}=${r.querySelector('.pick-row-tag')?.textContent || ''}`));
  if (filterMenu.some((t) => /羅東夜市=2/.test(t)) && filterMenu.some((t) => /幾米公園=1/.test(t))) {
    ok('景點下拉顯示每個景點的張數：' + filterMenu.join('、'));
  } else fail('景點張數不對：' + JSON.stringify(filterMenu));
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === '取消').click());
  await sleep(300);

  // 排序真的有效
  const order = async () => page.evaluate(() => [...document.querySelectorAll('.feed-item .fi-what')].map((e) => e.textContent).filter((t) => t.includes('任務')));
  const newest = await order();
  await page.evaluate(() => document.querySelector('.wall-ctl-icon').click());
  await page.waitForSelector('.pick-row');
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('.pick-row')].find((b) => b.textContent.includes('最舊的在前')).click());
  await page.waitForSelector('.feed-item');
  await sleep(1400);
  const oldest = await order();
  const reversed = newest.length > 1 && newest.length === oldest.length
    && newest.every((x, i) => x === oldest[oldest.length - 1 - i]);
  if (reversed) ok(`切換「最舊的在前」後順序真的顛倒（${newest.length} 張，第一張 ${newest[0]} → ${oldest[0]}）`);
  else fail(`排序沒作用：新→${JSON.stringify(newest)} 舊→${JSON.stringify(oldest)}`);

  // 篩選景點
  await page.evaluate(() => document.querySelector('.wall-ctl').click());
  await page.waitForSelector('.pick-row');
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('.pick-row')].find((b) => b.textContent.includes('羅東夜市')).click());
  await page.waitForSelector('.feed-item');
  await sleep(1400);
  const only = await page.evaluate(() => ({
    items: document.querySelectorAll('.feed-item').length,
    label: document.querySelector('.wall-bar-title')?.textContent || '',
  }));
  const total = newest.length;
  if (only.items === 2 && only.label.includes(`2／${total}`)) ok(`只看羅東夜市：剩 2 張，標題顯示「${only.label}」`);
  else fail(`景點篩選不對（全部應為 ${total} 張）：` + JSON.stringify(only));

  // 選擇要記住
  await go(`/#/trip/${setup.tid}/people`);
  await page.waitForSelector('.wall-bar');
  await sleep(1200);
  const remembered = await page.evaluate(() => ({
    items: document.querySelectorAll('.feed-item').length,
    label: document.querySelector('.wall-ctl-label')?.textContent || '',
    sortMarked: document.querySelector('.wall-ctl-icon')?.classList.contains('on'),
  }));
  if (remembered.items === 2 && /羅東夜市/.test(remembered.label) && remembered.sortMarked) {
    ok(`下次進來維持上次的排序與篩選（下拉「${remembered.label}」、排序圖示有標記）`);
  } else fail('沒記住：' + JSON.stringify(remembered));

  // 未標記篩選與既有提示並存
  await page.evaluate(() => document.querySelector('.wall-ctl').click());
  await page.waitForSelector('.pick-row');
  await sleep(400);
  const coexist = await page.evaluate(() => ({
    cta: !!document.querySelector('.untag-cta'),
    opt: [...document.querySelectorAll('.pick-row')].some((b) => /只看未標記/.test(b.textContent)),
  }));
  if (coexist.cta && coexist.opt) ok('「還有 N 張沒標記」的提示與下拉裡的「只看未標記」並存');
  else fail('未標記提示/篩選不對：' + JSON.stringify(coexist));

  await page.evaluate(() => [...document.querySelectorAll('.pick-row')].find((b) => /只看未標記/.test(b.textContent)).click());
  await page.waitForSelector('.wall-bar');
  await sleep(1400);
  const untag = await page.evaluate(() => ({
    items: document.querySelectorAll('.feed-item').length,
    dots: document.querySelectorAll('.untag-dot').length,
  }));
  if (untag.items > 0 && untag.items === untag.dots) ok(`「只看未標記」有效：${untag.items} 張，每張都有未標記角標`);
  else fail('未標記篩選不對：' + JSON.stringify(untag));

  // ================= 「現在這一站」要同步給整個群組 =================

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

  // 是誰改的仍然存在記錄裡（之後要用得到），但畫面上不顯示
  await B.goto('about:blank');
  await B.goto(`http://localhost:${WEB}/#/trip/${shared.tid}`, { waitUntil: 'networkidle0' });
  await B.waitForSelector('.nextstn');
  await sleep(600);
  const byLine = await B.evaluate(() => document.body.textContent.includes('把大家帶到這裡'));
  if (!byLine) ok('畫面上不再顯示「○○ 把大家帶到這裡」');
  else fail('還在顯示是誰改的');

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
