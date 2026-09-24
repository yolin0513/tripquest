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
export const FILES = ['scripts/safe-push.sh', 'scripts/prepush-scan.mjs', 'scripts/pushgatetest.mjs', 'scripts/verified-reg.mjs', 'scripts/f8verify.mjs'];

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
      + '（常設：pushgatetest 的 Q2——遠端的 commit 本機沒有、假 git 讓 fetch 失敗 → 回 4「範圍」；拿掉那一道「停」只紅 Q2）' },
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
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /const notX = !WHO\.broken\('email'\)\.test\(B\.brokenX\)/,
    why: '邊界對照組「不能被湊到」那一半；下一行用同樣的樣式證明清單中的每一項都認得出來（兩個方向成對）' },
  { file: 'scripts/safe-push.sh', kind: 'absent', match: /^echo "✗ 沒有 \$REG（閘門從沒驗過、或登記檔不見了）/,
    why: '給人看的錯誤訊息裡剛好有「不見了」三個字，不是斷言' },
  // ---- F9（2026-09-24）----
  { file: 'scripts/safe-push.sh', kind: 'formatnometa', match: /git log --format= --name-only "\$RANGE" > "\$TMP\/touched"/,
    why: '這一行只列「動到哪些檔」決定要不要看 F8 登記，不是掃內容；commit 訊息與作者欄由 prepush-scan.mjs 另外掃（它有自己的 %B／%ae）' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /!WHO\.f8File\('importshots\.mjs'\)\.test\('擋下：F8 驗法沒有驗過（scripts\/importshotsXmjs 改過'\)/,
    why: '擷取樣式的邊界對照組：同一條斷言前半先證明 f8File 抓得到真的 importshots.mjs，這一半證明點不會被當成任意字元' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /yes\(!fs\.existsSync\(F8REG\)(, 'P1 前置| && !sh\(`git log --format= --name-only)/,
    why: 'P1／P4 的前置是「沒有 F8 登記」這個起點狀態（reset() 刪掉的），不是在驗某個東西被刪掉' },
  { file: 'scripts/pushgatetest.mjs', kind: 'absent', match: /yes\(!w2\.ok && \/scripts\\\/importshots\\\.mjs 工作區跟 HEAD 不一樣\//,
    why: 'V2 驗「舊的登記被刪掉」：V1 剛寫了它、並讀出內容比對過（原本在），所以這裡的不在是被刪的' },
  { file: 'scripts/verified-reg.mjs', kind: 'absent', match: /if \(!fs\.existsSync\((path\.join\(root, f\)|regPath)\)\) /,
    why: '流程判斷（工作區沒有就記一筆問題；登記本來就不在就照實說），不是斷言' },
  { file: 'scripts/f8verify.mjs', kind: 'absent', match: /if \(!fs\.existsSync\((WT|ST)\)\) return|if \(!xl\.includes\(why\)\) miss\.push/,
    why: '流程判斷（沒有複本就不用刪；沒有輸出資料夾時雜湊記成「無」；理由不對就記一筆），不是斷言某個東西不見了' },
  { file: 'scripts/f8verify.mjs', kind: 'absent', match: /fs\.unlinkSync\(p\); must\(!fs\.existsSync\(p\), '城市檔不在'\)|r0\.code !== 0 \|\| !fs\.existsSync\(LAST\)/,
    why: '造情境的前置：刪城市檔時 unlinkSync 在檔不存在時會丟例外（原本在）；資料變少的前置是斷言 LAST「在」' },
  { file: 'scripts/f8verify.mjs', kind: 'absent', match: /r\.err\.includes\('暫存檔已清掉'\) && !fs\.existsSync|r\.shots === NAMES\.length\], \['(暫存 \.partial 沒清掉|\.old 沒改回來)'/,
    why: '「清掉了」前面先證明建過：build-places 只有建過暫存檔、清成功才印「暫存檔已清掉」；importshots 要數到 13 張拍進 .partial。'
      + '.old 在第二步那格是「換上第一步把舊的改名成 .old」建出來的（拿掉還原的突變實測：_import 只剩 .old 裡的 13 張）' },
  { file: 'scripts/f8verify.mjs', kind: 'absent', match: /\['暫存 \.partial 沒清掉、也沒點名清不掉', !fs\.existsSync\(PART\) \|\|/,
    why: '同一格前一行已要求拍滿 13 張進 .partial（原本在）' },
];

// 第二道對照組：本 App 歷史上真的出過事的原文（逐字照抄，出處是那一版的檔；§5.3：真實資料只當第二道）。
// 規則寫得再好，抓不到自己當天剛修掉的舊寫法就是沒用——統籌者 2026-09-24 就是這樣發現自己的管線規則有漏洞。
export const HISTORY = [
  { kind: 'pipe', from: 'safe-push.sh（00f849b 之前）', file: 'x.sh', text: 'REMOTE="$(git ls-remote origin refs/heads/main | cut -f1 || true)"' },
  { kind: 'ortrue', from: 'safe-push.sh（00f849b 之前）', file: 'x.sh', text: 'AFTER="$(git ls-remote origin refs/heads/main | cut -f1 || true)"' },
  { kind: 'plus3', from: 'prepush-scan.mjs（26f0a69 之前）', file: 'x.mjs', text: "  added = diff.split('\\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));" },
  { kind: 'formatnometa', from: 'prepush-scan.mjs（40de287 之前，整支只取新增行）', file: 'x.mjs', text: "  const cmd = range ? `git log -p --format= --unified=0 ${range}` : 'git show HEAD --format= --unified=0';" },
];

// ---------- 第二部分：跳脫掃描（scripts/ 底下全部腳本；補充說明四第 4 點，2026-09-24）----------
// 寫的當下攔不到（heredoc、node -e 會把反斜線多吃或少吃一個）；變成語法錯誤的反而安全，一執行就炸——真正會空轉的是
// 語法正確、只是 regex 意思變了的那兩種：多跳脫一次（/\\s/ 變成找「反斜線＋s」）、反斜線被吃掉（/\s+/ 變成找「s」）。
// 要分位置判斷：模板字串（反引號）裡的程式碼會再被解析一次，那裡 \\s 才是對的、單一個 \s 反而會被吃掉。
const SCRIPT_EXT = new Set(['.mjs', '.js', '.sh']);
const ESC_LIT = /(?:^|[(=,:[!&|?{;]|return)\s*(\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])+\/[dgimsuy]*)/g;
const ESC_OVER = /\\\\[dDsSwWbB]/;                       // 一般程式碼的 regex 字面裡兩個反斜線接類別字母
const ESC_LOST = /(?:^\/\^?|[(|[]|\/\^)[dsw][+*?{]/;     // 一般程式碼的 regex 字面裡類別字母前面沒有反斜線
const ESC_LOST_TPL = /(?<!\\)\\[dDsSwW]/;                 // 模板字串裡只有一個反斜線（再解析一次就被吃掉）
export function escLine(line, inTpl) {
  const out = [];
  for (const m of line.matchAll(ESC_LIT)) {
    const lit = m[1];
    if (inTpl) { if (ESC_LOST_TPL.test(lit)) out.push({ kind: 'lost-tpl', lit }); }
    else {
      if (ESC_OVER.test(lit)) out.push({ kind: 'over', lit });
      if (ESC_LOST.test(lit)) out.push({ kind: 'lost', lit });
    }
  }
  return out;
}
// 看過的：真的壞寫法（待授權修）或確定沒問題的；對不到任何一行＝過期，算檢查器壞了
export const ESC_KNOWN = [
  { file: 'scripts/densitytest.mjs', kind: 'lost', match: /e\.innerText\.replace\(\/s\+\/g, ''\)/, state: '待修',
    why: '本意是 /\\s+/g（去掉空白），現在去掉的是字母 s；斷言剛好不受空白影響所以一直綠' },
  { file: 'scripts/plantest.mjs', kind: 'lost', match: /b\.innerText\.replace\(\/s\+\/g, ''\)/, state: '待修',
    why: '同上：本意是 /\\s+/g' },
  // 下面兩條要找的正是原始碼裡的「反斜線＋s」，用 has（一般字串）比對，免得比對樣式自己又變成一個多跳脫的 regex
  { file: 'scripts/layouttest.mjs', kind: 'lost-tpl', has: 'const endsNum = /[0-9][\\s\\u3000]*$/', state: '待修',
    why: '在模板字串裡（送進瀏覽器執行），瀏覽器拿到的是 /[0-9][s　]*$/——一般空白認不得（應寫 \\\\s、\\\\u3000）' },
  { file: 'scripts/layouttest.mjs', kind: 'lost-tpl', has: 'const startsUnit = /^[\\s\\u3000]*', state: '待修',
    why: '同上：瀏覽器拿到的是 /^[s　]*…/' },
];
// 逐字元標出每個位置在哪裡：c＝程式碼、t＝模板字串的文字部分、s＝一般字串、m＝註解、r＝程式碼裡的 regex 字面。
// 只數反引號分不出來（反引號也會出現在註解、字串、regex 的字元類別裡，奇偶一亂後面整段都判錯——2026-09-24 實測）。
export function lexContexts(src) {
  const ctx = new Array(src.length);
  const stack = ['c'];                 // 模板字串的 ${ … } 裡面又是程式碼，用堆疊記
  const braces = [];                   // 每一層 ${ 裡面的大括號深度
  let i = 0, prev = '';                // prev：上一個有意義的程式碼字元（判斷 / 是除號還是 regex 開頭）
  const regexOk = () => prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(return|typeof|in|of|case|else|do)$/.test(src.slice(Math.max(0, i - 7), i));
  while (i < src.length) {
    const top = stack[stack.length - 1], ch = src[i], nx = src[i + 1];
    if (top === 't') {
      if (ch === '\\') { ctx[i] = ctx[i + 1] = 't'; i += 2; continue; }
      if (ch === '`') { ctx[i++] = 'c'; stack.pop(); prev = '`'; continue; }
      if (ch === '$' && nx === '{') { ctx[i] = ctx[i + 1] = 'c'; i += 2; stack.push('c'); braces.push(0); prev = '{'; continue; }
      ctx[i++] = 't'; continue;
    }
    // 程式碼
    if (ch === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') ctx[i++] = 'm'; continue; }
    if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; while (i < end) ctx[i++] = 'm'; continue; }
    if (ch === '"' || ch === "'") {
      ctx[i++] = 's';
      while (i < src.length && src[i] !== ch && src[i] !== '\n') { if (src[i] === '\\') ctx[i++] = 's'; ctx[i++] = 's'; }
      ctx[i++] = 's'; prev = ch; continue;
    }
    if (ch === '`') { ctx[i++] = 'c'; stack.push('t'); continue; }
    if (ch === '/' && regexOk()) {
      ctx[i++] = 'r'; let cls = false;
      while (i < src.length && src[i] !== '\n') {
        const c = src[i];
        if (c === '\\') { ctx[i] = ctx[i + 1] = 'r'; i += 2; continue; }
        if (c === '[') cls = true; else if (c === ']') cls = false;
        ctx[i++] = 'r';
        if (c === '/' && !cls) break;
      }
      while (i < src.length && /[a-z]/.test(src[i])) ctx[i++] = 'r';
      prev = '/'; continue;
    }
    if (stack.length > 1 && braces.length) {
      if (ch === '{') braces[braces.length - 1]++;
      if (ch === '}') { if (braces[braces.length - 1] === 0) { ctx[i++] = 'c'; stack.pop(); braces.pop(); prev = '}'; continue; } braces[braces.length - 1]--; }
    }
    ctx[i] = 'c';
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return ctx;
}
// 一份 JS 原始碼 → 命中（對照組與正式掃描走同一段）
export function escSource(src) {
  const ctx = lexContexts(src);
  const hits = [];
  let lits = 0, off = 0;
  src.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(ESC_LIT)) {
      const where = ctx[off + m.index + m[0].length - m[1].length];   // regex 字面開頭那個 / 在哪裡
      if (where !== 'r' && where !== 't') continue;                    // 字串、註解裡長得像 regex 的不算
      lits++;
      for (const h of escLine(m[0], where === 't')) hits.push({ kind: h.kind, n: i + 1 });
    }
    off += l.length + 1;
  });
  return { hits, lits };
}
const walkScripts = (root, d = 'scripts') => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (e.name === 'fixtures' ? [] : walkScripts(root, d + '/' + e.name)) : [d + '/' + e.name]));
export function escapeScan(root = ROOT) {
  const files = walkScripts(root);
  const orphans = files.filter((f) => !SCRIPT_EXT.has(path.extname(f)));
  const hits = [];
  let lits = 0;
  for (const f of files.filter((f) => SCRIPT_EXT.has(path.extname(f)))) {
    const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    if (f.endsWith('.sh')) {
      lines.forEach((l, i) => { if (/\b(grep|sed)\b/.test(l) && /\\\\[dsw]/.test(l)) hits.push({ kind: 'over-sh', file: f, n: i + 1, text: l.trim() }); });
      continue;
    }
    const r = escSource(src);
    lits += r.lits;
    for (const h of r.hits) hits.push({ kind: h.kind, file: f, n: h.n, text: lines[h.n - 1].trim() });
  }
  return { files: files.length, scanned: files.length - orphans.length, orphans, hits, lits };
}

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

  // 第二部分：跳脫掃描。先跑對照組（兩種位置 × 壞的要抓到、對的不能抓到），再跑真實原文，最後掃全部腳本
  log('— 跳脫掃描（scripts/ 底下全部腳本）—');
  const bs = '\\';
  const escCtrl = [
    ['一般程式碼：多跳脫一次要抓到', 'const r = /a' + bs + bs + 's+/;', false, 'over'],
    ['一般程式碼：反斜線被吃掉要抓到', "x.replace(/s+/g, '')", false, 'lost'],
    ['模板字串裡：只有一個反斜線要抓到', 'x.split(/' + bs + 's+/)', true, 'lost-tpl'],
    ['一般程式碼：正確的 /' + bs + 's+/ 不能抓', 'x.split(/' + bs + 's+/)', false, null],
    ['模板字串裡：正確的 /' + bs + bs + 's+/ 不能抓', 'x.split(/' + bs + bs + 's+/)', true, null],
    // 真實原文：2026-09-24 我用 heredoc 寫 patch 時把 sweep.mjs 這一行的反斜線吃掉（當下攔不到）
    ['真實原文（sweep.mjs 被吃掉的那一行）', '  if (r.status === 0 && /^d+ 項通過$/m.test(out)) pass++;', false, 'lost'],
  ];
  for (const [label, sample, inTpl, want] of escCtrl) {
    const got = escLine(sample, inTpl).map((h) => h.kind);
    const okCtrl = want ? got.includes(want) : got.length === 0;
    log(`跳脫對照組：${label}＝${okCtrl}`);
    if (!okCtrl) broken.push(`跳脫對照組沒過（${label}）`);
  }
  // 詞法分析的對照組（上一版只數反引號，碰到註解、字串、regex 字元類別裡的反引號就整段判錯位置——2026-09-24 實測）。
  // 每一種危險各自一份合成原始碼：放在同一份裡會互相抵銷（註解裡一個反引號、regex 字元類別裡一個反引號剛好湊成一對，
  // 把註解當程式碼的突變因此守不住——2026-09-24 突變實測）。每份的最後一行都是「程式碼裡反斜線被吃掉」，
  // 前面那一步判錯位置的話，它會被誤當成模板字串裡的文字而漏抓。
  const tick = '`';
  const tail = "y.replace(/s+/g, '');";
  const lexCases = [
    ['註解裡一個反引號', ['// 註解裡只有一個反引號 ' + tick + ' 不能讓後面變成模板字串', tail], '2:lost'],
    ['regex 字元類別裡一個反引號', ["const q = /['\"" + tick + ";]/;", tail], '2:lost'],
    ['字串裡一個反引號', ["const s = '字串裡的 " + tick + " 不算';", tail], '2:lost'],
    ['字串裡長得像 regex 的不算', ["const s = '在字串裡 /s+/ 不算';"], ''],
    ['模板字串裡的 regex', ['const T = ' + tick + '(() => {', '  return /a' + bs + 's+/.test(x);', '})()' + tick + ';', tail], '2:lost-tpl 4:lost'],
  ];
  for (const [label, src, want] of lexCases) {
    const got = escSource(src.join('\n')).hits.map((h) => `${h.n}:${h.kind}`).sort().join(' ');
    const okLex = got === want;
    log(`跳脫對照組：詞法分析——${label}＝${okLex}（命中 ${got || '無'}，應為 ${want || '無'}）`);
    if (!okLex) broken.push(`跳脫對照組沒過（詞法分析：${label}）`);
  }
  const esc = escapeScan(root);
  log(`掃了 ${esc.scanned}/${esc.files} 支腳本、${esc.lits} 個 regex 字面，命中 ${esc.hits.length}`);
  if (!esc.scanned || !esc.lits) broken.push('跳脫掃描的母體是空的');
  if (esc.orphans.length) broken.push(`scripts/ 底下有不認得的腳本（孤兒，沒被掃到）：${esc.orphans.join('、')}`);
  const knownUsed = new Set();
  const escBad = esc.hits.filter((h) => {
    const i = ESC_KNOWN.findIndex((k) => k.file === h.file && k.kind === h.kind && (k.has ? h.text.includes(k.has) : k.match.test(h.text)));
    if (i >= 0) { knownUsed.add(i); return false; }
    return true;
  });
  ESC_KNOWN.forEach((k, i) => { if (!knownUsed.has(i)) broken.push(`跳脫掃描登記的已知項對不到任何一行（${k.file}／${k.kind}）`); });
  for (const k of ESC_KNOWN.filter((k) => k.state === '待修')) log(`   已知、待修（未授權）：[${k.kind}] ${k.file}——${k.why}`);
  for (const h of escBad) log(`   [${h.kind}] ${h.file}:${h.n}  ${h.text.slice(0, 140)}`);
  bad.push(...escBad);

  if (broken.length) { log(`擋下：檢查器壞了（${broken.join('、')}）`); return 4; }
  if (bad.length) { log(`擋下：有壞寫法（${[...new Set(bad.map((h) => h.kind))].join('、')}）`); return 1; }
  log('通過');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(run());
