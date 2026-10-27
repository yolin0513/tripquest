// mutate.mjs 的 cmd 白名單（npm run mutcmdtest；2026-10-27，秒級）。
//
// 為什麼：mutate.mjs 用 shell 跑突變清單裡寫的 cmd，權限規則只認 mutate 那一行、管不到它開出來的子程序。
// 清單裡順手帶了 &&、重導向的 cmd 會被一起放行——防意外（Dispatch 2026-10-27），清單檔本身改得到，防不了故意。
//
// 在 repo 的暫存 clone（.logs/mutcmd-clone）裡從命令列入口跑（共用慣例 §5.20），跑完刪掉並確認主工作區沒被動。
// 判定不信 mutate.mjs 自己印的數字：探針有沒有跑看它寫進標記檔的行，目標檔看雜湊。
//   I1a 尾巴接 &&                 → 回 2、只點名這一條、探針沒跑、目標檔沒動（拿掉 CMD_RE 的 $ 只放過這一條）
//   I1b 開頭先跑別的指令          → 同上（拿掉 ^ 只放過這一條）
//   I1c 名字裡夾 shell 字元（&）  → 同上（字元類放寬只放過這一條）
//   I2  只有合形狀的              → 照跑：探針看到改壞版一次、目標檔還原
//   I3  真實資料：tools/mutations/ 每一份清單的每一條 cmd 都合形狀（印份數與條數，0 條就紅）
// 突變見 tools/mutations/mut_mutcmd.json。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';
import { lintCmds } from './mutate.mjs';
import { asMutations } from './mutlint.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLONE = path.join(ROOT, '.logs', 'mutcmd-clone');
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 600).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
const unformed = [];
const pre = (c, m) => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { unformed.push(m); console.log('⊘ 情境未成立：' + m); }
  return c;
};
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const cgit = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: CLONE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const P = (r) => path.join(CLONE, r);

const mainBefore = snapshot({ root: ROOT });

fs.rmSync(CLONE, { recursive: true, force: true });
execFileSync('git', ['clone', '-q', ROOT, CLONE]);
cgit('config', 'user.name', 'mut');
cgit('config', 'user.email', 'mut@users.noreply.github.com');
cgit('config', 'core.autocrlf', 'false');
// 工作區的版本蓋過去：被驗的是工作區這一份（含還沒 commit 的改動、含突變）
for (const f of ['scripts/mutate.mjs', 'scripts/worktree-guard.mjs', 'scripts/run-timeout.mjs', 'scripts/proctree.mjs', '.gitignore']) fs.copyFileSync(path.join(ROOT, f), P(f));
fs.writeFileSync(P('zz-target.txt'), 'alpha\n');
fs.writeFileSync(P('scripts/zz-check.mjs'), "import fs from 'node:fs'; const b = fs.readFileSync('zz-target.txt', 'utf8').includes('BROKEN'); fs.mkdirSync('.logs', { recursive: true }); fs.appendFileSync('.logs/zz-marker.txt', (b ? 'broken' : 'orig') + '\\n'); if (b) { console.log('✗ 目標被改壞了\\n\\n0 項通過，有失敗'); process.exit(1); } console.log('1 項通過');\n");
cgit('add', '-A');
cgit('commit', '-q', '-m', 'mutcmd 起點');
const START = cgit('rev-parse', 'HEAD').trim();
const ORIG = sha1(P('zz-target.txt'));
const MARKER = P('.logs/zz-marker.txt');
pre(sha1(P('scripts/mutate.mjs')) === sha1(path.join(ROOT, 'scripts/mutate.mjs')), `前置：clone 裡跑的 mutate.mjs＝主工作區那一份（${sha1(P('scripts/mutate.mjs')).slice(0, 12)}）`);

