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

const openAll = () => page.evaluate(() => {
  document.querySelectorAll('.daycollapse, .qcollapse').forEach((d) => d.classList.add('open'));
});

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  const tid = await page.evaluate(async () => {
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
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    c.getContext('2d').fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const q0 = s.questsOf(spots[0].id)[0];
    await importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q0.id, memberId: me });
    return tid;
  });

  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qline', { timeout: 20000 });
  await openAll();
  await sleep(700);

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
      vh: innerHeight,
    };
  });
  const usable = m.vh - 136;                       // 扣掉頂列與底部分頁
  const fit = usable / m.avg;
  yes(m.max <= 104, `收合列最高 ${m.max}px（含間距平均 ${m.avg}px）`, `max=${m.max}`);
  yes(fit >= 4, `一個螢幕看得到 ${fit.toFixed(1)} 個任務（目標 ≥4）`);
  yes(m.sectionH < 700, `一個景點（標題＋${m.inSection} 個任務）共 ${m.sectionH}px（改版前 2308px）`);
  yes(m.head <= 90, `景點標題列 ${m.head}px`);
  yes(!(await page.$('.map-btn')), '地圖不再是整寬一顆大按鈕');
  const mapBtn = await page.evaluate(() => {
    const a = document.querySelector('.qc-map');
    if (!a) return null;
    const b = a.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), label: a.getAttribute('aria-label') || '' };
  });
  yes(mapBtn && mapBtn.w >= 44 && mapBtn.h >= 44, `地圖小圖示 ${mapBtn && mapBtn.w}×${mapBtn && mapBtn.h}px，仍是可點的大小`);
  yes(mapBtn && /用地圖看/.test(mapBtn.label), '地圖圖示有說明文字（螢幕閱讀器與長按都看得到）');

  // ---------- ② 名字看得完整 ----------
  console.log('\n— 名字要看得出來 —');
  const titles = await page.$$eval('.qline-title', (els) => els.map((e) => ({
    text: e.textContent.trim(),
    shown: e.scrollHeight <= e.clientHeight + 2,     // 有沒有被 line-clamp 切掉
  })));
  const cut = titles.filter((t) => !t.shown);
  yes(cut.length === 0, `${titles.length} 個任務名全部顯示完整`, cut.map((t) => t.text).join('、'));
  const foods = titles.filter((t) => t.text.startsWith('必吃')).map((t) => t.text);
  yes(new Set(foods).size === foods.length, `同前綴的任務名彼此分得出來（${foods.join('／') || '無'}）`);
  const fsize = await page.$eval('.qline-title', (e) => parseFloat(getComputedStyle(e).fontSize));
  yes(fsize >= 16, `任務名字級 ${fsize}px —— 縮的是圖與留白，不是字`);

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
  yes(acts.every((a) => a.w >= 44 && a.h >= 44), `兩顆都 ≥44px（${acts.map((a) => a.w + '×' + a.h).join('、')}）`);
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
  const doneRow = await page.evaluate(() => {
    const r = document.querySelector('.qline.done');
    if (!r) return null;
    return {
      check: !!r.querySelector('.qline-done'),
      noCam: !r.querySelector('.qline-act'),
      ownThumb: r.querySelector('.qline-thumb').classList.contains('has-img'),
      sub: r.querySelector('.qline-sub').textContent,
    };
  });
  yes(doneRow && doneRow.check, '完成的任務右邊是打勾');
  yes(doneRow && doneRow.noCam, '完成的任務收合時不再放相機鈕（點開才有「再拍一張」）');
  yes(doneRow && doneRow.ownThumb, '完成的任務縮圖換成自己拍的那張');
  yes(doneRow && /已完成/.test(doneRow.sub), `完成狀態寫在列上：「${doneRow && doneRow.sub.trim()}」`);

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
  yes(ex.photoH > 120, `展開才出現大圖（${ex.photoH}px）`);
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
        smallBtn: btns.filter((b) => b.getBoundingClientRect().height < 44).length,
        clipped: [...document.querySelectorAll('.qline-title')].filter((e) => e.scrollHeight > e.clientHeight + 2).length,
        maxH: Math.max(...rows.filter((x) => !x.classList.contains('open')).map((x) => Math.round(x.getBoundingClientRect().height))),
      };
    });
    yes(!r.overflow, `${label}：沒有橫向破版（fs=${r.fs || 'm'} contrast=${r.contrast || 'normal'}）`);
    yes(r.smallBtn === 0, `${label}：相機鈕仍然 ≥44px`);
    yes(r.maxH <= 160, `${label}：收合列最高 ${r.maxH}px 仍在合理範圍`);
    void r.clipped;
  }
  await page.evaluate(async () => {
    const p = await import('./js/prefs.js');
    p.setPref('fs', 'm'); p.setPref('contrast', 'normal');
  });

  yes(errs.length === 0, '整段沒有 JS 例外', errs.join(' | '));
  console.log('\n任務列密度測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
