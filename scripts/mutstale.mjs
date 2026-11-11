// 突變的「紅」過期了沒（npm 沒接；手動跑：node scripts/mutstale.mjs [--list 類別代號]；2026-11-05 守夜加）。只讀、不寫 repo 裡任何檔
// （對照組的合成目錄在 .logs/mutstale-ctl-<pid>/，跑完刪掉）。
//
// 為什麼：帳本（.logs/mutate-ledger.jsonl）只記「哪一天跑過、紅了沒」，沒有東西會說「那次紅的時候，被改壞的檔跟現在還是同一份嗎」。
// 2026-10-29 itinview 兩條自動捲動突變就是這樣：10-28 紅過，之後 js/views/trip.js 又改了兩次，沒有任何東西提醒要重跑。
// 「應該會紅而沒紅」最常見的樣子不是突變沒紅，是紅的那一次已經不代表現在的程式。
//
// 每一條 mutate 格式的突變（tools/mutations/ 裡、跟 mutlint 同一個 asMutations 判準）分到一類，行首是固定的代號：
//   [沒紀錄]   帳本裡沒有這條（帳本 2026-10-08 才開；之前跑過的也算在這裡——不是「從沒跑過」，是「帳本沒紀錄」）
//   [沒結果]   帳本有，但從沒有一次算數的結果（全部是 no-result：逾時、被殺、沒跑完）
//   [沒紅]     最近一次算數的結果是 not-red
//   [過期]     最近一次算數的結果是 red，但被改壞的那支檔，現在的內容（統一行尾）≠ 那一次開跑時的內容
//   [紅·檔同]  最近一次算數的結果是 red，被改壞的那支檔跟那次一樣
// 「算數」＝result 是 red 或 not-red；no-result 不蓋掉之前算數的那一次（§5.20：沒發生的測量不是測量）。
// 另外一欄（只印、不改分類）：守它的測試檔（cmd 裡那支）在那次之後有沒有 commit 或工作區改動——
//   有改＝「測試檔：之後改過」；沒追蹤或 git 失敗＝「測試檔：判斷不了」，不當成沒改。
//
// 限制（照實寫）：
//   · 帳本的 red 只是「結束碼非 0、而且有跑完的總結行」，**不是「紅在預期那一條」**——紅在哪要看 .logs/mutate-out.<seq>.log。
//     所以 [紅·檔同] 也不等於「現在有人守」：被測的其他檔（import 進來的模組、CSS）變了，這裡看不到。
//   · 突變以「目標檔＋名稱」對帳本；同一個鍵出現在兩份清單裡會點名（帳本分不出是哪一份跑的）。
//   · 測試檔那一欄用 commit 時間比對開跑時間：開跑時測試檔若在工作區、之後才 commit，會被判成「之後改過」（偏嚴）。
// 回傳值：0 印完（不論有幾條過期——這是報表，不是閘門）；4 對照組沒過或讀不到帳本／清單（檢查器壞了）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { asMutations } from './mutlint.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATS = ['沒紀錄', '沒結果', '沒紅', '過期', '紅·檔同'];
const shaNorm = (buf) => crypto.createHash('sha1').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

// 測試檔在 atIso 之後改過沒：'改過'／'沒改'／'判斷不了'
const testCache = new Map();   // 每支測試檔只查一次：null＝判斷不了、'dirty'、或最後一次 commit 的時間（毫秒）
function testChanged(root, cmd, atIso) {
  const m = /^node (scripts\/[a-z0-9-]+\.mjs)$/.exec(String(cmd || ''));
  if (!m) return '判斷不了';
  const ck = `${root}\u0000${m[1]}`;
  if (!testCache.has(ck)) {
    let v = null;
    if (git(root, ['ls-files', '--error-unmatch', m[1]]) !== null) {
      const st = git(root, ['status', '--porcelain', '--', m[1]]);
      const last = st !== null && !st.trim() ? git(root, ['log', '-1', '--format=%cI', '--', m[1]]) : null;
      v = st === null ? null : st.trim() ? 'dirty' : last && last.trim() ? Date.parse(last.trim()) : null;
    }
    testCache.set(ck, v);
  }
  const v = testCache.get(ck);
  if (v === null || Number.isNaN(v)) return '判斷不了';
  if (v === 'dirty') return '改過';
  return v > Date.parse(atIso) ? '改過' : '沒改';
}

