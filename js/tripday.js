// 今天在這趟旅程的哪個階段（純函式，不碰畫面；行程頁、首頁、測試共用）。
// 日期一律用當地的「日」比，不用時刻：晚上 11 點看，明天出發就是「還有 1 天」。

const dayMS = 86400000;
function localDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const t = new Date(y, m - 1, d);
  // new Date 會把 13 月、2 月 30 日自動進位成別天；對不回原本的年月日就是不存在的日期
  if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null;
  return t;
}
function startOfDay(now) { const t = new Date(now); t.setHours(0, 0, 0, 0); return t; }

// { phase: 'none' | 'before' | 'during' | 'after', daysToGo, day }
//   none   沒設出發日（不猜，畫面什麼都不顯示）
//   before 還沒出發：daysToGo ≥ 1
//   during 進行中：day 是第幾天（出發當天 = 1）
//   after  回程日已過
export function tripPhase(startDate, endDate, now = new Date()) {
  const start = localDay(startDate);
  if (!start) return { phase: 'none', daysToGo: null, day: null };
  const end = localDay(endDate) || start;
  const today = startOfDay(now);
  // Math.round：夏令時間那一天只有 23 或 25 小時
  const diff = Math.round((start - today) / dayMS);
  if (diff > 0) return { phase: 'before', daysToGo: diff, day: null };
  if (today > end) return { phase: 'after', daysToGo: null, day: null };
  return { phase: 'during', daysToGo: null, day: Math.round((today - start) / dayMS) + 1 };
}

// 行程頁預設選中哪一天（v1.74.11 起一次顯示一天）。dayNums：有景點的天（日期列上的那幾格）。
// todayDay 照行程頁的慣例：null 沒設日期、0 還沒出發、-1 已結束、正整數 進行中第幾天。
// 使用者手動指定「現在這一站」時，那一天最優先——他自己講的，比日期推算準。
// 以前「已結束／全部完成」是全部收起來；一次只顯示一天之後，收起來就是一片空白，
// 所以改成第一天（行程從頭看起）。今天那天沒有景點（日期列上沒有那一格）也是第一天。
export function defaultDay({ dayNums, todayDay, focusDay }) {
  if (!dayNums || !dayNums.length) return null;
  if (focusDay && dayNums.includes(focusDay)) return focusDay;
  if (todayDay > 0 && dayNums.includes(todayDay)) return todayDay;
  return dayNums[0];
}

// 第 day 天是星期幾（「週五」）。沒設出發日、日期不存在、天數不對 → ''（不猜）
const WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
export function weekdayLabel(startDate, day) {
  const start = localDay(startDate);
  if (!start || !(day >= 1)) return '';
  const t = new Date(start); t.setDate(t.getDate() + (day - 1));
  return WEEK[t.getDay()];
}

// 當日標題卡的「第一站 → 最後一站」。只用使用者排的景點名，不編一個當日標題。
export function dayRoute(spots) {
  const names = (spots || []).map((s) => String(s?.name || '').trim()).filter(Boolean);
  if (!names.length) return '';
  return names.length === 1 ? names[0] : `${names[0]} → ${names[names.length - 1]}`;
}

// 時間軸的三態：{ 景點 id: 'past' | 'now' | 'next' }。
// 只有 live（進行中、看的是今天）而且「現在這一站」就在這一天才分；否則回 {}——
// 不知道他走到哪就不淡化任何一站，淡錯了會讓人以為那一站不用去了。
export function timelineStates(ids, { live, nowId }) {
  const list = ids || [];
  const i = nowId ? list.indexOf(nowId) : -1;
  if (!live || i < 0) return {};
  const out = {};
  list.forEach((id, k) => { out[id] = k < i ? 'past' : k === i ? 'now' : 'next'; });
  return out;
}

// 出發倒數的字。只有「還沒出發」才有；其餘回 ''（不顯示，也不拿 0 冒充）
export function countdownText(startDate, endDate, now = new Date()) {
  const p = tripPhase(startDate, endDate, now);
  if (p.phase !== 'before') return '';
  return p.daysToGo === 1 ? '明天出發' : `還有 ${p.daysToGo} 天出發`;
}
