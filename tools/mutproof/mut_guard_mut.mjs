// mutate.mjs 護欄的突變：每條在 repo 的暫存 clone（.logs/mg-mut）裡改壞一處，跑 clone 自己的 mutatetest，
// 列出實際紅的那幾條，跟預期比（預期是「哪幾條情境的開頭」）。
import fs from 'node:fs';
import path from 'node:path';
import { evidHeader, evid, linesOf, expectGate, itemsOf, gateOrExit, completed } from './evid.mjs';
import { parseTested, sha12 } from '../../scripts/probe-hash.mjs';
const RUNNER = 'mut_guard_mut';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const COPY = path.join(REPO, '.logs', 'mg-mut');
const MUTS = [
  { name: 'G0 不改（基準）', expect: [] },
  { name: 'G1 拿掉嚴格模式的工作區檢查', find: 'if (!onlyMode && dirty.size) {', repl: 'if (false) {', expect: ['A '] },
  { name: 'G2 工作區檢查改成一律拒絕', find: 'if (!onlyMode && dirty.size) {', repl: 'if (true) {', expect: ["A' ", 'A" ', 'E ', 'N1 ', 'N5 ', 'N6 ', 'O1 ', 'O2 ', 'O3 原樣逾時 →', 'O4 '], expectUnformed: ['B—', 'C—', "C'—", 'C"—', 'D—', '前置：卡住的探針', '前置：N2', '前置：N3', '前置：N4', '前置：N7', '前置：O3 卡住的原樣', '前置：被停掉的探針', '前置：紅六項的那一條'] },   // 一律拒絕時 B／C／D 的殺程序情境造不出來＝未成立，不算擋下的證據；N、O 組（2026-11-11 加）的預期是推論、這次沒實跑
  // 2026-11-12 守夜：「前置：O3」同時是「前置：O3 clone 在起點」與「前置：O3 卡住的原樣真的跑起來了」的開頭，預期檢查回 8（不唯一）、沒跑。
  // 讀 mutatetest：前者是 reset()、跟 mutate 無關，一律拒絕時照樣成立；後者要 mutate 先跑原樣才有探針——一律拒絕時 mutate 在跑原樣前就回 2，
  // 探針不會起來＝未成立。所以改成只對到後者（看到突變結果之前改的，仍是事前）。
  // 同一天實跑（.logs/res-1112-item4b-guard.log）：G2 紅的 12 條全在 expect 裡，但多了 2 行預期外的「⊘ 情境未成立」——
  // H 組「前置：被停掉的探針…」、I 組「前置：紅六項的那一條…」（一律拒絕時 mutate 不跑，H、I 的情境也造不出來；當初清單漏列）。
  // scripts/evidence.mjs 據此判 G2＝情境未成立（驅動自己那行印 ✓，因為驅動的判定不看未成立——見 STATUS 待辦）。
  // 這兩筆是**事後**補的（共用慣例 §5.22）：只當下一次的基準，不是預測能力的檢驗。
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
  const fin = completed(r, out);
  if (m === RUN[0]) gateOrExit(m.name.startsWith('G0') && expectGate('mut_guard_mut', m.name, out, itemsOf(RUN.slice(1), ['expect', 'expectUnformed'])));
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hash = (out.match(/被驗的 mutate (\S+)/) || [, '？'])[1];
  const realReds = reds.filter((l) => !l.startsWith('前置'));
  const hitAll = m.expect.every((e) => realReds.some((l) => l.startsWith(e)));
  const extra = realReds.filter((l) => !m.expect.some((e) => l.startsWith(e)));
  const ok = fin.ok && (m.expect.length ? r.status !== 0 && hitAll && !extra.length : r.status === 0 && !reds.length);
  if (!ok) bad++;
  const tested = parseTested(out);
  const outer = (m.find ? 'scripts/mutate.mjs' : null) ? sha12(path.join(COPY, (m.find ? 'scripts/mutate.mjs' : null))) : null;
  const nested = { file: (m.find ? 'scripts/mutate.mjs' : null) || null, outer, inner: tested && (m.find ? 'scripts/mutate.mjs' : null) ? tested[(m.find ? 'scripts/mutate.mjs' : null)] || null : null, printed: !!tested };
  nested.ok = !!tested && (!(m.find ? 'scripts/mutate.mjs' : null) || nested.inner === outer);
  fs.mkdirSync(path.join(REPO, '.logs', 'mutproof', RUNNER), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.logs', 'mutproof', RUNNER, m.name.replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.txt'), out);
  evid({ finished: fin.ok, finishWhy: fin.why, nested, runner: 'mut_guard_mut', name: m.name, expect: m.expect, expectUnformed: m.expectUnformed || [], reds, unformed: linesOf(out, '⊘ 情境未成立：'), status: r.status, sha: hash });
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}、${((Date.now() - t0) / 1000).toFixed(1)} 秒、被驗的 mutate ${hash}、紅 ${reds.length} 條${extra.length ? '（預期外：' + extra.map((x) => x.slice(0, 24)).join('／') + '）' : ''}`);
  if (!fin.ok) console.log(`     ⊘ 被中斷、不算數：${fin.why}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 90));
}
fs.rmSync(COPY, { recursive: true, force: true });
// 2026-11-12：原本印 MUTS.length——只跑 G0、G2 兩條時也印「8 條全部照預期」（共用慣例 §5.21：從清單走出來的數不算）。
console.log(bad ? `${bad} 條不照預期（跑了 ${RUN.length} 條／清單 ${MUTS.length} 條）` : `跑了 ${RUN.length} 條（清單 ${MUTS.length} 條）全部照預期——驅動的判定只看紅的，「情境未成立」以 scripts/evidence.mjs 的分類為準`);
process.exitCode = bad ? 1 : 0;
