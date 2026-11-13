// 吉祥物融進介面：從卡片／照片的上緣探頭（2026-11-13 第四段之二）從使用者的入口驗（npm run peektest；會開瀏覽器）
//
// 涵蓋的程式：js/peeks.js、js/addphoto.js（完成任務挑哪一張）、js/ui.js（celebrate 的照片＋探頭圖）、
//   js/weather.js（isSnowDay／isRainDay／dayAlert）、js/views/trip.js（天氣條的提示句、主頁下一站卡沒有拍照鈕）、
//   js/views/weather.js（出門提醒卡）、css/style.css（.gl-peek、.wx-strip、.wx-advice、.celebrate-shot）
// 圖本身有沒有鋪滿畫布的底色，另一支量（scripts/arttransparenttest.mjs）。
//
// Yolin 2026-11-13：「我要的吉祥物整合是像這樣，角色融入到按鍵或畫面裡，不是像現在角色站在文字旁邊，甚至沒有去背」。
// 所以這支驗的是「融進去」本身——不是「有一張圖」：
//   - 邊線對齊：探頭圖的邊線（畫布裡的 y，CSS 的 --pk-sink）落在那張卡片／照片的上緣（差 ≤ 1.5px）
//   - 是那個元素的一部分：探頭圖是出門提醒卡／照片外框的子元素
//   - 不站在字旁邊：提示那一行只有字（沒有圖）；慶祝畫面標題上面不再另外放一隻吉祥物
// Yolin 看了截圖（2026-11-13）：任務頁東西一多，任務就被擠到下面——**天氣條不掛探頭圖、也不加高**，
//   只換成有數字的那一句；探頭圖只在天氣頁的出門提醒卡與完成任務的照片上。所以天氣條驗的是「沒有圖、上面的間距跟晴天一樣」。
//   v1.84.0 起天氣條在主頁（點旅程卡先到主頁）；完成任務要先點底部分頁「任務」（pickRow 自己會過去）。
//
// 不打真網路（共用慣例 §5.6）：Open-Meteo 的請求由本測試回一份自己造的預報（16 天、從今天起，哪天下雨／下雪由各情境指定）；
// 其餘外站一律當場回 503。定位：瀏覽器給一個合成的座標。每個情境前清掉天氣快取（localStorage 'tripquest.wx'，3 小時），
// 再從底部分頁回首頁、點旅程卡進去——天氣條每次重查。
//
//   P1 今天會下雨：天氣條提示那一行是有數字的那一句、只有字；天氣條裡沒有探頭圖；點天氣條 → 天氣頁
//   P2 天氣頁：出門提醒卡上緣是鬍鬍撐傘探頭（邊線對齊）；清單裡每一條照舊只有字和前面的小圖
//   P3 完成任務（任務列「從相簿選」一張照片）：吉祥物從照片上緣探頭（邊線對齊照片上緣、整張在畫面裡、標題上面沒有另一隻）——
//      必吃 → 捧麵；夜市的其他任務 → 烤串；自然 → 遮陽帽；城市 → 相機；古蹟（沒有對得上的類別）→ 小鳳打領結
//   P4 今天會下雪：天氣條是下雪那一句、沒有探頭圖；天氣頁的卡片是湯圓踩雪板；會下雪的那天不再算下雨
//   P5 晴天（反向）：天氣條、天氣頁都沒有探頭圖，照舊那一句；下雨那天的天氣條上面的間距跟晴天一樣（沒有加高）
//   P6 還沒出發、出發那天會下雨：「出發那天（M/D）可能下雨…」、天氣條沒有探頭圖
//   P7 主頁的下一站卡沒有「拍照解任務」（v1.84.0；原本驗那顆鈕的相機圖示，鈕拿掉後改驗它不在）
//   P8 每一張探頭圖：aria-hidden、沒有 <text>／<title>、id 整頁唯一、引用都指到自己那張；同一頁放好幾張時 id 也不撞
//   主題：和紙不套白邊、動作線看得到；深色一輪白邊真的有套上、動作線不畫（跟 glyphs.js 的吉祥物同一條規矩）、
//         白邊濾鏡的範圍罩得住每一層（不然白邊被切成直角，照片上多一塊白色方塊）、
//         提醒卡與照片的邊線一樣對齊、天氣條一樣沒有探頭圖、主頁一樣沒有拍照鈕
//   動畫（v1.83.0 起；js/peeks.js 的 cheer()、css/style.css 的 .pk-cheer）：完成任務那一刻小鳳打領結那張從照片後面跳上來、揮翅膀——
//     和紙那輪 P3 的「古蹟 → 小鳳打領結」：慶祝畫面一出來就量（隔 150ms 量兩次位置不一樣＝有動）；每一段動畫的 keyframes 只動 transform、opacity；
//     等每一段都結束，身體、翅膀沒有殘留的位移（框跟撤掉動畫的靜止圖一樣）、扣在照片上的手與揮動線都完全看得到（不會卡在半空）
//     減少動態效果那輪：設定頁的開關、系統設定（瀏覽器模擬 prefers-reduced-motion）各完成一個任務——照舊探頭（靜止圖）、0 段動畫
//   動畫（v1.85.0 推廣；Yolin：「效果不錯，推廣到其他時刻」）：P3 的另外四張（捧麵蒸氣、烤串晃兩下、遮陽帽揮兩下、相機閃一下）、
//     P2 天氣頁下雨（慢慢探上來、傘輕晃）、P4 下雪（慢慢探上來、雪板左右滑），每一張：有動且會動的層跟登記的一樣、
//     跳之前整隻藏在卡片／照片後面（動畫倒回第 0 格量）、只用 transform／opacity、動完停在靜止圖的位置；「兩下」的那兩張數擺了幾次
//     （小鳳打領結也補「跳之前藏在後面」——起跳點從寫死的 176 改成照每一張的高度算）
// 沒涵蓋（寫明）：慶祝時縮圖讀不到（沒有照片）→ 照舊在標題上面放整隻小鳳——使用者的路造不出「照片存好了、縮圖讀不到」。
//   減少動態效果那輪只完成任務、沒有再開天氣頁：天氣頁、主頁卡片呼叫的是同一個 cheer()，第一行就是同一個判斷（glyphs.js 的 reducedMotion，
//     全身吉祥物的 moveMascot 也用它；mascottest 深色那輪開著減少動態效果驗那四隻不動）。
//   主頁「旅程結束了／任務全部完成了」那張卡的探頭圖由 hometest 驗；全身吉祥物（空白頁、載入中、回顧、解鎖新徽章）由 mascottest 驗。
//   慶祝畫面自己那 0.2 秒淡入跟小鳳的動畫同時開始，前 0.2 秒小鳳是半透明的——那是 .celebrate 的動畫，不在這支量。
//
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5823;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const soft = (p) => p.then(() => true, () => false);   // 等不到記成 false，不丟例外
// 導覽用的點擊：點不到（clickText 會丟例外點名）記成 false、照樣往下跑，由後面的斷言記 ✗
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });

// 一張真的 1×1 PNG，走完整的加照片流程（同 mascottest）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photoPath = join(mkdtempSync(join(tmpdir(), 'tq-peek-')), 'p.png');
writeFileSync(photoPath, PNG);

const GPS = { latitude: 23.456789, longitude: 120.987654, accuracy: 10 };   // 合成的定位
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const md = (s) => { const p = s.split('-'); return `${+p[1]}/${+p[2]}`; };

// 造一份 Open-Meteo 預報：wet＝{ 第幾天（今天＝0）: 'rain'｜'snow' }，其餘晴、22／16 度
// 下雪那天：降雨機率也有 70、雨量 3 毫米——照「下雪優先」不該再算成下雨（P4 驗）；最低 -3 度 → 會有「會冷」的提醒
function fakeForecast(wet) {
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [],
    precipitation_probability_max: [], snowfall_sum: [], wind_speed_10m_max: [] };
  for (let i = 0; i < 16; i++) {
    const w = wet[i];
    daily.time.push(plus(i));
    daily.weather_code.push(w === 'rain' ? 63 : w === 'snow' ? 73 : 1);
    daily.temperature_2m_max.push(w === 'snow' ? 2 : 22);
    daily.temperature_2m_min.push(w === 'snow' ? -3 : 16);
    daily.precipitation_sum.push(w === 'rain' ? 12 : w === 'snow' ? 3 : 0);
    daily.precipitation_probability_max.push(w === 'rain' ? 80 : w === 'snow' ? 70 : 10);
    daily.snowfall_sum.push(w === 'snow' ? 3.5 : 0);
    daily.wind_speed_10m_max.push(10);
  }
  return { elevation: 40, timezone: 'Asia/Taipei', current: { temperature_2m: 20, weather_code: 1 }, daily };
}

