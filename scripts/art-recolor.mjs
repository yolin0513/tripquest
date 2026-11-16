// 生圖素材：把一隻角色畫錯的顏色改回參考圖（2026-11-16；流程見 docs/ART_生圖素材.md 第 9 節）
// 第一個用途：D 豐富版（單張 D 第二版）裡鬍鬍被畫成淺灰毛、白眉毛；參考圖是白毛、淺灰耳朵、灰眉毛（Yolin 選乙案）。
//
// 用法：node scripts/art-recolor.mjs <輸入圖> <輸出圖（要不存在）> <配方：內建名稱，或一個 .json 檔>
//   內建配方：d2-huhu（D 豐富版的鬍鬍；輸入圖的 sha256 要對得上，拿錯圖就停）
//
// 配方寫什麼（座標都是輸入圖的像素）：
//   image：{ w, h }＝輸入圖的尺寸（對不上就停）；sha256：可省略，寫了就要對得上
//   box：[x, y, w, h]＝角色所在的方塊，只有這裡面、角色外框圍住的地方會被改
//   seeds.fur：毛上的幾個點（頭、身體）；seeds.ear：每隻耳朵裡一個點（可省略：省略就跟毛一起改——
//     耳朵的墨線沒把耳朵圍起來的圖，程式分不出耳朵；d2-huhu 就是這樣，參考圖很淡的米灰耳朵這張做不到）
//   brows：[[x, y, w, h], …]＝眉毛所在的方塊（眉毛沒有外框、直接貼在毛上，只能用方塊圈）
//   to：{ fur, ear, brow }＝改成什麼顏色（從參考圖量的 rgb）
//
// 做法：
//   1. 方塊裡亮度 < 0.45 的點當墨線。從方塊四邊往內填色（只走不是墨線的點）＝角色外面；填不到的＝角色（外框＋裡面）。
//      所以角色的外框要是閉合的；有缺口，填色會流進角色裡、碰到種子點 → 停下（「外框有缺口」）。
//   2. 角色裡面、不是墨線的點，照連通塊分開：耳朵（含耳朵種子點的那幾塊）跟其他的毛分開改；耳朵跟毛的種子點落在同一塊 → 停下。
//   3. 量原本的毛色：毛的種子點所在那幾塊裡，低彩度（最大最小通道差 < 16）、亮度 0.70～0.93 的點的各通道中位數；
//      耳朵同樣量。點數不到 50 → 停下（「找不到要改的毛色」）；原本已經跟目標差不到 0.03 的亮度 → 停下（「已經是目標色」）。
//   4. 換色：新色＝目標色＋（原色－原本的毛色）×0.35——保留一點水彩的紋理。只改「像毛」的點，用權重淡入淡出：
//      彩度權重（彩度 10 以下全改、26 以上不改：領巾、臉頰、舌頭、草地、沙地都不動）×亮度權重（0.50 以下不改、0.72 以上全改：
//      墨線、眼睛、鼻子不動；墨線邊上的反鋸齒改一部分）×白色權重（亮度 0.94 以下全改、0.975 以上不改：鬍子這種本來就白的不動）。
//      眉毛方塊裡改用另一條：越白越接近眉毛色、越灰越接近毛的新色（平滑過渡，方塊邊上看不出接縫）；不套白色權重。
//   5. 角色外面、方塊外面一個點都不改；寫檔前逐點比對輸入與輸出，角色外面有任何一點不同就停（「動到外面」）。
//   6. 改完驗收：毛、耳朵的中位數要在目標色 ±6 內，眉毛核心（原本最白的那些點）要在 ±12 內，不然停下、不寫檔。
//   輸入沒有透明通道就照樣寫 3 個通道（不加透明通道，其他點才是逐位元組相同）。
//
// 每次執行先跑合成對照組（同一段程式；樣本先寫成 PNG 再從檔案讀回來，走真的讀檔路徑）：
//   該改：R1 合成的一隻（灰頭、灰耳朵、白眉毛、白鬍子、粉紅臉頰、綠底）——毛、耳朵、眉毛變成目標色，
//          鬍子、臉頰、墨線、底色一個點都不動
//          R10 配方沒寫耳朵——耳朵跟毛一起變成毛的目標色
//   該擋、各擋在自己那一關：R2 外框有缺口；R3 耳朵跟頭之間沒有墨線；R4 毛本來就是白的；R9 毛不是灰（淺藍）＝找不到要改的毛色；
//          R5 圖的尺寸跟配方不符；R8 配方寫了 sha256、圖對不上
//   檢查器自己：R6 「動到外面」的比對——外面改一個點要數到 1、原樣要數到 0；R7 改完驗收——把原圖當成改完的圖，要判不過
//   任何一個判錯（包括擋了、但擋的理由不對）就印「✗ 對照 …」、回 9、不處理真的圖。
// 回傳：0 改好；2 用法錯；3 這張圖不能照配方改（寫明哪一關）；9 對照組沒全對；1 其他錯誤。
// 已知抓不到：配方的方塊、種子點、眉毛方塊是人看圖填的，填錯位置（例如眉毛方塊框到別的白色）程式分不出來——
//   所以改完一定要出前後對照圖、人眼看一次。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSharp } from './art-lib.mjs';

