// 照名字猜的主題不上畫面、也不進送給 AI 的請求（npm run guesstruthtest；2026-10-27，待驗清單 H2、H3）。
//
// postertruthtest 只驗到組 prompt 的純函式。這支從使用者真的會走的入口驗：有綁金鑰的行程，**打開行程頁**
// （trip.js 進頁就在背景 warmTripContent），在網路層攔下每一個送往 api.anthropic.com 的請求、讀它的 body，
// 回假的回應——什麼都沒真的送出去，金鑰是合成的。組 prompt 的函式乾淨，不代表送出去的 body 乾淨（中間還有別的層）。
// 同一次打開，也讀行程頁每個景點標題列上看得到的字。
//
// 怎麼判 body：同一份 body 裡本來就有固定的提示詞範本（例句裡就有「溫泉」），不能直接要求「類別名 0 次」。
// 所以拿一趟名字猜不出任何類別的行程當基準，比每個類別名在 body 裡出現幾次：
//   H2-0 前置：三趟都真的攔到「行程表海報」那個請求（母體非空）；猜得出的那幾個名字，照名字猜真的會猜成具體類別（資料有能力讓測試紅）
//   H2-1 從分享連結匯入的行程（景點都不帶 theme、名字以山／寺／海結尾）：每個類別名出現的次數＝基準——猜出來的類別沒進 body
//   （2026-10-27 同一天改：帶著的 theme 也是猜的，判準改成可信類別 trustedTheme；匯入那趟另兩站改成存著猜的 theme 的舊景點）
//   H2-2 反向：第 1 天第一站換成景點庫裡真的梧棲漁港（存著猜的 coast、景點庫是 food）：「美食」比基準多、「海濱」＝基準
//        ——證明讀得到 body、帶著的主題照樣送（只驗 H2-1 的話，「什麼主題都不送」也會過）
//   H3-1 匯入的那趟：行程頁三個景點標題列上看得到的字裡，沒有任何類別名（以前印「🌿 山林自然」之類）
//   H3-2 反向：可信的那一站，標題列看得到景點庫的「美食」
//   H4（v1.92.0 景點類型圖示，js/placeicon.js）：匯入那趟三站都沒有圖示（名字猜得出類別也不給）；可信的梧棲漁港有 food 的圖示、
//      而且圖真的載入了（naturalWidth > 0，檔案路徑寫錯或沒部署會抓到）——任務頁、行程分頁（點底部分頁進去、在那一頁重新整理）、
//      建立行程搜景點的卡片，三個畫面各讀一次
//   H5（v1.94.0，Dispatch 2026-11-16 三件＋2026-11-17 定丙）：存著照名字配的符號（🌊、🛕、🏯）畫面上一律從景點庫重算——
//      已選小標籤、主頁下一站卡與今天接下來、換一站、調整行程、照片牆篩選、回顧影片地圖標籤；對得回的那一站同時驗有景點庫的圖或符號
//      （只驗「存著的不見了」的話，景點庫沒載好、一律 📍 也會過）。每個畫面先重新整理再從真入口打開。任務頁打卡那站不顯示主題小標。
//      每一頁都沒有印出「[object」。H4-1、H4-3 的乙寺、丙海也改成存著猜的符號。
// 突變見 tools/mutations/mut_guesstruth.json、mut_v192.json、mut_v194.json。

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5771, BASE = `http://localhost:${WEB}`;
const KEY = 'sk-ant-api03-' + 'S'.repeat(80);     // 合成的，從沒存在過
const THEMES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/themes.json'), 'utf8')).themes;
const LABELS = Object.entries(THEMES).map(([k, v]) => [k, v.label]);

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 600) : '')); process.exitCode = 1; }
};
const count = (text, s) => text.split(s).length - 1;

const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1200);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const sent = [];        // 攔到的每一個送往 Anthropic 的請求 body（原樣字串）

