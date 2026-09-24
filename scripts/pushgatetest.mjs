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
//   I 取訊息與作者欄的指令輸出是空的（模擬換環境後解析壞掉）→ 4、「訊息與作者欄」壞了、沒推（故障時不放行）
//   K 3 個 commit 只解出 1 筆訊息與作者欄（部分失效）→ 4、「筆數」那一條
//   K2 筆數對、訊息都遺失 → 4、「訊息」那一條
//   L 新增行抽多了（同一行重複計入）→ 4、「新增行抽取」（numstat 核對是 !==，不是 <）
//   J 內容本身以 ++ 開頭的命中行、加了又刪 → 1、來源是新增行（抽新增行要照 diff 結構，並用 --numstat 的行數核對）
//   H 假信箱只寫在 commit 訊息裡 → 1、email 那一類、來源是 commit 訊息（v8 §2.5：訊息一樣會公開）
//   H2 作者信箱是假信箱 → 1、email 那一類、來源是作者欄
//   F 本機以為已經推上去、遠端其實沒有（帶命中的 commit 繞過閘門推上去、抓回來，再把遠端倒退）→ 1、email 那一類
//     （共用慣例 v8 §2.5：自查範圍要照遠端的實際狀態算；把「問遠端」換成讀本機追蹤分支時，只有這一種會報不符）
//   D 遠端拒收（pre-receive hook 回 1）→ 2、push 那一關
//   E 推了卻沒更新（post-receive hook 把 main 退回舊值）→ 3、比對遠端那一關
//   G 抓不到遠端（origin 指到不存在的地方）→ 4、「抓不到遠端」
//   N 只刪不增的推送 → 0、推出去（「對不上就停」的檢查也要有正常情況放行的樣本，v9 §5.14）
//   M／M2／M3／M5 四支閘門檔各自在工作區改過（沒 commit；推送時執行的就是這一份）、驗法還沒重跑 → 5、點名那一支、自查都還沒開始
//   M0 沒有登記檔 → 5
//   M4 改過的 safe-push.sh 已經 commit、工作區又改回登記時的樣子 → 5（比的是 HEAD 裡要推的那一份，不是工作區；F9）
//   P1 動到 build-places.mjs、沒有 F8 登記 → 6、點名沒有登記檔、自查還沒開始
//   P2 動到 build-places.mjs、F8 登記整組相符 → 0、推出去
//   P3 F8 登記相符之後，又改了 importshots.mjs 並 commit → 6、點名 importshots（不是另外兩支）
//   P4 沒動到 F8 那幾支、也沒有 F8 登記 → 0、推出去（沒動到就不看這一關，§5.14 正常情況要放行）
//   P5 動到 f8verify.mjs 的是較早的 commit、最新的 commit 很乾淨 → 6（範圍裡每一個 commit 都算）
//   P6 比照 M4：改過的 build-places.mjs 已 commit、工作區又改回登記時的樣子 → 6（F8 那一關也比 HEAD）
//   V1–V4 登記前的檢查（verified-reg.mjs）：乾淨 → 可登記；工作區有沒 commit 的改動、還沒 commit、工作區沒有 → 不登記、
//     點名那一支、舊的登記一起刪掉
// 每個情境開始前 reset() 回到同一個起點；PUSHGATE_ORDER=reverse 或 shuffle:<種子> 換順序跑，結果要不變。
// 全部通過（而且是預設順序）才把四支閘門檔 HEAD 裡的雜湊寫進 .logs/pushgate.verified（不進版控）——safe-push.sh 推送前拿它比對；
// 有任何失敗就刪掉它。登記前先確認這四支的工作區跟 HEAD 一模一樣，有改動就不登記（F9：驗到的要是推出去的那一份）。
// 比對「是誰擋的」的樣式本身也先用已知的輸出驗過（§5.11 第二層）；印出實際執行的那份閘門的雜湊（第三層：
// 突變時拿它確認跑到的真的是改壞的那一版）。
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headProblems, writeReg, dropReg } from './verified-reg.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REG_REAL = path.join(ROOT, '.logs', 'pushgate.verified');   // 真的 repo 的登記（不進版控）
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
// 只看錯誤訊息的位置（補充說明四第 1 點）：整份輸出裡「出現過」不等於「是理由」——正常輸出的某一行也可能剛好含有同一段字
const R = (out) => out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('擋下：') || l.startsWith('✗')).join('\n');
const WHO = {
  // 名字要對到完整的一項（前面是「（」或「、」、後面是「）」「、」「：」「（」），不能只是前綴——
  // 補充說明四：MealMate 的 r-foo 被 r-foo-veg 湊到；這裡則是 email 不能被 emailx 湊到
  hit: /^擋下：有命中（email（/m,
  // 命中的來源（新增行／commit 訊息／作者欄）；來源清單在「來源：」到第一個全形右括號之間，用頓號分開
  hitFrom: (src) => new RegExp(`^擋下：有命中（email（\\d+ 行；來源：(?:[^）、]*、)*${src}(?=[）、])`, 'm'),
  broken: (k) => new RegExp(`^擋下：檢查器壞了（(?:[^）、]*、)*${k}(?=[）、：（])`, 'm'),
  anyBroken: /^擋下：檢查器壞了（/m,
  // 訊息與作者欄壞了的是哪一條（範圍／筆數／訊息）；清單在冒號到第一個全形右括號之間，用頓號分開
  metaFault: (k) => new RegExp(`^擋下：檢查器壞了（訊息與作者欄：(?:[^）、]*、)*${k}(?=[）、])`, 'm'),
  unreachable: /^擋下：檢查器壞了（抓不到遠端）/m,
  pushFail: /^✗ git push 失敗/m,
  mismatch: /^✗ 推完了但遠端.*不等於本機/m,
  unverified: /^擋下：閘門沒有驗過（/m,
  f8: /^擋下：F8 驗法沒有驗過（/m,
  f8File: (f) => new RegExp(`^擋下：F8 驗法沒有驗過（scripts/${f.replace(/\./g, '\\.')} 改過`, 'm'),
};

