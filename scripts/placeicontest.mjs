// 景點類型圖示（npm run placeicontest；v1.92.0，2026-11-16；秒級、不開瀏覽器、進鏈與底線）
//
// 為什麼：Yolin 2026-11-16 要組 A 的 9 張圖示進 App——「只給對得上景點庫類型的景點用；使用者自己打字新增的景點留白」，
// 新圖檔列進 sw.js 的 SHELL_ASSETS。下面三種壞法，別的測試都不會紅：
//   · 離線清單寫錯一張（大小寫不同、檔沒進版控、被 .gitignore 擋掉）→ Service Worker 安裝時 cache.addAll 整批失敗，新版永遠裝不上；
//     Windows 不分大小寫、GitHub Pages 分，本機看起來一切正常
//   · 圖檔換了、登記沒跟著換（或反過來）→ media/art/manifest.json 的登記失去意義
//   · 有人照名字、或照存著的值挑圖示 → 猜出來的東西變成使用者看得到的圖（設計原則，v1.74）
// 三段：
// 一、素材 ↔ 登記 ↔ 程式 ↔ 離線清單（A1～A8）＋景點庫每一種類型都有圖示（A9）
// 二、只給對得回景點庫的（B0～B8；用真的景點庫、真的比對規則——同 themetrusttest 的做法）
// 三、登記制（C1、C2）：js/ 底下除了 js/placeicon.js 本身，誰用到圖示（PLACE_ICON、media/art/ 路徑、placeIconForSpot／placeIconForEntry／
//     placeIconImg 的呼叫）都要登記，而且只准 App 畫面的用途；海報（B11 不改）不准用景點類型圖示
// v1.93.0（D 進海報頁首）：登記多一種 kind「poster-header」（組 D 頁首插圖，只准海報）——一、三兩段各加分支：
//   一：kind 只准兩種；組 A 的規則（128 見方 PNG、一張 16 KB、合計 100 KB、只有影像區塊、對 PLACE_ICON）只套 place-type；
//       poster-header 是 JPEG、尺寸等於程式畫的大小（layout.js 的 HEADER_ART）、一張 100 KB、沒有 APP0 以外的 APPn 與註解區段
//       （EXIF／XMP 在 APP1、C2PA 在 APP11——生圖服務可能把來源紀錄寫在這兩處）、對 HEADER_ART、在離線清單、進版控。
//   三：類別多一種「poster-art」，只准 js/itinposter/ 底下；js/itinposter/ 底下也只准 poster-art；poster-art 那一行不准用景點類型圖示。
// 一、三兩段先跑對照組（.logs/placeicon-ctl 底下造真的檔，走同一個讀檔與檢查），沒過就停（回 4）、不採信真實結果。
// 已知限制：git 讀的是目前目錄的 repo；環境裡設了 GIT_DIR 之類的變數，A8 會去讀別的 repo（這支不是推送閘，不另外擋；推送閘自己擋）。
//   三的掃描是逐行比字：解構（const { PLACE_ICON: X } = …）、拼出來的路徑（'media/' + 'art'）掃不到——在這個樣式範圍內未見，不是證明沒有。
// 突變見 tools/mutations/mut_v192.json。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shellOf } from './shelltest.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// theme.js、generate.js 用 fetch 讀 data/；node 底下換成讀檔，只供應 themes.json 與 data/places/ 底下的檔，其餘照樣失敗
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s !== './data/themes.json' && !/^\.\/data\/places\/[\w-]+\.json$/.test(s)) throw new Error('placeicontest 不供應：' + s);
  const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
const gen = await import('../js/quests/generate.js');
const icon = await import('../js/placeicon.js');
const { HEADER_ART } = await import('../js/itinposter/layout.js');
await theme.loadThemes();

let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + String(extra).slice(0, 1200) : '')); if (process.exitCode !== 4) process.exitCode = 1; }
};

// ---------- 一、素材 ----------
export const ART_DIR = 'media/art';
export const SIZE = 128;                 // 128 見方：畫面上最大 32 CSS px，4 倍密度的螢幕剛好
export const MAX_BYTES = 16 * 1024;      // 一張的上限（實際 5～9 KB）
export const MAX_TOTAL = 100 * 1024;     // 合計的上限（實際約 60 KB）：全部進離線快取，每個使用者裝 App 都要下載
// pHYs 只有「每公尺幾個像素」兩個數字、不帶文字；附錄 A.6 點名會帶路徑或中繼資料的是 tEXt、iTXt、zTXt、eXIf
const OK_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'pHYs', 'IDAT', 'IEND']);
const LABELS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
// v1.93.0 組 D 海報頁首（JPEG）
export const ITEM_KINDS = ['place-type', 'poster-header'];
export const MAX_ART_BYTES = 100 * 1024;   // 一張的上限（實際 69802）：進離線快取
// 准的 JPEG 區段：量化表 DB、畫面 C0／C1／C2、霍夫曼表 C4、重新開始間隔 DD、掃描 DA、結尾 D9、JFIF 的 APP0（E0，只有密度）。
// 其餘（E1～EF 的 APPn：EXIF／XMP 在 E1、C2PA 在 EB；註解 FE；不認得的）都算影像以外的區段
const OK_JPEG = new Set(['DB', 'C0', 'C1', 'C2', 'C4', 'DD', 'DA', 'D9', 'E0']);

export function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));   // readdir 給的是磁碟上真的大小寫
  }
  return out;
}

export function pngInfo(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  const chunks = [];
  let o = 8;
  while (o + 8 <= buf.length) { const len = buf.readUInt32BE(o); chunks.push(buf.toString('latin1', o + 4, o + 8)); o += 12 + len; }
  if (chunks[0] !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), chunks, end: o === buf.length };
}

