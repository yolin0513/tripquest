// mutate.mjs 的兩道護欄（npm run mutatetest；2026-10-02）。
//
// 1. 工作區有進版控的檔跟 HEAD 不一樣 → 拒絕跑（回 2）、點名那個檔、目標檔沒被動。
// 2. 跑到一半**真的把程序殺掉**（Windows 用 taskkill /T /F，不用模擬的旗標——旗標走的不是同一條路）→
//    改壞的檔留著（finally 沒跑，先確認這件事真的發生了）→ 再啟動要偵測到未完成、點名該還原的檔（回 5）
//    → --recover 照紀錄還原成原檔、紀錄清掉、工作區＝HEAD。
// 3. 正常跑完（反向）：突變紅了、檔還原、沒有留下進度紀錄、工作區＝HEAD。
// 全部在 repo 的暫存 clone（.logs/mut-clone）裡跑（共用慣例 v11.3 §5.20），跑完刪掉並確認主工作區沒被動。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLONE = path.join(ROOT, '.logs', 'mut-clone');
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 600) : '')); process.exitCode = 1; }
};
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const cgit = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: CLONE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mainBefore = snapshot({ root: ROOT });

fs.rmSync(CLONE, { recursive: true, force: true });
execFileSync('git', ['clone', '-q', ROOT, CLONE]);
cgit('config', 'user.name', 'mut');
cgit('config', 'user.email', 'mut@users.noreply.github.com');
cgit('config', 'core.autocrlf', 'false');
for (const f of ['scripts/mutate.mjs', 'scripts/worktree-guard.mjs', '.gitignore']) fs.copyFileSync(path.join(ROOT, f), path.join(CLONE, f));
const W = (rel, s) => fs.writeFileSync(path.join(CLONE, rel), s);
W('zz-target.txt', 'alpha\n');
W('scripts/zz-check.mjs', "import fs from 'node:fs'; if (fs.readFileSync('zz-target.txt', 'utf8').includes('BROKEN')) { console.log('✗ 目標被改壞了'); process.exit(1); }\n");
W('scripts/zz-sleep.mjs', 'setTimeout(() => {}, 120000);\n');
cgit('add', '-A');
cgit('commit', '-q', '-m', 'mut 起點');
const START = cgit('rev-parse', 'HEAD').trim();
const ORIG = sha1(path.join(CLONE, 'zz-target.txt'));
// 突變清單放在 .logs（被擋掉，不算工作區改動）
fs.mkdirSync(path.join(CLONE, '.logs'), { recursive: true });
const LIST = path.join(CLONE, '.logs', 'zz-muts.json');
fs.writeFileSync(LIST, JSON.stringify([
  { name: '會紅的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' },
  { name: '會睡很久的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-sleep.mjs' },
]));
const JOURNAL = path.join(CLONE, '.logs', 'mutate-journal.json');
console.log(`暫存 clone：${path.relative(ROOT, CLONE)}，起點 ${START.slice(0, 7)}；被驗的 mutate ${sha1(path.join(CLONE, 'scripts/mutate.mjs')).slice(0, 12)}`);

const reset = () => {
  cgit('reset', '-q', '--hard', START);
  fs.rmSync(JOURNAL, { force: true });
  return cgit('status', '--porcelain=v1', '--untracked-files=no') === '';
};
const run = (...a) => {
  const r = spawnSync(process.execPath, ['scripts/mutate.mjs', ...a], { cwd: CLONE, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

console.log('\n— 護欄 1：工作區不等於 HEAD 就拒絕 —');
{
  yes(reset(), '前置：clone 在起點、工作區乾淨');
  fs.appendFileSync(path.join(CLONE, 'README.md'), '\n留下來的改動\n');
  const r = run(LIST, '會紅的');
  yes(r.code === 2 && /拒絕跑突變：README\.md$/m.test(r.out), `README.md 跟 HEAD 不一樣 → 回 2、點名 README.md（實得 ${r.code}）`, r.out.slice(-300));
  yes(sha1(path.join(CLONE, 'zz-target.txt')) === ORIG && !fs.existsSync(JOURNAL), '拒絕時目標檔沒被動、沒有留下進度紀錄');
}

console.log('\n— 護欄 2：跑到一半真的殺掉程序 —');
{
  yes(reset(), '前置：clone 在起點、工作區乾淨');
  const child = spawn(process.execPath, ['scripts/mutate.mjs', LIST, '會睡很久的'], { cwd: CLONE, stdio: 'ignore' });
  let seen = false;
  for (let i = 0; i < 100 && !seen; i++) { await sleep(200); seen = fs.existsSync(JOURNAL) && fs.readFileSync(path.join(CLONE, 'zz-target.txt'), 'utf8').includes('BROKEN'); }
  yes(seen, '前置：進度紀錄已寫到磁碟、目標檔已被改壞（突變正在跑）');
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(child.pid, 'SIGKILL');
  await new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.on('exit', r)));
  await sleep(300);
  const after = fs.readFileSync(path.join(CLONE, 'zz-target.txt'), 'utf8');
  yes(after.includes('BROKEN') && fs.existsSync(JOURNAL), '前置：殺掉之後改壞的檔留著、finally 沒跑（這就是要防的那種情況）');

  const r = run(LIST, '會紅的');
  yes(r.code === 5 && /上一次的突變沒有做完/.test(r.out) && /zz-target\.txt：應還原成 [0-9a-f]{12}，現在 [0-9a-f]{12}（不是原檔）/.test(r.out),
    `再啟動 → 回 5、偵測到未完成並點名 zz-target.txt 與該還原的雜湊（實得 ${r.code}）`, r.out.slice(-400));
  yes(r.out.includes(`應還原成 ${ORIG.slice(0, 12)}`), `點名的雜湊＝原檔的雜湊（${ORIG.slice(0, 12)}）`);
  const rc = run('--recover');
  yes(rc.code === 0 && sha1(path.join(CLONE, 'zz-target.txt')) === ORIG && !fs.existsSync(JOURNAL)
    && cgit('status', '--porcelain=v1', '--untracked-files=no') === '',
  `--recover → 回 0、目標檔＝原檔、紀錄清掉、工作區＝HEAD（實得 ${rc.code}）`, rc.out.slice(-300));
}

console.log('\n— 反向：正常跑完 —');
{
  yes(reset(), '前置：clone 在起點、工作區乾淨');
  const r = run(LIST, '會紅的');
  yes(r.code === 0 && /✓ 會紅的：紅了/.test(r.out) && /跑完工作區＝HEAD/.test(r.out), `突變紅了 → 回 0、印出跑完工作區＝HEAD（實得 ${r.code}）`, r.out.slice(-300));
  yes(sha1(path.join(CLONE, 'zz-target.txt')) === ORIG && !fs.existsSync(JOURNAL), '正常跑完：目標檔還原、沒有留下進度紀錄');
}

fs.rmSync(CLONE, { recursive: true, force: true });
yes(!fs.existsSync(CLONE), '暫存 clone 已刪');
const mainTouched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(mainTouched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(mainTouched));
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
