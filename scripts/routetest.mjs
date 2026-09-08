// 規劃行程・第 2 批：移動時間矩陣、時刻鏈、排順序建議（npm run routetest）
//
// 投票決議的驗收點：
//   ① 一天一個 /table 請求（N 個點只打一次），重排 20 次不再打網路（快取矩陣）
//   ② OSRM 掛掉／離線 → 退回直線×係數，UI 明講是估的，功能不壞
//   ③ 時刻鏈：固定時間優先、推算晚於預定標 ⚠、停留未設用 1 小時推算並明講
//   ④ 排順序：最近鄰+2-opt，總移動不劣於現況；📌 釘住的永不移動；
//     永遠先預覽、按「套用」才寫入；套用後拖拉照常
//   ⑤ 沒座標的景點：排順序前擋下並引導「自動找出位置」

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5517, OSRM = 5518;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

// 假 OSRM：durations = 兩點直線距離（公尺）÷ 10（好驗證、可預測）
let tableHits = 0;
let osrmDown = false;
const osrmSrv = createServer((req, res) => {
  if (osrmDown) { res.writeHead(503); return res.end('down'); }
  const m = req.url.match(/\/table\/v1\/[a-z]+\/([^?]+)/);
  if (!m) { res.writeHead(404); return res.end(); }
  tableHits++;
  const pts = m[1].split(';').map((c) => c.split(',').map(Number));   // [lng,lat]
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const dist = (a, b) => {
    const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const durations = pts.map((a) => pts.map((b) => dist(a, b) / 10));
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ code: 'Ok', durations }));
}).listen(OSRM);
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
page.on('dialog', (d) => d.accept());

