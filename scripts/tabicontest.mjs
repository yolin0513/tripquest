// 底部分頁五格的吉祥物頭像、照片空白頁的鬍鬍置中（v1.96.0；npm run tabicontest；會開瀏覽器）
//
// 涵蓋的程式：js/app.js (renderTabs, tabItem), js/tabicons.js, js/peeks.js (pose 的 POSE_MID), js/views/people.js (照片空白頁), js/views/trip.js (沒有景點的主頁與任務頁), css/style.css (#tabbar .ti-mc, .tab-hop, .pose-c, .empty .btn > .gl-peek)
//
// 為什麼：Yolin 2026-11-19 看了五格小樣——採用；「照片的鬍鬍沒有置中，偏左邊了，請修正後上線」。照片那格的裁切圈第一版是 cx 110，
// 鬍鬍的身體中線在 100，往左偏 10 個畫布單位（選中 30px 時 1.8px）。Dispatch 要照片空白頁那隻也量：揮手的鬍鬍照圖框置中，
// 身體在按鈕中線左邊 12px（圖框裡含舉起的手），一起修。
//
// 置中怎麼量（不量 DOM 外框：圓心偏了、svg 的外框照樣置中，量外框抓不到這次的問題）：
//   畫素比 3 截整個畫面、照「畫面座標 × 畫素比」裁（page.screenshot 的 clip 座標不照捲動後的畫面算，peektest P9 踩過）；
//   分頁頭像：圓裡（半徑少 3px，避開圈）的深色畫素（亮度 < 110＝外框線）；照片空白頁：圖框裡、按鈕上緣以上那幾列，跟旁邊背景顏色不同的畫素（剪影）。
//   找左右鏡射最對得上的那條直線（鏡射過去不是同一種畫素的最少），它離圓心／按鈕中線幾 px。量之前先讓動畫跑完（finish）。
//
// 驗什麼（編號 TInn 一律兩位數：突變的 expect 比訊息開頭）。和紙、深色各一輪（從設定頁的主題鈕切）：
//   TI01 旅程那一層五格：每一格一張圓形頭像，順序 湯圓／小鳳／阿灰／鬍鬍／棉棉（data-mascot），aria-hidden；字照舊（主頁～分帳）
//   TI02 大小：亮著那一格 30px、其餘 26px（五格輪流亮，每一次都量）；分頁列高 76px（跟改之前一樣）
//   TI03～TI07 置中（一格一條：主頁、任務、行程、照片、分帳）：亮著（30px）與沒亮（26px）兩種，鏡射軸離圓心都 ≤ 0.7px
//   TI08 TI03～TI07 的對照組（同一頁、同一個量法）：照片那格的圖往左挪 10 個畫布單位（＝第一版 cx 110 的樣子），必須量到偏左 ≥ 1.0px
//   門檻怎麼訂的（第一次跑之前、08:2x 定）：照同一個量法、同樣的畫素比在 sharp 量 js/tabicons.js 的正本（一次性 .logs/tab-20261119/measure-real.mjs，
//   sharp 不是 Chromium、只看餘裕）——五格 0～0.33px（棉棉 0.33：一邊耳朵不對稱、把線條的鏡射軸拉偏一個裝置畫素；身體 path 本身對 100 對稱）、
//   對照組 −1.5px、Yolin 看到的那個偏移 1.6～1.8px。原本訂 0.5／−1.2，棉棉與對照組都只剩 0.2～0.3px 餘裕、Chromium 的抗鋸齒差一格就翻，放寬到 0.7／−1.0；
//   兩邊仍隔得開（置中 ≤ 0.7、偏 10 單位 ≥ 1.0）。
//   TI09 首頁那一層（我的旅程、設定）照舊是表情符號、沒有頭像（3.12：不在這次的範圍）
//   TI10 切到別格（含從首頁點旅程卡進來）：新亮的那一隻跳一下——動畫真的起跑（等 ready、之後動畫時間有走或已經播完）、只動 transform；
//        其他四格沒有動畫（五次切換每一次都要）
//   TI11 同一格裡進子頁面（行程 →「調整每天的行程」，還是行程那一格）：分頁列沒重畫（亮著的還是同一個元素）、沒有正在跑的動畫；
//        前置：剛點行程那一跳先播完、網址真的換了
//   TI12（深色那輪）設定頁打開「減少動態效果」之後切到別格：不跳（沒有 tab-hop、0 段動畫）；前置：<html> 有 reduce-motion
//   TI13 照片頁還沒有照片：「回任務清單」上揮手的鬍鬍，身體中線（剪影的鏡射軸）對準按鈕中線 ≤ 0.7px
//   TI14 TI13 的對照組：同一張圖把 --pk-dx 撥回 0（照圖框置中＝修之前），必須量到身體在按鈕中線左邊 ≥ 8px
//   TI15 直接打開旅程的頁面（重新整理、開 App）：亮著那一格不跳
//   TI16 還沒有景點的那一趟（從首頁點旅程卡進主頁、再點「任務」）：兩頁「＋ 去安排景點」上指路的阿灰對準按鈕中線 ≤ 0.7px
//   TI17 TI16 的對照組：--pk-dx 撥回 0，兩頁都必須量到左邊 ≥ 5px（修之前 7.8px）
//   TI13～TI17 的門檻（第一次跑之前、Dispatch 08:2x 准 point 一起修之後訂）：sharp 照同一個量法、兩個主題的底色模擬
//   （一次性 .logs/tab-20261119/measure-pose.mjs，對照組符合）——修好之後 −0.18～0px，修之前 hello −12.0、point −7.9px。
//   TI18／TI19（邀請讀不到那隻搔頭的湯圓）第一版有、2026-11-19 拿掉（編號不重用）：整隻繞 (100,170) 歪 12°，剪影沒有左右對稱的中線，
//   深色主題替吉祥物描的白邊又把量到的鏡射軸推右 5 個畫布單位（同一個位置和紙 +1.33px、深色 +4.83px；一次性 .logs/tab-20261119/measure-rim.mjs
//   用 sharp 重現）——沒有一個量法在兩個主題都量得準，證明不了「對準」。Dispatch 2026-11-19 選甲：湯圓維持照圖框置中、不登記。
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
// 不打真網路（共用慣例 §5.6）：外站一律當場回 503。資料用 store 造（造狀態，不是被測的路）；換頁一律點畫面上的分頁、旅程卡、按鈕。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5871;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const sharp = (await import('sharp')).default;

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const soft = (p) => p.then(() => true, () => false);
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });

