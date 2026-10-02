// 突變驅動腳本的逐項紀錄（2026-10-02）：給 scripts/evidence.mjs 從 log 產生入庫的逐項證據用。
//   @@EVID-TOTAL {"runner","names":[...]}   開跑前：這次的母體（要跑哪幾條）
//   @@EVID {"runner","name","expect":[...],"expectUnformed":[...],"reds":[...],"unformed":[...],"status","sha"}   每跑完一條
// expect／expectUnformed 是「預期該紅／預期情境未成立」的開頭字串；reds／unformed 是實際紅的那幾行、實際 ⊘ 的那幾行。
// 分類由 evidence.mjs 統一算，不在各支驅動裡各算各的。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const evidHeader =(runner, names) => console.log('@@EVID-TOTAL ' + JSON.stringify({ runner, names }));
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
// 斷言母體的指紋：拿掉每次會變的內容（括號裡的實得值、數字），排序後雜湊。寫預期的當時登記，之後斷言增減就看得出來。
const norm = (m) => m.replace(/（[^）]*）/g, '').replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
export function fingerprint(messages) {
  const set = [...new Set(messages.map(norm))].sort();
  return { count: set.length, hash: crypto.createHash('sha1').update(set.join('\n')).digest('hex').slice(0, 12), set };
}
// 刻意寫成「整組開頭」的預期（結尾是空白或 —）可以對到好幾條；其餘的要剛好對到一條
const isGroupPrefix = (t) => /[ —]$/.test(t);
export function ambiguousItems(items, messages) {
  return items.filter((it) => !isGroupPrefix(it.text)).map((it) => ({ ...it, n: messages.filter((m) => m.startsWith(it.text)).length })).filter((it) => it.n > 1);
}
const REG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'expect-registry.json');
export function readRegistry(file = REG) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }

// 回傳 'ok'｜'stale'｜'review'｜'ambiguous'｜'none'
export function expectCheck(runner, baseName, out, items, { messages, registry = REG, accept = process.argv.includes('--accept-review') } = {}) {
  const msgs = messages || verdictMessages(out);
  if (!msgs.length) { console.log(`◇ 預期清單檢查做不了（${runner}）：基準「${baseName}」沒有印出任何判定行`); return 'none'; }
  const stale = staleItems(items, msgs);
  const amb = ambiguousItems(items, msgs);
  const fp = fingerprint(msgs);
  const reg = readRegistry(registry);
  const key = `${runner}｜${baseName}`;
  const was = reg[key];
  console.log(`預期清單檢查（${runner}，以「${baseName}」為當前斷言）：當前斷言 ${msgs.length} 條（指紋 ${fp.count} 種、${fp.hash}）、預期 ${items.length} 筆、過期 ${stale.length} 筆、不唯一 ${amb.length} 筆、登記的指紋 ${was ? `${was.count} 種、${was.hash}（${was.at}）` : '沒有'}`);
  for (const s of stale) console.log(`◇ 預期清單過期：${s.name}（${s.field}）「${s.text}」不是任何一條當前斷言的開頭`);
  for (const a of amb) console.log(`◇ 預期不唯一：${a.name}（${a.field}）「${a.text}」同時是 ${a.n} 條斷言的開頭`);
  if (stale.length) return 'stale';
  if (amb.length) return 'ambiguous';
  if (!was || accept) {
    reg[key] = { count: fp.count, hash: fp.hash, at: new Date().toISOString().slice(0, 10), set: fp.set };
    fs.writeFileSync(registry, JSON.stringify(reg, null, 2) + '\n');
    console.log(`登記斷言母體（${was ? '複審後重新登記' : '首次'}）：${key} → ${fp.count} 種、${fp.hash}`);
    return 'ok';
  }
  if (was.hash !== fp.hash) {
    const added = fp.set.filter((x) => !was.set.includes(x)), gone = was.set.filter((x) => !fp.set.includes(x));
    console.log(`◇ 預期需要複審：${key} 的斷言母體變了（${was.count} → ${fp.count} 種；新增 ${added.length}：${added.slice(0, 5).join('／')}；少了 ${gone.length}：${gone.slice(0, 5).join('／')}）——新增的斷言可能沒有任何預期守著，複審預期後加 --accept-review 重新登記`);
    return 'review';
  }
  return 'ok';
}
export const expectGate = (...a) => expectCheck(...a);
const EXIT = { stale: 6, review: 7, ambiguous: 8, none: 6 };
export function gateOrExit(res) {
  if (res === true || res === 'ok') return;
  const r = res === false ? 'none' : res;
  const why = { stale: '預期清單過期', review: '預期需要複審', ambiguous: '預期不唯一', none: '預期清單檢查做不了' }[r];
  console.log(`◇ ${why}——不跑其餘突變（回 ${EXIT[r]}；這不是「不如預期」）`);
  process.exit(EXIT[r]);
}
