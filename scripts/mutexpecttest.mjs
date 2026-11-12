// mutate.mjs「紅了的時候跟 expect 對」的驗法（node scripts/mutexpecttest.mjs，在測試鏈裡、緊接 mutatetest；2026-11-12，Dispatch：「多紅」也要變成執行器會報的東西——
// 「不一定要判紅，但至少要印『另有 N 行非預期的紅』。不然下次有人看到 9/9 就過了，而那 N 行可能是真的問題。」）
//
// 在 .logs/mutx-repo 建一個最小的 git repo：只放 mutate.mjs、它 import 到的四支、.gitignore、兩支探針、一個目標檔
// （不 clone 整個 repo，幾秒跑完——這支也是一份突變清單的 cmd，每條突變都要重跑它一次）。
// 被驗的那幾支從主工作區複製（不是從 HEAD），所以還沒 commit 的改動、突變改壞的那一份，都是這裡跑到的那一份；開頭印出雜湊。
// 從 mutate.mjs 的命令列入口跑（共用慣例 §5.20），比對它印的行與帳本；跑完刪掉暫存 repo，確認主工作區沒被動。
//
// 探針（原樣都正常結束、結束碼 0；改壞後結束碼 1、跑滿母體，所以五條都是「紅了」——要驗的是紅了之後的那幾行）：
//   zz-abc：原樣 3 項 ✓；改壞後 A ✓、B ✗、C ✗。C 的訊息**中間**提到「B：」——比對要錨定開頭，整行找子字串會把它算成對到 B。
//   zz-ctl：原樣 2 項 ✓；改壞後 第 1 項 ✗、第 2 項 ✓，再多印一行「✗ 對照組沒過——」結論（不是斷言，不算非預期的紅）。
// 情境（同一次 mutate 跑五條；每一條各驗自己那一段輸出）：
//   X1 expect 只寫 B（zz-abc）→ 印「另有 1 行非預期的紅」並列出 C 那一行；不印「預期要紅卻沒紅」、也不印「紅在預期」
//   X1帳本 帳本那一筆記 extraRed 1、expectMissing 空陣列
//   X2 expect 寫 B、C → 「紅在預期」；不印「另有」
//   X3 expect 只寫 A → 印「預期要紅卻沒紅 1 條…：A：」
//   X4 沒寫 expect → 印「沒寫 expect：✗ 2 行分不出…」；不印「另有」（沒有預期就說不出哪一行是「非預期」）
//   X5 expect 寫「第 1 項」（zz-ctl）→ 紅在預期：結論行不算非預期的紅
//   X6 回傳值仍是 0（只印、不改判定）；總結那一行四種各幾條
// 突變：tools/mutations/mut_mutexpect1112.json，每一條事前寫預期紅哪幾個標籤。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.join(ROOT, '.logs', 'mutx-repo');
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 700).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
// 情境未成立：要驗的狀況沒發生（例如那一條根本沒紅），這次什麼都沒量到——不是通過也不是紅，最後回 3
const unformed = [];
const pre = (c, m) => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { unformed.push(m); console.log('⊘ 情境未成立：' + m); }
  return c;
};

// 一條突變在 mutate 輸出裡的那一段：「✓ 紅了｜<名字>（」那一行底下、行首是 5 個空白的行（去掉那 5 個空白）。找不到那一行回 null。
export function blockOf(out, name) {
  const lines = String(out).split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`✓ 紅了｜${name}（`));
  if (i < 0) return null;
  const body = [];
  for (let k = i + 1; k < lines.length && lines[k].startsWith('     '); k++) body.push(lines[k].slice(5));
  return body;
}

// 擷取的程式本身也要有對照組（共用慣例 §5.11）：抓空的話，下面每一條「沒有某一行」都會恆真
{
  const sample = ['原樣｜node x', '✓ 紅了｜甲（結束碼 1）', '     ✗ 甲一', '     另有 1 行', '✓ 紅了｜乙（結束碼 1）', '     ✗ 乙一', '', '結果：紅 2'].join('\n');
  const a = blockOf(sample, '甲'), b = blockOf(sample, '乙'), c = blockOf(sample, '丙');
  yes(a && a.join('|') === '✗ 甲一|另有 1 行' && b && b.join('|') === '✗ 乙一' && c === null,
    `擷取對照組：合成輸出裡「甲」那一段抓到 2 行、「乙」1 行、不存在的「丙」回 null（實得 ${JSON.stringify([a, b, c])}）`);
}