const TABS = ['主頁', '任務', '行程', '照片', '分帳'];
const KINDS = ['tit', 'cockatiel', 'hawk', 'schnauzer', 'bunny'];
const NUM = { 主頁: 'TI03', 任務: 'TI04', 行程: 'TI05', 照片: 'TI06', 分帳: 'TI07' };
const WHO = { 主頁: '湯圓', 任務: '小鳳', 行程: '阿灰', 照片: '鬍鬍', 分帳: '棉棉' };

// 鏡射軸：mask[y*W+x]＝1 是要比的畫素；在 [lo,hi]（畫素座標，0.5 一格）裡找鏡射對不上最少的那條線。
// 畫素 x 的中心是 x+0.5，鏡射到 2a−x−0.5，也就是第 2a−x−1 格；鏡射出範圍外算對不上（範圍外是空的）。
function mirrorAxis(mask, W, H, lo, hi) {
  let ink = 0;
  for (const v of mask) ink += v;
  let best = null;
  for (let a2 = Math.ceil(2 * lo); a2 <= Math.floor(2 * hi); a2++) {
    let mis = 0;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (!mask[row + x]) continue;
        const xm = a2 - x - 1;
        if (xm < 0 || xm >= W || !mask[row + xm]) mis++;
      }
    }
    const s = ink ? mis / ink : 1;
    if (!best || s < best.score) best = { axis: a2 / 2, score: s };
  }
  return { ...best, ink };
}

async function shot(page, vw) {
  const png = await page.screenshot();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, d: info.width / vw };
}

