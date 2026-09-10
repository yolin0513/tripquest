// 匯率換算 —— open.er-api.com（免金鑰、免註冊、支援 CORS、160+ 幣別）。
// 匯率變動慢，快取 12 小時；離線用最後一次快取並顯示更新時間。

const KEY = 'tripquest.fx';
let _currencies = null;

export async function loadCurrencies() {
  if (!_currencies) {
    // v1.73.4：補逾時。這一支擋在**整個分帳頁**前面（expenses.js 在 render() 之前
    // await 它），沒有逾時的話慢網路上就是一片空白等下去。抓的是本站的靜態檔、
    // 也在 SW 預快取清單裡，所以 6 秒還沒回來就是不會回來了 —— 退回只有新台幣的
    // 最小清單，畫面照樣出得來（金額顯示不受影響，只有幣別選單會少）。
    const to = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
    try { _currencies = await fetch('./data/currencies.json', { signal: to(6000) }).then((r) => r.json()); }
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
const _to = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

export async function getRates() {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < 12 * 3600000) return { ...cached, stale: false };
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: _to(8000) });
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
