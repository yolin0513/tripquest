// 「沒把握就留白」的產生器層測試（npm run curatedtest；純 Node，不開瀏覽器）。
//
// 守的是 v1.74 的設計原則：**只有對得上策展資料庫的地點才出題**，其餘地點一個字都不猜。
// 起因是 Yolin 的實例——宜蘭「白雲山鹿」是早餐店，名字裡有「山」就被當成自然景點，
// 出了「拍下最開闊的一景」「一條路的盡頭」「光影最好的一刻」，家人真的去拍了。
//
// 這支不開瀏覽器：產生器、比對、句庫都是純函式，資料是 fetch 相對路徑進來的 JSON，
// 餵一個把相對路徑導到檔案的 fetch 就能跑（實測毫秒級）。畫面那一半在 blanktest.mjs。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, extra) => { console.log('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; };
const yes = (c, m, extra) => (c ? ok(m) : fail(m, extra));

// App 的程式碼是瀏覽器用的：fetch 相對路徑 → 讀檔
globalThis.fetch = async (u) => ({
  ok: true,
  json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')),
});
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const gen = await imp('js/quests/generate.js');
const compose = await imp('js/quests/compose.js');
const { mergeRecord } = await imp('js/merge.js');

// ---------- 策展庫（母體） ----------
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/places/index.json'), 'utf8'));
const CURATED = [];
for (const c of idx.countries || []) for (const r of c.regions || []) for (const ci of r.cities || []) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/places/' + ci.file), 'utf8'));
  CURATED.push(...(d.places || []).map((p) => ({ ...p, cityId: ci.id })));
}
const phrases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/phrases.json'), 'utf8'));

console.log('\n— 母體 —');
yes(CURATED.length >= 100, `策展資料庫 ${CURATED.length} 筆`);
yes(Object.keys(phrases.themes || {}).length >= 5, `句庫 ${Object.keys(phrases.themes || {}).length} 個主題`);

// ---------- T2 反例：不在策展庫裡的店家，一個都不准命中 ----------
console.log('\n— T2 反例不命中 —');
// 前半是 Yolin 的案例與勘查員實跑過的店；後半是**用策展名造出來的**，那才是真正會誤命中的形狀
// （舊規則「輸入裡含有策展名就算命中」→ 1080 個造出來的假店名誤命中 1032 個）。
const NEG = [
  '好樂迪KTV 中山店', '山風民宿hillstay', '火山爆發雞礁溪總店', '家樂福 內湖店', '海底撈 信義店',
  '大佛牛排', '鼎泰豐', '星巴克', '全聯', '晶華酒店', '一蘭拉麵', '白雲山鹿',
  '台北101便利商店', '士林夜市民宿', '太平山莊餐廳', '羅東夜市停車場', '九份老街牛排',
];
const curatedNames = new Set(CURATED.map((p) => p.name));
yes(NEG.length > 0 && NEG.every((n) => !curatedNames.has(n)), `前置：反例 ${NEG.length} 個，每一個都不在策展庫裡（精確比對）`,
  NEG.filter((n) => curatedNames.has(n)).join('、'));
{
  const hit = [];
  for (const n of NEG) { const m = await gen.matchPlace(n, ''); if (m) hit.push(`${n}→${m.name}(${m._s})`); }
  yes(hit.length === 0, `${NEG.length} 個反例全部不命中策展庫`, hit.join('、'));
}
{
  // 大量造出來的假店名（策展名 + 八種店名後綴）—— 這是母體，不是抽樣
  const SUFFIX = ['山莊餐廳', '民宿', '停車場', '咖啡', '小吃部', '便利商店', '足體養生館', '牛排'];
  const fakes = [];
  for (const p of CURATED) for (const s of SUFFIX) fakes.push(p.name + s);
  const bad = [];
  for (const f of fakes) { const m = await gen.matchPlace(f, ''); if (m) bad.push(`${f}→${m.name}`); }
  yes(fakes.length > 500, `前置：造了 ${fakes.length} 個「策展名＋店名後綴」的假店名`);
  yes(bad.length === 0, `${fakes.length} 個假店名全部不命中（舊規則是 1032 個誤命中）`, bad.slice(0, 6).join('、'));
}

// ---------- T3 正例不掉 ----------
console.log('\n— T3 正例仍然命中 —');
{
  const miss = [];
  for (const p of CURATED) { const m = await gen.matchPlace(p.name, ''); if (!m || m.id !== p.id) miss.push(p.name + '→' + (m ? m.name : '無')); }
  yes(miss.length === 0, `策展庫 ${CURATED.length} 筆用自己的名稱全部命中自己`, miss.slice(0, 8).join('、'));
  // 常見別寫法：策展庫目前沒有 aliases 欄位（實查 0 筆），所以用真實會出現的寫法變體
  const VAR = [['羅東觀光夜市', '羅東夜市'], ['士林 夜市', '士林夜市'], ['宜蘭 羅東夜市', '羅東夜市']];
  const vm = [];
  for (const [input, want] of VAR) { const m = await gen.matchPlace(input, ''); if (!m || m.name !== want) vm.push(`${input}→${m ? m.name : '無'}（要 ${want}）`); }
  yes(vm.length === 0, `寫法變體 ${VAR.length} 個仍然命中（中間插字、空白、地區前綴）`, vm.join('、'));
}

