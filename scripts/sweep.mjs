// 全功能巡檢（npm run sweep，預設跑正式站；加 --local 跑本機）
//
// 這支是「複查」用的：走過每一個畫面的三種狀態（有資料 / 空的 / 壞網址），
// 檢查主控台錯誤、空白畫面、橫向破版、畫面上出現 undefined|NaN|null、
// 觸控區太小、以及底部分頁每一顆真的按得動。
//
// 為什麼要有這支：功能測試各自只顧自己那一塊，
// 「某一頁在沒有資料時整個炸掉」這種事沒有人負責發現。
// v1.23 那輪就是靠這種掃描抓到 replaceChildren(null) 把字串 "null" 印在畫面上。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const LOCAL = process.argv.includes('--local');
const PORT = 5261;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let web = null;
if (LOCAL) { web = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' }); await sleep(1400); }
const BASE = LOCAL ? `http://localhost:${PORT}/` : 'https://yolin0513.github.io/tripquest/';

let pass = 0;
const problems = [];
const ok = (m) => { pass++; console.log('✓ ' + m); };
const bad = (m) => { problems.push(m); console.error('✗ ' + m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
let errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

const IGNORE = /favicon|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|overpass|nominatim|open-meteo|er-api/i;

// 一個畫面要通過的檢查
async function inspect(label, hash, { allowEmpty = false } = {}) {
  errs = [];
  await page.evaluate(() => { location.hash = '#/__blank__'; });
  await sleep(120);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await sleep(900);
  // 還在轉圈圈就多等一下 —— 不等的話量到的是「載入中」不是這一頁真正的樣子
  await page.waitForFunction(() => !document.querySelector('#view .spinner'), { timeout: 15000 }).catch(() => {});
  await sleep(400);

  const r = await page.evaluate(() => {
    const view = document.getElementById('view');
    const txt = (view.innerText || '').trim();
    const de = document.documentElement;
    // 找出真的溢出的元素，回報是誰（只說「有破版」很難修）
    const wide = [...document.querySelectorAll('#view *')]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 2)
      .slice(0, 3)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.className || '').toString().split(' ')[0]);
    // 太小的觸控區
    const small = [...document.querySelectorAll('#view button, #view a, #view input, #view select, #tabbar a')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (b.height < 40 || b.width < 40);
      })
      .slice(0, 5)
      .map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}(${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)})`);
    return {
      len: txt.length,
      hash: location.hash,
      // 「undefined」出現在畫面上一定是 bug；null/NaN 要抓獨立的字，
      // 不然「null」會誤中景點名稱之類的正常內容
      junk: (txt.match(/undefined|\bNaN\b|(?:^|[\s：:·])null(?:$|[\s，。])/g) || []).slice(0, 3),
      overflowX: de.scrollWidth > de.clientWidth + 2,
      wide, small,
    };
  });

  const real = errs.filter((e) => !IGNORE.test(e));
  if (real.length) bad(`${label}：主控台有錯 → ${real.slice(0, 2).join(' | ')}`);
  else if (!allowEmpty && r.len < 8) bad(`${label}：畫面幾乎空白（${r.len} 字）`);
  else if (r.junk.length) bad(`${label}：畫面上出現 ${JSON.stringify(r.junk)}`);
  else if (r.overflowX) bad(`${label}：橫向破版 → ${r.wide.join(', ') || '(找不到元素)'}`);
  else if (r.small.length) bad(`${label}：觸控區 <40px → ${r.small.join(', ')}`);
  else ok(`${label}（${r.len} 字）`);
  return r;
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.hero', { timeout: 30000 });
  const ver = await page.evaluate(() => fetch('./sw.js', { cache: 'reload' }).then((r) => r.text()).then((t) => (t.match(/tripquest-v[\d.]+/) || [''])[0]));
  console.log(`\n== 對象：${BASE}（${ver}）==\n`);

  // ---------- 1. 沒有任何資料時的每個畫面 ----------
  console.log('— 空狀態 —');
  await inspect('首頁（沒有旅程）', '/');
  await inspect('建立新旅程', '/new');
  await inspect('設定', '/settings');
  await inspect('緊急求助（沒有旅程）', '/sos');
  await inspect('加入（沒有邀請碼）', '/join');

  // ---------- 2. 壞網址 ----------
  console.log('\n— 壞網址／不存在的東西 —');
  for (const [label, h] of [
    ['不存在的旅程', '/trip/no-such-trip'],
    ['不存在的景點', '/trip/no-such-trip/spot/no-such-spot'],
    ['不存在的任務', '/quest/no-such-quest'],
    ['亂打的網址', '/zzz/qqq'],
    ['壞掉的邀請碼', '/join?j=%%%broken%%%'],
  ]) {
    errs = [];
    await page.evaluate((x) => { location.hash = x; }, h);
    await sleep(1200);
    const st = await page.evaluate(() => ({ hash: location.hash, len: (document.getElementById('view').innerText || '').trim().length }));
    const real = errs.filter((e) => !IGNORE.test(e));
    if (real.length) bad(`${label}：丟出錯誤 → ${real[0]}`);
    else if (st.len < 8) bad(`${label}：留下空白畫面`);
    else ok(`${label}：安全落地（${st.hash}）`);
  }

  // ---------- 3. 有資料時的每個畫面 ----------
  console.log('\n— 有資料 —');
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { importPhoto } = await import('./js/photos.js');
    const gid = uuid(), tid = uuid(), mA = uuid(), mB = uuid();
    await s.put({ id: gid, type: 'group', name: '巡檢家族' });
    await s.put({ id: mA, type: 'member', groupId: gid, displayName: '阿公', phone: '0912345678' });
    await s.put({ id: mB, type: 'member', groupId: gid, displayName: '小美' });
    const today = new Date();
    const iso = (d) => new Date(d).toISOString().slice(0, 10);
    await s.put({
      id: tid, type: 'trip', groupId: gid, title: '巡檢用行程', region: '台北', country: 'TW',
      startDate: iso(today - 86400000), endDate: iso(+today + 86400000), allowWiki: false,
    });
    const { spots, quests } = await generateForTrip({
      tripId: tid, region: '台北',
      items: [{ name: '台北101', day: 1, startMin: 540, stayMin: 120 }, { name: '士林夜市', day: 2, startMin: 1080 }],
    });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);

    // 一張真的照片 + 讚 + 留言 + 花費，讓照片牆／分帳／回顧都有東西可畫
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const cx = c.getContext('2d'); cx.fillStyle = '#3a7'; cx.fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const q0 = quests[0];
    await importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: q0.id, spotId: q0.spotId, memberId: mA });
    const subs = s.submissionsOfQuest ? s.submissionsOfQuest(q0.id) : [];
    const sub = subs[0];
    if (sub) {
      await s.put({ id: uuid(), type: 'reaction', tripId: tid, groupId: gid, submissionId: sub.id, memberId: mB, kind: 'like' });
      await s.put({ id: uuid(), type: 'comment', tripId: tid, groupId: gid, submissionId: sub.id, memberId: mB, text: '拍得真好' });
    }
    await s.put({ id: uuid(), type: 'expense', tripId: tid, groupId: gid, amount: 1200, currency: 'TWD', payerId: mA, participants: [mA, mB], category: 'food', note: '晚餐' });
    return { tid, sid: spots[0].id, qid: quests[0].id };
  });
  ok(`建立巡檢資料（2 景點、${(await page.evaluate(async (t) => (await import('./js/store.js')).questsOfTrip(t).length, ids.tid))} 任務、1 照片、1 花費）`);

  for (const [label, h, opt] of [
    ['首頁（有旅程）', '/', {}],
    ['行程頁', `/trip/${ids.tid}`, {}],
    ['旅程設定', `/trip/${ids.tid}/settings`, {}],
    ['調整每天的行程', `/trip/${ids.tid}/plan`, {}],
    ['照片牆', `/trip/${ids.tid}/people`, {}],
    ['分帳', `/trip/${ids.tid}/expenses`, {}],
    ['回顧 hub', `/trip/${ids.tid}/memories`, {}],
    ['成就徽章', `/trip/${ids.tid}/badges`, {}],
    ['最終回顧', `/trip/${ids.tid}/recap`, {}],
    ['相簿／回憶影片', `/trip/${ids.tid}/album`, {}],
    ['行程海報', `/trip/${ids.tid}/poster`, {}],
    ['天氣', `/trip/${ids.tid}/weather`, {}],
    ['緊急求助（行程內）', `/trip/${ids.tid}/sos`, {}],
    ['景點頁', `/trip/${ids.tid}/spot/${ids.sid}`, {}],
    ['任務詳情', `/quest/${ids.qid}`, {}],
  ]) await inspect(label, h, opt);

  // ---------- 3b. 等待中的畫面要有字 ----------
  // 長輩看到沒有說明的轉圈圈會以為當掉了就把 App 關掉 —— 而關掉的往往正是
  // 「再等三秒就好了」的那一次。v1.23 已經為 SOS 修過一次，這裡把它變成常設檢查。
  console.log('\n— 等待畫面有沒有說明 —');
  for (const [label, h] of [['天氣', `/trip/${ids.tid}/weather`], ['最終回顧', `/trip/${ids.tid}/recap`]]) {
    await page.evaluate(() => { location.hash = '#/__blank__'; });
    await sleep(150);
    await page.evaluate((x) => { location.hash = x; }, h);
    // 抓載入中那一瞬間
    let seen = null;
    for (let i = 0; i < 40 && seen === null; i++) {
      seen = await page.evaluate(() => {
        const sp = document.querySelector('#view .spinner');
        if (!sp) return null;
        return { hasText: !!document.querySelector('#view .wait-text'), text: (document.querySelector('#view .wait-text') || {}).textContent || '' };
      });
      if (seen === null) await sleep(60);
    }
    if (!seen) ok(`${label}：快到沒有出現載入畫面`);
    else if (!seen.hasText) bad(`${label}：載入中只有一顆轉圈圈，沒有任何文字`);
    else ok(`${label}：載入中有說明「${seen.text}」`);
    await page.waitForFunction(() => !document.querySelector('#view .spinner'), { timeout: 15000 }).catch(() => {});
  }

  // ---------- 4. 底部分頁每一顆真的按得動 ----------
  // v1.35 就是這裡整個壞掉：測試全綠，實際點下去回不了任務頁。
  console.log('\n— 底部分頁點擊矩陣 —');
  const TABS = [['任務', `#/trip/${ids.tid}`], ['照片', `#/trip/${ids.tid}/people`], ['分帳', `#/trip/${ids.tid}/expenses`], ['回顧', `#/trip/${ids.tid}/memories`]];
  for (const [fromLabel, fromHash] of [...TABS, ['景點頁', `#/trip/${ids.tid}/spot/${ids.sid}`], ['任務詳情', `#/quest/${ids.qid}`]]) {
    await page.evaluate((h) => { location.hash = h; }, fromHash);
    await sleep(900);
    for (const [toLabel, toHash] of TABS) {
      const clicked = await page.evaluate((t) => {
        const el = [...document.querySelectorAll('#tabbar a.tab')].find((a) => a.textContent.includes(t));
        if (!el) return false;
        el.click();
        return true;
      }, toLabel);
      await sleep(800);
      const now = await page.evaluate(() => ({ hash: location.hash, len: (document.getElementById('view').innerText || '').trim().length }));
      if (!clicked) bad(`分頁：${fromLabel} → ${toLabel} 找不到按鈕`);
      else if (now.hash !== toHash) bad(`分頁：${fromLabel} → ${toLabel} 網址不對（${now.hash}）`);
      else if (now.len < 8) bad(`分頁：${fromLabel} → ${toLabel} 畫面空白`);
      else pass++;
      await page.evaluate((h) => { location.hash = h; }, fromHash);
      await sleep(600);
    }
    ok(`分頁：從「${fromLabel}」四顆都切得過去且畫面正確`);
  }

  // ---------- 5. 字級：特大時不能破版 ----------
  console.log('\n— 特大字 —');
  await page.evaluate(async () => { (await import('./js/prefs.js')).setPref('fontScale', 'xl'); });
  await sleep(400);
  for (const [label, h] of [['行程頁', `/trip/${ids.tid}`], ['照片牆', `/trip/${ids.tid}/people`], ['分帳', `/trip/${ids.tid}/expenses`], ['設定', '/settings']]) {
    await inspect('特大字 · ' + label, h);
  }
  await page.evaluate(async () => { (await import('./js/prefs.js')).setPref('fontScale', 'm'); });

  // ---------- 6. 離線 ----------
  console.log('\n— 離線 —');
  await page.setOfflineMode(true);
  await inspect('離線 · 行程頁', `/trip/${ids.tid}`);
  await inspect('離線 · 照片牆', `/trip/${ids.tid}/people`);
  await inspect('離線 · 緊急求助', `/trip/${ids.tid}/sos`);
  await page.setOfflineMode(false);
  await page.waitForFunction(() => navigator.onLine, { timeout: 15000 });
  ok('離線後恢復連線正常');
} catch (e) {
  bad('巡檢中斷：' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n'));
} finally {
  await browser.close();
  if (web) web.kill();
}

console.log(`\n${pass} 項通過` + (problems.length ? `，${problems.length} 項有問題：\n` + problems.map((p) => '  · ' + p).join('\n') : ''));