export const RECIPES = {
  'd2-huhu': {
    name: 'D 豐富版的鬍鬍：灰毛改白（耳朵一起）、白眉毛改灰（目標色量自 App 匯出的參考圖）',
    image: { w: 1774, h: 887 },
    sha256: 'fa53a5033b25b365513e74b9fea20ca253ec0408a1c469b1c19f90fa6e011cde',
    box: [722, 596, 200, 230],
    // 耳朵沒寫：這張耳朵內側那條線是開口的，耳朵跟頭是同一塊（2026-11-16 畫連通塊看過）
    seeds: { fur: [[815, 635], [770, 760]] },
    brows: [[802, 649, 31, 19], [854, 641, 29, 19]],
    to: { fur: [251, 249, 245], brow: [195, 189, 183] },
  },
};

const DARK = 0.45, TEX = 0.35;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lumOf = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const med = (a) => { const s = Float64Array.from(a).sort(); return s[Math.floor(s.length / 2)]; };
class Stop extends Error {}

export async function readImage(sharp, file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, c: info.channels, d: data, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}
async function writeImage(sharp, img, file) {
  await sharp(img.d, { raw: { width: img.w, height: img.h, channels: img.c } }).png().toFile(file);
}

// 角色的範圍：方塊裡填不到的點（Uint8Array，1＝角色，含外框）＋裡面不是墨線的點的連通塊編號
export function silhouette(img, box) {
  const [bx, by, bw, bh] = box, { w, c, d } = img;
  const dark = new Uint8Array(bw * bh), outside = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = ((by + y) * w + bx + x) * c;
    dark[y * bw + x] = lumOf(d[i], d[i + 1], d[i + 2]) < DARK ? 1 : 0;
  }
  const q = [];
  const push = (x, y) => { const k = y * bw + x; if (!dark[k] && !outside[k]) { outside[k] = 1; q.push(k); } };
  for (let x = 0; x < bw; x++) { push(x, 0); push(x, bh - 1); }
  for (let y = 0; y < bh; y++) { push(0, y); push(bw - 1, y); }
  while (q.length) {
    const k = q.pop(), x = k % bw, y = (k / bw) | 0;
    if (x > 0) push(x - 1, y);
    if (x < bw - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < bh - 1) push(x, y + 1);
  }
  const comp = new Int32Array(bw * bh).fill(-1);
  let n = 0;
  for (let k0 = 0; k0 < bw * bh; k0++) {
    if (dark[k0] || outside[k0] || comp[k0] >= 0) continue;
    comp[k0] = n; const st = [k0];
    while (st.length) {
      const k = st.pop(), x = k % bw, y = (k / bw) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const m = ny * bw + nx;
        if (!dark[m] && !outside[m] && comp[m] < 0) { comp[m] = n; st.push(m); }
      }
    }
    n++;
  }
  return { dark, outside, comp, n };
}

