// 分段用：在兩個情境之間停（2026-10-02）。等 .logs/ev 裡「有 exit= 的外殼紀錄」達到指定份數，就停掉 run-all.sh 那棵程序樹。
// 停的時候下一個情境可能剛開頭——progress.mjs 會把它標成「開了頭沒跑完」，不算數、下一段重跑。
// 認程序與殺：命令列含 run-all.sh 的 bash；run-timeout.mjs 的 killTree（建立時間＋可殺清單、root 先殺）。
//   node tools/ev/stop-at-boundary.mjs <跑完的份數>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { killTree } = await import(pathToFileURL(path.join(REPO, 'scripts', 'run-timeout.mjs')).href);
const EV = path.join(REPO, '.logs', 'ev');
const want = Number(process.argv[2]);
if (!(want > 0)) { console.log('用法：node tools/ev/stop-at-boundary.mjs <跑完的份數>'); process.exit(2); }
const done = () => fs.readdirSync(EV).filter((f) => /^ev2-.+\.shell$/.test(f) && /exit=\d+/.test(fs.readFileSync(path.join(EV, f), 'utf8'))).length;
const t0 = Date.now();
while (done() < want) {
  if (Date.now() - t0 > 3 * 3600 * 1000) { console.log('等了 3 小時還沒等到，放棄'); process.exit(2); }
  await new Promise((r) => setTimeout(r, 2000));
}
const ps = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command',
  "Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { $_.CommandLine -like '*run-all.sh*' } | Select-Object ProcessId | ConvertTo-Json -Compress"], { encoding: 'utf8' }) || 'null');
const pids = (Array.isArray(ps) ? ps : ps ? [ps] : []).map((p) => p.ProcessId);
console.log(`${new Date().toISOString()} 跑完 ${done()} 份；run-all.sh 的程序：${pids.join('、') || '（沒有）'}`);
for (const pid of pids) { const r = killTree(pid); console.log(`停掉 ${pid}：殺了 ${r.killed.join('、')}${r.skipped && r.skipped.length ? `；略過（不在可殺清單）${r.skipped.join('、')}` : ''}`); }
fs.appendFileSync(path.join(EV, 'run-all.txt'), `==== 分段：跑完 ${want} 份之後停下（${new Date().toISOString()}）\n`);
