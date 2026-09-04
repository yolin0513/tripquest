// 線上前端端到端驗證（npm run livetest）
// 直接載入正式站 GitHub Pages，不呼叫 setConfig，靠 js/sync.js 的 BUILT_IN
// 自動連上 Cloudflare Worker，用兩個獨立瀏覽器 context 當兩台手機跑完整流程：
// 自動連線 → 建群組 → 推雲端 → 邀請加入 → 縮圖/全圖下載 → 雙向同步 → 撤回
// → 身分備份卡換裝置認領 → 錯誤祕鑰被擋。
// 會在正式 D1/R2 留下一個測試群組（靠 128-bit 祕鑰隔離，不影響真實資料）。
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const APP = 'https://yolin0513.github.io/tripquest/';
const WORKER = 'https://tripquest.yolin0513.workers.dev';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ok = (m) => console.log('✓ ' + m);
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

// outbox 可能正在背景自動 drain；busy 就等一下再試，最多 ~30 秒
async function drain(page, opts = {}) {
  for (let i = 0; i < 30; i++) {
    const r = await page.evaluate(async (o) => (await import('./js/outbox.js')).drain(o), opts);
    if (!r || r.skipped !== 'busy') return r;
    await sleep(1000);
  }
  return { skipped: 'busy' };
}

// 直接問伺服器這個群組有幾筆記錄。
// 不要用 drain() 回傳的 pushed 來判斷有沒有推成功：那個數字只代表「這一次 drain 有沒有
// 發出推送」，而 App 背景本來就會自動 drain，背景先推完並清掉 outbox 之後，測試自己叫的
// 那次就會拿到 pushed:0——資料其實好好地在伺服器上。要驗就驗伺服器的實際狀態。
async function serverCount(page) {
  return page.evaluate(async () => {
    const store = await import('./js/store.js');
    const sync = await import('./js/sync.js');
    const g = store.syncedGroups()[0];
    if (!g) return -1;
    const res = await sync.adapterForGroup(g.id, g.syncSecret).pull(0);
    return (res.records || []).length;
  });
}

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try { await page.setBypassServiceWorker(true); } catch { /* older puppeteer */ }
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(APP, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  return { ctx, page };
}

