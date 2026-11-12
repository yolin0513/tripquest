// tools/ev/find-runall.mjs 的驗法（2026-11-12）：每一種情境都用真的程序——真的 Git Bash、真的叫 run-all.sh 的腳本、真的父子鏈，
// 走 find-runall.mjs 的真實入口 findRunAll()（真的 Get-CimInstance 程序表＋真的 MSYS 連結）。只查、不殺任何東西：
// 誘餌程序每 0.2 秒看一次停止檔，驗完放停止檔讓它們自己結束（最多 60 秒也會自己結束），最後確認帶這次暫存路徑的程序 0 支。
//   node scripts/find-runall-check.mjs           改了 tools/ev 的 find-runall.mjs、stop-after.mjs、stop-at-boundary.mjs 就跑這支
//   （手動；不在測試鏈——登記在 scripts/affected.mjs 的 ORPHAN_OK；突變 tools/mutations/mut_evstop1112.json 也用這個入口）
//   放 scripts/ 不放 tools/ev/：mutate.mjs 的 cmd 白名單只認 `node scripts/<名稱>.mjs`。
//   回 0 全過；1 有一條沒過；3 情境未成立（例：機器上有真的 run-all.sh 在跑、bash 解到 WSL、某個情境沒造出來）
//
// 情境（每一種都先確認情境真的成立，不成立回 3，不算紅也不算過）：
//   A：呼叫者的 shell 沒提到 run-all.sh → 認到 0。基準。
//   B：呼叫者的 `bash -c` 指令提到 run-all.sh（修之前認到的就是這種）→ 上層一支都不認。兩道擋互為備援（見 find-runall.mjs 檔頭）。
//   C：機器上另一支 `bash -c "…run-all.sh…"`（不是上層、只是字串提到）→ 不認。只有 (a)「只認腳本參數」擋得住。
//   D：呼叫者自己就是 run-all.sh 開出來的（上層有一支拿 run-all.sh 當腳本在跑）→ 不認。只有 (b)「排除上層鏈」擋得住。
//   E：真的有一支 bash 拿 run-all.sh 當腳本在跑（不是上層）→ **要認到它**，而且認到的全部屬於它那一棵。防「修成永遠認到 0」。
//   F：列不出程序表、取不到 MSYS 連結、程序表裡找不到自己 → findRunAll 丟例外（呼叫端不殺），不是回空清單。
//   G：PID 被重用（合成程序表：自己的父 PID 指到一支比自己晚建立、在跑 run-all.sh 的程序）→ 它不是上層、要認到。
//   H：兩支停程序工具都改走 findRunAll、不再內嵌舊查詢，認不出就 exit 2、不往下殺。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url).replace(/\\/g, '/');
const FR = await import(pathToFileURL(path.join(ROOT, 'tools', 'ev', 'find-runall.mjs')).href);
const { TARGET, findRunAll, pickTargets, listWithCmd } = FR;

// ---- 探針模式：被各情境的 shell 叫起來，從「自己的位置」呼叫 findRunAll，印出結果與自己的上層鏈 ----
if (process.argv[2] === '--probe') {
  const all = listWithCmd();
  const r = findRunAll({ list: () => all });
  const anc = [...FR.ancestorsOf(all, process.pid, [])];
  const ancRows = all.filter((p) => anc.includes(p.pid)).map((p) => ({ pid: p.pid, name: p.name, mentions: String(p.cmd).includes(TARGET), runs: FR.runsTarget(p.cmd) }));
  process.stdout.write(JSON.stringify({ label: process.argv[3], pid: process.pid, ...r, ancRows }) + '\n');
  process.exit(0);
}

const { resolveExe } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'resolve-exe.mjs')).href);
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const bad = (m, x) => { fail++; console.log('✗ ' + m + (x ? `\n   ${x}` : '')); };
const yes = (c, m, x) => (c ? ok(m) : bad(m, x));
const notFormed = (m) => { console.log(`⊘ 情境未成立：${m}`); cleanup(); process.exit(3); };

