// 大眾運輸時間（npm run transittest，v1.68）—— mock Google Routes API。
//
// 驗收點：
//   · **沒有金鑰時完全維持現狀**：沒有「🚆 大眾運輸」按鈕、開車估算照樣顯示、零 Google 請求
//   · 有金鑰：一天 N 個景點 → N-1 次序列請求（不是矩陣），每一段的出發時間接續上一段
//   · 顯示的是「實際班次」：路線名、上下車站、發車時刻、轉乘次數、走路時間，
//     而且開車估算降級成附註（兩者要看得出差別）
//   · 時區：TW→+08:00、JP→+09:00 寫進 departureTime（差一小時班次就是錯的）
//   · 出發時間在過去 → 講人話，不是靜默失敗
//   · 金鑰被拒（403）→ 講清楚要去開 Routes API
//   · 次數上限：算次數不算錢；到達上限要擋下並說明
//   · 快取：同一段再查一次不會再打 Google

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5621, API = 5622;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });

// ---- mock Routes API ----
let reqs = [];
let mode = 'ok';                       // ok | forbidden | none | hang
const hung = new Set();
const routesSrv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let j = {}; try { j = JSON.parse(body); } catch { /* noop */ }
    reqs.push({ body: j, key: req.headers['x-goog-api-key'], mask: req.headers['x-goog-fieldmask'] });
    if (mode === 'hang') { hung.add(res); return; }          // 永遠不回應 → 驗客戶端的逾時
    if (mode === 'forbidden') { res.writeHead(403, cors); return res.end('{}'); }
    if (mode === 'none') {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ routes: [] }));
    }
    // 依出發時間回一班「20 分鐘後發車、車程 18 分」的捷運 + 6 分鐘走路
    const dep = new Date(j.departureTime || Date.now());
    const board = new Date(dep.getTime() + 6 * 60000);
    const off = new Date(board.getTime() + 18 * 60000);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({
      routes: [{
        duration: '1680s',
        legs: [{
          steps: [
            { travelMode: 'WALK', staticDuration: '360s' },
            { travelMode: 'TRANSIT', staticDuration: '1080s',
              transitDetails: {
                stopDetails: {
                  departureStop: { name: '石牌站' }, arrivalStop: { name: '中山站' },
                  departureTime: board.toISOString(), arrivalTime: off.toISOString(),
                },
                transitLine: { nameShort: '淡水信義線', name: '淡水信義線', vehicle: { type: 'SUBWAY' } },
              } },
            { travelMode: 'WALK', staticDuration: '240s' },
          ],
        }],
      }],
    }));
  });
});
routesSrv.listen(API);

