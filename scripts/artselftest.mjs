// 生圖腳本的自帶對照組＋命令列入口（node scripts/artselftest.mjs；2026-11-16）。
// 涵蓋的程式：scripts/art-slice.mjs、scripts/art-keyout.mjs、scripts/art-lib.mjs、scripts/art-recolor.mjs（2026-11-16 晚加；
// 四支都在這裡直接點名，run-affected 從引用認得到——scripts/ 底下不沿 import 往下展開，所以 art-lib 也要寫出來）。
// 在 test:chain 裡、不在底線：改到這四支才挑這一支。
// 兩支腳本平常只在收到圖時手動跑；這支讓「改了腳本、自帶對照組壞了」在測試鏈上就紅，不等到下一次收圖（Dispatch 2026-11-16 定）。
//   AS1 切圖自帶對照組：從命令列入口跑，對照行剛好 16 個、全是 ✓（數目寫死：少跑一個樣本也紅；加樣本要一起改 N_SLICE）
//   AS2 去背自帶對照組：同上，剛好 9 個（N_KEYOUT）
//   AS3 一張合成九宮格走完切圖→去背（只用預設參數，就是 Yolin 會打的那一行）：a 切圖回 0、9 格＋總表；b 去背回 0、9 張＋總表；
//       c 讀回寫出去的檔，每張四角透明；d 甜甜圈那格的洞透明（預設 --holes auto）。b 紅時 c、d 沒東西可讀，印一行說明、不另算紅
//   AS4 失敗路徑：切圖餵單格的圖 → 回 3、點名「列數不對」、輸出資料夾不存在（不對就一個檔都不寫）
//   AS5 好格照切、壞格點名：第 9 格碰到圖邊的 3×3 → 回 4、輸出 8 格＋總表＋_missing.txt、c9 沒寫、_missing.txt 點名 c9「碰到邊」
//   AS6 格數：800×800 的 4×4 用 --grid 4 與 16 個名稱 → 回 0、輸出 16 格＋總表
//   AS7 全部壞：9 格都只有一條細線（每格都「空格」）→ 回 3、點名「全部不能切」、輸出資料夾不存在
//   AS8 改色：a 自帶對照組剛好 10 個（N_RECOLOR）、全是 ✓；b 合成的灰頭照 .json 配方改——回 0、讀回來還是 3 通道、
//       毛變白、眉毛變灰、頭外面一個點都沒動（AS8b 沒有輸出時印一行紅、不另讀檔）
//   AS9 改色的失敗路徑：頭的墨線開缺口 → 回 3、點名「外框有缺口」、輸出檔不存在
// 不連網、不開瀏覽器；暫存檔寫在系統暫存目錄，收尾刪掉。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSharp, readRGBA, writePNG } from './art-lib.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLICE = 'scripts/art-slice.mjs', KEYOUT = 'scripts/art-keyout.mjs', LIB = 'scripts/art-lib.mjs', RECOLOR = 'scripts/art-recolor.mjs';
const N_SLICE = 16, N_KEYOUT = 9, N_RECOLOR = 10;
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  // 附上的子程序輸出每一行都縮排：裡面的「✗ 對照…」不能落在行首、被當成這支自己的紅（2026-11-16 突變第一輪踩到）
  else { console.log('✗ ' + m + (extra ? '\n' + String(extra).slice(0, 600).split(/\r?\n/).map((l) => '   ' + l).join('\n') : '')); process.exitCode = 1; }
};
console.log(testedLine(ROOT, [SLICE, KEYOUT, LIB, RECOLOR]));

// 自帶對照組的輸出行：「✓ 對照 S1a …」「✗ 對照 K3 …」——只認行首，說明文字裡出現的符號不算
const controls = (out) => (out || '').split(/\r?\n/).map((l) => l.match(/^([✓✗]) 對照 (\S+) /)).filter(Boolean).map((m) => ({ ok: m[1] === '✓', id: m[2] }));
const run = (script, args) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });

