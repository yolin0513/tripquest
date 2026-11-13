// 吉祥物（js/glyphs.js；2026-11-13 第三段）從使用者的入口驗（npm run mascottest；會開瀏覽器）
//
// 涵蓋的程式：js/glyphs.js、js/app.js（頁首）、js/ui.js（spinnerBox、celebrate）、js/addphoto.js、
//   js/views/home.js、js/views/recap.js、js/views/settings.js、css/style.css
//
// 和紙、深色各跑一輪（各開一個全新的瀏覽器情境；深色那輪從底部分頁「設定」→「畫面顏色」點「深色」切過去）：
//   M1 頁首：標題左邊是雪納瑞的頭（不是背包）、高 26（跟背包一樣）、在標題字左邊、不疊字；
//      頁首高度跟「同一頁換回背包」量到的一樣（頁首高度不變——貼門檻的版面測試靠這個）；首頁、設定頁、旅程頁都看一次
//   M2 空白頁：全新的 App「我的旅程」沒有旅程 → 空白那一塊是白兔、看得到、原本的 🧳 不在了
//   M3 載入中：「回顧」分頁按「最終回顧」→ 整理回顧時（天氣請求被攔住、確定還在等）轉圈上面是鷹、在轉圈上方
//   M4 行程回顧：放行天氣請求之後 → 回顧標題上面是白熊
//   M5 完成任務：任務頁那一站「從相簿選」一張照片 → 慶祝畫面是玄鳳、沒有打勾的圓
//      （2026-11-13 第四段之二起：有照片時玄鳳改成從照片上緣探頭——js/peeks.js 的 done；那一站用沒有對得上類別的龍山寺。
//       各類別換哪一張、邊線對不對齊，由 scripts/peektest.mjs 驗；這裡只驗「出場的是玄鳳」與主題、無障礙）
//   M6 設定頁：底部分頁「設定」→「關於」卡裡是山雀
//   M7 主題：和紙下身體沒有白邊、地面陰影與動作線看得到；深色下身體套白邊濾鏡（濾鏡真的在那張圖裡）、陰影與動作線不畫
//   M8 六個出場處六隻、各不相同（六隻平等、不重複）；每一張 aria-hidden、沒有 <text>／<title>（不寫名字）；
//      圖裡的 id 在整頁唯一、每個 url(#…) 都指到同一張圖裡面（同一頁好幾張時不會指到別張的裁切框）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5813;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

// 一張真的 1×1 PNG，走完整的加照片流程（同 blanktest）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photoPath = join(mkdtempSync(join(tmpdir(), 'tq-mascot-')), 'p.png');
writeFileSync(photoPath, PNG);

const EXPECT = { header: 'schnauzer', empty: 'bunny', loading: 'hawk', done: 'cockatiel', recap: 'bear', settings: 'tit' };

// 量一張吉祥物：種類、大小、看不看得到、白邊／陰影／動作線的狀態、無障礙、id 與引用
const probe = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const fig = el.querySelector('.mc-fig');
  const filt = fig ? getComputedStyle(fig).filter : '';
  const fid = fig && /url\(#([^)]+)\)/.exec(fig.getAttribute('filter') || '');
  const vis = (c) => { const g = el.querySelector(c); return g ? getComputedStyle(g).display !== 'none' && g.getBoundingClientRect().width > 0 : null; };
  const ids = [...el.querySelectorAll('[id]')].map((x) => x.id);
  const dupIds = ids.filter((id) => document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length !== 1);
  const refs = [...el.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  const strayRefs = refs.filter((id) => !el.querySelector(`[id="${CSS.escape(id)}"]`));
  const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    found: true, kind: el.getAttribute('data-mascot'), cls: el.getAttribute('class') || '',
    w: Math.round(r.width), h: Math.round(r.height * 10) / 10, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0,
    covered: !mid || !(mid === el || el.contains(mid)),
    filter: filt, rimOk: !!(fid && el.querySelector(`filter[id="${CSS.escape(fid[1])}"]`)),
    shadow: vis('.mc-shadow'), extra: vis('.mc-extra'),
    aria: el.getAttribute('aria-hidden'), texty: el.querySelectorAll('text, title').length,
    ids: ids.length, dupIds, refs: refs.length, strayRefs,
  };
}, sel);

