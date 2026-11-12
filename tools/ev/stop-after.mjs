// 分段用：等 .logs/ev/run-all.txt 出現「==== <驅動> 結束」那一行，就把 run-all.sh 那棵程序樹停掉（2026-10-02）。
// 停在兩支驅動之間：下一支剛開始、還沒套任何補丁，或剛套了第一份——下一支的殘留外殼紀錄由 progress.mjs 判成「沒跑完」，不算數。
// 認 run-all.sh 的程序：tools/ev/find-runall.mjs（只認拿 run-all.sh 當腳本在跑的 bash、排除自己的上層鏈；2026-11-12 修——
//   之前「命令列含 run-all.sh 的 bash」會把呼叫者自己的 shell 認進去、整棵殺掉，見那支檔頭）；
//   殺用 run-timeout.mjs 的 killTree（認子孫看建立時間、只殺可殺清單、root 先殺）。
// ⚠ 2026-11-12：run-all.sh 已被 tools/ev/run-segment.sh 取代（要停就放 .logs/ev/STOP、不殺程序），這支只對本機舊的 .logs/ev/run-all.sh 有用。
//   node tools/ev/stop-after.mjs six_mut
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { killTree } = await import(pathToFileURL(path.join(REPO, 'scripts', 'run-timeout.mjs')).href);
const { findRunAll } = await import(pathToFileURL(path.join(REPO, 'tools', 'ev', 'find-runall.mjs')).href);
const driver = process.argv[2];
const LOG = path.join(REPO, '.logs', 'ev', 'run-all.txt');
const mark = `==== ${driver} 結束`;
const t0 = Date.now();
while (!(fs.existsSync(LOG) && fs.readFileSync(LOG, 'utf8').includes(mark))) {
  if (Date.now() - t0 > 6 * 3600 * 1000) { console.log('等了 6 小時還沒等到，放棄'); process.exit(2); }
  await new Promise((r) => setTimeout(r, 3000));
}
let found;
try { found = findRunAll(); } catch (e) { console.log(`認不出 run-all.sh 的程序（${String(e.message).split('\n')[0]}）——不殺任何東西`); process.exit(2); }
const pids = found.targets;
console.log(`${new Date().toISOString()} 看到「${mark}」；run-all.sh 的程序：${pids.join('、') || '（沒有）'}（略過：自己的上層 ${found.skippedSelf.join('、') || '無'}；只是字串提到、沒在跑它的 ${found.skippedNotScript.join('、') || '無'}）`);
for (const pid of pids) { const r = killTree(pid); console.log(`停掉 ${pid}：殺了 ${r.killed.join('、')}${r.skipped && r.skipped.length ? `、略過（不在可殺清單）${r.skipped.join('、')}` : ''}`); }
fs.appendFileSync(LOG, `==== 分段：在「${mark}」之後停下（${new Date().toISOString()}）\n`);
