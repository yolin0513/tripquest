// 「驗法全過才登記被驗程式的雜湊」的共用部分（pushgatetest、f8verify 都用；補充工單 F9，2026-09-24）。
//
// 登記的是**已 commit 的版本**：推送推的是 HEAD，所以登記 HEAD 裡的雜湊、推送閘也拿 HEAD 裡的比。
// 登記前先確認被守的每一支都在 HEAD 裡、工作區跟 HEAD 一模一樣——有改動就不登記（驗法跑到的是工作區那一份，
// 它跟要推的那一份不同時，登記等於替沒驗過的版本作保）。登記檔放不進版控的 .logs/；不登記時連舊的一起刪掉。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

// HEAD 裡那一支的雜湊；不在 HEAD 裡回 ''
export const headHash = (root, f) => { const r = git(root, ['rev-parse', '-q', '--verify', `HEAD:${f}`]); return r.ok ? r.out : ''; };

// 每一支都要：在 HEAD 裡、工作區有、工作區的內容（照 git 的換行規則算）等於 HEAD。回傳不符合的說明（空陣列＝全部符合）
export const headProblems = (root, files) => {
  const bad = [];
  for (const f of files) {
    const want = headHash(root, f);
    if (!want) { bad.push(`${f} 不在 HEAD 裡（還沒 commit？）`); continue; }
    if (!fs.existsSync(path.join(root, f))) { bad.push(`${f} 工作區裡沒有`); continue; }
    const have = git(root, ['hash-object', '--', f]);
    if (!have.ok || !have.out) { bad.push(`${f} 算不出工作區的雜湊（${have.err || '沒有輸出'}）`); continue; }
    if (have.out !== want) bad.push(`${f} 工作區跟 HEAD 不一樣（有沒 commit 的改動）`);
  }
  return bad;
};

export const dropReg = (regPath) => {
  if (!fs.existsSync(regPath)) return '本來就不在';
  try { fs.unlinkSync(regPath); return '已刪掉'; } catch (e) { return `刪不掉（${e.code || e.message}），請自己刪`; }
};

// 驗法全過之後呼叫。符合條件才寫登記，回 { ok:true }；不符合就不寫、刪掉舊的，回 { ok:false, why }
export const writeReg = (root, regPath, files, header) => {
  const bad = headProblems(root, files);
  if (bad.length) return { ok: false, why: bad.join('；'), dropped: dropReg(regPath) };
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  fs.writeFileSync(regPath, header + files.map((f) => `${headHash(root, f)} ${f}`).join('\n') + '\n');
  return { ok: true };
};
