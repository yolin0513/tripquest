// 天氣預報與提醒 —— Open-Meteo（免金鑰、免註冊、支援 CORS）。
// 重點不是「幾度」，是「跟出發地差多少、要帶什麼」。

const FC = 'tripquest.wx';
const HOME = 'tripquest.home';

const CODE = {
  0: ['☀️', '晴'], 1: ['🌤️', '大致晴'], 2: ['⛅', '多雲'], 3: ['☁️', '陰'],
  45: ['🌫️', '霧'], 48: ['🌫️', '霧淞'],
  51: ['🌦️', '毛毛雨'], 53: ['🌦️', '小雨'], 55: ['🌧️', '雨'],
  56: ['🌧️', '凍雨'], 57: ['🌧️', '凍雨'],
  61: ['🌦️', '小雨'], 63: ['🌧️', '雨'], 65: ['🌧️', '大雨'],
  66: ['🌧️', '凍雨'], 67: ['🌧️', '凍雨'],
  71: ['🌨️', '小雪'], 73: ['🌨️', '雪'], 75: ['❄️', '大雪'], 77: ['🌨️', '霰'],
  80: ['🌦️', '陣雨'], 81: ['🌧️', '陣雨'], 82: ['⛈️', '強陣雨'],
  85: ['🌨️', '陣雪'], 86: ['❄️', '強陣雪'],
  95: ['⛈️', '雷雨'], 96: ['⛈️', '雷雨冰雹'], 99: ['⛈️', '強雷雨冰雹'],
};
// 逾時：查不到就走「重試」畫面，不能讓轉圈永遠轉（健檢修）
const _to = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

export function wxIcon(code) { return (CODE[code] || ['🌡️', ''])[0]; }
export function wxText(code) { return (CODE[code] || ['', '—'])[1]; }

function readCache(key) {
  try {
    const all = JSON.parse(localStorage.getItem(FC) || '{}');
    return all[key] || null;
  } catch { return null; }
}
function writeCache(key, data) {
  try {
    const all = JSON.parse(localStorage.getItem(FC) || '{}');
    all[key] = { at: Date.now(), data };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 8);
    const t = {}; for (const k of keys) t[k] = all[k];
    localStorage.setItem(FC, JSON.stringify(t));
  } catch { /* noop */ }
}

// 目的地多日預報。回傳 { elevation, tz, days:[{date,tmax,tmin,rainMm,rainProb,snowCm,code,windMax}], current, stale }
export async function forecast(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = readCache(key);
  if (cached && Date.now() - cached.at < 3 * 3600000) return { ...cached.data, stale: false };

  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', lat);
  u.searchParams.set('longitude', lng);
  u.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max');
  u.searchParams.set('current', 'temperature_2m,weather_code');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('forecast_days', '16');
  try {
    const res = await fetch(u, { signal: _to(12000) });
    if (!res.ok) throw new Error('http ' + res.status);
    const d = await res.json();
    const dl = d.daily || {};
    const days = (dl.time || []).map((date, i) => ({
      date,
      code: dl.weather_code?.[i] ?? 0,
      tmax: Math.round(dl.temperature_2m_max?.[i] ?? 0),
      tmin: Math.round(dl.temperature_2m_min?.[i] ?? 0),
      rainMm: +(dl.precipitation_sum?.[i] ?? 0),
      rainProb: dl.precipitation_probability_max?.[i] ?? 0,
      snowCm: +(dl.snowfall_sum?.[i] ?? 0),
      windMax: Math.round(dl.wind_speed_10m_max?.[i] ?? 0),
    }));
    const out = {
      elevation: Math.round(d.elevation ?? 0),
      tz: d.timezone || '',
      current: d.current ? { temp: Math.round(d.current.temperature_2m), code: d.current.weather_code } : null,
      days,
    };
    writeCache(key, out);
    return { ...out, stale: false };
  } catch {
    if (cached) return { ...cached.data, stale: true };
    return null;
  }
}

// 居住地（天氣比較基準）
export function getHome() {
  try { return JSON.parse(localStorage.getItem(HOME) || 'null'); } catch { return null; }
}
export function setHome(loc) {
  try { localStorage.setItem(HOME, JSON.stringify(loc)); } catch { /* noop */ }
}

// 哪一天算「會下雪」「會下雨」：出門提醒、行程頁天氣條的吉祥物探頭（2026-11-13 第四段）共用這一條，兩邊不會各說各話。
// 下雪優先：會下雪的那天不再算下雨。
const SNOW_CODES = [71, 73, 75, 77, 85, 86];
export function isSnowDay(d) { return d.snowCm > 0.2 || SNOW_CODES.includes(d.code); }
export function isRainDay(d) { return (d.rainProb >= 55 || d.rainMm >= 4) && !isSnowDay(d); }

