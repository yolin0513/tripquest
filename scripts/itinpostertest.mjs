// 行程海報（v1.88.0）從使用者的入口驗（npm run itinpostertest；會開瀏覽器）
//
// 涵蓋的程式：js/views/itinposter.js（那一頁：版型、張數、翻頁、存檔、記住上次選的）、js/itinposter/index.js（收資料、存 PNG／PDF）、
//   js/itinposter/draw.js（畫：canvas 真的字寬、吉祥物）、js/itinposter/layout.js、js/itinposter/model.js、js/pdf.js、
//   js/views/trip.js（行程分頁「行程」那一格的入口）、js/app.js（路由、底部亮哪一格）、js/weather.js（預報）、css/style.css
// 放什麼、排版的算法、PDF 檔的結構在 scripts/itinposterlayouttest.mjs（秒級、近似字寬）；這支用 canvas 真的字寬再驗一次版面，
// 版面與 PDF 的檢查器跟那一支共用（scripts/itinposterlib.mjs），每次先跑那幾支的對照組。
//
// 驗什麼：
//   P0 前置：造好兩趟（一趟 3 天 6 站、5 站對上景點庫、出發日是 2 天後；一趟沒有景點）
//   P1a 從首頁 → 底部「行程」→「行程」那一格 → 按「做成行程海報」進得來；P1b 進去之後底部亮的還是「行程」
//   P2a 沒有景點的一趟沒有那顆按鈕；P2b 直接開海報那一頁寫「還沒有排景點」、沒有預覽
//   P3a 預覽跟成品是同一份（同一份版面另外畫一張，逐像素相同），不是空白；P3b 每天一隻吉祥物真的畫出來了（v1.89）
//   （v1.89）P3c 海報上的吉祥物沒有接縫：手掌的深色外框在邊線附近沒有夾在深色中間的一列淡線（量畫出來的像素；
//         對照：App 的 peek() 分上下兩層的畫法，在同一個量法下量得到那條線）
//   P4 真的字寬排出來的 4 組（2 版型 × 2 張數）跑 itinposterlayouttest 同一組版面檢查（B1～B15）
//   （v1.89）P10a 沒開過行程分頁的一趟（路線快取裡沒有）直接開海報：不連路線服務、車程與約幾點到留白（不猜）；
//         P10b 開過行程分頁（畫面補上「約 N 分」「約幾點到」）再按進海報：每天一張的站卡寫的跟行程分頁一樣
//   P5a 天氣預報到了會重畫（小提醒放旅程那幾天）；P5b 查天氣只送目的地的座標與固定參數
//   P6a 換版型、換張數、翻頁的字；P6b 按「下一張」；P6c 離開再進來還是上次選的
//   P7a 存圖片：手機分享得了檔案 → 一次分享全部 PNG；P7b 分享不了 → 下載；檔名、尺寸跟預覽那一份一樣
//   P8a 存 PDF：xref、長度欄位、頁數、每頁比例；P8b 存檔的時候沒有任何對外請求、沒有上傳
//   P9 整段頁面沒有丟出例外
//   （v1.90）P11 交通圖示真的畫出來：每一個圖示那一格有深色外框與那一天的顏色（對照：同一張拿掉圖示再畫，那一格量不到）；
//         六種都畫過一次（合成的一天：每一段一種方式）
//   （v1.90）P12 背景紋理是規則的：同一張有紋理、沒紋理各畫一次，不一樣的像素全部落在格點上、格點很多；標題區與頁尾、
//         白框與面板裡面一個都沒有（點被蓋住、沒有畫在框上面）。對照：合成的規則格子放行、亂數抖動的點抓到、點畫在白框上抓到
//   （v1.90）P13 字的對比維持：拿掉字之後，有紋理、沒紋理兩張每一個字那一格的最深的底色一模一樣（紋理碰不到任何字的底）；
//         畫出來的點（量像素）當底，內文的灰字、黑字對比仍 ≥ 4.5。對照：點落在字的那一格抓到、點換深抓到
//   （v1.93）P14a 頁首插圖真的畫出來：全部一張的預覽用的是有插圖的版面（canvas 標 data-art="1"，跟有插圖那一份逐像素相同）；
//         插圖那一塊跟同一張拿掉插圖再畫的大半不同（路線圖、分天色帶各一張）
//   （v1.93）P14b 插圖上的字看得清楚：拿掉字再畫（真的畫出來的像素），每一個壓在插圖上的字那一格，每個像素對字色的對比都 ≥ 4.5；
//         量到的字不能是 0 個。版面那一層（插圖檔的像素）是 B18，這一條量 canvas 真的畫出來的
//   （v1.93）P14c 插圖底邊淡進紙色：最後一列跟紙色每個顏色差不到 3；對照：同一張不淡出，最後一列大半不是紙色；
//         淡出只在最下面 56 列（再往上一列，淡出與不淡出兩張一樣）
//   （v1.93）P15 插圖載不到（伺服器回 404）：退回沒有插圖的版面——預覽標 data-art="0"、跟沒插圖那一份逐像素相同、
//         高度是沒插圖那一份（跟有插圖那一份不同）；前置：插圖的請求真的被擋到
//   （v1.93）P16 深色、淺色主題下，海報（全部一張、有插圖）畫出來逐像素相同；前置：主題真的換了（<html> 的 data-theme 與底色都變了）。
//         兩種主題的截圖（頁面最上面那一個畫面＋海報原尺寸）存在 .logs/itinposter-shots/（被 .gitignore 擋掉；只給人看，判定不看它）
//   （v1.93）P17 有插圖時存成圖片：路線圖・全部一張按「存成圖片」（不分享、走下載），下載的那一張寬高＝有插圖那一份＝預覽畫布；
//         前置：預覽標 data-art="1"、有插圖跟沒插圖那一份高度不同（不然量不出來）。P7、P8 在每天一張（本來就沒插圖），驗不到這件
// 不打真網路（共用慣例 §5.6）：Open-Meteo 回自己造的預報，路線服務回自己造的秒數（照直線距離算），其餘外站 503 並記下來。
// 分享與下載：手機的分享換成記錄用的替身（分享得了／分享不了兩種）；下載攔在 <a download>.click()，記下檔名與內容、
//   不真的寫到磁碟（headless 的下載資料夾可能是使用者自己的「下載」）。這兩個是瀏覽器提供的，不是 App 的程式。
// 時區撥到台北（emulateTimezone），日期照那個時區算，不靠今天是哪天。名字、行程都是造的。
// 每一條斷言不管前面成不成都會印（等不到的畫面記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
// 從入口進不來時，直接開海報那一頁，讓後面的照樣量到（P1a 記成 ✗）——一條突變只紅它自己那一條。
// 突變見 tools/mutations/mut_v188ui.json、tools/mutations/mut_v189.json、tools/mutations/mut_v190ui.json、tools/mutations/mut_v193.json。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { clickText, userClick } from './userclick.mjs';
import { texts, textBox, PAGE_CHECKS, pageListProblems, pdfProblems, layoutControls, pdfControls, contrast, DOT_SPEC, readArtPix, ART_MIN } from './itinposterlib.mjs';
import { INK, SUB, PAPER, HEADER_ART } from '../js/itinposter/layout.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5861;
const ORIGIN = `http://localhost:${WEB}`;
const TZ = 'Asia/Taipei';
const TITLE = '合成的台北三日', EMPTY = '合成的空行程', BASE = TITLE;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
// 關掉 2D 畫布的 GPU 加速：畫面上的預覽與另外畫的那一張要用同一套繪製，才能逐像素比。
// 11-14 實測：開著的時候，同一份指令畫兩次，在吉祥物（縮放貼圖）與外框的反鋸齒邊上會有 1～3 個像素各差 1，每次跑不一樣。
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-accelerated-2d-canvas', '--disable-gpu'] });

// ---- 斷言：每一條有固定的編號與說明（突變的 expect 對開頭）；細節放括號裡 ----
const LBL = Object.fromEntries([
  'P0 前置：造好兩趟（一趟 3 天 6 站、5 站對上景點庫、出發日是 2 天後；一趟沒有景點）',
  'P1a 從首頁 → 底部「行程」→「行程」那一格 → 按「做成行程海報」進得來、預覽畫出來了',
  'P1b 進了海報那一頁，底部亮的還是「行程」、只亮一格',
  'P2a 沒有景點的一趟：「行程」那一格沒有「做成行程海報」（前置：那一格有內容）',
  'P2b 沒有景點的一趟直接開海報那一頁：寫「還沒有排景點」、沒有預覽',
  'P3a 預覽跟成品是同一份：畫面上的預覽跟同一份版面另外畫的一張逐像素相同，而且不是空白',
  'P3b 吉祥物真的畫出來了：每天一隻（全部一張 3 天 3 隻），每一隻那一格裡跟底色不同的像素超過 5%',
  'P3c 海報上的吉祥物沒有接縫：每一張、每一隻，邊線附近沒有夾在兩列深色中間的一列淡線（對照：App 分兩層的畫法量得到）',
  'P5a 天氣預報到了會重畫：小提醒放旅程那 3 天、寫哪天查的；預覽換成有預報的那一份（比沒預報的高）',
  'P5b 查天氣只送目的地的座標與固定參數（沒有行程名稱、景點名稱）',
  'P6a 換成「分天色帶」「每天一張」：預覽跟著換、選中的格子標 aria-checked、翻頁寫「第1天 / 共 3 張」',
  'P6b 按「下一張」：換到第 2 天那一張，跟成品同一份',
  'P6c 離開再從行程分頁進來：還是上次選的「分天色帶」「每天一張」',
  'P7a 存成圖片（手機分享得了檔案）：一次分享全部 PNG，檔名照天、尺寸跟預覽那一份一樣，沒有另外下載',
  'P7b 存成圖片（分享不了檔案）：改成下載，張數、檔名、尺寸一樣',
  'P8a 存成 PDF：下載一個 PDF，頁數對、xref 與長度欄位都對、每頁照那一張的比例',
  'P8b 存圖片、存 PDF 的時候沒有任何對外的請求，也沒有任何上傳（POST／PUT）',
  'P9 整段頁面沒有丟出例外',
  'P10a 沒開過行程分頁的一趟直接開海報：不連路線服務，車程與約幾點到留白（不猜）',
  'P10b 開過行程分頁再按進海報：每天一張的約幾點到、車程跟行程分頁畫面上寫的一樣',
  'P11 交通圖示真的畫出來：每一個圖示那一格有深色外框與那一天的顏色、拿掉圖示就量不到；六種都畫過',
  'P12 背景紋理是規則的：有、沒有紋理兩張不一樣的像素全部落在格點上；標題區與頁尾、白框與面板裡一個都沒有',
  'P13 字的對比維持：每一個字那一格的底，有紋理跟沒紋理一模一樣；畫出來的點當底，內文的字對比仍 ≥ 4.5',
  'P14a 頁首插圖真的畫出來：全部一張的預覽用有插圖的版面；插圖那一塊跟拿掉插圖再畫的一張大半不同（路線圖、分天色帶各一張）',
  'P14b 插圖上的字看得清楚：拿掉字再畫，壓在插圖上的每一個字那一格，每個像素對字色的對比都 ≥ 4.5（量到的字不是 0 個）',
  'P14c 插圖底邊淡進紙色：最後一列跟紙色差不到 3（對照：不淡出時大半不是紙色）；淡出只在最下面那幾列',
  'P15 插圖載不到：退回沒有插圖的版面（預覽標沒插圖、跟沒插圖那一份逐像素相同、高度是沒插圖那一份），不留空白',
  'P16 深色、淺色主題下，海報（全部一張、有插圖）畫出來逐像素相同（前置：主題真的換了）',
  'P17 有插圖時存下來的圖：路線圖・全部一張存成圖片，下載的那一張就是有插圖的版面（寬高＝有插圖那一份＝預覽；前置：有插圖跟沒插圖高度不同）',
].map((s) => [s.slice(0, s.indexOf(' ')), s]));
const B1_LABEL = '張數與標籤：全部一張 → 1 張；每天一張 → 天數張、照天排';
for (const [code, label] of [['B1', B1_LABEL], ...PAGE_CHECKS]) LBL[`P4-${code}`] = `P4-${code} ${label}（真的字寬）`;

