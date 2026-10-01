// run-affected 的工作區守衛（npm run worktreeguardtest；2026-10-02）。
//
// 起因：imgtest 每次跑都改寫 screenshots/features 裡三張進版控的截圖，v1.74.4、v1.74.5、2026-09-25 都是
// 事後手動 git checkout 還原——沒有任何東西擋，下一次可能不是截圖、也可能沒人注意到。
//
// 做法（共用慣例 v11.3 §5.20：從命令列入口跑的對照組，在 repo 的暫存 clone 裡跑，不在工作區裡跑）：
//   1. 把 repo clone 到 .logs/wtg-clone（被 .gitignore 擋掉），再把「這一份」的 run-affected.mjs、worktree-guard.mjs、
//      affected.mjs 蓋進去（突變時被驗的就是改壞的那一份），加幾支假測試進鏈，commit 成乾淨的起點。
//   2. 每個情境從乾淨的起點開始，用真的入口 `node scripts/run-affected.mjs --only <假測試>` 跑，比對回傳值與
//      輸出裡點名的那一支、那個檔（不只比回傳值；§5.11）。
//   3. 情境之間 reset 回起點；全部跑完刪掉 clone，並確認主工作區跑前跑後一樣。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLONE = path.join(ROOT, '.logs', 'wtg-clone');
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 600) : '')); process.exitCode = 1; }
};
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
const cgit = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: CLONE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const mainBefore = snapshot({ root: ROOT });