// 量一張探頭圖跟它的「卡片」：host＝卡片（或照片）的選擇器；圖是 host 裡（或 host 的兄弟裡）的 svg.gl-peek
//   edgeGap：圖的邊線（圖底往上 --pk-sink px）跟卡片上緣差幾 px；child：圖是不是卡片的子孫；inView：整張在畫面裡
const probe = (page, hostSel, peekSel) => page.evaluate((hs, ps) => {
  const host = document.querySelector(hs), el = document.querySelector(ps);
  if (!host || !el) return { found: false, host: !!host };
  host.scrollIntoView({ block: 'center' });
  const hr = host.getBoundingClientRect(), r = el.getBoundingClientRect();
  const sink = parseFloat(getComputedStyle(el).getPropertyValue('--pk-sink'));
  const ids = [...el.querySelectorAll('[id]')].map((x) => x.id);
  const dupIds = ids.filter((id) => document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length !== 1);
  const refs = [...el.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  const strayRefs = refs.filter((id) => !el.querySelector(`[id="${CSS.escape(id)}"]`));
  const fig = el.querySelector('.mc-fig');
  // 吉祥物露出來的那一塊不能壓到上一個區塊：卡片（沒有的話往外一層一層找）的上一個兄弟元素的底
  let a = host;
  while (a && !a.previousElementSibling && a.parentElement) a = a.parentElement;
  const prev = a && a.previousElementSibling;
  const prevBottom = prev ? prev.getBoundingClientRect().bottom : null;
  return {
    clear: prevBottom == null ? null : r.top >= prevBottom - 1, prevName: prev ? (prev.className || prev.tagName) : null,
    found: true, kind: el.getAttribute('data-peek'), w: Math.round(r.width), h: Math.round(r.height),
    edgeGap: Number.isFinite(sink) ? +(r.bottom - sink - hr.top).toFixed(2) : null, sink,
    above: Math.round(hr.top - r.top), child: host.contains(el),
    inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.width > 0,
    aria: el.getAttribute('aria-hidden'), texty: el.querySelectorAll('text, title').length,
    ids: ids.length, dupIds, refs: refs.length, strayRefs, onPage: document.querySelectorAll('svg.gl-peek').length,
    filter: fig ? getComputedStyle(fig).filter : null,
    // 動作線、蒸氣、閃光那一層：沒有這一層＝null；有的話看不看得到（和紙要看得到、深色不畫）
    extra: (() => { const g = el.querySelector('.mc-extra'); return g ? getComputedStyle(g).display !== 'none' && g.getBoundingClientRect().width > 0 : null; })(),
  };
}, hostSel, peekSel);
const brief = (p) => (p.found ? `${p.kind}，${p.w}×${p.h}，邊線差 ${p.edgeGap}px，露出卡片上緣 ${p.above}px` : `沒找到${p.host === false ? '（卡片也不在）' : ''}`);
const aligned = (p) => p.found && p.edgeGap != null && Math.abs(p.edgeGap) <= 1.5 && p.above >= 20;

// P8：圖不在時欄位是 undefined，訊息裡不能直接 .join（丟例外就少印後面的項）
function hygiene(where, p, minOnPage = 1) {
  const dup = p.dupIds || [], stray = p.strayRefs || [];
  yes(p.found && p.aria === 'true' && p.texty === 0 && p.refs > 0 && dup.length === 0 && stray.length === 0 && p.onPage >= minOnPage,
    `P8 ${where}：aria-hidden、沒有 <text>／<title>、${p.ids} 個 id 整頁唯一、${p.refs} 個引用都指到自己那張（整頁 ${p.onPage} 張探頭圖；aria=${p.aria}、文字元素 ${p.texty}；重複 ${dup.join('、') || '無'}；指到外面 ${stray.join('、') || '無'}）`);
}

// 天氣條：提示那一行（字、裡面有沒有圖）＋整條按鈕上有沒有探頭圖＋上面的間距
//   gap：天氣條上緣到上一個區塊（天氣條那一格 .wx-slot 的上一個兄弟元素）的底，幾 px——掛探頭圖時這裡會多留圖的高度
const strip = (page) => page.evaluate(() => {
  const btn = document.querySelector('.wx-strip'), tip = btn && btn.querySelector('.wx-strip-tip');
  const slot = btn && btn.closest('.wx-slot'), prev = slot && slot.previousElementSibling;
  return { has: !!tip, alert: tip ? tip.getAttribute('data-wx') : null, txt: tip ? tip.textContent.trim() : '',
    tipImgs: tip ? tip.querySelectorAll('svg, img').length : null, peeks: document.querySelectorAll('.wx-strip svg.gl-peek').length,
    hostMark: btn ? btn.classList.contains('has-peek') : null,
    gap: btn && prev ? Math.round(btn.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : null,
    prevName: prev ? (prev.className || prev.tagName) : null,
    scenes: document.querySelectorAll('svg.gl-scene').length };
});
const noPeek = (s) => s.has && s.peeks === 0 && s.hostMark === false;

// 回首頁。人已經在首頁時按「我的旅程」不會重畫——測試用程式造的行程就不會出現，所以先到「設定」再回來。
// 旅程頁、天氣頁沒有「我的旅程」分頁：先按頁首的返回鍵（最多 3 下）。
async function toHome(page) {
  for (let k = 0; k < 3; k++) {
    const where = await page.evaluate(() => location.hash);
    if (where === '#/' || where === '' || where === '#/settings') break;
    const hit = await userClick(page, await page.$('#backBtn'), '頁首的返回鍵');
    if (!hit.ok) { console.log('  [點不到]', hit.why); break; }
    await soft(page.waitForFunction((w) => location.hash !== w, { timeout: 10000 }, where));
    await sleep(300);
  }
  if (await page.evaluate(() => location.hash === '#/' || location.hash === '')) {
    await tap(page, 'a.tab', '設定');
    await soft(page.waitForFunction(() => location.hash === '#/settings', { timeout: 15000 }));
  }
  if (!await tap(page, 'a.tab', '我的旅程')) return false;
  const ok = await soft(page.waitForFunction(() => (location.hash === '#/' || location.hash === '') && document.querySelector('.trip-card'), { timeout: 15000 }));
  if (!ok) console.log('  [回不到首頁或沒有旅程卡]');
  return ok;
}
// 清掉天氣快取 → 首頁 → 點旅程卡 → 等天氣條出來
async function openTrip(page, title) {
  await page.evaluate(() => localStorage.removeItem('tripquest.wx'));
  if (!await toHome(page)) return false;
  if (!await tap(page, '.trip-card', title)) return false;
  const ok = await soft(page.waitForSelector('.wx-strip .wx-strip-tip', { timeout: 20000 }));
  if (!ok) console.log(`  [等不到天氣條] 「${title}」`);
  return ok;
}
// 點天氣條（點的是字那一塊）→ 天氣頁的提醒卡出來
async function openWeather(page) {
  if (!await tap(page, '.wx-strip', '')) return false;
  return soft(page.waitForSelector('.wx-advice', { timeout: 20000 }));
}

// 加完照片會連續跳「完成一個任務」＋新徽章各一次慶祝，全部按掉才會回到頁面（同 mascottest）
async function clearCelebrations(page, max = 10) {
  for (let k = 0; k < max; k++) {
    if (!await page.$('.celebrate')) break;
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.celebrate .btn')];
      (btns.find((b) => /繼續|太棒/.test(b.textContent)) || btns[0])?.click();
    });
    await sleep(350);
  }
}