const brief = (p) => p.found ? `${p.kind}，${p.w}×${p.h}` : '沒找到';

// M7：這一輪的主題下，白邊／陰影／動作線該是什麼樣子
function themeCheck(tag, where, p, washi, hasGround) {
  if (washi) {
    yes(p.found && p.filter === 'none', `${tag} M7 ${where}：和紙下身體沒有白邊（filter=${p.filter}）`);
    if (hasGround) yes(p.shadow === true && p.extra !== false, `${tag} M7 ${where}：和紙下地面陰影看得到${p.extra === null ? '（這隻沒有動作線）' : '、動作線也看得到'}（陰影 ${p.shadow}、動作線 ${p.extra}）`);
  } else {
    yes(p.found && /url\(/.test(p.filter) && p.rimOk, `${tag} M7 ${where}：深色下身體套白邊濾鏡、濾鏡就在這張圖裡（filter=${p.filter}、找得到 ${p.rimOk}）`);
    if (hasGround) yes(p.shadow === false && p.extra !== true, `${tag} M7 ${where}：深色下地面陰影與動作線不畫（陰影 ${p.shadow}、動作線 ${p.extra}）`);
  }
}

// M8 的無障礙與 id 部分：每一張都要
// 圖不在（p.found=false）時欄位都是 undefined：訊息裡不能直接 .join，否則丟例外、後面全部沒跑（第一輪突變 7 條就是這樣沒跑完）
function hygiene(tag, where, p) {
  const dup = p.dupIds || [], stray = p.strayRefs || [];
  yes(p.found && p.aria === 'true' && p.texty === 0, `${tag} M8 ${where}：aria-hidden、圖裡沒有 <text>／<title>（aria=${p.aria}、文字元素 ${p.texty}）`);
  yes(p.found && dup.length === 0 && stray.length === 0 && p.refs > 0,
    `${tag} M8 ${where}：圖裡 ${p.ids} 個 id 整頁唯一、${p.refs} 個引用都指到這張圖裡面（重複 ${dup.join('、') || '無'}；指到外面 ${stray.join('、') || '無'}）`);
}

// M1：頁首
async function header(page, tag, where) {
  const p = await probe(page, '#topTitle svg.gl-mascot');
  const t = await page.evaluate(() => {
    const tx = document.querySelector('#topTitle .top-title-text');
    const pk = document.querySelector('#topTitle svg.gl-pack');
    return { left: tx ? tx.getBoundingClientRect().left : null, pack: !!pk, bar: document.getElementById('topbar').getBoundingClientRect().bottom };
  });
  yes(p.found && p.kind === EXPECT.header && !t.pack, `${tag} M1 ${where}：頁首標題左邊是雪納瑞的頭、不是背包（${brief(p)}；背包 ${t.pack}）`);
  yes(p.found && Math.abs(p.h - 26) < 0.6 && p.top >= 0 && p.bottom <= t.bar && t.left != null && p.right <= t.left + 1,
    `${tag} M1 ${where}：頭高 26（跟背包一樣）、在頁首裡、在標題字左邊不疊字（高 ${p.h}、右緣 ${Math.round(p.right)}、字左緣 ${Math.round(t.left)}）`);
  return p;
}

// 頁首高度：同一頁把頭換成背包量一次，再換回來（頭換成背包之後頁首該跟以前一模一樣高）
const barHeights = (page) => page.evaluate(async () => {
  const g = await import('./js/glyphs.js');
  const title = document.getElementById('topTitle');
  const head = title.querySelector('svg.gl-mascot');
  const bar = () => document.getElementById('topbar').getBoundingClientRect().height;
  const now = bar();
  if (!head) return { now, withPack: null, back: false };   // 頭不在：記成 ✗（M1 那幾條會點名），不丟例外、照樣跑完
  const pk = g.backpack();
  head.replaceWith(pk);
  const withPack = bar();
  pk.replaceWith(head);
  return { now, withPack, back: !!title.querySelector('svg.gl-mascot') };
});

async function toSettings(page) {
  await clickText(page, 'a.tab', '設定');
  await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('.theme-seg'), { timeout: 15000 });
}
async function toHome(page, sel) {
  await clickText(page, 'a.tab', '我的旅程');
  await page.waitForFunction((s) => (location.hash === '#/' || location.hash === '') && document.querySelector(s), { timeout: 15000 }, sel);
}

