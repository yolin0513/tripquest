// 行程表解析 —— 把一段文字讀成「第幾天／幾點／景點／停留多久」。
//
// 這支不需要 AI 也能用，而且**有 AI 時它也要跑**：AI 回來的結果一樣走這裡的
// 正規化與守門，因為 AI 也會把「下午 1:00」寫成 01:00、把飯店當景點。
//
// 三代理一致點名的兩個風險，都在這裡防：
//   1. OCR／複製貼上常把整張表壓成一行 → 一行裡出現兩個以上的時間就強制重切。
//      不防的話會產生一個名字超長的垃圾景點，語法完全合法、也不會報錯，
//      整趟就這樣靜靜地毀掉。
//   2. 「天」的分界少抓一個，後面全部塞進前一天，而且每一筆看起來都對。
//      所以只認行首的天標記，並把判斷依據回報給畫面讓人確認。
//
// 一律回報 warnings 與原始行，確認畫面要拿來給使用者對照。

const PERIODS = [
  [/^(?:凌晨|清晨)/, 6], [/^(?:早上|上午|早晨|am\b)/i, 9], [/^(?:中午|正午|noon)/i, 12],
  [/^(?:下午|午後|pm\b)/i, 14], [/^(?:傍晚|黃昏)/, 17], [/^(?:晚上|夜晚|晚間|夜間)/, 19],
];
const TRANSIT = /步行|走路|徒步|車程|路程|搭車|搭乘|開車|騎車|轉車|飛行|公車|巴士|電車|地鐵|捷運|新幹線|計程車|渡輪|接駁|纜車|JR|轉乘/i;
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12, 兩: 2, 半: 0.5 };

// 不是景點、但也不要默默丟掉的行（預設不建立，讓使用者可以勾回來）
// 起點與終點的「家」不是要去拍照的地方
const HOME = /^(?:家|我家|住家|回家|自宅|出發地|自家)$/;
const NON_SPOT = /^(?:check\s*-?\s*in|check\s*-?\s*out|入住|退房|集合|解散|出發|返程|回程|自由活動|休息|睡覺|洗澡|待補|待訂|機場接送|搭機|起飛|降落|回飯店)/i;
// 從行尾／行首剝掉的雜訊
const NOISE = [
  // 順序有意義：交通時間要先剝，不然下面那條通用時長會先吃掉「10分鐘」，
  // 留下一個孤零零的「步行」黏在景點名字後面。
  /（?\s*(?:步行|走路|車程|路程|搭車|開車)\s*(?:約)?\s*\d+(?:\.\d+)?\s*(?:小時|分鐘|分)?\s*）?/g,
  // 停在「到」：不然「搭地鐵到清水寺」會被整句吃掉，變成一行看不懂的東西
  /（?\s*(?:搭|坐|轉)?\s*(?:JR|地鐵|新幹線|電車|公車|巴士|計程車|捷運|渡輪)[^，。、）)到]*）?/gi,
  /（?\s*(?:約|大約)?\s*\d+(?:\.\d+)?\s*(?:小時|hr?s?|h|分鐘|分|min)\s*）?/gi,   // 時長
  /(?:NT\$|USD|¥|＄|\$)\s?[\d,]+(?:\s*元)?/gi,
  /[\d,]+\s*(?:元|日圓|日幣)/g,
  /門票[^，。、）)]*/g,
];

// 全形轉半形、破折號統一、去掉項目符號 —— 這一步做確實，後面的正則可以少一半
export function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[－–—〜～]/g, '-')
    .replace(/[　]/g, ' ')
    .split(/\r?\n/)
    .map((l) => l
      .replace(/^\s*[>＞]+\s*/, '')                    // LINE 引用
      .replace(/^\s*[•・◆■▶►※★☆*\-–]+\s*/, '')        // 項目符號
      .replace(/^\s*\(?\d{1,2}[.)、]\s*/, '')          // 行首序號
      .replace(/(\d)\s*:\s*(\d)/g, '$1:$2')            // 「11 : 30」→「11:30」
      .replace(/\s+/g, ' ')
      .trim())
    .join('\n');
}

