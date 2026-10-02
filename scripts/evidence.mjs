// 從 .logs 裡的原始 log 產生**入庫的逐項證據**（2026-10-02）。原始 log 留在 .logs/（被 .gitignore 擋掉、可能帶本機路徑），
// 入庫的是這支產生的逐項表：每一條一行，帶分類、預期紅哪幾條、實際紅哪幾條、情境未成立的、回傳值、被驗那份的雜湊。
// 為什麼不能只留總數：JLPT 2026-10-02 有 29 條突變只剩「紅 13、14」這種摘要，看不出回傳值、看不出情境有沒有成立，降級成「無法複核」。
//
//   node scripts/evidence.mjs --evid <log> --out <md>         突變驅動（tools/mutproof/*_mut.mjs）印的 @@EVID 紀錄
//   node scripts/evidence.mjs --legacy-ev2 <目錄> --out <md>    舊的 ev2 證據（ev2-<標籤>.shell＋ev_<標籤>.log）
//
// 分類：成立且紅在預期／紅錯地方（紅了但不是預期那幾條，或少紅了預期的）／沒紅／情境未成立（不在預期裡的 ⊘）／基準全綠／基準不綠。
// 舊的 ev2 紀錄當時沒有把「預期紅哪幾條」記成機器讀得到的格式，只分得出：情境成立且紅（無預期可比）／情境成立但沒紅／情境未成立。
// 關卡（任何一關不過：點名、非 0、**不寫檔**）：
//   1. 清洗的對照組兩向：含本機路徑、使用者名、登記的個資詞的合成紀錄 → 輸出裡全部沒有；分類與預期／實際紅那幾條沒被洗掉。
//   2. 母體：證據行數＝這次跑的條數（@@EVID-TOTAL 的名單／ev2 外殼紀錄的份數），少了或多了都點名。
//   3. 寫檔前再用同一組樣式掃一次整份輸出，有本機路徑就不寫。
// 個資詞：讀 .logs/pii-terms.txt（被擋掉、不入庫；一行一個，例如群組名）；沒有這個檔就只洗路徑與使用者名，並在輸出裡註明。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const bs = String.fromCharCode(92);

