// AI 加值層（可選、每個行程各自帶金鑰、瀏覽器直連供應商）。
//
// 金鑰只在建立者這台手機（見 aikeys.js）。呼叫直接打 api.anthropic.com /
// texttospeech.googleapis.com，經 TLS，不經任何中間伺服器。
// 金鑰只放在 HTTP header，永遠不進 prompt；輸出與錯誤訊息都會洗掉金鑰樣式字串。
// 任何失敗 → 回 null，呼叫端自動用免金鑰的做法。

import * as store from './store.js';
import { getTripKey, addUsage, usageOf, scrubSecrets, containsSecret } from './aikeys.js';

const MODEL = 'claude-haiku-4-5';
const RATE = { in: 1, out: 5 };          // 微美金 / token（Haiku 4.5：$1 / $5 每百萬）
const TTS_MICRO_PER_CHAR = 4;            // Google Standard 語音 ~$4 / 百萬字元

// 這個行程現在能不能用某個 AI 功能
export async function aiOn(tripId, feature = 'recommend') {
  const trip = store.get(tripId);
  if (!trip || !trip.aiEnabled) return false;
  const k = await getTripKey(tripId);
  if (!k || !k.key) return false;
  if ((k.usedMicroUsd || 0) >= (k.capUsd ?? 2) * 1e6) return false;
  if (feature === 'tts') return !!k.ttsKey;
  return true;
}

// ---------- Claude（文字） ----------
async function callClaude(key, { system, prompt, maxTokens = 200, timeout = 25000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { error: scrubSecrets(data && data.error && data.error.message) || ('HTTP ' + r.status) };
    }
    const text = (data.content || []).map((c) => c.text || '').join('').trim();
    const u = data.usage || {};
    const microUsd = (u.input_tokens || 0) * RATE.in + (u.output_tokens || 0) * RATE.out;
    return { text, microUsd };
  } catch (e) {
    return { error: scrubSecrets(e && e.message) || 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function safeOut(text) {
  const t = scrubSecrets(text).trim();
  if (!t || containsSecret(t)) return null;
  return t.replace(/^["「]|["」]$/g, '');
}

// ---------- 通用文字 / JSON（aicontent.js 用，批次產生海報、影片、回顧文案）----------
// 一律：沒開 AI / 沒金鑰 / 超上限 / 失敗 → 回 null，呼叫端自動用內建做法。
export async function aiComplete(tripId, { system, prompt, maxTokens = 500, feature = 'recommend', timeout = 30000 }) {
  if (!prompt || !(await aiOn(tripId, feature))) return null;
  const k = await getTripKey(tripId);
  const res = await callClaude(k.key, { system, prompt, maxTokens, timeout });
  if (res.error) return null;
  await addUsage(tripId, res.microUsd);
  return safeOut(res.text);
}

export async function aiJSON(tripId, opts) {
  const raw = await aiComplete(tripId, opts);
  if (!raw) return null;
  const scrub = scrubSecrets(raw);
  const m = scrub.match(/[[{][\s\S]*[\]}]/);
  if (!m) return null;
  try {
    const val = JSON.parse(m[0]);
    return containsSecret(JSON.stringify(val)) ? null : val;
  } catch { return null; }
}

// 連線測試（設定頁用）—— 最小一次呼叫確認金鑰可用
export async function aiTestKey(key) {
  if (!key) return { ok: false, message: '請先貼上金鑰' };
  const res = await callClaude(key, { system: 'reply with OK', prompt: 'ping', maxTokens: 8, timeout: 12000 });
  if (res.error) {
    const m = /401|authentication|invalid x-api-key/i.test(res.error) ? '金鑰不正確' :
      /network|abort|failed/i.test(res.error) ? '連不上（檢查網路）' : ('測試失敗：' + res.error);
    return { ok: false, message: m };
  }
  return { ok: true, message: '金鑰可用 ✓' };
}

// ---------- Google Text-to-Speech（語音，選用） ----------
export async function aiTTS(tripId, text, voice) {
  const t = String(text || '').slice(0, 2000);
  if (!t.trim() || !(await aiOn(tripId, 'tts'))) return null;
  const k = await getTripKey(tripId);
  const v = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]+$/.test(voice || '') ? voice : 'cmn-TW-Standard-A';
  try {
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': k.ttsKey },
      body: JSON.stringify({
        input: { text: t },
        voice: { languageCode: v.split('-').slice(0, 2).join('-'), name: v },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.audioContent) return null;
    await addUsage(tripId, t.length * TTS_MICRO_PER_CHAR);
    const bin = atob(data.audioContent);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: 'audio/mpeg' });
  } catch { return null; }
}

export async function aiTestTtsKey(ttsKey) {
  if (!ttsKey) return { ok: false, message: '請先貼上金鑰' };
  try {
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': ttsKey },
      body: JSON.stringify({ input: { text: '測試' }, voice: { languageCode: 'cmn-TW', name: 'cmn-TW-Standard-A' }, audioConfig: { audioEncoding: 'MP3' } }),
    });
    if (r.ok) return { ok: true, message: '語音金鑰可用 ✓' };
    const d = await r.json().catch(() => ({}));
    return { ok: false, message: /API key not valid|API_KEY_INVALID/i.test(JSON.stringify(d)) ? '金鑰不正確' : ('測試失敗：HTTP ' + r.status) };
  } catch { return { ok: false, message: '連不上' }; }
}

export { usageOf };