const reset = () => {
  fs.rmSync(P('zz-target.txt'), { force: true });
  cgit('reset', '-q', '--hard', START);
  fs.rmSync(P('.logs'), { recursive: true, force: true });
  fs.mkdirSync(P('.logs'), { recursive: true });
  return cgit('status', '--porcelain=v1', '--untracked-files=no') === '' && sha1(P('zz-target.txt')) === ORIG;
};
const run = (...a) => {
  const r = spawnSync(process.execPath, ['scripts/mutate.mjs', ...a], { cwd: CLONE, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const marks = () => (fs.existsSync(MARKER) ? fs.readFileSync(MARKER, 'utf8').split('\n').filter(Boolean) : []);
const GOOD = { name: '合形狀的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' };
const writeList = (list) => {
  const f = P('.logs/zz-muts.json');
  fs.writeFileSync(f, JSON.stringify(list));
  const back = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { f, back };
};

console.log('\n— I1 不合形狀的 cmd：整份拒絕 —');
const BAD = [
  ['I1a', '尾巴接 &&', 'node scripts/zz-check.mjs && echo hi'],
  ['I1b', '開頭先跑別的', 'echo hi; node scripts/zz-check.mjs'],
  ['I1c', '名字裡夾 shell 字元', 'node scripts/zz&echo.mjs'],
];
for (const [id, name, cmd] of BAD) {
  pre(reset(), `前置：${id} clone 在起點`);
  const { f, back } = writeList([GOOD, { ...GOOD, name, cmd }]);
  pre(back[1].cmd === cmd, `前置：${id} 讀回確認清單裡的 cmd 原樣是「${cmd}」`);
  const r = run('--only', f);
  yes(r.code === 2 && new RegExp(`^✗ 這些突變的 cmd 不是「node scripts/<名字>\\.mjs」（會用 shell 執行），整份拒絕：${name}$`, 'm').test(r.out)
    && /^檢查 2\/2 條 cmd，1 條不是/m.test(r.out) && marks().length === 0 && sha1(P('zz-target.txt')) === ORIG,
  `${id} ${name} → 回 2、只點名這一條、連合形狀的那條也不跑、目標檔沒動（實得 ${r.code}、標記 ${marks().length} 行）`, r.out.slice(-400));
}

console.log('\n— I2 合形狀的照跑（反向） —');
{
  pre(reset(), '前置：I2 clone 在起點');
  const { f } = writeList([GOOD]);
  const r = run('--only', f);
  yes(r.code === 0 && /^檢查 1\/1 條 cmd，0 條不是/m.test(r.out) && marks().join(',') === 'broken' && sha1(P('zz-target.txt')) === ORIG,
    `I2 只有合形狀的 → 照跑：探針看到改壞版一次、目標檔還原（實得 ${r.code}、標記 ${marks().join(',') || '無'}）`, r.out.slice(-400));
}

console.log('\n— I3 真實資料 —');
{
  // 只看 mutate.mjs 格式的清單（mutlint 認得的兩種格式之一）；另一種 [{from, to}] 是驗閘門的補丁、沒有 cmd、不經 mutate.mjs
  const dir = path.join(ROOT, 'tools', 'mutations');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  let n = 0, lists = 0, patches = 0, other = 0;
  const bad = [];
  for (const name of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const ms = asMutations(name, j);
    if (!ms) { other++; continue; }
    if (j.every((m) => typeof m.from === 'string')) { patches++; continue; }
    lists++;
    const r = lintCmds(j);
    n += r.checked;
    for (const b of r.bad) bad.push(`${name}：${b}`);
  }
  yes(lists > 0 && n > 0 && bad.length === 0 && lists + patches + other === files.length,
    `I3 tools/mutations/ JSON ${files.length} 份＝mutate.mjs 清單 ${lists}＋補丁格式 ${patches}（沒有 cmd，不看）＋認不出 ${other}；清單裡 ${n} 條 cmd，${bad.length} 條不合形狀`, bad.join('\n'));
}

fs.rmSync(CLONE, { recursive: true, force: true });
yes(!fs.existsSync(CLONE), '暫存 clone 已刪');
const mainTouched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(mainTouched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(mainTouched));
if (unformed.length) {
  console.log(`\n⊘ 情境未成立 ${unformed.length} 項——這幾項這次什麼都沒量到，不是通過也不是紅：${unformed.join('；')}`);
  if (!process.exitCode) process.exitCode = 3;
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 3 ? '，有情境未成立' : ''));
