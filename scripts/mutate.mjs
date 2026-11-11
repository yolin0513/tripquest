// App 程式的突變執行器（2026-10-02 從 Session 暫存區搬進 repo；護欄照 MealMate docs/HOWTO_範圍化突變與帳本.md 第七節）
//
//   node scripts/mutate.mjs <mutations.json> [名稱...]           嚴格：進版控的檔必須等於 HEAD
//   node scripts/mutate.mjs --only <mutations.json> [名稱...]    寫新斷言、還沒 commit 時證明會紅：工作區可以不乾淨，
//                                                               但目標檔不能已經含這條突變「改壞後」的字串（HEAD 那版沒有的話）
//   node scripts/mutate.mjs --recover                           只做啟動時的還原檢查就結束
//
// 每一條：把 file 裡的 find（字面字串，必須恰好出現一次）換成 replace → 跑 cmd → 還原。期望 cmd 失敗（exit ≠ 0）。
//
// 先跑原樣、數母體（2026-11-11 守夜；修「被打斷的測試也印總結行、被記成紅」的盲點）：
//   突變之前，每一種「cmd＋總結行樣式」先跑一次沒改的（共用慣例 §5.11：先在同一個環境跑一次原樣、確認是綠的），
//   數它印了幾項＝母體。項目＝子程序輸出裡行首是 ✓ 或 ✗ 的行（不靠各測試的總結行——格式十幾種、很多只印通過數）。
//   原樣不成立（逾時、崩潰、結束碼不是 0、一項都數不到）→ 那一組的突變一條都不跑，回 3。
//   突變那一次分四種結束方式，各有行首字樣與回傳值：
//     正常結束——有總結行、項數＝母體：結束碼非 0 是「✓ 紅了」，0 是「✗ 沒紅」（回 1）
//     崩潰——沒有最後那一行總結（丟例外沒接住、被強制停掉）：「⊘ 崩潰」（回 7）
//     逾時——超過時限被整棵殺掉：「⊘ 逾時」（回 8）
//     沒跑完——有總結行，但項數比母體少（測試接住例外、印了總結就結束）：「⊘ 沒跑完」；比母體多：「⊘ 項數不符」（都回 9）
//   後三種都是「沒有結果」：帳本記 no-result，不算紅、也不算跑過。
//   為什麼不能只看總結行：2026-11-11 legviewtest 被時序問題打斷在 7/25 項，測試接住例外、照樣印「6 項通過、1 項失敗」，
//   執行器記成紅（第 547、550、557、560、561、563、565、567 次）。環境出錯的方式有無數種，結果只有一種：項數不夠。
//
// 為什麼要護欄：原本直接改主工作區、只靠 finally 寫回。程式被殺掉、當機、斷電時 finally 不會跑，壞檔留在工作區，
// 下一次 commit 可能帶出去；下一次開跑還會把壞檔當成原檔備份，「還原」把壞檔還原回去。
//
// 兩處紀錄（都在 .logs/，被 .gitignore 擋掉、不算工作區改動）：
//   · 帳本 .logs/mutate-ledger.jsonl：每次開跑先記「第 N 次開跑」（含目標檔與原檔雜湊），還原完成、刪掉還原紀錄之後記「第 N 次完成」。
//   · 還原紀錄 .logs/mutate-pending.json：第 N 次、目標檔路徑、原檔雜湊、**原檔的完整內容**。
//   順序：帳本「開跑」→ 還原紀錄 → 改壞 → 跑 → 寫回 → 核對雜湊 → 刪還原紀錄 → 帳本「完成」。兩個紀錄都寫完才 fsync 下一步。
// 啟動時第一件事：
//   · 有還原紀錄：帳本最後一筆未收尾的必須是同一次、同一支檔，否則拒絕（回 6）；一致 → 照它寫回原檔、核對雜湊、刪掉、帳本記「第 N 次中斷後已還原」。
//   · 沒有還原紀錄、帳本卻有未收尾的：那支檔現在的雜湊 ≠ 帳本記的原檔雜湊 → 拒絕（回 5），指出第幾次、哪支檔；
//     相等 → 照跑並註明（中斷落在「刪還原紀錄」與「記完成」之間時就是這樣，檔案沒事；一律拒絕會變成永遠關著的閘）。
// 回傳值：0 照預期（每一條都正常結束、跑滿母體、紅了）；1 有突變沒紅；2 工作區不符、清單被拒、或 find 對不上（沒套上）；
//   3 原樣不成立（那一組沒跑）；4 檢查器自己壞了（讀不到、還原後雜湊不對、各類相加對不上）；5 上次中斷、還原紀錄不見；
//   6 兩處紀錄不一致；7 有突變崩潰；8 有突變逾時；9 有突變項數不對母體（沒跑完或多了）。
//   好幾條結果不同時照 CODE_ORDER 取第一個出現的（沒紅先講——那是確定的發現），最後一行列出每一類各幾條。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runWithTimeout } from './run-timeout.mjs';
import { fileURLToPath } from 'node:url';
import { snapshot } from './worktree-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOGS = path.join(ROOT, '.logs');
const LEDGER = path.join(LOGS, 'mutate-ledger.jsonl');
const PENDING = path.join(LOGS, 'mutate-pending.json');
export const DONE_RE = /^\s*(\d+ 項通過|✓ 全部通過)/m;   // 測試最後那一行總結（見「跑完」那一段）
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
// 「是不是原樣」比的是統一行尾之後的內容：人工用 git 還原時，另一台機器的 core.autocrlf 可能給出 CRLF
// （MealMate 2026-10-02 撞到：暫存 repo 沒帶 .gitattributes，還原出來的檔被判成不是原樣、每次都被拒絕）。
// 這個比法假設「突變不會只改行尾或空白」——由下面的 lintMutations 在登記時強制，不靠大家記得。
const shaNorm = (buf) => sha1(Buffer.isBuffer(buf) ? buf.toString('utf8').replace(/\r\n/g, '\n') : String(buf).replace(/\r\n/g, '\n'));
const stripWs = (s) => String(s).replace(/\r\n/g, '\n').replace(/\s+/g, '');

