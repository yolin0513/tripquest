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

import { mergeRecord, sanitizeF, APPEND_ONLY } from '../js/merge.js';
import { inviteSummary } from '../js/invite.js';
const PULL_LIMIT = 500;

// 位置的保留期限（v1.60）。客戶端會自己過期，但「最後一台裝置再也沒開 App」時
// 那筆座標會永遠留在 D1 —— 所以伺服器端也要有一道。
// 刻意**不是 DELETE**：客戶端的同步游標是 seq，直接刪列的話已經拉過的手機永遠
// 不會知道，本機副本反而留著。改寫成「無座標墓碑」並佔新 seq，才會傳播出去。
const POS_TTL_MS = 48 * 3600 * 1000;

async function sweepPositions(env) {
  const cutoff = Date.now() - POS_TTL_MS;
  const rs = await env.DB.prepare(
    `SELECT group_id, id, json FROM records
      WHERE type = 'memberPos' AND updated_at < ? LIMIT 200`
  ).bind(cutoff).all();
  const rows = rs.results || [];
  let cleaned = 0;
  for (const row of rows) {
    let rec = null;
    try { rec = JSON.parse(row.json); } catch { rec = null; }
    if (!rec) continue;
    if (rec.deleted && rec.lat == null) continue;              // 已經是乾淨墓碑
    const tomb = { id: rec.id, type: 'memberPos', tripId: rec.tripId || null,
      memberId: rec.memberId || null, deleted: true,
      deviceId: rec.deviceId || null, createdAt: rec.createdAt || null, updatedAt: Date.now() };
    const g = await env.DB.prepare('UPDATE groups SET seq = seq + 1 WHERE id = ? RETURNING seq').bind(row.group_id).first();
    await env.DB.prepare(
      `UPDATE records SET seq = ?, updated_at = ?, json = ? WHERE group_id = ? AND id = ?`
    ).bind(Number(g && g.seq), tomb.updatedAt, JSON.stringify(tomb), row.group_id, row.id).run();
    cleaned++;
  }
  return cleaned;
}