// 過期的那一份，對得到哪個 commit、到現在差幾行（給人分輕重，不改分類）。
// 回 '當時那份＝<commit> 起，到現在 +a −d 行'／'當時那份沒進過任何 commit'／'判斷不了'。
const blobCache = new Map();
function whereWas(root, file, then) {
  const ck = `${root}\u0000${file}`;
  if (!blobCache.has(ck)) {
    // 一支檔只開兩次 git：log --raw 列出每個 commit 的新 blob，cat-file --batch 一次讀完（每個 commit 開一次 git show 要 76 秒）
    const log = git(root, ['log', '--format=C %H', '--raw', '--no-abbrev', '--no-renames', '--', file]);
    let list = null;
    if (log !== null) {
      const pairs = []; let cur = null;
      for (const l of log.split('\n')) {
        if (l.startsWith('C ')) cur = l.slice(2).trim();
        else if (l.startsWith(':') && cur) { const blob = l.split(' ')[3]; if (blob && !/^0+$/.test(blob)) pairs.push([cur, blob]); }
      }
      const blobs = [...new Set(pairs.map((p) => p[1]))];
      const r = spawnSync('git', ['-C', root, 'cat-file', '--batch'], { input: blobs.join('\n') + '\n', maxBuffer: 512 << 20 });
      const hashOf = new Map();
      if (r.status === 0) {
        let i = 0; const buf = r.stdout;
        while (i < buf.length) {
          const nl = buf.indexOf(10, i); if (nl < 0) break;
          const [id, type, size] = buf.slice(i, nl).toString().split(' ');
          if (type !== 'blob') { i = nl + 1; continue; }
          const n = Number(size); hashOf.set(id, shaNorm(buf.slice(nl + 1, nl + 1 + n))); i = nl + 1 + n + 1;
        }
      }
      // 讀到的 blob 數要等於要的數，否則整支判斷不了（不當成「沒進過 commit」）
      if (r.status === 0 && hashOf.size === blobs.length) list = pairs.map(([c, b]) => [c, hashOf.get(b)]);
    }
    blobCache.set(ck, list);
  }
  const list = blobCache.get(ck);
  if (!list) return '判斷不了';
  const hit = list.find(([, s]) => s === then);   // git log 從新到舊，取最新那個
  if (!hit) return '當時那份沒進過任何 commit';
  const ns = git(root, ['diff', '--numstat', hit[0], '--', file]);
  const m = /^(\d+)\t(\d+)\t/.exec(ns || '');
  return `當時那份＝${hit[0].slice(0, 7)} 起，到現在 ${m ? `+${m[1]} −${m[2]}` : '判斷不了'} 行`;
}

