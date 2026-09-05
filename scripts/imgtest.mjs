// 任務示意圖：抓取、出處標示、離線、佔位（npm run imgtest）
//
// 舊做法其實一張都沒抓成功過：REST summary 的縮圖網址改尺寸會 400、回 HTML 錯誤頁，
// storeImage 只好丟掉，畫面就一片空白。這支測試把「真的抓到圖」變成會被擋下來的事。
// 涵蓋率的完整數字用 npm run imgcoverage（會打 300 多次 Wikimedia，比較慢）。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5205;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ok = (m) => console.log('✓ ' + m);
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 780 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

try {
  // ---------- 建一趟：一個查得到的景點、一個查不到的、一個美食任務 ----------
  const setup = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '圖片測試' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '京都三日遊', region: '京都', allowWiki: true, startDate: null });
    const good = uuid(), bad = uuid();
    await s.put({ id: good, type: 'spot', tripId: tid, name: '清水寺', nameLocal: '清水寺', emoji: '⛩️', day: 1, order: 0, lat: 34.9948, lng: 135.785, wikiRef: { lang: 'zh', title: '清水寺' }, tags: ['sight'], primary: 'sight' });
    // 使用者自己打的景點，維基不會有 —— 正是要驗「查不到圖時長怎樣」的真實情境
    await s.put({ id: bad, type: 'spot', tripId: tid, name: '民宿旁邊的小巷', nameLocal: '民宿旁邊的小巷', emoji: '🏘️', day: 1, order: 1, lat: null, lng: null, wikiRef: null, tags: [], primary: null });
    const qGood = uuid(), qFood = uuid(), qBad = uuid();
    await s.put({ id: qGood, type: 'quest', tripId: tid, spotId: good, title: '清水舞台', hint: '拍那個懸空的大平台，最好帶到下方交錯的木柱。', kind: 'building', order: 0 });
    await s.put({ id: qFood, type: 'quest', tripId: tid, spotId: good, title: '必吃：章魚燒', hint: '現買一盒剛起鍋、撒滿柴魚片的章魚燒。', kind: 'food', order: 1 });
    await s.put({ id: qBad, type: 'quest', tripId: tid, spotId: bad, title: '巷口那盞燈籠', hint: '傍晚亮起來的時候最好看。', kind: 'thing', order: 0 });
    return { tid, good, bad, qGood, qFood, qBad };
  });
  ok('建立測試行程（查得到的景點 / 查不到的景點 / 美食任務）');

  // ---------- 抓圖 ----------
  await page.evaluate(async (tid) => {
    const { enrichTrip } = await import('./js/enrich.js');
    await enrichTrip(tid);
  }, setup.tid);

  const got = await page.evaluate(async (s) => {
    const st = await import('./js/store.js');
    const db = await import('./js/db.js');
    const spot = st.getRaw(s.good), bad = st.getRaw(s.bad), food = st.getRaw(s.qFood);
    const blob = spot.heroHash ? await db.getBlob(spot.heroHash) : null;
    return {
      heroHash: !!spot.heroHash,
      heroSource: spot.heroSource,
      author: spot.heroAttr && spot.heroAttr.author,
      license: spot.heroAttr && spot.heroAttr.license,
      blurb: spot.blurb,
      blobBytes: blob ? blob.blob.size : 0,
      blobType: blob ? blob.blob.type : '',
      badHero: !!bad.heroHash,
      badNoHero: !!bad._noHero,
      foodRef: !!food.refHash,
      foodGeneric: !!food.refGeneric,
      foodAuthor: food.refAttr && food.refAttr.author,
    };
  }, setup);

  if (got.heroHash) ok(`景點抓到示意圖（來源 ${got.heroSource}）`);
  else fail('景點沒抓到示意圖');
  if (got.blobType.startsWith('image/') && got.blobBytes > 5000) ok(`圖真的存進 IndexedDB（${got.blobType}、${Math.round(got.blobBytes / 1024)}KB），離線也看得到`);
  else fail(`存進去的不是圖：${got.blobType} ${got.blobBytes}B`);
  if (got.author && got.license) ok(`有作者與授權可以標示（${got.author} · ${got.license}）`);
  else fail(`缺出處資訊：author=${got.author} license=${got.license}`);
  if (got.blurb) ok(`順便抓到介紹句：「${got.blurb.slice(0, 20)}…」`);
  else fail('沒抓到介紹句');

  if (got.foodRef && got.foodGeneric) ok('美食任務抓到該道菜的通用照片，並標記為示意圖');
  else fail(`美食任務沒圖：ref=${got.foodRef} generic=${got.foodGeneric}`);

  if (!got.badHero && got.badNoHero) ok('查不到的景點：標記為沒有圖（不會每次重打 API）');
  else fail(`查不到的景點狀態不對：hero=${got.badHero} noHero=${got.badNoHero}`);

  // ---------- 畫面呈現 ----------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qbig');
  await sleep(1200);

  const ui = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.qbig')].map((c) => {
      const ph = c.querySelector('.qbig-photo');
      return {
        title: c.querySelector('.qbig-title')?.textContent || '',
        bg: (ph?.style.backgroundImage || '').slice(0, 24),
        placeholder: ph?.classList.contains('is-placeholder'),
        credit: ph?.querySelector('.img-credit')?.textContent || '',
      };
    });
    return { cards, blank: cards.filter((c) => !c.bg).length };
  });

  if (ui.blank === 0) ok(`每一張任務卡都有圖或色塊，沒有一張是空白的（${ui.cards.length} 張）`);
  else fail(`還有 ${ui.blank} 張任務卡是空白的`);

  const wikiCard = ui.cards.find((c) => c.title.includes('清水舞台'));
  if (wikiCard && /CC|BY|Public|GFDL|授權|©/i.test(wikiCard.credit)) ok(`維基圖有標作者與授權：「${wikiCard.credit}」`);
  else fail('維基圖沒有標出處：' + JSON.stringify(wikiCard));

  const foodCard = ui.cards.find((c) => c.title.includes('章魚燒'));
  if (foodCard && foodCard.credit.startsWith('示意圖')) ok(`美食圖標明是示意圖：「${foodCard.credit}」`);
  else fail('美食圖沒標示意圖：' + JSON.stringify(foodCard));

  const phCard = ui.cards.find((c) => c.title.includes('燈籠'));
  if (phCard && phCard.placeholder && phCard.bg.includes('data:image/svg')) ok('查不到圖的任務：用主題色塊佔位，版面不空');
  else fail('沒有佔位圖：' + JSON.stringify(phCard));

  // ---------- 三種情況各拍一張（要轉給使用者看的）----------
  const OUT = path.join(ROOT, 'screenshots/features');
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => document.querySelectorAll('.daycollapse .dc-head').forEach((b) => {
    if (!b.closest('.daycollapse').classList.contains('open')) b.click();
  }));
  await sleep(400);

  const shotCard = async (match, file) => {
    const found = await page.evaluate((m) => {
      const card = [...document.querySelectorAll('.qbig')].find((c) => c.querySelector('.qbig-title')?.textContent.includes(m));
      if (!card) return false;
      const r = card.getBoundingClientRect();
      // 讓整張卡（含圖片下緣的授權小字）都在畫面內，頂列下方留一點空
      window.scrollBy(0, r.top - (document.getElementById('topbar').offsetHeight + 16));
      return true;
    }, match);
    if (!found) { fail('找不到卡片：' + match); return; }
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, file) });
  };

  await shotCard('清水舞台', 'v1.26-任務卡示意圖.png');
  await shotCard('章魚燒', 'v1.26-美食示意圖.png');
  await shotCard('燈籠', 'v1.26-查不到圖佔位.png');
  ok('截圖：v1.26-任務卡示意圖 / v1.26-美食示意圖 / v1.26-查不到圖佔位');

  // ---------- 不會每次開畫面都重抓 ----------
  const before = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /wikipedia|wikimedia/.test(r.name)).length);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qbig');
  await sleep(1500);
  const after = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /wikipedia|wikimedia/.test(r.name)).length);
  if (after === 0) ok('第二次進入完全不再打 Wikimedia（圖從本機快取讀）');
  else fail(`第二次進入還打了 ${after} 次 Wikimedia`);
  void before;

  // ---------- 連不到 Wikimedia 時圖還在（＝真的存本機，不是每次現抓）----------
  await page.setRequestInterception(true);
  const blocked = [];
  page.on('request', (r) => {
    if (/wikipedia\.org|wikimedia\.org/.test(r.url())) { blocked.push(r.url()); r.abort().catch(() => {}); }
    else r.continue().catch(() => {});
  });
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qbig');
  await sleep(1500);
  const offline = await page.evaluate(() => {
    const ph = [...document.querySelectorAll('.qbig-photo')];
    return { cards: ph.length, withBg: ph.filter((p) => p.style.backgroundImage).length };
  });
  await page.setRequestInterception(false);
  if (offline.cards > 0 && offline.withBg === offline.cards) ok(`完全連不到 Wikimedia 時，${offline.cards} 張卡片的圖照樣顯示（擋掉 ${blocked.length} 個請求）`);
  else fail(`連不到 Wikimedia 時圖不見了：${offline.withBg}/${offline.cards}`);

  // ================= 舊行程（v1.25 以前建立的）會不會自動補圖 =================
  const dev = async () => {
    const ctx = await browser.createBrowserContext();
    const pg = await ctx.newPage();
    await pg.setViewport({ width: 390, height: 780 });
    pg.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
    await pg.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.hero');
    return pg;
  };
  // v1.25 以前留下的樣子：_enriched 已經是 true（舊版標記處理過了），但其實沒有圖、
  // 也沒有 _enrichV。「金閣寺」故意用會撞到中文維基消歧義頁的名字。
  const seedOld = (pg, extra = {}) => pg.evaluate(async (ex) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '舊團' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '去年的京都', region: '京都', ...ex });
    for (const n of ['清水寺', '金閣寺']) {
      const sid = uuid();
      await s.put({
        id: sid, type: 'spot', tripId: tid, name: n, nameLocal: n, emoji: '⛩️', day: 1, order: 0,
        lat: null, lng: null, wikiRef: { lang: 'zh', title: n }, _enriched: true,
      });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: n + '的主建築', kind: 'building', order: 0 });
    }
    return tid;
  }, extra);
  const openTrip = async (pg, tid, ms = 12000) => {
    await pg.goto('about:blank');
    await pg.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('.qbig');
    await sleep(ms);
  };
  const spotState = (pg, tid) => pg.evaluate(async (t) => {
    const s = await import('./js/store.js');
    return s.spotsOf(t).map((x) => ({ n: x.name, hero: !!x.heroHash, v: x._enrichV || 0, noHero: !!x._noHero, blurb: x.blurb || '' }));
  }, tid);

  const O = await dev();
  const oldTid = await seedOld(O);                       // 沒有 allowWiki 欄位 —— 舊行程可能就是這樣
  await openTrip(O, oldTid);
  const oldAfter = await spotState(O, oldTid);
  if (oldAfter.every((x) => x.hero)) ok(`舊行程再次打開會自動補圖，使用者不用做任何設定（${oldAfter.map((x) => x.n).join('、')}）`);
  else fail('舊行程沒有自動補圖：' + JSON.stringify(oldAfter));

  const kin = oldAfter.find((x) => x.n === '金閣寺');
  if (kin && kin.hero) ok('撞到消歧義頁的名字（金閣寺 → 鹿苑寺）也追得到圖');
  else fail('消歧義沒處理：' + JSON.stringify(kin));
  if (kin && !/可以指|may refer/.test(kin.blurb)) ok('消歧義頁那句「金閣寺可以指：」沒有被拿去當景點介紹');
  else fail('介紹句被消歧義污染：' + JSON.stringify(kin && kin.blurb));
  // 中文維基搜「金閣寺」第一名是三島由紀夫的同名小說 —— 景點要的是地方，不是書
  if (kin && !/小說|小说|novel|電影|映画/.test(kin.blurb)) ok(`消歧義追到的是「地方」不是同名的小說／電影：「${kin.blurb.slice(0, 16)}…」`);
  else fail('追錯條目（拿到同名作品）：' + JSON.stringify(kin && kin.blurb));

  // ---------- 連不到 Wikimedia 時，不可以把景點永久標成「沒有圖」 ----------
  const N = await dev();
  const netTid = await seedOld(N);
  await N.setRequestInterception(true);
  const onReq = (r) => {
    if (/wikipedia\.org|wikimedia\.org/.test(r.url())) r.abort().catch(() => {});
    else r.continue().catch(() => {});
  };
  N.on('request', onReq);
  await openTrip(N, netTid, 8000);
  const cut = await spotState(N, netTid);
  if (cut.every((x) => !x.hero && x.v === 0 && !x.noHero)) ok('連不到 Wikimedia 時：不留任何標記，之後才有機會重補');
  else fail('斷網時被錯誤標記了：' + JSON.stringify(cut));
  const cutUI = await N.evaluate(() => {
    const ph = [...document.querySelectorAll('.qbig-photo')];
    return { cards: ph.length, withBg: ph.filter((p) => p.style.backgroundImage).length };
  });
  if (cutUI.cards > 0 && cutUI.withBg === cutUI.cards) ok('斷網時畫面仍然完整（先用主題色塊佔位）');
  else fail(`斷網時有空白卡片：${cutUI.withBg}/${cutUI.cards}`);

  // 網路恢復 → 重開行程頁就補回來
  N.off('request', onReq);
  await N.setRequestInterception(false);
  await openTrip(N, netTid);
  const healed = await spotState(N, netTid);
  if (healed.every((x) => x.hero)) ok('網路恢復後再打開行程頁：圖自動補上');
  else fail('網路恢復後沒補上：' + JSON.stringify(healed));

  // ---------- 抓過就不再重抓 ----------
  const again = await N.evaluate(() => performance.getEntriesByType('resource').filter((r) => /wikipedia|wikimedia/.test(r.name)).length);
  await openTrip(N, netTid, 4000);
  const again2 = await N.evaluate(() => performance.getEntriesByType('resource').filter((r) => /wikipedia|wikimedia/.test(r.name)).length);
  if (again2 === 0) ok('補完之後再進去完全不再打 Wikimedia');
  else fail(`補完還重打了 ${again2} 次`);
  void again;

  // ---------- 關掉「景點示意圖」開關就不抓 ----------
  const F2 = await dev();
  const offTid = await seedOld(F2, { allowWiki: false });
  await F2.setRequestInterception(true);
  let wikiCalls = 0;
  F2.on('request', (r) => {
    if (/wikipedia\.org|wikimedia\.org/.test(r.url())) wikiCalls++;
    r.continue().catch(() => {});
  });
  await openTrip(F2, offTid, 6000);
  if (wikiCalls === 0) ok('行程設定關掉「景點示意圖」就完全不對外連線');
  else fail(`關掉了還打了 ${wikiCalls} 次`);

  console.log('\n示意圖測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