let BASH;
try { BASH = resolveExe('bash'); } catch (e) { console.log(`⊘ 情境未成立：找不到 Git Bash（${e.message}）`); process.exit(3); }
const TMP = path.join(ROOT, '.logs', 'find-runall-check', String(Date.now()));
fs.mkdirSync(TMP, { recursive: true });
const T = TMP.replace(/\\/g, '/');
// 每個誘餌各自一個停止檔：C 的誘餌在 E 開始前就收掉，情境之間互不污染（拿掉 (a) 時 E 不會因為 C 的誘餌還活著而一起紅）
const stopOf = (k) => `${T}/STOP-${k}`;
const LOOP = (k) => `for i in $(seq 1 300); do [ -f "${stopOf(k)}" ] && exit 0; sleep 0.2; done`;
const kids = [];
function cleanup() { for (const k of ['C', 'E']) { try { fs.writeFileSync(stopOf(k), ''); } catch { /* 目錄可能還沒建 */ } } }
const finish = (k, child) => { try { fs.writeFileSync(stopOf(k), ''); } catch { /* 同上 */ } return new Promise((r) => { if (child.exitCode !== null) r(); else { child.on('exit', r); setTimeout(r, 8000); } }); };
const probe = (label, args) => {
  const r = spawnSync(BASH, args, { encoding: 'utf8', timeout: 60000 });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('{'));
  if (!line) notFormed(`${label} 的探針沒有輸出（rc=${r.status}；${String(r.stderr || '').split('\n')[0]}）`);
  return JSON.parse(line);
};
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`說明 bash＝${BASH}；目標名＝${TARGET}；暫存＝.logs/find-runall-check/${path.basename(TMP)}`);

// 機器上本來就有真的 run-all.sh 在跑 → 後面「認到 0」判不出來，情境未成立
const before = findRunAll();
if (before.targets.length) notFormed(`機器上本來就有 ${before.targets.length} 支真的 run-all.sh 在跑（${before.targets.join('、')}），這次判不出來`);
console.log(`說明 開跑前：目標 0；字串提到但沒在跑的 ${before.skippedNotScript.length} 支（別人的 shell，不影響判定）`);

// ---- A ----
const a = probe('A', ['-c', `node "${SELF}" --probe A`]);
if (a.ancRows.some((p) => p.mentions)) notFormed('A 的上層竟然有提到目標名的 bash');
yes(a.targets.length === 0, `A：呼叫者沒提到 ${TARGET} → 認到 0（上層 ${a.ancRows.length} 支）`, `targets=${a.targets}`);

// ---- B ----
const b = probe('B', ['-c', `node "${SELF}" --probe B # ${TARGET}`]);
const bMention = b.ancRows.filter((p) => p.mentions && /^bash/i.test(p.name));
if (bMention.length === 0) notFormed('B 的上層沒有提到目標名的 bash（情境沒造出來）');
const bHit = b.targets.filter((t) => b.ancRows.some((p) => p.pid === t));
yes(bHit.length === 0 && b.targets.length === 0, `B：呼叫者的 bash -c 提到 ${TARGET}（上層提到的 ${bMention.length} 支）→ 一支都不認`, `認到 ${b.targets.join('、')}`);

// ---- C ----
const c = spawn(BASH, ['-c', `${LOOP('C')} # ${TARGET}`], { stdio: 'ignore' }); kids.push(c);
await sleepMs(1500);
const cAll = listWithCmd();
const cRow = cAll.find((p) => p.pid === c.pid);
if (!cRow || !String(cRow.cmd).includes(TARGET)) notFormed('C 的誘餌 bash 不在程序表、或命令列沒有目標名');
const cr = findRunAll({ list: () => cAll });
yes(!cr.targets.includes(c.pid) && cr.targets.length === 0, `C：另一支 bash -c 只是字串提到 ${TARGET}（${c.pid}）→ 不認`, `認到 ${cr.targets.join('、')}`);
await finish('C', c);
await sleepMs(500);
if (listWithCmd().some((p) => String(p.cmd).includes(stopOf('C')))) notFormed('C 的誘餌放了停止檔還沒結束，會污染後面的情境');

