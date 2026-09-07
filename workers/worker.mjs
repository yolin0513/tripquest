// TripQuest 同步 Worker —— Cloudflare Workers + D1 + R2
//
// 端點（都需要 ?g=<groupId> 與 Authorization: Bearer <groupSecret>，除了 /health）：
//   GET  /health                      { ok:true }
//   POST /push        {records:[...]}  合併中繼資料，回傳新的伺服器序號 { seq, wrote }
//   GET  /pull?since=<seq>             回傳 seq > since 的記錄 { records, seq, more }
//   HEAD /blob/<hash>                  200 存在 / 404 不存在（PUT 前先問，避免重傳）
//   GET  /blob/<hash>                  下載照片
//   PUT  /blob/<hash>   <binary>       上傳照片（<= MAX_BLOB_BYTES）
//   PUT    /album/<albumId>  {html,hashes,title}   發布公開相簿
//   DELETE /album/<albumId>                        收回公開相簿
//
// 公開端點（不需要祕鑰 —— 網址本身就是憑證）：
//   GET /a/<albumId>                 相簿頁（送嚴格 CSP，完全不准腳本）
//   GET /a/<albumId>/p/<hash>        相簿裡的照片（清單裡沒有的一律不給）
//
// 安全模型：群組由 groupId + 128-bit 祕鑰識別。第一次 push 建立群組並綁定祕鑰；
// 之後所有請求的祕鑰必須相符。每個群組的資料互相隔離。
//
// 合併規則：submission / reaction / comment / memberClaim 只新增（already-exists 就跳過）；
// 其餘中繼資料用「後寫入者勝（updatedAt，deviceId 決勝）＋ 墓碑」。

// 這個 Worker 只做同步（/health /push /pull /blob）。
// AI 不經 Worker —— 每個行程由建立者在 App 內輸入自己的金鑰，瀏覽器直連供應商。

const APPEND_ONLY = new Set(['submission', 'reaction', 'comment', 'retraction', 'memberClaim']);
const PULL_LIMIT = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (path === '/health') return json({ ok: true, ts: Date.now() });

    // 公開相簿：唯一不需要祕鑰的路徑（網址本身就是憑證，albumId 是 128-bit 亂數）
    const pub = path.match(/^\/a\/([a-f0-9]{24,64})(?:\/p\/([a-f0-9]{16,64}))?$/);
    if (pub) {
      try { return await handlePublicAlbum(env, pub[1], pub[2] || null); }
      catch (e) { return new Response('相簿讀取失敗：' + String(e && e.message || e), { status: 500 }); }
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
      const albumMatch = path.match(/^\/album\/([a-f0-9]{24,64})$/);
      if (albumMatch) return handleAlbum(request, env, groupId, secret, albumMatch[1]);
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

  // 撈出這批 id 目前的狀態。D1 一條敘述最多約 100 個綁定參數（含 groupId 這個），
  // 超過的話這條查詢會讓整個 Worker 直接被平台中止（不是普通的 JS 例外，try/catch
  // 接不住，使用者那端只會看到一個沒有 CORS 標頭的錯誤頁）。這裡一批最多帶 99 個
  // id（+1 個 groupId＝100，貼著上限但不超過）。
  const ids = [...new Set(records.map((r) => r && r.id).filter(Boolean))];
  const existing = new Map();
  const ID_CHUNK = 99;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
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
    // D1 的 batch() 一次最多約 100 條陳述式，超過會整批失敗（且失敗時 Cloudflare
    // Workers 平台回的錯誤頁沒有 CORS 標頭，瀏覽器那端只會看到一個看不懂的
    // 「CORS policy blocked / Failed to fetch」，訊息完全對不上真正原因）。
    // 拆成安全的小批依序送，一個行程景點任務多的時候才不會整包推送失敗。
    const D1_BATCH_LIMIT = 90;
    for (let i = 0; i < stmts.length; i += D1_BATCH_LIMIT) {
      await env.DB.batch(stmts.slice(i, i + D1_BATCH_LIMIT));
    }
    await env.DB.prepare('UPDATE groups SET seq = ? WHERE id = ?').bind(seq, groupId).run();
  }
  return json({ ok: true, seq, wrote: stmts.length });
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

