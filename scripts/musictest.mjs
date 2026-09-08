// 內建配樂（npm run musictest）—— 三代理 3:0 通過的授權方案落地檢查：
//   ① tracks.js 的曲目後設資料 ↔ media/music/ 實際檔案一一對應、大小合理
//   ② trackMusic：能下載、解碼、循環、給出可加進錄影的音軌；快取寫進 tq-music-v1
//   ③ 片尾授權標示：buildTimeline 選內建曲目時 outro 段帶 credit
//     （作者、曲名、授權短網址、經轉檔 —— CC BY 4.0 的要求，跟著影片走）
//   ④ 回憶頁 UI：內建曲目可選可試聽、合成/手機音樂/無音樂還在、
//     「音樂來源與授權」列出全部曲目與授權連結；新行程預設內建「溫暖懷舊」
//   ⑤ sw.js：music 快取獨立於版本、activate 清快取時要放過它（不然每次升版重抓 15MB）

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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
  // ---------- ⑤ sw.js 靜態檢查（不用瀏覽器） ----------
  const sw = readFileSync(ROOT + 'sw.js', 'utf-8');
  yes(/MUSIC_CACHE = 'tq-music-v1'/.test(sw) && sw.includes("k !== MUSIC_CACHE"),
    'sw.js：音樂快取獨立於版本，activate 清快取時放過它');
  yes(sw.includes("/media/music/"), 'sw.js：/media/music/ 走 cache-first 的音樂快取');
  yes(sw.includes("'./js/tracks.js'"), 'sw.js：tracks.js 在 SHELL 預快取清單裡');
  yes(!sw.includes('media/music/warm'), 'mp3 沒有被放進 SHELL 預快取（15MB 不該人人預載）');

  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- ① 後設資料 ↔ 檔案 ----------
  console.log('— 曲目資料 —');
  const meta = await page.evaluate(async () => {
    const T = await import('./js/tracks.js');
    const out = [];
    for (const t of T.TRACKS) {
      const r = await fetch('./media/music/' + t.file, { method: 'HEAD' });
      out.push({ id: t.id, title: t.title, mood: t.mood, okFile: r.ok, size: +r.headers.get('content-length') || 0 });
    }
    return { list: out, artist: T.TRACK_ARTIST, url: T.TRACK_LICENSE_URL,
      credit: T.musicCredit('track:warm'), noCredit: T.musicCredit('gentle') };
  });
  yes(meta.list.length >= 4 && meta.list.length <= 8, `曲目數 ${meta.list.length}（要求 4～8）`);
  yes(meta.list.every((x) => x.okFile && x.size > 500000), '每首的檔案都在、都 > 0.5MB',
    JSON.stringify(meta.list.filter((x) => !x.okFile || x.size <= 500000)));
  const total = meta.list.reduce((a, x) => a + x.size, 0);
  yes(total < 20 * 1048576, `總大小 ${(total / 1048576).toFixed(1)}MB（< 20MB、不預載）`);
  const moods = new Set(meta.list.map((x) => x.mood));
  yes(moods.size >= 4, `情緒涵蓋 ${moods.size} 種：${[...moods].join('、')}`);
  yes(meta.artist.includes('Kevin MacLeod') && meta.url.includes('creativecommons.org/licenses/by/4.0'),
    '作者與授權連結由單一常數提供');
  yes(meta.credit && meta.credit.line1.includes('Wholesome') && meta.credit.line1.includes('Kevin MacLeod')
    && meta.credit.line2.includes('creativecommons.org/licenses/by/4.0') && meta.credit.line2.includes('經轉檔'),
    `片尾標示齊全（曲名/作者/授權連結/註明修改）：「${meta.credit && meta.credit.line1}」`);
  yes(meta.noCredit === null, '合成音樂不標（是自己生成的，沒有出處可標）');

  // ---------- ② trackMusic：解碼、音軌、快取 ----------
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
    return { tracks, dur: m.duration, hit };
  });
  yes(pm.tracks === 1 && pm.dur > 30, `解碼成功（${Math.round(pm.dur)} 秒）、有 1 條可錄影的音軌`);
  yes(pm.hit, '下載後寫進 tq-music-v1 快取（之後離線可用）');

  // ---------- ③ 片尾 credit 進 timeline ----------
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
    const tl1 = await M.buildTimeline(tid, { music: 'track:tender' });
    const tl2 = await M.buildTimeline(tid, { music: 'gentle' });
    const o1 = tl1.segs.find((x) => x.kind === 'outro');
    const o2 = tl2.segs.find((x) => x.kind === 'outro');
    tl1.frames.clear(); tl2.frames.clear();
    return { c1: o1 && o1.credit, c2: o2 && o2.credit };
  }, ids.tid);
  yes(credit.c1 && credit.c1.line1.includes('Heartwarming') && credit.c1.line2.includes('creativecommons.org'),
    `選內建曲目 → 片尾段帶標示（${credit.c1 && credit.c1.line1}）`);
  yes(!credit.c2, '選合成音樂 → 片尾不標');

  // ---------- ④ 回憶頁 UI ----------
  console.log('\n— 回憶頁 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/album`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.music-pick', { timeout: 15000 });
  const ui = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.music-pick > button')].map((b) => b.textContent.trim());
    return {
      rows: document.querySelectorAll('.mp-row').length,
      prevBtns: document.querySelectorAll('.mp-prev').length,
      defOn: document.querySelector('.mp-row button.on')?.textContent || '',
      synth: btns.filter((x) => /溫柔|輕快|電影感|民謠/.test(x)).length,
      hasFile: btns.some((x) => x.includes('手機裡的音樂')),
      hasNone: btns.some((x) => x.includes('沒有音樂')),
      hasSrc: btns.some((x) => x.includes('音樂來源')),
    };
  });
  yes(ui.rows === 6 && ui.prevBtns === 6, `六首內建曲目、每首有試聽鈕（${ui.rows}/${ui.prevBtns}）`);
  yes(ui.defOn.includes('溫暖懷舊'), `新行程預設「${ui.defOn}」（真實錄音優先；下載失敗錄影時自動退合成）`);
  yes(ui.synth === 4 && ui.hasFile && ui.hasNone, '合成 4 種、手機音樂、沒有音樂都還在');
  yes(ui.hasSrc, '有「🎼 音樂來源與授權」入口');

  // 試聽：▶ → ⏹，再按停
  await page.evaluate(() => [...document.querySelectorAll('.mp-prev')][4].click());   // playful（已在快取）
  await sleep(1200);
  const prev = await page.evaluate(() => ({
    stopBtn: [...document.querySelectorAll('.mp-prev')].some((b) => b.textContent.includes('⏹')),
  }));
  yes(prev.stopBtn, '按 ▶ 開始試聽、按鈕變 ⏹');
  await page.evaluate(() => [...document.querySelectorAll('.mp-prev')].find((b) => b.textContent.includes('⏹'))?.click());
  await sleep(500);
  const prev2 = await page.evaluate(() => [...document.querySelectorAll('.mp-prev')].every((b) => b.textContent.includes('▶')));
  yes(prev2, '再按一次停止試聽');

  // 音樂來源彈窗：列出全部曲目與授權連結
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('音樂來源')).click());
  await page.waitForSelector('.modal-card', { timeout: 8000 });
  const src = await page.evaluate(() => {
    const el = document.querySelector('.modal-card');
    return {
      txt: el.textContent,
      lic: !!el.querySelector('a[href*="creativecommons.org/licenses/by/4.0"]'),
      inc: !!el.querySelector('a[href*="incompetech.com"]'),
    };
  });
  yes(src.lic && src.inc, '音樂來源彈窗有授權條款與 incompetech 連結');
  yes(['Wholesome', 'Carefree', 'Fluffing a Duck', 'Heartwarming', 'Porch Swing Days', 'Wallpaper']
    .every((t) => src.txt.includes(t)), '彈窗列出全部六首曲名');
  yes(src.txt.includes('Kevin MacLeod') && src.txt.includes('轉檔'), '彈窗標作者並註明有轉檔修改');

  console.log('\n內建配樂測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
