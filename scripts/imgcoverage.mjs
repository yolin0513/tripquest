// 任務示意圖涵蓋率量測（npm run imgcoverage）
//
// 跑真的 enrich 流程（在瀏覽器裡、真的打 Wikimedia），統計：
//   - 策展地點（data/places/*.json）有多少比例抓得到圖
//   - 自由輸入的景點名（沒有 wiki 參照、沒有座標）有多少比例抓得到
//   - 美食任務有多少比例抓得到該道菜的照片
//   - 各來源命中比例
// 加 --sample=N 只跑前 N 個（快速檢查用）。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5201;
const sampleArg = (process.argv.find((a) => a.startsWith('--sample=')) || '').split('=')[1];
const SAMPLE = sampleArg ? +sampleArg : 0;

// 自由輸入的景點：使用者自己打的名字，沒有策展資料可用（最容易沒圖的一群）
const FREE_TYPED = [
  '清水寺 本堂', '奈良公園的鹿', '築地場外市場', '首爾塔', '江之島',
  '合掌村', '兼六園', '青池', '美瑛四季彩之丘', '道後溫泉本館',
  '九份老街', '象山步道', '高美濕地', '池上伯朗大道', '安平古堡',
  '猴硐貓村', '擎天崗', '忘憂森林', '外澳沙灘', '鹿港天后宮',
];

const places = [];
const foods = new Set();
for (const f of (await readdir(path.join(ROOT, 'data/places'))).filter((x) => /^[a-z]{2}-/.test(x))) {
  const d = JSON.parse(await readFile(path.join(ROOT, 'data/places', f), 'utf8'));
  for (const p of d.places || []) {
    places.push({ name: p.name, lat: p.lat, lng: p.lng, wiki: p.wiki, tags: p.tags, primary: p.primary, region: d.region || d.city || '' });
    for (const m of p.must || []) foods.add(m);
    for (const q of p.quests || []) if (q.type === 'food') foods.add(q.title);
  }
}
const foodList = [...foods];

const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

await page.evaluate(async () => {
  const s = await import('./js/store.js');
  const { uuid } = await import('./js/ids.js');
  window.__gid = uuid(); window.__tid = uuid();
  await s.put({ id: window.__gid, type: 'group', name: 'cov' });
  await s.put({ id: window.__tid, type: 'trip', groupId: window.__gid, title: 'cov', allowWiki: true });
});

async function runSpots(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 10) {
    const chunk = list.slice(i, i + 10);
    const r = await page.evaluate(async (items) => {
      const s = await import('./js/store.js');
      const { enrichSpot } = await import('./js/enrich.js');
      const { uuid } = await import('./js/ids.js');
      const res = [];
      for (const p of items) {
        const sid = uuid();
        await s.put({
          id: sid, type: 'spot', tripId: window.__tid, name: p.name, nameLocal: p.name,
          lat: p.lat ?? null, lng: p.lng ?? null, wikiRef: p.wiki || null,
          tags: p.tags || [], primary: p.primary || null, region: p.region || '', day: 1, order: 0,
        });
        await enrichSpot(s.getRaw(sid));
        const sp = s.getRaw(sid);
        res.push({ name: p.name, hit: !!sp.heroHash, src: sp.heroSource || null });
      }
      return res;
    }, chunk);
    out.push(...r);
    process.stdout.write(`\r  ${out.length}/${list.length}   `);
  }
  process.stdout.write('\r');
  return out;
}

async function runFoods(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 10) {
    const chunk = list.slice(i, i + 10);
    const r = await page.evaluate(async (items) => {
      const res = [];
      let dish = null;
      try { dish = (await import('./js/enrich.js')).dishImage; } catch { /* 舊版沒有 */ }
      for (const name of items) {
        if (!dish) { res.push({ name, hit: false, src: null }); continue; }
        const got = await dish(name);
        res.push({ name, hit: !!(got && got.hash), src: got && got.source });
      }
      return res;
    }, chunk);
    out.push(...r);
    process.stdout.write(`\r  ${out.length}/${list.length}   `);
  }
  process.stdout.write('\r');
  return out;
}

function report(label, rows) {
  const hit = rows.filter((r) => r.hit).length;
  const pct = rows.length ? (100 * hit / rows.length).toFixed(1) : '0.0';
  console.log(`\n${label}：${hit}/${rows.length} 有圖（${pct}%）`);
  const bySrc = {};
  for (const r of rows) if (r.hit) bySrc[r.src || '?'] = (bySrc[r.src || '?'] || 0) + 1;
  for (const [k, n] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(18)} ${String(n).padStart(3)}  ${(100 * n / rows.length).toFixed(1)}%`);
  }
  const miss = rows.filter((r) => !r.hit).map((r) => r.name);
  if (miss.length) console.log('   沒抓到：' + miss.slice(0, 24).join('、') + (miss.length > 24 ? ` …等 ${miss.length} 個` : ''));
  return { hit, total: rows.length, pct: +pct };
}

try {
  const P = SAMPLE ? places.slice(0, SAMPLE) : places;
  const F = SAMPLE ? FREE_TYPED.slice(0, Math.min(SAMPLE, FREE_TYPED.length)) : FREE_TYPED;
  const D = SAMPLE ? foodList.slice(0, SAMPLE) : foodList;

  console.log(`策展地點 ${P.length}、自由輸入 ${F.length}、美食 ${D.length}\n`);
  const a = report('策展地點', await runSpots(P));
  const b = report('自由輸入的景點', await runSpots(F.map((name) => ({ name }))));
  const c = report('美食任務', await runFoods(D));

  const all = a.hit + b.hit + c.hit, tot = a.total + b.total + c.total;
  console.log(`\n===== 合計 ${all}/${tot}（${(100 * all / tot).toFixed(1)}%）=====`);
} catch (e) {
  console.error('✗', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
