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
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot } from './worktree-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOGS = path.join(ROOT, '.logs');
const LEDGER = path.join(LOGS, 'mutate-ledger.jsonl');
const PENDING = path.join(LOGS, 'mutate-pending.json');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const short = (s) => String(s).slice(0, 12);

function fsyncWrite(file, data, flag = 'w') {
  const fd = fs.openSync(file, flag);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const ledgerAdd = (e) => { fs.mkdirSync(LOGS, { recursive: true }); fsyncWrite(LEDGER, JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n', 'a'); };

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
    ledgerAdd({ seq: pending.seq, event: 'recovered', file: pending.file });
    console.log(`上一次被中斷（第 ${pending.seq} 次，突變「${pending.name}」），已還原 ${pending.file} → ${short(pending.sha)}`);
    return 0;
  }
  if (open) {
    const now = fileSha(open.file);
    if (now !== open.sha) {
      console.log(`✗ 第 ${open.seq} 次開跑（突變「${open.name}」）沒有收尾，還原紀錄卻不在；${open.file} 現在是 ${short(now)}，原檔應為 ${short(open.sha)}——上次中斷過、紀錄被移掉，請人工確認工作區（git diff ${open.file}）`);
      return 5;
    }
    ledgerAdd({ seq: open.seq, event: 'closed-file-ok', file: open.file });
    console.log(`註：第 ${open.seq} 次開跑沒有收尾、還原紀錄不在，但 ${open.file} 的雜湊等於原檔——照跑`);
  }
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const rc0 = startupCheck();
  if (rc0) return rc0;
  if (args[0] === '--recover') return 0;

  const onlyMode = args[0] === '--only';
  const [listFile, ...names] = onlyMode ? args.slice(1) : args;
  if (!listFile) { console.log('用法：node scripts/mutate.mjs [--only] <mutations.json> [名稱...]'); return 2; }
  const list = JSON.parse(fs.readFileSync(listFile, 'utf8')).filter((m) => !names.length || names.includes(m.name));
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
    ledgerAdd({ seq, event: 'started', name: m.name, file: m.file, sha });
    fsyncWrite(PENDING, JSON.stringify({ seq, name: m.name, file: m.file, sha, content: orig.toString('base64') }));
    fs.writeFileSync(f, text);
    let r;
    try {
      r = spawnSync(m.cmd, { cwd: ROOT, shell: true, encoding: 'utf8', timeout: m.timeoutMs || 400000 });
    } finally {
      fs.writeFileSync(f, orig);
    }
    if (sha1(fs.readFileSync(f)) !== sha) { console.log(`✗ ${m.file} 還原後雜湊不對——還原紀錄保留，下次啟動會照它還原`); return 4; }
    fs.rmSync(PENDING);
    ledgerAdd({ seq, event: 'done', file: m.file });
    const out = (r.stdout || '') + (r.stderr || '');
    const reds = out.split('\n').filter((l) => l.startsWith('✗')).slice(0, 4);
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    if (r.status !== 0 && !timedOut) console.log(`✓ ${m.name}：紅了（exit ${r.status}）\n${reds.map((l) => '     ' + l.slice(0, 160)).join('\n')}`);
    else { bad++; console.log(`✗ ${m.name}：${timedOut ? '逾時（不算紅）' : '沒紅（照樣全綠）'}`); }
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

process.exitCode = main();
