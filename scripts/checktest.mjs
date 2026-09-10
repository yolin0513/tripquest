// 行程檢查與逐條套用（npm run checktest，v1.69）。
//
// 三代理投票的驗收點：
//   · 只報「無可爭議」的：前後顛倒、固定時段重疊、硬遲到、排到隔天（陳述不是警告）
//   · **不報**跨午夜、停留太短、一天太多、打烊（沒有資料源）
//   · 每套用一條就**重新偵測**（鏈式問題：修第一條後面的建議值就過期了）
//   · **套用當下重讀比對** —— 預覽開著時旅伴改了同一個景點，不能靜默蓋掉他
//   · 修正優先動 stayMin / order，**不新增 startMin**（那等於替使用者種下永久的固定約束）
//   · 可以復原；可以「這樣沒關係」，而且改了時間之後問題會重新出現（不是永久消音）
//   · 每天沒有人填時間時，用「這一天幾點出發」當推算起點，而且畫面要講出來

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5631;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

// 假 OSRM：不架的話會打到真的 routing.openstreetmap.de（實測被回 429）——
// 既慢、結果不決定性，還占用公共服務的額度。durations = 直線公尺 ÷ 10。
const OSRM = 5632;
const osrmSrv = createServer((req, res) => {
  const m = req.url.match(/\/table\/v1\/[a-z]+\/([^?]+)/);
  if (!m) { res.writeHead(404); return res.end(); }
  const pts = decodeURIComponent(m[1]).split(';').map((c) => c.split(',').map(Number));   // [lng,lat]
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const sec = pts.map((a) => pts.map((b) => {
    const dl = rad(b[1] - a[1]), dg = rad(b[0] - a[0]);
    const hh = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dg / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(hh)) / 10);
  }));
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ code: 'Ok', durations: sec }));
});
osrmSrv.listen(OSRM);

