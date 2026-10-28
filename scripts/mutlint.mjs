// 突變清單的母體檢查（npm run mutlint；2026-10-02）。只讀、不寫任何檔（對照組的合成目錄除外，跑完刪掉）。
//
// 為什麼：148 份突變原本放在 Session 暫存區，Session 一沒就全部消失（$TEMP/tq-ev 被 Windows 清掉一半是現場預演），
// 所以搬進 tools/mutations/。這支守三件事（第 3 件見 findCount 上面）：
//   1. 母體用登記制：tools/mutations/ 裡每一份 JSON 必須是兩種突變格式之一——mutate.mjs 的 [{name, find, replace}|{name, edits}]，
//      或驗閘門補丁的 [{from, to}]（一份檔＝一條突變）。兩種都不是、讀不懂 → 點名那一份、非 0。檢查條數≠母體條數、
//      分類加總≠JSON 總數 → 非 0。（第一版只認 find/replace，148 份只算到 7 份，結論照樣是「0 條有問題」——2026-10-02 實測。）
//   2. 沒有一條突變只改空白或行尾（mutate.mjs 判斷「是不是原樣」會先統一行尾，只改行尾的突變會被看成什麼都沒改）。
// 回傳值：0 通過；1 有問題；4 對照組沒過（檢查器壞了）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintMutations } from './mutate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DIR = path.join(ROOT, 'tools', 'mutations');
// 登記過的非突變檔（目前沒有：D1 查詢的輸出含個資，留在本機、不進 repo）
export const NOT_MUTATIONS = [];

export function asMutations(f, j) {
  if (Array.isArray(j) && j.length && j.every((m) => m && typeof m.from === 'string' && typeof m.to === 'string')) {
    return [{ name: f, edits: j.map((x) => ({ find: x.from, replace: x.to })) }];
  }
  if (Array.isArray(j) && j.length && j.every((m) => m && typeof m.name === 'string'
    && (Array.isArray(m.edits) || (typeof m.find === 'string' && typeof m.replace === 'string')))) return j;
  return null;
}

// 3.（2026-10-28）mutate.mjs 格式的每一條突變，每一處 find 都必須在目標檔（現在的工作區）裡**剛好一處**——
//    跟 mutate.mjs 套用時同一個判準（原文比對、不統一行尾）。找不到或不只一處，那條突變跑到時只會印「沒跑」，
//    清單上有、報告裡算數，實際上永遠不會紅。當天查到 4 條已經是這樣（最早在 c063c64 之前就死了），沒有任何東西紅過。
//    補丁格式 [{from, to}] 不在此列：它由 tools/ev 的驅動腳本套在**指定的舊 commit** 上、目標檔也由驅動腳本給，
//    拿現在的檔比沒有意義；輸出照實寫「不適用」幾份。
function findCount(root, m, e) {
  let text;
  try { text = fs.readFileSync(path.join(root, m.file), 'utf8'); } catch { return null; }
  return text.split(e.find).length - 1;
}

