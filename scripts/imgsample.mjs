// 抽樣檢視「實際會出現在畫面上的圖」（npm run imgsample）
//
// 命中率數字會騙人：抓到一張剪貼畫也算命中。這支把真正存進 IndexedDB、
// 真正會畫到任務卡上的圖，拼成一張總覽圖直接用眼睛看。
// 用 --set=tw 只跑台灣（夜市與小吃）。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = 5212;
const SET = (process.argv.find((a) => a.startsWith('--set=')) || '').split('=')[1] || 'tw';

const SETS = {
  tw: {
    spots: ['羅東觀光夜市', '羅東夜市', '士林夜市', '逢甲夜市', '六合夜市', '饒河街觀光夜市',
      '九份老街', '象山步道', '高美濕地', '安平古堡', '猴硐貓村', '忘憂森林'],
    dishes: ['包心粉圓', '阿灶伯羊肉湯', '當歸羊肉湯', '義豐蔥油派', '龍鳳腿', '牛肉麵',
      '蚵仔煎', '大腸包小腸', '胡椒餅', '珍珠奶茶', '滷肉飯', '鹽酥雞'],
  },
  jp: {
    spots: ['清水寺', '金閣寺', '伏見稻荷大社', '嵐山竹林', '道頓堀', '淺草寺'],
    dishes: ['章魚燒', '大阪燒', '拉麵', '壽司', '抹茶聖代', '鯛魚燒'],
  },
};
const S = SETS[SET] || SETS.tw;

const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

try {
  console.log(`抽樣：${S.spots.length} 個景點、${S.dishes.length} 道小吃\n`);

  const rows = await page.evaluate(async ({ spots, dishes }) => {
    const s = await import('./js/store.js');
    const db = await import('./js/db.js');
    const { uuid } = await import('./js/ids.js');
    const { enrichSpot, dishImage } = await import('./js/enrich.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'sample' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: 'sample', allowWiki: true });

    const out = [];
    for (const name of spots) {
      const sid = uuid();
      await s.put({ id: sid, type: 'spot', tripId: tid, name, nameLocal: name, day: 1, order: 0, lat: null, lng: null, wikiRef: null });
      await s.put({ id: uuid(), type: 'quest', tripId: tid, spotId: sid, title: name + '任務', kind: 'thing', order: 0 });
      await enrichSpot(s.getRaw(sid));
      const sp = s.getRaw(sid);
      const rec = sp.heroHash ? await db.getBlob(sp.heroHash) : null;
      out.push({
        kind: '景點', label: name, src: sp.heroSource || '—',
        author: (sp.heroAttr && sp.heroAttr.author) || '',
        mime: rec ? rec.blob.type : '', kb: rec ? Math.round(rec.blob.size / 1024) : 0,
        hash: sp.heroHash || null, pool: (sp.heroPool || []).length,
      });
    }
    for (const d of dishes) {
      const got = await dishImage(d).catch(() => null);
      const rec = got ? await db.getBlob(got.hash) : null;
      out.push({
        kind: '小吃', label: d, src: got ? got.source : '—',
        author: (got && got.attr && got.attr.author) || '',
        mime: rec ? rec.blob.type : '', kb: rec ? Math.round(rec.blob.size / 1024) : 0,
        hash: got ? got.hash : null, pool: 0,
      });
    }
    return out;
  }, S);

  for (const r of rows) {
    const mark = r.hash ? '✓' : '·';
    console.log(`${mark} ${r.kind} ${r.label.padEnd(12)} ${(r.src || '').padEnd(16)} ${String(r.kb).padStart(4)}KB ${r.mime.replace('image/', '').padEnd(5)} ${r.pool ? '+' + r.pool + '備用 ' : '       '}${r.author.slice(0, 22)}`);
  }
  const hit = rows.filter((r) => r.hash).length;
  console.log(`\n命中 ${hit}/${rows.length}（${(100 * hit / rows.length).toFixed(0)}%）`);

  // 把真正的圖拼成一張總覽（要用眼睛看的，不是看數字）
  const png = await page.evaluate(async (items) => {
    const db = await import('./js/db.js');
    const COL = 4, W = 260, H = 200, PAD = 8, LBL = 34;
    const rowsN = Math.ceil(items.length / COL);
    const c = document.createElement('canvas');
    c.width = COL * (W + PAD) + PAD;
    c.height = rowsN * (H + LBL + PAD) + PAD;
    const x = c.getContext('2d');
    x.fillStyle = '#101828'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const cx = PAD + (i % COL) * (W + PAD);
      const cy = PAD + Math.floor(i / COL) * (H + LBL + PAD);
      x.fillStyle = '#1a2740'; x.fillRect(cx, cy, W, H);
      if (it.hash) {
        const rec = await db.getBlob(it.hash);
        if (rec) {
          const url = URL.createObjectURL(rec.blob);
          const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
          if (img) {
            const sc = Math.max(W / img.width, H / img.height);
            const dw = img.width * sc, dh = img.height * sc;
            x.save(); x.beginPath(); x.rect(cx, cy, W, H); x.clip();
            x.drawImage(img, cx + (W - dw) / 2, cy + (H - dh) / 2, dw, dh);
            x.restore();
          }
          URL.revokeObjectURL(url);
        }
      } else {
        x.fillStyle = '#66788f'; x.font = '15px sans-serif'; x.textAlign = 'center';
        x.fillText('（沒有圖 → 用主題色塊）', cx + W / 2, cy + H / 2);
        x.textAlign = 'left';
      }
      x.fillStyle = '#e8eefc'; x.font = 'bold 15px "Noto Sans TC", sans-serif';
      x.fillText(`${it.kind}｜${it.label}`.slice(0, 22), cx + 2, cy + H + 16);
      x.fillStyle = '#8fa3c4'; x.font = '12px sans-serif';
      x.fillText(`${it.src} ${it.kb ? it.kb + 'KB' : ''}`.slice(0, 34), cx + 2, cy + H + 30);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, rows);

  await mkdir(path.join(ROOT, 'screenshots/features'), { recursive: true });
  const file = path.join(ROOT, `screenshots/features/img-sample-${SET}.png`);
  await writeFile(file, Buffer.from(png, 'base64'));
  console.log('總覽圖：' + path.relative(ROOT, file));
} catch (e) {
  console.error('✗', e && e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
  web.kill();
}
