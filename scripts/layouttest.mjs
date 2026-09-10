// 版面掃描（npm run layouttest，v1.73）—— 使用者點名「超大型字體會不會跑版」。
//
// 為什麼要有這一支：最近幾個 bug 都是「斷言全綠但畫面壞掉」。
// 既有的斷言驗的是「東西在不在」，驗不到「並排在一起會不會擠爆」。
// 所以這裡不抽樣：**每一頁 × 標準／大／特大字級 × 320/360/390/430px，逐一渲染**，
// 加上每一個對話框，機械化檢查這些：
//   1. 橫向溢出（整頁能左右捲＝版面已經爆了）
//   2. 文字被截斷（scrollWidth > clientWidth 且沒有 overflow 設定）
//   3. 按鈕文字折行（用 Range 數行數，不是拿高度除行高 —— 那會把 padding 算進去）
//   4. **文字畫到自己的框外面**（v1.73.5）
//   5. **兩段文字互相重疊**（v1.73.5）
//   6. **不該斷開的地方斷行**，例如「3」留在行尾、「天」跑到下一行（v1.73.5）
//   7. 觸控區小於 44px
//   8. 內容被固定元素遮住（底部分頁列 76px、SOS 鈕）
//
// ⚠️ 4/5/6 是 v1.73.5 才補的。第一版的檔頭寫著「檢查六件事」、第 4 項是「元素重疊」，
// 但**那一項從來沒有實作**（只有五種 kind）。使用者用特大字級實測回報的三個跑版
// 有兩個就是重疊，掃描器一個都沒報。教訓：註解不是斷言，寫了不等於做了。
//
// 重疊不能用「兄弟節點的**框**相交」判 —— 縮圖上的徽章、SOS 鈕本來就是疊的，
// 而且真正的問題（`51/51` 撞到 `117.3`）兩個格子的框根本沒有相交，是**文字**
// 畫出了格子。所以量的是 Range 給的**實際畫出來的文字矩形**。
//
// 320px 是 iPhone SE 一代那種老機型；430px 是 iPhone Pro Max。長輩用舊手機的機率不低。

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5701, OSRM = 5702, OP = 5703;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const SHOTS = process.env.TQ_LAYOUT_SHOTS ? path.join(ROOT, 'screenshots', '_layout') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ---- 假外部服務：版面掃描不該打真的服務，也不該因為網路慢就變不決定性 ----
import { createServer } from 'node:http';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const osrmSrv = createServer((req, res) => {
  const m = req.url.match(/\/table\/v1\/[a-z]+\/([^?]+)/);
  if (!m) { res.writeHead(404); return res.end(); }
  // 依實際座標距離回時間，不要一律 900 秒 —— 均勻矩陣會讓 suggestOrder 永遠
  // 判定「已經很順」，「建議順序」那個對話框就永遠開不起來、掃不到。
  const pts = decodeURIComponent(m[1]).split(';').map((p2) => p2.split(',').map(Number));
  const n = pts.length;
  const dur = (a, b) => Math.round(Math.hypot((a[0] - b[0]) * 101, (a[1] - b[1]) * 111) * 90);
  res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 'Ok', durations: pts.map((a) => pts.map((b) => dur(a, b))) }));
  void n;
});
osrmSrv.listen(OSRM);
const opSrv = createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 24.6775, lon: 121.767, tags: { amenity: 'parking', name: '羅東夜市公有停車場', fee: 'yes', capacity: '186' } },
      { type: 'node', id: 2, lat: 24.678, lon: 121.768, tags: { amenity: 'toilets', wheelchair: 'yes', changing_table: 'yes' } },
      { type: 'node', id: 3, lat: 24.6772, lon: 121.7665, tags: { shop: 'convenience', name: '7-Eleven 羅東門市', opening_hours: '24/7' } },
      { type: 'node', id: 4, lat: 24.679, lon: 121.769, tags: { amenity: 'hospital', name: '羅東博愛醫院', emergency: 'yes' } },
    ] }));
  });
});
opSrv.listen(OP);

let pass = 0;
const problems = [];
const seen = new Set();          // 同一個問題在多個組合出現只記一次（但記下所有組合）
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; }
};

