// App 圖示（v1.98.0；npm run icontest；不連網、不開瀏覽器、秒級）。
// 涵蓋：scripts/make-icons.mjs、icons/src/icon.svg、icons/src/icon-maskable.svg、icons/icon-192.png、icons/icon-512.png、
//   icons/icon-maskable-512.png、icons/apple-touch-icon.png、manifest.webmanifest、index.html（都在這裡點名，run-affected 從引用認得到）。
// 在 test:chain 裡、不在底線：改到上面任一個才挑這一支。
//
//   IC1 四張的尺寸照 make-icons.mjs 的 TARGETS（192／512／512／180）
//   IC2 四張都沒有透明通道（iPhone 的 apple-touch-icon 不能透明；另外三張也整張畫滿底色）
//   IC3 maskable 的主體（跟底色 #C8553D 差超過 24 的畫素）全部在中央直徑 80% 的安全圓內（最遠點 ≤ 204.8 px），
//       而且主體畫素 ≥ 20000（母體非空：整張只有底色時「沒有畫素出圈」也成立）
//   IC4 icons/ 的四張 PNG 跟 icons/src/ 的原稿用 make-icons.mjs 的 renderIcon 重畫出來的逐點相同（每個通道差 ≤ 2）
//       ——改了原稿或尺寸表卻沒重跑 npm run icons，這一道紅
//   IC5 manifest.webmanifest 每一張圖示宣告的 sizes 等於檔案實際尺寸、指到的檔在 TARGETS 裡、maskable 那張 purpose 含 maskable；
//       index.html 的 rel="icon" 與 rel="apple-touch-icon" 各剛好一個、指到的檔存在而且在 TARGETS 裡
//
// 對照組（共用慣例 §5.3、§5.20）：每一道各自一個，在系統暫存目錄放一份 repo 的複本（index.html、manifest、icons/ 含 src/），
//   各弄壞一處、寫完先讀回確認壞的那一處真的在檔裡，再用同一個 checkIcons() 讀那份真的檔；斷言「失敗清單裡有那一道的編號」
//   ——不是「有任何一道紅」：弄壞尺寸時 IC4、IC5 也會跟著紅，只看有沒有紅，拿掉 IC1 也照樣過。
//   K1 icon-192 換成 191 見方 → IC1      K2 apple-touch-icon 加上透明通道 → IC2
//   K3 maskable 換成放大 1.25 倍畫的 → IC3（出圈）      K3b maskable 換成整張底色 → IC3（主體太少）
//   K4 icon-512 換成相機改成紅色畫的（尺寸、透明都對）→ IC4
//   K5 manifest 的 192 那張 sizes 寫成 180x180 → IC5      K5b index.html 的 apple-touch-icon 指到不存在的檔 → IC5
//   另外：原樣的複本必須 0 項失敗（複製本身沒有弄壞東西）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TARGETS, BG, renderIcon } from './make-icons.mjs';
import { testedLine } from './probe-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_R = 0.4 * 512, MIN_SUBJECT = 20000, BG_TOL = 24, PIX_TOL = 2;
const BGC = [1, 3, 5].map((i) => parseInt(BG.slice(i, i + 2), 16));
let pass = 0;
const yes = (c, m) => { if (c) { pass++; console.log('✓ ' + m); } else { console.log('✗ ' + m); process.exitCode = 1; } };

