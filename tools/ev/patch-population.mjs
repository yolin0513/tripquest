// tools/ev 的補丁母體（2026-10-02）：
//   產物＝6 支產生器在空目錄產出的檔（regen-check 的 48 份）；
//   會被套用的＝驅動腳本裡「檔=補丁.json」與「for k in a b c; do … =前綴_$k.json」展開之後的那幾份；
//   實際套用的＝跑完之後，ev2.sh 每套一份就印的「[標籤] 補丁：xxx.json」（.logs/ev/ev2-*.shell）。
// 用法：node tools/ev/patch-population.mjs            只列「產物」與「會被套用的」
//       node tools/ev/patch-population.mjs --applied   再加上「實際套用的」，三者對帳，對不上就點名、非 0
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DRIVERS = ['six_mut.sh', 'f9_mut.sh', 'f9_mut2.sh', 'f10_mut.sh', 'di_mut.sh', 'last_mut.sh'];

export function referenced(text) {
  const out = new Set();
  for (const m of text.matchAll(/=([A-Za-z0-9_]+\.json)\b/g)) out.add(m[1]);
  // for k in a b c; do … =前綴_$k.json
  for (const m of text.matchAll(/for k in ([^;]+); do[^\n]*?=([A-Za-z0-9_]+_)\$k\.json/g)) for (const k of m[1].trim().split(/\s+/)) out.add(`${m[2]}${k}.json`);
  return out;
}

function generated() {
  const tmp = path.join(REPO, '.logs', 'ev-pop');
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const gens = fs.readdirSync(HERE).filter((f) => /^mk_[a-z0-9]+_patches\.mjs$/.test(f));
  for (const g of gens) { const r = spawnSync(process.execPath, [path.join(HERE, g), tmp]); if (r.status !== 0) throw new Error(`${g} 跑不起來`); }
  const out = new Set(fs.readdirSync(tmp).filter((f) => f.endsWith('.json')));
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

// 對照組：for 迴圈展開
const ctl = referenced('for k in a b; do run "x-$k" "$P" $SP=pzz_$k.json; done\nrun y "$P" $SP=pyy_one.json');
if ([...ctl].sort().join() !== 'pyy_one.json,pzz_a.json,pzz_b.json') { console.log('✗ 對照組沒過（迴圈展開）'); process.exit(4); }

const gen = generated();
const used = new Set(), byDriver = {};
for (const d of DRIVERS) { byDriver[d] = referenced(fs.readFileSync(path.join(HERE, d), 'utf8')); byDriver[d].forEach((x) => used.add(x)); }
const genNotUsed = [...gen].filter((x) => !used.has(x)).sort();
const usedNotGen = [...used].filter((x) => !gen.has(x)).sort();
console.log(`產物 ${gen.size} 份；驅動會套用的 ${used.size} 份（${DRIVERS.map((d) => `${d.replace('.sh', '')} ${byDriver[d].size}`).join('、')}）`);
console.log(`產物裡沒有任何驅動會套用的 ${genNotUsed.length} 份：${genNotUsed.join('、') || '（無）'}`);
console.log(`驅動會套用、卻不是產物的 ${usedNotGen.length} 份：${usedNotGen.join('、') || '（無）'}`);
// 驅動會套用、卻不是產物的：手寫的補丁（不是產生器產的），只要在 tools/mutations/ 裡就算數
const handMissing = usedNotGen.filter((x) => !fs.existsSync(path.join(REPO, 'tools', 'mutations', x)));
console.log(`其中手寫、在 tools/mutations 裡的 ${usedNotGen.length - handMissing.length} 份；找不到的 ${handMissing.length} 份${handMissing.length ? '：' + handMissing.join('、') : ''}`);
let bad = handMissing.length > 0;
if (process.argv.includes('--applied')) {
  const dir = path.join(REPO, '.logs', 'ev');
  const applied = new Set();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^ev2-.+\.shell$/.test(x)) : []) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\[[^\]]+\] 補丁：([A-Za-z0-9_]+\.json)$/gm)) applied.add(m[1]);
  }
  const notApplied = [...used].filter((x) => !applied.has(x)).sort();
  const extra = [...applied].filter((x) => !used.has(x)).sort();
  console.log(`實際套用 ${applied.size} 份；會套用卻沒套到 ${notApplied.length} 份：${notApplied.join('、') || '（無）'}；不在名單卻套了 ${extra.length} 份：${extra.join('、') || '（無）'}`);
  bad = bad || notApplied.length > 0 || extra.length > 0 || applied.size !== used.size;
}
process.exitCode = bad ? 1 : 0;