let pass = 0;
const said = new Set();
// 不採信模式（2026-11-18，「9 條洞」的修法甲，themetrusttest 同一個寫法）：對照組沒過之後設起來，後面每一項照跑、
//   一律印成「✗ 不採信・…」、不算通過、結束碼維持 4。原本是對照組沒過就丟例外、P0 起整份不跑——項數少了，
//   突變執行器（要求項數＝原樣的母體）會判成「沒跑完」。現在項數照舊、執行器規則不動。
let distrust = false;
const say = (code, cond, detail = '', extra = '') => {
  said.add(code);
  const m = LBL[code] + (detail ? `（${detail}）` : '');
  if (distrust) { console.log(`✗ 不採信・${m}（對照組沒過，這一項不判定；檢查器說${cond ? '過' : '不過'}）`); return; }
  if (cond) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 900) : '')); if (process.exitCode !== 4) process.exitCode = 1; }
};
// 一段：裡面丟例外 → 這一段還沒判的每一條記成 ✗（說明照舊，突變的 expect 照樣對得到）
async function section(codes, fn) {
  try { await fn(); } catch (e) { for (const c of codes) if (!said.has(c)) say(c, false, `沒跑到：${e && e.message}`); }
  for (const c of codes) if (!said.has(c)) say(c, false, '這一段沒有判定這一條——測試寫錯');
}
const soft = (p) => p.then(() => true, () => false);
const tap = (page, sel, text) => clickText(page, sel, text).then(() => true, (e) => { console.log('  [點不到]', e.message); return false; });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 近似字寬：只給版面檢查器的對照組用（對照組驗的是檢查器的邏輯，不是排版）
const measure = (t, size, weight = 400) => [...String(t)].reduce((a, ch) => a + (ch.codePointAt(0) < 0x2e80 ? size * 0.58 : size), 0) * (weight >= 700 ? 1.03 : 1);

// PNG 的寬高（IHDR）；不是 PNG → null
function pngDims(head) {
  const u = Uint8Array.from(head || []);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (u.length < 24 || sig.some((b, i) => u[i] !== b) || String.fromCharCode(...u.subarray(12, 16)) !== 'IHDR') return null;
  const dv = new DataView(u.buffer);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

// 自己造的 Open-Meteo 預報：今天前一天到之後 14 天，台北時區的日期；旅程第 2 天（今天 +3）下雨，其餘晴
const dateIn = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + n * 86400000));
function fakeForecast() {
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [],
    precipitation_probability_max: [], snowfall_sum: [], wind_speed_10m_max: [] };
  for (let i = -1; i < 15; i++) {
    const wet = i === 3;
    daily.time.push(dateIn(i));
    daily.weather_code.push(wet ? 63 : 1);
    daily.temperature_2m_max.push(24);
    daily.temperature_2m_min.push(17);
    daily.precipitation_sum.push(wet ? 12 : 0);
    daily.precipitation_probability_max.push(wet ? 80 : 10);
    daily.snowfall_sum.push(0);
    daily.wind_speed_10m_max.push(10);
  }
  return { elevation: 20, timezone: TZ, current: { temperature_2m: 22, weather_code: 1 }, daily };
}
// 自己造的路線矩陣（v1.89）：直線距離 × 每公里秒數＋固定的上下車時間（開車）；網址照 route.js 打的路線服務
const OSRM_RE = /^https:\/\/routing\.openstreetmap\.de\/routed-(car|foot)\/table\/v1\/(driving|foot)\/([^?]+)\?/;
function fakeOsrm(u) {
  const m = OSRM_RE.exec(u);
  const pts = m[3].split(';').map((s) => s.split(',').map(Number));
  const walk = m[2] === 'foot';
  const km = (a, b) => { const R = 6371, r = Math.PI / 180; const dl = (b[1] - a[1]) * r, dg = (b[0] - a[0]) * r;
    const x = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  return { code: 'Ok', durations: pts.map((a) => pts.map((b) => (a === b ? 0 : Math.round(walk ? km(a, b) * 780 : km(a, b) * 110 + 360)))) };
}

// 每一頁一開就裝好：分享的替身、下載攔截、比對畫面的兩個小工具（對照組與檢查走同一份）
function initHooks() {
  window.__shareMode = 'none'; window.__shared = []; window.__dl = [];
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const rec = async (blob, name) => {
    const u = new Uint8Array(await blob.arrayBuffer());
    return { name, type: blob.type, size: u.length, head: Array.from(u.subarray(0, 32)), b64: /\.pdf$/.test(name) ? b64(u) : '' };
  };
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, writable: true,
    value(d) { return window.__shareMode === 'ok' && !!(d && d.files && d.files.length); } });
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true, writable: true,
    async value(d) {
      if (window.__shareMode !== 'ok') throw new DOMException('這次不分享', 'NotAllowedError');
      const files = await Promise.all((d.files || []).map((f) => rec(f, f.name)));
      window.__shared.push({ title: d.title, text: d.text, files });
    } });
  // 記住 blob 網址對到哪一個 Blob：開了請求攔截之後 fetch(blob:) 會回「Failed to fetch」（11-14 實測），所以不去 fetch、直接讀這一份
  const blobs = new Map();
  const mkURL0 = URL.createObjectURL;
  URL.createObjectURL = function (o) { const u = mkURL0.call(URL, o); if (o instanceof Blob) blobs.set(u, o); return u; };
  const click0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && /^blob:/.test(this.href)) {
      const r = { name: this.download, done: false };
      window.__dl.push(r);
      const b0 = blobs.get(this.href);
      (b0 ? Promise.resolve(b0) : Promise.reject(new Error('這個 blob 網址不是 createObjectURL 做的'))).then((b) => rec(b, r.name))
        .then((x) => Object.assign(r, x, { done: true }), (e) => Object.assign(r, { done: true, err: String(e) }));
      return undefined;
    }
    return click0.call(this);
  };
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  window.__ck = {
    // 兩張 canvas 有幾個像素不一樣（RGB 任一不同就算）；大小不一樣回 -1
    diff(a, b) {
      if (a.width !== b.width || a.height !== b.height) return -1;
      const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let n = 0;
      for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n++;
      return n;
    },
    // 不一樣的前幾個像素：座標與兩邊的 RGB（只給失敗訊息用，判定不看它）
    where(a, b, max = 4) {
      if (a.width !== b.width || a.height !== b.height) return [];
      const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      const out = [];
      for (let i = 0; i < x.length && out.length < max; i += 4) {
        if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) {
          const p = i / 4;
          out.push(`(${p % a.width},${Math.floor(p / a.width)}) ${x[i]},${x[i + 1]},${x[i + 2]}≠${y[i]},${y[i + 1]},${y[i + 2]}`);
        }
      }
      return out;
    },
    // 一格裡跟底色不一樣的像素占幾成（三個顏色差的和 > 40 才算）
    inkRatio(cv, box, paper) {
      const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
      const x1 = Math.min(cv.width, Math.round(box.x + box.w)), y1 = Math.min(cv.height, Math.round(box.y + box.h));
      if (x1 <= x0 || y1 <= y0) return 0;
      const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const [pr, pg, pb] = hex(paper);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - pr) + Math.abs(d[i + 1] - pg) + Math.abs(d[i + 2] - pb) > 40) n++;
      return n / (d.length / 4);
    },
    // 一段範圍裡「夾在兩列深色中間的一列淡線」：同一欄，上一列、下一列都深（亮度 < 90），這一列比兩邊都亮 20 以上。
    // 回傳有 3 個以上這種像素的列：[列, 個數]。手掌深色外框上的接縫（兩層在交接處各自反鋸齒）就是這個樣子
    seams(cv, x0, x1, r0, r1) {
      x0 = Math.max(0, Math.round(x0)); x1 = Math.min(cv.width, Math.round(x1));
      r0 = Math.max(1, Math.round(r0)); r1 = Math.min(cv.height - 1, Math.round(r1));
      if (x1 <= x0 || r1 <= r0) return [];
      const W = x1 - x0;
      const d = cv.getContext('2d').getImageData(x0, r0 - 1, W, r1 - r0 + 2).data;
      const L = (x, r) => { const i = ((r - r0 + 1) * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
      const out = [];
      for (let r = r0; r < r1; r++) {
        let n = 0;
        for (let x = 0; x < W; x++) { const a = L(x, r - 1), b = L(x, r + 1), c = L(x, r); if (a < 90 && b < 90 && c - Math.max(a, b) > 20) n++; }
        if (n >= 3) out.push([r, n]);
      }
      return out;
    },
    // （v1.90）一格裡深色（亮度 < 90）的像素占幾成：交通圖示的 INK 外框
    darkRatio(cv, box) {
      const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
      const x1 = Math.min(cv.width, Math.round(box.x + box.w)), y1 = Math.min(cv.height, Math.round(box.y + box.h));
      if (x1 <= x0 || y1 <= y0) return 0;
      const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 90) n++;
      return n / (d.length / 4);
    },
    // （v1.90）一格裡接近某個顏色（三個顏色差的和 ≤ 30）的像素占幾成：交通圖示裡那一天的顏色
    colorRatio(cv, box, color) {
      const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
      const x1 = Math.min(cv.width, Math.round(box.x + box.w)), y1 = Math.min(cv.height, Math.round(box.y + box.h));
      if (x1 <= x0 || y1 <= y0) return 0;
      const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const [r, g, b] = hex(color);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) <= 30) n++;
      return n / (d.length / 4);
    },
    // （v1.90）有紋理（a）、沒紋理（b）兩張比，不一樣的像素在哪裡。格點：第 j 列 y＝step/2＋j·step、x＝step/2＋i·step（奇數列再加 step/2）。
    // 回傳 n（不一樣的像素）、pts（有不一樣的格點幾個）、off（離最近的格點超過 r＋1.5 的像素）、inClear、inCover（落在那幾塊裡的像素）、
    // dot（b 那一張是純紙色、而且就在格點正中的像素，a 那一張最深的顏色——畫出來的點本身的顏色）
    dotDiff(a, b, step, r, paper, clear = [], cover = []) {
      const out = { n: 0, pts: 0, off: 0, inClear: 0, inCover: 0, dot: '', dotN: 0 };
      if (a.width !== b.width || a.height !== b.height) { out.n = -1; return out; }
      const W = a.width, H = a.height;
      const x = a.getContext('2d').getImageData(0, 0, W, H).data, y = b.getContext('2d').getImageData(0, 0, W, H).data;
      const [pr, pg, pb] = hex(paper);
      const pts = new Set();
      const inR = (q, px, py) => px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h;
      let dl = 999;
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const i = (py * W + px) * 4;
          if (x[i] === y[i] && x[i + 1] === y[i + 1] && x[i + 2] === y[i + 2]) continue;
          out.n++;
          const cx = px + 0.5, cy = py + 0.5;
          let best = Infinity, key = '';
          const j0 = Math.round((cy - step / 2) / step);
          for (let j = Math.max(0, j0 - 1); j <= j0 + 1; j++) {
            const o = step / 2 + (j % 2 ? step / 2 : 0), k0 = Math.round((cx - o) / step);
            for (let k = k0 - 1; k <= k0 + 1; k++) {
              const d = Math.hypot(cx - (o + k * step), cy - (step / 2 + j * step));
              if (d < best) { best = d; key = `${j}:${k}`; }
            }
          }
          if (best > r + 1.5) out.off++; else pts.add(key);
          if (clear.some((q) => inR(q, px, py))) out.inClear++;
          if (cover.some((q) => inR(q, px, py))) out.inCover++;
          if (best < 0.8 && y[i] === pr && y[i + 1] === pg && y[i + 2] === pb) {
            out.dotN++;
            const L = 0.299 * x[i] + 0.587 * x[i + 1] + 0.114 * x[i + 2];
            if (L < dl) { dl = L; out.dot = '#' + [x[i], x[i + 1], x[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); }
          }
        }
      }
      out.pts = pts.size;
      return out;
    },
    // （v1.90）兩張在一格裡有幾個像素不一樣（P13：拿掉字之後，每一個字那一格的底）
    diffIn(a, b, box) {
      const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
      const x1 = Math.min(a.width, Math.ceil(box.x + box.w)), y1 = Math.min(a.height, Math.ceil(box.y + box.h));
      if (x1 <= x0 || y1 <= y0) return 0;
      const p = a.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data, q = b.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++;
      return n;
    },
    // （v1.93）一格裡每個像素對某個字色的對比，最差的那一個（WCAG 相對亮度，跟 itinposterlib 的 luminance 同一條公式）；n＝量了幾個像素
    minContrast(cv, box, color) {
      const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
      const x1 = Math.min(cv.width, Math.ceil(box.x + box.w)), y1 = Math.min(cv.height, Math.ceil(box.y + box.h));
      if (x1 <= x0 || y1 <= y0) return { min: null, n: 0 };
      const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const [cr, cg, cb] = hex(color), lt = lum(cr, cg, cb);
      let min = Infinity, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = lum(d[i], d[i + 1], d[i + 2]);
        const c = (Math.max(l, lt) + 0.05) / (Math.min(l, lt) + 0.05);
        n++;
        if (c < min) min = c;
      }
      return { min, n };
    },
    // （v1.93）每一列的雜湊（只算 RGB）：P16 跨頁面比兩張海報（換主題要整頁重開，canvas 留不住，只帶得走這個）
    rowHashes(cv) {
      if (!cv || !cv.width || !cv.height) return [];
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const rows = [];
      for (let y = 0; y < cv.height; y++) {
        let h = 0x811c9dc5;
        for (let i = y * cv.width * 4, e = i + cv.width * 4; i < e; i++) { if ((i & 3) === 3) continue; h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
        rows.push(h);
      }
      return rows;
    },
    // （v1.93）第 y 列跟某個顏色差多少：max＝每個像素三個顏色差裡最大的那一個，取全列最大；far＝三個顏色差的和 > 40 的像素占幾成
    rowDev(cv, y, color) {
      const yy = Math.round(y);
      if (yy < 0 || yy >= cv.height || !cv.width) return { max: -1, far: -1 };
      const d = cv.getContext('2d').getImageData(0, yy, cv.width, 1).data;
      const [r, g, b] = hex(color);
      let max = 0, far = 0;
      for (let i = 0; i < d.length; i += 4) {
        const dr = Math.abs(d[i] - r), dg = Math.abs(d[i + 1] - g), db = Math.abs(d[i + 2] - b);
        max = Math.max(max, dr, dg, db);
        if (dr + dg + db > 40) far++;
      }
      return { max, far: far / cv.width };
    },
  };
}