// ---------- 公開相簿 ----------
//
// 為什麼要有這條路：單檔 HTML 把照片用 base64 內嵌，實測 40 張就 46.6MB，
// 一百多張會做出 60–200MB 的檔案 —— 電腦打得開，手機打不開。使用者真正要的是
// 「傳一個連結給家人看」，那就讓照片走 HTTP 一張一張載，而不是塞進一個檔案裡。
//
// 安全模型：
//   · albumId 是 App 端產生的 128-bit 亂數，網址本身就是憑證（跟邀請連結同一套想法）。
//   · 清單裡沒有的 hash 一律不給 —— 不會因為知道 groupId 就能撈整個群組的照片。
//   · 相簿頁是使用者的 App 上傳的 HTML，所以回應一定要送嚴格的 CSP：完全不准腳本。
//     沒有這一行，這裡就是自家網域上的儲存型 XSS。
//   · 只有原本就有群組祕鑰的人能發布 / 收回。
const ALBUM_HTML_MAX = 4_000_000;

function albumKeys(albumId) {
  return { meta: `album/${albumId}.json`, page: `album/${albumId}.html` };
}

async function handlePublicAlbum(env, albumId, hash) {
  const k = albumKeys(albumId);
  const metaObj = await env.PHOTOS.get(k.meta);
  if (!metaObj) return new Response('這個相簿不存在，或已經被收回了。', {
    status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const meta = JSON.parse(await metaObj.text());

  if (hash) {
    if (!Array.isArray(meta.hashes) || !meta.hashes.includes(hash)) return new Response('not found', { status: 404 });
    const obj = await env.PHOTOS.get(`${meta.groupId}/${hash}`);
    if (!obj) return new Response('not found', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const pageObj = await env.PHOTOS.get(k.page);
  if (!pageObj) return new Response('這個相簿還沒做好，請請對方再分享一次。', {
    status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(pageObj.body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // no-store：不然按了「收回連結」之後，家人的瀏覽器還是拿得到快取的那一份
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // 這份 HTML 是使用者上傳的 —— 一律不准跑腳本
      'content-security-policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'none'",
    },
  });
}

async function handleAlbum(request, env, groupId, secret, albumId) {
  const { error } = await authGroup(env, groupId, secret);
  if (error) return error;
  const k = albumKeys(albumId);

  if (request.method === 'DELETE') {
    const metaObj = await env.PHOTOS.get(k.meta);
    if (metaObj) {
      const meta = JSON.parse(await metaObj.text());
      if (meta.groupId !== groupId) return json({ error: 'forbidden' }, 403);
    }
    await env.PHOTOS.delete(k.meta);
    await env.PHOTOS.delete(k.page);
    return json({ ok: true, removed: true });
  }
  if (request.method !== 'PUT') return json({ error: 'method not allowed' }, 405);

  // 已經存在就必須是同一個群組的（albumId 是亂數，這只是防呆）
  const existing = await env.PHOTOS.get(k.meta);
  if (existing) {
    const meta = JSON.parse(await existing.text());
    if (meta.groupId !== groupId) return json({ error: 'forbidden' }, 403);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.html !== 'string' || !Array.isArray(body.hashes)) {
    return json({ error: 'bad album payload' }, 400);
  }
  if (body.html.length > ALBUM_HTML_MAX) return json({ error: 'album page too large' }, 413);
  const hashes = [...new Set(body.hashes.filter((h) => /^[a-f0-9]{16,64}$/.test(h)))];
  if (!hashes.length) return json({ error: 'no photos' }, 400);

  await env.PHOTOS.put(k.meta, JSON.stringify({
    groupId, albumId, hashes,
    title: String(body.title || '').slice(0, 200),
    createdAt: Date.now(),
  }), { httpMetadata: { contentType: 'application/json' } });
  await env.PHOTOS.put(k.page, body.html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  return json({ ok: true, albumId, photos: hashes.length });
}

// ---------- helpers ----------
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,HEAD,OPTIONS');
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
