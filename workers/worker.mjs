// TripQuest 同步 Worker —— Cloudflare Workers + D1 + R2
//
// 端點（都需要 ?g=<groupId> 與 Authorization: Bearer <groupSecret>，除了 /health）：
//   GET  /health                      { ok:true }
//   POST /push        {records:[...]}  合併中繼資料，回傳新的伺服器序號 { seq, wrote }
//   GET  /pull?since=<seq>             回傳 seq > since 的記錄 { records, seq, more }
//   HEAD /blob/<hash>                  200 存在 / 404 不存在（PUT 前先問，避免重傳）
//   GET  /blob/<hash>                  下載照片
//   PUT  /blob/<hash>   <binary>       上傳照片（<= MAX_BLOB_BYTES）
//
// 安全模型：群組由 groupId + 128-bit 祕鑰識別。第一次 push 建立群組並綁定祕鑰；
// 之後所有請求的祕鑰必須相符。每個群組的資料互相隔離。
//
// 合併規則：submission / reaction / comment / memberClaim 只新增（already-exists 就跳過）；
// 其餘中繼資料用「後寫入者勝（updatedAt，deviceId 決勝）＋ 墓碑」。

import { isAIPath, handleAI } from './ai.mjs';

const APPEND_ONLY = new Set(['submission', 'reaction', 'comment', 'retraction', 'memberClaim']);
const PULL_LIMIT = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (path === '/health') {
      return json({ ok: true, ts: Date.now(), ai: !!env.AI_ACCESS_TOKEN });
    }

    // 可選的 AI 加值層（自帶通行碼 + 用量上限，不需要群組祕鑰）
    if (isAIPath(path)) {
      try { return await handleAI(request, env, url, path); }
      catch (e) { return json({ error: 'ai_error', detail: String(e && e.message || e) }, 500); }
    }

    const groupId = url.searchParams.get('g');
    const secret = bearer(request) || url.searchParams.get('s');
    if (!groupId || !secret) return json({ error: 'missing group or secret' }, 400);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(groupId)) return json({ error: 'bad group id' }, 400);

    try {
      const blobMatch = path.match(/^\/blob\/([a-f0-9]{16,64})$/);
      if (blobMatch) return handleBlob(request, env, url, groupId, secret, blobMatch[1]);
      if (path === '/push' && request.method === 'POST') return handlePush(request, env, groupId, secret);
      if (path === '/pull') return handlePull(env, url, groupId, secret);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

// ---------- 群組驗證 ----------
async function authGroup(env, groupId, secret, { createIfMissing = false } = {}) {
  const row = await env.DB.prepare('SELECT id, secret, seq FROM groups WHERE id = ?').bind(groupId).first();
  if (row) {
    if (!timingSafeEqual(row.secret, secret)) return { error: json({ error: 'forbidden' }, 403) };
    return { group: row };
  }
  if (!createIfMissing) return { error: json({ error: 'unknown group' }, 404) };
  if (!/^[a-f0-9]{24,64}$/i.test(secret)) return { error: json({ error: 'weak secret' }, 400) };
  await env.DB.prepare('INSERT INTO groups (id, secret, seq, created_at) VALUES (?, ?, 0, ?)')
    .bind(groupId, secret, Date.now()).run();
  return { group: { id: groupId, secret, seq: 0 } };
}

// ---------- /push ----------
async function handlePush(request, env, groupId, secret) {
  const body = await request.json().catch(() => ({}));
  const records = Array.isArray(body.records) ? body.records : [];
  const { group, error } = await authGroup(env, groupId, secret, { createIfMissing: true });
  if (error) return error;

  // 撈出這批 id 目前的狀態
  const ids = [...new Set(records.map((r) => r && r.id).filter(Boolean))];
  const existing = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rs = await env.DB.prepare(
      `SELECT id, updated_at, device_id, type FROM records WHERE group_id = ? AND id IN (${chunk.map(() => '?').join(',')})`
    ).bind(groupId, ...chunk).all();
    for (const row of rs.results || []) existing.set(row.id, row);
  }

  let seq = group.seq;
  const stmts = [];
  for (const rec of records) {
    if (!rec || !rec.id || typeof rec !== 'object') continue;
    const cur = existing.get(rec.id);
    const appendOnly = APPEND_ONLY.has(rec.type);
    if (cur) {
      if (appendOnly) continue; // 已存在，不動
      const incWins = (rec.updatedAt || 0) > (cur.updated_at || 0) ||
        ((rec.updatedAt || 0) === (cur.updated_at || 0) && String(rec.deviceId) > String(cur.device_id));
      if (!incWins) continue;
    }
    seq += 1;
    stmts.push(env.DB.prepare(
      `INSERT INTO records (group_id, id, seq, type, updated_at, device_id, json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id, id) DO UPDATE SET
         seq = excluded.seq, type = excluded.type, updated_at = excluded.updated_at,
         device_id = excluded.device_id, json = excluded.json`
    ).bind(groupId, rec.id, seq, rec.type || null, rec.updatedAt || null, rec.deviceId || null, JSON.stringify(rec)));
  }
  if (stmts.length) {
    stmts.push(env.DB.prepare('UPDATE groups SET seq = ? WHERE id = ?').bind(seq, groupId));
    await env.DB.batch(stmts);
  }
  return json({ ok: true, seq, wrote: stmts.length ? stmts.length - 1 : 0 });
}

// ---------- /pull ----------
async function handlePull(env, url, groupId, secret) {
  const { group, error } = await authGroup(env, groupId, secret);
  if (error) return error;
  const since = Number(url.searchParams.get('since') || 0);
  const rs = await env.DB.prepare(
    'SELECT json, seq FROM records WHERE group_id = ? AND seq > ? ORDER BY seq LIMIT ?'
  ).bind(groupId, since, PULL_LIMIT).all();
  const rows = rs.results || [];
  const records = rows.map((r) => JSON.parse(r.json));
  const maxSeq = rows.length ? rows[rows.length - 1].seq : since;
  return json({ records, seq: rows.length === PULL_LIMIT ? maxSeq : group.seq, more: rows.length === PULL_LIMIT });
}

// ---------- /blob ----------
async function handleBlob(request, env, url, groupId, secret, hash) {
  const { error } = await authGroup(env, groupId, secret, { createIfMissing: request.method === 'PUT' });
  if (error) return error;
  const key = `${groupId}/${hash}`;

  if (request.method === 'HEAD') {
    const head = await env.PHOTOS.head(key);
    return cors(new Response(null, { status: head ? 200 : 404 }));
  }
  if (request.method === 'GET') {
    const obj = await env.PHOTOS.get(key);
    if (!obj) return json({ error: 'not found' }, 404);
    const h = new Headers();
    h.set('content-type', obj.httpMetadata?.contentType || 'image/jpeg');
    h.set('cache-control', 'public, max-age=31536000, immutable');
    return cors(new Response(obj.body, { headers: h }));
  }
  if (request.method === 'PUT') {
    const max = Number(env.MAX_BLOB_BYTES || 15000000);
    const len = Number(request.headers.get('content-length') || 0);
    if (len > max) return json({ error: 'too large' }, 413);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > max) return json({ error: 'too large' }, 413);
    await env.PHOTOS.put(key, buf, {
      httpMetadata: { contentType: request.headers.get('x-content-type') || 'image/jpeg' },
    });
    return json({ ok: true, bytes: buf.byteLength });
  }
  return json({ error: 'method not allowed' }, 405);
}

// ---------- helpers ----------
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,HEAD,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'authorization,content-type,x-content-type');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }));
}
function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