// ---------- T1／T4 沒命中的地點：0 任務、沒有任何猜出來的字 ----------
console.log('\n— T1／T4 沒命中就留白 —');
{
  const r = await gen.generateForTrip({
    tripId: 't-blank', region: '宜蘭',
    // 「大佛牛排」是牛排館，但名字命中 NAME_EMOJI 的 /大佛/ → 舊版會給它一個 🛕。
    // 表情符號也是使用者看得到的猜測，所以這一筆是「猜出來的圖示」那條斷言的母體。
    items: [{ name: '白雲山鹿', day: 1 }, { name: '羅東夜市', day: 1 }, { name: '好樂迪KTV 中山店', day: 1 }, { name: '大佛牛排', day: 1 }],
  });
  const byName = Object.fromEntries(r.spots.map((s) => [s.name, s]));
  const qOf = (name) => r.quests.filter((q) => q.spotId === byName[name].id);
  yes(r.spots.length === 4, `前置：四個地點都建起來了（${r.spots.map((s) => s.name).join('、')}）`);
  yes(byName['羅東夜市'].source === 'curated' && qOf('羅東夜市').length > 0,
    `對照組：策展命中的羅東夜市照常有 ${qOf('羅東夜市').length} 個任務`);
  for (const n of ['白雲山鹿', '好樂迪KTV 中山店', '大佛牛排']) {
    const s = byName[n];
    yes(qOf(n).length === 0, `${n}：0 個任務`, qOf(n).map((q) => q.title).join('、'));
    yes(s.blurb === '', `${n}：沒有介紹文字`, JSON.stringify(s.blurb));
    yes(s.emoji === '📍', `${n}：中性的地點圖示（不是照名字猜的）`, s.emoji);
    yes(s.theme === 'journey', `${n}：中性主題`, s.theme);
  }
  // 掃描：沒命中的地點的任何字串欄位，都不准含句庫裡的句子
  const tpl = [];
  for (const t of Object.values(phrases.themes || {})) {
    for (const f of ['blurb', 'questTitles', 'questHints']) {
      for (const v of t[f] || []) tpl.push(String(typeof v === 'string' ? v : v.t).replace(/\{\w+\}/g, '').trim());
    }
  }
  const frag = tpl.filter((x) => x.length >= 6);
  yes(frag.length > 50, `前置：句庫展開後有 ${frag.length} 句可比對`);
  const dirty = [];
  for (const n of ['白雲山鹿', '好樂迪KTV 中山店', '大佛牛排']) {
    const blob = JSON.stringify(byName[n]) + JSON.stringify(qOf(n));
    for (const f of frag) if (blob.includes(f)) dirty.push(`${n}: ${f}`);
  }
  yes(dirty.length === 0, '沒命中的地點，資料裡一句句庫的句子都沒有', dirty.slice(0, 5).join('｜'));
  // 對照組：策展景點的就含得到（證明上面那條不是因為比對器壞了）
  const curBlob = JSON.stringify(byName['羅東夜市']) + JSON.stringify(qOf('羅東夜市'));
  yes(frag.some((f) => curBlob.includes(f)), '對照組：策展景點的資料裡確實含得到句庫的句子');
}

// ---------- R7 補齊任務只補策展地點 ----------
console.log('\n— R7 補齊任務 —');
{
  const curated = { id: 's1', name: '羅東夜市', source: 'curated', theme: 'nightmarket', tags: ['nightmarket'] };
  const auto = { id: 's2', name: '白雲山鹿', source: 'auto', theme: 'journey' };
  const a = await gen.themedQuestsForSpot(curated, 't1');
  const b = await gen.themedQuestsForSpot(auto, 't1');
  yes(a.length > 0, `策展地點補得出任務（${a.length} 個）`);
  yes(b.length === 0, '沒命中的地點補不出任何任務', JSON.stringify(b));
}

