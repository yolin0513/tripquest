// 畫在字串裡的圖：path 形的裁切框不准用在轉過角度的地方（node scripts/cliptest.mjs；秒級、不開瀏覽器、不連網；2026-11-18）
//
// 涵蓋的程式：js/peeks.js, js/glyphs.js, js/tabicons.js（探頭圖、全身吉祥物、拍照圖示、底部分頁五格頭像的 SVG 字串；tabicons 是 v1.96.0 加的）
//
// 為什麼（Yolin 2026-11-18：「阿灰頭上有一塊灰色長方形，那是什麼？」）：Chromium 實測，阿灰望遠鏡（PEEK.scout）的頭轉了 3°，
// 頭頂深灰帶用 <path> 形的 clipPath 照圓頭裁，結果被裁成那條 path 的外接長方形——頭頂多一塊方形、白下巴被切平。拿掉旋轉就裁對；
// clipPath 裡是 <ellipse> 的，轉了角度也裁對；照規格裁的 librsvg（sharp）畫出來是對的，所以只看 sharp 的圖看不出來。
// 修法是不用 clipPath、直接畫算好的形狀（js/peeks.js 的 POSE_K 上面那段註解）。這支擋「又把這種寫法畫回來」。
// 這支只擋寫法、不證明畫出來沒事：指路阿灰的翅尖用同一種寫法，在 App 裡剛好裁對（原因沒查到），這支照樣會把它算成會出事。
// 畫出來對不對，由 scripts/peektest.mjs 的 P9 在瀏覽器裡量（建立行程頁的阿灰頭頂角落）。
//
// 規則：一個 clipPath 算「會出事」＝兩件同時成立——
//   形狀：clipPath 裡第一個形狀不是 ellipse／circle／rect（path、polygon、polyline……都算）。
//         ellipse 是實測沒事；circle 是跟 ellipse 同一類的推論；rect 就算被裁成外接長方形也是它自己。
//   轉角度：引用它的那個元素外面有一層 <g transform> 會轉，或那個元素自己的 transform 會轉。
//         「會轉」＝拿掉 translate(…)、scale(…)、rotate(0 …) 之後還剩任何東西（rotate(不是 0)、matrix(、skewX(……；看不出有沒有轉的一律當成會轉）。
//         只看引用處、不看定義處：clipPath 照規格用引用那個元素的座標（實測把定義搬到最外層照樣方框）。
// 引用找不到（定義跟引用不在同一行、形狀又不在白名單）＝判斷不了，算紅（共用慣例 §5.13：檢查器判斷不了就停，不當成沒事）。
//
//   CT1 對照組（合成樣本，跟真的檔走同一個掃描函式）：每個分支一個只打到它的樣本——
//       a 外面的 g 帶 rotate（外層轉角）、b 元素自己帶 rotate（元素自己的轉角）、
//       c 外面的 g 帶 matrix（不是 rotate 也算會轉）、d polygon＋外層轉角（不在白名單的形狀）；
//       不該抓的：e ellipse＋外層轉角（白名單）、f path＋rotate(0 …)（轉 0 度不算）、g path 沒轉、
//       h 定義在轉過的 g 裡、那個 g 關掉之後才引用（只看引用處；g 要照 </g> 關掉）；
//       判斷不了的：i path、引用不在同一行
//       每一個分支各有一條突變只紅它的樣本（tools/mutations/mut_fix1118.json，cmd 是這一支）。
//   CT2 真的檔：三支各讀到幾個 clipPath（每一支都非 0、合計 ≥ 20）、轉了角度的 ellipse 裁切框幾個（≥ 5：證明真的檔上讀得到轉角）、
//       會出事 0 個、判斷不了 0 個
//   CT3 真的檔的對照：把 js/peeks.js 裡 scout 頭頂算好的帶子與下巴、point 的翅尖，在記憶體裡換回 11-18 以前的 clipPath 寫法，
//       必須各抓到 1 個、點名在換的那一行（證明這支讀得到真的圖的結構，不是只在合成樣本上有用）
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['js/peeks.js', 'js/glyphs.js', 'js/tabicons.js'];
let pass = 0, fail = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { fail++; console.log('✗ ' + msg); } };

