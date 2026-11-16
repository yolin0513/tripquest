// 生圖素材：去背（2026-11-16；流程見 docs/ART_生圖素材.md 第 9 節）
//
// 用法：node scripts/art-keyout.mjs <一張圖或一個資料夾> <輸出資料夾（要不存在或是空的）> [--tol 48] [--holes auto|keep|clear]
//   資料夾：處理裡面的 .png／.jpg／.jpeg／.webp，底線開頭的（例如 art-slice.mjs 的 _sheet.png）跳過。
// 輸出：同名的透明背景 PNG ＋ _sheet.png（總表，透明處畫棋盤格，一眼看得出有沒有去乾淨）。
//
// 做法：
//   1. 從圖最外兩圈量底色（各通道中位數），邊框九成以上要跟它差不到 tol，不然「底色不純」停下。
//      本來就是透明底的圖（邊框九成以上透明）不去背，直接做下面的檢查。
//   2. 從四邊往內填色（上下左右相連、跟底色差不到 tol 的點）→ 全透明。
//      不是整張照顏色挖：主體裡面跟底色同色、但被外框圍住的地方（例如白底上白色的碗裡面）要能留著。
//      被圍住的底色區怎麼辦（--holes，預設 auto）：底色是生圖指定的洋紅 #FF00FF（提示詞規定物件不准用洋紅）
//      → 那是洞（購物袋提把、蝴蝶結的圈），一起去掉；其他底色 → 留著、只報不擋。keep／clear 可以強制指定。
//   3. 主體邊緣 2px 內的點多半是「主體色跟底色混在一起」（反鋸齒）：在附近 3px 找一個離底色最遠、而且
//      這個點剛好落在「底色→那個顏色」連線上的主體色，照落在線上的位置估透明度，再把底色成分扣掉（去色邊）——
//      不扣的話，放到淺色底上會有一圈洋紅色的邊。落不到任何連線上的點（例如黃色填色貼著墨線）當成主體、不動。
//   檢查（任何一張不過，整批停下、一個檔都不寫）：
//      主體被吃掉——跟底色差 120 以上的點一定是主體，去背後變全透明就是 tol 給太大；
//      碰到邊——四個角要全透明、最外 2 圈要有 95% 透明（主體碰到圖邊，多半是切圖時被切到）；
//      空的——不透明的點不到 2%。
//      只報不擋：保留時，被圍住的底色區有幾塊——如果那裡該透空，改用 --holes clear 重跑。
// 已知抓不到：外框有缺口時，填色會從缺口流進去，把內部跟底色同色的部分一起去掉（白底上白色主體最容易發生——
//   所以生圖用洋紅底）；洋紅底的圖如果物件真的用了洋紅（違反提示詞），那一塊會被當成洞去掉。
//   門檻都是「待驗」：照合成樣本訂的，真的圖丟進來才知道，見文件第 11 節。
//
// 每次執行先跑合成對照組（同一段程式；樣本先寫成 PNG 再從檔案讀回來，走真的讀檔路徑）：
//   該放行：K1 乾淨（反鋸齒的墨線圓）——中心要原色不透明、放到白底上邊緣不能偏粉紅、沒有被圍住的底色區；
//           K2 底色有雜訊；K3 白底上白色的主體（墨線圍住）——要留著、中心不透明、而且報出 1 塊；
//           K9 洋紅底上的甜甜圈——洞要自動去掉、本體留著、洞邊不能偏粉紅；
//           K6 本來就是透明底——透明度要跟輸入一模一樣
//   該擋、各擋在自己那一關：K4 底色是漸層→底色不純；K5 主體碰到圖邊→碰到邊；K7 只有一個小點→空的；
//           K8 tol 給 125、主體顏色跟底色差 122→主體被吃掉
//   任何一個判錯（包括擋了、但擋的理由不對）就印「✗ 對照 …」、回 9、不處理真的圖。
// 回傳：0 去好；2 用法錯；3 有圖不能去背（寫明哪一張哪一關）；9 對照組沒全對；1 其他錯誤。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharp, readRGBA, writePNG, borderBg, makeIsBg, hex, dist3, commitDir, freshDir, makeSheet } from './art-lib.mjs';

