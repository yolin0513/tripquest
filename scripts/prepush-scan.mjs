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
// 抓不到的：個資（名字、日期、金額……）——push 前自己把新增的文件行看一遍（共用慣例附錄 A）。
import { execSync } from 'node:child_process';

const range = process.argv[2] || '';
// 每一行記下來源（新增行／commit 訊息／作者欄），命中時講得出是哪裡（共用慣例 v8 §2.5：commit 訊息、作者與提交者的
// 名字與信箱一樣會永久公開；§5.11：要講得出是誰、為什麼擋）
// 測試用（pushgatetest）：弄壞指定的那一類或那一段，模擬檢查器壞掉。只會讓結果更嚴（回 4、不推），不會放行任何東西。
const selftestBreak = process.env.PREPUSH_SELFTEST_BREAK || '';
let added, commits = 0, parsed = 0;
try {
  const run = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  const cmd = range ? `git log -p --format= --unified=0 ${range}` : 'git show HEAD --format= --unified=0';
  added = run(cmd).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => ({ src: '新增行', text: l.slice(1) }));
  commits = Number(run(`git rev-list --count ${range ? range : '-1 HEAD'}`).trim());
  // 'meta'：模擬「取訊息與作者欄的指令輸出是空的」（換一台機器、git 版本或輸出格式不同時可能發生）
  const meta = selftestBreak === 'meta' ? '' : run(`git log --format=%h%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e ${range ? range : '-1 HEAD'}`);
  for (const rec of meta.split('\x1e')) {
    const f = rec.replace(/^\n/, '').split('\x00');
    if (f.length < 6) continue;
    parsed++;
    const [h, an, ae, cn, ce, body] = f;
    for (const t of [an, ae, cn, ce]) added.push({ src: '作者欄', text: t, at: h });
    for (const t of body.split('\n')) if (t) added.push({ src: 'commit 訊息', text: t, at: h });
  }
} catch (e) {
  console.log(`✗ 讀不到要檢查的範圍（${range || 'HEAD'}）：${String(e.message).split('\n')[0]}`);
  console.log('擋下：檢查器壞了（範圍）');
  process.exit(4);
}

const user = process.env.USERNAME || process.env.USER || '';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const checks = {
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
};

// 「搜尋式壞了」那一種：把指定那一類的搜尋式換成永遠不命中的
if (checks[selftestBreak]) checks[selftestBreak].re = /(?!)/g;

const broken = [], hit = [];
for (const [name, c] of Object.entries(checks)) {
  if (!c.re) { console.log(`${name}：無法檢查（讀不到本機使用者名稱）`); broken.push(name); continue; }
  const test = (line) => {
    c.re.lastIndex = 0;
    if (name === 'email') return (line.match(c.re) || []).filter((m) => !c.allow(m)).length > 0;
    return c.re.test(line);
  };
  const ctrlHit = test(c.ctrl);
  const hits = added.filter((l) => test(l.text));
  console.log(`${name}：對照組命中=${ctrlHit}，命中=${hits.length}`);
  if (!ctrlHit) broken.push(name);
  if (hits.length) hit.push(`${name}（${hits.length} 行；來源：${[...new Set(hits.map((l) => l.src))].join('、')}）`);
  for (const h of hits) console.log('   ', `[${h.src}${h.at ? ' ' + h.at : ''}]`, c.hide ? '（不印出）' : h.text.slice(0, 160));
}
const count = (s) => added.filter((l) => l.src === s).length;
console.log('範圍：', range || 'HEAD', '；commit 數：', commits, '；新增行數：', count('新增行'), '；commit 訊息行數：', count('commit 訊息'), '；作者欄：', count('作者欄'));
// 故障時不放行：每個 commit 一定有作者欄（4 欄）與訊息；數不起來只可能是解析壞了，不是「沒東西可掃」。
// （2026-09-24 統籌者探測：解析整個壞掉時印出「0 行」照樣通過。換個環境就會發生，不需要任何人改壞程式。）
// commit 數是 0 只在「真的沒有要推的」時成立：那時也不該有任何新增行。
const metaBroken = !Number.isInteger(commits) || commits < 0
  || (commits === 0 ? count('新增行') > 0
    : parsed !== commits || count('作者欄') !== 4 * commits || count('commit 訊息') < commits);
if (metaBroken) {
  console.log(`✗ 範圍內有 ${commits} 個 commit，卻只解析出 ${parsed} 筆訊息與作者欄（訊息 ${count('commit 訊息')} 行、作者欄 ${count('作者欄')}）——解析壞了`);
  console.log('擋下：檢查器壞了（訊息與作者欄）');
  process.exit(4);
}
if (broken.length) { console.log(`擋下：檢查器壞了（${broken.join('、')}）`); process.exit(4); }
if (hit.length) { console.log(`擋下：有命中（${hit.join('、')}）`); process.exit(1); }
console.log('通過');
