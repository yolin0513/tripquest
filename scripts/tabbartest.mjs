// 旅程層的底部分頁（主頁／任務／行程／照片／分帳；行程 2026-11-13 加；主頁 v1.84.0 加、回顧 v1.84.0 搬進行程分頁）的底部功能列位置一致（npm run tabbartest）
//
// 使用者實機回報：分帳頁的底部功能列位置跟其他三頁不同、會上移。
//
// 自動化量下來四頁的 #tabbar 都是 fixed / bottom:0 / top=768 —— 完全一樣，
// 所以無頭瀏覽器重現不出來。最可能的原因是**內容高度**：
// 內容比畫面短的分頁不能捲，iOS Safari 的瀏覽器工具列就不會收起來，
// 固定在底部的功能列看起來因此高一截。這支測兩件事：
//   ① 四頁的底部列位置完全一致
//   ② **每一頁都至少一個畫面高**，四頁的捲動特性才一樣（包含空資料的狀態）
// 順便釘住：每一個 view 的根節點都要是 .page（少了它就沒有底部留白）。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5441;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
// 不打真網路（共用慣例 §5.6；v1.87.0 補上）：外站一律當場回 503，記下是哪幾個主機（結尾印出來）。
// 這支 v1.86.0 撞過一次「換個螢幕高度」那段等 #view .page 逾時（之後三次都過、根因沒找到）；外站是變因之一，先拿掉。
const ORIGIN = `http://localhost:${WEB}`;
const ext = new Map();
await page.setRequestInterception(true);
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith(ORIGIN) || !/^https?:/.test(u)) return r.continue();
  const host = new URL(u).hostname;
  ext.set(host, (ext.get(host) || 0) + 1);
  return r.respond({ status: 503, contentType: 'text/plain', body: '' });
});
// 等不到 #view .page 時印出當下的樣子（網址、載入狀態、#view 裡有什麼、有沒有 SW 在控制、對話框、更新列）——
// 根因沒找到，下一次撞到要有現場可以看，不能只剩一句逾時。照樣算失敗（不重試、不吞掉）。
const scene = () => page.evaluate(() => {
  const v = document.getElementById('view');
  return {
    hash: location.hash.replace(/[0-9a-f-]{20,}/g, '…'), ready: document.readyState,
    view: v ? { n: v.childElementCount, first: v.firstElementChild ? `${v.firstElementChild.tagName}.${v.firstElementChild.className}` : '（空）', len: v.innerHTML.length } : '沒有 #view',
    sw: navigator.serviceWorker ? !!navigator.serviceWorker.controller : '不支援',
    modal: document.getElementById('modalRoot')?.childElementCount || 0, updateBar: !!document.getElementById('updateBar'),
  };
}).catch((e) => `讀不到（${e.message}）`);

const measure = async (hash) => {
  await page.goto('about:blank');
  await page.goto(`${ORIGIN}/${hash}`, { waitUntil: 'networkidle0' });
  try {
    await page.waitForSelector('#view .page', { timeout: 20000 });
  } catch (e) {
    console.log(`  [等不到 #view .page] ${hash.replace(/[0-9a-f-]{20,}/g, '…')}｜現場：${JSON.stringify(await scene())}｜外站：${JSON.stringify([...ext])}`);
    throw e;
  }
  await sleep(900);
  return page.evaluate(() => {
    const tb = document.getElementById('tabbar');
    const r = tb.getBoundingClientRect();
    const root = document.querySelector('#view > *');
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
      rootIsPage: !!root && root.classList.contains('page'),
      rootClass: root ? root.className : '(無)',
      pageH: Math.round(document.documentElement.scrollHeight),
      vh: window.innerHeight,
      visible: getComputedStyle(tb).display !== 'none',
    };
  });
};

try {
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 兩種資料量：一種有內容、一種幾乎空的（空的那種最容易比畫面矮）
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const g = uuid(), full = uuid(), bare = uuid(), m1 = uuid(), m2 = uuid();
    await s.put({ id: g, type: 'group', name: 'g' });
    await s.put({ id: m1, type: 'member', groupId: g, displayName: '阿公' });
    await s.put({ id: m2, type: 'member', groupId: g, displayName: '小美' });
    await s.put({ id: full, type: 'trip', groupId: g, title: '有內容', region: '宜蘭', allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: full, region: '宜蘭', items: [{ name: '羅東夜市', day: 1 }] });
    for (const x of spots) await s.put(x);
    for (const x of quests) await s.put(x);
    await s.put({ id: uuid(), type: 'expense', tripId: full, groupId: g, amount: 1200, currency: 'TWD', payerId: m1, participants: [m1, m2], category: 'food', note: '晚餐' });
    // 幾乎空的一趟：沒有景點、沒有花費
    await s.put({ id: bare, type: 'trip', groupId: g, title: '空的', region: '宜蘭', allowWiki: false });
    return { full, bare };
  });

  for (const [label, tid] of [['有內容的行程', ids.full], ['幾乎空的行程', ids.bare]]) {
    console.log(`\n— ${label} —`);
    // v1.84.0：「回顧」不再是底部分頁（搬進行程分頁）；最前面多一格「主頁」
    const tabs = [
      ['主頁', `#/trip/${tid}/home`],
      ['任務', `#/trip/${tid}`], ['行程', `#/trip/${tid}/itinerary`], ['照片', `#/trip/${tid}/people`],
      ['分帳', `#/trip/${tid}/expenses`],
    ];
    const got = [];
    for (const [name, hash] of tabs) {
      const m = await measure(hash);
      got.push([name, m]);
      yes(m.rootIsPage, `${name}：根節點是 .page（有底部留白）`, `class="${m.rootClass}"`);
      yes(m.pageH >= m.vh - 2,
        `${name}：頁面至少一個畫面高（${m.pageH}px ≥ ${m.vh}px）`,
        `只有 ${m.pageH}px，會捲不動 → iOS 的瀏覽器工具列不收起來，底部列看起來就高一截`);
    }
    const tops = got.map(([, m]) => m.top);
    const same = tops.every((x) => x === tops[0]);
    yes(same, `${tabs.length} 個分頁的底部列位置完全一致（top=${tops[0]}）`, JSON.stringify(got.map(([n, m]) => n + ':' + m.top)));
    const bottoms = got.map(([, m]) => m.bottom);
    yes(bottoms.every((x) => x === got[0][1].vh), `${tabs.length} 個分頁的底部列都貼齊畫面底部（bottom=${bottoms[0]}）`);
  }

  // 換個機型高度也要一致
  console.log('\n— 換個螢幕高度 —');
  for (const [w, hgt] of [[360, 640], [430, 932]]) {
    await page.setViewport({ width: w, height: hgt });
    const tops = [];
    const hashes = [`#/trip/${ids.full}/home`, `#/trip/${ids.full}`, `#/trip/${ids.full}/itinerary`, `#/trip/${ids.full}/people`, `#/trip/${ids.full}/expenses`];
    for (const hash of hashes) {
      const m = await measure(hash);
      tops.push(m.top);
    }
    yes(tops.every((x) => x === tops[0]), `${w}×${hgt}：${hashes.length} 個分頁仍然一致（top=${tops[0]}）`, JSON.stringify(tops));
  }

  console.log('\n底部功能列測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
// 說明行（不是判定）：攔下了哪些外站請求；0 次也照實印
console.log(`・外站請求一律當場回 503、沒有放出去：${[...ext].map(([h, n]) => `${h}×${n}`).join('、') || '這一輪 0 次'}`);
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
