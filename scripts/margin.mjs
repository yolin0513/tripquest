// 門檻斷言印「實際／門檻／餘裕」（2026-11-12 守夜；Dispatch：「差 2px 的那個，等於沒有在守」）
//
// 為什麼：版面測試原本只印過或不過。densitytest 的相機鈕 46px 對門檻 44px 只差 2px、一個景點 682px 對 700 差 18px——
// 字體、縮放、瀏覽器版本的一點差異就翻掉，翻掉時看起來像程式壞了；而「差一點就過不了」跟「穩穩地過」在輸出上長得一樣。
// 今晚只有 densitytest 剛好紅了所以被查，另外兩個同樣脆弱、只是運氣好。
//
// 用法（判準跟原本的比較式一模一樣，只多印一段）：
//   import { makeMargin } from './margin.mjs';
//   const M = makeMargin();
//   const r = M.within(m.max, '<=', 136, 'px', '收合列最高');
//   yes(r.ok, `收合列最高 ${m.max}px${r.tail}`);
//   …測試結尾：console.log(M.summary());
// 一次好幾個值（兩顆按鈕的寬與高）：M.within([46, 46, 46, 46], '>=', 44, 'px', '…')——全部都要過，餘裕取最差的那一個。
//
// 規則：
//   · 訊息原本的開頭不動、餘裕接在最後：突變的 expect 比的是開頭（共用慣例 §5.9）。
//   · 餘裕＝離門檻還有多遠：上限（<=、<）是「門檻−實際」，下限（>=、>）是「實際−門檻」；不過時是負的，照樣印（差多少一眼看到）。
//   · 比例＝餘裕÷門檻的絕對值；過了、但比例 < TIGHT（10%）標「⚠ 貼近門檻」。⚠ 只在過了的時候標——不過的那條本來就是 ✗。
//     10% 的依據：今晚三個例子（2.4%、4.5%、6.6%）都要現形；特大字收合列 180／220（18%）不算貼。
//   · 量不到（null、undefined、NaN、空陣列）：判不過、餘裕寫「量不到」——不當成 0，也不當成剛好在門檻上（共用慣例 §5.13）。
//   · summary()：這一份 makeMargin 到目前為止查了幾條、幾條貼近門檻、是哪幾條。說明行格式，行首是「餘裕：」，
//     不放 ✓／✗——不算進突變執行器的項數（scripts/mutate.mjs 數行首 ✓／✗ 的行）。
// 驗法：scripts/margintest.mjs（合成樣本，每個分支一條；突變 tools/mutations/mut_margin1112.json）。
export const TIGHT = 0.10;
const OPS = { '<=': (a, l) => a <= l, '<': (a, l) => a < l, '>=': (a, l) => a >= l, '>': (a, l) => a > l };
const SHOW = { '<=': '≤', '<': '<', '>=': '≥', '>': '>' };
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10));
const measurable = (v) => typeof v === 'number' && Number.isFinite(v);

export function makeMargin() {
  const seen = [];   // 每一條：{ name, ok, tight, slack, ratio, unit }
  function within(actual, op, limit, unit = '', name = '') {
    if (!OPS[op]) throw new Error(`margin.within：不認得的比較「${op}」（只認 <=、<、>=、>）`);
    if (!measurable(limit) || limit === 0) throw new Error(`margin.within：門檻要是非 0 的數字（拿到 ${limit}）`);
    const vals = Array.isArray(actual) ? actual : [actual];
    const lim = `門檻 ${SHOW[op]}${fmt(limit)}${unit}`;
    if (!vals.length || !vals.every(measurable)) {
      const r = { ok: false, worst: null, slack: null, ratio: null, tight: false, tail: `｜${lim}、量不到（${JSON.stringify(actual)}）` };
      seen.push({ name, ...r, unit });
      return r;
    }
    const upper = op === '<=' || op === '<';
    const worst = upper ? Math.max(...vals) : Math.min(...vals);
    const ok = vals.every((v) => OPS[op](v, limit));
    const slack = upper ? limit - worst : worst - limit;
    const ratio = slack / Math.abs(limit);
    const tight = ok && ratio < TIGHT;
    const tail = `｜${lim}、${vals.length > 1 ? `最差 ${fmt(worst)}${unit}、` : ''}餘裕 ${fmt(slack)}${unit}（${(ratio * 100).toFixed(1)}%）${tight ? ' ⚠ 貼近門檻' : ''}`;
    const r = { ok, worst, slack, ratio, tight, tail };
    seen.push({ name, ...r, unit });
    return r;
  }
  function summary() {
    const t = seen.filter((x) => x.tight);
    const bad = seen.filter((x) => !x.ok);
    const list = t.map((x) => `${x.name || '（沒名字）'} 餘裕 ${fmt(x.slack)}${x.unit}（${(x.ratio * 100).toFixed(1)}%）`).join('、');
    return `餘裕：查了 ${seen.length} 條有門檻的斷言，貼近門檻（< ${TIGHT * 100}%）${t.length} 條${t.length ? '：' + list : ''}；沒過 ${bad.length} 條`;
  }
  return { within, summary, count: () => seen.length };
}