try {
  await page.evaluateOnNewDocument((u) => { window.__TQ_OSRM_ENDPOINT = u; }, `http://localhost:${OSRM}`);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 一天五個點，故意排成之字形（0.01 度 ≈ 1.1km）：
  // A(0,0) C(0,0.02) B(0,0.01) E(0,0.04) D(0,0.03) —— 最佳應是 A B C D E
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '排序測試', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-01', allowWiki: false });
    const mk = async (name, order, lng, extra = {}) => {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name, emoji: '📍', day: 1, order,
        lat: 24.6, lng: 121.7 + lng, ...extra });
      return id;
    };
    const A = await mk('起點A', 0, 0, { startMin: 9 * 60, stayMin: 30 });
    const C = await mk('景點C', 1, 0.02, { stayMin: 30 });
    const B = await mk('景點B', 2, 0.01, { stayMin: 30 });
    const E = await mk('景點E', 3, 0.04, { stayMin: 30 });
    const D = await mk('景點D', 4, 0.03, { stayMin: 30, startMin: 13 * 60 });   // 有訂位時間
    return { tid, A, B, C, D, E };
  });

  // ---------- 純函式層 ----------
  console.log('— route.js 純函式 —');
  const core = await page.evaluate(async (ids) => {
    const s = await import('./js/store.js');
    const r = await import('./js/route.js');
    const inDay = s.spotsOf(ids.tid).sort((a, b) => a.order - b.order);
    const pts = inDay.map((x) => ({ lat: x.lat, lng: x.lng }));
    const m1 = await r.travelMatrix(pts, 'drive');
    const m2 = await r.travelMatrix(pts, 'drive');   // 第二次要吃快取
    const chain = r.chainTimes(inDay, m1, 'drive');
    const sug = r.suggestOrder(inDay, m1);
    return {
      src: m1.src, same: m1 === m2 || JSON.stringify(m1.sec) === JSON.stringify(m2.sec),
      sec01: m1.sec[0][1],
      chain: chain.map((c) => ({ a: c.arrive, l: c.late, t: c.travel })),
      order: sug.order.map((i) => inDay[i].name),
      before: sug.before, after: sug.after, changed: sug.changed,
    };
  }, ids);
  yes(core.src === 'osrm', '矩陣來源是 OSRM（假伺服器）');
  yes(tableHits === 1, `一天只打 1 個 /table 請求（實際 ${tableHits}）`);
  yes(core.same, '同一組點第二次取矩陣走快取');
  yes(core.chain[0].a === 540, '第一個點 09:00 出發（固定時間）');
  yes(core.chain[1].t != null && core.chain[1].a > 540, `第二點有移動時間（${core.chain[1].t}s）與推算到達`);
  yes(core.changed && core.order.join('') === '起點A景點B景點C景點D景點E',
    `之字形被排直：${core.order.join(' → ')}（${Math.round(core.before / 60)} 分 → ${Math.round(core.after / 60)} 分）`);
  yes(core.after < core.before, '建議的總移動時間變短');

  // 📌 釘住：把 C 釘在第 2 位（index 1），建議不可移動它
  const pinned = await page.evaluate(async (ids) => {
    const s = await import('./js/store.js');
    const r = await import('./js/route.js');
    await s.patch(ids.C, { pinned: true });
    const inDay = s.spotsOf(ids.tid).sort((a, b) => a.order - b.order);
    const pts = inDay.map((x) => ({ lat: x.lat, lng: x.lng }));
    const m = await r.travelMatrix(pts, 'drive');
    const sug = r.suggestOrder(inDay, m);
    const names = sug.order.map((i) => inDay[i].name);
    await s.patch(ids.C, { pinned: false });
    return { pos: names.indexOf('景點C'), names };
  }, ids);
  yes(pinned.pos === 1, `📌 釘住的景點位置不動（仍在第 ${pinned.pos + 1} 位：${pinned.names.join(' → ')}）`);

  // 降級：OSRM 掛掉 → est
  osrmDown = true;
  const down = await page.evaluate(async () => {
    const r = await import('./js/route.js');
    const pts = [{ lat: 24.6, lng: 121.75 }, { lat: 24.65, lng: 121.72 }];
    const m = await r.travelMatrix(pts, 'drive');
    return { src: m.src, sec: m.sec[0][1] };
  });
  yes(down.src === 'est' && down.sec > 0, `OSRM 掛掉 → 退回直線×係數（${Math.round(down.sec / 60)} 分），功能不壞`);
  osrmDown = false;

  // ---------- UI 層 ----------
  console.log('\n— 調整行程頁 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelectorAll('.plan-travel-note').length >= 3, { timeout: 20000 });
  const ui = await page.evaluate(() => ({
    travel: [...document.querySelectorAll('.plan-travel-note')].map((x) => x.textContent),
    eta: [...document.querySelectorAll('.plan-eta:not([hidden])')].map((x) => x.textContent),
    warn: document.querySelectorAll('.plan-eta.warn').length,
    opt: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('排順序')),
    addBtns: [...document.querySelectorAll('button')].filter((b) => /加一天|減一天/.test(b.textContent))
      .map((b) => ({ t: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width) })),
    exportBlock: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('匯出成文字'));
      return b ? { w: Math.round(b.getBoundingClientRect().width), oneLine: b.scrollWidth <= b.clientWidth + 1 } : null; })(),
    note: document.querySelector('.plan-src-note')?.textContent || '',
    pins: document.querySelectorAll('.plan-pin').length,
  }));
  yes(ui.travel.length === 4 && ui.travel[0].includes('約'), `兩點之間有移動小標 ×${ui.travel.length}（${ui.travel[0].trim()}）`);
  yes(ui.eta.some((x) => x.includes('約') && x.includes('到')), '沒固定時間的點顯示「約 HH:MM 到」');
  yes(ui.opt, '有「✨ 排順序」按鈕');
  // v1.51.3：交通切換已依使用者要求移除 —— 不可以再出現
  yes(ui.addBtns.length === 2 && Math.abs(ui.addBtns[0].w - ui.addBtns[1].w) <= 1,
    `加一天／減一天等寬（${ui.addBtns.map((x) => x.t + '=' + x.w + 'px').join('、')}）`);
  yes(!!ui.exportBlock && ui.exportBlock.oneLine, `匯出成文字獨立滿版一列（${ui.exportBlock.w}px、單行）`);
  const noSeg = await page.evaluate(() => !document.querySelector('.plan-modeseg')
    && ![...document.querySelectorAll('button')].some((b) => /開車|步行/.test(b.textContent)));
  yes(noSeg, '開車／步行切換已移除');
  yes(ui.note.includes('粗略估計') && ui.note.includes('不含大眾運輸'),
    `來源標示誠實：「${ui.note.slice(0, 34)}…」`);
  yes(ui.pins === 5, '每一列都有 📌 釘住鈕');

  // 工具區排版（實機回報四顆擠一列全折行）：兩層、全部不折行，360px＋特大字級也要
  const toolCheck = () => page.evaluate(() => {
    const q = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
    const rowTop = (el) => Math.round(el.getBoundingClientRect().top);
    const btns = [...document.querySelectorAll('.plan-day-tools .btn')]
      .concat([[...document.querySelectorAll('button')].find((b) => b.textContent.includes('匯出成文字'))]);
    const noWrap = btns.map((b) => ({ t: b.textContent.trim(), oneLine: b.scrollWidth <= b.clientWidth + 1 }));
    return {
      dayRowSame: Math.abs(rowTop(q('加一天')) - rowTop(q('減一天'))) <= 3,
      exportBelow: rowTop(q('匯出成文字')) - rowTop(q('加一天')) > 20,
      wrapped: noWrap.filter((x) => !x.oneLine).map((x) => x.t),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  let tc = await toolCheck();
  yes(tc.dayRowSame && tc.exportBelow, '天數控制同一列、匯出在下一列');
  yes(!tc.wrapped.length && !tc.overflow, '390px：工具按鈕不折行', tc.wrapped.join('、'));
  await page.setViewport({ width: 360, height: 780 });
  await page.evaluate(async () => (await import('./js/prefs.js')).setPref('fs', 'xl'));
  await sleep(500);
  tc = await toolCheck();
  yes(!tc.wrapped.length && !tc.overflow && tc.dayRowSame,
    '360px＋特大字級：文字不折行、不橫向溢出', tc.wrapped.join('、'));
  await page.evaluate(async () => (await import('./js/prefs.js')).setPref('fs', 'm'));
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  // 入口不重複：零景點的調整行程頁，「搜尋加入」「加景點」各只出現一組
  const emptyTid = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '空', region: '宜蘭', allowWiki: false });
    return tid;
  });
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${emptyTid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  const dedupe = await page.evaluate(() => ({
    search: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('搜尋景點加入第')).length,
    add: [...document.querySelectorAll('button')].filter((b) => /加景點到|新增第一個/.test(b.textContent)).length,
  }));
  yes(dedupe.search === 1 && dedupe.add === 0,
    `零景點時只有一顆「搜尋景點加入第 1 天」（手動入口已收進搜尋頁；加景點鈕 ${dedupe.add} 顆）`);
  // 行程頁零景點：「去安排景點」帶去調整行程，不再彈簡易輸入框
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${emptyTid}`, { waitUntil: 'networkidle0' });
  await sleep(600);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('去安排景點')).click());
  await sleep(600);
  const landed = await page.evaluate(() => ({
    hash: location.hash.includes('/plan'),
    dialog: !!document.querySelector('.modal-card'),
  }));
  yes(landed.hash && !landed.dialog, '行程頁「去安排景點」直達調整行程，不彈簡易輸入框');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-travel-note', { timeout: 20000 });

  // 排順序 → 預覽 → 套用
  const hitsBefore = tableHits;
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('排順序')).click());
  await page.waitForSelector('.modal-card', { timeout: 20000 });
  const preview = await page.evaluate(() => ({
    txt: document.querySelector('.modal-card').textContent,
    items: [...document.querySelectorAll('.opt-list li')].map((x) => x.textContent),
  }));
  yes(preview.txt.includes('→') && preview.txt.includes('估計'), '預覽顯示 總移動 前→後（估計值）');
  yes(preview.items.length === 5, `預覽列出 ${preview.items.length} 個景點的新順序`);
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.includes('套用')).click());
  await sleep(800);
  const applied = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    return s.spotsOf(tid).sort((a, b) => a.order - b.order).map((x) => x.name);
  }, ids.tid);
  yes(applied.join('') === '起點A景點B景點C景點D景點E', `套用後寫入新順序：${applied.join(' → ')}`);
  yes(tableHits === hitsBefore, '排順序＋套用全程 0 個新網路請求（吃快取矩陣）');

  // 套用後拖拉還能用（把 E 往前一格 → ▲）
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.plan-row')];
    const last = rows[rows.length - 1];
    last.querySelector('.plan-arrow')?.click();   // ▲
  });
  await sleep(700);
  const nudged = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    return s.spotsOf(tid).sort((a, b) => a.order - b.order).map((x) => x.name).join('');
  }, ids.tid);
  yes(nudged === '起點A景點B景點C景點E景點D', '套用後 ▲▼ 微調照常運作');

  // ⑤ 沒座標的擋下
  const noCoordMsg = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '沒座標的店', emoji: '🍜', day: 1, order: 9 });
    return true;
  }, ids.tid);
  void noCoordMsg;
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('排順序')).click());
  await sleep(600);
  const toastTxt = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  yes(toastTxt.includes('沒有座標'), `沒座標時擋下並引導：「${toastTxt.slice(0, 30)}…」`);

  // 建立行程頁有「幫我規劃」入口
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  const planner = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('幫我規劃行程')));
  yes(planner, '建立行程頁有「🔍 幫我規劃行程」入口');

  console.log('\n規劃第 2 批測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); osrmSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
