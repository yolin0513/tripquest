// 生圖素材的共用小工具（2026-11-16；art-slice.mjs、art-keyout.mjs 用）——流程見 docs/ART_生圖素材.md
// 只做影像的讀寫與量測，不碰 App 的程式。影像程式庫用 sharp（package.json 的 devDependencies）；
// 找不到就直接丟錯、講明是「找不到 sharp」，不默默跳過。
import fs from 'node:fs';
import path from 'node:path';

export async function loadSharp() {
  try { return (await import('sharp')).default; }
  catch (e) { throw new Error(`找不到 sharp（影像程式庫；package.json 有寫，要先 npm install）：${e.message}`); }
}

// 讀成 RGBA 原始像素：{ w, h, d }（d 是 Buffer，每像素 4 個位元組）
export async function readRGBA(sharp, file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`讀出來不是 4 個通道（${info.channels}）：${file}`);
  return { w: info.width, h: info.height, d: data };
}
export async function writePNG(sharp, img, file) {
  await sharp(img.d, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toFile(file);
}

// 兩個顏色的距離：三個通道差的最大值（0～255）
export const dist3 = (r, g, b, c) => Math.max(Math.abs(r - c[0]), Math.abs(g - c[1]), Math.abs(b - c[2]));
export const px = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2], img.d[i + 3]]; };

// 從最外 ring 像素那一圈量底色：
//   透明的佔九成以上 → 底是透明的（kind 'alpha'）；否則取不透明那些的各通道中位數當底色，
//   uniform＝邊框像素裡跟底色距離 ≤ tol 的比例（真圖有雜訊、壓縮痕跡，所以看比例、不要求每一點都一樣）
export function borderBg(img, tol, ring = 2) {
  const pts = [];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (x >= ring && y >= ring && x < img.w - ring && y < img.h - ring) continue;
    pts.push(px(img, x, y));
  }
  const clear = pts.filter((p) => p[3] < 16).length;
  if (clear / pts.length >= 0.9) return { kind: 'alpha', color: null, uniform: clear / pts.length, n: pts.length };
  const solid = pts.filter((p) => p[3] >= 16);
  const med = (k) => { const v = solid.map((p) => p[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const color = [med(0), med(1), med(2)];
  const uniform = pts.filter((p) => p[3] >= 16 && dist3(p[0], p[1], p[2], color) <= tol).length / pts.length;
  return { kind: 'color', color, uniform, n: pts.length };
}

// 這一點算不算底色
export function makeIsBg(img, bg, tol) {
  if (bg.kind === 'alpha') return (i) => img.d[i + 3] < 16;
  const c = bg.color;
  return (i) => img.d[i + 3] < 16 || dist3(img.d[i], img.d[i + 1], img.d[i + 2], c) <= tol;
}
export const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// 輸出資料夾：不存在就建；存在而且不是空的 → 丟錯（不跟舊的混在一起）
export function freshDir(dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`輸出資料夾不是空的：${dir}（先換一個新的資料夾）`);
  fs.mkdirSync(dir, { recursive: true });
}
// 先寫進暫存資料夾、全部成功才一起搬進輸出資料夾（任何一張失敗就一個都不寫）
export function commitDir(tmp, dir) {
  freshDir(dir);
  for (const f of fs.readdirSync(tmp)) fs.renameSync(path.join(tmp, f), path.join(dir, f));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 總表：每一張縮到 box 見方排成一張，下面寫編號與暫定名（只用英數字，避免字型缺字）；checker＝透明處畫棋盤格；
// numbered＝寫不寫編號（切圖的編號是格子裡的位置；去背照檔名排序，編號沒有意思、會跟位置搞混，所以不寫）；
// items[k].missing＝這一格沒切出來（切圖的壞格）：畫一個打叉的灰格、名稱後面標 BAD，位置照樣佔住
export async function makeSheet(sharp, items, out, { box = 200, cols = 3, checker = false, numbered = true } = {}) {
  const padX = 16, labelH = 30, cw = box + padX * 2, ch = box + labelH + padX;
  const rows = Math.ceil(items.length / cols), W = cw * cols, H = ch * rows;
  const layers = [];
  for (let k = 0; k < items.length; k++) {
    const x = (k % cols) * cw + padX, y = Math.floor(k / cols) * ch + padX;
    if (checker) {
      const s = 12, rects = [];
      for (let yy = 0; yy < box; yy += s) for (let xx = 0; xx < box; xx += s) if (((xx + yy) / s) % 2 === 0) rects.push(`<rect x="${xx}" y="${yy}" width="${s}" height="${s}" fill="#d9d9d9"/>`);
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}"><rect width="100%" height="100%" fill="#ffffff"/>${rects.join('')}</svg>`), left: x, top: y });
    }
    const img = items[k].missing
      ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}"><rect width="100%" height="100%" fill="#e6e1d8"/><path d="M 30 30 L ${box - 30} ${box - 30} M ${box - 30} 30 L 30 ${box - 30}" stroke="#b5463c" stroke-width="12" stroke-linecap="round"/></svg>`)
      : await sharp(items[k].file).resize(box, box, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    layers.push({ input: img, left: x, top: y });
    const label = `${numbered ? `${k + 1}. ` : ''}${items[k].name}${items[k].missing ? ' - BAD' : ''}`.replace(/[^\x20-\x7e]/g, '?').replace(/[<&>]/g, '_');
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${labelH}"><text x="${padX}" y="21" font-family="Arial, sans-serif" font-size="18" fill="#2f2c2a">${label}</text></svg>`), left: x - padX, top: y + box + 2 });
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 250, g: 247, b: 240, alpha: 1 } } }).composite(layers).png().toFile(out);
}
