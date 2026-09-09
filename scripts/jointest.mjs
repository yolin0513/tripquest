// 邀請加入的第一分鐘（npm run jointest，v1.57；v1.58 起連結改短格式）—— 兩台裝置走 LAN 伺服器：
//   · 點連結：行程名直接出現（連結帶 n=），日期／誰邀請／景點由伺服器 /invite 補上
//   · 按加入：原地進度卡（連線 → 接收 N 筆 → 整理），照片不用等，直接進行程頁
//   · 行程頁：一次性的歡迎卡（關掉不再出現）、「正在接收照片… 還有 N 張」進度列 → 到齊淡出
//   · 伺服器上還沒資料：不是技術錯誤，卡片留在原地講原因並給「再試一次」

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5583, API = 8793;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  return page;
}

try {
  const A = await device('A');
  const setup = await A.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { ensureGroupSync, shareURL } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '宜蘭家族旅行 旅伴' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族旅行', region: '宜蘭', startDate: '2026-10-10', endDate: '2026-10-12', allowWiki: false });
    const quests = [];
    const names = [['羅東夜市', 1], ['林場肉羹', 1], ['太平山', 2], ['礁溪溫泉', 3]];
    for (const [n, d] of names) {
      const sid = uuid(), qid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name: n, emoji: '📍', day: d, order: 0 });
      await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `在${n}拍一張`, kind: 'thing', order: 0 });
      quests.push(qid);
    }
    const mk = (i) => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 60},60%,50%)`; x.fillRect(0, 0, 600, 400); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); };
    for (let i = 0; i < 6; i++) await importPhoto(new File([await mk(i)], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: quests[i % 4], memberId: mA, allowGeo: false });
    await ensureGroupSync(gid);
    const url = await shareURL(tid);
    return { tid, gid, url, secret: s.getRaw(gid).syncSecret };
  });
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  // v1.58 短連結：g/k/t/n 必帶；LAN 模式（非內建雲端）要多帶 u=
  yes(setup.url.includes('#/join?g=') && /[?&]k=/.test(setup.url) && /[?&]t=/.test(setup.url) && /[?&]u=/.test(setup.url),
    `A 產生短邀請連結（${setup.url.length} 字元；帶 g/k/t/n/u）`);
  yes(setup.url.length < 260, `短連結長度 ${setup.url.length} < 260（雲端模式不帶 u= 會再短 ~30 字）`);
  yes(/^[A-Za-z0-9_-]{22}$/.test(setup.secret) && !/^[-_]|[-_]$/.test(setup.secret),
    `新群組祕鑰是 base64url 22 字、頭尾不是 - 或 _（${setup.secret.slice(0, 4)}…）`);

  // ---------- 編解碼與文字解析（單元層）----------
  const unit = await A.evaluate(async (u) => {
    const sh = await import('./js/share.js');
    const { uuid } = await import('./js/ids.js');
    let okRT = 0;
    for (let i = 0; i < 200; i++) { const id = uuid(); if (sh.b64ToUuid(sh.uuidToB64(id)) === id) okRT++; }
    const msg = `早安！點這個加入我們的旅行 ${u} 謝謝大家`;
    const p = sh.parseInviteText(msg);
    const cut = sh.parseInviteText(u.replace(/([?&]k=)([A-Za-z0-9_-]{12})/, '$1'));   // 被截短的祕鑰要拒收
    return { okRT, gid: p && p.groupId, url: p && p.url, cutNull: cut === null };
  }, setup.url);
  yes(unit.okRT === 200, 'UUID ↔ base64url 編解碼 round-trip 200/200');
  yes(unit.gid === setup.gid && String(unit.url).includes('localhost'), 'parseInviteText：從整段訊息文字撈出 g/k/u');
  yes(unit.cutNull, 'parseInviteText：祕鑰被截短（<22 字）就拒收，不吞錯位識別碼');

  // ---------- /invite 端點本身 ----------
  {
    const apiBase = `http://localhost:${API}`;
    const noAuth = await fetch(`${apiBase}/invite?g=${setup.gid}&s=${setup.secret}`);
    yes(noAuth.status === 400, `/invite 不收 ?s= 祕鑰（只收 Bearer）→ ${noAuth.status}`);
    const r = await fetch(`${apiBase}/invite?g=${setup.gid}&t=${setup.tid.slice(0, 8)}`, { headers: { authorization: 'Bearer ' + setup.secret } });
    const sum = await r.json();
    yes(r.status === 200 && sum.tripId === setup.tid && sum.title === '宜蘭家族旅行', '/invite 回完整 tripId 與行程名');
    yes(sum.preview.length === 4 && sum.who.length === 2 && sum.dates[0] === '2026-10-10', `/invite 摘要齊全（${sum.preview.length} 景點、${sum.who.join('、')}）`);
    yes((r.headers.get('cache-control') || '').includes('no-store'), '/invite 回應 no-store（摘要含成員名，不給中繼快取留底）');
    const bad = await fetch(`${apiBase}/invite?g=${setup.gid}`, { headers: { authorization: 'Bearer ' + setup.secret.slice(0, 21) + (setup.secret[21] === 'A' ? 'B' : 'A') } });
    yes(bad.status === 403, `/invite 錯祕鑰 → 403（${bad.status}）`);
  }

  // ---------- B 點連結：連線前的摘要 ----------
  console.log('\n— 點連結 —');
  const B = await device('B');
  await B.goto(setup.url, { waitUntil: 'networkidle0' });
  await B.waitForSelector('.join-preview', { timeout: 15000 });
  // 行程名來自連結的 n=，其餘摘要是 /invite 補上的（LAN 幾十 ms；給它 8 秒裕度）
  await B.waitForFunction(() => document.querySelector('.page')?.innerText.includes('羅東夜市'), { timeout: 8000 });
  const card = await B.evaluate(() => ({
    txt: document.querySelector('.page').innerText.replace(/\s+/g, ' '),
    joinBtn: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程'))?.getBoundingClientRect().height,
  }));
  yes(card.txt.includes('宜蘭家族旅行') && card.txt.includes('2026-10-10') && card.txt.includes('2026-10-12'), '行程名（連結自帶）＋日期（伺服器摘要）都在卡片上');
  yes(card.txt.includes('媽媽') && card.txt.includes('爸爸'), '看到是誰邀請（旅伴名）');
  yes(card.txt.includes('第 1 天') && card.txt.includes('羅東夜市') && card.txt.includes('第 2 天') && card.txt.includes('太平山'), '看到前幾個景點的骨架（依天）');
  yes(card.joinBtn >= 52, `「加入這個旅程」大按鈕 ${Math.round(card.joinBtn)}px`);

  // ---------- 按加入：進度卡 → 行程頁 ----------
  console.log('\n— 加入 —');
  const t0 = Date.now();
  await B.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程')).click());
  await B.waitForSelector('.join-progress:not([hidden])', { timeout: 5000 });
  const prog = await B.evaluate(() => document.querySelector('.join-progress').textContent);
  // 本機伺服器可能快到讀取時已是完成文案「好了，帶你進行程…」—— 一樣算進度卡有出現
  yes(/連線|接收|整理|好了/.test(prog), `按下去原地出現進度卡：「${prog.replace(/\s+/g, ' ').slice(0, 30)}…」`);
  // 資料到了先問「這是誰的手機？」→ 選爸爸 → 進行程頁
  await B.waitForFunction(() => [...document.querySelectorAll('.modal-card button')].some((x) => x.textContent.includes('爸爸')), { timeout: 30000 });
  await B.evaluate(() => { const b = [...document.querySelectorAll('.modal-card button')].find((x) => x.textContent.includes('爸爸')); b && b.click(); });
  await B.waitForFunction(() => location.hash.includes('/trip/') && !location.hash.includes('/join'), { timeout: 15000 });
  await B.waitForSelector('.progress-banner', { timeout: 15000 });
  const t1 = Date.now();
  const landed = await B.evaluate(() => ({
    welcome: !!document.querySelector('.welcome-card'),
    welcomeTxt: document.querySelector('.welcome-card')?.textContent || '',
    spots: [...document.querySelectorAll('.qc-name')].map((x) => x.textContent.trim()).slice(0, 5),
    banner: !!document.querySelector('.sync-banner:not([hidden])'),
  }));
  yes(t1 - t0 < 15000, `按加入到看見行程頁 ${((t1 - t0) / 1000).toFixed(1)} 秒（照片不用等）`);
  yes(landed.spots.some((x) => x.includes('羅東夜市')), `行程頁有景點可點（${landed.spots.slice(0, 2).join('、')}…）`);
  yes(landed.welcome && landed.welcomeTxt.includes('拍照任務這樣玩'), '一次性的歡迎卡出現');
  // 同步進度列：待抓縮圖 → 到齊
  const bannerSeen = await B.evaluate(async () => {
    const t = Date.now();
    let seenPending = false, seenDone = false;
    while (Date.now() - t < 20000) {
      const el = document.querySelector('.sync-banner');
      if (el && !el.hidden) { if (el.textContent.includes('還有')) seenPending = true; if (el.textContent.includes('到齊')) seenDone = true; }
      if (seenDone) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { seenPending, seenDone, gone: !document.querySelector('.sync-banner') };
  });
  yes(bannerSeen.seenDone || bannerSeen.gone, `照片同步進度列：${bannerSeen.seenPending ? '有顯示「還有 N 張」→ ' : ''}到齊後收起`);
  const thumbs = await B.evaluate(async (tid) => {
    const s = await import('./js/store.js'); const db = await import('./js/db.js');
    const keys = new Set(await db.allBlobKeys());
    const subs = s.submissionsOfTrip(tid);
    return { subs: subs.length, local: subs.filter((x) => keys.has(x.thumbHash)).length };
  }, setup.tid);
  yes(thumbs.subs === 6 && thumbs.local === 6, `6 張縮圖都在背景到齊（${thumbs.local}/6）`);
  // 歡迎卡關掉就不再出現
  await B.evaluate(() => document.querySelector('.welcome-card .wc-x').click());
  await B.goto('about:blank');
  await B.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await sleep(500);
  yes(await B.evaluate(() => !document.querySelector('.welcome-card')), '歡迎卡關掉後不再出現');

  // ---------- 旅伴清單與加入橫幅（v1.57.3）----------
  console.log('\n— 旅伴與加入提示 —');
  // A 先看一次行程頁（把目前的 claim 記為已看），B 已在剛剛 ensureMember 認領了「爸爸」
  await A.goto('about:blank');
  await A.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await A.waitForSelector('.crew-btn', { timeout: 15000 });
  const crew0 = await A.evaluate(() => document.querySelector('.crew-btn .crew-label').textContent);
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  await sleep(800);
  // 確定性重現「看頁之後才同步到新 claim」：把已看清單清空再重載 → 爸爸的 claim 是新的
  await A.evaluate((tid) => localStorage.setItem('tripquest.claimseen.' + tid, '[]'), setup.tid);
  await A.goto('about:blank');
  await A.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await A.waitForSelector('.crew-btn', { timeout: 15000 });
  const after = await A.evaluate(() => ({
    banner: document.querySelector('.join-banner')?.textContent || '',
    label: document.querySelector('.crew-btn .crew-label').textContent,
    newDots: document.querySelectorAll('.crew-btn .crew-new').length,
    ghosts: document.querySelectorAll('.crew-btn .avatar.ghost').length,
  }));
  yes(after.banner.includes('爸爸') && after.banner.includes('加入了旅程'), `同步後 A 看到加入橫幅：「${after.banner.replace('✕','').trim()}」`);
  yes(after.label.includes('1/2 位已加入'), `旅伴列標示 ${after.label.trim()}（媽媽還沒認領）`);
  yes(after.newDots === 1 && after.ghosts === 1, `新加入掛「新」×${after.newDots}、未加入頭像半透明 ×${after.ghosts}`);
  void crew0;
  // 點開旅伴清單
  await A.evaluate(() => document.querySelector('.crew-btn').click());
  await A.waitForSelector('.crew-row', { timeout: 8000 });
  const crew = await A.evaluate(() => [...document.querySelectorAll('.crew-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  yes(crew.length === 2 && crew[0].includes('爸爸') && crew[0].includes('加入') && /拍了 \d+ 張/.test(crew[0]),
    `清單第一列：${crew[0].slice(0, 40)}…`);
  yes(crew[1].includes('媽媽') && crew[1].includes('還沒加入'), `清單第二列：${crew[1].slice(0, 34)}…`);
  await A.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent.includes('知道了'))?.click());
  await sleep(300);
  // 按 ✕ → 橫幅看過就不再出現（背景重繪期間則會繼續在）
  await A.evaluate(() => document.querySelector('.join-banner .jb-x')?.click());
  await sleep(200);
  await A.goto('about:blank');
  await A.goto(`http://localhost:${WEB}/#/trip/${setup.tid}`, { waitUntil: 'networkidle0' });
  await A.waitForSelector('.crew-btn', { timeout: 15000 });
  await sleep(400);
  yes(await A.evaluate(() => !document.querySelector('.join-banner')), '加入橫幅看過一次就不再出現');

  // ---------- 回顧頁：第一畫面就看得到成果入口（v1.57.3 驗收指標）----------
  console.log('\n— 回顧頁排版 —');
  await A.goto(`http://localhost:${WEB}/#/trip/${setup.tid}/memories`, { waitUntil: 'networkidle0' });
  await A.waitForSelector('.mem-card', { timeout: 15000 });
  await sleep(400);
  const mem = await A.evaluate(() => {
    const cards = [...document.querySelectorAll('.mem-card')];
    const firstScreen = cards.filter((c) => c.getBoundingClientRect().bottom <= 780).map((c) => c.querySelector('.mem-card-title').textContent);
    const info = document.querySelector('.info-block');
    const order = [...document.querySelectorAll('.mem-card, .info-block')].map((e) => e.classList.contains('info-block') ? 'INFO' : e.querySelector('.mem-card-title').textContent);
    return {
      firstScreen,
      infoIsButton: info ? info.tagName === 'BUTTON' : null,
      infoHasArrow: info ? !!info.querySelector('.mem-card-arrow') : null,
      order,
    };
  });
  yes(mem.firstScreen.length >= 3 && mem.firstScreen.includes('回憶影片與相簿') && mem.firstScreen.includes('行程海報'),
    `390×844 第一畫面可按入口 ${mem.firstScreen.length} 個：${mem.firstScreen.join('、')}（改版前 0 個）`);
  yes(mem.order.indexOf('回憶影片與相簿') < mem.order.indexOf('INFO'), '成果入口在資訊區之前');
  yes(mem.infoIsButton === false && mem.infoHasArrow === false, '「大家的表現」是資訊區：不是按鈕、沒有箭頭');

  // ---------- 伺服器上還沒資料：不是技術錯誤 ----------
  console.log('\n— 失敗路徑 —');
  const C = await device('C');
  // 用一個沒推上伺服器的新群組產生連結：直接改 payload 的 groupId（同一份摘要）
  const fakeUrl = await A.evaluate(async (u) => {
    const sh = await import('./js/share.js');
    const { uuid } = await import('./js/ids.js');
    // 換成一個伺服器沒見過的群組（祕鑰格式合法）——摘要 404、加入 pull 也 404
    return u.replace(/([?&]g=)[A-Za-z0-9_-]{22}/, '$1' + sh.uuidToB64(uuid()));
  }, setup.url).catch(() => null);
  if (fakeUrl) {
    await C.goto(fakeUrl, { waitUntil: 'networkidle0' });
    await C.waitForSelector('.join-preview', { timeout: 15000 });
    // 摘要拿不到不能擋加入：按鈕要照常在、照常能按
    await C.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程')).click());
    await C.waitForFunction(() => document.querySelector('.join-progress')?.textContent.includes('再試一次'), { timeout: 90000 });
    const err = await C.evaluate(() => document.querySelector('.join-progress').textContent.replace(/\s+/g, ' '));
    yes(err.includes('沒加入成功') && err.includes('再試一次') && !/404|Error|undefined/.test(err), `伺服器沒資料 → 講人話並給重試：「${err.slice(0, 40)}…」`);
  } else {
    console.log('  （share.js 沒開放 __gzip/__gunzip，跳過失敗路徑的 UI 驗證）');
  }

  // ---------- 舊 v4 長連結：已寄出的邀請要繼續能用 ----------
  console.log('\n— 舊 v4 連結回歸 —');
  const v4code = await A.evaluate(async (tid) => {
    const sh = await import('./js/share.js');
    const st = await import('./js/store.js');
    const { getConfig } = await import('./js/sync.js');
    const trip = st.get(tid); const g = st.getRaw(trip.groupId);
    const payload = { v: 4, kind: 'sync', url: getConfig().url, groupId: g.id, secret: g.syncSecret, tripId: tid,
      title: trip.title, groupName: g.name, spots: 4, quests: 4, members: 2,
      dates: [trip.startDate, trip.endDate], who: ['媽媽', '爸爸'], preview: [{ n: '羅東夜市', d: 1 }] };
    return sh.__gzip(JSON.stringify(payload));
  }, setup.tid).catch(() => null);
  if (v4code) {
    const D = await device('D');
    await D.goto(`http://localhost:${WEB}/#/join?j=${v4code}`, { waitUntil: 'networkidle0' });
    await D.waitForSelector('.join-preview', { timeout: 15000 });
    const dTxt = await D.evaluate(() => document.querySelector('.page').innerText.replace(/\s+/g, ' '));
    yes(dTxt.includes('宜蘭家族旅行') && dTxt.includes('羅東夜市'), '舊 v4 連結照樣解析（摘要在連結裡）');
    await D.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程')).click());
    await D.waitForFunction(() => [...document.querySelectorAll('.modal-card button')].some((x) => x.textContent.includes('媽媽')), { timeout: 30000 });
    await D.evaluate(() => { const b = [...document.querySelectorAll('.modal-card button')].find((x) => x.textContent.includes('媽媽')); b && b.click(); });
    await D.waitForFunction(() => location.hash.includes('/trip/') && !location.hash.includes('/join'), { timeout: 15000 });
    yes(true, '舊 v4 連結照樣加入成功');
  } else {
    console.log('  （share.js 沒開放 __gzip，跳過 v4 回歸）');
  }

  // ---------- t= 前綴比不到（行程已刪）：退到群組最新行程，不能白屏 ----------
  console.log('\n— t= 前綴 fallback —');
  {
    const E = await device('E');
    const wrongT = setup.url.replace(/([?&]t=)[0-9a-f]{1,8}/, '$1ffffffff');
    await E.goto(wrongT, { waitUntil: 'networkidle0' });
    await E.waitForSelector('.join-preview', { timeout: 15000 });
    await E.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入這個旅程')).click());
    await E.waitForFunction(() => [...document.querySelectorAll('.modal-card button')].some((x) => x.textContent.includes('媽媽')), { timeout: 30000 });
    await E.evaluate(() => { const b = [...document.querySelectorAll('.modal-card button')].find((x) => x.textContent.includes('媽媽')); b && b.click(); });
    await E.waitForFunction(() => location.hash.includes('/trip/'), { timeout: 15000 });
    const eHash = await E.evaluate(() => location.hash);
    yes(eHash.includes(setup.tid), `t= 比不到 → 落到群組最新行程（${eHash.slice(0, 30)}…）`);
  }

  // ---------- 祕鑰錯（連結被截斷）：講人話、跟「還在上傳」分開 ----------
  console.log('\n— 連結被截斷（403）—');
  {
    const F = await device('F');
    const badK = setup.url.replace(/([?&]k=)([A-Za-z0-9_-]{22})/, (m, a, b) => a + b.slice(0, 21) + (b[21] === 'A' ? 'B' : 'A'));
    await F.goto(badK, { waitUntil: 'networkidle0' });
    await F.waitForFunction(() => document.querySelector('.join-preview')?.textContent.includes('不完整'), { timeout: 10000 });
    const fTxt = await F.evaluate(() => document.querySelector('.join-preview').textContent);
    yes(fTxt.includes('重新傳一次') && !/403|Error/.test(fTxt), `403 → 講「連結不完整、請重傳」不是技術錯誤（「${fTxt.slice(0, 24)}…」）`);
  }

  console.log('\n邀請加入測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
