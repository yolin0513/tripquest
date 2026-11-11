// mutate.mjs 的護欄（npm run mutatetest；2026-10-02，照 MealMate docs/HOWTO_範圍化突變與帳本.md 第七節的驗法）。
// ⏱ 受機器狀態影響（2026-10-29 標）：G「卡住」要在 60 秒內結束（逾時設 2.5 秒，裕度大）——機器非常忙時才可能誤紅。
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
//   I  紅了 6 項：6 行 ✗ 全部印出、全文存進 .logs/mutate-out.<第幾次>.log（原本只印前 4 行、紅了不留全文）
//   E  正常跑完：探針先跑原樣一次、再跑到改壞版一次、目標檔＝原檔、沒有還原紀錄、帳本有原樣、開跑、完成
// 2026-11-11 守夜加（盲點：被打斷的測試也印總結行 → 被記成紅）。突變那一次的四種結束方式，各一種真的跑出來的情境，
// 比對回傳值、行首字樣、帳本的 kind 三樣：
//   N1 正常結束·沒紅（回 1、「✗ 沒紅｜」）    N2 崩潰：丟例外沒接住（回 7、「⊘ 崩潰｜」；H 是被強制停掉的那一種）
//   G  逾時（回 8、「⊘ 逾時｜」）             N3 沒跑完：接住例外、印了總結，只跑 2/3 項（回 9、「⊘ 沒跑完｜」——修之前記成紅）
//   N4 沒跑完＋多印一行「✗ 例外」：不排除那一行的話項數剛好湊回 3（回 9）   N5 項數比母體多（回 9、「⊘ 項數不符｜」）
//   N7 檢查器樣子：跑滿 3 項、紅了，另外多印一行「✗ 對照組沒過——」結論 → 那一行不算項目、記成紅（回 0）
//   原樣不成立（回 3、突變一條都不跑、目標檔沒被改過）：O1 原樣不是綠的、O2 原樣崩潰、O3 原樣逾時、O4 原樣一項都數不到
//   N6 混在一起：回 1（沒紅先講）、最後一行各類相加＝選到的條數＝帳本收尾筆數；同一個 cmd 的原樣只跑一次

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';
import { testedLine } from './probe-hash.mjs';
import { killTree } from './run-timeout.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLONE = path.join(ROOT, '.logs', 'mut-clone');
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 600).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
// 「情境未成立」是第三種結果：要測的狀況從頭到尾沒發生——這次什麼都沒量到，**不是通過、也不是紅**
// （MealMate 2026-10-02：殺程序錯過時間窗，紅在造情境失敗、被算成一條紅）。印 ⊘、最後以回 3 結束（紅是 1）。
const unformed = [];
const pre = (c, m) => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { unformed.push(m); console.log('⊘ 情境未成立：' + m); }
  return c;
};
// 只跑指定的情境組（node scripts/mutatetest.mjs B C）：拿來比「單獨跑」與「一起跑」的結果
const ONLY = process.argv.slice(2);
const want = (g) => !ONLY.length || ONLY.includes(g);
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const cgit = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: CLONE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mainBefore = snapshot({ root: ROOT });