// 分頁列五格：每一格亮不亮、字、頭像（誰、大小、aria-hidden）、鏡射軸離圓心幾 px。prep＝對照組：把哪一隻的圖往左挪 10 個畫布單位
async function measureTabs(page, prep = null) {
  const info = await page.evaluate(async (prep) => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* 一直重複的不能 finish */ } });
    if (prep) {
      const g = document.querySelector(`#tabbar svg.mc-tab[data-mascot="${prep}"] .mc-fig`);
      if (g) g.setAttribute('transform', 'translate(-10 0)');
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bar = document.getElementById('tabbar');
    return {
      vw: innerWidth, barH: bar ? +bar.getBoundingClientRect().height.toFixed(1) : null,
      prepped: prep ? !!document.querySelector(`#tabbar svg.mc-tab[data-mascot="${prep}"] .mc-fig[transform="translate(-10 0)"]`) : null,
      tabs: [...document.querySelectorAll('#tabbar .tab')].map((a) => {
        const s = a.querySelector('svg.mc-tab');
        const r = s && s.getBoundingClientRect();
        return { label: a.textContent.trim(), on: a.classList.contains('active'), ti: (a.querySelector('.ti')?.textContent || '').trim(),
          kind: s ? s.dataset.mascot : null, hidden: s ? s.getAttribute('aria-hidden') === 'true' : null,
          r: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null };
      }),
    };
  }, prep);
  const img = await shot(page, info.vw);
  for (const t of info.tabs) {
    if (!t.r) continue;
    const { d } = img, cx = (t.r.x + t.r.w / 2) * d, cy = (t.r.y + t.r.h / 2) * d, R = (t.r.w / 2 - 3) * d;
    const ox = Math.floor(cx - R) - 1, oy = Math.floor(cy - R) - 1, W = Math.ceil(2 * R) + 3, H = W;
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const X = ox + x, Y = oy + y;
      if (X < 0 || Y < 0 || X >= img.W || Y >= img.H) continue;
      if ((X + 0.5 - cx) ** 2 + (Y + 0.5 - cy) ** 2 > R * R) continue;
      const i = (Y * img.W + X) * 3;
      if (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2] < 110) m[y * W + x] = 1;
    }
    const a = mirrorAxis(m, W, H, (cx - ox) - 0.35 * W, (cx - ox) + 0.35 * W);
    t.off = +((ox + a.axis - cx) / d).toFixed(2);
    t.ink = a.ink;
  }
  if (prep) await page.evaluate((prep) => document.querySelector(`#tabbar svg.mc-tab[data-mascot="${prep}"] .mc-fig`)?.removeAttribute('transform'), prep);
  return info;
}