// 行程頁天氣條上「那一天」的提示：旅程中看今天；還沒出發看出發那天。其餘情況（例：出發日在預報範圍外）不提示。
// days：tripForecastDays 的結果（帶 _tripDay）；today：手機的日期 'YYYY-MM-DD'。
// 回傳 { kind: 'rain'｜'snow', day, text } 或 null。句子裡的數字都是預報給的，不補、不猜。
export function dayAlert(trip, days, today) {
  if (!days || !days.length) return null;
  let d = days.find((x) => x.date === today), label = '今天';
  if (!d && trip && trip.startDate && trip.startDate > today && days[0].date === trip.startDate) {
    d = days[0];
    const p = d.date.split('-');
    label = `出發那天（${+p[1]}/${+p[2]}）`;
  }
  if (!d) return null;
  if (isSnowDay(d)) {
    return { kind: 'snow', day: d, text: `${label}可能下雪${d.snowCm > 0.2 ? `（預估積雪 ${d.snowCm} 公分）` : ''}，穿防滑的鞋，路面可能結冰。` };
  }
  if (isRainDay(d)) {
    const why = d.rainProb >= 55 ? `降雨機率 ${d.rainProb}%` : `預估雨量 ${d.rainMm} 毫米`;
    return { kind: 'rain', day: d, text: `${label}可能下雨（${why}），記得帶傘。` };
  }
  return null;
}

// 產生「要帶什麼」的提醒。destDays 取行程日期範圍內（或前 5 天）。
export function buildAdvice({ dest, destDays, hereTemp, hereName }) {
  const tips = [];
  if (!destDays || !destDays.length) return tips;

  const lo = Math.min(...destDays.map((d) => d.tmin));
  const hi = Math.max(...destDays.map((d) => d.tmax));

  // 與出發地溫差
  if (hereTemp != null) {
    const dayHi = Math.round(destDays.reduce((s, d) => s + d.tmax, 0) / destDays.length);
    const diff = Math.round(hereTemp - lo);
    if (diff >= 8) {
      tips.push({ level: 'cold', text: `目的地最低約 ${lo} 度，比${hereName || '出發地'}的 ${hereTemp} 度低 ${diff} 度，白天大概 ${dayHi} 度，記得帶厚外套。` });
    } else if (hereTemp - hi >= 8) {
      tips.push({ level: 'hot', text: `目的地白天可到 ${hi} 度，比${hereName || '出發地'}熱不少，帶短袖、防曬、多喝水。` });
    }
  }

  // 絕對低溫
  if (lo <= 3) tips.push({ level: 'cold', text: `會冷到 ${lo} 度左右，帽子、手套、圍巾都帶上，洋蔥式穿搭。` });
  else if (lo <= 10 && !tips.some((t) => t.level === 'cold')) tips.push({ level: 'cool', text: `早晚只有 ${lo} 度上下，帶一件保暖外套。` });

  // 雪
  const snowDays = destDays.filter(isSnowDay);
  if (snowDays.length) {
    tips.push({ level: 'snow', text: `${dayLabels(snowDays)}會下雪，穿防滑防水的鞋，路面可能結冰要走慢一點。` });
  }

  // 雨
  const rainDays = destDays.filter(isRainDay);
  if (rainDays.length) {
    tips.push({ level: 'rain', text: `${dayLabels(rainDays)}可能下雨，帶折傘或輕便雨衣。` });
  }

  // 高熱
  if (hi >= 33) tips.push({ level: 'hot', text: `白天最高 ${hi} 度，很熱，安排室內行程避開中午，隨身帶水。` });

  // 強風
  if (destDays.some((d) => d.windMax >= 40)) tips.push({ level: 'wind', text: '有幾天風很大，帽子小心被吹走，海邊 / 高處注意安全。' });

  // 海拔溫差
  if (dest && dest.elevation >= 1200) {
    const drop = Math.round(dest.elevation / 150) * 1;
    tips.push({ level: 'alt', text: `這裡海拔約 ${dest.elevation} 公尺，比平地低約 ${drop} 度，早晚更冷，山區可能結冰或積雪。` });
  }

  return tips;
}

function dayLabels(days) {
  // days 帶 _tripDay（相對第幾天）；沒有就用日期
  const ns = days.map((d) => d._tripDay).filter(Boolean);
  if (ns.length) {
    if (ns.length === 1) return `第 ${ns[0]} 天`;
    return `第 ${ns[0]}–${ns[ns.length - 1]} 天`;
  }
  const f = (s) => { const p = s.split('-'); return `${+p[1]}/${+p[2]}`; };
  return days.length === 1 ? f(days[0].date) : `${f(days[0].date)} 起`;
}

// 取現在位置的當前氣溫（比較基準用），失敗回 null
// 出發地的座標先降到小數 2 位（約 1 公里）才送給 Open-Meteo（2026-11-13，Dispatch 定 A2）：沒設居住地時這裡是
// 手機現在的 GPS（geo.js 給到小數 5 位、約 1 公尺，可能就是家裡）；查「現在幾度」用不到那麼準，結果不變。
export function coarse(v) { return Math.round(v * 100) / 100; }
export async function hereTempNow(lat, lng) {
  const f = await forecast(coarse(lat), coarse(lng));
  return f && f.current ? f.current.temp : null;
}
