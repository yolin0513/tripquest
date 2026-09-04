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
//
// 執行：node server/index.mjs        （預設埠 8787，或 PORT=9000 node server/index.mjs）
// 資料：server/data/  —— 想全部清空就刪掉這個資料夾。

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(__dirname, 'data');
const BLOBS = join(DATA, 'blobs');
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
  if (!/^[a-f0-9]{24,64}$/i.test(secret)) return { code: 400, err: 'weak secret' };
  g = state.groups[groupId] = { secret, seq: 0, records: {} };
  return { g };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,HEAD,OPTIONS');
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

    const isApi = path === '/push' || path === '/pull' || path.startsWith('/blob/');
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
        for (const rec of body.records || []) {
          if (!rec || !rec.id || typeof rec !== 'object') continue;
          const cur = g.records[rec.id];
          if (cur) {
            if (APPEND_ONLY.has(rec.type)) continue;
            const incWins = (rec.updatedAt || 0) > (cur.rec.updatedAt || 0) ||
              ((rec.updatedAt || 0) === (cur.rec.updatedAt || 0) && String(rec.deviceId) > String(cur.rec.deviceId));
            if (!incWins) continue;
          }
          g.seq += 1;
          g.records[rec.id] = { seq: g.seq, rec };
          wrote++;
        }
        if (wrote) scheduleSave();
        return send(res, 200, { ok: true, seq: g.seq, wrote });
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
