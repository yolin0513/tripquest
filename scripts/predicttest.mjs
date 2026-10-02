// 按次預測（scripts/predict.mjs、run-affected 的耗時預測與 --approved）的測試（npm run predicttest；2026-10-02）。
// 一、純函式：每一條規則一個合成樣本、正反兩向。
// 二、真入口：在 repo 的暫存 clone（.logs/pred-clone）裡從 `run-affected --only` 跑假測試——
//     沒量過要擋（回 8）、拿許可才跑、預估與實際記進 run-history、量過之後常規照跑、預估超過 600 秒要擋、
//     預測法不準要擋、--all 列出整條鏈。判定看 .logs/run-history.jsonl 與 .logs/test-times.json 的內容，不只看回傳值。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { predict, classify, predictorBroken, PREDICTOR_VERSION, LIMIT_SEC } from './predict.mjs';
import { snapshot, changesBetween, describe } from './worktree-guard.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 500).split('\n').map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
const V = PREDICTOR_VERSION;
const H = (pred, act, o = {}) => ({ version: V, predictedSec: pred, actualSec: act, heavy: false, approved: false, ...o });

console.log('— 一、純函式 —');
{
  const p = predict(['a', 'b'], { a: { sec: 10 }, b: { sec: 20.5 } });
  yes(p.sec === 30.5 && p.known === 2 && p.unknown.length === 0, `P1 加總：a 10＋b 20.5＝${p.sec}`);
  const q = predict(['a', 'c'], { a: { sec: 10 } });
  yes(q.sec === null && q.unknown.join() === 'c', 'P1 有一支沒量過 → 預測不出（不是當 0 秒加總）');
  yes(!classify({ pred: predict(['a'], { a: { sec: 100 } }) }).heavy, 'P2 量過、100 秒 → 常規');
  yes(classify({ pred: q }).heavy && /預測不出/.test(classify({ pred: q }).reason), 'P3 預測不出 → 重負載');
  yes(classify({ pred: predict(['a'], { a: { sec: LIMIT_SEC + 1 } }) }).heavy, `P4 ${LIMIT_SEC + 1} 秒 → 重負載`);
  yes(!classify({ pred: predict(['a'], { a: { sec: LIMIT_SEC } }) }).heavy, `P4 反向：剛好 ${LIMIT_SEC} 秒 → 常規`);
  const over3 = [H(100, 151), H(100, 200), H(100, 160)];
  yes(!!predictorBroken(over3), 'P5 連續 3 次實際超過預估 50% 以上 → 預測法要改');
  yes(!predictorBroken(over3.slice(1)), 'P5 反向：只有 2 次 → 不算');
  yes(!predictorBroken([H(100, 151), H(100, 140), H(100, 160)]), 'P5 反向：3 次裡有一次只超過 40% → 不算');
  yes(!predictorBroken([H(100, 150), H(100, 150), H(100, 150)]), 'P5 邊界：剛好 50% → 不算（要「超過」）');
  yes(classify({ pred: predict(['a'], { a: { sec: 10 } }), history: over3 }).heavy, 'P5 預測法要改時，就算預估很短也當重負載');
  yes(!!predictorBroken([H(100, LIMIT_SEC + 5)]), 'P6 預估常規、實際超過 600 秒、沒拿許可 → 預測法要改');
  yes(!predictorBroken([H(100, LIMIT_SEC + 5, { approved: true })]), 'P6 反向：有拿許可 → 不算');
  yes(!predictorBroken([H(700, LIMIT_SEC + 5, { heavy: true, approved: true })]), 'P6 反向：本來就判成重負載 → 不算');
  yes(!predictorBroken([H(100, 151, { version: V - 1 }), H(100, 200, { version: V - 1 }), H(100, 160, { version: V - 1 })]), 'P7 舊版預測法的紀錄不算（改好預測法、版本加 1 之後重新累計）');
  yes(!predictorBroken([H(null, 900, { heavy: true, approved: true })]), 'P7 預測不出（null）的那一次不參與「超過預估」');
}

