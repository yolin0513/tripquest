// tools/ev 入庫之後的檢查（2026-10-02；只讀、在 .logs/ev-regen 產生暫存檔、跑完刪掉）：
//   1. 能重新產生：每支 mk_*_patches.mjs 在空目錄重新產生一次，每一份都要跟 tools/mutations/ 裡入庫的那份逐位元組相同。
//   2. 引用都在：每支驅動腳本引用的補丁（「檔=xxx.json」與 $M/xxx_）都要在 tools/mutations/。
//   3. 沒有本機路徑：tools/ev/ 底下不准出現磁碟代號路徑、使用者目錄、系統暫存目錄的環境變數。
// 每一項先跑合成對照組（必須抓到），沒抓到就回 4。
// 用法：node tools/ev/regen-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const MUT = path.join(REPO, 'tools', 'mutations');
const TMP = path.join(REPO, '.logs', 'ev-regen');
const problems = [];
let broken = false;

// ---------- 1. 重新產生 ----------
export function compareDirs(genDir, mutDir) {
  const out = [];
  const gen = fs.readdirSync(genDir).filter((f) => f.endsWith('.json')).sort();
  for (const f of gen) {
    const a = fs.readFileSync(path.join(genDir, f));
    const p = path.join(mutDir, f);
    if (!fs.existsSync(p)) out.push(`${f}（重新產生出來了，tools/mutations 沒有）`);
    else if (!a.equals(fs.readFileSync(p))) out.push(`${f}（重新產生的跟入庫的不一樣）`);
  }
  return { n: gen.length, diffs: out };
}
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const gens = fs.readdirSync(HERE).filter((f) => /^mk_[a-z0-9]+_patches\.mjs$/.test(f)).sort();
for (const g of gens) {
  const r = spawnSync(process.execPath, [path.join(HERE, g), TMP], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`${g} 跑不起來（exit ${r.status}）：${(r.stderr || '').split('\n')[0]}`);
}
const cmp = compareDirs(TMP, MUT);
// 對照組：改一份暫存產物的一個位元組，必須被點名
{
  const any = fs.readdirSync(TMP).filter((f) => f.endsWith('.json'))[0];
  const CTL = TMP + '-ctl';
  fs.rmSync(CTL, { recursive: true, force: true });
  fs.cpSync(TMP, CTL, { recursive: true });
  if (any) fs.writeFileSync(path.join(CTL, any), fs.readFileSync(path.join(CTL, any), 'utf8') + ' ');
  const c = compareDirs(CTL, MUT);
  const ok = !!any && c.diffs.length === 1 && c.diffs[0].startsWith(any + '（重新產生的跟入庫的不一樣）');
  console.log(`對照組（重新產生）：改掉 ${any || '（沒有產物）'} 一個位元組 → 點名＝${ok}`);
  if (!ok) broken = true;
  fs.rmSync(CTL, { recursive: true, force: true });
}
console.log(`1. 重新產生：產生器 ${gens.length} 支、產出 ${cmp.n} 份，跟入庫的不一樣 ${cmp.diffs.length} 份`);
if (!gens.length || !cmp.n) { problems.push('重新產生的母體是空的'); }
problems.push(...cmp.diffs);
fs.rmSync(TMP, { recursive: true, force: true });

// ---------- 2. 引用都在 ----------
export function refsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/=([A-Za-z0-9_]+\.json)\b/g)) out.add(m[1]);
  for (const m of text.matchAll(/\$M\/([A-Za-z0-9_]+\.json)/g)) out.add(m[1]);
  for (const m of text.matchAll(/\$M\/(p[a-z0-9]+_)\$k\.json/g)) out.add(m[1] + '*');
  return [...out];
}
export function missingRefs(text, have) {
  return refsOf(text).filter((r) => (r.endsWith('*') ? !have.some((h) => h.startsWith(r.slice(0, -1))) : !have.includes(r)));
}
const have = fs.readdirSync(MUT);
{
  const fake = 'run x "$C" $SP=pzz_nope.json\nrun y "$C" $SP=psix_six1.json';
  const miss = missingRefs(fake, have);
  const ok = miss.length === 1 && miss[0] === 'pzz_nope.json';
  console.log(`對照組（引用）：合成驅動引用一份不存在的補丁 → 點名＝${ok}`);
  if (!ok) broken = true;
}
const drivers = fs.readdirSync(HERE).filter((f) => f.endsWith('.sh') && f !== 'ev2.sh').sort();
let nrefs = 0;
for (const d of drivers) {
  const t = fs.readFileSync(path.join(HERE, d), 'utf8');
  nrefs += refsOf(t).length;
  for (const m of missingRefs(t, have)) problems.push(`${d} 引用的 ${m} 不在 tools/mutations`);
}
console.log(`2. 引用：驅動腳本 ${drivers.length} 支、引用的補丁 ${nrefs} 筆`);
if (!drivers.length || !nrefs) problems.push('引用的母體是空的');

// ---------- 3. 沒有本機路徑 ----------
const bs = String.fromCharCode(92);
const LOCAL = new RegExp('[A-Za-z]:' + bs + bs + '|/[a-z]/(Claude|Users)/|' + bs + '$TEMP|AppData', 'i');
{
  const samples = ['REPO="/d/Claude/App/x"', 'W="C:' + bs + 'Users' + bs + 'x"', 'W="$TEMP/tq"', 'x AppData y'];
  const ok = samples.every((s) => LOCAL.test(s)) && !LOCAL.test('REPO="$(cd "$S/../.." && pwd)"');
  console.log(`對照組（本機路徑）：4 個合成樣本都抓到、正常寫法不抓＝${ok}`);
  if (!ok) broken = true;
}
const all = fs.readdirSync(HERE).sort();
let nlines = 0;
for (const f of all) {
  const lines = fs.readFileSync(path.join(HERE, f), 'utf8').split('\n');
  nlines += lines.length;
  lines.forEach((l, i) => { if (LOCAL.test(l) && !l.includes('LOCAL') && !l.includes('samples')) problems.push(`${f}:${i + 1} 有本機路徑`); });
}
console.log(`3. 本機路徑：掃了 ${all.length} 個檔、${nlines} 行`);

if (broken) { console.log('✗ 對照組沒過——檢查器壞了，不採信'); process.exitCode = 4; }
else if (problems.length) { console.log('✗ ' + problems.join('\n✗ ')); process.exitCode = 1; }
else console.log('通過');
