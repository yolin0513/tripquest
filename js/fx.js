// 匯率換算 —— open.er-api.com（免金鑰、免註冊、支援 CORS、160+ 幣別）。
// 匯率變動慢，快取 12 小時；離線用最後一次快取並顯示更新時間。

const KEY = 'tripquest.fx';
let _currencies = null;

export async function loadCurrencies() {
  if (!_currencies) {
    try { _currencies = await fetch('./data/currencies.json').then((r) => r.json()); }
    catch { _currencies = { list: [{ code: 'TWD', symbol: 'NT$', name: '新台幣', zero: false }], byCountry: {} }; }
  }
  return _currencies;
}
export function currencyInfo(code) {
  const l = (_currencies && _currencies.list) || [];
  return l.find((c) => c.code === code) || { code, symbol: code + ' ', name: code, zero: false };
}
export function currencyForCountry(country) {
  return (_currencies && _currencies.byCountry && _currencies.byCountry[country]) || '';
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

// 回傳 { base:'USD', rates:{TWD:32.1,...}, updatedAt, stale }
export async function getRates() {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < 12 * 3600000) return { ...cached, stale: false };
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('http ' + res.status);
    const d = await res.json();
    if (d.result !== 'success' || !d.rates) throw new Error('bad payload');
    const out = { base: 'USD', rates: d.rates, updatedAt: d.time_last_update_utc || '', fetchedAt: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* noop */ }
    return { ...out, stale: false };
  } catch {
    if (cached) return { ...cached, stale: true };
    return null;
  }
}

// amount(from 幣別) → to 幣別。ratesObj 是 getRates() 的結果（USD 為基準）。
export function convert(amount, from, to, ratesObj) {
  if (!amount || from === to) return amount || 0;
  if (!ratesObj || !ratesObj.rates) return null;
  const rf = from === 'USD' ? 1 : ratesObj.rates[from];
  const rt = to === 'USD' ? 1 : ratesObj.rates[to];
  if (!rf || !rt) return null;
  return amount / rf * rt;
}

export function fmtMoney(amount, code) {
  const info = currencyInfo(code);
  const n = info.zero ? Math.round(amount) : Math.round(amount * 100) / 100;
  const s = info.zero
    ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${info.symbol}${s}`;
}
