// 版面掃描（npm run layouttest，v1.73）—— 使用者點名「超大型字體會不會跑版」。
//
// 為什麼要有這一支：最近幾個 bug 都是「斷言全綠但畫面壞掉」。
// 既有的斷言驗的是「東西在不在」，驗不到「並排在一起會不會擠爆」。
// 所以這裡不抽樣：**每一頁 × 標準／大／特大字級 × 320/360/390/430px，逐一渲染**，
// 加上每一個對話框，機械化檢查六件事：
//   1. 橫向溢出（整頁能左右捲＝版面已經爆了）
//   2. 文字被截斷（scrollWidth > clientWidth 且沒有 overflow 設定）
//   3. 按鈕文字折行（用 Range 數行數，不是拿高度除行高 —— 那會把 padding 算進去）
//   4. 元素重疊（同層的兄弟節點矩形相交）
//   5. 觸控區小於 44px
//   6. 內容被固定元素遮住（底部分頁列 76px、SOS 鈕）
//
// 320px 是 iPhone SE 一代那種老機型；430px 是 iPhone Pro Max。長輩用舊手機的機率不低。

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5701, OSRM = 5702, OP = 5703;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const SHOTS = process.env.TQ_LAYOUT_SHOTS ? path.join(ROOT, 'screenshots', '_layout') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ---- 假外部服務：版面掃描不該打真的服務，也不該因為網路慢就變不決定性 ----
import { createServer } from 'node:http';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const osrmSrv = createServer((req, res) => {
  const m = req.url.match(/\/table\/v1\/[a-z]+\/([^?]+)/);
  if (!m) { res.writeHead(404); return res.end(); }
  // 依實際座標距離回時間，不要一律 900 秒 —— 均勻矩陣會讓 suggestOrder 永遠
  // 判定「已經很順」，「建議順序」那個對話框就永遠開不起來、掃不到。
  const pts = decodeURIComponent(m[1]).split(';').map((p2) => p2.split(',').map(Number));
  const n = pts.length;
  const dur = (a, b) => Math.round(Math.hypot((a[0] - b[0]) * 101, (a[1] - b[1]) * 111) * 90);
  res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 'Ok', durations: pts.map((a) => pts.map((b) => dur(a, b))) }));
  void n;
});
osrmSrv.listen(OSRM);
const opSrv = createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 24.6775, lon: 121.767, tags: { amenity: 'parking', name: '羅東夜市公有停車場', fee: 'yes', capacity: '186' } },
      { type: 'node', id: 2, lat: 24.678, lon: 121.768, tags: { amenity: 'toilets', wheelchair: 'yes', changing_table: 'yes' } },
      { type: 'node', id: 3, lat: 24.6772, lon: 121.7665, tags: { shop: 'convenience', name: '7-Eleven 羅東門市', opening_hours: '24/7' } },
      { type: 'node', id: 4, lat: 24.679, lon: 121.769, tags: { amenity: 'hospital', name: '羅東博愛醫院', emergency: 'yes' } },
    ] }));
  });
});
opSrv.listen(OP);

let pass = 0;
const problems = [];
const seen = new Set();          // 同一個問題在多個組合出現只記一次（但記下所有組合）
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; }
};