// 量一組連通塊裡「像毛」的點的中位色
function measure(img, box, comp, ids) {
  const [bx, by, bw, bh] = box, { w, c, d } = img;
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (!ids.has(comp[y * bw + x])) continue;
    const i = ((by + y) * w + bx + x) * c, r = d[i], g = d[i + 1], b = d[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) >= 16) continue;
    const L = lumOf(r, g, b);
    if (L < 0.70 || L > 0.93) continue;
    rs.push(r); gs.push(g); bs.push(b);
  }
  return { n: rs.length, rgb: rs.length ? [med(rs), med(gs), med(bs)] : null };
}

// 一組連通塊裡，低彩度、亮度跟目標差不到 0.03 的點有幾個、整組共幾個點（判「本來就是目標色」用：
// 要佔一半以上才算——頭裡本來就白的鬍子、眉毛只佔一小塊，不能讓「量不到毛色」被誤報成「已經是白的」）
function nearTarget(img, box, comp, ids, to) {
  const [bx, by, bw, bh] = box, { w, c, d } = img, T = lumOf(...to);
  let n = 0, total = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (!ids.has(comp[y * bw + x])) continue;
    total++;
    const i = ((by + y) * w + bx + x) * c, r = d[i], g = d[i + 1], b = d[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 16 && Math.abs(lumOf(r, g, b) - T) < 0.03) n++;
  }
  return { n, total };
}