fs.rmSync(CLONE, { recursive: true, force: true });
execFileSync('git', ['clone', '-q', ROOT, CLONE]);
cgit('config', 'user.name', 'mut');
cgit('config', 'user.email', 'mut@users.noreply.github.com');
cgit('config', 'core.autocrlf', 'false');
for (const f of ['scripts/mutate.mjs', 'scripts/worktree-guard.mjs', 'scripts/run-timeout.mjs', 'scripts/proctree.mjs', '.gitignore']) fs.copyFileSync(path.join(ROOT, f), path.join(CLONE, f));
const P = (r) => path.join(CLONE, r);
fs.writeFileSync(P('zz-target.txt'), 'alpha\n');
fs.writeFileSync(P('zz-fixture-a.txt'), 'fixture a\n');   // 「進版控、跟 HEAD 不一樣的檔」用這個 fixture，不拿 README.md
// 探針：每跑一次在標記檔寫一行（看到的是原樣還是改壞的）；看到 BROKEN 就紅。原樣時印一行 ✓（執行器數母體要數得到項目）
// 共用的開頭：讀目標檔、記標記。每支探針的標記帶自己的名字（zz-check 沿用舊的 orig／broken）
const HEAD_JS = "import fs from 'node:fs'; const b = fs.readFileSync('zz-target.txt', 'utf8').includes('BROKEN'); fs.mkdirSync('.logs', { recursive: true }); const mark = (s) => fs.appendFileSync('.logs/zz-marker.txt', s + '\\n'); ";
fs.writeFileSync(P('scripts/zz-check.mjs'), HEAD_JS + "mark(b ? 'broken' : 'orig'); if (b) { console.log('✗ 目標被改壞了\\n\\n0 項通過，有失敗'); process.exit(1); } console.log('✓ 目標是原樣\\n\\n1 項通過');\n");
// 中途被強制停掉（MealMate 2026-10-02）：前面一節本來就印 ✗，接著被 taskkill /F 停掉——結束碼 1，跟斷言失敗一模一樣，只差沒有最後那一行總結
// （原樣時正常跑完：執行器要先跑原樣、數母體）
fs.writeFileSync(P('scripts/zz-killed.mjs'), HEAD_JS + "import { execFileSync } from 'node:child_process'; if (!b) { mark('killed-orig'); console.log('✓ 前面一節\\n✓ 後面一節\\n\\n2 項通過'); process.exit(0); } console.log('✗ 前面一節本來就會失敗'); mark('printed-x'); execFileSync('taskkill', ['/PID', String(process.pid), '/F'], { stdio: 'ignore' }); setTimeout(() => { mark('finished'); console.log('1 項通過'); }, 5000);\n");
// 紅 6 項的探針：前 4 項之後的也要留在紀錄裡（I 情境）；原樣時 6 項都 ✓
fs.writeFileSync(P('scripts/zz-six.mjs'), HEAD_JS + "for (let i = 1; i <= 6; i++) console.log((b ? '✗' : '✓') + ' 第 ' + i + ' 項' + (b ? '紅了' : '')); console.log(b ? '\\n0 項通過，有失敗' : '\\n6 項通過'); process.exit(b ? 1 : 0);\n");
// 卡住的探針：只有改壞版會卡（原樣要正常結束，不然卡在原樣那一關）；pid 只在卡住時寫
fs.writeFileSync(P('scripts/zz-sleep.mjs'), HEAD_JS + "if (!b) { mark('sleep-orig'); console.log('✓ 沒卡住\\n\\n1 項通過'); process.exit(0); } mark('sleep'); fs.writeFileSync('.logs/zz-sleep.pid', String(process.pid)); setTimeout(() => {}, 120000);\n");
// ---- 2026-11-11：四種結束方式與原樣不成立的探針（每支只依靠它要測的那一種，原樣都是 3 項 ✓ 正常結束，除非它測的就是原樣） ----
const ORIG3 = "if (!b) { console.log('✓ 第 1 項\\n✓ 第 2 項\\n✓ 第 3 項\\n\\n3 項通過'); process.exit(0); } ";
// N2 崩潰：印了 1 項就丟例外、沒人接——沒有總結行
fs.writeFileSync(P('scripts/zz-throw.mjs'), HEAD_JS + "mark(b ? 'throw-broken' : 'throw-orig'); " + ORIG3 + "console.log('✓ 第 1 項'); throw new Error('假的：沒接住的例外');\n");
// N3 沒跑完：跑了 2 項、測試自己接住例外、照樣印總結（2026-11-11 legviewtest 停在 7/25 項就是這個樣子）
fs.writeFileSync(P('scripts/zz-short.mjs'), HEAD_JS + "mark(b ? 'short-broken' : 'short-orig'); " + ORIG3 + "console.log('✓ 第 1 項\\n✗ 第 2 項'); console.log('\\n1 項通過，有失敗'); process.exit(1);\n");
// N4 沒跑完＋接住例外時多印一行「✗ 例外」：照字面數是 3 行＝母體，排除那一行才是 2
fs.writeFileSync(P('scripts/zz-shortx.mjs'), HEAD_JS + "mark(b ? 'shortx-broken' : 'shortx-orig'); " + ORIG3 + "console.log('✓ 第 1 項\\n✗ 第 2 項\\n✗ 例外 Error: 假的時序問題'); console.log('\\n1 項通過，有失敗'); process.exit(1);\n");
// N7 檢查器的樣子（mutstale、mutlint）：每個對照組一行 ✓／✗，沒過時多印一行「✗ 對照組沒過——」結論——照字面數是 4 行，排除那一行才是 3（＝母體、紅了）
fs.writeFileSync(P('scripts/zz-ctlfail.mjs'), HEAD_JS + "mark(b ? 'ctlfail-broken' : 'ctlfail-orig'); " + ORIG3 + "console.log('✓ 第 1 項\\n✗ 第 2 項\\n✓ 第 3 項\\n✗ 對照組沒過——檢查器壞了，不採信下面的結果'); console.log('\\n2 項通過，有失敗'); process.exit(1);\n");
// N5 項數比母體多：3 項之外多印一行 ✗
fs.writeFileSync(P('scripts/zz-extra.mjs'), HEAD_JS + "mark(b ? 'extra-broken' : 'extra-orig'); " + ORIG3 + "console.log('✗ 第 1 項\\n✗ 第 2 項\\n✗ 第 3 項\\n✗ 多出來的一行'); console.log('\\n0 項通過，有失敗'); process.exit(1);\n");
// O1 原樣不是綠的：原樣就印 ✗、結束碼 1
fs.writeFileSync(P('scripts/zz-redorig.mjs'), HEAD_JS + "mark(b ? 'redorig-broken' : 'redorig-orig'); console.log('✗ 原樣就紅\\n✓ 第 2 項\\n\\n1 項通過，有失敗'); process.exit(1);\n");
// O2 原樣崩潰：原樣就丟例外、沒有總結行
fs.writeFileSync(P('scripts/zz-crashorig.mjs'), HEAD_JS + "mark(b ? 'crashorig-broken' : 'crashorig-orig'); console.log('✓ 第 1 項'); throw new Error('假的：原樣就崩潰');\n");
// O3 原樣逾時：原樣就卡住（pid 寫進另一個檔）
fs.writeFileSync(P('scripts/zz-sleeporig.mjs'), HEAD_JS + "mark(b ? 'sleeporig-broken' : 'sleeporig-orig'); fs.writeFileSync('.logs/zz-sleeporig.pid', String(process.pid)); setTimeout(() => {}, 120000);\n");
// O4 原樣一項都數不到：只印總結行、沒有任何行首 ✓／✗ 的行
fs.writeFileSync(P('scripts/zz-zero.mjs'), HEAD_JS + "mark(b ? 'zero-broken' : 'zero-orig'); console.log('（這支不印 ✓／✗）\\n\\n1 項通過'); process.exit(b ? 1 : 0);\n");
cgit('add', '-A');
cgit('commit', '-q', '-m', 'mut 起點');
const START = cgit('rev-parse', 'HEAD').trim();
const ORIG = sha1(P('zz-target.txt'));
const LIST = P('.logs/zz-muts.json');
const LEDGER = P('.logs/mutate-ledger.jsonl');
const PENDING = P('.logs/mutate-pending.json');
const MARKER = P('.logs/zz-marker.txt');
console.log(testedLine(CLONE, ['scripts/mutate.mjs', 'scripts/worktree-guard.mjs', 'scripts/run-timeout.mjs', 'scripts/proctree.mjs']));
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

