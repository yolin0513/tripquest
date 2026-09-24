// 推送閘的壞寫法掃描（npm run gatelint；共用慣例 v9 §5.16）。涵蓋的程式：scripts/safe-push.sh、
// scripts/prepush-scan.mjs、scripts/pushgatetest.mjs（推送閘門、公開前自查、閘門驗法）。
//
// 規則寫下、甚至親手修過，下一次寫新程式還是會寫出舊寫法——所以已知的壞寫法由機器掃。
// **登記制**（§5.2）：要掃的檔寫死在 FILES，不是「掃 scripts/ 全部、扣掉例外」；登記的檔不見了或是空的 → 檢查器壞了。
// 每一種寫法先跑**當場組出來的**壞寫法樣本（對照組），沒抓到就停、講明是檢查器壞了（§5.3）。
// 初篩型的（斷言「不存在」、shell 上帶反斜線的樣式）命中要逐條看；看過、確定是合理例外的，列在 EXCEPTIONS 並寫理由。
// 登記的例外對不到任何一行（程式改了、例外過期）也算檢查器壞了——免得例外清單默默地變成空的豁免。
//
// 回傳值：0 通過；1 有沒登記的命中；4 檢查器壞了（對照組沒抓到、登記的檔讀不到或是空的、例外過期）。
// 什麼時候跑：挑選器的底線（npm run test:affected，每版都跑）與完整的鏈（npm test）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FILES = ['scripts/safe-push.sh', 'scripts/prepush-scan.mjs', 'scripts/pushgatetest.mjs'];

