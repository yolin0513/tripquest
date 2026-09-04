// TripQuest AI 代理 —— 可選的加值層
//
// 前端是公開靜態站，任何金鑰都不能放前端 / repo。所有第三方 AI API 一律經過這個
// Worker，金鑰用 `wrangler secret put` 存成 Worker secret，我們不經手。
//
// 端點（都需要 header `X-AI-Token: <AI_ACCESS_TOKEN>`）：
//   GET  /ai/usage                       { month, usedUsd, capUsd, resetAt, rate }
//   POST /ai/recommend {place,city,kind}  → { text }          一句在地介紹 / 必吃
//   POST /ai/narrate   {trip,days}        → { lines:[...] }    回憶影片旁白
//   POST /ai/tts       {text,voice}       → { audio:<base64>, mime }
//
// 防濫用（避免邀請連結外流被人刷錢）：
//   1. 每月總花費上限（AI_MONTHLY_CAP_USD，預設 5）—— 先預扣估算成本、失敗直接擋，
//      呼叫完再用實際 token 用量校正。達上限回 402，前端自動改用免金鑰的做法。
//   2. 速率限制：每裝置每分鐘 AI_RATE_PER_MIN 次（預設 6）、全域每分鐘
//      AI_RATE_GLOBAL_PER_MIN 次（預設 30）。超過回 429。
//   3. X-AI-Token 錯 → 401。
//
// 需要的 secret（使用者本人設定，不寫進任何檔案）：
//   wrangler secret put AI_ACCESS_TOKEN     （自訂一組通行碼，填進 App 設定分享給家人）
//   wrangler secret put ANTHROPIC_API_KEY   （行程/景點/旁白文字；沒有就這些功能停用）
//   wrangler secret put GOOGLE_TTS_KEY      （語音旁白；沒有就 TTS 停用）
// 選用 vars（wrangler.toml [vars] 或 secret）：
//   AI_MODEL（預設 claude-haiku-4-5）、AI_MONTHLY_CAP_USD、AI_RATE_PER_MIN、AI_RATE_GLOBAL_PER_MIN

// 每百萬 token 美金（= 每 token 微美金）。校正用實際用量。
const MODEL_RATES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 15, out: 75 },
};
// 預扣估算（微美金），寧可高估
const EST_MICRO = { recommend: 4000, narrate: 9000, tts: 30000 };

export function isAIPath(path) {
  return path === '/ai/usage' || path === '/ai/recommend' || path === '/ai/narrate' || path === '/ai/tts';
}

export async function handleAI(request, env, url, path) {
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  const token = request.headers.get('x-ai-token') || url.searchParams.get('ai_token') || '';
  if (!env.AI_ACCESS_TOKEN || !timingSafeEqual(token, env.AI_ACCESS_TOKEN)) {
    return json({ error: 'bad_ai_token', message: 'AI 通行碼不對，或這個伺服器沒開啟 AI 功能。' }, 401);
  }

  const month = new Date().toISOString().slice(0, 7);
  const capMicro = Math.max(0, Math.round(parseFloat(env.AI_MONTHLY_CAP_USD || '5') * 1e6));
  await ensureTables(env);

  if (path === '/ai/usage') {
    const row = await env.DB.prepare('SELECT micro_usd, calls FROM ai_usage WHERE month = ?').bind(month).first();
    return json({
      month,
      usedUsd: +(((row && row.micro_usd) || 0) / 1e6).toFixed(4),
      capUsd: +(capMicro / 1e6).toFixed(2),
      calls: (row && row.calls) || 0,
      resetAt: monthEnd(month),
      features: {
        recommend: !!env.ANTHROPIC_API_KEY,
        narrate: !!env.ANTHROPIC_API_KEY,
        tts: !!env.GOOGLE_TTS_KEY,
      },
    });
  }

  const task = path.slice(4); // recommend | narrate | tts
  const dev = (request.headers.get('x-device') || 'anon').slice(0, 64);

  // ---- 速率限制 ----
  const rl = await rateCheck(env, dev);
  if (!rl.ok) return json({ error: 'rate_limited', message: '慢一點，過一下再試。', retryAfter: 60 }, 429);

  // ---- 月額度：先預扣 ----
  const est = EST_MICRO[task] || 5000;
  await env.DB.prepare('INSERT INTO ai_usage (month, micro_usd, calls) VALUES (?, 0, 0) ON CONFLICT(month) DO NOTHING').bind(month).run();
  const reserve = await env.DB.prepare(
    'UPDATE ai_usage SET micro_usd = micro_usd + ?1, calls = calls + 1 WHERE month = ?2 AND micro_usd + ?1 <= ?3'
  ).bind(est, month, capMicro).run();
  if (!reserve.meta.changes) {
    return json({ error: 'monthly_cap_reached', message: `本月 AI 額度（$${(capMicro / 1e6).toFixed(2)}）用完了，下個月 1 號重置。App 會自動改用免費做法。`, resetAt: monthEnd(month) }, 402);
  }

  let body = {};
  try { body = await request.json(); } catch { /* noop */ }

  try {
    let out, actualMicro = est;
    if (task === 'tts') {
      ({ out, actualMicro } = await doTTS(env, body));
    } else {
      ({ out, actualMicro } = await doClaude(env, task, body));
    }
    // 校正：把預扣改成實際
    await env.DB.prepare('UPDATE ai_usage SET micro_usd = micro_usd + ? WHERE month = ?').bind(actualMicro - est, month).run();
    const usedRow = await env.DB.prepare('SELECT micro_usd FROM ai_usage WHERE month = ?').bind(month).first();
    const res = json(out);
    res.headers.set('X-AI-Used-USD', (((usedRow && usedRow.micro_usd) || 0) / 1e6).toFixed(4));
    res.headers.set('X-AI-Cap-USD', (capMicro / 1e6).toFixed(2));
    return res;
  } catch (e) {
    // 呼叫失敗：退掉預扣，別讓使用者白付
    await env.DB.prepare('UPDATE ai_usage SET micro_usd = micro_usd - ?, calls = calls - 1 WHERE month = ?').bind(est, month).run();
    return json({ error: 'upstream_failed', message: '這次 AI 沒有回應，已改用一般做法。', detail: String(e && e.message || e) }, 502);
  }
}