const UNIFORM = 0.9;      // 邊框要有九成跟底色相同
const EDGE_R = 2;         // 離透明區幾 px 內的點要估半透明
const REF_R = 3;          // 往外找「純主體色」的範圍
const FIT_ERR = 24;       // 邊緣點離「底色→主體色」連線多遠以內，才當成兩者混色
const SOLID = 120;        // 跟底色差這麼多的點一定是主體
const RING_CLEAR = 0.95;  // 最外 2 圈要有這麼多透明
const MIN_OPAQUE = 0.02;  // 不透明的點至少佔這麼多
const ISLAND_MIN = 0.001; // 被圍住的底色區至少佔這麼多才報（去掉時不論大小都去掉）
const GEN_BG = [255, 0, 255]; // 生圖指定的底色（docs/ART_生圖素材.md 第 3 節；物件不准用這個顏色）

const neighbors4 = (p, w, h) => {
  const x = p % w, y = (p - x) / w, out = [];
  if (x > 0) out.push(p - 1);
  if (x < w - 1) out.push(p + 1);
  if (y > 0) out.push(p - w);
  if (y < h - 1) out.push(p + w);
  return out;
};

export function keyout(img, { tol, holes = 'auto' }) {
  const { w, h } = img, N = w * h;
  const bg = borderBg(img, tol);
  const d = Buffer.from(img.d);
  let partial = 0, holesCleared = 0, clearHoles = false;
  const islands = [];
  if (bg.kind === 'color') {
    if (bg.uniform < UNIFORM) return { ok: false, kind: '底色不純', msg: `邊框只有 ${Math.round(bg.uniform * 100)}% 跟底色 ${hex(bg.color)} 相同（要 90% 以上）：底色不是一整片同色，或主體大面積碰到圖邊`, bg };
    const isBg = makeIsBg(img, bg, tol), C = bg.color;
    // 2. 從四邊往內填色
    const mask = new Uint8Array(N), stack = [];
    const seed = (p) => { if (!mask[p] && isBg(p * 4)) { mask[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) for (const q of neighbors4(stack.pop(), w, h)) seed(q);
    // 被圍住的底色區（四邊連不到、跟底色差不到 tol 的相連區塊）：洞，還是主體裡剛好同色的部分？
    //   底色是生圖指定的洋紅（提示詞規定物件不准用洋紅）→ 是洞（提把、蝴蝶結的圈），一起去掉；
    //   其他底色（例如白底）→ 可能是主體白色的部分，留著、只報不擋。--holes keep／clear 可以指定。
    clearHoles = holes === 'clear' || (holes === 'auto' && dist3(C[0], C[1], C[2], GEN_BG) <= tol);
    const seen = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (mask[p] || seen[p] || !isBg(p * 4)) continue;
      const comp = [p];
      seen[p] = 1;
      for (let k = 0; k < comp.length; k++) for (const r of neighbors4(comp[k], w, h)) if (!mask[r] && !seen[r] && isBg(r * 4)) { seen[r] = 1; comp.push(r); }
      if (clearHoles) { for (const q of comp) mask[q] = 1; if (comp.length >= ISLAND_MIN * N) holesCleared++; }
      else if (comp.length >= ISLAND_MIN * N) islands.push(comp.length);
    }
    // 3. 邊緣估半透明＋去色邊（先算好再寫，不讓前面改過的點影響後面的判斷）
    const near = (x, y) => {
      for (let dy = -EDGE_R; dy <= EDGE_R; dy++) for (let dx = -EDGE_R; dx <= EDGE_R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) return true;
      }
      return false;
    };
    const edits = [];
    for (let p = 0; p < N; p++) {
      if (mask[p]) continue;
      const x = p % w, y = (p - x) / w;
      if (!near(x, y)) continue;
      const i = p * 4, c = [img.d[i], img.d[i + 1], img.d[i + 2]], dc = dist3(c[0], c[1], c[2], C);
      const v = [c[0] - C[0], c[1] - C[1], c[2] - C[2]];
      let best = null;
      for (let dy = -REF_R; dy <= REF_R; dy++) for (let dx = -REF_R; dx <= REF_R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (mask[q]) continue;
        const j = q * 4, df = dist3(img.d[j], img.d[j + 1], img.d[j + 2], C);
        if (df <= dc + 8 || (best && df <= best.df)) continue;
        const u = [img.d[j] - C[0], img.d[j + 1] - C[1], img.d[j + 2] - C[2]];
        const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
        const a = Math.max(0, Math.min(1, (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / uu));
        const err = Math.max(Math.abs(v[0] - a * u[0]), Math.abs(v[1] - a * u[1]), Math.abs(v[2] - a * u[2]));
        if (err <= FIT_ERR) best = { a, df };
      }
      if (!best || best.a >= 0.98) continue;
      const a = best.a;
      if (a < 1 / 255) { edits.push([p, 0, 0, 0, 0]); continue; }
      const fg = c.map((cv, k) => Math.max(0, Math.min(255, Math.round((cv - (1 - a) * C[k]) / a))));
      edits.push([p, fg[0], fg[1], fg[2], Math.round(a * 255)]);
    }
    for (let p = 0; p < N; p++) if (mask[p]) { const i = p * 4; d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
    for (const [p, r, g, b, a] of edits) { const i = p * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; if (a > 0 && a < 255) partial++; }
    // 檢查：主體被吃掉
    let eaten = 0;
    for (let p = 0; p < N; p++) { const i = p * 4; if (d[i + 3] === 0 && img.d[i + 3] >= 16 && dist3(img.d[i], img.d[i + 1], img.d[i + 2], C) > SOLID) eaten++; }
    if (eaten) return { ok: false, kind: '主體被吃掉', msg: `${eaten} 個跟底色差 ${SOLID} 以上的點變成全透明（tol ${tol} 可能給太大）`, bg };
  }
  // 檢查：碰到邊（四角全透明、最外 2 圈九成五透明）
  const A = (x, y) => d[(y * w + x) * 4 + 3];
  const corners = [A(0, 0), A(w - 1, 0), A(0, h - 1), A(w - 1, h - 1)];
  let ring = 0, ringClear = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= 2 && y >= 2 && x < w - 2 && y < h - 2) continue;
    ring++;
    if (A(x, y) < 16) ringClear++;
  }
  if (corners.some((a) => a >= 16) || ringClear / ring < RING_CLEAR) return { ok: false, kind: '碰到邊', msg: `最外 2 圈只有 ${Math.round((ringClear / ring) * 1000) / 10}% 透明、四角透明度 ${corners.join('／')}（主體碰到圖邊，可能是切圖時被切到）`, bg };
  // 檢查：空的
  let opaque = 0;
  for (let p = 0; p < N; p++) if (d[p * 4 + 3] >= 128) opaque++;
  if (opaque < MIN_OPAQUE * N) return { ok: false, kind: '空的', msg: `不透明的點只有 ${opaque} 個（${Math.round((opaque / N) * 1000) / 10}%，至少 ${MIN_OPAQUE * 100}%）`, bg };
  return { ok: true, bg, out: { w, h, d }, opaque, partial, islands, clearHoles, holesCleared };
}

