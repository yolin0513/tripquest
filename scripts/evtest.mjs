// tools/ev 五支突變驅動＋分段（segment.sh）＋進度（progress.mjs）的行為測試（npm run evtest；2026-10-02）。
//
// 為什麼需要它、範圍規則的依據（affected.mjs 讓下面 OWN 列的檔只跑這一支，不再放大成全套）：
//   · 鏈裡 57 支測試（連它們 import 的輔助檔）沒有一支引用 tools/ev（2026-10-02 掃過、附合成對照組）——放大成全套跑 57 支，
//     這幾支檔案一行都沒被執行到，等於沒有測試。這一支才是真的去跑它們。
//   · 這幾支會影響的只有「證據怎麼跑、跑了哪些、進度怎麼判」：驅動列了哪些情境、每個情境帶哪幾份補丁給 ev2.sh、run() 有沒有
//     先問 seg_skip（停止旗標、已跑完跳過）、有沒有寫驅動側進度（開始／結束）、progress.mjs 判不判得出跑完。這些全部在這裡驗。
//   · 不在範圍內、照舊放大的：ev2.sh（真的開暫存複本、套補丁、跑驗法——要時段）、mk_*_patches.mjs（這裡換成空的，補丁直接
//     用 repo 裡的 tools/mutations）、其餘 tools/ev 工具。它們沒列在 OWN，改了照樣放大。
//
// 做法（真實入口＝用 Git Bash 執行驅動腳本本身）：把 tools/ev 與 tools/mutations 複製到 .logs/evtest/tools/…，ev2.sh 換成
// 假外殼（不開複本：檢查每份補丁存在、照指令寫出完成的證據、印 exit=0），mk_*_patches.mjs 換成空的；然後：
//   1. 五支驅動各跑一次：回 0、印 alldone；假外殼收到的情境＝驅動列的情境（先印母體）；補丁都存在；
//      driver-progress.log 每個情境都有「開始」與「結束 rc=0」；progress.mjs 判成跑完、還沒跑 0、沒有 ✗。
//   2. 再跑一次：每個情境都被跳過（上一段已跑完），假外殼一次都沒被叫。
//   3. 新目錄、先放停止旗標：一個情境都不開。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveExe } from './resolve-exe.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T = path.join(ROOT, '.logs', 'evtest');
// 被驗的那一份 tools/ev 從哪裡拿：預設本 repo；突變驅動（tools/mutproof/evtest_mut.mjs）指到改壞的複本，testedLine 印的就是那一份的雜湊
const SRC_ROOT = process.env.EVTEST_ROOT ? path.resolve(process.env.EVTEST_ROOT) : ROOT;
export const OWN = ['tools/ev/six_mut.sh', 'tools/ev/f9_mut.sh', 'tools/ev/f10_mut.sh', 'tools/ev/di_mut.sh', 'tools/ev/last_mut.sh', 'tools/ev/segment.sh', 'tools/ev/progress.mjs'];
const DRIVERS = ['six_mut', 'f9_mut', 'f10_mut', 'di_mut', 'last_mut'];
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 600).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
let BASH;
try { BASH = resolveExe('bash'); } catch (e) { console.log(`⊘ 情境未成立：${e.message}`); process.exit(3); }

const STUB = `#!/usr/bin/env bash
# evtest 的假外殼：不開複本、不跑驗法。補丁不存在 → 跟真的一樣套不上、不跑；否則照指令寫出完成的證據
S="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$S/../.." && pwd)"; O="$REPO/.logs/ev"; M="$REPO/tools/mutations"
L="$1"; C="$2"; CMD="$3"; shift 3
echo "$L	$*" >> "$O/stub-calls.txt"
for fp in "$@"; do p="\${fp#*=}"; [ -f "$M/$p" ] || { echo "[$L] ✗ 補丁不存在：$p"; exit 9; }; done
exec node "$S/zz-stub-evidence.mjs" "$L" "$CMD" "$O/ev_$L.log"
`;
const STUB_EVID = `import fs from 'node:fs';
const [l, cmd, log] = process.argv.slice(2);
const n = (re) => (cmd.match(re) || []).length;
const out = [];
for (let i = 0; i < n(/node scripts\\/pushgatetest\\.mjs/g); i++) out.push('1 項通過');
for (let i = 0; i < n(/scripts\\/f8verify\\.mjs/g); i++) out.push('全部擋下（假外殼）');
if (/echo "結果：/.test(cmd)) out.push('結果：假外殼');
fs.writeFileSync(log, out.join('\\n') + '\\n');
console.log('[' + l + '] exit=0');
`;

