// 中文文案體檢（npm run zhtest，v1.72）。
//
// 起因：使用者在回憶影片第 3 天的字卡上看到
//   「溫泉公園漫步，品嚐在地雞湯，了解水產養殖，溫暖的宜蘭說不再見」
// 最後那句漏了介詞（要嘛「向溫暖的宜蘭說再見」、要嘛「不跟溫暖的宜蘭說再見」），
// 整句是新聞標題式的壓縮。查出來是 AI 產的（`aicontent.js` 的 narration），
// 靜態句型庫裡完全沒有「再見／道別」字樣。
//
// 這支測試守三件事：
//   1. **靜態句型庫全部展開**（不是抽樣）跑語法紅旗 —— 以後有人加了怪模板會被擋下
//   2. **對照組**：把使用者回報的那句丟進檢查器，確認它抓得到 —— 不然這就是一個
//      永遠會通過的空檢查器
//   3. **AI 提示詞**：五支都要帶共用的中文語感規則，而且提示詞版本要進 sig
//      （不進 sig 的話，改了提示詞對既有行程完全沒效果）
//
// AI 的輸出沒辦法在這裡驗 —— 那要真的打 API。能驗的是「提示詞有沒有把話講清楚」。

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; }
};

// ---------- 語法紅旗 ----------
// 針對使用者踩到的那一類：該有介詞卻沒有、電報式壓縮、流水帳。
// 「說再見／道別」這種需要介詞的句型：**要看整個子句**有沒有介詞，不能只看緊鄰的一個字。
// （用 lookbehind 會誤殺「向溫暖的宜蘭說再見」—— 正則可以從「暖的宜蘭說再見」開始
//   匹配，前一個字是「溫」不在介詞集合裡就過了。這是我第一版寫錯的地方。）
const needsPrep = (verb) => (t) => {
  const m = new RegExp('([^，。！？；]*)' + verb).exec(t);
  return !!m && !/[向跟和與對]/.test(m[1]);
};

const FLAGS = [
  { fn: needsPrep('說(?:聲)?再見'), why: '「說再見」前面缺介詞（要「向／跟 X 說再見」）' },
  { fn: needsPrep('道別'), why: '「道別」前面缺介詞' },
  { re: /說不再見/, why: '「說不再見」語序不通' },
  { re: /(公園|老街|夜市|車站|步道|海邊|山上)(漫步|漫遊|巡禮|走訪)(?![的地])/, why: '地點直接接動詞，像新聞標題（缺「在／去」）' },
  { re: /^[^。！？]*[，、][^。！？]*[，、][^。！？]*[，、][^。！？]*$/, why: '四段以上用逗號硬串，是清單不是句子' },
  { re: /（\s*）|「\s*」|\(\s*\)/, why: '括號/引號是空的（替換失敗）' },
  { re: /[，。、]{2,}/, why: '連續標點' },
  { re: /^[，。、]|[，、]$/, why: '句子開頭或結尾是標點' },
];
const flagsFor = (t) => FLAGS.filter((f) => (f.fn ? f.fn(t) : f.re.test(t)));

