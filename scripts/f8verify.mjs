// F8 的驗法（npm run f8verify）：build-places.mjs、importshots.mjs 每一個單位 × 每一種情境都要擋下。
// 全部擋下才把「建置腳本＋這支驗法」HEAD 裡的雜湊登記進 .logs/f8.verified（不進版控；補充工單 F9，2026-09-24）；
// safe-push.sh 在這次要推的 commit 動到它們時比對，對不上就回 6、不推。有任何一格沒擋、或驗法自己出錯，就刪掉登記。
//
// 怎麼跑（為什麼長這樣）：
// - 先確認這三支的工作區跟 HEAD 一模一樣，有改動就不跑、不登記：登記的要是推出去的那一份（統籌者 2026-09-24 踩過反方向的坑——
//   複本是已 commit 的版本、新段落還沒 commit，跑到的是舊的）。
// - 在 .logs/f8-wt 開一份 HEAD 的暫存複本（git worktree）來跑：情境要改 data/places、screenshots、素材，不能碰工作區。
//   放在 repo 底下，node 往上找得到 node_modules，不必接 junction（刪複本時才不會順著連結刪到真的 node_modules）。
//   跑之前斷言複本裡三支的雜湊等於 HEAD，並印出來（突變時拿它確認跑到的真的是改壞的那一版）。
// - 每一格五件事都成立才算擋下：回傳非 0、✗ 那一行點名這個單位（對邊界）、理由對、輸出資料夾前後雜湊相同、沒有堆疊；
//   清理那幾種另外要：別人的東西還在、自己的暫存清掉了（清不掉就要在 ✗ 那一行點名「清不掉」）。被別的規則碰巧擋下的算沒擋。
// - 判定程式本身先跑合成的對照組（每一種「沒擋」各一份），對照組沒過就不跑矩陣（§5.11 第二層）。
// - 格數用斷言確認：build-places＝城市數 × 10、importshots＝21。
// - 鎖檔的情境要 Windows 的 PowerShell（Node 開檔不會擋改名）；鎖檔的程序自己等哨兵檔消失才放開、正常結束，這裡從不殺程序。
//
// 環境變數：F8VERIFY_ONLY=bp 或 is 只跑其中一個矩陣（給突變用；只跑一半時一律不登記）。
// 耗時：272 秒（2026-09-24 在 1b55171 實測，181 格）。
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headProblems, headHash, writeReg, dropReg, regAction } from './verified-reg.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REG = path.join(ROOT, '.logs', 'f8.verified');
export const F8_FILES = ['scripts/build-places.mjs', 'scripts/importshots.mjs', 'scripts/f8verify.mjs'];
const ONLY = process.env.F8VERIFY_ONLY || '';
const WT = path.join(ROOT, '.logs', 'f8-wt');
const t0 = Date.now();
let failed = 0;
const bad = (m) => { failed++; console.log('✗ ' + m); };
const git = (args, cwd = ROOT) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// importshots 每拍一張印一行「✓ v1.38-NN-名字.png」：數這些行＝拍進 .partial 的張數
const countShots = (out) => (out.match(/^✓ v1\.38-\d\d-/gm) || []).length;

const rmWT = () => {
  if (!fs.existsSync(WT)) return;
  git(['worktree', 'remove', '--force', WT]);
  if (fs.existsSync(WT)) fs.rmSync(WT, { recursive: true, force: true });
  git(['worktree', 'prune']);
};
// 中途停下：收掉暫存複本、刪掉登記、點名原因
const give = (why) => {
  rmWT();
  console.log(`✗ ${why}`);
  console.log(`擋下：F8 驗法沒有跑完，不登記（.logs/f8.verified ${dropReg(REG)}）`);
  process.exit(1);
};

