// 空狀態的按鈕會不會把人帶到它自己說的地方（npm run emptytest，v1.62）
//
// 使用者實機踩到：照片牆沒照片時顯示「回任務清單」，點下去卻到了分帳頁。
// 原因是那顆按鈕用 back()（回上一頁），而使用者是從分帳分頁切過來的。
// 這支測試把「按鈕文字說的目的地」與「實際導向」綁在一起，讓同類錯誤不會再溜過去。
//
// 做法：每個空狀態都**從別的分頁切過去**（製造 history 有前一頁的情境），
// 再點按鈕、斷言網址。只驗按鈕存在是抓不到這個 bug 的。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5671;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1500);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // 一個「什麼都沒有」的行程：沒有照片、沒有旅伴、沒有花費、沒有座標
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid(), sid = uuid(), tidEmpty = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭行', region: '宜蘭', allowWiki: false });
    await s.put({ id: sid, type: 'spot', tripId: tid, name: '羅東夜市', emoji: '🏮', day: 1, order: 0 });
    await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: '拍一張', kind: 'thing', order: 0 });
    // 另一個連景點都沒有的行程
    await s.put({ id: tidEmpty, type: 'trip', groupId: gid, title: '還沒安排', region: '宜蘭', allowWiki: false });
    return { gid, tid, tidEmpty };
  });

  const go = async (hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await sleep(700);
  };
  // 從別的分頁切過去 → 製造「上一頁不是目的地」的情境（這才抓得到 back() 的 bug）
  const viaAnotherTab = async (from, to) => { await go(from); await go(to); };
  const clickText = async (txt) => {
    const hit = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('.empty button, .page > button')].find((x) => x.textContent.includes(t));
      if (!b) return false;
      b.click();
      return true;
    }, txt);
    await sleep(800);
    return hit;
  };
  const hash = () => page.evaluate(() => location.hash);

  // ---------- 照片牆：沒有照片（使用者回報的那一個） ----------
  console.log('\n— 照片牆（沒有照片）—');
  await viaAnotherTab(`#/trip/${ids.tid}/expenses`, `#/trip/${ids.tid}/people`);
  const label = await page.evaluate(() => document.querySelector('.empty button')?.textContent || '');
  yes(label.includes('任務'), `空狀態按鈕是「${label}」`);
  yes(await clickText('回任務清單'), '按鈕可以按');
  const h1 = await hash();
  yes(h1 === `#/trip/${ids.tid}`,
    `「回任務清單」→ 真的到任務頁（${h1.replace(ids.tid, '…')}）—— 從分帳切過來也一樣`);

  // ---------- 行程頁：沒有景點 ----------
  console.log('\n— 其他空狀態 —');
  await viaAnotherTab(`#/trip/${ids.tidEmpty}/people`, `#/trip/${ids.tidEmpty}`);
  yes(await clickText('去安排景點'), '行程頁沒有景點時有「＋ 去安排景點」');
  yes((await hash()) === `#/trip/${ids.tidEmpty}/plan`, '「去安排景點」→ 行程安排頁');

  // ---------- 分帳：沒有旅伴 ----------
  await viaAnotherTab(`#/trip/${ids.tid}/people`, `#/trip/${ids.tid}/expenses`);
  yes(await clickText('去旅程設定加旅伴'), '分帳沒有旅伴時有「去旅程設定加旅伴」');
  yes((await hash()) === `#/trip/${ids.tid}/settings`, '「去旅程設定加旅伴」→ 旅程設定頁');

  // ---------- 行程安排頁：「完成，回旅程」 ----------
  await viaAnotherTab(`#/trip/${ids.tid}/expenses`, `#/trip/${ids.tid}/plan`);
  const planClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('完成，回旅程'));
    if (!b) return false; b.click(); return true;
  });
  await sleep(800);
  yes(planClicked, '行程安排頁有「完成，回旅程」');
  yes((await hash()) === `#/trip/${ids.tid}`, '「完成，回旅程」→ 真的回旅程頁（不是回上一頁的分帳）');

  // ---------- 首頁：沒有旅程 ----------
  await page.evaluate(async () => {
    const s = await import('./js/store.js'); const db = await import('./js/db.js');
    for (const r of s.exportRecords({ all: true })) await db.deleteRecordHard(r.id);
    location.hash = '#/';
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);
  const homeBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('開一個新旅程') || x.textContent.includes('建立'));
    if (!b) return null; b.click(); return b.textContent.trim();
  });
  await sleep(800);
  yes(homeBtn && (await hash()).startsWith('#/new'), `首頁沒有旅程時的「${homeBtn}」→ 新增旅程頁`);

  // ---------- 原始碼守衛：標了目的地的按鈕不准用 back() ----------
  //
  // v1.73.3：這個檢查器以前只認得**一種**寫法（單引號標籤、緊接在 onclick 後面），
  // 而它掃的 11 個檔案裡總共只有 1 個 `back(`、正則命中 0 次 —— 也就是說它從上線到
  // 現在沒有檢查過任何東西，卻每次都印一個 ✓。餵 6 種真實可能的寫法給它只抓得到 2 種。
  //
  // 兩件事一起修：(1) 認得雙引號、樣板字串、方法簡寫、標籤前有子節點；
  // (2) 加**對照組** —— 把已知該被抓到的寫法餵進同一個檢查器，斷言它真的抓得到。
  // 沒有對照組的話，「檢查器壞掉」與「程式碼是乾淨的」在畫面上長得一模一樣。
  console.log('\n— 原始碼守衛 —');
  const VIEWS = ['people.js', 'plan.js', 'trip.js', 'expenses.js', 'home.js', 'memories.js',
    'album.js', 'weather.js', 'badges.js', 'recap.js', 'poster.js'];
  // 找出每一處 back(…) 呼叫，取它後面那一段，裡面**每一個**字串都檢查。
  // 不要用「back 之後第一個引號字串」—— 標籤前面可能還有子節點
  //（`h('span', {}, '⟵'), '回旅程頁'`），那樣只會抓到 'span' 就停了。
  const BACK = /\bback\s*\(/g;
  const STR = /['"\x60]([^'"\x60\n]*)['"\x60]/g;
  const DEST = /回[^」]*(旅程|任務|清單|首頁|頁)/;
  const scan = (src, tag) => {
    const hits = [];
    for (const m of src.matchAll(BACK)) {
      // 註解裡的 back( 不算（people.js 那個唯一的 back( 就在註解裡）
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue;
      const tail = src.slice(m.index, m.index + 240);
      for (const t of tail.matchAll(STR)) if (DEST.test(t[1])) hits.push(`${tag}: 「${t[1]}」`);
    }
    return hits;
  };

  // 對照組：這六種寫法都該被抓到。抓不到就是檢查器壞了，不是程式碼乾淨。
  const CONTROL = [
    `h('button', { onclick: () => back() }, '回旅程')`,
    `h('button', { onclick: () => back() }, "回任務清單")`,
    'h(\'button\', { onclick: () => back() }, `回首頁`)',
    `h('button', { class: 'x', onclick: () => back(1) }, h('span', {}, '⟵'), '回旅程頁')`,
    `h('button', { onclick() { back(); } }, '回清單')`,
    `h('button', { onclick: () => back() }, '回上一頁')`,
  ];
  const missed = CONTROL.filter((c, i) => !scan(c, 'c' + i).length);
  yes(missed.length === 0,
    `檢查器本身有效：${CONTROL.length} 種已知該被抓到的寫法全部抓得到`,
    '抓不到：' + missed.join(' ｜ '));

  const bad = [];
  for (const f of VIEWS) bad.push(...scan(await readFile(ROOT + 'js/views/' + f, 'utf8'), f));
  yes(bad.length === 0, `沒有「文字說了目的地、實作卻用 back()」的按鈕（掃了 ${VIEWS.length} 個 view）`, bad.join('；'));

  console.log('\n空狀態導覽測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