export default {
  // 每天清一次過期位置（wrangler.toml 的 triggers）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweepPositions(env).catch((e) => console.error('sweepPositions', e)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (path === '/health') return json({ ok: true, ts: Date.now() });

    // 內建配樂（公開授權內容：CC0/PD/CC BY，見 repo 的 MUSIC_LICENSES.md）。
    // 只開 GET/HEAD、檔名白名單格式、固定前綴 music/v1/ —— 沒有列舉、沒有上傳，
    // 不會變成任意存取 bucket 的破口。檔名即版本（內容不變），給長快取。
    const mus = path.match(/^\/music\/([a-z0-9-]{1,40}\.mp3)$/);
    if (mus) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method' }, 405);
      const obj = await env.PHOTOS.get('music/v1/' + mus[1]);
      if (!obj) return new Response('not found', { status: 404 });
      return cors(new Response(request.method === 'HEAD' ? null : obj.body, {
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': String(obj.size),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      }));
    }

    // 公開相簿：唯一不需要祕鑰的路徑（網址本身就是憑證，albumId 是 128-bit 亂數）
    const pub = path.match(/^\/a\/([a-f0-9]{24,64})(?:\/p\/([a-f0-9]{16,64}))?$/);
    if (pub) {
      try { return await handlePublicAlbum(env, pub[1], pub[2] || null); }
      catch (e) { return new Response('相簿讀取失敗：' + String(e && e.message || e), { status: 500 }); }
    }

    // 地圖短網址解析（v1.61）。Google 的 maps.app.goo.gl 短網址本身不含座標，
    // 要跟隨轉址才拿得到；瀏覽器端直接 fetch 會被 CORS 擋，所以借道這裡。
    if (path === '/resolve' && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleResolve(request, url);
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
      if (path === '/invite' && request.method === 'GET') return handleInvite(request, env, url, groupId);
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
  // v1.58 起新群組的祕鑰是 base64url 22 字；既有 hex 祕鑰是這個字元集的子集，照舊可用
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(secret)) return { error: json({ error: 'weak secret' }, 400) };
  await env.DB.prepare('INSERT INTO groups (id, secret, seq, created_at) VALUES (?, ?, 0, ?)')
    .bind(groupId, secret, Date.now()).run();
  return { group: { id: groupId, secret, seq: 0 } };
}

// ---------- /push ----------
async function handlePush(request, env, groupId, secret) {
  const body = await request.json().catch(() => ({}));
  const records = Array.isArray(body.records) ? body.records : [];
  const { error } = await authGroup(env, groupId, secret, { createIfMissing: true });
  if (error) return error;

  // 撈出這批 id 目前的狀態。D1 一條敘述最多約 100 個綁定參數（含 groupId 這個），
  // 超過的話這條查詢會讓整個 Worker 直接被平台中止（不是普通的 JS 例外，try/catch
  // 接不住，使用者那端只會看到一個沒有 CORS 標頭的錯誤頁）。這裡一批最多帶 99 個
  // id（+1 個 groupId＝100，貼著上限但不超過）。
  // v1.56 欄位級合併：追蹤型別（spot/trip/quest）要讀 json 才能逐組合併；其他型別只讀 meta。
  const ids = [...new Set(records.map((r) => r && r.id).filter(Boolean))];
  const ID_CHUNK = 99;
  const loadExisting = async () => {
    const existing = new Map();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rs = await env.DB.prepare(
        `SELECT id, seq, updated_at, device_id, type,
                CASE WHEN type IN ('spot','trip','quest') THEN json ELSE NULL END AS json
           FROM records WHERE group_id = ? AND id IN (${chunk.map(() => '?').join(',')})`
      ).bind(groupId, ...chunk).all();
      for (const row of rs.results || []) existing.set(row.id, row);
    }
    return existing;
  };

  // 決定每筆要寫什麼：回 { rec, mergedBack } 或 null（不用寫）
  const plan = (rec, cur) => {
    if (!rec || !rec.id || typeof rec !== 'object') return null;
    sanitizeF(rec);
    if (!cur) return { rec, mergedBack: false };
    if (APPEND_ONLY.has(rec.type)) return null;                       // 已存在，不動
    // 快速路徑：同一版本（同 updatedAt+deviceId）→ 不 parse、不寫
    if ((rec.updatedAt || 0) === (cur.updated_at || 0) && String(rec.deviceId || '') === String(cur.device_id || '')) return null;
    if (cur.json) {
      let curRec = null;
      try { curRec = JSON.parse(cur.json); } catch { curRec = null; }
      if (curRec) {
        const { rec: merged, changed } = mergeRecord(curRec, rec);
        if (!changed) return null;                                     // 合併結果＝現存 → 不寫、不佔 seq
        return { rec: merged, mergedBack: JSON.stringify(merged) !== JSON.stringify(rec) };
      }
    }
    const incWins = (rec.updatedAt || 0) > (cur.updated_at || 0) ||
      ((rec.updatedAt || 0) === (cur.updated_at || 0) && String(rec.deviceId) > String(cur.device_id));
    return incWins ? { rec, mergedBack: false } : null;
  };

  // 樂觀鎖：寫入以「讀到時的 seq」為條件；沒寫進去的（有人搶先寫）重讀重合併，最多再試 2 輪。
  let pending = records;
  let wrote = 0;
  const mergedBack = [];
  let lastSeq = null;
  for (let round = 0; round < 3 && pending.length; round++) {
    const existing = await loadExisting();
    const todo = [];
    for (const rec of pending) {
      const cur = existing.get(rec && rec.id);
      const p = plan(rec, cur);
      if (p) todo.push({ rec: p.rec, prevSeq: cur ? cur.seq : null, mergedBack: p.mergedBack });
    }
    if (!todo.length) break;
    // 先原子預留一段 seq（修掉並發 push 互相覆蓋 groups.seq 的既有競態）
    const g = await env.DB.prepare('UPDATE groups SET seq = seq + ? WHERE id = ? RETURNING seq').bind(todo.length, groupId).first();
    const top = Number(g && g.seq);
    let seq = top - todo.length;
    const stmts = [];
    for (const t of todo) {
      seq += 1;
      const r = t.rec;
      if (t.prevSeq == null) {
        stmts.push(env.DB.prepare(
          `INSERT INTO records (group_id, id, seq, type, updated_at, device_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(group_id, id) DO NOTHING`
        ).bind(groupId, r.id, seq, r.type || null, r.updatedAt || null, r.deviceId || null, JSON.stringify(r)));
      } else {
        stmts.push(env.DB.prepare(
          `UPDATE records SET seq = ?, type = ?, updated_at = ?, device_id = ?, json = ?
            WHERE group_id = ? AND id = ? AND seq = ?`
        ).bind(seq, r.type || null, r.updatedAt || null, r.deviceId || null, JSON.stringify(r), groupId, r.id, t.prevSeq));
      }
    }
    // D1 的 batch() 一次最多約 100 條，超過整批失敗（且錯誤頁沒有 CORS 標頭，瀏覽器只看到
    // 看不懂的「Failed to fetch」）。拆成小批依序送。
    const D1_BATCH_LIMIT = 90;
    const results = [];
    for (let i = 0; i < stmts.length; i += D1_BATCH_LIMIT) {
      const out = await env.DB.batch(stmts.slice(i, i + D1_BATCH_LIMIT));
      results.push(...out);
    }
    const retry = [];
    todo.forEach((t, i) => {
      const ok = results[i] && results[i].meta && results[i].meta.changes > 0;
      if (ok) { wrote += 1; if (t.mergedBack) mergedBack.push(t.rec); }
      else retry.push(t.rec);                                          // 被搶先寫了 → 下一輪重讀重合併
    });
    lastSeq = top;
    pending = retry;
  }
  if (lastSeq == null) {
    const row = await env.DB.prepare('SELECT seq FROM groups WHERE id = ?').bind(groupId).first();
    lastSeq = Number(row && row.seq) || 0;
  }
  // merged：伺服器合併後與送來的不同 → 客戶端立刻套用，不用等下一輪 pull
  return json({ ok: true, seq: lastSeq, wrote, merged: mergedBack });
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
  // 保險：就算 cron 還沒跑到，超期的位置也不會離開伺服器（不改資料庫、只改這次的回應）
  const posCut = Date.now() - POS_TTL_MS;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r && r.type === 'memberPos' && r.lat != null && (r.at || r.updatedAt || 0) < posCut) {
      records[i] = { id: r.id, type: 'memberPos', tripId: r.tripId || null, memberId: r.memberId || null,
        deleted: true, deviceId: r.deviceId || null, updatedAt: r.updatedAt || Date.now() };
    }
  }
  const maxSeq = rows.length ? rows[rows.length - 1].seq : since;
  return json({ records, seq: rows.length === PULL_LIMIT ? maxSeq : group.seq, more: rows.length === PULL_LIMIT });
}