// 合成九宮格：600×600 洋紅底、九個墨線圓（不整齊的位置與大小），第 5 格是甜甜圈（中間的洞是被圍住的洋紅）
// edge＝第 9 格移到碰到右邊圖邊（AS5 用）
function grid({ edge = false } = {}) {
  const W = 600, d = Buffer.alloc(W * W * 4);
  const cells = [[95, 100, 60], [300, 110, 50], [505, 95, 55], [100, 300, 55], [300, 300, 62], [500, 310, 50], [105, 500, 58], [300, 495, 45], edge ? [560, 500, 60] : [495, 500, 60]];
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
// 4×4：800×800 洋紅底、16 個實心圓（AS6 用）
function grid4() {
  const W = 800, d = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const cx = 100 + 200 * Math.min(3, Math.floor(x / 200)), cy = 100 + 200 * Math.min(3, Math.floor(y / 200)), dd = Math.hypot(x - cx, y - cy);
    const c = dd > 55 ? [255, 0, 255] : dd > 49 ? [47, 44, 42] : [246, 210, 122];
    const o = (y * W + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return { w: W, h: W, d };
}
// 9 格都只有一條 2×40 的細線（AS7 用：每一格都是「空格」）
function lines() {
  const W = 600, d = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const near = [100, 300, 500].some((cx) => x >= cx && x < cx + 2) && [100, 300, 500].some((cy) => y >= cy - 20 && y < cy + 20);
    const c = near ? [47, 44, 42] : [255, 0, 255], o = (y * W + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return { w: W, h: W, d };
}

// 改色用的合成圖（AS8、AS9；跟 art-recolor.mjs 自帶的樣本分開畫，不共用零件）：160×120 淺綠底、灰頭（中心 70,60、半徑 40、墨線 4px）、
// 頭裡一塊白色眉毛（55..75, 40..48）；gap＝頭的左邊墨線開一個缺口
function recolorSample({ gap = false } = {}) {
  const W = 160, H = 120, d = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dd = Math.hypot(x - 70, y - 60);
    let c = [150, 205, 130];
    if (dd <= 40) c = dd > 36 ? [40, 36, 36] : [226, 222, 216];
    if (dd <= 36 && x >= 55 && x < 75 && y >= 40 && y < 48) c = [252, 252, 252];
    if (gap && dd > 36 && dd <= 40 && x < 40 && y > 55 && y < 65) c = [150, 205, 130];
    const o = (y * W + x) * 3;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
  }
  return d;
}
const RECOLOR_RECIPE = {
  image: { w: 160, h: 120 }, box: [0, 0, 160, 120], seeds: { fur: [[70, 75]] }, brows: [[53, 38, 24, 12]],
  to: { fur: [251, 249, 245], brow: [195, 189, 183] },
};

const tmp =fs.mkdtempSync(path.join(os.tmpdir(), 'artselftest-'));
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

  // AS5：第 9 格碰到圖邊 → 其他 8 格照切、c9 點名
  const edgeFile = path.join(tmp, 'edge.png'), edgeOut = path.join(tmp, 'edge-out');
  await writePNG(sharp, grid({ edge: true }), edgeFile);
  const p = run(SLICE, [edgeFile, edgeOut, '--names', names.join(',')]);
  const wantPartial = [...names.filter((n) => n !== 'c9').map((n) => `${n}.png`), '_missing.txt', '_sheet.png'].sort().join(',');
  const miss = fs.existsSync(path.join(edgeOut, '_missing.txt')) ? fs.readFileSync(path.join(edgeOut, '_missing.txt'), 'utf8') : '';
  const missLines = miss.split(/\r?\n/).filter((l) => /^\d+\. /.test(l));
  yes(p.status === 4 && ls(edgeOut) === wantPartial && missLines.length === 1 && missLines[0].startsWith('9. c9（第 3 列第 3 格）：碰到邊：'),
    `AS5 一格碰到圖邊：回 ${p.status}（應 4）、輸出（${ls(edgeOut)}）、_missing.txt 點名 ${missLines.length} 格「${missLines.join(' / ').slice(0, 80)}」`, p.stdout);

  // AS6：4×4 用 --grid 4
  const g4File = path.join(tmp, 'g4.png'), g4Out = path.join(tmp, 'g4-out');
  await writePNG(sharp, grid4(), g4File);
  const names16 = Array.from({ length: 16 }, (_, i) => `d${i + 1}`);
  const q = run(SLICE, [g4File, g4Out, '--grid', '4', '--names', names16.join(',')]);
  const want16 = [...names16.map((n) => `${n}.png`), '_sheet.png'].sort().join(',');
  yes(q.status === 0 && ls(g4Out) === want16, `AS6 4×4 用 --grid 4：回 ${q.status}（應 0）、輸出 ${fs.existsSync(g4Out) ? fs.readdirSync(g4Out).length : 0} 個檔（應 17）`, q.stdout);

  // AS7：9 格全部壞 → 一個檔都不寫
  const linesFile = path.join(tmp, 'lines.png'), linesOut = path.join(tmp, 'lines-out');
  await writePNG(sharp, lines(), linesFile);
  const z = run(SLICE, [linesFile, linesOut]);
  const zWhy = (z.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('✗ ') && !l.startsWith('✗ 對照'));
  yes(z.status === 3 && zWhy.some((l) => l.startsWith('✗ 9 格全部不能切')) && !fs.existsSync(linesOut),
    `AS7 9 格全部空格：回 ${z.status}（應 3）、理由「${zWhy.join(' / ')}」、輸出資料夾${fs.existsSync(linesOut) ? '存在' : '不存在'}`, z.stdout);

  // AS8：改色——自帶對照組剛好 N_RECOLOR 個、全是 ✓；合成圖照 .json 配方改：回 0、讀回來毛變白、眉毛變灰、底色一個點都沒動
  const rcIn = path.join(tmp, 'rc-in.png'), rcOut = path.join(tmp, 'rc-out.png'), rcRecipe = path.join(tmp, 'rc.json');
  await sharp(recolorSample(), { raw: { width: 160, height: 120, channels: 3 } }).png().toFile(rcIn);
  fs.writeFileSync(rcRecipe, JSON.stringify(RECOLOR_RECIPE));
  const rc = run(RECOLOR, [rcIn, rcOut, rcRecipe]);
  const rcc = controls(rc.stdout);
  yes(rcc.length === N_RECOLOR && new Set(rcc.map((c) => c.id)).size === N_RECOLOR && rcc.every((c) => c.ok),
    `AS8a 改色自帶對照組：對照行 ${rcc.length} 個（應 ${N_RECOLOR}）、不重複、判錯的 ${rcc.filter((c) => !c.ok).map((c) => c.id).join('、') || '0 個'}`, rc.stdout);
  if (rc.status !== 0 || !fs.existsSync(rcOut)) yes(false, `AS8b 改色回 ${rc.status}（應 0）、輸出${fs.existsSync(rcOut) ? '在' : '不在'}`, rc.stdout);
  else {
    const a = await sharp(rcIn).raw().toBuffer({ resolveWithObject: true }), b = await sharp(rcOut).raw().toBuffer({ resolveWithObject: true });
    const P = (r, x, y) => { const i = (y * 160 + x) * r.info.channels; return [r.data[i], r.data[i + 1], r.data[i + 2]]; };
    const near = (p, t, tol) => p.every((v, j) => Math.abs(v - t[j]) <= tol);
    let bgDiff = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) if (Math.hypot(x - 70, y - 60) > 41 && P(a, x, y).join() !== P(b, x, y).join()) bgDiff++;
    const furOk = near(P(b, 70, 75), RECOLOR_RECIPE.to.fur, 6), browOk = near(P(b, 65, 44), RECOLOR_RECIPE.to.brow, 12);
    yes(b.info.channels === 3 && furOk && browOk && bgDiff === 0,
      `AS8b 改色回 0、讀回來 ${b.info.channels} 通道（應 3）、毛 rgb(${P(b, 70, 75).join(',')})${furOk ? '' : '✗'}、眉毛 rgb(${P(b, 65, 44).join(',')})${browOk ? '' : '✗'}、頭外面不同的點 ${bgDiff}（應 0）`, rc.stdout);
  }

  // AS9：改色的失敗路徑——頭的墨線有缺口 → 回 3、理由「外框有缺口」、輸出檔不存在
  const gapIn = path.join(tmp, 'rc-gap.png'), gapOut = path.join(tmp, 'rc-gap-out.png');
  await sharp(recolorSample({ gap: true }), { raw: { width: 160, height: 120, channels: 3 } }).png().toFile(gapIn);
  const g = run(RECOLOR, [gapIn, gapOut, rcRecipe]);
  const gWhy = (g.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('✗ ') && !l.startsWith('✗ 對照'));
  yes(g.status === 3 && gWhy.some((l) => l.startsWith('✗ 外框有缺口')) && !fs.existsSync(gapOut),
    `AS9 改色餵外框有缺口的圖：回 ${g.status}（應 3）、理由「${gWhy.join(' / ')}」、輸出檔${fs.existsSync(gapOut) ? '存在' : '不存在'}`, g.stdout);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log(`✗ 收尾刪不掉暫存資料夾：${e.code || e.message}`); process.exitCode = 1; }
}

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
