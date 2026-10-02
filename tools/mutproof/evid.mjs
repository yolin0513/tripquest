// 突變驅動腳本的逐項紀錄（2026-10-02）：給 scripts/evidence.mjs 從 log 產生入庫的逐項證據用。
//   @@EVID-TOTAL {"runner","names":[...]}   開跑前：這次的母體（要跑哪幾條）
//   @@EVID {"runner","name","expect":[...],"expectUnformed":[...],"reds":[...],"unformed":[...],"status","sha"}   每跑完一條
// expect／expectUnformed 是「預期該紅／預期情境未成立」的開頭字串；reds／unformed 是實際紅的那幾行、實際 ⊘ 的那幾行。
// 分類由 evidence.mjs 統一算，不在各支驅動裡各算各的。
export const evidHeader = (runner, names) => console.log('@@EVID-TOTAL ' + JSON.stringify({ runner, names }));
export const evid = (rec) => console.log('@@EVID ' + JSON.stringify(rec));
export const linesOf = (out, mark) => out.split('\n').filter((l) => l.startsWith(mark)).map((l) => l.slice(mark.length));

// ---------- 預期清單過期的前置（2026-10-02，Dispatch：接進每支驅動開跑前）----------
// 預期清單也會過期（換 fixture、加斷言、改寫原文之後），過期的樣子是「不如預期」——很容易被讀成程式有問題、去修沒壞的東西。
// 所以每支驅動先跑基準，拿它印出的判定行當「當前斷言集合」，逐條核對其餘突變的預期：每一條必須是某條當前斷言的開頭。
// 過期 → 印「◇ 預期清單過期：…」、回 6、不跑其餘突變——獨立的結果，不跟「不如預期」（✗）共用。
// 「情境未成立」的預期比的是基準裡對應的「前置：…」斷言（基準的情境都成立，不會印 ⊘ 行）。
export const verdictMessages = (out) => out.split('\n')
  .filter((l) => /^(✓|✗|⊘ 情境未成立：) ?/.test(l))
  .map((l) => l.replace(/^(✓ |✗ |⊘ 情境未成立：)/, ''));
export const itemsOf = (muts, fields) => muts.flatMap((m) => fields.flatMap((f) => (m[f] || []).map((text) => ({ name: m.name, field: f, text }))));
export function staleItems(items, messages) {
  const pool = messages.concat(messages.filter((x) => x.startsWith('前置：')).map((x) => x.slice(3)));
  return items.filter((it) => !pool.some((p) => p.startsWith(it.text)));
}
export function expectGate(runner, baseName, out, items, { messages } = {}) {
  const msgs = messages || verdictMessages(out);
  if (!msgs.length) { console.log(`◇ 預期清單檢查做不了（${runner}）：基準「${baseName}」沒有印出任何判定行`); return false; }
  const stale = staleItems(items, msgs);
  console.log(`預期清單檢查（${runner}，以「${baseName}」為當前斷言）：當前斷言 ${msgs.length} 條、預期 ${items.length} 筆、過期 ${stale.length} 筆`);
  for (const s of stale) console.log(`◇ 預期清單過期：${s.name}（${s.field}）「${s.text}」不是任何一條當前斷言的開頭`);
  return stale.length === 0;
}
export function gateOrExit(ok) {
  if (!ok) { console.log('◇ 預期清單過期——不跑其餘突變（回 6；這不是「不如預期」）'); process.exit(6); }
}
