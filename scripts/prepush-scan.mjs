// 公開前自查（本 repo 是 public；共用慣例 §2.4）。由 scripts/safe-push.sh 呼叫，也可以單獨跑：
//   node scripts/prepush-scan.mjs <範圍>        例：node scripts/prepush-scan.mjs <遠端的 sha>..HEAD
// 沒給範圍就只看 HEAD 這一個 commit。
//
// 掃**範圍內每一個 commit 的新增行**（不是只看最後一個 commit——一次推好幾個 commit 時，前面那幾個也會公開；
// 也不是看淨差異——先加後刪的一行，在歷史裡照樣看得到），以及每一個 commit 的**訊息與作者、提交者的名字信箱**
// （2026-09-24 補：它們一樣永久留在公開歷史裡）。命中時寫明來源。四類：金鑰或 token、email（GitHub 與 Anthropic 的
// noreply 除外）、本機使用者名稱（執行當下從環境變數讀，不寫進檔案、不印出來）、磁碟機代號與家目錄路徑。
// 每一類先在當場組出的合成樣本（對照組）上命中，才算這一類有在檢查。
//
// 回傳值（safe-push.sh 照原樣傳出去，一看就知道是哪一關擋的）：
//   0 通過；1 有命中（新增行裡真的有）；4 檢查器壞了（某一類的對照組沒命中、或那一類無法檢查、或讀不到範圍）
// 每一種都在最後一行寫明是哪一類。
//
// 依賴注入（2026-09-25，統籌者補充說明八：移除 PREPUSH_SELFTEST_BREAK 後門）：檢查表 checks 與執行 git 的函式 run 都是
// scan() 的參數，直接執行這支檔時用真的；pushgatetest 在程式裡傳壞掉的版本進來模擬檢查器壞掉。正式程式裡沒有任何
// 「設了某個變數就故意失敗」的分支——原本那個開關有一種用法會把某一類的搜尋式換成永遠不命中，只靠對照組兜底。
//
// 抓不到的：個資（名字、日期、金額……）——push 前自己把新增的文件行看一遍（共用慣例附錄 A）。
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const makeRun = (cwd) => (cmd) => execSync(cmd, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
export const realUser = () => process.env.USERNAME || process.env.USER || '';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 檢查表：四類，各帶一個當場組出的合成樣本（對照組）
export const makeChecks = (user) => ({
  secret: {
    re: /(sk-ant-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"])/i,
    ctrl: 'const k = "AIza' + 'X'.repeat(35) + '";',
  },
  email: {
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: (m) => /@users\.noreply\.github\.com$/i.test(m) || /^noreply@anthropic\.com$/i.test(m),
    ctrl: 'contact ' + ['zz', 'test'].join('.') + '@' + 'example-fake' + '.org',
  },
  user: { re: user ? new RegExp(esc(user), 'i') : null, ctrl: 'path/' + user + '/x', hide: true },
  // 磁碟機代號前面不能是英文字母（不然網址協定的冒號斜線會誤中），也不能是反斜線（不然 regex 字面裡的
  // 數字跳脫、冒號、數字跳脫會誤中）。這幾行註解與下面的字面都刻意寫成不會命中自己——2026-09-23 這支檔案
  // 第一次推送就被自己的搜尋式擋下過；修法是改寫，不是把這支檔案排除在掃描之外。
  path: {
    re: /((?<![A-Za-z\\])[A-Za-z]:[\\/][^\s`'"]*|\/[a-z]\/Users\/|\/home\/[A-Za-z]|~\/)/,
    ctrl: 'at ' + 'Q' + ':\\foo\\bar',
  },
});

// 掃一個範圍，回傳回傳值（0／1／4）；每一行輸出交給 log
export function scan({ range = '', run = makeRun(process.cwd()), checks = makeChecks(realUser()), log = console.log } = {}) {
  // 每一行記下來源（新增行／commit 訊息／作者欄），命中時講得出是哪裡（共用慣例 v8 §2.5：commit 訊息、作者與提交者的
  // 名字與信箱一樣會永久公開；§5.11：要講得出是誰、為什麼擋）
  let added, commits = 0, parsed = 0;
  try {
    const cmd = range ? `git log -p --format= --unified=0 ${range}` : 'git show HEAD --format= --unified=0';
    // 照 diff 的結構抽：只有 @@ 之後、以 + 開頭的行才是內容。不能用「以 +++ 開頭就當檔頭跳過」——內容本身以 ++ 開頭的行，
    // 加上 diff 的 + 也變成 +++，會被默默丟掉、根本沒掃（2026-09-24 統籌者查出，四個 App 全中）。
    added = [];
    let inHunk = false;
    for (const l of run(cmd).split('\n')) {
      if (l.startsWith('diff --git ')) inHunk = false;
      else if (l.startsWith('@@')) inHunk = true;
      else if (inHunk && l.startsWith('+')) added.push({ src: '新增行', text: l.slice(1) });
    }
    // 核對：抽出來的行數要等於 git 自己用 --numstat 算的新增行數（獨立來源；二進位檔記成 -，不算）。
    // 對不上就是抽取壞了——不論是上面那種寫法的錯，還是換環境後輸出格式變了。
    const numCmd = range ? `git log --numstat --format= ${range}` : 'git show HEAD --numstat --format=';
    const expected = run(numCmd).split('\n').map((l) => l.split('\t')[0]).filter((n) => /^\d+$/.test(n))
      .reduce((s, n) => s + Number(n), 0);
    log(`新增行核對：抽出 ${added.length} 行，git 算 ${expected} 行`);
    if (added.length !== expected) {
      log(`✗ 抽出 ${added.length} 行新增行，git 算 ${expected} 行——抽取壞了`);
      log('擋下：檢查器壞了（新增行抽取）');
      return 4;
    }
    commits = Number(run(`git rev-list --count ${range ? range : '-1 HEAD'}`).trim());
    const meta = run(`git log --format=%h%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e ${range ? range : '-1 HEAD'}`);
    for (const rec of meta.split('\x1e')) {
      const f = rec.replace(/^\n/, '').split('\x00');
      if (f.length < 6) continue;
      parsed++;
      const [h, an, ae, cn, ce, body] = f;
      for (const t of [an, ae, cn, ce]) added.push({ src: '作者欄', text: t, at: h });
      for (const t of body.split('\n')) if (t) added.push({ src: 'commit 訊息', text: t, at: h });
    }
  } catch (e) {
    log(`✗ 讀不到要檢查的範圍（${range || 'HEAD'}）：${String(e.message).split('\n')[0]}`);
    log('擋下：檢查器壞了（範圍）');
    return 4;
  }

  const broken = [], hit = [];
  for (const [name, c] of Object.entries(checks)) {
    if (!c.re) { log(`${name}：無法檢查（讀不到本機使用者名稱）`); broken.push(name); continue; }
    const test = (line) => {
      c.re.lastIndex = 0;
      if (c.allow) return (line.match(c.re) || []).filter((m) => !c.allow(m)).length > 0;
      return c.re.test(line);
    };
    const ctrlHit = test(c.ctrl);
    const hits = added.filter((l) => test(l.text));
    log(`${name}：對照組命中=${ctrlHit}，命中=${hits.length}`);
    if (!ctrlHit) broken.push(name);
    if (hits.length) hit.push(`${name}（${hits.length} 行；來源：${[...new Set(hits.map((l) => l.src))].join('、')}）`);
    for (const h of hits) log('    ' + `[${h.src}${h.at ? ' ' + h.at : ''}] ` + (c.hide ? '（不印出）' : h.text.slice(0, 160)));
  }
  const count = (s) => added.filter((l) => l.src === s).length;
  log(`範圍： ${range || 'HEAD'} ；commit 數： ${commits} ；解析出訊息與作者欄： ${parsed} 筆；新增行數： ${count('新增行')} ；commit 訊息行數： ${count('commit 訊息')} ；作者欄： ${count('作者欄')}`);
  // 故障時不放行：每個 commit 一定有一筆作者欄與訊息；數不起來只可能是解析壞了，不是「沒東西可掃」。
  // （2026-09-24 統籌者探測：解析整個壞掉時印出「0 行」照樣通過。換個環境就會發生，不需要任何人改壞程式。）
  // 每一條守一種壞法（pushgatetest 各有一種情境、拿掉那一條只紅它自己）。不另查「作者欄＝4×commit 數」：
  // 每解析一筆固定推 4 欄，它恆等於 4×解析筆數，筆數那條已經涵蓋（突變實測是等價的）。
  const metaFaults = [];
  // 範圍：commit 數讀不成數字，或是 0（真的沒有要推的）卻有新增行
  if (!Number.isInteger(commits) || commits < 0 || (commits === 0 && count('新增行') > 0)) metaFaults.push('範圍');
  // 筆數：有 commit 卻解析不出同樣筆數（整個壞掉、或只解出一部分）
  if (commits > 0 && parsed !== commits) metaFaults.push('筆數');
  // 訊息：筆數對、訊息卻遺失（每個 commit 至少一行）
  if (commits > 0 && count('commit 訊息') < commits) metaFaults.push('訊息');
  if (metaFaults.length) {
    log(`✗ 範圍內有 ${commits} 個 commit，解析出 ${parsed} 筆訊息與作者欄（訊息 ${count('commit 訊息')} 行、作者欄 ${count('作者欄')}）——解析壞了`);
    log(`擋下：檢查器壞了（訊息與作者欄：${metaFaults.join('、')}）`);
    return 4;
  }
  if (broken.length) { log(`擋下：檢查器壞了（${broken.join('、')}）`); return 4; }
  if (hit.length) { log(`擋下：有命中（${hit.join('、')}）`); return 1; }
  log('通過');
  return 0;
}

// 直接執行這支檔時（safe-push.sh 就是這樣叫的）：用真的 git、真的檢查表。
// Windows 的路徑不分大小寫（磁碟機代號可能一邊大寫一邊小寫）；萬一這個判斷還是失準、一行都沒掃就回 0，
// safe-push.sh 會因為輸出裡沒有「通過」那一行而擋下（pushgatetest 的 T）。
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (same(path.resolve(process.argv[1] || ''), fileURLToPath(import.meta.url))) process.exitCode = scan({ range: process.argv[2] || '' });