let pass = 0;
const yes = (c, m, extra = '') => { if (c) { pass++; console.log('✓ ' + m); } else { console.log('✗ ' + m + (extra ? ' — ' + extra : '')); process.exitCode = 1; } };
const fail = (m) => { console.log('✗ ' + m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((u) => { window.__TQ_OSRM_ENDPOINT = u; }, `http://localhost:${OSRM}`);
  page.on('console', (m) => { if (m.type() === 'error') console.log('   [console] ' + m.text().slice(0, 160)); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- 純函式：規則清單 ----------
  console.log('— 偵測規則 —');
  const rules = await page.evaluate(async () => {
    const { dayIssues } = await import('./js/plancheck.js');
    const r = await import('./js/route.js');
    const { loadThemes } = await import('./js/theme.js');
    await loadThemes();
    const osrm = (n) => ({ src: 'osrm', sec: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1800))) });
    const run = (spots, m) => {
      const mm = m || osrm(spots.length);
      const chain = r.chainTimes(spots, mm, 'drive');
      return dayIssues(spots, chain, r.timeConflicts(spots)).map((x) => ({ kind: x.kind, fix: x.fix, title: x.title, advice: x.advice, note: !!x.note, soft: !!x.soft }));
    };
    const sp = (id, name, o, startMin, stayMin, lat) => ({ id, name, day: 1, order: o, lat: lat ?? 25 + o * 0.05, lng: 121.5, startMin, stayMin });
    return {
      order: run([sp('a', '午餐', 0, 13 * 60, 60), sp('b', '景點', 1, 10 * 60, 60)]),
      overlap: run([sp('a', '午餐', 0, 13 * 60, 120), sp('b', '景點', 1, 14 * 60, 60, 25.0005)]),
      late: run([sp('a', 'A', 0, 9 * 60, 60), sp('b', 'B', 1, 10 * 60 + 5, 60)]),
      lateSoft: run([sp('a', 'A', 0, 9 * 60, 60), sp('b', 'B', 1, 10 * 60 + 5, 60)], { src: 'est', sec: osrm(2).sec }),
      lateTiny: run([sp('a', 'A', 0, 9 * 60, 60), sp('b', 'B', 1, 10 * 60 + 25, 60)]),
      midnight: run([sp('a', '夜市', 0, 23 * 60, 90), sp('b', '宵夜', 1, 60, 60)]),
      shortStay: run([sp('a', 'A', 0, 9 * 60, 30), sp('b', 'B', 1, undefined, 30)]),
      many: run(Array.from({ length: 8 }, (_, i) => sp('s' + i, 'S' + i, i, i === 0 ? 9 * 60 : undefined, 30))),
      overnight: run([sp('a', 'A', 0, 22 * 60, 120), sp('b', 'B', 1, undefined, 120)]),
      overnightGuess: run([sp('a', '夜市', 0, 22 * 60, undefined), sp('b', 'B', 1, undefined, undefined)]),
      clean: run([sp('a', 'A', 0, 9 * 60, 60), sp('b', 'B', 1, 11 * 60, 60)]),
    };
  });
  yes(rules.order.length === 1 && rules.order[0].kind === 'order' && rules.order[0].fix.type === 'swap',
    `前後顛倒 → 報，而且建議「對調順序」（只動 order，不新增 startMin）`);
  yes(rules.overlap.length === 1 && rules.overlap[0].fix.type === 'stay' && rules.overlap[0].fix.stayMin === 60,
    `固定時段重疊 → 報，建議把前一站停留改成 60 分（只動 stayMin）：「${rules.overlap[0].advice}」`);
  yes(rules.late.some((x) => x.kind === 'late' && x.fix && x.fix.type === 'stay'),
    `硬遲到 → 報，建議縮短前一站停留（不是幫使用者補一個新的固定時刻）`);
  yes(!rules.lateSoft.some((x) => x.kind === 'late'),
    '離線用直線估算時**不報**遲到（誤報成本遠高於漏報）');
  yes(!rules.lateTiny.some((x) => x.kind === 'late'),
    '晚不到 20 分**不報**（OSRM 本來就不含紅燈與找停車位）');
  yes(!rules.midnight.some((x) => !x.note),
    `23:00 夜市 → 01:00 宵夜**不報任何警告**（跨午夜是正當安排），只有「排到隔天」的陳述`);
  yes(!rules.shortStay.some((x) => /停留.*短|太短/.test(x.title)), '**不報**「停留時間太短」');
  yes(!rules.many.some((x) => /太多|太滿/.test(x.title)), '**不報**「一天塞太多點」');
  yes(!rules.order.concat(rules.overlap, rules.late).some((x) => /打烊|營業/.test(x.title)),
    '**不報**「到達時已打烊」（專案沒有景點的營業時間資料）');
  const on = rules.overnight.find((x) => x.kind === 'overnight');
  yes(on && on.note && !on.fix, `排到隔天 → 陳述不是警告、也不給修正按鈕：「${on ? on.title : ''}」`);
  // 這一條繼承規則 1 的弱點：離開時刻＝到達＋停留，而停留常常是我們自己猜的。
  // 使用者只填了「夜市 22:00」一個時間時，那個「隔天 02:10」完全是猜出來的。
  yes(on && !on.soft && !/推算/.test(on.title),
    '停留都是使用者自己填的 → 直接陳述，不加修飾');
  const og = rules.overnightGuess.find((x) => x.kind === 'overnight');
  yes(og && og.soft && og.title.startsWith('照目前的推算'),
    `停留是我們猜的 → 講明白這是推算：「${og ? og.title : ''}」`);
  yes(og && /估的/.test(og.advice), `並且說出來哪裡是估的：「${og ? og.advice : ''}」`);
  yes(!rules.clean.length, '正常的一天：一條都不報');

  // ---------- UI：預覽、套用、重新偵測、復原 ----------
  console.log('\n— 預覽與逐條套用 —');
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '檢查測試', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-02', allowWiki: false });
    const mk = async (name, day, order, extra = {}) => {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name, emoji: '📍', day, order,
        lat: 24.6 + order * 0.01, lng: 121.7, ...extra });
      return id;
    };
    // 第 1 天：午餐訂 13:00 停 2 小時，下一站訂 14:00 → 重疊
    const lunch = await mk('龍記餐廳', 1, 0, { startMin: 13 * 60, stayMin: 120 });
    const after = await mk('幾米公園', 1, 1, { startMin: 14 * 60, stayMin: 60 });
    // 第 2 天：完全沒填時間 → 要用「幾點出發」推算
    await mk('傳藝中心', 2, 0, { stayMin: 120 });
    await mk('羅東夜市', 2, 1, { stayMin: 90 });
    return { tid, lunch, after };
  });

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelectorAll('.pd-check').length > 0, { timeout: 20000 });
  const btns = await page.evaluate(() => ({
    check: [...document.querySelectorAll('.pd-check')].map((b) => ({ day: b.dataset.day, t: b.textContent.trim(), issue: b.classList.contains('has-issue') })),
    start: [...document.querySelectorAll('.pd-start')].map((b) => ({ day: b.dataset.day, t: b.textContent.trim() })),
  }));
  const d1 = btns.check.find((x) => x.day === '1');
  yes(d1 && d1.issue && d1.t.includes('1'), `第 1 天有問題 → 標出來（「${d1 ? d1.t : ''}」）`);
  yes(btns.start.some((x) => x.day === '2' && x.t.includes('09:00')),
    `第 2 天完全沒填時間 → 顯示「🕘 09:00 出發」讓使用者可以改（「${(btns.start.find((x) => x.day === '2') || {}).t || ''}」）`);
  yes(!btns.start.some((x) => x.day === '1'), '第 1 天有人填了時間 → 不出現出發時刻按鈕（以使用者填的為準，不多嘴）');

  // 打開第 1 天的檢查
  await page.evaluate(() => document.querySelector('.pd-check[data-day="1"]').click());
  await page.waitForSelector('.chk-item', { timeout: 15000 });
  const panel = await page.evaluate(() => ({
    items: [...document.querySelectorAll('.chk-item')].map((n) => ({
      t: n.querySelector('.chk-t').textContent.trim(),
      a: n.querySelector('.chk-a').textContent.trim(),
      btns: [...n.querySelectorAll('.chk-btns .btn')].map((b) => b.textContent.trim()),
      h: n.querySelector('.chk-btns .btn') ? n.querySelector('.chk-btns .btn').getBoundingClientRect().height : 0,
    })),
    size: parseFloat(getComputedStyle(document.querySelector('.chk-t')).fontSize),
  }));
  yes(panel.items.length === 1 && panel.items[0].t.includes('13:00') && panel.items[0].t.includes('14:00'),
    `預覽用具體時刻說明問題：「${panel.items[0].t}」`);
  yes(panel.items[0].btns.includes('這樣改') && panel.items[0].btns.includes('這樣沒關係'),
    '每一條都有「這樣改」與「這樣沒關係」（不逼使用者一定要處理）');
  yes(panel.items[0].h >= 44, `按鈕夠大（${Math.round(panel.items[0].h)}px）`);
  yes(panel.size >= 13, `問題文字沒縮小（${panel.size}px）`);

  // 套用
  await page.evaluate(() => [...document.querySelectorAll('.chk-item .btn')].find((b) => b.textContent.includes('這樣改')).click());
  await page.waitForFunction(() => document.querySelector('.chk-item.done'), { timeout: 15000 });
  await sleep(500);
  const applied = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return {
      lunchStay: s.get(o.lunch).stayMin,
      lunchStart: s.get(o.lunch).startMin,
      afterStart: s.get(o.after).startMin,
      done: [...document.querySelectorAll('.chk-item.done')].map((n) => n.textContent.trim()),
      left: document.querySelectorAll('.chk-item:not(.done)').length,
      undo: [...document.querySelectorAll('.chk-item.done .btn')].map((b) => b.textContent.trim()),
    };
  }, ids);
  yes(applied.lunchStay === 60, `套用後前一站停留 120 → ${applied.lunchStay} 分（只動 stayMin）`);
  yes(applied.lunchStart === 13 * 60 && applied.afterStart === 14 * 60,
    '**沒有動任何人的「幾點到」** —— 不替使用者種下新的固定時刻約束');
  yes(applied.done.length === 1 && applied.done[0].includes('已改好'), '套用的那一條原地變成「已改好」，不無聲消失');
  yes(applied.left === 0, '重新偵測後沒有殘留的舊建議（問題已解決）');
  yes(applied.undo.includes('復原'), '有「復原」');

  // 復原
  await page.evaluate(() => [...document.querySelectorAll('.chk-item.done .btn')].find((b) => b.textContent.includes('復原')).click());
  await sleep(800);
  const undone = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return { stay: s.get(o.lunch).stayMin, items: document.querySelectorAll('.chk-item:not(.done)').length };
  }, ids);
  yes(undone.stay === 120, `復原後停留回到 ${undone.stay} 分`);
  yes(undone.items === 1, '復原後問題重新出現在清單上');

  // 「這樣沒關係」
  await page.evaluate(() => [...document.querySelectorAll('.chk-item .btn')].find((b) => b.textContent.includes('這樣沒關係')).click());
  await sleep(800);
  const dismissed = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const sp = s.get(o.after);
    return { items: document.querySelectorAll('.chk-item:not(.done)').length, ok: sp._ok, keys: Object.keys(sp).filter((k) => k.startsWith('_')) };
  }, ids);
  yes(dismissed.items === 0 && dismissed.ok && dismissed.ok.overlap, '「這樣沒關係」之後這一條不再出現');
  yes(dismissed.keys.includes('_ok'), '旗標用 `_` 開頭 → 不觸發同步，純本機（旅伴那邊照樣會看到提醒）');

  // 改了時間之後要重新出現（不是永久消音）
  await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    await s.patch(o.after, { startMin: 14 * 60 + 30 });
  }, ids);
  await page.evaluate(() => document.querySelector('.modal-actions .btn').click());
  await sleep(400);
  await page.evaluate(() => document.querySelector('.pd-check[data-day="1"]')?.click());
  await page.waitForSelector('.chk-item', { timeout: 15000 }).catch(() => {});
  const back = await page.evaluate(() => document.querySelectorAll('.chk-item:not(.done)').length);
  yes(back === 1, '之後又改了時間 → 同一類問題重新出現（「這樣沒關係」不是永久消音）');

  // ---------- 連續套用兩條：已解決的都要留在畫面上，而且各自復原 ----------
  console.log('\n— 連續套用兩條 —');
  await page.evaluate(() => document.querySelector('.modal-actions .btn')?.click());
  await sleep(400);
  const two = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    // 第 3 天造兩個彼此獨立的問題：兩組「前一站停到超過下一站的訂位時間」
    const mk = async (name, order, startMin, stayMin) => {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: o.tid, name, emoji: '📍', day: 3, order,
        lat: 24.6 + order * 0.0005, lng: 121.7, startMin, stayMin });
      return id;
    };
    const a = await mk('早餐店', 0, 8 * 60, 120);      // 08:00 停到 10:00
    const b = await mk('博物館', 1, 9 * 60, 120);      // 卻訂 09:00 → 重疊
    const c = await mk('午餐', 2, 13 * 60, 120);       // 13:00 停到 15:00
    const d2 = await mk('下午的點', 3, 14 * 60, 60);   // 卻訂 14:00 → 重疊
    return { a, b, c, d2 };
  }, ids);
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelector('.pd-check[data-day="3"]'), { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.pd-check[data-day="3"]').click());
  await page.waitForSelector('.chk-item', { timeout: 15000 });
  const before2 = await page.evaluate(() => document.querySelectorAll('.chk-item:not(.done)').length);
  yes(before2 === 2, `第 3 天偵測到 2 條各自獨立的問題（實際 ${before2}）`);

  await page.evaluate(() => [...document.querySelectorAll('.chk-item:not(.done) .btn')].find((b) => b.textContent.includes('這樣改')).click());
  await page.waitForFunction(() => document.querySelector('.chk-item.done'), { timeout: 15000 });
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('.chk-item:not(.done) .btn')].find((b) => b.textContent.includes('這樣改')).click());
  await page.waitForFunction(() => document.querySelectorAll('.chk-item.done').length >= 2, { timeout: 15000 }).catch(() => {});
  await sleep(400);
  const after2 = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return {
      done: document.querySelectorAll('.chk-item.done').length,
      undoBtns: [...document.querySelectorAll('.chk-item.done')].map((n) => !!n.querySelector('.btn')),
      aStay: s.get(o.a).stayMin, cStay: s.get(o.c).stayMin,
    };
  }, two);
  yes(after2.done === 2,
    `連續套用兩條之後，兩條都還留在畫面上（實際 ${after2.done} 條）—— 修前第一條會被第二條蓋掉、無聲消失`);
  yes(after2.undoBtns.length === 2 && after2.undoBtns.every(Boolean), '兩條各自有自己的「復原」');
  yes(after2.aStay === 60 && after2.cStay === 60, `兩條都真的改到了（${after2.aStay} 分 / ${after2.cStay} 分）`);

  // 復原第二條，第一條不能跟著被倒回去
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.chk-item.done')];
    rows[rows.length - 1].querySelector('.btn').click();
  });
  // 等條件而不是等固定秒數：重新偵測要跑 dayMatrix，時間不固定
  await page.waitForFunction(() => document.querySelectorAll('.chk-item.done').length === 1, { timeout: 20000 }).catch(() => {});
  await sleep(300);
  const partial = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return { aStay: s.get(o.a).stayMin, cStay: s.get(o.c).stayMin, done: document.querySelectorAll('.chk-item.done').length };
  }, two);
  yes(partial.cStay === 120 && partial.aStay === 60,
    `一顆「復原」只還原它自己那一列（午餐回到 ${partial.cStay} 分、早餐店維持 ${partial.aStay} 分）—— 按鈕長在那一列上，語意必須一致`);
  yes(partial.done === 1, '復原後那一列從已解決清單移除，剩下另一條');
  await page.evaluate(() => document.querySelector('.modal-actions .btn')?.click());
  await sleep(400);

  // ---------- 過期防護 ----------
  console.log('\n— 旅伴同時在改 —');
  // 先把第 1 天的預覽打開（stamps 在這一刻拍快照），旅伴的修改才是「預覽開著時進來的」。
  // 順序不能顛倒：先改再開的話快照裡已經是新值，這一條就驗不到東西。
  await page.evaluate(() => document.querySelector('.pd-check[data-day="1"]')?.click());
  await page.waitForSelector('.chk-item', { timeout: 15000 });
  const guard = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    // 模擬旅伴的修改在預覽開著的時候同步進來
    await s.patch(o.lunch, { stayMin: 150 });
    const before = s.get(o.lunch).stayMin;
    const btn = [...document.querySelectorAll('.chk-item .btn')].find((b) => b.textContent.includes('這樣改'));
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return { clicked: !!btn, before, after: s.get(o.lunch).stayMin,
      toast: document.getElementById('toast')?.textContent || '' };
  }, ids);
  // 這一條要防「按鈕根本不存在 → 什麼都沒發生 → 斷言空轉通過」
  yes(guard.clicked, '（前置）預覽裡真的有一顆「這樣改」可以按');
  yes(guard.clicked && guard.after === guard.before,
    `旅伴剛改過 → **不套用**，他的值還在（${guard.before} 分，沒有被預覽時算的舊值蓋掉）`);
  yes(guard.toast.includes('旅伴'), `而且講出來：「${guard.toast}」`);

  // ---------- 出發時刻可以改，而且會同步 ----------
  console.log('\n— 這一天幾點出發 —');
  await page.evaluate(() => document.querySelector('.modal-actions .btn')?.click());
  await sleep(400);
  const startSync = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    await s.patch(o.tid, { dayStarts: { 2: 7 * 60 + 30 } });
    const t = s.get(o.tid);
    const { groupsOf } = await import('./js/merge.js');
    return { v: t.dayStarts['2'], grp: !!groupsOf('trip').dayStarts, f: !!(t._f && t._f.dayStarts) };
  }, ids);
  yes(startSync.v === 450, '「這一天幾點出發」寫進 trip.dayStarts');
  yes(startSync.grp, 'dayStarts 是 TRACKED.trip 的獨立欄位組（會同步、各自 LWW）');
  yes(startSync.f, '有自己的欄位時間戳 —— 改出發時刻不會搶走別人對行程名或日期的修改');

  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelectorAll('.pd-start').length > 0, { timeout: 20000 });
  const eta2 = await page.evaluate(() => ({
    start: [...document.querySelectorAll('.pd-start')].map((b) => b.textContent.trim()),
    eta: [...document.querySelectorAll('.plan-eta:not([hidden])')].map((n) => n.textContent.trim()),
  }));
  yes(eta2.start.some((x) => x.includes('07:30')), `改過的出發時刻顯示出來（「${eta2.start.find((x) => x.includes('07:30')) || ''}」）`);
  yes(eta2.eta.some((x) => x.includes('約 07:30')), `第 2 天的時刻表從 07:30 推算（「${eta2.eta.find((x) => x.includes('約 07:30')) || ''}」）`);

  // 推算出來的時刻**不寫進資料**
  const notWritten = await page.evaluate(async (o) => {
    const s = await import('./js/store.js');
    return s.spotsOf(o.tid).filter((x) => x.day === 2).map((x) => x.startMin ?? null);
  }, ids);
  yes(notWritten.every((x) => x === null),
    `推算出來的時刻**沒有寫進景點**（startMin 全是空的：${JSON.stringify(notWritten)}）—— 三代理 3:0 的核心決議`);

  console.log('\n行程檢查測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); osrmSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
