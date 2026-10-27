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
// 突變見 tools/mutations/mut_guesstruth.json。

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
    return { body: sent.join('\n'), heads };
  };

  const BASELINE = [
    { name: '甲', day: 1, order: 0, source: 'shared' },
    { name: '乙', day: 2, order: 0, source: 'shared' },
    { name: '丙', day: 3, order: 0, source: 'shared' },
  ];
  // 甲山：分享匯入（不帶 theme）；乙寺、丙海：v1.74 以前建的舊景點，存著當時照名字猜的 theme（帶著的也不可信，2026-10-27）
  const GUESSABLE = [
    { name: '甲山', day: 1, order: 0, source: 'shared' },
    { name: '乙寺', day: 2, order: 0, source: 'auto', theme: 'heritage' },
    { name: '丙海', day: 3, order: 0, source: 'auto', theme: 'coast' },
  ];
  // 可信的那一站用景點庫裡真的「梧棲漁港」（tc-wuqi）：景點庫是 food；存著的是照名字猜的 coast
  const CARRIED = [{ name: '梧棲漁港', region: '台中市', day: 1, order: 0, source: 'curated', placeId: 'tc-wuqi', theme: 'coast' }, GUESSABLE[1], GUESSABLE[2]];

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
} catch (e) {
  yes(false, '例外：' + ((e && e.stack) || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
