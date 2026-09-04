#!/usr/bin/env node
// TripQuest —— Cloudflare 一鍵部署（跨平台 Node 版，不需要 WSL）
//
//   cd D:\Claude\App\TripQuest
//   node scripts/publish-cloud.mjs
//
// 過程中會開一次瀏覽器，請按「Allow」授權 wrangler。其餘全自動：
//   1. wrangler 登入（已登入就略過）
//   2. 建立 D1 資料庫 tripquest（已存在就沿用）
//   3. 把 database_id 寫進 workers/wrangler.toml
//   4. 用 schema.sql 建資料表
//   5. 建立 R2 bucket tripquest-photos（已存在就沿用）
//   6. 部署 Worker，印出 workers.dev 網址
//
// 前提：已註冊 Cloudflare、已在後台啟用 R2（第一次要綁卡，免費額度內不扣款）。
//
// 選項：
//   --skip-frontend   只部署 Worker，不動 js/sync.js
//   --url <url>       跳過部署，直接把現有 Worker 網址寫進前端

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROOT, 'workers', 'wrangler.toml');
const SCHEMA = join(ROOT, 'workers', 'schema.sql');
const SYNC_JS = join(ROOT, 'js', 'sync.js');
const DB_NAME = 'tripquest';
const BUCKET = 'tripquest-photos';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : ''; };

const isWin = process.platform === 'win32';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function wr(wrArgs, { capture = true, allowFail = false } = {}) {
  // 用 npx 呼叫本地 wrangler；Windows 要 shell 才能解析 npx.cmd
  const res = spawnSync('npx', ['--yes', 'wrangler', ...wrArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: isWin,
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  const out = ((res.stdout || '') + (res.stderr || '')).trim();
  if (capture && out) console.log(out);
  if (res.status !== 0 && !allowFail) {
    console.error(`\n!! wrangler ${wrArgs.join(' ')} 失敗（exit ${res.status}）`);
    process.exit(res.status || 1);
  }
  return out;
}

function step(n, msg) { console.log(`\n==> ${n}/6 ${msg}`); }

// ---- 直接寫前端網址就好 ----
if (opt('--url')) {
  writeFrontend(opt('--url'));
  console.log(`\n已把 ${opt('--url')} 寫進 js/sync.js 的 BUILT_IN。記得 git commit + push。`);
  process.exit(0);
}

// ---- 1/6 登入 ----
step(1, 'wrangler 登入（瀏覽器會跳出，請按 Allow）');
const who = wr(['whoami'], { allowFail: true });
if (/You are logged in|Account Name/i.test(who)) {
  console.log('    已登入，略過');
} else {
  wr(['login'], { capture: false });
  wr(['whoami'], { allowFail: true });
}

// ---- 2/6 D1 ----
step(2, `建立 D1 資料庫 ${DB_NAME}`);
let dbId = '';
const dbList = wr(['d1', 'list', '--json'], { allowFail: true });
try {
  const arr = JSON.parse(dbList.slice(dbList.indexOf('[')));
  const hit = arr.find((d) => d.name === DB_NAME);
  if (hit) { dbId = hit.uuid || hit.database_id || ''; console.log('    已存在'); }
} catch { /* fall through */ }

if (!dbId) {
  const created = wr(['d1', 'create', DB_NAME]);
  const m = created.match(UUID_RE);
  if (m) dbId = m[0];
}
if (!dbId) {
  console.error(`\n!! 拿不到 database_id。請到 Cloudflare 後台複製，手動填進 ${TOML} 後用 --url 之外的步驟接手，或重跑。`);
  process.exit(1);
}
console.log(`    database_id = ${dbId}`);

// ---- 3/6 寫 wrangler.toml ----
step(3, '把 database_id 寫進 workers/wrangler.toml');
let toml = readFileSync(TOML, 'utf8');
toml = toml.replace(/^database_id\s*=\s*.*$/m, `database_id = "${dbId}"`);
writeFileSync(TOML, toml);
console.log('    ' + toml.split('\n').find((l) => l.startsWith('database_id')));

// ---- 4/6 schema ----
step(4, '建立資料表（schema.sql）');
wr(['d1', 'execute', DB_NAME, '--remote', `--file=${SCHEMA}`, '--yes']);

// ---- 5/6 R2 ----
step(5, `建立 R2 bucket ${BUCKET}`);
const buckets = wr(['r2', 'bucket', 'list'], { allowFail: true });
if (buckets.includes(BUCKET)) {
  console.log('    已存在');
} else {
  const r2 = wr(['r2', 'bucket', 'create', BUCKET], { allowFail: true });
  if (/not enabled|must.*enable|Enable R2/i.test(r2)) {
    console.error('\n!! R2 尚未啟用。請到 Cloudflare 後台 → R2 → 啟用（第一次需綁卡，免費額度內不扣款），再重跑。');
    process.exit(1);
  }
}

// ---- 6/6 deploy ----
step(6, '部署 Worker');
const deploy = spawnSync('npx', ['--yes', 'wrangler', 'deploy'], {
  cwd: join(ROOT, 'workers'), encoding: 'utf8', shell: isWin, stdio: ['inherit', 'pipe', 'pipe'],
});
const deployOut = ((deploy.stdout || '') + (deploy.stderr || '')).trim();
console.log(deployOut);
if (deploy.status !== 0) process.exit(deploy.status || 1);

const url = (deployOut.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0] || '';

console.log('\n' + '='.repeat(56));
if (url) {
  console.log(` 完成！Worker 網址：\n   ${url}`);
  if (!flag('--skip-frontend')) {
    writeFrontend(url);
    console.log('\n 已寫進 js/sync.js 的 BUILT_IN。接著：');
    console.log('   git add -A && git commit -m "cloud: 接上同步 Worker" && git push');
  }
  console.log('\n 驗證：');
  console.log(`   curl ${url}/health`);
  console.log(`   node scripts/synctest.mjs --url ${url}`);
} else {
  console.log(' 部署完成，但沒抓到 workers.dev 網址，請看上面 deploy 輸出。');
}
console.log('='.repeat(56));

// ---- helper ----
function writeFrontend(rawUrl) {
  const url = String(rawUrl).replace(/\/$/, '');
  if (!/^https:\/\/.+/.test(url)) { console.error('!! 網址格式怪怪的：' + url); process.exit(1); }
  if (!existsSync(SYNC_JS)) { console.error('!! 找不到 js/sync.js'); process.exit(1); }
  let s = readFileSync(SYNC_JS, 'utf8');
  const mode = url.includes('workers.dev') ? 'cloud' : 'lan';
  const line = `const BUILT_IN = { mode: '${mode}', url: '${url}' };`;
  if (!/const BUILT_IN = \{[^}]*\};/.test(s)) { console.error('!! sync.js 裡找不到 BUILT_IN 那一行'); process.exit(1); }
  s = s.replace(/const BUILT_IN = \{[^}]*\};/, line);
  writeFileSync(SYNC_JS, s);
  console.log('    js/sync.js → ' + line);
}
