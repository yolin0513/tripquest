// 回憶影片：閃爍、段落時長、字幕不被切、裁切不砍人、記憶體（npm run videotest）
//
// 使用者第一趟旅程結束後回報：每張照片出現後會「再閃一下」、最後的路線回顧
// 只出現不到一秒、字被切掉、人被裁掉。這支把那四件事都釘住。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5451;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

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

  // 三天、六個景點、兩個人；照片刻意混直式 / 橫式 / 正方形
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '阿公' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭三日遊', region: '宜蘭',
      startDate: '2026-08-01', endDate: '2026-08-03', allowWiki: false });

    // 各種長寬比：9:16 直式、3:4 直式、4:3 橫式、1:1 正方
    const SHAPES = [[900, 1600], [1200, 1600], [1600, 1200], [1400, 1400]];
    const mk = (i) => {
      const [w, hh] = SHAPES[i % SHAPES.length];
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w, hh);
      g.addColorStop(0, `hsl(${(i * 47) % 360},70%,58%)`);
      g.addColorStop(1, `hsl(${(i * 47 + 60) % 360},60%,32%)`);
      x.fillStyle = g; x.fillRect(0, 0, w, hh);
      x.fillStyle = '#fff'; x.font = `${Math.round(w / 6)}px sans-serif`;
      x.textAlign = 'center'; x.fillText(String(i + 1), w / 2, hh / 2);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    };

    const spots = [];
    let n = 0;
    for (let d = 1; d <= 3; d++) {
      for (let k = 0; k < 2; k++) {
        const sid = uuid();
        await s.put({ id: sid, type: 'spot', tripId: tid, name: `第${d}天的第${k + 1}個景點`, emoji: '📍',
          day: d, order: k, lat: 24.6 + d * 0.06 + k * 0.02, lng: 121.7 + k * 0.05 + d * 0.01 });
        spots.push(sid);
        for (let j = 0; j < 3; j++) {
          const qid = uuid();
          await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid,
            title: j === 0 ? '這是一個非常非常長的任務標題用來測試字幕會不會被畫面邊界切掉喔喔喔' : `任務${n + 1}`,
            kind: 'thing', order: j, source: j === 1 ? 'must' : 'auto' });
          await importPhoto(new File([await mk(n)], 'p.jpg', { type: 'image/jpeg' }),
            { tripId: tid, questId: qid, memberId: n % 2 ? mB : mA, allowGeo: false });
          n++;
        }
      }
    }
    return { tid, photos: n, spots: spots.length, members: [mA, mB] };
  });
  console.log(`  種了 ${ids.photos} 張照片 / ${ids.spots} 個景點\n`);

  // ---------- 1. 段落時長 ----------
  console.log('— 段落時長 —');
  const tl = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const out = {};
    for (const key of ['short', 'full']) {
      const t = await mem.buildTimeline(tid, { length: key });
      const byKind = {};
      for (const s of t.segs) byKind[s.kind] = +((byKind[s.kind] || 0) + s.dur).toFixed(2);
      const map = t.segs.find((s) => s.kind === 'map');
      out[key] = { total: +t.total.toFixed(1), photos: t.photoCount, totalPhotos: t.totalPhotos,
        byKind, mapDur: map?.dur ?? 0, mapShare: +(((map?.dur || 0) / t.total) * 100).toFixed(1) };
    }
    return out;
  }, ids.tid);
  for (const [k, v] of Object.entries(tl)) {
    console.log(`  ${k}: ${v.total}s（${(v.total / 60).toFixed(1)} 分）· 照片 ${v.photos}/${v.totalPhotos} · 地圖 ${v.mapDur}s = ${v.mapShare}%`);
  }
  yes(tl.short.total < tl.full.total, '精華版比完整版短', `${tl.short.total} vs ${tl.full.total}`);
  yes(tl.short.total <= 200, `精華版控制在 3 分半以內（${tl.short.total}s）`);
  yes(tl.full.photos === ids.photos, '完整版一張都不漏');
  yes(tl.short.mapDur >= 6.5, `地圖段至少 6.5 秒（現在 ${tl.short.mapDur}s，舊版固定 5.5s）`);
  yes(tl.short.mapShare >= 3, `地圖在精華版佔比 ≥3%（${tl.short.mapShare}%）`);

  // 長片的地圖不可以被壓到看不見
  const longMap = await page.evaluate(async () => {
    const mem = await import('./js/memory.js');
    return { d20: mem.mapDur(20), d6: mem.mapDur(6), d2: mem.mapDur(2) };
  });
  yes(longMap.d20 > longMap.d6 && longMap.d6 > longMap.d2, '景點越多，地圖段越長', JSON.stringify(longMap));

  // ---------- 2. 交界不可以閃 ----------
  console.log('\n— 照片交界（使用者回報的「再閃一下」）—');
  const flash = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const c = document.createElement('canvas');
    const p = await mem.createPlayer(c, tid, { length: 'full' });
    const t0 = await mem.buildTimeline(tid, { length: 'full' });
    const photoSegs = t0.segs.filter((s) => s.kind === 'photo');
    // 等前幾張真的解碼完
    await new Promise((r) => setTimeout(r, 1200));
    const ctx = c.getContext('2d');
    const lumAt = (t) => {
      p.seek(t);
      const d = ctx.getImageData(360, 620, 360, 680).data;
      let l = 0; for (let i = 0; i < d.length; i += 4) l += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return l / (d.length / 4);
    };
    const out = [];
    // 只看前 4 個交界（後面的圖還沒預抓進來）
    for (let i = 0; i < Math.min(4, photoSegs.length - 1); i++) {
      const b = photoSegs[i + 1].start;
      await new Promise((r) => setTimeout(r, 500));
      const before = lumAt(b - 0.05);
      const after = lumAt(b + 0.05);
      const mid = lumAt(b + 0.2);
      out.push({ i, b: +b.toFixed(2), before: Math.round(before), after: Math.round(after), mid: Math.round(mid) });
    }
    p.destroy();
    return out;
  }, ids.tid);
  for (const f of flash) {
    const drop = f.before - Math.min(f.after, f.mid);
    yes(drop < 25, `交界 ${f.i + 1}（t=${f.b}s）沒有掉到黑：${f.before} → ${f.after} → ${f.mid}`,
      `亮度掉了 ${drop}，這就是使用者說的「再閃一下」`);
  }

  // ---------- 3. 字幕不可以被切掉 ----------
  console.log('\n— 文字排版 —');
  const text = await page.evaluate(async () => {
    const mem = await import('./js/memory.js');
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
    const ctx = c.getContext('2d');
    const cases = [
      ['短的', '羅東夜市'],
      ['很長的任務標題', '這是一個非常非常長的任務標題用來測試字幕會不會被畫面邊界切掉喔喔喔'],
      ['英文夾雜', 'Luodong Night Market 羅東觀光夜市 must-try 蔥油餅'],
      ['超長 AI 旁白', '第二天我們一路往山上走，霧氣在樹梢之間流動，孩子在步道上跑得比誰都快，那天的空氣特別乾淨'],
    ];
    return cases.map(([name, s]) => {
      const f = mem.fitText(ctx, s, { maxW: 940, maxLines: 3, size: 58, min: 34, weight: 700 });
      ctx.font = `700 ${f.size}px sans-serif`;
      const widest = Math.max(...f.lines.map((l) => ctx.measureText(l).width));
      return { name, size: f.size, lines: f.lines.length, widest: Math.round(widest),
        cut: f.lines.some((l) => l.endsWith('…')), joined: f.lines.join('') };
    });
  });
  for (const t of text) {
    yes(t.widest <= 941, `「${t.name}」不會超出邊界（最寬 ${t.widest} ≤ 940，字級 ${t.size}，${t.lines} 行）`);
    if (t.name !== '超長 AI 旁白') yes(!t.cut, `「${t.name}」是縮字級／換行，不是砍字`, t.joined);
  }

  // ---------- 4. 裁切不可以砍到人 ----------
  console.log('\n— 照片裁切 —');
  const fit = await page.evaluate(async () => {
    const mem = await import('./js/memory.js');
    return {
      p916: mem.fitMode(900, 1600),   // 手機直拍 → 剛好，可以 cover
      p34: mem.fitMode(1200, 1600),   // 3:4 直式 → 只裁一點，cover
      l43: mem.fitMode(1600, 1200),   // 4:3 橫式 → cover 只剩 42%，一定要 contain
      sq: mem.fitMode(1400, 1400),    // 正方 → contain
      pano: mem.fitMode(3000, 1000),  // 全景 → contain
    };
  });
  yes(fit.p916 === 'cover', '9:16 直拍：滿版（不浪費畫面）');
  yes(fit.p34 === 'cover', '3:4 直拍：滿版');
  yes(fit.l43 === 'contain', '4:3 橫拍：改成完整放進畫面 + 糊化背景（不裁掉人）');
  yes(fit.sq === 'contain', '正方形：完整放進畫面');
  yes(fit.pano === 'contain', '全景：完整放進畫面');

  // 橫式照片畫出來後，畫面左右應該是糊化的背景而不是被切掉的照片主體
  const drawn = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const c = document.createElement('canvas');
    const p = await mem.createPlayer(c, tid, { length: 'full' });
    const t = await mem.buildTimeline(tid, { length: 'full' });
    // 第 3 張是 4:3 橫式
    const seg = t.segs.filter((s) => s.kind === 'photo')[2];
    await new Promise((r) => setTimeout(r, 1500));
    p.seek(seg.start + 1.2);
    const ctx = c.getContext('2d');
    const band = (y) => { const d = ctx.getImageData(0, y, 1080, 2).data; let l = 0;
      for (let i = 0; i < d.length; i += 4) l += (d[i] + d[i + 1] + d[i + 2]) / 3; return l / (d.length / 4); };
    // 照片本體在中間、上下應該是暗的糊化背景
    const r = { top: Math.round(band(120)), midY: Math.round(band(940)), bot: Math.round(band(1500)) };
    p.destroy();
    return r;
  }, ids.tid);
  yes(drawn.midY > drawn.top + 8, '橫式照片：本體在中間、上方是壓暗的糊化背景',
    `top=${drawn.top} mid=${drawn.midY} bot=${drawn.bot}`);

  // ---------- 5. 記憶體：不可以一次全部解碼 ----------
  console.log('\n— 記憶體 —');
  const memr = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const t = await mem.buildTimeline(tid, { length: 'full' });
    await t.frames.ensure(0);
    t.frames.prefetch(0);
    await new Promise((r) => setTimeout(r, 900));
    const early = t.frames.imgs.size;
    // 假裝播到中間
    t.frames.prefetch(10); t.frames.release(10);
    await new Promise((r) => setTimeout(r, 900));
    return { total: t.photoCount, held: t.frames.imgs.size, early };
  }, ids.tid);
  yes(memr.held <= 8, `同時只握著 ${memr.held} 張（共 ${memr.total} 張），不是全部解碼`,
    `舊版一次載入全部：60 張＝390MB、170 張＞1GB`);

  // ---------- 6. 精華版要涵蓋每個景點與每個人 ----------
  console.log('\n— 精華版挑照片 —');
  const hl = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const all = mem.collectSlides(tid);
    const pick = mem.pickHighlights(all, 8);
    return {
      n: pick.length,
      spotsAll: new Set(all.map((s) => s.spotId)).size,
      spotsPick: new Set(pick.map((s) => s.spotId)).size,
      memAll: new Set(all.map((s) => s.memberId)).size,
      memPick: new Set(pick.map((s) => s.memberId)).size,
      sorted: pick.every((s, i) => i === 0 || pick[i - 1].takenAt <= s.takenAt || pick[i - 1].day <= s.day),
    };
  }, ids.tid);
  yes(hl.spotsPick === hl.spotsAll, `每個景點都有代表照（${hl.spotsPick}/${hl.spotsAll}）`);
  yes(hl.memPick === hl.memAll, `每個人都出現到（${hl.memPick}/${hl.memAll}）`);
  yes(hl.sorted, '挑完仍照時間順序排');

  // ---------- 7. 相簿頁大小 ----------
  console.log('\n— 相簿頁（單檔 HTML）—');
  const alb = await page.evaluate(async (tid) => {
    const mem = await import('./js/memory.js');
    const r = await mem.buildAlbumPage(tid);
    return { mb: +(r.blob.size / 1048576).toFixed(2), count: r.count, missing: r.missing,
      hasScript: (await r.blob.text()).includes('<script') };
  }, ids.tid);
  console.log(`  ${alb.count} 張 → ${alb.mb} MB（每張約 ${(alb.mb * 1024 / alb.count).toFixed(0)} KB）`);
  yes(alb.missing === 0, '沒有照片被漏掉');
  yes(!alb.hasScript, '相簿頁不含 <script>（分享網址那條路會被 CSP 擋掉腳本）');

  // ---------- 重複照片：影片去重＋介面講清楚；重新產生一定納入新照片 ----------
  console.log('\n— 張數與重新產生 —');
  const dup = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const mem = await import('./js/memory.js');
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = `hsl(${i},60%,50%)`; x.fillRect(0, 0, 300, 200); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); };
    const q = s.questsOfTrip(tid)[0];
    const mA = s.membersOf(s.get(tid).groupId)[0].id;
    const sameBlob = await mk(123);
    await importPhoto(new File([sameBlob], 'x.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: mA, allowGeo: false });
    const before = mem.collectSlides(tid).length;
    // 同一張圖再傳一次（重複內容）＋一張全新的
    await importPhoto(new File([sameBlob], 'x2.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: mA, allowGeo: false });
    await importPhoto(new File([await mk(321)], 'y.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: mA, allowGeo: false });
    const after = mem.collectSlides(tid).length;
    const tl = await mem.buildTimeline(tid, { length: 'full' });
    return { before, after, tlPhotos: tl.photoCount, subs: s.submissionsOfTrip(tid).length };
  }, ids.tid);
  yes(dup.after === dup.before + 1 && dup.tlPhotos === dup.after,
    `重新產生一定重新蒐集：新照片入片、重複內容只放一次（投稿 ${dup.subs}、影片 ${dup.tlPhotos}）`);
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/album'; }, ids.tid);
  await page.waitForSelector('.len-pick', { timeout: 15000 });
  const lenNote = () => page.evaluate(() =>
    [...document.querySelectorAll('.form-hint')].map((x) => x.textContent).find((t) => t.includes('張')) || '');
  const noteS = await lenNote();                        // 預設精華版（這組資料照片少 → 走「一張都不會少」分支）
  yes(noteS.includes('內容重複') && noteS.includes('同一張只放一次'),
    `介面講清楚重複張數：「${noteS.slice(noteS.indexOf('（'), noteS.indexOf('）') + 1)}」`);
  // 取樣說明的文案（照片多才會出現）用原始碼守衛，避免被改掉
  {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(ROOT + 'js/views/album.js', 'utf8');
    yes(src.includes('不是每張都會入選') && src.includes('必拍任務的照片優先'),
      '精華版取樣規則文案在（讚/說明/必拍優先、不是每張都入選）');
  }
  await page.evaluate(() => [...document.querySelectorAll('.len-btn')].find((b) => b.textContent.includes('完整版'))?.click());
  await new Promise((r) => setTimeout(r, 400));
  const noteF = await lenNote();
  yes(noteF.includes('不重複的照片都放進去') && noteF.includes('內容重複'), '完整版：講明「全部不重複的照片都放進去」＋重複張數');

  console.log('\n影片測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
