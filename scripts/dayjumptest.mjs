// 改完景點回行程頁停在那一天的記號：只用一次、10 分鐘過期（npm run dayjumptest；秒級、不開瀏覽器）
//
// 涵蓋的程式：js/tripday.js 的 markDayJump／takeDayJump
//
// 這兩個性質壞掉時表面行為完全正常（回行程頁照樣停在那一天），只有「之後每次打開都被拉回那天」
// 「隔天打開也不是今天」才看得出來——plantest 走的是存檔後馬上回去，碰不到這兩條路。
// 從真實入口（景點設定頁存檔 → 行程頁）進去的那一條由 plantest 守；這裡用假的 storage、固定的「現在」自己造情境（§5.8）。
import { markDayJump, takeDayJump, DAY_JUMP_MS } from '../js/tripday.js';

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const fake = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const T0 = Date.UTC(2030, 4, 1, 2, 0);
const DAYS = [1, 2, 3];

// J1 基本：存了第 2 天，馬上回去 → 2
{
  const s = fake();
  markDayJump(s, 'trip-a', 2, T0);
  yes(s.m.size === 1, `J1 前置：存了一筆記號（storage 有 ${s.m.size} 筆）`);
  const d = takeDayJump(s, 'trip-a', DAYS, T0 + 1000);
  yes(d === 2, `J1 存檔後 1 秒回行程頁 → 第 2 天（實得 ${d}）`);
}

// J2 只用一次：第一次拿到 2，第二次（他之後再打開）要拿不到
{
  const s = fake();
  markDayJump(s, 'trip-a', 2, T0);
  const first = takeDayJump(s, 'trip-a', DAYS, T0 + 1000);
  yes(first === 2, `J2 前置：第一次拿到第 2 天（實得 ${first}）`);
  const second = takeDayJump(s, 'trip-a', DAYS, T0 + 2000);
  yes(second === null, `J2 只用一次：第二次打開行程頁拿不到記號（實得 ${second}）`);
}

// J3 過期：10 分鐘以後才回去 → 不用（照常回今天）；差 1 毫秒還在期限內 → 用
{
  const s = fake();
  markDayJump(s, 'trip-a', 3, T0);
  const late = takeDayJump(s, 'trip-a', DAYS, T0 + DAY_JUMP_MS);
  yes(late === null, `J3 過期：存檔 10 分鐘後才回行程頁 → 不用記號（實得 ${late}）`);
  const s2 = fake();
  markDayJump(s2, 'trip-a', 3, T0);
  const edge = takeDayJump(s2, 'trip-a', DAYS, T0 + DAY_JUMP_MS - 1);
  yes(edge === 3, `J3 反向：差 1 毫秒到 10 分鐘 → 照用（實得 ${edge}）`);
  yes(DAY_JUMP_MS === 10 * 60 * 1000, `J3 期限是 10 分鐘（實得 ${DAY_JUMP_MS} 毫秒）`);
  // 手機時間被往回調：記號的時間在「現在」之後，算出來的經過時間是負的，永遠不會過期
  const s3 = fake();
  markDayJump(s3, 'trip-a', 3, T0 + 3600000);
  const back = takeDayJump(s3, 'trip-a', DAYS, T0);
  yes(back === null, `J3 時間倒退：記號比現在晚 1 小時 → 不用（不然永遠不過期）（實得 ${back}）`);
  // 沒有時間欄位的記號（舊格式或被改過）：算不出經過多久，不能當成沒過期
  const s4 = fake();
  s4.setItem('tripquest.dayJump.trip-a', JSON.stringify({ day: 2 }));
  const noAt = takeDayJump(s4, 'trip-a', DAYS, T0);
  yes(noAt === null, `J3 記號沒有時間 → 不用（算不出過期沒，不當成沒過期）（實得 ${noAt}）`);
}

// J4 別的行程、讀不懂、那天已經不在行程裡 → null
{
  const s = fake();
  markDayJump(s, 'trip-a', 2, T0);
  yes(takeDayJump(s, 'trip-b', DAYS, T0 + 1000) === null, 'J4 別的行程拿不到這一趟的記號');
  yes(takeDayJump(s, 'trip-a', [1, 3], T0 + 1000) === null, 'J4 那一天已經不在行程裡 → null（不選一個不存在的天）');
  const s2 = fake();
  s2.setItem('tripquest.dayJump.trip-a', '{壞掉');
  yes(takeDayJump(s2, 'trip-a', DAYS, T0) === null, 'J4 讀不懂 → null');
  yes(s2.m.size === 0, 'J4 讀不懂的記號也被清掉（不會每次都讀到同一筆壞的）');
}

console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : ''));