{
  // 重負載判準（Dispatch 2026-10-02）：（≥2 工作程序 且 >60 秒）或 >600 秒 或 會開瀏覽器
  const k = (sec, o = {}) => classify({ pred: predict(['a'], { a: { sec } }), ...o });
  yes(k(5, { browser: ['a'] }).heavy, 'P8 會開瀏覽器 → 就算只要 5 秒也是重負載');
  yes(k(61, { multi: ['a'] }).heavy, 'P9 多程序、61 秒 → 重負載');
  yes(!k(60, { multi: ['a'] }).heavy, 'P9 反向：多程序、剛好 60 秒 → 常規');
  yes(!k(500).heavy, 'P9 反向：單一程序、500 秒（不到 600）→ 常規');
}
{
  const { procFlags } = await import('./run-affected.mjs');
  const repo = { chain: [{ name: 'a', file: 'scripts/a.mjs' }, { name: 'b', file: 'scripts/b.mjs' }, { name: 'c', file: 'scripts/c.mjs' }, { name: 'd', file: 'scripts/d.mjs' }, { name: 'e', file: 'scripts/e.mjs' }],
    refs: { b: ['scripts/helper.mjs'], d: ['scripts/missing.mjs'] } };
  const FILES = { 'scripts/a.mjs': "import puppeteer from 'puppeteer';", 'scripts/b.mjs': "import { go } from './helper.mjs';", 'scripts/helper.mjs': "import puppeteer from 'puppeteer';",
    'scripts/c.mjs': "const r = spawnSync(process.execPath, ['x']);", 'scripts/d.mjs': 'console.log(1);', 'scripts/e.mjs': 'console.log(1);' };
  const read = (f) => { if (!(f in FILES)) throw new Error('讀不到 ' + f); return FILES[f]; };
  const fl = procFlags(repo, ['a', 'b', 'c', 'd', 'e'], read);
  yes(fl.browser.includes('a'), 'P10 測試檔自己用 puppeteer → 算會開瀏覽器');
  yes(fl.browser.includes('b'), 'P10 透過 import 的輔助檔才開瀏覽器 → 也算（不能只看測試檔本身）');
  yes(fl.multi.includes('c') && !fl.browser.includes('c'), 'P10 會 spawn 子程序 → 算多程序');
  yes(fl.browser.includes('d'), 'P10 import 的檔讀不到 → 從寬當成會開瀏覽器');
  yes(!fl.browser.includes('e') && !fl.multi.includes('e'), 'P10 反向：單純的測試 → 兩邊都不算');
}