function cnNum(s) {
  const t = String(s || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return parseFloat(t);
  if (CN_NUM[t] != null) return CN_NUM[t];
  const m = t.match(/^十([一二三四五六七八九])$/);
  if (m) return 10 + CN_NUM[m[1]];
  return null;
}

// 行首的「天」標記
function dayMark(line) {
  let m = line.match(/^(?:【|\[)?\s*(?:day|d)\s*(\d{1,2})\s*(?:】|\])?[：:.\s-]*/i);
  if (m) return { day: parseInt(m[1], 10), len: m[0].length, label: m[0].trim() };
  m = line.match(/^(?:【|\[)?\s*第\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[天日]\s*(?:】|\])?[：:.\s-]*/);
  if (m) { const n = cnNum(m[1]); if (n) return { day: n, len: m[0].length, label: m[0].trim() }; }
  m = line.match(/^(\d{1,2})\s*日目[：:.\s-]*/);
  if (m) return { day: parseInt(m[1], 10), len: m[0].length, label: m[0].trim() };
  if (/^(?:次日|隔天|翌日|第二日)/.test(line)) {
    const len = line.match(/^(?:次日|隔天|翌日|第二日)[：:.\s-]*/)[0].length;
    return { next: true, len, label: line.slice(0, len).trim() };
  }
  return null;
}

// 整行幾乎只剩日期 → 當成換天（行中間的 9/12 不算）
function dateOnlyLine(line) {
  const t = line.replace(/[（(][^）)]*[）)]/g, '').trim();
  return /^\d{1,2}\s*[/月-]\s*\d{1,2}\s*日?\s*$/.test(t) || /^\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}\s*$/.test(t);
}

const TIME_RE = /(\d{1,2})\s*[:：]\s*(\d{2})|(\d{1,2})\s*點(半|\d{1,2}\s*分)?/g;

function toMin(h, m) { return Math.max(0, Math.min(24 * 60, h * 60 + (m || 0))); }