console.log('— 對照組（先確認檢查器不是空的）—');
const REAL = '溫泉公園漫步，品嚐在地雞湯，了解水產養殖，溫暖的宜蘭說不再見';
const hit = flagsFor(REAL);
yes(hit.length >= 2, `使用者回報的那句抓得到（${hit.length} 條紅旗：${hit.map((f) => f.why).join('；')}）`);
yes(!flagsFor('泡完湯再喝碗熱雞湯，這天過得很慢。').length, '正常的句子不會被誤判');
yes(!flagsFor('走一圈羅東夜市，邊走邊吃最過癮。').length, '兩段式的正常句子不會被誤判');
yes(flagsFor('向溫暖的宜蘭說再見').length === 0, '「向 X 說再見」是對的，不該被抓');
// 每一條紅旗都要有自己的樣本（2026-09-24 盤點實測：原本只有上面那一句，碰得到 8 條裡的 3 條；
// 把「連續標點」那條弄壞，塞進句型庫的連續標點就放行了）。新增紅旗卻沒給樣本 → 這一條紅。
const FLAG_SAMPLES = {
  '「說再見」前面缺介詞（要「向／跟 X 說再見」）': '溫暖的宜蘭說再見',
  '「道別」前面缺介詞': '在宜蘭道別',
  '「說不再見」語序不通': '宜蘭說不再見',
  '地點直接接動詞，像新聞標題（缺「在／去」）': '夜市漫步',
  '四段以上用逗號硬串，是清單不是句子': '泡湯，喝湯，看海，散步',
  '括號/引號是空的（替換失敗）': '這裡（）很好',
  '連續標點': '好吃，，再來',
  '句子開頭或結尾是標點': '，好吃',
};
yes(FLAGS.length > 0 && FLAGS.every((f) => f.why in FLAG_SAMPLES),
  `前置：${FLAGS.length} 條紅旗每一條都有樣本`, '沒有樣本的：' + FLAGS.filter((f) => !(f.why in FLAG_SAMPLES)).map((f) => f.why).join('；'));
const brokenFlags = [];
for (const f of FLAGS) {
  const s = FLAG_SAMPLES[f.why];
  const got = s !== undefined && flagsFor(s).includes(f);
  if (!got) brokenFlags.push(f.why);
  yes(got, `對照組：「${s}」抓得到紅旗「${f.why}」`);
}

// ---------- 靜態句型庫全部展開 ----------
console.log('\n— 靜態句型庫（全部展開，不抽樣）—');
const ph = JSON.parse(fs.readFileSync(ROOT + 'data/phrases.json', 'utf8'));
const NAMES = ['羅東夜市', '國立傳統藝術中心', '幾米公園', '礁溪溫泉公園'];
const FILL = { feature: '海風', must: '蔥油餅', item: '蔥油餅' };
const txt = (v) => (typeof v === 'string' ? v : (v && v.t) || '');
const fill = (tpl, name) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (k === 'name' ? name : (FILL[k] ?? '')))
  .replace(/\s{2,}/g, ' ').replace(/（）|「」/g, '').replace(/，(?=[，。、])/g, '').trim();

const bad = [];
let total = 0;
for (const [theme, v] of Object.entries(ph.themes)) {
  for (const name of NAMES) {
    for (const key of ['blurb', 'questTitles', 'questHints']) {
      for (const t of v[key] || []) {
        const line = fill(txt(t), name);
        total++;
        const f = flagsFor(line);
        if (f.length) bad.push(`[${theme}.${key}] ${f[0].why}：「${line}」`);
      }
    }
  }
}
for (const [k, v] of Object.entries(ph.mustQuest)) {
  for (const name of NAMES) {
    for (const key of ['title', 'hint']) {
      const line = fill(v[key], name);
      total++;
      const f = flagsFor(line);
      if (f.length) bad.push(`[mustQuest.${k}.${key}] ${f[0].why}：「${line}」`);
    }
  }
}
// 母體不能是空的，而且要等於從句型庫算出來的句數（2026-09-24 盤點實測：句型庫清空時，
// 原本「0 句全部展開、零紅旗」照樣打勾）。應有句數另外從資料算，不從上面的迴圈數。
const themeLines = Object.values(ph.themes || {}).reduce((n, v) => n + ['blurb', 'questTitles', 'questHints'].reduce((m, k) => m + (v[k] || []).length, 0), 0);
const expectTotal = themeLines * NAMES.length + Object.keys(ph.mustQuest || {}).length * 2 * NAMES.length;
yes(Object.keys(ph.themes || {}).length > 0 && Object.keys(ph.mustQuest || {}).length > 0 && total > 0 && total === expectTotal,
  `前置：句型庫不是空的（主題 ${Object.keys(ph.themes || {}).length} 個、必吃 ${Object.keys(ph.mustQuest || {}).length} 個），展開了 ${total} 句＝應有 ${expectTotal} 句`);
