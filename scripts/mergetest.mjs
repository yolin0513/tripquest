// 欄位級合併（npm run mergetest）—— 三代理 3:0「GO with changes」的驗收：
//   純函式層（js/merge.js）：分組 LWW、收斂（merge(a,b)==merge(b,a)）、pos 手動優先、
//     舊記錄退路、刪除整筆語意、trip/quest 追蹤表、_f 白名單
//   兩台裝置（LAN 伺服器 server/index.mjs，與 Worker 同一份 merge.js）：
//     (a) 同時改不同欄位都保留  (b) 同欄位較晚者勝、兩台一致  (c) 刪除 vs 編輯整筆語意
//     (e) 兩台同時 push          (f) 非追蹤欄位（enrich 類）推高 updatedAt 不吃掉別人的釘住
//     (g) 表單送出沒改的 name 不搶走對方的改名  (h) 沒改動再 push 一次 wrote=0（不造成同步風暴）
//     (i) 時鐘慢 3 分鐘的裝置改的東西照樣推得出去

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { mergeRecord, seedF, groupChanged, sanitizeF, TRACKED } from '../js/merge.js';

let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));
const J = (x) => JSON.stringify(x);

// ================= 純函式 =================
console.log('— merge.js 純函式 —');
{
  const base = { id: 'x', type: 'spot', name: '清水寺', day: 1, order: 0, lat: null, lng: null, pinned: false, updatedAt: 1000, deviceId: 'a', _f: seedF({ type: 'spot' }, 1000) };
  // (a) 不同欄位：A 補座標（t=2000）、B 釘住（t=3000）
  const A = { ...base, lat: 34.99, lng: 135.78, geoSrc: 'osm', updatedAt: 2000, deviceId: 'a', _f: { ...base._f, pos: 2000 } };
  const B = { ...base, pinned: true, updatedAt: 3000, deviceId: 'b', _f: { ...base._f, pinned: 3000 } };
  const m1 = mergeRecord(A, B).rec, m2 = mergeRecord(B, A).rec;
  yes(m1.lat === 34.99 && m1.pinned === true, '(a) 不同欄位：座標與釘住都保留');
  yes(J(m1) === J(m2), '合併順序無關（merge(A,B) === merge(B,A)）');
  yes(m1._f.pos === 2000 && m1._f.pinned === 3000 && m1.updatedAt === 3000, '_f 逐組取較大、updatedAt 取較大');
  // (b) 同欄位：較晚者勝
  const N1 = { ...base, name: '清水寺-A', updatedAt: 2000, _f: { ...base._f, name: 2000 } };
  const N2 = { ...base, name: '清水寺-B', updatedAt: 2500, deviceId: 'b', _f: { ...base._f, name: 2500 } };
  yes(mergeRecord(N1, N2).rec.name === '清水寺-B' && mergeRecord(N2, N1).rec.name === '清水寺-B', '(b) 同欄位：較晚者勝');
  // 同分：deviceId → 值本身，任何順序一致
  const T1 = { ...base, name: 'Z', updatedAt: 2000, deviceId: 'a', _f: { ...base._f, name: 2000 } };
  const T2 = { ...base, name: 'Y', updatedAt: 2000, deviceId: 'a', _f: { ...base._f, name: 2000 } };
  yes(mergeRecord(T1, T2).rec.name === mergeRecord(T2, T1).rec.name, '同分（同時間、同裝置）也收斂');
  // slot 一組：A 拖到第 2 天第 0 位（t=3000）、B 在第 1 天把它移到第 3 位（t=2500）→ 整組取 A
  const S1 = { ...base, day: 2, order: 0, updatedAt: 3000, _f: { ...base._f, slot: 3000 } };
  const S2 = { ...base, day: 1, order: 3, updatedAt: 2500, deviceId: 'b', _f: { ...base._f, slot: 2500 } };
  const sm = mergeRecord(S1, S2).rec;
  yes(sm.day === 2 && sm.order === 0, 'slot（day+order）整組合併，不會出現「第 2 天 order 3」這種誰都沒指定的位置');
  // pos：手動優先，不看時間
  const P1 = { ...base, lat: 1, lng: 1, geoSrc: 'manual', updatedAt: 2000, _f: { ...base._f, pos: 2000 } };
  const P2 = { ...base, lat: 2, lng: 2, geoSrc: 'osm', updatedAt: 5000, deviceId: 'b', _f: { ...base._f, pos: 5000 } };
  yes(mergeRecord(P1, P2).rec.geoSrc === 'manual' && mergeRecord(P2, P1).rec.lat === 1, 'pos：手動貼的座標優先於較晚的自動查詢');
  // time 一組含舊字串：A 清掉時間（startMin null、startTime ''）較晚，B 帶舊字串 → 不復活
  const Q1 = { ...base, startMin: null, stayMin: null, startTime: '', endTime: '', updatedAt: 4000, _f: { ...base._f, time: 4000 } };
  const Q2 = { ...base, startMin: 540, startTime: '09:00', updatedAt: 3500, deviceId: 'b', _f: { ...base._f, time: 3500 } };
  const qm = mergeRecord(Q2, Q1).rec;
  yes(qm.startMin === null && qm.startTime === '', 'time 組含舊字串 startTime：清掉的時間不會從舊字串復活');
  // 舊記錄退路：沒有 _f 的記錄，每組用 updatedAt；純舊對純舊 = 整筆 LWW
  const L1 = { id: 'x', type: 'spot', name: '舊A', day: 1, order: 0, updatedAt: 1000, deviceId: 'a' };
  const L2 = { id: 'x', type: 'spot', name: '舊B', day: 1, order: 1, updatedAt: 2000, deviceId: 'b' };
  const lm = mergeRecord(L1, L2).rec;
  yes(lm.name === '舊B' && lm.order === 1 && lm._f && lm._f.name === 2000, '純舊對純舊＝整筆後寫者勝，並把 _f 播種齊全');
  // 舊記錄 vs 新版：新版只改 pinned（t=3000，_f 播種自 1500）；舊記錄改了 name（t=2000）→ name 取舊記錄的（2000 > 1500）
  const L3 = { id: 'x', type: 'spot', name: '舊記錄改的名', day: 1, order: 0, updatedAt: 2000, deviceId: 'a' };
  const N3 = { id: 'x', type: 'spot', name: '原名', day: 1, order: 0, pinned: true, updatedAt: 3000, deviceId: 'b', _f: { ...seedF({ type: 'spot' }, 1500), pinned: 3000 } };
  const lm3 = mergeRecord(L3, N3).rec;
  yes(lm3.name === '舊記錄改的名' && lm3.pinned === true, '舊記錄的改名不被新版「只改釘住」的記錄吃掉（播種齊全＋退路）');
  // 刪除整筆語意
  const D1 = { ...base, deleted: true, updatedAt: 5000, deviceId: 'a' };
  const E1 = { ...base, stayMin: 45, updatedAt: 4000, deviceId: 'b', _f: { ...base._f, time: 4000 } };
  yes(mergeRecord(E1, D1).rec.deleted === true && mergeRecord(D1, E1).rec.deleted === true, '(c) 刪除較晚 → 整筆刪除（不會半刪）');
  const E2 = { ...base, stayMin: 45, updatedAt: 6000, deviceId: 'b', _f: { ...base._f, time: 6000 } };
  const r2 = mergeRecord(D1, E2).rec;
  yes(!r2.deleted && r2.stayMin === 45, '(c) 編輯較晚 → 景點還在且帶著編輯');
  // changed 判定：同一筆再合併 → 不變（伺服器不寫、不佔 seq）
  yes(mergeRecord(m1, m1).changed === false && mergeRecord(m1, A).changed === false, '相同或已包含的資訊再合併 → changed=false');
  // trip 與 quest 也在追蹤表；album 組不會被「沒有 albumId 的舊記錄」蓋空
  const tr1 = { id: 't', type: 'trip', title: '宜蘭', albumId: 'abc', albumUrl: 'u', updatedAt: 3000, deviceId: 'a', _f: { ...seedF({ type: 'trip' }, 3000) } };
  const tr2 = { id: 't', type: 'trip', title: '宜蘭家族旅行', updatedAt: 4000, deviceId: 'b' };
  const tm = mergeRecord(tr1, tr2).rec;
  yes(TRACKED.trip && TRACKED.quest && tm.title === '宜蘭家族旅行' && tm.albumId === 'abc', 'trip：標題取較晚、albumId 不被沒有此欄位的舊記錄蓋空');
  // groupChanged：表單送同值不算改
  yes(groupChanged({ name: 'a' }, { name: 'a' }, ['name']) === false && groupChanged({ name: 'a' }, { name: 'b' }, ['name']) === true, 'groupChanged：值沒變不算改');
  // sanitizeF 白名單
  // v1.73.2：未知鍵改成**刻意放行**（伺服器要當透明管道，
  // 不然它自己就是那個把新欄位組的時間戳砍掉的人）。這是行為變更不是回歸。
  const bad = sanitizeF({ type: 'spot', _f: { name: 1, futureGroup: 2, pos: 'x' } });
  yes(J(Object.keys(bad._f).sort()) === J(['futureGroup', 'name']),
    'sanitizeF：已知組與未來組都留、非數字丟掉', J(bad._f));
  // 隨機收斂：三方合併，任何順序結果一致。
  //
  // 母體分三種，缺一不可（v1.73.1）：
  //   齊全 —— 同版裝置之間，理想情況
  //   全無 —— v1.56 之前的舊記錄（seedF 還沒跑過）
  //   部分 —— **混版才會出現**：舊版客戶端合併時是用它自己那一版的 TRACKED
  //           重建 _f 的，不認識的欄位組整個消失，留下一份「部分 _f」的記錄
  //
  // 以前只生「齊全」。而「混版在這個專案是常態不是例外」是寫在決策文件裡的前提，
  // 卻是唯一沒有進 fuzz 母體的那一種 —— 這一區的 bug 全部抓不到。
  const GROUPS = ['name', 'slot', 'time', 'pinned', 'pos'];
  const shapes = { full: 0, none: 0, partial: 0 };
  let conv = true, convWhy = '';
  for (let i = 0; i < 600 && conv; i++) {
    const r = () => Math.floor(Math.random() * 5);
    const mkF = () => {
      // 形狀要**逐台**隨機，不能整輪一樣 —— 混版的意思正是三台形狀不同
      const d3 = Math.floor(Math.random() * 3);
      const kind = d3 === 0 ? 'full' : d3 === 1 ? 'none' : 'partial';
      shapes[kind]++;
      if (kind === 'none') return undefined;
      const keep = kind === 'full' ? GROUPS : GROUPS.filter(() => Math.random() > 0.4);
      const f = {};
      for (const g of keep) f[g] = 1000 + r() * 100;
      return f;
    };
    const mk = (d) => ({ id: 'x', type: 'spot', name: 'n' + r(), day: r(), order: r(), pinned: !!(r() % 2), stayMin: r() * 10,
      updatedAt: 1000 + r() * 100, deviceId: d, _f: mkF() });
    const a = mk('a'), b = mk('b'), c = mk('c');
    const x = mergeRecord(mergeRecord(a, b).rec, c).rec;
    const y = mergeRecord(mergeRecord(c, a).rec, b).rec;
    const z = mergeRecord(b, mergeRecord(c, a).rec).rec;
    if (J(x) !== J(y) || J(y) !== J(z)) { conv = false; convWhy = J({ a, b, c, x, y, z }).slice(0, 400); }
  }
  yes(conv, `隨機 600 組三方合併都收斂（_f 齊全 ${shapes.full}／全無 ${shapes.none}／部分 ${shapes.partial}）`, convWhy);
  // 母體不能是空的：上面三種形狀每一種都要真的生出來過，
  // 不然這條斷言會在「產生器壞掉」時空轉通過（這一套裡最常見的假綠燈）。
  yes(shapes.full > 100 && shapes.none > 100 && shapes.partial > 100,
    `三種 _f 形狀都有進到母體（不是空轉通過）`, J(shapes));
}

