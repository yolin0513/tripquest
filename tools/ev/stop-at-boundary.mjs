// 分段用：在兩個情境之間停（2026-10-02）。等 .logs/ev 裡「有 exit= 的外殼紀錄」達到指定份數，就停掉 run-all.sh 那棵程序樹。
// 停的時候下一個情境可能剛開頭——progress.mjs 會把它標成「開了頭沒跑完」，不算數、下一段重跑。
// 認程序：tools/ev/find-runall.mjs（只認拿 run-all.sh 當腳本在跑的 bash、排除自己的上層鏈；2026-11-12 修——
//   之前「命令列含 run-all.sh 的 bash」會把呼叫者自己的 shell 認進去、整棵殺掉，見那支檔頭）；
//   殺：run-timeout.mjs 的 killTree（建立時間＋可殺清單、root 先殺）。
// ⚠ 2026-11-12：run-all.sh 已被 tools/ev/run-segment.sh 取代（要停就放 .logs/ev/STOP、不殺程序），這支只對本機舊的 .logs/ev/run-all.sh 有用。
//   node tools/ev/stop-at-boundary.mjs <跑完的份數>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { killTree } = await import(pathToFileURL(path.join(REPO, 'scripts', 'run-timeout.mjs')).href);
const { findRunAll } = await import(pathToFileURL(path.join(REPO, 'tools', 'ev', 'find-runall.mjs')).href);
const EV = path.join(REPO, '.logs', 'ev');
const want = Number(process.argv[2]);
if (!(want > 0)) { console.log('用法：node tools/ev/stop-at-boundary.mjs <跑完的份數>'); process.exit(2); }
const done = () => fs.readdirSync(EV).filter((f) => /^ev2-.+\.shell$/.test(f) && /exit=\d+/.test(fs.readFileSync(path.join(EV, f), 'utf8'))).length;
const t0 = Date.now();
while (done() < want) {
  if (Date.now() - t0 > 3 * 3600 * 1000) { console.log('等了 3 小時還沒等到，放棄'); process.exit(2); }
  await new Promise((r) => setTimeout(r, 2000));
}
let found;
try { found = findRunAll(); } catch (e) { console.log(`認不出 run-all.sh 的程序（${String(e.message).split('\n')[0]}）——不殺任何東西`); process.exit(2); }
const pids = found.targets;
console.log(`${new Date().toISOString()} 跑完 ${done()} 份；run-all.sh 的程序：${pids.join('、') || '（沒有）'}（略過：自己的上層 ${found.skippedSelf.join('、') || '無'}；只是字串提到、沒在跑它的 ${found.skippedNotScript.join('、') || '無'}）`);
for (const pid of pids) { const r = killTree(pid); console.log(`停掉 ${pid}：殺了 ${r.killed.join('、')}${r.skipped && r.skipped.length ? `；略過（不在可殺清單）${r.skipped.join('、')}` : ''}`); }
fs.appendFileSync(path.join(EV, 'run-all.txt'), `==== 分段：跑完 ${want} 份之後停下（${new Date().toISOString()}）\n`);
