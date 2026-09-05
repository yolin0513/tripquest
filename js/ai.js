// AI 加值層（可選、每個行程各自帶金鑰、瀏覽器直連供應商）。
//
// 金鑰只在建立者這台手機（見 aikeys.js）。呼叫直接打 api.anthropic.com /
// texttospeech.googleapis.com，經 TLS，不經任何中間伺服器。
// 金鑰只放在 HTTP header，永遠不進 prompt；輸出與錯誤訊息都會洗掉金鑰樣式字串。
// 任何失敗 → 回 null，呼叫端自動用免金鑰的做法。

import * as store from './store.js';
import { getTripKey, getDeviceKey, addUsage, usageOf, scrubSecrets, containsSecret, DEVICE_KEY_ID } from './aikeys.js';

const MODEL = 'claude-haiku-4-5';
// 看圖讀行程表要判斷版面（哪一欄是時間、跨頁的表格），Haiku 會漏行，所以這一條路走 Sonnet。
const VISION_MODEL = 'claude-sonnet-5';
// 微美金 / token。一定要跟 model 對起來，不然花費統計會騙人。
const RATES = {
  'claude-haiku-4-5': { in: 1, out: 5 },        // $1 / $5 每百萬
  'claude-sonnet-5': { in: 3, out: 15 },        // $3 / $15 每百萬
};
const RATE = RATES[MODEL];
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
async function callClaude(key, { system, prompt, content, maxTokens = 200, timeout = 25000, model = MODEL }) {
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
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: content || prompt }] }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { error: scrubSecrets(data && data.error && data.error.message) || ('HTTP ' + r.status) };
    }
    const text = (data.content || []).map((c) => c.text || '').join('').trim();
    const u = data.usage || {};
    const rate = RATES[model] || RATE;
    const microUsd = (u.input_tokens || 0) * rate.in + (u.output_tokens || 0) * rate.out;
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

// ---------- 看圖／看 PDF 讀行程表（匯入用） ----------
//
// 這條路特別在：它發生在「旅程還沒建立」的時候，所以金鑰來自這台手機的預設金鑰
// （aikeys.DEVICE_KEY_ID），不是某一趟的。花費也記在那裡。
//
// 隱私：只有走到這裡才會把圖片內容送出去，而且呼叫端一定要先明確告知使用者。
// 圖片在送出前已經重繪過（見 views/import.js 的 shrink），EXIF／GPS 不會跟著走。

export async function deviceAiReady() {
  const k = await getDeviceKey();
  if (!k || !k.key) return false;
  return (k.usedMicroUsd || 0) < (k.capUsd ?? 2) * 1e6;
}

const IMPORT_SYSTEM = `你是行程表判讀助理。使用者給你一張行程表的照片、PDF 或文字。
只輸出 JSON 陣列，不要任何說明文字。每個元素：
{"day":數字(第幾天,從1開始),"start":"HH:MM"或null,"end":"HH:MM"或null,"stayMin":數字或null,"name":"景點名稱","uncertain":true/false}
規則：
- name 只放地點或店家名稱，不要放交通方式、票價、備註、時間。
- 「午餐：一蘭拉麵」→ name 是「一蘭拉麵」。「午餐（自理）」這種沒有店名的就不要輸出。
- 24 小時制。「下午2點」→ "14:00"。看不出時間就 null，不要猜。
- 只寫得出「上午／下午」這種模糊時段時，給概略時間並把 uncertain 設 true。
- 表格若跨頁或有欄位對不齊，寧可把該列 uncertain 設 true，也不要合併成一筆。
- 看不清楚的字不要自己編，該筆 uncertain 設 true。`;

// files: [{ mime, b64 }]（image/* 或 application/pdf）；text: 補充文字（可省略）
// 回傳 { rows, microUsd } 或 { error }
export async function aiReadItinerary({ files = [], text = '' }) {
  const k = await getDeviceKey();
  if (!k || !k.key) return { error: 'no-key' };
  if ((k.usedMicroUsd || 0) >= (k.capUsd ?? 2) * 1e6) return { error: 'over-cap' };

  const content = [];
  for (const f of files.slice(0, 5)) {
    if (!f || !f.b64) continue;
    if (f.mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.b64 } });
    } else if (/^image\/(jpeg|png|webp|gif)$/.test(f.mime || '')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.b64 } });
    }
  }
  if (text.trim()) content.push({ type: 'text', text: text.trim().slice(0, 8000) });
  if (!content.length) return { error: 'empty' };
  content.push({ type: 'text', text: '請把上面的行程整理成 JSON 陣列。' });

  const res = await callClaude(k.key, {
    system: IMPORT_SYSTEM, content, model: VISION_MODEL, maxTokens: 4000, timeout: 90000,
  });
  if (res.error) return { error: res.error };
  await addUsage(DEVICE_KEY_ID, res.microUsd);

  const scrub = scrubSecrets(res.text || '');
  const m = scrub.match(/\[[\s\S]*\]/);
  if (!m) return { error: 'parse', microUsd: res.microUsd };
  try {
    const rows = JSON.parse(m[0]);
    if (!Array.isArray(rows)) return { error: 'parse', microUsd: res.microUsd };
    if (containsSecret(JSON.stringify(rows))) return { error: 'parse', microUsd: res.microUsd };
    return { rows, microUsd: res.microUsd };
  } catch { return { error: 'parse', microUsd: res.microUsd }; }
}

export { usageOf };