// 只差空白／行尾的突變：統一行尾、去掉所有空白之後 find 與 replace 相同 → 突變什麼都沒改，卻可能「顯示通過」
export function lintMutations(list) {
  const bad = [];
  for (const m of list) {
    const edits = m.edits || [{ find: m.find, replace: m.replace }];
    if (edits.some((e) => typeof e.find !== 'string' || typeof e.replace !== 'string' || stripWs(e.find) === stripWs(e.replace))) bad.push(m.name);
  }
  return { checked: list.length, bad };
}
// cmd 只准「node scripts/<名字>.mjs」一種形狀（2026-10-27）：下面用 shell 跑 cmd，清單檔是改得到的資料。
// 權限規則只認 mutate 這一行，規則管不到它開出來的子程序——清單裡順手帶了 &&、重導向、別的參數的 cmd
// 會被一起放行。防的是意外，不是故意。
export const CMD_RE = /^node scripts\/[a-z0-9-]+\.mjs$/;
export function lintCmds(list) {
  const bad = list.filter((m) => typeof m.cmd !== 'string' || !CMD_RE.test(m.cmd)).map((m) => m.name);
  return { checked: list.length, bad };
}
const short =(s) => String(s).slice(0, 12);

// ---------- 跑完沒：數項數，對原樣的母體 ----------
// 不算項目的行（登記制：只登記實際在突變紀錄裡看過、逐行看過的；比對行首字首）：
//   「✗ 例外」——測試接住例外時印的，不是斷言（2026-11-11 盤 355 份 .logs/mutate-out.*.log：19 行）。
//     不排除它的話，打斷在最後一項之前、再多印一行「✗ 例外」，項數剛好湊回母體。
//   「✗ 對照組沒過——」——mutstale、mutlint 對照組沒過時多印的結論行（同一次盤點：19 行，只在這兩支）。那兩支的項目是
//     每個對照組一行 ✓／✗，結論行只在沒過時印；算進去的話，每一次真的紅都會多一項、被判成「項數不符」。
//     （第一次盤點時漏看了這一種、註解寫成「其他非斷言的 ✗ 行都沒出現過」——2026-11-11 用新規則回頭數 mutstale 的紀錄才發現，已更正。）
//   新的非斷言行會讓項數多於母體 →「⊘ 項數不符」、沒有結果（保守的方向：不會把沒跑完的記成紅），看過再補登。
export const NON_ITEM = ['✗ 例外', '✗ 對照組沒過——'];
export const countItems = (out) => String(out || '').split(/\r?\n/).filter((l) => /^[✓✗]/.test(l) && !NON_ITEM.some((p) => l.startsWith(p))).length;
// 一次子程序怎麼結束的（原樣與突變共用）：timeout 逾時被殺／crash 沒有總結行或被外力停掉／ended 正常結束
export function endKind(r, doneRe) {
  if (r.timedOut) return 'timeout';
  if (r.status === null || !doneRe.test(r.out || '')) return 'crash';
  return 'ended';
}
// 原樣那一次：正常結束、結束碼 0、數得到項目，才拿來當母體
export function judgeBase(r, doneRe) {
  const items = countItems(r.out);
  const end = endKind(r, doneRe);
  if (end !== 'ended') return { kind: end, items };
  if (r.status !== 0) return { kind: 'not-green', items };
  if (!items) return { kind: 'zero', items };
  return { kind: 'ok', items };
}
// 突變那一次：正常結束而且項數＝母體，才看結束碼分紅／沒紅
export function judge(r, doneRe, pop) {
  const items = countItems(r.out);
  const end = endKind(r, doneRe);
  if (end !== 'ended') return { kind: end, items };
  if (items < pop) return { kind: 'short', items };
  if (items > pop) return { kind: 'extra', items };
  return { kind: r.status !== 0 ? 'red' : 'not-red', items };
}
export const KIND = {
  red: { mark: '✓', label: '紅了', result: 'red', code: 0 },
  'not-red': { mark: '✗', label: '沒紅', result: 'not-red', code: 1 },
  crash: { mark: '⊘', label: '崩潰', result: 'no-result', code: 7 },
  timeout: { mark: '⊘', label: '逾時', result: 'no-result', code: 8 },
  short: { mark: '⊘', label: '沒跑完', result: 'no-result', code: 9 },
  extra: { mark: '⊘', label: '項數不符', result: 'no-result', code: 9 },
  unapplied: { mark: '⊘', label: '沒套上', result: null, code: 2 },
  nobase: { mark: '⊘', label: '沒跑', result: null, code: 3 },
};
export const CODE_ORDER = ['not-red', 'unapplied', 'short', 'extra', 'timeout', 'crash', 'nobase'];
const BASE_WHY = {
  timeout: '原樣逾時被殺', crash: '原樣崩潰（沒有最後那一行總結）', 'not-green': '原樣不是綠的', zero: '原樣一項都數不到（沒有行首是 ✓／✗ 的行，無法判斷突變那次有沒有跑完）',
};

