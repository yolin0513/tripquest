// 用地圖帶路 —— 盡量用「地名」而不是座標組 Google Maps 連結，
// 這樣使用者在 Google Maps 上看到的是看得懂的地名。
// 這些是 Google Maps 的 universal link，手機裝了 App 會直接喚起 App。

// 太通用、搜不到的名稱（自由輸入的無名地點才會出現）
const GENERIC = /^(午餐|晚餐|早餐|宵夜|吃飯|用餐|中餐|下午茶|喝咖啡|休息|住宿|飯店|旅館|民宿|hotel|集合|會合|停車|買東西|購物|逛街|自由活動|回程|出發|返程|未命名|這裡|那裡|待定|待安排|其他|tbd|—|\.{2,})/i;

// 回傳「拿去搜尋的字串」，或 null（代表要退回座標）
export function bestQuery(spot) {
  if (!spot) return null;
  const name = String(spot.name || spot.nameLocal || '').trim();
  const region = String(spot.region || '').trim();
  const district = String(spot.district || '').trim();
  const wiki = spot.wikiRef || {};
  const wikiTitle = wiki.title ? String(wiki.title).trim() : '';

  // 用顯示名（使用者看得懂的中文）；只有當維基標題是「當地語言」名稱時才改用它
  // （例如日本景點的日文名，在 Google Maps 命中率較高）
  let base = name;
  if (wikiTitle.length >= 2 && wiki.lang && wiki.lang !== 'zh' && wiki.lang !== 'zh-tw') base = wikiTitle;
  if (!base && wikiTitle.length >= 2) base = wikiTitle;

  // 名稱不夠明確 → 交給呼叫端退回座標
  const usable = base.length >= 2 && !(spot.source === 'auto' && GENERIC.test(base));
  if (!usable) return null;

  // 加地區 / 行政區前綴幫助搜對地方（名稱裡沒有才加）
  const parts = [base];
  if (region && !base.includes(region)) parts.push(region);
  else if (district && !base.includes(district)) parts.push(district);
  return parts.join(' ');
}

function coord(spot) {
  return (spot && spot.lat != null && spot.lng != null) ? `${spot.lat},${spot.lng}` : null;
}

// 在地圖上「顯示」這個景點
export function mapsSearchUrl(spot) {
  const q = bestQuery(spot);
  const target = q || coord(spot);
  if (!target) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
}

// 「導航到」這個景點
export function mapsDirUrl(spot) {
  const q = bestQuery(spot);
  const target = q || coord(spot);
  if (!target) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}`;
}

// 這個景點的地圖連結是用名稱（true）還是退回座標（false）—— 供文案 / 除錯用
export function isNameBased(spot) {
  return bestQuery(spot) != null;
}
