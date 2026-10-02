// 兩次跑同一個情境的 log 逐條比對判定行（2026-10-02）：
//   判定行＝以「✓ 」或「✗ 」開頭的行；拿掉「（實得…）」與秒數之後逐行比。先印兩邊的母體行數——
//   第一版用 grep 的 [✓✗] 方括號抓判定行，在這台機器上一行都抓不到，兩份空清單互比得到「差異 0」，差點當成逐行相同報出去。
//   對照組兩向（同一個比對程式）：把其中一行的 ✓ 改成 ✗ → 必須有差異；自己比自己 → 必須沒有差異；母體 0 行 → 判檢查器壞了。
//   node tools/ev/compare-runs.mjs <log A> <log B>
import fs from 'node:fs';

export const verdicts = (text) => text.split('\n')
  .filter((l) => l.startsWith('✓ ') || l.startsWith('✗ '))
  .map((l) => l.replace(/（實得[^）]*）/g, '').replace(/\d+(\.\d+)? 秒/g, '# 秒'));
export function diffLines(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push({ i: i + 1, a: a[i] ?? '（沒有）', b: b[i] ?? '（沒有）' });
  return out;
}

const [A, B] = process.argv.slice(2);
const va = verdicts(fs.readFileSync(A, 'utf8')), vb = verdicts(fs.readFileSync(B, 'utf8'));
// 對照組
const changed = va.slice(); const k = changed.findIndex((l) => l.startsWith('✓ '));
if (k >= 0) changed[k] = '✗ ' + changed[k].slice(2);
const c1 = diffLines(va, changed).length, c0 = diffLines(va, va).length;
console.log(`對照組：改一行 → 差異 ${c1} 行（要 1）；自己比自己 → 差異 ${c0} 行（要 0）`);
if (!va.length || !vb.length || c1 !== 1 || c0 !== 0) { console.log(`✗ 比對器壞了或母體是空的（A ${va.length} 行、B ${vb.length} 行）——不下結論`); process.exit(4); }
const d = diffLines(va, vb);
const cnt = (v, s) => v.filter((l) => l.startsWith(s)).length;
console.log(`母體：A 判定行 ${va.length} 行（✓ ${cnt(va, '✓ ')}、✗ ${cnt(va, '✗ ')}）；B ${vb.length} 行（✓ ${cnt(vb, '✓ ')}、✗ ${cnt(vb, '✗ ')}）`);
console.log(`逐行比對：差異 ${d.length} 行`);
for (const x of d.slice(0, 10)) console.log(`  第 ${x.i} 行：A「${x.a.slice(0, 60)}」／B「${x.b.slice(0, 60)}」`);
process.exitCode = d.length ? 1 : 0;
