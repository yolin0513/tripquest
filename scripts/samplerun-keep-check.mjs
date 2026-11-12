// tools/sample-run.mjs「不覆寫舊紀錄」的驗法（2026-11-12）：每一種情境都從 sample-run 的命令列入口真的跑一場
// （被包住的指令是一支只印一個記號的 node），看跑完之後資料夾裡每個檔的內容。暫存在 .logs/samplerun-keep-check/<時間>/（不進版控）。
//   node scripts/samplerun-keep-check.mjs        改了 tools/sample-run.mjs 的換名／.partial 那幾段就跑這支
//   （手動；不在測試鏈——登記在 scripts/affected.mjs 的 ORPHAN_OK；突變 tools/mutations/mut_samplerun1112.json 也用這個入口）
//   回 0 全過；1 有一條沒過；3 情境未成立（例：設不了舊檔的修改時間）
//
// 情境（各用自己的檔名，彼此不依賴——一種情境沒造成，不會讓後面的情境跟著紅在別的理由上）：
//   S1：紀錄檔原本不在 → 寫進去、跑完不留 .partial、不多出任何檔。基準。
//   S2：同名的紀錄檔已經在（舊內容、修改時間設成固定值）→ 舊的改名成「名字.時間戳.副檔名」保留、新的寫原名、紀錄裡寫了改名那一行。
//   S3：S2 再加上那個帶時間戳的名字已經被占用（同一秒）→ 占用的那個檔不被蓋掉，舊的換到下一個號碼（-2）。
//   S4：上一場被中途停掉、留下 <紀錄檔>.partial → 那個 .partial 也改名保留；這一場跑完不留 .partial。
//   S5：舊紀錄換不了名（紀錄檔的位置是一個資料夾）→ 回 5、說不覆寫；原本的東西沒動、被包住的指令沒跑。
// 最後比對主工作區跑前跑後的 git status（這支只寫 .logs/，不該動到任何進版控的檔）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = path.join(ROOT, 'tools', 'sample-run.mjs');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const bad = (m, x) => { fail++; console.log('✗ ' + m + (x ? `\n   ${x}` : '')); };
const yes = (c, m, x) => (c ? ok(m) : bad(m, x));
const notFormed = (m) => { console.log(`⊘ 情境未成立：${m}`); process.exit(3); };

