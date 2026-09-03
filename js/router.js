// 極簡 hash 路由

const routes = [];
let notFound = null;
let current = null;

export function route(pattern, handler) {
  // pattern 例：'/trip/:id/spot/:spotId'
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, pattern });
}
export function setNotFound(fn) { notFound = fn; }

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + path;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

export function back(fallback = '/') {
  if (history.length > 1 && document.referrer !== '' || (window.__tqDepth || 0) > 0) history.back();
  else navigate(fallback);
}

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const path = raw.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(raw.split('?')[1] || ''));
  return { path, query };
}

async function resolve() {
  const { path, query } = parse();
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      current = { path, params, query, pattern: r.pattern };
      window.scrollTo(0, 0);
      await r.handler({ params, query, path });
      return;
    }
  }
  if (notFound) await notFound({ path });
}

export function currentRoute() { return current; }

export function startRouter() {
  window.addEventListener('hashchange', () => { window.__tqDepth = (window.__tqDepth || 0) + 1; resolve(); });
  if (!location.hash) navigate('/', { replace: true });
  resolve();
}