// ---------- T10b 沒填時間就不出有時段假設的句子 ----------
console.log('\n— T10b 時段守門 —');
{
  const withWhen = [];
  for (const [key, t] of Object.entries(phrases.themes || {})) {
    for (const f of ['questTitles', 'questHints']) for (const v of t[f] || []) if (v && v.when) withWhen.push(`${key}.${f}:${v.when}`);
  }
  yes(withWhen.length > 0, `前置：句庫裡有 ${withWhen.length} 句帶 when（${[...new Set(withWhen.map((x) => x.split(':')[1]))].join('／')}）`);
  // 夜市那一組整組沒有標時段，卻滿是「一到晚上」「燈火下」——假設了夜晚的句子要標出來，
  // 否則早上去的夜市（很多夜市白天也有攤）照樣會拿到「在 X 燈火下合照」。
  const nm = phrases.themes.nightmarket || {};
  const nightish = [...(nm.questTitles || []), ...(nm.questHints || [])]
    .filter((v) => /燈火|入夜|越晚|一到晚上|最亮/.test(typeof v === 'string' ? v : v.t));
  yes(nightish.length > 0, `前置：夜市主題裡有 ${nightish.length} 句假設了夜晚`);
  yes(nightish.every((v) => v && v.when === 'night'), '夜市那幾句假設夜晚的都標了 when: night',
    nightish.map((v) => (typeof v === 'string' ? v : v.t) + '→' + (v.when || '沒標')).join('｜'));
  yes(compose.phraseOk({ when: 'night' }, null) === false, '沒設時間 → 帶 when 的句子不給出');
  yes(compose.phraseOk({}, null) === true, '沒設時間 → 沒標時段的句子照樣給出');
  yes(compose.phraseOk({ when: 'night' }, [18 * 60, 20 * 60]) === true, '晚上到的景點 → night 的句子給出');
  yes(compose.phraseOk({ when: 'night' }, [9 * 60, 10 * 60]) === false, '早上到的景點 → night 的句子不給出');
  // 真的跑一趟：全部 135 個策展景點、五個種子，沒填時間時一句帶 when 的都不該出現
  const whenTexts = [];
  for (const t of Object.values(phrases.themes || {})) {
    for (const f of ['questTitles', 'questHints']) for (const v of t[f] || []) if (v && v.when) whenTexts.push(String(v.t).replace(/\{\w+\}/g, '').trim());
  }
  let bad = 0; let total = 0;
  for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
    const r = await gen.generateForTrip({ tripId: seed, items: CURATED.map((p, i) => ({ placeId: p.id, day: 1 + (i % 5) })) });
    total += r.quests.length;
    for (const q of r.quests) for (const w of whenTexts) if (w.length >= 4 && (String(q.title).includes(w) || String(q.hint || '').includes(w))) bad++;
  }
  yes(total > 1000, `前置：五個種子共產生 ${total} 個任務`);
  yes(bad === 0, `沒填時間的 ${total} 個任務裡，帶時段假設的句子 0 句（改動前是 232 句）`, String(bad));
  // 對照組：同一批景點填上晚上的時間 → night 的句子出得來
  const night = await gen.generateForTrip({ tripId: 's1', items: CURATED.map((p, i) => ({ placeId: p.id, day: 1 + (i % 5), startMin: 19 * 60, stayMin: 90 })) });
  let nightHit = 0;
  for (const q of night.quests) for (const w of whenTexts) if (w.length >= 4 && (String(q.title).includes(w) || String(q.hint || '').includes(w))) nightHit++;
  yes(nightHit > 0, `對照組：改成晚上 19:00 到，帶時段的句子就出得來（${nightHit} 句）`);
}

// ---------- T8 照片任務的 id 是確定性的（同步不會變兩筆） ----------
console.log('\n— T8 照片任務不重複 —');
{
  const spotId = 'spot-abc';
  yes(gen.photoQuestId(spotId) === gen.photoQuestId(spotId) && gen.photoQuestId(spotId) === 'q-photo-spot-abc',
    `photoQuestId 是確定性的（${gen.photoQuestId(spotId)}）`);
  yes(gen.photoQuestId('spot-x') !== gen.photoQuestId('spot-y'), '不同景點不會撞在一起');
  // 兩台裝置離線各建一筆，走真的 merge.js（同步端就是逐筆 id 合併、沒有去重）
  const mk = (id, device, at) => ({ id, type: 'quest', tripId: 't', spotId, title: '某地的照片', source: 'photo', updatedAt: at, deviceId: device });
  const drain = (recs) => {                       // 模擬同步端：照 id 收進同一張表
    const byId = new Map();
    for (const r of recs) byId.set(r.id, mergeRecord(byId.get(r.id) || null, r).rec);
    return byId;
  };
  const deterministic = drain([mk(gen.photoQuestId(spotId), 'A', 1000), mk(gen.photoQuestId(spotId), 'B', 1001)]);
  yes(deterministic.size === 1, `兩台各建一次 → 合併後只有 1 筆（實際 ${deterministic.size}）`);
  yes([...deterministic.values()][0].title === '某地的照片', '合併後那一筆仍是照片任務');
  // 對照組：同樣兩台、同樣的操作，只把 id 換成隨機的 → 真的會變兩筆
  const { uuid } = await imp('js/ids.js');
  const random = drain([mk(uuid(), 'A', 1000), mk(uuid(), 'B', 1001)]);
  yes(random.size === 2, `對照組：改用隨機 id 的話會變成 ${random.size} 筆（這就是要用確定性 id 的原因）`);
}

// R9（geocode 的 jsonv2 欄位與火車站排序）驗在 geotest.mjs —— `geocodeSearch` 會讀
// IndexedDB 快取，純 Node 跑不起來（實測 `indexedDB is not defined`），而 geotest 本來
// 就有假的 Nominatim 端點。

console.log(`\n${process.exitCode ? '✗ 有失敗' : '✓ 全部通過'}（${pass} 項）`);
