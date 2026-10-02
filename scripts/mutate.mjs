// App 程式的突變執行器（2026-10-02 從 Session 暫存區搬進 repo；護欄照 MealMate docs/HOWTO_範圍化突變與帳本.md 第七節）
//
//   node scripts/mutate.mjs <mutations.json> [名稱...]           嚴格：進版控的檔必須等於 HEAD
//   node scripts/mutate.mjs --only <mutations.json> [名稱...]    寫新斷言、還沒 commit 時證明會紅：工作區可以不乾淨，
//                                                               但目標檔不能已經含這條突變「改壞後」的字串（HEAD 那版沒有的話）
//   node scripts/mutate.mjs --recover                           只做啟動時的還原檢查就結束
//
// 每一條：把 file 裡的 find（字面字串，必須恰好出現一次）換成 replace → 跑 cmd → 還原。期望 cmd 失敗（exit ≠ 0）。
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
// 回傳值：0 照預期；1 有突變沒紅；2 工作區不符；4 檢查器自己壞了（讀不到、還原後雜湊不對）；5 上次中斷、還原紀錄不見；6 兩處紀錄不一致。

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
const short = (s) => String(s).slice(0, 12);

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

  let bad = 0;
  for (const m of list) {
    const f = path.join(ROOT, m.file);
    const orig = fs.readFileSync(f);
    let text = orig.toString('utf8'), okAll = true;
    for (const e of editsOf(m)) {
      const n = text.split(e.find).length - 1;
      if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次（要恰好 1 次），沒跑\n     ${e.find.slice(0, 80)}`); okAll = false; break; }
      text = text.replace(e.find, e.replace);
    }
    if (!okAll) { bad++; continue; }
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
    // 結果分三種：紅了／沒紅／沒有結果（逾時被殺）。**沒有結果不是通過**——記成跑過了，下一次就會被當成「跑過了」而跳過
    // 跑完＝有最後那一行總結（2026-10-02，MealMate 撞到：Windows 上被強制停掉時結束碼是 1，跟斷言失敗一模一樣，
    // 前面幾節本來就印 ✗ 的測試被停掉，會被記成「紅了」）。總結行預設是「N 項通過」或「✓ 全部通過」，測試不一樣的在清單裡寫 done（regex 字串）。
    const doneRe = m.done ? new RegExp(m.done, 'm') : DONE_RE;
    const finished = !r.timedOut && r.status !== null && doneRe.test(r.out || '');
    const result = r.timedOut || !finished ? 'no-result' : r.status !== 0 ? 'red' : 'not-red';
    const why = r.timedOut ? `逾時 ${(m.timeoutMs || 400000) / 1000} 秒被殺` : !finished ? `沒跑完：沒有最後那一行總結（結束碼 ${r.status}，可能是被強制停掉）` : null;
    ledgerAdd({ seq, event: 'done', name: m.name, file: m.file, result, ...(why ? { reason: why } : {}) });
    const reds = (r.out || '').split('\n').filter((l) => l.startsWith('✗')).slice(0, 4);
    if (result === 'red') console.log(`✓ ${m.name}：紅了（exit ${r.status}）\n${reds.map((l) => '     ' + l.slice(0, 160)).join('\n')}`);
    else { bad++; console.log(`✗ ${m.name}：${result === 'no-result' ? `${r.timedOut ? '逾時被殺' : '沒跑完（沒有最後那一行總結）'}——沒有結果（不算紅、也不算跑過）` : '沒紅（照樣全綠）'}`); }
  }
  if (!onlyMode) {
    let after;
    try { after = snapshot({ root: ROOT, untracked: 'no' }); } catch { after = null; }
    if (!after || after.size) { console.log(`✗ 跑完工作區不等於 HEAD：${after ? [...after.keys()].join('、') : '讀不到'}`); return 4; }
    console.log('\n跑完工作區＝HEAD');
  }
  console.log(`${list.length - bad}/${list.length} 條照預期紅`);
  return bad ? 1 : 0;
}

// 直接執行才跑（讓 lintMutations 可以被別支 import 去掃既有的突變清單）
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().then((c) => { process.exitCode = c; });
}