try {
  const A = await device('A');

  // 0) 確認前端自動採用 cloud 模式（沒有人動過設定）
  const cfg = await A.page.evaluate(async () => (await import('./js/sync.js')).getConfig());
  if (cfg.mode === 'cloud' && cfg.url === WORKER) ok(`前端自動連上同步：${cfg.mode} ${cfg.url}`);
  else fail('BUILT_IN 未生效：' + JSON.stringify(cfg));

  const health = await A.page.evaluate(async (w) => (await fetch(w + '/health')).json(), WORKER);
  if (health && health.ok) ok('Worker /health 正常'); else fail('/health：' + JSON.stringify(health));

  // 1) 裝置 A 建行程 + 2 張照片
  const setup = await A.page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '線上驗證團' });
    const mA = uuid(), mB = uuid();
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '小美' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '線上端到端', region: '京都', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, itineraryText: '清水寺、金閣寺', region: '京都' });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    await ensureGroupSync(gid);
    const mk = (h) => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = `hsl(${h},60%,50%)`; x.fillRect(0, 0, 600, 400); return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.85)); };
    await importPhoto(new File([await mk(10)], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: quests[0].id, memberId: mA, allowGeo: false });
    await importPhoto(new File([await mk(200)], 'b.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: quests[1].id, memberId: mA, allowGeo: false });
    return { tid, gid };
  });
  ok('裝置 A 建立行程 + 2 張照片');

  const aPush = await drain(A.page, { force: true });
  const aOnServer = await serverCount(A.page);
  if (aOnServer >= 6 && aPush && aPush.uploaded >= 2) ok(`裝置 A 推送到雲端：伺服器上 ${aOnServer} 筆、照片 ${aPush.uploaded}`);
  else fail(`裝置 A 推送異常：伺服器上 ${aOnServer} 筆、drain=${JSON.stringify(aPush)}`);

  const invite = await A.page.evaluate(async (tid) => (await import('./js/share.js')).shareURL(tid), setup.tid);
  if (invite.includes('#/join?j=')) ok('產生邀請連結'); else fail('邀請連結：' + invite.slice(0, 60));

  // 2) 裝置 B 用邀請連結加入（另一個 context = 另一台手機）
  const B = await device('B');
  const code = invite.split('j=')[1];
  const joinRes = await B.page.evaluate(async (code) => {
    const tid = await (await import('./js/share.js')).joinInvite(code);
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const keys = new Set(await db.allBlobKeys());
    const subs = s.submissionsOfTrip(tid);
    return {
      tid, subs: subs.length, spots: s.spotsOf(tid).length,
      members: s.membersOf(s.get(tid).groupId).length,
      thumbsLocal: subs.filter((x) => keys.has(x.thumbHash)).length,
    };
  }, code);
  if (joinRes.spots === 2 && joinRes.members === 2) ok(`裝置 B 加入：${joinRes.spots} 景點、${joinRes.members} 成員`);
  else fail('裝置 B 骨架同步：' + JSON.stringify(joinRes));
  if (joinRes.subs === 2) ok('裝置 B 收到 2 筆投稿'); else fail('裝置 B 投稿數：' + joinRes.subs);
  // 縮圖預抓是背景工作：joinInvite 要快點回，讓長輩一按加入就看得到行程，縮圖慢一步沒關係
  // （真的還沒到，blobURL 也會即時去雲端抓）。所以這裡等背景跑完再驗，不要求 join 當下就好。
  let thumbs = joinRes.thumbsLocal;
  for (let i = 0; i < 20 && thumbs < 2; i++) {
    await sleep(1000);
    await drain(B.page);
    thumbs = await B.page.evaluate(async (tid) => {
      const s = await import('./js/store.js');
      const db = await import('./js/db.js');
      const keys = new Set(await db.allBlobKeys());
      return s.submissionsOfTrip(tid).filter((x) => keys.has(x.thumbHash)).length;
    }, joinRes.tid);
  }
  if (thumbs === 2) ok('裝置 B 縮圖已下載到本機'); else fail('裝置 B 縮圖：' + thumbs + '/2');

  const lazy = await B.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { blobURL, hasLocal } = await import('./js/photos.js');
    const sub = s.submissionsOfTrip(tid)[0];
    const before = await hasLocal(sub.photoHash);
    const url = await blobURL(sub.photoHash);
    const after = await hasLocal(sub.photoHash);
    return { before, after, gotUrl: !!url };
  }, joinRes.tid);
  if (!lazy.before && lazy.after && lazy.gotUrl) ok('裝置 B 全圖從雲端延遲下載成功'); else fail('全圖延遲下載：' + JSON.stringify(lazy));

  // 3) 裝置 B 拍一張 + 按讚 → 回同步到 A
  await B.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const mB = s.membersOf(s.get(tid).groupId).find((m) => m.displayName === '小美').id;
    const quest = s.questsOfTrip(tid).find((q) => !s.isQuestDone(q.id));
    const c = document.createElement('canvas'); c.width = 500; c.height = 500; c.getContext('2d').fillRect(0, 0, 500, 500);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    const sub = await importPhoto(new File([blob], 'c.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: quest.id, memberId: mB, allowGeo: false });
    await s.toggleReaction(s.submissionsOfTrip(tid).find((x) => x.id !== sub.id).id, mB, '❤️');
  }, joinRes.tid);
  await drain(B.page);
  ok('裝置 B 拍 1 張 + 按讚並推送');

  await drain(A.page);
  const aPull = await A.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const subs = s.submissionsOfTrip(tid);
    return { subs: subs.length, reacts: subs.reduce((n, x) => n + s.reactionsOf(x.id).length, 0) };
  }, setup.tid);
  if (aPull.subs === 3) ok('裝置 A 收到裝置 B 的照片（共 3 張）'); else fail('裝置 A 投稿數：' + aPull.subs);
  if (aPull.reacts === 1) ok('裝置 A 收到裝置 B 的讚'); else fail('裝置 A 讚數：' + aPull.reacts);

  // 4) 撤回一張，兩邊都消失
  await A.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    await s.deleteSubmission(s.submissionsOfTrip(tid)[0].id);
  }, setup.tid);
  await drain(A.page);
  await drain(B.page);
  const bRetract = await B.page.evaluate(async (tid) => (await import('./js/store.js')).submissionsOfTrip(tid).length, joinRes.tid);
  if (bRetract === 2) ok('撤回同步：裝置 B 也剩 2 張'); else fail('撤回後裝置 B：' + bRetract);

  // 5) 換手機：裝置 C 用身分備份卡還原
  const card = await A.page.evaluate(async () => {
    const { exportCard, encodeCard } = await import('./js/identity.js');
    return encodeCard(await exportCard());
  });
  const C = await device('C');
  const cRes = await C.page.evaluate(async (card) => {
    const { decodeCard, importCard } = await import('./js/identity.js');
    await importCard(decodeCard(card));
    const s = await import('./js/store.js');
    const trip = s.trips()[0];
    const subs = trip ? s.submissionsOfTrip(trip.id) : [];
    const mine = subs.filter((x) => { const m = s.getRaw(x.memberId); return m && m.displayName === '阿明'; }).length;
    return { trips: s.trips().length, subs: subs.length, mineByName: mine };
  }, card);
  await drain(C.page);
  const cRes2 = await C.page.evaluate(async () => {
    const s = await import('./js/store.js');
    const trip = s.trips()[0];
    const subs = trip ? s.submissionsOfTrip(trip.id) : [];
    const mine = subs.filter((x) => { const m = s.getRaw(x.memberId); return m && m.displayName === '阿明'; }).length;
    return { trips: s.trips().length, subs: subs.length, mineByName: mine };
  });
  Object.assign(cRes, cRes2);
  // 撤回步驟刪掉了阿明的一張，所以剩 1 張是阿明的、1 張是小美的；重點是換裝置後仍認得阿明
  if (cRes.trips === 1 && cRes.subs === 2 && cRes.mineByName === 1) ok(`裝置 C 用備份卡換裝置認領：${cRes.trips} 旅程、${cRes.subs} 照片、阿明身分仍對得上`);
  else fail('備份卡還原：' + JSON.stringify(cRes));

  // 6) 錯誤祕鑰被擋
  const unauth = await A.page.evaluate(async (gid, w) => {
    return (await fetch(`${w}/pull?g=${gid}&since=0`, { headers: { authorization: 'Bearer deadbeefdeadbeefdeadbeefdeadbeef00' } })).status;
  }, setup.gid, WORKER);
  if (unauth === 403) ok('錯誤祕鑰被擋（403）'); else fail('未授權存取：' + unauth);

  console.log(`\n驗證用群組 ${setup.gid}（可留著，靠祕鑰隔離；要清可在 wrangler d1 execute 刪）`);
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  console.log('線上端到端驗證結束');
}
