// mutlint 的突變：在 repo 的暫存 clone（.logs/ml-mut）裡改壞 scripts/mutlint.mjs，從命令列入口跑，
// 看哪幾個對照組報 false、回傳值是多少。預期：拿掉點名 → 對應的對照組 false、回 4；原樣 → 全 true、回 0。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.argv[2];
const COPY = path.join(REPO, '.logs', 'ml-mut');
const UNK = "if (!ms) { problems.push(`${f}（不是任何一種突變格式，也沒登記成非突變檔）`); unrecognized++; continue; }";
const PARSE = "catch (e) { problems.push(`${f}（讀不懂：${e.message.split('\\n')[0]}）`); unrecognized++; continue; }";
const STALE = "for (const f of notMutations) if (!files.includes(f)) problems.push(`${f}（登記成非突變檔，但目錄裡沒有——登記過期）`);";
const MUTS = [
  { name: 'K0 原樣（反向）', edits: [], expectFalse: [], rc: 0 },
  { name: 'K1 拿掉「認不出的格式」點名', edits: [[UNK, 'if (!ms) { unrecognized++; continue; }']], expectFalse: ['漏一筆（find 拼成 fnd）'], rc: 4 },
  { name: 'K2 拿掉「讀不懂」點名', edits: [[PARSE, 'catch (e) { unrecognized++; continue; }']], expectFalse: ['讀不懂的一份'], rc: 4 },
  { name: 'K3 拿掉「登記過期」點名', edits: [[STALE, '']], expectFalse: ['登記過期'], rc: 4 },
  { name: 'K4 點名的那一段全部拿掉', edits: [[UNK, 'if (!ms) { unrecognized++; continue; }'], [PARSE, 'catch (e) { unrecognized++; continue; }'], [STALE, '']],
    expectFalse: ['漏一筆（find 拼成 fnd）', '讀不懂的一份', '登記過期'], rc: 4 },
  { name: 'K5 一律報有問題（該放的擋住）', edits: [["  if (checked !== pop) problems.push(", "  problems.push('一律');\n  if (checked !== pop) problems.push("]], expectFalse: ['齊全', '漏一筆（find 拼成 fnd）', '讀不懂的一份', '登記過期'], rc: 4 },
];
let bad = 0;
for (const m of MUTS) {
  fs.rmSync(COPY, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', REPO, COPY]);
  const p = path.join(COPY, 'scripts/mutlint.mjs');
  let src = fs.readFileSync(p, 'utf8');
  for (const [find, repl] of m.edits) {
    const n = src.split(find).length - 1;
    if (n !== 1) { console.log(`✗ ${m.name}：find 出現 ${n} 次，突變沒造成，中止\n   ${find.slice(0, 60)}`); process.exit(9); }
    src = src.replace(find, repl);
  }
  fs.writeFileSync(p, src);
  const sha = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  const r = spawnSync(process.execPath, ['scripts/mutlint.mjs'], { cwd: COPY, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const line = (out.match(/^對照組：判斷＝.*$/m) || [''])[0];
  const falses = [...line.matchAll(/(?:、|：)([^、＝]+)＝false/g)].map((x) => x[1]);
  const ok = r.status === m.rc && falses.slice().sort().join('|') === m.expectFalse.slice().sort().join('|');
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${m.name}：回 ${r.status}（預期 ${m.rc}）、被驗的 mutlint ${sha}、報 false 的對照組：${falses.join('、') || '無'}`);
}
fs.rmSync(COPY, { recursive: true, force: true });
console.log(bad ? `${bad} 條不照預期` : `${MUTS.length} 條全部照預期`);
process.exitCode = bad ? 1 : 0;