// 加完照片會連續跳「完成一個任務」＋新徽章各一次慶祝，全部按掉才會回到頁面（同 tagtest）
async function clearCelebrations(page, max = 10) {
  for (let k = 0; k < max; k++) {
    if (!await page.$('.celebrate')) break;
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.celebrate .btn')];
      (btns.find((b) => /繼續|太棒/.test(b.textContent)) || btns[0])?.click();
    });
    await sleep(350);
  }
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function round(theme) {
  const washi = theme === 'washi';
  const tag = washi ? '［和紙］' : '［深色］';
  console.log(`\n— ${washi ? '和紙' : '深色'} —`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844 });
  const held = [];
  let hold = false;
  await page.setRequestInterception(true);
  // 只放行本機：天氣（旅程頁的天氣列、回顧的當時天氣）等外部請求一律當場回 503，不打真網路（共用慣例 §5.6）；
  // hold 時天氣請求先扣著不回（回顧就停在「整理中」，載入中的畫面才量得到）
  page.on('request', (req) => {
    const u = req.url();
    if (/^(http:\/\/localhost[:/]|data:|blob:)/.test(u)) { req.continue().catch(() => {}); return; }
    if (hold && /open-meteo/.test(u)) { held.push(req); return; }
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  const seen = {};
  try {
    await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero');

    if (!washi) {
      await toSettings(page);
      await clickText(page, '.theme-seg button', '深色');
      await page.waitForFunction(() => document.documentElement.dataset.theme === undefined, { timeout: 5000 });
      await toHome(page, '.empty');
    }
    const attr = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
    yes(attr === (washi ? 'washi' : null), `${tag} 前置：這一輪真的是${washi ? '和紙' : '深色'}（data-theme=${attr}）`);

    // ---- M1 頁首（首頁）＋頁首高度 ----
    const hd = await header(page, tag, '首頁');
    seen.header = hd.kind;
    themeCheck(tag, '頁首的頭', hd, washi, false);
    hygiene(tag, '頁首的頭', hd);
    const bh = await barHeights(page);
    yes(bh.back && bh.now > 0 && Math.abs(bh.now - bh.withPack) < 0.5, `${tag} M1 頁首高度跟換回背包時一樣（頭 ${bh.now}、背包 ${bh.withPack}）`);

    // ---- M2 空白頁 ----
    const em = await probe(page, '.empty .empty-mascot svg.gl-mascot');
    seen.empty = em.kind;
    const bag = await page.evaluate(() => (document.querySelector('.empty')?.textContent || '').includes('🧳'));
    yes(em.found && em.kind === EXPECT.empty && em.h >= 100 && em.inView && !em.covered && !bag,
      `${tag} M2 全新的 App 沒有旅程 → 空白那一塊是白兔、看得到、🧳 不在了（${brief(em)}；在畫面裡 ${em.inView}、被蓋 ${em.covered}；🧳 ${bag}）`);
    themeCheck(tag, '空白頁', em, washi, true);
    hygiene(tag, '空白頁', em);

    // ---- M6 設定頁 ----
    await toSettings(page);
    await header(page, tag, '設定頁');
    const st = await probe(page, '.card.about .about-mascot svg.gl-mascot');
    seen.settings = st.kind;
    yes(st.found && st.kind === EXPECT.settings && st.h >= 80 && st.inView && !st.covered,
      `${tag} M6 設定頁「關於」卡裡是山雀、看得到（${brief(st)}；在畫面裡 ${st.inView}、被蓋 ${st.covered}）`);
    themeCheck(tag, '設定頁', st, washi, true);
    hygiene(tag, '設定頁', st);

    // ---- 造一趟已經結束的行程（回顧才開）：一站有座標的內建景點，任務照內建資料出 ----
    const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
    await page.evaluate(async (start, end) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const { generateForTrip } = await import('./js/quests/generate.js');
      const g = uuid(), t = uuid(), m = uuid();
      await s.put({ id: g, type: 'group', name: 'g' });
      await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
      await s.put({ id: t, type: 'trip', groupId: g, title: '吉祥物測試', region: '台北', allowWiki: false, startDate: start, endDate: end });
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items: [{ name: '龍山寺', day: 1 }] });
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
    }, ago(10), ago(9));
    await toHome(page, '.trip-card');
    await clickText(page, '.trip-card', '吉祥物測試');
    await page.waitForSelector('.qcollapse', { timeout: 15000 });
    await sleep(600);
    await header(page, tag, '旅程頁');

    // ---- M5 完成任務 ----
    const opened = await page.evaluate(() => !!document.querySelector('.qcollapse.open'));
    if (!opened) await clickText(page, '.qc-toggle', '龍山寺');
    await page.waitForSelector('.qcollapse.open .qline .addphoto-icons input[type=file]', { timeout: 10000 });
    const inputs = await page.$$('.qcollapse.open .qline .addphoto-icons input[type=file]');
    // 走不下去的前置：丟例外點名（記成 ✗ 例外、照樣印總結），不當成一條斷言
    if (inputs.length < 2) throw new Error(`前置不成立：任務那一列沒有「拍照／從相簿選」兩個入口（${inputs.length} 個）`);
    await inputs[1].uploadFile(photoPath);            // [0]=拍照 [1]=從相簿選
    await page.waitForSelector('.celebrate', { timeout: 30000 });
    await sleep(700);   // 彈出動畫跑完再量
    // 探頭圖的 data-peek 是「哪一張」（done＝玄鳳打領結），換成「哪一隻」才能跟其他五個出場處比
    const dn = await probe(page, '.celebrate .celebrate-shot svg.gl-peek');
    const peekKind = await page.evaluate(() => document.querySelector('.celebrate .celebrate-shot svg.gl-peek')?.getAttribute('data-peek') || null);
    dn.kind = { done: 'cockatiel' }[peekKind] || (peekKind ? `探頭圖 ${peekKind}` : dn.kind);
    seen.done = dn.kind;
    const badge = await page.evaluate(() => !!document.querySelector('.celebrate .celebrate-badge'));
    const ttl = await page.evaluate(() => document.querySelector('.celebrate h2')?.textContent || '');
    yes(/完成/.test(ttl), `${tag} 前置：跳出來的是完成任務的慶祝（標題「${ttl}」）`);
    yes(dn.found && dn.kind === EXPECT.done && dn.h >= 100 && dn.inView && !badge,
      `${tag} M5 完成任務的慶祝畫面是玄鳳（從照片上緣探頭）、看得到、沒有打勾的圓（${brief(dn)}；在畫面裡 ${dn.inView}；打勾 ${badge}）`);
    themeCheck(tag, '完成任務', dn, washi, false);   // 探頭圖沒有地面陰影；動作線跟著主題的那一條在 peektest
    hygiene(tag, '完成任務（頁首的頭也在同一頁）', dn);
    await clearCelebrations(page);

    // ---- M3 載入中、M4 行程回顧 ----
    hold = true;
    await clickText(page, 'a.tab', '回顧');
    await page.waitForSelector('.mem-card', { timeout: 15000 });
    await clickText(page, '.mem-card', '最終回顧');
    const t0 = Date.now();
    while (!held.length && Date.now() - t0 < 10000) await sleep(100);
    const waiting = await page.evaluate(() => !!document.querySelector('.wait-box') && !document.querySelector('.recap-head'));
    yes(held.length >= 1 && waiting, `${tag} 前置：天氣請求被攔住（${held.length} 個）、回顧還在整理中（${waiting}）`);
    const ld = await probe(page, '.wait-box svg.gl-mascot');
    seen.loading = ld.kind;
    const spin = await page.evaluate(() => { const s = document.querySelector('.wait-box .spinner'); return s ? s.getBoundingClientRect().top : null; });
    yes(ld.found && ld.kind === EXPECT.loading && ld.h >= 70 && ld.inView && spin != null && ld.bottom <= spin + 1,
      `${tag} M3 整理回顧時轉圈上面是鷹、看得到（${brief(ld)}；圖底 ${Math.round(ld.bottom || 0)}、轉圈頂 ${spin == null ? '無' : Math.round(spin)}）`);
    themeCheck(tag, '載入中', ld, washi, true);
    hygiene(tag, '載入中', ld);
    hold = false;
    for (const r of held.splice(0)) await r.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
    await page.waitForSelector('.recap-head', { timeout: 30000 });
    await sleep(300);
    const rc = await probe(page, '.recap-head .recap-mascot svg.gl-mascot');
    seen.recap = rc.kind;
    yes(rc.found && rc.kind === EXPECT.recap && rc.h >= 90 && rc.inView && !rc.covered,
      `${tag} M4 回顧標題上面是白熊、看得到（${brief(rc)}；在畫面裡 ${rc.inView}、被蓋 ${rc.covered}）`);
    themeCheck(tag, '行程回顧', rc, washi, true);
    hygiene(tag, '行程回顧', rc);

    // ---- M8 同一頁放兩張同一隻（現在沒有畫面這樣放，以後誰在同一頁放兩隻一樣的也不能撞 id）----
    if (washi) {
      const two = await page.evaluate(async () => {
        const g = await import('./js/glyphs.js');
        const box = document.createElement('div');
        const a = g.mascot('bear', 60), b = g.mascot('bear', 60);
        box.append(a, b); document.body.append(box);
        const idsOf = (el) => [...el.querySelectorAll('[id]')].map((x) => x.id);
        const inside = (el) => [...el.innerHTML.matchAll(/url\(#([^)]+)\)/g)].every((m) => el.querySelector(`[id="${CSS.escape(m[1])}"]`));
        const ia = idsOf(a), ib = idsOf(b);
        const out = { na: ia.length, overlap: ia.filter((x) => ib.includes(x)), inside: inside(a) && inside(b) };
        box.remove();
        return out;
      });
      yes(two.na >= 2 && two.overlap.length === 0 && two.inside,
        `${tag} M8 同一頁兩張白熊：各 ${two.na} 個 id、沒有一個撞到、引用都指到自己那張（撞到 ${two.overlap.join('、') || '無'}）`);
    }
  } catch (e) {
    yes(false, `${tag} 例外：${e && e.stack || e}`);
  } finally {
    // ---- M8 六個出場處六隻不同 ----
    const spots = Object.keys(EXPECT);
    const kinds = spots.map((k) => seen[k]);
    yes(kinds.every(Boolean) && new Set(kinds).size === spots.length,
      `${tag} M8 六個出場處六隻、各不相同（${spots.map((k) => `${k}=${seen[k] || '沒看到'}`).join('、')}）`);
    await ctx.close();
  }
}

try {
  await round('washi');
  await round('dark');
  console.log('\n吉祥物測試結束');
} catch (e) {
  yes(false, '例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