// 核心：照配方改一張圖。回 { out, report }；不能改就丟 Stop（訊息開頭是哪一關）
export function recolor(img, R) {
  if (img.w !== R.image.w || img.h !== R.image.h) throw new Stop(`圖的尺寸跟配方不符：圖是 ${img.w}×${img.h}，配方寫 ${R.image.w}×${R.image.h}`);
  if (R.sha256 && img.sha256 !== R.sha256) throw new Stop(`圖的 sha256 跟配方不符（拿錯圖了？）：圖是 ${img.sha256.slice(0, 12)}…，配方寫 ${R.sha256.slice(0, 12)}…`);
  const [bx, by, bw, bh] = R.box;
  if (bx < 0 || by < 0 || bx + bw > img.w || by + bh > img.h) throw new Stop(`配方的方塊超出圖：${R.box.join(',')}`);
  const S = silhouette(img, R.box);
  const at = ([x, y]) => (y - by) * bw + (x - bx);
  const earSeeds = R.seeds.ear || [];
  for (const [kind, pts] of [['毛', R.seeds.fur], ['耳朵', earSeeds]]) for (const p of pts) {
    const k = at(p);
    if (p[0] < bx || p[1] < by || p[0] >= bx + bw || p[1] >= by + bh) throw new Stop(`種子點在方塊外面：${kind} (${p.join(',')})`);
    if (S.dark[k]) throw new Stop(`種子點落在墨線上：${kind} (${p.join(',')})`);
    if (S.outside[k]) throw new Stop(`外框有缺口：從方塊外面填色，流進角色裡碰到${kind}的種子點 (${p.join(',')})`);
  }
  const furIds = new Set(R.seeds.fur.map((p) => S.comp[at(p)]));
  const earIds = new Set(earSeeds.map((p) => S.comp[at(p)]));
  for (const id of earIds) if (furIds.has(id)) throw new Stop('耳朵跟毛連在一起：耳朵與毛的種子點落在同一塊（中間沒有墨線隔開）');
  // 配方沒寫耳朵：耳朵跟其他的毛一起改（墨線沒把耳朵圍起來的圖，程式分不出耳朵——d2-huhu 就是這樣）
  const furM = measure(img, R.box, S.comp, furIds), earM = earIds.size ? measure(img, R.box, S.comp, earIds) : null;
  for (const [kind, M, ids, to] of [['毛', furM, furIds, R.to.fur], ...(earM ? [['耳朵', earM, earIds, R.to.ear]] : [])]) {
    if (M.n >= 50) continue;
    const near = nearTarget(img, R.box, S.comp, ids, to);
    if (near.n * 2 >= near.total) throw new Stop(`${kind}已經是目標色：像${kind}的灰點只有 ${M.n} 個，跟目標亮度差不到 0.03 的低彩度點 ${near.n}／${near.total} 個`);
    throw new Stop(`找不到要改的${kind}色：像${kind}的點只有 ${M.n} 個（要 50 個以上）`);
  }
  const inBrow = (x, y) => R.brows.some(([x0, y0, w0, h0]) => x >= x0 && y >= y0 && x < x0 + w0 && y < y0 + h0);
  const furL = lumOf(...furM.rgb);
  const out = { ...img, d: Buffer.from(img.d) };
  const { w, c, d } = img;
  let changed = 0, browCore = [];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x;
    if (S.outside[k]) continue;                     // 角色外面
    const X = bx + x, Y = by + y, i = (Y * w + X) * c;
    const o = [d[i], d[i + 1], d[i + 2]], L = lumOf(...o), ch = Math.max(...o) - Math.min(...o);
    const isEar = earIds.has(S.comp[k]);
    const from = isEar ? earM.rgb : furM.rgb, to = isEar ? R.to.ear : R.to.fur;
    const mapped = o.map((v, j) => Math.min(255, Math.max(0, to[j] + (v - from[j]) * TEX)));
    let target = mapped, wgt = (1 - ss(10, 26, ch)) * ss(0.50, 0.72, L);
    if (!isEar && inBrow(X, Y)) {
      const t = ss(furL + 0.04, 0.97, L);
      target = mapped.map((v, j) => v * (1 - t) + R.to.brow[j] * t);
      if (t > 0.9 && wgt > 0.9) browCore.push(i);
    } else if (!isEar) wgt *= 1 - ss(0.94, 0.975, L);
    for (let j = 0; j < 3; j++) {
      const v = Math.round(o[j] + (target[j] - o[j]) * wgt);
      if (v !== o[j]) { out.d[i + j] = v; changed++; }
    }
  }
  return { out, S, report: { furFrom: furM.rgb, earFrom: earM && earM.rgb, furN: furM.n, earN: earM ? earM.n : 0, changed, furIds, earIds, browCore } };
}

// 檢查器 1：角色外面（含方塊外面）有幾個點不同
export function outsideDiff(a, b, R, S) {
  const [bx, by, bw, bh] = R.box;
  let n = 0;
  for (let Y = 0; Y < a.h; Y++) for (let X = 0; X < a.w; X++) {
    const x = X - bx, y = Y - by;
    const inside = x >= 0 && y >= 0 && x < bw && y < bh && !S.outside[y * bw + x];
    if (inside) continue;
    const i = (Y * a.w + X) * a.c;
    for (let j = 0; j < a.c; j++) if (a.d[i + j] !== b.d[i + j]) { n++; break; }
  }
  return n;
}
// 檢查器 2：改完驗收（毛、耳朵在目標 ±6、眉毛核心 ±12）；回不過的理由清單
export function verifyAfter(after, R, S, rep) {
  const bad = [];
  for (const [kind, ids, to] of [['毛', rep.furIds, R.to.fur], ...(rep.earIds.size ? [['耳朵', rep.earIds, R.to.ear]] : [])]) {
    const [bx, by, bw, bh] = R.box, rs = [[], [], []];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!ids.has(S.comp[y * bw + x])) continue;
      const i = ((by + y) * after.w + bx + x) * after.c;
      const p = [after.d[i], after.d[i + 1], after.d[i + 2]];
      if (Math.max(...p) - Math.min(...p) >= 16 || lumOf(...p) < 0.70) continue;
      if (kind === '毛' && R.brows.some(([x0, y0, w0, h0]) => bx + x >= x0 && by + y >= y0 && bx + x < x0 + w0 && by + y < y0 + h0)) continue;
      p.forEach((v, j) => rs[j].push(v));
    }
    const m = rs.map(med);
    if (!rs[0].length || m.some((v, j) => Math.abs(v - to[j]) > 6)) bad.push(`${kind}沒有變成目標色：中位 rgb(${m.join(',')})，目標 rgb(${to.join(',')})`);
  }
  if (R.brows.length) {
    const rs = [[], [], []];
    for (const i of rep.browCore) for (let j = 0; j < 3; j++) rs[j].push(after.d[i + j]);
    const m = rs.map(med);
    if (!rs[0].length || m.some((v, j) => Math.abs(v - R.to.brow[j]) > 12)) bad.push(`眉毛沒有變成目標色：核心 ${rs[0].length} 點，中位 rgb(${m.join(',')})，目標 rgb(${R.to.brow.join(',')})`);
  }
  return bad;
}

