// 回顧影片「預告片」風格（v1.97.0；npm run trailertest；會開瀏覽器）
//
// 涵蓋的程式：js/trailer.js、js/trailerplan.js、js/music.js（createTrailerScore）、js/views/album.js（風格選擇、平穩版、自動降級的說明）、
//   js/memory.js（原本的風格不動：TR09 拿推送過的 d50955a 逐格比對）、js/glyphs.js（剪影、reducedMotion）
//
// 規劃：docs/DESIGN_回顧影片預告片風格.md（第 9 節列的 9 條＋時鐘兩條＋相簿頁兩條）。Yolin 2026-11-19 第 10 節 1～7 選甲。
//
// 驗什麼（編號 TRnn 一律兩位數：突變的 expect 比訊息開頭）：
//   TR01 段落順序與每段的拍數（完整版：照片 ≥ 33 張）＝規劃第 2 節；全片 121 拍＝72.6 秒
//   TR02 切點在拍點上：每一個鏡頭起點都是 0.6 秒的整數倍；而且畫出來的畫面真的在那一刻換（加速段與快剪的硬切：
//        切點前後一格差很多、同一個鏡頭裡相鄰兩格差很少——用 27×36 格的區塊平均比，把顆粒平均掉）
//   TR03 畫面上的每一個字都來自登記的來源：包住 fillText 收整支片子畫過的字（每 0.15 秒一格），逐一拆成
//        行程資料（測試自己從造的資料算，不拿時間軸的字串來比）與固定的詞；母體先證明非空、而且含片名、出品、主演、說明
//   TR04 白閃：快剪段逐格（0.04 秒）量一塊不含字的區域的亮度，數「變成全白」的次數——一般版至少 1 次、相鄰兩次至少隔 2 拍；
//        平穩版 0 次
//   TR05 平穩版：每一張照片在自己的鏡頭裡畫面不變（同一張的 35% 與 55% 兩個時刻，畫面逐位元組相同）、片名卡的字不縮放不收字距；
//        對照組：一般版同樣兩個時刻必須不同
//   TR06 黑邊：上黑邊整片是黑的；下黑邊只有灰階（字幕是白字，照片的顏色不可以滲進來）；母體含有字幕的那幾格
//   TR07 照片少於 8 張：相簿頁的「預告片」按鈕不能按、照實寫「照片少於 8 張，做不出預告片」；剛好 8 張可以按；建播放器丟同一句
//   TR08 自動降級：降級控制器餵慢的格子依序關顆粒 → 景深 → 調色、餵快的格子不動；從相簿頁播放、把畫圖故意放慢，畫面上出現說明
//   TR09 原本的風格逐格相同：同一份合成資料，原本風格取 12 個時刻，跟 d50955a（推送過的 v1.96.0）逐位元組比；對照組：不同時刻必須不同、
//        目前版本在另一個全新來源量的必須相同；前置（獨立一條「TR09 前置」）：三份種出來的照片位元組相同（三份都用全新的來源，見 CUR_WEB）
//   TR10 時鐘：配樂的音訊時鐘在走，畫面跟音訊時鐘（不跟牆上時鐘）
//   TR11 時鐘：音訊時鐘一開始就沒在走、或播放中停住超過半秒 → 改看牆上時鐘、從停住的地方接著走（不然錄影永遠等不到片尾）
//   TR12 相簿頁：選「預告片」→ 長度選項收起、出現預告片配樂；選擇只存在這支手機（trip.musicStyle 不動）；重新整理還記得；
//        選別的配樂照實寫「這首不會對拍」；切回經典一切照舊
//   TR13 減少動態效果：相簿頁寫明預覽是平穩版、存影片預設平穩版、有「改做完整版」；預覽真的是平穩版（拖進度條到同一張的兩個時刻，畫面相同）
//   TR14 TR03 的檢查器自己的對照組（沒登記的字判沒登記、片名與換行切開的片名判有登記）
//   TR15 時鐘：真的播預告片配樂（js/music.js 的 createTrailerScore）2 秒，畫面一直跟著音訊時鐘、時間有往前走——
//        TR10／TR11 用的是假的時鐘，這一條走播放器的對外介面、真的 AudioContext
// 沒有任何測試走到的：recordTrailer（錄影要即時錄滿 72.6 秒，每條突變都重跑太貴）；音訊時鐘在真的錄影迴圈裡的行為
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5881, BASE_WEB = 5883;
// TR09 目前版本那兩份各用一個全新的來源（不用 WEB）。①b 診斷（2026-11-19 12:2x）一度推論是「已經種過照片的來源」壓縮不同，
// 後來第 6 組實測全新來源也會不同——真正的原因是 importPhoto 壓縮出來的位元組不固定，所以照片只匯入一次、三份存同一份位元組（檔頭 TR09 那段）。
// 三個比對用的伺服器一次只開一個（13:3x，見 serveOn）：同時開會超過本 repo 4 個工作程序的上限。
const CUR_WEB = 5885, CUR_WEB2 = 5886;
const BASE_COMMIT = 'd50955a';         // v1.96.0（推送過的）：原本的風格要跟它逐格相同
const FIXED = ['出品', '主演', 'TripQuest', '個人', '天', '年', '月', '照片少於', '張，做不出預告片'];