// JPEG 的區段（v1.93.0）：FF xx 一段一段走（D0～D7、01 沒有長度欄位，不會出現在掃描以外），掃描（DA）之後是壓縮資料，
// 走到下一個不是 FF 00、不是 FF D0～D7 的 FF xx。回 { w, h（第一個 C0／C1／C2 的）, markers（十六進位、大寫）, end（D9 剛好在檔尾）}；
// 開頭不是 FF D8、或走到一半不是 FF → null
export function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const markers = [];
  let o = 2, w = 0, h = 0, end = false;
  while (o + 1 < buf.length) {
    if (buf[o] !== 0xff) return null;
    const mk = buf[o + 1];
    const name = mk.toString(16).toUpperCase().padStart(2, '0');
    markers.push(name);
    if (mk === 0xd9) { o += 2; end = o === buf.length; break; }
    if (o + 3 >= buf.length) return null;
    const len = buf.readUInt16BE(o + 2);
    if ((mk === 0xc0 || mk === 0xc1 || mk === 0xc2) && !w && o + 8 < buf.length) { h = buf.readUInt16BE(o + 5); w = buf.readUInt16BE(o + 7); }
    o += 2 + len;
    if (mk === 0xda) while (o + 1 < buf.length && !(buf[o] === 0xff && buf[o + 1] !== 0x00 && !(buf[o + 1] >= 0xd0 && buf[o + 1] <= 0xd7))) o++;
  }
  return { w, h, markers, end };
}

// dir：裝 manifest.json 與圖檔的資料夾；iconMap：程式的表；posterArt：程式畫的海報頁首（layout.js 的 HEADER_ART，沒有就 null）；
// shell：SHELL_ASSETS；tracked：git 追蹤的（相對 dir 的路徑，Set）；ignored(rel)→bool
export function checkAssets({ dir, iconMap, posterArt, shell, tracked, ignored }) {
  const P = Object.fromEntries(LABELS.map((k) => [k, []]));
  let man = null;
  try { man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { P.A1.push('讀不到或解析不了 manifest.json：' + e.message); return { P, items: [], files: [], total: 0, artBytes: 0 }; }
  const items = Array.isArray(man.items) ? man.items : [];
  if (!items.length) P.A1.push('items 是空的');
  if (new Set(items.map((it) => it.file)).size !== items.length) P.A1.push('登記裡有重複的 file');
  for (const it of items) if (!ITEM_KINDS.includes(it.kind)) P.A1.push(`${it.file} 的 kind「${it.kind}」不認得（只准 ${ITEM_KINDS.join('、')}）`);
  const icons = items.filter((it) => it.kind === 'place-type');
  const arts = items.filter((it) => it.kind === 'poster-header');
  if (new Set(icons.map((it) => it.primary)).size !== icons.length) P.A1.push('登記裡有重複的 primary');
  const files = listFiles(dir).filter((f) => f !== 'manifest.json');
  const regFiles = new Set(items.map((it) => it.file));
  for (const f of files) if (!regFiles.has(f)) P.A2.push(`有檔沒登記：${f}`);
  for (const it of items) if (!files.includes(it.file)) P.A2.push(`登記了卻沒有檔：${it.file}`);
  let total = 0, artBytes = 0;   // total：組 A（place-type）合計；artBytes：海報頁首合計
  for (const it of items) {
    if (!files.includes(it.file)) continue;
    const buf = fs.readFileSync(path.join(dir, it.file));
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha !== it.sha256) P.A3.push(`${it.file} 的雜湊 ${sha.slice(0, 12)}… 跟登記的 ${String(it.sha256).slice(0, 12)}… 不同`);
    if (it.kind === 'poster-header') {
      artBytes += buf.length;
      const jp = jpegInfo(buf);
      if (!jp) { P.A4.push(`${it.file} 不是 JPEG`); continue; }
      if (posterArt && (jp.w !== posterArt.w || jp.h !== posterArt.h)) P.A4.push(`${it.file} 是 ${jp.w}×${jp.h}（程式畫成 ${posterArt.w}×${posterArt.h}）`);
      if (buf.length > MAX_ART_BYTES) P.A4.push(`${it.file} 有 ${buf.length} 位元組（海報頁首上限 ${MAX_ART_BYTES}）`);
      const bad = [...new Set(jp.markers.filter((m) => !OK_JPEG.has(m)))];
      if (bad.length || !jp.end) P.A5.push(`${it.file} 有影像以外的區段：${bad.join('、') || '（沒有剛好在檔尾結束）'}`);
      continue;
    }
    if (it.kind !== 'place-type') continue;
    total += buf.length;
    const info = pngInfo(buf);
    if (!info) { P.A4.push(`${it.file} 不是 PNG`); continue; }
    if (info.w !== SIZE || info.h !== SIZE) P.A4.push(`${it.file} 是 ${info.w}×${info.h}（要 ${SIZE}×${SIZE}）`);
    if (buf.length > MAX_BYTES) P.A4.push(`${it.file} 有 ${buf.length} 位元組（一張上限 ${MAX_BYTES}）`);
    const extra = [...new Set(info.chunks.filter((c) => !OK_CHUNKS.has(c)))];
    if (extra.length || !info.end) P.A5.push(`${it.file} 有影像以外的區塊：${extra.join('、') || '（區塊長度跟檔尾對不上）'}`);
  }
  if (total > MAX_TOTAL) P.A4.push(`合計 ${total} 位元組（上限 ${MAX_TOTAL}）`);
  const map = iconMap || {};
  const want = new Map(icons.map((it) => [it.primary, `./${ART_DIR}/${it.file}`]));
  for (const k of Object.keys(map)) if (want.get(k) !== map[k]) P.A6.push(`程式的表 ${k} → ${map[k]}，登記是 ${want.get(k) || '（沒有這一類）'}`);
  for (const [k, v] of want) if (!Object.prototype.hasOwnProperty.call(map, k)) P.A6.push(`登記 ${k} → ${v}，程式的表沒有`);
  // 海報頁首：登記的 poster-header ↔ 程式畫的那一張（各最多一張、兩邊同一張）
  const artWant = arts.map((it) => `./${ART_DIR}/${it.file}`);
  const artHave = posterArt ? [posterArt.src] : [];
  if (artWant.length > 1) P.A6.push(`登記了 ${artWant.length} 張海報頁首（程式只畫一張）`);
  if (artWant.join() !== artHave.join()) P.A6.push(`程式的海報頁首 ${artHave[0] || '（沒有）'}，登記是 ${artWant.join('、') || '（沒有）'}`);
  const set = new Set(shell || []);
  const inMap = new Set([...Object.values(map), ...artHave]);
  for (const v of inMap) if (!set.has(v)) P.A7.push(`程式的表 ${v} 不在 SHELL_ASSETS`);
  for (const u of shell || []) if (u.startsWith(`./${ART_DIR}/`) && !inMap.has(u)) P.A7.push(`SHELL_ASSETS 的 ${u} 不在程式的表上`);
  const need = [...[...inMap].map((v) => v.slice(`./${ART_DIR}/`.length)), 'manifest.json'];
  for (const rel of need) {
    if (!tracked.has(rel)) {
      const ci = [...tracked].find((t) => t.toLowerCase() === rel.toLowerCase());
      P.A8.push(ci ? `${ART_DIR}/${rel} 的大小寫跟 git 不同（git 是 ${ci}）` : `${ART_DIR}/${rel} 沒有進版控`);
    }
    if (ignored(rel)) P.A8.push(`${ART_DIR}/${rel} 被 .gitignore 擋掉`);
  }
  return { P, items, files, total, artBytes };
}