export function scanDir(d, notMutations = NOT_MUTATIONS, root = ROOT) {
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  const others = fs.readdirSync(d).filter((f) => !f.endsWith('.json'));
  const problems = [];
  let pop = 0, checked = 0, unrecognized = 0, findChecked = 0, patchFormat = 0;
  const bad = [], used = [], known = [], dead = [];
  for (const f of files) {
    if (notMutations.includes(f)) { known.push(f); continue; }
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); }
    catch (e) { problems.push(`${f}（讀不懂：${e.message.split('\n')[0]}）`); unrecognized++; continue; }
    const ms = asMutations(f, j);
    if (!ms) { problems.push(`${f}（不是任何一種突變格式，也沒登記成非突變檔）`); unrecognized++; continue; }
    used.push(f);
    pop += ms.length;
    const r = lintMutations(ms);
    checked += r.checked;
    for (const n of r.bad) bad.push(`${f}：${n}`);
    if (Array.isArray(j) && j.every((m) => m && typeof m.from === 'string')) { patchFormat++; continue; }
    for (const m of ms) {
      if (typeof m.file !== 'string' || !m.file) { dead.push(`${f}｜${m.name}：沒寫 file`); continue; }
      for (const e of (m.edits || [{ find: m.find }])) {
        findChecked++;
        const n = findCount(root, m, e);
        if (n === null) dead.push(`${f}｜${m.name}：讀不到 ${m.file}`);
        else if (n !== 1) dead.push(`${f}｜${m.name}：find 在 ${m.file} 出現 ${n} 次`);
      }
    }
  }
  for (const f of others) problems.push(`${f}（不是 JSON，放錯地方）`);
  for (const f of notMutations) if (!files.includes(f)) problems.push(`${f}（登記成非突變檔，但目錄裡沒有——登記過期）`);
  if (checked !== pop) problems.push(`檢查 ${checked} 條，不等於母體 ${pop} 條`);
  if (used.length + known.length + unrecognized !== files.length) problems.push(`分類加總 ${used.length + known.length + unrecognized} 份，不等於 JSON 總數 ${files.length} 份`);
  return { files: files.length, used: used.length, known: known.length, unrecognized, pop, checked, bad, problems, findChecked, patchFormat, dead };
}

export const describeScan = (label, r) => `${label}：JSON ${r.files} 份＝突變 ${r.used}＋登記的非突變 ${r.known}＋認不出 ${r.unrecognized}；`
  + `母體 ${r.pop} 條、檢查 ${r.checked} 條、只改空白或行尾 ${r.bad.length} 條${r.bad.length ? '（' + r.bad.join('；') + '）' : ''}；`
  + `find 查了 ${r.findChecked} 處、其中找不到或不只一處 ${r.dead.length} 處（補丁格式 ${r.patchFormat} 份不適用：套在指定的舊 commit 上）`
  + `${r.problems.length ? '；問題：' + r.problems.join('；') : ''}`;

