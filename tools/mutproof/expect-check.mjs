// 預期清單的檢查（2026-10-02）：
//   1. 預期清單過期：每一條預期（expect／expectRed／expectFalse／expectUnformed 裡的字串）必須是「當前測試某一條斷言訊息的開頭」。
//      當前斷言集合＝基準那一場（沒改壞）印出的每一行 ✓／✗／⊘ 判定行。找不到 → 「預期清單過期」，獨立的結果，不跟「不如預期」共用。
//   2. 動態內容：預期字串在驅動原始碼裡是不是用 ${…} 組出來的（開頭嵌動態內容最危險：每次跑結果可能不同）。
// 比對方式本身（驅動用 startsWith 比 ✗ 後面的訊息）恆為「開頭」，這裡另外數一次確認。
//   node tools/mutproof/expect-check.mjs           讀 .logs/mutproof/<驅動>/<基準>.txt 與各驅動原始碼
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// 判定行：✓／✗／⊘ 開頭（⊘ 後面是「情境未成立：」），取訊息本身
export const verdictMessages = (out) => out.split('\n')
  .filter((l) => /^(✓|✗|⊘ 情境未成立：) ?/.test(l))
  .map((l) => l.replace(/^(✓ |✗ |⊘ 情境未成立：)/, ''));
export function stale(expects, messages) {
  return expects.filter((e) => !messages.some((m) => m.startsWith(e)));
}
// 從驅動原始碼抽每一條的預期陣列（只認字面陣列）；回傳 [{ name, field, items: [{ text, dynamic }] }]
export function expectsOf(src) {
  const out = [];
  for (const m of src.matchAll(/name: '([^']+)'[\s\S]*?(?=\n {2}\{ name:|\n\];)/g)) {
    const block = m[0];
    for (const f of block.matchAll(/(expect|expectRed|expectFalse|expectUnformed): \[([^\]]*)\]/g)) {
      const items = [...f[2].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((x) => {
        const text = x[1] ?? x[2] ?? x[3];
        return { text, dynamic: x[3] !== undefined && /\$\{/.test(text) };
      });
      out.push({ name: m[1], field: f[1], items });
    }
  }
  return out;
}

// ---------- 對照組 ----------
{
  const msgs = verdictMessages('✓ A 一條\n✗ B 二條（實得 1）\n⊘ 情境未成立：C—造不出來\n   ✗ 縮排的證據行不算\n說明 ✗ 不在行首不算');
  const ok1 = msgs.join('|') === 'A 一條|B 二條（實得 1）|C—造不出來';
  const ok2 = stale(['A ', 'C—'], msgs).length === 0 && stale(['Z 不存在'], msgs).join() === 'Z 不存在';
  const ex = expectsOf("const MUTS = [\n  { name: 'X1 一', expect: ['A ', `P ${1 + 1} 秒`] },\n  { name: 'X2 二', expectUnformed: [\"C'—\"] },\n];");
  const ok3 = ex.length === 2 && ex[0].items.length === 2 && ex[0].items[1].dynamic && !ex[0].items[0].dynamic && ex[1].items[0].text === "C'—";
  console.log(`對照組：判定行抽取＝${ok1}、過期判斷兩向＝${ok2}、抽預期與動態判斷＝${ok3}`);
  if (!(ok1 && ok2 && ok3)) { console.log('✗ 對照組沒過——不採信'); process.exit(4); }
}

const RUNNERS = [
  ['predict_mut', 'M0 不改（基準）'], ['timeout_mut', ['T0 不改（基準，worktreeguardtest）', 'T0b 不改（基準，mutatetest）']],
  ['wtg_mut', 'M0 不改（基準）'], ['mut_guard_mut', 'G0 不改（基準）'],
];
const safe = (n) => n.replace(/[^\w一-鿿-]+/g, '_');
let total = 0, dyn = 0, staleN = 0, nonEmpty = 0;
const problems = [];
for (const [r, base] of RUNNERS) {
  const src = fs.readFileSync(path.join(HERE, r + '.mjs'), 'utf8');
  const bases = Array.isArray(base) ? base : [base];
  const msgs = bases.flatMap((b) => {
    const f = path.join(REPO, '.logs', 'mutproof', r, safe(b) + '.txt');
    if (!fs.existsSync(f)) { problems.push(`${r}：找不到基準輸出 ${path.relative(REPO, f)}`); return []; }
    return verdictMessages(fs.readFileSync(f, 'utf8'));
  });
  const ex = expectsOf(src);
  let n = 0;
  for (const e of ex) for (const it of e.items) {
    n++; total++;
    if (it.dynamic) { dyn++; problems.push(`${r} ${e.name}（${e.field}）預期嵌動態內容：${it.text}`); }
    // 「情境未成立」的預期比的是基準裡對應的前置斷言（基準的情境都有成立，不會印 ⊘ 行）：「前置：B——…」去掉「前置：」再比
    const pool = e.field === 'expectUnformed' ? msgs.concat(msgs.filter((x) => x.startsWith('前置：')).map((x) => x.slice(3))) : msgs;
    if (msgs.length && stale([it.text], pool).length) { staleN++; problems.push(`${r} ${e.name}（${e.field}）預期清單過期：「${it.text}」不是任何一條當前斷言的開頭`); }
  }
  if (n) nonEmpty++;
  console.log(`${r}：當前斷言 ${msgs.length} 條、預期字串 ${n} 筆（${ex.length} 組）`);
}
console.log(`母體：驅動 ${RUNNERS.length} 支（有預期的 ${nonEmpty} 支）、預期字串 ${total} 筆；比對方式＝開頭（startsWith）${total} 筆、中間 0 筆；嵌動態內容 ${dyn} 筆；預期清單過期 ${staleN} 筆`);
for (const p of problems) console.log('  ' + p);
process.exitCode = staleN || problems.some((p) => p.includes('找不到基準')) ? 1 : 0;