// 那一站展開，挑一列還沒完成的任務：must＝true 挑「必吃」那列、false 挑不是必吃的、null 任一列
// v1.84.0 起點旅程卡先到主頁：不在任務頁就點底部分頁「任務」過去（使用者的路）
async function pickRow(page, spot, must) {
  if (!await page.$('.qcollapse')) {
    if (!await tap(page, '#tabbar a.tab', '任務')) return null;
    if (!await soft(page.waitForSelector('.qcollapse', { timeout: 15000 }))) return null;
  }
  const isOpen = (n) => [...document.querySelectorAll('.qcollapse.open .qc-toggle')].some((b) => b.textContent.includes(n));
  if (!await page.evaluate(isOpen, spot)) await tap(page, '.qc-toggle', spot);
  if (!await soft(page.waitForFunction(isOpen, { timeout: 8000 }, spot))) return null;
  return page.evaluate((n, m) => {
    const c = [...document.querySelectorAll('.qcollapse.open')].find((x) => x.querySelector('.qc-toggle')?.textContent.includes(n));
    const r = c && [...c.querySelectorAll('.qline:not(.done)')].find((x) => {
      const t = x.querySelector('.qline-title')?.textContent || '';
      return m === null ? true : m ? t.startsWith('必吃') : !t.startsWith('必吃');
    });
    return r ? { id: r.dataset.quest, title: r.querySelector('.qline-title').textContent } : null;
  }, spot, must);
}

