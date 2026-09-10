// 景點的時間：單一來源。
//
// 之前有兩套並存：匯入行程表寫的是 `startMin` / `stayMin`（數字），
// 景點設定頁寫的是 `startTime` / `endTime`（"09:00" 字串），而海報與回顧只讀後者
// —— 也就是說**匯入進來的時間在海報與回顧上完全看不到**。
//
// 現在以 `startMin` / `stayMin` 為準，舊資料的字串當 fallback，
// 所有要顯示時間的地方都走這裡。

export const STAYS = [
  { v: '', label: '不設定' }, { v: '30', label: '30 分' }, { v: '60', label: '1 小時' },
  { v: '90', label: '1.5 小時' }, { v: '120', label: '2 小時' }, { v: '180', label: '3 小時' },
  { v: '240', label: '4 小時' },
];

// 下拉的欄位很窄，「2 小時 30 分」會被截掉 —— 用短寫法
export const shortStay = (m) => (m < 60 ? m + ' 分' : String(+(m / 60).toFixed(1)) + ' 小時');

// 解析出來的時間不見得剛好是選單裡的那幾個（14:00-16:30 就是 150 分）。
// 沒有對應選項時 select 會顯示「不設定」，看起來像被丟掉了 —— 所以把實際值補進去。
// 這支給匯入流程與景點設定頁共用，那個坑不會在兩個地方各踩一次。
export function stayOptions(currentMin) {
  const opts = [...STAYS];
  const cur = String(currentMin || '');
  if (cur && !opts.some((s) => s.v === cur)) {
    opts.push({ v: cur, label: shortStay(Number(cur)) });
    opts.sort((a, b) => (parseInt(a.v, 10) || 0) - (parseInt(b.v, 10) || 0));
  }
  return opts;
}

// 一天的「幾點出發」。時刻鏈需要一個起點：當天沒有任何景點填「幾點到」時，
// chainTimes 的第一站 arrive 是 null，於是整天推不出任何時刻（實測確認）。
// v1.68 先用固定的早上 9 點；v1.69 會接上使用者可設定的 trip.dayStarts。
// 這個值是「假設」，畫面上要講出來，不要讓人以為是他自己設的。
export const DAY_START_DEFAULT = 9 * 60;
export function dayStartOf(trip, day) {
  const v = trip && trip.dayStarts && trip.dayStarts[String(day)];
  return Number.isFinite(v) ? v : DAY_START_DEFAULT;
}

export function fmtHHMM(min) {
  if (!Number.isFinite(min)) return '';
  // 結束時間可能跨過午夜（23:30 停 2 小時）—— 換算成隔天並標示，不出現 25:30
  const d = Math.floor(min / 1440);
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${d >= 1 ? (d === 1 ? '隔天 ' : d + ' 天後 ') : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// <input type="time"> 的值 → 分鐘數
export function minOfInput(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = +m[1] * 60 + +m[2];
  return mins >= 0 && mins < 24 * 60 ? mins : null;
}

// 景點的時間，統一從這裡拿。舊資料只有 startTime/endTime 字串時也讀得出來。
export function spotTimes(s) {
  if (!s) return { startMin: null, stayMin: null, startTime: '', endTime: '', label: '' };
  let startMin = Number.isFinite(s.startMin) ? s.startMin : minOfInput(s.startTime);
  let stayMin = Number.isFinite(s.stayMin) && s.stayMin > 0 ? s.stayMin : null;
  if (stayMin == null && startMin != null) {
    const end = minOfInput(s.endTime);
    if (end != null && end > startMin) stayMin = end - startMin;
  }
  const startTime = fmtHHMM(startMin);
  const endTime = (startMin != null && stayMin) ? fmtHHMM(startMin + stayMin) : '';
  let label = startTime;
  if (startTime && stayMin) {
    const h = Math.floor(stayMin / 60), mi = stayMin % 60;
    label = `${startTime} 停留 ${h ? h + ' 小時' + (mi ? ' ' + mi + ' 分' : '') : mi + ' 分'}`;
  }
  return { startMin, stayMin, startTime, endTime, label };
}
