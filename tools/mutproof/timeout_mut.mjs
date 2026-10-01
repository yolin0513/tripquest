// 第二批（單支逾時、帳本 no-result）的突變：每條在 repo 的暫存 clone（.logs/to-mut）裡改壞一處，
// 跑 clone 自己的那支測試，看紅的是不是預期那幾條。用法：node tools/mutproof/timeout_mut.mjs <repo> [名稱開頭...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const ONLY = process.argv.slice(3);
const COPY = path.join(REPO, '.logs', 'to-mut');
const MUTS = [
  { name: 'T0 不改（基準，worktreeguardtest）', test: 'scripts/worktreeguardtest.mjs', expect: [] },
  { name: 'T0b 不改（基準，mutatetest）', test: 'scripts/mutatetest.mjs', expect: [] },
  { name: 'T1 逾時時不殺程序樹', test: 'scripts/worktreeguardtest.mjs', file: 'scripts/run-timeout.mjs',
    find: "if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });",
    repl: "if (process.platform === 'win32') void 0;", expect: ['卡住的測試 → 回 7', '整棵程序樹都被殺掉'] },
  { name: 'T2 run-affected 不設時限', test: 'scripts/worktreeguardtest.mjs', file: 'scripts/run-affected.mjs',
    find: 'timeoutMs: timeoutSec * 1000 });', repl: 'timeoutMs: 0 });', expect: ['卡住的測試 → 回 7', '整棵程序樹都被殺掉'] },
  { name: 'T3 逾時照樣記成沒紅', test: 'scripts/mutatetest.mjs', file: 'scripts/mutate.mjs',
    find: "const result = r.timedOut ? 'no-result'", repl: "const result = false ? 'no-result'", expect: ['G 卡住', 'G 帳本記成 no-result', 'G --no-result 列出', 'G 再正常跑一次'] },
  { name: 'T4 沒有結果的清單永遠是空的', test: 'scripts/mutatetest.mjs', file: 'scripts/mutate.mjs',
    find: "filter((e) => e.result === 'no-result')", repl: 'filter(() => false)', expect: ['B 被中斷的那一次', 'G --no-result 列出', 'G 手動把', 'G 再正常跑一次'] },
];
let bad = 0;
for (const m of MUTS.filter((x) => !ONLY.length || ONLY.some((o) => x.name.startsWith(o)))) {
  fs.rmSync(COPY, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', REPO, COPY]);
  let sha = '（沒改）';
  if (m.file) {
    const p = path.join(COPY, m.file);
    const src = fs.readFileSync(p, 'utf8');
    const n = src.split(m.find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    fs.writeFileSync(p, src.replace(m.find, m.repl));
    if (!fs.readFileSync(p, 'utf8').includes(m.repl)) { console.log(`✗ ${m.name}：讀回沒有改壞的字串，中止`); process.exit(9); }
    sha = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [m.test], { cwd: COPY, encoding: 'utf8', timeout: 400000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hitAll = m.expect.every((e) => reds.some((l) => l.startsWith(e)));
  const extra = reds.filter((l) => !m.expect.some((e) => l.startsWith(e)) && !l.startsWith('前置'));
  const ok = m.expect.length ? r.status !== 0 && hitAll : r.status === 0 && !reds.length;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}、${((Date.now() - t0) / 1000).toFixed(1)} 秒、改壞那份 ${sha}、紅 ${reds.length} 條${extra.length ? '（另外紅：' + extra.map((x) => x.slice(0, 28)).join('／') + '）' : ''}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 90));
}
fs.rmSync(COPY, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : '全部照預期');
process.exitCode = bad ? 1 : 0;
