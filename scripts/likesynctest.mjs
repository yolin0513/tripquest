// 讚的同步（npm run likesynctest；v1.76.0，2026-11-10 投票 (c)）。資料全是合成的。
// 涵蓋的程式：js/likes.js js/store.js js/merge.js server/index.mjs workers/worker.mjs
//
// 第一段（純函式，不開瀏覽器）：
//   按表情的三種結果（Yolin 2026-11-10 第 3 題：按另一個表情是換表情、按同一個是收回）；
//   讚數＝不同的人數；id 對不上的不算；舊式 reaction → legacy、不顯示數字；
//   守衛：'like' 不得出現在 APPEND_ONLY（merge.js、server/index.mjs 那一份）或 TRACKED——
//     一旦有人加進去，like 就變成「已存在就不動」或欄位級合併，收回／換表情會傳不出去，而且會恢復「Worker 要先部署」的要求而沒人知道；
//   like 紀錄在現役 Worker（7162ada 的 merge.js）與目前的 merge.js 上判讀一樣（混搭期間兩版伺服器並存）。
//
// 第二段（兩台真的裝置＋LAN 伺服器，開瀏覽器）：R2 反對 (c) 的理由——
//   「時鐘慢的裝置推送輸了、伺服器不通知 → 靜默分歧」——寫成測試，不靠論證。
//   同一個人（甲）用兩台裝置：A 時鐘正常、B 時鐘慢 1 小時。
//   期望值是「依因果的最後一次操作」與「三方（A、B、伺服器）相同」，不是從實作算出來的。
//   突變：把 store.js stamp 改成只用 now（不參考舊的 updatedAt）——S1 必須紅（mut_v176.json）。
//   問自己的一句（Dispatch 2026-11-10）：如果 R2 是對的、實作真的會分歧，這條抓得到嗎？——那個突變就是 R2 說的那種實作。
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rm, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { likeId, nextEmoji, likeSummary, LIKE_TYPE } from '../js/likes.js';
import * as Cur from '../js/merge.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, failN = 0;
const yes = (c, m, x = '') => { if (c) { pass++; console.log('✓ ' + m); } else { failN++; console.log('✗ ' + m + (x ? '\n   ' + x : '')); } };
const J = (x) => JSON.stringify(x);

// ================= 第一段：純函式 =================
console.log('— 純函式（js/likes.js）—');
yes(nextEmoji(null, '❤️') === '❤️' && nextEmoji(undefined, '😂') === '😂', '按表情：沒按過 → 那個表情');
yes(nextEmoji('❤️', '❤️') === null, '按表情：按著 ❤️ 再按 ❤️ → 收回（null）');
yes(nextEmoji('❤️', '😂') === '😂', '按表情：按著 ❤️ 按 😂 → 換成 😂（不是收回）');
yes(nextEmoji(null, '❤️') === '❤️' && nextEmoji('', '❤️') === '❤️', '按表情：已收回（null／空字串）再按 → 那個表情');
{
  const S = 's1', L = (a, e, extra = {}) => ({ id: likeId(S, a), type: LIKE_TYPE, submissionId: S, actorId: a, emoji: e, ...extra });
  const recs = [L('甲', '❤️'), L('乙', '😂'), L('丙', null), { ...L('丁', '❤️'), id: 'like:別張:丁' },
    L('戊', '❤️', { submissionId: 's2', id: likeId('s2', '戊') })];
  const r = likeSummary(recs, S, '乙');
  yes(r.count === 2 && r.mine === '😂' && r.legacy === false && r.showCount === true,
    `讚數＝按著讚的不同的人（甲❤️、乙😂 算；丙收回、丁 id 對不上、戊別張不算）→ 2 人、我按 😂（實得 ${J(r)}）`);
  const r0 = likeSummary([L('丙', null)], S, '丙');
  yes(r0.count === 0 && r0.mine === null && r0.showCount === false, `全部收回 → 0 人、不顯示（實得 ${J(r0)}）`);
  const leg = { id: 'u1', type: 'reaction', submissionId: S, actorId: '己', emoji: '❤️' };
  const rl = likeSummary([...recs, leg], S, '己');
  yes(rl.count === 2 && rl.legacy === true && rl.showCount === false && rl.mine === null,
    `有舊式 reaction → legacy、不顯示數字；「我按過」只看 like（己只有舊式 → mine null；實得 ${J(rl)}）`);
}

