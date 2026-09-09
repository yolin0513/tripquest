#!/usr/bin/env node
// TripQuest 自架同步伺服器 —— 零相依、單一檔案。
// 給不想在 Cloudflare 綁信用卡的人：搭配 Cloudflare Tunnel / Tailscale 打到外網即可。
// 協定與 workers/worker.mjs 完全一致，App 端用同一個 adapter。
//
// 端點（除 /health 外都需要 ?g=<groupId> 與 Authorization: Bearer <groupSecret>）：
//   GET  /health
//   POST /push   {records:[...]}   → { seq, wrote }
//   GET  /pull?since=<seq>         → { records, seq, more }
//   HEAD /blob/<hash>              → 200 / 404
//   GET  /blob/<hash>             → 照片
//   PUT  /blob/<hash>  <binary>   → 上傳
//   PUT / DELETE /album/<albumId>  → 發布 / 收回公開相簿
//   GET  /a/<albumId>[/p/<hash>]   → 公開相簿頁 / 相簿裡的照片（不需要祕鑰）
//
// 執行：node server/index.mjs        （預設埠 8787，或 PORT=9000 node server/index.mjs）
// 資料：server/data/  —— 想全部清空就刪掉這個資料夾。

import { createServer } from 'node:http';
import { inviteSummary } from '../js/invite.js';
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { mergeRecord, sanitizeF } from '../js/merge.js';
import { networkInterfaces } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(__dirname, 'data');
const BLOBS = join(DATA, 'blobs');
const ALBUMS = join(DATA, 'albums');
const STATE_FILE = join(DATA, 'state.json');
const PORT = Number(process.env.PORT || 8787);
const MAX_BLOB = 15_000_000;
const PULL_LIMIT = 500;
const APPEND_ONLY = new Set(['submission', 'reaction', 'comment', 'retraction', 'memberClaim']);

await mkdir(BLOBS, { recursive: true });

