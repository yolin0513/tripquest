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
//   CT2 真的檔：三支各讀到幾個 clipPath（每一支都非 0、合計 ≥ 11）、轉了角度的 ellipse 裁切框幾個（≥ 2：證明真的檔上讀得到轉角）、
//       會出事 0 個、判斷不了 0 個
//       下限 2026-11-20 從「≥ 20、≥ 5」改成「≥ 11、≥ 2」：v1.99.0～v1.100.0 吉祥物換成照參考圖描的向量，描圖不用 clipPath，
//       這一版要換的 14 段（PEEK 10、TAB_ART 3、ICON.lib 1）裡的 clipPath 會歸 0。新下限是數出來的：把那 14 段從三支檔的複本挖掉、
//       在複本上跑這一支，CT2 自己數到合計 11（peeks 3／glyphs 7／tabicons 1）、轉角 ellipse 2（.logs/v1100/ct2floor.mjs；對照組：
//       不挖的複本數到的跟 repo 直接跑相同）。換的過程中數字只會往下掉到這裡、不會更低，所以中途每個 commit 都過得了。
//   CT3 真的檔的對照：在 js/peeks.js 的 scout、point 那兩張 fig 那一行的開頭，於記憶體裡插一個「外層轉 3°、裡面 path 形 clipPath」的群組
//       （就是 11-18 出事的那種寫法），插之前整支檔會出事 0 個、插了必須剛好抓到 1 個、點名在插的那一行、id 是插的那個
//       （證明這支讀得到真的圖的結構，不是只在合成樣本上有用）。
//       2026-11-20 從「換回」改成「插入」：原本是把 11-18 算好的頭頂帶、翅尖字串換回 clipPath 寫法，v1.100.0 那兩張換成描圖後字串不在了。
//       插入不依賴圖裡畫了什麼，換圖前後都成立。
//   CT4 探頭圖的前景（PEEK 每一張的 front）都不帶 id（2026-11-20 加；Dispatch 16:3x 選甲；寫之前 date＝16:36）：
//       peek() 把前景另外畫一份在邊線以下那一層，帶 id 的話那一份要換前綴，不然同一張圖裡 id 出現兩次（11-18 鬍鬍揮手、山雀坐姿就是）。
//       守這件事的突變「探頭圖：前景下層那一份不換前綴」在 v1.100.0 換圖後沒紅——main 有兩張前景帶 id、HEAD 一張都沒有
//       （.logs/v1100/frontids.mjs），換不換前綴結果一樣，現在的資料下是等價突變，已從 mut_fix1118 移出。
//       這一條替它守門：前景帶 id 的張數必須是 0；哪天新圖的前景又帶 id（例：前景裡有裁切框），這條紅＝要把那條突變放回清單、重新證明會紅。
//       母體：PEEK 區塊（const PEEK = { 到下一個行首 };）裡「  名字: { vb: [」的張數 ≥ 15，而且前景行（行首四格空白 front:）跟張數一樣多——
//       寫法變了（例：前景拆成多行）數不到，就紅，不當成 0 個。對照組：合成一段兩張的 PEEK（一張前景帶 id、fig 也帶 id），必須剛好數到前景那 1 個。
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
yes(unread.length === 0 && rows.every((r) => r.list.length > 0) && all.length >= 11 && turnedSafe >= 2 && risky.length === 0 && unknown.length === 0,
  `CT2 真的檔：path 形的裁切框沒有用在轉過角度的地方（${counts}，合計 ${all.length}（要 ≥ 11）；轉了角度的 ellipse 裁切框 ${turnedSafe} 個（要 ≥ 2，證明讀得到轉角）；`
  + `會出事 ${risky.map((x) => `${x.f}:${x.line} ${x.id} <${x.shape}>`).join('、') || '0 個'}；判斷不了 ${unknown.map((x) => `${x.f}:${x.line} ${x.id} <${x.shape}>`).join('、') || '0 個'}）`);

