// 行程表解析（npm run itintest）
//
// 這支不開瀏覽器 —— 解析器是純函式，直接餵真實世界會出現的髒資料。
// 案例都不是我編的理想輸入：LINE 轉貼、旅行社 PDF 複製、Excel 貼上、
// 手機 OCR 出來的一整行、長輩自己打的口語行程。
//
// 最重要的一組是「壓成一行」：那種輸入不會報錯，會安靜地生出一個
// 名字超長的垃圾景點，整趟就這樣毀掉。所以它有獨立的斷言。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseItinerary, fromRows, normalize, fmtTime, fmtStay, parseDuration } from '../js/itinerary.js';

let pass = 0;
const ok = (m) => { pass++; console.log('✓ ' + m); };
const fail = (m, extra) => { console.error('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; };
const eq = (got, want, m) => (got === want ? ok(m) : fail(m, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
const yes = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const names = (r) => r.items.map((i) => i.name);
const spot = (r, n) => r.items.find((i) => i.name === n);

// ---------- 1. 基本：一天一行，時間在前 ----------
{
  const r = parseItinerary(`
第1天
09:00 清水寺
11:30 金閣寺
14:00 - 16:30 錦市場
第2天
10:00 大阪城
`);
  eq(r.items.length, 4, '基本格式：抓到 4 個景點');
  eq(names(r).join(','), '清水寺,金閣寺,錦市場,大阪城', '基本格式：名稱正確');
  eq(spot(r, '清水寺').day, 1, '基本格式：第 1 天');
  eq(spot(r, '大阪城').day, 2, '基本格式：第 2 天');
  eq(fmtTime(spot(r, '金閣寺').startMin), '11:30', '基本格式：時間正確');
  eq(spot(r, '錦市場').stayMin, 150, '區間時間：停留 150 分鐘');
  eq(spot(r, '錦市場').stayGuess, false, '區間時間：停留不是用猜的');
  eq(spot(r, '清水寺').stayMin, null, '沒寫停留就留空，不亂填');
}

// ---------- 2. 中文時間、口語 ----------
{
  const r = parseItinerary(`
第一天 早上9點 士林夜市
下午2點半 故宮博物院
晚上 饒河街夜市
第二天 10點30分 淡水老街 停留2小時
`);
  eq(fmtTime(spot(r, '士林夜市').startMin), '09:00', '中文時間：早上9點 → 09:00');
  eq(fmtTime(spot(r, '故宮博物院').startMin), '14:30', '中文時間：下午2點半 → 14:30');
  eq(spot(r, '饒河街夜市').timeApprox, true, '模糊時段：標記成「我猜的」');
  eq(fmtTime(spot(r, '淡水老街').startMin), '10:30', '中文時間：10點30分');
  eq(spot(r, '淡水老街').stayMin, 120, '明寫停留：2小時 → 120 分');
  eq(spot(r, '淡水老街').day, 2, '中文天數：第二天');
  yes(!spot(r, '淡水老街').name.includes('停留'), '明寫停留：時長不會留在名字裡');
}

// ---------- 3. 整張表被壓成一行（OCR／複製貼上最常見的災難）----------
{
  const r = parseItinerary('第1天 09:00 東大寺 11:00 春日大社 13:00 奈良公園 15:30 興福寺');
  eq(r.items.length, 4, '壓成一行：拆回 4 筆');
  eq(names(r).join(','), '東大寺,春日大社,奈良公園,興福寺', '壓成一行：名稱各自獨立');
  eq(fmtTime(spot(r, '興福寺').startMin), '15:30', '壓成一行：時間跟著對');
  yes(r.warnings.some((w) => w.includes('擠成一整行')), '壓成一行：有提醒使用者確認');
  yes(!r.items.some((i) => i.name.length > 20), '壓成一行：沒有產生超長垃圾名稱');
}
{
  // 連天標記都在同一行
  const r = parseItinerary('第1天 09:00 台北101 第2天 09:00 九份老街');
  eq(r.items.length, 2, '一行含兩天：拆成 2 筆');
  eq(spot(r, '台北101') && spot(r, '台北101').day, 1, '一行含兩天：第一筆在第 1 天');
  eq(spot(r, '九份老街') && spot(r, '九份老街').day, 2, '一行含兩天：第二筆在第 2 天');
}

// ---------- 3b. 但不要切過頭：括號、破折號區間 ----------
{
  // 回歸：「【第1天】」曾經在 `第1天` 前面被切一刀，生出一個叫「【」的景點
  const r = parseItinerary('【第1天】\n09:00 台北101\n【第2天】\n09:00 九份老街');
  eq(r.items.length, 2, '【第N天】：不會生出多餘的括號景點');
  yes(!names(r).some((n) => /^[【\[]/.test(n)), '【第N天】：沒有叫「【」的景點');
  eq(spot(r, '九份老街').day, 2, '【第N天】：第 2 天讀得到');
  yes(!r.warnings.some((w) => w.includes('擠成一整行')), '【第N天】：不該誤報「被擠成一行」');
}
{
  const r = parseItinerary('第1天\n14:00 - 16:30 錦市場');
  eq(r.items.length, 1, '區間不被誤切：只有 1 筆');
  eq(spot(r, '錦市場').stayMin, 150, '區間不被誤切：停留還是 150 分');
}
{
  // 只有時間、沒有名字（OCR 讀到時間欄、名字欄糊掉）→ 明確算「看不懂」
  const r = parseItinerary('第1天\n09:00 清水寺\n15:00');
  eq(r.items.length, 1, '只有時間沒名字：不會建立空景點');
  yes(r.unparsed.includes('15:00'), '只有時間沒名字：列進「看不懂的行」讓人自己補');
}

// ---------- 4. 不要把不是時間的數字當時間 ----------
{
  const r = parseItinerary(`
第1天
10:00 7-11 中山門市集合
11:00 85度C 買咖啡
12:00 鼎泰豐 101店
`);
  eq(r.items.length, 3, '假時間：沒有被切成一堆碎片');
  yes(names(r).some((n) => n.includes('7-11')), '假時間：7-11 不會被當成時間切開');
  yes(names(r).some((n) => n.includes('85')), '假時間：85度C 保留');
  yes(names(r).some((n) => n.includes('鼎泰豐')), '假時間：鼎泰豐 101店 保留');
}

// ---------- 5. 剝雜訊：交通、票價、備註 ----------
{
  const r = parseItinerary(`
第1天
09:00 淺草寺（搭地鐵銀座線 約20分鐘）
11:00 東京晴空塔 門票2100日圓
13:00 上野公園 步行10分鐘
`);
  eq(names(r).join(','), '淺草寺,東京晴空塔,上野公園', '剝雜訊：交通／票價／步行時間都清掉了');
  yes(r.items.every((i) => i.stayMin == null), '剝雜訊：交通時間不會被當成停留時間');
}
{
  // 回歸：「（搭公車 約20分鐘）」曾經變成「停留 20 分」
  const r = parseItinerary('第1天\n11:30 清水寺（搭公車 約20分鐘）\n15:00 二條城 停留1小時');
  eq(spot(r, '清水寺').stayMin, null, '搭公車 20 分鐘：不是停留時間');
  eq(spot(r, '二條城').stayMin, 60, '停留1小時：這個才是停留時間');
}
{
  // 交通字眼離數字有一段距離時也要擋（「（搭地鐵銀座線 約20分鐘）」）
  const r = parseItinerary('第1天\n09:00 淺草寺（搭地鐵銀座線 約20分鐘）');
  eq(spot(r, '淺草寺').stayMin, null, '交通字眼隔了幾個字也擋得住');
}
{
  // 反過來：明寫「停留」時，前面提到交通工具也不能因此被誤擋
  const r = parseItinerary('第1天\n10:00 搭地鐵到清水寺 停留2小時');
  eq(r.items.length, 1, '「搭地鐵到清水寺」：交通描述不會把景點整句吃掉');
  eq(spot(r, '清水寺') && spot(r, '清水寺').stayMin, 120, '明寫停留時，前面的交通字眼不影響');
}

// ---------- 6. 用餐與非景點 ----------
{
  const r = parseItinerary(`
第1天
08:00 飯店早餐
12:00 午餐：一蘭拉麵
14:00 京都車站
18:00 晚餐（自理）
21:00 Check in 東橫INN
`);
  yes(names(r).includes('一蘭拉麵'), '用餐：「午餐：一蘭拉麵」取出店名');
  const ci = r.items.find((i) => /check\s*in/i.test(i.name));
  yes(ci && ci.include === false, 'Check in：預設不建立景點（但保留讓人勾回來）');
  const dinner = r.items.find((i) => i.name === '晚餐');
  yes(!dinner || dinner.include !== undefined, '晚餐（自理）：沒有店名不會變成怪景點');
}

// ---------- 7. 沒有天標記 ----------
{
  const r = parseItinerary('清水寺\n金閣寺\n伏見稻荷');
  eq(r.items.length, 3, '無天標記：3 筆');
  yes(r.items.every((i) => i.day === 1), '無天標記：全部放第 1 天');
  yes(r.warnings.some((w) => w.includes('第幾天')), '無天標記：有明講「我全放第1天」');
  yes(r.items.every((i) => i.warnings.includes('這一行沒有時間')), '無時間：每一筆都標出來');
}

// ---------- 8. 日期當換天 ----------
{
  const r = parseItinerary(`
9/12
09:00 首爾塔
9/13
09:00 景福宮
`);
  eq(spot(r, '首爾塔').day, 1, '日期換天：9/12 → 第 1 天');
  eq(spot(r, '景福宮').day, 2, '日期換天：9/13 → 第 2 天');
}
{
  // 天號從 Day 0 或 Day 3 開始也要收斂成 1..N
  const r = parseItinerary('Day 3 09:00 甲地\nDay 4 09:00 乙地');
  eq(spot(r, '甲地').day, 1, '天號重排：Day 3 → 第 1 天');
  eq(spot(r, '乙地').day, 2, '天號重排：Day 4 → 第 2 天');
}

// ---------- 9. LINE 轉貼／項目符號／全形 ----------
{
  const r = parseItinerary(`
＞ 第１天
・０９：００　龍山寺
• 11:00 西門町
1. 13:00 中正紀念堂
`);
  eq(r.items.length, 3, '髒格式：3 筆');
  eq(names(r).join(','), '龍山寺,西門町,中正紀念堂', '髒格式：全形／項目符號／序號都清掉');
  eq(fmtTime(spot(r, '龍山寺').startMin), '09:00', '髒格式：全形數字時間讀得出來');
}

// ---------- 10. 頓號分隔（沒有時間時才拆）----------
{
  const r = parseItinerary('第1天 清水寺、金閣寺、二條城');
  eq(r.items.length, 3, '頓號：拆成 3 個景點');
  const r2 = parseItinerary('第1天\n09:00 清水寺、地主神社');
  eq(r2.items.length, 1, '有時間時不拆頓號：拆了時間會對不上');
}

// ---------- 11. AI 回來的列走同一套守門 ----------
{
  const r = fromRows([
    { day: 1, start: '09:00', end: '11:00', name: '首爾塔' },
    { day: 1, start: '13:00', stayMin: 90, name: '明洞', uncertain: true },
    { day: 2, start: '99:99', name: '弘大' },
    { day: 2, name: '', start: '10:00' },
    { day: 2, start: '10:00', name: 'Check out 飯店' },
  ]);
  eq(r.items.length, 4, 'AI 列：空名稱那筆被丟掉');
  eq(spot(r, '首爾塔').stayMin, 120, 'AI 列：用起訖算出停留');
  eq(spot(r, '明洞').stayMin, 90, 'AI 列：stayMin 直接採用');
  yes(spot(r, '明洞').warnings.some((w) => w.includes('不太確定')), 'AI 列：uncertain 有標出來');
  eq(spot(r, '弘大').startMin, null, 'AI 列：99:99 這種壞時間丟掉不採用');
  yes(r.warnings.some((w) => w.includes('沒有名字')), 'AI 列：有回報跳過幾筆');
  const co = r.items.find((i) => /check\s*out/i.test(i.name));
  yes(co && co.include === false, 'AI 列：Check out 一樣不建立景點');
}

// ---------- 12. 邊界 ----------
{
  eq(parseItinerary('').items.length, 0, '空字串：0 筆、不爆炸');
  eq(parseItinerary(null).items.length, 0, 'null：0 筆、不爆炸');
  eq(parseItinerary('   \n\n  ').items.length, 0, '只有空白：0 筆');
  eq(normalize('Ａ　Ｂ'), 'A B', 'normalize：全形轉半形');
  eq(fmtStay(90), '1 小時 30 分', 'fmtStay：90 分 → 1 小時 30 分');
  eq(fmtStay(45), '45 分鐘', 'fmtStay：45 分鐘');
  eq(fmtTime(null), '', 'fmtTime：null → 空字串');
  const long = parseItinerary('第1天 09:00 ' + '長'.repeat(40));
  yes(long.items[0].warnings.some((w) => w.includes('名字有點長')), '超長名稱：有標記要人確認');
}

// ---------- 13. 真實案例：旅行社 PDF 複製出來的樣子 ----------
{
  const r = parseItinerary(`
【第1天】桃園機場／關西機場－大阪
08:40 桃園國際機場集合
12:15 關西國際機場
15:00 心齋橋商店街 停留2小時
19:00 道頓堀 (晚餐自理)
住宿：大阪難波東橫INN

【第2天】大阪－京都
09:00 伏見稻荷大社 約1.5小時
11:30 清水寺
14:00 祇園、花見小路
`);
  eq(spot(r, '心齋橋商店街').day, 1, '旅行社格式：第 1 天');
  eq(spot(r, '心齋橋商店街').stayMin, 120, '旅行社格式：停留2小時');
  eq(spot(r, '伏見稻荷大社').day, 2, '旅行社格式：第 2 天');
  eq(spot(r, '伏見稻荷大社').stayMin, 90, '旅行社格式：約1.5小時 → 90 分');
  yes(names(r).includes('清水寺'), '旅行社格式：清水寺');
  yes(!names(r).some((n) => n.includes('晚餐自理')), '旅行社格式：括號備註不變成名字');
  const dt = spot(r, '道頓堀');
  yes(dt && dt.day === 1, '旅行社格式：道頓堀在第 1 天');
  // 回歸：「【第1天】桃園機場／關西機場－大阪」的「大阪」是當天路線，不是要去拍照的地方
  yes(!names(r).some((n) => /關西機場|^大阪$|^大阪-京都$/.test(n)), '旅行社格式：天標題那一行不會變成景點');
}
{
  // 但整份都沒有時間時，天標記後面接的就真的是景點清單
  const r = parseItinerary('第1天 清水寺、金閣寺\n第2天 大阪城');
  eq(r.items.length, 3, '無時間的行程：天標記後面照樣當景點讀');
  eq(names(r).join(','), '清水寺,金閣寺,大阪城', '無時間的行程：三個都在');
}

// ---------- 14. 停留時長的各種寫法 ----------
// 「03時07分」原本會 match 到「07分」→ 存進 7 分鐘。不是讀不出來，是**默默存錯**。
{
  const cases = [
    ['01時00分', 60], ['03時07分', 187], ['11時00分', 660], ['00時20分', 20], ['00時00分', 0],
    ['01時12分', 72], ['1小時30分', 90], ['1.5小時', 90], ['90分鐘', 90], ['30分', 30],
    ['1h30m', 90], ['2h', 120], ['一個半小時', 90], ['兩小時', 120], ['停留 01:00', 60],
    ['約20分鐘', 20], ['3 hrs', 180], ['45min', 45],
  ];
  for (const [s, want] of cases) {
    const got = parseDuration(s);
    eq(got && got.min, want, `時長「${s}」= ${want} 分`);
  }
  eq(parseDuration('沒有時長'), null, '沒有時長時回 null');
}

// ---------- 15. 旅程標題 ----------
{
  const r = parseItinerary('行程名稱：宜蘭遊\n\n第1天\n09:00 羅東夜市');
  eq(r.title, '宜蘭遊', '「行程名稱：宜蘭遊」讀成標題');
  eq(r.items.length, 1, '標題那一行不會變成景點');
  eq(names(r).join(','), '羅東夜市', '只剩真正的景點');
}
{
  for (const [line, want] of [['旅程：京都五日', '京都五日'], ['標題: 北海道之旅', '北海道之旅'], ['Trip: Tokyo 2026', 'Tokyo 2026']]) {
    const r = parseItinerary(`${line}\n第1天\n09:00 甲地`);
    eq(r.title, want, `標題寫法「${line.split(/[:：]/)[0]}」讀得出來`);
  }
}
{
  // 沒有標籤時，只認表頭區長得像行程名的一行
  const r = parseItinerary('京都三日遊\n第1天\n09:00 清水寺');
  eq(r.title, '京都三日遊', '表頭的「京都三日遊」當標題');
  eq(r.items.length, 1, '不會變成景點');
}
{
  // 沒有結構時不要亂猜 —— 第一行是真的景點
  const r = parseItinerary('清水寺\n金閣寺\n伏見稻荷');
  eq(r.title, '', '整份沒有天標記也沒有時間時不猜標題');
  eq(r.items.length, 3, '第一行仍然是景點');
}
{
  // 真正的景點不會被當標題：它有時間、也不在表頭
  const r = parseItinerary('第1天\n09:00 宜蘭傳藝中心\n11:00 羅東夜市');
  eq(r.title, '', '有時間的景點行不會被當標題');
  eq(r.items.length, 2, '兩個景點都在');
}

// ---------- 16. 使用者的真實行程表（宜蘭遊）----------
// 這份是長輩實際貼進來的 Google 地圖行程匯出，抓到三個真 bug 才有這一節。
{
  const raw = readFileSync(fileURLToPath(new URL('./fixtures/yilan.txt', import.meta.url)), 'utf8');
  const r = parseItinerary(raw);
  const g = (n) => r.items.find((x) => x.name === n);

  eq(r.title, '宜蘭遊', '真實資料：讀到旅程名稱');
  eq(r.items.length, 32, '真實資料：32 筆（33 行扣掉標題）');
  eq(r.unparsed.length, 0, '真實資料：沒有讀不懂的行');
  eq(new Set(r.items.map((x) => x.day)).size, 3, '真實資料：3 天');

  // 一小時以上的停留（原本全掛）
  eq(g('白雲山鹿').stayMin, 60, '真實資料：01時00分 = 60 分');
  eq(g('香草菲菲 芳香植物博物館').stayMin, 187, '真實資料：03時07分 = 187 分（原本存成 7）');
  eq(g('山風民宿hillstay').stayMin, 72, '真實資料：01時12分 = 72 分（原本存成 12）');
  eq(r.items.filter((x) => x.day === 3)[0].stayMin, 660, '真實資料：11時00分 = 660 分');
  eq(g('東南蜜餞舖').stayMin, 20, '真實資料：00時20分 = 20 分');

  // 店名清理
  yes(g('火山爆發雞礁溪總店'), '真實資料：emoji 與「｜」後面的廣告詞清掉了');
  yes(g('玉里橋頭臭豆腐 礁溪店'), '真實資料：關鍵字堆疊切掉了');
  yes(g('石頭鄉燜烤玉米-羅東總店'), '真實資料：「（看清楚店名再評論）」清掉了');
  yes(g('火烤碳香-真珠玉米'), '真實資料：尾巴的「(羅東店)」清掉了');
  yes(g('金丹早餐(原力行早餐)'), '真實資料：正常的括號別名不會被誤切');
  yes(!r.items.some((x) => /停留|時\d|分\)/.test(x.name)), '真實資料：沒有景點名字夾到「停留」殘骸');

  // 預設不建立的那幾筆
  const homes = r.items.filter((x) => x.name === '家');
  eq(homes.length, 2, '真實資料：兩筆「家」');
  yes(homes.every((x) => !x.include), '真實資料：「家」預設不勾');
  const backups = r.items.filter((x) => (x.warnings || []).some((w) => w.includes('備案')));
  eq(backups.length, 2, '真實資料：兩筆備案');
  yes(backups.every((x) => !x.include), '真實資料：備案預設不勾');
  eq(r.items.filter((x) => x.include).length, 28, '真實資料：預設建立 28 個');

  // 提示
  yes(g('雲居溫泉會館').warnings.some((w) => w.includes('0 分鐘')), '真實資料：停留 0 分鐘有提示');
  yes(g('羅東觀光夜市'), '真實資料：羅東觀光夜市在清單裡');
  const dup = r.items.filter((x) => (x.warnings || []).some((w) => w.includes('不只一次')));
  yes(dup.length >= 4, '真實資料：住兩晚的飯店與「家」標出重複');

  // 時間順序
  const d1 = r.items.filter((x) => x.day === 1).map((x) => x.startMin);
  yes(d1.every((v, i) => i === 0 || v >= d1[i - 1]), '真實資料：第 1 天的時間是遞增的');
}

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
