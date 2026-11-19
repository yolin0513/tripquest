// 產生 App 圖示（npm run icons）。v1.98.0 起：從 icons/src/ 的兩份 SVG 原稿畫成四張 PNG（sharp）。
// 原稿是描「App 圖示第 1 格參考圖」（鬍鬍捧相機，Yolin 2026-11-19 選定）得到的向量，不加外框；
// 描法、顏色、構圖與當時的檢查見 docs/STATUS.md 的 v1.98.0 那一節與 docs/ART_App圖示.md。
// v1.0～v1.97.0 的舊圖示（藍色圓角方塊＋白色鏡頭）是這支用純 Node 畫的，v1.98.0 換掉。
//
// · 四張都不透明：整張先鋪底色 #C8553D（原稿自己就鋪了，這裡再 flatten 一次、拿掉 alpha 通道）——iPhone 的 apple-touch-icon 不能透明。
// · maskable 用另一份原稿：主體收在中央直徑 80% 的安全圓內。
// · 原稿寫 width="512" height="512"，這裡換成目標尺寸再畫（直接畫成 192／180，不是從 512 縮）。
//
// scripts/icontest.mjs 會 import 這裡的 TARGETS 與 renderIcon 重畫一次，跟 icons/ 裡的 PNG 逐點比——
// 改了原稿或這張表卻沒重跑 npm run icons，它會紅。
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const BG = '#C8553D';
export const SRC_SIZE = 512;
export const ICONS_DIR = fileURLToPath(new URL('../icons/', import.meta.url));
export const SRC_DIR = fileURLToPath(new URL('../icons/src/', import.meta.url));
export const TARGETS = [
  { name: 'icon-192.png', size: 192, src: 'icon.svg' },
  { name: 'icon-512.png', size: 512, src: 'icon.svg' },
  { name: 'icon-maskable-512.png', size: 512, src: 'icon-maskable.svg' },
  { name: 'apple-touch-icon.png', size: 180, src: 'icon.svg' },
];

// svgText：原稿全文；size：輸出邊長。回傳 PNG 的 Buffer（3 通道、不透明）。
export async function renderIcon(svgText, size) {
  const tag = `width="${SRC_SIZE}" height="${SRC_SIZE}"`;
  const n = svgText.split(tag).length - 1;
  if (n !== 1) throw new Error(`原稿裡的 ${tag} 應該剛好 1 處，實際 ${n} 處`);
  const svg = svgText.replace(tag, `width="${size}" height="${size}"`);
  return sharp(Buffer.from(svg)).flatten({ background: BG }).removeAlpha().png().toBuffer();
}

async function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  for (const t of TARGETS) {
    const svg = fs.readFileSync(SRC_DIR + t.src, 'utf8');
    const buf = await renderIcon(svg, t.size);
    fs.writeFileSync(ICONS_DIR + t.name, buf);
    console.log(`wrote icons/${t.name}（${t.size}×${t.size}，從 icons/src/${t.src}，${buf.length} bytes）`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
