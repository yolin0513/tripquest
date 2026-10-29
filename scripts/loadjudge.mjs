// 一段時間裡機器乾不乾淨（2026-10-29）：讀 tools/loadsample.ps1 的紀錄，判定某段耗時能不能採計。
//   node scripts/loadjudge.mjs <紀錄檔> <開始 HH:MM:SS> <結束 HH:MM:SS> --base-foreign <開跑前量的外來基線>
//   node scripts/loadjudge.mjs                 不帶參數＝對照組：合成紀錄從命令列入口跑一遍，每一條規則各一種
//                                              （突變清單 tools/mutations/mut_loadjudge.json 用這個入口）
// 回 0＝乾淨（耗時可採計）、1＝受干擾（耗時不採計，功能結果照採）、2＝紀錄讀不到或這段沒有取樣（不是乾淨）。
//
// 門檻（外來與系統兩塊同一個形狀；觀察者 claude 與本 repo 自己開的不設門檻）：
//   平均 ≤ 基線 ＋ 8.3（12 核的一個核心）、任何一窗 ≤ 35。
//   外來基線：每次開跑前量（2026-10-28 那輪是 12.0）。
//   系統基線 1.2：2026-10-28 seq 232（乾淨那一條）65 窗平均 1.18；2026-10-29 早上空機 6 窗 0.3～0.5。可用 --base-system 覆寫。
// 系統那一塊為什麼也要門檻：2026-10-28 一輪突變期間，安裝程式（推論，在 系統目錄（%SystemRoot%） 底下、被算進系統）吃掉約 20%，
//   當時只有外來那塊有門檻，它一聲都沒響。看得見而擋不下來，跟看不見是同一個結果。
// 照這條規則回頭算：seq 230、231 系統平均 23.2／19.8 → 受干擾（與當時人工改判一致）；seq 232 平均 1.18、
//   但前 6 窗（23:54～23:55）系統 6.6～9.1——在門檻內，只是「系統約 1%」那句說得太滿（那 6 窗是安裝收尾，推論）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ONE_CORE = 8.3;
const MAX_WINDOW = 35;
const SYSTEM_BASE = 1.2;
const LINE = /^\uFEFF?(\d\d):(\d\d):(\d\d) system=([\d.]+) observer=([\d.]+) own=([\d.]+) foreign=([\d.]+)/;

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const sec = (h, m, s) => h * 3600 + m * 60 + s;
const parseHMS = (t) => { const m = /^(\d\d):(\d\d):(\d\d)$/.exec(t || ''); return m ? sec(+m[1], +m[2], +m[3]) : NaN; };