// 真的殺程序：開跑一條突變，等「正在跑」的痕跡都在磁碟上（還原紀錄在、目標檔是壞的、探針寫了 sleep）再整棵殺掉。
// 情境成立與否**只看殺掉之後磁碟上留下的痕跡**：壞檔還在（finally 跑過的話會被寫回原樣）、還原紀錄還在、帳本那一次只有開跑。
// 程序在窗口出現之前就自己結束了（錯過時間窗）→ 回 null＝情境未成立。
async function killMidway(name = '會睡很久的') {
  const child = spawn(process.execPath, ['scripts/mutate.mjs', LIST, name], { cwd: CLONE, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  let ready = false;
  for (let i = 0; i < 100 && !ready && !exited; i++) { await sleep(200); ready = fs.existsSync(PENDING) && targetBroken() && marks().includes('sleep'); }
  if (!exited) {
    killTree(child.pid, { log: () => {} });   // 認子孫看建立時間、逐支殺（不用 taskkill /T——PID 重用時會殺到不相干的程序）
    await new Promise((r) => (exited || child.exitCode !== null || child.signalCode !== null ? r() : child.on('exit', r)));
  }
  await sleep(300);
  const open = ledger().filter((e) => e.event === 'started').pop();
  return ready && targetBroken() && fs.existsSync(PENDING) && open && !ledger().some((e) => e.seq === open.seq && e.event !== 'started') ? open : null;
}
// 造「殺到一半」的情境：沒成立就重來（最多 3 次），還是不成立 → 記成情境未成立
async function formKill(label, setup = () => {}) {
  for (let k = 1; k <= 3; k++) {
    if (!reset()) { console.log(`   （第 ${k} 次：clone 回不到起點）`); continue; }
    setup();
    const open = await killMidway();
    if (open) { pre(true, `前置：${label}——殺掉之後壞檔留在磁碟上、還原紀錄在、帳本那一次只有開跑（第 ${k} 次造成）`); return open; }
    console.log(`   （第 ${k} 次沒造成，重來）`);
  }
  pre(false, `${label}——殺程序造情境 3 次都沒成立`);
  return null;
}

console.log('\n— K 對照組：錯過時間窗必須判成「情境未成立」 —');
if (want('K')) {
  // 故意錯過：殺的是一條很快就自己跑完的突變（會紅的），還沒等到「正在跑」的窗口它就結束了。
  // 判定照樣只看磁碟痕跡：目標檔已被寫回原樣、還原紀錄不在 → 沒有「殺到一半」→ killMidway 必須回 null。
  pre(reset(), '前置：clone 在起點');
  const o = await killMidway('會紅的');
  yes(o === null && sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING),
    `K 殺程序錯過時間窗（突變自己先跑完）→ 判成情境未成立，不是成立（實得 ${o ? '成立' : '未成立'}；目標檔＝原檔＝${sha1(P('zz-target.txt')) === ORIG}）`);
}

console.log('\n— A 護欄一：工作區 —');
if (want('A')) {
  {
    pre(reset(), '前置：clone 在起點、工作區乾淨、目標檔＝原檔');
    fs.appendFileSync(P('zz-fixture-a.txt'), '\n留下來的改動\n');
    pre(/zz-fixture-a\.txt/.test(cgit('status', '--porcelain=v1', '--untracked-files=no')), '前置：zz-fixture-a.txt 真的跟 HEAD 不一樣');
    const r = run(LIST, '會紅的');
    yes(r.code === 2 && /拒絕跑突變：zz-fixture-a\.txt$/m.test(r.out), `A 嚴格模式、zz-fixture-a.txt 不一致 → 回 2、點名 zz-fixture-a.txt（實得 ${r.code}）`, r.out.slice(-300));
    yes(sha1(P('zz-target.txt')) === ORIG && marks().length === 0, `A 目標檔雜湊沒變、探針沒跑（標記 ${marks().length} 行）`);
  }
  {
    pre(reset(), '前置：clone 在起點');
    fs.appendFileSync(P('zz-fixture-a.txt'), '\n不相干的改動\n');
    const r = run('--only', LIST, '會紅的');
    yes(r.code === 0 && marks().join(',') === 'orig,broken' && sha1(P('zz-target.txt')) === ORIG,
      `A' --only、不相干的改動 → 照跑：探針先看到原樣一次、再看到改壞版一次（標記 ${marks().join(',') || '無'}）、目標檔還原（實得 ${r.code}）`, r.out.slice(-300));
  }
  {
    pre(reset(), '前置：clone 在起點');
    fs.writeFileSync(P('zz-target.txt'), 'alpha BROKEN\n');
    pre(fs.readFileSync(P('zz-target.txt'), 'utf8').includes('BROKEN'), '前置：讀回確認目標檔真的含改壞後的字串');
    const r = run('--only', LIST, '會紅的');
    yes(r.code === 2 && /--only：zz-target\.txt 已經含突變「會紅的」改壞後的字串/.test(r.out) && marks().length === 0,
      `A" --only、目標檔已含改壞後的字串 → 回 2、點名、探針沒跑（實得 ${r.code}）`, r.out.slice(-300));
  }
}

console.log('\n— B 真的殺程序之後重啟 —');
if (want('B')) {
  const open = await formKill('B');
  if (open) {
    const r = run(LIST, '會紅的');
    yes(new RegExp(`上一次被中斷（第 ${open.seq} 次，突變「會睡很久的」），已還原 zz-target\\.txt`).test(r.out),
      `B 重啟 → 點名第 ${open.seq} 次與 zz-target.txt`, r.out.slice(-400));
    yes(sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING), 'B 還原後目標檔雜湊＝原檔、還原紀錄不在');
    yes(ledger().some((e) => e.seq === open.seq && e.event === 'recovered'), `B 帳本記第 ${open.seq} 次已還原`);
    yes(r.code === 0 && marks().filter((x) => x === 'broken').length === 1, `B 還原後照跑：探針看到改壞版一次（實得 ${r.code}、標記 ${marks().join(',')}）`);
    const nr = run('--no-result');
    yes(nr.code === 0 && new RegExp(`^ {3}會睡很久的（第 ${open.seq} 次，被中斷、啟動時還原`, 'm').test(nr.out), 'B 被中斷的那一次記成沒有結果、--no-result 列得出來', nr.out.slice(-300));
  }
}

