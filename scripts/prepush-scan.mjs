// 公開前自查（本 repo 是 public；共用慣例 §2.4）。由 scripts/safe-push.sh 呼叫，也可以單獨跑：
//   node scripts/prepush-scan.mjs <範圍>        例：node scripts/prepush-scan.mjs <遠端的 sha>..HEAD
// 沒給範圍就只看 HEAD 這一個 commit。
//
// 掃**範圍內每一個 commit 的新增行**（不是只看最後一個 commit——一次推好幾個 commit 時，前面那幾個也會公開；
// 也不是看淨差異——先加後刪的一行，在歷史裡照樣看得到）。四類：金鑰或 token、email（GitHub 與 Anthropic 的
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
let added;
try {
  const cmd = range ? `git log -p --format= --unified=0 ${range}` : 'git show HEAD --format= --unified=0';
  const diff = execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
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

// 測試用（pushgatetest 的「搜尋式壞了」那一種）：把指定那一類的搜尋式換成永遠不命中的，模擬檢查器壞掉。
// 只會讓結果更嚴（對照組沒命中 → 回 4、不推），不會讓任何東西放行。
const selftestBreak = process.env.PREPUSH_SELFTEST_BREAK || '';
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
  const hits = added.filter(test);
  console.log(`${name}：對照組命中=${ctrlHit}，新增行命中=${hits.length}`);
  if (!ctrlHit) broken.push(name);
  if (hits.length) hit.push(`${name}（${hits.length} 行）`);
  if (!c.hide) for (const h of hits) console.log('   ', h.slice(0, 160));
}
console.log('範圍：', range || 'HEAD', '；新增行數：', added.length);
if (broken.length) { console.log(`擋下：檢查器壞了（${broken.join('、')}）`); process.exit(4); }
if (hit.length) { console.log(`擋下：有命中（${hit.join('、')}）`); process.exit(1); }
console.log('通過');
