// tools/loadsample.ps1「取樣器自己另成一欄」的驗法（node scripts/loadsampletest.mjs，在測試鏈裡；2026-11-12，Dispatch 指示：
// 取樣器自己是系統目錄底下的 powershell，一直被算進「系統」——排除自己的 PID、另印一欄、盲點清單補一條）。
//
// 從真的入口跑：powershell -File tools/loadsample.ps1 -Seconds 2 -Count 2，讀它寫的紀錄檔（主工作區那一份，所以突變改壞的就是這裡跑到的那一份；開頭印雜湊）。
// 2 秒窗：取樣器每窗做兩次快照，自己的 CPU 在 2 秒窗約 0.4～0.8（同日實測三窗），10 秒窗只剩 0.1～0.2、四捨五入可能變 0——所以用短窗。
//   L1 回 0、紀錄剛好 2 行（-Count 2）
//   L2 每一行的 self 欄緊接在 foreign 後面（loadjudge 的行格式只認到 foreign，self 插到前面它就讀不懂）
//   L3 每一窗 self > 0（自己真的被認出來、印在自己那一欄；沒認出來時 self 永遠是 0、自己落回「系統」）
//   L4 loadjudge 讀得懂新格式：這段讀到 2 窗（判乾淨或受干擾都可以，這裡只驗讀得懂）
// 驗不到的（寫明，不假裝）：self 印的數字是不是剛好等於取樣器自己的 CPU——外面沒有另一個來源量得到它；
//   「自己只算一次、不會同時又算進系統」靠結構保證（Classify 只回一類、self 是第一個判斷），沒有另外的斷言。
// 突變：tools/mutations/mut_loadsample1112.json，每一條事前寫預期紅哪幾個標籤。
// 約 6 秒、一個 powershell。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOG = path.join(ROOT, '.logs', `loadsampletest-${process.pid}.log`);
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 700).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
const unformed = [];

// self 緊接在 foreign 後面、後面接 top=[
// （時間寫成 \d{2}：寫成兩個 \d 相連時，「d、冒號、反斜線」長得像磁碟代號路徑，會被公開前自查誤報）
export const selfAfterForeign = (l) => /^﻿?\d{2}:\d{2}:\d{2} system=[\d.]+ observer=[\d.]+ own=[\d.]+ foreign=[\d.]+ self=[\d.]+ top=\[/.test(l);
// self 的值（在哪個位置都抓；前面要是行首或空白，所以 top=[myself=…] 這種程序名不算）
export const selfValue = (l) => { const m = /(?:^| )self=([\d.]+)/.exec(l); return m ? Number(m[1]) : null; };

// 擷取的程式本身也要有對照組（共用慣例 §5.11）：抓空的話 L2、L3 會變成恆紅或恆綠
{
  const NEW = '21:07:08 system=0.1 observer=5.5 own=0 foreign=0.2 self=0.4 top=[a=0.2] systop=[b=0.1]';
  const OLD = '21:07:08 system=0.5 observer=5.5 own=0 foreign=0.2 top=[a=0.2] systop=[b=0.1]';
  const FRONT = '21:07:08 system=0.1 observer=5.5 own=0 self=0.3 foreign=0.2 top=[a=0.2] systop=[b=0.1]';
  const TRAP = '21:07:08 system=0.1 observer=5.5 own=0 foreign=0.2 top=[myself=0.9] systop=[b=0.1]';
  const got = [selfAfterForeign(NEW), selfValue(NEW), selfAfterForeign('\uFEFF' + NEW), selfAfterForeign(OLD), selfValue(OLD), selfAfterForeign(FRONT), selfValue(FRONT), selfValue(TRAP)];
  yes(JSON.stringify(got) === JSON.stringify([true, 0.4, true, false, null, false, 0.3, null]),
    `擷取對照組：新格式（含開頭 BOM）認得、值 0.4；舊格式沒有 self；self 插在 foreign 前面不算緊接、值照抓 0.3；myself= 不算（實得 ${JSON.stringify(got)}）`);
}

const mainBefore = snapshot({ root: ROOT });
console.log(testedLine(ROOT, ['tools/loadsample.ps1', 'scripts/loadjudge.mjs']));
fs.rmSync(LOG, { force: true });
const t0 = Date.now();
const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tools', 'loadsample.ps1'), '-Seconds', '2', '-Count', '2', '-Out', LOG],
  { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
console.log(`（取樣器跑了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒、結束碼 ${r.status}${r.error ? '、' + r.error.code : ''}）`);
if (r.error) {
  // powershell 叫不起來或逾時：取樣器根本沒跑，這次什麼都沒量到
  unformed.push(`取樣器沒跑起來（${r.error.code}）`);
  console.log(`⊘ 情境未成立：取樣器沒跑起來（${r.error.code}）`);
} else {
  const text = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (const l of lines) console.log('  紀錄：' + l.replace(/^\uFEFF/, ''));
  yes(r.status === 0 && lines.length === 2, `L1：取樣器回 0、紀錄剛好 2 行（實得 回 ${r.status}、${lines.length} 行）`, (r.stdout || '') + (r.stderr || ''));
  const bad2 = lines.filter((l) => !selfAfterForeign(l));
  yes(lines.length > 0 && bad2.length === 0, `L2：每一行的 self 欄緊接在 foreign 後面（${lines.length} 行裡不合的 ${bad2.length} 行）`, bad2.join('\n'));
  const vals = lines.map(selfValue);
  yes(lines.length > 0 && vals.every((v) => v !== null && v > 0), `L3：每一窗 self > 0——取樣器自己被認出來、印在自己那一欄（實得 ${JSON.stringify(vals)}）`);
  const hms = lines.map((l) => (/^﻿?(\d{2}:\d{2}:\d{2}) /.exec(l) || [])[1]).filter(Boolean);
  if (hms.length === lines.length && hms.length > 0) {
    const toSec = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
    const fmt = (s) => [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
    const from = hms[0], to = fmt((toSec(hms[hms.length - 1]) + 1) % 86400);
    const j = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'loadjudge.mjs'), LOG, from, to, '--base-foreign', '100'], { cwd: ROOT, encoding: 'utf8' });
    const jout = (j.stdout || '') + (j.stderr || '');
    yes((j.status === 0 || j.status === 1) && jout.includes(`這段（${from}～${to}）${lines.length} 窗`),
      `L4：loadjudge 讀得懂新格式——這段（${from}～${to}）讀到 ${lines.length} 窗（實得 回 ${j.status}）`, jout);
  } else {
    yes(false, `L4：loadjudge 讀得懂新格式——紀錄行開頭沒有時間，沒辦法給它範圍（${hms.length}／${lines.length} 行有時間）`);
  }
}

fs.rmSync(LOG, { force: true });
const touched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(touched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(touched));
if (unformed.length) {
  console.log(`\n⊘ 情境未成立 ${unformed.length} 項——這次什麼都沒量到，不是通過也不是紅：${unformed.join('；')}`);
  if (!process.exitCode) process.exitCode = 3;
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 3 ? '，有情境未成立' : ''));
