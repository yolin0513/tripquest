// 產生 App 圖示（純 Node，無相依）。設計：深色底 + 藍色圓角方塊 + 白色相機鏡頭 + 定位針缺口。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return c1.map((v, i) => Math.round(lerp(v, c2[i], t))); }

function draw(size, { pad = 0.16 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bg1 = [15, 21, 35], bg2 = [26, 41, 74];
  const blue = [91, 140, 255], blueDark = [58, 96, 200];
  const white = [238, 242, 251];
  const cx = size / 2, cy = size / 2;
  const R = size * (0.5 - pad);          // 圓角方塊半徑（外框）
  const corner = R * 0.42;
  const lensR = R * 0.46;
  const dotR = R * 0.16;

  const px = (x, y, col, a = 1) => {
    const i = (y * size + x) * 4;
    const inv = 1 - a;
    buf[i] = buf[i] * inv + col[0] * a;
    buf[i + 1] = buf[i + 1] * inv + col[1] * a;
    buf[i + 2] = buf[i + 2] * inv + col[2] * a;
    buf[i + 3] = Math.max(buf[i + 3], Math.round(a * 255));
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 背景漸層
      const g = (x + y) / (2 * size);
      px(x, y, mix(bg1, bg2, g), 1);

      // 圓角方塊（signed distance to rounded box）
      const dx = Math.abs(x - cx) - (R - corner);
      const dy = Math.abs(y - cy) - (R - corner);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - corner;
      const boxA = clamp(0.5 - outside, 0, 1);
      if (boxA > 0) px(x, y, mix(blue, blueDark, (y - cy + R) / (2 * R)), boxA);

      // 白色鏡頭圓
      const dl = Math.hypot(x - cx, y - cy) - lensR;
      const lensA = clamp(0.5 - dl, 0, 1) * boxA;
      if (lensA > 0) px(x, y, white, lensA);

      // 內圈藍點
      const dd = Math.hypot(x - cx, y - cy) - dotR;
      const dotA = clamp(0.5 - dd, 0, 1) * boxA;
      if (dotA > 0) px(x, y, mix(blue, blueDark, 0.3), dotA);

      // 右上角「定位針」小圓（缺口感）
      const pinx = cx + R * 0.62, piny = cy - R * 0.62;
      const dp = Math.hypot(x - pinx, y - piny) - R * 0.22;
      const pinA = clamp(0.5 - dp, 0, 1);
      if (pinA > 0) px(x, y, [255, 180, 84], pinA);
    }
  }
  return buf;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const targets = [
  { name: 'icon-192.png', size: 192, pad: 0.16 },
  { name: 'icon-512.png', size: 512, pad: 0.16 },
  { name: 'icon-maskable-512.png', size: 512, pad: 0.26 },
  { name: 'apple-touch-icon.png', size: 180, pad: 0.12 },
];
for (const t of targets) {
  const buf = draw(t.size, { pad: t.pad });
  writeFileSync(new URL('../icons/' + t.name, import.meta.url), png(t.size, t.size, buf));
  console.log('wrote icons/' + t.name);
}
