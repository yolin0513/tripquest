// AI 加值層（可選）—— 沒設定金鑰時一切照常，這裡只是「有的話錦上添花」。
//
// 安全：前端只存「Worker 網址 + 通行碼」，真正的 API 金鑰在使用者自己的 Cloudflare
// Worker 裡（wrangler secret），我們不經手。Worker 端有每月花費上限與速率限制。
//
// 每個功能都可獨立開關；任何失敗都回傳 null，呼叫端就用原本免金鑰的做法。

import { myDeviceId } from './identity.js';

const KEY = 'tripquest.ai';
const FEATURES = ['recommend', 'narrate', 'tts'];

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function getAIConfig() {
  const c = read();
  return {
    url: (c.url || '').replace(/\/$/, ''),
    token: c.token || '',
    features: Object.fromEntries(FEATURES.map((f) => [f, !!(c.features && c.features[f])])),
  };
}
export function setAIConfig(patch) {
  const cur = read();
  const next = { ...cur, ...patch };
  if (patch && patch.features) next.features = { ...(cur.features || {}), ...patch.features };
  localStorage.setItem(KEY, JSON.stringify(next));
}
export function aiConfigured() {
  const c = getAIConfig();
  return !!(c.url && c.token);
}
export function aiOn(feature) {
  const c = getAIConfig();
  return aiConfigured() && !!c.features[feature];
}

async function call(path, { method = 'POST', body, timeout = 20000 } = {}) {
  const c = getAIConfig();
  if (!c.url || !c.token) return { error: 'not_configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(c.url + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-ai-token': c.token,
        'x-device': (myDeviceId && myDeviceId()) || 'anon',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || ('http_' + res.status), message: data.message, status: res.status };
    return { data, headers: res.headers };
  } catch (e) {
    return { error: 'network', message: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// 連線測試（設定頁用）
export async function aiTest(url, token) {
  const saved = read();
  localStorage.setItem(KEY, JSON.stringify({ ...saved, url, token }));
  const r = await call('/ai/usage', { method: 'GET', timeout: 8000 });
  localStorage.setItem(KEY, JSON.stringify(saved));
  if (r.error) return { ok: false, error: r.error, message: r.message };
  return { ok: true, usage: r.data };
}

// 本月用量 / 花費
export async function aiUsage() {
  const r = await call('/ai/usage', { method: 'GET', timeout: 8000 });
  return r.error ? null : r.data;
}

// 一句在地介紹（景點沒有 blurb 時補）
export async function aiRecommend({ place, city, kind }) {
  if (!aiOn('recommend') || !place) return null;
  const r = await call('/ai/recommend', { body: { place, city, kind } });
  return r.error ? null : (r.data.text || null);
}

// 回憶影片旁白：days = 每天一段摘要文字
export async function aiNarrate({ trip, days }) {
  if (!aiOn('narrate') || !days || !days.length) return null;
  const r = await call('/ai/narrate', { body: { trip, days }, timeout: 30000 });
  return r.error ? null : (Array.isArray(r.data.lines) ? r.data.lines : null);
}

// 文字轉語音 → Blob（audio/mpeg），失敗回 null
export async function aiTTS(text, voice) {
  if (!aiOn('tts') || !text) return null;
  const r = await call('/ai/tts', { body: { text, voice }, timeout: 30000 });
  if (r.error || !r.data.audio) return null;
  try {
    const bin = atob(r.data.audio);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: r.data.mime || 'audio/mpeg' });
  } catch { return null; }
}

export { FEATURES };
