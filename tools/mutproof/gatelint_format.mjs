// gatelint「判定與證據分行」的三格證明（2026-10-02，照 JLPT 的結構）：
//   要求 R：「某一行判定行（以 3 格縮排＋[種類] 開頭）裡出現 X」，X＝『[pipe] scripts/verified-reg.mjs:』
//   格 1　舊格式（原始碼跟判定擠同一行）＋碰巧樣本 → R 被滿足（證明洞原本在）
//   格 2　新格式（原始碼在下一行、縮排 6 格）＋同一個碰巧樣本 → R 不被滿足（洞堵住了）
//   格 3　新格式＋真的違規 → R 照樣滿足（沒有把要求改成無法滿足）
// 碰巧樣本：在 safe-push.sh 加一行「|| true」違規，它的原始碼裡剛好含 X。前置：這一行必須真的被規則點名
// （出現 [ortrue] scripts/safe-push.sh:行號 的判定行）——沒被點名的話，「樣本沒被抓到」跟「新格式堵住了」在輸出上長得一樣，判情境未成立。
// 全部在 .logs/glf 的暫存複本裡、從命令列入口跑；加進去的樣本讀回確認。
// 用法：node tools/mutproof/gatelint_format.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const DIR = path.join(REPO, '.logs', 'glf');
const X = '[pipe] scripts/verified-reg.mjs:';
const COINCIDENT = 'git fetch -q origin main || true   # 說明：[pipe] scripts/verified-reg.mjs:51 那一條';
const REAL = "const h = sh('git rev-parse HEAD | cut -c1-7');";
const NEW_BAD = '  for (const h of bad) { log(`   [${h.kind}] ${h.file}:${h.n}`); log(`      ${h.text.slice(0, 140)}`); }';
const OLD_BAD = '  for (const h of bad) log(`   [${h.kind}] ${h.file}:${h.n}  ${h.text.slice(0, 140)}`);';

const judgments = (out) => out.split('\n').filter((l) => /^ {3}\[[a-z-]+\] /.test(l));
const R = (out) => judgments(out).some((l) => l.includes(X));

function cell({ oldFormat, plant }) {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  fs.cpSync(path.join(REPO, 'scripts'), path.join(DIR, 'scripts'), { recursive: true });
  const gl = path.join(DIR, 'scripts', 'gatelint.mjs');
  if (oldFormat) {
    const s = fs.readFileSync(gl, 'utf8');
    if (s.split(NEW_BAD).length !== 2) return { err: '新格式那一行找不到（gatelint 又改過了？）' };
    fs.writeFileSync(gl, s.replace(NEW_BAD, OLD_BAD));
    if (!fs.readFileSync(gl, 'utf8').includes(OLD_BAD)) return { err: '改回舊格式沒成功' };
  }
  const [file, line] = plant === 'coincident' ? ['scripts/safe-push.sh', COINCIDENT] : plant === 'comment' ? ['scripts/safe-push.sh', '# 註解：[pipe] scripts/verified-reg.mjs:51'] : ['scripts/verified-reg.mjs', REAL];
  const p = path.join(DIR, file);
  const body = fs.readFileSync(p, 'utf8').replace(/\s*$/, '\n') + line + '\n';
  fs.writeFileSync(p, body);
  const n = body.split('\n').length - 1;
  if (!fs.readFileSync(p, 'utf8').split('\n').includes(line)) return { err: '樣本沒寫進去' };
  const r = spawnSync(process.execPath, [gl], { cwd: DIR, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const flagged = plant !== 'real'
    ? judgments(out).some((l) => l.startsWith(`   [ortrue] ${file}:${n}`))
    : judgments(out).some((l) => l.startsWith(`   [pipe] ${file}:${n}`));
  fs.rmSync(DIR, { recursive: true, force: true });
  return { status: r.status, flagged, R: R(out), n };
}

const cases = [
  ['格 1 舊格式＋碰巧樣本', { oldFormat: true, plant: 'coincident' }, true],
  ['格 2 新格式＋碰巧樣本', { oldFormat: false, plant: 'coincident' }, false],
  ['格 3 新格式＋真的違規', { oldFormat: false, plant: 'real' }, true],
];
let bad = 0, unformed = 0;
// 前置的對照組：碰巧樣本放在註解裡（不會被任何規則點名）→ 必須判成情境未成立，不能判成「堵住了」
{
  const c = cell({ oldFormat: false, plant: 'comment' });
  const ok = !c.err && c.flagged === false;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} 前置對照：樣本在註解裡、沒被點名 → ${c.flagged === false ? '判成情境未成立（不算格 2 的堵住了）' : '竟然被點名了'}`);
}
for (const [label, o, want] of cases) {
  const c = cell(o);
  if (c.err) { unformed++; console.log(`⊘ 情境未成立：${label}——${c.err}`); continue; }
  if (!c.flagged) { unformed++; console.log(`⊘ 情境未成立：${label}——樣本那一行（第 ${c.n} 行）沒有被任何規則點名，什麼都沒量到`); continue; }
  const ok = c.R === want;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${label}：樣本被點名、gatelint 回 ${c.status}、要求 R ${c.R ? '被滿足' : '不被滿足'}（預期${want ? '被滿足' : '不被滿足'}）`);
}
console.log(bad || unformed ? `✗ ${bad} 格不照預期、${unformed} 格情境未成立` : '三格都照預期');
process.exitCode = bad ? 1 : unformed ? 3 : 0;