// 動畫（v1.83.0 只有小鳳打領結；v1.85.0 七張都會動）：畫面一出來就量。圖上每一段動畫的名字、狀態、keyframes 用到的屬性；
// 隔 150ms 取兩次會動的那幾層的 transform／opacity，看有沒有變。會動的層（js/peeks.js 的 cheer() 包的）：
//   身體 .pk-hop；轉／滑的零件 .pk-wave（翅膀）、.pk-wave-r（右手）、.pk-sway（烤串）、.pk-tilt（雨傘）、.pk-slide（雪板）；
//   只動透明度的 .pk-grip（扣在卡片／照片上的手）、.pk-wave-lines（揮動線）、.pk-steam（蒸氣）、.pk-flash（閃光）
// 跳之前：把每一段動畫倒回 0，量邊線以上那層的內容是不是整個在邊線下面（＝藏在卡片／照片後面）；量完照常往下播。
const PEEK_SEL = '.celebrate .celebrate-shot svg.gl-peek';
const KF_META = ['offset', 'computedOffset', 'easing', 'composite'];   // getKeyframes() 每一格都帶的欄位，不是被動畫的屬性
const LAYER_CLS = ['pk-hop', 'pk-wave', 'pk-wave-r', 'pk-sway', 'pk-tilt', 'pk-slide', 'pk-grip', 'pk-wave-lines', 'pk-steam', 'pk-flash'];
const PART_SEL = '.pk-wave, .pk-wave-r, .pk-sway, .pk-tilt, .pk-slide';
const FADE_SEL = '.pk-grip, .pk-wave-lines, .pk-steam, .pk-flash';
const animNow = (page, ps = PEEK_SEL) => page.evaluate(async (ps, meta, cls) => {
  const el = document.querySelector(ps);
  if (!el) return { found: false };
  const sel = cls.map((c) => '.' + c).join(', ');
  const layers = () => [...el.querySelectorAll(sel)]
    .map((x) => { const s = getComputedStyle(x); return `${x.getAttribute('class')}:${s.transform}|${s.opacity}`; }).join(';');
  const anims = el.getAnimations({ subtree: true });
  const props = [...new Set(anims.flatMap((a) => (a.effect?.getKeyframes?.() || []).flatMap((k) => Object.keys(k).filter((p) => !meta.includes(p)))))];
  const s1 = layers();
  await new Promise((r) => setTimeout(r, 150));
  const s2 = layers();
  const count = {};
  for (const c of cls) count[c] = el.querySelectorAll('.' + c).length;
  let hidden = null, topGap = null;
  const hop = el.querySelector('.pk-hop');
  if (hop && anims.length) {
    const was = anims.map((a) => a.currentTime);   // 量完放回原本播到的那一格接著播（不是從頭重播）
    for (const a of anims) { a.pause(); a.currentTime = 0; }
    const edgeY = el.getBoundingClientRect().bottom - parseFloat(el.style.getPropertyValue('--pk-sink'));
    const top = hop.getBoundingClientRect().top;
    topGap = Math.round((top - edgeY) * 10) / 10;
    hidden = Number.isFinite(topGap) && top >= edgeY - 0.5;
    anims.forEach((a, i) => { a.currentTime = was[i]; a.play(); });
  }
  return {
    found: true, kind: el.getAttribute('data-peek'), cheer: el.classList.contains('pk-cheer'), soft: el.classList.contains('pk-soft'),
    n: anims.length, running: anims.filter((a) => a.playState === 'running').length, names: anims.map((a) => a.animationName || '?'),
    props, moved: s1 !== '' && s1 !== s2, count, hidden, topGap,
    layers: { hop: count['pk-hop'], wave: count['pk-wave'], grip: count['pk-grip'], lines: count['pk-wave-lines'] },
  };
}, ps, KF_META, LAYER_CLS);
// 動完：等圖上每一段動畫都結束（最多 6 秒），量會動的那幾層停在哪；
// 再拿掉 pk-cheer（動畫整個撤掉＝靜止圖）量一次——兩次要一樣，才算停在靜止圖的位置、沒卡在半空。
// 比的是位置矩陣（getScreenCTM），不是框：身體那層包著翅膀，比框的話翅膀沒轉回來身體的框也跟著變、身體沒落定翅膀的框也跟著移，
// 一條突變會弄紅兩條、分不出是哪一層。所以身體比它自己的矩陣，零件（翅膀、手、烤串、傘、雪板）比「相對於身體」的矩陣。
// swing：結束之後再把動畫一格一格倒回去（每 20ms）讀那個零件的角度或位移，數「往同一邊擺到底」幾次（揮兩下＝2），讀完放回結束的那一格。
const animEnd = (page, ps = PEEK_SEL, swingSel = null) => page.evaluate(async (ps, partSel, fadeSel, swingSel) => {
  const el = document.querySelector(ps);
  if (!el) return { found: false };
  const anims = el.getAnimations({ subtree: true });
  const done = await Promise.race([
    Promise.all(anims.map((a) => a.finished)).then(() => anims.length > 0, () => false),
    new Promise((r) => setTimeout(() => r(false), 6000)),
  ]);
  const ident = (t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
  const css = (sel, k) => [...el.querySelectorAll(sel)].map((x) => getComputedStyle(x)[k]);
  const hopT = css('.pk-hop', 'transform'), waveT = css('.pk-wave', 'transform'), partT = css(partSel, 'transform');
  const gripO = css('.pk-grip', 'opacity'), linesO = css('.pk-wave-lines', 'opacity'), fadeO = css(fadeSel, 'opacity');
  const hop = el.querySelector('.pk-hop'), waves = [...el.querySelectorAll('.pk-wave')], parts = [...el.querySelectorAll(partSel)];
  const six = (m) => [m.a, m.b, m.c, m.d, m.e, m.f];
  const ctm = () => {
    const h = hop ? hop.getScreenCTM() : null;
    const rel = (xs) => (h ? xs.map((w) => six(h.inverse().multiply(w.getScreenCTM()))) : []);
    return { hop: h ? six(h) : null, waves: rel(waves), parts: rel(parts) };
  };
  let swings = null, peak = null;
  const sx = swingSel ? el.querySelector(swingSel) : null;
  if (sx && done) {
    const end = Math.max(...anims.map((a) => a.effect.getComputedTiming().endTime));
    const vals = [];
    for (let t = 0; t <= end; t += 20) {
      for (const a of anims) { a.pause(); a.currentTime = t; }
      const m = new DOMMatrixReadOnly(getComputedStyle(sx).transform);
      vals.push(/pk-slide/.test(sx.getAttribute('class')) ? m.e : Math.atan2(m.b, m.a) * 180 / Math.PI);
    }
    for (const a of anims) a.currentTime = end;
    const big = vals.reduce((p, v) => (Math.abs(v) > Math.abs(p) ? v : p), 0);
    peak = +big.toFixed(1);
    let inside = false;
    swings = 0;
    for (const v of vals) { const now = Math.sign(big) * v > Math.abs(big) * 0.35; if (now && !inside) swings++; inside = now; }
  }
  const moving = ctm();
  el.classList.remove('pk-cheer');
  const still = ctm();
  const d = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const r3 = (x) => +x.toFixed(3);
  const relDiff = (m, s) => (m.length && m.length === s.length ? r3(Math.max(...m.map((w, i) => d(w, s[i])))) : null);
  return {
    found: true, done, n: anims.length, hopT, waveT, partT, gripO, linesO, fadeO, swings, peak,
    hopIdent: hopT.length > 0 && hopT.every(ident), waveIdent: waveT.length > 0 && waveT.every(ident), partIdent: partT.length > 0 && partT.every(ident),
    hopDiff: moving.hop && still.hop ? r3(d(moving.hop, still.hop)) : null,
    waveDiff: relDiff(moving.waves, still.waves), partDiff: relDiff(moving.parts, still.parts),
  };
}, ps, PART_SEL, FADE_SEL, swingSel);

// v1.85.0 推廣的六張：每一張該有哪幾層會動（js/peeks.js 的 CHEER；零件分幾段是圖裡數的）、是不是慢慢探上來、
// 「兩下」的那幾張數哪一個零件。小鳳打領結（v1.83.0）照舊用下面那五條原本的斷言。
const ANIM_WANT = {
  eat: { label: '捧麵', soft: false, layers: { 'pk-steam': 1, 'pk-grip': 1 }, parts: 0, fades: 2 },
  grill: { label: '烤串', soft: false, layers: { 'pk-sway': 2, 'pk-grip': 1 }, parts: 2, fades: 1, swing: '.pk-sway', swingWord: '晃兩下' },
  hat: { label: '遮陽帽', soft: false, layers: { 'pk-wave-r': 3, 'pk-wave-lines': 1, 'pk-grip': 1 }, parts: 3, fades: 2, swing: '.pk-wave-r', swingWord: '揮兩下' },
  cam: { label: '相機', soft: false, layers: { 'pk-flash': 1, 'pk-grip': 1 }, parts: 0, fades: 2 },
  rain: { label: '撐傘', soft: true, layers: { 'pk-tilt': 1, 'pk-grip': 1 }, parts: 1, fades: 1 },
  snow: { label: '雪板', soft: true, layers: { 'pk-slide': 1 }, parts: 1, fades: 0 },
};
// 一張的四條（swing 有寫的再加一條「兩下」）：有動、跳之前藏在後面、只用 transform／opacity、動完停在正確位置
function animChecks(kind, A, E) {
  const w = ANIM_WANT[kind], L = `動畫・${w.label}`;
  const cnt = A.count || {};
  const layerBad = LAYER_CLS.filter((c) => c !== 'pk-hop' && (cnt[c] || 0) !== (w.layers[c] || 0));
  const total = LAYER_CLS.reduce((s, c) => s + (cnt[c] || 0), 0);
  yes(A.found && A.kind === kind && A.cheer === true && A.soft === w.soft && A.running >= 1 && A.moved === true
    && cnt['pk-hop'] === 1 && layerBad.length === 0 && A.n === total,
    `${L} 有動：一出來就有動畫在跑、隔 150ms 量兩次位置不一樣、${w.soft ? '慢慢探上來' : '跳上來'}、會動的層跟登記的一樣（${A.kind}；pk-cheer ${A.cheer}；慢慢探 ${A.soft}；動畫 ${A.n} 段、跑著的 ${A.running}、層數合計 ${total}；位置變了 ${A.moved}；`
    + `層：${LAYER_CLS.filter((c) => cnt[c]).map((c) => `${c} ${cnt[c]}`).join('、') || '無'}；對不上：${layerBad.map((c) => `${c} ${cnt[c] || 0}≠${w.layers[c] || 0}`).join('、') || '無'}）`);
  yes(A.found && A.hidden === true,
    `${L} 跳之前整隻藏在後面：動畫倒回第 0 格，邊線以上那層的內容整個在邊線下面（內容頂離邊線 ${A.topGap}px）`);
  const ONLY = ['transform', 'opacity'], props = A.props || [];
  yes(A.found && A.n > 0 && props.length > 0 && props.every((x) => ONLY.includes(x)),
    `${L} 只用 transform 和 opacity：圖上每一段動畫的 keyframes 只動這兩個屬性（${A.n} 段：${(A.names || []).join('、')}；用到的屬性 ${props.join('、') || '無'}）`);
  const fadeO = E.fadeO || [], partT = E.partT || [];
  const partsOk = w.parts === 0 ? partT.length === 0 : (partT.length === w.parts && E.partIdent === true && E.partDiff != null && E.partDiff <= 0.01);
  yes(E.found && E.done === true && E.hopIdent === true && E.hopDiff != null && E.hopDiff <= 0.01 && partsOk
    && fadeO.length === w.fades && fadeO.every((o) => o === '1'),
    `${L} 動完停在正確位置：每一段動畫都結束後，身體與零件的位置矩陣跟撤掉動畫的靜止圖一樣、只動透明度的那幾層都完全看得到（結束了 ${E.done}；身體 ${(E.hopT || []).join('、')}、矩陣差 ${E.hopDiff}；`
    + `零件 ${partT.length} 段 ${partT.join('、') || '無'}、相對於身體的矩陣差 ${E.partDiff}；透明度 ${fadeO.join('、') || '無'}）`);
  if (w.swing) {
    yes(E.found && E.done === true && E.swings === 2,
      `${L} ${w.swingWord}：把動畫一格一格倒回去讀 ${w.swing} 的角度，往同一邊擺到底的次數是 2（數到 ${E.swings}；擺最大 ${E.peak} 度）`);
  }
}

// 在那一列按「從相簿選」選一張照片，量慶祝畫面上的照片與探頭圖；量完把慶祝全部按掉
//   anim＝true：慶祝畫面一出來先量動畫（animNow）——動畫只有 1.65 秒，等 900ms 再量就只剩翅膀在動
async function complete(page, spot, must, anim = false) {
  const none = { found: false };
  const row = await pickRow(page, spot, must);
  if (!row) return { row: null, p: none, ttl: '', standalone: null, a: none };
  const inputs = await page.$$(`.qline[data-quest="${row.id}"] .addphoto-icons input[type=file]`);
  if (inputs.length < 2) return { row, p: none, ttl: '', standalone: null, a: none };
  await inputs[1].uploadFile(photoPath);            // [0]=拍照 [1]=從相簿選
  if (!await soft(page.waitForSelector('.celebrate', { timeout: 30000 }))) return { row, p: none, ttl: '', standalone: null, a: none };
  const a = anim ? await animNow(page) : none;
  await sleep(900);   // 彈出動畫跑完再量
  const p = await probe(page, '.celebrate .celebrate-shot img', '.celebrate .celebrate-shot svg.gl-peek');
  const ttl = await page.evaluate(() => document.querySelector('.celebrate h2')?.textContent || '');
  // 標題上面另外放的吉祥物（第三段的做法）或打勾的圓：有照片的時候都不該再出現
  const standalone = await page.evaluate(() => document.querySelectorAll('.celebrate .celebrate-mascot, .celebrate .celebrate-badge').length);
  return { row, p, ttl, standalone, a };
}

// P7（v1.84.0 改）：主頁的下一站卡不放「拍照解任務」——Yolin：主頁不放任務的跳轉，拍照就在每一列任務上（相機圖示在 photoicontest 驗）。
// 卡片在、卡裡有「帶我去」才算數（不然「沒有那顆」是因為整張卡沒畫出來）。
async function todayShot(page, tag) {
  const b = await page.evaluate(() => {
    const card = document.querySelector('.trip-home .today-card');
    if (!card) return null;
    const btns = [...card.querySelectorAll('button, a')].map((x) => x.textContent.trim());
    return { btns, shot: card.querySelectorAll('.today-shot').length, words: btns.filter((x) => x.includes('拍照解任務')).length,
      go: btns.some((x) => x.includes('帶我去')) };
  });
  yes(!!b && b.go && b.shot === 0 && b.words === 0,
    `${tag} P7 主頁的下一站卡沒有「拍照解任務」（主頁不放任務的跳轉；卡在、有帶我去才算數）（${b ? `卡裡的按鈕：${b.btns.join('、')}` : '主頁沒有下一站卡'}）`);
}

async function newPage(ctx) {
  await ctx.overridePermissions(ORIGIN, ['geolocation']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });
  await page.setViewport({ width: 390, height: 844 });
  await page.setGeolocation(GPS);
  return page;
}
// 擋外站：Open-Meteo 回造的預報，其餘 503
function intercept(page, getWet) {
  page.on('request', (req) => {
    const u = req.url();
    if (/^(http:\/\/localhost[:/]|data:|blob:)/.test(u)) { req.continue().catch(() => {}); return; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/.test(u)) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeForecast(getWet())) }).catch(() => {});
      return;
    }
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
}

