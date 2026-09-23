// 推送閘的測試（npm run pushgatetest）。涵蓋的程式：scripts/safe-push.sh 與 scripts/prepush-scan.mjs 。
//
// 用本機 bare repo 當遠端，完全不碰 GitHub。每一種情況都比對三樣：回傳值、**擋下的是哪一關、哪一類**
// （只看回傳值的驗法本身就是假斷言——StockDiary 2026-09-23：它的一種情境回了失敗，但擋下的是別的關卡）、
// 遠端的 main 有沒有被動到。
//   A 乾淨 → 0、推出去
//   B 新增行帶一個合成的假信箱 → 1、email 那一類擋的、沒推
//   B2 兩個 commit、只有前一個帶假信箱 → 1（自查掃遠端還沒有的**每一個** commit，不是只看 HEAD）
//   C 檢查器壞了（讀不到使用者名稱）→ 4、user 那一類、沒推
//   C2 檢查器壞了（email 的搜尋式壞掉、對照組沒命中）→ 4、email 那一類、沒推
//   F 本機以為已經推上去、遠端其實沒有（帶命中的 commit 繞過閘門推上去、抓回來，再把遠端倒退）→ 1、email 那一類
//     （共用慣例 v8 §2.5：自查範圍要照遠端的實際狀態算；把「問遠端」換成讀本機追蹤分支時，只有這一種會報不符）
//   D 遠端拒收（pre-receive hook 回 1）→ 2、push 那一關
//   E 推了卻沒更新（post-receive hook 把 main 退回舊值）→ 3、比對遠端那一關
//   G 抓不到遠端（origin 指到不存在的地方）→ 4、「抓不到遠端」
// 比對「是誰擋的」的樣式本身也先用已知的輸出驗過（§5.11 第二層）；印出實際執行的那份閘門的雜湊（第三層：
// 突變時拿它確認跑到的真的是改壞的那一版）。
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.log('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-pushgate-'));
const bare = path.join(base, 'remote.git');
const work = path.join(base, 'work');
const sh = (cmd, cwd = work, env = {}) => execSync(cmd, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const gate = (env = {}) => {
  const r = spawnSync('bash', ['scripts/safe-push.sh'], { cwd: work, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const remoteHead = () => sh('git rev-parse main', bare).trim();
const localHead = () => sh('git rev-parse HEAD').trim();
const commit = (file, text, msg) => { fs.writeFileSync(path.join(work, file), text); sh(`git add ${file}`); sh(`git commit -q -m ${msg}`); };
const fakeMail = () => ['zz', 'fake'].join('.') + '@' + 'example-test' + '.org';   // 當場組的合成假信箱（不寫進任何檔）
const hook = (name, body) => { const p = path.join(bare, 'hooks', name); fs.writeFileSync(p, '#!/bin/sh\n' + body + '\n'); fs.chmodSync(p, 0o755); return p; };

// 比對「是誰擋的」用的樣式（§5.11 第二層：擷取程式本身也要有對照組）
const WHO = {
  hit: /擋下：有命中（email/,
  broken: (k) => new RegExp(`擋下：檢查器壞了（${k}`),
  unreachable: /擋下：檢查器壞了（抓不到遠端）/,
  pushFail: /git push 失敗/,
  mismatch: /不等於本機/,
};

try {
  {
    const SAMPLE = {
      hit: 'email：對照組命中=true，新增行命中=1\n擋下：有命中（email（1 行））\n✗ 公開前自查有命中——不推',
      broken: 'email：對照組命中=false，新增行命中=0\n擋下：檢查器壞了（email）\n✗ 公開前自查的檢查器壞了——不推',
      unreachable: 'fatal: bad\n✗ 抓不到遠端，無法決定要檢查哪些 commit\n擋下：檢查器壞了（抓不到遠端）',
      push: 'error: failed to push some refs\n✗ git push 失敗——停',
      mismatch: '✗ 推完了但遠端（a）不等於本機（b）——停',
    };
    yes(WHO.hit.test(SAMPLE.hit) && !WHO.hit.test(SAMPLE.broken) && !WHO.hit.test(SAMPLE.unreachable),
      '對照（擷取樣式）：「命中」只抓得到命中那一句，不會把檢查器壞了誤認成命中');
    yes(WHO.broken('email').test(SAMPLE.broken) && !WHO.broken('email').test(SAMPLE.hit) && !WHO.broken('user').test(SAMPLE.broken),
      '對照（擷取樣式）：「檢查器壞了」抓得到、而且分得出是哪一類');
    yes(WHO.unreachable.test(SAMPLE.unreachable) && !WHO.unreachable.test(SAMPLE.broken),
      '對照（擷取樣式）：「抓不到遠端」跟一般的檢查器壞了分得開');
    yes(WHO.pushFail.test(SAMPLE.push) && !WHO.pushFail.test(SAMPLE.mismatch) && WHO.mismatch.test(SAMPLE.mismatch) && !WHO.mismatch.test(SAMPLE.push),
      '對照（擷取樣式）：「推送失敗」與「遠端不等於本機」分得開');
  }

  sh(`git init -q --bare "${bare}"`, base);
  sh(`git init -q -b main "${work}"`, base);
  sh('git config user.email t@users.noreply.github.com');
  sh('git config user.name t');
  sh('git config core.autocrlf false');
  fs.mkdirSync(path.join(work, 'scripts'));
  for (const f of ['safe-push.sh', 'prepush-scan.mjs']) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(work, 'scripts', f));
  commit('a.txt', 'base\n', 'base');
  sh(`git remote add origin "${bare}"`);
  sh('git push -q origin main');
  yes(remoteHead() === localHead(), '前置：暫時的遠端（本機 bare repo）已有 base');
  // 第三層：實際執行的是哪一份閘門（突變時拿這一行跟改壞的那一份比）
  console.log('  執行的閘門：safe-push.sh ' + sh('git hash-object scripts/safe-push.sh').trim().slice(0, 12)
    + '、prepush-scan.mjs ' + sh('git hash-object scripts/prepush-scan.mjs').trim().slice(0, 12));

  // A 乾淨
  commit('c.txt', 'clean\n', 'clean');
  let r = gate();
  yes(r.code === 0 && /已推送/.test(r.out) && remoteHead() === localHead(), 'A 乾淨 → 回 0、已推送、遠端＝本機', r.out.slice(-300));

  // B 命中
  let before = remoteHead();
  commit('b.txt', `contact: ${fakeMail()}\n`, 'leak');
  r = gate();
  yes(r.code === 1, `B 新增行帶合成假信箱 → 回 1（實得 ${r.code}）`, r.out.slice(-300));
  yes(WHO.hit.test(r.out) && !WHO.broken('').test(r.out), 'B 擋下的是自查的 email 那一類（不是別關、也不是檢查器壞了）', r.out.slice(-300));
  yes(remoteHead() === before, 'B 遠端沒被動到');
  sh('git reset -q --hard HEAD~1');

  // B2 兩個 commit、只有前一個有問題
  commit('b.txt', `contact: ${fakeMail()}\n`, 'leak');
  commit('b.txt', 'cleaned\n', 'cleanup');
  r = gate();
  yes(r.code === 1 && WHO.hit.test(r.out), 'B2 兩個 commit、只有前一個帶假信箱 → 仍被 email 那一類擋下（掃的是每一個 commit，不是只看 HEAD）', r.out.slice(-300));
  yes(remoteHead() === before, 'B2 遠端沒被動到');
  sh('git reset -q --hard HEAD~2');

  // C 檢查器壞了
  commit('d.txt', 'clean2\n', 'clean2');
  r = gate({ USERNAME: '', USER: '' });
  yes(r.code === 4, `C 讀不到使用者名稱（檢查器壞了）→ 回 4（實得 ${r.code}）`, r.out.slice(-300));
  yes(WHO.broken('user').test(r.out) && !WHO.hit.test(r.out), 'C 擋下的是「檢查器壞了」的 user 那一類（不是命中）', r.out.slice(-300));
  yes(remoteHead() === before, 'C 遠端沒被動到');

  // C2 某一類的搜尋式壞了（對照組沒命中）
  r = gate({ PREPUSH_SELFTEST_BREAK: 'email' });
  yes(r.code === 4 && WHO.broken('email').test(r.out) && /email：對照組命中=false/.test(r.out),
    `C2 email 的搜尋式壞了（對照組沒命中）→ 回 4、寫明是 email 那一類（實得 ${r.code}）`, r.out.slice(-300));
  yes(remoteHead() === before, 'C2 遠端沒被動到');

  // F 本機以為已經推上去、遠端其實沒有：帶命中的 commit 繞過閘門推上去（本機追蹤分支跟著前進），
  // 遠端再倒退回 before；之後疊一個乾淨的 commit 走閘門。範圍照遠端的實際狀態算，才掃得到那個命中。
  commit('f.txt', `contact: ${fakeMail()}\n`, 'leak-bypassed');
  const leaked = localHead();
  sh('git push -q origin main');
  sh(`git --git-dir="${bare}" update-ref refs/heads/main ${before}`);
  commit('f2.txt', 'clean3\n', 'clean3');
  yes(sh('git rev-parse origin/main').trim() === leaked && remoteHead() === before,
    'F 前置：本機的追蹤分支停在帶命中的那個 commit，遠端實際上沒有它（情境成立）');
  r = gate();
  yes(r.code === 1 && WHO.hit.test(r.out) && !WHO.broken('').test(r.out),
    `F 本機以為已推、遠端其實沒有 → 回 1、擋在自查的 email 那一類（實得 ${r.code}）`, r.out.slice(-300));
  yes(remoteHead() === before, 'F 遠端沒被動到');
  // 收尾：閘門壞了時遠端會被推前；拉回原位，後面的情境才不會跟著紅（突變時只該紅 F）
  sh(`git --git-dir="${bare}" update-ref refs/heads/main ${before}`);
  sh('git reset -q --hard HEAD~2');
  sh('git fetch -q origin');

  // D 遠端拒收
  const pre = hook('pre-receive', 'echo "拒收（測試）" >&2; exit 1');
  r = gate();
  yes(r.code === 2 && WHO.pushFail.test(r.out) && /通過/.test(r.out), `D 遠端拒收 → 回 2、擋在 push 那一關（自查已通過）（實得 ${r.code}）`, r.out.slice(-300));
  yes(remoteHead() === before, 'D 遠端沒被動到');
  fs.unlinkSync(pre);

  // E 推了卻沒更新
  hook('post-receive', 'while read old new ref; do git update-ref "$ref" "$old"; done');
  r = gate();
  yes(r.code === 3 && WHO.mismatch.test(r.out), `E 推了卻沒更新 → 回 3、擋在比對遠端那一關（實得 ${r.code}）`, r.out.slice(-300));
  yes(remoteHead() === before, 'E 前置：遠端 main 確實被 hook 退回舊值（情境成立）');

  // G 抓不到遠端
  sh(`git remote set-url origin "${path.join(base, 'nowhere.git')}"`);
  r = gate();
  yes(r.code === 4 && WHO.unreachable.test(r.out), `G 抓不到遠端 → 回 4、寫明「抓不到遠端」（實得 ${r.code}）`, r.out.slice(-300));
  yes(remoteHead() === before, 'G 遠端沒被動到');

  console.log('\n推送閘測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
