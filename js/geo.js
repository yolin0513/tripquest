// 定位 + 反向地理編碼。最後已知位置會快取，離線也能顯示。

const LAST = 'tripquest.lastloc';
const RGEO = 'tripquest.rgeo';

export function lastKnown() {
  try { return JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { return null; }
}
function saveLast(loc) {
  try { localStorage.setItem(LAST, JSON.stringify(loc)); } catch { /* noop */ }
}

// 取得目前位置。maxAgeMs 內的快取可接受；拿不到新的就回快取（帶 stale 標記）。
export function currentPosition({ timeout = 9000, maxAgeMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const cached = lastKnown();
    if (cached && Date.now() - cached.at < maxAgeMs) { resolve({ ...cached, stale: false }); return; }
    if (!navigator.geolocation) { resolve(cached ? { ...cached, stale: true } : null); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy || 0), at: Date.now() };
        saveLast(loc);
        finish({ ...loc, stale: false });
      },
      () => finish(cached ? { ...cached, stale: true } : null),
      { enableHighAccuracy: true, timeout, maximumAge: maxAgeMs },
    );
    setTimeout(() => finish(cached ? { ...cached, stale: true } : null), timeout + 500);
  });
}

// Nominatim 反向地理編碼（免金鑰，需 User-Agent，約 1 req/s）。結果快取。
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  try {
    const cache = JSON.parse(localStorage.getItem(RGEO) || '{}');
    if (cache[key] && Date.now() - cache[key].at < 7 * 86400000) return cache[key].v;
  } catch { /* noop */ }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&accept-language=zh-TW`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    const a = d.address || {};
    const v = {
      display: d.display_name || '',
      short: [a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village || a.county, a.state]
        .filter(Boolean).slice(0, 2).join('、'),
      country: (a.country_code || '').toUpperCase(),
      countryName: a.country || '',
    };
    try {
      const cache = JSON.parse(localStorage.getItem(RGEO) || '{}');
      cache[key] = { v, at: Date.now() };
      localStorage.setItem(RGEO, JSON.stringify(cache));
    } catch { /* noop */ }
    return v;
  } catch { return null; }
}

export function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function fmtDist(m) {
  if (m == null) return '';
  return m < 950 ? `${Math.round(m / 10) * 10} 公尺` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} 公里`;
}

// 導航連結（交給系統地圖 App；Google Maps 通用連結，iOS/Android 都會攔截）
export function navUrl(lat, lng, label) {
  const dest = label ? `${encodeURIComponent(label)}` : `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place=${dest}`;
}
// 只顯示某個點
export function mapUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