// 讀 root 底下那一份（repo 本身或暫存複本）；回傳 { fails: [{id, msg}], info: [說明行] }。讀不到檔算失敗，不跳過。
async function checkIcons(root) {
  const fails = [], info = [];
  const bad = (id, msg) => fails.push({ id, msg });
  const names = TARGETS.map((t) => t.name);
  const meta = {};
  for (const t of TARGETS) {
    const f = path.join(root, 'icons', t.name);
    let m = null;
    try { m = await sharp(f).metadata(); } catch (e) { bad('IC1', `${t.name} 讀不到：${e.code || e.message}`); continue; }
    meta[t.name] = m;
    if (m.width !== t.size || m.height !== t.size) bad('IC1', `${t.name} ${m.width}×${m.height}（應 ${t.size}×${t.size}）`);
    if (m.hasAlpha || m.channels !== 3) bad('IC2', `${t.name} ${m.channels} 通道、透明 ${m.hasAlpha}（應 3 通道、沒有透明）`);
  }
  info.push(`尺寸與通道：${TARGETS.map((t) => meta[t.name] ? `${t.name} ${meta[t.name].width}×${meta[t.name].height}／${meta[t.name].channels} 通道` : `${t.name} 讀不到`).join('、')}`);

  // IC3
  const mk = TARGETS.find((t) => t.src === 'icon-maskable.svg');
  try {
    const { data, info: inf } = await sharp(path.join(root, 'icons', mk.name)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const c = inf.width / 2; let far = 0, n = 0;
    for (let y = 0; y < inf.height; y++) for (let x = 0; x < inf.width; x++) {
      const i = (y * inf.width + x) * 3;
      if (Math.max(Math.abs(data[i] - BGC[0]), Math.abs(data[i + 1] - BGC[1]), Math.abs(data[i + 2] - BGC[2])) <= BG_TOL) continue;
      n++; const d = Math.hypot(x + 0.5 - c, y + 0.5 - c); if (d > far) far = d;
    }
    info.push(`maskable 主體 ${n} 點、最遠點離圓心 ${far.toFixed(1)} px（安全圓 ${SAFE_R.toFixed(1)}；主體下限 ${MIN_SUBJECT}）`);
    if (n < MIN_SUBJECT) bad('IC3', `maskable 主體只有 ${n} 點（下限 ${MIN_SUBJECT}）`);
    if (far > SAFE_R) bad('IC3', `maskable 最遠點 ${far.toFixed(1)} px 出了安全圓（${SAFE_R.toFixed(1)}）`);
  } catch (e) { bad('IC3', `${mk.name} 讀不到：${e.code || e.message}`); }

  // IC4
  const diffs = [];
  for (const t of TARGETS) {
    try {
      const svg = fs.readFileSync(path.join(root, 'icons', 'src', t.src), 'utf8');
      const want = await sharp(await renderIcon(svg, t.size)).raw().toBuffer({ resolveWithObject: true });
      const got = await sharp(path.join(root, 'icons', t.name)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (got.info.width !== want.info.width || got.info.height !== want.info.height) { bad('IC4', `${t.name} 跟原稿重畫的尺寸不同（${got.info.width}×${got.info.height} 對 ${want.info.width}×${want.info.height}）`); diffs.push(`${t.name} 尺寸不同`); continue; }
      let dp = 0;
      for (let i = 0; i < want.data.length; i += 3) if (Math.abs(want.data[i] - got.data[i]) > PIX_TOL || Math.abs(want.data[i + 1] - got.data[i + 1]) > PIX_TOL || Math.abs(want.data[i + 2] - got.data[i + 2]) > PIX_TOL) dp++;
      diffs.push(`${t.name} ${dp} 點`);
      if (dp > 0) bad('IC4', `${t.name} 跟 icons/src/${t.src} 重畫的有 ${dp} 點不同（要重跑 npm run icons）`);
    } catch (e) { bad('IC4', `${t.name} 或 icons/src/${t.src} 讀不到／畫不出來：${e.code || e.message}`); diffs.push(`${t.name} 讀不到`); }
  }
  info.push(`跟原稿重畫比，差超過 ${PIX_TOL} 的點：${diffs.join('、')}`);

  // IC5
  try {
    const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    const icons = Array.isArray(man.icons) ? man.icons : [];
    if (!icons.length) bad('IC5', 'manifest 沒有 icons');
    let sawMask = false;
    for (const ic of icons) {
      const base = path.basename(String(ic.src || ''));
      if (!names.includes(base)) { bad('IC5', `manifest 的 ${ic.src} 不在 TARGETS 裡`); continue; }
      const m = meta[base];
      if (!m) { bad('IC5', `manifest 的 ${ic.src} 讀不到`); continue; }
      if (ic.sizes !== `${m.width}x${m.height}`) bad('IC5', `manifest 的 ${ic.src} 宣告 ${ic.sizes}、實際 ${m.width}x${m.height}`);
      if (base === mk.name) { sawMask = true; if (!String(ic.purpose || '').split(/\s+/).includes('maskable')) bad('IC5', `manifest 的 ${ic.src} purpose 沒有 maskable`); }
    }
    if (!sawMask) bad('IC5', `manifest 沒有列 ${mk.name}`);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const links = [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"\s+href="([^"]+)"/g)].map((x) => ({ rel: x[1], href: x[2] }));
    for (const rel of ['icon', 'apple-touch-icon']) {
      const hit = links.filter((l) => l.rel === rel);
      if (hit.length !== 1) { bad('IC5', `index.html 的 rel="${rel}" 有 ${hit.length} 個（應 1）`); continue; }
      const base = path.basename(hit[0].href);
      if (!names.includes(base) || !fs.existsSync(path.join(root, hit[0].href))) bad('IC5', `index.html 的 rel="${rel}" 指到 ${hit[0].href}（不在 TARGETS 或檔不存在）`);
    }
    info.push(`manifest 圖示 ${icons.length} 張、index.html 圖示連結 ${links.length} 個`);
  } catch (e) { bad('IC5', `manifest／index.html 讀不到或解析不了：${e.code || e.message}`); }
  return { fails, info };
}

// ---------- 本體：repo 自己那一份 ----------
console.log(testedLine(ROOT, ['scripts/make-icons.mjs', 'icons/src/icon.svg', 'icons/src/icon-maskable.svg', 'manifest.webmanifest', 'index.html']));
const real = await checkIcons(ROOT);
for (const l of real.info) console.log('  說明：' + l);
for (const id of ['IC1', 'IC2', 'IC3', 'IC4', 'IC5']) {
  const f = real.fails.filter((x) => x.id === id);
  yes(f.length === 0, `${id} ${f.length ? f.map((x) => x.msg).join('；') : '過'}`);
}
yes(TARGETS.length === 4, `TARGETS 有 ${TARGETS.length} 張（應 4：192、512、maskable 512、apple 180）`);

// ---------- 對照組 ----------
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'icontest-'));
let seq = 0;
const copyRepo = () => {
  const d = path.join(tmpBase, String(++seq));
  fs.mkdirSync(path.join(d, 'icons', 'src'), { recursive: true });
  for (const f of ['index.html', 'manifest.webmanifest']) fs.copyFileSync(path.join(ROOT, f), path.join(d, f));
  for (const t of TARGETS) fs.copyFileSync(path.join(ROOT, 'icons', t.name), path.join(d, 'icons', t.name));
  for (const s of ['icon.svg', 'icon-maskable.svg']) fs.copyFileSync(path.join(ROOT, 'icons', 'src', s), path.join(d, 'icons', 'src', s));
  return d;
};
const svgText = (s) => fs.readFileSync(path.join(ROOT, 'icons', 'src', s), 'utf8');
const zoomed = (svg, k) => svg.replace(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/, (_, x, y, w, h) => {
  const W = +w / k, H = +h / k, X = +x + (+w - W) / 2, Y = +y + (+h - H) / 2;
  return `viewBox="${X.toFixed(3)} ${Y.toFixed(3)} ${W.toFixed(3)} ${H.toFixed(3)}"`;
});
// 每一個：造壞（寫真的檔）→ 讀回確認壞處在 → checkIcons → 失敗清單裡要有 want
const CASES = [
  { k: 'K1', want: 'IC1', what: 'icon-192 換成 191 見方',
    make: async (d) => fs.writeFileSync(path.join(d, 'icons', 'icon-192.png'), await renderIcon(svgText('icon.svg'), 191)),
    landed: async (d) => (await sharp(path.join(d, 'icons', 'icon-192.png')).metadata()).width === 191 },
  { k: 'K2', want: 'IC2', what: 'apple-touch-icon 加上透明通道',
    make: async (d) => { const f = path.join(d, 'icons', 'apple-touch-icon.png'); fs.writeFileSync(f, await sharp(fs.readFileSync(f)).ensureAlpha().png().toBuffer()); },
    landed: async (d) => (await sharp(path.join(d, 'icons', 'apple-touch-icon.png')).metadata()).hasAlpha === true },
  { k: 'K3', want: 'IC3', what: 'maskable 換成放大 1.25 倍畫的',
    make: async (d) => { const z = zoomed(svgText('icon-maskable.svg'), 1.25); if (z === svgText('icon-maskable.svg')) throw new Error('viewBox 沒換到'); fs.writeFileSync(path.join(d, 'icons', 'icon-maskable-512.png'), await renderIcon(z, 512)); },
    landed: async (d) => !fs.readFileSync(path.join(d, 'icons', 'icon-maskable-512.png')).equals(fs.readFileSync(path.join(ROOT, 'icons', 'icon-maskable-512.png'))) },
  { k: 'K3b', want: 'IC3', what: 'maskable 換成整張底色',
    make: async (d) => fs.writeFileSync(path.join(d, 'icons', 'icon-maskable-512.png'), await sharp({ create: { width: 512, height: 512, channels: 3, background: BG } }).png().toBuffer()),
    landed: async (d) => { const s = await sharp(path.join(d, 'icons', 'icon-maskable-512.png')).stats(); return s.channels.every((c) => c.min === c.max); } },
  { k: 'K4', want: 'IC4', what: 'icon-512 換成相機改紅色畫的',
    make: async (d) => { const s = svgText('icon.svg'); if (!s.includes('#6fb7e3')) throw new Error('原稿裡找不到相機的顏色'); fs.writeFileSync(path.join(d, 'icons', 'icon-512.png'), await renderIcon(s.split('#6fb7e3').join('#ff0000'), 512)); },
    landed: async (d) => !fs.readFileSync(path.join(d, 'icons', 'icon-512.png')).equals(fs.readFileSync(path.join(ROOT, 'icons', 'icon-512.png'))) },
  { k: 'K5', want: 'IC5', what: 'manifest 的 192 那張 sizes 寫成 180x180',
    make: async (d) => { const f = path.join(d, 'manifest.webmanifest'); const s = fs.readFileSync(f, 'utf8'); if (s.split('"192x192"').length !== 2) throw new Error('manifest 裡的 "192x192" 不是剛好一處'); fs.writeFileSync(f, s.replace('"192x192"', '"180x180"')); },
    landed: async (d) => fs.readFileSync(path.join(d, 'manifest.webmanifest'), 'utf8').includes('"180x180"') },
  { k: 'K5b', want: 'IC5', what: 'index.html 的 apple-touch-icon 指到不存在的檔',
    make: async (d) => { const f = path.join(d, 'index.html'); const s = fs.readFileSync(f, 'utf8'); const from = 'href="./icons/apple-touch-icon.png"'; if (s.split(from).length !== 2) throw new Error('index.html 裡的 apple-touch-icon 連結不是剛好一處'); fs.writeFileSync(f, s.replace(from, 'href="./icons/apple-touch-icon-x.png"')); },
    landed: async (d) => fs.readFileSync(path.join(d, 'index.html'), 'utf8').includes('apple-touch-icon-x.png') },
];
try {
  const d0 = copyRepo();
  const r0 = await checkIcons(d0);
  yes(r0.fails.length === 0, `K0 原樣的複本 0 項失敗（實際 ${r0.fails.length}：${r0.fails.map((x) => x.id).join('、') || '無'}）`);
  for (const c of CASES) {
    const d = copyRepo();
    let made = false, err = '';
    try { await c.make(d); made = await c.landed(d); } catch (e) { err = e.message; }
    if (!made) { yes(false, `${c.k} 對照組沒造成（${c.what}）${err ? '：' + err : '：讀回去壞處不在'}——情境未成立`); continue; }
    const r = await checkIcons(d);
    const ids = [...new Set(r.fails.map((x) => x.id))];
    yes(ids.includes(c.want), `${c.k} 對照組（${c.what}）：紅的是 ${ids.join('、') || '沒有'}，應含 ${c.want}`);
  }
} finally {
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { console.log(`✗ 收尾刪不掉暫存資料夾：${e.code || e.message}`); process.exitCode = 1; }
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : '（全部通過）'));
