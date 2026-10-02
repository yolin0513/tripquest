// tools/ev 分段重跑的進度（2026-10-02）：逐個情境列出「跑完／被中斷／開了頭沒跑完／還沒跑」，不只給總數。
//
// 「跑完」看的是**完成的證據**，不是結束的痕跡：
//   · 有 exit= 不等於跑完——被停掉的那一刻外殼還來得及寫 exit=（2026-10-02 實測：six-3 倒序跑到一半，留下 exit=127）。
//   · 完成的證據依這個情境實際跑的指令而定（從驅動腳本裡它用的那個指令變數推）：
//       指令裡每一次 pushgatetest → log 要有一行「N 項通過」；
//       每一次 f8verify → log 要有一行 F8 驗法的結論句（「全部擋下…」或「擋下：F8 驗法…」；f8verify 的每個出口都印其中一句才結束）；
//       指令最後若會 echo「結果：…」→ log 要有那一行。
//     （第一版只認「N 項通過」：f9 有 10 個跑 F8 驗法的情境結尾根本沒有這一行，跑完了也會永遠被判成被中斷——開跑前查出來的。）
//   · 判準本身的驗法：--check <目錄> 拿當年確實跑完的外殼紀錄與 log 跑一次，每一份都要判成「跑完」；再把每份 log 截掉結尾那一行
//     當對照組，每一份都要判成「被中斷」。
//
//   node tools/ev/progress.mjs                 寫 .logs/ev/progress.txt（只讀、只寫進度檔）
//   node tools/ev/progress.mjs --is-done <標籤> 那個情境已經跑完 → 回 0，否則回 1（給驅動跳過已跑完的情境）
//   node tools/ev/progress.mjs --check <目錄>   用那個目錄裡的舊紀錄驗判準（兩向）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const EV = path.join(REPO, '.logs', 'ev');
const ORDER = [['six_mut', '18a7d94'], ['f9_mut', '936b3eb'], ['f10_mut', '44eac70'], ['di_mut', 'c79b4ca'], ['last_mut', 'f125671']];