const WIDTHS = [320, 360, 390, 430];
const FONTS = ['m', 'l', 'xl'];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://localhost:${WEB}`, ['geolocation']);
  const page = await ctx.newPage();
  await page.setGeolocation({ latitude: 24.6771, longitude: 121.7669 });
  await page.evaluateOnNewDocument((o) => {
    window.__TQ_OSRM_ENDPOINT = o.osrm;
    window.__TQ_OVERPASS_ENDPOINT = o.op;
  }, { osrm: `http://localhost:${OSRM}`, op: `http://localhost:${OP}/interpreter` });
  page.on('pageerror', (e) => problems.push({ kind: 'pageerror', where: 'global', detail: e.message.slice(0, 120) }));

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // ---------- 建一份「有內容」的行程：空頁面驗不到擠壓 ----------
  const ids = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const db = await import('./js/db.js');
    const gid = uuid(), tid = uuid(), me = uuid();
    await s.put({ id: gid, type: 'group', name: '家族' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭家族小旅行（三天兩夜）', region: '宜蘭',
      country: 'TW', startDate: '2026-10-01', endDate: '2026-10-03', aiEnabled: false,
      createdByDevice: myDeviceId(), baseCurrency: 'TWD' });
    await s.put({ id: me, type: 'member', tripId: tid, groupId: gid, displayName: '阿嬤' });
    await s.put({ id: uuid(), type: 'member', tripId: tid, groupId: gid, displayName: '爸爸' });
    // 長名稱是版面殺手 —— 故意放幾個
    const names = [
      ['國立傳統藝術中心宜蘭園區', 1], ['蘭陽博物館', 1], ['頭城老街', 1],
      ['礁溪溫泉公園森林風呂', 2], ['甕窯雞', 2], ['羅東夜市', 2],
      ['金車生技水產養殖研發中心', 3], ['幾米公園', 3],
    ];
    const spots = [];
    for (let i = 0; i < names.length; i++) {
      const id = uuid();
      await s.put({ id, type: 'spot', tripId: tid, name: names[i][0], emoji: '📍',
        // 第 1 天刻意排成 Z 字（近→遠→近），不然 suggestOrder 會回「已經很順」
        // 直接 toast 不開對話框，掃描器就掃不到那個對話框。
        day: names[i][1], order: i,
        lat: 24.67 + [0, 0.06, 0.01][i] * (i < 3 ? 1 : 0) + (i >= 3 ? i * 0.01 : 0),
        lng: 121.76 + (i % 3) * 0.01,
        startMin: i === 0 ? 9 * 60 : undefined, stayMin: 60,
        blurb: '這裡是這趟不能少的一站，慢慢走、慢慢看，找個角度拍一張會想一直看的照片。' });
      spots.push(id);
      // 每站 6～7 個任務 → 全趟 51 個。數量本身就是版面壓力：
      // 回顧頁的「51/51」比「1/16」寬得多，而格子寬度是固定的 90px 下限。
      for (let q = 0; q < (i < 3 ? 7 : 6); q++) {
        await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: id, order: q, source: 'template',
          title: `拍下 ${names[i][0]} 最有代表性的一幕`,
          hint: '站遠一點，把整體帶進畫面；不用擺姿勢，抓大家正在笑的那一刻最好。' });
      }
    }
    // 一張照片（相簿／影片頁需要）
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    await db.putBlob({ hash: 'h1', blob: new Blob([png], { type: 'image/png' }), w: 1, h: 1, bytes: png.length, kind: 'photo' });
    // 每個任務都完成、而且有讚 —— 使用者的實機截圖是 51/51、任務列有「❤️ 2」「❤️ 3」。
    // 沒有讚的話任務列的狀態列短很多，撞不到右邊的相機按鈕。
    const all = [];
    for (const sp of spots) all.push(...s.questsOf(sp));
    for (let qi = 0; qi < all.length; qi++) {
      const sid = uuid();
      await s.put({ id: sid, type: 'submission', tripId: tid, questId: all[qi].id, memberId: me,
        photoHash: 'h1', thumbHash: 'h1', createdAt: Date.now() - qi * 60000 });
      // 兩三個讚（reaction 記錄）
      for (let k = 0; k < (qi % 3) + 1; k++) {
        await s.put({ id: uuid(), type: 'reaction', tripId: tid, groupId: gid, submissionId: sid,
          actorId: k === 0 ? me : uuid(), emoji: '❤️', createdAt: Date.now() });
      }
    }
    // 一筆分帳
    await s.put({ id: uuid(), type: 'expense', tripId: tid, groupId: gid, title: '晚餐（羅東夜市三攤）',
      amount: 1250, currency: 'TWD', payerId: me, at: Date.now(), category: 'food', shareIds: [me] });
    return { tid, gid };
  });

  // ---------- 檢查器（跑在瀏覽器裡）----------
  const CHECK = `(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1;
    };
    const label = (el) => (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '');
    const txt = (el) => (el.textContent || '').trim().slice(0, 22);

    // 1. 橫向溢出
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
      out.push({ kind: 'overflow-x', where: 'document', detail: de.scrollWidth + ' > ' + de.clientWidth });
      // 找兇手：右緣超出視窗的元素
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && el.offsetParent !== null) {
          out.push({ kind: 'overflow-el', where: label(el), detail: '右緣 ' + Math.round(r.right) + ' > ' + vw + ' ｜「' + txt(el) + '」' });
          break;
        }
      }
    }

    // 2+3. 按鈕：文字折行、觸控區
    //
    // 折行的判準要分兩種，不能一律當問題（第一版就是這樣，噴了 199 個假警報）：
    //  · **並排的按鈕**折行 ＝ 被旁邊的擠扁了，是真問題。
    //  · **滿版按鈕**折成兩行是正常的（長標籤在窄螢幕本來就會換行，而且好讀）；
    //    折成三行以上才是問題。
    //  · 底部分頁列（.tab）本來就是「圖示一行、文字一行」，完全不該算折行。
    //  · **卡片型按鈕**（<button> 裡包了區塊級子元素，例如景點卡的「emoji / 名稱 /
    //    主題 / 進度」各自一行）本來就是多行，Range 會回一堆矩形，量了沒有意義。
    //    只量「純文字標籤」的按鈕，那才是會被旁邊擠扁的那一類。
    const isBlocky = (el) => [...el.children].some((c) => {
      const d = getComputedStyle(c).display;
      return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d === 'table';
    });
    for (const b of document.querySelectorAll('button, .btn, a.btn, .nl-cat')) {
      const r = b.getBoundingClientRect();
      if (!r.width || b.offsetParent === null) continue;
      if (b.closest('#tabbar')) continue;                 // 分頁列：圖示+文字兩行是設計
      const t = txt(b);
      if (!t) continue;
      if (isBlocky(b)) continue;                          // 卡片型按鈕：多行是設計
      const parent = b.parentElement;
      const pw = parent ? parent.getBoundingClientRect().width : r.width;
      const fullWidth = pw > 0 && r.width >= pw * 0.85;
      const n = lines(b);
      const limit = fullWidth ? 2 : 1;
      if (n > limit) {
        out.push({ kind: fullWidth ? 'btn-wrap-3' : 'btn-wrap-squeezed', where: label(b),
          detail: '「' + t + '」折成 ' + n + ' 行' + (fullWidth ? '（滿版，>2 行才算）' : '（並排被擠扁）') });
      }
      if (r.height < 44 && !b.closest('.pv') && !b.closest('#tabbar')) {
        out.push({ kind: 'touch-small', where: label(b), detail: '「' + t + '」高 ' + Math.round(r.height) + 'px < 44' });
      }
    }

    // 4/5/6. 文字畫出框、兩段文字重疊、不該斷的地方斷行（v1.73.5）
    //
    // 收集所有「葉節點文字」實際畫出來的矩形。用 Range 而不是 getBoundingClientRect：
    // 元素的**框**可能好好的，但裡面的文字（例如 white-space:nowrap 的狀態列）
    // 畫到框外面去、蓋到隔壁的按鈕上 —— 那才是使用者看到的問題。
    const leaves = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length || !el.textContent.trim()) continue;
      if (el.offsetParent === null) continue;
      if (el.closest('#tabbar, .sos-fab, .modal-mask')) continue;
      const cs = getComputedStyle(el);
      if (+cs.opacity === 0 || cs.visibility === 'hidden') continue;
      const rng = document.createRange();
      rng.selectNodeContents(el);
      const rects = [...rng.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) continue;
      const box = el.getBoundingClientRect();
      const t = { x0: Math.min(...rects.map((r) => r.left)), x1: Math.max(...rects.map((r) => r.right)),
        y0: Math.min(...rects.map((r) => r.top)), y1: Math.max(...rects.map((r) => r.bottom)) };
      // Range 回的是**未裁切**的文字範圍。元素（或祖先）有 overflow:hidden 的話，
      // 畫面上看不到那一段 —— 不夾的話 .qc-theme（nowrap + ellipsis）會被誤報成
      // 跟進度標記重疊。夠到最近的裁切祖先為止。
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if (ac.overflow === 'visible' && ac.overflowX === 'visible' && ac.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        t.x0 = Math.max(t.x0, ar.left); t.x1 = Math.min(t.x1, ar.right);
        t.y0 = Math.max(t.y0, ar.top); t.y1 = Math.min(t.y1, ar.bottom);
      }
      if (t.x1 - t.x0 < 1 || t.y1 - t.y0 < 1) continue;   // 被裁到完全看不見
      // 刻意疑在別人上面的東西不算（縮圖上的徽章、浮動按鈕、頂端標題列…）。
      // 要往上走：h1#topTitle 自己是 static，但它在 fixed 的 #topbar 裡面 ——
      // 內容從固定標題列底下捲過去是設計，不是重疊。
      // （只看元素自己的 position 的話，一輪掃描就噴了 107 筆，絕大多數是這一類。）
      let stacked = false;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const pos = getComputedStyle(a).position;
        if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') { stacked = true; break; }
      }
      leaves.push({ el, cs, box, t, rects, stacked });

      // 4. 文字畫到自己的框外面，而且沒有裁切設定 → 它會蓋到旁邊的東西
      // 判準是「文字比自己的框**寬**」，不是「超出框」。
      // emoji 的字形墨水框常常整個偏移幾像素（📷 框 187～233、字形 194～240，
      // 同樣寬 46px）—— 那不是版面問題。真正的問題（nowrap 的狀態列）是
      // 文字 160px、框只有 58px。門檻 8px，避開字形邊緣的一兩像素。
      if (!stacked && cs.overflow === 'visible' && cs.overflowX === 'visible'
          && (t.x1 - t.x0) > box.width + 16) {
        // 容差固定 16px，不用百分比。emoji 的字形墨水框比字進寬多出十幾像素
        // 是常態（❤️、📷 都是）且**不隨框寬成比例**，所以百分比門檻反而會
        // 把寬框上的真問題濾掉（實際踩過：回顧頁的日期列溢 20px / 框 288px，
        // 20% 門檻會漏報）。
        // 門檻是「超出 12px **且** 超出框寬的 20%」。emoji 的字形墨水框比字進寬
        // 多出十幾像素是常態（❤️、📷 都是），那在畫面上完全看不出來；
        // 而真正的問題（nowrap 的狀態列）是文字 211px、框只有 58px。
        // 真的撞到人的話下面的 overlap 還會抳 —— 這一條不是唯一的防線。
        out.push({ kind: 'text-spill', where: label(el),
          detail: '「' + txt(el) + '」文字畫到 ' + Math.round(t.x0) + '～' + Math.round(t.x1)
            + '，自己的框只有 ' + Math.round(box.left) + '～' + Math.round(box.right) });
      }

      // 6. 不該斷的地方斷行：行尾是孤零零的數字、下一行開頭是量詞
      //    （使用者實測：「… · 3」換行「天 · 4 人」）
      const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
      if (tops.length > 1 && el.textContent.length <= 160) {
        const lines = [];
        const node = el.firstChild;
        if (node && node.nodeType === 3) {
          let cur = '', prevTop = null;
          for (let i = 0; i < node.length; i++) {
            const r2 = document.createRange();
            r2.setStart(node, i); r2.setEnd(node, i + 1);
            const rr = r2.getBoundingClientRect();
            if (!rr.width && !rr.height) { cur += node.data[i]; continue; }
            const top = Math.round(rr.top);
            if (prevTop !== null && top !== prevTop) { lines.push(cur); cur = ''; }
            prevTop = top; cur += node.data[i];
          }
          if (cur) lines.push(cur);
        }
        for (let i = 0; i + 1 < lines.length; i++) {
          const endsNum = /[0-9][\s\u3000]*$/.test(lines[i]);
          const startsUnit = /^[\s\u3000]*[天人張個次日年月分秒公里小時位%％]/.test(lines[i + 1]);
          if (endsNum && startsUnit) {
            out.push({ kind: 'bad-wrap', where: label(el),
              detail: '「' + lines[i].slice(-12).trim() + '」換行「' + lines[i + 1].slice(0, 12).trim()
                + '」—— 數字和量詞被拆開' });
            break;
          }
        }
      }
    }

    // 5. 兩段文字互相重疊
    for (let i = 0; i < leaves.length; i++) {
      const a = leaves[i];
      if (a.stacked) continue;
      for (let j = i + 1; j < leaves.length; j++) {
        const b = leaves[j];
        if (b.stacked) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.t.x1, b.t.x1) - Math.max(a.t.x0, b.t.x0);
        const oy = Math.min(a.t.y1, b.t.y1) - Math.max(a.t.y0, b.t.y0);
        // 垂直方向要疊到字高的一半以上才算。上下排的兩個區塊差個 4–5px
        // 是 line-height 的行距，Range 會把它算進去 —— 那不是重疊。
        // 真正的碰撞（使用者實機的 51/51117.3）是同一行的水平碰撞，
        // 垂直方向會疊掉整個字高。
        const minH = Math.min(a.t.y1 - a.t.y0, b.t.y1 - b.t.y0);
        if (ox > 4 && oy > Math.max(4, minH * 0.5)) {
          out.push({ kind: 'overlap', where: label(a.el) + ' × ' + label(b.el),
            detail: '「' + txt(a.el) + '」和「' + txt(b.el) + '」疊了 '
              + Math.round(ox) + '×' + Math.round(oy) + 'px' });
          i = leaves.length;                          // 一頁報一組就夠，不然會爆量
          break;
        }
      }
    }

    // 7. 文字被截斷（有 overflow:hidden 且內容比容器寬，又沒有 ellipsis）
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'visible' || !el.textContent.trim()) continue;
      if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
        out.push({ kind: 'text-clip', where: label(el), detail: '「' + txt(el) + '」' + el.scrollWidth + ' > ' + el.clientWidth });
      }
    }

    // 5. 被固定元素遮住：最後一個可見內容的底部不能低於分頁列頂端
    const bar = document.getElementById('tabbar');
    if (bar && !bar.hidden) {
      const barTop = bar.getBoundingClientRect().top;
      const pageEl = document.querySelector('.page');
      if (pageEl) {
        const kids = [...pageEl.children].filter((x) => x.getBoundingClientRect().height > 0);
        const last = kids[kids.length - 1];
        if (last) {
          const lr = last.getBoundingClientRect();
          // 只有在頁面捲到底時才有意義
          const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
          if (atBottom && lr.bottom > barTop + 1) {
            out.push({ kind: 'hidden-by-tabbar', where: label(last), detail: '底部 ' + Math.round(lr.bottom) + ' > 分頁列 ' + Math.round(barTop) });
          }
        }
      }
    }
    return out;
  })()`;

  const record = (combo, list) => {
    for (const p of list) {
      const key = p.kind + '|' + p.where + '|' + (p.detail || '').slice(0, 40);
      if (seen.has(key)) { const e = problems.find((x) => x.key === key); if (e && e.combos.length < 6) e.combos.push(combo); continue; }
      seen.add(key);
      problems.push({ key, ...p, combos: [combo] });
    }
  };

  // ---------- 掃描 ----------
  const ROUTES = [
    ['首頁', '/'],
    ['行程頁', `/trip/${ids.tid}`],
    ['旅程設定', `/trip/${ids.tid}/settings`],
    ['調整行程', `/trip/${ids.tid}/plan`],
    ['搜尋景點', `/trip/${ids.tid}/findspot`],
    ['照片牆', `/trip/${ids.tid}/people`],
    ['相簿影片', `/trip/${ids.tid}/album`],
    ['海報', `/trip/${ids.tid}/poster`],
    ['分帳', `/trip/${ids.tid}/expenses`],
    ['回顧入口', `/trip/${ids.tid}/memories`],
    ['成果回顧', `/trip/${ids.tid}/recap`],
    ['成就', `/trip/${ids.tid}/badges`],
    ['天氣', `/trip/${ids.tid}/weather`],
    ['緊急求助', `/trip/${ids.tid}/sos`],
    ['找附近', `/trip/${ids.tid}/nearby`],
    ['建立行程', '/new'],
    ['設定', '/settings'],
  ];

  let combos = 0;
  console.log(`— 逐頁掃描（${ROUTES.length} 頁 × ${FONTS.length} 字級 × ${WIDTHS.length} 寬度 = ${ROUTES.length * FONTS.length * WIDTHS.length} 種組合）—`);
  for (const [name, route] of ROUTES) {
    for (const w of WIDTHS) {
      for (const fs2 of FONTS) {
        await page.setViewport({ width: w, height: 844, deviceScaleFactor: 1 });
        await page.goto('about:blank');
        await page.goto(`http://localhost:${WEB}/#${route}`, { waitUntil: 'networkidle0' }).catch(() => {});
        await page.evaluate((v) => { document.documentElement.dataset.fs = v; }, fs2);
        await page.waitForSelector('.page, .hero', { timeout: 15000 }).catch(() => {});
        await sleep(650);
        // 先把折疊的都展開 —— 使用者看到的是展開狀態。
        // 收合時 .qc-body 是 grid-template-rows: 0fr（高度 0 但還在 DOM 裡），
        // 所以任務列一直只被掃到「收起來」的樣子 —— 使用者實機回報的
        // 「愛心數被相機按鈕擋住」就是這樣漏掉的（v1.73.5）。
        for (let k = 0; k < 2; k++) {
          const opened = await page.evaluate(() => {
            let n = 0;
            for (const b of document.querySelectorAll('.daycollapse:not(.open) .dc-head, .qcollapse:not(.open) .qc-toggle')) { b.click(); n++; }
            // <details>（「進階（可略過）」那種）也要展開 —— 使用者會展開它
            for (const d of document.querySelectorAll('details:not([open])')) { d.open = true; n++; }
            return n;
          }).catch(() => 0);
          if (!opened) break;
          await sleep(450);
        }
        await sleep(200);
        // 捲到底再驗「被分頁列遮住」
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(250);
        const list = await page.evaluate(CHECK);
        combos++;
        record(`${name}/${w}px/${fs2}`, list);
        if (SHOTS && fs2 === 'xl' && w === 320) {
          await page.screenshot({ path: path.join(SHOTS, `${name}-320-xl.png`) });
        }
      }
    }
    process.stdout.write('.');
  }
  console.log('');
  yes(combos === ROUTES.length * FONTS.length * WIDTHS.length,
    `掃了 ${combos} 種「頁面 × 字級 × 寬度」組合`);

  // ---------- 對話框 ----------
  console.log('\n— 對話框（最壞情況：320px × 特大字級）—');
  await page.setViewport({ width: 320, height: 844, deviceScaleFactor: 1 });
  const MODALS = [
    ['建議順序', `/trip/${ids.tid}/plan`, () => [...document.querySelectorAll('.pd-opt')][0]?.click()],
    ['刪除確認', `/trip/${ids.tid}/settings`, () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('移除這趟'))?.click()],
    ['日期選擇', `/trip/${ids.tid}/settings`, () => [...document.querySelectorAll('.setting-row')].find((r) => r.textContent.includes('旅程日期'))?.querySelector('button')?.click()],
    ['調整上限', `/trip/${ids.tid}/settings`, () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('貼上 Google 金鑰'))?.click()],
    ['加一筆帳', `/trip/${ids.tid}/expenses`, () => document.getElementById('topActionBtn')?.click()],
    ['音樂授權', `/trip/${ids.tid}/album`, () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('音樂來源與授權'))?.click()],
  ];
  let modalN = 0;
  const notOpened = [];
  for (const [label, route, open] of MODALS) {
    await page.goto('about:blank');
    await page.goto(`http://localhost:${WEB}/#${route}`, { waitUntil: 'networkidle0' }).catch(() => {});
    await page.evaluate(() => { document.documentElement.dataset.fs = 'xl'; });
    await page.waitForSelector('.page', { timeout: 15000 }).catch(() => {});
    await sleep(900);
    await page.evaluate(open).catch(() => {});
    const shown = await page.waitForSelector('.modal-card', { timeout: 6000 }).then(() => true).catch(() => false);
    // 「打不開就略過」＝ 掃描器可以無聲地縮水成 0 個對話框還說通過。
    // 開不起來要當失敗：不是選擇器過期了，就是那個入口真的壞了，兩種都要知道。
    if (!shown) { console.log(`  ✗ ${label}：對話框打不開（選擇器過期或入口壞了）`); notOpened.push(label); continue; }
    await sleep(400);
    modalN++;
    const list = await page.evaluate(`(() => {
      const out = [];
      const card = document.querySelector('.modal-card');
      const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size || 1; };
      if (card.scrollWidth > card.clientWidth + 1) out.push({ kind: 'modal-overflow-x', where: '.modal-card', detail: card.scrollWidth + ' > ' + card.clientWidth });
      for (const b of card.querySelectorAll('.modal-actions .btn, .numpad-row .btn')) {
        const t = (b.textContent || '').trim();
        if (t && lines(b) > 1) out.push({ kind: 'modal-btn-wrap', where: '.' + b.className.split(' ')[1], detail: '「' + t + '」折成 ' + lines(b) + ' 行' });
        const r = b.getBoundingClientRect();
        if (r.height && r.height < 44) out.push({ kind: 'modal-touch-small', where: t, detail: Math.round(r.height) + 'px' });
      }
      const vw = document.documentElement.clientWidth;
      for (const el of card.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1)) { out.push({ kind: 'modal-overflow-el', where: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0], detail: Math.round(r.left) + '～' + Math.round(r.right) + ' vs ' + vw }); break; }
      }
      return out;
    })()`);
    record(`${label}/320px/xl`, list);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `modal-${label}-320-xl.png`) });
    console.log(`  ${label}：${list.length ? '✗ ' + list.length + ' 個問題' : '✓'}`);
    await page.evaluate(() => document.querySelector('.modal-actions .btn')?.click()).catch(() => {});
    await sleep(250);
  }
  yes(!notOpened.length && modalN === MODALS.length,
    `${MODALS.length} 個對話框全部打得開並掃過`,
    notOpened.length ? '打不開：' + notOpened.join('、') : '');

  // ---------- 結果 ----------
  console.log(`\n— 掃描結果：${combos} 種頁面組合 + ${modalN} 個對話框 —`);
  const byKind = {};
  for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  // 報告檔**永遠**寫。以前只在有問題時寫，全綠時磁碟上留著的是上一次的舊報告 ——
  // 看到那個檔案的人會以為問題還在。
  const head = `TripQuest 版面掃描 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`
    + `${combos} 種頁面組合（${ROUTES.length} 頁 × ${FONTS.length} 字級 × ${WIDTHS.length} 寬度）+ ${modalN} 個對話框\n`
    + `發現 ${problems.length} 個問題\n${'-'.repeat(60)}\n`;
  const lines2 = problems.map((p) => `[${p.kind}] ${p.where}\n    ${p.detail}\n    出現在：${p.combos.join('、')}`);
  try {
    fs.writeFileSync(path.join(ROOT, 'screenshots', '_layout-report.txt'),
      head + (lines2.join('\n\n') || '（零問題）\n'), 'utf8');
  } catch { /* noop */ }
  if (problems.length) {
    for (const p of problems) {
      console.log(`  ✗ [${p.kind}] ${p.where}`);
      console.log(`      ${p.detail}`);
      console.log(`      出現在：${p.combos.join('、')}${p.combos.length >= 6 ? ' …' : ''}`);
    }
    console.log('\n  分類統計：' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join('、'));
  }
  yes(!problems.length, `零版面問題（掃了 ${combos} 種組合 + ${modalN} 個對話框）`,
    `${problems.length} 個問題，見上面`);
} catch (e) {
  console.log('✗ 例外：' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill(); osrmSrv.close(); opSrv.close();
}
console.log(`\n版面掃描結束\n\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