// 對照組：判斷本身，加上四種母體情境（齊全、漏一筆、讀不懂、登記過期），比對的是「點名的那一句」
export function controls(tmp, log = console.log) {
  const results = {};
  const lint = lintMutations([
    { name: '原樣', find: 'a', replace: 'b' },
    { name: '只改行尾', find: 'x\n', replace: 'x\r\n' },
    { name: '只改空白', find: 'if (a)', replace: 'if(a)' },
    { name: 'edits 裡有一處只改空白', edits: [{ find: 'a', replace: 'b' }, { find: 'c d', replace: 'cd' }] },
  ]);
  results['判斷'] = lint.checked === 4 && lint.bad.join('、') === '只改行尾、只改空白、edits 裡有一處只改空白';
  // 對照組的目標檔 x.js 放在另一個目錄（<tmp>-src），scanDir 以它為 root 去讀
  const srcRoot = tmp + '-src';
  const mk = (files, xjs = 'const a = 1;\n') => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(tmp, f), typeof v === 'string' ? v : JSON.stringify(v));
    fs.rmSync(srcRoot, { recursive: true, force: true });
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'x.js'), xjs);
  };
  const BASE = {
    'a_mut.json': [{ name: 'a', file: 'x.js', find: 'a', replace: 'b' }],
    'p_mut.json': [{ from: 'x', to: 'y' }, { from: 'z', to: '' }],
    'd1_out.json': { results: [] },
  };
  const cases = [
    ['齊全', BASE, ['d1_out.json'], (r) => r.problems.length === 0 && r.pop === 2 && r.checked === 2 && r.used === 2 && r.known === 1],
    ['漏一筆（find 拼成 fnd）', { ...BASE, 'q_mut.json': [{ name: 'q', file: 'x.js', fnd: 'a', replace: 'b' }] }, ['d1_out.json'],
      (r) => r.problems.length === 1 && /^q_mut\.json（不是任何一種突變格式/.test(r.problems[0])],
    ['讀不懂的一份', { ...BASE, 'broken.json': '{ 不是 JSON' }, ['d1_out.json'], (r) => r.problems.length === 1 && /^broken\.json（讀不懂/.test(r.problems[0])],
    ['登記過期', BASE, ['d1_out.json', 'gone.json'], (r) => r.problems.length === 1 && /^gone\.json（登記成非突變檔，但目錄裡沒有/.test(r.problems[0])],
  ];
  // find 對不上目標檔的三種（目標檔 x.js 內容各自不同）；「齊全」那一種同時是反向：x.js 裡 a 剛好一處 → 0 處死掉
  const deadCases = [
    ['find 找不到（目標檔已經改掉那一段）', 'const b = 1;\n', (r) => r.dead.length === 1 && /^a_mut\.json｜a：find 在 x\.js 出現 0 次$/.test(r.dead[0])],
    ['find 不只一處', 'const a = a;\n', (r) => r.dead.length === 1 && /^a_mut\.json｜a：find 在 x\.js 出現 \d+ 次$/.test(r.dead[0]) && !/出現 [01] 次/.test(r.dead[0])],
    ['edits 裡第二處找不到', 'const a = 1;\n', null],
  ];
  for (const [label, files, notM, ok] of cases) {
    mk(files);
    const r = scanDir(tmp, notM, srcRoot);
    results[label] = ok(r) && (label !== '齊全' || (r.dead.length === 0 && r.findChecked === 1 && r.patchFormat === 1));
    log(describeScan(`對照組（${label}）`, r) + `＝${results[label]}`);
  }
  for (const [label, xjs, ok] of deadCases) {
    if (ok) { mk(BASE, xjs); }
    else mk({ ...BASE, 'a_mut.json': [{ name: 'a', file: 'x.js', edits: [{ find: 'a', replace: 'b' }, { find: '不存在的一段', replace: 'z' }] }] }, xjs);
    const r = scanDir(tmp, ['d1_out.json'], srcRoot);
    results[label] = ok ? ok(r) : (r.dead.length === 1 && /^a_mut\.json｜a：find 在 x\.js 出現 0 次$/.test(r.dead[0]) && r.findChecked === 2);
    log(describeScan(`對照組（${label}）`, r) + `＝${results[label]}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(srcRoot, { recursive: true, force: true });
  log(`對照組：${Object.entries(results).map(([k, v]) => `${k}＝${v}`).join('、')}`);
  return Object.values(results).every(Boolean);
}

function main() {
  if (!controls(path.join(ROOT, '.logs', 'mutlint-ctl'))) { console.log('✗ 對照組沒過——檢查器壞了，不採信下面的結果'); return 4; }
  if (!fs.existsSync(DIR)) { console.log(`✗ ${path.relative(ROOT, DIR)} 不存在——母體是空的不是「沒有問題」`); return 4; }
  const r = scanDir(DIR);
  console.log(describeScan(path.relative(ROOT, DIR).split(path.sep).join('/'), r));
  if (!r.files || !r.pop) { console.log('✗ 母體是空的'); return 4; }
  if (!r.findChecked) { console.log('✗ 一處 find 都沒查到——母體是空的不是「沒有死掉的突變」'); return 4; }
  for (const x of r.dead) console.log(`  ✗ 死掉的突變：${x}`);
  if (r.problems.length || r.bad.length || r.dead.length) { console.log('✗ 有問題——非 0 結束'); return 1; }
  console.log('通過');
  return 0;
}

// 最後一定印這一行（2026-10-02）：mutlint_mut 拿它判「跑完了沒」——被強制停掉時結束碼也是 1，跟「有問題」分不出來
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) { process.exitCode = main(); console.log(`mutlint 結束：回 ${process.exitCode}`); }
