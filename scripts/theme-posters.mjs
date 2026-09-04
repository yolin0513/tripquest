// 產生不同主題的行程海報對照圖（自然 / 美食 / 古蹟 / 夜市…）。
// 輸出到 screenshots/themes/。用法：node scripts/theme-posters.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('../screenshots/themes/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const TRIPS = [
  { key: 'nature', title: '花蓮山林兩日', region: '花蓮',
    itin: '第1天 太魯閣國家公園、白楊步道、翠峰湖\n第2天 合歡山主峰步道、清境農場' },
  { key: 'food', title: '台南美食馬拉松', region: '台南',
    itin: '第1天 國華街、度小月擔仔麵、阿明豬心冬粉\n第2天 阿堂鹹粥、莉莉水果店、周氏蝦捲' },
  { key: 'heritage', title: '府城古蹟慢走', region: '台南',
    itin: '第1天 赤崁樓、祀典武廟、孔廟\n第2天 安平古堡、億載金城、延平郡王祠' },
  { key: 'nightmarket', title: '台北夜市巡禮', region: '台北',
    itin: '第1天 士林夜市、寧夏夜市\n第2天 饒河街觀光夜市、臨江街夜市' },
  { key: 'coast', title: '東北角海岸線', region: '新北',
    itin: '第1天 鼻頭角步道、南雅奇岩、龍洞灣\n第2天 象鼻岩、深澳漁港、水湳洞' },
];

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore',
});
await sleep(1200);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('.hero');

for (const t of TRIPS) {
  const tripId = await page.evaluate(async (t) => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: t.title + ' 旅伴' });
    for (const n of ['我', '家人']) await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: n });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: t.title, startDate: '2026-05-01', endDate: '2026-05-02', region: t.region, allowGeo: false, allowWiki: false });
    const { spots, quests } = await generateForTrip({ tripId: tid, region: t.region, itineraryText: t.itin });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    return tid;
  }, t);

  // 灌合成照片（每個景點第一個任務一張）
  await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const { importPhoto } = await import('./js/photos.js');
    const members = s.membersOf(s.get(tid).groupId).map((m) => m.id);
    const quests = s.questsOfTrip(tid);
    const bySpot = new Map();
    for (const q of quests) if (!bySpot.has(q.spotId)) bySpot.set(q.spotId, q);
    let i = 0;
    for (const q of bySpot.values()) {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 1200, 900);
      g.addColorStop(0, `hsl(${(i * 47) % 360},55%,52%)`); g.addColorStop(1, `hsl(${(i * 47 + 40) % 360},48%,34%)`);
      x.fillStyle = g; x.fillRect(0, 0, 1200, 900);
      x.fillStyle = 'rgba(255,255,255,.9)'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center';
      x.fillText('示範照片', 600, 470);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      await importPhoto(new File([blob], `p${i}.jpg`, { type: 'image/jpeg' }), { tripId: tid, questId: q.id, memberId: members[i % members.length], allowGeo: false });
      i++;
    }
  }, tripId);

  // 給每天前幾個景點時間，讓時間軸有時間標籤（依當天順序）
  await page.evaluate(async (tid) => {
    const s = await import('./js/store.js');
    const tt = [['09:00', '11:30'], ['12:30', '14:00'], ['15:00', '']];
    const byDay = new Map();
    for (const sp of s.spotsOf(tid)) { const d = sp.day || 1; (byDay.get(d) || byDay.set(d, []).get(d)).push(sp); }
    for (const list of byDay.values()) for (let i = 0; i < list.length && i < tt.length; i++) {
      await s.patch(list[i].id, { startTime: tt[i][0], endTime: tt[i][1] });
    }
  }, tripId);

  const res = await page.evaluate(async (tid) => {
    const P = await import('./js/poster/index.js');
    const T = await import('./js/theme.js');
    await T.loadThemes();
    const model = P.buildModel(tid);
    const out = await P.renderPoster(tid, { presetId: 'watercolor' });
    const toDataUrl = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    return { tripTheme: model.tripTheme, dayThemes: model.days.map((d) => d.theme), img: await toDataUrl(out[0].blob), n: out.length };
  }, tripId);

  writeFileSync(join(OUT, `${t.key}.jpg`), Buffer.from(res.img.split(',')[1], 'base64'));
  console.log(`  ✓ ${t.key}.jpg  tripTheme=${res.tripTheme}  days=[${res.dayThemes}]  (${res.n} 張)`);
}

await browser.close();
server.kill();
console.log('\n完成，輸出於 screenshots/themes/');