// ---------- 假測試 ----------
const FAKE = {
  'zz-wtg-writer': "import fs from 'node:fs'; fs.appendFileSync('README.md', '\\n測試寫進版控的檔\\n');",
  'zz-wtg-newfile': "import fs from 'node:fs'; fs.writeFileSync('docs/zz-junk.txt', 'x');",
  'zz-wtg-ignored': "import fs from 'node:fs'; fs.mkdirSync('screenshots/_out/zz', { recursive: true }); fs.writeFileSync('screenshots/_out/zz/a.png', 'x');",
  'zz-wtg-clean': "console.log('什麼都不做');",
  'zz-wtg-touchdirty': "import fs from 'node:fs'; fs.appendFileSync('CLAUDE.md', '\\n又改了一次\\n');",
  'zz-wtg-red': "console.log('✗ 故意紅'); process.exit(1);",
  // 卡住：自己睡、再開一個也在睡的孫程序，兩個 pid 寫進 .logs（看整棵樹有沒有真的被殺，不信執行器自己印的字）
  'zz-wtg-hang': "import fs from 'node:fs'; import { spawn } from 'node:child_process'; fs.mkdirSync('.logs', { recursive: true }); const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' }); fs.writeFileSync('.logs/hang-pids.txt', process.pid + ' ' + g.pid); setTimeout(() => {}, 120000);",
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

fs.rmSync(CLONE, { recursive: true, force: true });
execFileSync('git', ['clone', '-q', ROOT, CLONE]);
cgit('config', 'user.name', 'wtg');
cgit('config', 'user.email', 'wtg@users.noreply.github.com');
cgit('config', 'core.autocrlf', 'false');
for (const f of ['scripts/run-affected.mjs', 'scripts/worktree-guard.mjs', 'scripts/run-timeout.mjs', 'scripts/affected.mjs', '.gitignore']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(CLONE, f));
}
for (const [n, src] of Object.entries(FAKE)) fs.writeFileSync(path.join(CLONE, 'scripts', n + '.mjs'), src + '\n');
const pkgPath = path.join(CLONE, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.scripts.test += Object.keys(FAKE).map((n) => ` && node scripts/${n}.mjs`).join('');
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
cgit('add', '-A');
cgit('commit', '-q', '-m', 'wtg 起點');
const START = cgit('rev-parse', 'HEAD').trim();
console.log(`暫存 clone：${path.relative(ROOT, CLONE)}，起點 ${START.slice(0, 7)}；被驗的 run-affected ${sha(path.join(CLONE, 'scripts/run-affected.mjs'))}、worktree-guard ${sha(path.join(CLONE, 'scripts/worktree-guard.mjs'))}`);

const reset = () => {
  cgit('reset', '-q', '--hard', START);
  cgit('clean', '-fdxq', '-e', 'node_modules');
  return cgit('status', '--porcelain=v1', '--untracked-files=all') === '';
};
const run = (names, env = {}) => {
  const r = spawnSync(process.execPath, ['scripts/run-affected.mjs', '--only', names], { cwd: CLONE, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// 擷取「點名」的那一行；擷取本身先用已知輸出驗過（§5.11 第二層）
const blamed = (out) => (out.match(/^✗ (\S+) 動到工作區的檔：(.*?) —— /m) || []).slice(1);
const KNOWN = '\n✗ zz-a 動到工作區的檔：README.md（改了進版控的檔） —— 測試的輸出要寫到…\n';
yes(blamed(KNOWN)[0] === 'zz-a' && blamed(KNOWN)[1] === 'README.md（改了進版控的檔）' && blamed('✓ 沒事').length === 0,
  '擷取點名那一行的樣式：已知輸出抓得到測試名與檔名，沒有那一行時抓不到');

console.log('\n— 會擋的情境 —');
{
  yes(reset(), '前置：clone 在起點、工作區乾淨');
  const r = run('zz-wtg-writer');
  const [who, what] = blamed(r.out);
  yes(r.code === 3 && who === 'zz-wtg-writer' && /^README\.md（改了進版控的檔）$/.test(what || ''),
    `測試改了進版控的 README.md → 回 3、點名 zz-wtg-writer 與 README.md（實得 ${r.code}、${who}、${what}）`, r.out.slice(-400));
  yes(/README\.md/.test(cgit('status', '--porcelain=v1')), '前置（事後確認）：README.md 真的被改了——不是情境沒造成');
}
{
  reset();
  const r = run('zz-wtg-newfile');
  const [who, what] = blamed(r.out);
  yes(r.code === 3 && who === 'zz-wtg-newfile' && what === 'docs/zz-junk.txt（新檔）',
    `測試丟下沒被擋掉的新檔 → 回 3、點名 docs/zz-junk.txt（實得 ${r.code}、${who}、${what}）`, r.out.slice(-400));
}
{
  reset();
  fs.appendFileSync(path.join(CLONE, 'CLAUDE.md'), '\n開跑前就有的改動\n');
  const r = run('zz-wtg-touchdirty');
  const [who, what] = blamed(r.out);
  yes(r.code === 3 && who === 'zz-wtg-touchdirty' && what === 'CLAUDE.md（開跑前就有改動，測試又改了它）',
    `開跑前就改過的 CLAUDE.md、測試又改一次 → 回 3、點名它（實得 ${r.code}、${who}、${what}）`, r.out.slice(-400));
}
{
  reset();
  const r = run('zz-wtg-writer', { GIT_DIR: path.join(CLONE, 'no-such-git-dir') });
  yes(r.code === 4 && /工作區守衛壞了：zz-wtg-writer 開跑前拍不到工作區/.test(r.out),
    `git 讀不到 → 回 4、寫明守衛壞了，不當成沒改動（實得 ${r.code}）`, r.out.slice(-400));
}

console.log('\n— 單支逾時 —');
{
  reset();
  const pidFile = path.join(CLONE, '.logs', 'hang-pids.txt');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['scripts/run-affected.mjs', '--only', 'zz-wtg-hang', '--timeout-sec', '3'], { cwd: CLONE, encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const sec = (Date.now() - t0) / 1000;
  const pids = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim().split(' ').map(Number) : [];
  yes(pids.length === 2 && pids.every((p) => p > 0), `前置：卡住的測試真的跑起來、開了孫程序（pid ${pids.join('、') || '無'}）`);
  await new Promise((res) => setTimeout(res, 500));
  yes(r.status === 7 && /✗ zz-wtg-hang 逾時（3 秒）被殺——沒有結果，不是通過也不是紅/.test(out) && sec < 30,
    `卡住的測試 → 回 7、寫明「沒有結果」、${sec.toFixed(1)} 秒內結束（實得 ${r.status}）`, out.slice(-300));
  yes(pids.length === 2 && pids.every((p) => !alive(p)), `整棵程序樹都被殺掉：${pids.map((p) => `${p}＝${alive(p) ? '還在' : '不在'}`).join('、')}`);
}

console.log('\n— 要放行的情境 —');
{
  reset();
  const r = run('zz-wtg-clean');
  yes(r.code === 0 && /工作區守衛：zz-wtg-clean 開跑前不一樣的檔 0 個，跑完多出或變了 0 個/.test(r.out),
    `什麼都不動的測試 → 回 0，守衛那一行有印（實得 ${r.code}）`, r.out.slice(-400));
}
{
  reset();
  const r = run('zz-wtg-ignored');
  yes(fs.existsSync(path.join(CLONE, 'screenshots/_out/zz/a.png')), '前置：被擋掉的目錄裡真的寫出了檔');
  yes(r.code === 0, `測試只寫進 .gitignore 擋掉的 screenshots/_out/ → 回 0（實得 ${r.code}）`, r.out.slice(-400));
}
{
  reset();
  fs.appendFileSync(path.join(CLONE, 'CLAUDE.md'), '\n開跑前就有的改動\n');
  const r = run('zz-wtg-clean');
  yes(r.code === 0 && /開跑前不一樣的檔 1 個，跑完多出或變了 0 個/.test(r.out),
    `開跑前就有的改動不算在測試頭上 → 回 0、開跑前 1 個（實得 ${r.code}）`, r.out.slice(-400));
}
{
  reset();
  const r = run('zz-wtg-red');
  yes(r.code === 1 && /✗ zz-wtg-red 紅了/.test(r.out) && !blamed(r.out).length,
    `測試自己紅、沒動工作區 → 照原本回 1、不被說成動了工作區（實得 ${r.code}）`, r.out.slice(-400));
}

fs.rmSync(CLONE, { recursive: true, force: true });
yes(!fs.existsSync(CLONE), '暫存 clone 已刪');
const mainTouched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(mainTouched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(mainTouched));

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