console.log('\n— C 還原紀錄被移掉 —');
if (want('C')) {
  {
    const open = await formKill('C');
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
    const open = await formKill("C'");
    if (open) {
      fs.rmSync(PENDING);
      cgit('checkout', '--', 'zz-target.txt');            // 人工還原
      pre(sha1(P('zz-target.txt')) === ORIG, "前置：C' 人工還原之後目標檔＝原檔");
      const r = run(LIST, '會紅的');
      yes(r.code === 0 && new RegExp(`註：第 ${open.seq} 次開跑沒有收尾、還原紀錄不在，但 zz-target\\.txt 統一行尾後的雜湊等於原檔——照跑`).test(r.out)
        && marks().filter((x) => x === 'broken').length === 1 && sha1(P('zz-target.txt')) === ORIG,
      `C' 人工還原後 → 照跑、註明、探針看到改壞版一次、目標檔＝原檔（實得 ${r.code}）`, r.out.slice(-400));
    }
  }
  {
    // C"：MealMate 2026-10-02 撞到的真實路徑——repo 沒有 .gitattributes、git 是 core.autocrlf=true，人工用
    // `git checkout` 還原，拿到 CRLF 版（git 自己看是乾淨的）→ 統一行尾後是原樣，要照跑。
    const open = await formKill('C"', () => {
      cgit('rm', '-q', '.gitattributes');
      cgit('commit', '-q', '-m', '沒有 .gitattributes 的機器');
      cgit('config', 'core.autocrlf', 'true');
    });
    if (open) {
      fs.rmSync(PENDING);
      cgit('checkout', '--', 'zz-target.txt');
      if (pre(fs.readFileSync(P('zz-target.txt'), 'utf8') === 'alpha\r\n' && sha1(P('zz-target.txt')) !== ORIG
        && cgit('status', '--porcelain=v1', '--untracked-files=no') === '',
      '前置：git 還原出來的是 CRLF 版、位元組雜湊跟原檔不同、git 看工作區是乾淨的（不然這一條驗不到行尾）')) {
        const r = run(LIST, '會紅的');
        yes(r.code === 0 && /統一行尾後的雜湊等於原檔——照跑/.test(r.out) && marks().filter((x) => x === 'broken').length === 1,
          `C" 用 git 還原成 CRLF 版 → 統一行尾後是原樣，照跑（實得 ${r.code}）`, r.out.slice(-400));
      }
    }
    cgit('config', 'core.autocrlf', 'false');
  }
}

