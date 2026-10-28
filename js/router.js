// hash 路由 + 真實導覽歷史堆疊
//
// 「返回」= 回到使用者上一個實際造訪的畫面（用瀏覽器 history），不是硬寫的父層。
// 只在 App 內走過至少一步時才 history.back()；直接深連結進來就退到 fallback。

import { mount } from './ui.js';

const routes = [];
let notFound = null;
let current = null;

// 主畫面只有一個入口：這裡。
//
// 每一次換頁（resolve）都有一個編號 gen。畫面函式不自己寫 #view、不自己改頂列，而是拿路由器
// 給它的 drawPage(node)、setTop(opts)——只在「這一次仍是最新的一次」才真的畫，否則丟掉。
// 起因（2026-10-28，settletest）：行程頁還在載景點庫時使用者點了「分帳」，分帳頁先畫好，
// 行程頁晚一步畫完、把它蓋掉——網址是分帳、畫面是行程。原本 gen 只擋得住捲動，擋不住畫。
// 畫面要重畫自己也不直接呼叫自己，一律 refreshPage()，同樣經過 gen。
// scripts/viewentrytest.mjs 盯著「有沒有人繞過這裡」。
const view = document.getElementById('view');

function spinner() {
  const box = document.createElement('div');
  box.className = 'center-fill';
  const s = document.createElement('div');
  s.className = 'spinner';
  box.append(s);
  return box;
}

// 頂列（標題、右上角按鈕）也是畫面的一部分，同樣只准最新的那一次改（settletest 實測：
// 過期的行程頁把分帳頁的「記一筆」換成「旅程設定」，點下去被帶去設定頁）。
// 頂列怎麼畫由 app.js 注入（router 不 import app.js，會循環相依）。
let topbar = null;
export function setTopbar(fn) { topbar = fn; }

// 開機時（路由器還沒啟動、store 還在載）先放一個轉圈圈；啟動之後就不准再用它
export function bootLoading() { if (gen === 0) mount(view, spinner()); }

// 這個 App session 內，透過 push（非 replace）前進了幾步
let depth = 0;
// 記住每一步是哪個畫面，方便判斷 fallback
const trail = [];

// 捲動位置記憶：回到這個 session 造訪過的畫面時，還原他原本看到哪裡。
// 長輩最怕畫面自己亂跳 —— 從照片牆回到旅程頁，應該回到原本那一段，不是彈回最上面、
// 更不該又自己捲一次。
//
// 判斷「回來」不看返回鍵：底部分頁列切來切去（任務→分帳→任務）也是回來，但那不會被
// history 認成 back。改成只要這個 session 記得這一頁的位置就還原，記不得才算第一次進來。
const scrollMemory = new Map();
let curRaw = '/';
let restoredScroll = false;   // 這一次 resolve 有沒有還原捲動位置，view 可以讀

// 同步寫就好：scroll 事件本來就每幀最多一次，而且延到 rAF 會寫到換頁後的新網址上
function rememberScroll() { scrollMemory.set(curRaw, window.scrollY); }

// 給畫面判斷「這次是不是回到舊畫面」（是的話就別自作主張捲動）
export function navRestoredScroll() { return restoredScroll; }

export function route(pattern, handler) {
  // pattern 例：'/trip/:id/spot/:spotId'
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, pattern });
}
export function setNotFound(fn) { notFound = fn; }

// path 可含 query，例：'/trip/x?tab=map'
export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  const cur = location.hash || '#/';
  if (target === cur) {
    // 導到目前這一頁 → 強制重繪（很多操作完呼叫 navigate(同網址) 想刷新）
    resolve();
    return;
  }
  if (replace) {
    location.replace(target);          // 不新增 history 記錄
    if (trail.length) trail[trail.length - 1] = path;
  } else {
    location.hash = target;            // 新增 history 記錄（hashchange 會 push 進 trail）
  }
}

// fallback：沒有可退的歷史時要去哪
export function back(fallback = '/') {
  if (depth > 0) {
    history.back();                    // 交給瀏覽器；hashchange 會把 depth 減回去
  } else {
    navigate(fallback, { replace: true });
  }
}
export function canGoBack() { return depth > 0; }

