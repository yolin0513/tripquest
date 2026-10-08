// 共用慣例副本要跟主檔一致（2026-10-08，照 MealMate 的 scripts/convcheck.mjs 抄過來、改成本專案的樣子）。
// 起因（Dispatch）：副本過期時，過期的規則和現行的規則在閱讀時長得一樣——都叫「共用慣例」、都讀得通，沒有任何地方會告訴你
// 手上那份過期了。本專案的副本停在 v9 時，主檔早就是 v11.6（MealMate 2026-10-08 發現的，它只讀、沒碰）。
// 由 scripts/convtest.mjs 驗（在 test:chain 裡、而且在底線，每次 test:affected 都跑）。
//
// 主檔：統籌工作區的 CONVENTIONS.md（Dispatch 2026-10-08 確認）。路徑用相對於本 repo 根目錄的寫法登記在這裡
// （不寫本機絕對路徑：repo 是公開的）。搬家了就改這一行。
// **換一台沒有統籌工作區的機器，這道檢查會紅（讀不到主檔）——刻意的**：靜默跳過的版本比對等於沒有版本比對，紅了至少會有人問為什麼。
// 判定：讀不到主檔＝紅（講明「讀不到主檔」，不當成通過）；副本與主檔是同一個實體檔＝紅（拿自己比自己永遠一致）；
// 版本行不同＝紅；版本行相同、全文不同＝紅（主檔改了內容卻沒改版本，或副本被手改過）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MASTER_REL = '../../Fable_Planner/CONVENTIONS.md';
export const COPY_REL = 'docs/CONVENTIONS.md';

/** 第一行的版本標記：<!-- CONVENTIONS vX 日期 -->；不是這個樣子就回 null */
export function versionLine(text) {
  const first = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)[0];
  return /^<!-- CONVENTIONS v[\d.]+ \d{4}-\d{2}-\d{2} -->$/.test(first) ? first : null;
}

/** 比對副本與主檔的內容（純函式）：{ ok, why } */
export function compareConv(copyText, masterText) {
  if (masterText == null) return { ok: false, why: '讀不到主檔' };
  if (copyText == null) return { ok: false, why: '讀不到副本' };
  const cv = versionLine(copyText); const mv = versionLine(masterText);
  if (!mv) return { ok: false, why: '主檔第一行不是版本標記' };
  if (!cv) return { ok: false, why: '副本第一行不是版本標記' };
  if (cv !== mv) return { ok: false, why: `版本不同：副本 ${cv}、主檔 ${mv}——副本過期，照主檔更新（照統籌者的工單）` };
  const norm = (t) => String(t).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (norm(copyText) !== norm(masterText)) return { ok: false, why: `版本相同（${cv}）但全文不同——主檔改了內容卻沒改版本，或副本被改過` };
  return { ok: true, why: `一致（${cv}）` };
}

/** 兩個路徑是不是同一個實體檔（實體路徑相同，或同一個檔案編號——硬連結也算）；讀不到就回 null */
export function sameFile(a, b) {
  try {
    const ra = fs.realpathSync.native(a).toLowerCase(), rb = fs.realpathSync.native(b).toLowerCase();
    const sa = fs.statSync(a, { bigint: true }), sb = fs.statSync(b, { bigint: true });
    return ra === rb || (sa.ino !== 0n && sa.ino === sb.ino && sa.dev === sb.dev);
  } catch { return null; }
}

/** 從 repo 根目錄讀兩份來比 */
export function convCheck(root, { masterRel = MASTER_REL, copyRel = COPY_REL } = {}) {
  const m = path.resolve(root, masterRel), c = path.resolve(root, copyRel);
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const mt = read(m), ct = read(c);
  if (mt == null) return { ok: false, why: '讀不到主檔' };
  if (ct == null) return { ok: false, why: '讀不到副本' };
  // 先確認是兩個不同的實體檔，再比內容——指錯（或被連結起來）時，自己跟自己比永遠一致
  const same = sameFile(c, m);
  if (same !== false) return { ok: false, why: same ? '副本與主檔是同一個實體檔（拿自己比自己）' : '判斷不了副本與主檔是不是同一個檔' };
  return compareConv(ct, mt);
}

const HERE = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === HERE.toLowerCase()) {
  const r = convCheck(path.resolve(path.dirname(HERE), '..'));
  console.log(`${r.ok ? '✓' : '✗'} 共用慣例副本：${r.why}`);
  process.exitCode = r.ok ? 0 : 1;
}
