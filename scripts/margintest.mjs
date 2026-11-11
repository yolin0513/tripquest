// scripts/margin.mjs 的驗法（node scripts/margintest.mjs；2026-11-12 守夜）。純 node、不開瀏覽器、秒級。
// 每個分支一條合成樣本，樣本之間不共用零件（共用慣例 §5.3）；突變見 tools/mutations/mut_margin1112.json，每條只紅它那一條。
//   G1 上限、過、貼近：127 ≤136 → 過、餘裕 9、6.6%、標 ⚠
//   G2 下限、過、貼近：46 ≥44 → 過、餘裕 2、4.5%、標 ⚠
//   G3 上限、過、不貼近：180 ≤220 → 過、餘裕 40、18.2%、不標 ⚠
//   G4 上限、不過：709 <700 → 不過、餘裕 -9（負的照印）、不標 ⚠（不過的不算「貼近」）
//   G5 嚴格與不嚴格的邊界：700 <700 不過、700 ≤700 過（餘裕 0）
//   G6／G6b／G6c 好幾個值（拆成三條，各守一個分支）：下限取最小、上限取最大、其中一個不過就整條不過
//   G7 貼近的界線：餘裕剛好 10% 不標、9% 標
//   G8 量不到：null、NaN、空陣列 → 不過、寫「量不到」，不當成 0
//   G9 不認得的比較、門檻是 0 → 丟錯（不默默當成過）
//   G10 summary：查了幾條、貼近幾條、點名、沒過幾條；行首不是 ✓／✗
import { makeMargin, TIGHT } from './margin.mjs';

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 400) : '')); process.exitCode = 1; }
};
const one = (...a) => makeMargin().within(...a);

{ const r = one(127, '<=', 136, 'px');
  yes(r.ok && r.slack === 9 && r.tight && r.tail === '｜門檻 ≤136px、餘裕 9px（6.6%） ⚠ 貼近門檻', 'G1 上限、過、貼近：127 ≤136 → 餘裕 9px、6.6%、標 ⚠', JSON.stringify(r)); }
{ const r = one(46, '>=', 44, 'px');
  yes(r.ok && r.slack === 2 && r.tight && r.tail.endsWith('餘裕 2px（4.5%） ⚠ 貼近門檻'), 'G2 下限、過、貼近：46 ≥44 → 餘裕 2px、4.5%、標 ⚠', JSON.stringify(r)); }
{ const r = one(180, '<=', 220, 'px');
  yes(r.ok && r.slack === 40 && !r.tight && r.tail === '｜門檻 ≤220px、餘裕 40px（18.2%）', 'G3 上限、過、不貼近：180 ≤220 → 餘裕 40px、不標 ⚠', JSON.stringify(r)); }
{ const r = one(709, '<', 700, 'px');
  yes(!r.ok && r.slack === -9 && !r.tight && r.tail.includes('餘裕 -9px') && !r.tail.includes('⚠'), 'G4 上限、不過：709 <700 → 不過、餘裕 -9px、不標 ⚠', JSON.stringify(r)); }
{ const a = one(700, '<', 700), b = one(700, '<=', 700);
  yes(!a.ok && a.slack === 0 && b.ok && b.slack === 0 && b.tight, 'G5 邊界：700 <700 不過、700 ≤700 過（餘裕 0、貼近）', JSON.stringify([a, b])); }
{ const lo = one([46, 48, 45], '>=', 44, 'px');
  yes(lo.ok && lo.worst === 45 && lo.slack === 1 && lo.tail.includes('最差 45px'), 'G6 好幾個值、下限：[46,48,45] ≥44 → 最差取最小 45、餘裕 1px', JSON.stringify(lo)); }
{ const hi = one([100, 90], '<=', 136, 'px');
  yes(hi.ok && hi.worst === 100 && hi.slack === 36, 'G6b 好幾個值、上限：[100,90] ≤136 → 最差取最大 100、餘裕 36px', JSON.stringify(hi)); }
{ const bad = one([50, 43], '>=', 44, 'px');
  yes(!bad.ok, 'G6c 好幾個值裡有一個不過 → 整條不過（[50,43] ≥44）', JSON.stringify(bad)); }
{ const edge = one(90, '<=', 100), near = one(91, '<=', 100);
  yes(TIGHT === 0.1 && !edge.tight && near.tight, 'G7 貼近的界線：餘裕剛好 10% 不標、9% 標', JSON.stringify([edge, near])); }
{ const rs = [one(null, '>=', 44, 'px'), one(NaN, '<=', 136), one([], '>=', 44), one([46, undefined], '>=', 44)];
  yes(rs.every((r) => !r.ok && r.slack === null && r.tail.includes('量不到')), 'G8 量不到（null、NaN、空陣列、其中一個沒值）→ 不過、寫「量不到」', JSON.stringify(rs)); }
{ const thrown = (f) => { try { f(); return false; } catch { return true; } };
  yes(thrown(() => one(1, '=<', 2)) && thrown(() => one(1, '<=', 0)) && thrown(() => one(1, '<=', NaN)), 'G9 不認得的比較、門檻是 0 或不是數字 → 丟錯'); }
{ const M = makeMargin();
  M.within(46, '>=', 44, 'px', '相機鈕'); M.within(180, '<=', 220, 'px', '特大字收合列'); M.within(709, '<', 700, 'px', '一個景點'); M.within(127, '<=', 136, 'px', '收合列');
  const s = M.summary();
  yes(s === '餘裕：查了 4 條有門檻的斷言，貼近門檻（< 10%）2 條：相機鈕 餘裕 2px（4.5%）、收合列 餘裕 9px（6.6%）；沒過 1 條' && !/^[✓✗]/.test(s) && M.count() === 4,
    'G10 summary：查了 4 條、貼近 2 條並點名、沒過 1 條；行首不是 ✓／✗', s); }

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
