// 突變驅動腳本的逐項紀錄（2026-10-02）：給 scripts/evidence.mjs 從 log 產生入庫的逐項證據用。
//   @@EVID-TOTAL {"runner","names":[...]}   開跑前：這次的母體（要跑哪幾條）
//   @@EVID {"runner","name","expect":[...],"expectUnformed":[...],"reds":[...],"unformed":[...],"status","sha"}   每跑完一條
// expect／expectUnformed 是「預期該紅／預期情境未成立」的開頭字串；reds／unformed 是實際紅的那幾行、實際 ⊘ 的那幾行。
// 分類由 evidence.mjs 統一算，不在各支驅動裡各算各的。
export const evidHeader = (runner, names) => console.log('@@EVID-TOTAL ' + JSON.stringify({ runner, names }));
export const evid = (rec) => console.log('@@EVID ' + JSON.stringify(rec));
export const linesOf = (out, mark) => out.split('\n').filter((l) => l.startsWith(mark)).map((l) => l.slice(mark.length));
