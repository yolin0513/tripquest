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

  console.log('\n示意圖測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
