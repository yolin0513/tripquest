// 正式 Worker 的端到端測試（npm run workertest，v1.73.2）
// ⏱ 受機器狀態影響（2026-10-29 標）：「錯祕鑰的過大請求也是 413」同時要求 8 秒內回應——機器忙時可能誤紅；紅在這一條先看當時負載。
//
// 為什麼要有這一支：`npm test` 裡所有同步測試跑的都是 `server/index.mjs`（LAN 版），
// 而 **限流、D1 分批、safeImgType、公開相簿、/resolve 這些只存在於 `workers/worker.mjs`**。
// 它在測試裡以前只被當**文字**讀（audittest / musictest / maplinktest 的 grep 式斷言），
// 也就是說：v1.65 的限流從上線到現在，一行都沒有被執行過。
//
// 這裡用專案自帶的 wrangler（workerd）把**真的** Worker 跑起來，配一個本機 D1，
// 不需要網路、不需要新依賴、不會碰到正式資料。
import { spawn } from 'node:child_process';
import { killTree } from './run-timeout.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { mergeRecord, stable } from '../js/merge.js';

const WDIR = fileURLToPath(new URL('../workers', import.meta.url));
// 隨機埠：固定埠碰到上一次殘留的 workerd 就起不來（實際踩過）。
const PORT = 8700 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
let pass = 0;
const yes = (c, m, x = '') => { if (c) { pass++; console.log('✓ ' + m); } else { console.log('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; } };
const rnd = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

// 連續打 40 次，計 429。Worker 的限流是**對齊整分鐘的固定視窗**（worker.mjs：win = floor(now / (period*1000))），
// 40 次若剛好跨過整分鐘，前後兩個視窗各自都不到 31 次 → 一次 429 都沒有（2026-09-23 在完整的鏈裡、機器忙時
// 紅過一次；單獨跑綠）。只放寬斷言的話，跨視窗時就會「情境沒成立卻判綠」。所以記下這一輪開始與結束落在
// 哪個視窗；跨了就代表剛進入新視窗，立刻在這個視窗裡再打一輪。回傳 sameWin 給呼叫端寫前置斷言。
const PUSH_PERIOD_MS = 60 * 1000;                  // 跟 worker.mjs 的 LIMITS.push.period 一致
const winOf = (t) => Math.floor(t / PUSH_PERIOD_MS);
// 每一輪記下開始與結束的時間（寫進前置斷言的訊息）：下次再跨視窗，就看得到是不是真的跨了整分鐘。
const hms = (t) => new Date(t).toISOString().slice(11, 23);
async function burst40(send) {
  let n429 = 0, retryAfter = null, sameWin = false, rounds = 0;
  const spans = [];
  for (; rounds < 2 && !sameWin; rounds++) {
    n429 = 0;
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      const rr = await send(i, rounds);
      if (rr.status === 429) { n429++; if (retryAfter === null) retryAfter = rr.headers.get('retry-after'); }
    }
    const t1 = Date.now();
    sameWin = winOf(t1) === winOf(t0);
    spans.push(`${hms(t0)}–${hms(t1)} UTC${sameWin ? '' : '，跨了整分鐘'}`);
  }
  return { n429, retryAfter, sameWin, rounds, spans: spans.join('；') };
}
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

  // ---------- 新增欄位組（leg／important／booked，2026-11-05）不會讓「只補了時間戳」的推回寫進 D1 ----------
  // 新版合併對「兩邊都沒有這組」的舊記錄會在 _f 補上 leg:0 等鍵 → 跟伺服器那份不一樣 →
  // 新版客戶端觸發補推（store.js importRecords 的 heal）。投票時兩位代理推論相反：會不會因此把
  // 家人群組裡每一筆 spot 都寫一次 D1。這裡走真的路徑重現：伺服器上放一筆舊版寫的 spot，
  // pull 回來、用真的 js/merge.js 照 importRecords 的寫法合併、把合併結果推回去，
  // 然後**另外讀 D1**（pull since=推之前的 seq）確認沒寫；對照組：真的改了值的那一筆要寫進去。
  // 兩個來源各自判：Worker 回的 wrote，與事後從 D1 讀到的 seq／記錄。
  {
    const auth = { headers: { authorization: 'Bearer ' + secret } };
    const tL = Date.now() - 60_000;
    const oldF = { name: tL, slot: tL, time: tL, pinned: tL, pos: tL };   // 舊版寫的：只認得五組
    r = await push(gid, secret, [{ id: 'L1', type: 'spot', tripId: 'r1', name: '舊站', day: 1, order: 0, updatedAt: tL, deviceId: 'dOld', _f: oldF }]);
    yes(r.ok, `新組情境：伺服器上放一筆舊版寫的 spot（HTTP ${r.status}）`);
    const p0 = await (await fetch(`${B}/pull?g=${gid}&since=0`, auth)).json();
    const onServer = (p0.records || []).find((x) => x.id === 'L1');
    const seq0 = p0.seq;
    yes(onServer && Number.isFinite(seq0) && onServer._f && onServer._f.leg === undefined,
      `前置：伺服器那份沒有 leg 組（seq=${seq0}）`, JSON.stringify(onServer && onServer._f));
    // 照 store.js importRecords：本機已有同一筆（cur），收到伺服器那份（inc）
    const { rec: healed } = mergeRecord(structuredClone(onServer), structuredClone(onServer));
    const heals = stable(healed) !== stable(onServer);
    yes(heals && healed._f.leg === 0 && healed._f.important === 0 && healed._f.booked === 0,
      '前置：新版合併真的會補 0、真的會觸發補推（情境成立）', JSON.stringify(healed._f));
    // 主要目標：只補了時間戳、值沒變的那一份推回去 → D1 不寫
    r = await push(gid, secret, [healed]);
    const jh = await r.json().catch(() => ({}));
    const p1 = await (await fetch(`${B}/pull?g=${gid}&since=${seq0}`, auth)).json();
    const rewritten = (p1.records || []).filter((x) => x.id === 'L1');
    yes(r.ok && jh.wrote === 0, `【新組】只補了時間戳的推回：Worker 回 wrote=0（實得 HTTP ${r.status}、wrote=${jh.wrote}）`);
    yes(rewritten.length === 0 && p1.seq === seq0,
      `【新組】另外讀 D1：那一筆沒有被重寫、群組 seq 沒動（seq ${seq0} → ${p1.seq}，since=${seq0} 讀到 L1 ${rewritten.length} 筆）`);
    // 對照組：真的選了交通方式（值變了）→ 要寫進去。這條沒寫的話，上面的「沒寫」可能只是整段沒跑到
    const tC = Date.now();
    const changed = { ...healed, legFrom: 'L0', legMode: 'train', updatedAt: tC, deviceId: 'dNew', _f: { ...healed._f, leg: tC } };
    r = await push(gid, secret, [changed]);
    const jc = await r.json().catch(() => ({}));
    const p2 = await (await fetch(`${B}/pull?g=${gid}&since=${seq0}`, auth)).json();
    const got = (p2.records || []).find((x) => x.id === 'L1');
    yes(r.ok && jc.wrote === 1, `【新組·對照】真的改了值：Worker 回 wrote=1（實得 HTTP ${r.status}、wrote=${jc.wrote}）`);
    yes(got && got.legMode === 'train' && got.legFrom === 'L0' && got._f.leg === tC && p2.seq > seq0,
      `【新組·對照】另外讀 D1：讀得到新值、leg 的時間戳、seq 前進（seq ${seq0} → ${p2.seq}）`, JSON.stringify(got));
  }

  // ---------- 三樣新紀錄 buy／stay／flight（2026-11-06）走真的 Worker ----------
  // 投票（docs/VOTE_2026-11-05_航班待買住宿.md）第 4 步：部署前用 workertest 驗。純函式層（舊版副本、寫入次數）在 mergetest；
  // 這裡驗只有真的 Worker＋D1 才驗得到的：_f 存得進去、舊的那份推上去會輸、兩台改不同組都留下、不在表上的型別整筆存整筆回。
  {
    const auth = { headers: { authorization: 'Bearer ' + secret } };
    const pullAll = async () => (await (await fetch(`${B}/pull?g=${gid}&since=0`, auth)).json()).records || [];
    const tB = Date.now() - 30_000;
    const fB = { text: tB, done: tB };
    r = await push(gid, secret, [{ id: 'B1', type: 'buy', tripId: 'r1', text: '防曬乳', done: false, doneBy: null, updatedAt: tB, deviceId: 'dA', _f: fB }]);
    let got = (await pullAll()).find((x) => x.id === 'B1');
    yes(r.ok && got && got._f && got._f.text === tB && got._f.done === tB,
      `【新紀錄】buy 的 _f 兩組都存進 D1、讀得回來（HTTP ${r.status}）`, JSON.stringify(got && got._f));
    // 兩台改不同組：A 改字（較早）、B 勾了（較晚）——兩邊都留下
    r = await push(gid, secret, [{ ...got, text: '防曬乳 SPF50', updatedAt: tB + 1000, deviceId: 'dA', _f: { ...fB, text: tB + 1000 } }]);
    r = await push(gid, secret, [{ ...got, done: true, doneBy: 'm1', updatedAt: tB + 2000, deviceId: 'dB', _f: { ...fB, done: tB + 2000 } }]);
    got = (await pullAll()).find((x) => x.id === 'B1');
    yes(got && got.text === '防曬乳 SPF50' && got.done === true && got.doneBy === 'm1',
      '【新紀錄】buy：一台改字、另一台較晚勾了 → 伺服器兩邊都留下', JSON.stringify(got));
    // 舊的那份推上去會輸（離線很久的手機把最早那份推上來）
    const tS = Date.now() - 20_000;
    const stay = { id: 'S1', type: 'stay', tripId: 'r1', name: '海邊民宿', checkIn: '2024-03-10', checkOut: '2024-03-12', address: null, note: '', deviceId: 'dA' };
    await push(gid, secret, [{ ...stay, name: '海邊民宿（新）', updatedAt: tS + 5000, _f: { name: tS + 5000, dates: tS, addr: tS, note: tS } }]);
    const pre = (await pullAll()).find((x) => x.id === 'S1');
    r = await push(gid, secret, [{ ...stay, updatedAt: tS, deviceId: 'dOld', _f: { name: tS, dates: tS, addr: tS, note: tS } }]);
    const jo = await r.json().catch(() => ({}));
    got = (await pullAll()).find((x) => x.id === 'S1');
    yes(pre && pre.name === '海邊民宿（新）' && r.ok && jo.wrote === 0 && got && got.name === '海邊民宿（新）',
      `【新紀錄】stay：舊的那份推上去會輸（wrote=${jo.wrote}、伺服器上仍是「${got && got.name}」）`);
    // 對照組：同一筆真的較晚改了別組（日期）→ 要寫進去，而且名字不被舊值蓋回
    r = await push(gid, secret, [{ ...stay, checkIn: '2024-03-11', updatedAt: tS + 9000, deviceId: 'dOld', _f: { name: tS, dates: tS + 9000, addr: tS, note: tS } }]);
    const jn = await r.json().catch(() => ({}));
    got = (await pullAll()).find((x) => x.id === 'S1');
    yes(r.ok && jn.wrote === 1 && got && got.checkIn === '2024-03-11' && got.name === '海邊民宿（新）',
      `【新紀錄·對照】stay：較晚改了日期 → 寫進去（wrote=${jn.wrote}），名字照樣是新的那個`, JSON.stringify(got));
    // flight 的四組
    const tF = Date.now() - 10_000;
    r = await push(gid, secret, [{ id: 'F1', type: 'flight', tripId: 'r1', flightNo: 'XX 101', depDate: '2024-03-10', depTime: '08:30', depPlace: '', arrDate: null, arrTime: '', arrPlace: '', note: '',
      updatedAt: tF, deviceId: 'dA', _f: { no: tF, dep: tF, arr: tF, note: tF } }]);
    got = (await pullAll()).find((x) => x.id === 'F1');
    yes(r.ok && got && got._f && ['no', 'dep', 'arr', 'note'].every((g) => got._f[g] === tF),
      '【新紀錄】flight 的 _f 四組都存進 D1、讀得回來', JSON.stringify(got && got._f));
    // 不在表上的型別：整筆存、整筆回（_f 被拿掉＝整筆後寫者贏，跟現役 Worker 對這三種做的事一樣）
    const tU = Date.now() - 5_000;
    r = await push(gid, secret, [{ id: 'U1', type: 'zzfuture', tripId: 'r1', a: 1, b: { c: [1, 2] }, updatedAt: tU, deviceId: 'dA', _f: { a: tU } }]);
    got = (await pullAll()).find((x) => x.id === 'U1');
    yes(r.ok && got && got.a === 1 && JSON.stringify(got.b) === '{"c":[1,2]}' && got._f === undefined,
      '【新紀錄】不在表上的型別：整筆存整筆回、_f 被拿掉（舊版 Worker 對 buy／stay／flight 就會這樣）', JSON.stringify(got));

    // ---------- 讚（v1.76.0，投票 (c)）：固定 id 的 like 紀錄，整筆後寫者贏 ----------
    // 投票說「伺服器不用改」；這裡用真的 Worker＋D1 證明最小的一輪：按讚 → 換表情 → 收回，每一步都寫得進去
    // （沒有變成「已存在就不動」——那是 APPEND_ONLY 的行為，like 不在裡面）。最小範圍（Yolin 2026-11-10 工作方式指示）。
    const tL = Date.now() - 4_000;
    const like = { id: 'like:S9:m1', type: 'like', tripId: 'r1', submissionId: 'S9', actorId: 'm1', createdAt: tL, deviceId: 'dA' };
    const steps = [['❤️', '按讚'], ['👍', '換表情'], [null, '收回']];
    const seen = [];
    for (const [i, [emo]] of steps.entries()) {
      r = await push(gid, secret, [{ ...like, emoji: emo, updatedAt: tL + i }]);
      got = (await pullAll()).find((x) => x.id === like.id);
      seen.push(r.ok && got ? got.emoji : '（沒讀到）');
    }
    yes(JSON.stringify(seen) === JSON.stringify(['❤️', '👍', null]), `【讚】真的 Worker：按讚 → 換表情 → 收回，每一步伺服器上都是新的值（實得 ${JSON.stringify(seen)}）`);
  }

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
  // 未驗證的請求也走 push 的限流桶（30 次／60 秒，以 IP 為 key），所以同樣要確認 40 次落在同一個視窗（見下面 burst40）
  const scan = await burst40((i, round) => push(gid, rnd() + rnd(), [{ id: `x${round}_${i}`, type: 'trip', title: 'x', updatedAt: Date.now(), deviceId: 'z' }]));
  yes(scan.sameWin, `前置：掃描那一輪 40 次落在同一個 60 秒視窗裡（打了 ${scan.rounds} 輪：${scan.spans}）`);
  const got429 = scan.n429;
  yes(got429 > 0, `每次換一把錯祕鑰的掃描會被擋（40 次裡 ${got429} 次 429）—— 以前一次都不會擋`);
  r = await push(gid, secret, [{ id: 'r2', type: 'spot', tripId: 'r1', name: 'ok', updatedAt: Date.now(), deviceId: 'd1' }]);
  yes(r.ok, `自己人不會被剛才那波掃描連坐（HTTP ${r.status}）`);

  // ---------- 限流本身（v1.65，上線至今從未被執行過）----------
  // 40 次要落在同一個固定視窗裡才算數，見檔頭的 burst40
  const own = await burst40((i, round) => push(gid, secret, [{ id: `p${round}_${i}`, type: 'spot', tripId: 'r1', name: 'p', updatedAt: Date.now() + i, deviceId: 'd1' }]));
  const { n429, retryAfter } = own;
  yes(own.sameWin, `前置：計數的那一輪 40 次 push 落在同一個 60 秒視窗裡（打了 ${own.rounds} 輪：${own.spans}）`);
  yes(n429 > 0, `push 超過額度會回 429（40 次裡 ${n429} 次；LIMITS.push=30/60s）`);
  yes(retryAfter === '60', `429 帶 Retry-After: 60（實得 ${retryAfter}）`);

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
      // 認子孫看建立時間、逐支殺（不用 taskkill /T——PID 重用時會殺到不相干的程序；2026-10-02）
      killTree(dev.pid, { log: (s) => console.log(s) });
    } else {
      process.kill(-dev.pid, 'SIGKILL');
    }
  } catch { /* noop */ }
  dev.kill();
  await sleep(1500);
  await rm(path.join(WDIR, '.wrangler'), { recursive: true, force: true }).catch(() => {});
}
console.log('\nWorker 測試結束\n\n' + pass + ' 項通過' + (process.exitCode ? '，有失敗' : ''));