let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.log('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
let curWebs = [];   // TR09 比對用的伺服器（一次只有一個活著；finally 把還活著的關掉）
const baseDir = path.join(ROOT, '.logs', `trailertest-base-${process.pid}`);
await sleep(1400);
// 自動播放旗標照 musictest：TR15 要讓程式合成的配樂真的跑起來（不然 AudioContext 停在 suspended、音訊時鐘不走）
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

// ---------- 造資料（兩個網址各造一次，所以寫成可以丟進頁面的函式） ----------
// files（TR09 用）：給了就不走 importPhoto，直接存這一份位元組——importPhoto 對同一張圖每次壓縮出來的位元組不一定相同
// （2026-11-19 12:2x ①b 與 12:27 實測：三個全新來源裡就有一個第 3、7、9 張不同），原本的風格因此差 1～2 階，比不出程式有沒有改。
async function seedTrip(cfg, files = null) {
  const s = await import('./js/store.js');
  const { uuid } = await import('./js/ids.js');
  const { importPhoto } = await import('./js/photos.js');
  const gid = uuid(), tid = uuid();
  await s.put({ id: gid, type: 'group', name: cfg.group });
  const mids = [];
  for (const n of cfg.members) { const id = uuid(); mids.push(id); await s.put({ id, type: 'member', groupId: gid, displayName: n }); }
  await s.put({ id: tid, type: 'trip', groupId: gid, title: cfg.title, region: cfg.region,
    startDate: cfg.start, endDate: cfg.end, allowWiki: false });
  const SHAPES = [[1200, 1600], [900, 1600], [1600, 1200]];
  const mk = (i) => {
    const [w, hh] = SHAPES[i % SHAPES.length];
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, hh);
    g.addColorStop(0, `hsl(${(i * 47) % 360},75%,55%)`);
    g.addColorStop(1, `hsl(${(i * 47 + 70) % 360},65%,35%)`);
    x.fillStyle = g; x.fillRect(0, 0, w, hh);
    x.fillStyle = '#fff'; x.font = `${Math.round(w / 6)}px sans-serif`;
    x.textAlign = 'center'; x.fillText(String(i + 1), w / 2, hh / 2);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  };
  const quests = [];
  for (let d = 1; d <= cfg.days; d++) {
    for (let k = 0; k < 2; k++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: `${cfg.spotPrefix}${d}之${k + 1}`, day: d, order: k,
        lat: 23.9 + d * 0.05 + k * 0.02, lng: 121.5 + k * 0.04 + d * 0.01 });
      const qid = uuid();
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `任務${quests.length + 1}`, kind: 'thing', order: 0, source: 'auto' });
      quests.push(qid);
    }
  }
  for (let i = 0; i < cfg.photos; i++) {
    if (files) {
      const db = await import('./js/db.js'), ids = await import('./js/ids.js');
      const put = async (f, kind) => {
        const blob = new Blob([Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0))], { type: f.type });
        const hash = await ids.sha256Hex(await blob.arrayBuffer());
        await db.putBlob({ hash, blob, bytes: blob.size, kind });
        return { hash, bytes: blob.size };
      };
      const ph = await put(files[i].photo, 'photo'), th = await put(files[i].thumb, 'thumb');
      // 欄位照 js/photos.js 的 importPhoto
      await s.addSubmission({ tripId: tid, questId: quests[Math.floor(i * quests.length / cfg.photos)], memberId: mids[i % mids.length],
        forMemberId: null, subjectIds: null, photoHash: ph.hash, thumbHash: th.hash, originalHash: null, originalBytes: null,
        w: files[i].w, h: files[i].h, bytes: ph.bytes, takenAt: files[i].takenAt, gps: null, hadGps: false, caption: '',
        byDevice: ids.deviceName(), deviceId: ids.deviceId() });
      continue;
    }
    await importPhoto(new File([await mk(i)], 'p.jpg', { type: 'image/jpeg' }),
      { tripId: tid, questId: quests[Math.floor(i * quests.length / cfg.photos)], memberId: mids[i % mids.length], allowGeo: false });
  }
  const subs = s.submissionsOfTrip(tid);
  for (const [i, cap] of cfg.captions || []) if (subs[i]) await s.setPhotoTag(subs[i].id, { caption: cap });
  for (const [i, n] of cfg.likes || []) if (subs[i]) for (let k = 0; k < n; k++) await s.toggleReaction(subs[i].id, mids[k % mids.length], '❤️');
  return { tid, photos: subs.length };
}
// 把一個行程的照片位元組（全圖與縮圖）取出來，給 seedTrip 的 files 用
async function exportPhotos(tid) {
  const s = await import('./js/store.js'), db = await import('./js/db.js');
  const b64 = async (hash) => {
    const e = await db.getBlob(hash);
    const u = new Uint8Array(await e.blob.arrayBuffer());
    let str = ''; for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { b64: btoa(str), type: e.blob.type };
  };
  const out = [];
  for (const sub of s.submissionsOfTrip(tid)) out.push({ photo: await b64(sub.photoHash), thumb: await b64(sub.thumbHash), w: sub.w, h: sub.h, takenAt: sub.takenAt });
  return out;
}

