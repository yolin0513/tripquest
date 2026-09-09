// 相簿檢視與全螢幕檢視器（npm run albumtest，v1.57）：
//   · 照片分頁預設「相簿」格狀，可切「動態」；排序／景點篩選沿用
//   · 依天分組、每天一個貼頂標題；200 張時只解碼可視範圍附近的縮圖（延遲載入）
//   · 點格子 → 全螢幕：計數、左右切換、雙擊放大、✕ 關閉、Android 返回鍵關閉、Esc
//   · 檢視器內按讚／留言 → 跟照片牆同一套記錄（動態流的數字跟著變）
//   · 縮圖已到、全圖未到：先秀縮圖，全圖到了無縫換上
//   · 觸控區 ≥ 48px；動態流點照片也進檢視器，標記從 ✏️ 進

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5581;
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

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  // 3 天 × 70 張 = 210 張（不同色塊，含拍攝時間分佈到三天）
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '相簿測試團' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '相簿測試', region: '宜蘭', startDate: '2026-08-01', endDate: '2026-08-03', allowWiki: false });
    const quests = [];
    for (let d = 1; d <= 3; d++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: `第${d}天景點`, emoji: '📍', day: d, order: 0 });
      const qid = uuid();
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `任務${d}`, kind: 'thing', order: 0 });
      quests.push(qid);
    }
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); x.fillStyle = `hsl(${(i * 37) % 360},60%,50%)`; x.fillRect(0, 0, 640, 480); x.fillStyle = '#fff'; x.font = '120px sans-serif'; x.fillText(String(i), 200, 300); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); };
    let n = 0;
    for (let d = 1; d <= 3; d++) for (let k = 0; k < 70; k++) {
      await importPhoto(new File([await mk(n)], `p${n}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: quests[d - 1], memberId: n % 2 ? mB : mA, allowGeo: false });
      n++;
    }
    const subs = s.submissionsOfTrip(tid);
    return { tid, gid, n, firstId: subs[0].id };
  });
  console.log(`  種了 ${ids.n} 張照片\n`);

  // ---------- 相簿格狀 ----------
  console.log('— 相簿（格狀）—');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pg-grid', { timeout: 15000 });
  await sleep(800);
  const g = await page.evaluate(() => ({
    modeOn: document.querySelector('.wall-mode.on')?.textContent.trim(),
    days: [...document.querySelectorAll('.pg-day')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
    cells: document.querySelectorAll('.pg-cell').length,
    loaded: document.querySelectorAll('.pg-cell[data-loaded]').length,
    withSrc: [...document.querySelectorAll('.pg-cell img')].filter((i) => i.src).length,
    cellPx: Math.round(document.querySelector('.pg-cell').getBoundingClientRect().width),
    feedItems: document.querySelectorAll('.feed-item').length,
    modeBtnH: Math.round(document.querySelector('.wall-mode').getBoundingClientRect().height),
  }));
  yes(g.modeOn && g.modeOn.includes('相簿'), `預設是「${g.modeOn}」檢視`);
  yes(g.cells === 210 && g.feedItems === 0, `格狀 ${g.cells} 格、沒有動態流卡片`);
  yes(g.days.length === 3 && g.days[0].includes('第 1 天') && g.days[0].includes('8/1') && g.days[0].includes('70 張'), `依天分組：${g.days.join(' ／ ')}`);
  yes(g.loaded < 210 && g.loaded >= 9, `延遲載入：210 格只先解碼可視範圍附近 ${g.loaded} 格`);
  yes(g.cellPx >= 100 && g.modeBtnH >= 44, `格子 ${g.cellPx}px、切換鈕 ${g.modeBtnH}px（觸控區夠）`);
  // 捲到底 → 後面的格子才載
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(900);
  const loaded2 = await page.evaluate(() => document.querySelectorAll('.pg-cell[data-loaded]').length);
  yes(loaded2 > g.loaded, `捲動後繼續載（${g.loaded} → ${loaded2}）`);
  await page.evaluate(() => window.scrollTo(0, 0));

  // 景點篩選沿用：只看第 2 天景點 → 70 格、一個分組
  await page.evaluate(() => { localStorage.setItem('tripquest.wall.' + location.hash.split('/')[2], JSON.stringify({ sort: 'new', spot: '', untagged: false, mode: 'grid' })); });
  const filt = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const sp = s.spotsOf(tid).find((x) => x.day === 2);
    localStorage.setItem('tripquest.wall.' + tid, JSON.stringify({ sort: 'old', spot: sp.id, untagged: false, mode: 'grid' }));
    return sp.id;
  }, ids.tid);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pg-grid', { timeout: 15000 });
  const f = await page.evaluate(() => ({ cells: document.querySelectorAll('.pg-cell').length, days: document.querySelectorAll('.pg-day').length, title: document.querySelector('.wall-bar-title')?.textContent }));
  yes(f.cells === 70 && f.days === 1 && f.title.includes('70'), `景點篩選沿用：${f.title}、${f.days} 個分組`);
  void filt;

  // ---------- 全螢幕檢視 ----------
  console.log('\n— 全螢幕檢視 —');
  await page.evaluate((tid) => localStorage.setItem('tripquest.wall.' + tid, JSON.stringify({ sort: 'old', spot: '', untagged: false, mode: 'grid' })), ids.tid);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/people`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pg-grid', { timeout: 15000 });
  await sleep(500);
  await page.evaluate(() => document.querySelectorAll('.pg-cell')[4].click());
  await page.waitForSelector('.pv', { timeout: 8000 });
  await sleep(600);
  const v = await page.evaluate(() => {
    const pv = document.querySelector('.pv');
    const r = (el) => el.getBoundingClientRect();
    return {
      counter: pv.querySelector('.pv-counter').textContent,
      imgSrc: !!pv.querySelectorAll('.pv-slide')[1].querySelector('img').src,
      imgOnScreen: (() => { const b = pv.querySelectorAll('.pv-slide')[1].querySelector('img').getBoundingClientRect(); return b.width > 100 && b.left >= 0 && b.right <= window.innerWidth + 1; })(),
      closeH: Math.round(r(pv.querySelector('.pv-close')).height),
      reactH: Math.round(r(pv.querySelector('.pv-react')).height),
      reacts: pv.querySelectorAll('.pv-react').length,
      cbtn: pv.querySelector('.pv-cbtn').textContent,
      full: pv.querySelectorAll('.pv-slide')[1].querySelector('img').dataset.full === '1',
      cap: pv.querySelector('.pv-cap-2').textContent,
    };
  });
  yes(v.counter === '5 / 210' && v.imgSrc && v.imgOnScreen, `點第 5 格 → 全螢幕「${v.counter}」、圖片有載且在畫面中央（不是黑的）`);
  yes(v.closeH >= 48 && v.reactH >= 44 && v.reacts === 4, `✕ ${v.closeH}px、按讚鈕 ${v.reactH}px、四種讚`);
  yes(v.full, '縮圖先秀、全圖到了無縫換上（本機兩份都在 → 已是全圖）');
  yes(v.cap.includes('第1天景點') && v.cap.includes('任務1'), `說明列：${v.cap}`);
  // 轉場逐幀驗證（v1.57.1 修閃爍；照 v1.49 flashback=0 的做法）：連滑 8 次，
  // 每一個 rAF 幀檢查 (a) 畫面中央永遠有一張已解碼的圖蓋住（沒有空/黑幀）
  // (b) 圖的版面寬度不變（縮圖→全圖不跳尺寸）。修正前：重建那一幀中央沒有圖。
  const frameScan = await page.evaluate(async () => {
    const pv = document.querySelector('.pv');
    const stage = pv.querySelector('.pv-stage');
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let frames = 0, blank = 0, widths = new Set();
    let run = true;
    const tick = () => {
      if (!run) return;
      frames++;
      const els = document.elementsFromPoint(cx, cy);
      const img = els.find((e) => e.tagName === 'IMG' && e.classList.contains('pv-img'));
      if (!img || !img.currentSrc || !img.naturalWidth) blank++;
      else widths.add(Math.round(img.getBoundingClientRect().width));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (let k = 0; k < 8; k++) { pv.__tq.go(1); await new Promise((res) => setTimeout(res, 380)); }
    run = false;
    return { frames, blank, widths: [...widths] };
  });
  yes(frameScan.blank === 0, `連滑 8 張、逐幀掃 ${frameScan.frames} 幀：中央空/黑幀 = ${frameScan.blank}（修正前重建瞬間會空一幀）`);
  yes(frameScan.widths.length === 1, `圖片版面寬度全程一致（${frameScan.widths.join('、')}px —— 縮圖不再以原始小尺寸置中）`);
  // 掃完回到原本的第 5+8 張沒錯位
  const c1b = await page.evaluate(() => document.querySelector('.pv-counter').textContent);
  yes(c1b === '13 / 210', `連滑後計數正確（${c1b}）`);

  // 右鍵／左鍵切換
  await page.keyboard.press('ArrowRight'); await sleep(450);
  await page.keyboard.press('ArrowRight'); await sleep(450);
  await page.keyboard.press('ArrowLeft'); await sleep(450);
  const c2 = await page.evaluate(() => document.querySelector('.pv-counter').textContent);
  yes(c2 === '14 / 210', `→ → ← 之後在「${c2}」（逐幀掃描後從 13 出發）`);
  // 雙擊放大
  const stageBox = await page.evaluate(() => { const r = document.querySelector('.pv-stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(stageBox.x, stageBox.y); await sleep(80); await page.mouse.click(stageBox.x, stageBox.y); await sleep(200);
  const z1 = await page.evaluate(() => document.querySelector('.pv').__tq.scale);
  await page.mouse.click(stageBox.x, stageBox.y); await sleep(80); await page.mouse.click(stageBox.x, stageBox.y); await sleep(200);
  const z2 = await page.evaluate(() => document.querySelector('.pv').__tq.scale);
  yes(z1 === 2.5 && z2 === 1, `雙擊放大到 ${z1}x、再雙擊還原 ${z2}x`);
  // 按讚 → 記錄與動態流一致（第一次會問「這是誰的手機？」→ 選媽媽）
  await page.evaluate(() => document.querySelector('.pv-react').click());
  await sleep(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-card button')].find((x) => x.textContent.includes('媽媽')); b && b.click(); });
  await sleep(700);
  const liked = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const pv = document.querySelector('.pv');
    const on = pv.querySelector('.pv-react.on')?.textContent || '';
    const subs = s.submissionsOfTrip(tid).sort((a, b) => (a.takenAt || a.createdAt) - (b.takenAt || b.createdAt));
    return { on, reacts: s.reactionsOf(subs[pv.__tq.index].id).length };
  }, ids.tid);
  yes(liked.on.includes('❤️') && liked.on.includes('1') && liked.reacts === 1, `檢視器按 ❤️ → 同一筆 reaction 記錄（${liked.on.trim()}）`);
  // 留言
  await page.evaluate(() => document.querySelector('.pv-cbtn').click());
  await sleep(300);
  await page.type('.pv-cadd .field', '這張拍得真好');
  await page.keyboard.press('Enter');
  await sleep(600);
  const cm = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const pv = document.querySelector('.pv');
    const subs = s.submissionsOfTrip(tid).sort((a, b) => (a.takenAt || a.createdAt) - (b.takenAt || b.createdAt));
    return { list: document.querySelector('.pv-clist').textContent, n: s.commentsOf(subs[pv.__tq.index].id).length, btn: document.querySelector('.pv-cbtn').textContent };
  }, ids.tid);
  yes(cm.n === 1 && cm.list.includes('這張拍得真好') && cm.btn.includes('1'), `檢視器留言 → 同一套 comment 記錄（${cm.btn.trim()}）`);
  await page.evaluate(() => document.querySelector('.pv-sheet .pv-btn').click());
  // ✕ 關閉（走 history.back）→ 回到相簿頁、數字更新
  await page.evaluate(() => document.querySelector('.pv-close').click());
  await sleep(700);
  const closed = await page.evaluate(() => ({ pv: !!document.querySelector('.pv'), hash: location.hash, likes: document.querySelectorAll('.pg-likes').length }));
  yes(!closed.pv && closed.hash.includes('/people'), '✕ 關閉 → 回到相簿頁（沒有退出行程）');
  yes(closed.likes === 1, '格子上的 ❤️ 數字跟著更新');
  // Android 返回鍵（history.back）也關
  await page.evaluate(() => document.querySelectorAll('.pg-cell')[0].click());
  await page.waitForSelector('.pv', { timeout: 8000 });
  await page.goBack(); await sleep(600);
  const backClosed = await page.evaluate(() => ({ pv: !!document.querySelector('.pv'), hash: location.hash }));
  yes(!backClosed.pv && backClosed.hash.includes('/people'), '實體返回鍵 → 只關檢視器，仍在相簿頁');
  // Esc 也關
  await page.evaluate(() => document.querySelectorAll('.pg-cell')[1].click());
  await page.waitForSelector('.pv', { timeout: 8000 });
  await page.keyboard.press('Escape'); await sleep(600);
  yes(await page.evaluate(() => !document.querySelector('.pv')), 'Esc 關閉');

  // ---------- 動態流：點照片也進檢視器；切換記住 ----------
  console.log('\n— 動態流 —');
  await page.evaluate(() => [...document.querySelectorAll('.wall-mode')].find((b) => b.textContent.includes('動態')).click());
  await page.waitForSelector('.feed-item', { timeout: 15000 });
  await sleep(500);
  const feed = await page.evaluate(() => ({ items: document.querySelectorAll('.feed-item').length, grid: document.querySelectorAll('.pg-grid').length }));
  yes(feed.items > 0 && feed.grid === 0, `切到動態：${feed.items} 張卡片、無格狀`);
  await page.evaluate(() => document.querySelector('.fi-photo-btn').click());
  await page.waitForSelector('.pv', { timeout: 8000 });
  yes(await page.evaluate(() => !!document.querySelector('.pv .pv-tag')), '動態流點照片 → 檢視器（有 ✏️ 標記入口）');
  await page.keyboard.press('Escape'); await sleep(500);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/people`, { waitUntil: 'networkidle0' });
  await sleep(600);
  yes(await page.evaluate(() => document.querySelector('.wall-mode.on')?.textContent.includes('動態')), '檢視選擇有記住');

  console.log('\n相簿測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
