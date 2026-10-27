// 海報與 AI 文案不把「照名字猜的主題」當成事實（npm run postertruthtest；秒級、不開瀏覽器）
//
// 涵蓋的程式：js/theme.js、js/poster/index.js、js/aicontent.js、js/quests/generate.js（loadPlaceLookup）
//
// 2026-10-27 查到（線上現況）：從分享連結匯入的景點不帶 theme，海報每天的主題章退回 themeForSpot() 照名字猜，
// 猜出來的類別名（例：名字以「山」結尾 → 🌿山林自然）印在海報上；AI 文案的 prompt 每天也附這個猜出來的類別名，
// AI 不知道那是猜的，會把它寫進「每天一句」。Dispatch 定：優先於繪本風改版（「改版是讓畫面更好看，這一條是讓畫面不說謊」）。
// 同一天再查到：景點**帶著的** theme 也是建立時照名字猜的——判準改成可信類別（trustedTheme：從景點庫重算，不看存著的值）。
//   P0 前置：合成景點的名字，舊寫法（themeForSpot）真的會猜成一個具體類別——不然後面「沒出現」是空驗
//   P1 那天沒有可信類別（不帶 theme、或帶著但不可信）→ 海報模型的當天主題是 null、主題章那一行是空字串
//   P2 海報模型整份（給畫海報用的全部資料）裡，沒有任何主題的類別名
//   P3 可信類別的那天，主題章照印（反方向：不是把主題章整個關掉）；而且印的是景點庫的分類，不是存著的值
//   P4 一天裡有可信、有不可信 → 只算可信的
//   P5 整趟主題（決定配色）：都不可信是 null；有可信就照可信的
//   P6 送給 AI 的「每天」那幾行：沒有可信類別的那天沒有任何類別名；可信的那天有
//   P7 景點庫沒載好（lookup 沒給）→ 什麼都不印（保守方向）
// 入口：modelFrom（buildModel 的純函式那一半）、digestFrom＋tripTextDayList（ensureTripText 組 prompt 的那一半）。
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
const { modelFrom, stampText } = await import('../js/poster/index.js');
const { digestFrom, tripTextDayList } = await import('../js/aicontent.js');
const { loadPlaceLookup } = await import('../js/quests/generate.js');
const T = await theme.loadThemes();
const lookup = await loadPlaceLookup();

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

// 所有主題的類別名（含中性的「旅途」）——P2／P6 要它們一個都不出現
const LABELS = Object.values(T.themes).map((x) => x.label);
const labelsIn = (text) => LABELS.filter((l) => text.includes(l));
yes(LABELS.length >= 10 && LABELS.includes('山林自然') && LABELS.includes('旅途'), `前置：讀得到主題表（${LABELS.length} 個類別名）`);
// 對照組：同一個 labelsIn 對一段含類別名的字必須抓到（不然 P2／P6 的「沒有」是空驗）
yes(labelsIn('第1天（宜蘭，山林自然）：甲山').join() === '山林自然', '對照組：labelsIn 抓得到放進去的類別名');
yes(labelsIn('第1天（宜蘭）：甲山、乙溪').length === 0, '對照組：labelsIn 對沒有類別名的字回 0 個');

// 合成行程（名字是造的；可信的那幾站用景點庫裡真的「梧棲漁港」tc-wuqi：景點庫 food、照名字猜 coast）。
// 第 1 天：一個不帶 theme（分享匯入）、一個帶著 food 但名字被改過（複核不通過）——都不可信
// 第 2 天：梧棲漁港，存著舊寫法猜的 coast → 可信類別是景點庫的 food
// 第 3 天：一個梧棲漁港（可信 food）、兩個存著 nature 的分享景點（舊的 storedThemeOf 會算 nature 兩票）
const WUQI = { name: '梧棲漁港', region: '台中市', source: 'curated', placeId: 'tc-wuqi' };
const trip = { id: 't', groupId: 'g', title: '合成行程', region: '合成縣' };
const spots = [
  { id: 's1', name: '甲山', day: 1, order: 0, source: 'shared' },
  { id: 's2', ...WUQI, name: '乙溪', day: 1, order: 1, theme: 'food' },
  { id: 's3', ...WUQI, day: 2, order: 0, theme: 'coast' },
  { id: 's5', ...WUQI, day: 3, order: 0, theme: 'coast' },
  { id: 's6', name: '己山', day: 3, order: 1, source: 'shared', theme: 'nature' },
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

const m = model(spots);
const d1 = m.days.find((d) => d.day === 1), d2 = m.days.find((d) => d.day === 2), d3 = m.days.find((d) => d.day === 3);
// P1
yes(d1 && d1.theme === null && stampText(d1) === '', `P1 第 1 天沒有可信類別（一個沒帶、一個帶著但複核不通過）→ 當天主題 null、不印主題章（實得 ${d1 && d1.theme}、「${d1 && stampText(d1)}」）`);
// P2：只有第 1 天時，整份模型裡沒有任何類別名
const m1 = model(spots.filter((s) => s.day === 1));
const leak = labelsIn(JSON.stringify(m1) + m1.days.map(stampText).join(''));
yes(leak.length === 0, `P2 只有第 1 天時，整份海報模型＋主題章裡沒有任何類別名（實得 ${leak.join('、') || '0 個'}）`);
// P3
yes(d2 && stampText(d2) === '🍜 美食', `P3 第 2 天梧棲漁港 → 主題章印景點庫的「🍜 美食」、不是存著的 coast（實得「${d2 && stampText(d2)}」）`);
// P4
yes(d3 && d3.theme === 'food', `P4 第 3 天一個可信 food、兩個存著 nature 的 → 只算可信的，是 food（實得 ${d3 && d3.theme}；只看帶著的是 nature）`);
// P5
yes(m1.tripTheme === null && m.tripTheme === 'food', `P5 整趟主題：都不可信是 null（實得 ${m1.tripTheme}）、有可信就照可信的（實得 ${m.tripTheme}）`);

// P6
const lines = tripTextDayList(digestFrom(trip, spots, lookup)).split('\n');
const l1 = lines.find((l) => l.startsWith('第1天')) || '', l2 = lines.find((l) => l.startsWith('第2天')) || '';
yes(l1.includes('甲山') && labelsIn(l1).length === 0, `P6 送給 AI 的第 1 天那行沒有任何類別名（「${l1}」）`);
yes(labelsIn(l2).join() === '美食', `P6 可信 food 的第 2 天那行有「美食」（「${l2}」）`);

// P7
const m7 = model(spots, null);
const l7 = tripTextDayList(digestFrom(trip, spots));
yes(m7.days.every((d) => d.theme === null && stampText(d) === '') && m7.tripTheme === null && labelsIn(l7).length === 0,
  `P7 景點庫沒載好（lookup 沒給）→ 海報沒有主題章、AI 的每天那幾行沒有類別名（實得 ${m7.days.map((d) => d.theme).join(',')}；${labelsIn(l7).join('、') || '0 個'}）`);

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