// 空白區塊按鈕上置中掛的姿勢（照片空白頁的鬍鬍 hello、沒有景點的阿灰 point）：
// 剪影的鏡射軸離按鈕中線幾 px。noDx＝對照組：把 --pk-dx 撥回 0（照圖框置中＝修之前）
async function measurePose(page, kind, label, noDx = false) {
  const r = await page.evaluate(async (kind, label, noDx) => {
    const btn = [...document.querySelectorAll('.page .empty .btn')].find((b) => b.textContent.includes(label));
    if (!btn) return { btn: false, found: false };
    const el = btn.querySelector(`:scope > svg.gl-peek[data-peek="${kind}"]`);
    if (!el) return { btn: true, found: false };
    btn.scrollIntoView({ block: 'center' });
    document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* 一直重複的不能 finish */ } });
    const dx = el.style.getPropertyValue('--pk-dx');
    if (noDx) el.style.setProperty('--pk-dx', '0px');
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const s = el.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { btn: true, found: true, dx, vw: innerWidth, vh: innerHeight, s: { x: s.left, y: s.top, w: s.width, h: s.height }, b: { x: b.left, y: b.top, w: b.width } };
  }, kind, label, noDx);
  if (!r.found) return r;
  const img = await shot(page, r.vw);
  if (noDx) await page.evaluate((kind, dx) => { const el = document.querySelector(`.page .empty .btn > svg.gl-peek[data-peek="${kind}"]`); if (el) el.style.setProperty('--pk-dx', dx); }, kind, r.dx);
  const { d } = img;
  const x0 = Math.round(r.s.x * d), x1 = Math.round((r.s.x + r.s.w) * d), y0 = Math.round(r.s.y * d), y1 = Math.round(r.b.y * d) - 1;
  const side = Math.round(6 * d);
  if (x0 - side < 0 || x1 + side >= img.W || y0 < 0 || y1 <= y0) return { ...r, off: null, why: `圖（含左右各 6px 的背景）不整張在畫面裡（${x0}～${x1}、${y0}～${y1}）` };
  // 背景：圖框左右兩邊外面 6px、圖高 30% 那一列的顏色，兩邊要一樣（不一樣就是旁邊有別的東西，量不準）
  const px = (X, Y) => { const i = (Y * img.W + X) * 3; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const yb = Math.round((r.s.y + r.s.h * 0.3) * d);
  const L = px(x0 - side, yb), Rr = px(x1 + side, yb);
  const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  if (dist(L, Rr) > 24) return { ...r, off: null, why: `圖框左右兩邊的背景不一樣（${L}／${Rr}）` };
  const W = x1 - x0, H = y1 - y0, m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dist(px(x0 + x, y0 + y), L) > 60) m[y * W + x] = 1;
  const a = mirrorAxis(m, W, H, 0.2 * W, 0.8 * W);
  return { ...r, off: +((x0 + a.axis) / d - (r.b.x + r.b.w / 2)).toFixed(2), ink: a.ink, score: +(a.score * 100).toFixed(1) };
}

// 剛切到 label 那一格：亮著的那一隻有沒有跳（動畫真的起跑、時間有走或已經播完、只動 transform），其他四格有沒有動畫
const hopState = (page, label) => page.evaluate(async (label) => {
  const tabs = [...document.querySelectorAll('#tabbar .tab')];
  const a = tabs.find((t) => t.classList.contains('active'));
  const s = a && a.querySelector('svg.mc-tab');
  if (!s || !a.textContent.includes(label)) return { found: false, active: a ? a.textContent.trim() : '沒有' };
  const otherAnims = tabs.filter((t) => t !== a).reduce((n, t) => n + (t.querySelector('svg.mc-tab')?.getAnimations({ subtree: true }).length || 0), 0);
  const an = s.getAnimations();
  const res = { found: true, hop: s.classList.contains('tab-hop'), n: an.length, otherAnims };
  const x = an.find((q) => q.animationName === 'tab-hop');
  if (x) {
    await Promise.race([x.ready, new Promise((r) => setTimeout(r, 1000))]);
    const t1 = x.currentTime;
    await new Promise((r) => setTimeout(r, 120));
    res.t1 = t1 == null ? null : Math.round(t1);
    res.t2 = x.currentTime == null ? null : Math.round(x.currentTime);
    res.dur = x.effect.getTiming().duration;
    res.props = [...new Set(x.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)))];
  }
  return res;
}, label);
const hopOk = (h) => h.found && h.hop && h.t1 != null && h.t2 != null && (h.t2 > h.t1 || h.t2 >= h.dur - 1)
  && h.props.length === 1 && h.props[0] === 'transform' && h.otherAnims === 0;
const quiet = (h) => h.found && !h.hop && h.n === 0;
const hb = (h) => (!h.found ? `亮著的是「${h.active}」、沒有頭像` : `tab-hop ${h.hop}、${h.n} 段動畫${h.t1 != null ? `（時間 ${h.t1}→${h.t2}／${h.dur}ms、動 ${h.props.join(' ')}）` : ''}、其他四格 ${h.otherAnims} 段`);

// 點一格分頁（使用者的路），等那一格亮起來、頁面畫出來
async function goTab(page, label) {
  if (!await tap(page, '#tabbar a.tab', label)) return false;
  return soft(page.waitForFunction((l) => {
    const a = document.querySelector('#tabbar .tab.active');
    return !!a && a.textContent.includes(l) && !!document.querySelector('#view .page');
  }, { timeout: 15000 }, label));
}

