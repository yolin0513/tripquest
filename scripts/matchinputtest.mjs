// 原本打的名字（npm run matchinputtest；v1.76.0，2026-11-10 投票＋Yolin 選 B；秒級、不開瀏覽器）。資料全是合成的或公開地標。
// 涵蓋的程式：js/quests/generate.js js/theme.js js/share.js
//
// matchInput：送進 matchPlace 的那串字。只在對上景點庫時寫；階層選擇寫 null；超過 40 字不存；沒對上不寫。
// trustedTheme 多一步：matchInput 是字串時，拿它再比一次，要比回同一筆，不然 reason 'input-mismatch'、拿不到類別。
// 一、寫入（真的 generateForTrip、真的景點庫）  二、判讀（trustedTheme）  三、登記制：js/ 底下只有 generate.js 寫、theme.js 讀
//   （分享連結 makeShareCode 是逐欄列的白名單，share.js 沒提到 matchInput ⇒ 不帶；由第三段的登記守）。
// 已知限制：「建立時的地區提示」跟 spot.region 不同時，第二次比對可能比不回同一筆 → 拿不到類別（安全方向），這裡沒有造那個情境。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
globalThis.fetch = async (u) => {
  const s = String(u);
  if (!/^\.\/data\/[\w-]+\.json$/.test(s) && !/^\.\/data\/places\/[\w-]+\.json$/.test(s)) throw new Error('matchinputtest 不供應：' + s);
  const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
const gen = await import('../js/quests/generate.js');
await theme.loadThemes();

let pass = 0, failN = 0;
const yes = (c, m, x = '') => { if (c) { pass++; console.log('✓ ' + m); } else { failN++; console.log('✗ ' + m + (x ? '\n   ' + String(x).slice(0, 600) : '')); } };
const J = (x) => JSON.stringify(x);
const one = async (item) => (await gen.generateForTrip({ tripId: 't-test', items: [item], region: '台中市' })).spots[0];

// ---------- 一、寫入 ----------
console.log('— 寫入（generateForTrip）—');
const s1 = await one({ name: '梧棲漁港', region: '台中市' });
yes(s1.source === 'curated' && s1.placeId === 'tc-wuqi' && s1.matchInput === '梧棲漁港',
  `打字對上景點庫 → matchInput 是打的那串字（實得 ${J({ source: s1.source, placeId: s1.placeId, matchInput: s1.matchInput })}）`);
const s2 = await one({ placeId: 'tc-wuqi', name: '梧棲漁港' });
yes(s2.source === 'curated' && 'matchInput' in s2 && s2.matchInput === null, `階層選擇（帶 placeId）→ matchInput 是 null（實得 ${J(s2.matchInput)}、有鍵 ${'matchInput' in s2}）`);
const s3 = await one({ name: '阿嬤家巷口小吃', region: '台中市' });
yes(s3.source !== 'curated' && !('matchInput' in s3), `沒對上景點庫 → 不寫 matchInput（實得 source ${s3.source}、有鍵 ${'matchInput' in s3}）`);
{
  const long = '梧棲漁港' + '的'.repeat(gen.MATCH_INPUT_MAX);   // 41 字以上
  const lp = await gen.matchPlace(long, '台中市');
  if (lp) {
    const s4 = await one({ name: long, region: '台中市' });
    yes(long.length > gen.MATCH_INPUT_MAX && s4.source === 'curated' && !('matchInput' in s4), `超過 ${gen.MATCH_INPUT_MAX} 字、照樣對上 → 不存（鍵不存在＝不知道）（${long.length} 字、有鍵 ${'matchInput' in s4}）`);
  } else {
    // 造不出「超過 40 字又對得上景點庫」的名字（${long.length} 字的版本對不上）——長度規則只能從 generateForTrip 用的那支
    // matchInputFor 直接驗（內層函式，不是真實入口；照實寫明）
    const f = gen.matchInputFor;
    const s40 = '名'.repeat(40), s41 = '名'.repeat(41);
    yes(gen.MATCH_INPUT_MAX === 40 && f(s40, false) === s40 && f(s41, false) === undefined && f(s41, true) === null,
      `長名字對不上景點庫（${long.length} 字），改驗 matchInputFor：40 字存、41 字不存（undefined）、階層選擇 null（實得 ${J([f(s40, false)?.length, f(s41, false), f(s41, true)])}）`);
  }
}

// ---------- 二、判讀 ----------
console.log('\n— 判讀（trustedTheme）—');
const L = await gen.loadPlaceLookup();
const base = { name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi' };
const t1 = theme.trustedTheme({ ...base, matchInput: '梧棲漁港' }, L);
yes(t1.key === 'food' && t1.reason === null, `原本打的字比回同一筆 → 照樣拿得到 food（實得 ${J(t1)}）`);
const wrong = '阿嬤家巷口小吃';
const pre = L.matchPlace(wrong, '台中市');
yes(!pre || pre.id !== 'tc-wuqi', `前置：「${wrong}」比不回 tc-wuqi（實得 ${pre && pre.id}）`);
const t2 = theme.trustedTheme({ ...base, matchInput: wrong }, L);
yes(t2.key === null && t2.reason === 'input-mismatch', `原本打的字比不回同一筆（當年就比錯）→ 拿不到、reason input-mismatch（實得 ${J(t2)}）`);
const t3 = theme.trustedTheme({ ...base, matchInput: null }, L);
const t4 = theme.trustedTheme({ ...base }, L);
yes(t3.key === 'food' && t4.key === 'food', `null（階層選擇）與沒有這個欄位（舊景點）→ 維持原本行為、拿得到 food（實得 ${t3.key}、${t4.key}）`);
const t5 = theme.trustedTheme({ ...base, matchInput: '' }, L);
yes(t5.key === null && t5.reason === 'input-mismatch', `空字串是字串、不是「不知道」→ 照樣要比（比不回 → 拿不到；實得 ${J(t5)}）`);
const born = s1.theme;
yes(born === 'food', `建立當下（generateForTrip 用 trustedTheme 算 theme）→ food，matchInput 不會讓剛建好的景點拿不到類別（實得 ${born}）`);

// ---------- 三、登記制 ----------
console.log('\n— 登記制：js/ 底下誰碰 matchInput —');
// 登記：檔 → 准許的用法。write＝寫入；read＝讀。沒登記的檔一出現 matchInput 就報。
const REG = { 'js/quests/generate.js': 'write', 'js/theme.js': 'read' };
const WRITE_RE = /matchInput\s*(=(?!=)|:)/;
function scan(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const rel = path.relative(root, p).split(path.sep).join('/');
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (!line.includes('matchInput')) return;
        const code = line.replace(/\/\/.*$/, '');
        if (!code.includes('matchInput')) return;            // 只在註解裡
        const use = WRITE_RE.test(code) ? 'write' : 'read';
        const ok = REG[rel] === use || (REG[rel] === 'write' && use === 'read');
        out.push({ rel, line: i + 1, use, ok });
      });
    }
  };
  walk(path.join(root, 'js'));
  return out;
}
{
  // 對照組：暫存目錄造真的 .js 檔（沒登記的檔讀、generate.js 以外寫），走同一支 scan
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matchinput-'));
  fs.mkdirSync(path.join(tmp, 'js', 'views'), { recursive: true });
  const key = 'match' + 'Input';
  fs.writeFileSync(path.join(tmp, 'js', 'views', 'x.js'), `const a = spot.${key};\n`);
  fs.writeFileSync(path.join(tmp, 'js', 'theme.js'), `spot.${key} = 'x';\n`);
  const back = fs.readFileSync(path.join(tmp, 'js', 'views', 'x.js'), 'utf8') + fs.readFileSync(path.join(tmp, 'js', 'theme.js'), 'utf8');
  const ctl = scan(tmp);
  yes(back.split('matchInput').length === 3 && ctl.length === 2 && ctl.every((x) => !x.ok)
    && ctl.some((x) => x.rel === 'js/views/x.js' && x.use === 'read') && ctl.some((x) => x.rel === 'js/theme.js' && x.use === 'write'),
    `對照組：沒登記的檔讀、theme.js 寫 → 兩處都報（${J(ctl)}）`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
const real = scan(ROOT);
const files = [...new Set(real.map((x) => x.rel))].sort();
yes(J(files) === J(['js/quests/generate.js', 'js/theme.js']) && real.some((x) => x.rel === 'js/quests/generate.js' && x.use === 'write'),
  `真實：碰到 matchInput 的檔正好是 generate.js（寫）與 theme.js（讀）（${J(files)}，${real.length} 行）`);
yes(real.length > 0 && real.every((x) => x.ok), `真實：每一處都符合登記（${J(real.filter((x) => !x.ok))}）`);

console.log(`\n原本打的名字：${pass} 項通過、${failN} 項失敗`);
process.exitCode = failN ? 1 : 0;