// state: { groups: { <id>: { secret, seq, records: { <recId>: {seq, rec} } } } }
let state = { groups: {} };
if (existsSync(STATE_FILE)) {
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch { state = { groups: {} }; }
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFile(STATE_FILE, JSON.stringify(state)).catch(() => {}), 400);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function authGroup(groupId, secret, createIfMissing) {
  let g = state.groups[groupId];
  if (g) {
    if (!timingSafeEqual(g.secret, secret)) return { code: 403, err: 'forbidden' };
    return { g };
  }
  if (!createIfMissing) return { code: 404, err: 'unknown group' };
  // v1.58 起新群組的祕鑰是 base64url 22 字；既有 hex 祕鑰是子集，照舊可用
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(secret)) return { code: 400, err: 'weak secret' };
  g = state.groups[groupId] = { secret, seq: 0, records: {} };
  return { g };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-content-type');
}
const send = (res, code, obj) => { cors(res); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > MAX_BLOB + 1_000_000) { reject(new Error('too large')); req.destroy(); } chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  try {
    if (path === '/health') return send(res, 200, { ok: true, ts: Date.now() });

    // ---- 公開相簿（跟 workers/worker.mjs 同一套；本機開發與測試用）----
    const pub = path.match(/^\/a\/([a-f0-9]{24,64})(?:\/p\/([a-f0-9]{16,64}))?$/);
    if (pub && req.method === 'GET') {
      const meta = join(ALBUMS, pub[1] + '.json');
      if (!existsSync(meta)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('這個相簿不存在，或已經被收回了。'); }
      const info = JSON.parse(await readFile(meta, 'utf8'));
      if (pub[2]) {
        if (!info.hashes.includes(pub[2])) { res.writeHead(404); return res.end('not found'); }
        const f = join(BLOBS, info.groupId, pub[2]);
        if (!existsSync(f)) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
        return createReadStream(f).pipe(res);
      }
      const page = join(ALBUMS, pub[1] + '.html');
      if (!existsSync(page)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('這個相簿還沒做好。'); }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'none'",
      });
      return createReadStream(page).pipe(res);
    }

    // ---- /invite（邀請摘要；只收 Bearer，跟 workers/worker.mjs 同一套）----
    if (path === '/invite' && req.method === 'GET') {
      const gid = u.searchParams.get('g');
      const auth = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      const secret = auth ? auth[1].trim() : '';
      if (!gid || !secret) return send(res, 400, { error: 'missing group or secret' });
      const { g, code, err } = authGroup(gid, secret, false);
      if (err) return send(res, code, { error: err });
      const sum = inviteSummary(Object.values(g.records).map((x) => x.rec), u.searchParams.get('t') || '');
      if (!sum) return send(res, 404, { error: 'no trip yet' });
      cors(res); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(sum));
    }

    const isApi = path === '/push' || path === '/pull' || path.startsWith('/blob/') || path.startsWith('/album/');
    if (isApi) {
      const groupId = u.searchParams.get('g');
      const auth = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      const secret = (auth && auth[1].trim()) || u.searchParams.get('s');
      if (!groupId || !secret) return send(res, 400, { error: 'missing group or secret' });
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(groupId)) return send(res, 400, { error: 'bad group id' });

      // ---- /push ----
      if (path === '/push' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const { g, code, err } = authGroup(groupId, secret, true);
        if (err) return send(res, code, { error: err });
        let wrote = 0;
        const mergedBack = [];
        for (const rec0 of body.records || []) {
          if (!rec0 || !rec0.id || typeof rec0 !== 'object') continue;
          const rec = sanitizeF(rec0);
          const cur = g.records[rec.id];
          let toWrite = rec;
          if (cur) {
            if (APPEND_ONLY.has(rec.type)) continue;
            // v1.56 欄位級合併（js/merge.js，與 Worker、客戶端同一份純函式）
            const { rec: merged, changed } = mergeRecord(cur.rec, rec);
            if (!changed) continue;                     // 結果沒變 → 不寫、不佔 seq
            toWrite = merged;
            if (JSON.stringify(merged) !== JSON.stringify(rec)) mergedBack.push(merged);
          }
          g.seq += 1;
          g.records[rec.id] = { seq: g.seq, rec: toWrite };
          wrote++;
        }
        if (wrote) scheduleSave();
        return send(res, 200, { ok: true, seq: g.seq, wrote, merged: mergedBack });
      }

      // ---- /pull ----
      if (path === '/pull' && req.method === 'GET') {
        const { g, code, err } = authGroup(groupId, secret, false);
        if (err) return send(res, code, { error: err });
        const since = Number(u.searchParams.get('since') || 0);
        const rows = Object.values(g.records).filter((x) => x.seq > since).sort((a, b) => a.seq - b.seq).slice(0, PULL_LIMIT);
        const more = rows.length === PULL_LIMIT;
        const seq = rows.length ? (more ? rows[rows.length - 1].seq : g.seq) : since;
        return send(res, 200, { records: rows.map((x) => x.rec), seq, more });
      }

      // ---- /album ----
      const am = path.match(/^\/album\/([a-f0-9]{24,64})$/);
      if (am) {
        const { code, err } = authGroup(groupId, secret, false);
        if (err) return send(res, code, { error: err });
        await mkdir(ALBUMS, { recursive: true });
        const meta = join(ALBUMS, am[1] + '.json');
        const pageFile = join(ALBUMS, am[1] + '.html');
        if (existsSync(meta)) {
          const cur = JSON.parse(await readFile(meta, 'utf8'));
          if (cur.groupId !== groupId) return send(res, 403, { error: 'forbidden' });
        }
        if (req.method === 'DELETE') {
          if (existsSync(meta)) await rm(meta);
          if (existsSync(pageFile)) await rm(pageFile);
          return send(res, 200, { ok: true, removed: true });
        }
        if (req.method === 'PUT') {
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
          const hashes = [...new Set((body.hashes || []).filter((x) => /^[a-f0-9]{16,64}$/.test(x)))];
          if (!hashes.length || typeof body.html !== 'string') return send(res, 400, { error: 'bad album payload' });
          await writeFile(meta, JSON.stringify({ groupId, albumId: am[1], hashes, title: body.title || '', createdAt: Date.now() }));
          await writeFile(pageFile, body.html);
          return send(res, 200, { ok: true, albumId: am[1], photos: hashes.length });
        }
        return send(res, 405, { error: 'method not allowed' });
      }

      // ---- /blob ----
      const m = path.match(/^\/blob\/([a-f0-9]{16,64})$/);
      if (m) {
        const { code, err } = authGroup(groupId, secret, req.method === 'PUT');
        if (err) return send(res, code, { error: err });
        const dir = join(BLOBS, groupId);
        const file = join(dir, m[1]);
        if (req.method === 'HEAD') { cors(res); res.writeHead(existsSync(file) ? 200 : 404); return res.end(); }
        if (req.method === 'GET') {
          if (!existsSync(file)) return send(res, 404, { error: 'not found' });
          cors(res);
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
          return createReadStream(file).pipe(res);
        }
        if (req.method === 'PUT') {
          const buf = await readBody(req);
          if (buf.length > MAX_BLOB) return send(res, 413, { error: 'too large' });
          await mkdir(dir, { recursive: true });
          await writeFile(file, buf);
          return send(res, 200, { ok: true, bytes: buf.length });
        }
      }
      return send(res, 404, { error: 'not found' });
    }

    // ---- 靜態站（可用 node server/index.mjs 一次開 App + 同步）----
    if (req.method === 'GET') {
      if (/^\/(server|node_modules|scripts|workers|\.git)\b/.test(path)) return send(res, 403, { error: 'forbidden' });
      let rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/index.html';
      const fp = join(ROOT, rel);
      if (fp.startsWith(ROOT) && existsSync(fp) && (await stat(fp)).isFile()) {
        res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
        return createReadStream(fp).pipe(res);
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return createReadStream(join(ROOT, 'index.html')).pipe(res);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  const addrs = ['localhost'];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
  }
  console.log('\nTripQuest 同步伺服器已啟動：\n');
  for (const a of addrs) console.log(`  http://${a}:${PORT}`);
  console.log('\n· 同一個 Wi-Fi：手機用上面的網址開 App，設定 → 多人同步 填同一個網址。');
  console.log('· 要在外網用：另開 `cloudflared tunnel --url http://localhost:' + PORT + '`，把它給的網址填進設定。\n');
  const groups = Object.keys(state.groups).length;
  if (groups) console.log(`（已載入 ${groups} 個群組）\n`);
});
