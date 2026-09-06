// 折疊的預設展開規則（npm run collapsetest）
//
// 使用者實機回報：打開時「第二天的全部任務都是展開的」，但預期只展開進行中的那一站。
//
// 原因兩個：
//   ① 沒有手動指定「現在這一站」時，景點層的預設是 `!allDone` ——
//      當天所有還沒完成的景點通通展開。
//   ② 按過一次「全部展開」會把每個景點的 spotOpen 寫成 1，而且**永遠記住**，
//      之後不管焦點怎麼移動都還是全開。
//
// 規則（現行）：
//   天  ：現在這一站在哪天 → 只開那天；否則 全完成→全收 / 沒日期或還沒開始→只開第一天
//         / 已結束→全收 / 進行中→只開今天。使用者手動點過的那一天以他為準。
//   景點：只開「現在這一站」（手動指定的，或第一個未完成的）。
//         使用者手動點過的那一個以他為準。
//   焦點換了（他自己改，或前一站拍完自動往下走）→ 清掉記住的狀態，新預設生效。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5361;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const eq = (g, w, m) => (g === w ? ok(m) : fail(m, `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`));
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

const open = async (tid) => {
  await page.goto('about:blank');
  await page.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qcollapse', { timeout: 20000 });
  await sleep(900);
};
const state = () => page.evaluate(() => ({
  days: [...document.querySelectorAll('.daycollapse')].map((d) => ({
    day: d.dataset.day, open: d.classList.contains('open'),
  })),
  spots: [...document.querySelectorAll('.qcollapse')].map((s) => ({
    name: (s.querySelector('.qc-name') || {}).firstChild?.textContent || '',
    open: s.classList.contains('open'),
    here: !!s.querySelector('.qc-here'),
  })),
}));
const openSpots = (st) => st.spots.filter((s) => s.open).map((s) => s.name);
const openDays = (st) => st.days.filter((d) => d.open).map((d) => d.day);

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 兩天、每天三個景點；第 1 天全部完成，第 2 天第一個完成、後兩個沒完成
  // —— 正是使用者的情境：同一天多個景點、部分完成
  const setup = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: me, type: 'member', groupId: gid, displayName: '我' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '折疊測試', region: '宜蘭', allowWiki: false });
    const names = [['D1甲', 1], ['D1乙', 1], ['D1丙', 1], ['D2甲', 2], ['D2乙', 2], ['D2丙', 2]];
    const spots = [];
    let order = 0;
    for (const [name, day] of names) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, emoji: '📍', day, order: order++ });
      const qs = [];
      for (let k = 0; k < 2; k++) {
        const qid = uuid();
        await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sid, title: `${name}任務${k + 1}`, kind: 'thing', order: k });
        qs.push(qid);
      }
      spots.push({ id: sid, name, day, qs });
    }
    const c = document.createElement('canvas'); c.width = 200; c.height = 150;
    c.getContext('2d').fillRect(0, 0, 200, 150);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const shoot = async (qid) => importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: qid, memberId: me });
    // 第 1 天三個景點全部拍完
    for (const sp of spots.filter((x) => x.day === 1)) for (const q of sp.qs) await shoot(q);
    // 第 2 天只有第一個拍完
    for (const q of spots.find((x) => x.name === 'D2甲').qs) await shoot(q);
    return { tid, spots: spots.map((x) => ({ id: x.id, name: x.name, day: x.day })) };
  });
  ok('建立：兩天各三個景點，第 1 天全完成、第 2 天只完成第一個');

  // ---------- 預設：只展開第一個未完成的景點 ----------
  console.log('\n— 沒有手動指定「現在這一站」—');
  await open(setup.tid);
  let st = await state();
  eq(openSpots(st).join(','), 'D2乙', `只展開第一個未完成的景點（實得：${openSpots(st).join('、') || '無'}）`);
  eq(openDays(st).join(','), '2', `只展開它所在的第 2 天（實得：${openDays(st).join('、') || '無'}）`);
  yes(!st.spots.find((x) => x.name === 'D2丙').open, '同一天其他未完成的景點是收起來的（使用者回報的就是這裡全開）');
  yes(!st.spots.find((x) => x.name === 'D1甲').open, '已完成的景點收起來');

  // ---------- 手動點過的以他為準 ----------
  console.log('\n— 手動展開會被記住 —');
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.qcollapse')].find((s) => s.querySelector('.qc-name').firstChild.textContent === 'D2丙');
    sec.querySelector('.qc-toggle').click();
  });
  await sleep(300);
  await open(setup.tid);
  st = await state();
  yes(st.spots.find((x) => x.name === 'D2丙').open, '手動展開的那一個，下次打開仍然是開的');
  yes(st.spots.find((x) => x.name === 'D2乙').open, '現在這一站照樣是開的');

  // ---------- 焦點移動 → 記住的狀態清掉 ----------
  console.log('\n— 焦點移動之後 —');
  await page.evaluate(async (st2) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const c = document.createElement('canvas'); c.width = 200; c.height = 150;
    c.getContext('2d').fillRect(0, 0, 200, 150);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const me = s.exportRecords().find((r) => r.type === 'member').id;
    const sp = st2.spots.find((x) => x.name === 'D2乙');
    for (const q of s.questsOf(sp.id)) {
      await importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: st2.tid, questId: q.id, memberId: me });
    }
  }, setup);
  await open(setup.tid);
  st = await state();
  eq(openSpots(st).join(','), 'D2丙', `D2乙 拍完之後，焦點自動移到 D2丙，而且只開它（實得：${openSpots(st).join('、') || '無'}）`);
  yes(!st.spots.find((x) => x.name === 'D2乙').open, '先前手動展開的狀態被清掉了，不會越積越多');

  // ---------- 「全部展開」不會變成永久全開 ----------
  console.log('\n— 按過「全部展開」之後 —');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.day-tool-btn')].find((x) => x.textContent.includes('全部展開'));
    if (b) b.click();
  });
  await sleep(400);
  st = await state();
  eq(openSpots(st).length, 6, '按下去當場全部展開（這是他要的）');
  await open(setup.tid);
  st = await state();
  yes(openSpots(st).length === 6, '同一個焦點下重開仍然全開（尊重他的選擇）');
  // 焦點一移動就回到只開一個
  await page.evaluate(async (st2) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const c = document.createElement('canvas'); c.width = 200; c.height = 150;
    c.getContext('2d').fillRect(0, 0, 200, 150);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const me = s.exportRecords().find((r) => r.type === 'member').id;
    const sp = st2.spots.find((x) => x.name === 'D2丙');
    for (const q of s.questsOf(sp.id)) {
      await importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: st2.tid, questId: q.id, memberId: me });
    }
  }, setup);
  await open(setup.tid);
  st = await state();
  yes(openSpots(st).length <= 1, `全部完成之後不再是全開（開著 ${openSpots(st).length} 個）`);

  // ---------- 手動指定「現在這一站」 ----------
  console.log('\n— 手動指定現在這一站 —');
  await page.evaluate(async (st2) => {
    const s = await import('./js/store.js');
    const sp = st2.spots.find((x) => x.name === 'D1乙');
    await s.setHereSpot(st2.tid, sp.id, null);
  }, setup);
  await open(setup.tid);
  st = await state();
  eq(openSpots(st).join(','), 'D1乙', `只展開指定的那一站（實得：${openSpots(st).join('、') || '無'}）`);
  eq(openDays(st).join(','), '1', '也只展開它所在的第 1 天');
  yes(st.spots.find((x) => x.name === 'D1乙').here, '那一站標著「現在這一站」');

  // ---------- 儲存鍵沒有因為 v1.41 改版而失效 ----------
  console.log('\n— 儲存鍵 —');
  // 先手動點一下再看 —— 剛剛換焦點時記住的狀態被清掉了，那時候本來就該是 0 個
  const keys = await page.evaluate(() => {
    document.querySelectorAll('.qcollapse')[0].querySelector('.qc-toggle').click();
    document.querySelectorAll('.daycollapse')[1].querySelector('.dc-head').click();
    return Object.keys(localStorage).filter((k) => /spotOpen|dayOpen|focus/.test(k));
  });
  yes(keys.some((k) => k.startsWith('tripquest.spotOpen.')), `景點層的鍵還是 tripquest.spotOpen.<spotId>（${keys.filter((k) => k.includes('spotOpen')).length} 個）`, '目前有的鍵：' + JSON.stringify(keys));
  yes(keys.some((k) => k.startsWith('tripquest.dayOpen.')), '天層的鍵還是 tripquest.dayOpen.<tripId>.<day>');
  yes(keys.some((k) => k.startsWith('tripquest.focus.')), '新增 tripquest.focus.<tripId> 記住上次的焦點（用來判斷要不要清掉舊狀態）');

  console.log('\n折疊規則測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
