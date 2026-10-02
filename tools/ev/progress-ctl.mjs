// progress.mjs 的對照組（2026-10-02）：把 .logs/ev 複製到 .logs/ev-ctl，各造一種該擋的情況，確認會擋、而且點名的是那一件；
// 原樣的複本要照過。只讀 .logs/ev、只寫 .logs/ev-ctl（跑完刪掉）。
//   node tools/ev/progress-ctl.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SRC = path.join(REPO, '.logs', 'ev');
const CTL = path.join(REPO, '.logs', 'ev-ctl');
const fresh = () => {
  fs.rmSync(CTL, { recursive: true, force: true });
  fs.mkdirSync(CTL, { recursive: true });
  for (const f of fs.readdirSync(SRC)) { const p = path.join(SRC, f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(CTL, f)); }
};
const run = () => { const r = spawnSync(process.execPath, [path.join(HERE, 'progress.mjs'), '--ev', CTL], { encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const cases = [
  ['原樣', () => {}, null],
  ['清單外、沒登記的外殼紀錄', () => fs.copyFileSync(path.join(CTL, 'ev2-six-1.shell'), path.join(CTL, 'ev2-zz-extra.shell')), /^✗ log 裡有、清單沒有：zz-extra$/m],
  ['同一次輸出裡同一個情境跑兩次', () => fs.appendFileSync(path.join(CTL, 'run-six_mut.txt'), '\n==== six-3\n==== six-3\n'), /^✗ six_mut：同一次輸出裡同一個情境跑了兩次以上：six-3$/m],
  ['寫了 alldone 卻有沒輪到的', () => {
    const f = path.join(CTL, 'run-six_mut.txt');
    const s = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, s.replace(/^==== six-6$/m, '==== （拿掉）').replace(/^\[six-6\] 上一段已跑完.*$/m, '') + (/^alldone$/m.test(s) ? '' : '\nalldone\n'));
  }, /^✗ six_mut：輸出寫了 alldone，卻還有沒輪到的：six-6$/m],
  // 兩個來源（驅動側 driver-progress.log、外殼紀錄）的核對：兩向各一種該擋的，加兩種該放行的
  ['驅動記了結束、外殼紀錄沒有 exit=', () => {
    dp('開始', 'six-1'); dp('結束', 'six-1', 'rc=0');
    const f = path.join(CTL, 'ev2-six-1.shell');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/exit=\d+/g, ''));
  }, /^✗ 驅動記了「結束」、外殼紀錄卻沒有 exit=：six-1$/m],
  ['外殼判成跑完、驅動沒記結束', () => dp('開始', 'six-1'), /^✗ 外殼紀錄判成跑完、驅動卻沒記「結束」：six-1$/m],
  ['（放行）兩邊都記了', () => { dp('開始', 'six-1'); dp('結束', 'six-1', 'rc=0'); }, null],
  ['（放行）被停掉：外殼有 exit=、驅動沒記結束、沒有完成的證據', () => {
    dp('開始', 'six-1');
    const f = path.join(CTL, 'ev_six-1.log');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^\d+ 項通過.*$/gm, ''));
  }, null],
];
function dp(kind, label, rc) { fs.appendFileSync(path.join(CTL, 'driver-progress.log'), [kind, label, ...(rc ? [rc] : []), '2026-10-02T00:00:00'].join('\t') + '\n'); }
let bad = 0;
for (const [label, make, want] of cases) {
  fresh(); make();
  const r = run();
  const ok = want ? r.code === 1 && want.test(r.out) : r.code === 0 && !/^✗ /m.test(r.out);
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${label}：回 ${r.code}${want ? `，點名${want.test(r.out) ? '對' : '錯／沒點名'}` : ''}`);
  if (!ok) console.log(r.out.split('\n').filter((l) => /^✗/.test(l)).map((l) => '   ' + l).join('\n'));
}
fs.rmSync(CTL, { recursive: true, force: true });
console.log(bad ? `${bad} 種不照預期` : `${cases.length} 種都照預期`);
process.exitCode = bad ? 1 : 0;