const MAIN = { group: '山海小隊', members: ['小安', '阿哲', '米米'], title: '東岸慢慢走', region: '花蓮',
  start: '2026-08-01', end: '2026-08-03', days: 3, spotPrefix: '海岸', photos: 36,
  captions: [[3, '清晨的港口'], [9, '阿哲的冰'], [17, '最高的那座橋'], [26, '回程前一刻']], likes: [[17, 3], [9, 1]] };

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  const main = await page.evaluate(seedTrip, MAIN);
  const few7 = await page.evaluate(seedTrip, { ...MAIN, title: '七張的', photos: 7, captions: [], likes: [] });
  const few8 = await page.evaluate(seedTrip, { ...MAIN, title: '八張的', photos: 8, captions: [], likes: [] });
  console.log(`  種了 ${main.photos}／${few7.photos}／${few8.photos} 張照片\n`);

  // ---------- TR01 段落 ----------
  console.log('— 段落與拍點 —');
  const st = await page.evaluate(async (tid) => {
    const tr = await import('./js/trailer.js');
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm: false });
    const out = { sections: p.plan.sections.map((s) => `${s.name}:${s.b1 - s.b0}`).join(' '), total: p.duration, beats: p.plan.beats,
      shots: p.plan.shots.map((s) => ({ kind: s.kind, sec: s.section, t0: s.t0, b0: s.b0, dur: s.dur, dip: !!s.dip })) };
    p.destroy();
    return out;
  }, main.tid);
  const WANT = 'cold:8 studio:4 build:32 accel:32 montage:16 silence:2 title:10 egg:7 end:10';
  console.log(`  段落：${st.sections}；${st.beats} 拍、${st.total.toFixed(2)} 秒`);
  yes(st.sections === WANT && st.beats === 121 && Math.abs(st.total - 72.6) <= 0.04,
    'TR01 段落順序與拍數＝規劃第 2 節（冷開場 8／出品 4／鋪陳 32／加速 32／快剪 16＋黑 2／片名 10／彩蛋 7／片尾 10＝121 拍、72.6 秒）',
    `${st.sections}｜${st.beats} 拍｜${st.total}`);

  // ---------- TR02 切點 ----------
  const offGrid = st.shots.filter((s) => Math.abs(s.t0 / 0.6 - Math.round(s.t0 / 0.6)) > 1e-6);
  const hard = st.shots.filter((s, i) => i > 0 && s.kind === 'photo' && (s.sec === 'accel' || s.sec === 'montage')
    && st.shots[i - 1].kind === 'photo');
  const cut = await page.evaluate(async (tid, times) => {
    const tr = await import('./js/trailer.js');
    // 區塊平均（27×36 格、紅綠藍各一）：把顆粒平均掉，只看大塊的畫面。不只看亮度——色相不同、亮度相近的兩張照片也要分得出來。
    // 寫在 evaluate 裡面（2026-11-19 12:0x）：原本寫成字串傳進來再 eval，第一次單跑就被 App 的 CSP（script-src 'self'，不准 unsafe-eval）擋下。
    const blocks = (ctx) => {
      const d = ctx.getImageData(0, 232, 1080, 1456).data; const o = new Float32Array(27 * 36 * 3);
      for (let by = 0; by < 36; by++) for (let bx = 0; bx < 27; bx++) {
        let n = 0, r = 0, g = 0, b = 0;
        for (let y = by * 40 + 4; y < by * 40 + 40; y += 6) for (let x = bx * 40 + 4; x < bx * 40 + 40; x += 6) { const i = (y * 1080 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        const k = (by * 27 + bx) * 3; o[k] = r / n; o[k + 1] = g / n; o[k + 2] = b / n;
      }
      return o;
    };
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm: false });
    const ctx = c.getContext('2d');
    const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    const out = [];
    for (const t of times) {
      await p.drawAt(t - 0.1); const a = blocks(ctx);
      await p.drawAt(t - 0.06); const a2 = blocks(ctx);
      await p.drawAt(t + 0.02); const b = blocks(ctx);
      out.push({ t, across: diff(a2, b), within: diff(a, a2) });
    }
    p.destroy();
    return out;
  }, main.tid, hard.map((s) => s.t0));
  // 前一個鏡頭會淡到黑的（鋪陳的照片 dip:true，js/trailer.js 的 DIP＝0.15 秒），切點前 0.1～0.06 秒本來就在淡出，
  // 「同一鏡頭裡不變」那一半不適用，只看切點前後有換（2026-11-19 12:0x 第一次單跑撞出：26.4 秒鋪陳接加速，同一鏡頭裡 17.8）。
  // 一般版只有鋪陳的最後一張照片會接在加速／快剪的照片前面（加速、快剪的照片不 dip），所以這種切點最多 1 個；多了就是 dip 跑到不該有的地方，照樣算紅。
  const prevDip = new Set(hard.filter((s) => st.shots[st.shots.indexOf(s) - 1].dip).map((s) => s.t0));
  const badCut = cut.filter((x) => !(x.across > 12 && (prevDip.has(x.t) || x.within < 6)));
  const steady = cut.filter((x) => !prevDip.has(x.t));
  console.log(`  硬切 ${cut.length} 個（前一張淡到黑的 ${prevDip.size} 個：${[...prevDip].join(',')}）：切點前後區塊差 ${Math.min(...cut.map((x) => x.across)).toFixed(1)}～${Math.max(...cut.map((x) => x.across)).toFixed(1)}、`
    + `其餘 ${steady.length} 個同一鏡頭裡 ${Math.max(...steady.map((x) => x.within)).toFixed(1)} 以下`);
  yes(offGrid.length === 0 && cut.length >= 12 && badCut.length === 0 && prevDip.size <= 1,
    `TR02 切點在拍點上：${st.shots.length} 個鏡頭起點都是 0.6 秒的整數倍、${cut.length} 個硬切的畫面都在那一刻換`,
    `不在拍點：${offGrid.map((s) => s.t0).join(',')}｜沒在那一刻換：${JSON.stringify(badCut.slice(0, 3))}`);

  // ---------- TR03 字的來源 ----------
  console.log('\n— 字的來源 —');
  const drawn = await page.evaluate(async (tid) => {
    const tr = await import('./js/trailer.js');
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm: false });
    const log = new Set();
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, ...a) { if (this.canvas === c) log.add(String(s)); return orig.call(this, s, ...a); };
    try { for (let t = 0; t < p.duration; t += 0.15) await p.drawAt(t); }
    finally { CanvasRenderingContext2D.prototype.fillText = orig; }
    p.destroy();
    return [...log];
  }, main.tid);
  // 登記表：從造的資料自己算（不拿時間軸的字串來比）
  const reg = [MAIN.title, MAIN.region, MAIN.group, ...MAIN.members, ...MAIN.captions.map((x) => x[1]), MAIN.start, MAIN.end,
    '2026', '8', String(MAIN.members.length), String(MAIN.days),
    ...Array.from({ length: MAIN.days * 2 }, (_, i) => `${MAIN.spotPrefix}${Math.floor(i / 2) + 1}之${(i % 2) + 1}`), ...FIXED];
  const SEP = /[\s–·、…:：()（）/-]/gu;
  const leftover = (s) => {
    let r = s;
    for (const tk of [...reg].sort((a, b) => b.length - a.length)) r = r.split(tk).join(' ');
    r = r.replace(SEP, '').replace(/\p{Extended_Pictographic}|️/gu, '');
    if (!r) return '';
    const frag = s.replace(/…$/, '');
    return reg.some((v) => frag && v.includes(frag)) ? '' : r;      // 換行切開的片段：是某一筆資料的一段就算
  };
  const stray = drawn.filter((s) => leftover(s));
  const must = [MAIN.title, `${MAIN.group} 出品`, '主演', '最高的那座橋'];
  const missing = must.filter((m) => !drawn.some((s) => s.includes(m)));
  console.log(`  畫過 ${drawn.length} 種字串：${drawn.slice(0, 14).join('｜')}${drawn.length > 14 ? '…' : ''}`);
  yes(leftover('夏天去花蓮') !== '' && leftover('一場說走就走的冒險') !== '' && leftover('東岸慢慢走') === '' && leftover('東岸慢') === '',
    'TR14 TR03 的檢查器自己的對照組：「夏天」「說走就走的冒險」判沒登記、片名與換行切開的片名判有登記');
  yes(drawn.length >= 10 && missing.length === 0 && stray.length === 0,
    `TR03 畫面上的 ${drawn.length} 種字串都來自行程資料或固定的詞（含片名、出品、主演、照片說明）`,
    `沒登記：${stray.join('｜')}｜該有沒有：${missing.join('｜')}`);

  // ---------- TR04 白閃 ----------
  console.log('\n— 白閃 —');
  const flashOf = async (calm) => page.evaluate(async (tid, calm) => {
    const tr = await import('./js/trailer.js');
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm });
    const ctx = c.getContext('2d');
    const mont = p.plan.sections.find((s) => s.name === 'montage');
    const t0 = mont.b0 * 0.6, t1 = mont.b1 * 0.6;
    const onsets = []; let prev = false, frames = 0;
    for (let t = t0 + 0.001; t < t1; t += 0.04) {
      await p.drawAt(t);
      const d = ctx.getImageData(120, 420, 200, 200).data;
      let l = 0; for (let i = 0; i < d.length; i += 4) l += (d[i] + d[i + 1] + d[i + 2]) / 3;
      const white = l / (d.length / 4) > 235;
      if (white && !prev) onsets.push(+t.toFixed(3));
      prev = white; frames++;
    }
    p.destroy();
    return { onsets, frames, span: +(t1 - t0).toFixed(2) };
  }, main.tid, calm);
  const fN = await flashOf(false), fC = await flashOf(true);
  const gaps = fN.onsets.slice(1).map((t, i) => t - fN.onsets[i]);
  console.log(`  一般版：快剪 ${fN.span} 秒、量了 ${fN.frames} 格、白閃 ${fN.onsets.length} 次（${fN.onsets.join(', ')}）；平穩版 ${fC.frames} 格、${fC.onsets.length} 次`);
  yes(fN.onsets.length >= 1 && gaps.every((g) => g >= 1.2 - 0.05) && fC.frames > 20 && fC.onsets.length === 0,
    `TR04 白閃：一般版 ${fN.onsets.length} 次、相鄰最少隔 ${gaps.length ? Math.min(...gaps).toFixed(2) : '—'} 秒（≥ 2 拍）；平穩版 0 次`,
    `一般版 ${JSON.stringify(fN.onsets)}｜平穩版 ${JSON.stringify(fC.onsets)}`);

  // ---------- TR05 平穩版 ----------
  console.log('\n— 平穩版 —');
  const still = async (calm) => page.evaluate(async (tid, calm) => {
    const tr = await import('./js/trailer.js');
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm });
    const ctx = c.getContext('2d');
    const hash = async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 1080, 1920).data))]
      .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const out = [];
    for (const s of p.plan.shots) {
      if (s.kind !== 'photo' && s.kind !== 'egg' && s.kind !== 'title') continue;
      const a = s.kind === 'title' ? s.t0 + 2.0 : s.t0 + s.dur * 0.35;
      const b = s.kind === 'title' ? s.t0 + 4.0 : s.t0 + s.dur * 0.55;
      await p.drawAt(a); const ha = await hash();
      await p.drawAt(b); const hb = await hash();
      out.push({ kind: s.kind, sec: s.section, same: ha === hb });
    }
    p.destroy();
    return out;
  }, main.tid, calm);
  const sC = await still(true), sN = await still(false);
  const moved = sC.filter((x) => !x.same);
  console.log(`  平穩版 ${sC.length} 個鏡頭（照片、彩蛋、片名）：${sC.length - moved.length} 個兩個時刻相同；一般版 ${sN.filter((x) => !x.same).length}/${sN.length} 個不同`);
  yes(sC.length >= 10 && moved.length === 0 && sN.filter((x) => x.kind === 'photo' && !x.same).length >= 5,
    `TR05 平穩版：${sC.length} 個鏡頭裡照片不推不移、片名卡的字不縮放不收字距（對照組：一般版會動）`,
    `平穩版有動：${JSON.stringify(moved.slice(0, 4))}`);

  // ---------- TR06 黑邊 ----------
  console.log('\n— 黑邊 —');
  const bars = await page.evaluate(async (tid) => {
    const tr = await import('./js/trailer.js');
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm: false });
    const ctx = c.getContext('2d');
    let frames = 0, topBad = 0, botBad = 0, withText = 0;
    const firstBad = [];
    for (let t = 1.3; t < p.duration; t += 0.5) {
      await p.drawAt(t); frames++;
      const top = ctx.getImageData(0, 0, 1080, 232).data;
      let tb = 0; for (let i = 0; i < top.length; i += 4) if (top[i] || top[i + 1] || top[i + 2]) tb++;
      const bot = ctx.getImageData(0, 1688, 1080, 232).data;
      let bb = 0, lit = 0;
      for (let i = 0; i < bot.length; i += 4) {
        const r = bot[i], g = bot[i + 1], b = bot[i + 2];
        if (r || g || b) lit++;
        if (Math.abs(r - g) > 2 || Math.abs(g - b) > 2 || Math.abs(r - b) > 2) bb++;
      }
      if (tb) topBad++;
      if (bb) botBad++;
      if (lit > 200) withText++;
      if ((tb || bb) && firstBad.length < 3) firstBad.push({ t: +t.toFixed(2), tb, bb });
    }
    p.destroy();
    return { frames, topBad, botBad, withText, firstBad };
  }, main.tid);
  console.log(`  ${bars.frames} 格：上黑邊有非黑 ${bars.topBad} 格、下黑邊有彩色 ${bars.botBad} 格、下黑邊有字 ${bars.withText} 格`);
  yes(bars.frames >= 100 && bars.withText >= 5 && bars.topBad === 0 && bars.botBad === 0,
    `TR06 黑邊：${bars.frames} 格裡上黑邊整片黑、下黑邊只有灰階字（含字幕 ${bars.withText} 格）`, JSON.stringify(bars.firstBad));

  // ---------- TR07 照片不夠 ----------
  console.log('\n— 照片不夠 —');
  const fewOf = async (tid) => {
    await page.evaluate((t) => { location.hash = '#/trip/' + t + '/album'; }, tid);
    await page.waitForSelector('.style-pick button', { timeout: 15000 });
    await sleep(300);
    return page.evaluate(() => {
      const b = [...document.querySelectorAll('.style-pick button')].find((x) => x.textContent.includes('預告片'));
      return { disabled: !!b?.disabled, note: document.querySelector('.style-note')?.textContent || '', found: !!b };
    });
  };
  const u7 = await fewOf(few7.tid);
  const u8 = await fewOf(few8.tid);
  const thrown = await page.evaluate(async (tid) => {
    const tr = await import('./js/trailer.js');
    try { await tr.createTrailerPlayer(document.createElement('canvas'), tid, {}); return ''; } catch (e) { return e.message; }
  }, few7.tid);
  console.log(`  7 張：按鈕 ${u7.disabled ? '不能按' : '可以按'}、說明「${u7.note}」；8 張：${u8.disabled ? '不能按' : '可以按'}；建播放器：「${thrown}」`);
  yes(u7.found && u7.disabled && u7.note.includes('照片少於 8 張，做不出預告片') && u8.found && !u8.disabled
      && !u8.note.includes('照片少於') && thrown === '照片少於 8 張，做不出預告片',
    'TR07 照片少於 8 張：預告片不能選、照實寫原因；剛好 8 張可以選', JSON.stringify({ u7, u8, thrown }));

  // ---------- TR08 自動降級 ----------
  console.log('\n— 自動降級 —');
  const meter = await page.evaluate(async () => {
    const tr = await import('./js/trailer.js');
    const slow = new tr.DegradeMeter(); const ev = [];
    for (let k = 0; k < 200; k++) { const r = slow.record(40, k * 40); if (r) ev.push(r.off.join('、')); }
    const fast = new tr.DegradeMeter(); let fastEv = 0;
    for (let k = 0; k < 200; k++) if (fast.record(12, k * 40)) fastEv++;
    return { ev, fastEv, note: tr.degradeNote(['顆粒']) };
  });
  await page.evaluate((t) => { localStorage.setItem('tripquest.trailer', JSON.stringify({ [t]: { style: 'trailer', music: 'none' } })); location.hash = '#/'; }, main.tid);
  await sleep(300);
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/album'; }, main.tid);
  await page.waitForSelector('.style-pick button.on', { timeout: 15000 });
  await sleep(1200);
  // 把畫圖故意放慢（只在這個測試頁包住；正式程式沒有任何放慢的開關）：冷開場沒有 drawImage，所以 fillRect 也包
  await page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype;
    window.__tqSlow = { drawImage: P.drawImage, fillRect: P.fillRect };
    const slow = (fn) => function (...a) { const t = performance.now(); while (performance.now() - t < 8); return fn.apply(this, a); };
    P.drawImage = slow(window.__tqSlow.drawImage);
    P.fillRect = slow(window.__tqSlow.fillRect);
  });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('播放預覽'))?.click());
  let note = '';
  for (let k = 0; k < 40 && !note; k++) { await sleep(250); note = await page.evaluate(() => { const e = document.querySelector('.tr-degrade'); return e && !e.hidden ? e.textContent : ''; }); }
  await page.evaluate(() => {
    Object.assign(CanvasRenderingContext2D.prototype, window.__tqSlow);
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('暫停'))?.click();
  });
  console.log(`  控制器：慢 → ${meter.ev.map((x) => `「${x}」`).join(' → ')}；快 → ${meter.fastEv} 次；相簿頁播放放慢後：「${note}」`);
  yes(meter.ev.join('|') === '顆粒|顆粒、景深|顆粒、景深、調色' && meter.fastEv === 0 && note.startsWith('這支手機比較慢，已關掉顆粒'),
    'TR08 自動降級：畫太慢依序關掉顆粒 → 景深 → 調色、夠快不動；相簿頁播放時畫面上有說明', JSON.stringify({ ...meter, note }));

  // ---------- TR10／TR11 時鐘 ----------
  console.log('\n— 時鐘 —');
  const clk = await page.evaluate(async () => {
    const tr = await import('./js/trailer.js');
    let w = 0; const now = () => w;
    // 音訊時鐘在走：比牆上時鐘快 0.5 秒，畫面要跟音訊
    let a = 0; const m = { running: () => true, time: () => a };
    const c1 = tr.makeClock(100, { now }); c1.begin(0, m);
    w = 1000; a = 1.5; const follow = c1.now();
    // 播放中停住：音訊卡在 1.5，牆上時鐘再走 0.6 秒 → 改看牆上時鐘、從 1.5 接著走
    w = 1600; c1.now(); w = 2000; const stalled = c1.now();
    // 一開始就沒在走
    w = 0; const m2 = { running: () => false, time: () => 0 };
    const c2 = tr.makeClock(100, { now }); c2.begin(3, m2); w = 1000;
    return { follow, stalled, notRun: c2.now(), audio1: c1.audio };
  });
  console.log(`  跟音訊 ${clk.follow}；停住後 ${clk.stalled.toFixed(2)}；一開始沒在走 ${clk.notRun}`);
  yes(Math.abs(clk.follow - 1.5) < 1e-9, 'TR10 時鐘：音訊時鐘在走，畫面跟音訊時鐘（不是牆上時鐘的 1.0 秒）', JSON.stringify(clk));
  yes(Math.abs(clk.stalled - 1.9) < 0.01 && !clk.audio1 && Math.abs(clk.notRun - 4) < 1e-9,
    'TR11 時鐘：音訊時鐘停住超過半秒、或一開始就沒在走 → 改看牆上時鐘、從停住的地方接著走', JSON.stringify(clk));
  // 真的配樂：從播放器的對外介面播（相簿頁按「播放預覽」呼叫的就是這一支），2 秒前後各讀一次
  const real = await page.evaluate(async (tid) => {
    const tr = await import('./js/trailer.js');
    const c = document.createElement('canvas');
    const p = await tr.createTrailerPlayer(c, tid, { calm: false });
    await p.play(tr.TRAILER_MUSIC, null);
    const t0 = p.time, a0 = p.audioClock;
    await new Promise((r) => setTimeout(r, 2000));
    const t1 = p.time, a1 = p.audioClock, on = p.playing;
    p.destroy();
    return { a0, a1, on, t0: +t0.toFixed(3), t1: +t1.toFixed(3) };
  }, main.tid);
  console.log(`  真的配樂：開始時跟音訊 ${real.a0}、2 秒後跟音訊 ${real.a1}、還在播 ${real.on}；時間 ${real.t0} → ${real.t1}`);
  yes(real.a0 && real.a1 && real.on && real.t1 - real.t0 > 1.2 && real.t1 - real.t0 < 3.0,
    'TR15 時鐘：真的播預告片配樂 2 秒，畫面一直跟著音訊時鐘、時間有往前走', JSON.stringify(real));

  // ---------- TR12 相簿頁 ----------
  console.log('\n— 相簿頁 —');
  await page.evaluate((t) => { localStorage.removeItem('tripquest.trailer'); location.hash = '#/'; }, main.tid);
  await sleep(300);
  await page.evaluate((t) => { location.hash = '#/trip/' + t + '/album'; }, main.tid);
  await page.waitForSelector('.style-pick button', { timeout: 15000 });
  await sleep(400);
  // 數字與單位中間是不換行空白（js/ui.js 的 qty），先換成一般空白再比
  const ui = async () => page.evaluate(() => ({
    on: document.querySelector('.style-pick button.on')?.textContent || '',
    lenHidden: !!document.querySelector('.len-pick:not(.style-pick)')?.hidden,
    trMusic: document.querySelector('.tr-music')?.className || '',
    beat: document.querySelector('.tr-beat')?.textContent || '',
    note: (document.querySelector('.style-note')?.textContent || '').replace(/ /g, ' '),
    pref: localStorage.getItem('tripquest.trailer') || '',
  }));
  const musicBefore = await page.evaluate(async (t) => (await import('./js/store.js')).getRaw(t)?.musicStyle ?? null, main.tid);
  const u0 = await ui();
  await page.evaluate(() => [...document.querySelectorAll('.style-pick button')].find((b) => b.textContent.includes('預告片')).click());
  await sleep(500);
  const u1 = await ui();
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.style-pick button', { timeout: 15000 });
  await sleep(400);
  const u2 = await ui();
  await page.evaluate(() => [...document.querySelectorAll('.music-pick > button')].find((b) => b.textContent.includes('溫柔')).click());
  await sleep(300);
  const u3 = await ui();
  const musicAfter = await page.evaluate(async (t) => (await import('./js/store.js')).getRaw(t)?.musicStyle ?? null, main.tid);
  await page.evaluate(() => [...document.querySelectorAll('.style-pick button')].find((b) => b.textContent.includes('經典')).click());
  await sleep(400);
  const u4 = await ui();
  console.log(`  一開始：${u0.on.slice(0, 2)}｜選預告片：${u1.on.slice(0, 3)}、長度${u1.lenHidden ? '收起' : '還在'}、說明「${u1.note.slice(0, 22)}…」｜重新整理：${u2.on.slice(0, 3)}｜選溫柔：「${u3.beat.slice(0, 7)}…」｜trip.musicStyle ${musicBefore} → ${musicAfter}｜切回：${u4.on.slice(0, 2)}`);
  yes(u0.on.startsWith('經典') && !u0.lenHidden && !u0.trMusic
      && u1.on.startsWith('預告片') && u1.lenHidden && u1.trMusic.includes('on') && u1.note.includes('約 1 分 13 秒') && JSON.parse(u1.pref)[main.tid]?.style === 'trailer'
      && u2.on.startsWith('預告片')
      && u3.beat.startsWith('這首不會對拍') && musicAfter === musicBefore
      && u4.on.startsWith('經典') && !u4.lenHidden && !u4.trMusic && !u4.beat,
    'TR12 相簿頁：選預告片收起長度、出現預告片配樂；選擇只存在這支手機（trip.musicStyle 不動）、重新整理還在；別的配樂寫「不會對拍」；切回經典照舊',
    JSON.stringify({ u0, u1, u2, u3, u4, musicBefore, musicAfter }));

  // ---------- TR13 減少動態效果 ----------
  console.log('\n— 減少動態效果 —');
  await page.evaluate((t) => {
    const p = JSON.parse(localStorage.getItem('tripquest.prefs') || '{}'); p.reduceMotion = true;
    localStorage.setItem('tripquest.prefs', JSON.stringify(p));
    localStorage.setItem('tripquest.trailer', JSON.stringify({ [t]: { style: 'trailer', music: 'none' } }));
  }, main.tid);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.style-pick button.on', { timeout: 15000 });
  await sleep(1500);
  const rm = await page.evaluate(async (tid) => {
    const total = (await import('./js/trailer.js')).trailerInfo(tid, { calm: true }).seconds;   // 平穩版比較短：照它的總長換算進度條位置
    const rmOn = document.documentElement.classList.contains('reduce-motion');
    const note = document.querySelector('.style-note')?.textContent || '';
    const ex = document.querySelector('.tr-export');
    const exText = ex && !ex.hidden ? ex.textContent : '';
    // 拖進度條到第一張照片（鋪陳第 1 張：7.2～9.6 秒）裡的兩個時刻
    const bar = document.querySelector('.scrub'), cv = document.querySelector('.album-canvas');
    const r = bar.getBoundingClientRect();
    const seekTo = async (sec) => {
      const x = r.left + r.width * (sec / total);
      bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: r.top + r.height / 2, bubbles: true, pointerId: 1 }));
      bar.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: r.top + r.height / 2, bubbles: true, pointerId: 1 }));
      await new Promise((res) => setTimeout(res, 900));
      const d = cv.getContext('2d').getImageData(0, 232, 1080, 1456).data;
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].slice(0, 8).join(',');
    };
    const a = await seekTo(7.9), b = await seekTo(8.6), c = await seekTo(11.0);
    const btn = document.querySelector('.tr-full');
    btn?.click();
    await new Promise((res) => setTimeout(res, 200));
    return { rmOn, total, note, exText, same: a === b, diffOther: a !== c, after: document.querySelector('.tr-full')?.textContent || '' };
  }, main.tid);
  console.log(`  reduce-motion：${rm.rmOn}；說明有「平穩版」：${rm.note.includes('平穩版')}；存影片：「${rm.exText.slice(0, 26)}…」；同一張兩個時刻${rm.same ? '相同' : '不同'}（對照：別張${rm.diffOther ? '不同' : '相同'}）；按下後：「${rm.after}」`);
  yes(rm.rmOn && rm.note.includes('預覽做成平穩版') && rm.exText.includes('做成平穩版') && rm.exText.includes('改做完整版')
      && rm.same && rm.diffOther && rm.after === '改回平穩版',
    'TR13 減少動態效果：預覽是平穩版（同一張兩個時刻畫面相同）、存影片預設平穩版、按「改做完整版」可以改', JSON.stringify(rm));
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('tripquest.prefs') || '{}'); p.reduceMotion = false; localStorage.setItem('tripquest.prefs', JSON.stringify(p)); });

  // ---------- TR09 原本的風格逐格相同 ----------
  console.log('\n— 原本的風格 —');
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.mkdirSync(baseDir, { recursive: true });
  const tarPath = path.join(baseDir, 'base.tar');
  const ar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tarPath, BASE_COMMIT, 'index.html', 'sw.js', 'manifest.webmanifest', 'js', 'css', 'data', 'icons'], { encoding: 'utf8' });
  const ex = ar.status === 0 ? spawnSync('tar', ['-xf', 'base.tar'], { cwd: baseDir, encoding: 'utf8' }) : null;
  const baseMem = fs.existsSync(path.join(baseDir, 'js', 'memory.js')) ? fs.readFileSync(path.join(baseDir, 'js', 'memory.js'), 'utf8') : '';
  const curMem = fs.readFileSync(path.join(ROOT, 'js', 'memory.js'), 'utf8');
  // 先證明它真的是舊版：新版才有的那兩個 export，舊版沒有；新版有 trailer.js、舊版沒有
  const isOld = baseMem.includes('\nfunction drawLabel(') && curMem.includes('\nexport function drawLabel(')
    && !fs.existsSync(path.join(baseDir, 'js', 'trailer.js'));
  console.log(`  基準 ${BASE_COMMIT}：archive ${ar.status}、解開 ${ex?.status}、memory.js ${baseMem.length} 字元、是舊版 ${isOld}`);
  if (!isOld) {
    // 前置那一條也要印（2026-11-19 13:3x 補）：只印下面那一條，項數會從 16 變 15，突變執行器判「沒跑完」（② 實測撞到）
    fail('TR09 前置：基準沒做出來，三份照片沒比（情境未成立，不算過）');
    fail('TR09 原本的風格逐格相同：基準沒做出來（情境未成立，不算過）', (ar.stderr || '') + (ex?.stderr || ''));
  } else {
    // 比對用的伺服器一次只開一個（2026-11-19 13:3x）：①b 之後三個同時開，加上 WEB 與瀏覽器，單跑 5 個工作程序、在突變底下 6 個，
    // 超過本 repo 4 個的上限（§5.19；sample-run 記到峰值 6～7 個含主程式）。開一個 → 量 → 關掉、等它真的結束 → 再開下一個。
    const serveOn = async (port, cwd) => {
      const p = spawn('python', ['-m', 'http.server', String(port)], { cwd, stdio: 'ignore' });
      curWebs.push(p);
      await sleep(1400);
      return p;
    };
    const stopServe = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve()
      : new Promise((res) => { p.once('exit', res); p.kill(); }));
    const CLASSIC = { ...MAIN, title: '經典對照', photos: 10, captions: [], likes: [] };
    // 照片只用 importPhoto 匯入一次（在主頁面），三份都直接存這一份位元組
    const src = await page.evaluate(seedTrip, CLASSIC);
    const files = await page.evaluate(exportPhotos, src.tid);
    // shift：只給「應判相同」那條對照組的突變用（把量的時刻整體挪開），正常呼叫一律 0
    const classicFrames = async (port, shift, photoFiles) => {
      const pg = await browser.newPage();
      await pg.setViewport({ width: 390, height: 844 });
      await pg.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
      await pg.waitForSelector('.hero');
      const seeded = await pg.evaluate(seedTrip, CLASSIC, photoFiles);
      const r = await pg.evaluate(async (tid, shift) => {
        const mem = await import('./js/memory.js');
        const t = await mem.buildTimeline(tid, { length: 'full' });
        const ph = t.segs.filter((s) => s.kind === 'photo');
        const day = t.segs.find((s) => s.kind === 'day'), map = t.segs.find((s) => s.kind === 'map'), outro = t.segs.find((s) => s.kind === 'outro');
        const times = [1.4, day.start + 1.2,
          ...[0, 1, 2, 3, 5, 8].filter((i) => ph[i]).map((i) => ph[i].start + ph[i].dur * 0.5),
          ph[1].start + ph[1].dur - 0.4, ph[4].start + ph[4].dur - 0.3,
          map ? map.start + map.dur * 0.6 : outro.start + 1.0, outro.start + 2.0];
        const c = document.createElement('canvas');
        const p = await mem.createPlayer(c, tid, { length: 'full' });
        const ctx = c.getContext('2d');
        const out = [];
        const grab = async () => {
          const d = ctx.getImageData(0, 0, 1080, 1920).data;
          return { d, h: [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20) };
        };
        for (const t0 of times) {
          const tt = t0 + shift;
          // 等畫面穩定：seek 先畫，圖片在背景載（js/memory.js 的 FrameStore：全圖沒到先退縮圖）。每 300ms 重畫一次、連續兩次相同才收。
          // （2026-11-19 12:0x 加的時候推論 3 個時刻不同是全圖沒載完；實測不是——真正的原因是照片位元組不同，見檔頭 CUR_WEB 那段。這道留著，免得量到半途的畫面。）
          p.seek(tt);
          let prev = null, now = null, draws = 0, stable = false;
          while (draws < 10 && !stable) {
            await new Promise((res) => setTimeout(res, 300)); p.seek(tt); draws++;
            now = await grab();
            stable = !!prev && prev.h === now.h;
            prev = now;
          }
          const d = now.d;
          let l = 0; for (let i = 0; i < d.length; i += 40) l += d[i] + d[i + 1] + d[i + 2];
          // 取樣點（每 211 個像素取一個，紅綠藍）：雜湊不同時，拿來算差了幾個點、最多差多少——分得出「整張不一樣」還是「邊緣差 1、2 階」
          const smp = []; for (let i = 0; i < d.length; i += 211 * 4) smp.push(d[i], d[i + 1], d[i + 2]);
          out.push({ t: +t0.toFixed(3), h: now.h, stable, draws, lum: Math.round(l / (d.length / 40) / 3), smp });
        }
        p.destroy();
        // 每張照片存進去的位元組雜湊（js/photos.js 的 storeBlob 照內容 SHA-256 存，frame.hash 就是它）
        return { out, photoSegs: ph.length, photos: ph.map((s) => (s.frame.hash || '').slice(0, 16)) };
      }, seeded.tid, shift);
      await pg.close();
      return r;
    };
    let sv = await serveOn(CUR_WEB, ROOT);
    const cur = await classicFrames(CUR_WEB, 0, files);
    await stopServe(sv);
    sv = await serveOn(BASE_WEB, baseDir);
    const base = await classicFrames(BASE_WEB, 0, files);
    await stopServe(sv);
    sv = await serveOn(CUR_WEB2, ROOT);
    const cur2 = await classicFrames(CUR_WEB2, 0, files);
    await stopServe(sv);
    // 前置（2026-11-19 12:2x）：三份種出來的 10 張照片位元組都要相同，不然比的是不同的照片、畫面不同也不代表程式改了
    console.log(`  照片在主頁面匯入一次：${files.length} 張，三份都直接存這一份位元組`);
    const inputSame = files.length === 10 && cur.photos.length === 10 && [base, cur2].every((x) => x.photos.join() === cur.photos.join());
    console.log(`  前置：三份各種 10 張照片，位元組（雜湊前 8 碼）目前 ${cur.photos.map((x) => x.slice(0, 8)).join(',')}`
      + `；跟基準${base.photos.join() === cur.photos.join() ? '相同' : '不同：' + base.photos.map((x) => x.slice(0, 8)).join(',')}`
      + `；跟第二份${cur2.photos.join() === cur.photos.join() ? '相同' : '不同：' + cur2.photos.map((x) => x.slice(0, 8)).join(',')}`);
    yes(inputSame, 'TR09 前置：三份（目前、基準、目前第二份，各自全新的來源）種出來的 10 張照片位元組都相同');
    // 應判相同的對照組（2026-11-19 12:1x 補）：目前版本在另一個全新來源再量一次，12 個時刻必須逐位元組相同——
    // 不然「跟基準不同」分不出是程式改了，還是量法本身在兩個頁面之間不穩。
    const selfSame = cur.out.filter((x, i) => cur2.out[i] && x.t === cur2.out[i].t && x.h === cur2.out[i].h).length;
    const delta = (a, b) => { let n = 0, mx = 0; for (let i = 0; i < a.smp.length; i++) { const dd = Math.abs(a.smp[i] - b.smp[i]); if (dd) n++; if (dd > mx) mx = dd; } return `${n}/${a.smp.length} 點、最大差 ${mx}`; };
    console.log(`  對照組（目前版本兩個全新來源各量一次）：相同 ${selfSame}/12` + (selfSame < 12 ? '：' + cur.out.map((x, i) => (x.h === cur2.out[i]?.h ? '' : `${x.t}（${delta(x, cur2.out[i])}）`)).filter(Boolean).join('、') : ''));
    console.log('  跟基準不同的時刻：' + (cur.out.map((x, i) => (x.h === base.out[i]?.h ? '' : `${x.t}（${delta(x, base.out[i])}）`)).filter(Boolean).join('、') || '無'));
    const same = cur.out.filter((x, i) => base.out[i] && x.t === base.out[i].t && x.h === base.out[i].h).length;
    const distinct = new Set(cur.out.map((x) => x.h)).size;
    const unstable = [...cur.out, ...base.out, ...cur2.out].filter((x) => !x.stable).length;
    console.log(`  ${cur.out.length} 個時刻：相同 ${same}；同一份裡互不相同的畫面 ${distinct} 種（對照組：不同時刻必須不同）；亮度 ${cur.out.map((x) => x.lum).join(',')}`);
    // 「畫不穩」只印、不進判定：不穩的畫面雜湊會跟著變，same 或 selfSame 本來就會不符，單獨當條件擋不到別的東西（§5.20 不留不會擋的檢查）
    console.log(`  每個時刻畫幾次才穩（最少 2 次；多於 2＝前兩次不同）：目前 ${cur.out.map((x) => x.draws).join(',')}；基準 ${base.out.map((x) => x.draws).join(',')}；10 次都不穩 ${unstable} 個`);
    if (!inputSame) {
      fail('TR09 原本的風格逐格相同：前置不成立，沒比（不算過）');
    } else {
      yes(cur.out.length === 12 && base.out.length === 12 && same === 12 && distinct >= 10 && selfSame === 12,
        `TR09 原本的風格逐格相同：12 個時刻跟 ${BASE_COMMIT}（v1.96.0）逐位元組相同（目前版本另一個來源也 12/12 相同）`,
        cur.out.map((x, i) => `${x.t}:${x.h === base.out[i]?.h ? '同' : '不同'}`).join(' ') + `｜對照組 ${selfSame}/12`);
    }
  }

  console.log('\n預告片測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
  for (const s of curWebs) s.kill();
  await sleep(800);   // 伺服器還佔著目錄時刪不掉（①b 診斷實測 EPERM）
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
