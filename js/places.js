// Google Places（v1.70）—— 只用在「找附近 → 停車場」的「再查一次」，使用者自帶金鑰。
//
// **OSM 仍然是預設**，這一支是選配的第二意見。三個理由：
//  1. **Places 的內容不准長期儲存**（除了 place_id）。現在的一天快取必須拿掉，也就是說
//     開車到訊號不好的地方就查不到 —— 對「找附近」是明確的退步。OSM 留著就保住離線。
//  2. 沒有金鑰的人不能因此變得更差（免費路徑不能退化）。
//  3. 鄉下的 OSM 常常比 Google 全（Google 收的是營業場所，路邊的公有停車格不一定在）。
//
// 所以做成雙軌：平常 OSM，資料看起來不對時按一下用 Google 再查。
//
// 計費：FieldMask 決定等級。這裡刻意**只要 Essentials/Pro 欄位** ——
// `rating` 與 `userRatingCount` 會把整個請求升到 Enterprise 級（貴很多），不要。

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

// 逾時：不設的話 Google 掛住就會讓按鈕永遠停在「查詢中…」（跟 Overpass 同一套寫法）
const _to = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

const FIELDS = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.businessStatus',
  'places.shortFormattedAddress',
].join(',');

// Places 的資料不進 localStorage、不進 IndexedDB —— 條款不准。只活在這一次的畫面上。
// 這是刻意的：寫進去很方便，但那會違反使用者自己金鑰的使用條款。
export async function nearbyParkingGoogle(lat, lng, key, { radius = 1500, signal } = {}) {
  const ep = (typeof window !== 'undefined' && window.__TQ_PLACES_ENDPOINT) || ENDPOINT;
  let res;
  try {
    res = await fetch(ep, {
      method: 'POST', signal: signal || _to(12000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({
        includedTypes: ['parking'],
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        languageCode: 'zh-TW',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
    });
  } catch (e) { return { ok: false, reason: (e && e.name === 'TimeoutError') ? 'timeout' : 'network' }; }
  if (res.status === 403) return { ok: false, reason: 'key' };
  if (res.status === 429) return { ok: false, reason: 'quota' };
  if (res.status === 400) return { ok: false, reason: 'bad' };
  if (!res.ok) return { ok: false, reason: 'http' + res.status };
  let j;
  try { j = await res.json(); } catch { return { ok: false, reason: 'parse' }; }
  const out = [];
  for (const p of j.places || []) {
    const loc = p.location || {};
    if (loc.latitude == null) continue;
    // businessStatus 是 Google 比 OSM 強的地方之一：歇業的場地直接不列
    // （OSM 那邊沒有等價欄位，只能靠有沒有人回來改）
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
    out.push({
      id: 'g' + (p.id || out.length),
      kind: 'parking',
      src: 'google',
      name: (p.displayName && p.displayName.text) || '停車場',
      lat: loc.latitude, lng: loc.longitude,
      addr: p.shortFormattedAddress || '',
    });
  }
  return { ok: true, results: out };
}

export function placesErr(reason) {
  return ({
    key: '金鑰被拒 —— 請到旅程設定確認已啟用 Places API (New)、參照網址限制允許這個網站',
    quota: 'Google 說太頻繁了，等一下再試',
    network: '連不上 Google（可能沒有網路）',
    timeout: 'Google 太久沒回應（12 秒），等一下再試',
    bad: '請求被拒 —— 請確認已啟用 Places API (New)',
  })[reason] || 'Google 查詢失敗（' + reason + '）';
}
