// 海報與 AI 文案不把「照名字猜的主題」當成事實（npm run postertruthtest；秒級、不開瀏覽器）
//
// 涵蓋的程式：js/theme.js、js/poster/index.js、js/poster/presets.js、js/aicontent.js、js/quests/generate.js（loadPlaceLookup）
//
// 2026-10-27 查到（線上現況）：從分享連結匯入的景點不帶 theme，海報每天的主題章退回 themeForSpot() 照名字猜，
// 猜出來的類別名（例：名字以「山」結尾 → 🌿山林自然）印在海報上；AI 文案的 prompt 每天也附這個猜出來的類別名，
// AI 不知道那是猜的，會把它寫進「每天一句」。Dispatch 定：優先於繪本風改版（「改版是讓畫面更好看，這一條是讓畫面不說謊」）。
// 同一天再查到：景點**帶著的** theme 也是建立時照名字猜的——判準改成可信類別（trustedTheme：從景點庫重算，不看存著的值）。
// Dispatch 同一天裁定：海報**一律不印類別**（連可信的也不印）——沒有主題章、主題插圖、每站 emoji；可信類別只決定配色。
//   P0 前置：合成景點的名字，舊寫法（themeForSpot）真的會猜成一個具體類別——不然後面「沒出現」是空驗
//   P1 那天沒有可信類別（不帶 theme、或帶著但不可信）→ 海報模型的當天主題是 null（配色退回中性）
//   P2 海報模型整份（給畫海報用的全部資料）裡，沒有任何類別名、沒有任何類別 emoji、沒有每站 emoji 欄位——連可信的那天也沒有
//   P3 可信類別的那天，配色照用（反方向：不是把主題整個關掉）；而且用的是景點庫的分類，不是存著的值
//   P4 一天裡有可信、有不可信 → 只算可信的
//   P5 整趟主題（決定配色）：都不可信是 null；有可信就照可信的
//   P6 送給 AI 的「每天」那幾行：沒有可信類別的那天沒有任何類別名；可信的那天有
//   P7 景點庫沒載好（lookup 沒給）→ 什麼都不印（保守方向）
//   P8 配色只換顏色：styleFor 拿到有插圖、有燈籠串時間軸的主題，插圖與時間軸照樣是中性的
//   P9 繪製程式（js/poster/*.js 去掉註解）不讀類別名、不讀 emoji——模型裡沒有，畫的那一半也不能自己去拿
// 入口：modelFrom（buildModel 的純函式那一半）、styleFor、digestFrom＋tripTextDayList（ensureTripText 組 prompt 的那一半）。
// 從「回顧 → 做海報」真實入口、攔下實際送往 Anthropic 的請求內容那兩條在瀏覽器，見 docs/VERIFY_第1批.md。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// theme.js、generate.js 用 fetch 讀 data/；node 底下換成讀檔（只供應 themes.json 與 data/places/，其餘照樣失敗）
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s !== './data/themes.json' && !/^\.\/data\/places\/[\w-]+\.json$/.test(s)) throw new Error('postertruthtest 不供應：' + s);
  const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
const { modelFrom } = await import('../js/poster/index.js');
const { styleFor, PRESETS } = await import('../js/poster/presets.js');
const { digestFrom, tripTextDayList } = await import('../js/aicontent.js');
const { loadPlaceLookup } = await import('../js/quests/generate.js');
const T = await theme.loadThemes();
const lookup = await loadPlaceLookup();

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

// 所有主題的類別名（含中性的「旅途」）與類別 emoji——P2／P6 要它們一個都不出現
const LABELS = Object.values(T.themes).map((x) => x.label);
const EMOJIS = Object.values(T.themes).map((x) => x.emoji).filter(Boolean);
const labelsIn = (text) => LABELS.filter((l) => text.includes(l));
const emojisIn = (text) => EMOJIS.filter((e) => text.includes(e));
yes(LABELS.length >= 10 && LABELS.includes('山林自然') && LABELS.includes('旅途') && EMOJIS.length >= 10,
  `前置：讀得到主題表（${LABELS.length} 個類別名、${EMOJIS.length} 個類別 emoji）`);
// 對照組：同一個 labelsIn／emojisIn 對一段含類別名／emoji 的字必須抓到（不然 P2／P6 的「沒有」是空驗）
yes(labelsIn('第1天（宜蘭，山林自然）：甲山').join() === '山林自然', '對照組：labelsIn 抓得到放進去的類別名');
yes(labelsIn('第1天（宜蘭）：甲山、乙溪').length === 0, '對照組：labelsIn 對沒有類別名的字回 0 個');
yes(emojisIn(`{"x":"${T.themes.food.emoji}"}`).length === 1 && emojisIn('{"x":"甲山"}').length === 0, '對照組：emojisIn 抓得到放進去的類別 emoji、沒放就是 0 個');