const mainBefore = snapshot({ root: ROOT });
fs.rmSync(REPO, { recursive: true, force: true });
fs.mkdirSync(path.join(REPO, 'scripts'), { recursive: true });
const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q');
git('config', 'user.name', 'mutx');
git('config', 'user.email', 'mutx@users.noreply.github.com');
git('config', 'core.autocrlf', 'false');
const TESTED = ['scripts/mutate.mjs', 'scripts/worktree-guard.mjs', 'scripts/run-timeout.mjs', 'scripts/proctree.mjs', 'scripts/resolve-exe.mjs'];
for (const f of [...TESTED, '.gitignore']) fs.copyFileSync(path.join(ROOT, f), path.join(REPO, f));
const P = (r) => path.join(REPO, r);
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
fs.writeFileSync(P('zz-target.txt'), 'alpha\n');
const HEAD_JS = "import fs from 'node:fs'; const b = fs.readFileSync('zz-target.txt', 'utf8').includes('BROKEN'); ";
fs.writeFileSync(P('scripts/zz-abc.mjs'), HEAD_JS
  + "if (!b) { console.log('✓ A：第 1 項\\n✓ B：第 2 項\\n✓ C：第 3 項\\n\\n3 項通過'); process.exit(0); } "
  + "console.log('✓ A：第 1 項\\n✗ B：第 2 項紅了\\n✗ C：第 3 項紅了（訊息中間提到 B：也不算對到 B）\\n\\n1 項通過，有失敗'); process.exit(1);\n");
fs.writeFileSync(P('scripts/zz-ctl.mjs'), HEAD_JS
  + "if (!b) { console.log('✓ 第 1 項\\n✓ 第 2 項\\n\\n2 項通過'); process.exit(0); } "
  + "console.log('✗ 第 1 項紅了\\n✓ 第 2 項\\n✗ 對照組沒過——檢查器壞了，不採信下面的結果\\n\\n1 項通過，有失敗'); process.exit(1);\n");
git('add', '-A');
git('commit', '-q', '-m', 'mutx 起點');
console.log(testedLine(REPO, TESTED));
yes(sha1(P('scripts/mutate.mjs')) === sha1(path.join(ROOT, 'scripts/mutate.mjs')), '暫存 repo 裡的 mutate.mjs＝主工作區那一份（跑到的是要驗的那一份）');