const SAFE_SHAPES = new Set(['ellipse', 'circle', 'rect']);
// 會轉：拿掉 translate(…)、scale(…)、rotate(0 …) 之後還剩任何東西（rotate(不是 0)、matrix(、skewX(……）就算會轉
const turns = (tf) => {
  if (!tf) return false;
  const rest = tf.replace(/\b(?:translate|scale)\([^)]*\)/g, '')
    .replace(/\brotate\(\s*-?0+(?:\.0+)?(?=[\s,)])[^)]*\)/g, '')
    .replace(/[\s,]+/g, '');
  return rest.length > 0;
};
const tfOf = (attrs) => (attrs.match(/\btransform="([^"]*)"/) || [])[1] || '';
// 一行（一段 SVG 字串）裡每一個 clipPath：形狀、每一個引用處的轉角
export function scanText(t) {
  const out = [];
  for (const d of t.matchAll(/<clipPath\b[^>]*\bid="([^"]+)"[^>]*>\s*<([a-zA-Z]+)/g)) {
    const id = d[1], shape = d[2];
    const refs = [];
    const needle = `clip-path="url(#${id})"`;
    for (let at = t.indexOf(needle); at >= 0; at = t.indexOf(needle, at + 1)) {
      const open = t.lastIndexOf('<', at);
      const own = t.slice(open, t.indexOf('>', at) + 1);
      const stack = [];
      for (const g of t.slice(0, open).matchAll(/<(\/?)g\b([^>]*)>/g)) {
        if (g[1]) stack.pop(); else if (!g[2].trim().endsWith('/')) stack.push(tfOf(g[2]));
      }
      refs.push({ outer: stack.some(turns), self: turns(tfOf(own)) });
    }
    const safe = SAFE_SHAPES.has(shape.toLowerCase());
    const turned = refs.some((r) => r.outer || r.self);
    out.push({ id, shape, refs: refs.length, turned, safe, risky: !safe && turned, unknown: !safe && refs.length === 0 });
  }
  return out;
}
const scanLines = (text) => text.split('\n').flatMap((l, i) => scanText(l).map((x) => ({ ...x, line: i + 1 })));

// ---- CT1 合成樣本 ----
const P = '<path d="M0 0 L9 0 L9 9 Z"/>';
const SAMPLES = {
  a: { want: 'risky', t: `<g transform="translate(5 5) rotate(12)"><defs><clipPath id="a">${P}</clipPath></defs><g clip-path="url(#a)"><rect width="9" height="9"/></g></g>` },
  b: { want: 'risky', t: `<defs><clipPath id="b">${P}</clipPath></defs><g clip-path="url(#b)" transform="rotate(-8 4 4)"><rect width="9" height="9"/></g>` },
  c: { want: 'risky', t: `<g transform="matrix(1 0 0 1 3 3)"><defs><clipPath id="c">${P}</clipPath></defs><g clip-path="url(#c)"><rect width="9" height="9"/></g></g>` },
  d: { want: 'risky', t: `<g transform="rotate(20)"><defs><clipPath id="d"><polygon points="0,0 9,0 9,9"/></clipPath></defs><g clip-path="url(#d)"><rect width="9" height="9"/></g></g>` },
  e: { want: 'ok', t: `<g transform="rotate(20)"><defs><clipPath id="e"><ellipse cx="4" cy="4" rx="4" ry="3"/></clipPath></defs><g clip-path="url(#e)"><rect width="9" height="9"/></g></g>` },
  f: { want: 'ok', t: `<g transform="rotate(0 100 136)"><defs><clipPath id="f">${P}</clipPath></defs><g clip-path="url(#f)"><rect width="9" height="9"/></g></g>` },
  g: { want: 'ok', t: `<defs><clipPath id="g">${P}</clipPath></defs><g clip-path="url(#g)"><rect width="9" height="9"/></g>` },
  h: { want: 'ok', t: `<g transform="rotate(30)"><defs><clipPath id="h">${P}</clipPath></defs></g><g clip-path="url(#h)"><rect width="9" height="9"/></g>` },
  i: { want: 'unknown', t: `<defs><clipPath id="i">${P}</clipPath></defs>` },
};
const got = (x) => (x.unknown ? 'unknown' : x.risky ? 'risky' : 'ok');
const ctl = Object.entries(SAMPLES).map(([k, s]) => { const r = scanText(s.t); return { k, want: s.want, n: r.length, got: r.length === 1 ? got(r[0]) : `${r.length} 個` }; });
const ctlBad = ctl.filter((c) => c.got !== c.want);
yes(ctlBad.length === 0 && ctl.length === 9,
  `CT1 對照組：合成樣本 ${ctl.length} 個各判對（${ctl.map((c) => `${c.k}=${c.got}`).join('、')}；要 a～d 會出事、e～h 沒事、i 判斷不了；判錯 ${ctlBad.map((c) => `${c.k}（要 ${c.want}）`).join('、') || '無'}）`);

