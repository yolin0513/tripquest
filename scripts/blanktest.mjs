// 「沒把握就留白」的畫面測試（npm run blanktest）。
//
// curatedtest 驗的是產生器：沒對上策展資料庫就不出題。這一支驗**使用者那一半**：
// 沒有任務的地點在行程頁上看得到什麼、按得到什麼，以及「帶我去下一站」會不會卡住。
//
// 為什麼要有這支：留白之後，「沒有任務的地點」從例外變成常態（餐廳、民宿、店家）。
// 如果它在畫面上只剩一行名字，那就不是留白，是把地點藏起來 —— 照片沒地方放、
// 任務也沒地方加（舊版要走五步：行程頁 →「調整每天的行程」→ 展開 →「✏️ 任務」→「＋ 新增任務」）。

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const WEB = 5219;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const web = spawn('python', ['-m', 'http.server', String(WEB)], { stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

// 一張真的 1×1 PNG，用來走完整的上傳流程
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dir = mkdtempSync(join(tmpdir(), 'tq-blank-'));
const photoPath = join(dir, 'p.png');
writeFileSync(photoPath, PNG);

// 卡片狀態：名字 → { quests, hasAdd, hasCam, hasLib, open }
const cards = () => page.evaluate(() => [...document.querySelectorAll('.qcollapse')].map((sec) => ({
  name: sec.querySelector('.qc-name')?.firstChild?.textContent?.trim(),
  quests: sec.querySelectorAll('.qline').length,
  open: sec.classList.contains('open'),
  addBtn: [...sec.querySelectorAll('.qline-add button')].map((b) => b.textContent.trim()),
  addVisible: (() => { const a = sec.querySelector('.qline-add'); return !!a && a.getBoundingClientRect().height > 20; })(),
})));

const clickIn = async (spotName, label) => page.evaluate((n, l) => {
  const sec = [...document.querySelectorAll('.qcollapse')].find((s) => s.querySelector('.qc-name')?.textContent.includes(n));
  const b = [...sec.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
  if (!b) return false;
  b.click();
  return true;
}, spotName, label);

const modalType = async (value, btn) => {
  await page.waitForSelector('#modalRoot input, #modalRoot textarea', { timeout: 4000 });
  await page.evaluate((v, b) => {
    const el = document.querySelector('#modalRoot textarea, #modalRoot input');
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#modalRoot button')].find((x) => x.textContent.trim() === b).click();
  }, value, btn);
  await sleep(300);
};

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- 資料：一個策展景點 ＋ 兩個對不上的店家 ----------
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const g = uuid(), tid = uuid(), m1 = uuid();
    await s.put({ id: g, type: 'group', name: 'g' });
    await s.put({ id: m1, type: 'member', groupId: g, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: g, title: '宜蘭家族旅行', region: '宜蘭', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, region: '宜蘭', items: [
      { name: '白雲山鹿', day: 1 },            // Yolin 的案例：早餐店，名字裡有「山」
      { name: '羅東夜市', day: 1 },            // 策展命中
      { name: '好樂迪KTV 中山店', day: 1 },
    ] });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    // 舊旅程（R8）：v1.74 之前建的，帶著猜出來的 template 任務 —— 一筆都不准動
    const oldTid = uuid(), oldSpot = uuid();
    await s.put({ id: oldTid, type: 'trip', groupId: g, title: '去年的旅程', region: '宜蘭', allowWiki: false });
    await s.put({ id: oldSpot, type: 'spot', tripId: oldTid, name: '白雲山鹿', day: 1, order: 0, source: 'auto', theme: 'nature', emoji: '⛰️', blurb: '山裡的清新空氣。' });
    for (const [i, t] of ['拍下 白雲山鹿 最開闊的一景', '一條路的盡頭', '光影最好的一刻'].entries()) {
      await s.put({ id: uuid(), type: 'quest', tripId: oldTid, spotId: oldSpot, title: t, kind: 'view', source: 'template', order: i });
    }
    return { tid, oldTid, oldSpot, spotIds: Object.fromEntries(spots.map((x) => [x.name, x.id])) };
  });

  // ---------- 真實入口：從「我的旅程」點進去 ----------
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.trip-card, .card');
  const entered = await page.evaluate((title) => {
    const el = [...document.querySelectorAll('button, a, .trip-card, .card')].find((x) => x.textContent.includes(title));
    if (!el) return false;
    el.click(); return true;
  }, '宜蘭家族旅行');
  yes(entered, '真實入口：從「我的旅程」點進這一趟');
  await page.waitForSelector('.qcollapse', { timeout: 8000 });

  // ---------- T1 白雲山鹿：0 任務、沒有猜出來的字 ----------
  const c0 = await cards();
  const blank = c0.find((c) => c.name === '白雲山鹿');
  const curated = c0.find((c) => c.name === '羅東夜市');
  const ktv = c0.find((c) => c.name?.startsWith('好樂迪'));
  yes(!!blank && !!curated && !!ktv, `前置：三張卡都在（${c0.map((c) => c.name).join('、')}）`);
  yes(curated.quests > 0, `對照組：羅東夜市照常有 ${curated.quests} 個任務`);
  yes(blank.quests === 0 && ktv.quests === 0, `白雲山鹿與好樂迪：0 個任務（${blank.quests}／${ktv.quests}）`);
  const texts = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.qcollapse')].find((s) => s.querySelector('.qc-name')?.textContent.includes('白雲山鹿'));
    return sec.textContent;
  });
  for (const bad of ['最開闊', '一條路的盡頭', '光影最好的一刻']) {
    yes(!texts.includes(bad), `畫面上沒有猜出來的任務「${bad}」`);
  }

  // ---------- R4 沒有任務的地點：兩個入口都看得到、而且是展開的 ----------
  yes(blank.addVisible, '白雲山鹿的卡片預設展開，入口看得到（收合的話兩個入口都被藏起來）');
  yes(blank.addBtn.includes('＋ 新增任務'), `有「＋ 新增任務」（${blank.addBtn.join('、')}）`);
  yes(blank.addBtn.some((b) => b.includes('拍照')) && blank.addBtn.some((b) => b.includes('相簿')), '有加照片的兩顆（拍照／從相簿選）');
  yes(curated.addBtn.includes('＋ 新增任務'), '有任務的地點在任務列最後也有同一顆「＋ 新增任務」（兩種地點一致）');

  // ---------- T7a「帶我去下一站」跳過沒有任務的地點 ----------
  // 這一條要在「新增任務」之前驗：等下面替白雲山鹿加了一個任務，它就**應該**變成下一站了。
  {
    const next = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.here-card, .btn, .card')].find((x) => x.textContent.includes('帶我去下一站'));
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    yes(next && next.includes('羅東夜市') && !next.includes('白雲山鹿'),
      `「帶我去下一站」指向有任務的羅東夜市，不是排在最前面、沒有任務的白雲山鹿（${next}）`);
  }

  // ---------- T5a 一步新增任務 ----------
  yes(await clickIn('白雲山鹿', '＋ 新增任務'), '按下白雲山鹿卡片上的「＋ 新增任務」');
  await modalType('找到招牌的那隻鹿', '下一步');
  await modalType('拍到鹿就算完成', '新增');
  const added = await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    return s.exportRecords().filter((r) => r.type === 'quest' && r.spotId === sid)
      .map((q) => ({ title: q.title, hint: q.hint, source: q.source }));
  }, ids.spotIds['白雲山鹿']);
  yes(added.length === 1 && added[0].title === '找到招牌的那隻鹿', `新增了 1 個任務（${added.map((a) => a.title).join('、')}）`);
  yes(added[0].source === 'custom', `source 是 custom（${added[0].source}）`);
  yes(added[0].hint === '拍到鹿就算完成', '提示也存進去了');
  await page.waitForFunction(() => document.body.textContent.includes('找到招牌的那隻鹿'), { timeout: 5000 })
    .then(() => ok('新增的任務馬上出現在卡片上')).catch(() => fail('新增後畫面沒更新'));

  // ---------- T5b「＋照片」：確定性 id 的照片任務 ----------
  const before = await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    return !!s.get('q-photo-' + sid);
  }, ids.spotIds['好樂迪KTV 中山店']);
  yes(!before, '前置：好樂迪還沒有照片任務');
  const libInput = await page.evaluateHandle(() => {
    const sec = [...document.querySelectorAll('.qcollapse')].find((s) => s.querySelector('.qc-name')?.textContent.includes('好樂迪'));
    return [...sec.querySelectorAll('.qline-add input[type=file]')].pop();
  });
  await libInput.asElement().uploadFile(photoPath);
  await sleep(2500);
  const afterPhoto = await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    const q = s.get('q-photo-' + sid);
    return { exists: !!q, title: q && q.title, source: q && q.source, subs: q ? s.submissionsOf(q.id).length : 0 };
  }, ids.spotIds['好樂迪KTV 中山店']);
  yes(afterPhoto.exists, `選了照片才建起 q-photo-<spotId>（title：${afterPhoto.title}）`);
  yes(afterPhoto.source === 'photo', `source 是 photo（${afterPhoto.source}）`);
  yes(afterPhoto.subs === 1, `照片真的存進去了（${afterPhoto.subs} 張）`);

  // ---------- T7b 全部地點都沒有任務時：不丟錯、不空白 ----------
  const allBlank = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const g = s.exportRecords().find((r) => r.type === 'group');
    const tid = uuid();
    await s.put({ id: tid, type: 'trip', groupId: g.id, title: '全都沒任務', region: '宜蘭', allowWiki: false });
    for (const n of ['早餐店', '民宿', '加油站']) {
      await s.put({ id: uuid(), type: 'spot', tripId: tid, name: n, day: 1, order: 0, source: 'auto', theme: 'journey', emoji: '📍' });
    }
    return tid;
  });
  await page.goto(`http://localhost:${WEB}/#/trip/${allBlank}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qcollapse');
  const allBlankUI = await page.evaluate(() => ({
    cards: document.querySelectorAll('.qcollapse').length,
    adds: document.querySelectorAll('.qline-add').length,
    text: document.body.textContent.includes('帶我去下一站'),
  }));
  yes(allBlankUI.cards === 3 && allBlankUI.adds === 3, `全部 0 任務的行程：三張卡都在、三組入口都在（${allBlankUI.cards}／${allBlankUI.adds}）`);
  yes(!allBlankUI.text, '沒有任何任務時不顯示「帶我去下一站」（沒有東西可以帶）');

  // ---------- T9「補齊任務」只補策展地點 ----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/settings`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  const hasBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '補齊');
    if (b) b.click();
    return !!b;
  });
  yes(hasBtn, '旅程設定裡有「補齊」');
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#modalRoot button')].find((x) => /好|確定|繼續/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(1200);
  const afterRegen = await page.evaluate(async (map) => {
    const s = await import('./js/store.js');
    const out = {};
    for (const [n, sid] of Object.entries(map)) out[n] = s.questsOf(sid).length;
    return out;
  }, ids.spotIds);
  yes(afterRegen['白雲山鹿'] === 1, `「補齊」沒有替白雲山鹿補任何題（還是只有自己新增的那 1 個：${afterRegen['白雲山鹿']}）`);
  yes(afterRegen['好樂迪KTV 中山店'] === 1, `好樂迪也沒被補題（只有照片任務：${afterRegen['好樂迪KTV 中山店']}）`);
  yes(afterRegen['羅東夜市'] >= curated.quests, `策展的羅東夜市照樣補得到（${curated.quests} → ${afterRegen['羅東夜市']}）`);

  // ---------- T10 舊旅程一筆都不動 ----------
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.oldTid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qcollapse');
  const oldTrip = await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    const qs = s.questsOf(sid);
    return { n: qs.length, titles: qs.map((q) => q.title), blurb: s.get(sid).blurb, onScreen: document.body.textContent.includes('一條路的盡頭') };
  }, ids.oldSpot);
  yes(oldTrip.n === 3, `舊旅程的 3 個 template 任務一筆不少（${oldTrip.n}）`);
  yes(oldTrip.titles.includes('光影最好的一刻'), '內容原封不動（含那句「光影最好的一刻」）');
  yes(oldTrip.blurb === '山裡的清新空氣。', '舊的介紹文字也沒被清掉');
  yes(oldTrip.onScreen, '畫面上照樣看得到（不是只留在資料裡）');

  console.log('\n留白測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