// 抓行首的時間（單點或區間）。刻意只認行首 —— 行中間的數字（7-11、1 樓、85 度 C）
// 一律不當時間，不然名稱會被切爛。
function leadingTime(line) {
  let s = line;
  let period = null;
  for (const [re, hour] of PERIODS) {
    const m = s.match(re);
    if (m) { period = hour; s = s.slice(m[0].length).trim(); break; }
  }
  const one = (str) => {
    let m = str.match(/^(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (m) return { min: toMin(+m[1], +m[2]), len: m[0].length };
    m = str.match(/^(\d{1,2})\s*點\s*(半|\d{1,2}\s*分)?/);
    if (m) {
      const mm = m[2] ? (m[2].includes('半') ? 30 : parseInt(m[2], 10)) : 0;
      return { min: toMin(+m[1], mm), len: m[0].length };
    }
    return null;
  };
  const a = one(s);
  if (!a) {
    if (period != null) return { start: period * 60, end: null, approx: true, rest: s };
    return null;
  }
  let rest = s.slice(a.len).trim();
  let start = a.min;
  // 下午 2:00 → 14:00（12 點維持 12:00）
  if (period != null && period >= 12 && start < 12 * 60) start += 12 * 60;
  let end = null;
  const dash = rest.match(/^-\s*/);
  if (dash) {
    const b = one(rest.slice(dash[0].length).trim());
    if (b) {
      end = b.min;
      if (period != null && period >= 12 && end < 12 * 60) end += 12 * 60;
      rest = rest.slice(dash[0].length + b.len).trim();
    }
  }
  return { start, end, approx: false, rest };
}

// 停留時長的各種寫法。**順序有意義：一定要長的先試**。
//
// 這裡踩過一次很痛的雷：原本只認「數字＋單位」，遇到「03時07分」會match到「07分」，
// 於是存進去 7 分鐘 —— 不是「讀不出來」而是**默默存了錯的數字**，畫面上看起來
// 一切正常。「01時00分」更巧，match 到「00分」= 0，被當成無效丟掉變「不設定」。
// 同一個 bug 的兩種面貌，一種看得出來、一種看不出來。
const DUR = [
  // 01時00分 / 1時30分 / 1小時30分 / 1 小時 30 分鐘 / 1h30m
  [/(\d{1,2})\s*(?:小時|時|hrs|hr|h)\s*(\d{1,2})\s*(?:分鐘|分|min|m)?(?![:：\d])/i, (a, b) => +a * 60 + +b],
  // 1.5小時 / 一個半小時 / 兩小時 / 3 hrs
  [/(\d+(?:\.\d+)?|一個半|半|[一二兩三四五六七八九十]+)\s*(?:小時|hrs|hr|h)(?![a-z])/i, (a) => Math.round(hrNum(a) * 60)],
  // 90分鐘 / 30分 / 45min
  [/(\d{1,3})\s*(?:分鐘|分|min)(?![a-z])/i, (a) => +a],
  // 停留 01:00 —— 只有在「停留／待」後面才算，不然會吃到時刻
  [/(?:停留|待)\s*(?:約|大約)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/, (a, b) => +a * 60 + +b],
];

function hrNum(s) {
  if (s === '一個半') return 1.5;
  if (s === '半') return 0.5;
  const n = cnNum(s);
  return n == null ? 0 : n;
}

// 回傳 { min, raw }；min 可以是 0（「停留 00時00分」是明確寫的 0，不是「沒寫」）
export function parseDuration(text) {
  const s = String(text || '');
  for (const [re, calc] of DUR) {
    const m = s.match(re);
    if (!m) continue;
    const mins = Math.round(calc(m[1], m[2]));
    if (!Number.isFinite(mins) || mins < 0 || mins > 24 * 60) continue;
    return { min: mins, raw: m[0].trim(), index: m.index };
  }
  return null;
}

// 明寫的停留時長（含「這到底是停留還是路程」的判斷）
function explicitDuration(line) {
  // 「步行10分鐘」「車程1小時」講的是路上，不是停留 —— 先擋掉，不然會把交通時間
  // 當成停留時間，而且名字還會被剖一半留下「步行」兩個字。
  const m0 = parseDuration(line);
  if (!m0) return null;
  const m = { 0: m0.raw, index: m0.index };
  const before = line.slice(0, m.index);
  // 明寫「停留 N」就是停留，不管前面講了什麼交通工具
  const explicit = /^\s*(?:停留|待)/.test(m[0]) || /(?:停留|待)\s*(?:約|大約)?\s*$/.test(before);
  if (!explicit) {
    // 否則看同一個括號／逗號區段裡有沒有交通字眼。整段一起看，不能只看緊鄰的那個字：
    //「（搭地鐵銀座線 約20分鐘）」的「地鐵」離數字有五個字遠。
    const cut = Math.max(before.lastIndexOf('('), before.lastIndexOf('（'),
      before.lastIndexOf('，'), before.lastIndexOf(','), before.lastIndexOf('、')) + 1;
    if (TRANSIT.test(before.slice(cut))) return null;
  }
  return { min: m0.min, raw: m0.raw };
}

// 店名的關鍵字堆疊：「玉里橋頭臭豆腐 礁溪店-礁溪美食 礁溪小吃 礁溪必吃 礁溪臭豆腐 礁溪restaurant」
// 這種是 Google 地圖商家為了搜尋而塞的，不是店名。
// 判準：同一個 2～3 字的詞在名字裡出現 3 次以上 → 從第二次出現的地方切掉。
// 這比列黑名單通用（不用預先知道是哪個地名），而且短名字不會被誤傷。
function cutStuffing(s) {
  const t = s.trim();
  // 門檻刻意抓緊。一開始用「重複 3 次」，結果把「金丹早餐(原力行早餐)(早餐備案)」
  // 的「早餐」當成堆疊，砍成「金丹早餐(原力行」—— 正常店名重複兩三次很常見，
  // 真正的關鍵字堆疊是重複四次以上。
  if (t.length < 20) return t;
  for (const len of [3, 2]) {
    const count = new Map();
    for (let i = 0; i + len <= t.length; i++) {
      const k = t.slice(i, i + len);
      if (!/^[\p{L}\p{N}]+$/u.test(k)) continue;
      count.set(k, (count.get(k) || 0) + 1);
    }
    for (const [k, c] of count) {
      if (c < 4) continue;
      const second = t.indexOf(k, t.indexOf(k) + 1);
      if (second > 3) return t.slice(0, second).trim();
    }
  }
  return t;
}

// 把時長那一段整組拿掉。只砍掉 dur.raw 的話，「(停留 01時00分)」會留下一個
// 空殼「(停留 )」黏在名字後面，然後把真正的註記擠掉。
function stripDurationPhrase(rest, raw) {
  const i = rest.indexOf(raw);
  if (i < 0) return rest;
  const open = Math.max(rest.lastIndexOf('(', i), rest.lastIndexOf('（', i));
  const close = rest.indexOf(')', i + raw.length);
  // 括號裡除了時長只剩「停留／待／約」→ 整組是時長註記，可以整組砍
  if (open >= 0 && close > open && /^\s*(?:停留|待|約|大約)?\s*$/.test(rest.slice(open + 1, i))) {
    return rest.slice(0, open) + ' ' + rest.slice(close + 1);
  }
  // 沒有括號時，「停留」這個字要跟著數字一起走 ——
  // 只砍「2小時」會留下「淡水老街 停留」這種景點名字
  const head = rest.slice(0, i).replace(/\s*(?:停留|待|約|大約)\s*$/, '');
  return head + ' ' + rest.slice(i + raw.length);
}

function cleanName(s) {
  let t = s;
  for (const re of NOISE) t = t.replace(re, ' ');
  t = t
    .replace(/\p{Extended_Pictographic}️?/gu, '')   // 店名裡的 emoji（🌋🐓）不是名字的一部分
    .replace(/^[\s\-|·]+/, '')                           // 行首的破折號（「-玉里橋頭臭豆腐…」）
    .replace(/[（(][^）)]{0,20}[）)]\s*$/, ' ')     // 尾巴的括號註記（晚餐自理）(自費)
    .replace(/[（(]\s*[）)]/g, ' ')
    .replace(/\s*(?:集合|解散)\s*$/, '')
    .replace(/^\s*(?:到|前往|抵達)\s*/, '')
    .replace(/^[：:\-|·　\s]+/, '')
    .replace(/[：:\-|·，,。;；\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 「午餐：一蘭拉麵」→ 留「一蘭拉麵」；「午餐（自理）」→ 空
  const colon = t.match(/^(?:午餐|晚餐|早餐|中餐|用餐|吃飯)\s*[：:]\s*(.+)$/);
  if (colon) t = colon[1].trim();
  // 「｜」後面通常是廣告詞（「火山爆發雞礁溪總店｜宜蘭烤雞美食餐廳」）
  const bar = t.indexOf('|');
  if (bar > 1) t = t.slice(0, bar).trim();
  t = cutStuffing(t).replace(/[：:\-|·，,。;；\s]+$/, '').trim();
  return t;
}

// 旅程標題。兩種來源：
//   1. 明寫的標籤（「行程名稱：宜蘭遊」）—— 整份任何位置都認
//   2. 表頭區（第一個天標記／第一個有時間的行之前）長得像行程名的一行
// 第 2 種刻意只看表頭：真正的景點不會出現在那裡。而且整份完全沒有結構
//（沒有天標記也沒有時間）時就不猜，不然「清水寺／金閣寺」的第一行會被吃掉。
const TITLE_LABEL = /^(?:行程名稱|行程標題|旅程名稱|旅程標題|旅程|行程|標題|title|trip)\s*[:：]\s*(.+)$/i;
const TITLE_LOOK = /(?:[0-9０-９一二三四五六七八九十]+\s*[日天]\s*(?:[0-9一二三四五六七八九十]+\s*夜)?\s*遊|之旅|遊記|[一-龥]{2,10}遊$|旅行$|行$)/;

function extractTitle(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(TITLE_LABEL);
    if (m && m[1].trim()) return { title: m[1].trim().slice(0, 40), at: i };
  }
  // 表頭區有多長？
  let head = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const d = dayMark(lines[i].text);
    if (d || leadingTime(d ? lines[i].text.slice(d.len).trim() : lines[i].text)) { head = i; break; }
  }
  if (head === 0 || head === lines.length) return null;   // 沒有表頭，或整份沒結構 → 不猜
  for (let i = 0; i < head; i++) {
    const t = lines[i].text.trim();
    if (t.length >= 2 && t.length <= 30 && TITLE_LOOK.test(t)) return { title: t.slice(0, 40), at: i };
  }
  return null;
}

// 一行裡有兩個以上的時間 → 整張表被壓成一行了，用時間當界線重切。
// 這是最重要的一道防線：不切的話會生出一個名字超長的垃圾景點，
// 語法完全合法、不會報錯，整趟就這樣靜靜毀掉。
function resplit(line) {
  const marks = [];
  TIME_RE.lastIndex = 0;
  let m;
  while ((m = TIME_RE.exec(line))) {
    // 「14:00 - 16:30 錦市場」的第二個時間是區間的結束，不是新的一筆。
    // 在這裡切下去，會把一個好好的停留時間拆成兩筆垃圾。
    if (/-\s*$/.test(line.slice(0, m.index))) continue;
    marks.push(m.index);
  }
  // 天標記出現在行中間也要切
  const dayIn = [...line.matchAll(/(?:第\s*(?:[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[天日]|day\s*\d{1,2})/gi)]
    .map((x) => x.index).filter((i) => i > 0);
  const cuts = [...new Set([...marks, ...dayIn])].sort((a, b) => a - b).filter((i) => i > 0);
  if (marks.length < 2 && !dayIn.length) return [line];
  const parts = [];
  let prev = 0;
  for (const c of cuts) { parts.push(line.slice(prev, c).trim()); prev = c; }
  parts.push(line.slice(prev).trim());

  // 切點前面只剩括號或標點時，那不是「兩筆黏在一起」，是這一筆自己的開頭
  // （「【第1天】」會在 `第1天` 前面被切一刀，留下一個叫「【」的景點）。
  // 往後併回去，讓它變回原本那一行。
  const real = (s) => /[\p{L}\p{N}]/u.test(s);
  const out = [];
  let carry = '';
  for (const p of parts) {
    if (!p) continue;
    if (!real(p)) { carry += p; continue; }
    out.push((carry + p).trim());
    carry = '';
  }
  return out.length ? out : (carry ? [carry] : []);
}

// 主要入口。回傳 { days: [{day, items:[…]}], warnings: […], unparsed: […] }
export function parseItinerary(text) {
  const src = normalize(text);
  const rawLines = src.split('\n').filter((l) => l.trim());
  const items = [];
  const unparsed = [];
  const warnings = [];
  let day = 1;
  let sawDayMark = false;
  let wasResplit = false;

  const lines = [];
  for (const l of rawLines) {
    const pieces = resplit(l);
    if (pieces.length > 1) wasResplit = true;
    for (const p of pieces) lines.push({ text: p, raw: l });
  }
  if (wasResplit) warnings.push('有幾行看起來被擠成一整行，我照時間幫你拆開了，請確認分得對不對');

  // 旅行社的行程表，天標記那一行後面接的是「當天的路線」不是景點
  // （「【第1天】桃園機場／關西機場－大阪」的「大阪」不是要去拍照的地方）。
  // 判斷依據：這份行程表其他行有時間、而天標記這一行沒有 → 它是標題。
  // 反過來，整份都沒有時間時（「第1天 清水寺、金閣寺」），那才真的是在列景點。
  const anyTimed = lines.some((x) => {
    const d = dayMark(x.text);
    return !!leadingTime(d ? x.text.slice(d.len).trim() : x.text);
  });

  const titleHit = extractTitle(lines);

  for (let li = 0; li < lines.length; li++) {
    const { text: line0, raw } = lines[li];
    let line = line0.trim();
    if (!line) continue;
    if (titleHit && li === titleHit.at) continue;      // 這行是旅程名稱，不是景點

    if (dateOnlyLine(line)) { if (items.length) day += 1; sawDayMark = true; continue; }

    const dm = dayMark(line);
    if (dm) {
      sawDayMark = true;
      day = dm.next ? day + 1 : dm.day;
      line = line.slice(dm.len).trim();
      if (!line) continue;
      if (anyTimed && !leadingTime(line)) continue;    // 這是當天的標題，不是景點
    }

    const t = leadingTime(line);
    let rest = t ? t.rest : line;
    const dur = explicitDuration(rest);
    if (dur) rest = stripDurationPhrase(rest, dur.raw);

    // 沒有時間資訊時才拆多景點，有時間的話拆了會讓時間對不上
    const pieces = t ? [rest] : rest.split(/[、，,→>＞]+/).map((s) => s.trim()).filter(Boolean);

    for (const piece of pieces) {
      const name = cleanName(piece);
      if (!name) { unparsed.push(raw); continue; }
      // 「（早餐備案）」「（午餐備案）」是備而不用的，跟起點終點的「家」一樣，
      // 建成拍照景點只會讓清單變髒。預設不勾，但留在畫面上讓人可以勾回來。
      const backup = /備案|備選|候補|plan\s*b/i.test(piece) || /備案/.test(raw);
      const home = HOME.test(name);
      const skip = NON_SPOT.test(name) || backup || home;

      let stay = dur ? dur.min : null;
      if (!stay && t && t.end != null && t.end > t.start) stay = t.end - t.start;
      const zeroStay = !!dur && dur.min === 0;
      if (zeroStay) stay = null;

      const w = [];
      if (t && t.approx) w.push('時間是我猜的');
      if (!t) w.push('這一行沒有時間');
      if (backup) w.push('看起來是備案，預設不建立');
      if (home) w.push('看起來是出發／回家的地方，預設不建立');
      if (zeroStay && !backup) w.push('原本寫停留 0 分鐘');
      if (name.length > 18) w.push('名字有點長，可能夾到別的字');
      if (name.length < 2 && !home && !backup) w.push('名字太短');

      items.push({
        id: 'imp' + items.length,
        day, name,
        startMin: t ? t.start : null,
        endMin: t && t.end != null ? t.end : (t && stay ? t.start + stay : null),
        stayMin: stay,
        stayGuess: !dur && !(t && t.end != null),
        timeApprox: !!(t && t.approx),
        include: !skip,
        kind: skip ? 'other' : 'spot',
        raw, warnings: w,
      });
    }
  }

  if (!sawDayMark && items.length) warnings.push('沒看到「第幾天」的字樣，我先全部放在第 1 天');
  if (unparsed.length) warnings.push(`有 ${unparsed.length} 行看不懂，沒有放進來`);

  // 天號重新排成 1..N（有人從 Day 0 或 Day 2 開始）
  const seen = [...new Set(items.map((x) => x.day))].sort((a, b) => a - b);
  const remap = new Map(seen.map((d, i) => [d, i + 1]));
  for (const it of items) it.day = remap.get(it.day);

  // 同名的地方出現不只一次（住兩晚的飯店最常見）—— 不擅自刪，但要講出來
  const times = new Map();
  for (const it of items) times.set(it.name, (times.get(it.name) || 0) + 1);
  for (const it of items) {
    if (times.get(it.name) > 1) it.warnings.push('這個地方出現不只一次');
  }

  const title = titleHit ? titleHit.title : '';
  if (title) warnings.push(`旅程名稱讀到「${title}」，會幫你填進去`);
  return { items, warnings, unparsed, title };
}

// AI 看圖／看 PDF 回來的列，轉成跟規則式解析一模一樣的形狀。
// 兩條路匯流成同一種資料，確認畫面才只需要寫一套；而且 AI 也會出錯
// （把「下午 1:00」寫成 01:00、把飯店當景點），所以同樣要過這裡的守門。
export function fromRows(rows, title = '') {
  const items = [];
  const warnings = [];
  const hhmm = (v) => {
    if (v == null || v === '') return null;
    const m = String(v).match(/^(\d{1,2})\s*[:：]?\s*(\d{2})?$/);
    if (!m) return null;
    const h = +m[1], mm = m[2] ? +m[2] : 0;
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  };
  let bad = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = cleanName(String((r && (r.name || r.spot || r.title)) || ''));
    if (!name) { bad++; continue; }
    const day = Math.max(1, Math.min(60, parseInt(r.day, 10) || 1));
    const start = hhmm(r.start ?? r.time);
    let end = hhmm(r.end);
    let stay = Number.isFinite(+r.stayMin) && +r.stayMin > 0 ? Math.min(720, Math.round(+r.stayMin)) : null;
    if (!stay && start != null && end != null && end > start) stay = end - start;
    if (stay && start != null && end == null) end = start + stay;

    const w = [];
    if (start == null) w.push('這一筆沒有時間');
    if (name.length > 18) w.push('名字有點長，可能夾到別的字');
    if (r.uncertain) w.push('這一筆 AI 自己也不太確定');

    items.push({
      id: 'ai' + items.length, day, name,
      startMin: start, endMin: end, stayMin: stay,
      stayGuess: !(Number.isFinite(+r.stayMin) && +r.stayMin > 0) && !(start != null && end != null),
      timeApprox: !!r.approx,
      include: !NON_SPOT.test(name),
      kind: NON_SPOT.test(name) ? 'other' : 'spot',
      raw: String(r.raw || name), warnings: w,
    });
  }
  if (bad) warnings.push(`有 ${bad} 筆沒有名字，我跳過了`);
  if (title) warnings.push(`旅程名稱讀到「${title}」，會幫你填進去`);
  const seen = [...new Set(items.map((x) => x.day))].sort((a, b) => a - b);
  const remap = new Map(seen.map((d, i) => [d, i + 1]));
  for (const it of items) it.day = remap.get(it.day);
  return { items, warnings, unparsed: [], title };
}

export function fmtTime(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function fmtStay(min) {
  if (!min) return '';
  if (min < 60) return `${min} 分鐘`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

// 用策展地點庫幫每一筆標「認得／不認得」——認不出來的就是要人多看兩眼的那幾筆。
// 這比任何字串啟發式都可靠，而且免費。
export async function annotate(items, cityHint = '') {
  const { matchPlace } = await import('./quests/generate.js');
  for (const it of items) {
    if (!it.include) continue;
    try {
      const hit = await matchPlace(it.name, cityHint);
      if (hit) { it.matched = hit.name; it.emoji = hit.emoji || '📍'; }
      // 沒對到**不是問題**，不要標警告。策展資料庫只收熱門景點，一趟真實行程
      // 大部分的店家本來就不在裡面；自由輸入的景點照樣會出任務、照樣會去維基
      // 找示意圖。把正常情況標成橘色警告，整個畫面會變成一片橘，
      // 真正需要看的那兩三筆反而被淹掉。
    } catch { /* 靜默 */ }
  }
  return items;
}
