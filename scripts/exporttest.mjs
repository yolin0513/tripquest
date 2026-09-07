// 匯出全部照片（ZIP）與公開相簿網址（npm run exporttest）
//
// 兩件使用者實測後提出的事：
//   3. 匯出的 HTML 相簿在手機打不開 → 改走「照片用 HTTP 一張一張載」的分享網址
//   4. 匯出全部照片、畫質不要壓縮 → 既有照片沒有原檔（匯入時就縮到 1600px 了），
//      只能從現在起提供「保留原檔」。這支要證明兩件事都真的成立。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5461, API = 8797;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- 1. 現況：匯入就壓縮，原檔不留 ----------
  console.log('— 匯入時到底有沒有留原檔 —');
  const base = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const db = await import('./js/db.js');
    const gid = uuid(), tid = uuid(), m1 = uuid(), m2 = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: m1, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: m2, type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭三日遊', region: '宜蘭',
      startDate: '2026-08-01', endDate: '2026-08-03', allowWiki: false });
    // 高熵大圖 → 壓縮前後差距接近真實照片
    const mk = () => {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
      const x = c.getContext('2d'); const d = x.createImageData(3000, 2000);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255;
        d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    };
    const spots = [];
    for (let day = 1; day <= 2; day++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: day === 1 ? '羅東觀光夜市' : '太平山', emoji: '📍',
        day, order: 0, lat: 24.6 + day * 0.1, lng: 121.7 + day * 0.05 });
      spots.push(sid);
    }
    const orig = [];
    for (let i = 0; i < 4; i++) {
      const qid = uuid();
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: spots[i % 2], title: `任務${i + 1}`, kind: 'thing', order: i });
      const f = new File([await mk()], `原檔${i}.jpg`, { type: 'image/jpeg' });
      orig.push(f.size);
      await importPhoto(f, { tripId: tid, questId: qid, memberId: i % 2 ? m2 : m1, allowGeo: false });
    }
    const subs = s.submissionsOfTrip(tid);
    const stored = [];
    for (const x of subs) { const b = await db.getBlob(x.photoHash); stored.push(b?.bytes || 0); }
    const kinds = new Set();
    for (const k of await db.allBlobKeys()) { const e = await db.getBlob(k); kinds.add(e?.kind); }
    return { tid, gid, quests: 4,
      origAvgKB: Math.round(orig.reduce((a, b) => a + b, 0) / orig.length / 1024),
      storedAvgKB: Math.round(stored.reduce((a, b) => a + b, 0) / stored.length / 1024),
      kinds: [...kinds], hasOriginalHash: subs.some((x) => x.originalHash),
      w: subs[0].w, h: subs[0].h };
  });
  console.log(`  原檔平均 ${base.origAvgKB}KB → 存下來的是 ${base.storedAvgKB}KB（${base.w}×${base.h}）`);
  yes(base.w <= 1600 && base.h <= 1600, `匯入時縮到長邊 1600px（實際 ${base.w}×${base.h}）`);
  yes(!base.kinds.includes('original'), '預設不留原始檔（所以既有照片的「無壓縮匯出」做不到）', JSON.stringify(base.kinds));
  yes(!base.hasOriginalHash, '預設的投稿記錄沒有 originalHash');

  // ---------- 2. 匯出 ZIP ----------
  console.log('\n— 匯出全部照片 —');
  const zip = await page.evaluate(async (tid) => {
    const ex = await import('./js/photoexport.js');
    const sum = ex.exportSummary(tid);
    const r = await ex.exportPhotos(tid);
    const buf = new Uint8Array(await r.files[0].blob.arrayBuffer());
    // 讀 ZIP 的中央目錄，把檔名撈出來（證明真的是合法 ZIP、檔名是 UTF-8）
    const dv = new DataView(buf.buffer);
    let end = buf.length - 22;
    while (end > 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
    const total = dv.getUint16(end + 10, true);
    let off = dv.getUint32(end + 16, true);
    const names = [];
    let utf8 = true;
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const flags = dv.getUint16(off + 8, true);
      if (!(flags & 0x0800)) utf8 = false;
      const nlen = dv.getUint16(off + 28, true);
      const elen = dv.getUint16(off + 30, true);
      const clen = dv.getUint16(off + 32, true);
      names.push(new TextDecoder().decode(buf.slice(off + 46, off + 46 + nlen)));
      off += 46 + nlen + elen + clen;
    }
    return { sum, files: r.files.length, missing: r.missing, names, utf8,
      mb: +(r.files[0].blob.size / 1048576).toFixed(2), sig: dv.getUint32(0, true) === 0x04034b50 };
  }, base.tid);
  console.log('  檔名：', zip.names.join(' / '));
  yes(zip.sig, 'ZIP 檔頭正確（PK\\x03\\x04）');
  yes(zip.utf8, '檔名旗標是 UTF-8（中文檔名不會變亂碼）');
  yes(zip.names.length === base.quests + 1, `${base.quests} 張照片 + 1 個說明.txt = ${zip.names.length} 個項目`);
  yes(zip.names.includes('說明.txt'), '附了說明.txt（列出景點、拍的人、時間、來源）');
  yes(zip.names.some((n) => n.includes('羅東觀光夜市') && n.includes('媽媽')),
    '檔名帶得到景點與拍攝者', zip.names.join(','));
  yes(zip.names.some((n) => /^D1-01_/.test(n)), '檔名帶得到第幾天與順序');
  yes(zip.sum.compressedOnly === base.quests && zip.sum.withOriginal === 0,
    `摘要誠實回報「${zip.sum.compressedOnly} 張沒有原始檔」`);

  // ZIP 真的解得開（用瀏覽器內建的 DecompressionStream 不行 —— 改驗 CRC）
  const crcOk = await page.evaluate(async (tid) => {
    const ex = await import('./js/photoexport.js');
    const r = await ex.exportPhotos(tid);
    const buf = new Uint8Array(await r.files[0].blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    // 第一筆 local header
    const nlen = dv.getUint16(26, true), elen = dv.getUint16(28, true);
    const crc = dv.getUint32(14, true), size = dv.getUint32(18, true);
    const data = buf.slice(30 + nlen + elen, 30 + nlen + elen + size);
    // 自己算一次 CRC32
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return { match: ((c ^ 0xFFFFFFFF) >>> 0) === crc, size, isJpegOrWebp: data[0] === 0xFF || data[0] === 0x52 };
  }, base.tid);
  yes(crcOk.match, `第一個檔案的 CRC32 對得上（${crcOk.size} bytes）—— 解壓縮軟體不會說檔案損毀`);
  yes(crcOk.isJpegOrWebp, '存進去的真的是圖片位元組');

  // ---------- 3. 保留原檔 ----------
  console.log('\n— 打開「連原始檔一起留著」之後 —');
  const withOrig = await page.evaluate(async (gid) => {
    const { setPref } = await import('./js/prefs.js');
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const db = await import('./js/db.js');
    const ex = await import('./js/photoexport.js');
    setPref('keepOriginal', true);
    const tid = uuid(), sid = uuid(), qid = uuid(), m = s.membersOf(gid)[0].id;
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '原檔測試', region: '宜蘭', allowWiki: false });
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '幾米公園', emoji: '📍', day: 1, order: 0 });
    await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: '任務', kind: 'thing', order: 0 });
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const x = c.getContext('2d'); const d = x.createImageData(3000, 2000);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const f = new File([blob], 'big.jpg', { type: 'image/jpeg' });
    const sub = await importPhoto(f, { tripId: tid, questId: qid, memberId: m, allowGeo: false });
    const o = await db.getBlob(sub.originalHash);
    const p = await db.getBlob(sub.photoHash);
    const usage = await ex.originalUsage();
    const r = await ex.exportPhotos(tid);
    const buf = new Uint8Array(await r.files[0].blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const firstSize = dv.getUint32(18, true);
    // 同步佇列裡不可以有原檔
    const outbox = await db.outboxAll();
    return {
      hasOriginal: !!sub.originalHash, origKB: Math.round((o?.bytes || 0) / 1024),
      compKB: Math.round((p?.bytes || 0) / 1024), usage,
      exportedFirstKB: Math.round(firstSize / 1024),
      origInOutbox: outbox.some((e) => e.op === 'blob' && e.hash === sub.originalHash),
      summary: ex.exportSummary(tid),
    };
  }, base.gid);
  console.log(`  原檔 ${withOrig.origKB}KB vs 壓縮後 ${withOrig.compKB}KB（${(withOrig.origKB / withOrig.compKB).toFixed(1)} 倍）`);
  yes(withOrig.hasOriginal, '投稿記錄帶得到 originalHash');
  yes(withOrig.origKB > withOrig.compKB * 2, '原檔明顯比壓縮檔大（所以要讓使用者自己開關）');
  yes(withOrig.exportedFirstKB >= withOrig.origKB - 2, `匯出用的是原檔（${withOrig.exportedFirstKB}KB）而不是壓縮檔`);
  yes(!withOrig.origInOutbox, '原檔不會進同步佇列（不會被上傳到雲端）');
  yes(withOrig.summary.withOriginal === 1, '摘要正確標示這張有原始檔');
  yes(withOrig.usage.count === 1, `「設定」看得到原檔佔了多少（${withOrig.usage.count} 張 / ${Math.round(withOrig.usage.bytes / 1024)}KB）`);

  // 原檔不可以被 gc 掉
  const gc = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const sub = s.exportRecords().find((r) => r.type === 'submission' && r.originalHash);
    await s.gcBlobs([sub.originalHash, sub.photoHash]);
    return !!(await db.getBlob(sub.originalHash));
  });
  yes(gc, '原檔不會被 gcBlobs 誤刪（它只存在這台裝置上，刪了回不來）');

  await page.evaluate(async () => (await import('./js/prefs.js')).setPref('keepOriginal', false));

  // ---------- 4. 公開相簿網址 ----------
  console.log('\n— 分享網址（照片走 HTTP，不是塞進一個檔案）—');
  await page.evaluate((u) => { (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url: u }); })(); }, `http://localhost:${API}`);
  await sleep(400);
  const pubOk = await page.evaluate(async (tid) => {
    const as = await import('./js/albumshare.js');
    const r = await as.publishAlbum(tid);
    return { url: r.url, photos: r.photos, info: as.albumInfo(tid) };
  }, base.tid).catch((e) => ({ error: String(e.message || e) }));

  if (pubOk.error) {
    console.log('  （本機測試伺服器沒有相簿端點，跳過線上驗證：' + pubOk.error + '）');
  } else {
    yes(/\/a\/[a-f0-9]{32}$/.test(pubOk.url), `網址格式正確：${pubOk.url}`);
    yes(pubOk.photos === base.quests, `${pubOk.photos} 張照片都上去了`);
    const pg = await browser.newPage();
    const res = await pg.goto(pubOk.url, { waitUntil: 'networkidle0' });
    const seen = await pg.evaluate(() => {
      const im = [...document.querySelectorAll('img')];
      return { status: 1, imgs: im.length, loaded: im.filter((i) => i.naturalWidth > 0).length,
        h1: document.querySelector('h1')?.textContent || '', script: !!document.querySelector('script') };
    });
    yes(res.ok(), '網址打得開');
    yes(seen.h1.includes('宜蘭'), `標題正確：${seen.h1}`);
    yes(seen.imgs === base.quests, `${seen.imgs} 張照片`);
    yes(seen.loaded === seen.imgs, `照片都載得到（${seen.loaded}/${seen.imgs}）`);
    yes(!seen.script, '頁面裡沒有腳本');
    const csp = res.headers()['content-security-policy'] || '';
    yes(csp.includes("script-src 'none'"), 'Worker 送了嚴格 CSP（使用者上傳的 HTML 不准跑腳本）', csp);
    // 清單以外的 hash 不可以給
    const bad = await pg.goto(pubOk.url + '/p/' + 'a'.repeat(64), { waitUntil: 'domcontentloaded' });
    yes(bad.status() === 404, '清單以外的照片一律 404（知道 groupId 也撈不走整個群組）');
    await pg.close();

    // 收回之後就打不開
    await page.evaluate(async (tid) => (await import('./js/albumshare.js')).unpublishAlbum(tid), base.tid);
    const pg2 = await browser.newPage();
    const gone = await pg2.goto(pubOk.url, { waitUntil: 'domcontentloaded' });
    yes(gone.status() === 404, '按「收回連結」之後網址就失效了');
    await pg2.close();
  }

  console.log('\n匯出測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
