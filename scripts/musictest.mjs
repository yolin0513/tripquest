// 內建配樂（npm run musictest）—— v1.55 曲庫擴充後的落地檢查：
//   ① 21 首 × 6 分類的後設資料一致性；CC BY 維持 6 首不擴大；只有 playful 留在 repo
//   ② 片尾標示：CC BY 兩行（含授權短網址）、CC0/PD 一行（作曲者＋演奏者、不標授權）
//   ③ trackMusic：本機保底曲（playful）能解碼、進 tq-music-v1 快取、給出可錄影的音軌
//   ④ 回憶頁 UI：畫面永遠六列（每分類一首推薦曲）＋ 🔁 換一首 ＋ ▶ 試聽；
//     展開完整曲庫 21 首；合成/手機音樂/無音樂保留；選過的曲目記住（存 musicStyle）
//   ⑤ sw.js 音樂快取白名單；workers/worker.mjs 的 /music 路由唯讀、白名單檔名
//   （R2 線上實際供裝在 sweep 驗，這支不碰網路 —— 端點覆寫成本機）

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5541;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

try {
  // ---------- ⑤ 靜態檢查 ----------
  const sw = readFileSync(ROOT + 'sw.js', 'utf-8');
  yes(/MUSIC_CACHE = 'tq-music-v1'/.test(sw) && sw.includes('k !== MUSIC_CACHE'),
    'sw.js：音樂快取獨立於版本，activate 清快取時放過它');
  yes(!/media\/music\/(warm|travel|porch|tender|jaunty)/.test(sw), 'mp3 沒進 SHELL 預快取');
  const wk = readFileSync(ROOT + 'workers/worker.mjs', 'utf-8');
  yes(wk.includes("\\/music\\/([a-z0-9-]{1,40}\\.mp3)") && wk.includes("request.method !== 'GET' && request.method !== 'HEAD'"),
    'Worker /music 路由：檔名白名單、只開 GET/HEAD（不能變成上傳或列舉破口）');
  const repoFiles = readdirSync(ROOT + 'media/music');
  yes(repoFiles.length === 1 && repoFiles[0] === 'playful.mp3',
    `repo 只留一首離線保底（${repoFiles.join('、')}），其餘走 R2`);

  // 端點覆寫成本機（porch 等 R2 曲會 404 —— 退路行為也順便驗到）
  await page.evaluateOnNewDocument((u) => { window.__TQ_MUSIC_ENDPOINT = u; }, `http://localhost:${WEB}/media/music/`);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- ① 後設資料 ----------
  console.log('— 曲庫結構 —');
  const meta = await page.evaluate(async () => {
    const T = await import('./js/tracks.js');
    const perCat = T.CATEGORIES.map((c) => ({ key: c.key, n: T.tracksOfCat(c.key).length }));
    return {
      total: T.TRACKS.length, cats: T.CATEGORIES.length, perCat,
      ccby: T.TRACKS.filter((t) => t.lic === 'ccby').length,
      free: T.TRACKS.filter((t) => t.lic === 'cc0' || t.lic === 'pd').length,
      locals: T.TRACKS.filter((t) => t.local).map((t) => t.id),
      orphan: T.TRACKS.filter((t) => !T.CATEGORIES.some((c) => c.key === t.cat)).length,
      cWarm: T.musicCredit('track:warm'),
      cClassical: T.musicCredit('track:cl-morning'),
      cModern: T.musicCredit('track:ko-bleu'),
    };
  });
  yes(meta.total >= 20 && meta.total <= 30 && meta.cats === 6,
    `${meta.total} 首 / 6 分類（${meta.perCat.map((x) => x.key + ':' + x.n).join('、')}）`);
  yes(meta.perCat.every((x) => x.n >= 3) && meta.orphan === 0, '每個分類至少 3 首、沒有孤兒分類');
  yes(meta.ccby === 6 && meta.free === meta.total - 6,
    `CC BY 維持 6 首不擴大；其餘 ${meta.free} 首全是 CC0/公有領域`);
  yes(meta.locals.join(',') === 'playful', '離線保底曲只有 playful（走本機檔）');
  yes(meta.cWarm.line2 && meta.cWarm.line2.includes('creativecommons.org/licenses/by/4.0') && meta.cWarm.line2.includes('經轉檔'),
    'CC BY 片尾兩行（含授權短網址、註明修改）');
  yes(meta.cClassical.line2 === null && meta.cClassical.line1.includes('葛利格 曲') && meta.cClassical.line1.includes('Musopen Symphony 演奏'),
    `古典 CC0/PD 片尾一行標作曲者＋演奏者：「${meta.cClassical.line1}」`);
  yes(meta.cModern.line2 === null && meta.cModern.line1.includes('Komiku'),
    `現代 CC0 片尾一行：「${meta.cModern.line1}」`);

  // ---------- ③ 本機保底曲：解碼／快取／音軌 ----------
  console.log('\n— 播放與快取 —');
  const pm = await page.evaluate(async () => {
    const T = await import('./js/tracks.js');
    const m = await T.trackMusic('playful');
    const tracks = m.stream.getAudioTracks().length;
    await m.start();
    await new Promise((r) => setTimeout(r, 300));
    await m.fadeOutStop(0.2);
    const c = await caches.open('tq-music-v1');
    const hit = !!(await c.match(new URL('./media/music/playful.mp3', location.href).href));
    let missErr = '';
    try { await T.ensureTrackCached('porch'); } catch (e) { missErr = String(e.message || e); }
    return { tracks, dur: m.duration, hit, missErr };
  });
  yes(pm.tracks === 1 && pm.dur > 30, `保底曲解碼成功（${Math.round(pm.dur)} 秒）、有可錄影的音軌`);
  yes(pm.hit, '下載後寫進 tq-music-v1 快取');
  yes(pm.missErr.includes('下載失敗'), `R2 曲拿不到時拋明確錯誤（呼叫端據此退回合成）：${pm.missErr}`);

  // ---------- ② 片尾 credit 進 timeline ----------
  console.log('\n— 片尾標示 —');
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mA = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '配樂測試', region: '宜蘭',
      startDate: '2026-08-01', endDate: '2026-08-01', allowWiki: false });
    const sid = uuid(), qid = uuid();
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '景點', emoji: '📍', day: 1, order: 0 });
    await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: '拍一張', kind: 'thing', order: 0 });
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const x = c.getContext('2d'); x.fillStyle = '#4a8'; x.fillRect(0, 0, 800, 600);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    await importPhoto(new File([blob], 'p.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: qid, memberId: mA, allowGeo: false });
    return { tid };
  });
  const credit = await page.evaluate(async (tid) => {
    const M = await import('./js/memory.js');
    const tl1 = await M.buildTimeline(tid, { music: 'track:cl-aria' });
    const tl2 = await M.buildTimeline(tid, { music: 'track:warm' });
    const o = (tl) => tl.segs.find((x) => x.kind === 'outro').credit;
    const r = { c1: o(tl1), c2: o(tl2) };
    tl1.frames.clear(); tl2.frames.clear();
    return r;
  }, ids.tid);
  yes(credit.c1 && credit.c1.line1.includes('詠嘆調') && credit.c1.line1.includes('Kimiko Ishizaka') && credit.c1.line2 === null,
    `古典曲片尾：「${credit.c1 && credit.c1.line1}」（一行、不標授權連結）`);
  yes(credit.c2 && credit.c2.line2 && credit.c2.line2.includes('creativecommons.org'),
    'CC BY 曲片尾照舊兩行');

  // ---------- ④ 回憶頁 UI：永遠六列 ----------
  console.log('\n— 回憶頁 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/album`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.music-pick', { timeout: 15000 });
  const rowsOf = () => page.evaluate(() => ({
    cat: [...document.querySelectorAll('.mp-row:not(.compact)')].map((r) => ({
      cat: r.querySelector('.mp-cat')?.textContent || '',
      title: r.querySelector('.mp-title')?.textContent || '',
      on: !!r.querySelector('button.on'),
      hasAlt: !!r.querySelector('.mp-alt'), hasPrev: !!r.querySelector('.mp-prev'),
    })),
    compact: document.querySelectorAll('.mp-row.compact').length,
    synth: [...document.querySelectorAll('.music-pick > button')].filter((x) => /溫柔|輕快|電影感|民謠/.test(x.textContent)).length,
    hasFile: [...document.querySelectorAll('.music-pick > button')].some((x) => x.textContent.includes('手機裡的音樂')),
    hasNone: [...document.querySelectorAll('.music-pick > button')].some((x) => x.textContent.includes('沒有音樂')),
    hasSrc: [...document.querySelectorAll('.music-pick > button')].some((x) => x.textContent.includes('音樂來源')),
  }));
  let ui = await rowsOf();
  yes(ui.cat.length === 6 && ui.cat.every((r) => r.hasAlt && r.hasPrev),
    `收合狀態永遠六列，每列有 🔁 與 ▶（${ui.cat.map((r) => r.cat).join('、')}）`);
  yes(ui.compact === 0, '完整曲庫收合時不佔空間');
  yes(ui.cat[0].on && ui.cat[0].title.includes('Wholesome'), `新行程預設 ${ui.cat[0].cat}「${ui.cat[0].title}」`);
  yes(ui.synth === 4 && ui.hasFile && ui.hasNone && ui.hasSrc, '合成 4 種、手機音樂、沒有音樂、音樂來源都在');

  // 🔁 換一首：溫暖懷舊列輪替，且因為該分類是目前所選 → 選擇跟著換並存檔
  await page.evaluate(() => document.querySelector('.mp-row:not(.compact) .mp-alt').click());
  await sleep(500);
  ui = await rowsOf();
  const saved1 = await page.evaluate(async (tid) => (await import('./js/store.js')).getRaw(tid).musicStyle, ids.tid);
  yes(ui.cat[0].title.includes('Porch Swing Days') && ui.cat[0].on && saved1 === 'track:porch',
    `🔁 換一首：Wholesome → ${ui.cat[0].title}，選擇跟著換並記住（musicStyle=${saved1}）`);
  await page.evaluate(() => document.querySelector('.mp-row:not(.compact) .mp-alt').click());
  await page.evaluate(() => document.querySelector('.mp-row:not(.compact) .mp-alt').click());
  await sleep(500);
  ui = await rowsOf();
  yes(ui.cat[0].title.includes('Wholesome'), '輪替繞一圈回到第一首');

  // 展開完整曲庫：21 首全列，收起後歸零
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('看完整曲庫')).click());
  await sleep(400);
  ui = await rowsOf();
  yes(ui.compact === 21 && ui.cat.length === 6, `展開後完整曲庫 ${ui.compact} 首（六列推薦照舊）`);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('收起完整曲庫')).click());
  await sleep(300);
  ui = await rowsOf();
  yes(ui.compact === 0, '收起後恢復六列');

  // ▶ 試聽（活潑家庭列的推薦曲是本機的 playful → 離線也試得動）
  await page.evaluate(() => [...document.querySelectorAll('.mp-row:not(.compact)')][3].querySelector('.mp-prev').click());
  await sleep(1500);
  const prev = await page.evaluate(() => [...document.querySelectorAll('.mp-prev')].some((b) => b.textContent.includes('⏹')));
  yes(prev, '按 ▶ 開始試聽、按鈕變 ⏹');
  await page.evaluate(() => [...document.querySelectorAll('.mp-prev')].find((b) => b.textContent.includes('⏹'))?.click());
  await sleep(400);

  // 音樂來源彈窗：全 21 首、授權種類、CC BY 連結
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('音樂來源')).click());
  await page.waitForSelector('.modal-card', { timeout: 8000 });
  const src = await page.evaluate(() => {
    const el = document.querySelector('.modal-card');
    return {
      items: el.querySelectorAll('li').length,
      txt: el.textContent,
      lic: !!el.querySelector('a[href*="creativecommons.org/licenses/by/4.0"]'),
    };
  });
  yes(src.items === 21 && src.lic, `來源彈窗列出全部 ${src.items} 首、有 CC BY 授權連結`);
  yes(src.txt.includes('CC0（免標示）') && src.txt.includes('公有領域（免標示）') && src.txt.includes('Kimiko Ishizaka'),
    '彈窗標明每首的授權種類與演奏者');

  console.log('\n內建配樂測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