// ---- CT2 真的檔 ----
const src = {};
for (const f of FILES) {
  try { src[f] = fs.readFileSync(ROOT + f, 'utf8'); } catch (e) { src[f] = null; }
}
const rows = FILES.map((f) => ({ f, list: src[f] ? scanLines(src[f]) : null }));
const unread = rows.filter((r) => !r.list);
const all = rows.flatMap((r) => (r.list || []).map((x) => ({ ...x, f: r.f })));
const risky = all.filter((x) => x.risky), unknown = all.filter((x) => x.unknown);
const turnedSafe = all.filter((x) => x.safe && x.turned && x.shape === 'ellipse').length;
const counts = rows.map((r) => `${r.f} ${r.list ? r.list.length : '讀不到'} 個`).join('、');
yes(unread.length === 0 && rows.every((r) => r.list.length > 0) && all.length >= 20 && turnedSafe >= 5 && risky.length === 0 && unknown.length === 0,
  `CT2 真的檔：path 形的裁切框沒有用在轉過角度的地方（${counts}，合計 ${all.length}（要 ≥ 20）；轉了角度的 ellipse 裁切框 ${turnedSafe} 個（要 ≥ 5，證明讀得到轉角）；`
  + `會出事 ${risky.map((x) => `${x.f}:${x.line} ${x.id} <${x.shape}>`).join('、') || '0 個'}；判斷不了 ${unknown.map((x) => `${x.f}:${x.line} ${x.id} <${x.shape}>`).join('、') || '0 個'}）`);

// ---- CT3 真的檔的對照：換回 11-18 以前的寫法 ----
const BAND = '<path d="M51.41 80.56 C58.52 61.24 76.25 50 100 50 C123.75 50 141.48 61.24 148.59 80.56 Q100 67.44 51.41 80.56 Z" fill="#9a948f"/><path d="M70.95 133.75 A30 17 0 0 1 129.05 133.75 C121.02 136.68 111.18 138 100 138 C88.82 138 78.98 136.68 70.95 133.75 Z" fill="#fffdf9"/>';
const OLD_BAND = '<defs><clipPath id="i3"><path d="M100 50 C131.2 50 152 69.4 152 101 C152 127.7 131.2 138 100 138 C68.8 138 48 127.7 48 101 C48 69.4 68.8 50 100 50 Z" /></clipPath></defs><g clip-path="url(#i3)"><path d="M40 84 Q100 64 160 84 V40 H40 Z" fill="#9a948f"/><ellipse cx="100" cy="138" rx="30" ry="17" fill="#fffdf9"/></g>';
const TIP = '<path d="M10.6 39.2 C7.83 46.96 3.65 53.08 0 56 C-3.65 53.08 -7.83 46.96 -10.6 39.2 Z" fill="#6f6965"/>';
const OLD_TIP = '<defs><clipPath id="i4"><path d="M0 0 C13 0 15 16 13 30 C11 42 5 52 0 56 C-5 52 -11 42 -13 30 C-15 16 -13 0 0 0 Z" /></clipPath></defs><g clip-path="url(#i4)"><rect x="-20" y="39.2" width="40" height="56" fill="#6f6965"/></g>';
function revert(kind, from, to) {
  const text = src['js/peeks.js'];
  if (!text) return { ok: false, why: '讀不到 js/peeks.js' };
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*${kind}: \\{ vb: \\[`).test(l));
  if (start < 0) return { ok: false, why: `找不到 ${kind} 開頭那一行` };
  // 這一張的範圍：從開頭那一行到下一張的開頭（找不到下一張就往下 6 行）
  let end = lines.findIndex((l, i) => i > start && /^\s*[a-z]+: \{ vb: \[/.test(l));
  if (end < 0) end = Math.min(lines.length, start + 6);
  const at = [];
  for (let i = start; i < end; i++) for (let k = lines[i].indexOf(from); k >= 0; k = lines[i].indexOf(from, k + 1)) at.push(i);
  if (at.length !== 1) return { ok: false, why: `${kind} 那一張（第 ${start + 1}～${end} 行）裡算好的形狀出現 ${at.length} 次（要剛好 1 次）` };
  lines[at[0]] = lines[at[0]].replace(from, to);
  const hits = scanLines(lines.join('\n')).filter((x) => x.risky);
  return { ok: true, line: at[0] + 1, hits };
}
for (const [kind, from, to, label] of [['scout', BAND, OLD_BAND, '阿灰望遠鏡頭頂帶與下巴'], ['point', TIP, OLD_TIP, '指路阿灰的翅尖']]) {
  const r = revert(kind, from, to);
  yes(r.ok && r.hits.length === 1 && r.hits[0].line === r.line,
    `CT3 真的檔的對照：${label}（${kind}）換回 11-18 以前的 clipPath 寫法 → 抓到 1 個、在換的那一行（${r.ok ? `換在第 ${r.line} 行；抓到 ${r.hits.map((x) => `第 ${x.line} 行 ${x.id} <${x.shape}>`).join('、') || '0 個'}` : r.why}）`);
}

console.log(`\n${pass} 項通過${fail ? `，${fail} 項失敗` : ''}`);
process.exit(fail ? 1 : 0);