// ---------- 清洗 ----------
export function makeSanitizer({ user = os.userInfo().username, home = os.homedir(), terms = [] } = {}) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => bs + c);
  const pats = [
    [new RegExp('[A-Za-z]:[' + bs + bs + '/][^\\s"\'`）)，、；]*', 'g'), '‹路徑›'],          // 磁碟代號開頭的路徑
    [new RegExp('/[a-z]/(?:Users|Claude)[^\\s"\'`）)，、；]*', 'g'), '‹路徑›'],              // Git Bash 形式
    [new RegExp('/(?:home|Users)/[^\\s"\'`）)，、；]*', 'g'), '‹路徑›'],
  ];
  if (home) pats.unshift([new RegExp(esc(home), 'gi'), '‹家目錄›']);
  if (user) pats.push([new RegExp(esc(user), 'gi'), '‹使用者›']);
  for (const t of terms.filter((x) => x && x.trim())) pats.push([new RegExp(esc(t.trim()), 'gi'), '‹已遮蔽›']);
  const clean = (s) => pats.reduce((x, [re, to]) => x.replace(re, to), String(s));
  // 複掃用**另一組獨立寫的偵測**，不從上面的清洗樣式推出來——用同一組的話，清洗少了一條，複掃也跟著少同一條，
  // 拿自己驗自己永遠一致（2026-10-02 突變 E1 實測：拿掉磁碟代號那條，複掃照樣說乾淨）。
  const raw = [user, home, ...terms].map((x) => String(x || '').trim()).filter((x) => x.length >= 2).map((x) => x.toLowerCase());
  const leaks = (s) => {
    const t = String(s);
    if (/[A-Za-z]:[\\/][A-Za-z]/.test(t)) return true;                      // 磁碟代號開頭的路徑
    if (/(^|[\s"'`(（])\/(?:[a-z]\/|home\/|Users\/)/.test(t)) return true;   // Git Bash 與家目錄形式
    const low = t.toLowerCase();
    return raw.some((x) => low.includes(x));
  };
  return { clean, leaks, n: pats.length };
}
export function loadTerms(root = ROOT) {
  const f = path.join(root, '.logs', 'pii-terms.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : null;
}

// ---------- 分類 ----------
const starts = (list, pre) => list.some((l) => l.startsWith(pre));
export function classify(r) {
  const expect = r.expect || [], expU = r.expectUnformed || [], reds = r.reds || [], unf = r.unformed || [];
  const extraU = unf.filter((l) => !expU.some((p) => l.startsWith(p)));
  const missU = expU.filter((p) => !starts(unf, p));
  const missR = expect.filter((p) => !starts(reds, p));
  const extraR = reds.filter((l) => !expect.some((p) => l.startsWith(p)));
  // 沒跑完（被停掉、逾時、沒有最後那一行總結）→ 不算數，不進紅／沒紅（2026-10-02，MealMate：被停掉的那一輪記成「紅錯地方」）
  if (r.finished === false) return '被中斷（不算數）';
  // clone 裡實際跑的那份不是外層改壞的那份（或沒印被驗的檔）→ 改壞的程式沒在跑 → 這次什麼都沒量到
  if (r.nested && r.nested.ok === false) return '情境未成立';
  if (extraU.length) return '情境未成立';
  if (!expect.length && !expU.length) return reds.length === 0 && r.status === 0 ? '基準全綠' : '基準不綠';
  if (!missR.length && !extraR.length && !missU.length) return '成立且紅在預期';
  if (!reds.length && !unf.length) return '沒紅';
  return '紅錯地方';
}

// ---------- 讀 @@EVID ----------
export function parseEvid(text) {
  const totals = [], recs = [];
  for (const l of text.split('\n')) {
    if (l.startsWith('@@EVID-TOTAL ')) totals.push(JSON.parse(l.slice(13)));
    else if (l.startsWith('@@EVID ')) recs.push(JSON.parse(l.slice(7)));
  }
  return { totals, recs };
}
export function populationProblems(totals, recs) {
  const out = [];
  if (!totals.length) out.push('log 裡沒有 @@EVID-TOTAL（不知道母體是多少）');
  const want = totals.flatMap((t) => t.names.map((n) => `${t.runner}｜${n}`));
  const got = recs.map((r) => `${r.runner}｜${r.name}`);
  for (const w of want) if (!got.includes(w)) out.push(`少了：${w}`);
  for (const g of got) if (!want.includes(g)) out.push(`多了（不在母體名單裡）：${g}`);
  if (new Set(got).size !== got.length) out.push('同一條出現兩次');
  return out;
}

// ---------- 讀舊的 ev2 ----------
// 情境成立＝外殼確認了「HEAD 裡的那支＝改壞的那一份」，而且沒有「[標籤] ✗」開頭的失敗行。
// 只認行首（不拿「一行裡有沒有 ✗ 這個字」判斷——MealMate 2026-10-02：✓ 開頭、訊息裡帶 ✗ 的行被當成紅）。
export const LEGACY_DONE = /^(\d+ 項通過|全部擋下|擋下：F8 驗法|結果：)/m;
export const legacyFormed =(sh) => new RegExp('^\\[[^\\]]+\\] HEAD 裡的 .+＝改壞的那一份', 'm').test(sh) && !/^\[[^\]]+\] ✗/m.test(sh);
export function parseLegacyEv2(dir) {
  const shells = fs.readdirSync(dir).filter((f) => /^ev2-.+\.shell$/.test(f)).sort();
  const recs = shells.map((f) => {
    const label = f.slice(4, -6);
    const sh = fs.readFileSync(path.join(dir, f), 'utf8');
    const logF = path.join(dir, `ev_${label}.log`);
    const log = fs.existsSync(logF) ? fs.readFileSync(logF, 'utf8') : null;
    const formed = legacyFormed(sh);
    const m = sh.match(/exit=(\d+)/);
    const status = m ? Number(m[1]) : null;
    const reds = log ? log.split('\n').filter((l) => l.startsWith('✗ ')).map((l) => l.slice(2)) : [];
    const changed = [...sh.matchAll(/改：(\S+)（(\w+) → (\w+)）/g)].map((x) => `${x[1]} ${x[3]}`);
    // 有 exit= 不等於跑完（被停掉時外殼照樣寫得出 exit=、結束碼跟斷言失敗一樣）：log 裡要有至少一行完成的證據
    // （寬鬆判準；依指令逐項核對的嚴格版在 tools/mutproof/rescan.mjs，用 tools/ev/progress.mjs 的判準）
    const done = log !== null && LEGACY_DONE.test(log);
    const cls = !formed || status === null || log === null ? '情境未成立' : !done ? '被中斷（不算數）' : reds.length || status !== 0 ? '成立且紅（無預期可比）' : '成立但沒紅';
    return { runner: 'ev2（舊）', name: label, expect: ['（當時沒記成機器讀得到的格式）'], reds, unformed: formed ? [] : ['外殼沒有確認改壞的那一份在 HEAD 裡，或沒有 log'], status, sha: changed.join('；'), cls };
  });
  return { shells: shells.length, recs };
}

// ---------- 輸出 ----------
const cell = (s) => String(s).replace(/\|/g, '｜').replace(/\n/g, ' ');
export function render({ title, source, recs, sanitizer, termsNote }) {
  const head = [`# ${title}`, '', `> 由 \`scripts/evidence.mjs\` 從 \`${source}\` 產生（原始 log 在 .logs/、不入庫）。${termsNote}`, '',
    `共 ${recs.length} 條。分類統計：` + Object.entries(recs.reduce((m, r) => ((m[r.cls] = (m[r.cls] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join('、'), '',
    '| 來源 | 名稱 | 分類 | 預期紅 | 實際紅 | 情境未成立 | 回傳值 | 被驗那份 | clone 裡跑的＝改壞那份 |', '|---|---|---|---|---|---|---|---|---|'];
  const nestedCell = (n) => (!n ? '（直接跑，沒有 clone）' : !n.printed ? '✗ 測試沒印被驗的檔' : !n.file ? '基準（沒改檔）' : n.ok ? `✓ ${n.file} ${n.inner}` : `✗ ${n.file} 外層 ${n.outer}≠clone 裡 ${n.inner}`);
  const rows = recs.map((r) => '| ' + [r.runner, r.name, r.cls, (r.expect || []).join('／') || '（基準）', (r.reds || []).join('／') || '—',
    [...(r.expectUnformed || []).map((x) => '預期：' + x), ...(r.unformed || [])].join('／') || '—', r.status ?? '—', r.sha || '—', nestedCell(r.nested)].map((x) => cell(sanitizer.clean(x))).join(' | ') + ' |');
  return head.concat(rows).join('\n') + '\n';
}

// ---------- 對照組 ----------
export function selfControls() {
  const out = [];
  const s = makeSanitizer({ user: 'zzuser', home: 'C:' + bs + 'Users' + bs + 'zzuser', terms: ['阿嬤的宜蘭團'] });
  const dirty = ['C:' + bs + 'Users' + bs + 'zzuser' + bs + 'x' + bs + 'y.mjs:12', '/c/' + 'Users/zzuser/a', 'Q:' + '/zzproj/scripts/a.mjs', '群組「阿嬤的宜蘭團」寫不進去', 'zzuser 的機器'];
  const cleaned = dirty.map(s.clean);
  out.push(['清洗：五種髒樣本洗完都看不到原字', cleaned.every((c) => !/zzuser|阿嬤的宜蘭團|zzproj|Users/.test(c))]);
  out.push(['清洗：洗完的輸出再掃一次是乾淨的', cleaned.every((c) => !s.leaks(c))]);
  const keep = 'C 刪掉還原紀錄 → 回 5、指出第 1 次與 zz-target.txt（實得 2）';
  out.push(['清洗：分類用的字（情境名、回傳值、檔名）不會被洗掉', s.clean(keep) === keep]);
  const rec = { runner: 'x_mut', name: 'G5', expect: ['C '], reds: ['C 刪掉還原紀錄 → 回 5（實得 2）'], unformed: [], status: 1, sha: 'Q:' + '/zzproj/scripts/mutate.mjs' }   // 合成路徑在執行時才組出來（不寫字面，也不用真實專案路徑格式）;
  rec.cls = classify(rec);
  const md = render({ title: 't', source: 's', recs: [rec], sanitizer: s, termsNote: '' });
  out.push(['清洗：整份輸出沒有路徑、但分類與實際紅那一條還在', !s.leaks(md) && md.includes('成立且紅在預期') && md.includes('C 刪掉還原紀錄')]);
  // 分類：每一種一個樣本
  const C = (r) => classify({ status: 1, expectUnformed: [], unformed: [], ...r });
  out.push(['分類：成立且紅在預期', C({ expect: ['A '], reds: ['A 一', 'A 二'] }) === '成立且紅在預期']);
  out.push(['分類：紅錯地方（多紅了別條）', C({ expect: ['A '], reds: ['A 一', 'B 一'] }) === '紅錯地方']);
  out.push(['分類：紅錯地方（預期那條沒紅、紅了別條）', C({ expect: ['A '], reds: ['B 一'] }) === '紅錯地方']);
  out.push(['分類：沒紅', C({ expect: ['A '], reds: [] }) === '沒紅']);
  out.push(['分類：情境未成立（不在預期裡的 ⊘）', C({ expect: ['A '], reds: ['A 一'], unformed: ['B—造不出來'] }) === '情境未成立']);
  out.push(['分類：預期內的 ⊘ 不算未成立', C({ expect: [], expectUnformed: ['B—'], reds: [], unformed: ['B—造不出來'] }) === '成立且紅在預期']);
  out.push(['分類：clone 裡跑的不是改壞那份 → 情境未成立（就算紅在預期也一樣）',
    C({ expect: ['A '], reds: ['A 一'], nested: { file: 'x.mjs', outer: 'aaa', inner: 'bbb', ok: false } }) === '情境未成立'
    && C({ expect: ['A '], reds: ['A 一'], nested: { file: 'x.mjs', outer: 'aaa', inner: 'aaa', ok: true } }) === '成立且紅在預期']);
  out.push(['分類：沒跑完 → 被中斷（不算數），就算紅在預期也一樣', C({ expect: ['A '], reds: ['A 一'], finished: false }) === '被中斷（不算數）'
    && C({ expect: ['A '], reds: ['A 一'], finished: true }) === '成立且紅在預期' && classify({ expect: [], reds: [], status: 0, finished: false }) === '被中斷（不算數）']);
  out.push(['分類：基準全綠／基準不綠',classify({ expect: [], reds: [], status: 0 }) === '基準全綠' && classify({ expect: [], reds: ['x'], status: 1 }) === '基準不綠']);
  // 舊 ev2 外殼：成立／沒套上／訊息裡帶 ✗ 字但不是失敗行
  const okSh = '[x] 改：a.mjs（111 → 222）\n[x] HEAD 裡的 a.mjs＝改壞的那一份（222）\n[x] exit=1';
  out.push(['舊紀錄：確認改壞那份在 HEAD 裡 → 成立', legacyFormed(okSh)]);
  out.push(['舊紀錄：「[x] ✗ patch 沒套上——不跑」→ 未成立', !legacyFormed('[x] ✗ patch 沒套上（a=p.json）——不跑')]);
  out.push(['舊紀錄：沒有「HEAD 裡＝改壞那份」那一行 → 未成立', !legacyFormed('[x] 改：a.mjs（111 → 222）\n[x] exit=1')]);
  out.push(['舊紀錄：完成的證據——有「N 項通過」或 F8 結論才算跑完，只有 ✗ 行不算', LEGACY_DONE.test('✗ 一\n\n12 項通過，有失敗') && LEGACY_DONE.test('全部擋下（只跑了 bp）') && !LEGACY_DONE.test('✗ 一\n✗ 二\n') && !LEGACY_DONE.test('✓ 12 項通過')]);
  out.push(['舊紀錄：訊息裡帶 ✗ 字、但不在行首 → 不算失敗',legacyFormed(okSh + '\n[x] 說明：上一輪的 ✗ 已處理')]);
  // 母體：少一筆、多一筆都要點名
  const T = [{ runner: 'r', names: ['a', 'b'] }];
  const p1 = populationProblems(T, [{ runner: 'r', name: 'a' }]);
  const p2 = populationProblems(T, [{ runner: 'r', name: 'a' }, { runner: 'r', name: 'b' }, { runner: 'r', name: 'c' }]);
  out.push(['母體：少了 b → 點名 b', p1.length === 1 && p1[0] === '少了：r｜b']);
  out.push(['母體：多了 c → 點名 c', p2.length === 1 && p2[0] === '多了（不在母體名單裡）：r｜c']);
  out.push(['母體：齊全 → 沒有問題', populationProblems(T, [{ runner: 'r', name: 'a' }, { runner: 'r', name: 'b' }]).length === 0]);
  return out;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const ctl = selfControls();
  for (const [m, ok] of ctl) console.log(`${ok ? '✓' : '✗'} 對照組：${m}`);
  if (ctl.some(([, ok]) => !ok)) { console.log('✗ 對照組沒過——產生器壞了，不寫檔'); return 4; }
  const outF = opt('--out');
  if (!outF) { console.log('用法：--evid <log> --out <md>  或  --legacy-ev2 <目錄> --out <md>'); return 2; }
  const terms = loadTerms();
  const sanitizer = makeSanitizer({ terms: terms || [] });
  const termsNote = terms ? `個資詞 ${terms.length} 個已遮蔽。` : '（這台機器沒有 .logs/pii-terms.txt：只洗了路徑與使用者名。）';
  let recs, title, source, problems = [];
  if (opt('--evid')) {
    source = path.basename(opt('--evid'));
    const { totals, recs: rs } = parseEvid(fs.readFileSync(opt('--evid'), 'utf8'));
    problems = populationProblems(totals, rs);
    recs = rs.map((r) => ({ ...r, cls: classify(r) }));
    title = `突變逐項證據：${totals.map((t) => t.runner).join('、')}`;
    console.log(`母體：名單 ${totals.reduce((n, t) => n + t.names.length, 0)} 條、紀錄 ${recs.length} 條`);
  } else if (opt('--legacy-ev2')) {
    source = path.basename(opt('--legacy-ev2')) + '/ev2-*.shell＋ev_*.log';
    const { shells, recs: rs } = parseLegacyEv2(opt('--legacy-ev2'));
    recs = rs;
    if (recs.length !== shells || !shells) problems.push(`外殼紀錄 ${shells} 份、證據 ${recs.length} 行，對不上或是空的`);
    title = '舊的 ev2 證據（逐項；當時沒記預期紅哪幾條）';
    console.log(`母體：外殼紀錄 ${shells} 份、證據 ${recs.length} 行`);
  } else { console.log('✗ 要指定 --evid 或 --legacy-ev2'); return 2; }
  if (problems.length) { console.log('✗ 母體對不上，不寫檔：\n   ' + problems.join('\n   ')); return 1; }
  const md = render({ title, source, recs, sanitizer, termsNote });
  if (sanitizer.leaks(md)) { console.log('✗ 輸出裡還有本機路徑或個資詞，不寫檔'); return 1; }
  if (md.split('\n').filter((l) => /^\| (?!來源|---)/.test(l)).length !== recs.length) { console.log('✗ 表格行數不等於條數，不寫檔'); return 4; }
  fs.mkdirSync(path.dirname(outF), { recursive: true });
  fs.writeFileSync(outF, md);
  console.log(`寫入 ${outF}：${recs.length} 條（${Object.entries(recs.reduce((m, r) => ((m[r.cls] = (m[r.cls] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join('、')}）`);
  return 0;
}

// 最後一定印這一行（2026-10-02）：evidence_mut 拿它判「跑完了沒」——被強制停掉時結束碼也是 1，跟「擋下」分不出來
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) { process.exitCode = main(); console.log(`evidence 結束：回 ${process.exitCode}`); }