// ---------- 判定一格 ----------
// r：{ code, err }；name：要點名的字（nameRe 對邊界）；why：理由；before／after：輸出資料夾的雜湊；extras：[說明, 成立與否]
export const judge = ({ code, err, name, nameRe, why, before, after, extras = [] }) => {
  const xl = (err.split('\n').find((l) => l.startsWith('✗')) || '');
  const miss = [];
  if (code === 0) miss.push('回 0');
  if (!(nameRe ? nameRe.test(xl) : xl.includes(name))) miss.push('✗ 那一行沒點名');
  if (!xl.includes(why)) miss.push(`理由不是「${why}」`);
  if (before !== after) miss.push('輸出變了');
  if (/^\s+at /m.test(err)) miss.push('有堆疊');
  for (const [label, okay] of extras) if (!okay) miss.push(label);
  return { ok: miss.length === 0, miss, xl };
};
{
  // 判定程式的對照組：每一種「沒擋」各一份合成樣本（跑的是同一個 judge）；應判擋下的那一份要判擋下
  const id = 'tw-tai';
  const re = new RegExp(`(^|[^a-z0-9-])${esc(id)}([^a-z0-9-]|$)`);
  const good = { code: 1, err: `✗ ${id}：換不上 x\n擋下：寫檔失敗`, nameRe: re, why: '換不上', before: 'a', after: 'a' };
  const cases = {
    擋下: [good, true],
    回0: [{ ...good, code: 0 }, false],
    沒點名: [{ ...good, err: `✗ 換不上 x\n擋下：寫檔失敗（${id}）` }, false],
    湊到別人: [{ ...good, err: `✗ ${id}pei：換不上 x` }, false],
    湊到連字號: [{ ...good, err: `✗ ${id}-x：換不上 x` }, false],
    理由不對: [{ ...good, err: `✗ ${id}：寫不進暫存檔 x` }, false],
    輸出變了: [{ ...good, after: 'b' }, false],
    有堆疊: [{ ...good, err: good.err + '\n    at file:///x.mjs:1:1' }, false],
    清理沒做: [{ ...good, extras: [['暫存沒清掉', false]] }, false],
  };
  const wrong = Object.entries(cases).filter(([, [s, want]]) => judge(s).ok !== want).map(([k]) => k);
  // 數「拍進 .partial 幾張」的程式也要有對照組：拍了兩張要數到 2；點換成別的字、少一位數字都不能算
  const shotSample = ['✓ v1.38-01-advanced.png', '✓ v1.38-13-privacy-consent.png', '✓ v1x38-02-source.png', '✓ v1.38-3-x.png', '說明 ✓ v1.38-04-y.png'].join('\n');
  if (countShots(shotSample) !== 2) wrong.push(`數張數（數到 ${countShots(shotSample)}、應為 2）`);
  console.log(`判定的對照組：${Object.keys(cases).length} 份合成樣本＋數張數 1 份${wrong.length ? '，判錯的：' + wrong.join('、') : '都判對'}`);
  if (wrong.length) { console.log('擋下：F8 驗法的判定程式壞了（對照組沒過），不跑矩陣'); dropReg(REG); process.exit(4); }
}

// 完整跑的時候，一開始就先刪登記、全過才在最後寫：中途不管哪裡當掉，都不會留下舊的登記
if (!ONLY) console.log(`開始前：.logs/f8.verified ${dropReg(REG)}（全過才會重寫）`);

// ---------- 先確認：工作區＝HEAD、開 HEAD 的暫存複本 ----------
const pre = headProblems(ROOT, F8_FILES);
if (pre.length) give(`不跑：${pre.join('；')}——先 commit 再跑（驗到的要是推出去的那一份）`);
const HEAD = git(['rev-parse', 'HEAD']).stdout.trim();
rmWT();
if (fs.existsSync(WT)) give(`暫存複本 ${path.relative(ROOT, WT)} 清不掉，請自己刪`);
const add = git(['worktree', 'add', '-q', '--detach', WT, HEAD]);
if (add.status !== 0) give(`開不了暫存複本：${add.stderr.trim()}`);
const summary = [];
try {
  console.log(`跑的版本：${HEAD.slice(0, 12)}（HEAD）`);
  for (const f of F8_FILES) {
    const inWT = git(['hash-object', '--', f], WT).stdout.trim();
    const want = headHash(ROOT, f);
    console.log(`  ${f}：複本 ${inWT.slice(0, 12)}、HEAD ${want.slice(0, 12)}`);
    if (!inWT || inWT !== want) give(`複本裡的 ${f} 不是 HEAD 那一份`);
  }

  if (ONLY !== 'is') summary.push(buildPlaces());
  if (ONLY !== 'bp') summary.push(await importShots());
} catch (e) {
  bad('例外：' + (e && e.stack || e));
} finally {
  rmWT();
}