// ---------- Claude（文字） ----------
async function doClaude(env, task, body) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('這個伺服器沒有設定 ANTHROPIC_API_KEY');
  const model = env.AI_MODEL || 'claude-haiku-4-5';
  const rate = MODEL_RATES[model] || MODEL_RATES['claude-haiku-4-5'];

  let system, prompt, maxTokens;
  if (task === 'recommend') {
    const place = String(body.place || '').slice(0, 80);
    const city = String(body.city || '').slice(0, 40);
    const kind = String(body.kind || '').slice(0, 20);
    if (!place) throw new Error('缺 place');
    system = '你是台灣在地旅遊小幫手。用繁體中文寫一句 25～40 字、給長輩看的親切介紹，講這個地點最有代表性的東西或必拍必吃。不要用英文、不要誇飾、不要「網美」等流行語。只回那一句，不要引號。';
    prompt = `地點：${place}${city ? `（${city}）` : ''}${kind ? `，類型：${kind}` : ''}`;
    maxTokens = 120;
  } else if (task === 'narrate') {
    const trip = String(body.trip || '').slice(0, 60);
    const days = Array.isArray(body.days) ? body.days.slice(0, 10) : [];
    if (!days.length) throw new Error('缺 days');
    system = '你在為一支家庭旅遊回憶影片寫旁白。每天一句、繁體中文、12～22 字、溫暖口語、像長輩會說的話。用 JSON 陣列回覆，例如 ["第一天…","第二天…"]，不要多餘文字。';
    prompt = `旅程：${trip}\n` + days.map((d, i) => `第${i + 1}天：${String(d).slice(0, 120)}`).join('\n');
    maxTokens = 400;
  } else {
    throw new Error('未知任務');
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data && data.error && data.error.message || ('HTTP ' + r.status));
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  const u = data.usage || {};
  const actualMicro = Math.round((u.input_tokens || 0) * rate.in + (u.output_tokens || 0) * rate.out);

  if (task === 'narrate') {
    let lines = [];
    try { lines = JSON.parse(text.match(/\[[\s\S]*\]/)[0]); } catch { lines = text.split(/\n+/).filter(Boolean); }
    return { out: { lines: lines.map((s) => String(s).trim()).filter(Boolean).slice(0, 10) }, actualMicro };
  }
  return { out: { text: text.replace(/^["「]|["」]$/g, '') }, actualMicro };
}

// ---------- Google Text-to-Speech ----------
async function doTTS(env, body) {
  if (!env.GOOGLE_TTS_KEY) throw new Error('這個伺服器沒有設定 GOOGLE_TTS_KEY');
  const text = String(body.text || '').slice(0, 2000);
  if (!text.trim()) throw new Error('缺 text');
  const voice = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]+$/.test(body.voice || '') ? body.voice : 'cmn-TW-Standard-A';
  const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.split('-').slice(0, 2).join('-'), name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data && data.error && data.error.message || ('HTTP ' + r.status));
  // Standard 語音約 $4 / 百萬字元 → 每字元 4 微美金
  const actualMicro = Math.max(1, Math.round(text.length * 4));
  return { out: { audio: data.audioContent, mime: 'audio/mpeg' }, actualMicro };
}

// ---------- 速率限制（D1，分鐘桶） ----------
async function rateCheck(env, dev) {
  const perDev = parseInt(env.AI_RATE_PER_MIN || '6', 10);
  const perAll = parseInt(env.AI_RATE_GLOBAL_PER_MIN || '30', 10);
  const minute = new Date().toISOString().slice(0, 16);
  const exp = Date.now() + 180000;
  const bump = async (bucket) => {
    await env.DB.prepare('INSERT INTO ai_rate (bucket, n, exp) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET n = n + 1').bind(bucket, exp).run();
    const row = await env.DB.prepare('SELECT n FROM ai_rate WHERE bucket = ?').bind(bucket).first();
    return (row && row.n) || 1;
  };
  const nDev = await bump(`d:${dev}:${minute}`);
  const nAll = await bump(`*:${minute}`);
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM ai_rate WHERE exp < ?').bind(Date.now()).run();
  return { ok: nDev <= perDev && nAll <= perAll };
}

async function ensureTables(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ai_usage (month TEXT PRIMARY KEY, micro_usd INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ai_rate (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, exp INTEGER NOT NULL)'),
  ]);
}

function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString();
}

// ---------- helpers（與 worker.mjs 同樣的 CORS / 常數時間比對） ----------
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'authorization,content-type,x-ai-token,x-device');
  res.headers.set('Access-Control-Expose-Headers', 'X-AI-Used-USD,X-AI-Cap-USD');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }));
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