const isComment = (line, file) => (file.endsWith('.sh') ? /^\s*#/ : /^\s*\/\//).test(line);
const GITCMD = /(git\s+(push|ls-remote|log|diff|show|fetch|rev-parse|rev-list)\b|prepush-scan|safe-push\.sh)/;

// 每一種寫法：line(行, 檔名) 回傳 true＝命中；file(全文) 是整檔層級的判斷（只在該檔整體符合時才看行）
export const KINDS = {
  pipe: {
    what: '自查、推送、取遠端狀態、取 diff 的那一行後面接管線',
    // .mjs 先拿掉 regex 字面（裡面的 | 是「或」，不是管線）；.sh 不拿——路徑裡的斜線會把管線夾在中間一起刪掉
    line: (l, file) => GITCMD.test(l) && /(^|[^|])\|(?!\|)/.test(file.endsWith('.mjs') ? l.replace(/\/(\\\/|[^/\n])+\/[gimsuy]*/g, '') : l),
    // 樣本刻意讓管線夾在兩條斜線之間（遠端寫成路徑）：「.sh 也拿掉 /…/」的寫法會漏掉它（突變實測）
    sample: () => ['git ls-remote "$ROOT/remote.git" main', '| cut -f1 > "$TMP/remote"'].join(' '),
  },
  ortrue: {
    what: '自查或閘門裡的 || true',
    line: (l) => /\|\|\s*true\b/.test(l),
    sample: () => 'git fetch -q origin main ' + '||' + ' true',
  },
  emptycatch: {
    what: '空的 catch',
    line: (l) => /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l),
    sample: () => 'try { run(); } ' + 'catch (e) ' + '{}',
  },
  plus3: {
    what: '用「以 +++ 開頭」判斷 diff 檔頭',
    line: (l) => /startsWith\(\s*['"`]\+\+\+['"`]\s*\)|\^\\\+\\\+\\\+|['"]\^\+\+\+/.test(l),
    sample: () => "l.startsWith('" + '+'.repeat(3) + "')",
  },
  formatnometa: {
    what: '用 --format= 取新增行，卻沒有另外取 commit 訊息與作者欄（%B、%ae）',
    file: (t) => !(/%B/.test(t) && /%ae/.test(t)),
    line: (l) => /--format=(\s|['"`]|$)/.test(l),
    sample: () => 'const d = run(`git log -p ' + '--format=' + ' --unified=0 ${range}`);',
  },
  absent: {
    what: '斷言「不存在」（初篩：要看前面有沒有先確認它原本在）',
    line: (l) => /!\s*fs\.existsSync|existsSync\([^)]*\)\s*===\s*false|不見了|===\s*false\b|!\s*[\w.$]+(\([^()]*\))?\.(includes|test)\(/.test(l),
    sample: () => "yes(" + '!' + "fs.existsSync(reg), '登記檔" + '不見了' + "');",
  },
  shellregex: {
    what: 'grep、sed 的樣式含反斜線、寫在 shell 指令列上（初篩：要確認同一次執行跑過對照組）',
    line: (l) => /\b(grep|sed)\b/.test(l) && /\\/.test(l),
    sample: () => "grep -E '^" + '\\' + "+{3}' diff.txt",
  },
};

// 看過、確定是合理例外的命中。每一條寫理由；對不到任何一行＝過期，算檢查器壞了。
export const EXCEPTIONS = [
  { file: 'scripts/safe-push.sh', kind: 'ortrue', match: /git fetch -q origin main > "\$TMP\/fetch" 2>&1 \|\| true/,
    why: 'fetch 失敗不在這一行停，是因為下一段緊接著查「本機有沒有遠端那個 commit」，沒有就回 4（擋下：檢查器壞了（範圍））。'
      + '（2026-09-24 一次性實測：假遠端 main 指向不存在的 commit，ls-remote 讀得到、fetch 回 128 → 閘門回 4、假遠端沒動；'
      + 'pushgatetest 還沒有這一種情境）' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /!WHO\.\w+(\([^)]*\))?\.test\(R\(SAMPLE\.\w+\)\)/,
    why: '擷取樣式本身的對照組：同一條斷言先證明這個樣式抓得到它該抓的樣本，再證明它不會誤抓別的樣本' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /!WHO\.\w+(\([^)]*\))?\.test\(R\(r\.out\)\)/,
    why: '斷言閘門的輸出裡「沒有別的擋下理由」；用到的每一個樣式都先在 SAMPLE 對照組上證明抓得到' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /includes\(fakeMail\(\)\) && !sh\('git show HEAD --format='\)\.includes\(fakeMail\(\)\)/,
    why: 'H 的前置：同一條斷言先確認假信箱真的在 commit 訊息裡，再確認它不在新增行裡' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /yes\(had && !fs\.existsSync\(regPath\)/,
    why: 'M0 的前置：同一條斷言先確認登記檔原本在（had），刪掉之後才確認它不在' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /const missed = Object\.entries\(pats\)\.filter\(\(\[, re\]\) => !re\.test\(R\(inErr\)\)\)/,
    why: '位置對照組的正向那一半：收集「出現在錯誤訊息裡卻沒被抓到」的樣式，下一行斷言這個清單是空的——不是在斷言不存在' },
  { file: 'scripts/safe-push.sh', kind: 'absent', match: /^echo "✗ 沒有 \$REG（閘門從沒驗過、或登記檔不見了）/,
    why: '給人看的錯誤訊息裡剛好有「不見了」三個字，不是斷言' },
];

// 第二道對照組：本 App 歷史上真的出過事的原文（逐字照抄，出處是那一版的檔；§5.3：真實資料只當第二道）。
// 規則寫得再好，抓不到自己當天剛修掉的舊寫法就是沒用——統籌者 2026-09-24 就是這樣發現自己的管線規則有漏洞。
export const HISTORY = [
  { kind: 'pipe', from: 'safe-push.sh（00f849b 之前）', file: 'x.sh', text: 'REMOTE="$(git ls-remote origin refs/heads/main | cut -f1 || true)"' },
  { kind: 'ortrue', from: 'safe-push.sh（00f849b 之前）', file: 'x.sh', text: 'AFTER="$(git ls-remote origin refs/heads/main | cut -f1 || true)"' },
  { kind: 'plus3', from: 'prepush-scan.mjs（26f0a69 之前）', file: 'x.mjs', text: "  added = diff.split('\\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));" },
  { kind: 'formatnometa', from: 'prepush-scan.mjs（40de287 之前，整支只取新增行）', file: 'x.mjs', text: "  const cmd = range ? `git log -p --format= --unified=0 ${range}` : 'git show HEAD --format= --unified=0';" },
];

export function scanText(file, text, kinds = KINDS) {
  const hits = [];
  const lines = text.split('\n');
  for (const [k, K] of Object.entries(kinds)) {
    if (K.file && !K.file(text)) continue;
    lines.forEach((l, i) => {
      if (!isComment(l, file) && K.line(l, file)) hits.push({ kind: k, file, n: i + 1, text: l.trim() });
    });
  }
  return { hits, lines: lines.length };
}

export function run({ root = ROOT, kinds = KINDS, exceptions = EXCEPTIONS, files = FILES, log = console.log } = {}) {
  const broken = [];
  // 對照組：每一種寫法的樣本，用同一段偵測去掃
  for (const [k, K] of Object.entries(kinds)) {
    const s = K.sample();
    const got = scanText('sample' + (k === 'pipe' || k === 'ortrue' || k === 'shellregex' ? '.sh' : '.mjs'), s, { [k]: K }).hits.length > 0;
    log(`${k}：對照組命中=${got}`);
    if (!got) broken.push(`對照組沒抓到（${k}）`);
  }
  for (const h of HISTORY) {
    const got = kinds[h.kind] ? scanText(h.file, h.text, { [h.kind]: kinds[h.kind] }).hits.length > 0 : false;
    log(`${h.kind}：歷史原文（${h.from}）命中=${got}`);
    if (!got) broken.push(`歷史原文沒抓到（${h.kind}）`);
  }
  // 母體：登記的檔
  const all = [];
  for (const f of files) {
    const p = path.join(root, f);
    let t = '';
    try { t = fs.readFileSync(p, 'utf8'); } catch { broken.push(`讀不到登記的檔（${f}）`); continue; }
    if (!t.trim()) { broken.push(`登記的檔是空的（${f}）`); continue; }
    const r = scanText(f, t.replace(/\r\n/g, '\n'), kinds);
    // 印出掃到的那一份的雜湊（與 git hash-object 相同算法）：突變時拿它確認掃到的真的是改壞的那一版
    const buf = fs.readFileSync(p);
    const sha = crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex').slice(0, 12);
    log(`掃 ${f}（${sha}）：${r.lines} 行，命中 ${r.hits.length}`);
    all.push(...r.hits);
  }
  const used = new Set();
  const bad = all.filter((h) => {
    const i = exceptions.findIndex((e) => e.file === h.file && e.kind === h.kind && e.match.test(h.text));
    if (i >= 0) { used.add(i); return false; }
    return true;
  });
  exceptions.forEach((e, i) => { if (!used.has(i)) broken.push(`登記的例外對不到任何一行（${e.file}／${e.kind}：${e.match}）`); });
  log(`登記的例外：${exceptions.length} 條，用到 ${used.size} 條；命中共 ${all.length}，沒登記的 ${bad.length}`);
  for (const h of bad) log(`   [${h.kind}] ${h.file}:${h.n}  ${h.text.slice(0, 140)}`);
  if (broken.length) { log(`擋下：檢查器壞了（${broken.join('、')}）`); return 4; }
  if (bad.length) { log(`擋下：有壞寫法（${[...new Set(bad.map((h) => h.kind))].join('、')}）`); return 1; }
  log('通過');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(run());
