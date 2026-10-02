// scripts/evidence.mjs 的突變（2026-10-02）：把它複製到 .logs/evm/ 改壞一處，不帶參數跑（只跑自身對照組）：
// 對照組沒過 → 回 4；過了 → 回 2（用法說明）。每條預期回 4、而且點名的是預期那一條對照組。
// 用法：node tools/mutproof/evidence_mut.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const DIR = path.join(REPO, '.logs', 'evm');
const SRC = fs.readFileSync(path.join(REPO, 'scripts', 'evidence.mjs'), 'utf8');
const MUTS = [
  { name: 'E0 不改（基準）', edits: [], rc: 2, fails: [] },
  { name: 'E1 不洗磁碟代號路徑', edits: [["[new RegExp('[A-Za-z]:[' + bs + bs + '/][^\\\\s\"\\'`）)，、；]*', 'g'), '‹路徑›'],", '']], rc: 4,
    fails: ['清洗：五種髒樣本洗完都看不到原字', '清洗：洗完的輸出再掃一次是乾淨的', '清洗：整份輸出沒有路徑、但分類與實際紅那一條還在'] },
  { name: 'E2 不洗登記的個資詞', edits: [["for (const t of terms.filter((x) => x && x.trim())) pats.push(", 'for (const t of [].filter((x) => x && x.trim())) pats.push(']], rc: 4,
    fails: ['清洗：五種髒樣本洗完都看不到原字', '清洗：洗完的輸出再掃一次是乾淨的'] },   // 複掃獨立之後也接得住
  { name: 'E3 洗過頭：整行洗光', edits: [['const clean = (s) => pats.reduce((x, [re, to]) => x.replace(re, to), String(s));', "const clean = (s) => '‹已遮蔽›';"]], rc: 4,
    fails: ['清洗：分類用的字（情境名、回傳值、檔名）不會被洗掉', '清洗：整份輸出沒有路徑、但分類與實際紅那一條還在'] },
  { name: 'E4 不看預期外的 ⊘', edits: [['if (extraU.length) return', 'if (false) return']], rc: 4, fails: ['分類：情境未成立（不在預期裡的 ⊘）'] },
  { name: 'E5 不看多紅的', edits: [['if (!missR.length && !extraR.length && !missU.length)', 'if (!missR.length && !missU.length)']], rc: 4, fails: ['分類：紅錯地方（多紅了別條）'] },
  { name: 'E7 不看 clone 裡跑的是不是改壞那份', edits: [["if (r.nested && r.nested.ok === false) return '情境未成立';", '']], rc: 4,
    fails: ['分類：clone 裡跑的不是改壞那份 → 情境未成立（就算紅在預期也一樣）'] },
  { name: 'E8 舊紀錄改回子字串判斷（一行裡有 ✗ 字就算失敗）', edits: [["!/^\\[[^\\]]+\\] ✗/m.test(sh);", "!/✗/.test(sh);"]], rc: 4,
    fails: ['舊紀錄：訊息裡帶 ✗ 字、但不在行首 → 不算失敗'] },
  { name: 'E6 母體不查少了的', edits: [['for (const w of want) if (!got.includes(w)) out.push(`少了：${w}`);', '']], rc: 4, fails: ['母體：少了 b → 點名 b'] },
];
let bad = 0;
for (const m of MUTS) {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, 'scripts'), { recursive: true });
  let s = SRC;
  for (const [a, b] of m.edits) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止\n   ${a.slice(0, 70)}`); process.exit(9); }
    s = s.replace(a, b);
  }
  fs.writeFileSync(path.join(DIR, 'scripts', 'evidence.mjs'), s);
  const r = spawnSync(process.execPath, [path.join(DIR, 'scripts', 'evidence.mjs')], { cwd: DIR, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const failed = out.split('\n').filter((l) => l.startsWith('✗ 對照組：')).map((l) => l.slice('✗ 對照組：'.length));
  const ok = r.status === m.rc && failed.slice().sort().join('|') === m.fails.slice().sort().join('|');
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}（預期 ${m.rc}）、沒過的對照組 ${failed.length} 條${failed.length ? '：' + failed.join('／') : ''}`);
}
fs.rmSync(DIR, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : '全部照預期');
process.exitCode = bad ? 1 : 0;