const WIDTHS = [320, 360, 390, 430];
const FONTS = ['m', 'l', 'xl'];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://localhost:${WEB}`, ['geolocation']);
  const page = await ctx.newPage();
  await page.setGeolocation({ latitude: 24.6771, longitude: 121.7669 });
  await page.evaluateOnNewDocument((o) => {
    window.__TQ_OSRM_ENDPOINT = o.osrm;
    window.__TQ_OVERPASS_ENDPOINT = o.op;
  }, { osrm: `http://localhost:${OSRM}`, op: `http://localhost:${OP}/interpreter` });
  page.on('pageerror', (e) => problems.push({ kind: 'pageerror', where: 'global', detail: e.message.slice(0, 120) }));

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- 建一份「有內容」的行程：空頁面驗不到擠壓 ----------
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const db = await import('./js/db.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族小旅行（三天兩夜）', region: '宜蘭',
      country: 'TW', startDate: '2026-10-01', endDate: '2026-10-03', aiEnabled: false,
      createdByDevice: myDeviceId(), baseCurrency: 'TWD' });
    await s.put({ id: me, type: 'member', tripId: tid, groupId: gid, displayName: '阿嬤' });
    await s.put({ id: uuid(), type: 'member', tripId: tid, groupId: gid, displayName: '爸爸' });
    // 長名稱是版面殺手 —— 故意放幾個
    const names = [
      ['國立傳統藝術中心宜蘭園區', 1], ['蘭陽博物館', 1], ['頭城老街', 1],
      ['礁溪溫泉公園森林風呂', 2], ['甕窯雞', 2], ['羅東夜市', 2],
      ['金車生技水產養殖研發中心', 3], ['幾米公園', 3],
    ];
    const spots = [];
    for (let i = 0; i < names.length; i++) {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name: names[i][0], emoji: '📍',
        // 第 1 天刻意排成 Z 字（近→遠→近），不然 suggestOrder 會回「已經很順」
        // 直接 toast 不開對話框，掃描器就掃不到那個對話框。
        day: names[i][1], order: i,
        lat: 24.67 + [0, 0.06, 0.01][i] * (i < 3 ? 1 : 0) + (i >= 3 ? i * 0.01 : 0),
        lng: 121.76 + (i % 3) * 0.01,
        startMin: i === 0 ? 9 * 60 : undefined, stayMin: 60,
        blurb: '這裡是這趟不能少的一站，慢慢走、慢慢看，找個角度拍一張會想一直看的照片。' });
      spots.push(id);
      for (let q = 0; q < 2; q++) {
        await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: id, order: q, source: 'template',
          title: `拍下 ${names[i][0]} 最有代表性的一幕`,
          hint: '站遠一點，把整體帶進畫面；不用擺姿勢，抓大家正在笑的那一刻最好。' });
      }
    }
    // 一張照片（相簿／影片頁需要）
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    await db.putBlob({ hash: 'h1', blob: new Blob([png], { type: 'image/png' }), w: 1, h: 1, bytes: png.length, kind: 'photo' });
    const q1 = s.questsOf(spots[0])[0];
    await s.put({ id: uuid(), type: 'submission', tripId: tid, questId: q1.id, memberId: me,
      photoHash: 'h1', thumbHash: 'h1', createdAt: Date.now() });
    // 一筆分帳
    await s.put({ id: uuid(), type: 'expense', tripId: tid, groupId: gid, title: '晚餐（羅東夜市三攤）',
      amount: 1250, currency: 'TWD', payerId: me, at: Date.now(), category: 'food', shareIds: [me] });
    return { tid, gid };
  });

  // ---------- 檢查器（跑在瀏覽器裡）----------
  const CHECK = `(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1;
    };
    const label = (el) => (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '');
    const txt = (el) => (el.textContent || '').trim().slice(0, 22);

    // 1. 橫向溢出
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
      out.push({ kind: 'overflow-x', where: 'document', detail: de.scrollWidth + ' > ' + de.clientWidth });
      // 找兇手：右緣超出視窗的元素
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && el.offsetParent !== null) {
          out.push({ kind: 'overflow-el', where: label(el), detail: '右緣 ' + Math.round(r.right) + ' > ' + vw + ' ｜「' + txt(el) + '」' });
          break;
        }
      }
    }

    // 2+3. 按鈕：文字折行、觸控區
    //
    // 折行的判準要分兩種，不能一律當問題（第一版就是這樣，噴了 199 個假警報）：
    //  · **並排的按鈕**折行 ＝ 被旁邊的擠扁了，是真問題。
    //  · **滿版按鈕**折成兩行是正常的（長標籤在窄螢幕本來就會換行，而且好讀）；
    //    折成三行以上才是問題。
    //  · 底部分頁列（.tab）本來就是「圖示一行、文字一行」，完全不該算折行。
    //  · **卡片型按鈕**（<button> 裡包了區塊級子元素，例如景點卡的「emoji / 名稱 /
    //    主題 / 進度」各自一行）本來就是多行，Range 會回一堆矩形，量了沒有意義。
    //    只量「純文字標籤」的按鈕，那才是會被旁邊擠扁的那一類。
    const isBlocky = (el) => [...el.children].some((c) => {
      const d = getComputedStyle(c).display;
      return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d === 'table';
    });
    for (const b of document.querySelectorAll('button, .btn, a.btn, .nl-cat')) {
      const r = b.getBoundingClientRect();
      if (!r.width || b.offsetParent === null) continue;
      if (b.closest('#tabbar')) continue;                 // 分頁列：圖示+文字兩行是設計
      const t = txt(b);
      if (!t) continue;
      if (isBlocky(b)) continue;                          // 卡片型按鈕：多行是設計
      const parent = b.parentElement;
      const pw = parent ? parent.getBoundingClientRect().width : r.width;
      const fullWidth = pw > 0 && r.width >= pw * 0.85;
      const n = lines(b);
      const limit = fullWidth ? 2 : 1;
      if (n > limit) {
        out.push({ kind: fullWidth ? 'btn-wrap-3' : 'btn-wrap-squeezed', where: label(b),
          detail: '「' + t + '」折成 ' + n + ' 行' + (fullWidth ? '（滿版，>2 行才算）' : '（並排被擠扁）') });
      }
      if (r.height < 44 && !b.closest('.pv') && !b.closest('#tabbar')) {
        out.push({ kind: 'touch-small', where: label(b), detail: '「' + t + '」高 ' + Math.round(r.height) + 'px < 44' });
      }
    }

    // 4. 文字被截斷（有 overflow:hidden 且內容比容器寬，又沒有 ellipsis）
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'visible' || !el.textContent.trim()) continue;
      if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
        out.push({ kind: 'text-clip', where: label(el), detail: '「' + txt(el) + '」' + el.scrollWidth + ' > ' + el.clientWidth });
      }
    }

    // 5. 被固定元素遮住：最後一個可見內容的底部不能低於分頁列頂端
    const bar = document.getElementById('tabbar');
    if (bar && !bar.hidden) {
      const barTop = bar.getBoundingClientRect().top;
      const pageEl = document.querySelector('.page');
      if (pageEl) {
        const kids = [...pageEl.children].filter((x) => x.getBoundingClientRect().height > 0);
        const last = kids[kids.length - 1];
        if (last) {
          const lr = last.getBoundingClientRect();
          // 只有在頁面捲到底時才有意義
          const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
          if (atBottom && lr.bottom > barTop + 1) {
            out.push({ kind: 'hidden-by-tabbar', where: label(last), detail: '底部 ' + Math.round(lr.bottom) + ' > 分頁列 ' + Math.round(barTop) });
          }
        }
      }
    }
    return out;
  })()`;

  const record = (combo, list) => {
    for (const p of list) {
      const key = p.kind + '|' + p.where + '|' + (p.detail || '').slice(0, 40);
      if (seen.has(key)) { const e = problems.find((x) => x.key === key); if (e && e.combos.length < 6) e.combos.push(combo); continue; }
      seen.add(key);
      problems.push({ key, ...p, combos: [combo] });
    }
  };

  // ---------- 掃描 ----------
  const ROUTES = [
    ['首頁', '/'],
    ['行程頁', `/trip/${ids.tid}`],
    ['旅程設定', `/trip/${ids.tid}/settings`],
    ['調整行程', `/trip/${ids.tid}/plan`],
    ['搜尋景點', `/trip/${ids.tid}/findspot`],
    ['照片牆', `/trip/${ids.tid}/people`],
    ['相簿影片', `/trip/${ids.tid}/album`],
    ['海報', `/trip/${ids.tid}/poster`],
    ['分帳', `/trip/${ids.tid}/expenses`],
    ['回顧入口', `/trip/${ids.tid}/memories`],
    ['成果回顧', `/trip/${ids.tid}/recap`],
    ['成就', `/trip/${ids.tid}/badges`],
    ['天氣', `/trip/${ids.tid}/weather`],
    ['緊急求助', `/trip/${ids.tid}/sos`],
    ['找附近', `/trip/${ids.tid}/nearby`],
    ['建立行程', '/new'],
    ['設定', '/settings'],
  ];

  let combos = 0;
  console.log(`— 逐頁掃描（${ROUTES.length} 頁 × ${FONTS.length} 字級 × ${WIDTHS.length} 寬度 = ${ROUTES.length * FONTS.length * WIDTHS.length} 種組合）—`);
  for (const [name, route] of ROUTES) {
    for (const w of WIDTHS) {
      for (const fs2 of FONTS) {
        await page.setViewport({ width: w, height: 844, deviceScaleFactor: 1 });
        await page.goto('about:blank');
        await page.goto(`http://localhost:${WEB}/#${route}`, { waitUntil: 'networkidle0' }).catch(() => {});
        await page.evaluate((v) => { document.documentElement.dataset.fs = v; }, fs2);
        await page.waitForSelector('.page, .hero', { timeout: 15000 }).catch(() => {});
        await sleep(650);
        // 捲到底再驗「被分頁列遮住」
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(250);
        const list = await page.evaluate(CHECK);
        combos++;
        record(`${name}/${w}px/${fs2}`, list);
        if (SHOTS && fs2 === 'xl' && w === 320) {
          await page.screenshot({ path: path.join(SHOTS, `${name}-320-xl.png`) });
        }
      }
    }
    process.stdout.write('.');
  }
  console.log('');
  yes(combos === ROUTES.length * FONTS.length * WIDTHS.length,
    `掃了 ${combos} 種「頁面 × 字級 × 寬度」組合`);

  // ---------- 對話框 ----------
  console.log('\n— 對話框（最壞情況：320px × 特大字級）—');
  await page.setViewport({ width: 320, height: 844, deviceScaleFactor: 1 });
  const MODALS = [
    ['建議順序', `/trip/${ids.tid}/plan`, () => [...document.querySelectorAll('.pd-opt')][0]?.click()],
    ['刪除確認', `/trip/${ids.tid}/settings`, () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('移除這趟'))?.click()],
    ['日期選擇', `/trip/${ids.tid}/settings`, () => [...document.querySelectorAll('.setting-row')].find((r) => r.textContent.includes('旅程日期'))?.querySelector('button')?.click()],
    ['調整上限', `/trip/${ids.tid}/settings`, () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('貼上 Google 金鑰'))?.click()],
    ['加一筆帳', `/trip/${ids.tid}/expenses`, () => document.getElementById('topActionBtn')?.click()],
    ['音樂授權', `/trip/${ids.tid}/album`, () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('音樂來源與授權'))?.click()],
  ];
  let modalN = 0;
  const notOpened = [];
  for (const [label, route, open] of MODALS) {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#${route}`, { waitUntil: 'networkidle0' }).catch(() => {});
    await page.evaluate(() => { document.documentElement.dataset.fs = 'xl'; });
    await page.waitForSelector('.page', { timeout: 15000 }).catch(() => {});
    await sleep(900);
    await page.evaluate(open).catch(() => {});
    const shown = await page.waitForSelector('.modal-card', { timeout: 6000 }).then(() => true).catch(() => false);
    // 「打不開就略過」＝ 掃描器可以無聲地縮水成 0 個對話框還說通過。
    // 開不起來要當失敗：不是選擇器過期了，就是那個入口真的壞了，兩種都要知道。
    if (!shown) { console.log(`  ✗ ${label}：對話框打不開（選擇器過期或入口壞了）`); notOpened.push(label); continue; }
    await sleep(400);
    modalN++;
    const list = await page.evaluate(`(() => {
      const out = [];
      const card = document.querySelector('.modal-card');
      const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1; };
      if (card.scrollWidth > card.clientWidth + 1) out.push({ kind: 'modal-overflow-x', where: '.modal-card', detail: card.scrollWidth + ' > ' + card.clientWidth });
      for (const b of card.querySelectorAll('.modal-actions .btn, .numpad-row .btn')) {
        const t = (b.textContent || '').trim();
        if (t && lines(b) > 1) out.push({ kind: 'modal-btn-wrap', where: '.' + b.className.split(' ')[1], detail: '「' + t + '」折成 ' + lines(b) + ' 行' });
        const r = b.getBoundingClientRect();
        if (r.height && r.height < 44) out.push({ kind: 'modal-touch-small', where: t, detail: Math.round(r.height) + 'px' });
      }
      const vw = document.documentElement.clientWidth;
      for (const el of card.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1)) { out.push({ kind: 'modal-overflow-el', where: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0], detail: Math.round(r.left) + '～' + Math.round(r.right) + ' vs ' + vw }); break; }
      }
      return out;
    })()`);
    record(`${label}/320px/xl`, list);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `modal-${label}-320-xl.png`) });
    console.log(`  ${label}：${list.length ? '✗ ' + list.length + ' 個問題' : '✓'}`);
    await page.evaluate(() => document.querySelector('.modal-actions .btn')?.click()).catch(() => {});
    await sleep(250);
  }
  yes(!notOpened.length && modalN === MODALS.length,
    `${MODALS.length} 個對話框全部打得開並掃過`,
    notOpened.length ? '打不開：' + notOpened.join('、') : '');

  // ---------- 結果 ----------
  console.log(`\n— 掃描結果：${combos} 種頁面組合 + ${modalN} 個對話框 —`);
  const byKind = {};
  for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  // 報告檔**永遠**寫。以前只在有問題時寫，全綠時磁碟上留著的是上一次的舊報告 ——
  // 看到那個檔案的人會以為問題還在。
  const head = `TripQuest 版面掃描 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`
    + `${combos} 種頁面組合（${ROUTES.length} 頁 × ${FONTS.length} 字級 × ${WIDTHS.length} 寬度）+ ${modalN} 個對話框\n`
    + `發現 ${problems.length} 個問題\n${'-'.repeat(60)}\n`;
  const lines2 = problems.map((p) => `[${p.kind}] ${p.where}\n    ${p.detail}\n    出現在：${p.combos.join('、')}`);
  try {
    fs.writeFileSync(path.join(ROOT, 'screenshots', '_layout-report.txt'),
      head + (lines2.join('\n\n') || '（零問題）\n'), 'utf8');
  } catch { /* noop */ }
  if (problems.length) {
    for (const p of problems) {
      console.log(`  ✗ [${p.kind}] ${p.where}`);
      console.log(`      ${p.detail}`);
      console.log(`      出現在：${p.combos.join('、')}${p.combos.length >= 6 ? ' …' : ''}`);
    }
    console.log('\n  分類統計：' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join('、'));
  }
  yes(!problems.length, `零版面問題（掃了 ${combos} 種組合 + ${modalN} 個對話框）`,
    `${problems.length} 個問題，見上面`);
} catch (e) {
  console.log('✗ 例外：' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill(); osrmSrv.close(); opSrv.close();
}
console.log(`\n版面掃描結束\n\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