// 合成行程（名字是造的；可信的那幾站用景點庫裡真的「梧棲漁港」tc-wuqi：景點庫 food、照名字猜 coast）。
// 第 1 天：一個不帶 theme（分享匯入）、一個帶著 food 但名字被改過（複核不通過）——都不可信
// 第 2 天：梧棲漁港，存著舊寫法猜的 coast → 可信類別是景點庫的 food
// 第 3 天：一個梧棲漁港（可信 food）、兩個存著 nature 的分享景點（舊的 storedThemeOf 會算 nature 兩票）
// 每一站都帶 emoji（存著的值，有的是猜的）——P2 驗它沒有進模型
const WUQI = { name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi', emoji: '🐟' };
const trip = { id: 't', groupId: 'g', title: '合成行程', region: '合成縣' };
const spots = [
  { id: 's1', name: '甲山', day: 1, order: 0, source: 'shared', emoji: T.themes.nature.emoji },
  { id: 's2', ...WUQI, name: '乙溪', day: 1, order: 1, theme: 'food' },
  { id: 's3', ...WUQI, day: 2, order: 0, theme: 'coast' },
  { id: 's5', ...WUQI, day: 3, order: 0, theme: 'coast' },
  { id: 's6', name: '己山', day: 3, order: 1, source: 'shared', theme: 'nature', emoji: T.themes.nature.emoji },
  { id: 's7', name: '庚山', day: 3, order: 2, source: 'shared', theme: 'nature' },
];
const none = () => [];
const model = (list, lk = lookup) => modelFrom({ trip, spots: list, members: [], aiTx: {}, questsOf: none, submissionsOf: none, lookup: lk });

// P0
const guessed = ['甲山', '乙溪', '己山', '庚山'].map((n) => theme.themeForSpot({ name: n }));
yes(guessed.every((k) => k === 'nature'), `P0 前置：舊寫法會把「甲山」「乙溪」「己山」「庚山」照名字猜成 nature（實得 ${guessed.join('、')}）`);
yes(theme.themeForSpot({ name: '梧棲漁港' }) === 'coast' && lookup && lookup.placeById('tc-wuqi')?.primary === 'food',
  'P0 前置：「梧棲漁港」照名字猜 coast、景點庫是 food——P3 才分得出用的是哪一邊');
const oldD3 = theme.storedThemeOf(spots.filter((s) => s.day === 3));
yes(oldD3 === 'nature', `P0 前置：只看帶著的 theme（storedThemeOf）算第 3 天是 nature（實得 ${oldD3}）——P4 才分得出新舊`);
const fp = T.themes.food.poster, cp = T.themes.coast.poster;
yes(fp && cp && fp.accent && fp.accent !== cp.accent, `P0 前置：food 與 coast 的配色不同（${fp && fp.accent}／${cp && cp.accent}）——P3 才分得出用的是哪一邊`);

const m = model(spots);
const d1 = m.days.find((d) => d.day === 1), d2 = m.days.find((d) => d.day === 2), d3 = m.days.find((d) => d.day === 3);
const wc = PRESETS.watercolor;
// P1
yes(d1 && d1.theme === null && styleFor(wc, theme.themeMeta(d1.theme)).accent === wc.accent,
  `P1 第 1 天沒有可信類別（一個沒帶、一個帶著但複核不通過）→ 當天主題 null、配色是水彩自己的（實得 ${d1 && d1.theme}）`);
// P2：整份模型（含可信的第 2、3 天）裡沒有任何類別名、類別 emoji，項目沒有 emoji 欄位
const all = JSON.stringify(m);
yes(labelsIn(all).length === 0 && emojisIn(all).length === 0 && m.days.every((d) => d.items.every((it) => !('emoji' in it))),
  `P2 整份海報模型（含可信的那幾天）沒有類別名、沒有類別 emoji、項目沒有 emoji 欄位（實得 ${[...labelsIn(all), ...emojisIn(all)].join('、') || '0 個'}）`);
// P3
const s2 = d2 && styleFor(wc, theme.themeMeta(d2.theme));
yes(d2 && d2.theme === 'food' && s2.accent === fp.accent,
  `P3 第 2 天梧棲漁港 → 配色用景點庫的 food（${fp.accent}）、不是存著的 coast（實得 ${d2 && d2.theme}、${s2 && s2.accent}）`);
// P4
yes(d3 && d3.theme === 'food', `P4 第 3 天一個可信 food、兩個存著 nature 的 → 只算可信的，是 food（實得 ${d3 && d3.theme}；只看帶著的是 nature）`);
// P5
const m1 = model(spots.filter((s) => s.day === 1));
yes(m1.tripTheme === null && m.tripTheme === 'food', `P5 整趟主題：都不可信是 null（實得 ${m1.tripTheme}）、有可信就照可信的（實得 ${m.tripTheme}）`);

// P6
const lines = tripTextDayList(digestFrom(trip, spots, lookup)).split('\n');
const l1 = lines.find((l) => l.startsWith('第1天')) || '', l2 = lines.find((l) => l.startsWith('第2天')) || '';
yes(l1.includes('甲山') && labelsIn(l1).length === 0, `P6 送給 AI 的第 1 天那行沒有任何類別名（「${l1}」）`);
yes(labelsIn(l2).join() === '美食', `P6 可信 food 的第 2 天那行有「美食」（「${l2}」）`);

// P7
const m7 = model(spots, null);
const l7 = tripTextDayList(digestFrom(trip, spots));
yes(m7.days.every((d) => d.theme === null) && m7.tripTheme === null && labelsIn(l7).length === 0,
  `P7 景點庫沒載好（lookup 沒給）→ 海報配色全部中性、AI 的每天那幾行沒有類別名（實得 ${m7.days.map((d) => d.theme).join(',')}；${labelsIn(l7).join('、') || '0 個'}）`);

// P8：找一個帶插圖、帶非 dot 時間軸的主題當前置（不然「是中性的」是空驗）
const decoKey = Object.keys(T.themes).find((k) => (T.themes[k].deco || []).length && T.themes[k].timeline && T.themes[k].timeline !== 'dot');
yes(!!decoKey, `P8 前置：主題表裡有帶插圖、時間軸不是 dot 的主題（${decoKey}：${decoKey && T.themes[decoKey].deco.join('、')}／${decoKey && T.themes[decoKey].timeline}）`);
const bad = Object.values(PRESETS).map((pr) => [pr.id, styleFor(pr, theme.themeMeta(decoKey))]).filter(([, st]) => st.deco !== null || st.timeline !== 'dot');
yes(decoKey && bad.length === 0, `P8 三種風格拿到 ${decoKey}，插圖都是 null、時間軸都是 dot（不對的：${bad.map(([id]) => id).join('、') || '沒有'}）`);

// P9：繪製程式不讀類別名、emoji（去掉 // 註解再掃；PRESETS 的 label 是風格按鈕名，只准 presetList 那一處）
const codeOf = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, ''));
const READS = /\.(label|emoji)\b/;
const ALLOWED = [['js/poster/index.js', 'return Object.values(PRESETS).map((p) => ({ id: p.id, label: p.label }));']];
const hits = (files) => files.flatMap((f) => codeOf(f).map((l, i) => [f, i + 1, l.trim()]))
  .filter(([f, , l]) => READS.test(l) && !ALLOWED.some(([af, al]) => af === f && l === al));
