// mutate.mjs 護欄的突變：每條在 repo 的暫存 clone（.logs/mg-mut）裡改壞一處，跑 clone 自己的 mutatetest，
// 列出實際紅的那幾條，跟預期比（預期是「哪幾條情境的開頭」）。
import fs from 'node:fs';
import path from 'node:path';
import { evidHeader, evid, linesOf } from './evid.mjs';
import { parseTested, sha12 } from '../../scripts/probe-hash.mjs';
const RUNNER = 'mut_guard_mut';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const COPY = path.join(REPO, '.logs', 'mg-mut');
const MUTS = [
  { name: 'G0 不改（基準）', expect: [] },
  { name: 'G1 拿掉嚴格模式的工作區檢查', find: 'if (!onlyMode && dirty.size) {', repl: 'if (false) {', expect: ['A '] },
  { name: 'G2 工作區檢查改成一律拒絕', find: 'if (!onlyMode && dirty.size) {', repl: 'if (true) {', expect: ["A' ", 'A" ', 'E '], expectUnformed: ['B—', 'C—', "C'—", 'C"—', 'D—'] },   // 一律拒絕時 B／C／D 的殺程序情境造不出來＝未成立，不算擋下的證據
  { name: 'G3 啟動時不寫回原檔', find: 'fs.writeFileSync(path.join(ROOT, pending.file), buf);', repl: 'void buf;', expect: ['B '] },
  { name: 'G4 拿掉兩處一致的檢查', find: 'if (!open || open.seq !== pending.seq || open.file !== pending.file || open.sha !== pending.sha) {', repl: 'if (false) {', expect: ['D '] },
  { name: 'G5 還原紀錄不見、檔案不是原檔也照跑', find: 'if (now !== want) {', repl: 'if (false) {', expect: ['C '] },
  { name: 'G6 比「是不是原樣」時不統一行尾', find: 'const now = open.shaNorm ? fileShaNorm(open.file) : fileSha(open.file);\n    const want = open.shaNorm || open.sha;', repl: 'const now = fileSha(open.file);\n    const want = open.sha;', expect: ['C" '] },
  { name: 'G7 登記檢查永遠不抓只改空白或行尾的', find: 'stripWs(e.find) === stripWs(e.replace)', repl: 'false', expect: ['F '] },
];
const ONLY = process.argv.slice(3); let bad = 0;
const RUN = MUTS.filter((x) => !ONLY.length || ONLY.some((o) => x.name.startsWith(o)));
evidHeader('mut_guard_mut', RUN.map((x) => x.name));
for (const m of RUN) {
  fs.rmSync(COPY, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', REPO, COPY]);
  if (m.find) {
    const p = path.join(COPY, 'scripts/mutate.mjs');
    const src = fs.readFileSync(p, 'utf8');
    const n = src.split(m.find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    fs.writeFileSync(p, src.replace(m.find, m.repl));
    if (!fs.readFileSync(p, 'utf8').includes(m.repl)) { console.log(`✗ ${m.name}：讀回沒有改壞的字串，中止`); process.exit(9); }
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['scripts/mutatetest.mjs'], { cwd: COPY, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hash = (out.match(/被驗的 mutate (\S+)/) || [, '？'])[1];
  const realReds = reds.filter((l) => !l.startsWith('前置'));
  const hitAll = m.expect.every((e) => realReds.some((l) => l.startsWith(e)));
  const extra = realReds.filter((l) => !m.expect.some((e) => l.startsWith(e)));
  const ok = m.expect.length ? r.status !== 0 && hitAll && !extra.length : r.status === 0 && !reds.length;
  if (!ok) bad++;
  const tested = parseTested(out);
  const outer = (m.find ? 'scripts/mutate.mjs' : null) ? sha12(path.join(COPY, (m.find ? 'scripts/mutate.mjs' : null))) : null;
  const nested = { file: (m.find ? 'scripts/mutate.mjs' : null) || null, outer, inner: tested && (m.find ? 'scripts/mutate.mjs' : null) ? tested[(m.find ? 'scripts/mutate.mjs' : null)] || null : null, printed: !!tested };
  nested.ok = !!tested && (!(m.find ? 'scripts/mutate.mjs' : null) || nested.inner === outer);
  fs.mkdirSync(path.join(REPO, '.logs', 'mutproof', RUNNER), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.logs', 'mutproof', RUNNER, m.name.replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.txt'), out);
  evid({ nested, runner: 'mut_guard_mut', name: m.name, expect: m.expect, expectUnformed: m.expectUnformed || [], reds, unformed: linesOf(out, '⊘ 情境未成立：'), status: r.status, sha: hash });
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}、${((Date.now() - t0) / 1000).toFixed(1)} 秒、被驗的 mutate ${hash}、紅 ${reds.length} 條${extra.length ? '（預期外：' + extra.map((x) => x.slice(0, 24)).join('／') + '）' : ''}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 90));
}
fs.rmSync(COPY, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : `${MUTS.length} 條全部照預期`);
process.exitCode = bad ? 1 : 0;
