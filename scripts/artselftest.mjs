// 生圖腳本的自帶對照組＋命令列入口（node scripts/artselftest.mjs；2026-11-16）。
// 涵蓋的程式：scripts/art-slice.mjs、scripts/art-keyout.mjs、scripts/art-lib.mjs（三支都在這裡直接點名，run-affected 從引用認得到——
// scripts/ 底下不沿 import 往下展開，所以 art-lib 也要寫出來）。在 test:chain 裡、不在底線：改到這三支才挑這一支。
// 兩支腳本平常只在收到圖時手動跑；這支讓「改了腳本、自帶對照組壞了」在測試鏈上就紅，不等到下一次收圖（Dispatch 2026-11-16 定）。
//   AS1 切圖自帶對照組：從命令列入口跑，對照行剛好 13 個、全是 ✓（數目寫死：少跑一個樣本也紅；加樣本要一起改 N_SLICE）
//   AS2 去背自帶對照組：同上，剛好 9 個（N_KEYOUT）
//   AS3 一張合成九宮格走完切圖→去背（只用預設參數，就是 Yolin 會打的那一行）：a 切圖回 0、9 格＋總表；b 去背回 0、9 張＋總表；
//       c 讀回寫出去的檔，每張四角透明；d 甜甜圈那格的洞透明（預設 --holes auto）。b 紅時 c、d 沒東西可讀，印一行說明、不另算紅
//   AS4 失敗路徑：切圖餵單格的圖 → 回 3、點名「列數不對」、輸出資料夾不存在（不對就一個檔都不寫）
// 不連網、不開瀏覽器；暫存檔寫在系統暫存目錄，收尾刪掉。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSharp, readRGBA, writePNG } from './art-lib.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLICE = 'scripts/art-slice.mjs', KEYOUT = 'scripts/art-keyout.mjs', LIB = 'scripts/art-lib.mjs';
const N_SLICE = 13, N_KEYOUT = 9;
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  // 附上的子程序輸出每一行都縮排：裡面的「✗ 對照…」不能落在行首、被當成這支自己的紅（2026-11-16 突變第一輪踩到）
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 600).split(/\r?\n/).map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
console.log(testedLine(ROOT, [SLICE, KEYOUT, LIB]));

// 自帶對照組的輸出行：「✓ 對照 S1a …」「✗ 對照 K3 …」——只認行首，說明文字裡出現的符號不算
const controls = (out) => (out || '').split(/\r?\n/).map((l) => l.match(/^([✓✗]) 對照 (\S+) /)).filter(Boolean).map((m) => ({ ok: m[1] === '✓', id: m[2] }));
const run = (script, args) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });

// 合成九宮格：600×600 洋紅底、九個墨線圓（不整齊的位置與大小），第 5 格是甜甜圈（中間的洞是被圍住的洋紅）
function grid() {
  const W = 600, d = Buffer.alloc(W * W * 4);
  const cells = [[95, 100, 60], [300, 110, 50], [505, 95, 55], [100, 300, 55], [300, 300, 62], [500, 310, 50], [105, 500, 58], [300, 495, 45], [495, 500, 60]];
  const fills = [[242, 164, 151], [246, 210, 122], [185, 218, 165], [170, 211, 231], [210, 195, 231], [236, 230, 222], [251, 249, 245], [242, 164, 151], [185, 218, 165]];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let c = [255, 0, 255];
    for (let k = 0; k < 9; k++) {
      const [cx, cy, r] = cells[k], dd = Math.hypot(x - cx, y - cy);
      if (dd > r) continue;
      if (k === 4 && dd < 18) break;                                   // 洞
      c = dd > r - 6 || (k === 4 && dd < 24) ? [47, 44, 42] : fills[k];
      break;
    }
    const o = (y * W + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return { w: W, h: W, d };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artselftest-'));
try {
  const sharp = await loadSharp();
  const gridFile = path.join(tmp, 'grid.png'), sliced = path.join(tmp, 'sliced'), keyed = path.join(tmp, 'keyed');
  await writePNG(sharp, grid(), gridFile);
  const names = ['c1', 'c2', 'c3', 'c4', 'donut', 'c6', 'c7', 'c8', 'c9'];

  const s = run(SLICE, [gridFile, sliced, '--names', names.join(',')]);
  const sc = controls(s.stdout);
  yes(sc.length === N_SLICE && new Set(sc.map((c) => c.id)).size === N_SLICE && sc.every((c) => c.ok),
    `AS1 切圖自帶對照組：對照行 ${sc.length} 個（應 ${N_SLICE}）、不重複、判錯的 ${sc.filter((c) => !c.ok).map((c) => c.id).join('、') || '0 個'}`, s.stdout);

  const k = run(KEYOUT, [sliced, keyed]);
  const kc = controls(k.stdout);
  yes(kc.length === N_KEYOUT && new Set(kc.map((c) => c.id)).size === N_KEYOUT && kc.every((c) => c.ok),
    `AS2 去背自帶對照組：對照行 ${kc.length} 個（應 ${N_KEYOUT}）、不重複、判錯的 ${kc.filter((c) => !c.ok).map((c) => c.id).join('、') || '0 個'}`, k.stdout);

  const want = [...names.map((n) => `${n}.png`), '_sheet.png'].sort().join(',');
  const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().join(',') : '（沒有這個資料夾）');
  yes(s.status === 0 && ls(sliced) === want, `AS3a 切圖回 ${s.status}（應 0）、輸出 9 格＋總表（${ls(sliced)}）`, s.stdout);
  yes(k.status === 0 && ls(keyed) === want, `AS3b 去背回 ${k.status}（應 0）、輸出 9 張＋總表（${ls(keyed)}）`, k.stdout);
  if (!(k.status === 0 && ls(keyed) === want)) console.log('說明：AS3c、AS3d 沒驗（去背沒成功，沒有輸出可讀；AS3b 已經紅）');
  else {
    const notClear = [];
    let holeA = -1;
    for (const n of names) {
      const img = await readRGBA(sharp, path.join(keyed, `${n}.png`));
      const A = (x, y) => img.d[(y * img.w + x) * 4 + 3];
      if ([A(0, 0), A(img.w - 1, 0), A(0, img.h - 1), A(img.w - 1, img.h - 1)].some((a) => a !== 0)) notClear.push(n);
      if (n === 'donut') holeA = A(img.w >> 1, img.h >> 1);
    }
    yes(notClear.length === 0, `AS3c 去背後 9 張四角都透明（不透明的：${notClear.join('、') || '0 張'}）`);
    yes(holeA === 0, `AS3d 甜甜圈那格中間的洞是透明的（透明度 ${holeA}）`);
  }

  const loneOut = path.join(tmp, 'lone-out');
  const f = run(SLICE, [path.join(sliced, 'donut.png'), loneOut]);
  const why = (f.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('✗ ') && !l.startsWith('✗ 對照'));
  yes(f.status === 3 && why.some((l) => l.startsWith('✗ 列數不對')) && !fs.existsSync(loneOut),
    `AS4 切圖餵單格的圖：回 ${f.status}（應 3）、理由「${why.join(' / ')}」、輸出資料夾${fs.existsSync(loneOut) ? '存在' : '不存在'}`, f.stdout);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log(`✗ 收尾刪不掉暫存資料夾：${e.code || e.message}`); process.exitCode = 1; }
}

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