console.log('\n— F 登記時拒絕只改空白／行尾的突變 —');
if (want('F')) {
  pre(reset(), '前置：clone 在起點');
  const BAD = P('.logs/zz-muts-ws.json');
  const ws = [
    { name: '會紅的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' },
    { name: '只改行尾的', file: 'zz-target.txt', find: 'alpha\n', replace: 'alpha\r\n', cmd: 'node scripts/zz-check.mjs' },
    { name: '只改空白的', file: 'zz-target.txt', find: 'alpha', replace: ' alpha ', cmd: 'node scripts/zz-check.mjs' },
  ];
  fs.writeFileSync(BAD, JSON.stringify(ws));
  const back = JSON.parse(fs.readFileSync(BAD, 'utf8'));
  pre(back[1].replace === 'alpha\r\n' && back[1].find === 'alpha\n' && back[2].replace === ' alpha ',
    '前置：讀回確認只改行尾／只改空白的那兩條真的寫進清單（不是被拆成別的字串）');
  const r = run(BAD, '會紅的');
  yes(r.code === 2 && /檢查 3\/3 條突變，2 條只改空白或行尾/.test(r.out) && /拒絕：只改行尾的、只改空白的$/m.test(r.out) && marks().length === 0
    && sha1(P('zz-target.txt')) === ORIG,
  `F 清單裡有只改行尾、只改空白的 → 回 2、點名那兩條、整份不跑（連沒問題的那條也不跑）（實得 ${r.code}）`, r.out.slice(-400));
}

console.log('\n— D 兩處紀錄不一致 —');
if (want('D')) {
  const open = await formKill('D');
  if (open) {
    fs.writeFileSync(LEDGER, ledger().filter((e) => e.seq !== open.seq).map((e) => JSON.stringify(e)).join('\n'));   // 帳本少了那一次
    pre(fs.existsSync(PENDING) && !ledger().some((e) => e.seq === open.seq), '前置：還原紀錄還在、帳本裡已經沒有那一次');
    const r = run(LIST, '會紅的');
    yes(r.code === 6 && new RegExp(`兩處紀錄不一致：還原紀錄是第 ${open.seq} 次（zz-target\\.txt）`).test(r.out) && targetBroken(),
      `D 還原紀錄在、帳本沒有對應的 → 回 6、目標檔不被動（實得 ${r.code}）`, r.out.slice(-400));
  }
}

console.log('\n— G 逾時：記成「沒有結果」，不是跑過 —');
if (want('G')) {
  pre(reset(), '前置：clone 在起點');
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
  if (pre(pid > 0 && marks().includes('sleep'), `前置：卡住的探針真的跑起來了（pid ${pid}）`)) {
    yes(r.code === 8 && /^⊘ 逾時｜會卡住的：逾時 2\.5 秒被殺——沒有結果/m.test(r.out) && sec < 60, `G 卡住 → 回 8、行首「⊘ 逾時｜」、寫明沒有結果、${sec.toFixed(1)} 秒結束（實得 ${r.code}）`, r.out.slice(-300));
    yes(!alive, `G 卡住的探針整棵被殺掉（pid ${pid}＝${alive ? '還在' : '不在'}）`);
    yes(sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING), 'G 目標檔雜湊＝原檔、還原紀錄不在');
    const closing = ledger().filter((e) => e.name === '會卡住的' && e.event === 'done').pop();
    yes(closing && closing.result === 'no-result' && closing.kind === 'timeout', `G 帳本記成 no-result、kind＝timeout（實得 ${closing ? `${closing.result}／${closing.kind}` : '沒有那一筆'}）——不是 done 了事`);
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
}

console.log('\n— H 中途被強制停掉：記成「沒有結果」，不是紅 —');
if (want('H')) {
  pre(reset(), '前置：clone 在起點');
  const HL = P('.logs/zz-muts-killed.json');
  fs.writeFileSync(HL, JSON.stringify([
    { name: '被停掉的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-killed.mjs' },
    { name: '會紅的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-check.mjs' },
  ]));
  const r = run(HL, '被停掉的');
  if (pre(marks().includes('printed-x') && !marks().includes('finished'), `前置：被停掉的探針印了 ✗、沒撐到總結行就被停掉（探針痕跡：${marks().join(',')}）`)) {
    const closing = ledger().filter((e) => e.name === '被停掉的' && e.event === 'done').pop();
    yes(closing && closing.result === 'no-result' && closing.kind === 'crash' && /^崩潰：沒有最後那一行總結/.test(closing.reason || ''), `H 帳本記成 no-result、kind＝crash、理由寫崩潰（實得 ${closing ? `${closing.result}／${closing.kind}／${closing.reason}` : '沒有那一筆'}）——不是 red`);
    yes(r.code === 7 && /^⊘ 崩潰｜被停掉的：沒有最後那一行總結/m.test(r.out) && !/^✓ 紅了｜被停掉的/m.test(r.out), `H 回 7、行首「⊘ 崩潰｜」、沒有寫成紅了（實得 ${r.code}）`, r.out.slice(-300));
    // 沒有結果時看得到原因：探針被停掉前印的那一行要出現在 mutate 的輸出裡，而且全文存進 .logs/
    const tf = closing && P(`.logs/mutate-noresult.${closing.seq}.log`);
    yes(/^ {5}│ ✗ 前面一節本來就會失敗$/m.test(r.out) && tf && fs.existsSync(tf) && fs.readFileSync(tf, 'utf8').includes('✗ 前面一節本來就會失敗'),
      'H 沒有結果時印出子程序輸出的最後幾行、全文存進 .logs/mutate-noresult.<第幾次>.log', r.out.slice(-300));
    // 反向：同一份清單裡跑到底的「會紅的」照樣記成 red
    const r2 = run(HL, '會紅的');
    const c2 = ledger().filter((e) => e.name === '會紅的' && e.event === 'done').pop();
    yes(r2.code === 0 && c2 && c2.result === 'red', `H 反向：跑到底的「會紅的」照樣記成 red（實得 ${c2 ? c2.result : '沒有那一筆'}）`, r2.out.slice(-300));
  }
}

