// mutate.mjs 的護欄（npm run mutatetest；2026-10-02，照 MealMate docs/HOWTO_範圍化突變與帳本.md 第七節的驗法）。
//
// 全部在 repo 的暫存 clone（.logs/mut-clone）裡跑（共用慣例 v11.3 §5.20），跑完刪掉並確認主工作區沒被動。
// **判定不信 mutate.mjs 自己印的數字**：還原看被改那支檔的內容雜湊；測試有沒有跑、跑到的是原樣還是改壞的，
// 看探針測試自己寫進標記檔（.logs/zz-marker.txt）的行。輸出只用來比對「點名的是哪一次、哪支檔」。
//
// 情境（每一道護欄都有會擋的一面與要放行的一面）：
//   A  嚴格模式、工作區有不一致的檔 → 回 2、點名那個檔；目標檔雜湊沒變、探針沒跑
//   A' --only、工作區有不相干的改動 → 照跑：探針跑到改壞版一次、目標檔還原
//   A" --only、目標檔已含「改壞後」字串（HEAD 沒有）→ 回 2、點名；探針沒跑
//   B  跑到一半**真的殺程序**（taskkill /T /F；不用旗標模擬——旗標那條路上 finally 照樣會跑）→ 先確認壞檔留著、
//      兩處紀錄都在 → 重啟：自動還原（目標檔雜湊＝原檔）、還原紀錄不見、帳本記這一次已還原，接著照跑
//   C  殺掉之後把還原紀錄刪掉、帳本留著未收尾 → 回 5、指出第幾次與哪支檔；目標檔不被動（仍是壞的）
//   C' 同上，但人工把目標檔還原成原樣 → 照跑（不是永遠關著的閘）
//   D  還原紀錄在、帳本沒有對應的未收尾 → 回 6；目標檔不被動
//   E  正常跑完：探針跑到改壞版一次、目標檔＝原檔、沒有還原紀錄、帳本那一次有開跑也有完成

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
for (const f of ['scripts/mutate.mjs', 'scripts/worktree-guard.mjs', 'scripts/run-timeout.mjs', '.gitignore']) fs.copyFileSync(path.join(ROOT, f), path.join(CLONE, f));
const P = (r) => path.join(CLONE, r);
fs.writeFileSync(P('zz-target.txt'), 'alpha\n');
// 探針：每跑一次在標記檔寫一行（看到的是原樣還是改壞的）；看到 BROKEN 就紅
fs.writeFileSync(P('scripts/zz-check.mjs'), "import fs from 'node:fs'; const b = fs.readFileSync('zz-target.txt', 'utf8').includes('BROKEN'); fs.mkdirSync('.logs', { recursive: true }); fs.appendFileSync('.logs/zz-marker.txt', (b ? 'broken' : 'orig') + '\\n'); if (b) { console.log('✗ 目標被改壞了'); process.exit(1); }\n");
fs.writeFileSync(P('scripts/zz-sleep.mjs'), "import fs from 'node:fs'; fs.mkdirSync('.logs', { recursive: true }); fs.appendFileSync('.logs/zz-marker.txt', 'sleep\\n'); fs.writeFileSync('.logs/zz-sleep.pid', String(process.pid)); setTimeout(() => {}, 120000);\n");
cgit('add', '-A');
cgit('commit', '-q', '-m', 'mut 起點');
const START = cgit('rev-parse', 'HEAD').trim();
const ORIG = sha1(P('zz-target.txt'));
const LIST = P('.logs/zz-muts.json');
const LEDGER = P('.logs/mutate-ledger.jsonl');
const PENDING = P('.logs/mutate-pending.json');
const MARKER = P('.logs/zz-marker.txt');
console.log(`暫存 clone：${path.relative(ROOT, CLONE)}，起點 ${START.slice(0, 7)}；被驗的 mutate ${sha1(P('scripts/mutate.mjs')).slice(0, 12)}`);