// ================= 混版（v1.73.2）=================
//
// 使用者回報：媽媽（舊手機）只是改了行程名，爸爸設好的「每天幾點出發」就跳回舊的，
// 而且來回不會停。根因是舊版客戶端的 mergeRecord 用**它自己那一版的 TRACKED**
// 重建 _f，不認識的欄位組整個消失；新版再讀時 effTs 找不到就退路到 updatedAt，
// 於是舊值取得一個全新的時間戳。
//
// 這裡不 mock 合併邏輯：讀真的 js/merge.js，只把 TRACKED 裡的 dayStarts 那一行
// 用字串手術刪掉，做出一份「v1.68 客戶端」。伺服器端照抄 workers/worker.mjs
// 的 plan()（sanitizeF → mergeRecord → 只有 changed 才寫）。
{
  console.log('\n— 混版（舊版客戶端不認識新欄位組）—');
  const SRC = await readFile(new URL('../js/merge.js', import.meta.url), 'utf8');
  const oldSrc = SRC.replace(/dayStarts:\s*\[[^\]]*\],?\s*/g, '');
  yes(oldSrc !== SRC, '做得出「舊版 TRACKED」副本（找得到 dayStarts 那一行）');
  const tmp = new URL('./_mixver_old.mjs', import.meta.url);
  await writeFile(tmp, oldSrc, 'utf8');
  const Old = await import(tmp.href);
  await rm(tmp, { force: true });

  const stampG = (r, g, t) => ({ ...r, updatedAt: t, _f: { ...(r._f || {}), [g]: t } });
  const clone = (r) => JSON.parse(JSON.stringify(r));
  // 伺服器：照抄 worker.mjs plan() 的合併語意
  const mkServer = () => {
    let row = null;
    return {
      push(rec0) {
        const rec = sanitizeF(clone(rec0));
        if (!row) { row = rec; return; }
        const { rec: merged, changed } = mergeRecord(row, rec);
        if (changed) row = merged;
      },
      pull() { return row && clone(row); },
      get startMin() { return row && row.dayStarts && row.dayStarts[1]; },
    };
  };

  // 情境一：A 設 07:00 之後，B 只改行程名（完全沒碰出發時刻）
  const S = mkServer();
  let a = stampG(stampG({ id: 't1', type: 'trip', title: '宜蘭', dayStarts: { 1: 540 } }, 'dayStarts', 1000), 'title', 1000);
  S.push(a);
  let b = Old.mergeRecord(null, S.pull()).rec;
  a = stampG({ ...a, dayStarts: { 1: 420 } }, 'dayStarts', 1500);   // A：改成 07:00
  S.push(a);
  b = Old.mergeRecord(stampG({ ...b, title: '宜蘭三日' }, 'title', 2000), b).rec;   // B：只改名字
  S.push(b);
  yes(S.startMin === 420,
    '舊版裝置改行程名，不會把新版設好的「每天幾點出發」蓋回去',
    `伺服器上是 ${S.startMin}（應為 420）`);

  // 情境二：舊版真的沒有這個欄位時，也不能讓它把值弄不見
  const S2 = mkServer();
  let a2 = stampG(stampG({ id: 't2', type: 'trip', title: 'x', dayStarts: { 1: 480 } }, 'dayStarts', 3000), 'title', 3000);
  S2.push(a2);
  const b2 = Old.mergeRecord(null, S2.pull()).rec;
  S2.push(stampG({ ...b2, title: 'y' }, 'title', 3500));
  yes(S2.startMin === 480, '舊版裝置推回來也不會讓新欄位的值消失', `伺服器上是 ${S2.startMin}`);

  // 情境三：升級當下 —— B 換成新版，本機那份 stale 值不能拿新戳去蓋人
  //（這是 seedF 那一半在守的；只做 effTs 那一半的話這條會紅）
  const S3 = mkServer();
  let a3 = stampG(stampG({ id: 't3', type: 'trip', title: 'x', dayStarts: { 1: 540 } }, 'dayStarts', 1000), 'title', 1000);
  S3.push(a3);
  let b3 = Old.mergeRecord(null, S3.pull()).rec;               // B 在舊版時期合併過 → _f.dayStarts 消失
  a3 = stampG({ ...a3, dayStarts: { 1: 420 } }, 'dayStarts', 5000);
  S3.push(a3);
  // B 升級成新版，然後改了行程名（走 store.patch 的語意：seedF + 只 bump 改到的組）
  const f3 = seedF(b3, b3.updatedAt);
  const b3n = { ...b3, title: 'z', updatedAt: 6000, _f: { ...f3, title: 6000 } };
  S3.push(b3n);
  yes(S3.startMin === 420,
    '舊裝置升級後改別的東西，不會幫本機那份 stale 值蓋新章去覆蓋別台',
    `伺服器上是 ${S3.startMin}（應為 420）`);

  // 情境四：sanitizeF 要放行未知鍵（否則伺服器自己就是製造「缺一組」的來源），
  // 但要有閘門
  const un = sanitizeF({ type: 'trip', _f: { title: 1000, futureGroup: 2000, evil: 'x', BAD_KEY: 3000, __proto__: 4000 } });
  yes(Number.isFinite(un._f.futureGroup) && un._f.title === 1000,
    'sanitizeF：放行未來版本的欄位組（不然伺服器就是那個把鍵砍掉的人）', J(un._f));
  yes(un._f.evil === undefined && un._f.BAD_KEY === undefined,
    'sanitizeF：非數字與不合規鍵名照樣擋掉', J(un._f));
  const many = {};
  for (let i = 0; i < 40; i++) many['fut' + i] = 1000 + i;
  const cap = sanitizeF({ type: 'trip', _f: { title: 1000, ...many } });
  yes(Object.keys(cap._f).length <= 9,
    `sanitizeF：未知鍵有數量上限（40 個只留 ${Object.keys(cap._f).length - 1} 個未知鍵）`, J(Object.keys(cap._f).length));
  const frozen = sanitizeF({ type: 'trip', _f: { title: 9e15 } });
  yes(frozen._f.title === undefined,
    'sanitizeF：擋掉遠在未來的時間戳（否則任何人都能把一個欄位組永久凍結）', J(frozen._f));
}