const status = () => execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
const st0 = status();
const TMP = path.join(ROOT, '.logs', 'samplerun-keep-check', String(Date.now()));
fs.mkdirSync(TMP, { recursive: true });
const P = (f) => path.join(TMP, f);
const read = (f) => (fs.existsSync(P(f)) && fs.statSync(P(f)).isFile() ? fs.readFileSync(P(f), 'utf8') : null);
// 同一個情境的所有檔：主檔名相同（a.log、a.<時間戳>.log、a.log.partial……都是「a.」開頭）
// （第一版用「b.log.」開頭找，b.<時間戳>.log 找不到，S1、S5 的「沒多出檔」因此空轉——11-12 第一次跑被 S2 抓到）
const ls = (stem) => fs.readdirSync(TMP).filter((f) => f.startsWith(stem + '.')).sort();
// 舊檔的修改時間設成固定值 → 改名後的時間戳事先知道（本機時區）
const FIXED = new Date(2020, 0, 2, 3, 4, 5);
const STAMP = '20200102-030405';
const putOld = (f, text) => {
  fs.writeFileSync(P(f), text);
  fs.utimesSync(P(f), FIXED, FIXED);
  if (Math.abs(fs.statSync(P(f)).mtimeMs - FIXED.getTime()) > 1000) notFormed(`${f} 的修改時間設不成 ${STAMP}`);
};
const run = (out, mark) => {
  const r = spawnSync(process.execPath, [SR, P(out), process.execPath, '-e', 'console.log(process.argv[1])', mark], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return { rc: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
};
console.log(`說明 暫存＝${path.relative(ROOT, TMP).replace(/\\/g, '/')}；舊檔時間戳＝${STAMP}`);

// ---- S1：紀錄檔原本不在 ----
{
  if (ls('a').length) notFormed('S1 開跑前 a.log 就在');
  const r = run('a.log', 'MARK-1');
  const a = read('a.log');
  yes(r.rc === 0 && a && a.includes('MARK-1'), 'S1：第一場寫進 a.log（MARK-1）', `rc=${r.rc}；${r.out.split('\n')[0]}`);
  yes(!fs.existsSync(P('a.log.partial')), 'S1：跑完不留 a.log.partial');
  const files = ls('a').filter((f) => f !== 'a.log.partial');
  yes(files.join() === 'a.log', 'S1：沒有舊檔可換名時，資料夾裡只有 a.log', files.join('、'));
}

// ---- S2：同名的紀錄檔已經在 ----
{
  putOld('b.log', 'OLD-B\n');
  const r = run('b.log', 'MARK-2');
  const b = read('b.log') || '';
  const kept = read(`b.${STAMP}.log`) || '';
  yes(r.rc === 0 && b.includes('MARK-2') && !b.includes('OLD-B'), 'S2：新的一場寫進 b.log、裡面沒有舊的內容', `rc=${r.rc}`);
  yes(kept.includes('OLD-B') && !kept.includes('MARK-2'), `S2：舊的改名保留成 b.${STAMP}.log（時間戳＝它最後寫入的時間）、內容是舊的`, ls('b').join('、'));
  yes(b.includes(`舊紀錄改名保留：b.log → b.${STAMP}.log`), 'S2：紀錄裡寫了改名那一行');
  const files = ls('b').filter((f) => !f.endsWith('.partial'));
  yes(files.join() === `b.${STAMP}.log,b.log`, 'S2：只多出那一個改名的檔', files.join('、'));
}

// ---- S3：帶時間戳的名字已經被占用 ----
{
  putOld('c.log', 'OLD-C\n');
  fs.writeFileSync(P(`c.${STAMP}.log`), 'SENTINEL-C\n');
  const r = run('c.log', 'MARK-3');
  yes(read(`c.${STAMP}.log`) === 'SENTINEL-C\n', `S3：已經在的 c.${STAMP}.log 沒被蓋掉`, JSON.stringify(read(`c.${STAMP}.log`)));
  yes((read(`c.${STAMP}-2.log`) || '').includes('OLD-C'), `S3：舊的換到下一個號碼 c.${STAMP}-2.log`, ls('c').join('、'));
  yes(r.rc === 0 && (read('c.log') || '').includes('MARK-3'), 'S3：新的一場寫進 c.log', `rc=${r.rc}`);
}

// ---- S4：上一場被中途停掉留下的 .partial ----
{
  putOld('d.log.partial', 'INTERRUPTED-D\n');
  const r = run('d.log', 'MARK-4');
  yes(read(`d.log.${STAMP}.partial`) === 'INTERRUPTED-D\n', `S4：上一場留下的 d.log.partial 改名保留成 d.log.${STAMP}.partial`, ls('d').join('、'));
  yes(!fs.existsSync(P('d.log.partial')), 'S4：這一場跑完不留 d.log.partial');
  yes(r.rc === 0 && (read('d.log') || '').includes('MARK-4'), 'S4：新的一場寫進 d.log', `rc=${r.rc}`);
}

// ---- S5：換不了名 ----
{
  fs.mkdirSync(P('e.log'));
  fs.writeFileSync(path.join(P('e.log'), 'keep.txt'), 'keep');
  if (!fs.statSync(P('e.log')).isDirectory()) notFormed('S5 的 e.log 不是資料夾');
  const r = run('e.log', 'MARK-5');
  yes(r.rc === 5 && /換不了名/.test(r.out) && /不覆寫/.test(r.out), 'S5：舊紀錄換不了名 → 回 5、說不覆寫', `rc=${r.rc}；${r.out.split('\n')[0]}`);
  const intact = fs.statSync(P('e.log')).isDirectory() && fs.readFileSync(path.join(P('e.log'), 'keep.txt'), 'utf8') === 'keep';
  const extra = ls('e').filter((f) => f !== 'e.log');
  const ran = fs.readdirSync(TMP).some((f) => fs.statSync(P(f)).isFile() && fs.readFileSync(P(f), 'utf8').includes('MARK-5'));
  yes(intact && !extra.length && !ran, 'S5：原本的東西沒動、沒多出檔、被包住的指令沒跑', `原樣 ${intact}；多出 ${extra.join('、') || '無'}；跑了 ${ran}`);
}

const st1 = status();
yes(st0 === st1, '收尾：主工作區跑前跑後的 git status 一樣', `跑前 ${st0.split('\n').filter(Boolean).length} 行、跑後 ${st1.split('\n').filter(Boolean).length} 行`);
console.log(`${pass} 項通過、${fail} 項沒過`);
process.exit(fail ? 1 : 0);