// ---------- 合成對照組 ----------
// 200×160、綠底：頭＝圓（中心 90,90、半徑 50，灰毛，墨線 4px）；耳朵＝右上的小圓（中心 135,50、半徑 22，灰，墨線 4px），
// 跟頭重疊的那一塊整塊是墨線（耳朵與頭隔開）；眉毛＝頭裡一塊白色（70..90, 62..72，沒有墨線）；鬍子＝頭下半一塊白色
// （70..110, 105..125）；臉頰＝粉紅小塊（110..118, 92..100）
const SYN_GRAY = [228, 224, 219];
function synth({ gap = false, earJoined = false, whiteFur = false, blueFur = false } = {}) {
  const W = 200, H = 160, d = Buffer.alloc(W * H * 3);
  const put = (x, y, rgb) => { const i = (y * W + x) * 3; d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; };
  const fur = whiteFur ? [251, 249, 245] : blueFur ? [170, 200, 240] : SYN_GRAY;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let col = [120, 190, 110];
    const dh = Math.hypot(x - 90, y - 90), de = Math.hypot(x - 135, y - 50);
    const inHead = dh <= 50, inEar = de <= 22;
    const ringHead = dh > 46 && dh <= 50, ringEar = de > 18 && de <= 22;
    if (inEar) col = ringEar ? [30, 28, 28] : SYN_GRAY;
    if (inHead) col = ringHead ? [30, 28, 28] : fur;
    // 耳朵與頭重疊的那一塊：預設整塊是墨線（隔開）；earJoined＝那一塊改成灰毛，耳朵的內部直接連到頭的內部
    if (inHead && inEar) col = earJoined ? SYN_GRAY : [30, 28, 28];
    if (inHead && !ringHead && x >= 70 && x < 90 && y >= 62 && y < 72) col = [252, 252, 252];
    if (inHead && !ringHead && x >= 70 && x < 110 && y >= 105 && y < 125) col = [253, 253, 254];
    if (inHead && !ringHead && x >= 110 && x < 118 && y >= 92 && y < 100) col = [240, 160, 160];
    if (gap && ringHead && y > 85 && y < 95 && x < 60) col = [120, 190, 110];
    put(x, y, col);
  }
  return { w: W, h: H, c: 3, d };
}
const SYN_R = {
  image: { w: 200, h: 160 }, box: [0, 0, 200, 160],
  seeds: { fur: [[90, 85]], ear: [[140, 40]] }, brows: [[68, 60, 24, 14]],
  to: { fur: [251, 249, 245], ear: [236, 230, 222], brow: [195, 189, 183] },
};

