// 每一支 JS 都在 Service Worker 的離線清單（SHELL_ASSETS）裡（npm run shelltest；秒級、不開瀏覽器）
//
// 涵蓋的程式：sw.js、js/**/*.js、index.html
//
// 為什麼要這支：v1.74.11 新增的 js/tripday.js 被行程頁 import，卻沒列進 SHELL_ASSETS（2026-10-27 查到）。
// 不在清單的檔不會在安裝時預存：裝好之後還沒在有網路時打開過行程頁就離線，行程頁整個載不起來；
// 而且它走 stale-while-revalidate，換版時可能拿到新舊混雜的檔。這種漏列不會讓任何測試紅（有網路時一切正常）。
//   S1 母體：git 追蹤的＋工作區裡的 js/**/*.js（不是 0 支）
//   S2 每一支都在 SHELL_ASSETS；不在的只准是登記過的例外（登記制），登記了卻已經在清單或檔案不存在也報
//   S3 清單裡的每一個 ./js/ 路徑都真的有檔（清單寫錯，安裝時 addAll 整批失敗、整個 SW 裝不起來）
//   S4 index.html 直接載入的本站 JS 也在清單
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 登記的例外：路徑 → 理由
export const EXEMPT = {
  'js/invite.js': '沒有任何地方 import 它（v1.58.0 邀請連結改版後留下的；要不要刪是另一件事），不需要離線',
};

export function listJs(dir, root = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p, root));
    else if (e.name.endsWith('.js')) out.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return out;
}

export function shellOf(swText) {
  const m = /const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(swText);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// files：相對 repo 的 js 路徑清單；exists(p)：清單裡的路徑有沒有檔
export function check({ files, swText, indexText, exempt = EXEMPT, exists }) {
  const lines = []; let ok = true;
  const say = (good, msg) => { lines.push((good ? '✓ ' : '✗ ') + msg); if (!good) ok = false; };
  const shell = shellOf(swText);
  say(!!shell && shell.length > 0, `S1 讀得到 SHELL_ASSETS（${shell ? shell.length : 0} 項）`);
  say(files.length > 0, `S1 母體：js 底下 ${files.length} 支`);
  if (!shell) return { ok, lines };
  const set = new Set(shell);
  const missing = files.filter((f) => !set.has('./' + f) && exempt[f] == null);
  say(missing.length === 0, `S2 每一支都在離線清單${missing.length ? '；漏列：' + missing.join('、') : ''}`);
  const stale = Object.keys(exempt).filter((f) => set.has('./' + f) || !files.includes(f));
  say(stale.length === 0, `S2 登記的例外 ${Object.keys(exempt).length} 條都還有效${stale.length ? '；過期：' + stale.join('、') : ''}`);
  const ghost = shell.filter((u) => u.startsWith('./js/') && !exists(u.slice(2)));
  say(ghost.length === 0, `S3 清單裡的 js 路徑都有檔${ghost.length ? '；沒有檔：' + ghost.join('、') : ''}`);
  const direct = [...indexText.matchAll(/<script[^>]*\bsrc="\.\/([^"]+\.js)"/g)].map((x) => x[1]);
  const directMissing = direct.filter((f) => !set.has('./' + f));
  say(direct.length > 0 && directMissing.length === 0, `S4 index.html 直接載入的 ${direct.length} 支都在清單${directMissing.length ? '；漏列：' + directMissing.join('、') : ''}`);
  return { ok, lines };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain) {
  let pass = 0;
  const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
  // 對照組：同一個 check()，餵合成的清單。每一種壞法只紅它自己那一類。
  const SW = "const SHELL_ASSETS = [\n  './index.html',\n  './js/a.js',\n  './js/views/b.js',\n];";
  const IDX = '<script src="./js/a.js"></script>';
  const has = (p) => ['js/a.js', 'js/views/b.js', 'js/c.js'].includes(p);
  const ctl = (name, args, want) => {
    const r = check({ exempt: {}, exists: has, swText: SW, indexText: IDX, files: ['js/a.js', 'js/views/b.js'], ...args });
    const red = r.lines.filter((l) => l.startsWith('✗ '));
    const hit = want == null ? red.length === 0 : red.length > 0 && red.every((l) => l.startsWith('✗ ' + want));
    yes(hit, `對照組 ${name}：${want ? '應只紅 ' + want : '應全過'}，實際紅 ${red.length} 條${red.length ? '（' + red.map((l) => l.slice(2, 30)).join('｜') + '）' : ''}`);
  };
  ctl('合格', {}, null);
  ctl('新檔沒列進清單', { files: ['js/a.js', 'js/views/b.js', 'js/c.js'] }, 'S2');
  ctl('登記過的例外放行', { files: ['js/a.js', 'js/views/b.js', 'js/c.js'], exempt: { 'js/c.js': '測試' } }, null);
  ctl('例外已經在清單（過期）', { exempt: { 'js/a.js': '測試' } }, 'S2');
  ctl('清單寫了不存在的檔', { exists: (p) => p !== 'js/views/b.js' }, 'S3');
  ctl('index.html 直接載入的沒列', { indexText: IDX + '<script src="./js/boot.js"></script>' }, 'S4');
  ctl('讀不到清單', { swText: 'const OTHER = [];' }, 'S1');

  const files = listJs(path.join(ROOT, 'js')).map((f) => 'js/' + f);
  const r = check({
    files,
    swText: fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'),
    indexText: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    exists: (p) => fs.existsSync(path.join(ROOT, p)),
  });
  console.log('— sw.js／js／index.html —');
  for (const l of r.lines) yes(l.startsWith('✓ '), l.slice(2));
  console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
}