console.log('\n— I 紅了的時候：每一行 ✗ 都留下來，不只前幾行 —');
if (want('I')) {
  pre(reset(), '前置：clone 在起點');
  const IL = P('.logs/zz-muts-six.json');
  fs.writeFileSync(IL, JSON.stringify([
    { name: '紅六項的', file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd: 'node scripts/zz-six.mjs' },
  ]));
  const r = run(IL, '紅六項的');
  const closing = ledger().filter((e) => e.name === '紅六項的' && e.event === 'done').pop();
  if (pre(closing && closing.result === 'red', `前置：紅六項的那一條記成 red（實得 ${closing ? closing.result : '沒有那一筆'}）`)) {
    const six = [1, 2, 3, 4, 5, 6];
    const printed = six.filter((i) => new RegExp(`^ {5}✗ 第 ${i} 項紅了$`, 'm').test(r.out));
    yes(printed.length === 6 && /✗ 6 行，全部列在下面/.test(r.out),
      `I 輸出列出全部 6 行 ✗、並寫明 6 行（列出的是第 ${printed.join('、') || '無'} 項）`, r.out.slice(-400));
    const tf = P(`.logs/mutate-out.${closing.seq}.log`);
    const kept = fs.existsSync(tf) ? six.filter((i) => fs.readFileSync(tf, 'utf8').includes(`✗ 第 ${i} 項紅了`)) : [];
    yes(kept.length === 6, `I 全文存進 .logs/mutate-out.${closing.seq}.log、6 項都在（在的是第 ${kept.join('、') || '無'} 項）`);
  }
}

console.log('\n— E 正常跑完（反向） —');
if (want('E')) {
  pre(reset(), '前置：clone 在起點');
  const r = run(LIST, '會紅的');
  const L = ledger();
  yes(/檢查 2\/2 條突變，0 條只改空白或行尾/.test(r.out), 'E 登記檢查：檢查的筆數＝清單的 2 條、0 條被拒（原樣的全部通過）', r.out.slice(-300));
  const base = L.find((e) => e.event === 'baseline');
  const st = L.find((e) => e.event === 'started' && e.name === '會紅的');
  const dn = st && L.find((e) => e.seq === st.seq && e.event === 'done');
  yes(r.code === 0 && marks().join(',') === 'orig,broken' && sha1(P('zz-target.txt')) === ORIG && !fs.existsSync(PENDING)
    && base && base.outcome === 'ok' && base.items === 1 && !('result' in base) && !('name' in base)
    && dn && dn.result === 'red' && dn.kind === 'red' && dn.items === 1 && dn.pop === 1 && dn.base === base.seq && base.seq < st.seq,
  `E 正常跑完：探針先原樣、再改壞版各一次，目標檔＝原檔、沒有還原紀錄；帳本先記原樣（母體 1、不帶 result／name），再記開跑與完成（紅、1/1 項、指回那一次原樣）（實得 ${r.code}）`, r.out.slice(-300));
  yes(/^原樣｜node scripts\/zz-check\.mjs：正常結束、結束碼 0、母體 1 項/m.test(r.out) && /^✓ 紅了｜會紅的（結束碼 1；跑滿 1\/1 項/m.test(r.out),
    'E 輸出：原樣那一行寫明母體 1 項；紅了那一行行首「✓ 紅了｜」、寫明跑滿 1/1 項', r.out.slice(-300));
}

// ---- 2026-11-11：四種結束方式、原樣不成立 ----
// 每一種：回傳值、行首字樣、帳本的 kind（或沒有開跑）三樣都要對；目標檔都要回到原樣。
const lastDone = (name) => ledger().filter((e) => e.name === name && e.event === 'done').pop();
const mut = (name, cmd, extra = {}) => ({ name, file: 'zz-target.txt', find: 'alpha', replace: 'BROKEN', cmd, ...extra });
const runOne = (m) => {
  const f = P('.logs/zz-muts-n.json');
  fs.writeFileSync(f, JSON.stringify([m]));
  pre(JSON.parse(fs.readFileSync(f, 'utf8'))[0].cmd === m.cmd, `前置：${m.name} 讀回確認清單寫進去了`);
  return run(f, m.name);
};