function judge(file, from, to, baseForeign, baseSystem) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.log(`紀錄讀不到：${file}（${e.code}）——不是乾淨`); return 2; }
  const a = parseHMS(from), b0 = parseHMS(to);
  if (Number.isNaN(a) || Number.isNaN(b0) || !Number.isFinite(baseForeign)) { console.log('參數不對：要 <開始> <結束> HH:MM:SS 與 --base-foreign 數字'); return 2; }
  const b = b0 < a ? b0 + 86400 : b0;                     // 跨午夜
  const all = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const rows = [];
  for (const l of all) {
    const m = LINE.exec(l); if (!m) continue;
    let s = sec(+m[1], +m[2], +m[3]); if (b0 < a && s < a) s += 86400;
    if (s >= a && s < b) rows.push({ t: `${m[1]}:${m[2]}:${m[3]}`, system: +m[4], foreign: +m[7] });
  }
  console.log(`讀到 ${all.length} 行、這段（${from}～${to}）${rows.length} 窗`);
  if (!rows.length) { console.log('這段沒有任何取樣——不是乾淨，是沒量到'); return 2; }
  const why = [];
  for (const [key, label, base] of [['foreign', '外來', baseForeign], ['system', '系統', baseSystem]]) {
    const avg = rows.reduce((t, r) => t + r[key], 0) / rows.length;
    const peak = rows.reduce((p, r) => (r[key] > p[key] ? r : p));
    console.log(`  ${label}：平均 ${avg.toFixed(1)}（門檻 ${(base + ONE_CORE).toFixed(1)}）、最大 ${peak[key]}＠${peak.t}（門檻 ${MAX_WINDOW}）`);
    if (avg > base + ONE_CORE) why.push(`${label}平均 ${avg.toFixed(1)} 超過 ${(base + ONE_CORE).toFixed(1)}`);
    if (peak[key] > MAX_WINDOW) why.push(`${label}單窗 ${peak[key]}＠${peak.t} 超過 ${MAX_WINDOW}`);
  }
  if (why.length) { console.log(`受干擾：${why.join('；')}——耗時不採計，功能結果照採`); return 1; }
  console.log('乾淨：耗時可採計');
  return 0;
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadjudge-'));
  const self = fileURLToPath(import.meta.url);
  const ln = (t, sys, fgn) => `${t} system=${sys} observer=1 own=5 foreign=${fgn} top=[x=1] systop=[y=1]`;
  const series = (sys, fgn, spike) => Array.from({ length: 6 }, (_, i) => ln(`10:00:${String(i * 10).padStart(2, '0')}`, spike && i === 3 && spike.sys != null ? spike.sys : sys, spike && i === 3 && spike.fgn != null ? spike.fgn : fgn)).join('\n');
  const cases = [
    ['乾淨', series(0.5, 2), 0, /^乾淨/m],
    ['系統平均超過（安裝程式那種）', series(20, 2), 1, /受干擾：系統平均/m],
    ['系統單窗超過', series(0.5, 2, { sys: 40 }), 1, /受干擾：系統單窗/m],
    ['外來平均超過', series(0.5, 20), 1, /受干擾：外來平均/m],
    ['外來單窗超過', series(0.5, 2, { fgn: 40 }), 1, /受干擾：外來單窗/m],
    ['這段沒有取樣', ln('09:00:00', 0.5, 2), 2, /沒有任何取樣/m],
    ['格式讀不懂', 'garbage line\n10:00:05 nothing', 2, /沒有任何取樣/m],
  ];
  let bad = 0;
  for (const [name, body, want, re] of cases) {
    const f = path.join(dir, 'case.log');
    fs.writeFileSync(f, body + '\n');
    const r = spawnSync(process.execPath, [self, f, '10:00:00', '10:01:00', '--base-foreign', '2'], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const okk = r.status === want && re.test(out);
    if (!okk) bad++;
    console.log(`${okk ? '✓' : '✗'} ${name}：回 ${r.status}（應為 ${want}）${okk ? '' : '\n' + out}`);
  }
  // 跨午夜：23:59:50 與 00:00:10 都要落在 23:59:00～00:01:00 裡
  const f = path.join(dir, 'midnight.log');
  fs.writeFileSync(f, [ln('23:59:50', 0.5, 2), ln('00:00:10', 0.5, 2)].join('\n') + '\n');
  const r = spawnSync(process.execPath, [self, f, '23:59:00', '00:01:00', '--base-foreign', '2'], { encoding: 'utf8' });
  const mid = r.status === 0 && /這段（23:59:00～00:01:00）2 窗/.test(r.stdout);
  if (!mid) bad++;
  console.log(`${mid ? '✓' : '✗'} 跨午夜兩窗都算進去：回 ${r.status}${mid ? '' : '\n' + r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${cases.length + 1 - bad} 項通過、沒過 ${bad} 項（對照組共 ${cases.length + 1} 種；這一行是突變執行器認的總結行）`);
  return bad ? 1 : 0;
}

if (process.argv.length === 2) process.exit(selftest());
const [file, from, to] = process.argv.slice(2).filter((x, i, a) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
const bs = arg('--base-system');
process.exit(judge(file, from, to, Number(arg('--base-foreign')), bs === undefined ? SYSTEM_BASE : Number(bs)));