// art：頁首插圖的請求（v1.93；有 SW 在控制時插圖從 SW 的快取拿、這裡看不到——P15 先繞過 SW）；artBlock 開著時回 404（P15「載不到」）
const net = { outside: [], writes: [], meteo: [], osrm: [], art: [], artBlock: false };
const pageErrors = [];
async function open() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror]', e.message); });
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateTimezone(TZ);
  await page.evaluateOnNewDocument(initHooks);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url(), m = req.method();
    if (!/^(GET|HEAD|OPTIONS)$/.test(m)) net.writes.push(`${m} ${u}`);
    if (u.startsWith(ORIGIN) && u.includes('/media/art/d/')) {
      net.art.push(net.artBlock ? `擋 ${u}` : u);
      if (net.artBlock) { req.respond({ status: 404, contentType: 'text/plain', body: '' }).catch(() => {}); return; }
    }
    if (u.startsWith(ORIGIN) || /^(data|blob):/.test(u)) { req.continue().catch(() => {}); return; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/.test(u)) {
      net.meteo.push(u);
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeForecast()) }).catch(() => {});
      return;
    }
    if (OSRM_RE.test(u)) {
      net.osrm.push(u);
      req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fakeOsrm(u)) }).catch(() => {});
      return;
    }
    net.outside.push(u);
    req.respond({ status: 503, contentType: 'text/plain', body: '' }).catch(() => {});
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await soft(page.waitForSelector('.hero', { timeout: 20000 }));
  return page;
}

// 從首頁一路點到海報那一頁（使用者的路）。進不來就直接開那一頁（讓後面的照樣量到），回傳進不來的理由
async function enterPoster(page, title, tid) {
  let why = '';
  const ok = await (async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    if (!await soft(page.waitForSelector('.trip-card', { timeout: 15000 }))) { why = '首頁沒有旅程卡'; return false; }
    if (!await tap(page, '.trip-card', title)) { why = '點不到旅程卡'; return false; }
    if (!await soft(page.waitForSelector('.trip-home', { timeout: 15000 }))) { why = '沒進到主頁'; return false; }
    if (!await tap(page, '#tabbar a.tab', '行程')) { why = '點不到底部「行程」'; return false; }
    if (!await soft(page.waitForSelector('.itin-page .itin-seg', { timeout: 15000 }))) { why = '沒進到行程分頁'; return false; }
    if (!await tap(page, '.itin-seg button', '行程')) { why = '點不到「行程」那一格'; return false; }
    if (!await soft(page.waitForSelector('#itin-pane-plan .itin-edit', { visible: true, timeout: 15000 }))) { why = '「行程」那一格沒有內容'; return false; }
    // v1.89：等行程那一格把「約幾點到」補上（路線服務的車程進了快取）再按海報——海報只讀快取，
    // 按得比車程回來還快，預覽與後面另外收的那一份會差在車程上（看行程的人也是先看到這些再去做海報）。等不到不算失敗
    await soft(page.waitForFunction(() => document.querySelectorAll('#itin-pane-plan .tl-eta').length > 0, { timeout: 8000 }));
    const btn = await page.$('#itin-pane-plan .itin-poster-btn');
    if (!btn) { why = '「行程」那一格沒有「做成行程海報」'; return false; }
    const k = await userClick(page, btn, '「做成行程海報」');
    if (!k.ok) { why = k.why; return false; }
    return true;
  })().catch((e) => { why = String(e && e.message); return false; });
  if (!ok) await page.evaluate((t) => { location.hash = `#/trip/${t}/itinposter`; }, tid);
  const drawn = await soft(page.waitForFunction(() => {
    const c = document.querySelector('.poster-canvas');
    return !!c && c.dataset.page != null && c.width > 0;
  }, { timeout: 20000 }));
  await sleep(300);
  const st = await page.evaluate(() => ({ hash: location.hash, active: [...document.querySelectorAll('#tabbar a.tab.active')].map((a) => a.textContent.trim()) }));
  return { ok, why, drawn, ...st };
}

// 海報那一頁現在的狀態：版型、張數、第幾張、選中的格子、翻頁那一列
const segState = (page) => page.evaluate(() => {
  const cv = document.querySelector('.poster-canvas');
  const on = (key) => [...document.querySelectorAll(`.ip-seg[data-key="${key}"] button`)].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent);
  const pager = document.querySelector('.pager');
  const btn = (t) => [...document.querySelectorAll('.pager-btn')].find((b) => b.textContent.includes(t));
  const vis = (el) => !!el && el.checkVisibility({ visibilityProperty: true });
  return {
    kind: cv && cv.dataset.kind, split: cv && cv.dataset.split, page: cv && cv.dataset.page,
    kindOn: on('kind'), splitOn: on('split'), pagerShown: vis(pager),
    label: (document.querySelector('.pager-lbl') || {}).textContent || '', prev: vis(btn('前一張')), next: vis(btn('下一張')),
  };
});
const waitShown = (page, kind, split, pg = '0') => soft(page.waitForFunction((k, s, p) => {
  const c = document.querySelector('.poster-canvas');
  return !!c && c.dataset.kind === k && c.dataset.split === s && c.dataset.page === p;
}, { timeout: 15000 }, kind, split, pg)).then(async (x) => { await sleep(400); return x; });