console.log('\n— N 突變那一次的結束方式 —');
if (want('N')) {
  {
    pre(reset(), '前置：clone 在起點');
    const r = runOne({ ...mut('沒紅的', 'node scripts/zz-check.mjs'), replace: 'alphaZ' });   // 沒有 BROKEN：探針照樣綠
    const d = lastDone('沒紅的');
    yes(r.code === 1 && /^✗ 沒紅｜沒紅的：跑滿 1\/1 項、結束碼 0——照樣全綠$/m.test(r.out) && d && d.result === 'not-red' && d.kind === 'not-red' && sha1(P('zz-target.txt')) === ORIG,
      `N1 正常結束·沒紅 → 回 1、行首「✗ 沒紅｜」、帳本 not-red（實得 ${r.code}／${d ? d.kind : '沒有那一筆'}）`, r.out.slice(-300));
  }
  {
    pre(reset(), '前置：clone 在起點');
    const r = runOne(mut('丟例外的', 'node scripts/zz-throw.mjs'));
    const d = lastDone('丟例外的');
    // 前置只要求「改壞版真的跑了」；原樣有沒有先跑由 E、N6 驗（綁在這裡的話，修之前的執行器會被判成情境未成立、證明不了修之前會紅）
    if (pre(marks().includes('throw-broken'), `前置：N2 探針跑到改壞版（${marks().join(',')}）`)) {
      yes(r.code === 7 && /^⊘ 崩潰｜丟例外的：沒有最後那一行總結（結束碼 1/m.test(r.out) && d && d.result === 'no-result' && d.kind === 'crash' && d.items === 1 && d.pop === 3,
        `N2 崩潰（丟例外沒接住）→ 回 7、行首「⊘ 崩潰｜」、帳本 no-result／crash、1/3 項（實得 ${r.code}／${d ? `${d.kind} ${d.items}/${d.pop}` : '沒有那一筆'}）`, r.out.slice(-300));
    }
  }
  {
    pre(reset(), '前置：clone 在起點');
    const r = runOne(mut('沒跑完的', 'node scripts/zz-short.mjs'));
    const d = lastDone('沒跑完的');
    if (pre(marks().includes('short-broken'), `前置：N3 探針跑到改壞版（${marks().join(',')}）`)) {
      yes(r.code === 9 && /^⊘ 沒跑完｜沒跑完的：只跑了 2\/3 項（結束碼 1）——沒有結果/m.test(r.out) && !/^✓ 紅了｜沒跑完的/m.test(r.out)
        && d && d.result === 'no-result' && d.kind === 'short' && d.items === 2 && d.pop === 3 && sha1(P('zz-target.txt')) === ORIG,
      `N3 有總結行、結束碼 1，但只跑了 2/3 項 → 回 9、行首「⊘ 沒跑完｜」、帳本 no-result／short，不是紅（實得 ${r.code}／${d ? `${d.result} ${d.kind} ${d.items}/${d.pop}` : '沒有那一筆'}）`, r.out.slice(-300));
    }
  }
  {
    pre(reset(), '前置：clone 在起點');
    const r = runOne(mut('沒跑完又印例外的', 'node scripts/zz-shortx.mjs'));
    const d = lastDone('沒跑完又印例外的');
    const raw = fs.existsSync(P(`.logs/mutate-out.${d ? d.seq : 0}.log`)) ? fs.readFileSync(P(`.logs/mutate-out.${d.seq}.log`), 'utf8').split(/\r?\n/).filter((l) => /^[✓✗]/.test(l)).length : -1;
    if (pre(raw === 3, `前置：N4 子程序照字面有 3 行行首 ✓／✗（＝母體，不排除「✗ 例外」就會湊回去；實得 ${raw}）`)) {
      yes(r.code === 9 && /^⊘ 沒跑完｜沒跑完又印例外的：只跑了 2\/3 項/m.test(r.out) && d && d.kind === 'short' && d.items === 2,
        `N4「✗ 例外」不算項目 → 只跑 2/3 項、回 9（實得 ${r.code}／${d ? `${d.kind} ${d.items}` : '沒有那一筆'}）`, r.out.slice(-300));
    }
  }
  {
    pre(reset(), '前置：clone 在起點');
    const r = runOne(mut('對照組沒過的', 'node scripts/zz-ctlfail.mjs'));
    const d = lastDone('對照組沒過的');
    const raw = fs.existsSync(P(`.logs/mutate-out.${d ? d.seq : 0}.log`)) ? fs.readFileSync(P(`.logs/mutate-out.${d.seq}.log`), 'utf8').split(/\r?\n/).filter((l) => /^[✓✗]/.test(l)).length : -1;
    if (pre(raw === 4, `前置：N7 子程序照字面有 4 行行首 ✓／✗（3 項＋1 行結論；實得 ${raw}）`)) {
      yes(r.code === 0 && /^✓ 紅了｜對照組沒過的（結束碼 1；跑滿 3\/3 項/m.test(r.out) && d && d.result === 'red' && d.kind === 'red' && d.items === 3 && d.pop === 3,
        `N7「✗ 對照組沒過——」不算項目 → 跑滿 3/3 項、記成紅、回 0（實得 ${r.code}／${d ? `${d.kind} ${d.items}/${d.pop}` : '沒有那一筆'}）`, r.out.slice(-300));
    }
  }
  {
    pre(reset(), '前置：clone 在起點');
    const r = runOne(mut('多印一行的', 'node scripts/zz-extra.mjs'));
    const d = lastDone('多印一行的');
    yes(r.code === 9 && /^⊘ 項數不符｜多印一行的：跑了 4 項、原樣是 3 項/m.test(r.out) && d && d.result === 'no-result' && d.kind === 'extra' && d.items === 4 && d.pop === 3,
      `N5 項數比母體多 → 回 9、行首「⊘ 項數不符｜」、帳本 no-result／extra（實得 ${r.code}／${d ? `${d.kind} ${d.items}/${d.pop}` : '沒有那一筆'}）`, r.out.slice(-300));
  }
  {
    // 混在一起：會紅的＋沒紅的（同一個 cmd，原樣只跑一次）＋沒跑完的
    pre(reset(), '前置：clone 在起點');
    const f = P('.logs/zz-muts-mix.json');
    fs.writeFileSync(f, JSON.stringify([mut('會紅的', 'node scripts/zz-check.mjs'), { ...mut('沒紅的', 'node scripts/zz-check.mjs'), replace: 'alphaZ' }, mut('沒跑完的', 'node scripts/zz-short.mjs')]));
    const r = run(f);
    const L = ledger();
    const baseCmds = L.filter((e) => e.event === 'baseline').map((e) => e.cmd);
    yes(r.code === 1 && /^結果：紅 1、沒紅 1、崩潰 0、逾時 0、沒跑完 1、項數不符 0、沒套上 0、沒跑（原樣不成立）0——相加 3、選到 3 條；真的跑了 3 條、帳本收尾 3 筆$/m.test(r.out),
      `N6 混在一起 → 回 1（沒紅先講）、最後一行各類各幾條、相加 3＝選到 3＝帳本收尾 3（實得 ${r.code}）`, r.out.slice(-500));
    yes(baseCmds.length === 2 && baseCmds.filter((c) => c === 'node scripts/zz-check.mjs').length === 1 && marks().filter((x) => x === 'orig').length === 2,
      `N6 同一個 cmd 的原樣只跑一次（帳本原樣 ${baseCmds.length} 筆：${baseCmds.join('、')}；zz-check 看到原樣 ${marks().filter((x) => x === 'orig').length} 次＝原樣 1＋沒紅的那條 1）`);
  }
}

