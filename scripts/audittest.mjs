// 第三輪健檢修正的回歸測試（npm run audittest，v1.64）。
// 每一條都對應一個「稽核找到、實際會咬人」的問題——刻意寫成「行為斷言」而不是
// 「原始碼字串斷言」，因為這個專案漏掉的真 bug 都是測試沒走真實情境才溜過去的。

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm, readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5683, API = 8839;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1800);

let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));
// 硬的前置：情境沒造出來就記一條紅、並停下——後面「讀不到／不是 HTML」這種斷言在情境不存在時恆真，
// 不准讓它們接著印出肯定句（2026-09-24 盤點實測：建立情境那一步被吞錯時，這兩段在真的有漏洞時照樣全綠）。
const must = (c, m, x) => { if (c) { ok(m); return; } fail(m, x); throw new Error('前置不成立，停下：' + m); };
const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return !!(await fn()); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

try {
  // ---------- 1. LAN server 靜態檔白名單（本輪最嚴重的漏洞）----------
  console.log('\n— LAN server 不能被拿去讀祕鑰檔 —');
  // 先讓伺服器產生 state.json（有群組祕鑰）。失敗不能吞：沒有這個檔，「讀不到祕鑰檔」就恆真。
  const setup = await fetch(`http://localhost:${API}/push?g=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, {
    method: 'POST', headers: { authorization: 'Bearer ' + 'a'.repeat(32), 'content-type': 'application/json' },
    body: JSON.stringify({ records: [{ id: 'x1', type: 'trip', title: '祕密行程', updatedAt: Date.now() }] }),
  });
  const STATE = ROOT + 'server/data/state.json';
  const stateText = async () => { try { return await readFile(STATE, 'utf8'); } catch { return ''; } };
  // 前置要驗到「萬一被讀到，下面的判斷認得出來」：檔在，而且內容帶著判斷用的祕鑰標記
  const hasSecret = await waitFor(async () => /syncSecret|"secret"/.test(await stateText()));
  must(setup.ok && hasSecret, `前置：伺服器真的寫出了帶祕鑰的 state.json（建立回 ${setup.status}、祕鑰標記在檔裡：${hasSecret}）`);
  // 母體（2026-09-24 改）：原本是寫死的 9 條路徑——伺服器多開放一個新資料夾（例如放著祕鑰備份的 .logs/）
  // 照樣全綠。改成孤兒檢查的形狀：repo 根目錄底下**不在下面這份允許清單裡的每一項**，都自動挑一個真的檔去探測。
  // 允許清單是這支測試自己的登記，**不讀伺服器的白名單**——伺服器白名單被改寬時，測試的標準才不會跟著變寬。
  const ALLOWED_TOP = new Set(['css', 'js', 'data', 'icons', 'media', 'fonts', 'index.html', 'manifest.webmanifest', 'sw.js', 'favicon.ico']);
  const TEXT = /\.(json|md|toml|mjs|js|txt|sh|yml|yaml|html|css|webmanifest|py|sql)$|^(config|HEAD|\.gitignore)$/i;
  const pickFile = (rel, depth = 0) => {          // 在這一項底下挑一個讀得出文字、不太小的檔
    const abs = path.join(ROOT, rel);
    let st; try { st = fs.statSync(abs); } catch (e) { return null; }
    if (st.isFile()) return (TEXT.test(path.basename(rel)) || st.size < 4096) && st.size >= 16 && st.size < 2e6 ? rel : null;
    if (!st.isDirectory() || depth > 4) return null;
    const kids = fs.readdirSync(abs).sort((a, b) => (TEXT.test(b) ? 1 : 0) - (TEXT.test(a) ? 1 : 0) || a.localeCompare(b));
    for (const k of kids.slice(0, 40)) { const f = pickFile(rel + '/' + k, depth + 1); if (f) return f; }
    return null;
  };
  const tops = fs.readdirSync(ROOT).filter((n) => !ALLOWED_TOP.has(n));
  const probes = [];   // [網址路徑, 磁碟上的相對路徑, 說明]
  for (const t of tops) { const f = pickFile(t); if (f) probes.push(['/' + f, f, `根目錄的 ${t}`]); }
  // 大小寫變化（Windows／macOS 檔案系統不分大小寫；v1.64 的漏洞就是這一類）
  probes.push(['/SERVER/data/state.json', 'server/data/state.json', '大寫路徑'], ['/Server/Data/State.json', 'server/data/state.json', '混合大小寫']);
  const gitCfg = pickFile('.git');
  if (gitCfg) probes.push(['/' + gitCfg.replace(/^\.git/, '.GIT'), gitCfg, 'git（大寫）']);
  // 前置：母體不是空的，而且一定涵蓋幾個高風險的（祕鑰檔、git、Worker 設定、文件）
  const topsProbed = new Set(probes.map(([, f]) => f.split('/')[0]));
  must(probes.length >= 10 && ['server', '.git', 'workers', 'docs'].every((t) => topsProbed.has(t)),
    `前置：探測 ${probes.length} 條路徑，涵蓋根目錄 ${topsProbed.size} 項（含 server、.git、workers、docs）`,
    '沒涵蓋到的：' + ['server', '.git', 'workers', 'docs'].filter((t) => !topsProbed.has(t)).join('、'));
  // 判斷：回應內容裡有沒有那個檔在磁碟上的真實開頭（不靠幾個字面標記——標記漂了不會有人發現）
  const diskHead = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').slice(0, 64);
  const leaks = (body, head) => head.length >= 16 && body.includes(head);
  // 對照組：真實內容一定要判得出來；App 首頁（白名單外的路徑會回的那一頁）一定不能被判成外洩
  const spa = await fetch(`http://localhost:${API}/`).then((r) => r.text());
  const ctrlBad = probes.filter(([, f]) => !leaks(fs.readFileSync(path.join(ROOT, f), 'utf8'), diskHead(f))).map(([, f]) => f);
  const ctrlFalse = probes.filter(([, f]) => leaks(spa, diskHead(f))).map(([, f]) => f);
  must(!ctrlBad.length && !ctrlFalse.length && spa.length > 0,
    `對照組：${probes.length} 個檔的真實內容都判得出來、App 首頁不會被誤判成外洩`,
    `判不出來的：${ctrlBad.join('、') || '無'}；首頁被誤判的：${ctrlFalse.join('、') || '無'}`);
  const leaked = [];
  for (const [url, f, label] of probes) {
    const body = await fetch(`http://localhost:${API}${url}`).then((r) => r.text());
    // 白名單外的路徑：要嘛 403，要嘛回 SPA 的 index.html（絕不能是真檔案內容）。外洩時只印路徑、不印內容
    if (leaks(body, diskHead(f))) leaked.push(`${label}（${url}）`);
  }
  yes(leaked.length === 0, `專案檔案都讀不到（試了 ${probes.length} 條路徑：根目錄允許清單以外的每一項＋大小寫變化）`, leaked.join('；'));
  const okStatic = await fetch(`http://localhost:${API}/js/store.js`).then((r) => r.text());
  yes(okStatic.includes('export'), '該給的靜態檔照樣給得出來（js/store.js）');

  // ---------- 2. blob 型別不能是 HTML ----------
  console.log('\n— 上傳的「照片」只能是圖片 —');
  const g2 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', sec2 = 'b'.repeat(32);
  // 上傳失敗不能吞：沒傳上去的話拿回來的是 404，「型別不是 HTML」就恆真
  const put = await fetch(`http://localhost:${API}/blob/deadbeef12345678?g=${g2}`, {
    method: 'PUT', headers: { authorization: 'Bearer ' + sec2, 'x-content-type': 'text/html' },
    body: new Blob(['<script>alert(1)</script>']),
  });
  const got = await fetch(`http://localhost:${API}/blob/deadbeef12345678?g=${g2}`, { headers: { authorization: 'Bearer ' + sec2 } });
  const body2 = await got.text();
  must(put.ok && got.status === 200 && body2.includes('<script>alert(1)</script>'),
    `前置：那份「宣稱是 HTML」的內容真的傳上去、也拿得回來（上傳回 ${put.status}、取回 ${got.status}）`);
  const ct = got.headers.get('content-type') || '';
  yes(!/text\/html/i.test(ct), `拿回來的型別不是 HTML（${ct}）—— 不然公開相簿的照片網址會變成可執行的頁面`);

  // ---------- 3. 邀請連結不能偷換同步伺服器 ----------
  console.log('\n— 邀請連結的 u= 不能偷換伺服器 —');
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const inject = await page.evaluate(async () => {
    const sh = await import('./js/share.js');
    const sync = await import('./js/sync.js');
    const before = sync.getConfig().url || '';
    let err = '';
    try {
      await sh.joinInvite({ kind: 'sync', short: true, groupId: 'cccccccc-dddd-4eee-8fff-000000000000',
        secret: 'c'.repeat(32), url: 'https://attacker.example', tripPrefix: 'x' });
    } catch (e) { err = String(e.message || e); }
    return { before, after: sync.getConfig().url || '', err };
  });
  yes(inject.after !== 'https://attacker.example',
    `沒有經過確認就不會換伺服器（現在還是「${inject.after || '單機'}」）`);
  yes(/沒有使用|不是安全連線/.test(inject.err), `而且擋下來時講得清楚：「${inject.err.slice(0, 30)}…」`);
  const httpBlocked = await page.evaluate(async () => {
    const sh = await import('./js/share.js');
    try {
      await sh.joinInvite({ kind: 'sync', short: true, groupId: 'dddddddd-eeee-4fff-8000-111111111111',
        secret: 'd'.repeat(32), url: 'http://attacker.example', tripPrefix: 'x' },
        { confirmHost: async () => true });      // 就算使用者按了同意
      return '';
    } catch (e) { return String(e.message || e); }
  });
  yes(/https/.test(httpBlocked), `http:// 的伺服器一律拒絕，就算使用者點頭：「${httpBlocked.slice(0, 26)}…」`);

  // ---------- 4. TRACKED 覆蓋率（靜態，但抓的是真問題）----------
  console.log('\n— 欄位級合併的覆蓋率 —');
  const mergeSrc = await readFile(ROOT + 'js/merge.js', 'utf8');
  for (const f of ['allowGeo', 'allowWiki', 'aiEnabled', 'title', 'startDate', 'musicStyle']) {
    yes(mergeSrc.includes(`'${f}'`), `trip.${f} 在 TRACKED 裡（不然會被整筆 LWW 蓋掉）`);
  }
  const workerSrc = await readFile(ROOT + 'workers/worker.mjs', 'utf8');
  yes(workerSrc.includes('TRACKED_SQL') && !workerSrc.includes("type IN ('spot','trip','quest')"),
    'Worker 的型別白名單是從 TRACKED 生成的，不是手抄（手抄會漂，而且本機測試全跑 LAN server 測不到）');

  // ---------- 5. 開頁不該把整個群組推上去 ----------
  console.log('\n— 開頁的上行流量 —');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 390, height: 844 });
  await p2.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await p2.waitForSelector('.hero');
  await p2.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  const tid = await p2.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'G' });
    await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '流量測試', region: '宜蘭', allowWiki: false });
    for (let i = 0; i < 8; i++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: '景點' + i, emoji: '📍', day: 1, order: i });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: '拍一張', kind: 'thing', order: 0 });
    }
    await ensureGroupSync(gid);
    await (await import('./js/outbox.js')).drain({ force: true });
    return tid;
  });
  await sleep(1200);
  const pushes = await p2.evaluate(async (t) => {
    const sizes = [];
    const of = window.fetch;
    window.fetch = async (u, init) => {
      if (String(u).includes('/push') && init && init.body) sizes.push((JSON.parse(init.body).records || []).length);
      return of(u, init);
    };
    // 開行程頁 → 照片牆 → 回行程頁（沒有任何本機改動）
    location.hash = '#/trip/' + t;
    await new Promise((r) => setTimeout(r, 1500));
    location.hash = '#/trip/' + t + '/people';
    await new Promise((r) => setTimeout(r, 1500));
    location.hash = '#/trip/' + t;
    await new Promise((r) => setTimeout(r, 1500));
    window.fetch = of;
    return sizes;
  }, tid);
  yes(pushes.length === 0,
    `沒有本機改動時，開頁只拉不推（推送次數 ${pushes.length}${pushes.length ? '，每次 ' + pushes.join('/') + ' 筆' : ''}）`);

  // ---------- 6. 4xx 不再無限重試 ----------
  console.log('\n— 送不出去的東西要停手並講清楚 —');
  const dead = await p2.evaluate(async () => {
    const db = await import('./js/db.js');
    const o = await import('./js/outbox.js');
    await db.outboxPut({ id: 'push:deadgroup', op: 'push', groupId: 'deadgroup', tries: 3, nextAt: 0, dead: true, lastError: 'push 403' });
    const st = await o.pendingOf('deadgroup');
    const dc = await o.deadCount('deadgroup');
    await db.outboxDelete('push:deadgroup');
    return { pending: st.total, dead: dc.n, why: dc.why };
  });
  yes(dead.pending === 0 && dead.dead === 1,
    `永久失敗的項目不算進「還在上傳」，而是單獨算得出來（why=「${dead.why}」）`);

  // ---------- 7. 清除所有資料要連 localStorage 一起清 ----------
  console.log('\n— 清除所有資料 —');
  const wiped = await p2.evaluate(async () => {
    localStorage.setItem('tripquest.lastloc', JSON.stringify({ lat: 25.03, lng: 121.56 }));
    localStorage.setItem('tripquest.home', JSON.stringify({ lat: 25.03, lng: 121.56 }));
    const db = await import('./js/db.js');
    db.wipeLocalKeys();
    const left = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tripquest.')) left.push(k); }
    return left;
  });
  yes(wiped.length === 0, `本機的位置痕跡也會被清掉（殘留 ${wiped.join(',') || '無'}）`);

  console.log('\n健檢回歸測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