// ---------- 合成對照組 ----------
const MAG = [255, 0, 255], INK = [47, 44, 42], YEL = [246, 210, 122], WHITE = [251, 249, 245];
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// 300×300：底色函式 bgAt(x,y)→[r,g,b,a]；圓（墨線 6px＋填色）以 4×4 超取樣畫出反鋸齒
// hole＞0：中間挖一個半徑 hole 的洞（露出底色），洞外圍一圈墨線——甜甜圈
function scene({ bgAt, cx = 150, cy = 150, r = 80, fill = YEL, ring = 6, noise = 0, hole = 0 }) {
  const W = 300, H = 300, d = Buffer.alloc(W * H * 4), rnd = lcg(11);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = bgAt(x, y), acc = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const dd = Math.hypot(x + (sx + 0.5) / 4 - 0.5 - cx, y + (sy + 0.5) / 4 - 0.5 - cy);
      const c = dd > r || dd < hole ? b : dd > r - ring || (hole > 0 && dd < hole + ring) ? [...INK, 255] : [...fill, 255];
      // 照透明度加權混色（透明底的樣本要用）
      acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
    }
    const o = (y * W + x) * 4, a = acc[3] / 16;
    for (let k = 0; k < 3; k++) d[o + k] = a ? Math.max(0, Math.min(255, Math.round(acc[k] / acc[3] + (noise && a === b[3] && b[3] ? (rnd() * 2 - 1) * noise : 0)))) : 0;
    d[o + 3] = Math.round(a);
  }
  return { w: W, h: H, d };
}
const solid = (c) => () => [...c, 255];
// 放到白底上，邊緣（半透明、或不透明但貼著透明的點）最粉紅的程度：(R+B)/2－G。墨線混白是灰色，接近 0
function maxPink(o) {
  let worst = 0;
  for (let y = 1; y < o.h - 1; y++) for (let x = 1; x < o.w - 1; x++) {
    const i = (y * o.w + x) * 4, a = o.d[i + 3];
    if (a === 0) continue;
    const edge = a < 255 || [i - 4, i + 4, i - o.w * 4, i + o.w * 4].some((j) => o.d[j + 3] === 0);
    if (!edge) continue;
    const comp = [0, 1, 2].map((k) => (o.d[i + k] * a + 255 * (255 - a)) / 255);
    worst = Math.max(worst, (comp[0] + comp[2]) / 2 - comp[1]);
  }
  return Math.round(worst);
}
const at = (o, x, y) => { const i = (y * o.w + x) * 4; return [o.d[i], o.d[i + 1], o.d[i + 2], o.d[i + 3]]; };
const SAMPLES = [
  ['K1', '乾淨的反鋸齒墨線圓', 'ok', null, () => scene({ bgAt: solid(MAG) }), (res) => {
    const c = at(res.out, 150, 150), pink = maxPink(res.out), errs = [];
    if (c[3] !== 255 || dist3(c[0], c[1], c[2], YEL) > 2) errs.push(`中心不是原色不透明（${c.join(',')}）`);
    if (pink > 20) errs.push(`放到白底上邊緣偏粉紅 ${pink}（上限 20）`);
    if (res.islands.length || res.holesCleared) errs.push(`不該有被圍住的底色區（報 ${res.islands.length}、去掉 ${res.holesCleared}）`);
    return { errs, note: `中心 ${c.join(',')}、邊緣粉紅度 ${pink}、半透明 ${res.partial} 點、被圍住的底色區 0 塊` };
  }],
  ['K2', '底色有雜訊（±12）', 'ok', null, () => scene({ bgAt: solid(MAG), noise: 12 }), null],
  ['K3', '白底上白色的主體（墨線圍住）', 'ok', null, () => scene({ bgAt: solid(WHITE), fill: WHITE }), (res) => {
    const c = at(res.out, 150, 150), errs = [];
    if (res.clearHoles) errs.push('白底不該自動去掉被圍住的區塊');
    if (c[3] !== 255) errs.push(`中心被去掉了（透明度 ${c[3]}）`);
    if (res.islands.length !== 1) errs.push(`被圍住的底色區要報 1 塊（報了 ${res.islands.length} 塊）`);
    return { errs, note: `留著被圍住的區塊、中心透明度 ${c[3]}、報出 ${res.islands.length} 塊（只報不擋）` };
  }],
  // 洋紅底上的甜甜圈：中間的洞（被圍住的洋紅）要自動去掉，洞的邊緣一樣不能有洋紅色邊
  ['K9', '洋紅底上的甜甜圈（洞被圍住）', 'ok', null, () => scene({ bgAt: solid(MAG), hole: 30 }), (res) => {
    const c = at(res.out, 150, 150), body = at(res.out, 150, 95), pink = maxPink(res.out), errs = [];
    if (!res.clearHoles) errs.push('洋紅底要自動去掉被圍住的區塊');
    if (c[3] !== 0) errs.push(`洞的中心沒去掉（透明度 ${c[3]}）`);
    if (body[3] !== 255) errs.push(`甜甜圈本體被去掉了（透明度 ${body[3]}）`);
    if (res.holesCleared !== 1 || res.islands.length) errs.push(`要去掉 1 塊、不另報（去掉 ${res.holesCleared}、報 ${res.islands.length}）`);
    if (pink > 20) errs.push(`洞邊放到白底上偏粉紅 ${pink}（上限 20）`);
    return { errs, note: `去掉被圍住的區塊 ${res.holesCleared} 塊、洞中心透明度 ${c[3]}、本體透明度 ${body[3]}、邊緣粉紅度 ${pink}` };
  }],
  ['K4', '底色是漸層', '底色不純', null, () => scene({ bgAt: (x) => [255, Math.round(x * 0.8), 255 - Math.round(x * 0.8), 255] }), null],
  ['K5', '主體碰到圖邊', '碰到邊', null, () => scene({ bgAt: solid(MAG), cx: 60 }), null],
  ['K6', '本來就是透明底', 'ok', null, () => scene({ bgAt: () => [0, 0, 0, 0] }), (res, img) => {
    let diff = 0;
    for (let i = 3; i < img.d.length; i += 4) if (res.out.d[i] !== img.d[i]) diff++;
    return { errs: diff ? [`透明度有 ${diff} 點跟輸入不同`] : [], note: `透明度跟輸入不同的點 ${diff} 個` };
  }],
  ['K7', '只有一個小點', '空的', null, () => scene({ bgAt: solid(MAG), r: 6, ring: 3 }), null],
  ['K8', 'tol 給 125、主體顏色跟底色差 122', '主體被吃掉', 125, () => scene({ bgAt: solid(MAG), fill: [133, 0, 255], ring: 0 }), null],
];
export async function selfControls(sharp, tol) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-keyout-ctl-'));
  let bad = 0;
  try {
    for (const [id, name, want, ownTol, make, extra] of SAMPLES) {
      const f = path.join(dir, `${id}.png`);
      await writePNG(sharp, make(), f);
      const img = await readRGBA(sharp, f);
      const res = keyout(img, { tol: ownTol || tol });
      const got = res.ok ? 'ok' : res.kind;
      let note = res.ok ? `不透明 ${Math.round((res.opaque / (img.w * img.h)) * 1000) / 10}%` : res.msg;
      let pass = got === want;
      if (pass && res.ok && extra) {
        const x = extra(res, img);
        note += `；${x.note}`;
        if (x.errs.length) { pass = false; note += `；✗ ${x.errs.join('；')}`; }
      }
      if (!pass) bad++;
      console.log(`${pass ? '✓' : '✗'} 對照 ${id} ${name}：預期「${want === 'ok' ? '放行' : want}」，實得「${got === 'ok' ? '放行' : got}」（${note}）`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return bad;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, dflt) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : dflt; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  const [input, out] = pos;
  const tol = Number(opt('--tol', 48)), holes = opt('--holes', 'auto');
  if (!input || !out || !(tol > 0 && tol < 128) || !['auto', 'keep', 'clear'].includes(holes)) { console.log('用法：node scripts/art-keyout.mjs <一張圖或資料夾> <輸出資料夾> [--tol 48] [--holes auto|keep|clear]'); return 2; }
  const sharp = await loadSharp();
  console.log(`— 合成對照組（每次先跑；tol ${tol}）—`);
  const bad = await selfControls(sharp, tol);
  if (bad) { console.log(`✗ 對照組有 ${bad} 個判錯，不處理真的圖`); return 9; }
  console.log('— 真的圖 —');
  const files = fs.statSync(input).isDirectory()
    ? fs.readdirSync(input).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith('_')).sort().map((f) => path.join(input, f))
    : [input];
  if (!files.length) { console.log(`✗ ${input} 裡沒有圖（.png／.jpg／.jpeg／.webp，底線開頭的不算）`); return 3; }
  const done = [], fails = [];
  for (const f of files) {
    const img = await readRGBA(sharp, f);
    const res = keyout(img, { tol, holes });
    const name = path.basename(f).replace(/\.[^.]+$/, '');
    if (!res.ok) { fails.push(`✗ ${name}：${res.kind}——${res.msg}`); continue; }
    done.push({ name, res });
    const why = holes !== 'auto' ? `--holes ${holes}` : res.clearHoles ? '底色是生圖指定的洋紅' : '底色不是生圖指定的洋紅';
    const isl = res.bg.kind === 'alpha' ? '' : res.clearHoles
      ? `；被圍住的底色區：去掉（${why}）${res.holesCleared} 塊`
      : `；被圍住的底色區：保留（${why}）${res.islands.length ? `，${res.islands.length} 塊（${res.islands.join('、')} 點）只報不擋——如果那裡該透空，改用 --holes clear 重跑` : '，沒有'}`;
    console.log(`  ${name}：${img.w}×${img.h}、底色 ${res.bg.kind === 'alpha' ? '本來就透明' : hex(res.bg.color)}、不透明 ${Math.round((res.opaque / (img.w * img.h)) * 1000) / 10}%、半透明邊 ${res.partial} 點${isl}`);
  }
  if (fails.length) { for (const s of fails) console.log(s); console.log(`✗ ${files.length} 張裡有 ${fails.length} 張不能去背；一個檔都沒寫`); return 3; }
  freshDir(out);
  fs.rmdirSync(out);
  const tmp = `${out}.tmp-${process.pid}`;
  fs.mkdirSync(tmp, { recursive: true });
  const items = [];
  for (const { name, res } of done) {
    const f = path.join(tmp, `${name}.png`);
    await writePNG(sharp, res.out, f);
    items.push({ name, file: f });
  }
  await makeSheet(sharp, items, path.join(tmp, '_sheet.png'), { checker: true, cols: Math.min(3, items.length), numbered: false });
  commitDir(tmp, out);
  console.log(`去背好 ${items.length} 張＋總表 _sheet.png（棋盤格底）→ ${out}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.log('✗ 錯誤：', e.message); process.exitCode = 1; });
}