// 造行程：一站一站用內建景點庫出任務（跟使用者從清單選景點一樣走 generateForTrip）
const makeTrip = (page, title, start, end, groups) => page.evaluate(async (ttl, s0, e0, gs) => {
  const s = await import('./js/store.js');
  const { uuid } = await import('./js/ids.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const g = uuid(), t = uuid(), m = uuid();
  await s.put({ id: g, type: 'group', name: 'g' });
  await s.put({ id: m, type: 'member', groupId: g, displayName: '小美' });
  await s.put({ id: t, type: 'trip', groupId: g, title: ttl, region: gs[0].region, allowWiki: false, startDate: s0, endDate: e0 });
  const names = [];
  for (const gr of gs) {
    const { spots, quests } = await generateForTrip({ tripId: t, region: gr.region, items: gr.names.map((name) => ({ name, region: gr.region, day: 1 })) });
    for (const x of spots) { await s.put(x); names.push(`${x.name}:${x.source}`); }
    for (const x of quests) await s.put(x);
  }
  return names;
}, title, start, end, groups);

async function washiRound() {
  console.log('\n— 和紙（P1～P8）—');
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  let wet = {};
  await page.setRequestInterception(true);
  intercept(page, () => wet);
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero');
    const made = await makeTrip(page, '探頭圖測試', plus(0), plus(1), [
      { region: '宜蘭', names: ['羅東夜市', '太平山', '頭城老街'] },
      { region: '台北', names: ['龍山寺'] },
    ]);
    yes(made.length === 4 && made.every((x) => x.endsWith(':curated')), `前置：四站都對上內建景點庫（${made.join('、')}）`);

    // ---- P1 今天會下雨 ----
    wet = { 0: 'rain' };
    const o1 = await openTrip(page, '探頭圖測試');
    await sleep(500);
    const s1 = await strip(page);
    yes(o1 && s1.alert === 'rain' && s1.txt === '今天可能下雨（降雨機率 80%），記得帶傘。' && s1.tipImgs === 0 && s1.scenes === 0,
      `P1 今天會下雨：提示那一行只有字、句子有預報的數字（提示 ${s1.alert}、行內的圖 ${s1.tipImgs}、舊的情境圖 ${s1.scenes}；「${s1.txt}」）`);
    // Yolin 2026-11-13：天氣條不探頭（當時在任務頁，任務會被擠到下面；v1.84.0 天氣條搬到主頁，規矩照舊）。「不加高」在 P5 跟晴天比上面的間距。
    yes(o1 && noPeek(s1),
      `P1 主頁的天氣條不掛探頭圖：天氣條裡沒有探頭圖、沒有掛探頭圖的標記（探頭圖 ${s1.peeks}、has-peek ${s1.hostMark}；上面的間距 ${s1.gap}px、上一個區塊「${s1.prevName}」）`);
    // 點天氣條 → 天氣頁（使用者的路；P2 的兩條都靠它，進不去就一起紅）
    const nav1 = o1 && await openWeather(page);

    // ---- P2 天氣頁（下雨）----
    // 動畫（v1.85.0）：卡片一出來就量（探上來＋傘輕晃大約 2.4 秒），量完再量位置
    const rainA = nav1 ? await animNow(page, '.wx-advice svg.gl-peek') : { found: false };
    const p2 = nav1 ? await probe(page, '.wx-advice', '.wx-advice svg.gl-peek') : { found: false };
    const rainE = nav1 ? await animEnd(page, '.wx-advice svg.gl-peek') : { found: false };
    const a2 = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.wx-advice-list li')];
      const rain = li.find((x) => x.classList.contains('wx-rain'));
      return { n: li.length, imgs: li.filter((x) => x.querySelector('svg, img')).length, rainBefore: rain ? getComputedStyle(rain, '::before').content : null };
    });
    yes(nav1 && p2.found && p2.kind === 'rain' && aligned(p2) && p2.child && p2.inView && p2.clear === true,
      `P2 天氣頁的出門提醒卡上緣是撐傘的探頭圖、邊線對齊、是卡片的一部分、整張在畫面裡、不壓到上一個區塊（進了天氣頁 ${nav1}；${brief(p2)}；子元素 ${p2.child}；在畫面裡 ${p2.inView}；上一個區塊「${p2.prevName}」、沒壓到 ${p2.clear}）`);
    hygiene('天氣頁的出門提醒卡（下雨）', p2);
    yes(nav1 && a2.n >= 1 && a2.imgs === 0 && a2.rainBefore && a2.rainBefore !== 'none',
      `P2 清單裡每一條照舊只有字和前面的小圖（${a2.n} 條、帶圖 ${a2.imgs}、下雨那條的小圖 ${a2.rainBefore}）`);

    // ---- P3 完成任務的慶祝畫面 ----
    await openTrip(page, '探頭圖測試');
    await sleep(500);
    const cases = [
      { label: '必吃 → 捧麵', spot: '羅東夜市', must: true, want: 'eat' },
      { label: '夜市的其他任務 → 烤串', spot: '羅東夜市', must: false, want: 'grill' },
      { label: '自然 → 遮陽帽', spot: '太平山', must: null, want: 'hat' },
      { label: '城市 → 相機', spot: '頭城老街', must: null, want: 'cam' },
      { label: '古蹟（沒有對得上的類別）→ 小鳳打領結', spot: '龍山寺', must: null, want: 'done' },
    ];
    let first = null, doneP = { found: false }, doneAnim = { found: false }, doneEnd = { found: false };
    const anim3 = {};   // v1.85.0：另外四張的動畫（捧麵、烤串、遮陽帽、相機）
    for (const c of cases) {
      const r = await complete(page, c.spot, c.must, true);
      yes(/完成/.test(r.ttl) && r.p.found && r.p.kind === c.want && aligned(r.p) && r.p.inView && r.standalone === 0,
        `P3 ${c.label}：從照片上緣探頭、邊線對齊照片上緣、整張在畫面裡、標題上面沒有另一隻（${c.spot}「${r.row ? r.row.title : '找不到這一列'}」；慶祝「${r.ttl}」；${brief(r.p)}；在畫面裡 ${r.p.inView}；另外的吉祥物／打勾 ${r.standalone}）`);
      if (!first) first = r.p;
      if (c.want === 'done') { doneP = r.p; doneAnim = r.a; doneEnd = await animEnd(page); }
      else anim3[c.want] = { a: r.a, e: await animEnd(page, PEEK_SEL, ANIM_WANT[c.want]?.swing || null) };
      await clearCelebrations(page);
      await sleep(500);
    }
    // 天氣條不再掛探頭圖，這一頁只有慶祝這一張；好幾張放在同一頁時 id 撞不撞，深色那輪的「P8 同一頁放好幾張」驗
    hygiene('慶祝畫面的探頭圖', first || { found: false }, 1);
    // 動作線跟 glyphs.js 的吉祥物同一條規矩：和紙看得到（深色那輪驗不畫）
    yes(doneP.found && doneP.extra === true && doneP.filter === 'none',
      `［和紙］ 慶祝畫面的探頭圖：動作線看得到、身體不套白邊（小鳳打領結那張；動作線 ${doneP.extra}、濾鏡 ${doneP.filter}）`);

    // ---- 動畫（v1.83.0）：完成任務那一刻小鳳打領結那張跳上來、揮翅膀 ----
    const A = doneAnim, E = doneEnd, L = A.layers || {};
    yes(A.found && A.kind === 'done' && A.cheer === true && A.running >= 1 && A.moved === true,
      `動畫 完成任務那一刻有動：慶祝畫面一出來，小鳳打領結那張有動畫在跑、隔 150ms 量兩次位置不一樣（${A.kind}；pk-cheer ${A.cheer}；動畫 ${A.n} 段、跑著的 ${A.running}；位置變了 ${A.moved}）`);
    // 母體：每一層一段動畫（身體 1、手 1、翅膀每一段各 1、揮動線 1——和紙才畫揮動線）
    const ONLY = ['transform', 'opacity'], props = A.props || [];
    yes(A.found && L.hop === 1 && L.grip === 1 && L.wave >= 1 && L.lines === 1 && A.n === L.hop + L.grip + L.wave + L.lines
      && props.length > 0 && props.every((x) => ONLY.includes(x)),
      `動畫 只用 transform 和 opacity：圖上每一段動畫的 keyframes 只動這兩個屬性（${A.n} 段：${(A.names || []).join('、')}；用到的屬性 ${props.join('、') || '無'}；會動的層 身體 ${L.hop}、翅膀 ${L.wave}、手 ${L.grip}、揮動線 ${L.lines}）`);
    yes(E.found && E.done === true && E.hopIdent === true && E.hopDiff != null && E.hopDiff <= 0.01,
      `動畫 動完停在正確位置・身體：每一段動畫都結束後，身體那層沒有殘留的位移、位置矩陣跟撤掉動畫的靜止圖一樣（結束了 ${E.done}；${E.n} 段；transform ${(E.hopT || []).join('、')}；矩陣最大差 ${E.hopDiff}）`);
    yes(E.found && E.done === true && E.waveIdent === true && E.waveDiff != null && E.waveDiff <= 0.01,
      `動畫 動完停在正確位置・翅膀：揮完回到原本的角度、相對於身體的位置矩陣跟靜止圖一樣（transform ${(E.waveT || []).join('、')}；矩陣最大差 ${E.waveDiff}）`);
    yes(E.found && E.done === true && (E.gripO || []).length === 1 && E.gripO.every((o) => o === '1') && (E.linesO || []).length === 1 && E.linesO.every((o) => o === '1'),
      `動畫 動完停在正確位置・扣在照片上的手與揮動線：都完全看得到（手 ${(E.gripO || []).join('、')}；揮動線 ${(E.linesO || []).join('、')}）`);
    // v1.85.0：起跳點改成每一張照圖算（--pk-from），小鳳打領結也要照樣整隻藏在照片後面才開始跳
    yes(A.found && A.hidden === true,
      `動畫 跳之前整隻藏在照片後面（小鳳打領結）：動畫倒回第 0 格，邊線以上那層的內容整個在邊線下面（內容頂離邊線 ${A.topGap}px）`);
    // ---- 動畫（v1.85.0）：完成任務的另外四張 ----
    for (const k of ['eat', 'grill', 'hat', 'cam']) animChecks(k, anim3[k]?.a || { found: false }, anim3[k]?.e || { found: false });
    // ---- 動畫（v1.85.0）：天氣頁下雨的那張（P2 量的）----
    animChecks('rain', rainA, rainE);

    // ---- P4 今天會下雪 ----
    wet = { 0: 'snow' };
    const o4 = await openTrip(page, '探頭圖測試');
    await sleep(500);
    const s4 = await strip(page);
    yes(o4 && s4.alert === 'snow' && s4.txt === '今天可能下雪（預估積雪 3.5 公分），穿防滑的鞋，路面可能結冰。' && s4.tipImgs === 0 && noPeek(s4),
      `P4 今天會下雪：天氣條是下雪那一句、提示那一行只有字、天氣條沒有探頭圖（提示 ${s4.alert}；探頭圖 ${s4.peeks}、has-peek ${s4.hostMark}；「${s4.txt}」）`);
    const w4 = await openWeather(page);
    const snowA = w4 ? await animNow(page, '.wx-advice svg.gl-peek') : { found: false };
    const p4b = w4 ? await probe(page, '.wx-advice', '.wx-advice svg.gl-peek') : { found: false };
    const snowE = w4 ? await animEnd(page, '.wx-advice svg.gl-peek') : { found: false };
    animChecks('snow', snowA, snowE);
    const a4 = await page.evaluate(() => ({
      rain: document.querySelectorAll('.wx-advice-list li.wx-rain').length,
      snow: document.querySelectorAll('.wx-advice-list li.wx-snow').length,
    }));
    yes(w4 && p4b.found && p4b.kind === 'snow' && aligned(p4b) && p4b.clear === true && a4.snow === 1 && a4.rain === 0,
      `P4 天氣頁的卡片是踩雪板、不壓到上一個區塊、會下雪的那天不再算下雨（${brief(p4b)}；上一個區塊「${p4b.prevName}」、沒壓到 ${p4b.clear}；下雪的提醒 ${a4.snow} 條、下雨的 ${a4.rain} 條；那天降雨機率 70%）`);
    hygiene('天氣頁的出門提醒卡（下雪）', p4b);

    // ---- P5 晴天（反向）----
    wet = {};
    const o5 = await openTrip(page, '探頭圖測試');
    await sleep(500);
    const s5 = await strip(page);
    const w5 = await openWeather(page);
    const n5 = await page.evaluate(() => document.querySelectorAll('svg.gl-peek').length);
    yes(o5 && s5.has && !s5.alert && s5.peeks === 0 && s5.txt === '天氣還算舒服，點看每天預報' && w5 && n5 === 0,
      `P5 晴天：天氣條、天氣頁都沒有探頭圖，照舊那一句（天氣條的探頭圖 ${s5.peeks}、天氣頁 ${n5}；「${s5.txt}」）`);
    // 天氣條「不加高」：下雨那天（P1）跟晴天（這裡）天氣條上面的間距一樣——掛過探頭圖時下雨那天會多留圖的高度（約 60px）。
    // 比的是同一個行程、同一個上一個區塊（兩邊都印出來）；兩邊都量得到才算數。
    yes(o1 && o5 && Number.isFinite(s1.gap) && Number.isFinite(s5.gap) && s1.prevName === s5.prevName && Math.abs(s1.gap - s5.gap) <= 1,
      `P5 下雨那天的天氣條沒有加高：上面的間距跟晴天一樣（下雨 ${s1.gap}px、晴天 ${s5.gap}px；上一個區塊「${s1.prevName}」／「${s5.prevName}」）`);

    // ---- P6 還沒出發、出發那天會下雨 ----
    await makeTrip(page, '出發日測試', plus(3), plus(4), [{ region: '宜蘭', names: ['太平山'] }]);
    wet = { 3: 'rain' };
    const o6 = await openTrip(page, '出發日測試');
    await sleep(500);
    const s6 = await strip(page);
    const want6 = `出發那天（${md(plus(3))}）可能下雨（降雨機率 80%），記得帶傘。`;
    yes(o6 && s6.alert === 'rain' && s6.txt === want6 && noPeek(s6),
      `P6 還沒出發：出發那天會下雨 → 「出發那天（M/D）…」、天氣條沒有探頭圖（提示 ${s6.alert}；探頭圖 ${s6.peeks}、has-peek ${s6.hostMark}；「${s6.txt}」）`);

    // ---- P7 主頁的下一站卡沒有拍照鈕（和紙）＋天氣頁那張不套白邊 ----
    wet = { 0: 'rain' };
    await openTrip(page, '探頭圖測試');
    await sleep(500);
    await todayShot(page, '［和紙］');
    const ww = await openWeather(page);
    const pw = ww ? await probe(page, '.wx-advice', '.wx-advice svg.gl-peek') : { found: false };
    yes(pw.found && pw.filter === 'none', `［和紙］ 探頭圖不套深色的白邊（天氣頁的出門提醒卡；進了天氣頁 ${ww}；濾鏡 ${pw.filter}）`);
  } catch (e) {
    yes(false, `［和紙］ 例外：${e && e.stack || e}`);
  } finally {
    await ctx.close();
  }
}

