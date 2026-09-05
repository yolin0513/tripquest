// 照片標記 + 加入照片動線的端到端測試（npm run tagtest）
//
// 針對長輩實測回報的兩個問題：
//   1. 任務列上的「編輯 / 刪除」被誤按 → 現在只剩兩顆加照片的按鈕，改任務移到「調整每天的行程」
//   2. 一次選多張時「照片裡有誰」被統一套用而標錯 → 上傳完全不問，改成事後一張一張標
//
// 最關鍵的一項是「標記會不會同步」：投稿是 append-only、合併時直接跳過，
// 所以標記若寫回投稿本身，在自己手機上看起來有改，卻永遠傳不到旅伴手機。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = path.join(ROOT, '.tagtest-tmp');
const WEB = 5196, API = 8792;

// ---------- 產生幾張真的 PNG（要走 <input type=file>，所以得是磁碟上的檔案）----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function png(size, [r, g, b]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) { raw[o++] = 0; for (let x = 0; x < size; x++) { raw[o++] = r; raw[o++] = g; raw[o++] = (b + x) & 255; } }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
const FILES = [];
for (let i = 0; i < 3; i++) {
  const f = path.join(TMP, `pic${i}.png`);
  await writeFile(f, png(64, [40 + i * 70, 90, 30 + i * 60]));
  FILES.push(f);
}

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
  page.on('pageerror', (e) => { console.log(`  [${name} pageerror]`, e.message); process.exitCode = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${name} console]`, m.text()); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate((url) => {
    (async () => { (await import('./js/sync.js')).setConfig({ mode: 'lan', url }); })();
  }, `http://localhost:${API}`);
  return { ctx, page };
}
const go = async (page, hash) => {
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}${hash}`, { waitUntil: 'networkidle0' });
};
const drain = (page) => page.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));

// 加完照片會連續跳「完成一個任務」＋每個新徽章各一次慶祝，全部按掉才會回到頁面
async function clearCelebrations(page, max = 10) {
  let n = 0;
  for (let k = 0; k < max; k++) {
    if (!await page.$('.celebrate')) break;
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.celebrate .btn')];
      (btns.find((b) => /繼續|太棒/.test(b.textContent)) || btns[0])?.click();   // 不要按會跳走的那幾顆
    });
    n++;
    await sleep(350);
  }
  return n;
}

try {
  const A = await device('A');

  // ---------- 建立一趟三人行程 ----------
  const setup = await A.page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync } = await import('./js/share.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: '標記測試團' });
    const dad = uuid(), bro = uuid(), mom = uuid();
    await s.put({ id: dad, type: 'member', groupId: gid, displayName: '爸爸' });
    await s.put({ id: bro, type: 'member', groupId: gid, displayName: '弟弟' });
    await s.put({ id: mom, type: 'member', groupId: gid, displayName: '媽媽' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '標記測試', region: '京都', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, itineraryText: '清水寺', region: '京都' });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    await ensureGroupSync(gid);
    s.setActiveMember(tid, dad);
    return { tid, gid, dad, bro, mom, spotId: spots[0].id, questId: quests[0].id };
  });
  ok('建立三人行程（爸爸 / 弟弟 / 媽媽）');

  // ================= 行程頁：打開就看得到加照片的按鈕，不用先點任何東西 =================
  await go(A.page, `/#/trip/${setup.tid}`);
  await A.page.waitForSelector('.qbig');
  const front = await A.page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !!el.offsetParent;
    };
    const cards = [...document.querySelectorAll('.qbig')];
    const first = cards[0];
    const btns = first ? [...first.querySelectorAll('.addphoto-row button')] : [];
    return {
      cards: cards.length,
      // 「不用先點任何東西」＝ 一進來按鈕就已經在畫面上（DOM 可見、有尺寸）
      btnsVisible: btns.filter(vis).length,
      labels: btns.map((b) => b.textContent),
      tooSmall: btns.filter((b) => b.getBoundingClientRect().height < 44).length,
      // 整個任務清單裡不該再有「編輯」
      editButtons: [...document.querySelectorAll('.qcollapse button, .qbig button')]
        .filter((b) => /編輯/.test(b.textContent)).length,
    };
  });

  if (front.btnsVisible === 2 && front.labels.every((t) => /拍照|相簿/.test(t))) {
    ok(`打開行程就直接看到加照片的按鈕：${front.labels.join(' / ')}（不用先點進任何地方）`);
  } else fail('行程頁任務卡上沒有加照片按鈕：' + JSON.stringify(front));
  if (front.editButtons === 0) ok('任務清單裡已經沒有「編輯」按鈕');
  else fail(`任務清單裡還有 ${front.editButtons} 顆「編輯」`);
  if (front.tooSmall === 0) ok('任務卡上的按鈕觸控區 ≥ 44px');
  else fail(`有 ${front.tooSmall} 顆按鈕太小`);

  // 從打開行程到「開始加照片」需要點幾下 —— 直接數，不用猜
  const taps = await A.page.evaluate(() => {
    const card = document.querySelector('.qbig');
    const btn = card && card.querySelector('.addphoto-row button');
    if (!btn) return -1;
    // 這顆按鈕現在就看得到、按下去就會叫出相機／相簿 → 1 下
    const r = btn.getBoundingClientRect();
    return (r.width > 0 && r.height > 0 && btn.offsetParent) ? 1 : -1;
  });
  if (taps === 1) ok('從打開行程到開始加照片：1 下（按「📷 拍照」就叫出相機）');
  else fail('點擊層級不對：' + taps);

  // 真的按下去會不會叫出檔案選擇（＝真的能開始加照片）
  const fires = await A.page.evaluate(() => new Promise((res) => {
    const card = document.querySelector('.qbig');
    const input = card.querySelector('input[type=file]');
    input.addEventListener('click', () => res(true), { once: true });
    card.querySelector('.addphoto-row button').click();
    setTimeout(() => res(false), 800);
  }));
  if (fires) ok('按下去確實會叫出相機／相簿');
  else fail('按了沒反應');

  // ================= 問題一：任務列只剩「加入照片」 =================
  await go(A.page, `/#/trip/${setup.tid}/spot/${setup.spotId}`);
  await A.page.waitForSelector('.qrow');
  const rowUI = await A.page.evaluate(() => {
    const rows = [...document.querySelectorAll('.qrow')];
    return {
      rows: rows.length,
      editOrDelete: rows.reduce((n, r) => n + r.querySelectorAll('.tag-btn').length, 0),
      addBtns: rows[0] ? [...rows[0].querySelectorAll('.addphoto-row button')].map((b) => b.textContent) : [],
      // 觸控區：長輩按得到才算數
      tooSmall: rows.reduce((n, r) => n + [...r.querySelectorAll('button')]
        .filter((b) => b.getBoundingClientRect().height < 44).length, 0),
    };
  });
  if (rowUI.editOrDelete === 0) ok('任務列已無「編輯 / 刪除」按鈕');
  else fail(`任務列仍有 ${rowUI.editOrDelete} 顆編輯/刪除按鈕`);
  if (rowUI.addBtns.length === 2 && rowUI.addBtns.every((t) => /拍照|相簿/.test(t))) ok(`任務列有兩顆加照片的按鈕：${rowUI.addBtns.join(' / ')}`);
  else fail('任務列的加照片按鈕不對：' + JSON.stringify(rowUI.addBtns));
  if (rowUI.tooSmall === 0) ok(`任務列 ${rowUI.rows} 列的按鈕觸控區都 ≥ 44px`);
  else fail(`任務列有 ${rowUI.tooSmall} 顆按鈕小於 44px`);

  // ---------- 一次選 3 張：不該跳出任何詢問 ----------
  await go(A.page, `/#/quest/${setup.questId}`);
  await A.page.waitForSelector('.big-shot-btn');
  const inputs = await A.page.$$('.big-shot-btn input[type=file]');
  await inputs[1].uploadFile(...FILES);            // [0]=拍照 [1]=從相簿選
  // 第一次完成任務會跳慶祝畫面（後面還接著徽章），慶祝之外不該有任何「詢問」對話框
  await A.page.waitForSelector('.celebrate', { timeout: 30000 });
  const askedDuringUpload = await A.page.evaluate(() => !!document.querySelector('.modal-overlay'));
  await clearCelebrations(A.page);
  await A.page.waitForFunction(() => document.querySelectorAll('.photo-cell').length >= 3, { timeout: 30000 });
  const afterUpload = await A.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const subs = s.submissionsOfTrip(tid);
    return {
      count: subs.length,
      anyPreTagged: subs.some((x) => x.subjectIds || x.forMemberId),
      untagged: s.untaggedPhotos(tid).length,
    };
  }, setup.tid);
  if (afterUpload.count === 3) ok('一次選 3 張，3 張都進來了');
  else fail('照片數：' + afterUpload.count);
  if (!askedDuringUpload && !afterUpload.anyPreTagged) ok('上傳過程完全沒問「照片裡有誰」（也沒被預先標記）');
  else fail(`上傳時仍有詢問：asked=${askedDuringUpload} preTagged=${afterUpload.anyPreTagged}`);
  if (afterUpload.untagged === 3) ok('3 張都標示為「未標記」');
  else fail('未標記數：' + afterUpload.untagged);

  // ================= 問題二：事後一張一張標，不會互相套用 =================
  const subIds = await A.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    return s.submissionsOfTrip(tid).map((x) => x.id);
  }, setup.tid);

  // 第 1 張＝全家福（三個人）、第 2 張＝只有弟弟 —— 這正是原本會標錯的情境
  await A.page.evaluate(async ([ids, dad, bro, mom]) => {
    const s = await import('./js/store.js');
    await s.setPhotoTag(ids[0], { subjectIds: [dad, bro, mom], photographerId: dad });
    await s.setPhotoTag(ids[1], { subjectIds: [bro], photographerId: mom });
  }, [subIds, setup.dad, setup.bro, setup.mom]);

  const tags = await A.page.evaluate(async ([ids]) => {
    const s = await import('./js/store.js');
    return ids.map((id) => {
      const sub = s.getRaw(id);
      const t = s.photoTag(sub);
      return { n: t.subjectIds.length, shooter: t.photographerId, tagged: s.isPhotoTagged(sub) };
    });
  }, [subIds]);
  if (tags[0].n === 3 && tags[1].n === 1) ok('第 1 張＝全家福（3 人）、第 2 張＝只有弟弟（1 人），沒有被統一套用');
  else fail('標記互相污染：' + JSON.stringify(tags));
  if (tags[0].shooter !== tags[1].shooter) ok('兩張的「誰拍的」各自獨立');
  else fail('拍攝者被統一套用');
  if (!tags[2].tagged) ok('第 3 張仍是未標記');
  else fail('第 3 張莫名被標記了');

  // ---------- 統計 / 徽章要跟著標記重算 ----------
  const stats1 = await A.page.evaluate(async ([tid, bro]) => {
    const b = await import('./js/badges.js');
    return { inPhotos: b.statsFor(tid, bro).inPhotosCount };
  }, [setup.tid, setup.bro]);
  await A.page.evaluate(async ([ids, dad]) => {
    const s = await import('./js/store.js');
    await s.setPhotoTag(ids[1], { subjectIds: [dad] });   // 改標記：弟弟換成爸爸
  }, [subIds, setup.dad]);
  const stats2 = await A.page.evaluate(async ([tid, bro]) => {
    const b = await import('./js/badges.js');
    return { inPhotos: b.statsFor(tid, bro).inPhotosCount };
  }, [setup.tid, setup.bro]);
  if (stats1.inPhotos === 2 && stats2.inPhotos === 1) ok(`改標記後統計即時重算（弟弟入鏡 ${stats1.inPhotos} → ${stats2.inPhotos}）`);
  else fail(`統計沒跟著標記走：${stats1.inPhotos} → ${stats2.inPhotos}`);

  // 改回全家福，方便後面驗同步
  await A.page.evaluate(async ([ids, bro]) => {
    const s = await import('./js/store.js');
    await s.setPhotoTag(ids[1], { subjectIds: [bro] });
    await s.setPhotoTag(ids[2], { caption: '這張有說明' });
  }, [subIds, setup.bro]);

  // ================= 標記與說明要真的同步到另一台手機 =================
  await drain(A.page);
  const invite = await A.page.evaluate(async (tid) => (await import('./js/share.js')).shareURL(tid), setup.tid);
  const code = invite.split('j=')[1];

  const B = await device('B');
  const joined = await B.page.evaluate(async (c) => {
    const tid = await (await import('./js/share.js')).joinInvite(c);
    const s = await import('./js/store.js');
    return { tid, subs: s.submissionsOfTrip(tid).length };
  }, code);
  if (joined.subs === 3) ok('裝置 B 加入後收到 3 張照片');
  else fail('裝置 B 收到的照片數：' + joined.subs);

  const bTags = await B.page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const subs = s.submissionsOfTrip(tid);
    return subs.map((x) => {
      const t = s.photoTag(x);
      return { n: t.subjectIds.length, shooter: t.photographerId, cap: t.caption };
    });
  }, joined.tid);
  if (bTags[0].n === 3 && bTags[1].n === 1) ok('「照片裡有誰」正確同步到裝置 B（3 人 / 1 人，沒有被合併掉）');
  else fail('標記沒同步到 B：' + JSON.stringify(bTags));
  if (bTags[0].shooter === setup.dad && bTags[1].shooter === setup.mom) ok('「這張是誰拍的」也同步到裝置 B');
  else fail('拍攝者沒同步：' + JSON.stringify(bTags.map((t) => t.shooter)));
  if (bTags[2].cap === '這張有說明') ok('事後加的照片說明也同步了（以前寫回投稿是傳不出去的）');
  else fail('說明沒同步：' + JSON.stringify(bTags[2].cap));

  // ---------- 兩台同時改同一張 → 後改的贏，不會變成兩筆打架 ----------
  await B.page.evaluate(async ([ids, mom]) => {
    const s = await import('./js/store.js');
    await s.setPhotoTag(ids[0], { subjectIds: [mom] });
  }, [subIds, setup.mom]);
  await drain(B.page);
  await drain(A.page);
  const merged = await A.page.evaluate(async ([tid, ids]) => {
    const s = await import('./js/store.js');
    const recs = s.exportRecords().filter((r) => r.type === 'phototag' && r.submissionId === ids[0]);
    const t = s.photoTag(s.getRaw(ids[0]));
    return { records: recs.length, n: t.subjectIds.length, tid };
  }, [setup.tid, subIds]);
  if (merged.records === 1) ok('同一張照片只會有一筆標記記錄（id 固定，不會兩台各生一筆）');
  else fail(`同一張照片有 ${merged.records} 筆標記記錄`);
  if (merged.n === 1) ok('兩台改同一張時，後改的那次為準');
  else fail('合併結果不對：' + merged.n);

  // ================= 照片牆的未標記提示 =================
  await go(A.page, `/#/trip/${setup.tid}/people`);
  await A.page.waitForSelector('.feed-item');
  const wall = await A.page.evaluate(() => ({
    cta: document.querySelector('.untag-cta')?.textContent || '',
    dots: document.querySelectorAll('.untag-dot').length,
    clickable: document.querySelectorAll('.fi-photo-btn').length,
  }));
  if (/還有 1 張沒標記/.test(wall.cta)) ok('照片牆有「還有 1 張沒標記」的入口');
  else fail('未標記入口不對：' + wall.cta);
  if (wall.dots === 1) ok('未標記的那張有「未標記」角標（其他張沒有）');
  else fail('未標記角標數：' + wall.dots);
  if (wall.clickable === 3) ok('照片牆每張照片都點得進標記畫面');
  else fail('可點的照片數：' + wall.clickable);

  // ---------- 標記畫面本身 ----------
  // 用 JS 觸發，不用座標點擊：照片是非同步塞進來的，版面會在點擊前後位移
  await A.page.evaluate(() => document.querySelector('.untag-cta').click());
  await A.page.waitForSelector('.tagger');
  const tagger = await A.page.evaluate(() => {
    const chips = [...document.querySelectorAll('.tagger-chip')];
    return {
      chips: chips.length,
      small: chips.filter((c) => c.getBoundingClientRect().height < 44).length,
      labels: [...document.querySelectorAll('.tagger-label')].map((l) => l.firstChild.textContent),
      hasNext: !!document.querySelector('.tagger-nav'),
    };
  });
  if (tagger.labels.join('|').includes('照片裡有誰') && tagger.labels.join('|').includes('這張是誰拍的')) ok('標記畫面有「照片裡有誰」與「這張是誰拍的」');
  else fail('標記畫面欄位不對：' + JSON.stringify(tagger.labels));
  if (tagger.small === 0) ok(`標記畫面 ${tagger.chips} 顆名字按鈕都 ≥ 44px`);
  else fail(`標記畫面有 ${tagger.small} 顆按鈕太小`);
  if (tagger.hasNext) ok('標記畫面可以連續切換到下一張');
  else fail('標記畫面沒有上一張/下一張');

  // 點名字就存（不需要按儲存）
  await A.page.evaluate(() => [...document.querySelectorAll('.tagger-chip')].find((c) => c.textContent.includes('弟弟'))?.click());
  await sleep(400);
  const afterTap = await A.page.evaluate(async ([tid]) => {
    const s = await import('./js/store.js');
    return { left: s.untaggedPhotos(tid).length };
  }, [setup.tid]);
  if (afterTap.left === 0) ok('點一下名字就直接存好了（沒有「儲存」按鈕要記得按）');
  else fail('點名字後仍未標記：' + afterTap.left);

  // ================= 任務的編輯 / 刪除有沒有真的搬到「調整每天的行程」 =================
  await go(A.page, `/#/trip/${setup.tid}/plan`);
  await A.page.waitForSelector('.plan-row');
  await A.page.evaluate(() => [...document.querySelectorAll('.plan-mini')].find((b) => b.textContent.includes('改任務'))?.click());
  await A.page.waitForSelector('.pq-row');
  const planUI = await A.page.evaluate(() => ({
    quests: document.querySelectorAll('.pq-row').length,
    edit: [...document.querySelectorAll('.pq-row .tag-btn')].map((b) => b.textContent),
    add: !![...document.querySelectorAll('.plan-quests .btn')].find((b) => b.textContent.includes('新增任務')),
    small: [...document.querySelectorAll('.pq-row .tag-btn')].filter((b) => b.getBoundingClientRect().height < 44).length,
  }));
  if (planUI.quests > 0 && planUI.edit.includes('編輯') && planUI.edit.includes('刪除')) ok(`「調整每天的行程」可以編輯 / 刪除任務（${planUI.quests} 個任務）`);
  else fail('行程頁沒有任務編輯：' + JSON.stringify(planUI));
  if (planUI.add) ok('「調整每天的行程」可以新增任務');
  else fail('行程頁沒有新增任務');
  if (planUI.small === 0) ok('行程頁的編輯 / 刪除按鈕觸控區 ≥ 44px');
  else fail(`行程頁有 ${planUI.small} 顆按鈕太小`);

  // 真的改一筆，確認寫得進去
  const before = await A.page.evaluate(async (sid) => (await import('./js/store.js')).questsOf(sid)[0].title, setup.spotId);
  await A.page.evaluate(() => document.querySelector('.pq-row .tag-btn')?.click());
  await A.page.waitForSelector('.modal-card input.field');
  await A.page.evaluate(() => { const i = document.querySelector('.modal-card input.field'); i.value = ''; });
  await A.page.type('.modal-card input.field', '改過的任務名');
  await A.page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === '確定')?.click());
  await A.page.waitForSelector('.modal-card textarea.field');
  await A.page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === '確定')?.click());
  await sleep(500);
  const after = await A.page.evaluate(async (sid) => (await import('./js/store.js')).questsOf(sid)[0].title, setup.spotId);
  if (after === '改過的任務名' && after !== before) ok(`在「調整每天的行程」改任務名成功（${before} → ${after}）`);
  else fail(`任務名沒改成功：${before} → ${after}`);

  // 刪除一個任務（含它的照片）
  const delOK = await A.page.evaluate(async (sid) => (await import('./js/store.js')).questsOf(sid).length, setup.spotId);
  await A.page.evaluate(() => document.querySelectorAll('.pq-row .tag-btn.danger')[0]?.click());
  await A.page.waitForSelector('.modal-actions');
  await A.page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === '刪除')?.click());
  await sleep(600);
  const delAfter = await A.page.evaluate(async (sid) => (await import('./js/store.js')).questsOf(sid).length, setup.spotId);
  if (delAfter === delOK - 1) ok(`在「調整每天的行程」刪任務成功（${delOK} → ${delAfter}）`);
  else fail(`刪任務失敗：${delOK} → ${delAfter}`);

  console.log('\n照片標記測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill(); api.kill();
  await rm(TMP, { recursive: true, force: true });
}
