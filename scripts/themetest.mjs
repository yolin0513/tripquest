// 主題判定與任務產生（npm run themetest）—— 實機回報的三個問題釘在這裡：
//   ① 「臺灣桃園國際機場」被「灣」誤判成海邊、機場沒有自己的主題
//      → 交通樞紐主題（機場/車站/港口/轉運站/服務區），簡繁都要命中
//   ② 07:00–08:00 的景點拿到「夜裡點燈的樣子」→ 依景點時段過濾句型；
//      沒設時間的照舊全池；之後改時間會提示換任務（已拍照片的不動）
//   ③ 「新千岁机场 / 新千歲機場」整串嵌進任務描述 → shortName 取一段
//   另外：醫院不再被「院」判成寺廟、超市不再被「市」判成夜市、大學不再是海邊

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5537;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

const NIGHT_WORDS = ['夜裡點燈', '入夜後', '車燈拍成一條線', '夕陽'];

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- ① 主題判定 ----------
  console.log('— 主題判定 —');
  const themed = await page.evaluate(async () => {
    const { loadThemes, themeForSpot } = await import('./js/theme.js');
    await loadThemes();
    const names = {
      airport: '臺灣桃園國際機場', airportCn: '新千岁机场 / 新千歲機場',
      station: '台北車站', eki: '京都駅', rest: '清水服務區', bus: '礁溪轉運站',
      hospital: '台大醫院', univ: '台灣大學', park: '大安森林公園',
      wharf: '淡水漁人碼頭', matsuyama: '松山機場',
    };
    const out = {};
    for (const [k, name] of Object.entries(names)) out[k] = themeForSpot({ name });
    return out;
  });
  yes(themed.airport === 'transit', `臺灣桃園國際機場 → ${themed.airport}（不再被「灣」判成海邊）`);
  yes(themed.airportCn === 'transit' && themed.matsuyama === 'transit',
    `新千岁机场（簡體）與松山機場 → ${themed.airportCn}/${themed.matsuyama}（簡繁都命中、「山」不搶）`);
  yes(themed.station === 'transit' && themed.eki === 'transit' && themed.bus === 'transit' && themed.rest === 'transit',
    `車站/駅/轉運站/服務區 → 都是交通樞紐`);
  yes(themed.hospital !== 'heritage' && themed.univ !== 'coast',
    `台大醫院 → ${themed.hospital}（不是寺廟）、台灣大學 → ${themed.univ}（不是海邊）`);
  yes(themed.park === 'nature' && themed.wharf === 'coast',
    `大安森林公園 → ${themed.park}、漁人碼頭 → ${themed.wharf}（原本對的沒被弄壞）`);

  // ---------- ② 任務產生：交通樞紐內容、時段過濾 ----------
  console.log('\n— 任務產生 —');
  const gen = await page.evaluate(async () => {
    const g = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const s = await import('./js/store.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '主題測試', region: '台北', allowWiki: false });
    const { spots, quests } = await g.generateForTrip({
      tripId: tid, region: '台北',
      items: [
        { name: '臺灣桃園國際機場', day: 1, startMin: 7 * 60, stayMin: 60 },
        { name: '台北101', day: 1, startMin: 7 * 60, stayMin: 60 },        // 早上的都市景點
        { name: '新千岁机场 / 新千歲機場', day: 2 },
      ],
    });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    const qOf = (name) => {
      const sp = spots.find((x) => x.name.includes(name));
      return quests.filter((q) => q.spotId === sp.id).map((q) => ({ t: q.title, h: q.hint, when: q.when || null }));
    };
    return {
      tid,
      airTheme: spots[0].theme, airEmoji: spots[0].emoji,
      air: qOf('桃園'), morning101: qOf('101'), cn: qOf('新千'),
    };
  });
  yes(gen.airTheme === 'transit' && gen.airEmoji === '✈️', `機場景點主題=${gen.airTheme}、emoji=${gen.airEmoji}`);
  const airTxt = gen.air.map((q) => q.t + q.h).join('');
  yes(/指標|合照|行李|窗外|第一張|等待|出發/.test(airTxt) && !/人潮走動|整座|城市/.test(airTxt),
    `機場任務貼合情境（${gen.air.map((q) => q.t).join('、')}）`);
  const m101 = gen.morning101.map((q) => q.t + q.h).join('');
  yes(!NIGHT_WORDS.some((w) => m101.includes(w)),
    `07:00 到的台北101 沒有夜間任務（${gen.morning101.map((q) => q.t).join('、')}）`);
  const cnTxt = gen.cn.map((q) => q.t + q.h).join('');
  yes(!cnTxt.includes('/') && !cnTxt.includes('新千岁'),
    `長複合名只嵌「新千歲機場」，不出現「新千岁机场 / …」（${gen.cn[0] && gen.cn[0].t}）`);

  // 純函式層：過濾規則 + 沒設時間全池可用 + when 有落在任務上
  const pure = await page.evaluate(async () => {
    const c = await import('./js/quests/compose.js');
    await c.loadPhrases();
    const morningWin = c.timeWindow({ startMin: 7 * 60, stayMin: 60 });
    const nightWin = c.timeWindow({ startMin: 19 * 60 + 30, stayMin: 90 });
    const spotUntimed = { name: '台北101' };
    const seen = new Set();
    let nightQuest = null;
    for (let i = 0; i < 30; i++) {
      const ctx = c.makeCtx('seed' + i);
      for (const q of c.composeQuests(spotUntimed, 'urban', ctx, { max: 4 })) {
        seen.add(q.title);
        if (q.title.includes('夜裡點燈')) nightQuest = q;
      }
    }
    // 早上的景點跑 30 種種子，一次都不能出現夜間句
    let morningBad = null;
    for (let i = 0; i < 30; i++) {
      const ctx = c.makeCtx('m' + i);
      for (const q of c.composeQuests({ name: '台北101', startMin: 7 * 60, stayMin: 60 }, 'urban', ctx, { max: 4 })) {
        if (/夜裡點燈|入夜後|車燈拍成一條線/.test(q.title + q.hint)) morningBad = q.title + '｜' + q.hint;
      }
    }
    return {
      okNight: c.phraseOk({ when: 'night' }, nightWin), noNight: c.phraseOk({ when: 'night' }, morningWin),
      okAlways: c.phraseOk({ when: 'night' }, null),
      untimedHasNight: [...seen].some((t) => t.includes('夜裡點燈')),
      nightQuestWhen: nightQuest && nightQuest.when, morningBad,
    };
  });
  yes(pure.noNight === false && pure.okNight === true && pure.okAlways === true,
    '過濾規則：早上擋夜間句、晚上放行、沒設時間全放行');
  yes(!pure.morningBad, '早上景點 30 種種子都不出現夜間句', pure.morningBad);
  yes(pure.untimedHasNight && pure.nightQuestWhen === 'night',
    '沒設時間維持全池（含夜間句），且任務有記 when=night（改時間提示靠它）');

  // ---------- ② 改時間 → 提示換任務（已拍照片的不動） ----------
  console.log('\n— 改時間提示 —');
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid(), sid = uuid(), q1 = uuid(), q2 = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '換任務測試', region: '台北', allowWiki: false });
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '台北101', emoji: '🗼', day: 1, order: 0, theme: 'urban' });
    await s.put({ id: q1, type: 'quest', tripId: tid, spotId: sid, title: '夜裡點燈的樣子', hint: '入夜後回來拍。', kind: 'view', source: 'template', when: 'night', order: 0, refImage: null });
    await s.put({ id: q2, type: 'quest', tripId: tid, spotId: sid, title: '有照片的夜拍', hint: '入夜後回來拍。', kind: 'view', source: 'template', when: 'night', order: 1, refImage: null });
    await s.put({ id: uuid(), type: 'submission', tripId: tid, questId: q2, blobId: null, createdAt: Date.now() });
    return { tid, sid, q1, q2 };
  });
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/spot/${ids.sid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.spot-time');
  // 景點設定頁也是 時/分 雙下拉（同族問題：iOS 原生 time input 空值畫成當下時間）
  const blank = await page.evaluate(() => {
    const [hh, mm] = document.querySelectorAll('.spot-time select');
    return { native: !!document.querySelector('.spot-time-row input[type=time]'),
      shown: hh.options[hh.selectedIndex].textContent, minDisabled: mm.disabled };
  });
  yes(!blank.native && blank.shown === '未設定' && blank.minDisabled,
    `設定頁沒有原生 time input，空值顯示「${blank.shown}」（分下拉先鎖住）`);
  await page.evaluate(() => {
    const [hh, mm] = document.querySelectorAll('.spot-time select');
    hh.value = '7'; hh.dispatchEvent(new Event('change', { bubbles: true }));
    mm.value = '30';
  });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '儲存').click());
  await page.waitForSelector('.modal-card', { timeout: 8000 });
  const dlg = await page.evaluate(() => document.querySelector('.modal-card').textContent);
  yes(dlg.includes('不太合') && dlg.includes('夜裡點燈') && dlg.includes('已拍照片的任務不會動'),
    `改成早上後跳提示：「${dlg.replace(/\s+/g, ' ').slice(0, 46)}…」`);
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.includes('幫我換')).click());
  await sleep(900);
  const after = await page.evaluate(async (ids) => {
    const s = await import('./js/store.js');
    const qs = s.questsOf(ids.sid);
    const c = await import('./js/quests/compose.js');
    await c.loadPhrases();
    const win = c.timeWindow(s.getRaw(ids.sid));
    return {
      titles: qs.map((q) => q.title), n: qs.length,
      photoKept: qs.some((q) => q.id === ids.q2),
      gone: !qs.some((q) => q.id === ids.q1),
      allFit: qs.filter((q) => q.id !== ids.q2).every((q) => c.phraseOk({ when: q.when }, win)),
      startMin: s.getRaw(ids.sid).startMin,
    };
  }, ids);
  yes(after.startMin === 450, `時間有存進去（startMin=${after.startMin}）`);
  yes(after.gone && after.photoKept && after.n === 2,
    `沒照片的夜間任務換掉、有照片的保留（現在：${after.titles.join('、')}）`);
  yes(after.allFit, '換上的任務都符合新時段');

  // 資料面：設定頁完全不碰「幾點到」→ 存的是 null，不是當下時間；
  // 匯入的 13:05（非固定分鐘選項）進設定頁再存，不能走樣
  const keep = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const s1 = uuid(), s2 = uuid();
    await s.put({ id: s1, type: 'spot', tripId: tid, name: '沒設時間的店', day: 1, order: 5 });
    await s.put({ id: s2, type: 'spot', tripId: tid, name: '13:05 的店', day: 1, order: 6, startMin: 13 * 60 + 5, stayMin: 30 });
    return { tid, s1, s2 };
  }, ids.tid);
  for (const [sid, expect, label] of [[keep.s1, null, '沒動「幾點到」→ 存進去是 null，不是當下時間'],
    [keep.s2, 785, '13:05 進設定頁再存，分鐘不走樣（785 分）']]) {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#/trip/${keep.tid}/spot/${sid}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.spot-time');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '儲存').click());
    await sleep(700);
    const got = await page.evaluate(async (sid) => (await import('./js/store.js')).getRaw(sid).startMin, sid);
    yes(got === expect, `${label}（實際 ${got}）`);
  }

  console.log('\n主題與任務測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
