// 突變清單的母體檢查（npm run mutlint；2026-10-02）。只讀、不寫任何檔（對照組的合成目錄除外，跑完刪掉）。
//
// 為什麼：148 份突變原本放在 Session 暫存區，Session 一沒就全部消失（$TEMP/tq-ev 被 Windows 清掉一半是現場預演），
// 所以搬進 tools/mutations/。這支守兩件事：
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

export function scanDir(d, notMutations = NOT_MUTATIONS) {
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  const others = fs.readdirSync(d).filter((f) => !f.endsWith('.json'));
  const problems = [];
  let pop = 0, checked = 0, unrecognized = 0;
  const bad = [], used = [], known = [];
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
  }
  for (const f of others) problems.push(`${f}（不是 JSON，放錯地方）`);
  for (const f of notMutations) if (!files.includes(f)) problems.push(`${f}（登記成非突變檔，但目錄裡沒有——登記過期）`);
  if (checked !== pop) problems.push(`檢查 ${checked} 條，不等於母體 ${pop} 條`);
  if (used.length + known.length + unrecognized !== files.length) problems.push(`分類加總 ${used.length + known.length + unrecognized} 份，不等於 JSON 總數 ${files.length} 份`);
  return { files: files.length, used: used.length, known: known.length, unrecognized, pop, checked, bad, problems };
}

export const describeScan = (label, r) => `${label}：JSON ${r.files} 份＝突變 ${r.used}＋登記的非突變 ${r.known}＋認不出 ${r.unrecognized}；`
  + `母體 ${r.pop} 條、檢查 ${r.checked} 條、只改空白或行尾 ${r.bad.length} 條${r.bad.length ? '（' + r.bad.join('；') + '）' : ''}`
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
  const mk = (files) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(tmp, f), typeof v === 'string' ? v : JSON.stringify(v));
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
  for (const [label, files, notM, ok] of cases) {
    mk(files);
    const r = scanDir(tmp, notM);
    results[label] = ok(r);
    log(describeScan(`對照組（${label}）`, r) + `＝${results[label]}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`對照組：${Object.entries(results).map(([k, v]) => `${k}＝${v}`).join('、')}`);
  return Object.values(results).every(Boolean);
}

function main() {
  if (!controls(path.join(ROOT, '.logs', 'mutlint-ctl'))) { console.log('✗ 對照組沒過——檢查器壞了，不採信下面的結果'); return 4; }
  if (!fs.existsSync(DIR)) { console.log(`✗ ${path.relative(ROOT, DIR)} 不存在——母體是空的不是「沒有問題」`); return 4; }
  const r = scanDir(DIR);
  console.log(describeScan(path.relative(ROOT, DIR).split(path.sep).join('/'), r));
  if (!r.files || !r.pop) { console.log('✗ 母體是空的'); return 4; }
  if (r.problems.length || r.bad.length) { console.log('✗ 有問題——非 0 結束'); return 1; }
  console.log('通過');
  return 0;
}

// 最後一定印這一行（2026-10-02）：mutlint_mut 拿它判「跑完了沒」——被強制停掉時結束碼也是 1，跟「有問題」分不出來
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) { process.exitCode = main(); console.log(`mutlint 結束：回 ${process.exitCode}`); }