async function darkRound() {
  console.log('\n— 深色 —');
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  const wet = { 0: 'rain' };
  await page.setRequestInterception(true);
  intercept(page, () => wet);
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero');
    await tap(page, 'a.tab', '設定');
    await soft(page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('.theme-seg'), { timeout: 15000 }));
    await tap(page, '.theme-seg button', '深色');
    await soft(page.waitForFunction(() => document.documentElement.dataset.theme === undefined, { timeout: 5000 }));
    const attr = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
    yes(attr === null, `［深色］ 前置：這一輪真的是深色（data-theme=${attr}）`);
    await makeTrip(page, '深色探頭圖測試', plus(0), plus(1), [{ region: '宜蘭', names: ['頭城老街'] }]);
    const o = await openTrip(page, '深色探頭圖測試');
    await sleep(500);
    await todayShot(page, '［深色］');
    const sd = await strip(page);
    const wd = o && await openWeather(page);
    const p = wd ? await probe(page, '.wx-advice', '.wx-advice svg.gl-peek') : { found: false };
    yes(o && noPeek(sd) && sd.alert === 'rain' && wd && p.found && p.kind === 'rain' && aligned(p) && !!p.filter && /url\(/.test(p.filter),
      `［深色］ 天氣條一樣沒有探頭圖；天氣頁出門提醒卡的探頭圖邊線一樣對齊、白邊有套上（天氣條：提示 ${sd.alert}、探頭圖 ${sd.peeks}、has-peek ${sd.hostMark}；提醒卡：${brief(p)}；濾鏡 ${p.filter}）`);
    // 白邊濾鏡的範圍要罩得住「圖形＋往外長的白邊」：罩不住，白邊被範圍切成直角。2026-11-13 截圖抓到：範圍原本是
    // 「那一塊的外框 ±15%」，邊線以下那層只有手掌、碗腳，15% 不到白邊的 5 個單位 → 深色下照片上多一塊白色方塊。
    // 前面那條只驗「有套濾鏡」（濾鏡是 url(...)），範圍不夠照樣過，所以沒抓到。
    // 只量看得到的那一塊：每一層外面包著裁切框（邊線以上／以下），身體畫到邊線以下很深、被裁掉的部分不算——
    // 要罩住的是「外框往外加白邊寬度」∩「裁切框往外加白邊寬度」（後者是因為裁切框邊上那一圈的白邊，要靠框外 5 個單位內的圖形長出來）。
    // 母體：每一張探頭圖（PEEK_KINDS，用對外的 peek() 畫出來、放進這一頁）每一層套了白邊的 g，數出來的層數要等於圖裡 g.mc-fig 的層數；
    // 對照組（同一個檢查）：把小鳳那張的範圍改回舊的 ±15%，必須抓到邊線以下那一層、上層不受影響。
    const rim = await page.evaluate(async () => {
      const m = await import('./js/peeks.js');
      const frac = (v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
      const check = (svg) => [...svg.querySelectorAll('g.mc-fig')].map((g) => {
        const dn = /-dn\)/.test(g.parentNode.getAttribute('clip-path') || '');
        const id = ((g.getAttribute('filter') || '').match(/url\(#([^)]+)\)/) || [])[1];
        const f = id ? svg.querySelector(`filter[id="${CSS.escape(id)}"]`) : null;
        const mo = f && f.querySelector('feMorphology');
        if (!f || !mo) return { dn, ok: false, margin: NaN, why: '沒有白邊濾鏡' };
        const r = parseFloat(mo.getAttribute('radius'));
        const b = g.getBBox();
        const at = (a, d) => f.getAttribute(a) ?? d;
        let reg;
        if (f.getAttribute('filterUnits') === 'userSpaceOnUse') {
          if (['x', 'y', 'width', 'height'].some((a) => String(at(a, '%')).endsWith('%'))) return { dn, ok: false, margin: NaN, why: '算不出範圍' };
          reg = { x: +at('x'), y: +at('y'), w: +at('width'), h: +at('height') };
        } else {   // 沒寫 filterUnits＝照外框算；沒寫的那幾項用規格的預設 -10%／120%
          reg = { x: b.x + frac(at('x', '-10%')) * b.width, y: b.y + frac(at('y', '-10%')) * b.height,
            w: frac(at('width', '120%')) * b.width, h: frac(at('height', '120%')) * b.height };
        }
        // 要罩住的範圍：外框 ±r，再跟裁切框 ±r 取交集（沒有裁切框＝整個外框 ±r）
        let need = { x0: b.x - r, y0: b.y - r, x1: b.x + b.width + r, y1: b.y + b.height + r };
        const cid = ((g.parentNode.getAttribute('clip-path') || '').match(/url\(#([^)]+)\)/) || [])[1];
        if (cid) {
          const cr = svg.querySelector(`clipPath[id="${CSS.escape(cid)}"] rect`);
          if (!cr) return { dn, ok: false, margin: NaN, why: '找不到裁切框' };
          const c = { x: +cr.getAttribute('x'), y: +cr.getAttribute('y'), w: +cr.getAttribute('width'), h: +cr.getAttribute('height') };
          need = { x0: Math.max(need.x0, c.x - r), y0: Math.max(need.y0, c.y - r), x1: Math.min(need.x1, c.x + c.w + r), y1: Math.min(need.y1, c.y + c.h + r) };
        }
        const side = { 左: need.x0 - reg.x, 右: reg.x + reg.w - need.x1, 上: need.y0 - reg.y, 下: reg.y + reg.h - need.y1 };
        const [worstSide, margin] = Object.entries(side).sort((p, q) => p[1] - q[1])[0];
        return { dn, ok: Number.isFinite(margin) && margin >= 0, margin, why: Number.isFinite(margin) && margin < 0 ? `${worstSide}邊差 ${(-margin).toFixed(1)}` : '' };
      });
      // 接縫：下層的裁切框要往上蓋過邊線一點（跟上層重疊）；剛好相接的話，那一列兩層的抗鋸齒各蓋一半，背景從手掌上透出一條線
      const seam = (svg) => {
        const rect = (suf) => svg.querySelector(`clipPath[id$="-${suf}"] rect`);
        const up = rect('up'), dn = rect('dn');
        // 沒有前景（邊線以下那層）就沒有接縫：裁切框每一張都定義了，要看有沒有一層真的用它（雪那張沒有前景、框沒人用）
        if (!dn || !svg.querySelector('[clip-path$="-dn)"]')) return null;
        if (!up) return NaN;
        return +up.getAttribute('y') + +up.getAttribute('height') - +dn.getAttribute('y');
      };
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;';
      document.body.append(host);
      const rows = [], seams = [];
      let layers = 0;
      for (const k of m.PEEK_KINDS) {
        const s = m.peek(k, 0.6);
        host.append(s);
        layers += s.querySelectorAll('g.mc-fig').length;
        for (const c of check(s)) rows.push({ kind: k, ...c });
        const o = seam(s);
        if (o !== null) seams.push({ kind: k, overlap: o });
      }
      // P8 同一頁放好幾張：七張都在這一頁時，id 不撞、每個引用都指到自己那張裡面
      const all = [...host.querySelectorAll('svg.gl-peek')];
      const allIds = all.flatMap((s) => [...s.querySelectorAll('[id]')].map((x) => x.id));
      const multi = { svgs: all.length, ids: allIds.length, dup: [...new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i))],
        stray: all.flatMap((s) => [...s.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map((x) => x[1]).filter((id) => !s.querySelector(`[id="${CSS.escape(id)}"]`))) };
      const ctl = m.peek(m.DONE_PEEK, 0.6);
      host.append(ctl);
      const cf = ctl.querySelector('filter');
      cf.removeAttribute('filterUnits');
      for (const [a, v] of [['x', '-15%'], ['y', '-15%'], ['width', '130%'], ['height', '130%']]) cf.setAttribute(a, v);
      const ctlRows = check(ctl);
      // 接縫的對照組：下層的框改回從邊線剛好開始
      const cu = ctl.querySelector('clipPath[id$="-up"] rect'), cd = ctl.querySelector('clipPath[id$="-dn"] rect');
      cd.setAttribute('y', String(+cu.getAttribute('y') + +cu.getAttribute('height')));
      const ctlSeam = seam(ctl);
      host.remove();
      return { kinds: m.PEEK_KINDS.length, rows, layers, seams, ctlSeam, multi,
        ctlDn: ctlRows.filter((c) => c.dn && !c.ok).length, ctlUp: ctlRows.filter((c) => !c.dn && !c.ok).length };
    });
    const rimBad = rim.rows.filter((x) => !x.ok);
    const rimDn = rim.rows.filter((x) => x.dn).length;
    const rimMin = rim.rows.length ? Math.min(...rim.rows.map((x) => x.margin)) : NaN;
    yes(rim.kinds >= 7 && rim.rows.length === rim.layers && rimDn >= 1 && rimBad.length === 0 && rim.ctlDn === 1 && rim.ctlUp === 0,
      `［深色］ 白邊濾鏡的範圍罩得住圖形加白邊（${rim.kinds} 張、數到 ${rim.rows.length} 層／圖裡 ${rim.layers} 層，其中邊線以下 ${rimDn} 層；最少還留 ${rimMin.toFixed(1)} 單位；罩不住：${rimBad.map((x) => `${x.kind}${x.dn ? '邊線以下' : '上層'}（${x.why || '算不出來'}）`).join('、') || '無'}；對照組改回 ±15%：抓到邊線以下 ${rim.ctlDn} 層、上層 ${rim.ctlUp} 層）`);
    // 接縫（2026-11-13 放大截圖看到、量到：修正前深色那一列比上下暗 41、和紙暗 3；兩層重疊 1 個單位後一樣亮）
    const seamBad = rim.seams.filter((x) => !(x.overlap >= 0.5));
    yes(rim.seams.length === rimDn && rim.seams.length >= 1 && seamBad.length === 0 && rim.ctlSeam === 0,
      `［深色］ 邊線以下那層的裁切框往上蓋過邊線（不留接縫）：${rim.seams.length} 張有前景、跟邊線以下的層數 ${rimDn} 一樣；重疊 ${rim.seams.map((x) => `${x.kind} ${x.overlap}`).join('、') || '無'}；不到 0.5：${seamBad.map((x) => x.kind).join('、') || '無'}；對照組改回剛好相接：重疊 ${rim.ctlSeam}`);
    const mu = rim.multi;
    yes(mu.svgs === rim.kinds && rim.kinds >= 7 && mu.ids > 0 && mu.dup.length === 0 && mu.stray.length === 0,
      `P8 同一頁放好幾張探頭圖：id 不撞、引用都指到自己那張（${mu.svgs} 張、${mu.ids} 個 id；重複 ${mu.dup.join('、') || '無'}；指到外面 ${mu.stray.join('、') || '無'}）`);
    // 完成一個任務（城市＝鬍鬍拿相機，那張有三道閃光）：深色下白邊套上、閃光那一層不畫、邊線照樣對齊照片
    await openTrip(page, '深色探頭圖測試');
    await sleep(500);
    const r = await complete(page, '頭城老街', null);
    yes(/完成/.test(r.ttl) && r.p.found && r.p.kind === 'cam' && aligned(r.p) && /url\(/.test(r.p.filter || '') && r.p.extra === false,
      `［深色］ 慶祝畫面的探頭圖：邊線對齊照片上緣、身體套白邊、動作線不畫（${brief(r.p)}；濾鏡 ${r.p.filter}；動作線 ${r.p.extra}）`);
    await clearCelebrations(page);
  } catch (e) {
    yes(false, `［深色］ 例外：${e && e.stack || e}`);
  } finally {
    await ctx.close();
  }
}

// 設定頁的「減少動態效果」開關（使用者的路：底部分頁「設定」→ 點那一列），等 <html> 的 reduce-motion 跟著變
async function setReduce(page, on) {
  const read = () => page.evaluate(() => ({
    checked: [...document.querySelectorAll('label.switch-row')].find((r) => r.textContent.includes('減少動態效果'))?.querySelector('input[type=checkbox]')?.checked ?? null,
    cls: document.documentElement.classList.contains('reduce-motion'),
    saved: JSON.parse(localStorage.getItem('tripquest.prefs') || '{}').reduceMotion ?? null,
  }));
  if (!await toHome(page)) return { ok: false };
  if (!await tap(page, 'a.tab', '設定')) return { ok: false };
  if (!await soft(page.waitForFunction(() => location.hash === '#/settings', { timeout: 15000 }))) return { ok: false };
  if ((await read()).checked !== on && !await tap(page, 'label.switch-row', '減少動態效果')) return { ok: false };
  await soft(page.waitForFunction((v) => document.documentElement.classList.contains('reduce-motion') === v, { timeout: 5000 }, on));
  return { ok: true, ...await read() };
}

// 減少動態效果：設定頁的開關、系統設定各完成一個任務（龍山寺＝小鳳打領結那張，平常會動的那一張）
// 照舊從照片上緣探頭（靜止圖），沒有 pk-cheer、0 段動畫。系統設定用瀏覽器模擬 prefers-reduced-motion，設定頁的開關先關回去，兩個入口分開驗。
async function reducedRound() {
  console.log('\n— 減少動態效果（設定頁的開關、系統設定）—');
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  await page.setRequestInterception(true);
  intercept(page, () => ({}));
  const none = { found: false };
  const still = (r) => r.p.found && r.p.kind === 'done' && aligned(r.p) && r.a.found && r.a.cheer === false && r.a.n === 0 && r.a.moved === false;
  const said = (r) => `${brief(r.p)}；pk-cheer ${r.a.cheer}；動畫 ${r.a.n} 段；位置變了 ${r.a.moved}`;
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.hero');
    const made = await makeTrip(page, '減少動態測試', plus(0), plus(1), [{ region: '台北', names: ['龍山寺'] }]);
    yes(made.length === 1 && made[0].endsWith(':curated'), `［減少動態］ 前置：龍山寺對上內建景點庫（${made.join('、')}）`);

    // ---- 設定頁的開關 ----
    const s1 = await setReduce(page, true);
    yes(s1.ok && s1.checked === true && s1.saved === true && s1.cls === true,
      `［減少動態］ 前置：設定頁打開「減少動態效果」→ <html> 有 reduce-motion（點到了 ${s1.ok}；開關 ${s1.checked}；存進偏好 ${s1.saved}；class ${s1.cls}）`);
    const r1 = (await openTrip(page, '減少動態測試')) ? await complete(page, '龍山寺', null, true) : { p: none, a: none };
    yes(still(r1), `動畫 減少動態效果（設定頁的開關）完全不動：照舊從照片上緣探頭（靜止圖）、沒有 pk-cheer、0 段動畫（${said(r1)}）`);
    await clearCelebrations(page);

    // ---- 系統設定（設定頁的開關關回去）----
    const s2 = await setReduce(page, false);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.reload({ waitUntil: 'networkidle0' });   // 重新載入：App 開頭讀一次系統設定（不靠「設定改變」事件）
    const sys = await page.evaluate(() => ({
      cls: document.documentElement.classList.contains('reduce-motion'),
      saved: JSON.parse(localStorage.getItem('tripquest.prefs') || '{}').reduceMotion ?? null,
    }));
    yes(s2.ok && s2.checked === false && s2.cls === false && sys.saved === false && sys.cls === true,
      `［減少動態］ 前置：系統設定減少動態效果、設定頁的開關關著 → <html> 有 reduce-motion（關掉開關後 class ${s2.cls}、開關 ${s2.checked}；偏好 ${sys.saved}；系統設定之後 class ${sys.cls}）`);
    const r2 = (await openTrip(page, '減少動態測試')) ? await complete(page, '龍山寺', null, true) : { p: none, a: none };
    yes(still(r2), `動畫 減少動態效果（系統設定）完全不動：照舊從照片上緣探頭（靜止圖）、沒有 pk-cheer、0 段動畫（${said(r2)}）`);
    await clearCelebrations(page);
  } catch (e) {
    yes(false, `［減少動態］ 例外：${e && e.stack || e}`);
  } finally {
    await ctx.close();
  }
}

try {
  await washiRound();
  await darkRound();
  await reducedRound();
  console.log('\n探頭圖測試結束');
} catch (e) {
  yes(false, '例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