let pass = 0;
const yes = (c, m, extra = '') => { if (c) { pass++; console.log('✓ ' + m); } else { console.log('✗ ' + m + (extra ? ' — ' + extra : '')); process.exitCode = 1; } };
const fail = (m) => { console.log('✗ ' + m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((api) => {
    window.__TQ_ROUTES_ENDPOINT = `http://localhost:${api}/routes`;
  }, API);
  page.on('console', (m) => { if (m.type() === 'error') console.log('   [console] ' + m.text().slice(0, 160)); });

  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 一天四個點（台北），日期放在未來，才有「未來的班次」可查
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    const d = new Date(Date.now() + 30 * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '大眾運輸測試', region: '台北',
      country: 'TW', startDate: iso, endDate: iso, allowWiki: false });
    const mk = async (name, order, lat, lng, extra = {}) => {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name, emoji: '📍', day: 1, order, lat, lng, ...extra });
      return id;
    };
    await mk('台北車站', 0, 25.0478, 121.5170, { startMin: 9 * 60, stayMin: 60 });
    await mk('中山站', 1, 25.0525, 121.5203, { stayMin: 60 });
    await mk('台北101', 2, 25.0338, 121.5645, { stayMin: 60 });
    await mk('龍山寺', 3, 25.0355, 121.4998, { stayMin: 60 });
    return { tid, iso };
  });

  // ---------- 沒有金鑰：完全維持現狀 ----------
  console.log('— 沒有金鑰（免費路徑不能退化）—');
  reqs = [];
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => document.querySelectorAll('.plan-travel-note').length >= 2, { timeout: 20000 });
  await sleep(600);
  const noKey = await page.evaluate(() => ({
    btn: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('大眾運輸')).length,
    notes: [...document.querySelectorAll('.plan-travel-note')].map((n) => n.textContent.trim()),
    transit: document.querySelectorAll('.plan-travel-note.transit').length,
  }));
  yes(noKey.btn === 0, '沒有金鑰 → 沒有「🚆 大眾運輸」按鈕（不給看得到按不了的東西）');
  yes(noKey.transit === 0 && noKey.notes.length >= 2 && noKey.notes.every((x) => /移動約/.test(x)),
    `開車估算照常顯示 ×${noKey.notes.length}（${noKey.notes[0] || ''}）`);
  yes(reqs.length === 0, `沒有金鑰 → 零個 Google 請求（實際 ${reqs.length}）`);

  // ---------- 純函式：時區與時間格式 ----------
  console.log('\n— 時區與出發時間 —');
  const tz = await page.evaluate(async () => {
    const t = await import('./js/transit.js');
    return {
      tw: t.tzOffsetFor(25.03, 121.56, 'TW'),
      jp: t.tzOffsetFor(35.68, 139.76, 'JP'),
      jpNoCountry: t.tzOffsetFor(35.68, 139.76, ''),
      twNoCountry: t.tzOffsetFor(25.03, 121.56, ''),
      unknown: t.tzOffsetFor(48.85, 2.35, ''),                    // 巴黎：表裡沒有
      iso: t.rfc3339('2026-10-01', 9 * 60, 8),
      isoJp: t.rfc3339('2026-10-01', 9 * 60, 9),
      isoNextDay: t.rfc3339('2026-10-01', 25 * 60, 8),            // 隔天 01:00
    };
  });
  yes(tz.tw.offset === 8 && !tz.tw.guessed, '台灣 → +8（用旅程的國家）');
  yes(tz.jp.offset === 9 && !tz.jp.guessed, '日本 → +9');
  yes(tz.jpNoCountry.offset === 9 && tz.twNoCountry.offset === 8,
    '沒有國家欄位時用座標框也對得出來（日本 +9／台灣 +8）');
  yes(tz.unknown.guessed, '認不出來的地方標 guessed（介面要說「時間可能差幾小時」），不默默給錯答案');
  yes(tz.iso === '2026-10-01T09:00:00+08:00', `台灣出發時間寫成「${tz.iso}」`);
  yes(tz.isoJp === '2026-10-01T09:00:00+09:00', `日本出發時間寫成「${tz.isoJp}」（差一小時班次就是錯的）`);
  yes(tz.isoNextDay === '2026-10-02T01:00:00+08:00', `跨午夜的出發時間換成隔天：「${tz.isoNextDay}」`);

  // 半小時時區：tzOffsetFor 認不出地點時會退回**本機時區**，人在印度出差時規劃
  // 日本行程就會走到這條路。原本用 parseInt(iso.slice(-6,-3)) 讀偏移，+05:30 會被
  // 讀成 5，整批發車時刻差 30 分鐘。
  reqs = [];
  const half = await page.evaluate(async () => {
    const t = await import('./js/transit.js');
    const at = t.rfc3339('2026-10-01', 9 * 60, 5.5);
    const r = await t.transitLeg({ lat: 25.0, lng: 121.5 }, { lat: 25.05, lng: 121.55 }, at, 'AIzaHALFHALFHALFHALFHALFHALFHALFHALF');
    return { at, depart: r.ok ? r.lines[0].depart : '', ok: r.ok };
  });
  yes(half.at === '2026-10-01T09:00:00+05:30', `半小時時區寫得出來：「${half.at}」`);
  yes(half.depart === '09:06',
    `半小時時區也讀得回來：發車顯示 ${half.depart}（修前會讀成 +05 → 顯示 08:36，整批差 30 分）`);

  // 逾時：Google 掛住時不能讓畫面永遠停在「查詢中…」
  mode = 'hang';
  const hangT0 = Date.now();
  const hangRes = await page.evaluate(async () => {
    const t = await import('./js/transit.js');
    const at = t.rfc3339('2099-10-01', 9 * 60, 8);
    return t.transitLeg({ lat: 25.0, lng: 121.5 }, { lat: 25.05, lng: 121.55 }, at, 'AIzaHANGHANGHANGHANGHANGHANGHANGHANG');
  });
  const secs = Math.round((Date.now() - hangT0) / 1000);
  mode = 'ok';
  yes(!hangRes.ok && hangRes.reason === 'timeout' && secs >= 13 && secs <= 22,
    `Google 沒回應 → ${secs} 秒後自己放棄並回 timeout（不是永遠卡著）`);
  const msg = await page.evaluate(async () => (await import('./js/transit.js')).VEHICLE_EMOJI && null);
  void msg;

  // ---------- 有金鑰 ----------
  console.log('\n— 有金鑰 —');
  await page.evaluate(async (tid) => {
    const k = await import('./js/aikeys.js');
    await k.setTripKey(tid, { mapsKey: 'AIzaTESTTESTTESTTESTTESTTESTTESTTESTTEST' });
  }, ids.tid);
  reqs = [];
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('大眾運輸')), { timeout: 20000 });
  yes(true, '有金鑰 → 出現「🚆 大眾運輸」按鈕');
  yes(reqs.length === 0, '按下去之前不會先打 Google（不是背景自動跑的）');

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('大眾運輸')).click());
  await page.waitForFunction(() => document.querySelectorAll('.plan-travel-note.transit').length >= 3, { timeout: 30000 });
  const got = await page.evaluate(() => ({
    transit: [...document.querySelectorAll('.plan-travel-note.transit')].map((n) => n.textContent.trim()),
    lines: [...document.querySelectorAll('.plan-transit-line')].map((n) => n.textContent.trim()),
    drive: [...document.querySelectorAll('.plan-transit-drive')].map((n) => n.textContent.trim()),
    note: document.querySelector('.plan-transit-note')?.textContent || '',
    lineSize: (() => { const n = document.querySelector('.plan-transit-line'); return n ? parseFloat(getComputedStyle(n).fontSize) : 0; })(),
  }));
  yes(reqs.length === 3, `4 個景點 → 3 次序列請求（一段一段，不是矩陣；實際 ${reqs.length}）`);
  yes(reqs.every((r) => r.body.travelMode === 'TRANSIT'), '每一次都是 TRANSIT 模式');
  yes(reqs.every((r) => r.key === 'AIzaTESTTESTTESTTESTTESTTESTTESTTESTTEST'), '金鑰放在 X-Goog-Api-Key 標頭（不放網址）');
  yes(reqs.every((r) => /\+08:00$/.test(r.body.departureTime)), `出發時間帶台灣時區（${reqs[0].body.departureTime}）`);

  // 出發時間要接續：第 2 段比第 1 段晚（第 1 段車程 28 分 + 停留 60 分）
  const t0 = new Date(reqs[0].body.departureTime).getTime();
  const t1 = new Date(reqs[1].body.departureTime).getTime();
  yes(t1 - t0 >= 80 * 60000 && t1 - t0 <= 100 * 60000,
    `第 2 段的出發時間接續第 1 段（相隔 ${Math.round((t1 - t0) / 60000)} 分 = 車程 28 + 停留 60）`);

  yes(!reqs.some((r) => /rating|userRatingCount|polyline/i.test(r.mask || '')),
    'FieldMask 沒有順手多要（評分／人氣／路線圖形都不要 —— 那些是更貴的計費等級）');

  yes(got.transit.length === 3 && got.transit[0].includes('大眾運輸 28 分'),
    `顯示實際班次時間：「${(got.transit[0] || '').split('\\n')[0]}」`);
  // Routes 回的 duration 是門到門的總時間，已經含走路。寫成「28 分・走路 10 分」
  // 會被讀成 28＋10 —— v1.70.2 改成明講「含」。
  yes(got.transit[0].includes('（含走路 10 分）'),
    `走路時間要講明是「含」在總時間裡（不是另外再加）：「${(got.transit[0] || '').slice(0, 30)}」`);
  yes(got.lines.length >= 3 && got.lines[0].includes('淡水信義線') && got.lines[0].includes('石牌站 → 中山站') && /\d\d:\d\d 發車/.test(got.lines[0]),
    `列出路線與上下車站與發車時刻：「${got.lines[0] || ''}」`);
  yes(got.drive.length === 3 && got.drive[0].includes('開車估算'),
    `開車估算降級成附註（「${got.drive[0] || ''}」）—— 一個是實際班次一個是估算，要看得出差別`);
  yes(got.lineSize >= 13, `班次那一行字級沒縮小（${got.lineSize}px）—— 長輩要看得到幾點的車`);
  yes(got.note.includes('實際時刻') && got.note.includes(ids.iso), `講明白這是哪一天查到的：「${got.note}」`);

  // 用量：算次數不算錢
  const used = await page.evaluate(async (tid) => (await (await import('./js/aikeys.js')).usageOf(tid)), ids.tid);
  yes(used.mapsUsed === 3, `用量記 3 次（不是換算成美金 —— 免費額度是「每月幾千次」，換成美金永遠是 $0）`);
  yes(used.hasMaps && used.mapsCap === 300, `預設上限 300 次／月（保險絲，不是預算）`);

  // 快取：再查一次不打 Google
  reqs = [];
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('大眾運輸')).click());
  await sleep(2500);
  yes(reqs.length === 0, `同一段再查一次走 24 小時快取，零個新請求（實際 ${reqs.length}）`);

  // ---------- 失敗路徑 ----------
  console.log('\n— 失敗路徑 —');
  mode = 'forbidden';
  await page.evaluate(async () => { await (await import('./js/db.js')).metaClearPrefix?.('transit:'); });
  const forb = await page.evaluate(async () => {
    const t = await import('./js/transit.js');
    const r = await t.testMapsKey('AIzaBADBADBADBADBADBADBADBADBADBADBADBAD');
    return r;
  });
  yes(!forb.ok && forb.message.includes('Routes API'),
    `金鑰被拒 → 講清楚要去啟用 Routes API：「${forb.message}」`);

  mode = 'none';
  const none = await page.evaluate(async () => {
    const t = await import('./js/transit.js');
    return t.testMapsKey('AIzaOKOKOKOKOKOKOKOKOKOKOKOKOKOKOKOKOKOK');
  });
  yes(none.ok && none.message.includes('查不到班次'),
    `金鑰可用但那段沒班次 → 不要說成金鑰壞掉：「${none.message}」`);

  mode = 'ok';
  // 過去的日期 → 講人話
  await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    await s.patch(tid, { startDate: '2020-01-01', endDate: '2020-01-01' });
  }, ids.tid);
  reqs = [];
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plan-list');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('大眾運輸')), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('大眾運輸')).click());
  await page.waitForFunction(() => {
    const el = document.getElementById('toast');
    return el && !el.hidden && el.textContent;
  }, { timeout: 15000 }).catch(() => {});
  const pastMsg = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  yes(pastMsg.includes('過'), `日期已過 → 講人話：「${pastMsg}」`);
  yes(reqs.length === 0, '日期已過就不打 Google（省下無意義的請求）');

  // ---------- v1.71：設定頁文案與貼上對話框 ----------
  console.log('\n— 旅程設定的金鑰區 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/settings`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page');
  await page.waitForFunction(() => document.body.textContent.includes('自帶金鑰'), { timeout: 20000 });
  const cfg = await page.evaluate(() => {
    const txt = document.body.textContent;
    const count = (re) => (txt.match(re) || []).length;
    return {
      notice: count(/金鑰只存在這支手機/g),
      tts: count(/語音|旁白配音|TTS/g),
      googleKeys: count(/貼上 Google 金鑰|Google 金鑰/g),
      hasAi: txt.includes('AI 加值'),
      hasMaps: txt.includes('地圖加值'),
      len: (document.querySelectorAll('.card.about')[0]?.textContent || '').length,
    };
  });
  yes(cfg.notice === 1, `「金鑰只存在這支手機」整頁只講一次（實際 ${cfg.notice} 次）`);
  yes(cfg.tts === 0, `設定頁完全沒有語音／TTS 的字樣（實際 ${cfg.tts} 處）`);
  yes(cfg.hasAi && cfg.hasMaps, 'AI 加值與地圖加值兩張卡都在，收在同一個「自帶金鑰」區塊底下');

  // 貼上對話框：按鈕不折行、跟輸入框對齊；360px 特大字級也要成立
  for (const [w, fs] of [[390, 'm'], [360, 'xl']]) {
    await page.setViewport({ width: w, height: 844, deviceScaleFactor: 2 });
    await page.evaluate((v) => { document.documentElement.dataset.fs = v; }, fs);
    await sleep(300);
    // 這時候金鑰已經存在，卡片上的按鈕是「更換」不是「貼上」—— 找「Google 金鑰」那一列的按鈕
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.setting-row')].find((r) => r.textContent.includes('Google 金鑰'));
      (row ? row.querySelector('button')
        : [...document.querySelectorAll('button')].find((b) => b.textContent.includes('貼上 Google 金鑰'))).click();
    });
    await page.waitForSelector('.numpad-row', { timeout: 15000 });
    await sleep(300);
    const row = await page.evaluate(() => {
      // 「折了幾行」要量**文字本身**，不能拿 offsetHeight 去比行高 ——
      // 按鈕有固定 px 的 padding，字級小的時候 padding 佔比大，會把單行誤判成兩行。
      // Range 的 client rects 一行一塊，數不同的 top 才是真的行數。
      const lines = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1;
      };
      const r = document.querySelector('.numpad-row');
      const f = r.querySelector('.field'), b = r.querySelector('.btn');
      const fr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
      const acts = [...document.querySelectorAll('.modal-actions .btn')].map((x) =>
        ({ t: x.textContent.trim(), lines: lines(x) }));
      return {
        nowrap: getComputedStyle(b).whiteSpace,
        sameTop: Math.abs(fr.top - br.top) <= 1,
        sameH: Math.abs(fr.height - br.height) <= 2,
        btnLines: lines(b),
        acts,
        overflow: document.querySelector('.modal-card').scrollWidth - document.querySelector('.modal-card').clientWidth,
      };
    });
    yes(row.nowrap === 'nowrap' && row.btnLines === 1,
      `${w}px／${fs}：「📋 貼上」不折行（實測 ${row.btnLines} 行）`);
    yes(row.sameTop && row.sameH, `${w}px／${fs}：輸入框與按鈕同一行、等高（不歪斜）`);
    yes(row.acts.every((a) => a.lines === 1),
      `${w}px／${fs}：對話框的動作按鈕文字也不折行（${row.acts.map((a) => a.t + ' ' + a.lines + ' 行').join('、')}）`);
    yes(row.overflow <= 1, `${w}px／${fs}：對話框沒有橫向溢出（${row.overflow}px）`);
    await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.includes('取消'))?.click());
    await sleep(300);
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => { document.documentElement.dataset.fs = 'm'; });

  console.log('\n大眾運輸測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  for (const r of hung) { try { r.destroy(); } catch { /* noop */ } }
  web.kill(); routesSrv.closeAllConnections?.(); routesSrv.close();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
