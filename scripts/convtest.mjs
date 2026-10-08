// 共用慣例副本跟主檔一致（node scripts/convtest.mjs；2026-10-08）。涵蓋的程式：scripts/convcheck.mjs 。
// 在 test:chain 裡，也在底線（scripts/affected.mjs 的 BASELINE）——每次 test:affected 都跑，不靠「動到某個檔」才觸發：
// 主檔在別的 repo，它改了本 repo 什麼都沒動，只有每次都跑才抓得到。
//   CV0（前提）副本讀得到、副本與主檔是兩個不同的實體檔
//   CV1 比對器（用副本的真實內容造）：原樣→一致；只改版本行→版本不同；版本相同、內文改一個字→全文不同；主檔讀不到→讀不到主檔
//   CV2 真的去比：副本跟主檔一致（不一致就紅——照主檔更新副本）
//   CV3 主檔路徑讀不到 → 紅、講明「讀不到主檔」（不當成通過）
//   CV4 副本與主檔是同一個實體檔（路徑直接指向自己、硬連結）→ 紅（拿自己比自己永遠一致）；兩個不同的檔 → 不算同一個（反向）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convCheck, compareConv, sameFile, MASTER_REL, COPY_REL } from './convcheck.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 400) : '')); process.exitCode = 1; }
};
console.log(testedLine(ROOT, ['scripts/convcheck.mjs']));

const copyAbs = path.resolve(ROOT, COPY_REL), masterAbs = path.resolve(ROOT, MASTER_REL);
const copyText = fs.existsSync(copyAbs) ? fs.readFileSync(copyAbs, 'utf8') : null;
yes(copyText !== null && sameFile(copyAbs, masterAbs) !== true,
  `前提：副本讀得到、副本與主檔不是同一個實體檔（副本讀得到＝${copyText !== null}、同一個檔＝${sameFile(copyAbs, masterAbs)}）`);

if (copyText !== null) {
  const first = copyText.split('\n')[0];
  const otherVer = copyText.replace(first, '<!-- CONVENTIONS v0.0 2000-01-01 -->');
  const otherBody = copyText.replace('適用：', '適應：');
  const res = [compareConv(copyText, copyText), compareConv(copyText, otherVer), compareConv(copyText, otherBody), compareConv(copyText, null)];
  yes(otherVer !== copyText && otherBody !== copyText, 'CV1 前置：造出來的「只改版本行」「內文改一個字」真的跟原文不同');
  yes(res[0].ok && !res[1].ok && res[1].why.startsWith('版本不同') && !res[2].ok && res[2].why.includes('全文不同') && !res[3].ok && res[3].why === '讀不到主檔',
    `CV1 比對器：原樣→一致、只改版本行→版本不同、內文改一個字→全文不同、主檔讀不到→讀不到主檔（${res.map((x) => x.why.slice(0, 12)).join('｜')}）`);
}

const real = convCheck(ROOT);
yes(real.ok, `CV2 共用慣例副本跟主檔一致：${real.why}`);

const gone = convCheck(ROOT, { masterRel: '../../沒有這個工作區/CONVENTIONS.md' });
yes(!gone.ok && gone.why === '讀不到主檔', `CV3 主檔讀不到 → 判不一致、講明「${gone.why}」（不當成通過）`);

{
  const self = convCheck(ROOT, { masterRel: COPY_REL });
  yes(!self.ok && self.why.startsWith('副本與主檔是同一個實體檔'), `CV4 主檔路徑指到副本自己 → 判不一致、講明「${self.why}」`);
  // 硬連結：路徑不同、實體是同一個檔；放在 .logs 底下、用帶 pid 的名字，收尾在 finally、刪不掉就報出來
  const dir = path.join(ROOT, '.logs', `convtest-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const a = path.join(dir, 'a.md'), b = path.join(dir, 'b.md'), c = path.join(dir, 'c.md');
    fs.writeFileSync(a, copyText ?? '<!-- CONVENTIONS v0.0 2000-01-01 -->\n');
    fs.linkSync(a, b);
    fs.writeFileSync(c, fs.readFileSync(a));
    const rel = (p) => path.relative(ROOT, p);
    const link = convCheck(ROOT, { copyRel: rel(a), masterRel: rel(b) });
    const twin = convCheck(ROOT, { copyRel: rel(a), masterRel: rel(c) });
    yes(sameFile(a, b) === true && !link.ok && link.why.startsWith('副本與主檔是同一個實體檔'),
      `CV4 硬連結（路徑不同、實體同一個）→ 判不一致、講明「${link.why}」`);
    yes(sameFile(a, c) === false && twin.ok, `CV4 反向：內容一樣但是兩個不同的檔 → 不算同一個、判一致（${twin.why}）`);
  } finally {
    try { fs.rmSync(dir, { recursive: true }); } catch (e) { console.log(`✗ 收尾刪不掉 ${path.relative(ROOT, dir)}：${e.code || e.message}`); process.exitCode = 1; }
  }
}

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