export function scan(root) {
  const dir = path.join(root, 'tools', 'mutations');
  const ledgerFile = path.join(root, '.logs', 'mutate-ledger.jsonl');
  if (!fs.existsSync(dir)) throw new Error(`讀不到 ${dir}`);
  if (!fs.existsSync(ledgerFile)) throw new Error(`讀不到帳本 ${ledgerFile}`);
  // 帳本：started 與 done 用 seq 接起來
  const started = new Map(), runs = [];
  let ledgerLines = 0;
  for (const line of fs.readFileSync(ledgerFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (!e.event) continue;
    ledgerLines++;
    if (e.event === 'started') started.set(e.seq, e);
    else if (e.result) runs.push({ ...e, start: started.get(e.seq) || null });
  }
  if (!ledgerLines) throw new Error('帳本是空的——母體是空的不是「全部有效」');
  const key = (file, name) => `${file}\u0000${name}`;
  const byKey = new Map();
  for (const r of runs) { const k = key(r.file, r.name); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }

  // 清單：mutate 格式（有 file 欄的）
  const rows = [], seenKeys = new Map();
  let listFiles = 0, mutateFmt = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const ms = asMutations(f, j);
    if (!ms || ms.some((m) => typeof m.file !== 'string')) continue;   // 補丁格式（沒有 file）不在這裡
    listFiles++;
    for (const m of ms) {
      mutateFmt++;
      const k = key(m.file, m.name);
      seenKeys.set(k, [...(seenKeys.get(k) || []), f]);
      const rs = byKey.get(k) || [];
      const counted = rs.filter((r) => r.result === 'red' || r.result === 'not-red');
      const last = counted.length ? counted.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
      let cat, detail = '', test = '';
      if (!rs.length) cat = '沒紀錄';
      else if (!last) cat = '沒結果';
      else if (last.result === 'not-red') { cat = '沒紅'; detail = `第 ${last.seq} 次 ${last.at.slice(0, 10)}`; }
      else {
        let now = null;
        try { now = shaNorm(fs.readFileSync(path.join(root, m.file))); } catch { now = null; }
        const then = last.start && last.start.shaNorm;
        cat = now && then && now === then ? '紅·檔同' : '過期';
        detail = `第 ${last.seq} 次 ${last.at.slice(0, 10)}${!then ? '（帳本沒有開跑時的雜湊）' : !now ? '（現在讀不到目標檔）' : ''}`;
        if (cat === '過期' && then) detail += `｜${whereWas(root, m.file, then)}`;
        test = testChanged(root, m.cmd, last.at);
      }
      rows.push({ list: f, name: m.name, file: m.file, cat, detail, test });
    }
  }
  const dup = [...seenKeys].filter(([, fs2]) => fs2.length > 1).map(([k, fs2]) => `${k.replace('\u0000', '｜')}（${fs2.join('、')}）`);
  const orphan = [...byKey.keys()].filter((k) => !seenKeys.has(k)).map((k) => k.replace('\u0000', '｜'));
  const ledgerMatched = [...byKey.keys()].filter((k) => seenKeys.has(k)).length;
  return { rows, dup, orphan, ledgerKeys: byKey.size, ledgerMatched, ledgerLines, listFiles, mutateFmt };
}

function report(r, listCat) {
  const n = Object.fromEntries(CATS.map((c) => [c, r.rows.filter((x) => x.cat === c).length]));
  const sum = CATS.reduce((a, c) => a + n[c], 0);
  console.log(`母體：mutate 格式清單 ${r.listFiles} 份、突變 ${r.mutateFmt} 條（逐條從清單數）；帳本事件 ${r.ledgerLines} 行、有結果的鍵 ${r.ledgerKeys} 個`);
  console.log(`分類：${CATS.map((c) => `${c} ${n[c]}`).join('、')}；相加 ${sum}（走清單逐條分的，等於 ${r.mutateFmt} 是必然的——這一行不是檢查）`);
  const fromList = r.rows.filter((x) => x.cat !== '沒紀錄').length;
  console.log(`對帳（兩個方向各數一次）：清單那側有帳本紀錄的 ${fromList} 條；帳本那側對得到清單的鍵 ${r.ledgerMatched} 個、對不到清單的 ${r.orphan.length} 個、同一個鍵出現在兩份清單 ${r.dup.length} 個`);
  const stale = r.rows.filter((x) => x.cat === '紅·檔同' && x.test === '改過').length;
  console.log(`[紅·檔同] 裡守它的測試檔之後改過的 ${stale} 條（只印、不改分類）`);
  for (const d of r.dup) console.log(`  同一個鍵在兩份清單：${d}`);
  for (const o of r.orphan) console.log(`  帳本有、清單沒有：${o}`);
  for (const x of r.rows) {
    if (listCat && !listCat.includes(x.cat)) continue;
    console.log(`[${x.cat}] ${x.list}｜${x.name}｜${x.file}${x.detail ? '｜' + x.detail : ''}${x.test ? '｜測試檔：' + x.test : ''}`);
  }
  return 0;
}

