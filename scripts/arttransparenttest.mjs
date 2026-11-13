// 吉祥物的圖不准有鋪滿畫布的底色（2026-11-13 第四段之二；npm run arttransparenttest；會開瀏覽器，只畫圖、不操作畫面）
//
// 起因：第四段第一版的六張情境圖，每一張都自己畫了一整塊 240×240 的圓角底色卡——Yolin 看截圖：
// 「角色融入到按鍵或畫面裡，不是像現在角色站在文字旁邊，甚至沒有去背」。容器沒有底色、深色白邊也不是原因，是圖本身。
//
// 驗法（驗語意、不貼字面）：不讀 SVG 的原始碼找 <rect>——把每一張圖**真的畫到畫布上**，量畫布最外 2px 那一圈
// 有幾成不透明（「邊框」）。鋪滿畫布的底色（方塊、路徑、圓角卡）、畫到畫布邊的場景（地面、雪坡）一定讓它很高；
// 角色本身只有被畫布裁到的地方碰到邊。判「鋪滿」：邊框 ≥ 35%。每一張實際量到的數字都印出來（通過時也印），對照組也印。
//   門檻的根據（2026-11-13 第一次跑量到的）：真的圖最高 22%（頁首的頭——只裁頭，耳朵和下巴被畫布切到）；
//   最弱的對照組「整條寬的地面」49%；35% 兩邊各留 13 點。
//   本來還量「面積」（整張幾成不透明），第一次跑就看出分不開：裁得緊的圖本來就滿（頁首的頭 86%、北北烤串 73%），
//   跟內縮的卡片（80%）、內切的大圓（81%）重疊——所以拿掉，不硬調門檻。
// **已知抓不到**（每次跑都印出那兩個對照組量到的數字，不是斷言）：底色沒碰到畫布邊的（內縮一點的卡片、內切的大圓）。
//   這支擋的是第四段第一版那一族：底色卡鋪滿畫布、場景畫到畫布邊。
// 母體用登記制：glyphs.js 的 MASCOT_KINDS（六隻）＋頁首的頭、ICON_KINDS（拍照圖示）、peeks.js 的 PEEK_KINDS（探頭圖）——
// 這幾份清單就是 App 畫得出來的每一張吉祥物圖；之後加新的圖，加進清單就自動被這支量到。每一張都從對外的函式產生（跟畫面用的同一條路）。
//
// 對照組（同一個量法、同一段程式，從真的圖改出來）：
//   會判鋪滿：滿版方塊插在最前面／最後面、滿版的路徑（不是 rect）、第四段第一版那種滿版圓角卡、整條寬的地面（只碰到左右下三邊）
//   不會判鋪滿：只放在 clipPath 裡的滿版方塊（不會被畫出來）、一塊小方塊、原樣
//
// 每一條斷言不管前面成不成都會印（等不到的記成 ✗、不丟例外）：突變執行器要「項數跟原樣一樣」才算跑滿。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5821;
const ORIGIN = `http://localhost:${WEB}`;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
const pct = (x) => `${Math.round(x * 100)}%`;
const FRAME_MAX = 0.35;   // 根據見檔頭（真的圖最高 22%、最弱的對照組 49%）
const isFull = (m) => m.frame >= FRAME_MAX;

let res = null;
try {
  const page = await browser.newPage();
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  res = await page.evaluate(async () => {
    const g = await import('./js/glyphs.js');
    const pk = await import('./js/peeks.js');
    // 量一張：序列化 → 當成圖片載入 → 畫到 240 寬的畫布 → 讀每一個像素的不透明度
    async function measure(el) {
      const vb = el.getAttribute('viewBox').split(/[\s,]+/).map(Number);
      const W = 240, H = Math.max(1, Math.round((W * vb[3]) / vb[2]));
      const xml = new XMLSerializer().serializeToString(el);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      let on = 0, fOn = 0, fAll = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = px[(y * W + x) * 4 + 3] >= 128;
        if (o) on++;
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) { fAll++; if (o) fOn++; }
      }
      return { frame: fOn / fAll, fill: on / (W * H), w: W, h: H };
    }
    // 母體（登記制）：每一份清單、每一張圖都從對外的函式產生
    const list = [];
    for (const k of g.MASCOT_KINDS) list.push([`吉祥物 ${k}`, () => g.mascot(k, 96)]);
    list.push(['頁首的頭', () => g.mascotHead(26)]);
    for (const k of g.ICON_KINDS) list.push([`拍照圖示 ${k}`, () => g.photoIcon(k, 30)]);
    for (const k of pk.PEEK_KINDS) list.push([`探頭圖 ${k}`, () => pk.peek(k, 0.6)]);
    const out = { counts: { mascot: g.MASCOT_KINDS.length, icon: g.ICON_KINDS.length, peek: pk.PEEK_KINDS.length }, all: [], ctl: {} };
    for (const [name, make] of list) {
      try { out.all.push({ name, ...(await measure(make())) }); } catch (e) { out.all.push({ name, err: String(e) }); }
    }
    // 對照組：從一張真的探頭圖改出來（跟上面同一個 measure）
    const base = () => pk.peek(pk.PEEK_KINDS[0], 0.6);
    const vbOf = (el) => el.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    const NS = 'http://www.w3.org/2000/svg';
    const add = (el, tag, attrs, where) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (where === 'first') el.insertBefore(n, el.firstChild); else if (where === 'last') el.appendChild(n); else where.appendChild(n);
      return el;
    };
    const ctl = {
      full_first: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'rect', { x, y, width: w, height: h, fill: '#f3f6f8' }, 'first'); },
      full_last: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'rect', { x, y, width: w, height: h, fill: '#f3f6f8' }, 'last'); },
      full_path: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'path', { d: `M${x} ${y} H${x + w} V${y + h} H${x} Z`, fill: '#eef5f9' }, 'first'); },
      // 第四段第一版的情境圖那種：滿版、四角裁圓（圓角 10%）的底色卡
      rounded_card: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'rect', { x, y, width: w, height: h, rx: w * 0.1, fill: '#fbf4e8' }, 'first'); },
      // 整條寬的地面（第四段第一版的雪坡、草地那種）：只碰到左、右、下三邊——最上面那一排是空的
      ground_band: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'rect', { x, y: y + h * 0.55, width: w, height: h * 0.45, fill: '#b9daa5' }, 'first'); },
      // 已知抓不到的兩種（只印數字、不是斷言）：底色沒碰到畫布邊
      inset_card: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'rect', { x: x + w * 0.06, y: y + h * 0.06, width: w * 0.88, height: h * 0.88, rx: w * 0.1, fill: '#fbf4e8' }, 'first'); },
      circle_badge: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: '#fbf1ec' }, 'first'); },
      clip_only: (el) => {
        const [x, y, w, h] = vbOf(el);
        const defs = document.createElementNS(NS, 'defs'), cp = document.createElementNS(NS, 'clipPath');
        cp.setAttribute('id', 'ctl-only'); defs.appendChild(cp); el.insertBefore(defs, el.firstChild);
        return add(el, 'rect', { x, y, width: w, height: h }, cp);
      },
      small: (el) => { const [x, y, w, h] = vbOf(el); return add(el, 'rect', { x: x + w * 0.45, y: y + h * 0.1, width: w * 0.1, height: h * 0.1, fill: '#f3f6f8' }, 'first'); },
    };
    for (const [k, f] of Object.entries(ctl)) {
      try { out.ctl[k] = await measure(f(base())); } catch (e) { out.ctl[k] = { err: String(e) }; }
    }
    out.ctl.plain = await measure(base());
    return out;
  });
} catch (e) { console.log('  [跑不起來]', e.message); }