// 從首頁點旅程卡進主頁
async function enterTrip(page, title) {
  if (!await soft(page.waitForSelector('.trip-card', { timeout: 15000 }))) return false;
  if (!await tap(page, '.trip-card', title)) return false;
  return soft(page.waitForFunction(() => /\/home$/.test(location.hash) && !!document.querySelector('#tabbar .tab.active svg.mc-tab'), { timeout: 15000 }));
}

const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
const ext = new Map();
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u.startsWith(ORIGIN) || /^(data|blob):/.test(u)) { req.continue().catch(() => {}); return; }
  if (/^https?:/.test(u)) { const host = new URL(u).hostname; ext.set(host, (ext.get(host) || 0) + 1); }
  req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
});

try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await soft(page.waitForSelector('.hero', { timeout: 20000 }));
  const TITLE = '分頁頭像的一趟', TITLE2 = '還沒排景點的一趟';
  const tid = await page.evaluate(async (ttl, ttl2) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const g = uuid(), t = uuid(), m = uuid();
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await s.put({ id: g, type: 'group', name: 'g' });
    await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
    await s.put({ id: t, type: 'trip', groupId: g, title: ttl, region: '宜蘭', allowWiki: false, startDate: day(3), endDate: day(4) });
    const { spots, quests } = await generateForTrip({ tripId: t, region: '宜蘭', items: [{ name: '羅東夜市', day: 1 }] });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    await (await import('./js/claim.js')).claim(t, m);
    // 第二趟：一個景點都沒有（TI16／TI17 的阿灰）
    const t2 = uuid();
    await s.put({ id: t2, type: 'trip', groupId: g, title: ttl2, region: '宜蘭', allowWiki: false, startDate: day(5), endDate: day(6) });
    await (await import('./js/claim.js')).claim(t2, m);
    return t;
  }, TITLE, TITLE2);

  for (const theme of ['washi', 'dark']) {
    const tag = theme === 'washi' ? '［和紙］' : '［深色］';
    console.log(`\n— ${tag} —`);
    // 先到 about:blank 再開：只差 # 後面那一段的話 goto 不會重新載入（同一份文件、只換網址）
    await page.goto('about:blank');
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await soft(page.waitForSelector('#tabbar a.tab', { timeout: 15000 }));
    if (theme === 'washi') {
      const th = await page.evaluate(() => document.documentElement.dataset.theme || '沒有');
      yes(th === 'washi', `${tag} 前置：這一輪真的是和紙（<html> data-theme＝${th}）`);
    }
    if (theme === 'dark') {
      const ok = await tap(page, 'a.tab', '設定') && await soft(page.waitForSelector('.theme-seg button', { timeout: 10000 }))
        && await tap(page, '.theme-seg button', '深色');
      const th = ok && await soft(page.waitForFunction(() => document.documentElement.dataset.theme === undefined, { timeout: 5000 }));
      yes(th, `${tag} 前置：這一輪真的是深色（設定頁按「深色」之後 <html> 沒有 data-theme）`);
      await tap(page, 'a.tab', '我的旅程');
    }

    // TI09 首頁那一層
    await soft(page.waitForSelector('.trip-card', { timeout: 15000 }));
    const top = await page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map((a) => ({ label: a.textContent.replace(/[^一-龥]/g, ''), ti: (a.querySelector('.ti')?.textContent || '').trim(), svg: !!a.querySelector('svg') })));
    yes(top.length === 2 && top[0].label === '我的旅程' && top[1].label === '設定' && top.every((t) => !t.svg && t.ti.length > 0),
      `${tag} TI09 首頁那一層照舊是表情符號、沒有頭像（${top.map((t) => `${t.label}：${t.svg ? '有 svg' : t.ti || '空'}`).join('、') || '沒有分頁'}）`);

    // 從旅程卡進來（主頁亮）→ 依序點任務、行程、照片、分帳：每一次量跳、量五格
    const visits = {}, hops = {};
    let hello = null, helloCtl = null, ctl = null;
    let ok = await enterTrip(page, TITLE);
    hops['主頁'] = ok ? await hopState(page, '主頁') : { found: false, active: '沒進到旅程' };
    if (ok) visits['主頁'] = await measureTabs(page);
    for (const L of TABS.slice(1)) {
      ok = await goTab(page, L);
      hops[L] = ok ? await hopState(page, L) : { found: false, active: `點不到或等不到「${L}」` };
      if (!ok) continue;
      if (L === '照片') {
        await soft(page.waitForFunction(() => [...document.querySelectorAll('.page .empty .btn')].some((b) => b.textContent.includes('回任務清單')), { timeout: 15000 }));
        await sleep(300);
        hello = await measurePose(page, 'hello', '回任務清單');
        helloCtl = await measurePose(page, 'hello', '回任務清單', true);
      }
      visits[L] = await measureTabs(page);
      if (L === '任務') ctl = await measureTabs(page, 'schnauzer');
    }

    // TI01：任務亮著那一次的五格
    const v1 = visits['任務'];
    const t1 = v1 ? v1.tabs : [];
    yes(t1.length === 5 && t1.every((t, i) => t.label === TABS[i] && t.kind === KINDS[i] && t.hidden === true && t.ti === ''),
      `${tag} TI01 旅程那一層五格是湯圓／小鳳／阿灰／鬍鬍／棉棉的頭像、aria-hidden、字照舊（${t1.map((t) => `${t.label}=${t.kind || '沒有頭像'}${t.hidden ? '' : '（沒藏）'}${t.ti ? `＋「${t.ti}」` : ''}`).join('、') || '沒量到'}）`);
    // TI02：五次各量一次大小
    const sizeBad = [];
    for (const L of TABS) {
      const v = visits[L];
      if (!v) { sizeBad.push(`${L} 那次沒量到`); continue; }
      for (const t of v.tabs) {
        const want = t.on ? 30 : 26;
        if (!t.r || Math.abs(t.r.w - want) > 0.5 || Math.abs(t.r.h - want) > 0.5) sizeBad.push(`${L}亮時 ${t.label} ${t.r ? `${t.r.w}×${t.r.h}` : '沒有頭像'}（要 ${want}）`);
      }
      if (v.barH !== 76) sizeBad.push(`${L}亮時分頁列高 ${v.barH}`);
    }
    yes(sizeBad.length === 0, `${tag} TI02 亮著那一格 30px、其餘 26px，五格輪流亮每一次都對；分頁列高 76px（${sizeBad.join('、') || `分頁列 ${v1 ? v1.barH : '?'}px`}）`);
    // TI03～TI07：每一格亮與不亮兩種
    for (const [i, L] of TABS.entries()) {
      const on = visits[L] && visits[L].tabs[i];
      const offBy = visits[L === '任務' ? '主頁' : '任務'];
      const off = offBy && offBy.tabs[i];
      // 大小歸 TI02 管（這裡不再比 30／26：大小錯了只該紅 TI02，不要連五條置中一起紅——突變分不出是哪一條規則擋的）
      const good = (t) => !!t && !!t.r && t.on === (t === on) && t.ink >= 200 && Math.abs(t.off) <= 0.7;
      const say = (t) => (!t ? '沒量到' : !t.r ? '沒有頭像' : `${t.off}px（${t.r.w}px、深色畫素 ${t.ink}）`);
      yes(good(on) && good(off),
        `${tag} ${NUM[L]} ${L}那格的${WHO[L]}置中：圓裡線條的鏡射軸離圓心 ≤ 0.7px（亮著：${say(on)}；沒亮：${say(off)}）`);
    }
    // TI08 對照組
    const c = ctl && ctl.tabs[3];
    yes(!!ctl && ctl.prepped && !!c && c.r && c.off <= -1.0 && c.ink >= 200,
      `${tag} TI08 對照組：照片那格的圖往左挪 10 個畫布單位（第一版 cx 110 的樣子），同一個量法量得到偏左（${!ctl ? '沒量到' : `挪上去了 ${ctl.prepped}；${c && c.r ? `${c.off}px、深色畫素 ${c.ink}` : '沒有頭像'}`}；要 ≤ -1.0px）`);
    // TI10 五次切換都跳
    const hopBad = TABS.filter((L) => !hopOk(hops[L] || { found: false, active: '沒量' }));
    yes(hopBad.length === 0,
      `${tag} TI10 切到別格（含從旅程卡進來）新亮的那一隻跳一下、動畫真的起跑、只動 transform，其他四格不動（${TABS.map((L) => `${L}：${hb(hops[L] || { found: false, active: '沒量' })}`).join('；')}）`);
    // TI13／TI14 照片空白頁的鬍鬍
    const hs = (h) => (!h ? '沒到那一頁' : !h.btn ? '找不到按鈕' : !h.found ? '按鈕上沒有那一隻' : h.off == null ? h.why : `${h.off}px（--pk-dx ${h.dx || '沒設'}；剪影畫素 ${h.ink}、對不上 ${h.score}%）`);
    const mid = (h) => !!h && h.off != null && h.ink >= 500 && Math.abs(h.off) <= 0.7;
    yes(mid(hello),
      `${tag} TI13 照片頁還沒有照片：「回任務清單」上揮手的鬍鬍身體中線對準按鈕中線 ≤ 0.7px（${hs(hello)}）`);
    yes(!!helloCtl && helloCtl.off != null && helloCtl.ink >= 500 && helloCtl.off <= -8,
      `${tag} TI14 對照組：同一張圖把 --pk-dx 撥回 0（照圖框置中＝修之前），同一個量法量到身體在按鈕中線左邊 ≥ 8px（${hs(helloCtl)}）`);

    // TI11 同一格裡進子頁面：行程 →「調整每天的行程」
    // 剛點「行程」那一下新亮的那一隻跳過（tab-hop 留在那個元素上、動畫播完停著）：先等它播完再進子頁面，
    // 之後只看「還是同一個元素、沒有正在跑的動畫」。第一版看 tab-hop 有沒有、動畫段數是 0——同一個元素本來就帶著剛才那一跳的
    // class 與播完的動畫，第一次跑（2026-11-19 08:33）兩輪都因此紅，是測試寫錯、不是 App（事後改）。
    let sub = { pre: false };
    if (await goTab(page, '行程') && await soft(page.waitForSelector('.itin-edit', { timeout: 15000 }))) {
      const settled = await page.evaluate(async () => {
        const s = document.querySelector('#tabbar .tab.active svg.mc-tab');
        window.__tqTabEl = s;
        const t0 = Date.now();
        while (s && s.getAnimations().some((a) => a.playState === 'running' || a.pending) && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 50));
        return !!s && !s.getAnimations().some((a) => a.playState === 'running' || a.pending);
      });
      const went = settled && await tap(page, '.itin-edit', '調整') && await soft(page.waitForFunction(() => /\/plan$/.test(location.hash), { timeout: 15000 }));
      await sleep(200);
      sub = await page.evaluate((went) => {
        const s = document.querySelector('#tabbar .tab.active svg.mc-tab');
        const an = s ? s.getAnimations() : [];
        return { pre: went, same: !!s && s === window.__tqTabEl, label: document.querySelector('#tabbar .tab.active')?.textContent.trim() || '沒有',
          running: an.filter((a) => a.playState === 'running' || a.pending).length, states: an.map((a) => `${a.animationName}:${a.playState}`).join(' ') || '沒有' };
      }, went);
      sub.settled = settled;
    }
    yes(sub.pre && sub.label === '行程' && sub.same && sub.running === 0,
      `${tag} TI11 行程那一格裡進「調整每天的行程」：分頁列沒重畫（同一個元素）、沒有正在跑的動畫（前置：剛才那一跳播完了 ${sub.settled ?? '?'}、網址換到 /plan ${sub.pre}；亮著「${sub.label ?? '?'}」、同一個 ${sub.same}、正在跑 ${sub.running ?? '?'} 段（${sub.states ?? '?'}））`);

    // TI15 直接打開（重新整理）：先到 about:blank，不然只換 # 後面那一段、不會重新載入
    await page.goto('about:blank');
    await page.goto(`${ORIGIN}/#/trip/${tid}/itinerary`, { waitUntil: 'networkidle0' });
    const boot = await soft(page.waitForFunction(() => !!document.querySelector('#tabbar .tab.active svg.mc-tab'), { timeout: 15000 })) ? await hopState(page, '行程') : { found: false, active: '等不到' };
    yes(quiet(boot), `${tag} TI15 直接打開行程分頁（重新整理）：亮著那一格不跳（${hb(boot)}）`);

    // TI16／TI17 沒有景點的那一趟：主頁與任務頁「＋ 去安排景點」上指路的阿灰（從首頁點旅程卡進來，再點「任務」）
    let ptHome = null, ptHomeCtl = null, ptTask = null, ptTaskCtl = null;
    await page.goto('about:blank');
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    if (await enterTrip(page, TITLE2)) {
      const sel = '.page .empty .btn > svg.gl-peek[data-peek="point"]';
      if (await soft(page.waitForSelector(sel, { timeout: 15000 }))) {
        await sleep(300);
        ptHome = await measurePose(page, 'point', '去安排景點');
        ptHomeCtl = await measurePose(page, 'point', '去安排景點', true);
      }
      if (await goTab(page, '任務') && await soft(page.waitForFunction(() => /\/trip\/[^/]+$/.test(location.hash) && !!document.querySelector('.page:not(.trip-home) .empty .btn > svg.gl-peek[data-peek="point"]'), { timeout: 15000 }))) {
        await sleep(300);
        ptTask = await measurePose(page, 'point', '去安排景點');
        ptTaskCtl = await measurePose(page, 'point', '去安排景點', true);
      }
    }
    yes(mid(ptHome) && mid(ptTask),
      `${tag} TI16 還沒有景點：主頁與任務頁「＋ 去安排景點」上指路的阿灰身體中線對準按鈕中線 ≤ 0.7px（主頁 ${hs(ptHome)}；任務頁 ${hs(ptTask)}）`);
    const ctlL = (h) => !!h && h.off != null && h.ink >= 500 && h.off <= -5;
    yes(ctlL(ptHomeCtl) && ctlL(ptTaskCtl),
      `${tag} TI17 對照組：同一張圖把 --pk-dx 撥回 0（修之前），同一個量法量到身體在按鈕中線左邊 ≥ 5px（主頁 ${hs(ptHomeCtl)}；任務頁 ${hs(ptTaskCtl)}）`);

    // TI12（深色那輪）減少動態效果
    if (theme === 'dark') {
      let rm = false, h1 = { found: false, active: '沒量' }, h2 = { found: false, active: '沒量' };
      await page.goto('about:blank');
      await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
      if (await soft(page.waitForSelector('#tabbar a.tab', { timeout: 15000 })) && await tap(page, 'a.tab', '設定') && await soft(page.waitForSelector('label.switch-row', { timeout: 10000 }))) {
        await tap(page, 'label.switch-row', '減少動態效果');
        rm = await page.evaluate(() => new Promise((r) => { const t0 = Date.now(); const k = () => (document.documentElement.classList.contains('reduce-motion') || Date.now() - t0 > 5000 ? r(document.documentElement.classList.contains('reduce-motion')) : setTimeout(k, 50)); k(); }));
        if (await tap(page, 'a.tab', '我的旅程') && await enterTrip(page, TITLE)) {
          h1 = await hopState(page, '主頁');
          if (await goTab(page, '照片')) h2 = await hopState(page, '照片');
        }
      }
      yes(rm === true, `${tag} 前置：設定頁打開「減少動態效果」→ <html> 有 reduce-motion（${rm}）`);
      yes(quiet(h1) && quiet(h2), `${tag} TI12 減少動態效果時切到別格不跳（從旅程卡進主頁：${hb(h1)}；切到照片：${hb(h2)}）`);
    }
  }
  console.log('\n分頁頭像測試結束');
} catch (e) {
  console.log('✗ 例外：' + String(e && e.stack || e).split('\n').slice(0, 3).join(' ｜ '));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
console.log(`・外站請求一律當場回 503、沒有放出去：${[...ext].map(([h, n]) => `${h}×${n}`).join('、') || '這一輪 0 次'}`);
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
