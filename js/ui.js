// DOM / UI 小工具

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function mount(node, ...children) { clear(node); node.append(...children.flat().filter(Boolean)); }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, ms);
}

// 通用互動對話框。回傳 Promise，resolve 值由呼叫端的按鈕決定。
export function modal({ title, body, actions }) {
  const root = document.getElementById('modalRoot');
  return new Promise((resolve) => {
    const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const card = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' },
      title && h('h2', { class: 'modal-title' }, title),
      typeof body === 'string' ? h('div', { class: 'modal-body', html: body }) : h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' },
        ...(actions || [{ label: '好', value: true, primary: true }]).map((a) =>
          h('button', {
            class: 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : ''),
            onclick: () => close(a.value),
          }, a.label)
        )
      )
    );
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, card);
    root.append(overlay);
    document.addEventListener('keydown', onKey);
    const focusable = card.querySelector('input, textarea, button.btn-primary, button');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  });
}

export async function confirmDialog(message, { danger = false, okLabel = '確定', cancelLabel = '取消' } = {}) {
  return modal({
    body: h('p', {}, message),
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  });
}

export async function promptDialog(message, { value = '', placeholder = '', okLabel = '確定', multiline = false } = {}) {
  const input = multiline
    ? h('textarea', { class: 'field', rows: 4, placeholder })
    : h('input', { class: 'field', type: 'text', placeholder, value });
  input.value = value;
  const res = await modal({
    body: h('div', {}, h('p', { style: 'margin:0 0 8px' }, message), input),
    actions: [
      { label: '取消', value: false },
      { label: okLabel, value: true, primary: true },
    ],
  });
  return res ? input.value.trim() : null;
}

// SVG 進度環
export function ring(ratio, { size = 44, stroke = 5, label } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, ratio)));
  const done = ratio >= 1;
  return h('div', { class: 'ring' + (done ? ' ring-done' : ''), style: `width:${size}px;height:${size}px` }, ...[
    fromSVG(`<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-fill)" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`),
    h('span', { class: 'ring-label' }, done ? '✓' : (label ?? Math.round(ratio * 100) + '%')),
  ]);
}

function fromSVG(str) {
  const wrap = document.createElement('div');
  wrap.innerHTML = str.trim();
  return wrap.firstChild;
}
export { fromSVG };

export function avatar(name, hue) {
  const ch = (name || '?').trim().slice(0, 1).toUpperCase();
  return h('span', {
    class: 'avatar',
    style: `--h:${hue ?? 210}`,
    title: name,
  }, ch);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 成就慶祝畫面
export function celebrate({ title, lines = [], photoURL, actions = [] }) {
  const root = document.getElementById('modalRoot');
  return new Promise((resolve) => {
    const close = (v) => { wrap.remove(); conf.remove(); resolve(v); };
    const conf = confetti();
    const wrap = h('div', { class: 'celebrate' },
      h('div', { class: 'celebrate-badge' }, '✓'),
      h('h2', {}, title || '完成了！'),
      ...lines.map((l) => h('p', {}, l)),
      photoURL ? h('img', { class: 'celebrate-photo', src: photoURL, alt: '' }) : null,
      ...actions.map((a) => h('button', {
        class: 'btn ' + (a.primary ? 'btn-primary' : 'btn-soft') + ' btn-block btn-big',
        onclick: () => close(a.value),
      }, a.label)),
    );
    root.append(conf, wrap);
    if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch { /* noop */ } }
    if (!actions.length) setTimeout(() => close(null), 2200);
  });
}

function confetti() {
  const wrap = h('div', { class: 'confetti' });
  const colors = ['#4f8dff', '#ffb454', '#4fd6a6', '#ff6b8b', '#c58bff'];
  for (let i = 0; i < 60; i++) {
    wrap.append(h('i', {
      style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};` +
        `animation-duration:${1.6 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.5}s`,
    }));
  }
  setTimeout(() => wrap.remove(), 4200);
  return wrap;
}

export const KIND_META = {
  building: { icon: '🏛️', label: '建築' },
  food: { icon: '🍜', label: '美食' },
  thing: { icon: '📿', label: '事物' },
  view: { icon: '🌄', label: '風景' },
  culture: { icon: '🎎', label: '文化' },
  group: { icon: '👥', label: '合照' },
  custom: { icon: '✨', label: '自訂' },
};