const mut = (name, cmd, extra = {}) => ({ name, file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd, ...extra });
const LIST = P('.logs/zz-muts.json');
fs.mkdirSync(P('.logs'), { recursive: true });
fs.writeFileSync(LIST, JSON.stringify([
  mut('X1', 'node scripts/zz-abc.mjs', { expect: ['B：'] }),
  mut('X2', 'node scripts/zz-abc.mjs', { expect: ['B：', 'C：'] }),
  mut('X3', 'node scripts/zz-abc.mjs', { expect: ['A：'] }),
  mut('X4', 'node scripts/zz-abc.mjs'),
  mut('X5', 'node scripts/zz-ctl.mjs', { expect: ['第 1 項'] }),
]));
const t0 = Date.now();
const r = spawnSync(process.execPath, ['scripts/mutate.mjs', LIST], { cwd: REPO, encoding: 'utf8' });
const out = (r.stdout || '') + (r.stderr || '');
console.log(`（mutate 跑了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒、結束碼 ${r.status}）`);
const ledger = fs.existsSync(P('.logs/mutate-ledger.jsonl')) ? fs.readFileSync(P('.logs/mutate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = (n) => ledger.filter((e) => e.name === n && e.event === 'done').pop();

// 前置：五條都真的紅了、輸出裡都有自己那一段（沒紅的話，下面驗的那幾行本來就不會印，不能算通過也不能算紅）
const B = {};
for (const n of ['X1', 'X2', 'X3', 'X4', 'X5']) {
  const d = done(n);
  B[n] = blockOf(out, n);
  pre(d && d.result === 'red' && B[n], `前置：${n} 紅了、輸出裡有它那一段（帳本 ${d ? d.result : '沒有那一筆'}、那一段 ${B[n] ? B[n].length + ' 行' : '找不到'}）`);
}
// 造樣本的那一行真的照設計寫進去了：C 那一行的「B：」在中間、不在開頭（§5.20：拆字串、跳脫寫錯時，樣本可能根本不含要測的東西）
const d1 = done('X1');
const raw1 = d1 && fs.existsSync(P(`.logs/mutate-out.${d1.seq}.log`)) ? fs.readFileSync(P(`.logs/mutate-out.${d1.seq}.log`), 'utf8') : '';
const cLine = raw1.split(/\r?\n/).find((l) => l.startsWith('✗ C：')) || '';
pre(cLine.indexOf('B：') > 2, `前置：探針 C 那一行的「B：」在訊息中間（第 ${cLine.indexOf('B：')} 個字；那一行：${cLine || '找不到'}）`);

const has = (blk, s) => !!blk && blk.some((l) => l.startsWith(s));
if (B.X1) {
  const i = B.X1.findIndex((l) => l.startsWith('另有 1 行非預期的紅'));
  yes(i >= 0 && B.X1[i + 1] === '  · C：第 3 項紅了（訊息中間提到 B：也不算對到 B）' && !has(B.X1, '預期要紅卻沒紅') && !has(B.X1, '預期對照'),
    'X1：expect 只寫 B → 印「另有 1 行非預期的紅」、下一行列出 C（訊息中間提到 B：也不算對到）；不印「預期要紅卻沒紅」，也不印「紅在預期」', B.X1.join('\n'));
}
if (d1) yes(d1.extraRed === 1 && Array.isArray(d1.expectMissing) && d1.expectMissing.length === 0,
  `X1帳本：那一筆記 extraRed 1、expectMissing 空陣列（實得 ${JSON.stringify({ extraRed: d1.extraRed, expectMissing: d1.expectMissing })}）`);
if (B.X2) yes(has(B.X2, '預期對照：expect 2 條都紅了、沒有別的紅——紅在預期') && !has(B.X2, '另有'),
  'X2：expect 寫 B、C → 印「紅在預期」；不印「另有」', B.X2.join('\n'));
if (B.X3) yes(has(B.X3, '預期要紅卻沒紅 1 條（紅的可能是別的規則碰巧擋下的）：A：'),
  'X3：expect 只寫 A → 印「預期要紅卻沒紅 1 條…：A：」', B.X3.join('\n'));
if (B.X4) yes(has(B.X4, '（這條沒寫 expect：✗ 2 行分不出哪些是預期的') && !has(B.X4, '另有'),
  'X4：沒寫 expect → 印「沒寫 expect：✗ 2 行分不出」；不印「另有」', B.X4.join('\n'));
if (B.X5) yes(has(B.X5, '預期對照：expect 1 條都紅了、沒有別的紅——紅在預期') && !has(B.X5, '另有'),
  'X5：「✗ 對照組沒過——」結論行不算非預期的紅 → 紅在預期', B.X5.join('\n'));
yes(r.status === 0 && /^紅 5\/5 條（只看結束碼與項數）；紅的再跟 expect 對：紅在預期 2 條、另有非預期的紅 2 條（共 3 行）、預期要紅卻沒紅 1 條、沒寫 expect 1 條$/m.test(out),
  `X6：回傳值仍是 0（只印、不改判定）；總結那一行：紅在預期 2、另有非預期的紅 2 條共 3 行、預期要紅卻沒紅 1、沒寫 expect 1（實得 ${r.status}）`,
  out.split(/\r?\n/).filter((l) => /^(紅 |結果：)/.test(l)).join('\n') || out.slice(-500));

fs.rmSync(REPO, { recursive: true, force: true });
yes(!fs.existsSync(REPO), '暫存 repo 已刪');
const touched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(touched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(touched));
if (unformed.length) {
  console.log(`\n⊘ 情境未成立 ${unformed.length} 項——這幾項這次什麼都沒量到，不是通過也不是紅：${unformed.join('；')}`);
  if (!process.exitCode) process.exitCode = 3;
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 3 ? '，有情境未成立' : ''));