// ---- D ----
const dDir = path.join(TMP, 'd'); fs.mkdirSync(dDir);
fs.writeFileSync(path.join(dDir, TARGET), `node "${SELF}" --probe D\n`);
const d = probe('D', [`${T}/d/${TARGET}`]);
const dRuns = d.ancRows.filter((p) => p.runs);
if (dRuns.length === 0) notFormed('D 的上層沒有拿目標當腳本在跑的 bash（情境沒造出來）');
yes(d.targets.length === 0, `D：呼叫者自己是 ${TARGET} 開出來的（上層在跑它的 ${dRuns.length} 支）→ 不認`, `認到 ${d.targets.join('、')}`);

// ---- E ----
const eDir = path.join(TMP, 'e'); fs.mkdirSync(eDir);
fs.writeFileSync(path.join(eDir, TARGET), `${LOOP('E')}\n`);
const e = spawn(BASH, [`${T}/e/${TARGET}`], { stdio: 'ignore' }); kids.push(e);
await sleepMs(1500);
const eAll = listWithCmd();
if (!eAll.some((p) => p.pid === e.pid)) notFormed('E 的那支 bash 不在程序表');
const er = findRunAll({ list: () => eAll });
const eTree = new Set([e.pid]);
for (let grow = true; grow;) { grow = false; for (const p of eAll) if (!eTree.has(p.pid) && eTree.has(p.ppid)) { eTree.add(p.pid); grow = true; } }
yes(er.targets.includes(e.pid), `E：真的有一支 bash 拿 ${TARGET} 當腳本在跑（${e.pid}）→ 認到它`, `targets=${er.targets.join('、') || '（空）'}`);
yes(er.targets.length > 0 && er.targets.every((t) => eTree.has(t)), `E：認到的 ${er.targets.length} 支全部屬於那一棵（根＋分叉的子殼）`, `不屬於的 ${er.targets.filter((t) => !eTree.has(t)).join('、')}`);

// ---- F ----
const throws = (f) => { try { f(); return false; } catch { return true; } };
yes(throws(() => findRunAll({ list: () => { throw new Error('合成：列不出'); } })), 'F：列不出程序表 → 丟例外（呼叫端不殺）');
yes(throws(() => findRunAll({ list: () => eAll, edges: () => { throw new Error('合成：MSYS 表取不到'); } })), 'F：取不到 MSYS 連結 → 丟例外');
yes(throws(() => findRunAll({ list: () => eAll.filter((p) => p.pid !== process.pid) })), 'F：程序表裡找不到自己 → 丟例外');

// ---- G（合成程序表，不碰真程序）----
const g = pickTargets([
  { pid: 10, ppid: 1, name: 'bash.exe', created: 2000, cmd: `"bash.exe" /x/${TARGET}` },
  { pid: 20, ppid: 10, name: 'node.exe', created: 1000, cmd: 'node probe' },
], 20, []);
yes(g.targets.includes(10), 'G：父 PID 指到一支比自己晚建立的程序（PID 被重用）→ 它不是上層、在跑目標就要認到', `targets=${g.targets}`);

// ---- H（讀兩支停程序工具的原始碼）----
for (const f of ['stop-after.mjs', 'stop-at-boundary.mjs']) {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'ev', f), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  yes(/findRunAll\(\)/.test(code) && !/CommandLine -like/.test(code), `H：${f} 改走 findRunAll、沒有內嵌的舊查詢`);
  const guard = code.split('\n').some((l) => l.includes('findRunAll()') && l.includes('catch') && l.includes('process.exit(2)'));
  yes(guard && code.indexOf('findRunAll()') < code.indexOf('killTree(pid)'), `H：${f} 認不出就 exit 2，而且認在殺之前`);
}

// ---- 收拾：放停止檔、等誘餌自己結束、確認沒有殘留 ----
cleanup();
await finish('E', e);
await sleepMs(800);
const left = listWithCmd().filter((p) => String(p.cmd).includes(T) || String(p.cmd).includes(TMP));
yes(left.length === 0, `收拾：帶這次暫存路徑的程序 0 支（誘餌都自己結束了）`, left.map((p) => `${p.name}(${p.pid})`).join('、'));

console.log(`${pass} 項通過、${fail} 項沒過`);
process.exit(fail ? 1 : 0);