const all = res ? res.all : [];
const ctl = res ? res.ctl : {};
const show = (m) => (m && !m.err ? `邊框 ${pct(m.frame)}（面積 ${pct(m.fill)}，只印不判）` : `量不到（${m ? m.err : '沒有結果'}）`);

// ---- 前置：母體與量法本身 ----
console.log(`  母體：吉祥物 ${res ? res.counts.mascot : '?'} 隻＋頁首的頭、拍照圖示 ${res ? res.counts.icon : '?'} 個、探頭圖 ${res ? res.counts.peek : '?'} 張，共 ${all.length} 張`);
yes(!!res && res.counts.mascot === 6 && res.counts.icon >= 2 && res.counts.peek >= 7 && all.length === 1 + res.counts.mascot + res.counts.icon + res.counts.peek,
  '前置：母體——六隻吉祥物、頁首的頭、拍照圖示、探頭圖全部列到（數出來的張數＝清單相加）');
yes(all.length > 0 && all.every((m) => !m.err && m.fill > 0.03),
  `前置：每一張都真的畫出東西（面積 > 3%；最少的一張 ${all.length ? pct(Math.min(...all.map((m) => (m.err ? 0 : m.fill)))) : '—'}）——畫不出來的圖量到的「透明」不算數`);
// ---- 對照組：同一個量法 ----
for (const [k, label] of [['full_first', '滿版方塊插在最前面'], ['full_last', '滿版方塊插在最後面'], ['full_path', '滿版的路徑（不是 rect）'],
  ['rounded_card', '第四段第一版那種滿版圓角卡'], ['ground_band', '整條寬的地面（只碰到左右下三邊）']]) {
  yes(!!ctl[k] && !ctl[k].err && isFull(ctl[k]), `對照組：${label} → 判鋪滿（${show(ctl[k])}）`);
}
for (const [k, label] of [['clip_only', '只放在 clipPath 裡的滿版方塊'], ['small', '一塊小方塊（一成寬）'], ['plain', '原樣']]) {
  yes(!!ctl[k] && !ctl[k].err && !isFull(ctl[k]), `對照組：${label} → 不判鋪滿（${show(ctl[k])}）`);
}
console.log(`  說明（不是斷言）：已知抓不到底色沒碰到畫布邊的——內縮的圓角卡 ${show(ctl.inset_card)}、內切的大圓 ${show(ctl.circle_badge)}；判定 ${ctl.inset_card && isFull(ctl.inset_card) ? '鋪滿' : '沒抓到'}／${ctl.circle_badge && isFull(ctl.circle_badge) ? '鋪滿' : '沒抓到'}`);
// ---- 每一張圖 ----
for (const m of all) console.log(`  ${isFull(m) || m.err ? '!!' : '  '} ${m.name}：${show(m)}`);
const bad = all.filter((m) => m.err || isFull(m));
yes(all.length > 0 && bad.length === 0,
  `吉祥物的圖沒有鋪滿畫布的底色（${all.length} 張；邊框都 < ${pct(FRAME_MAX)}，最高 ${all.length ? pct(Math.max(...all.map((m) => (m.err ? 1 : m.frame)))) : '—'}）${bad.length ? '——鋪滿或量不到：' + bad.map((m) => m.name).join('、') : ''}`);

console.log(`\n${pass} 項通過`);
await browser.close();
web.kill();
