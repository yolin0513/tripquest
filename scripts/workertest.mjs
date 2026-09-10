// 正式 Worker 的端到端測試（npm run workertest，v1.73.2）
//
// 為什麼要有這一支：`npm test` 裡所有同步測試跑的都是 `server/index.mjs`（LAN 版），
// 而 **限流、D1 分批、safeImgType、公開相簿、/resolve 這些只存在於 `workers/worker.mjs`**。
// 它在測試裡以前只被當**文字**讀（audittest / musictest / maplinktest 的 grep 式斷言），
// 也就是說：v1.65 的限流從上線到現在，一行都沒有被執行過。
//
// 這裡用專案自帶的 wrangler（workerd）把**真的** Worker 跑起來，配一個本機 D1，
// 不需要網路、不需要新依賴、不會碰到正式資料。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const WDIR = fileURLToPath(new URL('../workers', import.meta.url));
// 隨機埠：固定埠碰到上一次殘留的 workerd 就起不來（實際踩過）。
const PORT = 8700 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
let pass = 0;
const yes = (c, m, x = '') => { if (c) { pass++; console.log('✓ ' + m); } else { console.log('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; } };
const rnd = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 上一次跑剩下的 workerd 會抱著 .wrangler 的 sqlite 檔不放（Windows 檔案鎖），
// 開頭先清一次；埠是隨機的，所以就算清不掉也不會擋住這一次。
if (process.platform === 'win32') {
  await new Promise((r) => {
    const k = spawn('taskkill', ['/IM', 'workerd.exe', '/F'], { stdio: 'ignore' });
    k.on('exit', r); k.on('error', r); setTimeout(r, 5000);
  });
  await sleep(800);
}
await rm(path.join(WDIR, '.wrangler'), { recursive: true, force: true }).catch(() => {});
const init = spawn(npx, ['wrangler', 'd1', 'execute', 'tripquest', '--local', '--file=./schema.sql'],
  { cwd: WDIR, stdio: 'ignore', shell: process.platform === 'win32' });
await new Promise((r) => init.on('exit', r));

const dev = spawn(npx, ['wrangler', 'dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1'],
  { cwd: WDIR, stdio: 'ignore', shell: process.platform === 'win32' });

try {
  let up = false;
  for (let i = 0; i < 45 && !up; i++) {
    await sleep(2000);
    up = await fetch(B + '/health', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
  }
  if (!up) throw new Error('本機 Worker 起不來（wrangler dev）');
  yes(true, '本機 Worker（真的 workers/worker.mjs + 本機 D1）跑起來了');

  const gid = 'g' + rnd().slice(0, 20);
  const secret = rnd() + rnd();
  const push = (g, s, records, body) => fetch(`${B}/push?g=${g}`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + s, 'content-type': 'application/json' },
    body: body !== undefined ? body : JSON.stringify({ records }),
  });

  const t0 = Date.now();
  let r = await push(gid, secret, [{ id: 'r1', type: 'trip', title: '宜蘭', updatedAt: t0, deviceId: 'd1', _f: { title: t0 } }]);
  yes(r.ok, `建群組並推第一筆（HTTP ${r.status}）`);

  // ---------- 欄位級合併：未知欄位組要當透明管道（v1.73.2）----------
  // 舊版 Worker 的 sanitizeF 白名單會把「比它新的欄位組」砍掉，等於伺服器親手
  // 製造出「有 _f 卻缺這一組」的記錄，新版客戶端會把它讀成「沒有意見」，
  // 兩台新裝置就各守各的值、誰也贏不了誰。
  await push(gid, secret, [{
    id: 'r1', type: 'trip', title: '宜蘭', dayStarts: { 1: 420 },
    updatedAt: t0 + 10, deviceId: 'd1',
    _f: { title: t0, dayStarts: t0 + 10, futureGroup: t0 + 10, evilKey: 'x', BAD_NAME: t0, tooFar: Date.now() + 99 * 86400000 },
  }]);
  const back = await (await fetch(`${B}/pull?g=${gid}&since=0`, { headers: { authorization: 'Bearer ' + secret } })).json();
  const rec = (back.records || []).find((x) => x.id === 'r1');
  yes(rec && Number.isFinite(rec._f.futureGroup),
    '未知欄位組的時間戳原封傳過去（伺服器不再親手砍掉新鍵）', JSON.stringify(rec && rec._f));
  yes(rec && rec._f.evilKey === undefined && rec._f.BAD_NAME === undefined && rec._f.tooFar === undefined,
    '非數字／不合規鍵名／遠在未來的時間戳照樣擋掉', JSON.stringify(rec && rec._f));
  yes(rec && rec.dayStarts && rec.dayStarts['1'] === 420, '值本身正常寫入');

  // ---------- D1 一條敘述的綁定上限（ID_CHUNK=99 / D1_BATCH_LIMIT=90）----------
  // 超過的話整個 Worker 會被平台直接中止（不是普通例外，try/catch 接不住）
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: 'm' + i, type: 'spot', tripId: 'r1', name: 's' + i, updatedAt: Date.now() + i, deviceId: 'd1',
  }));
  // 用新的群組，不要等 61 秒的限流視窗 —— 死等是浪費，
  // 而且「等得夠久就會過」的測試很容易在慢機器上成為偶發失敗。
  const gid2 = 'g' + rnd().slice(0, 20);
  const secret2 = rnd() + rnd();
  r = await push(gid2, secret2, many);
  const jTxt = await r.text();
  let j = {}; try { j = JSON.parse(jTxt); } catch { /* noop */ }
  yes(r.ok && j.wrote === 200,
    `一次推 200 筆會正確分批（wrote=${j.wrote}，要 > 99 個綁定與 > 90 的 batch）`,
    `HTTP ${r.status}：${jTxt.slice(0, 160)}`);

  // ---------- /push 的大小上限要在驗證之前（v1.73.2）----------
  const big = JSON.stringify({ records: [{ id: 'big', type: 'trip', title: 'x'.repeat(3_000_000) }] });
  r = await push(gid, secret, null, big);
  yes(r.status === 413, `過大的 /push 被擋下來（HTTP ${r.status}，應為 413）`);
  const tBig = Date.now();
  r = await push(gid, rnd() + rnd(), null, big);
  yes(r.status === 413 && Date.now() - tBig < 8000,
    '錯祕鑰的過大請求也是 413 —— 先擋大小，不先花 CPU 解析任意大的 JSON');

  // ---------- 限流的 key 不能是「請求方自己指定的祕鑰」（v1.73.2）----------
  // 以前每換一把錯祕鑰就拿到全新的計數器：擋不到掃描，而且**每一次未驗證的請求
  // 都是一筆 D1 寫入**。免費方案每天 10 萬請求 ≈ 剛好等於 D1 每日寫入上限。
  // 副作用（刻意接受）：未驗證的請求與「建新群組的第一次推送」共用同一個 IP 桶。
  // 代價是同一個 IP 連續掃描之後，一分鐘內建不了新行程；換來的是「未驗證的請求
  // 不能無限寫 D1」。newgroup 本來就是 3 次/60 秒，所以這個耦合不會更緊。
  let got429 = 0;
  for (let i = 0; i < 40; i++) {
    const rr = await push(gid, rnd() + rnd(), [{ id: 'x' + i, type: 'trip', title: 'x', updatedAt: Date.now(), deviceId: 'z' }]);
    if (rr.status === 429) got429++;
  }
  yes(got429 > 0, `每次換一把錯祕鑰的掃描會被擋（40 次裡 ${got429} 次 429）—— 以前一次都不會擋`);
  r = await push(gid, secret, [{ id: 'r2', type: 'spot', tripId: 'r1', name: 'ok', updatedAt: Date.now(), deviceId: 'd1' }]);
  yes(r.ok, `自己人不會被剛才那波掃描連坐（HTTP ${r.status}）`);

  // ---------- 限流本身（v1.65，上線至今從未被執行過）----------
  let n429 = 0;
  for (let i = 0; i < 40; i++) {
    const rr = await push(gid, secret, [{ id: 'p' + i, type: 'spot', tripId: 'r1', name: 'p', updatedAt: Date.now() + i, deviceId: 'd1' }]);
    if (rr.status === 429) { n429++; if (n429 === 1) yes(rr.headers.get('retry-after') === '60', '429 帶 Retry-After: 60'); }
  }
  yes(n429 > 0, `push 超過額度會回 429（40 次裡 ${n429} 次；LIMITS.push=30/60s）`);

  // 讀取不該被限流 —— 輪詢是常態，擋了等於自己鎖死自己
  let pullOk = 0;
  for (let i = 0; i < 40; i++) {
    const rr = await fetch(`${B}/pull?g=${gid}&since=0`, { headers: { authorization: 'Bearer ' + secret } });
    if (rr.ok) pullOk++;
  }
  yes(pullOk === 40, `pull 不限流（40 次全過，實得 ${pullOk}）`);

} catch (e) {
  console.log('✗ 例外：' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  // 殺整棵行程樹：dev.kill() 只殺得到 npx 外殼，workerd 子行程會留下來
  // 抱著埠不放（CloseWait），下一次就起不來。
  try {
    if (process.platform === 'win32') {
      // 要**等** taskkill 跑完再清 .wrangler，不然 workerd 還抓著檔案鎖，
      // 那個目錄會刪不掉、行程也會一次次累積下去。
      const tk = spawn('taskkill', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore' });
      await new Promise((r) => { tk.on('exit', r); tk.on('error', r); setTimeout(r, 8000); });
    } else {
      process.kill(-dev.pid, 'SIGKILL');
    }
  } catch { /* noop */ }
  dev.kill();
  await sleep(1500);
  await rm(path.join(WDIR, '.wrangler'), { recursive: true, force: true }).catch(() => {});
}
console.log('\nWorker 測試結束\n\n' + pass + ' 項通過' + (process.exitCode ? '，有失敗' : ''));