// ---------- 結果與登記 ----------
for (const s of summary) console.log(s);
console.log(`耗時 ${Math.round((Date.now() - t0) / 1000)} 秒`);
// 登記怎麼辦由 regAction（純函式，pushgatetest 的情境 V5 驗）決定；下面兩行只是照判斷執行（F10：已知限制，見證據檔）
const act = regAction({ failed: failed > 0, partial: !!ONLY });
if (act === 'drop') {
  console.log(`擋下：F8 驗法有 ${failed} 項沒過，不登記（.logs/f8.verified ${dropReg(REG)}）`);
  process.exit(1);
}
if (act === 'keep') { console.log(`全部擋下（只跑了 ${ONLY}，不登記；.logs/f8.verified 維持原樣）`); process.exit(0); }
// 跑的途中 HEAD 或那三支有沒有變：變了就不登記（登記的要是剛剛驗的那一份）
const nowHead = git(['rev-parse', 'HEAD']).stdout.trim();
if (nowHead !== HEAD) give(`跑的途中 HEAD 變了（${HEAD.slice(0, 12)} → ${nowHead.slice(0, 12)}），不登記`);
const w = writeReg(ROOT, REG, F8_FILES, '# F8 驗法（f8verify）全部擋下時登記的雜湊（HEAD 裡的版本）。safe-push.sh 在推送動到這幾支時比對，對不上就回 6。\n'
  + '# 不進版控。改了下面任何一支，就 commit 之後重跑 npm run f8verify；全部擋下才會寫這個檔，有任何一格沒擋就刪掉它。\n');
if (!w.ok) give(`不登記：${w.why}`);
console.log('全部擋下；已登記 .logs/f8.verified');