console.log('\n— O 原樣不成立：突變一條都不跑 —');
if (want('O')) {
  const cases = [
    ['O1', '原樣不是綠的', 'zz-redorig', /原樣不是綠的（結束碼 1）/, 'not-green', {}],
    ['O2', '原樣崩潰', 'zz-crashorig', /原樣崩潰（沒有最後那一行總結）/, 'crash', {}],
    ['O3', '原樣逾時', 'zz-sleeporig', /原樣逾時被殺（2\.5 秒）/, 'timeout', { timeoutMs: 2500 }],
    ['O4', '原樣一項都數不到', 'zz-zero', /原樣一項都數不到/, 'zero', {}],
  ];
  for (const [id, what, probe, re, outcome, extra] of cases) {
    pre(reset(), `前置：${id} clone 在起點`);
    const t0 = Date.now();
    const r = runOne(mut(what, `node scripts/${probe}.mjs`, extra));
    const sec = (Date.now() - t0) / 1000;
    const L = ledger();
    const b = L.find((e) => e.event === 'baseline');
    const tag = probe.replace('zz-', '');
    yes(r.code === 3 && new RegExp(`^⊘ 原樣不成立｜node scripts/${probe}\\.mjs：${re.source}`, 'm').test(r.out) && new RegExp(`^⊘ 沒跑｜${what}：原樣不成立`, 'm').test(r.out)
      && b && b.outcome === outcome && !L.some((e) => e.event === 'started') && marks().join(',') === `${tag}-orig` && sha1(P('zz-target.txt')) === ORIG && sec < 60,
    `${id} ${what} → 回 3、行首「⊘ 原樣不成立｜」與「⊘ 沒跑｜」、帳本原樣 ${outcome}、沒有開跑、探針只跑了原樣、目標檔沒被改（實得 ${r.code}／${b ? b.outcome : '沒有原樣那一筆'}／標記 ${marks().join(',')}／${sec.toFixed(1)} 秒）`, r.out.slice(-400));
    if (id === 'O3') {
      const pidF = P('.logs/zz-sleeporig.pid');
      const pid = fs.existsSync(pidF) ? Number(fs.readFileSync(pidF, 'utf8')) : 0;
      await sleep(500);
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
      if (pre(pid > 0, `前置：O3 卡住的原樣真的跑起來了（pid ${pid}）`)) yes(!alive, `O3 原樣逾時時整棵被殺掉（pid ${pid}＝${alive ? '還在' : '不在'}）`);
    }
  }
}

fs.rmSync(CLONE, { recursive: true, force: true });
yes(!fs.existsSync(CLONE), '暫存 clone 已刪');
const mainTouched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(mainTouched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(mainTouched));
if (unformed.length) {
  console.log(`\n⊘ 情境未成立 ${unformed.length} 項——這幾項這次什麼都沒量到，不是通過也不是紅：${unformed.join('；')}`);
  if (!process.exitCode) process.exitCode = 3;
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 3 ? '，有情境未成立' : '') + (ONLY.length ? `（只跑 ${ONLY.join('、')}）` : ''));
