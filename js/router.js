// hash 路由 + 真實導覽歷史堆疊
//
// 「返回」= 回到使用者上一個實際造訪的畫面（用瀏覽器 history），不是硬寫的父層。
// 只在 App 內走過至少一步時才 history.back()；直接深連結進來就退到 fallback。

const routes = [];
let notFound = null;
let current = null;

// 這個 App session 內，透過 push（非 replace）前進了幾步
let depth = 0;
// 記住每一步是哪個畫面，方便判斷 fallback
const trail = [];

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

function parse(hash) {
  const raw = (hash ?? location.hash).replace(/^#/, '') || '/';
  const path = raw.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(raw.split('?')[1] || ''));
  return { raw, path, query };
}

let gen = 0;
async function resolve() {
  const my = ++gen;
  const { path, query } = parse();
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      current = { path, params, query, pattern: r.pattern };
      window.scrollTo(0, 0);
      try { await r.handler({ params, query, path }); } catch (e) { console.error(e); }
      void my;
      return;
    }
  }
  if (notFound) await notFound({ path });
}

export function currentRoute() { return current; }

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
  const { raw } = parse();
  if (!location.hash) { location.replace('#/'); trail.push('/'); }
  else trail.push(raw);
  resolve();
}