// ======================================================================
// build-places：每個城市 × 10 種情境
// ======================================================================
function buildPlaces() {
  const D = path.join(WT, 'data', 'places');
  const ST = path.join(D, '_staging');
  const RAWD = path.join(WT, 'data', '_raw');
  const index = JSON.parse(fs.readFileSync(path.join(D, 'index.json'), 'utf8'));
  const cities = [];
  for (const c of index.countries) for (const r of c.regions) for (const ci of r.cities) cities.push([ci.id, ci.file]);
  const WANT = { nofile: '不存在', malformed: '解析不了', emptyplaces: '是空的', renamed: '沒有 places 這個欄位', invalid: '無效',
    shrink: '資料變少', notinindex: '不在 index.json', tmpdir: '暫存位置', readonly: '換不上', stagingfile: '建不了輸出資料夾' };
  const KINDS = Object.keys(WANT);
  let readonlyFile = '';
  const reset = () => {
    if (readonlyFile && fs.existsSync(readonlyFile)) fs.chmodSync(readonlyFile, 0o666);
    readonlyFile = '';
    fs.rmSync(ST, { recursive: true, force: true });
    fs.rmSync(RAWD, { recursive: true, force: true });
    const r = git(['checkout', '-q', '--', 'data/places'], WT);
    if (r.status !== 0) throw new Error('還原 data/places 失敗：' + r.stderr);
  };
  const dirhash = () => {
    if (!fs.existsSync(ST)) return '無';
    if (fs.statSync(ST).isFile()) return '檔案 ' + sha(fs.readFileSync(ST));
    return sha(fs.readdirSync(ST).sort().map((n) => {
      const p = path.join(ST, n);
      return fs.statSync(p).isDirectory() ? `${n}/ ${fs.readdirSync(p).sort().join(',')}` : `${n} ${sha(fs.readFileSync(p))}`;
    }).join('\n'));
  };
  const run = (id) => { const r = spawnSync(process.execPath, ['scripts/build-places.mjs', id], { cwd: WT, encoding: 'utf8' }); return { code: r.status, err: (r.stderr || '') }; };
  const oldOut = (id) => { fs.mkdirSync(ST, { recursive: true }); fs.writeFileSync(path.join(ST, id + '.json'), '{"_meta":{"existingCount":0,"old":true},"candidates":[]}'); };
  // 造情境；造不成就丟例外（不帶著沒造成的情境往下驗）
  const setup = (kind, id, file) => {
    const p = path.join(D, file);
    const must = (c, what) => { if (!c) throw new Error(`造不出情境：${id} ${kind}（${what}）`); };
    const read = () => JSON.parse(fs.readFileSync(p, 'utf8'));
    const write = (j) => fs.writeFileSync(p, JSON.stringify(j));
    if (kind === 'tmpdir') { const d = path.join(ST, id + '.json.partial'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'keep.txt'), '別人的'); return; }
    if (kind === 'stagingfile') { fs.writeFileSync(ST, '別人的檔案'); must(fs.statSync(ST).isFile(), '_staging 是檔案'); return; }
    if (kind === 'readonly') {
      oldOut(id); readonlyFile = path.join(ST, id + '.json'); fs.chmodSync(readonlyFile, 0o444);
      let writable = true; try { fs.accessSync(readonlyFile, fs.constants.W_OK); } catch { writable = false; }
      must(!writable, '輸出檔真的是唯讀'); return;
    }
    if (kind === 'shrink') {
      const r0 = run(id); must(r0.code === 0, '先成功跑一次');
      const j = read(); const n = j.places.length; j.places.pop(); write(j); must(n > 1 && read().places.length === n - 1, '少一個地點'); return;
    }
    oldOut(id);
    if (kind === 'nofile') { fs.unlinkSync(p); must(!fs.existsSync(p), '城市檔不在'); }
    else if (kind === 'malformed') { fs.writeFileSync(p, '{ "broken": '); must(fs.readFileSync(p, 'utf8').length < 20, '城市檔壞掉'); }
    else if (kind === 'emptyplaces') { const j = read(); j.places = []; write(j); must(read().places.length === 0, 'places 是空的'); }
    else if (kind === 'renamed') { const j = read(); j.placez = j.places; delete j.places; write(j); must(!('places' in read()), '沒有 places'); }
    else if (kind === 'invalid') { const j = read(); delete j.places[0].name; write(j); must(!read().places[0].name, '第一個地點沒有 name'); }
    else if (kind === 'notinindex') {
      const ip = path.join(D, 'index.json'); const ix = JSON.parse(fs.readFileSync(ip, 'utf8'));
      for (const c of ix.countries) for (const r of c.regions) r.cities = r.cities.filter((ci) => ci.id !== id);
      fs.writeFileSync(ip, JSON.stringify(ix));
      // 只看城市這一層（地區也可能用同一個 id，例如 jp-okinawa）
      const back = JSON.parse(fs.readFileSync(ip, 'utf8'));
      must(!back.countries.some((c) => c.regions.some((r) => r.cities.some((ci) => ci.id === id))), '城市不在 index');
    } else throw new Error('不認得的情境 ' + kind);
  };
  const tally = new Map();
  let cells = 0;
  for (const [id, file] of cities) {
    for (const kind of KINDS) {
      reset();
      setup(kind, id, file);
      const before = dirhash();
      const r = run(id);
      const after = dirhash();
      const extras = [];
      if (kind === 'tmpdir') extras.push(['別人的東西被刪了', fs.existsSync(path.join(ST, id + '.json.partial', 'keep.txt'))]);
      if (kind === 'readonly') extras.push(['自己的暫存檔沒清掉（或根本沒建過）', r.err.includes('暫存檔已清掉') && !fs.existsSync(path.join(ST, id + '.json.partial'))]);
      if (kind === 'stagingfile') extras.push(['別人的檔案被動了', fs.existsSync(ST) && fs.statSync(ST).isFile()]);
      const j = judge({ ...r, nameRe: new RegExp(`(^|[^a-z0-9-])${esc(id)}([^a-z0-9-]|$)`), why: WANT[kind], before, after, extras });
      const key = `${kind}｜${j.ok ? '擋下' : '沒擋：' + j.miss.join('、')}`;
      tally.set(key, (tally.get(key) || 0) + 1);
      if (!j.ok) bad(`build-places ${id} ${kind} 沒擋：${j.miss.join('、')}｜${j.xl.slice(0, 80)}`);
      cells++;
    }
  }
  reset();
  const want = cities.length * KINDS.length;
  if (cells !== want) bad(`build-places 格數對不上：應有 ${want} 格、實際 ${cells} 格`);
  return `build-places：${cities.length} 個城市 × ${KINDS.length} 種情境＝${cells} 格（應有 ${want}）\n`
    + [...tally].sort().map(([k, n]) => `  ${n} 個城市：${k}`).join('\n');
}