// 畫面上的預覽是哪一份：用同一份版面（有預報、沒預報各一份）另外畫一張，逐像素比；也量吉祥物那一格
const matchShown = (page, tid) => page.evaluate(async (tid) => {
  const ip = await import('./js/itinposter/index.js');
  const { PAPER } = await import('./js/itinposter/layout.js');
  const cv = document.querySelector('.poster-canvas');
  const kind = cv.dataset.kind, split = cv.dataset.split, idx = Number(cv.dataset.page);
  // v1.93：畫面標了有沒有頁首插圖（data-art），另外畫的那一張照它排——標的跟實際排的不一樣，就認不出是哪一份
  const art = cv.dataset.art === '1';
  const f = await ip.tripForecast(tid);
  const out = { kind, split, idx, art: cv.dataset.art, w: cv.width, h: cv.height, variants: [] };
  for (const [name, fc] of [['有預報', f], ['沒預報', null]]) {
    const m = await ip.gatherModel(tid, { forecast: fc });
    const pages = ip.renderPages(m, { kind, split, art });
    const pg = pages[idx];
    const off = document.createElement('canvas');
    if (pg) await ip.drawPoster(off, pg);
    const diff = pg ? window.__ck.diff(off, cv) : -1;
    out.variants.push({ name, n: pages.length, dims: pages.map((p) => [p.w, p.h]), labels: pages.map((p) => p.label), diff,
      where: diff > 0 && diff < 1000 ? window.__ck.where(off, cv).map((s) => {
        const [x, y] = s.slice(1, s.indexOf(')')).split(',').map(Number);
        const inBox = pg.boxes.filter((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h).map((b) => b.kind);
        return `${s} 落在［${inBox.join('、') || '沒有框'}］`;
      }) : [],
      tips: m.tips.length, days: split === 'one' ? m.days.length : 1, mascots: pg ? pg.boxes.filter((b) => b.kind === 'peek') : [] });
  }
  const hit = out.variants.find((v) => v.diff === 0) || null;
  out.match = hit ? hit.name : '';
  out.ink = window.__ck.inkRatio(cv, { x: 0, y: 0, w: cv.width, h: cv.height }, PAPER);
  out.days = hit ? hit.days : 0;
  out.mascotInk = hit ? hit.mascots.map((b) => +window.__ck.inkRatio(cv, b, PAPER).toFixed(3)) : [];
  return out;
}, tid);
const variantOf = (c) => (c && c.variants.find((v) => v.name === c.match)) || null;

// 等天氣預報到了、重畫完：預覽的高變成「有預報、照畫面標的有沒有插圖」那一份的高；等不到就照當下的比（P5a 會記）
async function settle(page, tid) {
  const wantH = await page.evaluate(async (tid) => {
    const ip = await import('./js/itinposter/index.js');
    const cv = document.querySelector('.poster-canvas');
    const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
    return ip.renderPages(m, { kind: cv.dataset.kind, split: cv.dataset.split, art: cv.dataset.art === '1' })[Number(cv.dataset.page)].h;
  }, tid);
  const ok = await soft(page.waitForFunction((h) => { const c = document.querySelector('.poster-canvas'); return !!c && c.height === h; }, { timeout: 12000 }, wantH));
  await sleep(400);
  return ok;
}
// 開海報那一頁、等畫出來（canvas 有 data-page、有寬）
const waitDrawn = (page, ms = 20000) => soft(page.waitForFunction(() => {
  const c = document.querySelector('.poster-canvas');
  return !!c && c.dataset.page != null && c.width > 0;
}, { timeout: ms }));

let S = null;            // 造好的資料
let P3 = null;           // 第一次進來時預覽是哪一份（P5a 用）
let page = null;
let shownBefore = null;  // P6 之後、存檔之前，預覽是哪一份（P7、P8 跟它比）

try {
  page = await open();
  // ================= 對照組（先跑；任何一個沒過就停、不採信後面的結果） =================
  let ctlOk = true;
  const ctl = (label, got, want) => {
    const good = same(got, want);
    if (good) { pass++; console.log(`✓ 對照組（${label}）`); }
    else { console.log(`✗ 對照組（${label}）\n   實得 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`); }
    ctlOk = ctlOk && good;
  };
  const env = await page.evaluate(async () => {
    const { LEG_ICON, LEG_LABEL } = await import('./js/legs.js');
    const { wxIcon } = await import('./js/weather.js');
    const th = await (await import('./js/theme.js')).loadThemes();
    return { labels: Object.values(th.themes).map((t) => t.label), wxIcon: wxIcon(63),
      foodEmoji: th.themes.food.emoji, foodLabel: th.themes.food.label, legEmoji: `${LEG_ICON.car} ${LEG_LABEL.car}` };
  });
  const LABELS = new Set(env.labels);
  layoutControls(ctl, { measure, foodEmoji: env.foodEmoji, foodLabel: env.foodLabel, legEmoji: env.legEmoji, wxIcon: env.wxIcon, labels: LABELS });
  pdfControls(ctl);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 44, 0, 0, 0, 200, 8, 6, 0, 0, 0];
  ctl('PNG 尺寸：合成的 300×200 檔頭', pngDims(sig), { w: 300, h: 200 });
  ctl('PNG 尺寸：檔頭不是 PNG', pngDims([0, ...sig.slice(1)]), null);
  ctl('畫面比對：一樣的兩張 0 個像素不同、改一個像素抓到 1 個、大小不同回 -1', await page.evaluate(() => {
    const mk = (w = 20) => { const c = document.createElement('canvas'); c.width = w; c.height = 20; const x = c.getContext('2d'); x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, w, 20); x.fillStyle = '#333'; x.fillRect(5, 5, 6, 6); return c; };
    const a = mk(), b = mk(), c = mk();
    const cx = c.getContext('2d'); cx.fillStyle = '#ff0000'; cx.fillRect(15, 15, 1, 1);
    return { same: window.__ck.diff(a, b), one: window.__ck.diff(a, c), size: window.__ck.diff(a, mk(21)) };
  }), { same: 0, one: 1, size: -1 });
  ctl('墨水比例：一格裡只有底色是 0、畫一塊 50×50 是 0.25', await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d');
    x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, 200, 200);
    const box = { x: 50, y: 50, w: 100, h: 100 };
    const blank = window.__ck.inkRatio(c, box, '#fbf6ec');
    x.fillStyle = '#333'; x.fillRect(60, 60, 50, 50);
    return { blank, drawn: window.__ck.inkRatio(c, box, '#fbf6ec') };
  }), { blank: 0, drawn: 0.25 });
  ctl('接縫：深色塊中間一列淡線抓到那一列、整塊深色抓不到、淡線夾在底色中間（不是深色）抓不到', await page.evaluate(() => {
    const mk = (fill) => { const c = document.createElement('canvas'); c.width = 40; c.height = 20; const x = c.getContext('2d'); x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, 40, 20); fill(x); return c; };
    const seam = mk((x) => { x.fillStyle = '#2f2c2a'; x.fillRect(10, 5, 20, 10); x.fillStyle = '#615f5c'; x.fillRect(12, 9, 10, 1); });
    const solid = mk((x) => { x.fillStyle = '#2f2c2a'; x.fillRect(10, 5, 20, 10); });
    const onPaper = mk((x) => { x.fillStyle = '#ffffff'; x.fillRect(12, 9, 10, 1); });
    return { seam: window.__ck.seams(seam, 0, 40, 2, 18), solid: window.__ck.seams(solid, 0, 40, 2, 18), onPaper: window.__ck.seams(onPaper, 0, 40, 2, 18) };
  }), { seam: [[9, 10]], solid: [], onPaper: [] });
  // v1.90：P11、P12、P13 用的量法。合成的畫布由這裡自己畫（不用被測的 draw.js），規則的格子照 dotDiff 註解寫的那一種
  const ctl190 = await page.evaluate((step, r) => {
    const P = '#fbf6ec', W = 360, H = 360;
    const mk = (fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = P; x.fillRect(0, 0, W, H); if (fn) fn(x); return c; };
    const dots = (x, color, jitter = 0) => {
      x.fillStyle = color;
      let s = 7;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
      for (let j = 0, yy = step / 2; yy < H; j++, yy += step) for (let xx = step / 2 + (j % 2 ? step / 2 : 0); xx < W; xx += step) {
        x.beginPath(); x.arc(xx + jitter * rnd(), yy + jitter * rnd(), r, 0, Math.PI * 2); x.fill();
      }
    };
    const plain = mk();
    const reg = window.__ck.dotDiff(mk((x) => dots(x, '#ede2cc')), plain, step, r, P, [], []);
    const jit = window.__ck.dotDiff(mk((x) => dots(x, '#ede2cc', 14)), plain, step, r, P, [], []);
    const white = { x: 100, y: 100, w: 150, h: 120 };
    const under = mk((x) => { dots(x, '#ede2cc'); x.fillStyle = '#ffffff'; x.fillRect(white.x, white.y, white.w, white.h); });
    const underRef = mk((x) => { x.fillStyle = '#ffffff'; x.fillRect(white.x, white.y, white.w, white.h); });
    const over = mk((x) => { x.fillStyle = '#ffffff'; x.fillRect(white.x, white.y, white.w, white.h); dots(x, '#ede2cc'); });
    const cov = [{ x: 108, y: 108, w: 134, h: 104 }];
    const dark = window.__ck.dotDiff(mk((x) => dots(x, '#d0c2a8')), plain, step, r, P, [], []);
    const tb = { x: 10, y: 10, w: 40, h: 20 };
    return {
      reg: { off: reg.off, many: reg.pts >= 80, dot: reg.dot },
      jit: { off: jit.off > 0 },
      under: { inCover: window.__ck.dotDiff(under, underRef, step, r, P, [], cov).inCover },
      over: { inCover: window.__ck.dotDiff(over, underRef, step, r, P, [], cov).inCover > 0 },
      dark: dark.dot,
      textBg: { clean: window.__ck.diffIn(plain, plain, tb), dotted: window.__ck.diffIn(mk((x) => dots(x, '#ede2cc')), plain, tb) > 0 },
      icon: { blank: window.__ck.darkRatio(plain, tb), inked: window.__ck.darkRatio(mk((x) => { x.strokeStyle = '#2f2c2a'; x.lineWidth = 4; x.strokeRect(14, 14, 30, 12); }), tb) > 0.04,
        col: window.__ck.colorRatio(mk((x) => { x.fillStyle = '#c9423c'; x.fillRect(10, 10, 20, 20); }), tb, '#c9423c') },
    };
  }, DOT_SPEC.step, DOT_SPEC.r);
  ctl('紋理量法：規則的格子不一樣的像素都在格點上、格點很多、點的顏色量得到', ctl190.reg, { off: 0, many: true, dot: '#ede2cc' });
  ctl('紋理量法：亂數抖動的點抓到離格點太遠的像素', ctl190.jit, { off: true });
  ctl('紋理量法：點被白框蓋住，白框裡 0 個不一樣；點畫在白框上面抓得到', { under: ctl190.under.inCover, over: ctl190.over.inCover }, { under: 0, over: true });
  ctl('對比量法：點換深，量到的點顏色壓灰字不到 4.5；淡的那一種 ≥ 4.5', { dark: contrast(SUB, ctl190.dark || '#000000') < 4.5, light: contrast(SUB, ctl190.reg.dot || '#000000') >= 4.5 }, { dark: true, light: true });
  ctl('字底量法：兩張一樣 0 個像素不同、點落在那一格抓到', ctl190.textBg, { clean: 0, dotted: true });
  ctl('圖示量法：空白那一格沒有深色、畫了外框有、那一天的顏色量得到', { blank: ctl190.icon.blank, inked: ctl190.icon.inked, col: ctl190.icon.col }, { blank: 0, inked: true, col: 0.5 });
  // v1.93：P14、P16 用的量法。合成的畫布由這裡自己畫（不用被測的 draw.js）
  const ctl193 = await page.evaluate((ink, paper) => {
    const mk = (w, h, bg, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, w, h); if (fn) fn(x); return c; };
    const box = { x: 5, y: 5, w: 20, h: 10 };
    const white = window.__ck.minContrast(mk(40, 20, '#ffffff'), box, ink);
    const dot = window.__ck.minContrast(mk(40, 20, '#ffffff', (x) => { x.fillStyle = ink; x.fillRect(12, 8, 1, 1); }), box, ink);
    const outside = window.__ck.minContrast(mk(40, 20, '#ffffff'), { x: 50, y: 5, w: 10, h: 10 }, ink);
    const clean = window.__ck.rowDev(mk(40, 4, paper), 1, paper);
    const part = window.__ck.rowDev(mk(40, 4, paper, (x) => { x.fillStyle = '#2f2c2a'; x.fillRect(0, 1, 10, 1); }), 1, paper);
    const off = window.__ck.rowDev(mk(40, 4, paper), 9, paper);
    const ra = window.__ck.rowHashes(mk(30, 6, paper)), rb = window.__ck.rowHashes(mk(30, 6, paper));
    const rc = window.__ck.rowHashes(mk(30, 6, paper, (x) => { x.fillStyle = '#fbf6ed'; x.fillRect(17, 4, 1, 1); }));
    return {
      contrast: { white: { n: white.n, min: +white.min.toFixed(2) }, dot: { n: dot.n, min: dot.min }, outside: outside.n },
      row: { clean, part, off: off.max },
      hash: { rows: ra.length, same: ra.filter((h, i) => h !== rb[i]).length, one: ra.map((h, i) => (h !== rc[i] ? i : -1)).filter((i) => i >= 0) },
    };
  }, INK, PAPER);
  ctl('對比量法（插圖上的字）：白底對黑字跟公式算的一樣、一格裡有一個字色的像素就是 1、格子在畫布外量不到', ctl193.contrast,
    { white: { n: 200, min: +contrast('#ffffff', INK).toFixed(2) }, dot: { n: 200, min: 1 }, outside: 0 });
  ctl('紙色量法（插圖底邊）：整列紙色差 0、一列裡 10/40 是深色抓到四分之一、列在畫布外回 -1', ctl193.row,
    { clean: { max: 0, far: 0 }, part: { max: 204, far: 0.25 }, off: -1 });
  ctl('列雜湊（兩種主題比）：一樣的兩張 0 列不同、改一個像素（只差 1）抓到那一列', ctl193.hash, { rows: 6, same: 0, one: [4] });
  await page.evaluate(() => Promise.allSettled([fetch('https://ctl.invalid/x'), fetch('/ctl-post', { method: 'POST', body: 'x' })]));
  await sleep(300);
  ctl('網路紀錄：外站與上傳都記得到', { outside: net.outside.filter((u) => u.includes('ctl.invalid')).length, writes: net.writes.filter((w) => /^POST .*\/ctl-post$/.test(w)).length }, { outside: 1, writes: 1 });
  ctl('下載攔截：記得到檔名、大小、種類', await page.evaluate(async () => {
    window.__dl = [];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['abc'], { type: 'text/plain' })); a.download = 'ctl.txt';
    document.body.append(a); a.click(); a.remove();
    for (let i = 0; i < 60 && !(window.__dl[0] && window.__dl[0].done); i++) await new Promise((r) => setTimeout(r, 50));
    const d = window.__dl[0]; window.__dl = [];
    return d ? { name: d.name, size: d.size, type: d.type, ...(d.err ? { err: d.err } : {}) } : null;
  }), { name: 'ctl.txt', size: 3, type: 'text/plain' });
  net.outside.length = 0; net.writes.length = 0;
  if (!ctlOk) {
    console.log('✗ 對照組沒過——檢查器壞了，下面每一項照跑、一律印成「不採信」（項數照舊）');
    process.exitCode = 4;
    distrust = true;
  }

  // ================= P0 造資料 =================
  await section(['P0'], async () => {
    S = await page.evaluate(async (tz) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const { generateForTrip } = await import('./js/quests/generate.js');
      const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + n * 86400000));
      const g = uuid(), t = uuid(), e = uuid();
      await s.put({ id: g, type: 'group', name: 'g' });
      let ct = 1;
      for (const nm of ['小美', '阿明', '小華']) await s.put({ id: uuid(), type: 'member', groupId: g, displayName: nm, createdAt: ct++ });   // 合成的名字
      await s.put({ id: t, type: 'trip', groupId: g, title: '合成的台北三日', region: '台北', allowWiki: false, startDate: day(2), endDate: day(4) });
      await s.put({ id: e, type: 'trip', groupId: g, title: '合成的空行程', region: '台北', allowWiki: false, startDate: day(10), endDate: day(11) });
      const items = [[1, '士林夜市'], [1, '巷口麵店'], [1, '饒河街觀光夜市'], [2, '九份老街'], [3, '士林夜市'], [3, '寧夏夜市']].map(([d, name]) => ({ name, day: d, region: '台北' }));
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items });
      const shilin = spots.find((x) => x.day === 1 && x.placeId === 'taipei-shilin-nm');
      const alley = spots.find((x) => x.name === '巷口麵店');
      if (alley) { alley.startMin = 570; if (shilin) { alley.legFrom = shilin.id; alley.legMode = 'car'; } }
      // v1.89 第 3 天：士林夜市 18:00 到、停 1 小時 30 分，開車去寧夏夜市——路線服務算得出車程，寧夏夜市就推得出「約幾點到」（P10b）
      const sl3 = spots.find((x) => x.day === 3 && x.placeId === 'taipei-shilin-nm');
      const nx3 = spots.find((x) => x.day === 3 && x.name === '寧夏夜市');
      if (sl3 && nx3) { sl3.startMin = 1080; sl3.stayMin = 90; nx3.legFrom = sl3.id; nx3.legMode = 'car'; }
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
      return { g, t, e, n: spots.length, curated: spots.filter((x) => x.source === 'curated').length, xy: spots.filter((x) => x.lat != null && x.lng != null).length,
        start: day(2), today: day(0), alleyAuto: !!alley && alley.source !== 'curated', day3: !!(sl3 && nx3 && nx3.lat != null && sl3.lat != null), emptySpots: s.spotsOf(e).length };
    }, TZ);
    say('P0', S.n === 6 && S.curated === 5 && S.xy >= 5 && S.alleyAuto && S.day3 && S.start === dateIn(2) && S.today === dateIn(0) && S.emptySpots === 0,
      `${S.n} 站、${S.curated} 站對上景點庫、${S.xy} 站有座標、第 3 天兩站都有座標 ${S.day3}、出發日 ${S.start}；空的那一趟 ${S.emptySpots} 站`);
  });

  // ================= P1 入口 =================
  await section(['P1a', 'P1b'], async () => {
    const r = await enterPoster(page, TITLE, S.t);
    say('P1a', r.ok && r.drawn && r.hash === `#/trip/${S.t}/itinposter`, r.ok ? `網址 ${r.hash.replace(S.t, '<這一趟>')}` : `進不來：${r.why}`);
    say('P1b', r.drawn && r.active.length === 1 && r.active[0].includes('行程'), `亮的是 ${JSON.stringify(r.active)}`);
  });

  // ================= P3 預覽＝成品、吉祥物 =================
  await section(['P3a', 'P3b'], async () => {
    await settle(page, S.t);
    const c = await matchShown(page, S.t);
    say('P3a', c.match !== '' && c.ink > 0.05,
      `${c.kind}/${c.split} 第 ${c.idx + 1} 張 ${c.w}×${c.h}；${c.match ? `跟「${c.match}」那一份逐像素相同` : `兩份都不同：${c.variants.map((v) => `${v.name} ${v.diff}${v.where.length ? `〔另畫≠預覽：${v.where.join('；')}〕` : ''}`).join('、')}`}；跟底色不同的占 ${c.ink.toFixed(2)}`);
    say('P3b', c.days === 3 && c.mascotInk.length === c.days && c.mascotInk.every((r) => r > 0.05), `${c.days} 天、吉祥物 ${c.mascotInk.length} 隻，每一隻那一格跟底色不同的占 ${c.mascotInk.join('、')}`);
    P3 = c;
  });

  // ================= P3c 吉祥物沒有接縫（v1.89） =================
  await section(['P3c'], async () => {
    const r = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const pk = await import('./js/peeks.js');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      const out = { pages: 0, peeks: 0, rows: [], ctl: [], ctlN: 0, ctlErr: [] };
      // 量哪一段：兩層的交接處——App 的畫法下層從邊線往上 1 個畫布單位開始、上層到邊線為止——往上多 2 px、往下 2 px。
      // 不量更上面：烤串那張在邊線往上約 4 個單位，扣子與吊帶的外框之間本來就有一條細縫（peekFlat 與 peek 都有，
      // 2026-11-14 量過：k 1.39 時同一列 8 個像素，兩種畫法一樣），那是圖本身，不是接縫
      const band = (edge, k) => [edge - k - 2, edge + 2];
      // 海報真的畫出來的每一張：每一隻吉祥物（v1.93：全部一張照畫面那樣帶頁首插圖）
      const art = await ip.headerArtReady();
      for (const [kind, split] of [['route', 'one'], ['route', 'day'], ['band', 'one'], ['band', 'day']]) {
        for (const pg of ip.renderPages(m, { kind, split, art })) {
          const cv = document.createElement('canvas');
          await ip.drawPoster(cv, pg);
          out.pages++;
          for (const o of pg.ops.filter((x) => x.op === 'peek')) {
            out.peeks++;
            const s = window.__ck.seams(cv, o.x, o.x + o.w, ...band(o.edge, o.k));
            if (s.length) out.rows.push(`${kind}/${split} 第 ${o.day} 天 ${o.kind}（k ${o.k.toFixed(2)}）：${s.map(([y, n]) => `第 ${y} 列 ${n} 個`).join('、')}`);
          }
        }
      }
      // 對照：App 的 peek()（分上下兩層）拿掉白邊，照海報同一條路（序列化 → 圖片 → 畫到畫布）畫成海報上的大小，同一個量法要量得到
      const load = (el) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im); im.onerror = () => rej(new Error('載不到'));
        im.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], { type: 'image/svg+xml' }));
      });
      for (const kind of pk.PEEK_KINDS) for (const k of [1.9, 2.4]) {
        try {
          const el = pk.peek(kind, k);
          el.querySelectorAll('[filter]').forEach((g) => g.removeAttribute('filter'));
          const im = await load(el);
          const cv = document.createElement('canvas');
          cv.width = Math.round(im.width); cv.height = Math.round(im.height);
          const x = cv.getContext('2d'); x.fillStyle = '#fbf6ec'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height);
          const E = pk.peekGeom(kind).rise * k;
          out.ctlN++;
          if (window.__ck.seams(cv, 0, cv.width, ...band(E, k)).length) out.ctl.push(`${kind}×${k}`);
        } catch (e) { out.ctlErr.push(`${kind}×${k}：${e.message}`); }
      }
      return out;
    }, S.t);
    say('P3c', r.pages >= 8 && r.peeks >= 12 && r.rows.length === 0 && r.ctl.length > 0 && r.ctlErr.length === 0,
      `海報 ${r.pages} 張、吉祥物 ${r.peeks} 隻，有接縫的 ${r.rows.length} 隻；對照（App 分兩層的畫法）${r.ctlN} 張裡量到接縫的 ${r.ctl.length} 張：${r.ctl.join('、') || '沒有——量法量不到這種缺陷'}`,
      [...r.rows, ...r.ctlErr].join('\n   '));
  });

  // ================= P4 真的字寬排出來的版面 =================
  const P4CODES = ['P4-B1', ...PAGE_CHECKS.map(([code]) => `P4-${code}`)];
  await section(P4CODES, async () => {
    const R = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      // v1.93：插圖載得到時照畫面那樣排（全部一張帶頁首插圖）；載不到 art 是 false，下面每一條都記成 ✗（前置不成立）
      const art = await ip.headerArtReady();
      return { m, art, sets: [['route', 'one'], ['route', 'day'], ['band', 'one'], ['band', 'day']].map(([kind, split]) => ({ kind, split, art, pages: ip.renderPages(m, { kind, split, art }) })) };
    }, S.t);
    const sets = R.sets.map((x) => ({ ...x, m: R.m }));
    const all = sets.flatMap((x) => x.pages.map((pg, i) => ({ x, pg, i })));
    const nText = all.reduce((a, p) => a + texts(p.pg).length, 0);
    const where = `${sets.length} 組、${all.length} 張、${nText} 個字；頁首插圖${R.art === true ? '載得到' : '載不到（前置不成立）'}`;
    const b1 = sets.flatMap((x) => pageListProblems(x).map((b) => `${x.kind}/${x.split}：${b}`));
    say('P4-B1', all.length > 0 && R.art === true && b1.length === 0, where, b1.join('\n   '));
    // B18 的插圖分支量插圖檔的像素：讀 repo 裡那一張（跟瀏覽器載的是同一個檔）
    const OPTS = { labels: LABELS, artPix: { [HEADER_ART.src]: await readArtPix(path.join(ROOT, HEADER_ART.src)) } };
    for (const [code, , fn] of PAGE_CHECKS) {
      const bad = [];
      for (const p of all) {
        let r;
        try { r = fn(p.x, p.pg, p.i, OPTS); } catch (e) { r = [`檢查時例外：${e.message}`]; }
        for (const b of r) bad.push(`${p.x.kind}/${p.x.split} 第 ${p.i + 1} 張：${b}`);
      }
      say(`P4-${code}`, all.length > 0 && nText > 0 && R.art === true && bad.length === 0, where, bad.slice(0, 8).join('\n   '));
    }
  });

  // ================= P11～P13 交通圖示、背景紋理（v1.90） =================
  await section(['P11', 'P12', 'P13'], async () => {
    const R = await page.evaluate(async (tid, step, r) => {
      const ip = await import('./js/itinposter/index.js');
      const { PAPER } = await import('./js/itinposter/layout.js');
      const { LEG_LABEL } = await import('./js/legs.js');
      const { DONE_PEEK } = await import('./js/peeks.js');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      const draw = async (pg) => { const cv = document.createElement('canvas'); await ip.drawPoster(cv, pg); return cv; };
      const sets = [];
      const art = await ip.headerArtReady();   // v1.93：全部一張照畫面那樣帶頁首插圖
      for (const [kind, split] of [['route', 'one'], ['route', 'day'], ['band', 'one'], ['band', 'day']]) ip.renderPages(m, { kind, split, art }).forEach((pg, i) => sets.push({ tag: `${kind}/${split} 第 ${i + 1} 張`, pg }));
      // 合成的一天：每一段一種方式（六種有圖的＋「其他」），三種有交通的版面各一張——六種都要畫過一次
      const modes = ['walk', 'train', 'bus', 'car', 'boat', 'plane', 'other'];
      const names = ['子站', ...modes.map((md, k) => `第${k + 2}站`)];
      const syn = { title: '合成', span: null, dateRange: '', people: 0, placeCount: names.length, foods: [], tips: [], tipsAsOf: '',
        days: [{ day: 2, date: '', from: names[0], to: names[names.length - 1], foods: [], placeCount: names.length, peek: DONE_PEEK,
          stops: names.map((name, k) => ({ name, time: '', eta: '', stay: '', leg: k ? { mode: modes[k - 1], label: LEG_LABEL[modes[k - 1]], dur: '' } : null })) }] };
      const synSets = [['route', 'day'], ['band', 'one'], ['band', 'day']].map(([kind, split]) => ({ tag: `合成 ${kind}/${split}`, pg: ip.renderPages(syn, { kind, split })[0] }));
      const out = { p11: [], p11n: 0, p11modes: [], p11ctl: [], p12: [], p13: [], p13n: 0, dots: [], pages: sets.length };
      for (const s of [...sets, ...synSets]) {
        const icons = s.pg.ops.filter((o) => o.op === 'legicon');
        if (!icons.length) continue;
        const a = await draw(s.pg), c = await draw({ ...s.pg, ops: s.pg.ops.filter((o) => o.op !== 'legicon') });
        for (const o of icons) {
          const box = { x: o.x, y: o.y, w: o.s, h: o.s };
          const dk = window.__ck.darkRatio(a, box), col = window.__ck.colorRatio(a, box, o.color), none = window.__ck.darkRatio(c, box);
          out.p11n++;
          out.p11modes.push(o.mode);
          if (!(dk > 0.04 && col > 0.03)) out.p11.push(`${s.tag} ${o.mode}：深色 ${dk.toFixed(3)}、那一天的顏色 ${col.toFixed(3)}`);
          if (!(none < 0.01)) out.p11ctl.push(`${s.tag} ${o.mode}：拿掉圖示還有深色 ${none.toFixed(3)}`);
        }
      }
      for (const s of sets) {
        const pg = s.pg;
        const a = await draw(pg), b = await draw({ ...pg, bg: null });
        // 「框裡」：照實際畫的不透明方塊（白框、面板、對話框、色帶、膠囊、站卡），往內縮過圓角（0.3×圓角＋3）。
        // 不拿版面的外框（boxes）來量：對話框的外框連尾巴旁邊的空白也包進去，那裡本來就是紙、就該有點（v1.90 第一次跑時誤判）
        const cover = pg.ops.filter((o) => o.op === 'rect' && /^#[0-9a-f]{6}$/i.test(String(o.fill))).map((o) => { const k = Math.ceil((o.r || 0) * 0.3) + 3; return { x: o.x + k, y: o.y + k, w: o.w - 2 * k, h: o.h - 2 * k }; }).filter((q) => q.w > 0 && q.h > 0);
        const d = window.__ck.dotDiff(a, b, step, r, PAPER, (pg.bg && pg.bg.clear) || [], cover);
        if (!(d.n > 0 && d.pts >= 100 && d.off === 0 && d.inClear === 0 && d.inCover === 0 && d.dotN > 0)) out.p12.push(`${s.tag}：不一樣 ${d.n} 個像素、格點 ${d.pts} 個、離格點太遠 ${d.off}、在標題區或頁尾 ${d.inClear}、在框裡 ${d.inCover}、量到點的像素 ${d.dotN}`);
        out.dots.push(d.dot);
        // P13：拿掉字，兩張（有紋理、沒紋理）每一個字那一格（外擴 1）逐像素比
        const noText = pg.ops.filter((o) => o.op !== 'text');
        const a2 = await draw({ ...pg, ops: noText }), b2 = await draw({ ...pg, ops: noText, bg: null });
        for (const o of pg.ops.filter((x) => x.op === 'text')) {
          const left = o.align === 'center' ? o.x - o.w / 2 : o.align === 'right' ? o.x - o.w : o.x;
          const n = window.__ck.diffIn(a2, b2, { x: left - 1, y: o.y - o.size * 0.88 - 1, w: o.w + 2, h: o.size * 1.1 + 2 });
          out.p13n++;
          if (n) out.p13.push(`${s.tag}「${o.text}」那一格有 ${n} 個像素跟沒紋理時不一樣`);
        }
      }
      return out;
    }, S.t, DOT_SPEC.step, DOT_SPEC.r);
    const six = [...new Set(R.p11modes)].sort().join(',');
    say('P11', R.p11n > 0 && R.p11.length === 0 && R.p11ctl.length === 0 && six === 'bus,car,plane,train,walk,boat'.split(',').sort().join(','),
      `${R.p11n} 個圖示（種類 ${six}）；畫不出來的 ${R.p11.length} 個；對照（同一張拿掉圖示）還量得到的 ${R.p11ctl.length} 個`, [...R.p11, ...R.p11ctl].slice(0, 8).join('\n   '));
    say('P12', R.pages >= 8 && R.p12.length === 0, `${R.pages} 張，不合的 ${R.p12.length} 張`, R.p12.slice(0, 8).join('\n   '));
    const dotCols = [...new Set(R.dots)];
    const worst = dotCols.filter(Boolean).map((c) => ({ c, sub: contrast(SUB, c), ink: contrast(INK, c) }));
    say('P13', R.p13n > 0 && R.p13.length === 0 && worst.length > 0 && worst.length === dotCols.length && worst.every((w) => w.sub >= 4.5 && w.ink >= 4.5),
      `${R.p13n} 個字，底被紋理改到的 ${R.p13.length} 個；量到的點顏色 ${worst.map((w) => `${w.c}（灰字 ${w.sub.toFixed(2)}、黑字 ${w.ink.toFixed(2)}）`).join('、') || '沒有'}`, R.p13.slice(0, 8).join('\n   '));
  });

  // ================= P14 頁首插圖畫出來、字看得清楚、底邊淡出（v1.93） =================
  await section(['P14a', 'P14b', 'P14c'], async () => {
    const R = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      const art = await ip.headerArtReady();
      return { art, pages: ['route', 'band'].map((kind) => ({ kind, pg: ip.renderPages(m, { kind, split: 'one', art: true })[0] })) };
    }, S.t);
    // 壓在插圖上的字：字框（跟 B18 同一個 textBox）跟插圖那一塊重疊
    const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
    const jobs = R.pages.map(({ kind, pg }) => {
      const a = pg.ops.find((o) => o.op === 'art') || null;
      return { kind, pg, a, on: a ? texts(pg).filter((o) => ov(textBox(o), a)).map((o) => ({ text: o.text, role: o.role, color: o.color, box: textBox(o) })) : [] };
    });
    const M = await page.evaluate(async (jobs, paper) => {
      const ip = await import('./js/itinposter/index.js');
      const draw = async (pg) => { const cv = document.createElement('canvas'); await ip.drawPoster(cv, pg); return cv; };
      const out = [];
      for (const j of jobs) {
        const r = { kind: j.kind, has: !!j.a, ratio: 0, txt: [], last: null, lastNoFade: null, above: -1, inFade: -1 };
        out.push(r);
        if (!j.a) continue;
        const a = j.a;
        // P14a：同一張拿掉插圖再畫，插圖那一塊有幾成不一樣
        const full = await draw(j.pg), bare = await draw({ ...j.pg, ops: j.pg.ops.filter((o) => o.op !== 'art') });
        r.ratio = window.__ck.diffIn(full, bare, { x: a.x, y: a.y, w: a.w, h: a.h }) / (a.w * a.h);
        // P14b：拿掉字再畫，每一個壓在插圖上的字那一格，每個像素對字色的對比
        const noText = j.pg.ops.filter((o) => o.op !== 'text');
        const nt = await draw({ ...j.pg, ops: noText });
        for (const t of j.on) { const q = window.__ck.minContrast(nt, t.box, t.color); r.txt.push({ text: t.text, role: t.role, min: q.min, n: q.n }); }
        // P14c：淡出與不淡出（fade 0）兩張：最後一列、淡出開始前一列、淡出中間一列
        const nf = await draw({ ...j.pg, ops: noText.map((o) => (o.op === 'art' ? { ...o, fade: 0 } : o)) });
        const yl = a.y + a.h - 1;
        r.last = window.__ck.rowDev(nt, yl, paper);
        r.lastNoFade = window.__ck.rowDev(nf, yl, paper);
        r.above = window.__ck.diffIn(nt, nf, { x: a.x, y: a.y + a.h - a.fade - 1, w: a.w, h: 1 });
        r.inFade = window.__ck.diffIn(nt, nf, { x: a.x, y: a.y + a.h - Math.round(a.fade / 2), w: a.w, h: 1 });
      }
      return out;
    }, jobs, PAPER);
    const c = P3 || {};
    say('P14a', R.art === true && c.art === '1' && c.match !== '' && c.kind === 'route' && c.split === 'one' && M.length === 2 && M.every((r) => r.has && r.ratio > 0.5),
      `插圖${R.art === true ? '載得到' : '載不到'}；預覽 ${c.kind}/${c.split} 標 data-art="${c.art}"、${c.match ? `跟有插圖的「${c.match}」那一份相同` : '認不出是哪一份'}；插圖那一塊跟拿掉插圖時不一樣的占 ${M.map((r) => `${r.kind} ${r.has ? r.ratio.toFixed(2) : '沒有插圖'}`).join('、')}`);
    const tx = M.flatMap((r) => r.txt.map((t) => ({ ...t, kind: r.kind })));
    const lowT = tx.filter((t) => !(t.n > 0 && t.min >= ART_MIN));
    const worst = (k) => { const a = tx.filter((t) => t.kind === k && t.min != null); return a.length ? Math.min(...a.map((t) => t.min)).toFixed(2) : '沒有'; };
    say('P14b', M.length === 2 && M.every((r) => r.txt.length > 0) && lowT.length === 0,
      `壓在插圖上的字 ${M.map((r) => `${r.kind} ${r.txt.length} 個（最差 ${worst(r.kind)}）`).join('、')}；不到 ${ART_MIN} 的 ${lowT.length} 個`,
      lowT.slice(0, 8).map((t) => `${t.kind}「${t.text}」（${t.role}）${t.n ? t.min.toFixed(2) : '一個像素都沒量到'}`).join('\n   '));
    say('P14c', M.length === 2 && M.every((r) => r.has && r.last.max >= 0 && r.last.max <= 3 && r.lastNoFade.far >= 0.2 && r.above === 0 && r.inFade > 0),
      M.map((r) => (r.has ? `${r.kind}：最後一列跟紙色最多差 ${r.last.max}（不淡出時 ${(r.lastNoFade.far * 100).toFixed(0)}% 不是紙色）、淡出前一列兩張差 ${r.above} 個像素、淡出中間一列差 ${r.inFade} 個` : `${r.kind}：沒有插圖`)).join('；'));
  });

  // ================= P15 插圖載不到 → 沒有插圖的版面（v1.93） =================
  await section(['P15'], async () => {
    let r = null, blocked = 0, drawn = false;
    try {
      // 有 SW 在控制時，插圖從 SW 的快取拿、請求不出來——繞過 SW、關掉 HTTP 快取，伺服器那一頭回 404（像檔案不見了）
      await page.setBypassServiceWorker(true);
      await page.setCacheEnabled(false);
      net.art.length = 0; net.artBlock = true;
      await page.reload({ waitUntil: 'networkidle0' });   // 重開才會重載插圖（載過的那一份留在模組裡）
      drawn = await waitDrawn(page);
      await settle(page, S.t);
      blocked = net.art.filter((u) => u.startsWith('擋 ')).length;
      const c = await matchShown(page, S.t);
      const hs = await page.evaluate(async (tid) => {
        const ip = await import('./js/itinposter/index.js');
        const cv = document.querySelector('.poster-canvas');
        const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
        const at = (art) => ip.renderPages(m, { kind: cv.dataset.kind, split: cv.dataset.split, art })[Number(cv.dataset.page)].h;
        return { no: at(false), yes: at(true) };
      }, S.t);
      r = { c, hs };
    } finally {
      net.artBlock = false;
      await page.setBypassServiceWorker(false).catch(() => {});
      await page.setCacheEnabled(true).catch(() => {});
    }
    const c = r.c;
    say('P15', blocked > 0 && drawn && c.art === '0' && c.match === '有預報' && c.kind === 'route' && c.split === 'one' && c.h === r.hs.no && r.hs.no !== r.hs.yes,
      `插圖的請求被擋 ${blocked} 次；預覽 ${c.kind}/${c.split} 標 data-art="${c.art}"、${c.match ? `跟「${c.match}」那一份（照標的排）逐像素相同` : '認不出是哪一份'}；高 ${c.h}（沒插圖 ${r.hs.no}、有插圖 ${r.hs.yes}）`);
  });

  // ================= P16 深色、淺色主題下海報一樣（v1.93） =================
  await section(['P16'], async () => {
    const shotDir = path.join(ROOT, '.logs', 'itinposter-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    const theme = () => page.evaluate(() => ({ attr: document.documentElement.dataset.theme || '', bg: getComputedStyle(document.body).backgroundColor }));
    const snap = () => page.evaluate(() => {
      const c = document.querySelector('.poster-canvas');
      return c && c.width ? { w: c.width, h: c.height, art: c.dataset.art, kind: c.dataset.kind, split: c.dataset.split, rows: window.__ck.rowHashes(c) } : null;
    });
    // 使用者的路：首頁（旅程外面才有「設定」那一格）→ 底部「設定」→「畫面顏色」那一格
    const pick = async (k, label) => {
      await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
      if (!await soft(page.waitForSelector('.trip-card', { timeout: 15000 }))) return false;
      if (!await tap(page, '#tabbar a.tab', '設定')) return false;
      if (!await soft(page.waitForSelector(`[data-theme-pick="${k}"]`, { timeout: 15000 }))) return false;
      const r = await userClick(page, await page.$(`[data-theme-pick="${k}"]`), label);
      await sleep(500);
      return r.ok;
    };
    // 截圖（只給人看）：頁面最上面那一個畫面（固定在底部的分頁列不會疊到海報中間）＋海報本身原尺寸。寫不了不影響判定
    const shoot = async (name) => {
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await sleep(200);
      await page.screenshot({ path: path.join(shotDir, `${name}.png`) }).catch(() => {});
      const url = await page.evaluate(() => { const c = document.querySelector('.poster-canvas'); return c && c.width ? c.toDataURL('image/png') : ''; }).catch(() => '');
      if (url) fs.writeFileSync(path.join(shotDir, `poster-${name}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    };
    const e0 = await enterPoster(page, TITLE, S.t);   // P15 之後插圖檔回來了：重新從入口進來
    await settle(page, S.t);
    const t0 = await theme(), s0 = await snap();
    await shoot('washi');
    const okDark = await pick('dark', '「深色」');
    const t1 = await theme();
    const e1 = await enterPoster(page, TITLE, S.t);
    await settle(page, S.t);
    const s1 = await snap();
    await shoot('dark');
    const okBack = await pick('washi', '「淺色」');
    const t2 = await theme();
    await enterPoster(page, TITLE, S.t);   // 回海報那一頁（P6 從這裡換版型）
    await settle(page, S.t);
    const diffRows = s0 && s1 && s0.w === s1.w && s0.h === s1.h ? s0.rows.filter((h, i) => h !== s1.rows[i]).length : -1;
    const pre = okDark && okBack && t0.attr === 'washi' && t1.attr === '' && t0.bg !== t1.bg && t2.attr === 'washi';
    say('P16', pre && !!s0 && s0.art === '1' && s0.kind === 'route' && s0.split === 'one' && s0.rows.length === s0.h && !!s1 && s1.art === '1' && diffRows === 0,
      `主題 淺色「${t0.attr}」${t0.bg} → 深色「${t1.attr}」${t1.bg} → 換回「${t2.attr}」（點得到 ${okDark}、${okBack}）；海報 淺色 ${s0 ? `${s0.kind}/${s0.split} ${s0.w}×${s0.h} data-art="${s0.art}"` : '沒畫出來'}、深色 ${s1 ? `${s1.w}×${s1.h} data-art="${s1.art}"` : '沒畫出來'}；不一樣的列 ${diffRows}${e0.ok && e1.ok ? '' : `；（從入口進不來：${e0.why || e1.why}）`}`);
  });

  // ================= P17 有插圖時，存下來的圖就是有插圖的那一份（v1.93） =================
  await section(['P17'], async () => {
    await settle(page, S.t);
    const hs = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const cv = document.querySelector('.poster-canvas');
      const m = await ip.gatherModel(tid, { forecast: await ip.tripForecast(tid) });
      const at = (art) => ip.renderPages(m, { kind: cv.dataset.kind, split: cv.dataset.split, art }).map((p) => ({ w: p.w, h: p.h }));
      return { kind: cv.dataset.kind, split: cv.dataset.split, art: cv.dataset.art, w: cv.width, h: cv.height, yes: at(true), no: at(false) };
    }, S.t);
    await page.evaluate(() => { window.__shareMode = 'none'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-png', '存成圖片');
    await soft(page.waitForFunction(() => window.__dl.length >= 1 && window.__dl.every((d) => d.done), { timeout: 60000 }));
    await sleep(500);
    const d = await page.evaluate(() => { const r = window.__dl.map((x) => ({ name: x.name, type: x.type, head: x.head, err: x.err })); window.__dl = []; return r; });
    const dims = d.map((f) => pngDims(f.head));
    const y = hs.yes[0] || null, n = hs.no[0] || null;
    const pre = hs.art === '1' && hs.kind === 'route' && hs.split === 'one' && hs.yes.length === 1 && hs.no.length === 1 && !!y && !!n && y.h !== n.h;
    say('P17', pre && d.length === 1 && d[0].name === `${BASE}-行程海報.png` && d[0].type === 'image/png' && same(dims[0], y) && hs.w === y.w && hs.h === y.h,
      `預覽 ${hs.kind}/${hs.split} data-art="${hs.art}" ${hs.w}×${hs.h}；下載 ${d.length} 個：${d.map((f, i) => `${f.name}（${f.type}）${dims[i] ? `${dims[i].w}×${dims[i].h}` : '不是 PNG'}${f.err ? `、${f.err}` : ''}`).join('、') || '沒有'}；有插圖那一份 ${y ? `${y.w}×${y.h}` : '-'}、沒插圖 ${n ? `${n.w}×${n.h}` : '-'}`);
  });

  // ================= P5 天氣預報 =================
  await section(['P5a', 'P5b'], async () => {
    const r = await page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const f = await ip.tripForecast(tid);
      const mF = await ip.gatherModel(tid, { forecast: f }), m0 = await ip.gatherModel(tid, { forecast: null });
      const { destCoords } = await import('./js/views/weather.js');
      return { stale: f ? f.stale : null, tips: mF.tips, asOf: mF.tipsAsOf, tips0: m0.tips.length,
        hF: ip.renderPages(mF, { kind: 'route', split: 'one' })[0].h, h0: ip.renderPages(m0, { kind: 'route', split: 'one' })[0].h, dc: destCoords(tid) };
    }, S.t);
    const [, mo, dd] = dateIn(0).split('-').map(Number);
    const c = P3 || { match: '', kind: '', split: '' };
    say('P5a', r.stale === false && r.tips.length === 3 && same(r.tips.map((x) => x.day), [1, 2, 3]) && r.tips.filter((x) => x.warn).length === 1 && r.tips[1].warn
      && r.asOf === `${mo}/${dd}` && r.tips0 === 0 && r.hF > r.h0 && c.kind === 'route' && c.split === 'one' && c.match === '有預報',
      `小提醒 ${r.tips.length} 天（${r.tips.map((x) => x.text).join('｜')}；${r.asOf} 查）；預覽是「${c.match || '都不是'}」那一份；高 有預報 ${r.hF}、沒預報 ${r.h0}`);
    const KEYS = ['current', 'daily', 'forecast_days', 'latitude', 'longitude', 'timezone'];
    const bad = [];
    let hitDest = 0;
    for (const u of net.meteo) {
      const q = new URL(u).searchParams;
      const keys = [...new Set([...q.keys()])].sort();
      if (!same(keys, KEYS)) bad.push(`參數 ${keys.join(',')}`);
      if (r.dc && Number(q.get('latitude')) === r.dc.lat && Number(q.get('longitude')) === r.dc.lng) hitDest++;
    }
    say('P5b', net.meteo.length > 0 && hitDest > 0 && bad.length === 0, `查了 ${net.meteo.length} 次、${hitDest} 次是這趟的目的地座標`, bad.join('；'));
  });

  // ================= P6 換版型、翻頁、記住上次選的 =================
  await section(['P6a', 'P6b', 'P6c'], async () => {
    await tap(page, '.ip-seg[data-key="kind"] button', '分天色帶');
    await waitShown(page, 'band', 'one');
    await tap(page, '.ip-seg[data-key="split"] button', '每天一張');
    await waitShown(page, 'band', 'day');
    const a = await segState(page);
    const ca = await matchShown(page, S.t);
    const va = variantOf(ca);
    say('P6a', a.kind === 'band' && a.split === 'day' && same(a.kindOn, ['分天色帶']) && same(a.splitOn, ['每天一張']) && a.pagerShown
      && a.label.includes('第1天') && /共 3\s張/.test(a.label) && !a.prev && a.next && !!va && va.n === 3,
      `${a.kind}/${a.split}；選中 ${a.kindOn}、${a.splitOn}；翻頁「${a.label}」；前一張 ${a.prev ? '看得到' : '藏起來'}、下一張 ${a.next ? '看得到' : '藏起來'}；預覽${va ? `跟「${va.name}」第 1 張相同` : '跟成品不同'}`);
    await tap(page, '.pager-btn', '下一張');
    await waitShown(page, 'band', 'day', '1');
    const b = await segState(page);
    const cb = await matchShown(page, S.t);
    say('P6b', b.page === '1' && b.label.includes('第2天') && b.prev && b.next && cb.idx === 1 && !!variantOf(cb),
      `第 ${Number(b.page) + 1} 張「${b.label}」；${variantOf(cb) ? '跟成品同一份' : `跟成品不同（${cb.variants.map((v) => `${v.name} ${v.diff}`).join('、')}）`}`);
    const re = await enterPoster(page, TITLE, S.t);
    const c = await segState(page);
    const saved = await page.evaluate((t) => localStorage.getItem('tripquest.itinPoster.' + t), S.t);
    say('P6c', re.drawn && c.kind === 'band' && c.split === 'day' && c.page === '0' && same(c.kindOn, ['分天色帶']) && same(c.splitOn, ['每天一張']),
      `再進來是 ${c.kind}/${c.split} 第 ${Number(c.page) + 1} 張；這支手機記的是 ${saved}${re.ok ? '' : `；（從入口進不來：${re.why}）`}`);
    // 確保情境：存檔那幾條在「分天色帶・每天一張」上做（「沒記住上次選的」那條突變不連帶別條）
    if (c.kind !== 'band') { await tap(page, '.ip-seg[data-key="kind"] button', '分天色帶'); await sleep(600); }
    if (c.split !== 'day') { await tap(page, '.ip-seg[data-key="split"] button', '每天一張'); await sleep(600); }
    await waitShown(page, 'band', 'day');
  });

  // ================= P7、P8 存檔 =================
  await section(['P7a', 'P7b', 'P8a', 'P8b'], async () => {
    shownBefore = await matchShown(page, S.t);
    const v = variantOf(shownBefore);
    const dims = v ? v.dims : [];
    const names = dims.length > 1 ? (v ? v.labels : []).map((l) => `${BASE}-行程海報-${l}.png`) : [`${BASE}-行程海報.png`];
    const pngOk = (files) => files.length === dims.length && files.every((f, i) => f.name === names[i] && f.type === 'image/png' && same(pngDims(f.head), { w: dims[i][0], h: dims[i][1] }));
    const show = (files) => files.map((f) => `${f.name} ${JSON.stringify(pngDims(f.head))}`).join('、');
    net.outside.length = 0; net.writes.length = 0; net.osrm.length = 0;

    await page.evaluate(() => { window.__shareMode = 'ok'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-png', '存成圖片');
    await soft(page.waitForFunction(() => window.__shared.length > 0 || window.__dl.length > 0, { timeout: 60000 }));
    await sleep(1500);
    const a = await page.evaluate(() => ({ shared: window.__shared, dl: window.__dl.map((d) => d.name) }));
    const fa = a.shared.length === 1 ? a.shared[0].files : [];
    say('P7a', !!v && dims.length === 3 && a.shared.length === 1 && pngOk(fa) && a.dl.length === 0,
      `分享 ${a.shared.length} 次、${fa.length} 個檔：${show(fa)}；另外下載 ${a.dl.length} 個；預覽那一份 ${dims.map((d) => d.join('×')).join('、')}`);

    await page.evaluate(() => { window.__shareMode = 'none'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-png', '存成圖片');
    await soft(page.waitForFunction((n) => window.__dl.length >= n && window.__dl.every((d) => d.done), { timeout: 60000 }, Math.max(1, dims.length)));
    await sleep(800);
    const b = await page.evaluate(() => ({ shared: window.__shared.length, dl: window.__dl.map((d) => ({ name: d.name, type: d.type, head: d.head })) }));
    say('P7b', !!v && b.shared === 0 && pngOk(b.dl), `下載 ${b.dl.length} 個：${show(b.dl)}`);

    await page.evaluate(() => { window.__shareMode = 'ok'; window.__shared = []; window.__dl = []; });
    await tap(page, '.ip-pdf', '存成 PDF');
    await soft(page.waitForFunction(() => window.__dl.some((d) => d.done && /\.pdf$/.test(d.name)), { timeout: 60000 }));
    await sleep(500);
    const p = await page.evaluate(() => ({ shared: window.__shared.length, dl: window.__dl.map((d) => ({ name: d.name, type: d.type, size: d.size, b64: d.b64 })) }));
    const pdf = p.dl.length === 1 ? Buffer.from(p.dl[0].b64 || '', 'base64') : Buffer.alloc(0);
    const pbad = pdf.length ? pdfProblems(pdf, dims.map(([w, h]) => ({ w, h }))) : ['沒有 PDF'];
    say('P8a', !!v && dims.length === 3 && p.shared === 0 && p.dl.length === 1 && p.dl[0].name === `${BASE}-行程海報.pdf` && p.dl[0].type === 'application/pdf' && pbad.length === 0,
      `下載 ${p.dl.map((d) => `${d.name}（${d.type}，${d.size} 位元組）`).join('、') || '沒有'}；${dims.length} 頁`, pbad.join('；'));
    say('P8b', net.outside.length === 0 && net.osrm.length === 0 && net.writes.length === 0, `存了 3 次：對外 ${net.outside.length} 個、路線服務 ${net.osrm.length} 個、上傳 ${net.writes.length} 個`, [...net.outside, ...net.osrm, ...net.writes].join('；'));
  });

  // ================= P10 約幾點到、車程：跟行程分頁同一份（v1.89） =================
  await section(['P10a', 'P10b'], async () => {
    // 站卡上的約幾點到、車程（照站的順序；每天一張的那幾張）——模型與畫出來的字各一份
    const posterSide = (tid) => page.evaluate(async (tid) => {
      const ip = await import('./js/itinposter/index.js');
      const m = await ip.gatherModel(tid, { forecast: null });
      const pages = ip.renderPages(m, { kind: 'band', split: 'day' });
      return m.days.map((d, i) => ({
        day: d.day,
        eta: d.stops.map((s) => (s.time ? '' : s.eta)),
        dur: d.stops.slice(1).map((s) => (s.leg ? s.leg.dur : '')),
        drawnEta: (pages[i] ? pages[i].ops : []).filter((o) => o.op === 'text' && o.role === 'eta').map((o) => o.full),
        drawnLeg: (pages[i] ? pages[i].ops : []).filter((o) => o.op === 'text' && o.role === 'leg').map((o) => o.full),
      }));
    }, tid);
    // P10a：沒開過行程分頁的一趟（座標跟上面那一趟都不一樣，快取裡一定沒有）——直接開海報那一頁
    const cold = await page.evaluate(async (g, tz) => {
      const s = await import('./js/store.js');
      const { uuid } = await import('./js/ids.js');
      const { generateForTrip } = await import('./js/quests/generate.js');
      const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + n * 86400000));
      const t = uuid();
      await s.put({ id: t, type: 'trip', groupId: g, title: '合成的冷快取', region: '台北', allowWiki: false, startDate: day(20), endDate: day(20) });
      const { spots, quests } = await generateForTrip({ tripId: t, region: '台北', items: [{ name: '龍山寺', day: 1, region: '台北' }, { name: '台北101', day: 1, region: '台北' }] });
      if (spots[0] && spots[1]) { spots[0].startMin = 600; spots[0].stayMin = 60; spots[1].legFrom = spots[0].id; spots[1].legMode = 'car'; }
      for (const x of spots) await s.put(x);
      for (const x of quests) await s.put(x);
      return { t, placed: spots.filter((x) => x.lat != null).length };
    }, S.g, TZ);
    net.osrm.length = 0;
    await page.evaluate((t) => { location.hash = `#/trip/${t}/itinposter`; }, cold.t);
    const coldDrawn = await soft(page.waitForFunction(() => { const c = document.querySelector('.poster-canvas'); return !!c && c.width > 0; }, { timeout: 20000 }));
    await sleep(800);
    const cs = await posterSide(cold.t);
    await sleep(300);
    const coldNet = net.osrm.length;
    const c1 = cs[0] || { eta: [], dur: [], drawnEta: [], drawnLeg: [] };
    say('P10a', cold.placed === 2 && coldDrawn && coldNet === 0 && c1.dur.length === 1 && c1.dur[0] === '' && c1.eta.every((x) => x === '') && c1.drawnEta.length === 0,
      `兩站都有座標 ${cold.placed === 2}、預覽畫出來了 ${coldDrawn}；路線服務 ${coldNet} 次；車程「${c1.dur.join('｜')}」、約幾點到「${c1.eta.join('｜')}」、畫出來的約幾點到 ${c1.drawnEta.length} 個`);
    // P10b：使用者的路——行程分頁「行程」那一格（畫面補上「約 N 分」「約幾點到」）→ 按「做成行程海報」
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    let pre = await soft(page.waitForSelector('.trip-card', { timeout: 15000 }));
    pre = pre && await tap(page, '.trip-card', TITLE);
    pre = pre && await soft(page.waitForSelector('.trip-home', { timeout: 15000 }));
    pre = pre && await tap(page, '#tabbar a.tab', '行程');
    pre = pre && await soft(page.waitForSelector('.itin-page .itin-seg', { timeout: 15000 }));
    pre = pre && await tap(page, '.itin-seg button', '行程');
    pre = pre && await soft(page.waitForFunction(() => document.querySelectorAll('#itin-pane-plan .tl-eta').length > 0, { timeout: 20000 }));
    await sleep(500);
    const itin = await page.evaluate(() => [...document.querySelectorAll('#itin-pane-plan .itin-day')].map((sec) => ({
      day: Number(sec.dataset.day),
      eta: [...sec.querySelectorAll('li.tl-item > .tl-time')].map((x) => (x.classList.contains('tl-eta') ? x.textContent : '')),
      dur: [...sec.querySelectorAll('li.tl-leg')].map((li) => { const x = li.querySelector('.tl-leg-min'); return x ? x.textContent : ''; }),
    })));
    const btn = await page.$('#itin-pane-plan .itin-poster-btn');
    const k = btn ? await userClick(page, btn, '「做成行程海報」') : { ok: false, why: '沒有按鈕' };
    await soft(page.waitForFunction(() => { const c = document.querySelector('.poster-canvas'); return !!c && c.width > 0; }, { timeout: 20000 }));
    await sleep(500);
    const ps = await posterSide(S.t);
    const etaN = itin.reduce((a, d) => a + d.eta.filter(Boolean).length, 0), durN = itin.reduce((a, d) => a + d.dur.filter(Boolean).length, 0);
    const diffs = [];
    for (const d of itin) {
      const p = ps.find((x) => x.day === d.day);
      if (!p) { diffs.push(`第 ${d.day} 天海報沒有這一天`); continue; }
      if (!same(p.eta, d.eta)) diffs.push(`第 ${d.day} 天約幾點到：行程分頁 ${JSON.stringify(d.eta)}、海報 ${JSON.stringify(p.eta)}`);
      if (!same(p.dur, d.dur)) diffs.push(`第 ${d.day} 天車程：行程分頁 ${JSON.stringify(d.dur)}、海報 ${JSON.stringify(p.dur)}`);
      if (!same(p.drawnEta, d.eta.filter(Boolean))) diffs.push(`第 ${d.day} 天畫出來的約幾點到 ${JSON.stringify(p.drawnEta)}`);
      const lost = d.dur.filter(Boolean).filter((t) => !p.drawnLeg.some((x) => x.endsWith(' ' + t)));
      if (lost.length) diffs.push(`第 ${d.day} 天畫出來的車程少了 ${JSON.stringify(lost)}（畫的是 ${JSON.stringify(p.drawnLeg)}）`);
    }
    say('P10b', pre && k.ok && itin.length === 3 && etaN >= 1 && durN >= 1 && diffs.length === 0,
      `行程分頁${pre ? '' : '沒進到、'}${k.ok ? '' : `按不到海報（${k.why}）、`}${itin.length} 天，約幾點到 ${etaN} 站、車程 ${durN} 段：${itin.map((d) => `第 ${d.day} 天 ${d.eta.filter(Boolean).join('、') || '—'}／${d.dur.filter(Boolean).join('、') || '—'}`).join('；')}`,
      diffs.join('\n   '));
  });

  // ================= P2 沒有景點的一趟 =================
  await section(['P2a', 'P2b'], async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    await soft(page.waitForSelector('.trip-card', { timeout: 15000 }));
    let pre = await tap(page, '.trip-card', EMPTY);
    pre = pre && await soft(page.waitForSelector('.trip-home', { timeout: 15000 }));
    pre = pre && await tap(page, '#tabbar a.tab', '行程');
    pre = pre && await soft(page.waitForSelector('.itin-page .itin-seg', { timeout: 15000 }));
    pre = pre && await tap(page, '.itin-seg button', '行程');
    pre = pre && await soft(page.waitForSelector('#itin-pane-plan .itin-edit', { visible: true, timeout: 15000 }));
    const a = await page.evaluate(() => ({ btn: !!document.querySelector('#itin-pane-plan .itin-poster-btn'), edit: (document.querySelector('#itin-pane-plan .itin-edit') || {}).textContent || '' }));
    say('P2a', pre && !a.btn && a.edit.includes('去安排景點'), `「行程」那一格：${pre ? `有「${a.edit}」` : '沒進到'}、${a.btn ? '有' : '沒有'}海報按鈕`);
    await page.evaluate((t) => { location.hash = `#/trip/${t}/itinposter`; }, S.e);
    await soft(page.waitForFunction(() => /還沒有排景點/.test((document.querySelector('.page .empty') || {}).textContent || ''), { timeout: 15000 }));
    const b = await page.evaluate(() => ({ text: (document.querySelector('.page .empty') || {}).textContent || '', canvas: !!document.querySelector('.poster-canvas'), hash: location.hash }));
    say('P2b', b.text.includes('這趟還沒有排景點') && !b.canvas && b.hash.endsWith('/itinposter'), `寫「${b.text.slice(0, 20)}」、${b.canvas ? '有' : '沒有'}預覽`);
  });

  await section(['P9'], async () => { say('P9', pageErrors.length === 0, `${pageErrors.length} 個`, pageErrors.join('；')); });
} catch (e) {
  if (process.exitCode !== 4) { console.log('✗ 測試本身出錯：' + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode === 4 ? '，對照組沒過' : process.exitCode ? '，有失敗' : ''));