function fsyncWrite(file, data, flag = 'w') {
  const fd = fs.openSync(file, flag);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
// 帳本第一行的說明（新建時寫入，--no-result 也會印）。等本 App 有了「依帳本挑選要跑哪些突變」的機制，
// 再把這段拿掉，並補「沒有結果的會被挑進來」的對照組。
export const LEDGER_NOTE = '注意：result＝no-result（逾時被殺、沒跑完、中斷後還原）目前**不影響任何選擇**——本 App 還沒有依帳本挑選突變的機制，'
  + '這個欄位只是紀錄。不要以為標了 no-result 的突變下次會自動被跑；要跑請自己指定。';
const ledgerAdd = (e) => {
  fs.mkdirSync(LOGS, { recursive: true });
  if (!fs.existsSync(LEDGER)) fsyncWrite(LEDGER, JSON.stringify({ note: LEDGER_NOTE }) + '\n', 'a');
  fsyncWrite(LEDGER, JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n', 'a');
};
// 每條突變「最近一次收尾」是沒有結果的（逾時被殺、被中斷後還原、還原紀錄不見但檔案沒事）
export function noResult(entries) {
  const last = new Map();
  for (const e of entries) if (e.event && e.event !== 'started' && e.name) last.set(e.name, e);
  return [...last.values()].filter((e) => e.result === 'no-result');
}

function readLedger() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`帳本第 ${i + 1} 行讀不懂`); }
  });
}
// 帳本裡最後一次「開跑」之後有沒有收尾
function openRun(entries) {
  const started = entries.filter((e) => e.event === 'started');
  const last = started[started.length - 1];
  if (!last) return null;
  const closed = entries.some((e) => e.seq === last.seq && e.event !== 'started');
  return closed ? null : last;
}
const nextSeq = (entries) => entries.reduce((m, e) => Math.max(m, e.seq || 0), 0) + 1;
const fileSha = (relPath) => { try { return sha1(fs.readFileSync(path.join(ROOT, relPath))); } catch (e) { return e.code === 'ENOENT' ? 'missing' : 'unreadable'; } };
const fileShaNorm = (relPath) => { try { return shaNorm(fs.readFileSync(path.join(ROOT, relPath))); } catch (e) { return e.code === 'ENOENT' ? 'missing' : 'unreadable'; } };

