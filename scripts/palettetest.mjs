// 配色的文字對比檢查（npm run palettetest；秒級、不開瀏覽器）
//
// 涵蓋的程式：css/style.css
//
// 為什麼要這支：v1.74.11 加淺色「和紙」主題，配色是四個粉彩（珊瑚粉、山吹黃、水色、若竹綠）。
// 粉彩當文字顏色，對比只有 1.5～2 左右，長輩看不清楚——這是這個主題唯一可能做壞的地方，
// 而且壞了不會有任何測試紅（畫面照樣畫得出來）。所以交給機器：
//   P1 每個主題的變數都解得出來（沒有用到卻沒定義的變數；有的話那一條規則等於沒上色）
//   P2 每一條設了文字色的規則：文字色對「它自己的底色」——沒設底色就對頁面可能的三種底
//      （--bg、--bg-elev、--bg-elev-2，取最差的）——對比 ≥ 4.5（WCAG AA 一般文字）
//   P3 每一條只設了底色、沒設文字色的規則：繼承來的 --text 在那個底色上 ≥ 4.5
//   P4 解不出來的顏色（漸層、半透明、color-mix 以外的函式）只准是登記過的例外——靜默略過就是排除制
// 「這條規則實際用在哪裡、上面疊了什麼」靜態看不出來，那部分由 layouttest／截圖逐頁看（開瀏覽器）。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCss } from './motioncsstest.mjs';

const CSS_PATH = 'css/style.css';
export const MIN = 4.5;

// 主題 → 依序疊上的選擇器（後面的蓋前面的）
export const THEMES = {
  '深色': [':root'],
  '深色＋高對比': [':root', 'html[data-contrast="high"]'],
  '和紙': [':root', 'html[data-theme="washi"]'],
  '和紙＋高對比': [':root', 'html[data-theme="washi"]', 'html[data-theme="washi"][data-contrast="high"]'],
};

// 登記的例外（登記制：只有列在這裡的才放行；登記了卻沒用到也報）
// 一、每個主題都放行：上面沒有字，或底不是頁面（照片、固定黑底的檢視器、遮罩）
const NO_TEXT = '上面沒有字（線、圓點、進度條、開關、外框）';
const ON_PHOTO = '疊在照片或固定黑底上，不跟主題；底不是頁面，靜態算不出';
const EMOJI = '只有表情符號，字色不影響';
const ALL_THEMES = {
  '.progress-track > i': NO_TEXT,
  '.people-row .pr-mini-track > i': NO_TEXT,
  '.storage-bar > i': NO_TEXT,
  '.scrub > i': NO_TEXT,
  '.scrub-knob': NO_TEXT,
  '.tl-item:has(.qcollapse.is-here) .tl-dot': NO_TEXT,
  '.tl-past .tl-dot': NO_TEXT,
  '.tl-now .tl-dot': NO_TEXT,
  '.pg-untag': NO_TEXT + '（font-size 0 的小圓點）',
  '.switch-row input[type="checkbox"]::after': NO_TEXT,
  '.switch-row input[type="checkbox"]:checked': NO_TEXT,
  '.switch-row input[type="checkbox"]:checked::after': NO_TEXT,
  '.poster-frame': NO_TEXT + '（海報畫布的外框，裡面是 canvas）',
  '.apx-cam': EMOJI + '（📷）',
  '.qbig-photo.has-img .qbig-emoji': EMOJI,
  '.quest-focus-photo.has-img .qf-emoji': EMOJI,
  '.qbig-photo.has-img::after': ON_PHOTO,
  '.pv-top': ON_PHOTO,
  '.pv-btn': ON_PHOTO,
  '.pv-bottom': ON_PHOTO,
  '.pv-cap-2': ON_PHOTO,
  '.pv-react': ON_PHOTO,
  '.img-credit': ON_PHOTO,
  '.photo-view img': ON_PHOTO + '（照片本身）',
  '.tagger-photo': ON_PHOTO + '（照片本身）',
  '.modal-overlay': '遮罩；字在對話框自己的底上',
  '.record-overlay': '遮罩；字在對話框自己的底上',
  '.avatar': '每人一個色相（--h），靜態算不出；白字在 46% 亮度上，部分色相可能不到 4.5——v1.74.11 之前就有，另案',
};
// 二、只放行深色主題：v1.74.11 之前就有的對比不足，這一版不改深色的外觀（另案，已回報）。
// 「對頁面最差的底」是保守算法：那個字實際也許只放在較深的底上。
const DARK_KNOWN = [
  '.btn-danger', '.tag-btn.danger', '.tag-er', '.here-pick-tick', '.pick-row-tick', '.qbig.done .qbig-status',
  '.crew-new', '.chip-add', '.crumb-btn', '.tag-hot', '.music-src a', '.drb-edit', '.qc-prog.done', '.plan-addspot',
  '#sosFab', '.wx-day-rain', '.exp-person-bal.neg', '.numpad-del', '.qrow.done .qrow-icon', '.ig-ic', '.qline-link',
  '.pos-banner-off',
];
export const EXEMPT = { ...ALL_THEMES };
for (const s of DARK_KNOWN) for (const t of ['深色', '深色＋高對比']) EXEMPT[`${t}｜${s}`] = '深色主題既有的對比不足，另案';

