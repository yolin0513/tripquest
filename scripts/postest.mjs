// 旅伴位置分享的隱私不變式（npm run postest，v1.60）——三代理必修項逐條釘住：
//   · 預設關閉；開了才會有記錄；同意畫面把五件事講清楚
//   · 墓碑不帶座標（關掉之後 D1 與旅伴手機上都不該再有 lat/lng）
//   · id 帶 deviceId；不進 APPEND_ONLY（位置要能更新）
//   · exportRecords() 預設吐不出位置 → 匯出檔／相簿頁／行程文字都乾淨
//   · 單筆推送（不會因為更新位置就把整個群組推一遍）
//   · 伺服器端過期：超過 48 小時的位置改成無座標墓碑
//   · 顯示誠實：「最後看到」＋時間；精度太差不報公尺數

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm, readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5631, API = 8817;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

async function device(name, lat, lng) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://localhost:${WEB}`, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setGeolocation({ latitude: lat, longitude: lng });
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(({ url }) => (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })(), { url: `http://localhost:${API}` });
  return page;
}

try {
  // A＝媽媽（台北車站），B＝爸爸（約 400 公尺外）
  const A = await device('A', 25.0466, 121.5133);   // 刻意跟景點座標不同，匯出檔才驗得出來
  const today = new Date().toISOString().slice(0, 10);
  const setup = await A.evaluate(async (today) => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const { claim } = await import('./js/claim.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '台北行', region: '台北', startDate: today, endDate: today, allowWiki: false });
    const sid = uuid();
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '台北車站', emoji: '🚉', day: 1, order: 0, lat: 25.0478, lng: 121.5170 });
    await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: '拍一張', kind: 'thing', order: 0 });
    await ensureGroupSync(gid);
    await claim(tid, mA);
    return { gid, tid, mA, mB };
  }, today);

  // ---------- 預設關閉 ----------
  console.log('\n— 預設與同意 —');
  const def = await A.evaluate(async (tid) => {
    const pos = await import('./js/pos.js');
    return { sharing: pos.sharing(tid), recs: (await import('./js/store.js')).exportRecords({ all: true }).filter((r) => r.type === 'memberPos').length };
  }, setup.tid);
  yes(def.sharing === false && def.recs === 0, '預設關閉，而且完全沒有位置記錄');

  // 設定頁：開關存在、要先過同意畫面
  await A.evaluate((t) => { location.hash = '#/trip/' + t + '/settings'; }, setup.tid);
  await A.waitForFunction(() => document.body.textContent.includes('讓家人看到我在哪'), { timeout: 10000 });
  await A.evaluate(() => {
    const row = [...document.querySelectorAll('.switch-row')].find((x) => x.textContent.includes('讓家人看到我在哪'));
    row.querySelector('input[type=checkbox]').click();
  });
  await A.waitForSelector('.pc-row', { timeout: 8000 });
  const consent = await A.evaluate(() => ({
    txt: document.querySelector('.modal-card').innerText.replace(/\s+/g, ' '),
    keys: [...document.querySelectorAll('.pc-k')].map((x) => x.textContent),
  }));
  yes(consent.keys.length === 5 && ['誰看得到', '看得到什麼', '多久', '怎麼關', '關了會怎樣'].every((k) => consent.keys.includes(k)),
    `同意畫面把五件事講清楚：${consent.keys.join('／')}`);
  yes(consent.txt.includes('媽媽') && consent.txt.includes('爸爸'), '同意畫面列出「誰看得到」的實際名字');
  yes(consent.txt.includes('最後一次打開 App') && consent.txt.includes('不是即時追蹤'),
    '文案誠實：講「最後一次打開 App 的位置」，並明說不是即時追蹤');
  // 先按「先不要」→ 不該開啟
  await A.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('先不要')).click());
  await sleep(300);
  const declined = await A.evaluate(async (t) => (await import('./js/pos.js')).sharing(t), setup.tid);
  yes(declined === false, '按「先不要」不會開啟');

  // ---------- 開啟 → 有記錄，且形狀正確 ----------
  console.log('\n— 開啟分享 —');
  const rec = await A.evaluate(async (o) => {
    const pos = await import('./js/pos.js');
    const s = await import('./js/store.js');
    await pos.setSharing(o.tid, true);
    await new Promise((r) => setTimeout(r, 600));
    const all = s.exportRecords({ all: true }).filter((r) => r.type === 'memberPos');
    return { n: all.length, r: all[0] || null, deviceId: (await import('./js/ids.js')).deviceId() };
  }, setup);
  yes(rec.n === 1 && rec.r && rec.r.lat != null, `開啟後產生 1 筆位置（${rec.r && rec.r.lat}, ${rec.r && rec.r.lng}）`);
  yes(rec.r.id === `pos:${setup.tid}:${setup.mA}:${rec.deviceId}`, 'id 帶 deviceId（多裝置不會互相覆寫）');
  yes(String(rec.r.lat).split('.')[1].length <= 4 && String(rec.r.lng).split('.')[1].length <= 4,
    `座標降到小數 4 位（約 11 公尺）：${rec.r.lat}, ${rec.r.lng}`);
  yes(typeof rec.r.accM === 'number' && rec.r.at > 0, '帶精度與時間戳（顯示端才能誠實）');

  // ---------- 隱私不變式：exportRecords 預設吐不出來 ----------
  console.log('\n— 不會外流 —');
  const leak = await A.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const share = await import('./js/share.js');
    const mem = await import('./js/memory.js');
    const itin = await import('./js/itinexport.js').catch(() => null);
    const bundleBlob = await share.exportBundle(o.tid);
    const bundleTxt = await bundleBlob.text();
    const album = mem.albumHTML(mem.albumMeta(o.tid), await mem.albumSlides(o.tid).map((x) => ({ ...x, url: '' })));
    const url = await share.shareURL(o.tid);
    return {
      exportRecords: s.exportRecords().filter((r) => r.type === 'memberPos').length,
      exportGroup: s.exportGroup(o.gid).filter((r) => r.type === 'memberPos').length,
      bundleHasPos: /memberPos/.test(bundleTxt),
      bundleHasCoord: bundleTxt.includes('25.0466') || bundleTxt.includes('121.5133'),   // 只有位置記錄會有這個座標（景點是 25.0478）
      albumHasPos: /memberPos/.test(album),
      urlHasPos: /memberPos|25\.04|121\.51/.test(url),
      itinHasPos: itin ? /memberPos/.test(String(itin.itineraryText ? itin.itineraryText(o.tid) : '')) : false,
    };
  }, setup);
  yes(leak.exportRecords === 0, 'exportRecords() 預設吐不出位置（全 App 的通用資料源）');
  yes(leak.exportGroup === 1, 'exportGroup() 明確包含位置（同步需要）');
  yes(!leak.bundleHasPos && !leak.bundleHasCoord, '匯出檔不含位置，也不含座標字串');
  yes(!leak.albumHasPos, '分享相簿頁不含位置');
  yes(!leak.urlHasPos, '邀請連結不含位置');
  yes(!leak.itinHasPos, '行程表文字不含位置');

  // ---------- 單筆推送 ----------
  const single = await A.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const pos = await import('./js/pos.js');
    const sizes = [];
    const of = window.fetch;
    window.fetch = async (u, init) => {
      if (String(u).includes('/push') && init && init.body) sizes.push((JSON.parse(init.body).records || []).length);
      return of(u, init);
    };
    await pos.updateNow(o.tid, { force: true });
    await new Promise((r) => setTimeout(r, 900));
    window.fetch = of;
    return { sizes, total: s.exportGroup(o.gid).length };
  }, setup);
  yes(single.sizes.includes(1), `更新位置只送 1 筆，不是把整個群組 ${single.total} 筆推一遍（推送大小：${JSON.stringify(single.sizes)}）`);

  // ---------- B 看得到 A 的位置 ----------
  console.log('\n— 旅伴那端 —');
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  const B = await device('B', 25.0500, 121.5133);          // 約 380 公尺外
  await B.evaluate(async (o) => {
    const share = await import('./js/share.js');
    const { getConfig } = await import('./js/sync.js');
    const s = await import('./js/store.js');
    await share.joinInvite({ kind: 'sync', short: true, groupId: o.gid, secret: s.getRaw(o.gid)?.syncSecret || '', url: getConfig().url, tripPrefix: o.tid.slice(0, 8) })
      .catch(async () => { /* 已在同一台？忽略 */ });
  }, setup).catch(() => {});
  // B 是新裝置：直接用群組祕鑰拉
  const bSee = await B.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const sync = await import('./js/sync.js');
    const secret = o.secret;
    const adapter = sync.adapterForGroup(o.gid, secret);
    const res = await adapter.pull(0);
    await s.importRecords(res.records, { merge: true });
    await (await import('./js/claim.js')).claim(o.tid, o.mB);
    const pos = await import('./js/pos.js');
    const shots = pos.positionsOf(o.tid);
    const r = shots.get(o.mA);
    const d = r ? pos.describe(r, { lat: 25.0500, lng: 121.5133 }) : null;
    return { has: !!r, dist: d && d.dist, ago: d && d.ago, when: d && d.when, coarse: d && d.coarse };
  }, { ...setup, secret: await A.evaluate((g) => import('./js/store.js').then((s) => s.getRaw(g)?.syncSecret), setup.gid) });
  yes(bSee.has && bSee.dist > 200 && bSee.dist < 600, `旅伴看得到位置與距離：${bSee.dist} 公尺（實際約 380）`);
  yes(/剛剛|分鐘前/.test(bSee.ago) && /^\d{1,2}:\d{2}$/.test(bSee.when), `顯示「最後看到 ${bSee.when}（${bSee.ago}）」`);

  // ---------- SOS 頁 ----------
  await B.evaluate((t) => { location.hash = '#/trip/' + t + '/sos'; }, setup.tid);
  await B.waitForSelector('.sos-crew', { timeout: 15000 });
  const sosTxt = await B.evaluate(() => ({
    crew: document.querySelector('.sos-crew').innerText.replace(/\s+/g, ' '),
    hint: [...document.querySelectorAll('.form-hint')].map((x) => x.textContent).join(' '),
    map: !!document.querySelector('.sos-crew a[href*="maps"]'),
  }));
  yes(sosTxt.crew.includes('媽媽') && /公尺|公里/.test(sosTxt.crew) && sosTxt.crew.includes('最後看到'),
    `SOS 頁：「${sosTxt.crew.slice(0, 42)}…」`);
  yes(sosTxt.map, '一鍵「用地圖看他在哪」');
  yes(sosTxt.hint.includes('不是即時追蹤'), 'SOS 頁講明不是即時追蹤');

  // ---------- 關掉 → 墓碑不帶座標 ----------
  console.log('\n— 關掉分享 —');
  const off = await A.evaluate(async (o) => {
    const pos = await import('./js/pos.js');
    const s = await import('./js/store.js');
    await pos.setSharing(o.tid, false);
    await new Promise((r) => setTimeout(r, 600));
    const mine = s.exportRecords({ all: true }).filter((r) => r.type === 'memberPos');
    return { n: mine.length, rec: mine[0], sharing: pos.sharing(o.tid) };
  }, setup);
  yes(off.sharing === false && off.rec && off.rec.deleted === true, '關掉之後那筆變成墓碑');
  yes(off.rec.lat == null && off.rec.lng == null && off.rec.at == null,
    `墓碑不帶座標（${JSON.stringify(off.rec).slice(0, 90)}…）`);
  // 伺服器上也不該再有座標
  await A.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
  await sleep(500);
  const onServer = await A.evaluate(async (o) => {
    const sync = await import('./js/sync.js');
    const s = await import('./js/store.js');
    const adapter = sync.adapterForGroup(o.gid, s.getRaw(o.gid).syncSecret);
    const res = await adapter.pull(0);
    const p = (res.records || []).filter((r) => r.type === 'memberPos');
    return { n: p.length, anyCoord: p.some((r) => r.lat != null) };
  }, setup);
  yes(!onServer.anyCoord, `伺服器上的位置已無座標（${onServer.n} 筆墓碑）`);
  // B 同步後也看不到了
  const bAfter = await B.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const sync = await import('./js/sync.js');
    const adapter = sync.adapterForGroup(o.gid, o.secret);
    const res = await adapter.pull(0);
    await s.importRecords(res.records, { merge: true });
    const pos = await import('./js/pos.js');
    const raw = s.exportRecords({ all: true }).filter((r) => r.type === 'memberPos' && r.lat != null).length;
    return { visible: pos.positionsOf(o.tid).size, rawWithCoord: raw };
  }, { ...setup, secret: await A.evaluate((g) => import('./js/store.js').then((s) => s.getRaw(g)?.syncSecret), setup.gid) });
  yes(bAfter.visible === 0 && bAfter.rawWithCoord === 0, '旅伴同步後，手機上的座標副本也被覆蓋掉了');

  // ---------- 伺服器端過期 ----------
  console.log('\n— 伺服器端過期 —');
  const expired = await A.evaluate(async (o) => {
    const sync = await import('./js/sync.js');
    const s = await import('./js/store.js');
    const adapter = sync.adapterForGroup(o.gid, s.getRaw(o.gid).syncSecret);
    const old = Date.now() - 60 * 3600 * 1000;               // 60 小時前
    await adapter.push([{ id: 'pos:stale:x:y', type: 'memberPos', tripId: o.tid, memberId: o.mB,
      lat: 25.0478, lng: 121.517, accM: 20, at: old, updatedAt: old, deviceId: 'olddev' }]);
    const res = await adapter.pull(0);
    const r = (res.records || []).find((x) => x.id === 'pos:stale:x:y');
    return { found: !!r, hasCoord: !!(r && r.lat != null), deleted: !!(r && r.deleted) };
  }, setup);
  yes(expired.found && !expired.hasCoord && expired.deleted,
    '超過 48 小時的位置：伺服器回的是無座標墓碑（不必等客戶端）');

  // ---------- 行程期間之外不上傳 ----------
  const outside = await A.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const pos = await import('./js/pos.js');
    await s.patch(o.tid, { startDate: '2020-01-01', endDate: '2020-01-03' });
    await pos.setSharing(o.tid, true);
    await new Promise((r) => setTimeout(r, 500));
    const withCoord = s.exportRecords({ all: true }).filter((r) => r.type === 'memberPos' && r.lat != null).length;
    await pos.setSharing(o.tid, false);
    return withCoord;
  }, setup);
  yes(outside === 0, '行程期間以外，就算開了開關也不會上傳位置');

  // ---------- 原始碼守衛：不進 APPEND_ONLY ----------
  const mergeSrc = await readFile(ROOT + 'js/merge.js', 'utf8');
  yes(!/APPEND_ONLY[^\n]*memberPos/.test(mergeSrc) && !mergeSrc.includes("'memberPos'"),
    'memberPos 不在 APPEND_ONLY（不然位置永遠停在第一筆）');

  // ---------- SOS 醫院清單：只列有規模的醫院、不列診所國術館 ----------
  console.log('\n— SOS 醫院分級 —');
  const hosp = await A.evaluate(async () => {
    const { hospTier } = await import('./js/nearby.js');
    const t = (tags, area = false) => hospTier(tags, area);
    return {
      er: t({ name: '臺北榮民總醫院', emergency: 'yes' }, true),
      noEr: t({ name: '某某醫院', emergency: 'no' }, true),
      twHospArea: t({ name: '振興醫院' }, true),
      twHospNode: t({ name: '慶生醫院' }, false),
      jpByoin: t({ name: '京都第一赤十字病院' }, false),
      jpClinic: t({ name: "Oida Women's Clinic" }, false),
      twClinic: t({ name: '黃正宏診所' }, false),
      martial: t({ name: '富利國術館' }, false),
    };
  });
  yes(hosp.er === 0, 'emergency=yes → 最優先');
  yes(hosp.noEr === 3, 'emergency=no → 排最後（明確沒有急診）');
  yes(hosp.twHospArea < hosp.twHospNode, '台灣：畫了院區的醫院比單點的優先');
  yes(hosp.jpByoin < hosp.jpClinic && hosp.jpByoin < hosp.twClinic,
    `日本「病院」比 Clinic／診所優先（${hosp.jpByoin} < ${hosp.jpClinic}）——日本 emergency 填寫率只有 1%，靠名稱後備`);
  yes(hosp.twClinic > 1.5 && hosp.martial > 1.5, '「診所」「國術館」排到後段');
  const nearbySrc = await readFile(ROOT + 'js/nearby.js', 'utf8');
  yes(nearbySrc.includes('nwr[amenity=hospital]') && !nearbySrc.includes('hospital|clinic'),
    'SOS 查詢只抓 amenity=hospital（不再抓 clinic —— 國術館常被標成 clinic）');
  yes(nearbySrc.includes('out center tags 300'),
    '查詢上限放寬到 300（80 筆會被診所塞滿，真正的大醫院整個不在回應裡）');

  yes(nearbySrc.includes('dedupeByName'),
    '同名去重：大醫院在 OSM 常有多個節點（京都第一赤十字病院 ×2），不重複列出');

  console.log('\n位置分享測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