function setup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  const ev = path.join(dir, 'tools', 'ev'), mu = path.join(dir, 'tools', 'mutations');
  fs.mkdirSync(ev, { recursive: true }); fs.mkdirSync(mu, { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC_ROOT, 'tools', 'ev'))) fs.copyFileSync(path.join(SRC_ROOT, 'tools', 'ev', f), path.join(ev, f));
  for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'mutations'))) fs.copyFileSync(path.join(ROOT, 'tools', 'mutations', f), path.join(mu, f));
  for (const f of fs.readdirSync(ev)) if (/^mk_.+_patches\.mjs$/.test(f)) fs.writeFileSync(path.join(ev, f), '// evtest：空的\n');
  fs.writeFileSync(path.join(ev, 'ev2.sh'), STUB);
  fs.writeFileSync(path.join(ev, 'zz-stub-evidence.mjs'), STUB_EVID);
  fs.mkdirSync(path.join(dir, '.logs', 'ev'), { recursive: true });
}
const runDriver = (dir, d) => spawnSync(BASH, [path.join(dir, 'tools', 'ev', d + '.sh'), 'deadbeef'], { cwd: dir, encoding: 'utf8', timeout: 180000 });
const calls = (dir) => { const f = path.join(dir, '.logs', 'ev', 'stub-calls.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]) : []; };

const { scenariosOf } = await import(pathToFileURL(path.join(SRC_ROOT, 'tools', 'ev', 'progress.mjs')).href + '?evtest');
console.log(testedLine(SRC_ROOT, OWN));

// ---------- 1. 五支各跑一次 ----------
const A = path.join(T, 'a');
setup(A);
for (const d of DRIVERS) {
  const before = calls(A).length;
  const r = runDriver(A, d);
  const want = scenariosOf(fs.readFileSync(path.join(SRC_ROOT, 'tools', 'ev', d + '.sh'), 'utf8')).map((s) => s.label);
  const got = calls(A).slice(before);
  console.log(`  ${d}：驅動列的情境 ${want.length} 個，假外殼收到 ${got.length} 個`);
  yes(r.status === 0 && /^alldone$/m.test(r.stdout), `${d}：回 0、印 alldone`, `回 ${r.status}\n${r.stdout}${r.stderr}`);
  yes(want.length > 0 && got.join(',') === want.join(','), `${d}：假外殼收到的情境＝驅動列的（母體 ${want.length}）`, `收到 ${got.join(',')}`);
  yes(!/補丁不存在/.test(r.stdout), `${d}：每份補丁都存在`, r.stdout.split('\n').filter((l) => /補丁不存在/.test(l)).join('\n'));
  const dp = fs.readFileSync(path.join(A, '.logs', 'ev', 'driver-progress.log'), 'utf8').split('\n').map((l) => l.split('\t'));
  const noBegin = want.filter((l) => !dp.some((x) => x[0] === '開始' && x[1] === l));
  const noEnd = want.filter((l) => !dp.some((x) => x[0] === '結束' && x[1] === l && x[2] === 'rc=0'));
  yes(noBegin.length === 0 && noEnd.length === 0, `${d}：驅動側進度每個情境都有「開始」與「結束 rc=0」`, `沒開始：${noBegin.join(',')}；沒結束：${noEnd.join(',')}`);
}
{
  const r = spawnSync(process.execPath, [path.join(A, 'tools', 'ev', 'progress.mjs')], { cwd: A, encoding: 'utf8' });
  const rows = DRIVERS.map((d) => (r.stdout.match(new RegExp(`^  ${d} @ \\S+：(.*)$`, 'm')) || [])[1] || '');
  yes(r.status === 0 && !/^✗/m.test(r.stdout), 'progress.mjs：回 0、沒有 ✗', r.stdout);
  yes(rows.every((x) => /^跑完 [1-9]\d*、被中斷 0、開了頭沒跑完 0、判不出 0、還沒跑 0$/.test(x)),'progress.mjs：五支都判成跑完、還沒跑 0', rows.join('\n'));
  const m = r.stdout.match(/驅動側（driver-progress\.log）開始 (\d+)、結束 (\d+)；外殼側有 exit= 的 (\d+) 份/);
  yes(m && m[1] === m[2] && m[2] === m[3] && Number(m[1]) > 0, `progress.mjs：兩個來源數字相等（${m ? m.slice(1).join('／') : '抓不到那一行'}）`, r.stdout);
}

// ---------- 2. 再跑一次：全部跳過 ----------
for (const d of DRIVERS) {
  const before = calls(A).length;
  const r = runDriver(A, d);
  const n = scenariosOf(fs.readFileSync(path.join(SRC_ROOT, 'tools', 'ev', d + '.sh'), 'utf8')).length;
  const skipped = (r.stdout.match(/^\[[^\]]+\] 上一段已跑完/gm) || []).length;
  yes(r.status === 0 && calls(A).length === before && skipped === n, `${d}：再跑一次，${n} 個情境全部跳過、假外殼沒被叫（跳過 ${skipped}）`, r.stdout);
}

// ---------- 3. 停止旗標 ----------
const B = path.join(T, 'b');
setup(B);
fs.writeFileSync(path.join(B, '.logs', 'ev', 'STOP'), '');
for (const d of DRIVERS) {
  const r = runDriver(B, d);
  const n = scenariosOf(fs.readFileSync(path.join(SRC_ROOT, 'tools', 'ev', d + '.sh'), 'utf8')).length;
  const stopped = (r.stdout.match(/^\[[^\]]+\] 停止旗標在/gm) || []).length;
  yes(calls(B).length === 0 && stopped === n, `${d}：停止旗標在，${n} 個情境一個都不開（印停止 ${stopped}）`, r.stdout);
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