console.log('\n— 守衛：like 不進 APPEND_ONLY／TRACKED —');
yes(Cur.APPEND_ONLY.has('reaction') && !Cur.APPEND_ONLY.has(LIKE_TYPE), `merge.js APPEND_ONLY 不含 like（前置：含 reaction）`);
yes(Object.keys(Cur.TRACKED).length > 0 && !(LIKE_TYPE in Cur.TRACKED), `merge.js TRACKED 不含 like（前置：TRACKED 有 ${Object.keys(Cur.TRACKED).length} 型）`);
{
  const src = await readFile(path.join(ROOT, 'server/index.mjs'), 'utf8');
  const line = src.split('\n').find((l) => /^const APPEND_ONLY = new Set\(/.test(l)) || '';
  yes(line.includes("'reaction'") && !/'like'|"like"/.test(line), `server/index.mjs 自己那份 APPEND_ONLY 不含 like（前置：抓到那一行、含 reaction）`, line);
  const wk = await readFile(path.join(ROOT, 'workers/worker.mjs'), 'utf8');
  yes(/import \{[^}]*APPEND_ONLY[^}]*\} from '\.\.\/js\/merge\.js'/.test(wk), 'workers/worker.mjs 的 APPEND_ONLY 是從 merge.js 匯入的（上面那條就涵蓋 Worker）');
}

console.log('\n— 混搭：現役 Worker（7162ada 的 merge.js）與目前的 merge.js 對 like 的判讀相同 —');
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'likesync-'));
  const old = execFileSync('git', ['show', '7162ada:js/merge.js'], { cwd: ROOT, encoding: 'utf8' });
  const f = path.join(dir, 'merge-7162ada.mjs');
  await writeFile(f, old);
  const Old = await import(pathToFileURL(f).href);
  yes(old !== await readFile(path.join(ROOT, 'js/merge.js'), 'utf8'), '前置：兩版 merge.js 內容不同（真的是兩個來源）');
  const base = { id: likeId('s', '甲'), type: LIKE_TYPE, tripId: 't', submissionId: 's', actorId: '甲', createdAt: 1 };
  const pairs = [
    [{ ...base, emoji: '❤️', updatedAt: 1000, deviceId: 'a' }, { ...base, emoji: null, updatedAt: 1001, deviceId: 'b' }],
    [{ ...base, emoji: '😂', updatedAt: 2000, deviceId: 'a' }, { ...base, emoji: '❤️', updatedAt: 1500, deviceId: 'b' }],
    [{ ...base, emoji: '😂', updatedAt: 2000, deviceId: 'a' }, { ...base, emoji: '❤️', updatedAt: 2000, deviceId: 'b' }],
    [{ ...base, emoji: '❤️', updatedAt: 3000, deviceId: 'a', _f: { name: 3000 } }, { ...base, emoji: null, updatedAt: 3001, deviceId: 'b' }],
  ];
  const out = pairs.map(([x, y]) => [Old, Cur].map((M) => {
    const a = M.sanitizeF(JSON.parse(J(x))), b = M.sanitizeF(JSON.parse(J(y)));
    return [M.mergeRecord(a, b).rec.emoji, M.mergeRecord(b, a).rec.emoji];
  }));
  yes(out.every(([o, c]) => J(o) === J(c)), `四組 like 合併，兩版結果一樣（${J(out)}）`);
  yes(out.every(([, c]) => c[0] === c[1]), `合併順序無關（merge(A,B) 與 merge(B,A) 同結果）`);
  yes(out[0][1][0] === null && out[1][1][0] === '😂', `較新的那筆贏（收回 1001 > ❤️ 1000；😂 2000 > ❤️ 1500）（實得 ${J(out.map((o) => o[1][0]))}）`);
  await rm(dir, { recursive: true, force: true });
}

