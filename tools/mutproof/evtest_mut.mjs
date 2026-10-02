// evtest 的突變（2026-10-02）：證明 tools/ev 範圍縮小（affected.mjs 讓 OWN 那幾支只跑 evtest）之後，弄壞驅動的行為還抓得到。
// 每條把 tools/ev 複製到 .logs/evtest-mut/root/tools/ev、改壞一處，用 EVTEST_ROOT 指過去跑本 repo 的 evtest，預期只有指定的那幾條紅；
// evtest 印的「被驗的檔」雜湊要等於改壞那一份（不然壞的那一份根本沒跑）。
// 重負載（每條約 45 秒、bash＋node，6 條約 5 分鐘）：等時段。第一次跑沒有登記的指紋 → 會被「需要複審」擋下，複審後帶 --accept-review。
//   node tools/mutproof/evtest_mut.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evidHeader, evid, expectGate, itemsOf, gateOrExit } from './evid.mjs';
import { parseTested, sha12 } from '../../scripts/probe-hash.mjs';
const RUNNER = 'evtest_mut';

const REPO = path.resolve(process.argv[2] || '.');
const COPY = path.join(REPO, '.logs', 'evtest-mut', 'root');
const DRV = ['six_mut', 'f9_mut', 'f10_mut', 'di_mut', 'last_mut'];

const MUTS = [
  { name: 'V0 不改（基準）', file: null, expectRed: [] },
  { name: 'V1 f10 的 run() 不寫驅動側「結束」', file: 'tools/ev/f10_mut.sh', find: 'seg_end "$l" $?; ', repl: '',
    expectRed: ['f10_mut：驅動側進度每個情境都有', 'progress.mjs：回 0、沒有 ✗', 'progress.mjs：兩個來源數字相等'] },
  { name: 'V2 seg_skip 不看停止旗標', file: 'tools/ev/segment.sh',
    find: '  if [ -f "$O/STOP" ]; then echo "[$1] 停止旗標在（.logs/ev/STOP），不開新情境"; return 0; fi\n', repl: '',
    expectRed: DRV.map((d) => `${d}：停止旗標在`) },
  { name: 'V3 di 的 run() 不先問 seg_skip', file: 'tools/ev/di_mut.sh', find: 'seg_skip "$l" && return; ', repl: '',
    expectRed: ['di_mut：再跑一次', 'di_mut：停止旗標在'] },
  { name: 'V4 last 帶給外殼的補丁名寫錯', file: 'tools/ev/last_mut.sh', find: '$PS=plast_$k.json', repl: '$PS=plast_${k}x.json',
    expectRed: ['last_mut：每份補丁都存在', 'last_mut：驅動側進度每個情境都有', 'progress.mjs：回 0、沒有 ✗', 'progress.mjs：五支都判成跑完', 'progress.mjs：兩個來源數字相等', 'last_mut：再跑一次'] },
];

let bad = 0;
evidHeader(RUNNER, MUTS.map((x) => x.name));
for (const m of MUTS) {
  fs.rmSync(COPY, { recursive: true, force: true });
  fs.mkdirSync(path.join(COPY, 'tools', 'ev'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'tools', 'ev'))) fs.copyFileSync(path.join(REPO, 'tools', 'ev', f), path.join(COPY, 'tools', 'ev', f));
  if (m.file) {
    const p = path.join(COPY, m.file);
    const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const n = src.split(m.find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止`); process.exit(9); }
    const out = src.replace(m.find, m.repl);
    fs.writeFileSync(p, out);
    if (fs.readFileSync(p, 'utf8') !== out || !out.includes(m.repl)) { console.log(`✗ ${m.name}：讀回不是改壞的那一份，中止`); process.exit(9); }
  }
  const r = spawnSync(process.execPath, ['scripts/evtest.mjs'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, EVTEST_ROOT: COPY } });
  const out = (r.stdout || '') + (r.stderr || '');
  if (m === MUTS[0]) gateOrExit(expectGate(RUNNER, m.name, out, itemsOf(MUTS.slice(1), ['expectRed'])));
  const reds = out.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2));
  const hitAll = m.expectRed.every((e) => reds.some((l) => l.startsWith(e)));
  const extra = reds.filter((l) => !m.expectRed.some((e) => l.startsWith(e)));
  const tested = parseTested(out);
  const outer = m.file ? sha12(path.join(COPY, m.file)) : null;
  const nested = { file: m.file || null, outer, inner: tested && m.file ? tested[m.file] || null : null, printed: !!tested };
  nested.ok = !!tested && (!m.file || nested.inner === outer);
  const ok = nested.ok && (m.expectRed.length ? r.status !== 0 && hitAll && !extra.length : r.status === 0 && !reds.length);
  if (!ok) bad++;
  fs.mkdirSync(path.join(REPO, '.logs', 'mutproof', RUNNER), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.logs', 'mutproof', RUNNER, m.name.replace(/[^\w一-鿿-]+/g, '_') + '.txt'), out);
  evid({ nested, runner: RUNNER, name: m.name, expect: m.expectRed, expectUnformed: [], reds, unformed: [], status: r.status, sha: m.file ? `${m.file}=${outer}` : '' });
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}，紅 ${reds.length} 條${extra.length ? `（多紅：${extra.map((x) => x.slice(0, 30)).join('／')}）` : ''}；被驗那份 ${nested.ok ? '＝改壞的那份' : `對不上（外 ${outer}、內 ${nested.inner}）`}`);
  for (const l of reds) console.log('     ✗ ' + l.slice(0, 70));
}
fs.rmSync(path.join(REPO, '.logs', 'evtest-mut'), { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : `${MUTS.length} 條全部照預期`);
process.exitCode = bad ? 1 : 0;
