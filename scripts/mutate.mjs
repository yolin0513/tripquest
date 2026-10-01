// App 程式的突變執行器：node scripts/mutate.mjs <mutations.json> [名稱...]
//                         node scripts/mutate.mjs --recover      （上一次被殺掉時，把改壞的檔還原）
// 每一條：把 file 裡的 find（字面字串，必須恰好出現一次）換成 replace → 跑 cmd → 還原。期望 cmd 失敗（exit ≠ 0）。
//
// 2026-10-02 從 Session 暫存區搬進 repo，加兩道護欄。原本直接改主工作區的檔、只靠 finally 寫回：
// 程式被殺掉、當機、硬關機時 finally 不會跑，改壞的檔就留在工作區，下一次 commit 可能帶出去。
//   1. 開跑前：進版控的檔必須等於 HEAD，不等就拒絕（回 2）並列出來——否則上一次留下的壞檔會被這一次
//      當成原檔備份，「還原」會把壞檔還原回去。
//   2. 改檔之前：先把原檔備份、雜湊寫進磁碟上的進度紀錄（.logs/mutate-journal.json），還原並核對雜湊之後才刪。
//      被殺掉之後，下一次啟動看得到紀錄 → 拒絕（回 5）並點名哪個檔該還原成哪個雜湊；--recover 照紀錄還原。
// 還沒做到的（排進計畫）：整個改成在暫存複本裡突變，主工作區完全不動。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot } from './worktree-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOGS = path.join(ROOT, '.logs');
const JOURNAL = path.join(LOGS, 'mutate-journal.json');
const BACKUP = path.join(LOGS, 'mutate-backup');
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const writeDurable = (file, data) => {            // 寫完 fsync，被殺掉之前一定已經在磁碟上
  const fd = fs.openSync(file, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

function readJournal() {
  if (!fs.existsSync(JOURNAL)) return null;
  try { return JSON.parse(fs.readFileSync(JOURNAL, 'utf8')); }
  catch (e) { return { broken: String(e.message) }; }
}

function reportJournal(j) {
  if (j.broken) { console.log(`✗ 進度紀錄 ${path.relative(ROOT, JOURNAL)} 讀不懂（${j.broken}）——不自動處理，請人看過`); return; }
  console.log(`✗ 上一次的突變沒有做完（${j.started}，突變「${j.name}」）——這些檔可能還是改壞的：`);
  for (const e of j.files) {
    let now = 'missing';
    try { now = sha1(fs.readFileSync(path.join(ROOT, e.file))); } catch (err) { now = 'unreadable'; }
    console.log(`   ${e.file}：應還原成 ${e.sha.slice(0, 12)}，現在 ${now === e.sha ? '已經是原檔' : now.slice(0, 12) + '（不是原檔）'}；備份 ${path.relative(ROOT, path.join(BACKUP, e.sha))}`);
  }
  console.log('   還原：node scripts/mutate.mjs --recover');
}

function recover() {
  const j = readJournal();
  if (!j) { console.log('沒有未完成的突變，不用還原'); return 0; }
  if (j.broken) { reportJournal(j); return 4; }
  for (const e of j.files) {
    const bak = path.join(BACKUP, e.sha);
    const buf = fs.readFileSync(bak);
    if (sha1(buf) !== e.sha) { console.log(`✗ 備份 ${path.relative(ROOT, bak)} 的雜湊不對，不還原 ${e.file}`); return 4; }
    fs.writeFileSync(path.join(ROOT, e.file), buf);
    const back = sha1(fs.readFileSync(path.join(ROOT, e.file)));
    if (back !== e.sha) { console.log(`✗ ${e.file} 還原後雜湊仍不對`); return 4; }
    console.log(`✓ ${e.file} 已還原成 ${e.sha.slice(0, 12)}`);
  }
  fs.rmSync(JOURNAL);
  console.log('✓ 進度紀錄已清除');
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--recover') return recover();

  // 護欄 2 的另一半：上一次沒做完 → 先停
  const j = readJournal();
  if (j) { reportJournal(j); return 5; }

  // 護欄 1：進版控的檔要等於 HEAD
  let dirty;
  try { dirty = snapshot({ root: ROOT, untracked: 'no' }); }
  catch (e) { console.log(`✗ 讀不到工作區狀態（${String(e.message).split('\n')[0]}）——不當成乾淨，停下`); return 4; }
  if (dirty.size) {
    console.log(`✗ 工作區有 ${dirty.size} 個進版控的檔跟 HEAD 不一樣，拒絕跑突變：${[...dirty.keys()].join('、')}`);
    return 2;
  }

  const [listFile, ...only] = args;
  if (!listFile) { console.log('用法：node scripts/mutate.mjs <mutations.json> [名稱...]'); return 2; }
  const list = JSON.parse(fs.readFileSync(listFile, 'utf8')).filter((m) => !only.length || only.includes(m.name));
  fs.mkdirSync(BACKUP, { recursive: true });
  let bad = 0;
  for (const m of list) {
    const rel = m.file;
    const f = path.join(ROOT, rel);
    const orig = fs.readFileSync(f);
    const edits = m.edits || [{ find: m.find, replace: m.replace }];
    let text = orig.toString('utf8'), okAll = true;
    for (const e of edits) {
      const n = text.split(e.find).length - 1;
      if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次（要恰好 1 次），沒跑\n     ${e.find.slice(0, 80)}`); okAll = false; break; }
      text = text.replace(e.find, e.replace);
    }
    if (!okAll) { bad++; continue; }
    const sha = sha1(orig);
    writeDurable(path.join(BACKUP, sha), orig);
    writeDurable(JOURNAL, JSON.stringify({ started: new Date().toISOString(), name: m.name, files: [{ file: rel, sha }] }, null, 2));
    fs.writeFileSync(f, text);
    let r;
    try {
      r = spawnSync(m.cmd, { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 400000 });
    } finally {
      fs.writeFileSync(f, orig);
    }
    if (sha1(fs.readFileSync(f)) !== sha) { console.log(`✗ ${rel} 還原後雜湊不對——進度紀錄保留，請跑 --recover`); return 4; }
    fs.rmSync(JOURNAL);
    const out = (r.stdout || '') + (r.stderr || '');
    const reds = out.split('\n').filter((l) => l.startsWith('✗')).slice(0, 4);
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    if (r.status !== 0 && !timedOut) console.log(`✓ ${m.name}：紅了（exit ${r.status}）\n${reds.map((l) => '     ' + l.slice(0, 160)).join('\n')}`);
    else { bad++; console.log(`✗ ${m.name}：${timedOut ? '逾時（不算紅）' : '沒紅（照樣全綠）'}`); }
  }
  let after;
  try { after = snapshot({ root: ROOT, untracked: 'no' }); } catch { after = null; }
  if (!after || after.size) { console.log(`✗ 跑完工作區不等於 HEAD：${after ? [...after.keys()].join('、') : '讀不到'}`); return 4; }
  console.log(`\n跑完工作區＝HEAD；${list.length - bad}/${list.length} 條照預期紅`);
  return bad ? 1 : 0;
}

process.exitCode = main();