// ---------- /resolve（地圖短網址 → 座標或地名）----------
//
// 這是唯一不需要祕鑰的「對外請求」端點，所以邊界要收得很緊：
//
// 1) **來源與每一跳都走白名單**（只有 Google 的短網址與地圖網域）——不然這裡就成了
//    任意網址的代理／SSRF 跳板；轉址鏈也可能被導去內網或第三方，所以每一跳都要再驗一次。
// 2) **只讀 location 標頭，永遠不讀內容**（redirect:'manual'）。除了不當內容代理之外，
//    還有一個實測到的正確性理由：Google 地圖頁面的 HTML 裡有個 center= 參數，
//    但那是**預設地圖中心**（實測貼蘇澳的連結、HTML 裡卻是台北的座標）——
//    讀 HTML 會回一個看起來很合理、其實完全錯的位置，比解析失敗糟得多。
// 3) 最多 5 跳、每跳 6 秒逾時；回應只有座標或地名字串，不轉發任何其他內容。
// 4) 不記錄使用者貼的網址（沒有任何 log/儲存），回應 no-store。
// 不綁祕鑰是刻意的：單機模式（沒設同步）的使用者也要能用這個功能，而端點本身
// 讀不到、也吐不出任何使用者資料。
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'www.goo.gl']);
const HOP_OK = (h) => SHORT_HOSTS.has(h) || /(^|\.)google\.(com?|[a-z]{2})(\.[a-z]{2})?$/.test(h);

