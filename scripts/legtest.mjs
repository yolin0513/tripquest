// 交通方式／重要／訂好位三組新欄位（npm run legtest；純 node、不開瀏覽器、不碰網路）
// 投票：docs/VOTE_2026-11-05_同步欄位.md
//   1. merge.js：三組各自 LWW，跟既有組（slot、name…）互不吃掉；任何順序合併都收斂
//   2. 顯示規則（js/legs.js，經 dayMapModel 的每一段——地圖畫段的那條真實路徑）：
//      只有「現在的前一站＝選的時候記下的那一站」才顯示所選方式；重排、夾了沒位置的站、
//      第一站、認不得的代號 → 不顯示（三票都點名：把舊選擇套到沒人選過的一段是最大的錯法）
import { mergeRecord, seedF, TRACKED, stable } from '../js/merge.js';
import { legModeOf, LEG_MODES } from '../js/legs.js';
import { dayMapModel } from '../js/daymap.js';

let pass = 0;
const yes = (c, m, x = '') => { if (c) { pass++; console.log('✓ ' + m); } else { console.log('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; } };
const J = (x) => JSON.stringify(x);

// ---------- 1. merge.js ----------
yes(J(TRACKED.spot.leg) === J(['legFrom', 'legMode']) && J(TRACKED.spot.important) === J(['important']) && J(TRACKED.spot.booked) === J(['booked']),
  '三組欄位登記在 TRACKED.spot（leg＝legFrom＋legMode 同一組）', J(TRACKED.spot));

const base = { id: 'b', type: 'spot', name: '某站', day: 1, order: 1, updatedAt: 1000, deviceId: 'a', _f: seedF({ type: 'spot' }, 1000) };
{
  // A 把這站往前移（slot，t=2000）；B 同時選了交通方式（leg，t=3000）
  const A = { ...base, order: 0, updatedAt: 2000, deviceId: 'a', _f: { ...base._f, slot: 2000 } };
  const B = { ...base, legFrom: 'x', legMode: 'train', updatedAt: 3000, deviceId: 'b', _f: { ...base._f, leg: 3000 } };
  const m1 = mergeRecord(A, B).rec, m2 = mergeRecord(B, A).rec;
  yes(m1.order === 0 && m1.legMode === 'train' && m1.legFrom === 'x', '移站（slot）與選交通方式（leg）同時發生：兩邊都保留', J(m1));
  yes(stable(m1) === stable(m2), '合併順序無關（leg 與 slot）');
  // 較晚的 A 只改了名字：不能把 B 選的交通方式吃掉（leg 不跟著整筆勝方走）
  const A2 = { ...base, name: '改名', updatedAt: 4000, deviceId: 'a', _f: { ...base._f, name: 4000 } };
  const m3 = mergeRecord(B, A2).rec;
  yes(m3.name === '改名' && m3.legMode === 'train' && m3.legFrom === 'x', '較晚的改名不吃掉較早選的交通方式（leg 自成一組）', J(m3));
  // leg 是一組：較晚者整組勝，不會出現「A 的 legFrom 配 B 的 legMode」
  const C = { ...base, legFrom: 'y', legMode: 'bus', updatedAt: 5000, deviceId: 'c', _f: { ...base._f, leg: 5000 } };
  const m4 = mergeRecord(B, C).rec, m5 = mergeRecord(C, B).rec;
  yes(m4.legFrom === 'y' && m4.legMode === 'bus' && stable(m4) === stable(m5), 'leg 整組合併：較晚者的 legFrom＋legMode 一起勝', J(m4));
}
{
  // 重要、訂好位：各自一組，互不影響
  const I = { ...base, important: true, updatedAt: 2000, deviceId: 'a', _f: { ...base._f, important: 2000 } };
  const K = { ...base, booked: true, updatedAt: 3000, deviceId: 'b', _f: { ...base._f, booked: 3000 } };
  const m = mergeRecord(I, K).rec;
  yes(m.important === true && m.booked === true && stable(m) === stable(mergeRecord(K, I).rec), '「重要」與「訂好位」兩台各標一個：兩個都保留、順序無關', J(m));
  const Off = { ...I, important: false, updatedAt: 4000, deviceId: 'c', _f: { ...I._f, important: 4000 } };
  yes(mergeRecord(I, Off).rec.important === false && mergeRecord(Off, I).rec.important === false, '較晚取消「重要」→ 取消勝（不會因為另一邊是 true 就復活）');
}
{
  // 舊版寫的記錄（_f 非空、沒有這三組）對上新版選的交通方式：新版的選擇不會被舊記錄的「沒有」蓋掉
  const old = { ...base, name: '舊手機改名', updatedAt: 9000, deviceId: 'old', _f: { name: 9000, slot: 1000, time: 1000, pinned: 1000, pos: 1000 } };
  const neu = { ...base, legFrom: 'x', legMode: 'walk', updatedAt: 3000, deviceId: 'new', _f: { ...base._f, leg: 3000 } };
  const m = mergeRecord(old, neu).rec;
  yes(m.name === '舊手機改名' && m.legMode === 'walk', '舊版較晚的整筆（沒有 leg 組）不會把新版選的交通方式清掉', J(m));
}

// ---------- 2. 顯示規則：經 dayMapModel（地圖畫段用的就是它） ----------
const S = (id, lat, extra = {}) => ({ id, name: id, lat, lng: 135.5, ...extra });
const modes = (spots) => dayMapModel(spots).segs.map((s) => `${s.from}→${s.to}:${s.mode || '-'}`).join(' ');
{
  // 使用者在「a → b」這段選了電車（存在 b、記下前一站 a）
  const a = S('a', 34.60), b = S('b', 34.65, { legFrom: 'a', legMode: 'train' }), c = S('c', 34.70);
  const before = modes([a, b, c]);
  yes(before === '1→2:train 2→3:-', `前置：選了的那段顯示所選方式（${before}）`);
  // 重排成 c, b, a：b 的前一站變成 c——沒人在「c → b」選過任何方式
  const after = modes([c, b, a]);
  yes(after === '1→2:- 2→3:-', `重排之後，所選方式不會掛到沒人選過的一段（${after}）`);
  // 前一站被刪
  const del = modes([b, c]);
  yes(del === '1→2:-', `前一站被刪、b 變成第一站：不顯示（${del}）`);
  // 中間插進一個沒位置的站：a 不再是 b 的前一站
  const gap = modes([a, { id: 'g', name: 'g' }, b, c]);
  yes(gap === '1→3:- 3→4:-', `中間夾了沒位置的站：那段不顯示（${gap}）`);
  // 認不得的代號（未來版本新增的）：不顯示任何字
  const unk = modes([a, S('b', 34.65, { legFrom: 'a', legMode: 'hovercraft' }), c]);
  yes(unk === '1→2:- 2→3:-', `認不得的代號不顯示（${unk}）`);
  yes(legModeOf(null, b) === null, '每天第一站沒有進站段');
  yes(LEG_MODES.every((k) => legModeOf({ id: 'a' }, { legFrom: 'a', legMode: k }) === k), `七個代號都認得（${LEG_MODES.join('／')}）`);
}

console.log(`\n交通方式等三組欄位：${pass} 項通過${process.exitCode ? '，有失敗' : ''}`);