// 有紅旗壞了，「零紅旗」這個結論就不成立：不印肯定句
if (brokenFlags.length) yes(false, `有 ${brokenFlags.length} 條紅旗的對照組沒過（${brokenFlags.join('；')}）——不下「零紅旗」的結論`);
else if (total > 0 && total === expectTotal) yes(!bad.length, `${total} 句全部展開、零紅旗`, bad.slice(0, 5).join('\n   '));

// ---------- composeBlurb：沒有必吃項時不能吐出半截句子 ----------
console.log('\n— 沒有必吃項的食物景點 —');
globalThis.fetch = async () => ({ json: async () => ph });
const compose = await import('file://' + ROOT.replace(/\\/g, '/') + 'js/quests/compose.js');
await compose.loadPhrases();
let broken = 0, kinds = new Set();
for (let i = 0; i < 300; i++) {
  const line = compose.composeBlurb({ id: 's' + i, name: '龍記活海產', must: [] }, 'food', compose.makeCtx(String(i)));
  kinds.add(line);
  // {must} 被替換成空字串的殘骸
  if (/就是要吃，|招牌是，|的別錯過|嘴饞的話，[^，]*的會/.test(line) || flagsFor(line).length) broken++;
}
yes(!broken, `跑 300 次沒有半截句子（產生 ${kinds.size} 種不同的句子）`);
let withMust = 0;
for (let i = 0; i < 200; i++) {
  const line = compose.composeBlurb({ id: 'm' + i, name: '羅東夜市', must: ['蔥油餅'] }, 'food', compose.makeCtx('m' + i));
  if (line.includes('蔥油餅')) withMust++;
}
yes(withMust > 30, `有必吃項時 {must} 句型照樣用得到（${withMust}/200）—— 沒有被過度過濾`);

// ---------- AI 提示詞 ----------
console.log('\n— AI 提示詞 —');
const src = fs.readFileSync(ROOT + 'js/aicontent.js', 'utf8');
const systems = [...src.matchAll(/system:\s*'([^']*)'/g)].map((m) => m[1]);
const styleUses = (src.match(/\+ ZH_STYLE/g) || []).length;
yes(styleUses === 5, `五支提示詞都帶共用的中文語感規則（實際 ${styleUses} 支）`);
yes(/介詞、動詞、助詞都不能為了省字被砍掉/.test(src), '規則明確點名「不要為了省字砍掉介詞」（抽象的「自然」模型接不住）');
yes(/寧可少寫一點/.test(src), '規則講明字數是參考、寧可少寫也不要把句子壓壞');
yes(/不要把景點一個一個列出來/.test(src), '字卡那一段明講「不要把景點列出來」—— 這是壓縮壓力的源頭');
yes(/溫泉公園漫步/.test(src) && /泡完湯再喝碗熱雞湯/.test(src), '提示詞裡有反例與正例對照（比形容詞有效）');
const sigCount = (src.match(/PROMPT_V/g) || []).length;
yes(sigCount >= 6, `提示詞版本進了每一支的 sig（${sigCount} 處）—— 不進 sig 的話改了提示詞對既有行程沒效果`);
yes(/export async function clearTripText/.test(src), '有「重新產生」的路：clearTripText 把 aiText 記錄清掉');
yes(!systems.some((x) => /全部繁體中文、親切自然/.test(x)), '舊的抽象說法（「親切自然」當唯一要求）已經換掉');

// ---------- 模型 ----------
console.log('\n— 模型 —');
const aiSrc = fs.readFileSync(ROOT + 'js/ai.js', 'utf8');
const model = (aiSrc.match(/const MODEL = '([^']+)'/) || [])[1];
yes(model === 'claude-sonnet-5',
  `文案用 Sonnet 5 不用 Haiku（實際 ${model}）—— 字數限制很緊時，小模型最先犧牲的就是介詞助詞`);
yes(new RegExp("'" + model + "': \\{ in:").test(aiSrc),
  '費率表有這個模型的價格（不然花費統計會騙人）');

console.log('\n中文文案體檢結束');
console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