// 清掉導覽堆疊、直接回到某一頁（用在「主畫面」的返回：一步跳回我的旅程，
// 不要一層一層退）。
export function resetHistory(path = '/') {
  trail.length = 0;
  trail.push(path);
  depth = 0;
  const target = '#' + path;
  if ((location.hash || '#/') === target) resolve();
  else location.replace(target);
}

function parse(hash) {
  const raw = (hash ?? location.hash).replace(/^#/, '') || '/';
  const path = raw.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(raw.split('?')[1] || ''));
  return { raw, path, query };
}

let gen = 0;
// again：畫面要重畫自己（refreshPage）——同一個網址、不是導覽，所以不動捲動位置、fresh 是 false
async function resolve({ again = false } = {}) {
  const my = ++gen;
  const { raw, path, query } = parse();
  const restore = again ? null : (scrollMemory.has(raw) ? scrollMemory.get(raw) : null);
  if (!again) {
    restoredScroll = restore != null;
    curRaw = raw;
  }
  const drawPage = (node) => {
    if (my !== gen) return false;      // 已經有更新的一次換頁 → 這一份過期了，不畫
    mount(view, node);
    return true;
  };
  const setTop = (opts) => {
    if (my !== gen || !topbar) return false;
    topbar(opts);
    return true;
  };

  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      current = { path, params, query, pattern: r.pattern };
      if (restore == null && !again) window.scrollTo(0, 0);
      // view 函式是 async 的（載幣別、算矩陣、抓天氣…）。在它呼叫 drawPage() 之前，
      // 畫面上停的是上一頁的內容 —— 冷啟動或從空白進來時就是**全空、也沒有轉圈圈**，
      // 使用者分不出「在載入」與「壞掉了」（線上巡檢就是這樣量到分帳頁 0 字的）。
      // 但也不能無條件先畫 loading：多數頁面是同步就渲染完的，那會變成閃一下。
      // 所以只有慢到 250ms 還沒畫東西才補上轉圈圈。
      // **只在畫面真的還是空的時候畫** —— 很多 view 是「先畫好再繼續 await」
      // （行程頁畫完才去算移動時間），不檢查的話轉圈圈會把已經畫好的頁面蓋掉。
      let slow = setTimeout(() => { if (my === gen && !view.firstChild) mount(view, spinner()); }, 250);
      try { await r.handler({ params, query, path, fresh: !again, drawPage, setTop }); }
      catch (e) { console.error(e); }
      finally { clearTimeout(slow); slow = null; }
      // 這一次已經被更新的換頁取代 → 不捲（不然會把下一頁捲到這一頁記住的位置）
      if (restore != null && my === gen) {
        window.scrollTo(0, restore);
        // 有些畫面會在 render 之後才把內容補進來（照片、天氣條），再校正一次
        requestAnimationFrame(() => { if (my === gen) window.scrollTo(0, restore); });
      }
      return;
    }
  }
  if (notFound) await notFound({ path });
}

export function currentRoute() { return current; }

// 畫面重畫自己（改了資料、AI 文案回來…）：重跑目前網址那一頁，經過同一個 gen。
// 呼叫的時候使用者若已經換到別頁，重畫的是別頁（無害），不會把舊頁蓋上去。
export function refreshPage() { return resolve({ again: true }); }

function onHashChange() {
  const { raw } = parse();
  // 判斷是前進還是後退：新網址等於 trail 倒數第二 → 使用者按了返回
  if (trail.length >= 2 && trail[trail.length - 2] === raw) {
    trail.pop();
    depth = Math.max(0, depth - 1);
  } else if (trail[trail.length - 1] !== raw) {
    trail.push(raw);
    depth += 1;
  }
  resolve();
}

export function startRouter() {
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('scroll', rememberScroll, { passive: true });
  const { raw } = parse();
  if (!location.hash) { location.replace('#/'); trail.push('/'); }
  else trail.push(raw);
  resolve();
}
