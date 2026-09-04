// 多人同步端到端測試：起自架伺服器，兩個獨立瀏覽器 context 當兩台手機。
// 用法：node scripts/synctest.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5194, API = 8790;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });

const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ok = (m) => console.log('✓ ' + m);
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${name} pageerror]`, e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate((url) => {
    (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })();
  }, `http://localhost:${API}`);
  return { ctx, page };
}
async function go(page, hash) { await page.goto('about:blank'); await page.goto(`http://localhost:${WEB}${hash}`, { waitUntil: 'networkidle0' }); }

try {
  // ---- 裝置 A：建立行程 + 灌 2 張照片 ----
  const A = await device('A');
  const setup = await A.page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '同步測試團' });
    const mA = uuid(), mB = uuid();
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '小美' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '同步測試', region: '京都', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, itineraryText: '清水寺、金閣寺', region: '京都' });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    await ensureGroupSync(gid);
    // 兩張照片（阿明拍的）
    const mk = (h) => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = `hsl(${h},60%,50%)`; x.fillRect(0, 0, 600, 400); x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText('IMG' + h, 40, 200); return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.85)); };
    await importPhoto(new File([await mk(10)], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: quests[0].id, memberId: mA, allowGeo: false });
    await importPhoto(new File([await mk(200)], 'b.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: quests[1].id, memberId: mA, allowGeo: false });
    return { tid, gid };
  });
  ok('裝置 A 建立行程 + 2 張照片');

  // 觸發 A 的同步（把資料 + 照片推上伺服器）
  const aPush = await A.page.evaluate(async () => {
    const { drain } = await import('./js/outbox.js');
    return drain();
  });
  if (aPush && aPush.pushed >= 1 && aPush.uploaded >= 2) ok(`裝置 A 推送：資料 ${aPush.pushed}、照片 ${aPush.uploaded}`);
  else fail('裝置 A 推送異常：' + JSON.stringify(aPush));

  // 產生邀請連結
  const invite = await A.page.evaluate(async (tid) => (await import('./js/share.js')).shareURL(tid), setup.tid);
  if (invite.includes('#/join?j=')) ok('產生同步邀請連結'); else fail('邀請連結格式：' + invite.slice(0, 60));

  // ---- 裝置 B：用邀請連結加入 ----
  const B = await device('B');
  const code = invite.split('j=')[1];
  const joinRes = await B.page.evaluate(async (code) => {
    const { joinInvite } = await import('./js/share.js');
    const tid = await joinInvite(code);
    const s = await import('./js/store.js');
    const subs = s.submissionsOfTrip(tid);
    const spots = s.spotsOf(tid);
    const members = s.membersOf(s.get(tid).groupId);
    // 檢查照片縮圖有沒有下載回來
    const db = await import('./js/db.js');
    const keys = new Set(await db.allBlobKeys());
    const thumbsLocal = subs.filter((x) => keys.has(x.thumbHash)).length;
    return { tid, subs: subs.length, spots: spots.length, members: members.length, thumbsLocal };
  }, code);
  if (joinRes.spots === 2 && joinRes.members === 2) ok(`裝置 B 加入：${joinRes.spots} 景點、${joinRes.members} 成員`);
  else fail('裝置 B 骨架同步異常：' + JSON.stringify(joinRes));
  if (joinRes.subs === 2) ok('裝置 B 收到 2 筆投稿'); else fail('裝置 B 投稿數：' + joinRes.subs);
  if (joinRes.thumbsLocal === 2) ok('裝置 B 縮圖已下載到本機'); else fail('裝置 B 縮圖：' + joinRes.thumbsLocal + '/2');

  // 全圖延遲下載：呼叫 blobURL 應該從伺服器抓回
  const lazy = await B.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { blobURL, hasLocal } = await import('./js/photos.js');
    const sub = s.submissionsOfTrip(tid)[0];
    const before = await hasLocal(sub.photoHash);
    const url = await blobURL(sub.photoHash);
    const after = await hasLocal(sub.photoHash);
    return { before, after, gotUrl: !!url };
  }, joinRes.tid);
  if (!lazy.before && lazy.after && lazy.gotUrl) ok('裝置 B 全圖延遲下載成功'); else fail('全圖延遲下載：' + JSON.stringify(lazy));

  // ---- 裝置 B 也拍一張 + 按讚 → 回同步到 A ----
  await B.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const members = s.membersOf(s.get(tid).groupId);
    const mB = members.find((m) => m.displayName === '小美').id;
    const quest = s.questsOfTrip(tid).find((q) => !s.isQuestDone(q.id));
    const c = document.createElement('canvas'); c.width = 500; c.height = 500; c.getContext('2d').fillRect(0, 0, 500, 500);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    const sub = await importPhoto(new File([blob], 'c.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: quest.id, memberId: mB, allowGeo: false });
    const firstSub = s.submissionsOfTrip(tid).find((x) => x.id !== sub.id);
    await s.toggleReaction(firstSub.id, mB, '❤️');
    const { drain } = await import('./js/outbox.js');
    await drain();
  }, joinRes.tid);
  ok('裝置 B 拍 1 張 + 按讚並推送');

  // A 再同步一次，應該看到 B 的照片與讚
  const aPull = await A.page.evaluate(async (tid, gid) => {
    const { drain } = await import('./js/outbox.js');
    const sync = await import('./js/sync.js');
    const cursorBefore = await sync.getCursor(gid);
    const dr = await drain();
    const cursorAfter = await sync.getCursor(gid);
    const raw = await fetch(`http://localhost:8790/pull?g=${gid}&since=0`, { headers: { authorization: 'Bearer ' + (await import('./js/store.js')).getRaw(gid).syncSecret } }).then(r => r.json());
    window.__dbg = { dr, cursorBefore, cursorAfter, serverRecs: raw.records.length, serverSubs: raw.records.filter(r => r.type === 'submission').length, serverReacts: raw.records.filter(r => r.type === 'reaction').length };
    const s = await import('./js/store.js');
    const subs = s.submissionsOfTrip(tid);
    const reacts = subs.reduce((n, x) => n + s.reactionsOf(x.id).length, 0);
    const db = await import('./js/db.js');
    const keys = new Set(await db.allBlobKeys());
    const bThumb = subs.filter((x) => keys.has(x.thumbHash)).length;
    return { subs: subs.length, reacts, bThumb, dbg: window.__dbg };
  }, setup.tid, setup.gid);
  console.log('  dbg:', JSON.stringify(aPull.dbg));
  if (aPull.subs === 3) ok('裝置 A 收到裝置 B 的照片（共 3 張）'); else fail('裝置 A 投稿數：' + aPull.subs);
  if (aPull.reacts === 1) ok('裝置 A 收到裝置 B 的讚'); else fail('裝置 A 讚數：' + aPull.reacts);

  // ---- 撤回一張，兩邊都應消失 ----
  await A.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    await s.deleteSubmission(s.submissionsOfTrip(tid)[0].id);
    const { drain } = await import('./js/outbox.js');
    await drain();
  }, setup.tid);
  const bAfterRetract = await B.page.evaluate(async (tid) => {
    const { drain } = await import('./js/outbox.js');
    await drain();
    return (await import('./js/store.js')).submissionsOfTrip(tid).length;
  }, joinRes.tid);
  if (bAfterRetract === 2) ok('撤回同步：裝置 B 也剩 2 張'); else fail('撤回後裝置 B 張數：' + bAfterRetract);

  // ---- 換手機模擬：裝置 C 用身分備份卡還原 A ----
  const cardCode = await A.page.evaluate(async () => {
    const { exportCard, encodeCard } = await import('./js/identity.js');
    return encodeCard(await exportCard());
  });
  const C = await device('C');
  const cRes = await C.page.evaluate(async (card) => {
    const { decodeCard, importCard, myDeviceId } = await import('./js/identity.js');
    await importCard(decodeCard(card));
    const { drain } = await import('./js/outbox.js');
    await drain();
    const s = await import('./js/store.js');
    const trip = s.trips()[0];
    const subs = trip ? s.submissionsOfTrip(trip.id) : [];
    // 阿明拍的照片，換手機後 memberId 仍對得上
    const mine = subs.filter((x) => {
      const m = s.getRaw(x.memberId); return m && m.displayName === '阿明';
    }).length;
    return { deviceId: myDeviceId(), trips: s.trips().length, subs: subs.length, mineByName: mine };
  }, cardCode);
  if (cRes.trips === 1 && cRes.subs === 2) ok(`裝置 C 用備份卡還原：${cRes.trips} 旅程、${cRes.subs} 照片`);
  else fail('備份卡還原：' + JSON.stringify(cRes));

  // ---- 未授權存取應被擋 ----
  const unauth = await A.page.evaluate(async (gid) => {
    const r = await fetch(`http://localhost:${location.port ? '' : ''}` + '', {}).catch(() => null);
    void r;
    const bad = await fetch(`http://localhost:8790/pull?g=${gid}&since=0`, { headers: { authorization: 'Bearer wrongsecret000000000000000000' } });
    return bad.status;
  }, setup.gid);
  if (unauth === 403) ok('錯誤祕鑰被拒（403）'); else fail('未授權存取回應：' + unauth);

} catch (e) {
  fail('例外：' + e.stack);
} finally {
  await browser.close();
  web.kill(); api.kill();
  await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
  console.log('\n同步測試結束');
}
