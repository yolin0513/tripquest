// 「情境未成立」這個類別的突變（2026-10-02）：在 repo 的暫存 clone（.logs/uf-mut）裡改 scripts/mutatetest.mjs。
//   U0 不改，只跑 B C D → 回 0、沒有 ⊘
//   U1 殺程序的判斷永遠當成「成立」→ K 必須紅（K 是「錯過時間窗必須判成未成立」的對照組）
//   U2 探針一啟動就結束（殺程序一定錯過時間窗）→ 只跑 B C D：必須回 3、每個殺程序情境都是 ⊘、沒有任何一條 ✗
// 用法：node tools/mutproof/unformed_mut.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { evidHeader, evid, linesOf, expectGate, itemsOf, gateOrExit, completed } from './evid.mjs';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const COPY = path.join(REPO, '.logs', 'uf-mut');
const MUTS = [
  // 基準跑全部組別：U1 的預期是 K 組的斷言，只跑 B C D 的基準裡沒有它，預期清單檢查會誤判成過期
  { name: 'U0 不改（全部組別）', args: [], edits: [], check: (r, x, u) => r.status === 0 && x.length === 0 && u.length === 0 },
  { name: 'U1 殺程序的判斷永遠當成成立（K）', args: ['K'], expectRed: ['K 殺程序錯過時間窗'],
    edits: [["fs.existsSync(PENDING) && open && !ledger().some((e) => e.seq === open.seq && e.event !== 'started') ? open : null;", "fs.existsSync(PENDING) && open && !ledger().some((e) => e.seq === open.seq && e.event !== 'started') ? open : (open || { seq: 0 });"]],
    check: (r, x) => r.status === 1 && x.some((l) => l.startsWith('K 殺程序錯過時間窗')) },
  { name: 'U2 探針一啟動就結束（B C D）', args: ['B', 'C', 'D'], expectUnformed: ['B—', 'C—', "C'—", 'C"—', 'D—'],
    edits: [["fs.writeFileSync('.logs/zz-sleep.pid', String(process.pid)); setTimeout(() => {}, 120000);", "fs.writeFileSync('.logs/zz-sleep.pid', String(process.pid));"]],
    check: (r, x, u) => r.status === 3 && x.length === 0 && u.length === 5 },
];
let bad = 0;
const RUN = MUTS;
evidHeader('unformed_mut', RUN.map((x) => x.name));
for (const m of RUN) {
  fs.rmSync(COPY, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', REPO, COPY]);
  const p = path.join(COPY, 'scripts/mutatetest.mjs');
  let src = fs.readFileSync(p, 'utf8');
  for (const [find, repl] of m.edits) {
    const n = src.split(find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    src = src.replace(find, repl);
  }
  fs.writeFileSync(p, src);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['scripts/mutatetest.mjs', ...m.args], { cwd: COPY, encoding: 'utf8', timeout: 400000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fin = completed(r, out);
  if (m === RUN[0]) gateOrExit(m.name.startsWith('U0') && expectGate('unformed_mut', m.name, out, itemsOf(RUN.slice(1), ['expectRed', 'expectUnformed'])));
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const unf = out.split('\n').filter((l) => l.startsWith('⊘ 情境未成立：')).map((l) => l.slice(8));
  const ok = fin.ok && (m.check(r, reds, unf));
  if (!ok) bad++;
  evid({ finished: fin.ok, finishWhy: fin.why, runner: 'unformed_mut', name: m.name, expect: m.expectRed || [], expectUnformed: m.expectUnformed || [], reds, unformed: unf, status: r.status, sha: '' });
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}、${((Date.now() - t0) / 1000).toFixed(1)} 秒、✗ ${reds.length} 條、⊘ ${unf.length} 條`);
  if (!fin.ok) console.log(`     ⊘ 被中斷、不算數：${fin.why}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 90));
  for (const l of unf) console.log('     ⊘ ' + l.slice(0, 90));
}
fs.rmSync(COPY, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : '全部照預期');
process.exitCode = bad ? 1 : 0;
