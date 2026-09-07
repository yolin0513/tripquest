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
      const noOverlap = (rects) => {
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          if (hit(rects[i], rects[j])) return JSON.stringify([rects[i], rects[j]]);
        }
        return null;
      };
      const ovRects = L.overview.labels.map((x) => x.rect);
      const zRects = L.zoomView ? L.zoomView.labels.map((x) => x.rect) : [];
      const overlap = noOverlap(ovRects) || noOverlap(zRects);
      const outside = [...ovRects, ...zRects].find((r) => r.x0 < 0 || r.x1 > 1080 || r.y0 < 0 || r.y1 > 1920);
      // 實際畫面：全景（38%）與特寫（92%）各拍一張
      const player = await mem.createPlayer(c, tid, { length: 'full' });
      const t = await mem.buildTimeline(tid, { length: 'full' });
      const mapSeg = t.segs.find((x) => x.kind === 'map');
      const snap = async (frac) => {
        player.seek(mapSeg.start + mapSeg.dur * frac);
        await new Promise((r) => setTimeout(r, 250));
        player.seek(mapSeg.start + mapSeg.dur * frac);
        return c.toDataURL('image/png');
      };
      const png = await snap(0.38);
      const pngZoom = L.zoomView ? await snap(0.92) : null;
      player.destroy();
      return {
        png, pngZoom, overlap, outside: outside ? JSON.stringify(outside) : null,
        labels: L.overview.labels.length, cluster: L.cluster ? L.cluster.count : 0,
        clusterLabel: L.cluster ? L.cluster.label : '',
        zoomLabeled: L.zoomView ? L.zoomView.labels.length : 0,
        zoomVisible: L.zoomView ? L.zoomView.visible : 0,
        mapDur: mapSeg.dur,
        subtitle: L.subtitle, scale: L.overview.scaleBar.label,
      };
    }, sc);
    console.log(`  「${name}」 副標＝${res.subtitle}／比例尺＝${res.scale}`);
    yes(!res.overlap, `「${name}」標籤互不重疊`, res.overlap);
    yes(!res.outside, `「${name}」標籤都在畫面內`, res.outside);
    if (name.includes('十五個點')) {
      // 這正是換掉放大圈的理由：小圈只標得下 5 個，特寫用整個畫面幾乎全標得下
      yes(res.zoomLabeled >= Math.min(res.zoomVisible, 12),
        `特寫用整個畫面標名字：${res.zoomLabeled}/${res.zoomVisible} 個（放大圈時代只有 5 個）`);
    }
    if (name.includes('群聚')) {
      yes(res.cluster >= 3, `密集的 ${res.cluster} 個點收成一帶，地圖段加長做鏡頭推進（共 ${res.mapDur.toFixed(1)}s）`);
      yes(res.clusterLabel.startsWith('羅東一帶'), `群名用地名共同開頭：「${res.clusterLabel}」（不是縣市級的「宜蘭一帶」）`);
      yes(res.zoomLabeled === res.zoomVisible, `特寫裡每個地點都標到名字（${res.zoomLabeled}/${res.zoomVisible}）`);
    }
    if (sc.noCoord) yes(res.subtitle.includes(`${sc.coords.length + sc.noCoord} 個地點`), '副標誠實寫出「幾個地點、幾個有座標」', res.subtitle);
    await savePng(`路線圖-${name}-全景`, res.png);
    if (res.pngZoom) await savePng(`路線圖-${name}-特寫`, res.pngZoom);
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

  // 海報頁 UI：翻頁列真的出現、按鈕能翻。
  // 三天的長度故意差很大（7 / 1 / 4 個景點）—— 驗收標準是「翻頁時按鈕位置不動」
  const tid3 = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '三日遊', region: '宜蘭', allowWiki: false });
    const per = [7, 1, 4];
    for (let d = 1; d <= 3; d++) {
      for (let k = 0; k < per[d - 1]; k++) {
        await s.put({ id: uuid(), type: 'spot', tripId: tid, name: `第${d}天的景點${k + 1}`, emoji: '📍', day: d, order: k });
      }
    }
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
  // 翻頁時版面不可以跳：記下按鈕與預覽框的位置，翻兩次逐一比對
  const boxOf = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const canvasFits = () => page.evaluate(() => {
    const f = document.querySelector('.poster-frame').getBoundingClientRect();
    const c = document.querySelector('.poster-canvas').getBoundingClientRect();
    return c.height <= f.height + 1 && c.width <= f.width + 1;
  });
  const btn0 = await boxOf('.pager-btn:last-of-type');
  const frame0 = await boxOf('.poster-frame');
  yes(await canvasFits(), '第 1 天（7 個景點）：預覽縮在固定高度的框裡');
  await page.click('.pager-btn:last-of-type');
  await page.waitForFunction(() => document.querySelector('.pager-lbl').textContent === '第 2 天 / 共 3 天', { timeout: 20000 });
  await sleep(500);
  const btn1 = await boxOf('.pager-btn:last-of-type');
  const frame1 = await boxOf('.poster-frame');
  yes(JSON.stringify(btn1) === JSON.stringify(btn0), `翻到第 2 天（只有 1 個景點）按鈕位置一動不動（${JSON.stringify(btn1)}）`, `之前 ${JSON.stringify(btn0)}`);
  yes(frame1.h === frame0.h && frame1.y === frame0.y, `預覽框高度固定（${frame0.h}px），短的那天置中留白`);
  yes(await canvasFits(), '第 2 天：短海報置中、不撐開版面');
  await page.screenshot({ path: fileURLToPath(new URL('海報頁-翻頁-短的一天置中.png', OUT)) });
  console.log('  📸 海報頁-翻頁-短的一天置中');
  await page.click('.pager-btn:last-of-type');
  await page.waitForFunction(() => document.querySelector('.pager-lbl').textContent === '第 3 天 / 共 3 天', { timeout: 20000 });
  await sleep(500);
  const btn2 = await boxOf('.pager-btn:last-of-type');
  yes(JSON.stringify(btn2) === JSON.stringify(btn0), '翻到第 3 天按鈕位置還是一動不動');
  const lastVis = await page.evaluate(() => getComputedStyle(document.querySelector('.pager-btn:last-of-type')).visibility);
  yes(lastVis === 'hidden', '最後一張時「下一張 ›」是藏起來的');

  // 翻頁不可以閃（使用者錄影抽幀抓到：動畫結束後舊頁跳回來一幀）。
  // 逐幀監看整段轉場：① ghost 一旦開始滑動，就不准再回到位移 0 還留在畫面上
  // ②轉場期間 canvas 每一幀都要有內容（不是被 resize 清空的空白）
  const flick = await page.evaluate(() => new Promise((res) => {
    const frame = document.querySelector('.poster-frame');
    const cv = document.querySelector('.poster-canvas');
    const prevBtn = document.querySelector('.pager-btn');
    let flashback = 0, blank = 0, ghostSeen = false, moved = false, frames = 0;
    function tick() {
      const g = frame.querySelector('.poster-ghost');
      if (g) {
        ghostSeen = true;
        const t = getComputedStyle(g).transform;
        const x = t.startsWith('matrix') ? Math.abs(parseFloat(t.split(',')[4])) : 0;
        if (x > 6) moved = true;
        if (moved && x < 2) flashback++;          // 滑出去又跳回原位 = 閃回舊頁
      }
      try {
        const x2 = cv.getContext('2d').getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 4, 4).data;
        if (x2[3] === 0) blank++;                 // 透明 = 被 resize 清掉還沒畫
      } catch { /* noop */ }
      frames++;
      if (frames < 50) requestAnimationFrame(tick); else res({ flashback, blank, ghostSeen, frames });
    }
    prevBtn.click();                              // 翻回第 2 天，邊翻邊監看
    requestAnimationFrame(tick);
  }));
  yes(flick.ghostSeen, '轉場有滑動（有 ghost）');
  yes(flick.flashback === 0, `逐幀監看 ${flick.frames} 幀：舊頁沒有跳回來閃一下`, `flashback=${flick.flashback}`);
  yes(flick.blank === 0, `轉場期間 canvas 每一幀都有內容（blank=${flick.blank}）`);
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
  const pb1 = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).find((x) => x.includes('暫停')));
  yes(!!pb1, '播放中按鈕變成「⏸ 暫停」');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('暫停'))?.click());
  await sleep(300);
  const paused = await page.evaluate(() => document.querySelector('.scrub-time').textContent);
  await sleep(700);
  const paused2 = await page.evaluate(() => document.querySelector('.scrub-time').textContent);
  yes(paused === paused2, `暫停後時間停住（${paused}）`);
  const pb2 = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent).find((x) => x.includes('繼續播放')));
  yes(!!pb2, '暫停後按鈕變成「▶ 繼續播放」');
  await page.screenshot({ path: fileURLToPath(new URL('回憶頁-進度條.png', OUT)) });
  console.log('  📸 回憶頁-進度條');

  // 健檢釘住：播放中離開回憶頁，配樂必須停（AudioContext 要被關掉）
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const Orig = window.AudioContext;
    window.__ctxs = [];
    window.AudioContext = class extends Orig { constructor(...a) { super(...a); window.__ctxs.push(this); } };
  });
  await page.evaluate((tid) => { location.hash = `#/trip/${tid}/album`; }, tidV);
  await page.waitForSelector('.scrub-knob');
  await sleep(1000);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /播放預覽/.test(b.textContent))?.click());
  await sleep(1200);
  const playingCtx = await page.evaluate(() => window.__ctxs.filter((c) => c.state === 'running').length);
  await page.evaluate((tid) => { location.hash = `#/trip/${tid}`; }, tidV);
  await sleep(1200);
  const leftCtx = await page.evaluate(() => window.__ctxs.map((c) => c.state));
  yes(playingCtx >= 1, `播放中有 ${playingCtx} 個 AudioContext 在響`);
  yes(!leftCtx.includes('running'), `離開回憶頁後配樂全部停了（${JSON.stringify(leftCtx)}）`, leftCtx.join(','));

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
