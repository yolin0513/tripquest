// 任務列的密度與可用性（npm run densitytest）
//
// 起點是使用者實機回報：「一個任務就佔滿整個螢幕，景點一多要滑很久」。
// 改版前實測：每張卡固定 414px，一個螢幕 1.7 張，五個任務的景點要滑 2308px。
//
// 這支盯的是三件事，而且它們會互相拉扯：
//   ① 夠密（收合列要矮）
//   ② 名字看得完整（不能為了矮就把「必吃：包心…／必吃：阿灶…」截成一樣）
//   ③ 收合狀態**照樣能一下加照片**（先前定下來不能退讓的一條）
// 只顧①會犧牲②③，所以三個都要有斷言。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { makeMargin } from './margin.mjs';

// 2026-11-12 守夜（Dispatch 代 Yolin 定 C＋A，替代 B：門檻放寬到 710～720）：
//  · 任務名字原本由 compose.js 用行程 id 當種子抽句子，測試每次的行程 id 都是新的 uuid——量到的是「這次抽到哪一組」，
//    不是版面：同一版 29 次量到 656／682～683／709 三種高度，709 佔 8 次（「一個景點 <700」三分之一的機率紅，理由跟程式無關）。
//    改成**固定最壞情況**：每一站的主題任務直接換成**當下句庫**（data/phrases.json）裡最長的那幾句（字數排序）。
//    **帶時段標記（when）的句子全部納進候選**——compose.js 在沒填時間時不出這種句子，但使用者填了時間就抽得到
//    （夜市「在 {name} 燈火下合照」14 字，是那一站最長的一句）；前置斷言逐站數「句庫裡帶時段的幾句」與「進了候選的幾句」，
//    兩個數要相等，各主題合計至少 1 句。沒有改成「把那句的長度當常數餵進去」：直接從句庫讀，句庫改了最壞情況自己跟著變。
//    **同一趟同一個主題的句子不重複**（compose.js 的 pick 整趟共用「用過」的紀錄）：太平山與礁溪溫泉在景點庫都是 nature，
//    最壞情況照這條規則分——名字長的那站先拿最長的幾句，拿走的另一站不能再拿；兩站都拿最長那幾句是抽不到的組合。
//    句庫加了更長的句子也一樣；前置斷言另外確認三站的主題、每站至少 2 個主題任務（個數不隨種子變，見下面的註解）、
//    同主題不重疊、最長的那句在名字最長的站、指定的每一句都畫到畫面上（比的是畫面的任務名，不是指派時的變數）。
//    收合列的其他部分不隨機：副標是「還沒拍／✓ 已完成 N 張」，必吃任務名照資料原樣（mustQuest 的模板＋清單項目）。
//    已知限制：「字數最多」近似「畫出來最寬」，空白比漢字窄。
//  · 每一條有數字門檻的斷言印「實際／門檻／餘裕」（scripts/margin.mjs），結尾印一行貼近門檻的清單。
const M = makeMargin();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5341;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const eq = (g, w, m) => (g === w ? ok(m) : fail(m, `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const errs = [];
page.on('pageerror', (e) => { errs.push(e.message); console.log('  [pageerror]', e.message); });

// 被截掉的任務名：拿一份不設任何截斷的複本放在同一個位置量自然高度，比畫面上的高。
// 不靠 scrollHeight——v1.41～2026-10-28 一般字級下「人潮的…」「必吃…」明明被截掉，scrollHeight 那條照樣過。
const cutTitles = () => page.evaluate(() => [...document.querySelectorAll('.qline-title')].filter((e) => {
  const c = e.cloneNode(true);
  Object.assign(c.style, { display: 'block', webkitLineClamp: 'unset', overflow: 'visible', maxHeight: 'none', height: 'auto', position: 'absolute', visibility: 'hidden', width: e.getBoundingClientRect().width + 'px' });
  e.parentElement.appendChild(c);
  const natural = c.getBoundingClientRect().height;
  c.remove();
  return natural > e.getBoundingClientRect().height + 2;
}).map((e) => e.textContent.trim()));

const openAll = () => page.evaluate(() => {
  document.querySelectorAll('.daycollapse, .qcollapse').forEach((d) => d.classList.add('open'));
});

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const { tid, worst } = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: me, type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '密度測試', region: '宜蘭', allowWiki: false });
    const { spots, quests } = await generateForTrip({
      tripId: tid, region: '宜蘭',
      items: [{ name: '羅東夜市', day: 1 }, { name: '太平山', day: 1 }, { name: '礁溪溫泉', day: 1 }],
    });
    // 固定最壞情況（見檔頭 2026-11-12）：主題任務換成句庫裡最長的那幾句。{name} 的代法照 compose.js 的 fill（這三站的名字沒有斜線，shortName 原樣）。
    // **同一趟、同一個主題的句子不重複**：generate.js 整趟共用一個 ctx，compose.js 的 pick 用「'qt:'＋主題＋原始索引」記用過的——
    // 太平山與礁溪溫泉都是 nature，兩站不會拿到同一句。所以同主題的站，名字長的先拿最長的幾句、拿走的下一站不能再拿
    // （抽得到的最壞情況；兩站都拿最長那幾句是抽不到的組合，量出來的紅不代表使用者會看到）。
    const P = await (await fetch('./data/phrases.json')).json();
    const txt = (v) => (typeof v === 'string' ? v : (v && v.t) || '');
    const isWhen = (v) => !!(v && typeof v === 'object' && v.when);
    const fillName = (v, name) => txt(v).replace(/\{name\}/g, name).replace(/\s{2,}/g, ' ').trim();
    const worst = [];
    for (const theme of [...new Set(spots.map((sp) => sp.theme))]) {
      const raw = ((P.themes || {})[theme] || {}).questTitles || [];
      // 候選＝這個主題的全部句子（原始索引），**不經**時段篩選（compose.js 的 phraseOk 在沒填時間時會擋掉帶 when 的句子；這裡不擋）
      const pool = raw.map((v, i) => i);
      const taken = new Set();
      const sps = spots.filter((sp) => sp.theme === theme).sort((a, b) => b.name.length - a.name.length);
      // 這個主題最長的一句（用名字最長那站的名字代進去量）：前置斷言要它落在名字最長的那站
      const topIdx = pool.slice().sort((a, b) => fillName(raw[b], sps[0].name).length - fillName(raw[a], sps[0].name).length)[0];
      for (const sp of sps) {
        const tq = quests.filter((q) => q.spotId === sp.id && q.source === 'template');
        const mine = pool.filter((i) => !taken.has(i))
          .sort((a, b) => fillName(raw[b], sp.name).length - fillName(raw[a], sp.name).length)
          .slice(0, tq.length);
        mine.forEach((i) => taken.add(i));
        tq.forEach((q, k) => { q.title = fillName(raw[mine[k]], sp.name); });
        worst.push({
          name: sp.name, theme, n: tq.length, idx: mine, topIdx, titles: tq.map((q) => q.title), top: mine.map((i) => fillName(raw[i], sp.name)),
          // 主題任務的個數不隨種子變：compose.js 的 nTheme 只看有沒有必吃清單；同主題的站合計要幾句、句庫夠不夠，
          // 前置斷言用「每站拿到的句數＝主題任務數」檢查（不夠時 pick 會重置、出現重複，那就不是這裡排得出來的組合）。
          poolN: pool.length, rawN: raw.length,
          // 帶時段標記的句子：句庫裡有幾句、進了候選的有幾句（兩個數各自數）
          whenRaw: raw.filter(isWhen).length,
          whenInPool: pool.filter((i) => isWhen(raw[i])).length,
        });
      }
    }
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    c.getContext('2d').fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const q0 = s.questsOf(spots[0].id)[0];
    await importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q0.id, memberId: me });
    return { tid, worst };
  });

  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qline', { timeout: 20000 });
  await openAll();
  await sleep(700);

  // 前置：最壞情況真的畫到畫面上——三站的主題是景點庫給的那幾種（礁溪溫泉在景點庫是 nature，跟太平山同主題）、
  // 每站至少 2 個主題任務、指派的每一句都出現在畫面的任務名裡。比的是畫面，不是指派時的變數（拿指派的值跟指派的來源比會永遠成立）。
  // 另外兩道是「抽得到」的條件：同主題的站拿的句子沒有重疊；同主題最長的那句落在名字最長的那站。
  // 沒成立＝情境不成立，後面量到的高度不代表最壞。
  const WANT = { 羅東夜市: 'nightmarket', 太平山: 'nature', 礁溪溫泉: 'nature' };
  for (const w of worst) console.log(`  最壞情況｜${w.name}（${w.theme}，句庫 ${w.rawN} 句、候選 ${w.poolN} 句、帶時段的 ${w.whenRaw} 句進候選 ${w.whenInPool} 句）主題任務 ${w.n} 個：${w.titles.join('／')}`);
  const shown = await page.$$eval('.qline-title', (els) => els.map((e) => e.textContent.trim()));
  const missing = worst.flatMap((w) => w.top.filter((t) => !t || !shown.includes(t)));
  const themesW = [...new Set(worst.map((w) => w.theme))];
  // 同主題不重複：同一個主題下各站拿的原始索引沒有重疊（compose.js 的 pick 不會把同一句給同一趟的兩站）
  const shared = themesW.filter((th) => { const all = worst.filter((w) => w.theme === th).flatMap((w) => w.idx); return new Set(all).size !== all.length; });
  // 最長的那句給名字最長的站（同主題兩站以上時）：反過來排也抽得到，但不是最壞
  const notLongest = themesW.filter((th) => {
    const ws = worst.filter((w) => w.theme === th);
    if (ws.length < 2) return false;
    const maxLen = Math.max(...ws.map((w) => w.name.length));
    return !ws.some((w) => w.name.length === maxLen && w.idx.includes(w.topIdx));
  });
  // 帶時段的句子一句都不能漏出候選；各主題合計（同主題只算一次）至少要有 1 句（夜市「燈火下合照」、自然「晨光裡」）——否則這條前置驗不到「沒篩時段」
  const whenAll = themesW.reduce((a, th) => a + worst.find((w) => w.theme === th).whenRaw, 0);
  yes(worst.length === 3 && worst.every((w) => WANT[w.name] === w.theme && w.n >= 2 && w.idx.length === w.n && w.poolN === w.rawN && w.whenInPool === w.whenRaw)
      && whenAll >= 1 && missing.length === 0 && shared.length === 0 && notLongest.length === 0,
    `前置：最壞情況——三站的主題任務都換成句庫裡最長的那幾句（同主題不重複；候選含帶時段的 ${whenAll} 句）、畫面上都看得到（${worst.reduce((a, w) => a + w.n, 0)} 句）`,
    `沒畫出來：${missing.join('、')}｜同主題重疊：${shared.join('、')}｜最長的句子沒給名字最長的站：${notLongest.join('、')}｜${JSON.stringify(worst.map((w) => [w.name, w.theme, w.n, w.idx, w.poolN, w.rawN, w.whenInPool, w.whenRaw]))}`);

  // ---------- ① 夠密 ----------
  console.log('— 密度 —');
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.qline')];
    const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));
    const gap = parseInt(getComputedStyle(rows[0]).marginBottom, 10) || 0;
    const sec = document.querySelector('.qcollapse.open');
    return {
      n: rows.length,
      max: Math.max(...hs), min: Math.min(...hs),
      avg: Math.round(hs.reduce((a, c) => a + c, 0) / hs.length) + gap,
      head: Math.round(sec.querySelector('.qc-head').getBoundingClientRect().height),
      sectionH: Math.round(sec.getBoundingClientRect().height),
      inSection: sec.querySelectorAll('.qline').length,
      secName: ((sec.querySelector('.qc-head') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20),
      secRows: [...sec.querySelectorAll('.qline')].map((r) => Math.round(r.getBoundingClientRect().height)),
      tall: rows.map((r, i) => [hs[i], ((r.querySelector('.qline-title') || {}).textContent || '').trim()]).sort((a, b) => b[0] - a[0]).slice(0, 3),
      vh: innerHeight,
    };
  });
  // 說明行（不是項目）：量到的是哪幾列、哪一站——門檻紅了才知道是哪一句撐高的
  console.log(`  最高的三列：${m.tall.map(([h, t]) => `${h}px「${t}」`).join('、')}`);
  console.log(`  「一個景點」量的是第一個展開的景點：${m.secName}｜各列 ${m.secRows.join('、')}px`);
  const usable = m.vh - 136;                       // 扣掉頂列與底部分頁
  const fit = usable / m.avg;
  // 136 的依據（2026-10-28 實測，390×844、一般字級、這份種子）：名字一行 74px、兩行 100px、
  // 最長的「拍下 太平山 最開闊的一景」三行 127px。原本的 104 是名字最多兩行（截斷）時的值。
  const rMax = M.within(m.max, '<=', 136, 'px', '收合列最高');
  yes(rMax.ok, `收合列最高 ${m.max}px（含間距平均 ${m.avg}px）${rMax.tail}`, `max=${m.max}`);
  const rFit = M.within(fit, '>=', 4, ' 個', '一個螢幕看得到的任務數');   // 原始值比（判準跟原本一樣）
  yes(rFit.ok, `一個螢幕看得到 ${fit.toFixed(1)} 個任務（目標 ≥4）${rFit.tail}`);
  const rSec = M.within(m.sectionH, '<', 700, 'px', '一個景點');
  yes(rSec.ok, `一個景點（標題＋${m.inSection} 個任務）共 ${m.sectionH}px（改版前 2308px）${rSec.tail}`);
  const rHead = M.within(m.head, '<=', 90, 'px', '景點標題列');
  yes(rHead.ok, `景點標題列 ${m.head}px${rHead.tail}`);
  yes(!(await page.$('.map-btn')), '地圖不再是整寬一顆大按鈕');
  const mapBtn = await page.evaluate(() => {
    const a = document.querySelector('.qc-map');
    if (!a) return null;
    const b = a.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), label: a.getAttribute('aria-label') || '' };
  });
  const rMap = M.within(mapBtn ? [mapBtn.w, mapBtn.h] : null, '>=', 44, 'px', '地圖小圖示');
  yes(mapBtn && rMap.ok, `地圖小圖示 ${mapBtn && mapBtn.w}×${mapBtn && mapBtn.h}px，仍是可點的大小${rMap.tail}`);
  yes(mapBtn && /導航/.test(mapBtn.label), '地圖按鈕的說明是「導航」');
  const mapTxt = await page.$eval('.qc-map', (e) => e.innerText.replace(/\s+/g, ''));
  yes(/導航/.test(mapTxt), '地圖按鈕上看得到「導航」兩個字 —— 只有圖示很多人不知道那是什麼');

  // ---------- ② 名字看得完整 ----------
  console.log('\n— 名字要看得出來 —');
  const titles = await page.$$eval('.qline-title', (els) => els.map((e) => e.textContent.trim()));
  const cut = await cutTitles();
  yes(titles.length > 0 && cut.length === 0, `名字不被截斷：${titles.length} 個任務名全部顯示完整`, cut.join('、'));
  // textContent 是全文，被截掉也照樣不一樣——所以「分得出來」要連同「沒被截掉」一起成立才算
  const foods = titles.filter((t) => t.startsWith('必吃'));
  yes(foods.length >= 2 && new Set(foods).size === foods.length && !foods.some((t) => cut.includes(t)),
    `同前綴的任務名彼此分得出來（${foods.join('／') || '無'}，畫面上沒被截掉）`, cut.join('、'));
  const fsize = await page.$eval('.qline-title', (e) => parseFloat(getComputedStyle(e).fontSize));
  const rFs = M.within(fsize, '>=', 16, 'px', '任務名字級');
  yes(rFs.ok, `任務名字級 ${fsize}px —— 縮的是圖與留白，不是字${rFs.tail}`);

  // ---------- ③ 收合狀態就能加照片 ----------
  console.log('\n— 收合就能加照片 —');
  const acts = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.qline:not(.done)')][0];
    const btns = [...row.querySelectorAll('.qline-act button')];
    return btns.map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 };
    });
  });
  eq(acts.length, 2, '收合列上就有兩顆按鈕（拍照、從相簿選），不必先展開');
  const rActs = M.within(acts.flatMap((a) => [a.w, a.h]), '>=', 44, 'px', '收合列的兩顆相機鈕');
  yes(rActs.ok, `兩顆都 ≥44px（${acts.map((a) => a.w + '×' + a.h).join('、')}）${rActs.tail}`);
  yes(acts.some((a) => /拍照/.test(a.label)) && acts.some((a) => /相簿/.test(a.label)),
    `按鈕有說明：${acts.map((a) => a.label).join('、')}`);
  // 真的接得上檔案選擇（不是畫好看的）
  const wired = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.qline:not(.done)')][0];
    const inputs = [...row.querySelectorAll('input[type=file]')];
    return { n: inputs.length, cam: inputs.some((i) => i.getAttribute('capture') === 'environment') };
  });
  eq(wired.n, 2, '兩顆各自接到自己的檔案輸入');
  yes(wired.cam, '「拍照」那顆會直接叫相機（capture=environment）');

  // ---------- 已完成的列 ----------
  // v1.44：完成與否，右邊都是同樣位置、同樣的兩顆圖示鈕。
  // 之前完成的列換成綠色打勾，等於完成前後的操作方式不一樣 ——
  // 想再拍一張的人會在原本的位置找不到東西。
  const doneRow = await page.evaluate(() => {
    const r = document.querySelector('.qline.done');
    const u = document.querySelector('.qline:not(.done)');
    if (!r || !u) return null;
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(innerWidth - b.right) };
    };
    return {
      check: !!r.querySelector('.qline-done'),
      btns: [...r.querySelectorAll('.qline-act button')].map((b) => b.getAttribute('aria-label')),
      doneAct: box(r.querySelector('.qline-act')),
      undoneAct: box(u.querySelector('.qline-act')),
      ownThumb: r.querySelector('.qline-thumb').classList.contains('has-img'),
      sub: r.querySelector('.qline-sub').textContent,
    };
  });
  yes(doneRow && !doneRow.check, '完成的任務右邊不再是綠色打勾');
  yes(doneRow && doneRow.btns.length === 2 && doneRow.btns.some((x) => /拍照|再拍/.test(x)) && doneRow.btns.some((x) => /相簿/.test(x)),
    `完成的任務一樣有兩顆鈕：${doneRow && doneRow.btns.join('、')}`);
  yes(doneRow && doneRow.doneAct.right === doneRow.undoneAct.right && doneRow.doneAct.w === doneRow.undoneAct.w,
    `完成前後按鈕的位置與大小完全一樣（距右 ${doneRow && doneRow.doneAct.right}px、寬 ${doneRow && doneRow.doneAct.w}px）`,
    JSON.stringify(doneRow));
  yes(doneRow && doneRow.ownThumb, '完成狀態改用縮圖表示（換成自己拍的那張）');
  yes(doneRow && /已完成/.test(doneRow.sub), `列上也有文字：「${doneRow && doneRow.sub.trim()}」`);

  // ---------- 展開 ----------
  console.log('\n— 點開才給大圖 —');
  const before = await page.$$eval('.qline-photo', (e) => e.length);
  eq(before, 0, '還沒點開時不會先建 30 張大圖（省流量也省記憶體）');
  await page.evaluate(() => document.querySelectorAll('.qline:not(.done) .qline-head')[0].click());
  await sleep(500);
  const ex = await page.evaluate(() => {
    const r = document.querySelector('.qline.open');
    const photo = r.querySelector('.qline-photo');
    return {
      open: !!r,
      photoH: photo ? Math.round(photo.getBoundingClientRect().height) : 0,
      hint: !!r.querySelector('.qline-hint'),
      bigBtns: [...r.querySelectorAll('.qline-more .btn')].map((b) => b.textContent.trim()),
      expanded: r.querySelector('.qline-head').getAttribute('aria-expanded'),
    };
  });
  yes(ex.open, '點一下就展開');
  eq(ex.expanded, 'true', 'aria-expanded 有跟著改（螢幕閱讀器讀得到）');
  const rPhoto = M.within(ex.photoH, '>', 120, 'px', '展開的大圖');
  yes(rPhoto.ok, `展開才出現大圖（${ex.photoH}px）${rPhoto.tail}`);
  yes(ex.hint, '展開才顯示完整說明');
  yes(ex.bigBtns.some((t) => /拍照/.test(t)) && ex.bigBtns.some((t) => /相簿/.test(t)),
    `展開後是有字的大按鈕：${ex.bigBtns.join('、')}`);

  // 同一時間只展開一個
  await page.evaluate(() => document.querySelectorAll('.qline:not(.done) .qline-head')[1].click());
  await sleep(400);
  eq(await page.$$eval('.qline.open', (e) => e.length), 1, '點另一個會自動收合前一個');

  // ---------- 授權標示 ----------
  console.log('\n— 出處標示 —');
  const credits = await page.evaluate(() => ({
    onThumb: document.querySelectorAll('.qline-thumb .img-credit').length,
    onBig: document.querySelectorAll('.qline-photo').length,
  }));
  eq(credits.onThumb, 0, '56px 的縮圖不壓授權小字（糊成一團看不清）');
  yes(credits.onBig > 0, '展開的大圖仍然是標示出處的地方');

  // ---------- 特大字與高對比 ----------
  console.log('\n— 特大字 / 高對比 —');
  for (const [label, apply] of [
    ['特大字', async () => page.evaluate(async () => { (await import('./js/prefs.js')).setPref('fs', 'xl'); })],
    ['特大字＋高對比', async () => page.evaluate(async () => { (await import('./js/prefs.js')).setPref('contrast', 'high'); })],
  ]) {
    await apply();
    await sleep(400);
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const rows = [...document.querySelectorAll('.qline')];
      const btns = [...document.querySelectorAll('.qline-act button')];
      return {
        fs: de.dataset.fs || '', contrast: de.dataset.contrast || '',
        overflow: de.scrollWidth > de.clientWidth + 2,
        btnH: btns.map((b) => Math.round(b.getBoundingClientRect().height)),
        maxH: Math.max(...rows.filter((x) => !x.classList.contains('open')).map((x) => Math.round(x.getBoundingClientRect().height))),
        leak: rows.filter((x) => !x.classList.contains('open')).filter((x) => (x.querySelector('.qline-more')?.getBoundingClientRect().height || 0) > 1).length,
      };
    });
    const cut = await cutTitles();
    yes(!r.overflow, `${label}：沒有橫向破版（fs=${r.fs || 'm'} contrast=${r.contrast || 'normal'}）`);
    // 原本只數「幾顆 <44」：數到 0 顆時看不出最矮的那顆離 44 多遠。改成取全部的高、最矮的算餘裕
    const rXlBtn = M.within(r.btnH, '>=', 44, 'px', `${label}的相機鈕`);
    yes(rXlBtn.ok, `${label}：相機鈕仍然 ≥44px（${r.btnH.length} 顆）${rXlBtn.tail}`);
    yes(cut.length === 0, `${label}：名字不被截斷`, cut.join('、'));
    yes(r.leak === 0, `${label}：收合的列沒有把展開的內容漏出來`, `漏出來 ${r.leak} 列`);
    // 220 的依據（2026-10-28 實測，390×844、特大字、這份種子）：名字一行的列 126px、三行 161px、
    // 最長的「拍下 太平山 最開闊的一景」四行 196px。超過 220 ＝ 名字要折到五行以上（名字欄又被壓窄了）。
    // 舊的 160 是 v1.41 為了抓「收合後內容漏出來」（量到 587px）訂的，沒有量過特大字；漏出來改由上一條直接驗。
    const rXl = M.within(r.maxH, '<=', 220, 'px', `${label}的收合列`);
    yes(rXl.ok, `${label}：收合列最高 ${r.maxH}px（名字最多四行）${rXl.tail}`);
  }
  await page.evaluate(async () => {
    const p = await import('./js/prefs.js');
    p.setPref('fs', 'm'); p.setPref('contrast', 'normal');
  });

  yes(errs.length === 0, '整段沒有 JS 例外', errs.join(' | '));
  console.log('\n' + M.summary());
  console.log('\n任務列密度測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
