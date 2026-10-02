// 工作區守衛的突變：每條在 repo 的暫存複本（.logs/wtg-mut）裡改壞一處，跑複本自己的 worktreeguardtest，
// 預期只有指定的那幾條紅。複本＝clone HEAD ＋ 蓋上工作區裡這次改的檔。
import fs from 'node:fs';
import path from 'node:path';
import { evidHeader, evid, linesOf, expectGate, itemsOf, gateOrExit } from './evid.mjs';
import { parseTested, sha12 } from '../../scripts/probe-hash.mjs';
const RUNNER = 'wtg_mut';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const COPY = path.join(REPO, '.logs', 'wtg-mut');
const FILES = ['scripts/run-affected.mjs', 'scripts/worktree-guard.mjs', 'scripts/worktreeguardtest.mjs', 'scripts/affected.mjs', '.gitignore'];

const MUTS = [
  { name: 'M0 不改（基準）', file: null, expectRed: [] },
  { name: 'M1 比對永遠回空', file: 'scripts/worktree-guard.mjs', find: 'const out = [];\n  for (const [p, a] of after)', repl: 'const out = []; return out;\n  for (const [p, a] of after)',
    expectRed: ['測試改了進版控的 zz-fixture-a.txt', '測試丟下沒被擋掉的新檔', '開跑前就改過的 zz-fixture-b.txt'] },
  { name: 'M2 run-affected 不看比對結果', file: 'scripts/run-affected.mjs', find: '    if (touched.length) {', repl: '    if (false) {',
    expectRed: ['測試改了進版控的 zz-fixture-a.txt', '測試丟下沒被擋掉的新檔', '開跑前就改過的 zz-fixture-b.txt'] },
  { name: 'M3 不看沒進版控的新檔', file: 'scripts/worktree-guard.mjs', find: "untracked = 'all' } = {}", repl: "untracked = 'no' } = {}",
    expectRed: ['測試丟下沒被擋掉的新檔'] },
  { name: 'M4 開跑前就改過的檔不比雜湊', file: 'scripts/worktree-guard.mjs', find: 'else if (b.hash !== a.hash)', repl: 'else if (false)',
    expectRed: ['開跑前就改過的 zz-fixture-b.txt'] },
  { name: 'M5 拍不到就當成沒改動', file: 'scripts/run-affected.mjs', find: "      process.exit(4);\n", repl: "      return new Map();\n",
    expectRed: ['git 讀不到'] },
];

let bad = 0;
const RUN = MUTS;
evidHeader('wtg_mut', RUN.map((x) => x.name));
for (const m of RUN) {
  fs.rmSync(COPY, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', REPO, COPY]);
  for (const f of FILES) fs.copyFileSync(path.join(REPO, f), path.join(COPY, f));
  if (m.file) {
    const p = path.join(COPY, m.file);
    const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const n = src.split(m.find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    const out = src.replace(m.find, m.repl);
    fs.writeFileSync(p, out);
    if (fs.readFileSync(p, 'utf8') !== out || !out.includes(m.repl)) { console.log(`✗ ${m.name}：讀回不是改壞的那一份，中止`); process.exit(9); }
  }
  const r = spawnSync(process.execPath, ['scripts/worktreeguardtest.mjs'], { cwd: COPY, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (m === RUN[0]) gateOrExit(m.name.startsWith('M0') && expectGate('wtg_mut', m.name, out, itemsOf(RUN.slice(1), ['expectRed'])));
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hitAll = m.expectRed.every((e) => reds.some((l) => l.startsWith(e)));
  const extra = reds.filter((l) => !m.expectRed.some((e) => l.startsWith(e)));
  const ok = m.expectRed.length ? r.status !== 0 && hitAll && !extra.length : r.status === 0 && !reds.length;
  if (!ok) bad++;
  const tested = parseTested(out);
  const outer = m.file ? sha12(path.join(COPY, m.file)) : null;
  const nested = { file: m.file || null, outer, inner: tested && m.file ? tested[m.file] || null : null, printed: !!tested };
  nested.ok = !!tested && (!m.file || nested.inner === outer);
  fs.mkdirSync(path.join(REPO, '.logs', 'mutproof', RUNNER), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.logs', 'mutproof', RUNNER, m.name.replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.txt'), out);
  evid({ nested, runner: 'wtg_mut', name: m.name, expect: m.expectRed, expectUnformed: [], reds, unformed: [], status: r.status, sha: (out.match(/被驗的 run-affected \S+、worktree-guard \S+/) || [''])[0] });
  const hashLine = (out.match(/被驗的 run-affected \S+、worktree-guard \S+/) || ['（沒印雜湊）'])[0];
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}，紅 ${reds.length} 條${extra.length ? `（多紅：${extra.map((x) => x.slice(0, 30)).join('／')}）` : ''}；${hashLine}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 70));
}
fs.rmSync(COPY, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : `${MUTS.length} 條全部照預期`);
process.exitCode = bad ? 1 : 0;