// ================= 兩台裝置 =================
console.log('\n— 兩台裝置（LAN 伺服器）—');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5561, API = 8791;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  return page;
}
const drain = (page) => page.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
const spotOf = (page, sid) => page.evaluate((sid) => { const s = window.__s; return s.getRaw(sid); }, sid);
const bindStore = (page) => page.evaluate(async () => { window.__s = await import('./js/store.js'); });
const patchOn = (page, id, ch) => page.evaluate(({ id, ch }) => window.__s.patch(id, ch), { id, ch });

try {
  const A = await device('A'); const B = await device('B');
  await bindStore(A); await bindStore(B);
  const setup = await A.evaluate(async () => {
    const s = window.__s; const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync, shareURL } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), sid = uuid(), sid2 = uuid();
    await s.put({ id: gid, type: 'group', name: '合併測試團' });
    await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '合併測試', region: '京都', allowWiki: false });
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '清水寺', emoji: '🏯', day: 1, order: 0 });
    await s.put({ id: sid2, type: 'spot', tripId: tid, name: '金閣寺', emoji: '🏯', day: 1, order: 1 });
    await ensureGroupSync(gid);
    return { gid, tid, sid, sid2, invite: await shareURL(tid) };
  });
  await drain(A);
  await B.evaluate(async (u) => { const sh = await import('./js/share.js'); await sh.joinInvite(sh.parseInviteText(u)); }, setup.invite);
  const joined = await spotOf(B, setup.sid);
  yes(joined && joined.name === '清水寺' && joined._f && Number.isFinite(joined._f.name), 'B 加入群組，拿到帶 _f 的景點');

  // (a) 同時改不同欄位：A 補座標、B 釘住（各自本機先改，再各自同步）
  await patchOn(A, setup.sid, { lat: 34.9949, lng: 135.785, geoSrc: 'osm' });
  await patchOn(B, setup.sid, { pinned: true });
  await drain(A); await drain(B); await drain(A);
  let a = await spotOf(A, setup.sid), b = await spotOf(B, setup.sid);
  yes(a.lat === 34.9949 && a.pinned === true && b.lat === 34.9949 && b.pinned === true,
    `(a) 兩台同時改不同欄位 → 座標與釘住都保留（A:${a.lat}/${a.pinned}，B:${b.lat}/${b.pinned}）`);

  // (g) 表單送出沒改的 name：A 改名 → B 用「整份表單」存停留時間（name 沒動也一起送）→ A 的改名要活著
  await patchOn(A, setup.sid, { name: '清水寺（改）' });
  await drain(A);
  await sleep(30);
  await patchOn(B, setup.sid, { name: '清水寺', stayMin: 45, startMin: null, startTime: '', endTime: '' });   // 表單存檔的樣子（name 是 B 手上的舊值）
  await drain(B); await drain(A); await drain(B);
  a = await spotOf(A, setup.sid); b = await spotOf(B, setup.sid);
  yes(a.name === '清水寺（改）' && b.name === '清水寺（改）' && a.stayMin === 45 && b.stayMin === 45,
    `(g) 表單送出沒改的 name 不搶走對方的改名（${b.name}，停留 ${b.stayMin}）`);

  // (b) 同欄位：A 先改、B 後改 → 兩台都是 B 的
  await patchOn(A, setup.sid2, { name: '金閣寺-A' });
  await sleep(30);
  await patchOn(B, setup.sid2, { name: '金閣寺-B' });
  await drain(A); await drain(B); await drain(A);
  a = await spotOf(A, setup.sid2); b = await spotOf(B, setup.sid2);
  yes(a.name === '金閣寺-B' && b.name === '金閣寺-B', `(b) 同欄位較晚者勝、兩台一致（${a.name}）`);

  // (f) 非追蹤欄位推高 updatedAt：B 先改 pinned（較早），A 之後 patch blurb（enrich 類）→ B 的釘住要活著
  await patchOn(B, setup.sid2, { pinned: true });
  await sleep(30);
  await patchOn(A, setup.sid2, { blurb: '自動補的介紹（enrich）', _enrichV: 3 });
  await drain(A); await drain(B); await drain(A);
  a = await spotOf(A, setup.sid2); b = await spotOf(B, setup.sid2);
  yes(a.pinned === true && b.pinned === true && a.blurb.includes('enrich'), '(f) 別台的背景寫入（blurb）推高 updatedAt，不吃掉我的釘住');

  // (h) 沒改動再 push：wrote=0，seq 不變（不造成同步風暴）
  const storm = await A.evaluate(async (gid) => {
    const s = window.__s; const sync = await import('./js/sync.js');
    const g = s.getRaw(gid); const ad = sync.adapterForGroup(gid, g.syncSecret);
    const r1 = await ad.push(s.exportGroup(gid)); const r2 = await ad.push(s.exportGroup(gid));
    return { w1: r1.wrote, w2: r2.wrote, s1: r1.seq, s2: r2.seq };
  }, setup.gid);
  yes(storm.w2 === 0 && storm.s1 === storm.s2, `(h) 沒改動再 push 一次：wrote=${storm.w2}、seq 不變（${storm.s2}）`);

  // (e) 兩台同時 push 不同欄位
  await patchOn(A, setup.sid, { stayMin: 90 });
  await patchOn(B, setup.sid, { pinned: false });
  await Promise.all([drain(A), drain(B)]);
  await drain(A); await drain(B); await drain(A);
  a = await spotOf(A, setup.sid); b = await spotOf(B, setup.sid);
  yes(a.stayMin === 90 && a.pinned === false && b.stayMin === 90 && b.pinned === false, '(e) 兩台同時 push：最終三方一致、兩邊欄位都在');

  // (i) 時鐘慢 3 分鐘的 B：拉到 A 的版本後再改，還推得出去
  await patchOn(A, setup.sid2, { stayMin: 30 });
  await drain(A); await drain(B);
  await B.evaluate(() => { const real = Date.now; window.__realNow = real; Date.now = () => real() - 180000; });
  await patchOn(B, setup.sid2, { stayMin: 75 });
  await drain(B); await drain(A);
  a = await spotOf(A, setup.sid2);
  await B.evaluate(() => { Date.now = window.__realNow; });
  yes(a.stayMin === 75, `(i) 時鐘慢 3 分鐘的裝置改的停留時間照樣同步到對方（${a.stayMin}）`);

  // (c) 刪除 vs 編輯：A 改欄位、B 稍後刪除 → 兩台都刪
  await patchOn(A, setup.sid2, { name: '金閣寺-改' });
  await sleep(30);
  await B.evaluate((sid) => window.__s.remove(sid), setup.sid2);
  await drain(A); await drain(B); await drain(A);
  a = await spotOf(A, setup.sid2); b = await spotOf(B, setup.sid2);
  yes(a.deleted === true && b.deleted === true, '(c) 刪除較晚 → 兩台都整筆刪除（沒有半刪）');

  // 記錄體積：_f 只有五組數字
  const size = await A.evaluate((sid) => JSON.stringify(window.__s.getRaw(sid)._f).length, setup.sid);
  yes(size < 120, `_f 體積 ${size} bytes（不膨脹）`);

  console.log('\n欄位級合併測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