const reset = () => {
  // 先刪目標檔再 reset：git 看索引沒變時不會重寫它（C" 留下的 CRLF 版會帶到下一個情境——實測踩到）
  fs.rmSync(P('zz-target.txt'), { force: true });
  cgit('reset', '-q', '--hard', START);
  for (const f of [LEDGER, PENDING, MARKER]) fs.rmSync(f, { force: true });
  fs.mkdirSync(P('.logs'), { recursive: true });
  fs.writeFileSync(LIST, JSON.stringify([
    { name: '會紅的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' },
    { name: '會睡很久的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-sleep.mjs' },
  ]));
  return cgit('status', '--porcelain=v1', '--untracked-files=no') === '' && sha1(P('zz-target.txt')) === ORIG;
};
const run = (...a) => {
  const r = spawnSync(process.execPath, ['scripts/mutate.mjs', ...a], { cwd: CLONE, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const marks = () => (fs.existsSync(MARKER) ? fs.readFileSync(MARKER, 'utf8').split('\n').filter(Boolean) : []);
const ledger = () => (fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const targetBroken = () => fs.readFileSync(P('zz-target.txt'), 'utf8').includes('BROKEN');

// 真的殺程序：開跑「會睡很久的」，等兩處紀錄都在、目標檔改壞、探針開始睡，再整棵殺掉
async function killMidway() {
  const child = spawn(process.execPath, ['scripts/mutate.mjs', LIST, '會睡很久的'], { cwd: CLONE, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { await sleep(200); ready = fs.existsSync(PENDING) && targetBroken() && marks().includes('sleep'); }
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(child.pid, 'SIGKILL');
  await new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.on('exit', r)));
  await sleep(300);
  const open = ledger().filter((e) => e.event === 'started').pop();
  return ready && targetBroken() && fs.existsSync(PENDING) && open && !ledger().some((e) => e.seq === open.seq && e.event !== 'started') ? open : null;
}

console.log('\n— A 護欄一：工作區 —');
{
  yes(reset(), '前置：clone 在起點、工作區乾淨、目標檔＝原檔');
  fs.appendFileSync(P('README.md'), '\n留下來的改動\n');
  const r = run(LIST, '會紅的');
  yes(r.code === 2 && /拒絕跑突變：README\.md$/m.test(r.out), `A 嚴格模式、README.md 不一致 → 回 2、點名 README.md（實得 ${r.code}）`, r.out.slice(-300));
  yes(sha1(P('zz-target.txt')) === ORIG && marks().length === 0, `A 目標檔雜湊沒變、探針沒跑（標記 ${marks().length} 行）`);
}
{
  yes(reset(), '前置：clone 在起點');
  fs.appendFileSync(P('README.md'), '\n不相干的改動\n');
  const r = run('--only', LIST, '會紅的');
  yes(r.code === 0 && marks().join(',') === 'broken' && sha1(P('zz-target.txt')) === ORIG,
    `A' --only、不相干的改動 → 照跑：探針看到改壞版一次（標記 ${marks().join(',') || '無'}）、目標檔還原（實得 ${r.code}）`, r.out.slice(-300));
}
{
  yes(reset(), '前置：clone 在起點');
  fs.writeFileSync(P('zz-target.txt'), 'alpha BROKEN\n');
  const r = run('--only', LIST, '會紅的');
  yes(r.code === 2 && /--only：zz-target\.txt 已經含突變「會紅的」改壞後的字串/.test(r.out) && marks().length === 0,
    `A" --only、目標檔已含改壞後的字串 → 回 2、點名、探針沒跑（實得 ${r.code}）`, r.out.slice(-300));
}

console.log('\n— B 真的殺程序之後重啟 —');
{
  yes(reset(), '前置：clone 在起點');
  const open = await killMidway();
  yes(!!open, '前置：殺掉之後壞檔留著、還原紀錄在、帳本那一次只有開跑沒有收尾（造不出來就不往下驗）');
  if (open) {
    const r = run(LIST, '會紅的');
    yes(new RegExp(`上一次被中斷（第 ${open.seq} 次，突變「會睡很久的」），已還原 zz-target\\.txt`).test(r.out),
      `B 重啟 → 點名第 ${open.seq} 次與 zz-target.txt`, r.out.slice(-400));
    yes(sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING), 'B 還原後目標檔雜湊＝原檔、還原紀錄不在');
    yes(ledger().some((e) => e.seq === open.seq && e.event === 'recovered'), `B 帳本記第 ${open.seq} 次已還原`);
    yes(r.code === 0 && marks().filter((x) => x === 'broken').length === 1, `B 還原後照跑：探針看到改壞版一次（實得 ${r.code}、標記 ${marks().join(',')}）`);
    const nr = run('--no-result');
    yes(nr.code === 0 && /^ {3}會睡很久的（第 1 次，被中斷、啟動時還原/m.test(nr.out), 'B 被中斷的那一次記成沒有結果、--no-result 列得出來', nr.out.slice(-300));
  }
}

console.log('\n— C 還原紀錄被移掉 —');
{
  yes(reset(), '前置：clone 在起點');
  const open = await killMidway();
  yes(!!open, '前置：殺掉之後兩處紀錄都在、壞檔留著');
  if (open) {
    fs.rmSync(PENDING);
    const before = marks().length;
    const r = run(LIST, '會紅的');
    yes(r.code === 5 && new RegExp(`第 ${open.seq} 次開跑（突變「會睡很久的」）沒有收尾，還原紀錄卻不在；zz-target\\.txt`).test(r.out),
      `C 刪掉還原紀錄 → 回 5、指出第 ${open.seq} 次與 zz-target.txt（實得 ${r.code}）`, r.out.slice(-400));
    yes(targetBroken() && marks().length === before, 'C 拒絕時目標檔不被動（仍是壞的）、探針沒跑');
  }
}
{
  yes(reset(), '前置：clone 在起點');
  const open = await killMidway();
  yes(!!open, '前置：殺掉之後兩處紀錄都在、壞檔留著');
  if (open) {
    fs.rmSync(PENDING);
    cgit('checkout', '--', 'zz-target.txt');            // 人工還原
    const r = run(LIST, '會紅的');
    yes(r.code === 0 && new RegExp(`註：第 ${open.seq} 次開跑沒有收尾、還原紀錄不在，但 zz-target\\.txt 統一行尾後的雜湊等於原檔——照跑`).test(r.out)
      && marks().filter((x) => x === 'broken').length === 1 && sha1(P('zz-target.txt')) === ORIG,
    `C' 人工還原後 → 照跑、註明、探針看到改壞版一次、目標檔＝原檔（實得 ${r.code}）`, r.out.slice(-400));
  }
}

{
  // C"：MealMate 2026-10-02 撞到的真實路徑——repo 沒有 .gitattributes、git 是 core.autocrlf=true，人工用
  // `git checkout` 還原，拿到 CRLF 版（git 自己看是乾淨的）→ 統一行尾後是原樣，要照跑。
  // 照真實路徑造：clone 裡 commit 掉 .gitattributes、開 autocrlf，再用 git 還原（不是直接寫一個 CRLF 檔）。
  yes(reset(), '前置：clone 在起點');
  cgit('rm', '-q', '.gitattributes');
  cgit('commit', '-q', '-m', '沒有 .gitattributes 的機器');
  cgit('config', 'core.autocrlf', 'true');
  const open = await killMidway();
  yes(!!open, '前置：殺掉之後兩處紀錄都在、壞檔留著');
  if (open) {
    fs.rmSync(PENDING);
    cgit('checkout', '--', 'zz-target.txt');
    yes(fs.readFileSync(P('zz-target.txt'), 'utf8') === 'alpha\r\n' && sha1(P('zz-target.txt')) !== ORIG
      && cgit('status', '--porcelain=v1', '--untracked-files=no') === '',
    '前置：git 還原出來的是 CRLF 版、位元組雜湊跟原檔不同、git 看工作區是乾淨的（不然這一條驗不到行尾）');
    const r = run(LIST, '會紅的');
    yes(r.code === 0 && /統一行尾後的雜湊等於原檔——照跑/.test(r.out) && marks().filter((x) => x === 'broken').length === 1,
      `C" 用 git 還原成 CRLF 版 → 統一行尾後是原樣，照跑（實得 ${r.code}）`, r.out.slice(-400));
  }
  cgit('config', 'core.autocrlf', 'false');
}

console.log('\n— F 登記時拒絕只改空白／行尾的突變 —');
{
  yes(reset(), '前置：clone 在起點');
  const BAD = P('.logs/zz-muts-ws.json');
  const ws = [
    { name: '會紅的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' },
    { name: '只改行尾的', file: 'zz-target.txt', find: 'alpha\n', replace: 'alpha\r\n', cmd: 'node scripts/zz-check.mjs' },
    { name: '只改空白的', file: 'zz-target.txt', find: 'alpha', replace: ' alpha ', cmd: 'node scripts/zz-check.mjs' },
  ];
  fs.writeFileSync(BAD, JSON.stringify(ws));
  const back = JSON.parse(fs.readFileSync(BAD, 'utf8'));
  yes(back[1].replace === 'alpha\r\n' && back[1].find === 'alpha\n' && back[2].replace === ' alpha ',
    '前置：讀回確認只改行尾／只改空白的那兩條真的寫進清單（不是被拆成別的字串）');
  const r = run(BAD, '會紅的');
  yes(r.code === 2 && /檢查 3\/3 條突變，2 條只改空白或行尾/.test(r.out) && /拒絕：只改行尾的、只改空白的$/m.test(r.out) && marks().length === 0
    && sha1(P('zz-target.txt')) === ORIG,
  `F 清單裡有只改行尾、只改空白的 → 回 2、點名那兩條、整份不跑（連沒問題的那條也不跑）（實得 ${r.code}）`, r.out.slice(-400));
}

console.log('\n— D 兩處紀錄不一致 —');
{
  yes(reset(), '前置：clone 在起點');
  const open = await killMidway();
  yes(!!open, '前置：殺掉之後兩處紀錄都在、壞檔留著');
  if (open) {
    fs.writeFileSync(LEDGER, ledger().filter((e) => e.seq !== open.seq).map((e) => JSON.stringify(e)).join('\n'));   // 帳本少了那一次
    const r = run(LIST, '會紅的');
    yes(r.code === 6 && new RegExp(`兩處紀錄不一致：還原紀錄是第 ${open.seq} 次（zz-target\\.txt）`).test(r.out) && targetBroken(),
      `D 還原紀錄在、帳本沒有對應的 → 回 6、目標檔不被動（實得 ${r.code}）`, r.out.slice(-400));
  }
}

console.log('\n— G 逾時：記成「沒有結果」，不是跑過 —');
{
  yes(reset(), '前置：clone 在起點');
  const TL = P('.logs/zz-muts-timeout.json');
  fs.writeFileSync(TL, JSON.stringify([
    { name: '會紅的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' },
    { name: '會卡住的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-sleep.mjs', timeoutMs: 2500 },
  ]));
  const t0 = Date.now();
  const r = run(TL, '會卡住的');
  const sec = (Date.now() - t0) / 1000;
  const pidF = P('.logs/zz-sleep.pid');
  const pid = fs.existsSync(pidF) ? Number(fs.readFileSync(pidF, 'utf8')) : 0;
  await sleep(500);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
  yes(pid > 0 && marks().includes('sleep'), `前置：卡住的探針真的跑起來了（pid ${pid}）`);
  yes(r.code === 1 && /✗ 會卡住的：逾時被殺——沒有結果/.test(r.out) && sec < 60, `G 卡住 → 回 1、寫明沒有結果、${sec.toFixed(1)} 秒結束（實得 ${r.code}）`, r.out.slice(-300));
  yes(!alive, `G 卡住的探針整棵被殺掉（pid ${pid}＝${alive ? '還在' : '不在'}）`);
  yes(sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING), 'G 目標檔雜湊＝原檔、還原紀錄不在');
  const closing = ledger().filter((e) => e.name === '會卡住的' && e.event === 'done').pop();
  yes(closing && closing.result === 'no-result', `G 帳本記成 no-result（實得 ${closing ? closing.result : '沒有那一筆'}）——不是 done 了事`);
  yes(/不影響任何選擇/.test((fs.readFileSync(LEDGER, 'utf8').split('\n')[0] || '')), 'G 帳本第一行寫明這個欄位目前不影響任何選擇');
  let nr = run('--no-result');
  yes(nr.code === 0 && /^ {3}會卡住的（第 \d+ 次，逾時 2\.5 秒被殺/m.test(nr.out) && /不影響任何選擇/.test(nr.out), 'G --no-result 列出「會卡住的」、並印出那段說明', nr.out.slice(-300));

  // 反向：正常紅了的不列；手動把它改成 no-result → 列得出來；再正常跑一次 → 又不列
  const r2 = run(TL, '會紅的');
  nr = run('--no-result');
  yes(r2.code === 0 && !/^ {3}會紅的（/m.test(nr.out), 'G 反向：正常紅了的「會紅的」不在 --no-result 裡');
  fs.appendFileSync(LEDGER, JSON.stringify({ seq: 99, event: 'done', name: '會紅的', file: 'zz-target.txt', result: 'no-result', reason: '手動標記' }) + '\n');
  nr = run('--no-result');
  yes(/^ {3}會紅的（第 99 次，手動標記/m.test(nr.out), 'G 手動把「會紅的」改成 no-result → --no-result 列得出來（欄位真的被讀）', nr.out.slice(-300));
  run(TL, '會紅的');
  nr = run('--no-result');
  yes(!/^ {3}會紅的（/m.test(nr.out) && /^ {3}會卡住的（/m.test(nr.out), 'G 再正常跑一次「會紅的」→ 它不再列出，「會卡住的」還在', nr.out.slice(-300));
}

console.log('\n— E 正常跑完（反向） —');
{
  yes(reset(), '前置：clone 在起點');
  const r = run(LIST, '會紅的');
  const L = ledger();
  yes(/檢查 2\/2 條突變，0 條只改空白或行尾/.test(r.out), 'E 登記檢查：檢查的筆數＝清單的 2 條、0 條被拒（原樣的全部通過）', r.out.slice(-300));
  yes(r.code === 0 && marks().join(',') === 'broken' && sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING)
    && L.some((e) => e.seq === 1 && e.event === 'started') && L.some((e) => e.seq === 1 && e.event === 'done'),
  `E 正常跑完：探針看到改壞版一次、目標檔＝原檔、沒有還原紀錄、帳本第 1 次有開跑也有完成（實得 ${r.code}）`, r.out.slice(-300));
}

fs.rmSync(CLONE, { recursive: true, force: true });
yes(!fs.existsSync(CLONE), '暫存 clone 已刪');
const mainTouched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(mainTouched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(mainTouched));
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
