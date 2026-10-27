// 今天在旅程的哪個階段＋出發倒數的字（npm run tripdaytest；秒級、不開瀏覽器）
//
// 涵蓋的程式：js/tripday.js
//
// 情境一律自己造（固定的「現在」傳進去），不靠今天剛好是哪一天（共用慣例 §5.8）。
// 畫面上的入口（行程頁、首頁卡片）由 itinviewtest 驗。
import * as TD from '../js/tripday.js';
const { tripPhase, countdownText, defaultDay } = TD;
// 還沒寫好的函式先當成「永遠回錯的答案」，讓那幾條紅、而不是整支崩潰（崩潰的 1 和斷言失敗的 1 分不開）
const weekdayLabel = TD.weekdayLabel || (() => '（沒有這個函式）');
const dayRoute = TD.dayRoute || (() => '（沒有這個函式）');
const timelineStates = TD.timelineStates || (() => ({ missing: true }));

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const at = (y, m, d, hh = 10, mm = 0) => new Date(y, m - 1, d, hh, mm);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T1 = tripPhase('', '', at(2030, 5, 1));
yes(same(T1, { phase: 'none', daysToGo: null, day: null }), `T1 沒設出發日 → none（${JSON.stringify(T1)}）`);
yes(countdownText('', '', at(2030, 5, 1)) === '', 'T1 沒設出發日 → 倒數不顯示（空字串，不是「還有 0 天」）');
yes(tripPhase('亂打', '', at(2030, 5, 1)).phase === 'none', 'T1 出發日不是日期（亂打）→ none');
// new Date(2030, 12, 40) 會自動進位成 2031 年 2 月——不擋的話，打錯的日期會變成一個錯的倒數
yes(tripPhase('2030-13-40', '', at(2030, 5, 1)).phase === 'none', 'T1 出發日是不存在的日期（13 月 40 日）→ none，不進位成別天');
yes(tripPhase('2030-02-30', '', at(2030, 1, 1)).phase === 'none', 'T1 出發日是 2 月 30 日 → none');

const T2 = tripPhase('2030-05-10', '2030-05-12', at(2030, 5, 5));
yes(same(T2, { phase: 'before', daysToGo: 5, day: null }), `T2 還有 5 天 → before／5（${JSON.stringify(T2)}）`);
yes(countdownText('2030-05-10', '2030-05-12', at(2030, 5, 5)) === '還有 5 天出發', 'T2 字：「還有 5 天出發」');

// 晚上 11:30 看，明天出發：照「日」算是 1 天，不是 0.02 天也不是 0
yes(tripPhase('2030-05-10', '2030-05-12', at(2030, 5, 9, 23, 30)).daysToGo === 1, 'T3 前一天 23:30 → 還有 1 天');
yes(countdownText('2030-05-10', '2030-05-12', at(2030, 5, 9, 23, 30)) === '明天出發', 'T3 字：「明天出發」');
// 清晨 0:05 看，今天出發
const T4 = tripPhase('2030-05-10', '2030-05-12', at(2030, 5, 10, 0, 5));
yes(same(T4, { phase: 'during', daysToGo: null, day: 1 }), `T4 出發當天 0:05 → during 第 1 天（${JSON.stringify(T4)}）`);
yes(countdownText('2030-05-10', '2030-05-12', at(2030, 5, 10, 0, 5)) === '', 'T4 出發當天 → 倒數不顯示');

yes(tripPhase('2030-05-10', '2030-05-12', at(2030, 5, 12, 22)).day === 3, 'T5 回程當天 → 第 3 天（還在 during）');
yes(tripPhase('2030-05-10', '2030-05-12', at(2030, 5, 13, 0, 1)).phase === 'after', 'T5 回程隔天 0:01 → after');
yes(countdownText('2030-05-10', '2030-05-12', at(2030, 5, 13)) === '', 'T5 已結束 → 倒數不顯示');

// 沒填回程日 → 當成單日行程
yes(tripPhase('2030-05-10', '', at(2030, 5, 10)).day === 1 && tripPhase('2030-05-10', '', at(2030, 5, 11)).phase === 'after',
  'T6 沒填回程日 → 單日：當天第 1 天、隔天 after');

// 跨月、跨年的天數
yes(tripPhase('2031-01-02', '', at(2030, 12, 30)).daysToGo === 3, 'T7 跨年：12/30 → 1/2 還有 3 天');
yes(tripPhase('2030-03-01', '2030-03-05', at(2030, 2, 27)).daysToGo === 2, 'T7 跨月（2 月 28 天）：2/27 → 3/1 還有 2 天');

