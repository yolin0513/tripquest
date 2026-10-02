// 回頭掃：已經記下分類的突變／證據，哪幾筆其實沒跑完（2026-10-02，MealMate 撞到：被停掉的那一輪記成「跑完、紅錯地方」）。
// 修判定（evid.mjs 的 completed()）只保護以後；這支掃以前留下的原始輸出，沒有完成證據的標成「可能被中斷、需重驗」。
//   · .logs/mutproof/<驅動>/*.txt（突變驅動存的每一條原始輸出）：要有那支測試最後的總結行
//   · 舊 ev2 的外殼紀錄＋log（--legacy <目錄>）：照 tools/ev/progress.mjs 的判準（依指令要的「N 項通過」／F8 結論／結果：都要有）；
//     指令從現在的驅動腳本找，找不到的用寬鬆判準（至少一行完成的證據）並標「寬鬆」
//   · 耗時：驅動輸出（.logs/mutproof/<驅動>.txt 或 run-<驅動>.txt）裡「N.N 秒」明顯短於同一支中位數一半的，另外列出（輔助訊號）
// 先跑合成對照組（缺總結行／有總結行／F8 類／寬鬆），沒過就回 4。只讀、不寫。
//   node tools/mutproof/rescan.mjs [--legacy <舊 ev2 目錄>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { completed, SUMMARY } from './evid.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { scenariosOf, stateOf } = await import(pathToFileURL(path.join(REPO, 'tools', 'ev', 'progress.mjs')).href);
const SUMS = { mutlint_mut: /^mutlint 結束：回 \d+$/m, evidence_mut: /^evidence 結束：回 \d+$/m };
const LOOSE = /^(\d+ 項通過|全部擋下|擋下：F8 驗法|結果：)/m;

// ---------- 對照組 ----------
{
  const ok1 = !completed({ status: 1 }, '✗ 一條\n✗ 二條\n').ok && completed({ status: 1 }, '✗ 一條\n\n12 項通過，有失敗\n').ok;
  const ok2 = !completed({ status: null }, '12 項通過').ok && !completed({ status: 1 }, '通過', SUMS.mutlint_mut).ok && completed({ status: 0 }, '通過\nmutlint 結束：回 0', SUMS.mutlint_mut).ok;
  const fv = 'F8VERIFY_ONLY=bp node scripts/f8verify.mjs';
  const ok3 = stateOf('[x] exit=1\n', '…\n全部擋下（只跑了 bp）\n', fv).state === '跑完' && stateOf('[x] exit=1\n', '✓ 一格\n', fv).state !== '跑完';
  const ok4 = LOOSE.test('a\n120 項通過\n') && !LOOSE.test('✓ 120 項通過');
  // 真的中途停掉（MealMate 那個情形）：先印 ✗、再被 taskkill /F——結束碼要跟斷言失敗一樣（不是 0），而 completed 判沒跑完；
  // 同一支跑到底（印 ✗ 再印總結、回 1）要判跑完。兩向都看，才知道分得出來的是總結行、不是結束碼。
  const { spawn, execFileSync } = await import('node:child_process');
  const runIt = (code, killAfter) => new Promise((res) => {
    const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    if (killAfter) setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(c.pid), '/F'], { stdio: 'ignore' }); } catch { /* 已經結束 */ } }, killAfter);
    c.on('close', (status, signal) => res({ r: { status, signal }, out }));
  });
  const killed = await runIt("console.log('✓ 一\\n✗ 二'); setTimeout(() => console.log('3 項通過'), 5000);", 800);
  const full = await runIt("console.log('✓ 一\\n✗ 二\\n\\n1 項通過，有失敗'); process.exitCode = 1;", 0);
  const ok5 = killed.r.status !== 0 && /^✗ /m.test(killed.out) && !completed(killed.r, killed.out).ok && full.r.status === 1 && completed(full.r, full.out).ok;
  console.log(`中途停掉的對照：被停掉那支回 ${killed.r.status}${killed.r.signal ? `／${killed.r.signal}` : ''}、有 ✗、判${completed(killed.r, killed.out).ok ? '跑完' : '沒跑完'}；跑到底那支回 ${full.r.status}、判${completed(full.r, full.out).ok ? '跑完' : '沒跑完'}`);
  if (!(ok1 && ok2 && ok3 && ok4 && ok5)) { console.log(`✗ 對照組沒過（總結行＝${ok1}、停掉／自訂＝${ok2}、F8＝${ok3}、寬鬆＝${ok4}、真的停掉＝${ok5}）——不採信`); process.exit(4); }
  console.log('對照組：缺總結行／有總結行／被停掉／自訂總結／F8 類／寬鬆／真的中途停掉，都照預期');
}