const pfiles = fs.readdirSync(path.join(ROOT, 'js/poster')).filter((f) => f.endsWith('.js')).map((f) => 'js/poster/' + f);
// 對照組：在 .logs/ 造一支真的 .js 檔、走同一個 codeOf＋hits；一行讀 .label 要抓到、註解裡的不算
const ctlDir = path.join(ROOT, '.logs', 'postertruth-ctl');
fs.mkdirSync(ctlDir, { recursive: true });
const ctlFile = path.join(ctlDir, 'a.js');
fs.writeFileSync(ctlFile, "// 註解裡寫 tm.label 不算\nctx.fillText(themeMeta(d.theme).label, 0, 0);\n");
const ctlRel = path.relative(ROOT, ctlFile).split(path.sep).join('/');
const ctlHits = hits([ctlRel]);
yes(fs.readFileSync(ctlFile, 'utf8').includes(').label,') && ctlHits.length === 1 && ctlHits[0][1] === 2,
  `對照組：P9 的掃描抓得到真檔裡讀 .label 的那一行、註解那行不算（抓到 ${ctlHits.map((h) => '第' + h[1] + '行').join('、') || '0 行'}）`);
const ph = hits(pfiles);
yes(pfiles.length >= 3 && ph.length === 0,
  `P9 js/poster/ 底下 ${pfiles.length} 支 .js 去掉註解後，不讀 .label、.emoji（風格按鈕名那一處登記放行；命中：${ph.map((h) => h[0] + ':' + h[1]).join('、') || '0 處'}）`);

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