try {
  {
    const SAMPLE = {
      hit: 'email：對照組命中=true，命中=1\n擋下：有命中（email（1 行；來源：新增行））\n✗ 公開前自查有命中——不推',
      hitMsg: 'email：對照組命中=true，命中=1\n擋下：有命中（email（1 行；來源：commit 訊息））\n✗ 公開前自查有命中——不推',
      hitMix: '擋下：有命中（email（2 行；來源：新增行、作者欄））、path（1 行；來源：commit 訊息））',
      broken: 'email：對照組命中=false，新增行命中=0\n擋下：檢查器壞了（email）\n✗ 公開前自查的檢查器壞了——不推',
      metaBroken: '範圍： x..HEAD ；commit 數： 1 ；新增行數： 1 ；commit 訊息行數： 0 ；作者欄： 0\n✗ 範圍內有 1 個 commit，解析出 0 筆…——解析壞了\n擋下：檢查器壞了（訊息與作者欄：筆數、訊息）',
      metaCount: '✗ 範圍內有 3 個 commit，解析出 1 筆…——解析壞了\n擋下：檢查器壞了（訊息與作者欄：筆數）',
      metaMsg: '✗ 範圍內有 3 個 commit，解析出 3 筆…——解析壞了\n擋下：檢查器壞了（訊息與作者欄：訊息）',
      extractBroken: '✗ 抽出 0 行新增行，git 算 1 行——抽取壞了\n擋下：檢查器壞了（新增行抽取）',
      unreachable: 'fatal: bad\n✗ 抓不到遠端，無法決定要檢查哪些 commit\n擋下：檢查器壞了（抓不到遠端）',
      push: 'error: failed to push some refs\n✗ git push 失敗——停',
      mismatch: '✗ 推完了但遠端（a）不等於本機（b）——停',
      unverified: '✗ scripts/safe-push.sh 改過了（登記 a、現在 b）\n擋下：閘門沒有驗過（scripts/safe-push.sh 改過、驗法還沒重跑）',
      f8: '✗ scripts/importshots.mjs 跟 .logs/f8.verified 登記的不一樣（登記 a、HEAD 裡是 b）\n擋下：F8 驗法沒有驗過（scripts/importshots.mjs 改過、驗法還沒重跑）',
    };
    {
      const NOISE = ['email：對照組命中=true，命中=0',
        '說明：遇到 擋下：有命中（email（1 行；來源：新增行）） 這種情況不會推',
        '說明：擋下：檢查器壞了（email） 表示對照組沒命中；擋下：閘門沒有驗過（ 表示驗法沒重跑；擋下：F8 驗法沒有驗過（scripts/importshots.mjs 改過 也是',
        '提醒：✗ git push 失敗 或 ✗ 推完了但遠端（a）不等於本機 時會停', '通過', '✓ 已推送，遠端 main ＝ 本機 HEAD（abc）',
        // 錯誤訊息那一行（R() 會留下），但那些字只在附註裡、不在行首——樣式沒鎖行首就會誤判
        '✗ 另一件事失敗（附註：擋下：有命中（email（1 行；來源：新增行））、擋下：檢查器壞了（email）、擋下：閘門沒有驗過（、✗ git push 失敗、✗ 推完了但遠端（a）不等於本機、擋下：F8 驗法沒有驗過（scripts/importshots.mjs 改過 都是別的情況）'].join('\n');
      const pats = { hit: WHO.hit, hitFrom: WHO.hitFrom('新增行'), broken: WHO.broken('email'), unverified: WHO.unverified, pushFail: WHO.pushFail, mismatch: WHO.mismatch,
        f8: WHO.f8, f8File: WHO.f8File('importshots.mjs') };
      const wrong = Object.entries(pats).filter(([, re]) => re.test(R(NOISE))).map(([k]) => k);
      yes(wrong.length === 0, `對照（位置）：那句話只出現在正常行時，${Object.keys(pats).length} 種樣式都判「不是理由」`, '誤判的：' + wrong.join('、'));
      const inErr = [SAMPLE.hit, SAMPLE.broken, SAMPLE.unverified, SAMPLE.push, SAMPLE.mismatch, SAMPLE.f8].join('\n');
      const missed = Object.entries(pats).filter(([, re]) => !re.test(R(inErr))).map(([k]) => k);
      yes(missed.length === 0, `對照（位置）：同一句話出現在錯誤訊息那一行時，${Object.keys(pats).length} 種樣式都判「是理由」`, '沒抓到的：' + missed.join('、'));
    }
    yes(WHO.unverified.test(R(SAMPLE.unverified)) && !WHO.unverified.test(R(SAMPLE.broken)) && !WHO.unverified.test(R(SAMPLE.hit)),
      '對照（擷取樣式）：「閘門沒有驗過」抓得到、跟檢查器壞了與命中分得開');
    yes(WHO.f8.test(R(SAMPLE.f8)) && !WHO.f8.test(R(SAMPLE.unverified)) && !WHO.unverified.test(R(SAMPLE.f8))
      && WHO.f8File('importshots.mjs').test(R(SAMPLE.f8)) && !WHO.f8File('build-places.mjs').test(R(SAMPLE.f8))
      && !WHO.f8File('importshots.mjs').test('擋下：F8 驗法沒有驗過（scripts/importshotsXmjs 改過'),
      '對照（擷取樣式）：「F8 驗法沒有驗過」跟「閘門沒有驗過」分得開、分得出是哪一支（點不會被當成任意字元）');
    yes(WHO.hit.test(R(SAMPLE.hit)) && !WHO.hit.test(R(SAMPLE.broken)) && !WHO.hit.test(R(SAMPLE.unreachable)),
      '對照（擷取樣式）：「命中」只抓得到命中那一句，不會把檢查器壞了誤認成命中');
    yes(WHO.broken('email').test(R(SAMPLE.broken)) && !WHO.broken('email').test(R(SAMPLE.hit)) && !WHO.broken('user').test(R(SAMPLE.broken)),
      '對照（擷取樣式）：「檢查器壞了」抓得到、而且分得出是哪一類');
    yes(WHO.unreachable.test(R(SAMPLE.unreachable)) && !WHO.unreachable.test(R(SAMPLE.broken)),
      '對照（擷取樣式）：「抓不到遠端」跟一般的檢查器壞了分得開');
    yes(WHO.broken('訊息與作者欄').test(R(SAMPLE.metaBroken)) && !WHO.broken('訊息與作者欄').test(R(SAMPLE.broken))
      && !WHO.hit.test(R(SAMPLE.metaBroken)),
      '對照（擷取樣式）：「訊息與作者欄解析壞了」抓得到、跟別類的檢查器壞了分得開');
    yes(WHO.metaFault('筆數').test(R(SAMPLE.metaCount)) && !WHO.metaFault('訊息').test(R(SAMPLE.metaCount))
      && WHO.metaFault('訊息').test(R(SAMPLE.metaMsg)) && !WHO.metaFault('筆數').test(R(SAMPLE.metaMsg))
      && WHO.metaFault('筆數').test(R(SAMPLE.metaBroken)) && WHO.metaFault('訊息').test(R(SAMPLE.metaBroken))
      && !WHO.metaFault('筆數').test(R(SAMPLE.extractBroken)),
      '對照（擷取樣式）：訊息與作者欄壞的是「筆數」還是「訊息」分得開');
    yes(WHO.broken('新增行抽取').test(R(SAMPLE.extractBroken)) && !WHO.broken('新增行抽取').test(R(SAMPLE.metaBroken))
      && !WHO.hit.test(R(SAMPLE.extractBroken)),
      '對照（擷取樣式）：「新增行抽取壞了」抓得到、跟別類的檢查器壞了分得開');
    {
      // 邊界的對照組（兩個方向）：多一個字的不能被湊到；清單中間、用頓號隔開的每一項都要認得出來
      const B = {
        brokenX: '擋下：檢查器壞了（emailx）', brokenList: '擋下：檢查器壞了（secret、email、user）',
        fromX: '擋下：有命中（email（1 行；來源：新增行X））', fromList: '擋下：有命中（email（2 行；來源：作者欄、新增行））',
        metaX: '擋下：檢查器壞了（訊息與作者欄：訊息X）', metaList: '擋下：檢查器壞了（訊息與作者欄：範圍、訊息）',
      };
      const notX = !WHO.broken('email').test(B.brokenX) && !WHO.hitFrom('新增行').test(B.fromX) && !WHO.metaFault('訊息').test(B.metaX);
      const list = ['secret', 'email', 'user'].every((k) => WHO.broken(k).test(B.brokenList)) && WHO.hitFrom('新增行').test(B.fromList)
        && WHO.hitFrom('作者欄').test(B.fromList) && WHO.metaFault('訊息').test(B.metaList) && WHO.metaFault('範圍').test(B.metaList);
      yes(notX, '對照（邊界）：emailx、新增行X、訊息X 不會被 email、新增行、訊息湊到');
      yes(list, '對照（邊界）：清單中間用頓號隔開的每一項都認得出來（secret、email、user；作者欄、新增行；範圍、訊息）');
    }
    yes(WHO.pushFail.test(R(SAMPLE.push)) && !WHO.pushFail.test(R(SAMPLE.mismatch)) && WHO.mismatch.test(R(SAMPLE.mismatch)) && !WHO.mismatch.test(R(SAMPLE.push)),
      '對照（擷取樣式）：「推送失敗」與「遠端不等於本機」分得開');
    yes(WHO.hitFrom('commit 訊息').test(R(SAMPLE.hitMsg)) && !WHO.hitFrom('新增行').test(R(SAMPLE.hitMsg))
      && WHO.hitFrom('新增行').test(R(SAMPLE.hit)) && !WHO.hitFrom('commit 訊息').test(R(SAMPLE.hit))
      && WHO.hitFrom('作者欄').test(R(SAMPLE.hitMix)) && !WHO.hitFrom('commit 訊息').test(R(SAMPLE.hitMix)),
      '對照（擷取樣式）：命中的來源分得出新增行、commit 訊息、作者欄（別類的來源不會被算到 email 頭上）');
  }

  // ---------- 共用的起點：假遠端＋本機都有 base（含閘門三支檔與驗過的登記）----------
  const GATE = ['safe-push.sh', 'prepush-scan.mjs', 'pushgatetest.mjs', 'verified-reg.mjs'];
  const F8 = ['build-places.mjs', 'importshots.mjs', 'f8verify.mjs'];   // safe-push.sh 的 F8_GUARD（假遠端裡放替身，內容不重要）
  const regText = (dir) => '# 測試用的登記（pushgatetest 自己造的）\n'
    + GATE.map((f) => `${sh(`git hash-object scripts/${f}`, dir).trim()} scripts/${f}`).join('\n') + '\n';
  sh(`git init -q --bare "${bare}"`, base);
  sh(`git init -q -b main "${work}"`, base);
  sh('git config user.email t@users.noreply.github.com');
  sh('git config user.name t');
  sh('git config core.autocrlf false');
  fs.mkdirSync(path.join(work, 'scripts'));
  for (const f of GATE) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(work, 'scripts', f));
  for (const f of F8) fs.writeFileSync(path.join(work, 'scripts', f), `// ${f} 的替身（pushgatetest）\n`);
  // 登記放在不進版控的 .logs/（跟真的 repo 一樣）；.gitignore 擋掉它，reset() 的 git clean 才不會把它清掉
  fs.writeFileSync(path.join(work, '.gitignore'), '.logs/\n');
  fs.mkdirSync(path.join(work, '.logs'));
  fs.writeFileSync(path.join(work, '.logs', 'pushgate.verified'), regText(work));
  sh('git add scripts .gitignore');
  commit('a.txt', 'base\nline2\nline3\n', 'base');
  sh(`git remote add origin "${bare}"`);
  sh('git push -q origin main');
  const BASE = remoteHead();
  yes(BASE === localHead(), '前置：暫時的遠端（本機 bare repo）已有 base');
  // 第三層：實際執行的是哪一份閘門（突變時拿這一行跟改壞的那一份比）
  console.log('  執行的閘門：safe-push.sh ' + sh('git hash-object scripts/safe-push.sh').trim().slice(0, 12)
    + '、prepush-scan.mjs ' + sh('git hash-object scripts/prepush-scan.mjs').trim().slice(0, 12));

  // 每個情境開始前都回到同一個起點（情境之間互不污染，順序換了結果也不變——共用慣例 v9 §5.11 第四層）
  const reset = () => {
    for (const h of ['pre-receive', 'post-receive']) { const p = path.join(bare, 'hooks', h); if (fs.existsSync(p)) fs.unlinkSync(p); }
    sh(`git remote set-url origin "${bare}"`);
    sh(`git --git-dir="${bare}" update-ref refs/heads/main ${BASE}`);
    sh(`git reset -q --hard ${BASE}`);
    sh('git clean -qfd');
    sh('git fetch -q origin');
    // 登記檔在被 .gitignore 擋掉的 .logs/，git clean 不會動它：每次都寫回起點的樣子（閘門登記相符、沒有 F8 登記）
    fs.writeFileSync(path.join(work, '.logs', 'pushgate.verified'), regText(work));
    if (fs.existsSync(F8REG)) fs.unlinkSync(F8REG);
  };
  // 從每次都會印的「範圍：」那一行抓數字（擋下時才印的那一行，在判斷被拿掉時就不見了）
  const nums = (out) => {
    const l = out.split('\n').find((x) => x.startsWith('範圍：')) || '';
    return {
      commits: Number((l.match(/commit 數： (\d+)/) || [])[1]),
      parsed: Number((l.match(/解析出訊息與作者欄： (\d+) 筆/) || [])[1]),
      msg: Number((l.match(/commit 訊息行數： (\d+)/) || [])[1]),
    };
  };
  const threeCommits = () => {   // K／K2／L 用：3 個 commit，最新那個的訊息有 3 行
    commit('d.txt', 'clean2\n', 'clean2');
    commit('k1.txt', 'clean-k1\n', 'clean-k1');
    fs.writeFileSync(path.join(work, 'k2.txt'), 'clean-k2\n');
    sh('git add k2.txt');
    sh('git commit -q -m k2-a -m k2-b -m k2-c');
  };
  const untouched = (id) => yes(remoteHead() === BASE, `${id} 遠端沒被動到`);
  const F8REG = path.join(work, '.logs', 'f8.verified');
  const f8Reg = () => fs.writeFileSync(F8REG, '# 測試用的 F8 登記\n'
    + F8.map((f) => `${sh(`git rev-parse HEAD:scripts/${f}`).trim()} scripts/${f}`).join('\n') + '\n');
  const touch = (f, id) => { fs.appendFileSync(path.join(work, 'scripts', f), `// ${id} 改一行\n`); sh(`git add scripts/${f}`); sh(`git commit -q -m ${id}-${f.replace('.', '-')}`); };

  const SCENARIOS = [
    ['A', () => {
      commit('c.txt', 'clean\n', 'clean');
      const r = gate();
      yes(r.code === 0 && /^✓ 已推送/m.test(r.out) && remoteHead() === localHead(), 'A 乾淨 → 回 0、已推送、遠端＝本機', r.out.slice(-300));
    }],
    ['N', () => {
      // 只刪不增的推送要放行（共用慣例 v9 §5.14：「對不上就停」的檢查要有一種正常情況放行的樣本）
      fs.writeFileSync(path.join(work, 'a.txt'), 'base\n');
      sh('git commit -q -am remove-only');
      const st = sh('git log --numstat --format= -1').trim().split('\t');
      yes(st[0] === '0' && Number(st[1]) > 0, `N 前置：這個 commit 新增 ${st[0]} 行、刪除 ${st[1]} 行（只刪不增）`);
      const r = gate();
      yes(r.code === 0 && /^✓ 已推送/m.test(r.out) && remoteHead() === localHead(), `N 只刪不增的推送 → 回 0、已推送、遠端＝本機（實得 ${r.code}）`, r.out.slice(-300));
    }],
    ['B', () => {
      commit('b.txt', `contact: ${fakeMail()}\n`, 'leak');
      const r = gate();
      yes(r.code === 1, `B 新增行帶合成假信箱 → 回 1（實得 ${r.code}）`, r.out.slice(-300));
      yes(WHO.hitFrom('新增行').test(R(r.out)) && !WHO.anyBroken.test(R(r.out)), 'B 擋下的是自查的 email 那一類、來源是新增行（不是別關、也不是檢查器壞了）', r.out.slice(-300));
      untouched('B');
    }],
    ['B2', () => {
      commit('b.txt', `contact: ${fakeMail()}\n`, 'leak');
      commit('b.txt', 'cleaned\n', 'cleanup');
      const r = gate();
      yes(r.code === 1 && WHO.hit.test(R(r.out)), 'B2 兩個 commit、只有前一個帶假信箱 → 仍被 email 那一類擋下（掃的是每一個 commit，不是只看 HEAD）', r.out.slice(-300));
      untouched('B2');
    }],
    ['C', () => {
      commit('d.txt', 'clean2\n', 'clean2');
      const r = gate({ USERNAME: '', USER: '' });
      yes(r.code === 4, `C 讀不到使用者名稱（檢查器壞了）→ 回 4（實得 ${r.code}）`, r.out.slice(-300));
      yes(WHO.broken('user').test(R(r.out)) && !WHO.hit.test(R(r.out)), 'C 擋下的是「檢查器壞了」的 user 那一類（不是命中）', r.out.slice(-300));
      untouched('C');
    }],
    ['C2', () => {
      commit('d.txt', 'clean2\n', 'clean2');
      const r = gate({ PREPUSH_SELFTEST_BREAK: 'email' });
      yes(r.code === 4 && WHO.broken('email').test(R(r.out)) && /^email：對照組命中=false/m.test(r.out),
        `C2 email 的搜尋式壞了（對照組沒命中）→ 回 4、寫明是 email 那一類（實得 ${r.code}）`, r.out.slice(-300));
      untouched('C2');
    }],
    ['I', () => {
      // 取訊息與作者欄的指令輸出是空的（模擬換環境後解析壞掉）：要停下，不能印「0 行」就放行
      commit('d.txt', 'clean2\n', 'clean2');
      yes(Number(sh(`git rev-list --count ${BASE}..HEAD`).trim()) > 0, 'I 前置：範圍裡確實有要推的 commit（不然「0 行」可能只是真的沒東西可掃）');
      const r = gate({ PREPUSH_SELFTEST_BREAK: 'meta' });
      yes(r.code === 4 && WHO.broken('訊息與作者欄').test(R(r.out)) && !WHO.hit.test(R(r.out)),
        `I 訊息與作者欄解析出 0 筆 → 回 4、寫明「訊息與作者欄」壞了（實得 ${r.code}）`, r.out.slice(-300));
      untouched('I');
    }],
    ['K', () => {
      threeCommits();
      const r = gate({ PREPUSH_SELFTEST_BREAK: 'metapartial' });
      const n = nums(r.out);
      yes(n.commits >= 2 && n.parsed >= 1 && n.parsed < n.commits && n.msg >= n.commits,
        `K 前置：範圍裡有 ${n.commits} 個 commit、只解出 ${n.parsed} 筆（部分失效、不是全空），訊息行數 ${n.msg} 不少於 commit 數`, r.out.slice(-300));
      yes(r.code === 4 && WHO.metaFault('筆數').test(R(r.out)) && !WHO.metaFault('訊息').test(R(r.out)),
        `K 只解出一部分 → 回 4、擋在「筆數」那一條（實得 ${r.code}）`, r.out.slice(-300));
      untouched('K');
    }],
    ['K2', () => {
      threeCommits();
      const r = gate({ PREPUSH_SELFTEST_BREAK: 'nobody' });
      const n = nums(r.out);
      yes(n.commits >= 1 && n.parsed === n.commits && n.msg === 0,
        `K2 前置：${n.commits} 個 commit 都解析到了、訊息 ${n.msg} 行（只有訊息遺失）`, r.out.slice(-300));
      yes(r.code === 4 && WHO.metaFault('訊息').test(R(r.out)) && !WHO.metaFault('筆數').test(R(r.out)),
        `K2 訊息遺失 → 回 4、擋在「訊息」那一條（實得 ${r.code}）`, r.out.slice(-300));
      untouched('K2');
    }],
    ['L', () => {
      // 抽多了（同一行重複計入）：numstat 核對要用 !==，用 < 會放行
      threeCommits();
      const r = gate({ PREPUSH_SELFTEST_BREAK: 'dupline' });
      const ex = (r.out.match(/新增行核對：抽出 (\d+) 行，git 算 (\d+) 行/) || []).slice(1).map(Number);   // 每次都印的那一行
      yes(ex.length === 2 && ex[0] > ex[1] && ex[1] > 0, `L 前置：抽出的行數（${ex[0]}）確實比 git 算的（${ex[1]}）多`, r.out.slice(-300));
      yes(r.code === 4 && WHO.broken('新增行抽取').test(R(r.out)), `L 抽多了 → 回 4、擋在「新增行抽取」（實得 ${r.code}）`, r.out.slice(-300));
      untouched('L');
    }],
    ['J', () => {
      // 內容本身以 ++ 開頭的命中行，加了又刪（只有逐 commit 掃新增行才抓得到；舊寫法把它當 diff 檔頭丟掉）
      commit('j.txt', `++ contact: ${fakeMail()}\n`, 'leak-plusplus');
      commit('j.txt', 'cleaned\n', 'cleanup-j');
      yes(sh('git show HEAD~1 --format=').split('\n').some((l) => l.startsWith('+++ contact: ') && l.includes(fakeMail()))
        && !fs.readFileSync(path.join(work, 'j.txt'), 'utf8').includes(fakeMail()),
        'J 前置：命中行在 diff 裡長得像 +++ 檔頭、而且最新版已經刪掉（情境成立）');
      const r = gate();
      yes(r.code === 1 && WHO.hitFrom('新增行').test(R(r.out)) && !WHO.anyBroken.test(R(r.out)),
        `J ++ 開頭的命中行、加了又刪 → 回 1、email 那一類、來源是新增行（實得 ${r.code}）`, r.out.slice(-300));
      untouched('J');
    }],
    ['H', () => {
      fs.writeFileSync(path.join(work, 'h.txt'), 'clean-h\n');
      sh('git add h.txt');
      sh(`git commit -q -m "note: ${fakeMail()}"`);
      yes(sh('git log -1 --format=%B').includes(fakeMail()) && !sh('git show HEAD --format=').includes(fakeMail()),
        'H 前置：假信箱只在 commit 訊息裡、不在新增行裡（情境成立）');
      const r = gate();
      yes(r.code === 1 && WHO.hitFrom('commit 訊息').test(R(r.out)) && !WHO.hitFrom('新增行').test(R(r.out)),
        `H 命中寫在 commit 訊息裡 → 回 1、email 那一類、來源是 commit 訊息（實得 ${r.code}）`, r.out.slice(-300));
      untouched('H');
    }],
    ['H2', () => {
      fs.writeFileSync(path.join(work, 'h2.txt'), 'clean-h2\n');
      sh('git add h2.txt');
      sh(`git -c user.email=${fakeMail()} commit -q -m clean-h2`);
      yes(sh('git log -1 --format=%ae').trim() === fakeMail(), 'H2 前置：這個 commit 的作者信箱是合成假信箱（情境成立）');
      const r = gate();
      yes(r.code === 1 && WHO.hitFrom('作者欄').test(R(r.out)) && !WHO.hitFrom('新增行').test(R(r.out)),
        `H2 作者欄是假信箱 → 回 1、email 那一類、來源是作者欄（實得 ${r.code}）`, r.out.slice(-300));
      untouched('H2');
    }],
    ['F', () => {
      // 本機以為已經推上去、遠端其實沒有：帶命中的 commit 繞過閘門推上去（本機追蹤分支跟著前進），
      // 遠端再倒退回 BASE；之後疊一個乾淨的 commit 走閘門。範圍照遠端的實際狀態算，才掃得到那個命中。
      commit('f.txt', `contact: ${fakeMail()}\n`, 'leak-bypassed');
      const leaked = localHead();
      sh('git push -q origin main');
      sh(`git --git-dir="${bare}" update-ref refs/heads/main ${BASE}`);
      commit('f2.txt', 'clean3\n', 'clean3');
      yes(sh('git rev-parse origin/main').trim() === leaked && remoteHead() === BASE,
        'F 前置：本機的追蹤分支停在帶命中的那個 commit，遠端實際上沒有它（情境成立）');
      const r = gate();
      yes(r.code === 1 && WHO.hit.test(R(r.out)) && !WHO.anyBroken.test(R(r.out)),
        `F 本機以為已推、遠端其實沒有 → 回 1、擋在自查的 email 那一類（實得 ${r.code}）`, r.out.slice(-300));
      untouched('F');
    }],
    ['D', () => {
      commit('d.txt', 'clean2\n', 'clean2');
      hook('pre-receive', 'echo "拒收（測試）" >&2; exit 1');
      const r = gate();
      yes(r.code === 2 && WHO.pushFail.test(R(r.out)) && /^通過$/m.test(r.out), `D 遠端拒收 → 回 2、擋在 push 那一關（自查已通過）（實得 ${r.code}）`, r.out.slice(-300));
      untouched('D');
    }],
    ['E', () => {
      commit('d.txt', 'clean2\n', 'clean2');
      hook('post-receive', 'while read old new ref; do git update-ref "$ref" "$old"; done');
      const r = gate();
      yes(r.code === 3 && WHO.mismatch.test(R(r.out)), `E 推了卻沒更新 → 回 3、擋在比對遠端那一關（實得 ${r.code}）`, r.out.slice(-300));
      yes(remoteHead() === BASE, 'E 前置：遠端 main 確實被 hook 退回舊值（情境成立）');
    }],
    ['G', () => {
      commit('d.txt', 'clean2\n', 'clean2');
      sh(`git remote set-url origin "${path.join(base, 'nowhere.git')}"`);
      const r = gate();
      yes(r.code === 4 && WHO.unreachable.test(R(r.out)), `G 抓不到遠端 → 回 4、寫明「抓不到遠端」（實得 ${r.code}）`, r.out.slice(-300));
      untouched('G');
    }],
    // M／M2／M3：三支閘門檔各自改過、驗法還沒重跑，都要擋、而且點名改的是哪一支（共用慣例 v9 §5.15：能做成機器擋的就不要靠人記得）
    ...[['M', 'safe-push.sh', '#'], ['M2', 'prepush-scan.mjs', '//'], ['M3', 'pushgatetest.mjs', '//'], ['M5', 'verified-reg.mjs', '//']].map(([id, f, c]) => [id, () => {
      fs.appendFileSync(path.join(work, 'scripts', f), `${c} 改過一行，還沒重跑 pushgatetest\n`);
      commit('d.txt', 'clean2\n', 'clean2');
      const reg = fs.readFileSync(path.join(work, '.logs', 'pushgate.verified'), 'utf8').split('\n').find((l) => l.endsWith(' scripts/' + f));
      yes(!!reg && sh(`git hash-object scripts/${f}`).trim() !== reg.split(' ')[0],
        `${id} 前置：${f} 現在的雜湊跟登記的不一樣（情境成立）`);
      const r = gate();
      const others = GATE.filter((g) => g !== f);
      yes(r.code === 5 && WHO.unverified.test(R(r.out)) && new RegExp(`^擋下：閘門沒有驗過（scripts/${f.replace('.', '\\.')} 改過`, 'm').test(R(r.out)) && !/^新增行核對：/m.test(r.out)
        && !others.some((g) => R(r.out).includes(`scripts/${g} 改過`)),
        `${id} 只改了 ${f}、驗法沒重跑 → 回 5、點名 ${f}（不是另外幾支）、自查都還沒開始（實得 ${r.code}）`, r.out.slice(-300));
      untouched(id);
    }]),
    ['M0', () => {
      const regPath = path.join(work, '.logs', 'pushgate.verified');
      const had = fs.existsSync(regPath);
      fs.unlinkSync(regPath);
      commit('d.txt', 'clean2\n', 'clean2');
      yes(had && !fs.existsSync(regPath), 'M0 前置：登記檔原本在、現在不在了（情境成立）');
      const r = gate();
      yes(r.code === 5 && WHO.unverified.test(R(r.out)), `M0 沒有登記檔 → 回 5（實得 ${r.code}）`, r.out.slice(-300));
      untouched('M0');
    }],
    ['M4', () => {
      // 改過的 safe-push.sh 已經 commit，工作區又改回登記時的樣子：推出去的是改過的那一份，要擋（F9：比 HEAD，不比工作區）
      const p = path.join(work, 'scripts', 'safe-push.sh');
      const orig = fs.readFileSync(p);
      fs.appendFileSync(p, '# 改過一行、commit 了\n');
      sh('git add scripts/safe-push.sh'); sh('git commit -q -m m4');
      fs.writeFileSync(p, orig);
      const reg = fs.readFileSync(path.join(work, '.logs', 'pushgate.verified'), 'utf8').split('\n').find((l) => l.endsWith(' scripts/safe-push.sh'));
      yes(!!reg && sh('git hash-object scripts/safe-push.sh').trim() === reg.split(' ')[0] && sh('git rev-parse HEAD:scripts/safe-push.sh').trim() !== reg.split(' ')[0],
        'M4 前置：工作區的 safe-push.sh 跟登記相同、HEAD 裡的不同（情境成立）');
      const r = gate();
      yes(r.code === 5 && WHO.unverified.test(R(r.out)) && /^擋下：閘門沒有驗過（scripts\/safe-push\.sh 改過/m.test(R(r.out)),
        `M4 改過的版本已 commit、工作區改回原樣 → 回 5、點名 safe-push.sh（實得 ${r.code}）`, r.out.slice(-300));
      untouched('M4');
    }],
    ['P1', () => {
      touch('build-places.mjs', 'p1');
      yes(!fs.existsSync(F8REG), 'P1 前置：沒有 F8 登記檔');
      const r = gate();
      yes(r.code === 6 && WHO.f8.test(R(r.out)) && /^擋下：F8 驗法沒有驗過（沒有登記檔）/m.test(R(r.out)) && !/^新增行核對：/m.test(r.out),
        `P1 動到 build-places.mjs、沒有 F8 登記 → 回 6、「沒有登記檔」、自查還沒開始（實得 ${r.code}）`, r.out.slice(-300));
      untouched('P1');
    }],
    ['P2', () => {
      touch('build-places.mjs', 'p2');
      f8Reg();
      const r = gate();
      yes(r.code === 0 && /^✓ 已推送/m.test(r.out) && /^F8 驗法：這次動到了 scripts\/build-places\.mjs，登記相符/m.test(r.out) && remoteHead() === localHead(),
        `P2 動到 build-places.mjs、F8 登記整組相符 → 回 0、已推送（實得 ${r.code}）`, r.out.slice(-300));
    }],
    ['P3', () => {
      touch('build-places.mjs', 'p3');
      f8Reg();
      touch('importshots.mjs', 'p3');
      const r = gate();
      yes(r.code === 6 && WHO.f8File('importshots.mjs').test(R(r.out)) && !WHO.f8File('build-places.mjs').test(R(r.out)) && !WHO.f8File('f8verify.mjs').test(R(r.out)),
        `P3 登記之後又改了 importshots.mjs → 回 6、點名 importshots（不是另外兩支）（實得 ${r.code}）`, r.out.slice(-300));
      untouched('P3');
    }],
    ['P4', () => {
      commit('d.txt', 'clean2\n', 'clean2');
      yes(!fs.existsSync(F8REG) && !sh(`git log --format= --name-only ${BASE}..HEAD`).split('\n').some((l) => F8.some((f) => l === 'scripts/' + f)),
        'P4 前置：沒有 F8 登記、這次的 commit 沒動到 F8 那幾支');
      const r = gate();
      yes(r.code === 0 && /^✓ 已推送/m.test(r.out) && !/^F8 驗法：/m.test(r.out) && remoteHead() === localHead(),
        `P4 沒動到 F8 那幾支 → 不看這一關、回 0、已推送（實得 ${r.code}）`, r.out.slice(-300));
    }],
    ['P5', () => {
      touch('f8verify.mjs', 'p5');
      commit('d.txt', 'clean2\n', 'clean-after');
      yes(!sh('git show --format= --name-only HEAD').split('\n').includes('scripts/f8verify.mjs'), 'P5 前置：最新的 commit 沒動到 f8verify.mjs（動到的是前一個）');
      const r = gate();
      yes(r.code === 6 && /^擋下：F8 驗法沒有驗過（沒有登記檔）/m.test(R(r.out)),
        `P5 動到 F8 的是較早的 commit → 照樣回 6（實得 ${r.code}）`, r.out.slice(-300));
      untouched('P5');
    }],
    ['P6', () => {
      // 比照 M4：F8 登記之後，改過的 build-places.mjs 已經 commit、工作區又改回登記時的樣子 → 推出去的是改過的，要擋
      f8Reg();
      const p = path.join(work, 'scripts', 'build-places.mjs');
      const orig = fs.readFileSync(p);
      touch('build-places.mjs', 'p6');
      fs.writeFileSync(p, orig);
      const reg = fs.readFileSync(F8REG, 'utf8').split('\n').find((l) => l.endsWith(' scripts/build-places.mjs'));
      yes(!!reg && sh('git hash-object scripts/build-places.mjs').trim() === reg.split(' ')[0] && sh('git rev-parse HEAD:scripts/build-places.mjs').trim() !== reg.split(' ')[0],
        'P6 前置：工作區的 build-places.mjs 跟 F8 登記相同、HEAD 裡的不同（情境成立）');
      const r = gate();
      yes(r.code === 6 && WHO.f8File('build-places.mjs').test(R(r.out)),
        `P6 改過的 build-places.mjs 已 commit、工作區改回原樣 → 回 6、點名 build-places（實得 ${r.code}）`, r.out.slice(-300));
      untouched('P6');
    }],
    ['V', () => {
      // 登記前的檢查（verified-reg.mjs）：工作區要跟 HEAD 一模一樣才登記；不符合就不寫、舊的一起刪
      const files = ['scripts/build-places.mjs', 'scripts/importshots.mjs'];
      const reg = path.join(work, '.logs', 'v-test.verified');
      const w = writeReg(work, reg, files, '# t\n');
      yes(w.ok && fs.readFileSync(reg, 'utf8').includes(`${sh('git rev-parse HEAD:scripts/importshots.mjs').trim()} scripts/importshots.mjs`),
        'V1 工作區＝HEAD → 登記，內容是 HEAD 裡的雜湊', JSON.stringify(w));
      fs.appendFileSync(path.join(work, 'scripts', 'importshots.mjs'), '// 還沒 commit\n');
      const w2 = writeReg(work, reg, files, '# t\n');
      yes(!w2.ok && /scripts\/importshots\.mjs 工作區跟 HEAD 不一樣/.test(w2.why) && !/build-places/.test(w2.why) && !fs.existsSync(reg),
        'V2 工作區有沒 commit 的改動 → 不登記、點名 importshots、舊的登記刪掉', JSON.stringify(w2));
      sh('git checkout -q -- scripts/importshots.mjs');
      fs.writeFileSync(path.join(work, 'scripts', 'new.mjs'), '// 新檔\n');
      const p3 = headProblems(work, ['scripts/new.mjs']);
      yes(p3.length === 1 && /不在 HEAD 裡/.test(p3[0]), 'V3 還沒 commit 的新檔 → 不登記（不在 HEAD 裡）', JSON.stringify(p3));
      fs.unlinkSync(path.join(work, 'scripts', 'build-places.mjs'));
      const p4 = headProblems(work, files);
      yes(p4.length === 1 && /build-places\.mjs 工作區裡沒有/.test(p4[0]), 'V4 工作區裡沒有 → 不登記', JSON.stringify(p4));
      yes(dropReg(reg) === '本來就不在', 'V 刪登記：不在時照實說「本來就不在」');
    }],
  ];

  // 順序：預設照上面；PUSHGATE_ORDER=reverse 反過來；PUSHGATE_ORDER=shuffle:<種子> 打亂（F5-5：換順序結果要不變）
  const order = process.env.PUSHGATE_ORDER || '';
  let list = SCENARIOS.slice();
  if (order === 'reverse') list.reverse();
  else if (order.startsWith('shuffle:')) {
    let s = Number(order.slice(8)) || 1;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  }
  console.log('  情境順序：' + list.map(([id]) => id).join(' '));
  for (const [id, fn] of list) { reset(); fn(); }

  // 全部通過才登記被驗程式的雜湊（safe-push.sh 推送前比對，對不上就不推）。有 PUSHGATE_ORDER 時不登記：那是驗順序用的額外一跑。
  // 登記在不進版控的 .logs/：換一台機器 clone 下來就沒有登記，第一次推送前一定要先跑這支（新環境正是最需要重跑的時候）。
  // 登記的是 HEAD 裡的版本；工作區那幾支跟 HEAD 不一樣（有沒 commit 的改動）就不登記——驗到的是工作區那一份，推出去的是 HEAD（F9）。
  if (!process.exitCode && !order) {
    const header = '# 推送閘的驗法（pushgatetest）全部通過時登記的雜湊（HEAD 裡的版本）。safe-push.sh 推送前比對，對不上就不推（共用慣例 v9 §5.15）。\n'
      + '# 不進版控。改了下面任何一支、或換了一台機器，就 commit 之後重跑 npm run pushgatetest；全部通過才會寫這個檔，有任何失敗就刪掉它。\n';
    const w = writeReg(ROOT, REG_REAL, GATE.map((f) => 'scripts/' + f), header);
    if (w.ok) console.log('  已登記驗過的閘門雜湊：.logs/pushgate.verified');
    else fail(`沒有登記：${w.why}——先 commit 再跑（登記的要是推出去的那一份）；舊的登記${w.dropped}`);
  }

  console.log('\n推送閘測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
// 有任何失敗（含例外）就刪掉登記，不只是「不更新」：閘門檔沒動、驗法卻失敗，最可能是執行環境變了——那正是該停下的時候
if (process.exitCode && fs.existsSync(REG_REAL)) { fs.unlinkSync(REG_REAL); console.log('  有失敗：已刪掉 .logs/pushgate.verified（下次推送會被擋，直到驗法重新全過）'); }
else if (process.exitCode) console.log('  有失敗：.logs/pushgate.verified 本來就不在');
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
