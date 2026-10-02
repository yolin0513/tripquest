// 按次預測的突變（2026-10-02）：在 repo 的暫存 clone（.logs/pm-mut）裡改壞一處，跑 clone 自己的 predicttest，
// 看紅的是不是預期那幾條（只列開頭）。用法：node tools/mutproof/predict_mut.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { evidHeader, evid, linesOf } from './evid.mjs';
import { parseTested, sha12 } from '../../scripts/probe-hash.mjs';
const RUNNER = 'predict_mut';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const COPY = path.join(REPO, '.logs', 'pm-mut');
const MUTS = [
  { name: 'M0 不改（基準）', expect: [] },
  { name: 'M1 沒量過當成 0 秒', file: 'scripts/predict.mjs', find: 'return { sec: unknown.length ? null : sec,', repl: 'return { sec,', expect: ['P1 有一支沒量過', 'C2 '] },   // C1、C6 不紅是對的：「沒量過」另有一條判斷，不靠秒數
  { name: 'M2 超過 600 秒也不算重負載', file: 'scripts/predict.mjs', find: 'if (pred.sec > LIMIT_SEC) return', repl: 'if (false) return', expect: ['P4 601', 'C4 '] },
  { name: 'M3 拿掉「連續 3 次超過預估」', file: 'scripts/predict.mjs', find: 'if (last3.length === 3 && last3.every', repl: 'if (false && last3.every', expect: ['P5 連續 3 次', 'P5 預測法要改時', 'C5 '] },
  { name: 'M4 拿掉「常規卻超過 600 秒沒拿許可」', file: 'scripts/predict.mjs', find: '  if (crossed) return', repl: '  if (false) return', expect: ['P6 預估常規'] },
  { name: 'M5 不分預測法版本', file: 'scripts/predict.mjs', find: "history.filter((e) => e.version === version && typeof e.actualSec === 'number')", repl: "history.filter((e) => typeof e.actualSec === 'number')", expect: ['P7 舊版'] },
  { name: 'M6 一律當重負載', file: 'scripts/predict.mjs', find: "return { heavy: false, reason: `預估", repl: "return { heavy: true, reason: `預估", expect: ['P2 ', 'P4 反向', 'C3 '] },
  // 執行器在拍「跑完後」之前就寫了 tools/test-times.json → 工作區守衛把它算成測試動到的檔 → C2、C3 回 3
  { name: 'M8 先寫耗時、再拍工作區', file: 'scripts/run-affected.mjs', find: '    const touched = changesBetween(before, shot(`${name} 跑完後`));',
    repl: "    try { saveTimes(ROOT, { ...tbl, [name]: { sec: 0, at: 'x' } }); } catch (e) { void e; }\n    const touched = changesBetween(before, shot(`${name} 跑完後`));", expect: ['C2 ', 'C3 '] },
  { name: 'M9 不看會不會開瀏覽器', file: 'scripts/predict.mjs', find: '  if (browser.length) return', repl: '  if (false) return', expect: ['P8 '] },
  { name: 'M10 不看多程序超過 60 秒', file: 'scripts/predict.mjs', find: '  if (multi.length && pred.sec > MULTI_SEC) return', repl: '  if (false) return', expect: ['P9 多程序、61 秒'] },
  { name: 'M11 只看測試檔本身、不看 import 的輔助檔', file: 'scripts/run-affected.mjs',
    find: "const files = [t.file, ...(repo.refs[n] || []).filter((r) => r.startsWith('scripts/') && r.endsWith('.mjs'))];", repl: 'const files = [t.file];',
    expect: ['P10 透過 import 的輔助檔', 'P10 import 的檔讀不到'] },
  { name: 'M7 run-affected 判成重負載也照跑', file: 'scripts/run-affected.mjs', find: 'if (cls.heavy && !approved) {', repl: 'if (false) {', expect: ['C1 ', 'C4 ', 'C5 '] },
];
let bad = 0;
const RUN = MUTS;
evidHeader('predict_mut', RUN.map((x) => x.name));
for (const m of RUN) {
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
  const r = spawnSync(process.execPath, ['scripts/predicttest.mjs'], { cwd: COPY, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hitAll = m.expect.every((e) => reds.some((l) => l.startsWith(e)));
  const extra = reds.filter((l) => !m.expect.some((e) => l.startsWith(e)));
  const ok = m.expect.length ? r.status !== 0 && hitAll && !extra.length : r.status === 0 && !reds.length;
  if (!ok) bad++;
  const tested = parseTested(out);
  const outer = m.file ? sha12(path.join(COPY, m.file)) : null;
  const nested = { file: m.file || null, outer, inner: tested && m.file ? tested[m.file] || null : null, printed: !!tested };
  nested.ok = !!tested && (!m.file || nested.inner === outer);
  fs.mkdirSync(path.join(REPO, '.logs', 'mutproof', RUNNER), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.logs', 'mutproof', RUNNER, m.name.replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.txt'), out);
  evid({ nested, runner: 'predict_mut', name: m.name, expect: m.expect, expectUnformed: [], reds, unformed: linesOf(out, '⊘ 情境未成立：'), status: r.status, sha });
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}、改壞那份 ${sha}、紅 ${reds.length} 條${extra.length ? '（預期外：' + extra.map((x) => x.slice(0, 26)).join('／') + '）' : ''}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 80));
}
fs.rmSync(COPY, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : '全部照預期');
process.exitCode = bad ? 1 : 0;
