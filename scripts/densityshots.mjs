// 任務列密度的前後對照截圖（node scripts/densityshots.mjs）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../screenshots/_density', import.meta.url));
const WEB = 5342;
await mkdir(OUT, { recursive: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
await sleep(1400);
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
let n = 0;
const shot = async (name) => { await sleep(350);
  const f = `${OUT}/v1.41-${String(++n).padStart(2, '0')}-${name}.png`;
  await pg.screenshot({ path: f }); console.log('✓ ' + f.split(/[\/]/).pop()); };
await pg.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
await pg.waitForSelector('.hero');
const tid = await pg.evaluate(async () => {
  const s = await import('./js/store.js'); const { uuid } = await import('./js/ids.js');
  const { generateForTrip } = await import('./js/quests/generate.js');
  const { importPhoto } = await import('./js/photos.js');
  const gid = uuid(), tid = uuid(), me = uuid();
  await s.put({ id: gid, type: 'group', name: 'g' });
  await s.put({ id: me, type: 'member', groupId: gid, displayName: '阿公' });
  await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭遊', region: '宜蘭', allowWiki: true });
  const { spots, quests } = await generateForTrip({ tripId: tid, region: '宜蘭',
    items: [{ name: '羅東夜市', day: 1 }, { name: '太平山', day: 1 }, { name: '礁溪溫泉', day: 1 }] });
  for (const x of spots) await s.put(x); for (const x of quests) await s.put(x);
  const mk = (hue) => { const c = document.createElement('canvas'); c.width = 600; c.height = 450;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 600, 450);
    g.addColorStop(0, `hsl(${hue},60%,52%)`); g.addColorStop(1, `hsl(${hue + 40},55%,32%)`);
    x.fillStyle = g; x.fillRect(0, 0, 600, 450); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); };
  const qs = s.questsOf(spots[0].id);
  for (let i = 0; i < 2; i++) {
    const blob = await mk(20 + i * 90);
    await importPhoto(new File([blob], 'a.jpg', { type: 'image/jpeg' }), { tripId: tid, questId: qs[i].id, memberId: me });
  }
  return tid;
});
await pg.goto(`http://localhost:${WEB}/#/trip/${tid}`, { waitUntil: 'networkidle0' });
await pg.waitForSelector('.qline', { timeout: 20000 });
await pg.evaluate(() => document.querySelectorAll('.qcollapse').forEach((d) => d.classList.add('open')));
await sleep(7000);   // 等示意圖抓回來
const toSpots = () => pg.evaluate(() => { const s = document.querySelector('.qcollapse'); if (s) s.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
await toSpots();
await shot('collapsed');
await pg.evaluate(() => document.querySelectorAll('.qline:not(.done) .qline-head')[0].click());
await sleep(900);
await shot('expanded');
await pg.evaluate(() => document.querySelectorAll('.qline.open .qline-head').forEach((e) => e.click()));
await sleep(400);
await pg.evaluate(async () => { (await import('./js/prefs.js')).setPref('fs', 'xl'); });
await sleep(500); await toSpots();
await shot('xl');
await pg.evaluate(async () => { const p = await import('./js/prefs.js'); p.setPref('fs', 'm'); p.setPref('contrast', 'high'); });
await sleep(500); await toSpots();
await shot('contrast');
await b.close(); web.kill();
console.log(`\n共 ${n} 張`);
