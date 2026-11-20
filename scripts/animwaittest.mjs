// 共用等待函式的對照組（node scripts/animwaittest.mjs；秒級、不開瀏覽器、不連網；2026-11-21）
//
// 涵蓋的程式：scripts/animwait.mjs（peektest、mascottest 共用的「等動畫起跑／自己播完」）
//
// 為什麼另開一支：等待函式本身壞了（不真的等、逾時當成等到了），在瀏覽器裡的量測會「看當下有沒有動畫還在等」而時紅時不紅，
//   突變判不出紅在預期；這裡用假的動畫物件，結果固定、約 1 秒。等待函式的突變（tools/mutations/mut_wait1121.json）cmd 是這一支。
// 真的頁面上那一半（選擇器找圖、Animation.ready／finished 真的兌現）由 peektest、mascottest 走：它們的斷言要求標記在、而且 waitedOk。
//
//   AW1 等起跑・晚到：一段 200ms 後才起跑的假動畫，最多等 1500ms → 要等到（不逾時、等之前 1 段、等之後 0 段、等了 150～1400ms）
//   AW2 等起跑・等不到：一段永遠不起跑的假動畫，最多等 300ms → 要逾時、等之後還剩 1 段（逾時路徑不能被算成綠）
//   AW3 等播完・晚到：同 AW1，等的是播完
//   AW4 等播完・等不到：同 AW2，等的是播完
//   AW5 沒有動畫：0 段 → 馬上過（不逾時、等了 < 100ms）
//   AW6 判定 waitedOk：等到了→算；逾時、標記不在、找不到圖、等的是另一種、還剩段數→都不算（六格各一個合成標記，每格只打到一道擋）
// 突變（tools/mutations/mut_wait1121.json，cmd 是這一支）：不真的等→AW1、AW3；逾時當成等到了→AW2、AW4；
//   waitedOk 拿掉逾時／段數／等的種類／找得到圖任一道→各自只讓 AW6 的那一格不對（訊息「不對的：」點名哪一格）
import { waitAnimsIn, waitedOk, waitBrief } from './animwait.mjs';

let pass = 0, fail = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } };

// 假的動畫物件：只有等待函式會讀的那幾個欄位
const late = (key, ms) => {
  const a = key === 'ready' ? { pending: true } : { playState: 'running' };
  a[key] = new Promise((res) => setTimeout(() => { if (key === 'ready') a.pending = false; else a.playState = 'finished'; res(a); }, ms));
  return a;
};
const never = (key) => (key === 'ready' ? { pending: true, ready: new Promise(() => {}) } : { playState: 'running', finished: new Promise(() => {}) });

for (const [k, word, n1, n2] of [['ready', '起跑', 'AW1', 'AW2'], ['finished', '播完', 'AW3', 'AW4']]) {
  const a = await waitAnimsIn([late(k, 200)], k, 1500);
  yes(a.found && !a.timeout && a.before === 1 && a.after === 0 && a.waited >= 150 && a.waited <= 1400 && waitedOk(a, k),
    `${n1} 等${word}・晚到：200ms 後才${word}的一段，最多等 1500ms → 要真的等到（${waitBrief(a)}）`);
  const b = await waitAnimsIn([never(k)], k, 300);
  yes(b.found && b.timeout === true && b.after === 1 && !waitedOk(b, k),
    `${n2} 等${word}・等不到：永遠不${word}的一段，最多等 300ms → 要逾時、還剩 1 段、判定不算等到（${waitBrief(b)}）`);
}
{
  const z = await waitAnimsIn([], 'ready', 1500);
  yes(z.found && !z.timeout && z.n === 0 && z.waited < 100 && waitedOk(z, 'ready'), `AW5 沒有動畫：0 段 → 馬上過（${waitBrief(z)}）`);
}
{
  const ok = { until: 'finished', ms: 6000, found: true, n: 3, before: 3, after: 0, waited: 1200, timeout: false };
  const cells = [
    ['等到了', ok, true],
    // 每一格只靠 waitedOk 的一道擋（樣本不共用零件，§5.3）：「逾時」這格段數是 0（例如等的時候動畫被取消，ready／finished 拒絕、
    //   pending 已經變 false），只有 !timeout 那一道擋得到；「還剩 1 段」沒標逾時，只有 after === 0 那一道擋得到
    ['逾時（段數 0）', { ...ok, timeout: true }, false],
    ['標記不在', null, false],
    ['找不到圖', { ...ok, found: false }, false],
    ['等的是起跑', { ...ok, until: 'ready' }, false],
    ['還剩 1 段（沒標逾時）', { ...ok, after: 1 }, false],
  ];
  const got = cells.map(([, w]) => waitedOk(w, 'finished'));
  const bad = cells.filter(([, , want], i) => got[i] !== want).map(([name]) => name);
  yes(bad.length === 0, `AW6 判定 waitedOk（要的是「播完」）：${cells.map(([name], i) => `${name}→${got[i] ? '算' : '不算'}`).join('、')}${bad.length ? `；不對的：${bad.join('、')}` : ''}`);
}

console.log(`\n${pass} 項通過${fail ? `，${fail} 項失敗` : ''}`);
process.exit(fail ? 1 : 0);