// git：讀不到就丟錯（不當成「沒有追蹤」也不當成「沒被擋」）
function gitTracked(spec) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--', spec], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files 失敗（${r.status}）：${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
}
function gitIgnored(rel) {
  const r = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git check-ignore 失敗（${r.status}）：${r.stderr}`);
}

const CTL = path.join(ROOT, '.logs', 'placeicon-ctl');
let ctlOk = true;
const realDir = path.join(ROOT, ART_DIR);
const swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const realShell = shellOf(swText) || [];
const realMap = { ...icon.PLACE_ICON };

// git 那兩支的對照組：已知追蹤的檔要讀得到、已知被擋的路徑要判成被擋、已知沒被擋的要判成沒被擋
let gitOk = false;
try {
  const t1 = gitTracked('js/theme.js'), t0 = gitTracked('js/no-such-file-placeicon.js');
  const i1 = gitIgnored('.logs/placeicon-probe.txt'), i0 = gitIgnored('js/theme.js');
  gitOk = t1.length === 1 && t1[0] === 'js/theme.js' && t0.length === 0 && i1 === true && i0 === false;
  yes(gitOk, `對照組（git 讀取）：js/theme.js 讀得到追蹤、不存在的讀不到、.logs/ 判成被擋、js/theme.js 判成沒被擋`, JSON.stringify({ t1, t0, i1, i0 }));
} catch (e) { yes(false, '對照組（git 讀取）：git 讀不到', e.message); }
ctlOk = gitOk && ctlOk;

const realTracked = new Set(gitOk ? gitTracked(ART_DIR).map((p) => p.slice(ART_DIR.length + 1)) : []);

// 合成 PNG：只有結構（pngInfo 不解壓影像），夠驗大小、區塊、位元組數
const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
const ihdr = (w, h) => { const d = Buffer.alloc(13); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); d[8] = 8; d[9] = 6; return chunk('IHDR', d); };
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const synthPng = ({ w = SIZE, h = SIZE, idat = 64, text = false } = {}) => Buffer.concat([SIG, ihdr(w, h), ...(text ? [chunk('tEXt', Buffer.from('k\0v'))] : []), chunk('IDAT', Buffer.alloc(idat)), chunk('IEND', Buffer.alloc(0))]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// 合成 JPEG（v1.93.0）：只有區段結構（jpegInfo 不解碼），夠驗區段、尺寸、位元組數。app：在 SOI 之後插的區段 [[標記, 內容], …]
const seg = (mk, data) => { const b = Buffer.alloc(4 + data.length); b[0] = 0xff; b[1] = mk; b.writeUInt16BE(data.length + 2, 2); data.copy(b, 4); return b; };
const sof = (w, h) => { const d = Buffer.alloc(15); d[0] = 8; d.writeUInt16BE(h, 1); d.writeUInt16BE(w, 3); d[5] = 3; return seg(0xc2, d); };
const synthJpeg = ({ w = 40, h = 20, app = [], data = 64, tail = Buffer.alloc(0) } = {}) => Buffer.concat([
  Buffer.from([0xff, 0xd8]), ...app.map(([mk, s]) => seg(mk, Buffer.from(s))), seg(0xdb, Buffer.alloc(65)), sof(w, h), seg(0xc4, Buffer.alloc(18)),
  seg(0xda, Buffer.alloc(10)), Buffer.alloc(data, 0x11), Buffer.from([0xff, 0x00, 0x22]), Buffer.from([0xff, 0xd9]), tail]);

// 每一個對照組：在 .logs/ 造一份**全部合成、自己對得上**的素材（3 張合成 PNG＋照它們寫的登記、表、離線清單、追蹤清單），
// 套上一種壞法（只壞一處），用同一支 checkAssets 讀檔檢查；必須**只有**預期的那一類報問題（其他類一條都不能報——不然可能是別的規則順便擋下的）。
// 不拿真實的表／離線清單／登記當基準：真實資料壞掉時（突變就是這樣），對照組會跟著壞、整支回 4，A 段的真實檢查反而沒跑
// （2026-11-16 第一版就是這樣，執行器判成「沒跑完」）。對照組驗的是檢查器，不是 repo。
const CTL_NAMES = ['x', 'y', 'z'];
// v1.93.0：基準多一張合成的海報頁首（d/p.jpg，40×20），程式畫的那一張就是它
const ART_FILE = 'd/p.jpg', ART_PATH = `./${ART_DIR}/d/p.jpg`;
function assetCtl(label, expectLabel, { files = {}, drop = [], manifest = (m) => m, rawManifest = null, iconMap = (m) => m, posterArt = (a) => a, shell = (s) => s, tracked = (s) => s, ignored = () => false, msg = null }) {
  const dir = path.join(CTL, 'art');
  fs.rmSync(CTL, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
  const bytes = Object.fromEntries(CTL_NAMES.map((n, i) => [`a/${n}.png`, synthPng({ idat: 64 + i })]));
  bytes[ART_FILE] = synthJpeg();
  Object.assign(bytes, files);
  for (const [f, buf] of Object.entries(bytes)) {
    if (drop.includes(f)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), buf);
    if (!fs.readFileSync(path.join(dir, f)).equals(buf)) throw new Error('對照樣本寫進去讀回來不一樣：' + f);
  }
  const man = { items: [...CTL_NAMES.map((n) => ({ file: `a/${n}.png`, kind: 'place-type', primary: n, sha256: sha(bytes[`a/${n}.png`]) })),
    { file: ART_FILE, kind: 'poster-header', sha256: sha(bytes[ART_FILE]) }] };
  const map0 = Object.fromEntries(CTL_NAMES.map((n) => [n, `./${ART_DIR}/a/${n}.png`]));
  const shell0 = ['./index.html', ...Object.values(map0), ART_PATH];
  fs.writeFileSync(path.join(dir, 'manifest.json'), rawManifest != null ? rawManifest : JSON.stringify(manifest(man), null, 2));
  const base = new Set(listFiles(dir));
  const r = checkAssets({ dir, iconMap: iconMap(map0), posterArt: posterArt({ src: ART_PATH, w: 40, h: 20 }), shell: shell(shell0), tracked: tracked(base), ignored });
  const hit = LABELS.filter((k) => r.P[k].length);
  const want = expectLabel ? [expectLabel] : [];
  const good = hit.join() === want.join() && (!msg || r.P[expectLabel].some((x) => x.includes(msg)));
  yes(good, `對照組（${label}）：只有 ${expectLabel || '（沒有）'} 報問題`, `實際報問題的：${hit.join('、') || '無'}；${hit.map((k) => k + '：' + r.P[k].join('；')).join(' ／ ')}`);
  return good;
}
const foodFile = 'a/x.png';
const zPath = `./${ART_DIR}/a/z.png`, yPath = `./${ART_DIR}/a/y.png`;
ctlOk = assetCtl('原樣（合成的三張，自己對得上）', null, {}) && ctlOk;
ctlOk = assetCtl('登記檔解析不了', 'A1', { rawManifest: '{ 這不是 JSON' }) && ctlOk;
// 2026-11-16 補：checkAssets 每一個分支都要有自己的樣本（msg 釘住是哪一支報的；拿掉那一支，這個樣本就抓不到）
ctlOk = assetCtl('登記是空的（也沒有圖、表、離線清單）', 'A1', { drop: [...CTL_NAMES.map((n) => `a/${n}.png`), ART_FILE], manifest: (m) => { m.items = []; return m; }, iconMap: () => ({}), posterArt: () => null, shell: () => ['./index.html'], msg: 'items 是空的' }) && ctlOk;
ctlOk = assetCtl('登記裡同一個檔登了兩次', 'A1', { manifest: (m) => { m.items.push({ ...m.items[0], primary: 'x2' }); return m; }, iconMap: (m) => ({ ...m, x2: m.x }), msg: '重複的 file' }) && ctlOk;
const wBuf = synthPng({ idat: 77 });
ctlOk = assetCtl('登記裡同一類登了兩次', 'A1', { files: { 'a/w.png': wBuf }, manifest: (m) => { m.items.unshift({ file: 'a/w.png', kind: 'place-type', primary: 'x', sha256: sha(wBuf) }); return m; }, msg: '重複的 primary' }) && ctlOk;
ctlOk = assetCtl('多一張沒登記的檔', 'A2', { files: { 'a/extra.png': synthPng({ idat: 99 }) } }) && ctlOk;
ctlOk = assetCtl('登記了的檔不見了（git 還追蹤著）', 'A2', { drop: ['a/z.png'], tracked: (s) => new Set([...s, 'a/z.png']) }) && ctlOk;
ctlOk = assetCtl('登記的雜湊跟檔不同', 'A3', { manifest: (m) => { m.items.find((x) => x.file === foodFile).sha256 = '0'.repeat(64); return m; } }) && ctlOk;
ctlOk = assetCtl('尺寸不是 128×128', 'A4', { files: { [foodFile]: synthPng({ w: 256, h: 256 }) } }) && ctlOk;
ctlOk = assetCtl('一張超過 16 KB', 'A4', { files: { [foodFile]: synthPng({ idat: MAX_BYTES + 100 }) } }) && ctlOk;
ctlOk = assetCtl('合計超過 100 KB（每張都不超過）', 'A4', { files: Object.fromEntries(CTL_NAMES.map((n) => [`a/${n}.png`, synthPng({ idat: MAX_BYTES - 200 })]).concat([0, 1, 2, 3].map((i) => [`a/w${i}.png`, synthPng({ idat: MAX_BYTES - 200 - i })]))), manifest: (m) => { for (let i = 0; i < 4; i++) m.items.push({ file: `a/w${i}.png`, kind: 'place-type', primary: `w${i}`, sha256: sha(synthPng({ idat: MAX_BYTES - 200 - i })) }); return m; }, iconMap: (m) => ({ ...m, ...Object.fromEntries([0, 1, 2, 3].map((i) => [`w${i}`, `./${ART_DIR}/a/w${i}.png`])) }), shell: (s) => [...s, ...[0, 1, 2, 3].map((i) => `./${ART_DIR}/a/w${i}.png`)], msg: '合計' }) && ctlOk;
ctlOk = assetCtl('不是 PNG', 'A4', { files: { [foodFile]: Buffer.from('這不是 PNG，只是一段字，長度要超過 33 位元組才會走到簽名比對') }, msg: '不是 PNG' }) && ctlOk;
ctlOk = assetCtl('帶文字區塊', 'A5', { files: { [foodFile]: synthPng({ text: true }) } }) && ctlOk;
ctlOk = assetCtl('檔尾多了幾個位元組（區塊長度對不上）', 'A5', { files: { [foodFile]: Buffer.concat([synthPng(), Buffer.from([1, 2, 3])]) }, msg: '區塊長度跟檔尾對不上' }) && ctlOk;
ctlOk = assetCtl('程式的表兩類的圖對調（集合一樣、對應錯）', 'A6', { iconMap: (m) => ({ ...m, x: m.y, y: m.x }), msg: '程式的表 x →' }) && ctlOk;
ctlOk = assetCtl('程式的表少一類（離線清單也少那一張）', 'A6', { iconMap: (m) => { const c = { ...m }; delete c.z; return c; }, shell: (s) => s.filter((u) => u !== zPath) }) && ctlOk;
ctlOk = assetCtl('離線清單漏一張', 'A7', { shell: (s) => s.filter((u) => u !== yPath) }) && ctlOk;
ctlOk = assetCtl('離線清單多一張表上沒有的', 'A7', { shell: (s) => [...s, `./${ART_DIR}/a/ghost.png`] }) && ctlOk;
ctlOk = assetCtl('有一張沒進版控', 'A8', { tracked: (s) => new Set([...s].filter((t) => t !== foodFile)), msg: '沒有進版控' }) && ctlOk;
ctlOk = assetCtl('git 裡的大小寫不同', 'A8', { tracked: (s) => new Set([...s].map((t) => (t === foodFile ? 'a/X.png' : t))), msg: '大小寫' }) && ctlOk;
ctlOk = assetCtl('登記檔沒進版控', 'A8', { tracked: (s) => new Set([...s].filter((t) => t !== 'manifest.json')), msg: 'manifest.json 沒有進版控' }) && ctlOk;
ctlOk = assetCtl('被 .gitignore 擋掉', 'A8', { ignored: (rel) => rel === foodFile, msg: '.gitignore' }) && ctlOk;
// v1.93.0 組 D 海報頁首：每一個新分支一份（msg 釘住是哪一支報的）
const artSha = (b) => (m) => { m.items.find((x) => x.file === ART_FILE).sha256 = sha(b); return m; };
ctlOk = assetCtl('登記的 kind 不認得', 'A1', { manifest: (m) => { m.items.find((x) => x.file === ART_FILE).kind = 'poster'; return m; }, posterArt: () => null, shell: (s) => s.filter((u) => u !== ART_PATH), msg: '不認得' }) && ctlOk;
const bigA = synthPng({ idat: MAX_BYTES - 200 }), bigD = synthJpeg({ data: 90 * 1024 });
ctlOk = assetCtl('組 A 合計不算海報頁首（三張組 A＋一張 90 KB 的頁首超過 100 KB，也不報）', null, {
  files: { ...Object.fromEntries(CTL_NAMES.map((n) => [`a/${n}.png`, bigA])), [ART_FILE]: bigD },
  manifest: (m) => { for (const it of m.items) it.sha256 = sha(it.file === ART_FILE ? bigD : bigA); return m; } }) && ctlOk;
const notJpeg = Buffer.from('這不是 JPEG，只是一段字');
ctlOk = assetCtl('海報頁首不是 JPEG', 'A4', { files: { [ART_FILE]: notJpeg }, manifest: artSha(notJpeg), msg: '不是 JPEG' }) && ctlOk;
const wrongSize = synthJpeg({ w: 80, h: 20 });
ctlOk = assetCtl('海報頁首的尺寸跟程式畫的不同', 'A4', { files: { [ART_FILE]: wrongSize }, manifest: artSha(wrongSize), msg: '程式畫成 40×20' }) && ctlOk;
const tooBig = synthJpeg({ data: MAX_ART_BYTES + 100 });
ctlOk = assetCtl('海報頁首超過 100 KB', 'A4', { files: { [ART_FILE]: tooBig }, manifest: artSha(tooBig), msg: '海報頁首上限' }) && ctlOk;
for (const [mk, name, body] of [[0xe1, 'APP1（EXIF／XMP）', 'Exif\0\0MM'], [0xeb, 'APP11（C2PA）', 'JP\0\0c2pa'], [0xfe, '註解區段', 'made by']]) {
  const b = synthJpeg({ app: [[mk, body]] });
  ctlOk = assetCtl(`海報頁首帶${name}`, 'A5', { files: { [ART_FILE]: b }, manifest: artSha(b), msg: mk.toString(16).toUpperCase() }) && ctlOk;
}
const tailed = synthJpeg({ tail: Buffer.from([1, 2, 3]) });
ctlOk = assetCtl('海報頁首的檔尾多了幾個位元組', 'A5', { files: { [ART_FILE]: tailed }, manifest: artSha(tailed), msg: '沒有剛好在檔尾結束' }) && ctlOk;
ctlOk = assetCtl('程式畫的海報頁首跟登記的不是同一張', 'A6', { posterArt: (a) => ({ ...a, src: `./${ART_DIR}/d/q.jpg` }), shell: (s) => [...s.filter((u) => u !== ART_PATH), `./${ART_DIR}/d/q.jpg`], tracked: (s) => new Set([...s, 'd/q.jpg']), msg: '程式的海報頁首' }) && ctlOk;
const art2 = synthJpeg({ data: 70 });
ctlOk = assetCtl('登記了兩張海報頁首', 'A6', { files: { 'd/p2.jpg': art2 }, manifest: (m) => { m.items.push({ file: 'd/p2.jpg', kind: 'poster-header', sha256: sha(art2) }); return m; }, msg: '登記了 2 張海報頁首' }) && ctlOk;
ctlOk = assetCtl('程式沒有海報頁首、登記有', 'A6', { posterArt: () => null, shell: (s) => s.filter((u) => u !== ART_PATH), msg: '程式的海報頁首 （沒有）' }) && ctlOk;
ctlOk = assetCtl('海報頁首不在離線清單', 'A7', { shell: (s) => s.filter((u) => u !== ART_PATH), msg: ART_PATH }) && ctlOk;
ctlOk = assetCtl('海報頁首沒進版控', 'A8', { tracked: (s) => new Set([...s].filter((t) => t !== ART_FILE)), msg: `${ART_FILE} 沒有進版控` }) && ctlOk;
fs.rmSync(CTL, { recursive: true, force: true });

// ---------- 二、只給對得回景點庫的 ----------
const sight = icon.PLACE_ICON.sight, food = icon.PLACE_ICON.food;
yes(gen.placeLookupSync() === null, 'B0 前置：景點庫還沒載 → placeLookupSync() 是 null');
const b0 = icon.placeIconForSpot({ name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi' }, gen.placeLookupSync());
yes(b0 === null, `B0 景點庫沒載好 → 沒有圖示（實得 ${b0}）`);

const L = await gen.loadPlaceLookup();
const wuqi = L && L.placeById('tc-wuqi');
const guess = theme.themeForSpot({ name: '梧棲漁港' });
yes(!!wuqi && wuqi.primary === 'food' && guess === 'coast', `B1 前置：景點庫 tc-wuqi「梧棲漁港」primary 是 food，照名字猜是 coast（實得 ${wuqi && wuqi.primary}、${guess}）——兩邊不同，分得出用的是哪一邊`);
// 存著的值故意都寫成別的（表情符號、theme、primary）：只准照景點庫重算
const B1 = { name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi', emoji: '🌊', theme: 'coast', primary: 'nature' };
const b1 = icon.placeIconForSpot(B1, L);
yes(b1 === food, `B1 對得回景點庫 → 照景點庫的 primary 給 food 的圖示，存著的表情符號／theme／primary 都不看（實得 ${b1}）`);

const kyo = L.placeById('kyoto-kiyomizu');
const S2 = kyo && { name: kyo.name, region: kyo.cityName, source: 'curated', placeId: kyo.id };
const t2 = S2 && theme.trustedTheme(S2, L);
yes(!!kyo && kyo.primary === 'sight' && t2.key === null && t2.recheck === true, `B2 前置：清水寺 primary 是 sight，可信類別換出來是中性（key 是 null）但複核通過（實得 ${kyo && kyo.primary}、${t2 && JSON.stringify({ key: t2.key, recheck: t2.recheck })}）`);
const b2 = S2 && icon.placeIconForSpot(S2, L);
yes(b2 === sight, `B2 類別中性、複核通過 → 照樣給 sight 的圖示（看的是 recheck 不是 key；實得 ${b2}）`);

const shilin = L.placeById('taipei-shilin-nm');
const m3 = L.matchPlace('士林夜市', '台北市');
yes(!!shilin && shilin.primary === 'nightmarket' && !!m3 && m3.id === 'taipei-shilin-nm', `B3 前置：景點庫有「士林夜市」（nightmarket），拿名字比得到它（實得 ${shilin && shilin.primary}、${m3 && m3.id}）——照名字補的話這裡會有圖示`);
const b3 = icon.placeIconForSpot({ name: '士林夜市', region: '台北市', source: 'auto', emoji: '📍' }, L);
yes(b3 === null, `B3 使用者自己打字新增的（source auto、沒有 placeId）→ 沒有圖示，不照名字補（實得 ${b3}）`);

const b4 = icon.placeIconForSpot({ ...B1, name: '阿嬤家巷口' }, L);
yes(b4 === null, `B4 改過名字（比不回同一筆）→ 沒有圖示（實得 ${b4}）`);
const b5 = icon.placeIconForSpot({ ...B1, placeId: 'no-such-place' }, L);
yes(b5 === null, `B5 景點庫那一筆不見了 → 沒有圖示（實得 ${b5}）`);
const B6 = { ...B1, matchInput: '士林夜市' };
const t6 = theme.trustedTheme(B6, L);
yes(t6.reason === 'input-mismatch', `B6 前置：建立時打的字是「士林夜市」，比回來不是 tc-wuqi（可信類別判 ${t6.reason}）`);
const b6 = icon.placeIconForSpot(B6, L);
yes(b6 === null, `B6 建立時打的字比不回同一筆（當年就比錯）→ 沒有圖示（實得 ${b6}）`);

// 景點庫本身的一筆（建立行程選景點的清單）
const all = [];
for (const c of fs.readdirSync(path.join(ROOT, 'data', 'places')).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'places', c), 'utf8'));
  all.push(...(Array.isArray(j) ? j : j.places || []));
}
const wrong7 = all.filter((p) => icon.placeIconForEntry(p) !== (icon.PLACE_ICON[p.primary] || null));
yes(all.length > 0 && wrong7.length === 0, `B7 景點庫 ${all.length} 筆，每一筆都照自己的 primary 拿圖示`, wrong7.slice(0, 5).map((p) => p.id).join('、'));
const odd = ['toString', '__proto__', 'constructor', 'hasOwnProperty', '', 'temple'].map((k) => icon.placeIconForEntry({ primary: k }));
const odd2 = [null, undefined, {}, { primary: 3 }].map((p) => icon.placeIconForEntry(p));
yes([...odd, ...odd2].every((v) => v === null), `B8 不在表上的 primary（含 toString、__proto__ 這種物件本來就有的名字、空字串、非字串）→ 沒有圖示`, JSON.stringify([...odd, ...odd2].map((v) => typeof v)));

// A9：景點庫每一種 primary 都有圖示（新增一種類型卻沒有圖，選景點清單會一半有圖一半沒有——要嘛補圖、要嘛在這裡登記理由）
export const NO_ICON_OK = {};
const byPrimary = {};
for (const p of all) byPrimary[p.primary] = (byPrimary[p.primary] || 0) + 1;
const noIcon = Object.keys(byPrimary).filter((k) => !icon.PLACE_ICON[k] && NO_ICON_OK[k] == null);
console.log(`說明：景點庫各類筆數 ${Object.entries(byPrimary).map(([k, n]) => `${k} ${n}`).join('、')}；表上有、景點庫 0 筆的：${Object.keys(icon.PLACE_ICON).filter((k) => !byPrimary[k]).join('、') || '無'}`);
yes(Object.keys(byPrimary).length > 0 && noIcon.length === 0, `A9 景點庫的 ${Object.keys(byPrimary).length} 種 primary 都有圖示`, '沒有圖示的：' + noIcon.join('、'));

// ---------- 三、登記制 ----------
export const USE_RE = /media\/art\/|\bPLACE_ICON\b|\bplaceIconFor(?:Spot|Entry)\s*\(|\bplaceIconImg\s*\(/;
export const KINDS = ['trip-spot', 'task', 'itin', 'pick', 'poster-art'];   // 前四個是 App 畫面；poster-art（v1.93.0）只准海報頁首插圖
export const POSTER_DIR = 'js/itinposter/';                   // 海報：只准 poster-art，poster-art 也只准在這裡
const PLACE_USE_RE = /\bPLACE_ICON\b|\bplaceIconFor(?:Spot|Entry)\s*\(|\bplaceIconImg\s*\(/;   // 景點類型圖示（B11：海報不准）
export const DEF_FILE = 'js/placeicon.js';                    // 定義本身（一、二段驗它）
export const REGISTRY = [
  { file: 'js/views/trip.js', needle: 'const spotIconSrc = (s) => placeIconForSpot(s, placeLookupSync());', kind: 'trip-spot', why: '任務頁與行程分頁共用的取圖：經 placeIconForSpot（對得回景點庫才有）' },
  { file: 'js/views/trip.js', needle: "return src ? placeIconImg(src, s.emoji || '📍') : (s.emoji || '📍');", kind: 'task', why: '任務頁每一站標題列最前面那一格' },
  { file: 'js/views/trip.js', needle: "return src ? [placeIconImg(src, s.emoji || '📍'), ' ', name] : [", kind: 'itin', why: '行程分頁站卡第一行' },
  { file: 'js/views/create.js', needle: "h('span', { class: 'pc-emoji' }, placeIconForEntry(p) ? placeIconImg(placeIconForEntry(p)", kind: 'pick', why: '建立行程選景點的清單（景點庫本身的一筆）' },
  { file: 'js/itinposter/layout.js', needle: "export const HEADER_ART = { src: './media/art/d/poster-header.jpg'", kind: 'poster-art', why: '行程海報「全部一張」的頁首插圖（v1.93.0；登記在 manifest 的組 D、只准海報）' },
];

const listJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? listJs(p) : d.name.endsWith('.js') ? [p] : [];
});
// 區塊註解換成等量空白（行號不變），整行註解跳過
export function sitesIn(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  clean.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    if (USE_RE.test(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}
export function scan(root, registry) {
  const files = listJs(path.join(root, 'js')).map((f) => path.relative(root, f).split(path.sep).join('/')).filter((f) => f !== DEF_FILE);
  const sites = [];
  for (const f of files) for (const s of sitesIn(fs.readFileSync(path.join(root, f), 'utf8'))) sites.push({ file: f, ...s });
  const problems = [];
  const used = new Map();
  for (const s of sites) {
    const hits = registry.filter((r) => r.file === s.file && s.text.includes(r.needle));
    if (hits.length === 0) problems.push(`沒登記：${s.file}:${s.line}  ${s.text.slice(0, 100)}`);
    else if (hits.length > 1) problems.push(`一行對到 ${hits.length} 條登記：${s.file}:${s.line}`);
    if (hits.some((r) => r.kind === 'poster-art') && PLACE_USE_RE.test(s.text)) problems.push(`poster-art 那一行用了景點類型圖示：${s.file}:${s.line}`);
    for (const r of hits) used.set(r, (used.get(r) || 0) + 1);
  }
  for (const r of registry) {
    const n = used.get(r) || 0;
    if (n === 0) problems.push(`登記過期（對不到任何一行）：${r.file}「${r.needle}」`);
    if (n > 1) problems.push(`一條登記對到 ${n} 行：${r.file}「${r.needle}」`);
    if (!KINDS.includes(r.kind)) problems.push(`類別「${r.kind}」不准（只准 ${KINDS.join('、')}）：${r.file}「${r.needle}」`);
    else if (r.kind === 'poster-art' && !r.file.startsWith(POSTER_DIR)) problems.push(`類別「poster-art」只准海報（${POSTER_DIR}）：${r.file}「${r.needle}」`);
    else if (r.kind !== 'poster-art' && r.file.startsWith(POSTER_DIR)) problems.push(`海報（${POSTER_DIR}）只准登記 poster-art：${r.file}「${r.needle}」`);
  }
  return { files: files.length, sites, problems };
}
const mkJs = (files) => {
  fs.rmSync(CTL, { recursive: true, force: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(CTL, f)), { recursive: true });
    fs.writeFileSync(path.join(CTL, f), body);
    if (fs.readFileSync(path.join(CTL, f), 'utf8') !== body) throw new Error('對照樣本寫進去讀回來不一樣：' + f);
  }
};
const scanCtl = (label, files, registry, ok) => {
  mkJs(files);
  const r = scan(CTL, registry);
  const good = ok(r);
  yes(good, `對照組（${label}）`, `用到的地方 ${r.sites.length}：${r.sites.map((s) => s.file + ':' + s.line).join('、')}；問題：${r.problems.join('；') || '無'}`);
  return good;
};
const one = (r, prefix) => r.problems.length === 1 && r.problems[0].startsWith(prefix);
ctlOk = scanCtl('沒登記：照存著的類型直接查表', { 'js/a.js': 'const src = PLACE_ICON[spot.primary];\n' }, [], (r) => r.sites.length === 1 && one(r, '沒登記：js/a.js:1')) && ctlOk;
ctlOk = scanCtl('沒登記：直接寫圖檔路徑', { 'js/b.js': "const src = './media/art/a/food.png';\n" }, [], (r) => r.sites.length === 1 && one(r, '沒登記：js/b.js:1')) && ctlOk;
ctlOk = scanCtl('沒登記：海報呼叫 placeIconForSpot', { 'js/itinposter/c.js': 'const src = placeIconForSpot(s, lookup);\n' }, [], (r) => r.sites.length === 1 && one(r, '沒登記：js/itinposter/c.js:1')) && ctlOk;
ctlOk = scanCtl('沒登記：呼叫 placeIconImg', { 'js/d.js': 'el.append(placeIconImg(x));\n' }, [], (r) => r.sites.length === 1 && one(r, '沒登記：js/d.js:1')) && ctlOk;
ctlOk = scanCtl('註解、import、定義檔本身不算', {
  'js/e.js': "// PLACE_ICON 與 media/art/ 只是提到\n/* placeIconImg(x)\n placeIconForSpot(s) */\nimport { placeIconForSpot, placeIconImg } from '../placeicon.js';\n",
  [DEF_FILE]: "export const PLACE_ICON = { food: './media/art/a/food.png' };\n",
}, [], (r) => r.sites.length === 0 && r.problems.length === 0) && ctlOk;
ctlOk = scanCtl('區塊註解之後的行號照舊', { 'js/f.js': '/*\n\n*/\nconst a = placeIconForEntry(p);\n' },
  [{ file: 'js/f.js', needle: 'const a = placeIconForEntry(p);', kind: 'pick' }], (r) => r.sites.length === 1 && r.sites[0].line === 4 && r.problems.length === 0) && ctlOk;
ctlOk = scanCtl('登記過期', { 'js/g.js': 'const k = 1;\n' }, [{ file: 'js/g.js', needle: 'placeIconImg(', kind: 'task' }], (r) => one(r, '登記過期')) && ctlOk;
ctlOk = scanCtl('類別不准（海報）', { 'js/h.js': 'const a = placeIconImg(x);\n' }, [{ file: 'js/h.js', needle: 'placeIconImg(x)', kind: 'poster' }], (r) => one(r, '類別「poster」不准')) && ctlOk;
ctlOk = scanCtl('一條登記對到兩行', { 'js/i.js': 'const a = placeIconImg(x);\nconst b = placeIconImg(x);\n' }, [{ file: 'js/i.js', needle: 'placeIconImg(x)', kind: 'task' }], (r) => one(r, '一條登記對到 2 行')) && ctlOk;
// v1.93.0 poster-art：三個分支各一份要抓到的，加一份放行的
const ART_LINE = "export const A = { src: './media/art/d/p.jpg' };\n";
ctlOk = scanCtl('poster-art 登記在海報以外的檔', { 'js/j.js': ART_LINE }, [{ file: 'js/j.js', needle: "src: './media/art/d/p.jpg'", kind: 'poster-art' }], (r) => one(r, '類別「poster-art」只准海報')) && ctlOk;
ctlOk = scanCtl('海報的檔登記成 App 畫面的類別', { 'js/itinposter/k.js': ART_LINE }, [{ file: 'js/itinposter/k.js', needle: "src: './media/art/d/p.jpg'", kind: 'task' }], (r) => one(r, `海報（${POSTER_DIR}）只准登記 poster-art`)) && ctlOk;
ctlOk = scanCtl('poster-art 那一行用了景點類型圖示', { 'js/itinposter/l.js': 'const a = PLACE_ICON.food;\n' }, [{ file: 'js/itinposter/l.js', needle: 'PLACE_ICON.food', kind: 'poster-art' }], (r) => one(r, 'poster-art 那一行用了景點類型圖示')) && ctlOk;
ctlOk = scanCtl('poster-art 在海報裡、只寫頁首插圖的路徑（放行）', { 'js/itinposter/m.js': ART_LINE }, [{ file: 'js/itinposter/m.js', needle: "src: './media/art/d/p.jpg'", kind: 'poster-art' }], (r) => r.sites.length === 1 && r.problems.length === 0) && ctlOk;
fs.rmSync(CTL, { recursive: true, force: true });

if (!ctlOk) {
  console.log('✗ 對照組沒過——檢查器壞了，不採信下面一、三段的結果');
  process.exitCode = 4;
} else {
  const r = checkAssets({ dir: realDir, iconMap: realMap, posterArt: HEADER_ART, shell: realShell, tracked: realTracked, ignored: (rel) => gitIgnored(`${ART_DIR}/${rel}`) });
  const nKind = (k) => r.items.filter((it) => it.kind === k).length;
  console.log(`說明：${ART_DIR} 底下 ${r.files.length} 張圖、登記 ${r.items.length} 筆（place-type ${nKind('place-type')}、poster-header ${nKind('poster-header')}）、組 A 合計 ${r.total} 位元組、海報頁首 ${r.artBytes} 位元組；程式的表 ${Object.keys(realMap).length} 類、海報頁首 ${HEADER_ART.src}（${HEADER_ART.w}×${HEADER_ART.h}）；SHELL_ASSETS ${realShell.length} 項（其中 ${ART_DIR} 底下 ${realShell.filter((u) => u.startsWith(`./${ART_DIR}/`)).length} 項）；git 追蹤 ${ART_DIR} 底下 ${realTracked.size} 個檔`);
  yes(r.items.length > 0 && r.P.A1.length === 0, `A1 登記檔讀得到、${r.items.length} 筆、kind 都認得、file 與組 A 的 primary 都不重複`, r.P.A1.join('；'));
  yes(r.files.length > 0 && r.P.A2.length === 0, `A2 圖檔 ${r.files.length} 張 ↔ 登記 ${r.items.length} 筆，兩邊一張不差`, r.P.A2.join('；'));
  yes(r.P.A3.length === 0, `A3 每一張的雜湊都跟登記一樣`, r.P.A3.join('；'));
  yes(nKind('poster-header') === 1 && r.P.A4.length === 0, `A4 組 A 每一張都是 ${SIZE}×${SIZE} 的 PNG、不超過 ${MAX_BYTES} 位元組，合計 ${r.total} ≤ ${MAX_TOTAL}；海報頁首是 ${HEADER_ART.w}×${HEADER_ART.h} 的 JPEG、${r.artBytes} ≤ ${MAX_ART_BYTES}`, r.P.A4.join('；'));
  yes(r.P.A5.length === 0, `A5 只有影像區塊／區段（PNG 沒有文字或中繼資料、JPEG 沒有 APP0 以外的 APPn 與註解）`, r.P.A5.join('；'));
  yes(Object.keys(realMap).length > 0 && r.P.A6.length === 0, `A6 程式的表（js/placeicon.js 的 PLACE_ICON）與海報頁首（js/itinposter/layout.js 的 HEADER_ART）跟登記一模一樣`, r.P.A6.join('；'));
  yes(r.P.A7.length === 0, `A7 表上每一張都在 sw.js 的 SHELL_ASSETS，SHELL_ASSETS 裡 ${ART_DIR} 底下的每一項都在表上`, r.P.A7.join('；'));
  yes(r.P.A8.length === 0, `A8 每一張與登記檔都進了版控、大小寫跟 git 一樣、沒被 .gitignore 擋`, r.P.A8.join('；'));

  const s = scan(ROOT, REGISTRY);
  console.log(`說明：掃了 js/ 底下 ${s.files} 支 .js（不含 ${DEF_FILE}），用到圖示的 ${s.sites.length} 處；登記 ${REGISTRY.length} 條`);
  yes(s.files > 0 && s.sites.length > 0, `C1 母體非空（${s.files} 支檔、${s.sites.length} 處）`);
  yes(s.problems.length === 0 && s.sites.length === REGISTRY.length, `C2 每一處都登記了、每一條登記剛好對到一處（用到的地方 ${s.sites.length}＝登記 ${REGISTRY.length}）`, s.problems.join('\n   '));
}
console.log(`\n${pass} 項通過` + (process.exitCode === 1 ? '，有失敗' : process.exitCode === 4 ? '，對照組沒過' : ''));