async function selfTest(sharp) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-recolor-ctl-'));
  let allOk = true;
  const say = (ok, id, msg) => { console.log(`${ok ? '✓' : '✗'} 對照 ${id} ${msg}`); if (!ok) allOk = false; };
  const viaFile = async (img, name) => { const f = path.join(dir, name + '.png'); await writeImage(sharp, img, f); return readImage(sharp, f); };
  const expectStop = async (id, img, R, head, label) => {
    let msg = '（沒有停）';
    try { recolor(await viaFile(img, id), R); } catch (e) { msg = e instanceof Stop ? e.message : '（不是預期的停：' + e.message + '）'; }
    say(msg.startsWith(head), id, `${label}：${msg}`);
  };
  try {
    // R1 該改
    const src = await viaFile(synth(), 'R1');
    const { out, S, report } = recolor(src, SYN_R);
    const P = (img, x, y) => { const i = (y * img.w + x) * img.c; return [img.d[i], img.d[i + 1], img.d[i + 2]].join(','); };
    const same = (x, y) => P(src, x, y) === P(out, x, y);
    const near = (x, y, to, tol) => P(out, x, y).split(',').every((v, j) => Math.abs(+v - to[j]) <= tol);
    const checks = [
      ['毛變白', near(60, 90, SYN_R.to.fur, 6)], ['耳朵變淺灰', near(140, 40, SYN_R.to.ear, 6)], ['眉毛變灰', near(80, 67, SYN_R.to.brow, 12)],
      ['鬍子不動', same(90, 115)], ['臉頰不動', same(114, 96)], ['墨線不動', same(90, 41)], ['底色不動', same(5, 5)],
      ['外面一點都沒動', outsideDiff(src, out, SYN_R, S) === 0], ['驗收通過', verifyAfter(out, SYN_R, S, report).length === 0],
    ];
    say(checks.every((x) => x[1]), 'R1', `合成的一隻該改：${checks.map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' ')}`);
    await expectStop('R2', synth({ gap: true }), SYN_R, '外框有缺口', '頭的外框開一個缺口');
    await expectStop('R3', synth({ earJoined: true }), SYN_R, '耳朵跟毛連在一起', '耳朵與頭之間沒有墨線');
    await expectStop('R4', synth({ whiteFur: true }), SYN_R, '毛已經是目標色', '毛本來就是白的');
    await expectStop('R9', synth({ blueFur: true }), SYN_R, '找不到要改的毛色', '毛是淺藍色（不是灰）');
    // R10 配方沒寫耳朵：耳朵跟毛一起變成毛的目標色（d2-huhu 走的就是這一條）
    {
      const R0 = { ...SYN_R, seeds: { fur: SYN_R.seeds.fur }, to: { fur: SYN_R.to.fur, brow: SYN_R.to.brow } };
      const s0 = await viaFile(synth(), 'R10');
      const r0 = recolor(s0, R0);
      const P0 = (img, x, y) => { const i = (y * img.w + x) * img.c; return [img.d[i], img.d[i + 1], img.d[i + 2]]; };
      const earWhite = P0(r0.out, 140, 40).every((v, j) => Math.abs(v - R0.to.fur[j]) <= 6);
      const outOk = outsideDiff(s0, r0.out, R0, r0.S) === 0, verOk = verifyAfter(r0.out, R0, r0.S, r0.report).length === 0;
      say(earWhite && outOk && verOk, 'R10', `配方沒寫耳朵：耳朵跟毛一起變白${earWhite ? '✓' : '✗'}（rgb(${P0(r0.out, 140, 40).join(',')})） 外面沒動${outOk ? '✓' : '✗'} 驗收${verOk ? '✓' : '✗'}`);
    }
    await expectStop('R5', synth(), { ...SYN_R, image: { w: 201, h: 160 } }, '圖的尺寸跟配方不符', '配方的尺寸寫錯');
    await expectStop('R8', synth(), { ...SYN_R, sha256: '0'.repeat(64) }, '圖的 sha256 跟配方不符', '配方的 sha256 對不上');
    // R6 「動到外面」的比對：外面改一個點 → 1；原樣 → 0
    const poked = { ...out, d: Buffer.from(out.d) };
    poked.d[(3 * 200 + 3) * 3] ^= 1;
    const n1 = outsideDiff(src, poked, SYN_R, S), n0 = outsideDiff(src, out, SYN_R, S);
    say(n1 === 1 && n0 === 0, 'R6', `「動到外面」的比對：外面改一個點數到 ${n1}（應 1）、原樣數到 ${n0}（應 0）`);
    // R7 改完驗收：原圖當成改完的圖 → 要判不過，而且毛、耳朵、眉毛三項都要點名
    const bad = verifyAfter(src, SYN_R, S, report);
    say(['毛沒有', '耳朵沒有', '眉毛沒有'].every((h) => bad.some((b) => b.startsWith(h))), 'R7', `改完驗收拿原圖來驗：不過的 ${bad.length} 項（應 3）`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return allOk;
}

async function main() {
  const [input, output, recipeArg] = process.argv.slice(2);
  const sharp = await loadSharp();
  if (!(await selfTest(sharp))) { console.log('✗ 對照組沒全對，不處理真的圖'); return 9; }
  if (!input || !output || !recipeArg) { console.log('用法：node scripts/art-recolor.mjs <輸入圖> <輸出圖（要不存在）> <配方：' + Object.keys(RECIPES).join('／') + '，或 .json 檔>'); return 2; }
  const R = RECIPES[recipeArg] || (recipeArg.endsWith('.json') && fs.existsSync(recipeArg) ? JSON.parse(fs.readFileSync(recipeArg, 'utf8')) : null);
  if (!R) { console.log(`用法：不認得的配方「${recipeArg}」（內建：${Object.keys(RECIPES).join('、')}；或給一個存在的 .json 檔）`); return 2; }
  if (fs.existsSync(output)) { console.log(`用法：輸出檔已經存在：${output}（換一個新的檔名）`); return 2; }
  if (path.resolve(input) === path.resolve(output)) { console.log('用法：輸出不能跟輸入是同一個檔'); return 2; }
  const img = await readImage(sharp, input);
  let res;
  try { res = recolor(img, R); } catch (e) { if (e instanceof Stop) { console.log('✗ ' + e.message); return 3; } throw e; }
  const outN = outsideDiff(img, res.out, R, res.S);
  if (outN) { console.log(`✗ 動到外面：角色外面有 ${outN} 個點跟輸入不同，不寫檔`); return 3; }
  const bad = verifyAfter(res.out, R, res.S, res.report);
  if (bad.length) { for (const b of bad) console.log('✗ ' + b); return 3; }
  const tmp = output + '.tmp-' + process.pid + '.png';
  await writeImage(sharp, res.out, tmp);
  const back = await readImage(sharp, tmp);
  const backN = back.w === img.w && back.h === img.h && back.c === img.c ? outsideDiff(img, back, R, res.S) : -1;
  if (backN !== 0) { fs.rmSync(tmp, { force: true }); console.log(`✗ 寫出去再讀回來對不上（外面不同的點 ${backN}；-1＝尺寸或通道數變了），不寫檔`); return 3; }
  fs.renameSync(tmp, output);
  const r = res.report;
  console.log(`說明：配方「${recipeArg}」${R.name ? '（' + R.name + '）' : ''}`);
  console.log(`說明：原本的毛 rgb(${r.furFrom.join(',')})（量了 ${r.furN} 點）→ rgb(${R.to.fur.join(',')})；` +
    (r.earFrom ? `耳朵 rgb(${r.earFrom.join(',')})（${r.earN} 點）→ rgb(${R.to.ear.join(',')})；` : '耳朵沒有另外指定（跟毛一起改）；') +
    `眉毛 → rgb(${R.to.brow.join(',')})（核心 ${r.browCore.length} 點）`);
  console.log(`說明：改了 ${r.changed} 個通道值；角色外面不同的點 0（逐點比過，寫出去讀回來也比過）；寫出 ${output}（${img.w}×${img.h}、${img.c} 通道）`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.log('✗ 其他錯誤：' + (e && e.stack || e)); process.exitCode = 1; });
}