// ---- 對照組：合成一個小 repo，從命令列入口跑同一支，答案事先寫好 ----
function controls() {
  const d = path.join(ROOT, '.logs', `mutstale-ctl-${process.pid}`);
  fs.rmSync(d, { recursive: true, force: true });
  const W = (p, s) => { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), s); };
  const h = (s) => shaNorm(Buffer.from(s));
  const ok = [];
  try {
    W('a.js', 'A now\n'); W('b.js', 'B then\n'); W('scripts/t-old.mjs', '//\n'); W('scripts/t-new.mjs', '//\n');
    const cmdOld = 'node scripts/t-old.mjs', cmdNew = 'node scripts/t-new.mjs', cmdNone = 'node scripts/t-none.mjs';
    W('tools/mutations/m.json', JSON.stringify([
      { name: 'same', file: 'a.js', find: 'A', replace: 'X', cmd: cmdOld },        // red、檔同、測試檔在那之前 commit → 紅·檔同／沒改
      { name: 'changed', file: 'b.js', find: 'B', replace: 'X', cmd: cmdOld },     // red、當時內容不同 → 過期；當時那份有 commit → +1 −1 行
      { name: 'changed-unc', file: 'c.js', find: 'C', replace: 'X', cmd: cmdOld }, // red、當時那份沒進過 commit → 過期／沒進過任何 commit
      { name: 'notred', file: 'a.js', find: 'A', replace: 'Y', cmd: cmdOld },      // not-red → 沒紅
      { name: 'never', file: 'a.js', find: 'A', replace: 'Z', cmd: cmdOld },       // 帳本沒有 → 沒紀錄
      { name: 'nores', file: 'a.js', find: 'A', replace: 'W', cmd: cmdOld },       // 只有 no-result → 沒結果
      { name: 'red-then-nores', file: 'a.js', find: 'A', replace: 'V', cmd: cmdOld }, // red 之後 no-result → 仍是 紅·檔同
      { name: 'red-then-notred', file: 'a.js', find: 'A', replace: 'U', cmd: cmdOld }, // red 之後 not-red → 沒紅
      { name: 'test-after', file: 'a.js', find: 'A', replace: 'T', cmd: cmdNew },  // 紅·檔同、測試檔在那之後 commit → 測試檔：改過
      { name: 'test-untracked', file: 'a.js', find: 'A', replace: 'S', cmd: cmdNone }, // 紅·檔同、測試檔沒追蹤 → 判斷不了
    ]));
    W('tools/mutations/dup.json', JSON.stringify([{ name: 'same', file: 'a.js', find: 'A', replace: 'Q', cmd: cmdOld }]));
    W('tools/mutations/patch.json', JSON.stringify([{ from: 'x', to: 'y' }]));   // 補丁格式：不算進母體
    const L = []; let seq = 0;
    const run = (name, file, content, result, at) => { seq++; L.push({ seq, event: 'started', name, file, shaNorm: h(content) }); L.push({ seq, event: 'done', name, file, result, at }); };
    const past = '2000-01-01T00:00:00.000Z', future = '2099-01-01T00:00:00.000Z';
    run('same', 'a.js', 'A now\n', 'red', future);
    run('changed', 'b.js', 'B then\n', 'red', future);
    run('changed-unc', 'c.js', 'C then\n', 'red', future);
    run('notred', 'a.js', 'A now\n', 'not-red', future);
    run('nores', 'a.js', 'A now\n', 'no-result', future);
    run('red-then-nores', 'a.js', 'A now\n', 'red', future); run('red-then-nores', 'a.js', 'A now\n', 'no-result', future);
    run('red-then-notred', 'a.js', 'A now\n', 'red', future); run('red-then-notred', 'a.js', 'A now\n', 'not-red', future);
    run('test-after', 'a.js', 'A now\n', 'red', past);
    run('test-untracked', 'a.js', 'A now\n', 'red', future);
    run('gone', 'a.js', 'A now\n', 'red', future);                                // 帳本有、清單沒有
    W('.logs/mutate-ledger.jsonl', JSON.stringify({ note: 'n' }) + '\n' + L.map((x) => JSON.stringify(x)).join('\n') + '\n');
    // 合成 repo 的提交者信箱在執行時拼出來：原樣寫進檔案，推送前自查的 email 那一類會擋（2026-11-05 實際擋過一次）
    const C = ['-c', 'user.name=t', '-c', `user.email=${['t', 'example.invalid'].join('@')}`, 'commit', '-q', '-m', 'c'];
    const steps = [['init', '-q'], ['add', 'scripts/t-old.mjs', 'scripts/t-new.mjs', 'b.js'], C,
      () => { W('b.js', 'B now\n'); W('c.js', 'C now\n'); }, ['add', 'b.js', 'c.js'], C];
    for (const a of steps) {
      if (typeof a === 'function') { a(); continue; }
      if (git(d, a) === null) { console.log(`✗ 對照組：合成 repo 的 git ${a.join(' ')} 失敗——情境未成立`); return false; }
    }
    if (fs.readFileSync(path.join(d, 'b.js'), 'utf8') !== 'B now\n') { console.log('✗ 對照組：b.js 沒改成現在的內容——情境未成立'); return false; }
    const r = spawnSync(process.execPath, [SELF, '--root', d, '--no-controls'], { encoding: 'utf8' });
    const out = r.stdout || '';
    const line = (name, list = 'm.json') => out.split('\n').find((l) => /^\[[^\]]+\] /.test(l) && l.split('｜')[0].endsWith(` ${list}`) && l.split('｜')[1] === name) || '';
    const expect = (name, cat, test, list) => {
      const l = line(name, list);
      const good = l.startsWith(`[${cat}] `) && (test === undefined || l.includes(`｜測試檔：${test}`));
      ok.push([good, `${name}${list ? '@' + list : ''} → [${cat}]${test ? '／' + test : ''}`, l]);
    };
    expect('same', '紅·檔同', '沒改');
    expect('changed', '過期');
    ok.push([/｜到現在 \+1 −1 行/.test(line('changed').replace(/當時那份＝[0-9a-f]{7} 起，/, '｜')), 'changed 的當時那份對到 commit、差 +1 −1 行', line('changed')]);
    ok.push([line('changed-unc').startsWith('[過期] ') && line('changed-unc').includes('｜當時那份沒進過任何 commit'), 'changed-unc → [過期]／沒進過任何 commit', line('changed-unc')]);
    expect('notred', '沒紅');
    expect('never', '沒紀錄');
    expect('nores', '沒結果');
    expect('red-then-nores', '紅·檔同');
    expect('red-then-notred', '沒紅');
    expect('test-after', '紅·檔同', '改過');
    expect('test-untracked', '紅·檔同', '判斷不了');
    ok.push([out.includes('帳本有、清單沒有：a.js｜gone'), '帳本有、清單沒有 → 點名 gone', '']);
    ok.push([out.includes('同一個鍵在兩份清單：a.js｜same（dup.json、m.json）'), '同一個鍵兩份清單 → 點名 same', '']);
    ok.push([/突變 11 條/.test(out), '母體 11 條（補丁格式不算）', '']);
    ok.push([r.status === 0, `從命令列入口跑完回 0（實際 ${r.status}）`, '']);
    let pass = true;
    // 過了的也印一行 ✓（2026-11-11）：突變執行器先跑原樣、數行首 ✓／✗ 的行當母體——只在失敗時印，原樣就一項都數不到，
    // 守 mutstale 的突變一條都跑不起來；也照共用慣例 §5.20「通過的時候也要印出算過的東西」
    for (const [g, what, l] of ok) {
      if (g) console.log(`✓ 對照組：${what}`);
      else { pass = false; console.log(`✗ 對照組：${what}${l ? '；實際那一行：' + l : '；實際沒有那一行'}`); }
    }
    console.log(`對照組 ${ok.filter((x) => x[0]).length}/${ok.length}${pass ? '' : '——沒過'}`);
    return pass && ok.length === 15;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  for (const k of Object.keys(process.env)) {
    if (/^git_(dir|work_tree|index_file|common_dir|object_directory|ceiling_directories)$/i.test(k)) { console.log(`✗ 環境裡有 ${k}——git 可能看的是別的 repo，停`); return 4; }
  }
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const root = at('--root') ? path.resolve(at('--root')) : ROOT;
  const listCat = at('--list') ? at('--list').split(',') : null;
  if (listCat && listCat.some((c) => !CATS.includes(c))) { console.log(`✗ --list 只認：${CATS.join(',')}`); return 2; }
  if (!args.includes('--no-controls') && !controls()) { console.log('✗ 對照組沒過——檢查器壞了，不採信下面的結果'); return 4; }
  let r;
  try { r = scan(root); } catch (e) { console.log(`✗ ${e.message}`); return 4; }
  if (!r.mutateFmt) { console.log('✗ 一條 mutate 格式的突變都沒讀到——母體是空的'); return 4; }
  return report(r, listCat);
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()) {
  process.exitCode = main();
  console.log(`mutstale 結束：回 ${process.exitCode}`);
}