try {
  const page = await (await browser.createBrowserContext()).newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('api.anthropic.com')) {
      const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
      const raw = req.postData() || '';
      sent.push(raw);
      let sys = '';
      try { sys = JSON.parse(raw).system || ''; } catch {}
      const text = /行程表海報/.test(sys)
        ? JSON.stringify({ subtitle: '副標', dayLines: { 1: '一' }, videoIntro: '頭', videoOutro: '尾', narration: { 1: '一' } })
        : '[]';
      return req.respond({ status: 200, headers: CORS, contentType: 'application/json',
        body: JSON.stringify({ content: [{ text }], usage: { input_tokens: 10, output_tokens: 10 } }) });
    }
    if (/wikipedia|wikimedia|open-meteo|nominatim|overpass/.test(u)) return req.respond({ status: 404, body: '' });
    if (u.includes('workers.dev')) return req.abort('failed');       // 不准打正式 Worker
    return req.continue();
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(async () => { (await import('./js/sync.js')).setConfig({ mode: 'local', url: '' }); });

  // 造一趟有綁金鑰的行程，景點照傳入的樣子（不帶 theme＝從分享連結匯入的樣子），然後**打開行程頁**
  const visit = async (label, spots) => {
    const tid = await page.evaluate(async (o) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const { myDeviceId } = await import('./js/identity.js');
      const k = await import('./js/aikeys.js');
      const gid = uuid(), tid = uuid();
      await s.put({ id: gid, type: 'group', name: 'g' });
      await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '甲' });
      await s.put({ id: tid, type: 'trip', groupId: gid, title: o.label, region: '某地',
        startDate: '2026-04-01', endDate: '2026-04-03', aiEnabled: true, createdByDevice: myDeviceId() });
      for (const sp of o.spots) await s.put({ id: uuid(), type: 'spot', tripId: tid, emoji: '📍', lat: 24.8, lng: 121.7, ...sp });
      await k.setTripKey(tid, { key: o.key });
      return tid;
    }, { label, spots, key: KEY });
    sent.length = 0;
    await page.evaluate((tid) => { location.hash = '#/trip/' + tid; }, tid);
    // 等「行程表海報」那個請求出現，再多等一下讓同一輪的其他請求（景點介紹）也進來
    for (let i = 0; i < 50 && !sent.some((b) => /行程表海報/.test(b)); i++) await sleep(200);
    await sleep(1500);
    // 標題列上看得到的字（行程頁一次只顯示一天，三天的景點卡都在 DOM 裡、只是被隱藏——這裡讀的是字本身，看不看得到由 itinviewtest 管）
    const heads = await page.evaluate((names) => names.map((n) => {
      const sec = [...document.querySelectorAll('.qcollapse')].find((x) => (x.querySelector('.qc-name')?.textContent || '').startsWith(n));
      return sec ? sec.querySelector('.qc-name').textContent : null;
    }), spots.map((s) => s.name));
    // v1.92.0 標題列最前面那一格（類型圖示或原本的表情符號）
    const icons = await iconCells('.qcollapse', '.qc-name', '.qc-emoji', spots.map((s) => s.name));
    return { body: sent.join('\n'), heads, icons, tid };
  };
  // 每一站那一格：有沒有 <img>、src、真的載入了沒（等到 complete，最多 6 秒）、那一格的字
  const iconCells = async (cardSel, nameSel, cellSel, names) => {
    for (let i = 0; i < 30; i++) {
      const pending = await page.evaluate((sel) => [...document.querySelectorAll(sel + ' img.place-icon')].some((im) => !im.complete), cardSel);
      if (!pending) break;
      await sleep(200);
    }
    return page.evaluate((cardSel, nameSel, cellSel, names) => names.map((n) => {
      const card = [...document.querySelectorAll(cardSel)].find((x) => {
        const nm = nameSel ? x.querySelector(nameSel) : x;
        return (nm?.textContent || '').trim().replace(/^\S+\s/, '').startsWith(n) || (nm?.textContent || '').trim().startsWith(n);
      });
      if (!card) return null;
      const cell = cellSel ? card.querySelector(cellSel) : card;
      const img = cell && cell.querySelector('img.place-icon');
      return { img: img ? img.getAttribute('src') : null, loaded: !!img && img.complete && img.naturalWidth > 0, text: (cell?.textContent || '').trim(), all: card.textContent.trim() };
    }), cardSel, nameSel, cellSel, names);
  };

  const BASELINE = [
    { name: '甲', day: 1, order: 0, source: 'shared' },
    { name: '乙', day: 2, order: 0, source: 'shared' },
    { name: '丙', day: 3, order: 0, source: 'shared' },
  ];
  // 甲山：分享匯入（不帶 theme）；乙寺、丙海：v1.74 以前建的舊景點，存著當時照名字猜的 theme（帶著的也不可信，2026-10-27）
  // v1.94.0：乙寺、丙海也存著當時照名字配的符號（🛕、🌊）——畫面上要重算成 📍（H4-1、H4-3 讀到的是重算的）
  const GUESSABLE = [
    { name: '甲山', day: 1, order: 0, source: 'shared' },
    { name: '乙寺', day: 2, order: 0, source: 'auto', theme: 'heritage', emoji: '🛕' },
    { name: '丙海', day: 3, order: 0, source: 'auto', theme: 'coast', emoji: '🌊' },
  ];
  // 可信的那一站用景點庫裡真的「梧棲漁港」（tc-wuqi）：景點庫是 food；存著的是照名字猜的 coast 與 🌊
  const CARRIED = [{ name: '梧棲漁港', region: '台中市', day: 1, order: 0, source: 'curated', placeId: 'tc-wuqi', theme: 'coast', emoji: '🌊' }, GUESSABLE[1], GUESSABLE[2]];

  // 前置：資料有能力讓測試紅——照名字猜，猜得出的三個是具體類別，基準的三個猜不出
  const guess = await page.evaluate(async (names) => {
    const t = await import('./js/theme.js');
    await t.loadThemes();
    return names.map((n) => t.themeForSpot({ name: n }));
  }, ['甲山', '乙寺', '丙海', '梧棲漁港', '甲', '乙', '丙']);
  yes(guess.slice(0, 4).join(',') === 'nature,heritage,coast,coast' && guess.slice(4).every((g) => g === 'journey'),
    `H2-0 前置：照名字猜，甲山／乙寺／丙海／梧棲漁港會被猜成具體類別（梧棲漁港猜 coast、景點庫是 food）、甲／乙／丙猜不出（實得 ${guess.join(',')}）`);

  const base = await visit('基準', BASELINE);
  const guessed = await visit('匯入', GUESSABLE);
  const carried = await visit('帶著', CARRIED);
  const hit = (v) => /行程表海報/.test(v.body);
  yes(hit(base) && hit(guessed) && hit(carried),
    `H2-0 前置：三趟打開行程頁都攔到「行程表海報」那個請求（body ${base.body.length}／${guessed.body.length}／${carried.body.length} 字）`);

  const diff = (v) => LABELS.filter(([, l]) => count(v.body, l) !== count(base.body, l)).map(([k, l]) => `${l}（${k}）基準 ${count(base.body, l)} 次、這趟 ${count(v.body, l)} 次`);
  const d1 = diff(guessed);
  yes(hit(guessed) && d1.length === 0,
    `H2-1 匯入的行程（不帶 theme）：送出去的 body 裡 ${LABELS.length} 個類別名的次數都＝基準`, d1.join('；'));

  const food = THEMES.food.label, coast = THEMES.coast.label;
  yes(hit(carried) && count(carried.body, food) > count(base.body, food) && count(carried.body, coast) === count(base.body, coast),
    `H2-2 反向：第 1 天第一站是可信的梧棲漁港 → 「${food}」比基準多（${count(base.body, food)} → ${count(carried.body, food)}）、存著的「${coast}」＝基準（${count(base.body, coast)} → ${count(carried.body, coast)}）`);

  const labelsIn = (t) => LABELS.filter(([, l]) => (t || '').includes(l)).map(([, l]) => l);
  yes(guessed.heads.every((t) => t !== null) && guessed.heads.every((t) => labelsIn(t).length === 0),
    `H3-1 匯入的行程：三個景點標題列都找到了，字裡沒有任何類別名（實得 ${guessed.heads.map((t) => t === null ? '找不到' : `「${t}」`).join('、')}）`);
  yes(carried.heads[0] !== null && labelsIn(carried.heads[0]).join(',') === food,
    `H3-2 反向：可信的「梧棲漁港」標題列看得到景點庫的「${food}」、不是存著的「${coast}」（實得「${carried.heads[0]}」）`);

  // ---------- H4 景點類型圖示（v1.92.0；js/placeicon.js）：只給對得回景點庫的那一站，從使用者會走的三個畫面讀 ----------
  const FOOD_IMG = './media/art/a/food.png';
  const noImg = (c) => !!c && c.img === null;
  const foodOk = (c) => !!c && c.img === FOOD_IMG && c.loaded;
  const show4 = (cs) => JSON.stringify(cs);
  yes(guessed.icons.every((c) => c !== null) && guessed.icons.every((c) => noImg(c) && c.text === '📍'),
    `H4-1 匯入的行程（甲山／乙寺／丙海，名字猜得出類別）：任務頁三站都沒有類型圖示，那一格是「📍」——乙寺、丙海存著的 🛕、🌊 不露出來（v1.94.0）`, show4(guessed.icons));
  yes(foodOk(carried.icons[0]) && noImg(carried.icons[1]) && noImg(carried.icons[2]),
    `H4-2 反向：可信的「梧棲漁港」任務頁那一格是景點庫 food 的圖示、真的載入了；同一趟另兩站沒有`, show4(carried.icons));

  // 行程分頁：點底部「行程」→ 切到「行程」那一格（結束日已過，預設落在回顧）
  await page.click(`#tabbar a.tab[href="#/trip/${carried.tid}/itinerary"]`);
  await page.waitForSelector('.itin-seg button[data-tab="plan"]', { timeout: 8000 });
  await page.click('.itin-seg button[data-tab="plan"]');
  await page.waitForSelector('#itin-pane-plan .itin-stop', { timeout: 8000 });
  const ITIN = ['#itin-pane-plan .itin-stop', null, null];
  const it1 = await iconCells(...ITIN, ['梧棲漁港', '乙寺', '丙海']);
  yes(foodOk(it1[0]) && noImg(it1[1]) && noImg(it1[2]) && it1[1].all.startsWith('📍 乙寺') && it1[2].all.startsWith('📍 丙海'),
    `H4-3 行程分頁（從底部「行程」點進去）：梧棲漁港站卡有 food 圖示、真的載入了；乙寺、丙海站卡是「📍 名字」（存著的 🛕、🌊 不露出來）`, show4(it1));
  // 在行程分頁重新整理：模組重新載入，景點庫要由行程分頁自己載（任務頁沒先跑過）
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#itin-pane-plan .itin-stop', { timeout: 8000 });
  const it2 = await iconCells(...ITIN, ['梧棲漁港', '乙寺', '丙海']);
  yes(foodOk(it2[0]) && noImg(it2[1]) && noImg(it2[2]),
    `H4-4 在行程分頁重新整理（景點庫由行程分頁自己載）：梧棲漁港站卡照樣有 food 圖示、另兩站沒有`, show4(it2));

  // 建立行程選景點：搜「梧棲」→ 景點庫那一筆的卡片
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForSelector('input[type="search"]', { timeout: 8000 });
  await page.type('input[type="search"]', '梧棲');
  await page.waitForFunction(() => [...document.querySelectorAll('.place-card .pc-name')].some((x) => x.textContent.startsWith('梧棲漁港')), { timeout: 8000 });
  const pk = await iconCells('.place-card', '.pc-name', '.pc-emoji', ['梧棲漁港']);
  yes(foodOk(pk[0]), `H4-5 建立行程搜「梧棲」：梧棲漁港那張卡是景點庫 food 的圖示、真的載入了`, show4(pk));

  // ---------- H5（v1.94.0）：舊行程存著照名字配的符號——畫面上一律從景點庫重算（js/placeicon.js 的 spotMark／placeEmojiForSpot） ----------
  // Dispatch 2026-11-16「顯示時重算（甲）、不改寫存著的資料」＋「打卡改成中性、不顯示主題小標」＋「景點類型圖示接到其餘畫面」。
  // 每一站存著的符號都故意寫成別的（梧棲漁港 🌊、乙寺 🛕、打卡那站 🏯）：對得回景點庫的 → 景點庫的圖示（圖載不到時退回景點庫的符號）；
  // 對不回的 → 📍；存著的一個都不准露出來。每個畫面都從使用者會走的入口進去、先重新整理——景點庫要由那一頁自己載
  // （只驗「存著的不見了」的話，景點庫沒載好、一律 📍 也會過，所以每個畫面同時驗對得回的那一站有景點庫的圖或符號）。
  const CHECKIN_IMG = './media/art/a/checkin.png';
  const objText = [];      // 每一頁有沒有印出「[object」（spotMark 回傳的是節點，誤放進樣板字串就會這樣）
  const noObj = async (label) => { if (await page.evaluate(() => document.body.textContent.includes('[object'))) objText.push(label); };
  // H5-1 已選小標籤：在上面搜到的梧棲漁港那張卡點一下
  await page.evaluate(() => { [...document.querySelectorAll('.place-card')].find((c) => (c.querySelector('.pc-name')?.textContent || '').startsWith('梧棲漁港'))?.click(); });
  await page.waitForSelector('.pb-chips .chip', { timeout: 8000 });
  const chip = await iconCells('.pb-chips .chip', null, null, ['梧棲漁港']);
  await noObj('建立行程');
  yes(foodOk(chip[0]), `H5-1 建立行程「已選」小標籤：梧棲漁港有景點庫 food 的圖示、真的載入了`, show4(chip));

  // 一趟進行中的行程（今天是第 1 天），三站都在今天；乙寺、打卡那站各拍一張（沒拍完），梧棲漁港沒拍 → 下一站是梧棲漁港
  const today = await page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  const h5 = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const L = await (await import('./js/quests/generate.js')).loadPlaceLookup();
    const g = L.placeById('kyoto-gion'), w = L.placeById('tc-wuqi');
    const gid = uuid(), tid = uuid(), mA = uuid();
    await s.put({ id: gid, type: 'group', name: 'g5' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '甲' });
    const end = new Date(o.today + 'T12:00:00'); end.setDate(end.getDate() + 2);
    const p2 = (n) => String(n).padStart(2, '0');
    await s.put({ id: tid, type: 'trip', groupId: gid, title: 'H5', region: '某地', allowWiki: false,
      startDate: o.today, endDate: `${end.getFullYear()}-${p2(end.getMonth() + 1)}-${p2(end.getDate())}` });
    const defs = [
      { name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi', emoji: '🌊', theme: 'coast' },
      { name: '乙寺', region: '某地', source: 'auto', emoji: '🛕', theme: 'heritage' },
      { name: g.name, region: g.cityName, source: 'curated', placeId: g.id, emoji: '🏯', theme: 'urban' },
    ];
    const mk = (hue) => { const c = document.createElement('canvas'); c.width = 200; c.height = 150; const x = c.getContext('2d'); x.fillStyle = `hsl(${hue},60%,50%)`; x.fillRect(0, 0, 200, 150); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    for (let i = 0; i < defs.length; i++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, day: 1, order: i, lat: 24.2 + i * 0.05, lng: 120.5 + i * 0.05, ...defs[i] });
      const qs = [];
      for (let k = 0; k < 2; k++) { const qid = uuid(); qs.push(qid); await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `任務${i}-${k}`, kind: 'thing', order: k }); }
      if (i > 0) await importPhoto(new File([await mk(40 * i)], 'p.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: qs[0], memberId: mA, allowGeo: false });
    }
    return { tid, gion: { name: g.name, emoji: g.emoji }, wuqiEmoji: w.emoji };
  }, { today });
  const GN = h5.gion.name;
  const okEmo = (e) => typeof e === 'string' && e !== '' && e !== '📍' && e !== '🌊' && e !== '🛕' && e !== '🏯';
  yes(okEmo(h5.gion.emoji) && okEmo(h5.wuqiEmoji), `H5-0 前置：景點庫的符號（梧棲漁港 ${h5.wuqiEmoji}、打卡那站 ${h5.gion.emoji}）跟存著的 🌊／🏯、中性的 📍 都不一樣——分得出畫面用的是哪一個`);
  const cold = async (hash, sel) => {
    await page.evaluate((x) => { location.hash = x; }, hash);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector(sel, { timeout: 8000 });
  };
  const chkOk = (c) => !!c && c.img === CHECKIN_IMG && c.loaded;
  const plain = (c, name) => noImg(c) && c.text.startsWith('📍') && c.all.includes(name);
  const leak = (cs) => cs.some((c) => c && /[🌊🛕🏯]/u.test(c.all));

  // H5-2、H5-3 主頁（重新整理直接打開主頁：景點庫由主頁自己載）
  await cold(`#/trip/${h5.tid}/home`, '.today-card .nextstn-name');
  const nx = await iconCells('.today-card .nextstn-name', null, null, ['梧棲漁港']);
  const tn = await iconCells('.tn-item .tn-name', null, null, ['乙寺', GN]);
  await noObj('主頁');
  yes(foodOk(nx[0]) && !leak(nx), `H5-2 主頁下一站卡（重新整理後直接打開主頁）：梧棲漁港是景點庫 food 的圖示、真的載入了，存著的 🌊 沒露出來`, show4(nx));
  yes(plain(tn[0], '乙寺') && chkOk(tn[1]) && !leak(tn), `H5-3 主頁「今天接下來」：乙寺是「📍」（存著的 🛕 沒露出來）、打卡那站是景點庫 checkin 的圖示（存著的 🏯 沒露出來）`, show4(tn));

  // H5-4 換一站（主頁的「換一站」）
  await page.click('.nextstn-switch');
  await page.waitForSelector('.here-pick', { timeout: 8000 });
  const hp = await iconCells('.here-pick', '.here-pick-name', '.here-pick-emoji', ['梧棲漁港', '乙寺', GN]);
  await noObj('換一站');
  yes(foodOk(hp[0]) && plain(hp[1], '乙寺') && chkOk(hp[2]) && !leak(hp), `H5-4 換一站：梧棲漁港 food 圖示、乙寺「📍」、打卡那站 checkin 圖示；存著的都沒露出來`, show4(hp));
  await page.keyboard.press('Escape');

  // H5-5 調整行程（重新整理直接打開）
  await cold(`#/trip/${h5.tid}/plan`, '.plan-row .plan-name');
  const pl = await iconCells('.plan-row', '.plan-name', '.plan-name', ['梧棲漁港', '乙寺', GN]);
  await noObj('調整行程');
  yes(foodOk(pl[0]) && plain(pl[1], '乙寺') && chkOk(pl[2]) && !leak(pl), `H5-5 調整行程：梧棲漁港 food 圖示、乙寺「📍 乙寺」、打卡那站 checkin 圖示；存著的都沒露出來`, show4(pl));

  // H5-6 照片牆「要看哪些照片？」（下拉放不了圖，只有符號；只列有照片的乙寺、打卡那站）
  await cold(`#/trip/${h5.tid}/people`, '.wall-ctl');
  await page.evaluate(() => { [...document.querySelectorAll('.wall-ctl')].find((b) => (b.querySelector('.wall-ctl-label')?.textContent || '') === '全部照片')?.click(); });
  await page.waitForSelector('.pick-row-label', { timeout: 8000 });
  const pr = await page.evaluate(() => [...document.querySelectorAll('.pick-row-label')].map((x) => x.textContent));
  await noObj('照片牆篩選');
  yes(pr.includes('📍 乙寺') && pr.includes(`${h5.gion.emoji} ${GN}`) && !pr.some((t) => /[🌊🛕🏯]/u.test(t)),
    `H5-6 照片牆篩選：乙寺是「📍 乙寺」、打卡那站是景點庫的符號「${h5.gion.emoji}」；存著的都沒露出來（實得 ${JSON.stringify(pr)}）`);
  await page.keyboard.press('Escape');

  // H5-7 任務頁：打卡那站不顯示主題小標（打卡改成中性）；梧棲漁港照樣是景點庫的「美食」（不是一律不印）
  await cold(`#/trip/${h5.tid}`, '.qcollapse .qc-name');
  const th7 = await page.evaluate((names) => names.map((n) => {
    const sec = [...document.querySelectorAll('.qcollapse')].find((x) => (x.querySelector('.qc-name')?.textContent || '').startsWith(n));
    return sec ? (sec.querySelector('.qc-theme')?.textContent ?? '') : null;
  }), ['梧棲漁港', GN]);
  await noObj('任務頁');
  yes(th7[0] !== null && th7[0].includes(food) && th7[1] === '',
    `H5-7 任務頁主題小標：梧棲漁港有「${food}」、打卡那站沒有小標（不是「${THEMES.urban.label}」；實得 ${JSON.stringify(th7)}）`);

  // H5-8 回顧影片的地圖標籤（相簿頁算影片用的同一支 buildTimeline；重新整理後呼叫，景點庫由它自己載）
  await page.reload({ waitUntil: 'networkidle0' });
  const labels = await page.evaluate(async (tid) => {
    const m = await import('./js/memory.js');
    const tl = await m.buildTimeline(tid);
    const seg = tl.segs.find((x) => x.kind === 'map');
    return seg ? seg._layout.overview.labels.map((l) => l.text) : null;
  }, h5.tid);
  yes(!!labels && labels.includes(`${h5.wuqiEmoji}梧棲漁港`) && labels.includes('乙寺') && labels.includes(`${h5.gion.emoji}${GN}`) && !labels.some((t) => /[🌊🛕🏯]/u.test(t)),
    `H5-8 回顧影片的地圖標籤：對得回的兩站是景點庫的符號、乙寺不放符號；存著的都沒露出來（實得 ${JSON.stringify(labels)}）`);

  yes(objText.length === 0, `H5-9 上面每一頁都沒有印出「[object」（spotMark 回傳節點，誤放進樣板字串會印成這樣；有的：${objText.join('、') || '無'}）`);
} catch (e) {
  yes(false, '例外：' + ((e && e.stack) || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
