// 公開前自查（本 repo 是 public；共用慣例 §2.4）。由 scripts/safe-push.sh 呼叫，也可以單獨跑：
//   node scripts/prepush-scan.mjs <範圍>        例：node scripts/prepush-scan.mjs <遠端的 sha>..HEAD
// 沒給範圍就只看 HEAD 這一個 commit。
//
// 掃**範圍內每一個 commit 的新增行**（不是只看最後一個 commit——一次推好幾個 commit 時，前面那幾個也會公開；
// 也不是看淨差異——先加後刪的一行，在歷史裡照樣看得到），以及每一個 commit 的**訊息與作者、提交者的名字信箱**
// （2026-09-24 補：它們一樣永久留在公開歷史裡）。命中時寫明來源。五類：金鑰或 token、email（GitHub 與 Anthropic 的
// noreply 除外）、本機使用者名稱（執行當下從環境變數讀，不寫進檔案、不印出來）、磁碟機代號與家目錄路徑、
// 家人與真實行程（v1.91，見下面「第五類」）。
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
// 第五類 private（v1.91，Yolin 2026-11-16 同意）：家人的名字、真實行程的名稱／地點／日期。**名單不進 repo**（共用慣例 §2.5：
// 規則進 repo、資料不進 repo）——從被 .gitignore 擋掉的 PRIVATE_LIST 讀（一行一個詞；# 開頭是註解；前後空白不算）。
// 讀不到、是空的、有不到 2 個字的詞 → 這一類「無法檢查」→ 回 4（故障時停下，§5.13；新機器要先建這個檔，怎麼建見 STATUS）。
// 每一個詞是一個分支、配一個當場組出的樣本；被另一個詞整個包含的詞不另算（短的那個已經抓得到，留著的話「拿掉它」驗不出來）。
// 命中時不印那一行、也不印詞本身，只印第幾個詞、哪一支檔（輸出會進 log 與回報）。
//
// 抓不到的：名單以外的個資（金額、其他人的名字……）——push 前自己把新增的文件行看一遍（共用慣例附錄 A）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_LIST = '.private/pii-terms.txt';
// 讀名單：回 { terms, dropped } 或 { error }。dropped＝被別的詞整個包含、不另算的幾個
export function readTerms(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { error: `讀不到名單檔 ${PRIVATE_LIST}（${e.code || e.message}）` }; }
  const rows = text.split(/\r?\n/).map((l, i) => ({ n: i + 1, t: l.trim() })).filter((r) => r.t && !r.t.startsWith('#'));
  const short = rows.filter((r) => [...r.t].length < 2);
  if (short.length) return { error: `名單裡有不到 2 個字的詞（第 ${short.map((r) => r.n).join('、')} 行；一個字幾乎每一行都會撞到）` };
  const uniq = [...new Set(rows.map((r) => r.t))];
  if (!uniq.length) return { error: `名單是空的（${PRIVATE_LIST} 只有註解或空行）` };
  const terms = uniq.filter((t) => !uniq.some((u) => u !== t && t.toLowerCase().includes(u.toLowerCase())));
  return { terms, dropped: uniq.length - terms.length };
}