// ======================================================================
// importshots：13 個中斷點＋素材 3 種＋資料變少＋清理 4 種＝21 格
// ======================================================================
async function importShots() {
  const O = path.join(WT, 'screenshots', '_import');
  const PART = O + '.partial', OLD = O + '.old';
  const F = path.join(WT, 'scripts', 'fixtures', 'yilan.txt');
  const LAST = path.join(WT, '.logs', 'importshots.last.json');
  const NAMES = ['advanced', 'source', 'paste-text', 'confirm-top', 'confirm-stay', 'confirm-middle', 'confirm-day3', 'confirm-bottom',
    'title-filled', 'trip-result', 'trip-times', 'no-key-help', 'privacy-consent'];
  const reset = () => {
    for (const p of [PART, OLD, LAST]) fs.rmSync(p, { recursive: true, force: true });
    const r = git(['checkout', '-q', '--', 'scripts/fixtures', 'screenshots', 'js'], WT);
    if (r.status !== 0) throw new Error('還原失敗：' + r.stderr);
    git(['clean', '-qfd', 'screenshots'], WT);
    const n = fs.existsSync(O) ? fs.readdirSync(O).length : 0;
    if (n !== NAMES.length) throw new Error(`還原後 screenshots/_import 應有 ${NAMES.length} 張、實際 ${n} 張`);
  };
  const dirhash = () => (fs.existsSync(O) ? sha(fs.readdirSync(O).sort().map((n) => `${n} ${sha(fs.readFileSync(path.join(O, n)))}`).join('\n')) : '無');
  const count = () => (fs.existsSync(O) ? fs.readdirSync(O).length : 0);
  const run = (env = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['scripts/importshots.mjs'], { cwd: WT, env: { ...process.env, ...env } });
    let err = '', out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, err, shots: countShots(out) }));
  });
  // 鎖住一個檔（FileShare.Read：讀得到、改不了名、刪不掉）。檔案出現才鎖；哨兵檔刪掉才放開；最多 300 秒。
  let lockN = 0;
  const lock = (file) => {
    const sentinel = path.join(WT, '.logs', `f8-lock-${++lockN}`);
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, '');
    if ([file, sentinel].some((p) => p.includes("'"))) throw new Error('路徑含單引號，鎖不了');
    const ps = `$t=0; while (-not (Test-Path '${file}') -and $t -lt 1200) { Start-Sleep -Milliseconds 100; $t++ }; `
      + `if (-not (Test-Path '${file}')) { exit 2 }; Start-Sleep -Milliseconds 300; `
      + `$f=[IO.File]::Open('${file}','Open','Read','Read'); Write-Output LOCKED; `
      + `$t=0; while ((Test-Path '${sentinel}') -and $t -lt 3000) { Start-Sleep -Milliseconds 100; $t++ }; $f.Close()`;
    const c = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'] });
    const h = { locked: false, done: new Promise((res) => { c.on('close', res); c.on('error', res); }) };
    c.stdout.on('data', (d) => { if (String(d).includes('LOCKED')) h.locked = true; });
    h.release = async () => { fs.rmSync(sentinel, { force: true }); await h.done; };
    h.waitLocked = async () => { for (let i = 0; i < 300 && !h.locked; i++) await new Promise((r) => setTimeout(r, 100)); return h.locked; };
    return h;
  };
  const lines = [];
  let cells = 0;
  const cell = async (label, name, why, env, extrasFn, prep) => {
    reset();
    if (prep) await prep();
    const before = dirhash();
    const r = await run(env);
    const after = dirhash();
    const j = judge({ ...r, name, why, before, after, extras: extrasFn ? extrasFn(r) : [] });
    lines.push(`  ${label}｜${j.ok ? '擋下' : '沒擋：' + j.miss.join('、')}｜${j.xl.slice(0, 70)}`);
    if (!j.ok) bad(`importshots ${label} 沒擋：${j.miss.join('、')}`);
    cells++;
    return r;
  };
  for (let k = 1; k <= NAMES.length; k++) await cell(`第 ${k} 張之前中斷`, `「${NAMES[k - 1]}」`, `截圖中斷在第 ${k}/${NAMES.length} 張`, { IMPORTSHOTS_FAIL_AT: String(k) });
  await cell('素材是空的', 'scripts/fixtures/yilan.txt', '是空的', {}, null, () => fs.writeFileSync(F, ''));
  await cell('素材不在', 'scripts/fixtures/yilan.txt', '不在', {}, null, () => fs.unlinkSync(F));
  await cell('素材沒有時間', 'scripts/fixtures/yilan.txt', '沒有任何一行帶時間', {}, null, () => fs.writeFileSync(F, '這不是行程表\n只是一段文字\n'));
  await cell('資料變少（素材砍掉一半）', '「confirm-top」', '資料變少', {}, null, async () => {
    const r0 = await run();
    if (r0.code !== 0 || !fs.existsSync(LAST)) throw new Error('造不出情境：資料變少的前置（先成功跑一次）失敗');
    const L = fs.readFileSync(F, 'utf8').split('\n');
    fs.writeFileSync(F, L.slice(0, Math.floor(L.length / 2)).join('\n') + '\n');
  });
  const keep = (d) => path.join(d, 'keep.txt');
  await cell('_import.partial 一開始就在', 'screenshots/_import.partial', '已經有東西', {},
    () => [['別人的東西被刪了', fs.existsSync(keep(PART))]], () => { fs.mkdirSync(PART); fs.writeFileSync(keep(PART), '別人的'); });
  await cell('_import.old 一開始就在', 'screenshots/_import.old', '已經有東西', {},
    () => [['別人的東西被刪了', fs.existsSync(keep(OLD))]], () => { fs.mkdirSync(OLD); fs.writeFileSync(keep(OLD), '別人的'); });
  // 換上第一步失敗：_import/ 裡一張被鎖，舊的改不了名
  {
    let h;
    await cell('換上第一步失敗（_import/ 裡一張被鎖）', 'screenshots/_import/', '換不上', {},
      (r) => [['鎖檔的情境沒造成', h.locked], [`沒拍滿 ${NAMES.length} 張進 .partial（清掉了也證明不了建過）`, r.shots === NAMES.length], ['暫存 .partial 沒清掉', !fs.existsSync(PART)], ['.old 留下來了', !fs.existsSync(OLD)], [`_import 不是 ${NAMES.length} 張`, count() === NAMES.length]],
      async () => { h = lock(path.join(O, 'v1.38-05-confirm-stay.png')); if (!(await h.waitLocked())) throw new Error('造不出情境：鎖不住 _import 裡那一張'); });
    await h.release();
  }
  // 換上第二步失敗：.partial 裡第一張一出現就鎖住 → 舊的已改名成 .old、新的換不上 → 要把 .old 改回來；被鎖的 .partial 清不掉就要點名
  {
    let h;
    await cell('換上第二步失敗（_import.partial 裡一張被鎖）', 'screenshots/_import/', '換不上', {},
      (r) => {
        const xl = r.err.split('\n').find((l) => l.startsWith('✗')) || '';
        return [['鎖檔的情境沒造成', h.locked], [`沒拍滿 ${NAMES.length} 張進 .partial`, r.shots === NAMES.length], ['.old 沒改回來', !fs.existsSync(OLD)], [`_import 不是 ${NAMES.length} 張`, count() === NAMES.length],
          ['暫存 .partial 沒清掉、也沒點名清不掉', !fs.existsSync(PART) || xl.includes('暫存位置 screenshots/_import.partial 清不掉')]];
      },
      () => { h = lock(path.join(PART, 'v1.38-01-advanced.png')); });
    await h.release();
  }
  reset();
  const want = NAMES.length + 3 + 1 + 4;
  if (cells !== want) bad(`importshots 格數對不上：應有 ${want} 格、實際 ${cells} 格`);
  return `importshots：${cells} 格（應有 ${want}）\n` + lines.join('\n');
}