// ---- CT3 真的檔的對照：在真的圖裡插一個 11-18 出事的那種寫法 ----
// 插的群組：外層 rotate(3 100 136)（11-18 阿灰望遠鏡的頭就是轉這個角度）、裡面 path 形的 clipPath 照圓頭裁頭頂帶。
const INJECT = (id) => `<g transform="rotate(3 100 136)"><defs><clipPath id="${id}"><path d="M100 50 C131.2 50 152 69.4 152 101 C152 127.7 131.2 138 100 138 C68.8 138 48 127.7 48 101 C48 69.4 68.8 50 100 50 Z" /></clipPath></defs><g clip-path="url(#${id})"><path d="M40 84 Q100 64 160 84 V40 H40 Z" fill="#9a948f"/></g></g>`;
function inject(kind, id) {
  const text = src['js/peeks.js'];
  if (!text) return { ok: false, why: '讀不到 js/peeks.js' };
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*${kind}: \\{ vb: \\[`).test(l));
  if (start < 0) return { ok: false, why: `找不到 ${kind} 開頭那一行` };
  const fi = lines.findIndex((l, i) => i > start && i <= start + 3 && l.startsWith("    fig: '"));
  if (fi < 0) return { ok: false, why: `${kind} 那一張開頭往下 3 行內找不到 fig 那一行` };
  const before = scanLines(text).filter((x) => x.risky).length;
  lines[fi] = lines[fi].replace("    fig: '", "    fig: '" + INJECT(id));
  // 情境成立的痕跡：插的引用真的在那一行（插失敗就不能拿「抓到 0 個」當結論）
  if (!lines[fi].includes(`clip-path="url(#${id})"`)) return { ok: false, why: '插入後那一行讀不到插的引用（情境未成立）' };
  const hits = scanLines(lines.join('\n')).filter((x) => x.risky);
  return { ok: true, line: fi + 1, before, hits };
}
for (const [kind, label] of [['scout', '阿灰望遠鏡'], ['point', '指路阿灰']]) {
  const id = 'ct3' + kind, r = inject(kind, id);
  yes(r.ok && r.before === 0 && r.hits.length === 1 && r.hits[0].line === r.line && r.hits[0].id === id,
    `CT3 真的檔的對照：${label}（${kind}）那一張插一個轉過角度的 path 形裁切框 → 抓到 1 個、在插的那一行（${r.ok ? `插在第 ${r.line} 行；插之前會出事 ${r.before} 個；抓到 ${r.hits.map((x) => `第 ${x.line} 行 ${x.id} <${x.shape}>`).join('、') || '0 個'}` : r.why}）`);
}

// ---- CT4 探頭圖的前景都不帶 id（說明見檔頭） ----
function frontIds(text) {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => /^const PEEK = \{/.test(l));
  if (s < 0) return { ok: false, why: '找不到 const PEEK = { 那一行' };
  const e = lines.findIndex((l, i) => i > s && /^\};/.test(l));
  if (e < 0) return { ok: false, why: 'PEEK 區塊找不到結尾（行首 };）' };
  const body = lines.slice(s + 1, e);
  const kinds = body.filter((l) => /^ {2}\w+: \{ vb: \[/.test(l)).length;
  const fronts = [];
  for (let i = s + 1; i < e; i++) if (lines[i].startsWith('    front: ')) fronts.push({ line: i + 1, ids: lines[i].split('id="').length - 1 });
  return { ok: true, kinds, fronts, withId: fronts.filter((f) => f.ids > 0) };
}
{
  const FT = ['const PEEK = {', '  a: { vb: [0, 0, 1, 1], edge: 1,', "    fig: '<g id=\"x\"/>',", "    front: '<clipPath id=\"y\"><rect/></clipPath>',", "    extra: '' },",
    '  b: { vb: [0, 0, 1, 1], edge: 1,', "    fig: '',", "    front: '<path/>',", "    extra: '' },", '};'].join('\n');
  const c = frontIds(FT);
  yes(c.ok && c.kinds === 2 && c.fronts.length === 2 && c.withId.length === 1 && c.withId[0].line === 4,
    `CT4 對照組：合成兩張的 PEEK（a 的前景與 fig 都帶 id、b 都不帶），必須數到 2 張、2 行前景、帶 id 的只有第 4 行那 1 行（${c.ok ? `${c.kinds} 張、${c.fronts.length} 行前景、帶 id 的 ${c.withId.map((f) => `第 ${f.line} 行`).join('、') || '0 行'}` : c.why}）`);
}
{
  const r = src['js/peeks.js'] ? frontIds(src['js/peeks.js']) : { ok: false, why: '讀不到 js/peeks.js' };
  yes(r.ok && r.kinds >= 15 && r.fronts.length === r.kinds && r.withId.length === 0,
    `CT4 真的檔：探頭圖的前景都不帶 id（js/peeks.js 的 PEEK ${r.ok ? `${r.kinds} 張（要 ≥ 15）、前景 ${r.fronts.length} 行（要跟張數一樣）、帶 id 的 ${r.withId.map((f) => `第 ${f.line} 行 ${f.ids} 個`).join('、') || '0 行'}` : r.why}）`
    + '——紅的話：把 mut_fix1118 移出的「探頭圖：前景下層那一份不換前綴」放回去、重新證明會紅');
}

console.log(`\n${pass} 項通過${fail ? `，${fail} 項失敗` : ''}`);
process.exit(fail ? 1 : 0);