// ---- 行程頁預設選中哪一天（日期列；todayDay：null 沒設日期、0 還沒出發、-1 已結束、正整數 第幾天）----
const D = [1, 2, 3, 4];
yes(defaultDay({ dayNums: D, todayDay: 2, focusDay: 3 }) === 3, 'D1 現在這一站在第 3 天 → 選第 3 天（比今天優先）');
yes(defaultDay({ dayNums: D, todayDay: 2, focusDay: null }) === 2, 'D2 進行中第 2 天、沒有現在這一站 → 選第 2 天');
yes(defaultDay({ dayNums: D, todayDay: 0, focusDay: null }) === 1, 'D3 還沒出發 → 第 1 天');
yes(defaultDay({ dayNums: D, todayDay: -1, focusDay: null }) === 1, 'D4 已結束 → 第 1 天（不是全部收起來的空白）');
yes(defaultDay({ dayNums: D, todayDay: null, focusDay: null }) === 1, 'D5 沒設日期 → 第 1 天');
// 今天（第 3 天）沒有景點：日期列上沒有那一格，不能選一個不存在的格子
yes(defaultDay({ dayNums: [1, 2, 4], todayDay: 3, focusDay: null }) === 1, 'D6 今天那天沒有景點 → 第 1 天，不選不存在的格子');
yes(defaultDay({ dayNums: [1, 2], todayDay: 2, focusDay: 5 }) === 2, 'D7 現在這一站的天不在日期列上 → 照今天');
yes(defaultDay({ dayNums: [], todayDay: 2, focusDay: null }) === null, 'D8 沒有任何一天 → null（不回 undefined 冒充一天）');

// ---- 日期列與當日標題卡的「週幾」：只在有出發日時寫，算不出來就空白（不猜）----
yes(weekdayLabel('2030-05-10', 1) === '週五', `W1 2030-05-10 第 1 天 → 週五（實得 ${weekdayLabel('2030-05-10', 1)}）`);
yes(weekdayLabel('2030-05-30', 3) === '週六', `W2 跨月：5/30 出發的第 3 天是 6/1 → 週六（實得 ${weekdayLabel('2030-05-30', 3)}）`);
yes(weekdayLabel('', 2) === '', 'W3 沒設出發日 → 空字串');
yes(weekdayLabel('2030-02-30', 1) === '', 'W4 不存在的出發日 → 空字串，不進位成 3 月的星期幾');
yes(weekdayLabel('2030-05-10', 0) === '' && weekdayLabel('2030-05-10', null) === '', 'W5 第 0 天、沒有天數 → 空字串');

// ---- 當日標題卡的「第一站 → 最後一站」：只用使用者排的景點名，不編標題 ----
yes(dayRoute([{ name: '甲' }, { name: '乙' }, { name: '丙' }]) === '甲 → 丙', `R1 三站 → 「甲 → 丙」（實得 ${dayRoute([{ name: '甲' }, { name: '乙' }, { name: '丙' }])}）`);
yes(dayRoute([{ name: '甲' }]) === '甲', 'R2 一站 → 只寫「甲」，不寫「甲 → 甲」');
yes(dayRoute([{ name: '  ' }, { name: '乙' }, { name: '' }]) === '乙', 'R3 沒名字的站跳過 → 「乙」');
yes(dayRoute([]) === '' && dayRoute(null) === '', 'R4 沒有景點 → 空字串');

// ---- 時間軸三態：只有「進行中、看的是今天、今天有現在這一站」才分已到／現在／未到 ----
const L = ['a', 'b', 'c', 'd'];
yes(same(timelineStates(L, { live: true, nowId: 'b' }), { a: 'past', b: 'now', c: 'next', d: 'next' }),
  `S1 今天、現在這一站是 b → a 已到、b 現在、c d 未到（${JSON.stringify(timelineStates(L, { live: true, nowId: 'b' }))}）`);
yes(same(timelineStates(L, { live: false, nowId: 'b' }), {}), 'S2 不是今天（或還沒出發、已結束）→ 不分三態（空的，什麼都不淡化）');
yes(same(timelineStates(L, { live: true, nowId: 'x' }), {}), 'S3 現在這一站不在這一天 → 不分三態（不猜他走到哪）');
yes(same(timelineStates(L, { live: true, nowId: null }), {}), 'S4 沒有現在這一站 → 不分三態');
yes(same(timelineStates(L, { live: true, nowId: 'a' }), { a: 'now', b: 'next', c: 'next', d: 'next' }), 'S5 現在是第一站 → 沒有已到、後面全是未到');

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
