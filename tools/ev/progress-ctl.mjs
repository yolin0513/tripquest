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
];
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
