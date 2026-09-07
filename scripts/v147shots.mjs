// v1.47 驗證 + 截圖：路線圖（碰撞/群聚/比例尺）、海報預覽翻頁與全天數輸出、
// 預覽進度條拖曳、照片牆移除徽章入口
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_v147/', import.meta.url);
await mkdir(OUT, { recursive: true });
const WEB = 5495;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
const savePng = async (name, dataURL) => {
  await writeFile(fileURLToPath(new URL(name + '.png', OUT)), Buffer.from(dataURL.split(',')[1], 'base64'));
  console.log('  📸 ' + name);
};

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ================= 3. 路線圖 =================
  console.log('— 路線圖：碰撞、群聚、比例尺 —');
  // 使用者的實際情境：羅東一帶擠在一起 + 粉鳥林一個遠點；另外 26 個地點沒有座標
  const SCEN = {
    '使用者情境-羅東群聚加粉鳥林': {
      coords: [
        ['羅東運動公園', 24.6832, 121.7594], ['羅東林業文化園區', 24.6766, 121.7745],
        ['羅東觀光夜市', 24.6779, 121.7674], ['中山公園', 24.6771, 121.7712],
        ['粉鳥林漁港', 24.4736, 121.8355],
      ],
      noCoord: 26,
    },
    '只有四個點-兩個重疊': {
      coords: [
        ['羅東運動公園', 24.6832, 121.7594], ['羅東林業文化園區', 24.6766, 121.7745],
        ['羅東觀光夜市', 24.6779, 121.7674], ['粉鳥林漁港', 24.4736, 121.8355],
      ],
      noCoord: 0,
    },
    '羅東擠了十五個點': {
      coords: [
        ['羅東運動公園', 24.6832, 121.7594], ['羅東林業文化園區', 24.6766, 121.7745],
        ['羅東觀光夜市', 24.6779, 121.7674], ['中山公園', 24.6771, 121.7712],
        ['林場肉羹', 24.6786, 121.7712], ['北門綠豆沙牛乳大王', 24.679, 121.766],
        ['財記臭豆腐', 24.677, 121.769], ['石頭鄉燜烤玉米', 24.6768, 121.7702],
        ['火烤碳香真珠玉米', 24.6781, 121.7688], ['山風民宿', 24.672, 121.7695],
        ['中興文化創意園區', 24.665, 121.752], ['東南蜜餞舖', 24.6772, 121.768],
        ['正老元香食品廠', 24.6775, 121.7665], ['羅東文化工場', 24.6845, 121.7702],
        ['粉鳥林漁港', 24.4736, 121.8355], ['鄉村風味', 24.62, 121.78],
      ],
      noCoord: 5,
    },
    '整趟散得很開': {
      coords: [
        ['礁溪溫泉', 24.827, 121.773], ['幾米公園', 24.754, 121.758], ['羅東夜市', 24.678, 121.767],
        ['梅花湖', 24.639, 121.742], ['太平山', 24.502, 121.535], ['粉鳥林', 24.474, 121.836],
        ['南方澳', 24.583, 121.865], ['傳藝中心', 24.685, 121.824],
      ],
      noCoord: 3,
    },
  };

  for (const [name, sc] of Object.entries(SCEN)) {
    const res = await page.evaluate(async (scen) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const mem = await import('./js/memory.js');
      const gid = uuid(), tid = uuid();
      await s.put({ id: gid, type: 'group', name: 'g' });
      await s.put({ id: tid, type: 'trip', groupId: gid, title: '測試', region: '宜蘭', allowWiki: false });
      let o = 0;
      for (const [n, lat, lng] of scen.coords) {
        await s.put({ id: uuid(), type: 'spot', tripId: tid, name: n, emoji: '📍', day: 1, order: o++, lat, lng, region: '宜蘭' });
      }
      for (let i = 0; i < scen.noCoord; i++) {
        await s.put({ id: uuid(), type: 'spot', tripId: tid, name: `沒座標的店${i + 1}`, emoji: '🍜', day: 1, order: o++ });
      }
      // 版面驗證（純函式）
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
      const ctx = c.getContext('2d');
      const spots = s.spotsOf(tid).filter((x) => x.lat != null && x.lng != null);
      const L = mem.computeMapLayout(ctx, spots, { totalSpots: s.spotsOf(tid).length });
      const hit = (a, b) => !(a.x1 + 2 < b.x0 || b.x1 + 2 < a.x0 || a.y1 + 2 < b.y0 || b.y1 + 2 < a.y0);
      const rects = L.labels.map((x) => x.rect).concat(L.cluster ? L.cluster.inset.labels.map((x) => x.rect) : []);
      let overlap = null;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        if (hit(rects[i], rects[j])) overlap = JSON.stringify([rects[i], rects[j]]);
      }
      const outside = rects.find((r) => r.x0 < 0 || r.x1 > 1080 || r.y0 < 0 || r.y1 > 1920);
      // 放大圈不可以把「圈外的點」蓋掉（實測抓到的視覺 bug，釘住）
      let covered = null;
      if (L.cluster) {
        for (const p of L.pts) {
          if (L.cluster.inSet.has(p.i)) continue;
          if (Math.hypot(p.x - L.cluster.inset.cx, p.y - L.cluster.inset.cy) < L.cluster.inset.r + 18) covered = p.name;
        }
      }
      // 實際畫面：用播放器 seek 到地圖段中後段
      const player = await mem.createPlayer(c, tid, { length: 'full' });
      const t = await mem.buildTimeline(tid, { length: 'full' });
      const mapSeg = t.segs.find((x) => x.kind === 'map');
      player.seek(mapSeg.start + mapSeg.dur * 0.82);
      await new Promise((r) => setTimeout(r, 300));
      player.seek(mapSeg.start + mapSeg.dur * 0.82);
      const png = c.toDataURL('image/png');
      player.destroy();
      return {
        png, overlap, outside: outside ? JSON.stringify(outside) : null,
        labels: L.labels.length, cluster: L.cluster ? L.cluster.count : 0, covered,
        clusterLabel: L.cluster ? L.cluster.label : '',
        subtitle: L.subtitle, scale: L.scaleBar.label,
      };
    }, sc);
    console.log(`  「${name}」 副標＝${res.subtitle}／比例尺＝${res.scale}`);
    yes(!res.overlap, `「${name}」標籤互不重疊`, res.overlap);
    yes(!res.outside, `「${name}」標籤都在畫面內`, res.outside);
    if (name.includes('十五個點')) {
      yes(res.cluster >= 10, `${res.cluster} 個點收成一帶（放大圈放不下的名字會略過並標註，不會糊成一團）`);
    }
    if (name.includes('群聚')) {
      yes(res.cluster >= 3, `密集的 ${res.cluster} 個點收成一帶＋放大圈`);
      yes(res.clusterLabel.startsWith('羅東一帶'), `群名用地名共同開頭：「${res.clusterLabel}」（不是縣市級的「宜蘭一帶」）`);
      yes(!res.covered, '放大圈沒有蓋到圈外的點', res.covered);
    }
    if (sc.noCoord) yes(res.subtitle.includes(`${sc.coords.length + sc.noCoord} 個地點`), '副標誠實寫出「幾個地點、幾個有座標」', res.subtitle);
    await savePng(`路線圖-${name}`, res.png);
  }

  // ================= 4. 海報：預覽翻頁 + 全天數輸出 =================
  console.log('\n— 海報：3 / 5 / 7 天 —');
  for (const nDays of [3, 5, 7]) {
    const r = await page.evaluate(async (nDays) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const pi = await import('./js/poster/index.js');
      const gid = uuid(), tid = uuid();
      await s.put({ id: gid, type: 'group', name: 'g' });
      await s.put({ id: tid, type: 'trip', groupId: gid, title: `${nDays} 天行程`, region: '宜蘭', allowWiki: false });
      for (let d = 1; d <= nDays; d++) {
        for (let k = 0; k < 2; k++) {
          await s.put({ id: uuid(), type: 'spot', tripId: tid, name: `第${d}天景點${k + 1}`, emoji: '📍', day: d, order: k });
        }
      }
      const canvas = document.createElement('canvas');
      const first = await pi.renderPreview(canvas, tid, 'watercolor', 0);
      const seenDays = [];
      for (let pg = 0; pg < first.pages; pg++) {
        const info = await pi.renderPreview(canvas, tid, 'watercolor', pg);
        seenDays.push(info.label);
      }
      const out = await pi.renderPoster(tid, {});
      const lastPage = await pi.renderPreview(canvas, tid, 'watercolor', first.pages - 1);
      return { pages: first.pages, seenDays, exported: out.length, labels: out.map((x) => x.label),
        lastPng: nDays === 3 ? canvas.toDataURL('image/jpeg', 0.85) : null, lastLabel: lastPage.label };
    }, nDays);
    yes(r.pages === nDays, `${nDays} 天 → 預覽有 ${r.pages} 張可以翻（舊版只畫前 2 天）`, JSON.stringify(r));
    yes(r.seenDays.length === nDays && r.seenDays[nDays - 1].includes(`${nDays}`), `翻到最後一張是第 ${nDays} 天（${r.seenDays.join('、')}）`);
    yes(r.exported === nDays, `匯出 ${r.exported} 張（每天一張，一天不少）`, r.labels.join('、'));
    if (r.lastPng) await savePng(`海報-3天-預覽翻到第3天`, r.lastPng);
  }
  // 2 天：單張、不出現翻頁
  const two = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const pi = await import('./js/poster/index.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '2 天', region: '宜蘭', allowWiki: false });
    for (let d = 1; d <= 2; d++) await s.put({ id: uuid(), type: 'spot', tripId: tid, name: `D${d}`, emoji: '📍', day: d, order: 0 });
    const canvas = document.createElement('canvas');
    const info = await pi.renderPreview(canvas, tid, 'watercolor', 0);
    return { pages: info.pages, exported: (await pi.renderPoster(tid, {})).length };
  });
  yes(two.pages === 1 && two.exported === 1, '2 天維持單張（預覽 1 張、匯出 1 張）');

  // 海報頁 UI：翻頁列真的出現、按鈕能翻
  const tid3 = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '三日遊', region: '宜蘭', allowWiki: false });
    for (let d = 1; d <= 3; d++) await s.put({ id: uuid(), type: 'spot', tripId: tid, name: `第${d}天的景點`, emoji: '📍', day: d, order: 0 });
    return tid;
  });
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid3}/poster`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pager:not([hidden])', { timeout: 30000 });
  const pgr = await page.evaluate(() => ({
    lbl: document.querySelector('.pager-lbl').textContent,
    prevVis: getComputedStyle(document.querySelector('.pager-btn')).visibility,
  }));
  yes(pgr.lbl === '第 1 天 / 共 3 天', `翻頁列文字一句講完：「${pgr.lbl}」`);
  yes(pgr.prevVis === 'hidden', '第一張時「‹ 前一張」是藏起來的');
  await page.click('.pager-btn:last-of-type');
  await page.waitForFunction(() => document.querySelector('.pager-lbl').textContent === '第 2 天 / 共 3 天', { timeout: 20000 });
  ok('按「下一張」翻到第 2 天');
  await page.click('.pager-btn:last-of-type');
  await page.waitForFunction(() => document.querySelector('.pager-lbl').textContent === '第 3 天 / 共 3 天', { timeout: 20000 });
  const lastVis = await page.evaluate(() => getComputedStyle(document.querySelector('.pager-btn:last-of-type')).visibility);
  yes(lastVis === 'hidden', '最後一張時「下一張 ›」是藏起來的');
  await page.screenshot({ path: fileURLToPath(new URL('海報頁-翻頁列.png', OUT)) });
  console.log('  📸 海報頁-翻頁列');

  // ================= 2. 預覽進度條 =================
  console.log('\n— 回憶影片：可拖的進度條 —');
  const tidV = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), m = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: m, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '進度條測試', region: '宜蘭', allowWiki: false });
    const sid = uuid();
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '夜市', emoji: '📍', day: 1, order: 0, lat: 24.67, lng: 121.77 });
    const sid2 = uuid();
    await s.put({ id: sid2, type: 'spot', tripId: tid, name: '公園', emoji: '📍', day: 1, order: 1, lat: 24.75, lng: 121.75 });
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 800; c.height = 1100;
      const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 60},60%,50%)`; x.fillRect(0, 0, 800, 1100);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    for (let i = 0; i < 6; i++) {
      const q = uuid();
      await s.put({ id: q, type: 'quest', tripId: tid, spotId: i % 2 ? sid2 : sid, title: `任務${i}`, kind: 'thing', order: i });
      await importPhoto(new File([await mk(i)], 'p.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q, memberId: m, allowGeo: false });
    }
    return tid;
  });
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tidV}/album`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.scrub-knob');
  await sleep(1200);
  const t0 = await page.evaluate(() => document.querySelector('.scrub-time').textContent);
  yes(/\d:\d\d \/ \d:\d\d/.test(t0), `有「目前時間 / 總長」顯示：${t0}`);
  // 用滑鼠把進度條拖到約 80%
  const barBox = await (await page.$('.scrub')).boundingBox();
  await page.mouse.move(barBox.x + barBox.width * 0.1, barBox.y + barBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(barBox.x + barBox.width * 0.8, barBox.y + barBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(600);
  const after = await page.evaluate(() => document.querySelector('.scrub-time').textContent);
  const [cur, dur] = after.split(' / ').map((x) => { const [m, ss] = x.split(':').map(Number); return m * 60 + ss; });
  yes(cur >= dur * 0.6, `拖到約 80% 位置後時間跳到 ${after}（不用從頭看）`);
  const filled = await page.evaluate(() => parseFloat(document.querySelector('.scrub > i').style.width));
  yes(filled >= 60, `進度條填滿 ${filled.toFixed(0)}%，跟拖的位置一致`);
  // 播放 → 暫停 → 繼續
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /播放預覽|繼續播放/.test(b.textContent))?.click());
  await sleep(900);
  const btn1 = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).find((x) => x.includes('暫停')));
  yes(!!btn1, '播放中按鈕變成「⏸ 暫停」');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('暫停'))?.click());
  await sleep(300);
  const paused = await page.evaluate(() => document.querySelector('.scrub-time').textContent);
  await sleep(700);
  const paused2 = await page.evaluate(() => document.querySelector('.scrub-time').textContent);
  yes(paused === paused2, `暫停後時間停住（${paused}）`);
  const btn2 = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).find((x) => x.includes('繼續播放')));
  yes(!!btn2, '暫停後按鈕變成「▶ 繼續播放」');
  await page.screenshot({ path: fileURLToPath(new URL('回憶頁-進度條.png', OUT)) });
  console.log('  📸 回憶頁-進度條');

  // ================= 1. 照片牆移除徽章入口 =================
  console.log('\n— 照片牆 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tidV}/people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  const hasBadgeBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('看成就徽章')));
  yes(!hasBadgeBtn, '照片牆已無「看成就徽章」入口（回顧分頁本來就有）');

  console.log('\nv1.47 驗證結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