// ================= 第二段：兩台裝置 =================
console.log('\n— 兩台裝置（LAN 伺服器；同一個人甲，B 的時鐘慢 1 小時）—');
const WEB = 5571, API = 8793;
await rm(fileURLToPath(new URL('../server/data', import.meta.url)), { recursive: true, force: true });
const web = spawn('python', ['-m', 'http.server', String(WEB)], { cwd: ROOT, stdio: 'ignore' });
const api = spawn('node', ['server/index.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(API) } });
await sleep(1600);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const SLOW = 3600000;

async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failN++; console.log(`✗ [${name} pageerror] ${e.message}`); });
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
  await page.evaluate(async (url) => {
    (await import('./js/sync.js')).setConfig({ mode: 'lan', url });
    window.__s = await import('./js/store.js');
  }, `http://localhost:${API}`);
  return page;
}
const drain = (p) => p.evaluate(async () => (await import('./js/outbox.js')).drain({ force: true }));
const press = (p, sid, me, emo) => p.evaluate(({ sid, me, emo }) => window.__s.toggleReaction(sid, me, emo), { sid, me, emo });
const local = (p, sid, me) => p.evaluate(({ sid, me }) => { const r = window.__s.getRaw(`like:${sid}:${me}`); return r ? { emoji: r.emoji, updatedAt: r.updatedAt } : null; }, { sid, me });
const offline = async (p, on) => { await p.setOfflineMode(on); await p.evaluate((on) => window.dispatchEvent(new Event(on ? 'offline' : 'online')), on); };

