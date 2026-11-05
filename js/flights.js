// 航班卡（2026-11-05 投票：docs/VOTE_2026-11-05_航班待買住宿.md；Yolin 同日四題都 OK）。
//
// 型別 `flight`，一段航程一筆，掛 tripId。進 merge.js 的 TRACKED（2:1）：no／dep／arr／note 四組；
// 日期、時間、地點同一組（不合出「A 的日期配 B 的時間」）。
//
// 規矩（三票一致）：
//   · 時間存的是**機票上印的當地時間**（起飛地、抵達地各自的），**不存時區、不換算**。
//   · 倒數**只到「天」**（Yolin 同意）：拿這支手機今天的日期比起飛日。幾小時幾分要知道起飛地時區，只能猜——不做。
//   · 抵達日由使用者自己填，不從起飛日推（跨午夜、跨換日線都可能）。
//   · 不從班號推航空公司或時刻；不算飛行時長；不拿航班日期去改行程日期。
//   · 分享代碼不帶（Yolin 同意）；完整備份照 tripId 自動帶、保留 id。

import * as store from './store.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const normDate = (v) => (typeof v === 'string' && ISO.test(v) && !Number.isNaN(new Date(v + 'T00:00:00').getTime()) ? v : null);
export const normTime = (v) => (typeof v === 'string' && HM.test(v) ? v : null);
const dayNum = (iso) => Math.round(new Date(iso + 'T00:00:00').getTime() / 86400000);
const todayIso = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function flightsOf(tripId) {
  return store.exportRecords()
    .filter((r) => r.type === 'flight' && r.tripId === tripId && !r.deleted)
    .sort((a, b) => (a.depDate ? 0 : 1) - (b.depDate ? 0 : 1)
      || String(a.depDate || '').localeCompare(String(b.depDate || ''))
      || String(a.depTime || '').localeCompare(String(b.depTime || ''))
      || ((a.createdAt || 0) - (b.createdAt || 0))
      || String(a.id).localeCompare(String(b.id)));
}

// 以「天」計的倒數。沒有起飛日 → ''（不顯示）；日期已過 → ''（不寫「已起飛」——那是猜他有沒有搭上）。
export function flightCountdown(f, now = new Date()) {
  const d = normDate(f && f.depDate);
  if (!d) return '';
  const n = dayNum(d) - dayNum(todayIso(now));
  if (n < 0) return '';
  if (n === 0) return '今天起飛';
  if (n === 1) return '明天起飛';
  return `還有 ${n} 天起飛`;
}

// 下一班（今天或之後、日期最早的）——行程頁入口用
export function nextFlight(tripId, now = new Date()) {
  return flightsOf(tripId).find((f) => flightCountdown(f, now)) || null;
}

export function checkFlight(v) {
  if (!String(v.flightNo || '').trim() && !normDate(v.depDate)) return '至少填班號或起飛日期';
  if (v.depTime && !normTime(v.depTime)) return '起飛時間看不懂，用 08:30 這種寫法';
  if (v.arrTime && !normTime(v.arrTime)) return '抵達時間看不懂，用 08:30 這種寫法';
  return '';
}

export async function saveFlight(tripId, v, existing = null) {
  const rec = {
    flightNo: String(v.flightNo || '').trim(),
    depDate: normDate(v.depDate), depTime: normTime(v.depTime), depPlace: String(v.depPlace || '').trim(),
    arrDate: normDate(v.arrDate), arrTime: normTime(v.arrTime), arrPlace: String(v.arrPlace || '').trim(),
    note: String(v.note || '').trim(),
  };
  if (existing) return store.patch(existing.id, rec);
  return store.put({ type: 'flight', tripId, ...rec });
}

export async function removeFlight(id) { return store.remove(id); }
