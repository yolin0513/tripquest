#!/usr/bin/env node
// TripQuest 自架伺服器 —— 零相依、單一檔案。
//
// 用途：把這台電腦當作旅伴之間的「集合點」。大家的手機各自把行程 / 任務 / 照片
//       推上來，也把別人的拉下去，於是不用互傳備份檔就能看到彼此的進度與照片。
//
// 執行：   node server/index.mjs           （預設埠 8787）
//          PORT=9000 node server/index.mjs
//
// 這不需要註冊任何服務，也不需要金鑰。手機要連得到，必須跟電腦在同一個 Wi-Fi，
// 手機端在「設定 → 多人同步」填入本機在區網的網址（啟動時會印出來）。
//
// 資料存放：server/data/records.json（中繼資料）、server/data/blobs/<hash>（照片）
// 想清空就把 server/data 整個刪掉。

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');            // 專案根（拿來當靜態站）
const DATA = join(__dirname, 'data');
const BLOBS = join(DATA, 'blobs');
const RECORDS_FILE = join(DATA, 'records.json');
const PORT = Number(process.env.PORT || 8787);

await mkdir(BLOBS, { recursive: true });

/** @type {Map<string, object>} id -> record */
const records = new Map();
if (existsSync(RECORDS_FILE)) {
  try {
    for (const r of JSON.parse(await readFile(RECORDS_FILE, 'utf8'))) records.set(r.id, r);
    console.log(`載入 ${records.size} 筆既有記錄`);
  } catch { /* 壞檔就重來 */ }
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await writeFile(RECORDS_FILE, JSON.stringify([...records.values()]));
  }, 500);
}

// 後寫入者勝；submission / reaction / comment 只新增
function mergeRecord(inc) {
  if (!inc || !inc.id) return;
  const cur = records.get(inc.id);
  if (!cur) { records.set(inc.id, inc); return; }
  if (['submission', 'reaction', 'comment'].includes(inc.type)) return;
  const incWins = (inc.updatedAt || 0) > (cur.updatedAt || 0) ||
    ((inc.updatedAt || 0) === (cur.updatedAt || 0) && String(inc.deviceId) > String(cur.deviceId));
  if (incWins) records.set(inc.id, inc);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}
const json = (res, code, obj) => { cors(res); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 60 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = decodeURIComponent(u.pathname);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  try {
    if (path === '/health') return json(res, 200, { ok: true, records: records.size, ts: Date.now() });

    if (path === '/push' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      let n = 0;
      for (const r of body.records || []) { mergeRecord(r); n++; }
      scheduleSave();
      return json(res, 200, { ok: true, merged: n, total: records.size });
    }

    if (path === '/pull') {
      const since = Number(u.searchParams.get('since') || 0);
      const out = [...records.values()].filter((r) =>
        (r.updatedAt || r.createdAt || 0) >= since || since === 0);
      return json(res, 200, { records: out, ts: Date.now() });
    }

    const blobMatch = path.match(/^\/blob\/([a-f0-9]{16,64})$/);
    if (blobMatch) {
      const file = join(BLOBS, blobMatch[1]);
      if (req.method === 'PUT') {
        const buf = await readBody(req);
        await writeFile(file, buf);
        return json(res, 200, { ok: true, bytes: buf.length });
      }
      if (req.method === 'GET') {
        if (!existsSync(file)) return json(res, 404, { error: 'not found' });
        cors(res);
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        return createReadStream(file).pipe(res);
      }
    }

    // 其餘：當靜態站服務專案根（讓 `node server/index.mjs` 一鍵同時開 App + 同步）
    if (req.method === 'GET') {
      let rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/index.html';
      const filePath = join(ROOT, rel);
      if (filePath.startsWith(ROOT) && existsSync(filePath) && (await stat(filePath)).isFile()) {
        res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
        return createReadStream(filePath).pipe(res);
      }
      // SPA 後備
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return createReadStream(join(ROOT, 'index.html')).pipe(res);
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  const addrs = ['localhost'];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
  }
  console.log('\nTripQuest 伺服器已啟動：\n');
  for (const a of addrs) console.log(`  http://${a}:${PORT}`);
  console.log('\n手機（同一個 Wi-Fi）用上面其中一個網址開 App；');
  console.log('在「設定 → 多人同步」也填同一個網址即可互相同步。\n');
  void readdir;
});