try {
  const A = await device('A'), B = await device('B');
  const setup = await A.evaluate(async () => {
    const s = window.__s; const { uuid } = await import('./js/ids.js');
    const { ensureGroupSync, shareURL } = await import('./js/share.js');
    const gid = uuid(), tid = uuid(), me = uuid(), qid = uuid(), sp = uuid();
    await s.put({ id: gid, type: 'group', name: '範例家族' });
    await s.put({ id: me, type: 'member', groupId: gid, displayName: '甲' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '範例小旅行', region: '宜蘭', allowWiki: false });
    await s.put({ id: sp, type: 'spot', tripId: tid, name: '範例景點', emoji: '📍', day: 1, order: 0 });
    await s.put({ id: qid, type: 'quest', tripId: tid, spotId: sp, title: '拍下範例景點', kind: 'thing', order: 0 });
    const subs = [];
    for (let i = 0; i < 4; i++) {
      const id = uuid();
      await s.put({ id, type: 'submission', tripId: tid, questId: qid, memberId: me, photoHash: 'h' + i, thumbHash: 'h' + i, createdAt: Date.now() });
      subs.push(id);
    }
    await ensureGroupSync(gid);
    return { gid, tid, me, subs, invite: await shareURL(tid) };
  });
  await drain(A);
  await B.evaluate(async (u) => { const sh = await import('./js/share.js'); await sh.joinInvite(sh.parseInviteText(u)); }, setup.invite);
  await drain(B);
  const bHas = await B.evaluate((ids) => ids.every((id) => !!window.__s.getRaw(id)), setup.subs);
  yes(bHas, 'B 加入群組，拿到 4 張照片');
  await B.evaluate((ms) => { const real = Date.now.bind(Date); window.__realNow = real; Date.now = () => real() - ms; }, SLOW);
  const skew = await B.evaluate(() => window.__realNow() - Date.now());
  yes(skew >= SLOW - 5 && skew <= SLOW + 5, `前置：B 的時鐘慢 1 小時（實得 ${Math.round(skew / 60000)} 分）`);

  // 伺服器那一份從 node 直接問（不經任何一台裝置：裝置離線時也問得到，也不會被裝置的本機狀態影響）
  const secret = await A.evaluate((gid) => window.__s.getRaw(gid).syncSecret, setup.gid);
  const server = async (sid) => {
    const raw = await fetch(`http://localhost:${API}/pull?g=${setup.gid}&since=0`, { headers: { authorization: 'Bearer ' + secret } }).then((r) => r.json());
    const r = raw.records.filter((x) => x.id === `like:${sid}:${setup.me}`);
    return { n: r.length, emoji: r[0] ? r[0].emoji : undefined };
  };
  const three = async (sid) => ({ a: (await local(A, sid, setup.me))?.emoji, b: (await local(B, sid, setup.me))?.emoji, s: (await server(sid)).emoji });

  // S1：A 按 ❤️、推上去 → 慢的 B 拉到之後再按 ❤️（收回）→ 依因果最後一次是「收回」
  {
    const sid = setup.subs[0];
    await press(A, sid, setup.me, '❤️'); await drain(A);
    await drain(B);
    const seen = await local(B, sid, setup.me);
    yes(seen && seen.emoji === '❤️', `S1 前置：B 拉到 A 的 ❤️（實得 ${J(seen)}）`);
    await press(B, sid, setup.me, '❤️');
    const bl = await local(B, sid, setup.me);
    yes(bl && bl.emoji === null && bl.updatedAt > seen.updatedAt,
      `S1 B 收回：本機 emoji null、時間戳大於它看過的版本（時鐘慢也一樣；${bl && bl.updatedAt} > ${seen.updatedAt}）`);
    await drain(B); await drain(A); await drain(B);
    const t = await three(sid);
    yes(t.a === null && t.b === null && t.s === null, `S1 慢的 B 拉到之後收回 → A、B、伺服器都是收回（實得 ${J(t)}）`);
  }

  // S1b：慢的 B 拉到 A 的 ❤️ 之後按 😂（換表情）→ 三方都是 😂
  {
    const sid = setup.subs[1];
    await press(A, sid, setup.me, '❤️'); await drain(A); await drain(B);
    const seen = await local(B, sid, setup.me);
    yes(seen && seen.emoji === '❤️', `S1b 前置：B 拉到 A 的 ❤️（實得 ${J(seen)}）`);
    await press(B, sid, setup.me, '😂');
    await drain(B); await drain(A); await drain(B);
    const t = await three(sid);
    yes(t.a === '😂' && t.b === '😂' && t.s === '😂', `S1b 慢的 B 換表情 → 三方都是 😂（實得 ${J(t)}）`);
  }

  // S2：兩台都離線、各自按（A 😂、慢的 B ❤️），推送順序兩種排列 → 各自三方收斂，而且兩種順序結果相同
  {
    const finals = [];
    for (const [k, order] of [[2, ['A', 'B']], [3, ['B', 'A']]]) {
      const sid = setup.subs[k];
      await offline(A, true); await offline(B, true);
      await press(A, sid, setup.me, '😂');
      await press(B, sid, setup.me, '❤️');
      const pre = [await local(A, sid, setup.me), await local(B, sid, setup.me), await server(sid)];
      yes(pre[0]?.emoji === '😂' && pre[1]?.emoji === '❤️' && pre[2].n === 0,
        `S2（先 ${order[0]}）前置：離線時兩台各自按了、伺服器還沒有（實得 ${J(pre)}）`);
      await offline(A, false); await offline(B, false);
      const P = { A, B };
      await drain(P[order[0]]); await drain(P[order[1]]); await drain(P[order[0]]); await drain(P[order[1]]);
      const t = await three(sid);
      yes(t.a === t.b && t.b === t.s && (t.s === '😂' || t.s === '❤️'), `S2（先 ${order[0]}）兩台離線各自按 → 三方收斂（實得 ${J(t)}）`);
      finals.push(t.s);
    }
    yes(finals.length === 2 && finals[0] === finals[1], `S2 兩種推送順序結果相同（${J(finals)}）`);
  }

  // S3：A 按 ❤️ 推上去；慢的 B 沒拉、離線按 😂（推送會輸）→ B 上線同步後收斂到伺服器那一份，不會停在自己輸掉的版本
  {
    const sid = setup.subs[0];   // 沿用 S1 那張（目前三方都是 null）
    await press(A, sid, setup.me, '❤️'); await drain(A);
    await offline(B, true);
    await press(B, sid, setup.me, '😂');
    const bpre = await local(B, sid, setup.me);
    yes(bpre && bpre.emoji === '😂', `S3 前置：B 沒拉到 A 的 ❤️、本機按成 😂（實得 ${J(bpre)}）`);
    await offline(B, false);
    await drain(B); await drain(A); await drain(B);
    const t = await three(sid);
    yes(t.a === t.b && t.b === t.s, `S3 慢的 B 推送輸掉之後 → 三方收斂、B 沒停在自己的版本（實得 ${J(t)}）`);
  }
} catch (e) { failN++; console.log('✗ 例外 ' + (e && e.stack || e)); }
finally { await browser.close(); web.kill(); api.kill(); }
console.log(`\n讚的同步：${pass} 項通過、${failN} 項失敗`);
process.exitCode = failN ? 1 : 0;
