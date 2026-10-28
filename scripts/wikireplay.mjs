// 讓瀏覽器測試不必打真的 Wikimedia（共用慣例 §5.6：打真網路的測試不進 npm test）。
//
// 每一頁裝一個攔截器，所有往 wikipedia.org／wikimedia.org 的請求都經過它：
//   replay（預設）：照錄好的回應回答；沒錄到的網址**不連網**，記進 misses，測試最後要斷言 misses 是 0 並點名
//   record（--record）：照常連網，把 API 的回應存成樣本檔（圖片不存，回放時給一張合成的 JPEG）
//   live（--live）：照常連網、不存檔——npm run imgtest:live，不在鏈上
// 測試要模擬「連不到 Wikimedia」時設 w.offline = true（三種模式都一樣擋掉），不要另裝攔截器
// （同一頁兩個攔截器會搶同一個請求，先到的贏，結果看註冊順序）。
import fs from 'node:fs';
import path from 'node:path';

const WIKI = /^https:\/\/[^/]*(wikipedia\.org|wikimedia\.org)\//;
const IMG = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;   // 圖檔主機（API 回的縮圖網址兩種都有）

export function wikiMode(argv = process.argv) {
  return argv.includes('--record') ? 'record' : argv.includes('--live') ? 'live' : 'replay';
}

export function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || typeof raw.responses !== 'object' || !Object.keys(raw.responses).length) throw new Error(`樣本檔是空的或格式不對：${file}`);
  return raw;
}

// fake：回放時給圖片請求的合成 JPEG（Buffer）
export async function installWiki(page, { mode, fixture, fake, saved }) {
  const w = { offline: false, calls: 0, blocked: [], misses: [] };
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    const url = r.url();
    if (!WIKI.test(url)) { r.continue().catch(() => {}); return; }
    w.calls++;
    if (w.offline) { w.blocked.push(url); r.abort().catch(() => {}); return; }
    if (mode === 'replay') {
      if (IMG.test(url)) { r.respond({ status: 200, contentType: 'image/jpeg', body: fake, headers: { 'access-control-allow-origin': '*' } }).catch(() => {}); return; }
      const hit = fixture.responses[url];
      if (!hit) { w.misses.push(url); r.abort().catch(() => {}); return; }
      r.respond({ status: hit.status, contentType: hit.contentType, body: hit.body, headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
      return;
    }
    r.continue().catch(() => {});
  });
  if (mode === 'record') {
    page.on('response', async (res) => {
      const url = res.url();
      if (!WIKI.test(url) || IMG.test(url) || res.request().method() !== 'GET') return;
      try { saved[url] = { status: res.status(), contentType: res.headers()['content-type'] || 'application/json', body: await res.text() }; } catch { /* 預檢之類拿不到本文的，跳過 */ }
    });
  }
  return w;
}

export function saveFixture(file, saved) {
  const n = Object.keys(saved).length;
  if (!n) throw new Error('錄製模式一筆回應都沒存到——不寫檔（不要用空的樣本檔蓋掉舊的）');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(saved).sort().map((k) => [k, saved[k]]));
  fs.writeFileSync(file, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), responses: sorted }, null, 1) + '\n');
  return n;
}