// ---------- 顏色 ----------
export function parseColor(v) {
  v = String(v).trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{3})$/.exec(v))) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  if ((m = /^#([0-9a-f]{6})$/.exec(v))) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v))) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  if (v === '#000' || v === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (v === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  return null;
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

// 變數表：主題的每一層裡宣告的 --x
export function tokensFor(rules, layers) {
  const t = {};
  for (const sel of layers) for (const r of rules) if (r.sel === sel) for (const d of r.decls) if (d.prop.startsWith('--')) t[d.prop] = d.value;
  return t;
}

const over = (c, under) => ({ r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a), a: 1 });

// 把一個值解成顏色。under＝它疊在什麼上面（transparent、半透明要靠它；沒給就解不出來）。
// 回 { color } 或 { unresolved: 原因 }
export function resolve(value, tokens, under = null, depth = 0) {
  if (depth > 8) return { unresolved: '變數互相引用太深' };
  const v = String(value).trim();
  const vm = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(v);
  if (vm) {
    if (vm[1] in tokens) return resolve(tokens[vm[1]], tokens, under, depth + 1);
    if (vm[2] != null) return resolve(vm[2], tokens, under, depth + 1);
    return { unresolved: `沒定義的變數 ${vm[1]}`, undefinedVar: vm[1] };
  }
  if (/^transparent$/i.test(v)) return under ? { color: under } : { unresolved: '透明（疊在什麼上面靜態看不出來）' };
  // color-mix(in srgb, A P%, B)
  const mm = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/i.exec(v);
  if (mm) {
    const a = resolve(mm[1], tokens, under, depth + 1), b = resolve(mm[3], tokens, under, depth + 1);
    if (a.unresolved) return a;
    if (b.unresolved) return b;
    const p = +mm[2] / 100;
    const mix = (k) => a.color[k] * p + b.color[k] * (1 - p);
    return { color: { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 } };
  }
  const c = parseColor(v);
  if (!c) return { unresolved: `看不懂的顏色「${v.slice(0, 40)}」` };
  if (c.a < 1) return under ? { color: over(c, under) } : { unresolved: `半透明「${v}」（疊在什麼上面靜態看不出來）` };
  return { color: c };
}

// 一條規則的文字色與底色（宣告值，還沒解）
function colorsOf(r) {
  const get = (p) => { const d = [...r.decls].reverse().find((x) => x.prop === p); return d ? d.value : null; };
  let bg = get('background-color') ?? get('background');
  // background 簡寫：只取「整個值就是一個顏色」的情況；圖片、漸層、多段的都當成解不出來
  if (bg != null && /^(none|transparent|inherit|initial|unset)$/i.test(bg.trim())) bg = null;
  return { fg: get('color'), bg };
}

// 依頂層的某個字元切開（不切括號裡的）
function splitTop(s, sepRe) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && sepRe.test(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// 「A B」「A > B」→「A」（去掉最後一段）；只有一段回 null
function parentSel(sel) {
  const parts = splitTop(sel.replace(/\s*>\s*/g, ' '), /\s/);
  return parts.length > 1 ? parts.slice(0, -1).join(' ') : null;
}

// 底色宣告 → 要逐一檢查的顏色。圖片（url）解不出來，原樣交回去讓 resolve 報
export function bgStops(decl) {
  const v = decl.trim();
  const g = /^(?:repeating-)?linear-gradient\((.*)\)$/i.exec(v);
  if (g) {
    const args = splitTop(g[1], /,/);
    if (args.length && (/^to\s/i.test(args[0]) || /^-?[\d.]+(deg|turn|rad)$/i.test(args[0]))) args.shift();
    return args.map((a) => splitTop(a, /\s/)[0]);
  }
  if (/url\(/i.test(v)) return [v];
  const parts = splitTop(v, /\s/);
  return [parts.length > 1 && !/^(linear|radial|conic)/i.test(parts[0]) ? parts[0] : v];
}

// 回 { ok, lines, counts }
// exempt：鍵是「選擇器」（每個主題都放行）或「主題名｜選擇器」（只放行那個主題），值是理由
export function checkPalette(text, { exempt = {}, themes = THEMES } = {}) {
  const lines = [];
  let ok = true;
  const say = (good, msg) => { lines.push((good ? '✓ ' : '✗ ') + msg); if (!good) ok = false; };
  const rules = [];
  for (const r of parseCss(text)) for (const s of splitTop(r.sel, /,/)) rules.push({ ...r, sel: s });
  const bySel = new Map();
  for (const r of rules) { if (!bySel.has(r.sel)) bySel.set(r.sel, []); bySel.get(r.sel).push(r); }
  const ownColors = (sel) => {
    let fg = null, bg = null;
    for (const r of bySel.get(sel) || []) { const c = colorsOf(r); if (c.fg != null) fg = c.fg; if (c.bg != null) bg = c.bg; }
    return { fg, bg };
  };
  const counts = {};
  const usedExempt = new Set();
  for (const [name, layers] of Object.entries(themes)) {
    const missing = layers.filter((sel) => !rules.some((r) => r.sel === sel));
    if (missing.length) { say(false, `P0 ${name}：樣式表裡沒有 ${missing.join('、')} 這一層`); continue; }
    const tk = tokensFor(rules, layers);
    const pageBgs = ['--bg', '--bg-elev', '--bg-elev-2'].map((k) => resolve(`var(${k})`, tk));
    if (pageBgs.some((x) => x.unresolved)) { say(false, `P1 ${name}：頁面底色解不出來`); continue; }
    const pages = pageBgs.map((x) => x.color);
    const undef = new Set(), bad = [], unres = [];
    const exemptKey = (sel) => [`${name}｜${sel}`, sel].find((k) => exempt[k] != null);
    let n = 0, nEx = 0;
    const seen = new Set();
    for (const r of rules) {
      if (r.sel.startsWith(':root') || r.sel.startsWith('html[data-') || seen.has(r.sel)) continue;
      const { fg, bg } = ownColors(r.sel);
      if (fg == null && bg == null) continue;
      seen.add(r.sel);
      if (fg != null && /^(inherit|currentcolor|transparent)$/i.test(fg.trim())) continue;
      // 底色：自己的；沒有就看「上一層」那條規則的；再沒有就是頁面可能的三種底
      const par = parentSel(r.sel);
      const pc = par ? ownColors(par) : { fg: null, bg: null };
      const bgDecl = bg ?? pc.bg;
      const fgDecl = fg ?? pc.fg ?? 'var(--text)';
      // 漸層：每一個色標都要過；簡寫（「色 位置/大小 不重複」）取第一段的顏色
      const stops = bgDecl != null ? bgStops(bgDecl) : null;
      const bgs = stops == null ? pages.map((u) => ({ color: u }))
        : pages.flatMap((u) => stops.map((s) => resolve(s, tk, u)));
      const fgs = bgs.map((b) => (b.unresolved ? b : resolve(fgDecl, tk, b.color)));
      for (const x of [...bgs, ...fgs]) if (x.undefinedVar) undef.add(x.undefinedVar);
      const ek = exemptKey(r.sel);
      const failed = [...bgs, ...fgs].find((x) => x.unresolved);
      if (failed) {
        if (ek) { usedExempt.add(ek); continue; }
        unres.push(`${r.sel}（${failed.unresolved}）`);
        continue;
      }
      const worst = Math.min(...fgs.map((f, i) => contrast(f.color, bgs[i].color)));
      n++;
      if (worst + 1e-9 < MIN) {
        if (ek) { usedExempt.add(ek); nEx++; continue; }
        bad.push(`${r.sel}（${worst.toFixed(2)}${bg != null ? '，對自己的底色' : pc.bg != null ? '，對上一層的底色' : '，對頁面最差的底'}）`);
      }
    }
    counts[name] = n;
    say(undef.size === 0, `P1 ${name}：用到的變數都有定義${undef.size ? '；沒定義：' + [...undef].join('、') : ''}`);
    say(n > 0 && bad.length === 0, `P2／P3 ${name}：算了 ${n} 條規則的文字對比，${n - nEx - bad.length} 條 ≥ ${MIN}、${nEx} 條不到但登記過${bad.length ? `；不到的 ${bad.length} 條：` + bad.join('｜') : ''}`);
    say(unres.length === 0, `P4 ${name}：解不出來的顏色都有登記${unres.length ? `；沒登記的 ${unres.length} 條：` + unres.join('｜') : ''}`);
  }
  const stale = Object.keys(exempt).filter((k) => !usedExempt.has(k));
  say(stale.length === 0, `P4 登記的例外每一條都真的用到（${Object.keys(exempt).length} 條${stale.length ? '；沒用到：' + stale.join('｜') : ''}）`);
  return { ok, lines, counts };
}

// ---------- 執行 ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain) {
  let pass = 0;
  const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

  // 對照組：同一個 checkPalette，餵合成的樣式表（四個主題都有）。wantRed 寫「類別＋主題」的開頭，
  // 每一類都要紅到、而且不准紅到別類。
  const THEME_CSS = [
    ':root { --bg: #101010; --bg-elev: #181818; --bg-elev-2: #202020; --text: #ffffff; --primary: #4f8dff; --primary-text: #8fb6ff; }',
    'html[data-contrast="high"] { --bg: #000000; }',
    'html[data-theme="washi"] { --bg: #fffcf6; --bg-elev: #f8f0e3; --bg-elev-2: #efe4d2; --text: #3e3a39; --primary: #f2a497; --primary-text: #9a3a2b; }',
    'html[data-theme="washi"][data-contrast="high"] { --bg: #ffffff; }',
  ].join('\n');
  const GOOD = THEME_CSS + '\n.ok { color: var(--primary-text); }\n.blk { background: var(--primary); color: var(--primary-ink, #000000); }';
  const ctl = (name, css, wantRed, exempt = {}) => {
    const r = checkPalette(css, { exempt });
    const red = r.lines.filter((l) => l.startsWith('✗ '));
    const want = wantRed == null ? [] : [].concat(wantRed);
    const hit = want.length === 0 ? red.length === 0
      : want.every((w) => red.some((l) => l.startsWith('✗ ' + w))) && red.every((l) => want.some((w) => l.startsWith('✗ ' + w)));
    yes(hit, `對照組 ${name}：${want.length ? '應只紅 ' + want.join('＋') : '應全過'}，實際紅 ${red.length} 條${red.length ? '（' + red.map((l) => l.slice(2, 34)).join('｜') + '）' : ''}`);
  };
  ctl('合格的樣式表', GOOD, null);
  ctl('沒有和紙那一層', GOOD.replace('html[data-theme="washi"] {', 'html[data-theme="xx"] {'), ['P0 和紙']);
  ctl('粉彩當字', GOOD + '\n.bad { color: var(--primary); }', ['P2／P3 和紙']);
  ctl('沒定義的變數', GOOD + '\n.bad { color: var(--nope); }', ['P1 ', 'P4 深色', 'P4 和紙']);
  ctl('只設底色、繼承的字太淡', GOOD + '\n.bad { background: var(--text); }', ['P2／P3 ']);
  ctl('圖片底上有字', GOOD + '\n.bad { background: url(x.png); color: var(--text); }', ['P4 深色', 'P4 和紙']);
  ctl('上一層的底色要算進去', GOOD + '\n.a { background: #000000; color: #ffffff; }\n.a .b { color: #ffffff; }', null);
  ctl('漸層的每個色標都要過', GOOD + '\n.bad { background: linear-gradient(180deg, #000000, #ffffff); color: #ffffff; }', ['P2／P3 ']);
  ctl('疊在頁面上的半透明底', GOOD + '\n.bad { background: color-mix(in srgb, #000000 10%, transparent); color: #ffffff; }', ['P2／P3 和紙']);
  // 半透明的字要疊在底上算出來（算不出來會落到 P4，那就是這一支壞了）
  ctl('半透明的字', GOOD + '\n.bad { color: rgba(128, 128, 128, 0.3); }', ['P2／P3 ']);
  ctl('逗號隔開的選擇器各自算', GOOD + '\n.x, .bad { color: var(--primary); }', ['P2／P3 和紙']);
  ctl('登記過的例外放行', GOOD + '\n.bad { color: var(--primary); }', null, { '.bad': '測試' });
  ctl('只登記深色，和紙照樣擋', GOOD + '\n.bad { color: var(--primary); }', ['P2／P3 和紙', 'P4 登記'], { '深色｜.bad': '測試' });
  ctl('登記了卻沒用到', GOOD, ['P4 登記'], { '.不存在': '測試' });

  // 真的樣式表
  let text = null;
  try { text = fs.readFileSync(new URL('../' + CSS_PATH, import.meta.url), 'utf8'); } catch (e) { yes(false, `讀不到 ${CSS_PATH}：${e.code || e.message}`); }
  if (text != null) {
    const r = checkPalette(text, { exempt: EXEMPT });
    console.log(`— ${CSS_PATH}（${text.split('\n').length} 行）—`);
    for (const l of r.lines) yes(l.startsWith('✓ '), l.slice(2));
  }
  console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
}
