// 調整每天的行程 ＋ 景點設定頁（npm run plantest）
//
// 兩件事一起測，因為它們互為前提：
//   · 「換天」按鈕拿掉了 → 跨天拖曳必須真的做得到，包含**目標在畫面外**的情況。
//     實測（改版前）：32 個景點的宜蘭行程，第 3 天的標題在第 1 天下方 6313px，
//     螢幕只有 844px，而且沒有邊緣自動捲動 —— 跨天拖曳根本不可能完成。
//     所以先補了自動捲動，才拿掉「換天」。
//   · 景點設定頁只剩改名／時間／停留／刪除 → 被拿掉的功能必須在別處到得了，
//     尤其「加任務／改任務」要確認「調整每天的行程」真的做得到，不能變成死路。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5401;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const eq = (g, w, m) => (g === w ? ok(m) : fail(m, `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
const cdp = await page.createCDPSession();
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
});

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 用使用者那份真實行程（32 個景點、3 天）—— 短行程測不出跨天拖曳的難處
  const RAW = readFileSync(new URL('./fixtures/yilan.txt', import.meta.url), 'utf8');
  const ids = await page.evaluate(async (raw) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { parseItinerary } = await import('./js/itinerary.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const p = parseItinerary(raw);
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '我' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: p.title, region: '宜蘭', allowWiki: false });
    const items = p.items.map((x) => ({ name: x.name, day: x.day, startMin: x.startMin, stayMin: x.stayMin, region: '宜蘭' }));
    const { spots, quests } = await generateForTrip({ tripId: tid, items, region: '宜蘭' });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    // 挑一個停留時間**不在預設選項裡**的（香草菲菲 187 分），才驗得到「不設定」那個老問題
    return { tid, sid: spots.find((x) => x.name.includes('香草菲菲')).id };
  }, RAW);
  ok('用真實行程建立（32 個景點、3 天）');

  const openPlan = async () => {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/plan`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.plan-row', { timeout: 20000 });
    await sleep(700);
  };

  // ---------- 1. 「換天」拿掉了 ----------
  console.log('\n— 調整每天的行程 —');
  await openPlan();
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('.plan-row .plan-mini')].map((e) => e.textContent.replace(/\s+/g, '')));
  yes(!btns.some((t) => t.includes('換天')), '每個景點的「換天」按鈕已移除');
  yes(btns.some((t) => t.includes('任務')), '改任務那顆還在');
  yes(btns.some((t) => t.includes('設定')), '景點設定那顆還在');
  const arrows = await page.$$eval('.plan-row .plan-arrow', (els) => els.map((e) => e.getAttribute('aria-label')));
  yes(arrows.includes('往前移') && arrows.includes('往後移'), '同一天內的 ▲▼ 保留（不擅長拖拉的人還有路可走）');
  const tip = await page.$eval('.plan-tip', (e) => e.textContent);
  yes(!tip.includes('換天'), '說明文字也不再提「換天」');
  eq(tip.trim(), '按住 ☰ 拖曳可以換順序，同一天內換前後也可以用 ▲ ▼。', '提示只剩一句（拿掉邊緣捲動那段）');
  // 第 2 項：兩顆按鈕要等寬對齊
  const pair = await page.evaluate(() => {
    const row = document.querySelector('.plan-row-actions');
    const bs = [...row.querySelectorAll('.plan-mini')];
    return bs.map((b) => ({ w: Math.round(b.getBoundingClientRect().width), t: b.innerText.replace(/s+/g, '') }));
  });
  // v1.51 起多了 📌 釘住（排順序時當錨）—— 任務/設定兩顆仍要等寬
  eq(pair.length, 3, '一排三顆按鈕（任務／📌／設定）');
  yes(Math.abs(pair[0].w - pair[2].w) <= 1, `任務與設定等寬（${pair.map((x) => x.t + '=' + x.w + 'px').join('、')}）`);

  // ---------- 2. 目標在畫面外的跨天拖曳 ----------
  console.log('\n— 跨天拖曳（目標在畫面外）—');
  const geo = await page.evaluate(() => {
    const divs = [...document.querySelectorAll('.plan-divider')];
    const rows = [...document.querySelectorAll('.plan-row')];
    return {
      day3Top: Math.round(divs[2].getBoundingClientRect().top + scrollY),
      firstTop: Math.round(rows[0].getBoundingClientRect().top + scrollY),
      vh: innerHeight,
      first: rows[0].querySelector('.plan-name').textContent.trim(),
      day3Count: rows.filter((r) => {
        const y = r.getBoundingClientRect().top + scrollY;
        return y > divs[2].getBoundingClientRect().top + scrollY;
      }).length,
    };
  });
  yes(geo.day3Top - geo.firstTop > geo.vh * 3,
    `第 3 天在第 1 天下方 ${geo.day3Top - geo.firstTop}px，螢幕只有 ${geo.vh}px（所以自動捲動是必要的）`);

  const startDay = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    return s.spotsOf(tid)[0].day;
  }, ids.tid);
  eq(startDay, 1, `第一個景點原本在第 ${startDay} 天`);

  // 抓住第一列的把手，把手指壓在畫面下緣讓它一路捲到第 3 天
  const h0 = await page.evaluate(() => {
    const r = document.querySelector('.plan-row .plan-handle').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await touch('touchStart', h0.x, h0.y);
  await touch('touchMove', h0.x, h0.y + 30);
  const edgeY = 844 - 90;
  for (let i = 0; i < 160; i++) {                   // 停在下緣，讓自動捲動帶它走
    await touch('touchMove', h0.x, edgeY);
    await sleep(45);
    const done = await page.evaluate(() => {
      const d3 = [...document.querySelectorAll('.plan-divider')][2];
      return d3 ? d3.getBoundingClientRect().bottom < innerHeight - 200 : false;
    });
    if (done) break;
  }
  await sleep(300);
  await touch('touchEnd', 0, 0);
  await sleep(900);
  const moved = await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const sp = s.spotsOf(tid);
    const first = sp.find((x) => x.name === '家');
    return { day: first ? first.day : null, scrolled: Math.round(scrollY) };
  }, ids.tid);
  yes(moved.day === 3, `拖到畫面外的第 3 天成功（那個景點現在在第 ${moved.day} 天，過程中自動捲了 ${moved.scrolled}px）`,
    JSON.stringify(moved));

  // ---------- 3. ▲▼ 仍然有效 ----------
  console.log('\n— ▲▼ —');
  await openPlan();
  const beforeOrder = await page.$$eval('.plan-row .plan-name', (e) => e.slice(0, 2).map((x) => x.textContent.trim()));
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.plan-row')];
    rows[1].querySelector('.plan-arrow[aria-label="往前移"]').click();
  });
  await sleep(700);
  const afterOrder = await page.$$eval('.plan-row .plan-name', (e) => e.slice(0, 2).map((x) => x.textContent.trim()));
  yes(JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder), `▲ 有效：${beforeOrder.join('／')} → ${afterOrder.join('／')}`);

  // ---------- 4. 加任務／改任務沒有變成死路 ----------
  console.log('\n— 加任務／改任務還到得了嗎 —');
  await openPlan();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.plan-mini')].find((x) => /任務/.test(x.textContent));
    b.scrollIntoView({ block: 'center' }); b.click();
  });
  await page.waitForSelector('.plan-quests .pq-row, .plan-quests .btn', { timeout: 8000 });
  const qbox = await page.evaluate(() => ({
    rows: document.querySelectorAll('.plan-quests .pq-row').length,
    edit: [...document.querySelectorAll('.plan-quests .tag-btn')].map((e) => e.textContent.trim()),
    add: [...document.querySelectorAll('.plan-quests .btn')].map((e) => e.textContent.trim()),
  }));
  yes(qbox.rows > 0, `「改任務」展開後列出 ${qbox.rows} 個任務`);
  yes(qbox.edit.includes('編輯') && qbox.edit.includes('刪除'), '每個任務都有「編輯」「刪除」');
  yes(qbox.add.some((t) => t.includes('新增任務')), '有「＋ 新增任務」');
  // 真的加得進去
  const addedCount = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const before = s.exportRecords().filter((r) => r.type === 'quest').length;
    return before;
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.plan-quests .btn')].find((x) => x.textContent.includes('新增任務'));
    b.click();
  });
  await page.waitForSelector('.modal-card input, .modal-card textarea', { timeout: 6000 });
  await page.evaluate(() => {
    const f = document.querySelector('.modal-card input, .modal-card textarea');
    f.value = '測試新增的任務';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.modal-actions .btn')].find((b) => /下一步|確定|新增/.test(b.textContent)).click();
  });
  await page.waitForSelector('.modal-card input, .modal-card textarea', { timeout: 6000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.modal-actions .btn')].find((b) => /新增|確定/.test(b.textContent)).click();
  });
  await sleep(900);
  const after = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    return s.exportRecords().filter((r) => r.type === 'quest').length;
  });
  eq(after, addedCount + 1, '從「調整每天的行程」真的加得了新任務（不是死路）');

  // ---------- 5. 景點設定頁 ----------
  console.log('\n— 景點設定頁 —');
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/spot/${ids.sid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form', { timeout: 15000 });
  await sleep(500);
  const sv = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.form-label')].map((e) => e.textContent.trim()),
    buttons: [...document.querySelectorAll('.page button')].map((e) => e.textContent.trim()),
    hasHero: !!document.querySelector('.quest-focus-photo'),
    hasBlurb: !!document.querySelector('.spot-blurb'),
    hasMap: !!document.querySelector('a[href*="maps"]'),
    hasQuestList: !!document.querySelector('.qrow'),
    hasAddPhoto: !!document.querySelector('.addphoto-row, .addphoto-icons'),
    time: document.querySelector('.spot-time').value,
    stay: document.querySelector('.spot-stay').selectedOptions[0].textContent,
  }));
  eq(sv.labels.join('／'), '景點名稱／幾點到／停留多久／地圖位置', `欄位：${sv.labels.join('、')}（v1.48 起多了地圖位置）`);
  // 第 5 項：上方的「第幾天／幾個任務」與底下那段提示都拿掉
  const txt = await page.evaluate(() => document.querySelector('#view > .page').innerText);
  yes(!/第 d+ 天/.test(txt), '上方不再顯示「第幾天」');
  yes(!/個任務/.test(txt), '上方不再顯示「幾個任務」');
  yes(!/調整每天的行程/.test(txt), '底下那段「任務要改要加請到…」的提示已移除');
  yes(!sv.hasHero, '示意圖已移除');
  yes(!sv.hasBlurb, '文字描述已移除');
  yes(!sv.hasMap, '「用地圖帶我去」已移除（改在景點標題列的 🗺️）');
  yes(!sv.hasQuestList, '任務清單已移除');
  yes(!sv.hasAddPhoto, '加照片按鈕已移除（在任務列上）');
  yes(sv.buttons.some((t) => t.includes('刪除這個景點')), '有「刪除這個景點」');

  // 時間與停留：非預設值不能變成「不設定」
  eq(sv.time, '11:23', `時間帶進來了（${sv.time}）`);
  eq(sv.stay, '3.1 小時', `停留 187 分不是預設選項，但正確顯示成「${sv.stay}」（不是「不設定」）`);

  // 改名 + 改時間 → 行程頁要同步更新
  await page.evaluate(() => {
    const n = document.querySelector('.field[type=text]');
    n.value = '香草菲菲（改過）';
    n.dispatchEvent(new Event('input', { bubbles: true }));
    const t = document.querySelector('.spot-time');
    t.value = '18:30';
    t.dispatchEvent(new Event('change', { bubbles: true }));
    const s = document.querySelector('.spot-stay');
    s.value = '90';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('.page button')].find((b) => b.textContent.trim() === '儲存').click();
  });
  await page.waitForFunction(() => location.hash.includes('/plan'), { timeout: 10000 });
  await sleep(1200);
  const saved = await page.evaluate(async (sid) => {
    const s = await import('./js/store.js');
    const sp = s.getRaw(sid);
    return { name: sp.name, startMin: sp.startMin, stayMin: sp.stayMin, legacy: [sp.startTime, sp.endTime] };
  }, ids.sid);
  eq(saved.name, '香草菲菲（改過）', '名字存進去了');
  eq(saved.startMin, 1110, '時間存成 18:30（1110 分）');
  eq(saved.stayMin, 90, '停留存成 90 分');
  eq(saved.legacy.join(','), ',', '舊的字串欄位清掉了（只留一套，海報與回顧才不會讀到過期值）');

  ok('儲存後回到「調整每天的行程」，不會跳去別頁');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qcollapse', { timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('.qcollapse').forEach((x) => x.classList.add('open')));
  await sleep(600);
  const onTrip = await page.evaluate(() => document.body.innerText);
  yes(onTrip.includes('香草菲菲（改過）'), '行程頁上的名字同步更新');
  yes(/18:30 停留 1 小時 30 分/.test(onTrip), '行程頁上的時間也同步更新（18:30 停留 1 小時 30 分）');

  // ---------- 6. 刪除要說清楚會連帶刪掉什麼 ----------
  console.log('\n— 刪除確認 —');
  await page.goto(`http://localhost:${WEB}/#/trip/${ids.tid}/spot/${ids.sid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.page.form', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.page button')].find((b) => b.textContent.includes('刪除這個景點')).click();
  });
  await page.waitForSelector('.del-warn', { timeout: 8000 });
  const warn = await page.evaluate(() => ({
    text: document.querySelector('.modal-card').innerText.replace(/\s+/g, ' '),
    actions: [...document.querySelectorAll('.modal-actions .btn')].map((b) => b.textContent.trim()),
  }));
  yes(/個拍照任務/.test(warn.text), `說明會連帶刪掉幾個任務：「${warn.text.slice(0, 60)}…」`);
  yes(/救不回來|還沒有任務/.test(warn.text), '講明救不回來');
  yes(warn.actions.some((t) => /再想想|不要/.test(t)), `有明確的退出選項：${warn.actions.join(' / ')}`);
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => /再想想|不要/.test(b.textContent)).click());
  await sleep(400);
  const stillThere = await page.evaluate(async (sid) => !!(await import('./js/store.js')).getRaw(sid), ids.sid);
  yes(stillThere, '按「再想想」不會刪掉');

  // 第 1 項：真的刪掉之後要留在「調整每天的行程」
  await page.evaluate(() => {
    [...document.querySelectorAll('.page button')].find((b) => b.textContent.includes('刪除這個景點')).click();
  });
  await page.waitForSelector('.del-warn', { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('.modal-actions .btn')].find((b) => /刪掉/.test(b.textContent)).click());
  await page.waitForFunction(() => !location.hash.includes('/spot/'), { timeout: 15000 });
  await sleep(900);
  const landed = await page.evaluate(() => ({ hash: location.hash, hasPlan: !!document.querySelector('.plan-row') }));
  yes(//plan$/.test(landed.hash) && landed.hasPlan,
    `刪除後留在「調整每天的行程」（${landed.hash}）`, JSON.stringify(landed));
  // remove() 是留墓碑（getRaw 仍讀得到），要用 get() 判斷還在不在
  const gone = await page.evaluate(async (sid) => !(await import('./js/store.js')).get(sid), ids.sid);
  yes(gone, '景點真的刪掉了');

  console.log('\n行程調整與景點設定測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
