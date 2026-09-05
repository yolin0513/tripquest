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

// 明寫的停留時長
function explicitDuration(line) {
  // 「步行10分鐘」「車程1小時」講的是路上，不是停留 —— 先擋掉，不然會把交通時間
  // 當成停留時間，而且名字還會被剖一半留下「步行」兩個字。
  let m = line.match(/(?:停留|待|約|大約)?\s*([0-9]+(?:\.[0-9]+)?|半|一個半|一|兩|二|三|四|五)\s*(小時|hrs|hr|h|分鐘|分|min)/i);
  if (!m) return null;
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
  let n = m[1] === '一個半' ? 1.5 : (m[1] === '半' ? 0.5 : cnNum(m[1]));
  if (n == null) return null;
  const unit = m[2].toLowerCase();
  const mins = /小時|hr|hrs|h/.test(unit) ? Math.round(n * 60) : Math.round(n);
  if (mins <= 0 || mins > 12 * 60) return null;
  return { min: mins, raw: m[0].trim() };
}

function cleanName(s) {
  let t = s;
  for (const re of NOISE) t = t.replace(re, ' ');
  t = t
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
  return t;
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

  for (const { text: line0, raw } of lines) {
    let line = line0.trim();
    if (!line) continue;

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
    if (dur) rest = rest.replace(dur.raw, ' ');

    // 沒有時間資訊時才拆多景點，有時間的話拆了會讓時間對不上
    const pieces = t ? [rest] : rest.split(/[、，,→>＞]+/).map((s) => s.trim()).filter(Boolean);

    for (const piece of pieces) {
      const name = cleanName(piece);
      if (!name) { unparsed.push(raw); continue; }
      const skip = NON_SPOT.test(name);
      let stay = dur ? dur.min : null;
      if (!stay && t && t.end != null && t.end > t.start) stay = t.end - t.start;

      const w = [];
      if (t && t.approx) w.push('時間是我猜的');
      if (!t) w.push('這一行沒有時間');
      if (name.length > 18) w.push('名字有點長，可能夾到別的字');
      if (name.length < 2) w.push('名字太短');

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

  return { items, warnings, unparsed };
}

// AI 看圖／看 PDF 回來的列，轉成跟規則式解析一模一樣的形狀。
// 兩條路匯流成同一種資料，確認畫面才只需要寫一套；而且 AI 也會出錯
// （把「下午 1:00」寫成 01:00、把飯店當景點），所以同樣要過這裡的守門。
export function fromRows(rows) {
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
  const seen = [...new Set(items.map((x) => x.day))].sort((a, b) => a - b);
  const remap = new Map(seen.map((d, i) => [d, i + 1]));
  for (const it of items) it.day = remap.get(it.day);
  return { items, warnings, unparsed: [] };
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
      else it.warnings = [...(it.warnings || []), '不在我的景點資料庫裡，請確認名字對不對'];
    } catch { /* 靜默 */ }
  }
  return items;
}
