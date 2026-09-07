// 回顧卡排版：不重疊、不出界、資料多也放得下（npm run recapcardtest）
//
// 使用者附圖回報三個跑版：開場文字壓到 📷、「次互動」上有重疊、13 個徽章超出
// 右邊被切掉。舊版每一塊的 y 都寫死，內容一多就疊在一起。現在改成流式排版，
// renderRecapCard 回傳每一塊的框 —— 這支自動驗「由上往下、不重疊、不出界」，
// 並把幾種資料量的實際產出存成 PNG 給人眼複查。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('../screenshots/_recapcard/', import.meta.url);
await mkdir(OUT, { recursive: true });
const WEB = 5491;
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, x) => { console.error('✗ ' + m + (x ? '\n   ' + x : '')); process.exitCode = 1; };
const yes = (c, m, x) => (c ? ok(m) : fail(m, x));

const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); process.exitCode = 1; });

try {
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');

  // renderRecapCard 是純函式（r, ai, 調色盤 → canvas + 每一塊的框），
  // 可以直接餵極端資料，不用先種一整趟旅程。
  const SCEN = {
    '使用者回報的情境': {
      r: {
        title: '宜蘭三日遊', dateRange: '2026-08-01 – 2026-08-03', dayCount: 3, people: 4,
        photoCount: 41, spotCount: 8, doneCount: 21, questTotal: 24, distanceKm: 63.2, interactions: 32,
        foods: ['三星蔥油餅', '卜肉', '金丹早餐', '火山爆發雞', '花生捲冰淇淋', '西魯肉'].map((t) => ({ title: t })),
        tripBadges: [['📷', '第一張照片'], ['🍜', '大胃王'], ['🏃', '健走達人'], ['🌅', '早起的鳥'], ['❤️', '人氣王'],
          ['🤝', '最佳助攻'], ['🗺️', '探路先鋒'], ['🌧️', '風雨無阻'], ['👨‍👩‍👧', '全員到齊'], ['🎯', '全數達成'],
          ['💬', '話匣子'], ['📅', '全勤獎'], ['⭐', '滿分旅伴']].map(([e, n]) => ({ emoji: e, name: n })),
      },
      ai: {
        opening: '三天的宜蘭，從羅東夜市的熱鬧走到太平山的霧氣，四個人把每一個角落都拍成了回憶，連下雨的那個下午都變得可愛。',
        closing: '下次見面，記得帶著這些照片一起說故事。',
      },
    },
    '資料很多': {
      r: {
        title: '我們家二十週年紀念的環島大旅行（第一段：宜蘭花蓮台東）', dateRange: '2026-07-20 – 2026-07-29',
        dayCount: 10, people: 9,
        photoCount: 412, spotCount: 36, doneCount: 118, questTotal: 126, distanceKm: 512.8, interactions: 1234,
        foods: ['三星蔥油餅', '卜肉', '金丹早餐（原力行早餐）', '火山爆發雞礁溪總店', '花生捲冰淇淋', '西魯肉',
          '公正包子', '炸醬麵', '曾記麻糬', '炸彈蔥油餅', '海埔蚵仔煎', '池上便當', '初鹿鮮奶', '藍蜻蜓炸雞'].map((t) => ({ title: t })),
        tripBadges: Array.from({ length: 20 }, (_, i) => ({ emoji: ['🏅', '📷', '🍜', '🏃', '🌅'][i % 5], name: `很長的徽章名稱${i + 1}號` })),
      },
      ai: {
        opening: '十天、九個人、三十六個地方——這一趟我們把半個台灣走成了自己家的後院，孩子們學會了看火車時刻表，長輩們學會了自拍，每一天結束時大家都在比誰拍的照片多。這是一段會被講很多年的旅程。',
        closing: '環島的下半段，我們明年繼續。到時候還是這九個人，一個都不能少。',
      },
    },
    '最小資料': {
      r: {
        title: '週末走走', dateRange: '', dayCount: 1, people: 1,
        photoCount: 2, spotCount: 1, doneCount: 1, questTotal: 3, distanceKm: 0, interactions: 0,
        foods: [], tripBadges: [],
      },
      ai: null,
    },
  };

  for (const [name, sc] of Object.entries(SCEN)) {
    console.log(`\n— ${name} —`);
    const res = await page.evaluate(async (scen) => {
      const { renderRecapCard } = await import('./js/views/recap.js');
      const { loadThemes, themeForTrip, themeMeta } = await import('./js/theme.js');
      await loadThemes().catch(() => {});
      const p = themeMeta(themeForTrip([])).poster;
      const { canvas, boxes, W, H } = renderRecapCard(scen.r, scen.ai, p);
      return { png: canvas.toDataURL('image/png'), boxes, W, H };
    }, sc);

    // ① 由上往下、不重疊
    let overlap = null;
    for (let i = 1; i < res.boxes.length; i++) {
      if (res.boxes[i].y0 < res.boxes[i - 1].y1 - 1) { overlap = `${res.boxes[i - 1].name} 與 ${res.boxes[i].name}`; break; }
    }
    yes(!overlap, `區塊由上往下、互不重疊（${res.boxes.length} 塊）`, overlap);
    // ② 不出界
    const outOf = res.boxes.find((b) => b.y0 < 0 || b.y1 > res.H);
    yes(!outOf, `所有區塊都在畫布內（H=${res.H}px）`, outOf && `${outOf.name} y1=${outOf.y1} > ${res.H}`);
    // ③ 底部留白
    const last = res.boxes[res.boxes.length - 1];
    yes(res.H - last.y1 >= 60, `底部留白足夠（${res.H - last.y1}px）`);
    // ④ 使用者回報的三個點位
    const by = (n) => res.boxes.find((b) => b.name === n);
    if (sc.ai?.opening) {
      yes(by('opening').y1 <= by('nums-row0').y0, `開場文字（到 ${by('opening').y1}px）不會壓到大數字（從 ${by('nums-row0').y0}px 起）`);
    }
    if (sc.r.tripBadges.length) {
      yes(!!by('badges'), `徽章 ${sc.r.tripBadges.length} 個全數排進卡片（佔 ${by('badges').y1 - by('badges').y0}px，放不下會換行不會被切）`);
    }

    const file = fileURLToPath(new URL(`${name}.png`, OUT));
    await writeFile(file, Buffer.from(res.png.split(',')[1], 'base64'));
    console.log('  📸 ' + file.split(/[\\/]/).pop() + `（${res.W}×${res.H}）`);
  }

  console.log('\n回顧卡測試結束');
} catch (e) {
  fail('例外：' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
