// tools/ev 分段重跑的進度（2026-10-02）：逐個情境列出「跑完／開了頭沒跑完／還沒跑」，不只給總數。
//   跑完＝外殼紀錄（.logs/ev/ev2-<標籤>.shell）有「exit=」那一行；開了頭沒跑完＝有外殼紀錄、沒有 exit=；還沒跑＝沒有外殼紀錄。
//   應該跑的情境從驅動腳本數：「run <標籤> …」與「for k in a b; do run "<前綴>-$k" …」。
//   node tools/ev/progress.mjs [--out <檔>]     （預設寫 .logs/ev/progress.txt；只讀、只寫進度檔）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const EV = path.join(REPO, '.logs', 'ev');
const ORDER = [['six_mut', '18a7d94'], ['f9_mut', '936b3eb'], ['f10_mut', '44eac70'], ['di_mut', 'c79b4ca'], ['last_mut', 'f125671']];

export function labelsOf(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const loop = line.match(/^for k in ([^;]+); do run "([^"$]+)\$k"/);
    if (loop) { for (const k of loop[1].trim().split(/\s+/)) out.push(loop[2] + k); continue; }
    const m = line.match(/^run ("?)([A-Za-z0-9_.-]+)\1 /);
    if (m) out.push(m[2]);
  }
  return out;
}
// 對照組：迴圈與一般寫法都要數到
const ctl = labelsOf('run six-1 "$BOTH" x\nfor k in a b; do run "di-$k" "$BOTH" y; done\n# run 註解不算 "$X"');
if (ctl.join(',') !== 'six-1,di-a,di-b') { console.log(`✗ 對照組沒過（數情境）：${ctl.join(',')}`); process.exit(4); }

const rows = [];
for (const [d, c] of ORDER) {
  const labels = labelsOf(fs.readFileSync(path.join(HERE, d + '.sh'), 'utf8'));
  for (const l of labels) {
    const f = path.join(EV, `ev2-${l}.shell`);
    const sh = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    const m = sh && sh.match(/exit=(\d+)/);
    // 有 exit= 不等於跑完：被殺的那一刻外殼還來得及寫 exit=（2026-10-02 實測：six-3 倒序跑到一半被停，留下 exit=127）。
    // 跑完＝log 裡每一輪都跑到結尾：輪數＝「== 預設順序／== 倒序」標頭數（沒有標頭＝1 輪），每一輪結尾各有一行「N 項通過」。
    const logF = path.join(EV, `ev_${l}.log`);
    const log = fs.existsSync(logF) ? fs.readFileSync(logF, 'utf8') : '';
    const rounds = Math.max(1, (log.match(/^== (預設順序|倒序)$/gm) || []).length);
    const ends = (log.match(/^\d+ 項通過/gm) || []).length;
    const state = !sh ? '還沒跑' : !m ? '開了頭沒跑完' : ends >= rounds ? '跑完' : '被中斷（有 exit=、log 沒跑到結尾）';
    rows.push({ driver: d, commit: c, label: l, state, exit: m ? Number(m[1]) : null, rounds, ends });
  }
}
const by = (d, s) => rows.filter((r) => r.driver === d && r.state === s).length;
const STATES = ['跑完', '被中斷（有 exit=、log 沒跑到結尾）', '開了頭沒跑完', '還沒跑'];
const cnt = (s) => rows.filter((r) => r.state === s).length;
const sum = STATES.reduce((n, s) => n + cnt(s), 0);
const lines = [`tools/ev 進度（${new Date().toISOString()}）：情境 ${rows.length} 個＝${STATES.map((s) => `${s} ${cnt(s)}`).join('、')}；相加 ${sum}${sum === rows.length ? '＝母體' : '≠母體'}`];
for (const [d, c] of ORDER) lines.push(`  ${d} @ ${c}：${STATES.map((s) => `${s.replace(/（.*）/, '')} ${by(d, s)}`).join('、')}`);
lines.push('逐條（只有「跑完」的算數；其餘下一段從頭重跑）：');
for (const r of rows) lines.push(`  ${r.state}｜${r.driver}｜${r.label}${r.exit !== null ? `｜exit=${r.exit}` : ''}${r.state !== '還沒跑' ? `｜輪數 ${r.rounds}、跑到結尾 ${r.ends}` : ''}`);
if (sum !== rows.length) { fs.writeFileSync(path.join(EV, 'progress.txt'), lines.join('\n') + '\n'); console.log(lines[0]); process.exit(1); }
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : path.join(EV, 'progress.txt');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.slice(0, ORDER.length + 1).join('\n'));