console.log('\n— 二、真入口（暫存 clone）—');
const CLONE = path.join(ROOT, '.logs', 'pred-clone');
const mainBefore = snapshot({ root: ROOT });
fs.rmSync(CLONE, { recursive: true, force: true });
execFileSync('git', ['clone', '-q', ROOT, CLONE]);
const cgit = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: CLONE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
cgit('config', 'user.name', 'pred');
cgit('config', 'user.email', 'pred@users.noreply.github.com');
for (const f of ['scripts/run-affected.mjs', 'scripts/predict.mjs', 'scripts/run-timeout.mjs', 'scripts/proctree.mjs', 'scripts/worktree-guard.mjs', 'scripts/affected.mjs', '.gitignore', 'package.json']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(CLONE, f));
}
fs.writeFileSync(path.join(CLONE, 'scripts', 'zz-p-a.mjs'), "console.log('假測試');\n");
const pkgP = path.join(CLONE, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgP, 'utf8'));
pkg.scripts['test:chain'] += ' && node scripts/zz-p-a.mjs';
fs.writeFileSync(pkgP, JSON.stringify(pkg, null, 2) + '\n');
cgit('add', '-A'); cgit('commit', '-q', '-m', 'pred 起點');
console.log(testedLine(CLONE, ['scripts/run-affected.mjs', 'scripts/predict.mjs', 'scripts/run-timeout.mjs', 'scripts/proctree.mjs', 'scripts/worktree-guard.mjs', 'scripts/affected.mjs']));
const chainLen = pkg.scripts['test:chain'].split('&&').length;
const TIMES = path.join(CLONE, 'tools', 'test-times.json');
const HIST = path.join(CLONE, '.logs', 'run-history.jsonl');
const clear = () => { fs.rmSync(TIMES, { force: true }); fs.rmSync(HIST, { force: true }); };
const run = (...a) => { const r = spawnSync(process.execPath, ['scripts/run-affected.mjs', ...a], { cwd: CLONE, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const hist = () => (fs.existsSync(HIST) ? fs.readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const times = () => (fs.existsSync(TIMES) ? JSON.parse(fs.readFileSync(TIMES, 'utf8')) : {});

{
  clear();
  const r = run('--only', 'zz-p-a');
  yes(r.code === 8 && /預測不出：1 支沒量過（zz-p-a）/.test(r.out) && /要先向 Dispatch 要許可/.test(r.out) && hist().length === 0 && !('zz-p-a' in times()),
    `C1 沒量過 → 回 8、寫明預測不出與要許可、沒有跑（沒記紀錄、沒量秒數）（實得 ${r.code}）`, r.out.slice(-300));
}
{
  clear();   // 每個情境自己準備狀態，不吃上一個情境留下的（C1 若被放行而真的跑了，會留下秒數——2026-10-02 突變實測踩到）
  const r = run('--only', 'zz-p-a', '--approved');
  const h = hist().pop();
  yes(r.code === 0 && h && h.approved === true && h.heavy === true && h.predictedSec === null && typeof h.actualSec === 'number' && h.end === '綠' && h.version === PREDICTOR_VERSION,
    `C2 拿許可（--approved）→ 照跑、回 0；紀錄有預估（預測不出）與實際（${h ? h.actualSec : '無'} 秒）`, r.out.slice(-300));
  const tz = times()['zz-p-a'];
  yes(tz && typeof tz.sec === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(tz.at), `C2 跑完記下這支的實測秒數與量的日期（${tz ? tz.sec + ' 秒、' + tz.at : '沒有'}），寫在進版控的 tools/test-times.json`);
  yes(!/動到工作區的檔/.test(r.out), 'C2 執行器自己寫的 tools/test-times.json 沒被工作區守衛算成測試動到的檔', r.out.slice(-300));
}
{
  clear();
  fs.mkdirSync(path.dirname(TIMES), { recursive: true });
  fs.writeFileSync(TIMES, JSON.stringify({ 'zz-p-a': { sec: 0.1, at: '2026-10-01' } }));
  const r = run('--only', 'zz-p-a');
  const h = hist().pop();
  yes(r.code === 0 && h && h.heavy === false && typeof h.predictedSec === 'number' && /→ 常規/.test(r.out),
    `C3 量過、很短 → 不用許可、常規照跑；紀錄的預估是數字（${h ? h.predictedSec : '無'}）（實得 ${r.code}）`, r.out.slice(-300));
}
{
  fs.writeFileSync(TIMES, JSON.stringify({ 'zz-p-a': { sec: LIMIT_SEC + 100, at: '2026-10-01' } }));
  const n0 = hist().length;
  const r = run('--only', 'zz-p-a');
  yes(r.code === 8 && new RegExp(`預估 ${LIMIT_SEC + 100} 秒，超過 ${LIMIT_SEC} 秒`).test(r.out) && hist().length === n0,
    `C4 這一支上次跑了 ${LIMIT_SEC + 100} 秒 → 回 8、寫明預估超過、沒有跑（實得 ${r.code}）`, r.out.slice(-300));
}
{
  clear();
  fs.mkdirSync(path.dirname(HIST), { recursive: true });
  fs.writeFileSync(TIMES, JSON.stringify({ 'zz-p-a': { sec: 1, at: '2026-10-01' } }));
  fs.writeFileSync(HIST, [H(100, 151), H(100, 200), H(100, 160)].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const r = run('--only', 'zz-p-a');
  yes(r.code === 8 && /預測法要改：同一版預測法最近連續 3 次/.test(r.out), `C5 預測法最近不準 → 就算預估 1 秒也回 8（實得 ${r.code}）`, r.out.slice(-300));
}
{
  clear();
  const r = run('--all', '--dry');
  yes(r.code === 0 && new RegExp(`完整的鏈 ${chainLen} 支（npm test）`).test(r.out) && new RegExp(`（0/${chainLen} 支量過）→ 重負載`).test(r.out),
    `C6 --all 列出整條鏈 ${chainLen} 支、印出預測（實得 ${r.code}）`, r.out.slice(-300));
}
{
  // npm test 真的走 run-affected --all（package.json 那一行）
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  yes(real.test === 'node scripts/run-affected.mjs --all' && typeof real['test:chain'] === 'string' && real['test:chain'].startsWith('node scripts/'),
    'C7 package.json：npm test＝run-affected --all，鏈的定義在 test:chain');
}

fs.rmSync(CLONE, { recursive: true, force: true });
yes(!fs.existsSync(CLONE), '暫存 clone 已刪');
const mainTouched = changesBetween(mainBefore, snapshot({ root: ROOT }));
yes(mainTouched.length === 0, `主工作區跑前跑後一樣（跑前不一樣的檔 ${mainBefore.size} 個）`, describe(mainTouched));
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