// ---------- 啟動時：照兩處紀錄處理上一次的中斷 ----------
function startupCheck() {
  let entries, pending = null;
  try { entries = readLedger(); } catch (e) { console.log(`✗ ${e.message}（${rel(LEDGER)}）——不自動處理，請人看過`); return 4; }
  if (fs.existsSync(PENDING)) {
    try { pending = JSON.parse(fs.readFileSync(PENDING, 'utf8')); }
    catch (e) { console.log(`✗ 還原紀錄 ${rel(PENDING)} 讀不懂（${e.message}）——不自動處理，請人看過`); return 4; }
  }
  const open = openRun(entries);
  if (pending) {
    if (!open || open.seq !== pending.seq || open.file !== pending.file || open.sha !== pending.sha) {
      console.log(`✗ 兩處紀錄不一致：還原紀錄是第 ${pending.seq} 次（${pending.file}），帳本未收尾的是 ${open ? `第 ${open.seq} 次（${open.file}）` : '沒有'}——不自動還原，請人看過`);
      return 6;
    }
    const buf = Buffer.from(pending.content, 'base64');
    if (sha1(buf) !== pending.sha) { console.log(`✗ 還原紀錄裡的原檔內容雜湊不對（第 ${pending.seq} 次，${pending.file}）——不還原`); return 4; }
    fs.writeFileSync(path.join(ROOT, pending.file), buf);
    if (fileSha(pending.file) !== pending.sha) { console.log(`✗ ${pending.file} 還原後雜湊仍不對——還原紀錄保留`); return 4; }
    fs.rmSync(PENDING);
    if (fs.existsSync(PENDING)) { console.log('✗ 還原完成，但還原紀錄刪不掉——停下'); return 4; }
    ledgerAdd({ seq: pending.seq, event: 'recovered', name: pending.name, file: pending.file, result: 'no-result', reason: '被中斷、啟動時還原' });
    console.log(`上一次被中斷（第 ${pending.seq} 次，突變「${pending.name}」），已還原 ${pending.file} → ${short(pending.sha)}`);
    return 0;
  }
  if (open) {
    // 統一行尾之後比（人工 git 還原可能給出 CRLF）；舊紀錄沒有 shaNorm 的退回原始雜湊
    const now = open.shaNorm ? fileShaNorm(open.file) : fileSha(open.file);
    const want = open.shaNorm || open.sha;
    if (now !== want) {
      console.log(`✗ 第 ${open.seq} 次開跑（突變「${open.name}」）沒有收尾，還原紀錄卻不在；${open.file} 現在是 ${short(now)}，原檔應為 ${short(want)}（統一行尾後比）——上次中斷過、紀錄被移掉，請人工確認工作區（git diff ${open.file}）`);
      return 5;
    }
    ledgerAdd({ seq: open.seq, event: 'closed-file-ok', name: open.name, file: open.file, result: 'no-result', reason: '被中斷、還原紀錄不在但檔案是原樣' });
    console.log(`註：第 ${open.seq} 次開跑沒有收尾、還原紀錄不在，但 ${open.file} 統一行尾後的雜湊等於原檔——照跑`);
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const rc0 = startupCheck();
  if (rc0) return rc0;
  if (args[0] === '--recover') return 0;
  if (args[0] === '--no-result') {
    let entries;
    try { entries = readLedger(); } catch (e) { console.log(`✗ ${e.message}`); return 4; }
    console.log(LEDGER_NOTE);
    const list = noResult(entries);
    console.log(`帳本 ${entries.filter((e) => e.event).length} 筆、涉及 ${new Set(entries.filter((e) => e.name).map((e) => e.name)).size} 條突變；最近一次沒有結果的 ${list.length} 條：`);
    for (const e of list) console.log(`   ${e.name}（第 ${e.seq} 次，${e.reason || e.event}，${e.at}）`);
    return 0;
  }

  const onlyMode = args[0] === '--only';
  const [listFile, ...names] = onlyMode ? args.slice(1) : args;
  if (!listFile) { console.log('用法：node scripts/mutate.mjs [--only] <mutations.json> [名稱...]'); return 2; }
  const all = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  // 登記時的檢查：整份清單，不只這次選到的
  const lint = lintMutations(all);
  console.log(`檢查 ${lint.checked}/${all.length} 條突變，${lint.bad.length} 條只改空白或行尾`);
  if (lint.checked !== all.length || !all.length) { console.log('✗ 檢查的筆數不等於清單的筆數——檢查器壞了'); return 4; }
  if (lint.bad.length) { console.log(`✗ 這些突變只改了空白或行尾（統一行尾後判斷「是不是原樣」會看不出差別），拒絕：${lint.bad.join('、')}`); return 2; }
  const lc = lintCmds(all);
  console.log(`檢查 ${lc.checked}/${all.length} 條 cmd，${lc.bad.length} 條不是「node scripts/<名字>.mjs」`);
  if (lc.checked !== all.length) { console.log('✗ 檢查的 cmd 筆數不等於清單的筆數——檢查器壞了'); return 4; }
  if (lc.bad.length) { console.log(`✗ 這些突變的 cmd 不是「node scripts/<名字>.mjs」（會用 shell 執行），整份拒絕：${lc.bad.join('、')}`); return 2; }
  const list = all.filter((m) => !names.length || names.includes(m.name));
  if (!list.length) { console.log('✗ 一條突變都沒選到'); return 2; }
  const editsOf = (m) => m.edits || [{ find: m.find, replace: m.replace }];

  // 護欄一：工作區
  let dirty;
  try { dirty = snapshot({ root: ROOT, untracked: 'no' }); }
  catch (e) { console.log(`✗ 讀不到工作區狀態（不是 git repo，或 git 失敗：${String(e.message).split('\n')[0]}）——不當成乾淨，停下`); return 2; }
  if (!onlyMode && dirty.size) {
    console.log(`✗ 工作區有 ${dirty.size} 個進版控的檔跟 HEAD 不一樣，拒絕跑突變：${[...dirty.keys()].join('、')}`);
    return 2;
  }
  if (onlyMode) {
    for (const m of list) {
      const now = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
      let head = '';
      try { head = execFileSync('git', ['show', `HEAD:${m.file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { head = ''; }
      const already = editsOf(m).filter((e) => e.replace && now.includes(e.replace) && !head.includes(e.replace));
      if (already.length) {
        console.log(`✗ --only：${m.file} 已經含突變「${m.name}」改壞後的字串、HEAD 那版沒有——像是上一次沒還原，拒絕`);
        return 2;
      }
    }
    if (dirty.size) console.log(`註：--only 模式，工作區有 ${dirty.size} 個進版控的檔跟 HEAD 不一樣（允許）`);
  }

  // 原樣基準：每一種「cmd＋總結行樣式」跑一次沒改的，數母體。逾時取那一組裡最長的。
  fs.mkdirSync(LOGS, { recursive: true });
  const groupKey = (m) => `${m.cmd}\u0000${m.done || ''}`;
  const bases = new Map();
  for (const m of list) {
    const k = groupKey(m);
    if (bases.has(k)) continue;
    const timeoutMs = Math.max(...list.filter((x) => groupKey(x) === k).map((x) => x.timeoutMs || 400000));
    const doneRe = m.done ? new RegExp(m.done, 'm') : DONE_RE;
    const seq = nextSeq(readLedger());
    const r = await runWithTimeout(m.cmd, [], { cwd: ROOT, shell: true, timeoutMs });
    const b = judgeBase(r, doneRe);
    fs.writeFileSync(path.join(LOGS, `mutate-base.${seq}.log`), r.out || '');
    // 不帶 name、不帶 result：帳本的讀者（--no-result、mutstale）只認有 result 的突變紀錄，原樣不是突變
    ledgerAdd({ seq, event: 'baseline', cmd: m.cmd, ...(m.done ? { done: m.done } : {}), outcome: b.kind, items: b.items, status: r.status });
    bases.set(k, { ...b, seq, doneRe, timeoutMs });
    if (b.kind === 'ok') console.log(`原樣｜${m.cmd}：正常結束、結束碼 0、母體 ${b.items} 項（數行首 ✓／✗ 的行；第 ${seq} 次，全文 .logs/mutate-base.${seq}.log）`);
    else {
      const why = b.kind === 'timeout' ? `${BASE_WHY.timeout}（${timeoutMs / 1000} 秒）` : b.kind === 'not-green' ? `${BASE_WHY['not-green']}（結束碼 ${r.status}）` : BASE_WHY[b.kind];
      const tail = (r.out || '').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-8);
      console.log(`⊘ 原樣不成立｜${m.cmd}：${why}——這一組的突變一條都不跑（第 ${seq} 次，全文 .logs/mutate-base.${seq}.log）\n${tail.map((l) => '     │ ' + l.slice(0, 160)).join('\n')}`);
    }
  }

  const outcomes = [];   // 每一條突變的結果，各一筆；最後各類相加要等於選到的條數
  const runSeqs = [];
  for (const m of list) {
    const base = bases.get(groupKey(m));
    if (!base || base.kind !== 'ok') { outcomes.push({ name: m.name, kind: 'nobase' }); console.log(`⊘ 沒跑｜${m.name}：原樣不成立（見上面「原樣不成立」那一行）`); continue; }
    const f = path.join(ROOT, m.file);
    const orig = fs.readFileSync(f);
    let text = orig.toString('utf8'), okAll = true;
    for (const e of editsOf(m)) {
      const n = text.split(e.find).length - 1;
      if (n !== 1) { console.log(`⊘ 沒套上｜${m.name}：find 出現 ${n} 次（要恰好 1 次），沒跑\n     ${e.find.slice(0, 80)}`); okAll = false; break; }
      text = text.replace(e.find, e.replace);
    }
    if (!okAll) { outcomes.push({ name: m.name, kind: 'unapplied' }); continue; }
    if (fs.existsSync(PENDING)) { console.log('✗ 要寫還原紀錄時發現它已經存在（上一支還沒收尾）——停下'); return 6; }
    const sha = sha1(orig);
    const seq = nextSeq(readLedger());
    ledgerAdd({ seq, event: 'started', name: m.name, file: m.file, sha, shaNorm: shaNorm(orig) });
    fsyncWrite(PENDING, JSON.stringify({ seq, name: m.name, file: m.file, sha, shaNorm: shaNorm(orig), content: orig.toString('base64') }));
    fs.writeFileSync(f, text);
    let r;
    try {
      // 逾時整棵程序樹殺掉（spawnSync 的 timeout 在 Windows 只殺得到 shell，真正的測試會留著）
      r = await runWithTimeout(m.cmd, [], { cwd: ROOT, shell: true, timeoutMs: m.timeoutMs || 400000 });
    } finally {
      fs.writeFileSync(f, orig);
    }
    if (sha1(fs.readFileSync(f)) !== sha) { console.log(`✗ ${m.file} 還原後雜湊不對——還原紀錄保留，下次啟動會照它還原`); return 4; }
    fs.rmSync(PENDING);
    // 結果：紅了／沒紅／沒有結果（崩潰、逾時、沒跑完、項數不符）。**沒有結果不是通過**——記成跑過了，下一次就會被當成「跑過了」而跳過。
    // 有總結行不等於跑完（2026-11-11）：測試接住例外、印了總結就結束，結束碼 1、跟斷言失敗一模一樣——所以還要項數＝原樣的母體。
    // 沒有總結行＝崩潰（2026-10-02，MealMate：Windows 上被強制停掉時結束碼也是 1）。
    // 總結行預設是「N 項通過」或「✓ 全部通過」，測試不一樣的在清單裡寫 done（regex 字串）；原樣那一次用同一個樣式，樣式過期會在原樣就擋下。
    const j = judge(r, base.doneRe, base.items);
    const result = KIND[j.kind].result;
    const why = j.kind === 'timeout' ? `逾時 ${(m.timeoutMs || 400000) / 1000} 秒被殺`
      : j.kind === 'crash' ? `崩潰：沒有最後那一行總結（結束碼 ${r.status}，丟了例外沒接住或被強制停掉）`
        : j.kind === 'short' ? `沒跑完：只跑了 ${j.items}/${base.items} 項（結束碼 ${r.status}）`
          : j.kind === 'extra' ? `項數不符：跑了 ${j.items} 項、原樣是 ${base.items} 項（結束碼 ${r.status}）` : null;
    ledgerAdd({ seq, event: 'done', name: m.name, file: m.file, result, kind: j.kind, items: j.items, pop: base.items, base: base.seq, ...(why ? { reason: why } : {}) });
    outcomes.push({ name: m.name, kind: j.kind });
    runSeqs.push(seq);
    // 每一次都把子程序的全文留下來（不只沒有結果的時候）：判「紅的理由對不對」要看到**全部**紅的項目——
    // 別的情境也紅了，就是被別的規則碰巧擋下（2026-10-28：原本只印前 4 行 ✗、紅了不留全文，
    // pushgatetest 那條第 5 行以後有沒有紅、紅在哪，事後查不到，那筆結果只好重跑）
    fs.writeFileSync(path.join(LOGS, `mutate-out.${seq}.log`), r.out || '');
    const reds = (r.out || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.startsWith('✗'));
    if (result === 'red') console.log(`✓ 紅了｜${m.name}（結束碼 ${r.status}；跑滿 ${j.items}/${base.items} 項；✗ ${reds.length} 行，全部列在下面；全文在 .logs/mutate-out.${seq}.log）\n${reds.map((l) => '     ' + l.slice(0, 160)).join('\n')}`);
    else if (result === 'not-red') console.log(`✗ 沒紅｜${m.name}：跑滿 ${j.items}/${base.items} 項、結束碼 0——照樣全綠`);
    else { const lb = KIND[j.kind].label; console.log(`${KIND[j.kind].mark} ${lb}｜${m.name}：${why.startsWith(lb + '：') ? why.slice(lb.length + 1) : why}——沒有結果（不算紅、也不算跑過）`); }
    // 沒有結果時把子程序的輸出留下來：不然看不出是丟了例外、被殺、還是測試本來就不印總結行
    // （2026-10-28：scrolltest 兩條突變連兩天「沒有結果」，其實都紅了，只是 scrolltest 不印總結行）
    if (result === 'no-result') {
      const outFile = path.join(LOGS, `mutate-noresult.${seq}.log`);
      fs.writeFileSync(outFile, r.out || '');
      const tail = (r.out || '').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-8);
      console.log(`     子程序輸出最後 ${tail.length} 行（全文在 .logs/${path.basename(outFile)}）：\n${tail.map((l) => '     │ ' + l.slice(0, 160)).join('\n')}`);
    }
  }
  if (!onlyMode) {
    let after;
    try { after = snapshot({ root: ROOT, untracked: 'no' }); } catch { after = null; }
    if (!after || after.size) { console.log(`✗ 跑完工作區不等於 HEAD：${after ? [...after.keys()].join('、') : '讀不到'}`); return 4; }
    console.log('\n跑完工作區＝HEAD');
  }
  // 各類從每一條自己的結果數；帳本那一側另外數（真的跑了的那幾條，帳本裡要各有一筆收尾）——兩個來源對不上就是執行器自己壞了
  const tally = Object.fromEntries(Object.keys(KIND).map((k) => [k, outcomes.filter((o) => o.kind === k).length]));
  const sum = Object.values(tally).reduce((a, b) => a + b, 0);
  let ledgerDone = -1;
  try { const L = readLedger(); ledgerDone = runSeqs.filter((s) => L.some((e) => e.seq === s && e.event === 'done')).length; } catch { ledgerDone = -1; }
  console.log(`\n結果：紅 ${tally.red}、沒紅 ${tally['not-red']}、崩潰 ${tally.crash}、逾時 ${tally.timeout}、沒跑完 ${tally.short}、項數不符 ${tally.extra}、`
    + `沒套上 ${tally.unapplied}、沒跑（原樣不成立）${tally.nobase}——相加 ${sum}、選到 ${list.length} 條；真的跑了 ${runSeqs.length} 條、帳本收尾 ${ledgerDone} 筆`);
  if (sum !== list.length || outcomes.length !== list.length || ledgerDone !== runSeqs.length) { console.log('✗ 各類相加、選到的條數、帳本收尾筆數對不上——執行器自己算錯了'); return 4; }
  console.log(`${tally.red}/${list.length} 條照預期紅`);
  const first = CODE_ORDER.find((k) => tally[k]);
  return first ? KIND[first].code : 0;
}

// 直接執行才跑（讓 lintMutations 可以被別支 import 去掃既有的突變清單）
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().then((c) => { process.exitCode = c; });
}