function coordsFromUrl(u) {
  const pats = [
    /@(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,
    /!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/,
    /[?&](?:ll|sll|center|daddr|saddr)=(-?\d{1,2}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/,
    /[?&]q=(?:loc:)?(-?\d{1,2}\.\d{3,})(?:,|%2C)\s*(-?\d{1,3}\.\d{3,})/,
  ];
  for (const p of pats) {
    const m = u.match(p);
    if (!m) continue;
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

async function handleResolve(request, url) {
  const raw = url.searchParams.get('u') || '';
  let target;
  try { target = new URL(raw); } catch { return noStore(json({ error: 'bad url' }, 400)); }
  if (target.protocol !== 'https:' || !SHORT_HOSTS.has(target.hostname)
      || (target.hostname !== 'maps.app.goo.gl' && !/^\/maps\b/.test(target.pathname))) {
    return noStore(json({ error: 'unsupported host' }, 400));
  }

  let current = target.toString();
  for (let hop = 0; hop < 5; hop++) {
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; TripQuest/1.0)', 'accept-language': 'zh-TW,zh;q=0.9' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      });
    } catch { return noStore(json({ error: 'fetch failed' }, 502)); }
    const loc = res.headers.get('location');
    if (!loc) break;                                   // 不再轉址：current 就是最終網址
    let next;
    try { next = new URL(loc, current); } catch { break; }
    if (next.protocol !== 'https:' || !HOP_OK(next.hostname)) {
      return noStore(json({ error: 'redirect blocked' }, 400));   // 轉址跳出白名單就停手
    }
    // Google 對雲端 IP 常在第二跳丟出 /sorry/ 機器人驗證頁，它的 q= 是一串內部 token
    // ——跟進去只會拿到垃圾。上一跳的網址通常已經帶著我們要的東西了。
    if (/^\/sorry\b/.test(next.pathname)) break;
    current = next.toString();
    const hit = readPlace(current);
    if (hit) return noStore(json(hit));                // 拿到座標或地名就停，不用跟到底
  }
  const hit = readPlace(current);
  if (hit) return noStore(json(hit));
  return noStore(json({ error: 'no coords' }, 404));
}

// 從網址讀出「座標」或「地名」。地名要看起來像地名——Google 的內部 token
// （一長串沒有空格與中文的英數字）不能當地名回去，不然客戶端會拿它去查一個不存在的地方。
function readPlace(u) {
  const c = coordsFromUrl(u);
  if (c) return { ...c, src: 'url' };
  let q = '';
  try { q = new URL(u).searchParams.get('q') || ''; } catch { q = ''; }
  if (!q) {
    const m = u.match(/\/maps\/place\/([^/@?]+)/);
    if (m) { try { q = decodeURIComponent(m[1]).replace(/\+/g, ' '); } catch { q = ''; } }
  }
  q = q.trim();
  if (!q) return null;
  const looksLikeToken = q.length > 24 && !/[\s\u3000-\u9fff,]/.test(q);
  if (looksLikeToken) return null;
  return { query: q.slice(0, 200), src: 'name' };
}

function noStore(res) { res.headers.set('cache-control', 'no-store'); return res; }

// ---------- /invite（邀請摘要）----------
// 短邀請連結（v1.58）點開時拿摘要用。只收 Bearer 祕鑰——這個端點的回應含成員名，
// 不讓祕鑰有走 ?s= 進網址記錄的路。no-store：摘要要即時（分享後資料陸續到），
// 也不該被中繼快取留底。摘要計算與 LAN server 共用 js/invite.js。
async function handleInvite(request, env, url, groupId) {
  const secret = bearer(request);
  if (!secret) return json({ error: 'missing secret' }, 400);
  const { error } = await authGroup(env, groupId, secret);
  if (error) return error;
  const rs = await env.DB.prepare('SELECT json FROM records WHERE group_id = ?').bind(groupId).all();
  const recs = (rs.results || []).map((r) => { try { return JSON.parse(r.json); } catch { return null; } });
  const sum = inviteSummary(recs, url.searchParams.get('t') || '');
  if (!sum) return json({ error: 'no trip yet' }, 404);
  const res = json(sum);
  res.headers.set('cache-control', 'no-store');
  return res;
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