let suspect = 0;
// ---------- 1. 突變驅動的原始輸出 ----------
const MP = path.join(REPO, '.logs', 'mutproof');
const runners = fs.existsSync(MP) ? fs.readdirSync(MP).filter((d) => fs.statSync(path.join(MP, d)).isDirectory()) : [];
let n1 = 0;
for (const d of runners) {
  const files = fs.readdirSync(path.join(MP, d)).filter((f) => f.endsWith('.txt'));
  const bad = files.filter((f) => !(SUMS[d] || SUMMARY).test(fs.readFileSync(path.join(MP, d, f), 'utf8')));
  n1 += files.length; suspect += bad.length;
  console.log(`${d}：原始輸出 ${files.length} 份，沒有總結行 ${bad.length} 份${bad.length ? '：' + bad.join('、') : ''}`);
}
console.log(`突變驅動合計：${runners.length} 支、${n1} 份`);
// 耗時（輔助）
for (const f of fs.existsSync(path.join(REPO, '.logs')) ? fs.readdirSync(path.join(REPO, '.logs')).filter((x) => /^run-.+_mut\.txt$|^(mutguard|evidence)-mut.*\.txt$/.test(x)) : []) {
  const rows = [...fs.readFileSync(path.join(REPO, '.logs', f), 'utf8').matchAll(/^[✓✗] (\S+ [^：]*)：回 \S+、(\d+(?:\.\d+)?) 秒/gm)].map((m) => ({ name: m[1], sec: Number(m[2]) }));
  if (rows.length < 3) continue;
  const med = rows.map((r) => r.sec).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const short = rows.filter((r) => r.sec < med / 2);
  console.log(`耗時（${f}）：${rows.length} 筆、中位數 ${med} 秒；短於一半的 ${short.length} 筆${short.length ? '：' + short.map((r) => `${r.name} ${r.sec} 秒`).join('、') : ''}`);
}

// ---------- 2. 舊 ev2 ----------
const li = process.argv.indexOf('--legacy');
if (li > 0) {
  const dir = path.resolve(process.argv[li + 1]);
  const cmds = new Map();
  for (const f of fs.readdirSync(path.join(REPO, 'tools', 'ev')).filter((x) => /_mut2?\.sh$/.test(x))) for (const s of scenariosOf(fs.readFileSync(path.join(REPO, 'tools', 'ev', f), 'utf8'))) cmds.set(s.label, s.cmd);
  const shells = fs.readdirSync(dir).filter((f) => /^ev2-.+\.shell$/.test(f)).map((f) => f.slice(4, -6)).sort();
  const res = { strict: [], loose: [], noLog: [] };
  const flagged = [];
  for (const l of shells) {
    const sh = fs.readFileSync(path.join(dir, `ev2-${l}.shell`), 'utf8');
    const lf = path.join(dir, `ev_${l}.log`);
    const log = fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8') : null;
    if (log === null) { res.noLog.push(l); continue; }
    if (cmds.has(l) && cmds.get(l)) {
      res.strict.push(l);
      const st = stateOf(sh, log, cmds.get(l));
      if (st.state !== '跑完') flagged.push(`${l}（嚴格：${st.state}）`);
    } else {
      res.loose.push(l);
      if (!LOOSE.test(log)) flagged.push(`${l}（寬鬆：一行完成的證據都沒有）`);
    }
  }
  suspect += flagged.length;
  console.log(`舊 ev2（${path.basename(dir)}）：外殼紀錄 ${shells.length} 份＝嚴格判 ${res.strict.length}＋寬鬆判 ${res.loose.length}＋沒有 log ${res.noLog.length}（沒有 log 的本來就判成情境未成立）`);
  console.log(`  可能被中斷、需重驗 ${flagged.length} 份${flagged.length ? '：' + flagged.join('、') : ''}`);
}
console.log(suspect ? `可能被中斷、需重驗：${suspect} 份` : '沒有找到沒跑完卻被分類的');
process.exitCode = suspect ? 1 : 0;