// 驅動裡的情境：[{ label, cmd }]；cmd＝它用的那個指令變數展開後的字串
export function scenariosOf(text) {
  const vars = {};
  for (const m of text.matchAll(/^([A-Z][A-Z0-9_]*)='([^']*)'/gm)) vars[m[1]] = m[2];
  const out = [];
  for (const line of text.split('\n')) {
    const loop = line.match(/^for k in ([^;]+); do run "([^"$]+)\$k" "\$([A-Z0-9_]+)"/);
    if (loop) { for (const k of loop[1].trim().split(/\s+/)) out.push({ label: loop[2] + k, cmd: vars[loop[3]] ?? null }); continue; }
    // 指令可以是變數（"$PG"）或字面字串（"F8VERIFY_ONLY=bp node scripts/f8verify.mjs"）——第一版只認變數，f9 有 10 個情境被默默漏掉
    const m = line.match(/^run ("?)([A-Za-z0-9_.-]+)\1 "([^"]*)"/);
    if (m) {
      const v = m[3].match(/^\$([A-Z0-9_]+)$/);
      out.push({ label: m[2], cmd: v ? vars[v[1]] ?? null : m[3] });
    }
  }
  return out;
}
// 獨立的母體核對：不用上面的解析，直接數「run 開頭的行」＋迴圈的項目數；兩邊不等就點名沒被解析到的行
export function runLineCount(text) {
  let n = 0;
  for (const line of text.split('\n')) {
    const loop = line.match(/^for k in ([^;]+); do run /);
    if (loop) n += loop[1].trim().split(/\s+/).length;
    else if (/^run [^(]/.test(line)) n += 1;
  }
  return n;
}
// 這個指令跑完時 log 裡該有的證據
export function needOf(cmd) {
  return {
    pg: (cmd.match(/node scripts\/pushgatetest\.mjs/g) || []).length,
    fv: (cmd.match(/scripts\/f8verify\.mjs/g) || []).length,
    result: /echo "結果：/.test(cmd) ? 1 : 0,
  };
}
export function haveOf(log) {
  return {
    pg: (log.match(/^\d+ 項通過/gm) || []).length,
    fv: (log.match(/^(全部擋下|擋下：F8 驗法)/gm) || []).length,
    result: (log.match(/^結果：/gm) || []).length,
  };
}
export function stateOf(sh, log, cmd) {
  if (sh === null) return { state: '還沒跑' };
  const m = sh.match(/exit=(\d+)/);
  if (!m) return { state: '開了頭沒跑完' };
  if (cmd === null) return { state: '判不出（驅動裡找不到它的指令）', exit: Number(m[1]) };
  const need = needOf(cmd), have = haveOf(log || '');
  const ok = have.pg >= need.pg && have.fv >= need.fv && have.result >= need.result && (need.pg + need.fv + need.result) > 0;
  return { state: ok ? '跑完' : '被中斷（有 exit=、沒有完成的證據）', exit: Number(m[1]), need, have };
}

function rowsFor(dir) {
  const rows = [];
  for (const [d, c] of ORDER) {
    const text = fs.readFileSync(path.join(HERE, d + '.sh'), 'utf8');
    const sc = scenariosOf(text), n = runLineCount(text);
    if (sc.length !== n) {
      const got = new Set(sc.map((s) => s.label));
      const missed = text.split('\n').filter((l) => /^run [^(]/.test(l) && !got.has((l.match(/^run "?([A-Za-z0-9_.-]+)/) || [])[1]));
      console.log(`✗ ${d}：解析出 ${sc.length} 個情境，另一種數法是 ${n} 個——母體對不上（漏掉：${missed.map((l) => l.slice(0, 50)).join('／') || '迴圈'}）`);
      process.exit(4);
    }
    for (const { label, cmd } of sc) {
      const f = path.join(dir, `ev2-${label}.shell`), lf = path.join(dir, `ev_${label}.log`);
      const sh = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
      const log = fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8') : null;
      rows.push({ driver: d, commit: c, label, cmd, ...stateOf(sh, log, cmd), log });
    }
  }
  return rows;
}

// ---------- 對照組（合成）----------
{
  const drv = "BOTH='echo \"== 預設順序\"; node scripts/pushgatetest.mjs; echo \"== 倒序\"; node scripts/pushgatetest.mjs'\nFV='F8VERIFY_ONLY=bp node scripts/f8verify.mjs'\nrun a \"$BOTH\" x\nfor k in p q; do run \"b-$k\" \"$FV\" y; done";
  const sc = scenariosOf(drv);
  const okParse = sc.map((s) => s.label).join(',') === 'a,b-p,b-q' && needOf(sc[0].cmd).pg === 2 && needOf(sc[1].cmd).fv === 1;
  const sh = '[a] exit=1\n';
  const okBoth = stateOf(sh, '== 預設順序\n120 項通過\n== 倒序\n120 項通過\n', sc[0].cmd).state === '跑完'
    && stateOf(sh, '== 預設順序\n120 項通過\n== 倒序\n✓ 跑到一半\n', sc[0].cmd).state.startsWith('被中斷');
  const okFv = stateOf(sh, '…\n全部擋下（只跑了 bp，不登記）\n', sc[1].cmd).state === '跑完'
    && stateOf(sh, '…\n✓ 一格\n', sc[1].cmd).state.startsWith('被中斷');
  // 字面指令也要認得；獨立數法要數到同樣的數
  const lit = 'run c "F8VERIFY_ONLY=is node scripts/f8verify.mjs" scripts/x=p.json';
  const okLit = scenariosOf(lit)[0]?.cmd === 'F8VERIFY_ONLY=is node scripts/f8verify.mjs' && runLineCount(drv + '\n' + lit) === 4 && scenariosOf(drv + '\n' + lit).length === 4;
  if (!(okParse && okBoth && okFv && okLit)) { console.log(`✗ 對照組沒過（解析＝${okParse}、雙輪＝${okBoth}、F8＝${okFv}）`); process.exit(4); }
}

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (arg('--is-done')) {
  const r = rowsFor(EV).find((x) => x.label === arg('--is-done'));
  process.exit(r && r.state === '跑完' ? 0 : 1);
}
if (arg('--check')) {
  // 判準本身的驗法：舊紀錄（當年確實跑完）每份都要判成跑完；截掉 log 結尾那一行（對照組）每份都要判成被中斷
  const rows = rowsFor(arg('--check')).filter((r) => r.state !== '還沒跑');
  const notDone = rows.filter((r) => r.state !== '跑完');
  let cut = 0, cutOk = 0;
  for (const r of rows.filter((x) => x.state === '跑完')) {
    const lines = r.log.replace(/\s+$/, '').split('\n');
    // 從結尾往前，拿掉最後一行「完成的證據」（項通過／F8 結論／結果：）以及它之後的內容
    const idx = lines.map((l, i) => (/^(\d+ 項通過|全部擋下|擋下：F8 驗法|結果：)/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
    if (idx === undefined) continue;
    cut++;
    if (stateOf('[x] exit=1\n', lines.slice(0, idx).join('\n'), r.cmd).state.startsWith('被中斷')) cutOk++;
  }
  console.log(`判準驗法（${arg('--check')}）：舊紀錄 ${rows.length} 份，判成跑完 ${rows.length - notDone.length}、沒判成跑完 ${notDone.length}${notDone.length ? '：' + notDone.map((r) => `${r.label}（${r.state}）`).join('、') : ''}`);
  console.log(`對照組：截掉結尾證據 ${cut} 份，判成被中斷 ${cutOk} 份`);
  process.exitCode = notDone.length === 0 && cut === rows.length && cutOk === cut && rows.length > 0 ? 0 : 1;
} else {
  const rows = rowsFor(EV);
  const STATES = ['跑完', '被中斷（有 exit=、沒有完成的證據）', '開了頭沒跑完', '判不出（驅動裡找不到它的指令）', '還沒跑'];
  const cnt = (s) => rows.filter((r) => r.state === s).length;
  const by = (d, s) => rows.filter((r) => r.driver === d && r.state === s).length;
  const sum = STATES.reduce((n, s) => n + cnt(s), 0);
  const lines = [`tools/ev 進度（${new Date().toISOString()}）：情境 ${rows.length} 個＝${STATES.map((s) => `${s} ${cnt(s)}`).join('、')}；相加 ${sum}${sum === rows.length ? '＝母體' : '≠母體'}`];
  for (const [d, c] of ORDER) lines.push(`  ${d} @ ${c}：${STATES.map((s) => `${s.replace(/（.*）/, '')} ${by(d, s)}`).join('、')}`);
  lines.push('逐條（只有「跑完」的算數；其餘下一段從頭重跑）：');
  for (const r of rows) {
    const ev = r.need ? `｜需要 項通過${r.need.pg}／F8結論${r.need.fv}／結果${r.need.result}，有 ${r.have.pg}／${r.have.fv}／${r.have.result}` : '';
    lines.push(`  ${r.state}｜${r.driver}｜${r.label}${r.exit !== undefined ? `｜exit=${r.exit}` : ''}${ev}`);
  }
  fs.writeFileSync(path.join(EV, 'progress.txt'), lines.join('\n') + '\n');
  console.log(lines.slice(0, ORDER.length + 1).join('\n'));
  process.exitCode = sum === rows.length ? 0 : 1;
}