export const makeRun = (cwd) => (cmd) => execSync(cmd, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
export const realUser = () => process.env.USERNAME || process.env.USER || '';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 檢查表：五類（v1.91 加了第五類 private）。搜尋式由「分支」組成，**每一個分支配一個當場組出的合成樣本**（ctrl 的第 i 個樣本對應 parts 的第 i 個分支；
// 補充說明十一：對照樣本要打到每一個分支——原本金鑰 6 個分支、路徑 4 個分支都只有 1 個樣本，其他分支壞了也看不出來）。
// 放行規則（email 的 noreply）也有自己的樣本（ctrlNot）：這些**不能**被判成命中，放行規則壞了一樣算檢查器壞了。
// pushgatetest 的 Z 情境逐一拿掉每一個分支、每一條放行規則，自查都必須判「檢查器壞了」。
// 樣本一律在執行時才組出來，不把像金鑰、像路徑的字面寫進原始碼（這支檔案自己也會被自查掃到）。
const join = (parts, flags) => new RegExp(parts.map((p) => p.source).join('|'), flags);
// terms：readTerms 讀到的名單（沒給＝讀不到 → private 那一類無法檢查）；termsError：讀不到的原因
export const makeChecks = (user, terms = null, termsError = '') => {
  const privParts = (terms || []).map((t) => new RegExp(esc(t), 'i'));
  const secretParts = [
    /sk-ant-[A-Za-z0-9_-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/,
  ];
  // 磁碟機代號前面不能是英文字母（不然網址協定的冒號斜線會誤中），也不能是反斜線（不然 regex 字面裡的
  // 數字跳脫、冒號、數字跳脫會誤中）。這幾行註解與下面的字面都刻意寫成不會命中自己——2026-09-23 這支檔案
  // 第一次推送就被自己的搜尋式擋下過；修法是改寫，不是把這支檔案排除在掃描之外。
  const pathParts = [/(?<![A-Za-z\\])[A-Za-z]:[\\/][^\s`'"]*/, /\/[a-z]\/Users\//, /\/home\/[A-Za-z]/, /~\//];
  const allowRes = [/@users\.noreply\.github\.com$/i, /^noreply@anthropic\.com$/i];
  return {
    secret: {
      parts: secretParts, flags: 'i', re: join(secretParts, 'i'),
      ctrl: ['sk-' + 'ant-' + 'x'.repeat(12), 'const k = "AIza' + 'X'.repeat(35) + '";', 'gh' + 'p_' + 'A'.repeat(32),
        'github' + '_pat_' + 'B'.repeat(22), '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----',
        'api' + '_key = "' + 'C'.repeat(20) + '"'],
    },
    email: {
      re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      allowRes, allow: (m) => allowRes.some((r) => r.test(m)),
      ctrl: ['contact ' + ['zz', 'test'].join('.') + '@' + 'example-fake' + '.org'],
      ctrlNot: ['by ' + 'zz' + '@' + 'users.noreply.github.com', 'by ' + 'noreply' + '@' + 'anthropic.com'],
    },
    user: { re: user ? new RegExp(esc(user), 'i') : null, ctrl: ['path/' + user + '/x'], hide: true, missing: '讀不到本機使用者名稱' },
    path: {
      parts: pathParts, flags: '', re: join(pathParts, ''),
      ctrl: ['at ' + 'Q' + ':\\foo\\bar', 'at ' + '/' + 'c' + '/Users' + '/x', 'at ' + '/home' + '/zz', 'at ' + '~' + '/notes'],
    },
    // 家人與真實行程（v1.91）：每一個詞一個分支、一個樣本；放行樣本是一個不可見的分隔字元——名單裡混進空的詞時
    // 正規式會變成「什麼都命中」，它就會被判成命中、這一類算檢查器壞了
    private: {
      parts: privParts, flags: 'i', re: privParts.length ? join(privParts, 'i') : null,
      ctrl: (terms || []).map((t) => '前' + t + '後'), ctrlNot: ['⁣'],
      hide: true, missing: termsError || `讀不到名單檔 ${PRIVATE_LIST}`,
    },
  };
};

// 掃一個範圍，回傳回傳值（0／1／4）；每一行輸出交給 log
export function scan({ range = '', run = makeRun(process.cwd()), checks = makeChecks(realUser()), log = console.log } = {}) {
  // 每一行記下來源（新增行／commit 訊息／作者欄），命中時講得出是哪裡（共用慣例 v8 §2.5：commit 訊息、作者與提交者的
  // 名字與信箱一樣會永久公開；§5.11：要講得出是誰、為什麼擋）
  let added, commits = 0, parsed = 0;
  try {
    // 抽新增行與下面的 numstat 核對**用同一組 diff 選項**（2026-10-08）：原本這裡用 --unified=0、numstat 用預設，兩種都是合法的 diff，
    // 但對空白行的對齊可以不同——一次只改 STATUS 的推送，-U0 算出 30 行新增、numstat 算出 31 行，正常內容被判成「抽取壞了」擋下
    // （照「故障時停下」擋的，沒放出去任何東西）。只在整份檔案的尺度上才重現，縮不成小樣本；所以從結構上讓兩邊用同一種 diff。
    // 預設 diff 多出來的上下文行以空白開頭，下面只認 hunk 裡以 + 開頭的行，不會被誤抽。
    const cmd = range ? `git log -p --format= ${range}` : 'git show HEAD --format=';
    // 照 diff 的結構抽：只有 @@ 之後、以 + 開頭的行才是內容。不能用「以 +++ 開頭就當檔頭跳過」——內容本身以 ++ 開頭的行，
    // 加上 diff 的 + 也變成 +++，會被默默丟掉、根本沒掃（2026-09-24 統籌者查出，四個 App 全中）。
    added = [];
    let inHunk = false, file = '';
    for (const l of run(cmd).split('\n')) {
      // 記下是哪一支檔（不印內容的那幾類命中時，只印檔名與第幾個詞）
      if (l.startsWith('diff --git ')) { inHunk = false; file = l.split(' b/').pop(); }
      else if (l.startsWith('@@')) inHunk = true;
      else if (inHunk && l.startsWith('+')) added.push({ src: '新增行', text: l.slice(1), file });
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
      // 作者與提交者分開標來源（補充說明十一：兩邊各要有自己的情境；混成一個來源時，只拿掉其中一邊的檢查也看不出來）
      for (const t of [an, ae]) added.push({ src: '作者欄', text: t, at: h });
      for (const t of [cn, ce]) added.push({ src: '提交者欄', text: t, at: h });
      for (const t of body.split('\n')) if (t) added.push({ src: 'commit 訊息', text: t, at: h });
    }
  } catch (e) {
    log(`✗ 讀不到要檢查的範圍（${range || 'HEAD'}）：${String(e.message).split('\n')[0]}`);
    log('擋下：檢查器壞了（範圍）');
    return 4;
  }

  const broken = [], hit = [];
  for (const [name, c] of Object.entries(checks)) {
    if (!c.re) { log(`${name}：無法檢查（${c.missing || '搜尋式是空的'}）`); broken.push(name); continue; }
    const test = (line) => {
      c.re.lastIndex = 0;
      if (c.allow) return (line.match(c.re) || []).filter((m) => !c.allow(m)).length > 0;
      return c.re.test(line);
    };
    // 每一個分支的樣本都要命中、每一個放行樣本都不能命中，才算這一類有在檢查
    const missed = c.ctrl.map((s, i) => (test(s) ? -1 : i)).filter((i) => i >= 0);
    const leaked = (c.ctrlNot || []).map((s, i) => (test(s) ? i : -1)).filter((i) => i >= 0);
    const ctrlHit = missed.length === 0 && leaked.length === 0;
    const hits = added.filter((l) => test(l.text));
    log(`${name}：對照組命中=${ctrlHit}，命中=${hits.length}`
      + (missed.length ? `（第 ${missed.map((i) => i + 1).join('、')} 個分支的樣本沒命中）` : '')
      + (leaked.length ? `（第 ${leaked.map((i) => i + 1).join('、')} 個放行樣本被判成命中）` : ''));
    if (!ctrlHit) broken.push(name);
    if (hits.length) hit.push(`${name}（${hits.length} 行；來源：${[...new Set(hits.map((l) => l.src))].join('、')}）`);
    for (const h of hits) {
      // 不印內容的那幾類：有分支的（private）印第幾個詞，讓人找得到是哪一個，但詞本身不出現在輸出裡
      const which = c.hide && c.parts ? c.parts.map((p, i) => (p.test(h.text) ? i + 1 : 0)).filter(Boolean) : [];
      const where = `[${h.src}${h.at ? ' ' + h.at : ''}${h.file ? ' ' + h.file : ''}] `;
      log('    ' + where + (c.hide ? `（不印出${which.length ? `；第 ${which.join('、')} 個詞` : ''}）` : h.text.slice(0, 160)));
    }
  }
  const count = (s) => added.filter((l) => l.src === s).length;
  log(`範圍： ${range || 'HEAD'} ；commit 數： ${commits} ；解析出訊息與作者欄： ${parsed} 筆；新增行數： ${count('新增行')} ；commit 訊息行數： ${count('commit 訊息')} ；作者欄： ${count('作者欄')} ；提交者欄： ${count('提交者欄')}`);
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
// 名單檔照這支檔的位置找（repo 根目錄底下的 PRIVATE_LIST）；pushgatetest 的暫存 repo 裡放的是合成的名單。
if (same(path.resolve(process.argv[1] || ''), fileURLToPath(import.meta.url))) {
  const t = readTerms(fileURLToPath(new URL('../' + PRIVATE_LIST, import.meta.url)));
  if (t.terms) console.log(`名單：${t.terms.length} 個詞${t.dropped ? `（另有 ${t.dropped} 個被別的詞整個包含、不另算）` : ''}`);
  process.exitCode = scan({ range: process.argv[2] || '', checks: makeChecks(realUser(), t.terms || null, t.error || '') });
}
