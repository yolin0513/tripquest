// 欄位級合併（v1.56，三代理 3:0「GO with changes」後的定案）
//
// 之前同步是「整筆記錄後寫入者勝」：兩台裝置同時改同一景點的不同欄位
// （A 補座標、B 按釘住）會整筆互蓋，一邊遺失。現在：
//
//   · 追蹤型別（spot / trip / quest）的記錄多一個小物件 `_f`：{ 欄位組 → 該組最後
//     修改的毫秒時間戳 }。每組幾十 bytes，記錄不膨脹。
//   · 欄位「組」而不是單欄：永遠一起寫的欄位一起比（day+order＝一次移動、
//     lat+lng+geoSrc＝一個位置、startMin+stayMin+舊字串＝一個時段），
//     不會合併出「誰都沒指定過」的半套狀態。
//   · 每組各自 LWW（時間戳 → 值本身；同分不比 deviceId，純函式才能保證任何順序都收斂）。
//     `pos` 額外規則：兩邊都有座標而只有一邊是手動貼的 → 手動勝，不看時間
//     （「自動找位置」是背景批次，不該蓋掉人手貼的）。
//   · 非追蹤欄位（emoji、blurb、hero*…各裝置自己算得出來的）跟著整筆 LWW 勝方。
//   · 刪除（deleted 墓碑）與新增維持整筆語意，不會出現半刪。
//   · 舊記錄（沒有 `_f`）：每一組的時間戳退路為該記錄的 updatedAt —— 「它所有欄位
//     最後在那時被寫過」是唯一安全的保守估計；純舊對純舊完全等價於原本的整筆 LWW。
//     新版 App 第一次碰到舊記錄時會用它原本的 updatedAt 把 `_f` 播種齊全（store.js），
//     所以「部分 `_f`」不會存在 —— 這是三位代理都點名的漏洞。
//
// 這支是純函式、無瀏覽器相依：store.js（客戶端）、workers/worker.mjs（Cloudflare）、
// server/index.mjs（LAN 自架）三處 import 同一份，行為才會一致。

export const APPEND_ONLY = new Set(['submission', 'reaction', 'comment', 'retraction', 'memberClaim']);

// 追蹤欄位組（依 type）。不在表裡的 type 走整筆 LWW。
export const TRACKED = {
  spot: {
    name: ['name'],
    slot: ['day', 'order'],
    time: ['startMin', 'stayMin', 'startTime', 'endTime'],
    pinned: ['pinned'],
    pos: ['lat', 'lng', 'geoSrc'],
  },
  trip: {
    title: ['title'],
    dates: ['startDate', 'endDate'],
    musicStyle: ['musicStyle'],
    videoLength: ['videoLength'],
    posterStyle: ['posterStyle'],
    baseCurrency: ['baseCurrency'],
    country: ['country'],
    // 每一天幾點出發（v1.69）。**這是使用者自己設的，不是推導值** —— 所以放進同步層
    // 完全正當，全家會看到同一份。自成一組：它跟行程名、日期都無關，各自 LWW。
    //
    // 為什麼需要它：chainTimes 的第一站沒有「幾點到」時 arrive 是 null，整天推不出
    // 任何時刻（實測確認）。而「使用者一個時間都沒填」正是自動排時刻表最主要的情境。
    // 沒有這個欄位，整個行程檢查在最常見的情況下什麼都檢查不到。
    dayStarts: ['dayStarts'],
    album: ['albumId', 'albumUrl', 'albumAt'],
    // 使用者自己切的開關要各自成組（v1.64 健檢）。原本不在 TRACKED 裡 → 跟著整筆 LWW
    // 的勝方走：旅伴離線改了行程名再同步回來，建立者開的 AI 會被靜默關掉、
    // 關掉的示意圖抓取也會自己打開。
    allowGeo: ['allowGeo'],
    allowWiki: ['allowWiki'],
    aiEnabled: ['aiEnabled'],
  },
  quest: {
    text: ['title', 'hint'],
  },
};

export const groupsOf = (type) => TRACKED[type] || null;

const has = (rec, k) => rec != null && rec[k] !== undefined;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));

// 一組欄位的「有效時間戳」。
//
// 「沒有 _f[g]」有兩種完全不同的成因，以前混為一談（v1.73.2 拆開）：
//
//   (a) 整個 _f 都沒有 —— v1.55 以前的記錄，欄位級合併還沒發明。
//       它對每一組的意見就是整筆的 updatedAt，退路是對的。
//
//   (b) _f 非空、卻缺這一組 —— **寫這筆的那一版根本不認識這一組**。
//       這可以百分之百推論：store.js 的 put()／patch() 都走 seedF，seedF 會把
//       「自己認得的組」補齊；mergeRecord 也是重建全部認得的組。所以「有 _f
//       卻缺 g」的唯一成因就是「不認得 g」。而不認得 g 的那一版**在定義上
//       不可能是 g 的作者**（v1.68 連設定出發時刻的畫面都沒有），它對 g
//       沒有意見 —— 不能拿整筆的 updatedAt 冒充成它的意見。
//
// 混為一談的後果就是使用者回報的那個現象：媽媽（舊手機）只是改了行程名，
// 爸爸設好的「每天幾點出發」就跳回舊的，而且來回不會停。
//
// ⚠️ 這條推論只對「後來新增的欄位組」成立。如果哪天把一個**既有欄位**升級成
// 追蹤組（例如 spot.blurb 或 quest.order），所有既有記錄的 _f 都會缺那一組、
// 全部變成「沒有意見」，勝負就落到 pickGroup 最後的比值本身（字典序而非時間序）。
// 加新欄位安全，升級既有欄位不安全 —— 要做的話得另外處理。
export function effTs(rec, g) {
  const f = rec && rec._f;
  if (f && typeof f === 'object') {
    if (Number.isFinite(f[g])) return f[g];
    for (const k in f) if (Number.isFinite(f[k])) return 0;   // (b) 沒有意見
  }
  return (rec && rec.updatedAt) || 0;                          // (a) 舊記錄的退路
}

// 把一筆記錄的 _f 播種齊全（缺的組用 ts）；不改其他欄位。
//
// v1.73.2：**只播種真正的舊記錄**（完全沒有 _f 的那種）。
// _f 已經非空的話，缺席的組是「被舊版剝掉的」或「這一版才新增、還沒有人設過的」，
// 兩種都不該用現在的時間戳幫它發身分證 —— 那等於幫一個抄來的舊值蓋新章，是同一個
// 洞的本機版本。實測：舊裝置升級之後先 patch 再 pull，少了這一段就會把本機那份
// stale 值拿去蓋掉別台正確的新值（只改 effTs 那一半修不到這個情境）。
export function seedF(rec, ts) {
  const groups = groupsOf(rec.type);
  if (!groups) return rec._f;
  const f = { ...(rec._f || {}) };
  if (Object.keys(f).some((k) => Number.isFinite(f[k]))) return f;
  for (const g of Object.keys(groups)) if (!Number.isFinite(f[g])) f[g] = ts;
  return f;
}

// 一組欄位有沒有真的改變（patch 時只有改了才 bump 時間戳 —— 表單會把沒動的欄位一起送）
export function groupChanged(before, after, fields) {
  return fields.some((k) => stable(before ? before[k] : undefined) !== stable(after ? after[k] : undefined));
}

// 整筆 LWW：inc 是否贏過 cur（updatedAt → deviceId → 值）
export function recWins(inc, cur) {
  const a = inc.updatedAt || 0, b = cur.updatedAt || 0;
  if (a !== b) return a > b;
  const d = cmpStr(String(inc.deviceId || ''), String(cur.deviceId || ''));
  if (d !== 0) return d > 0;
  return cmpStr(stable(inc), stable(cur)) > 0;
}

function pickGroup(g, fields, inc, cur) {
  // pos：手動座標優先（兩邊都有座標、且只有一邊 manual）
  if (g === 'pos' && inc.lat != null && cur.lat != null) {
    const im = inc.geoSrc === 'manual', cm = cur.geoSrc === 'manual';
    if (im !== cm) return im ? inc : cur;
  }
  const ti = effTs(inc, g), tc = effTs(cur, g);
  // 退路來源（沒有 _f 這組）且整組沒有值 → 不要用「空」蓋掉對方有值的組
  const fi = inc._f && Number.isFinite(inc._f[g]), fc = cur._f && Number.isFinite(cur._f[g]);
  const anyI = fields.some((k) => has(inc, k)), anyC = fields.some((k) => has(cur, k));
  if (!fi && !anyI && anyC) return cur;
  if (!fc && !anyC && anyI) return inc;
  if (ti !== tc) return ti > tc ? inc : cur;
  // 同分：直接比值本身（不比 deviceId —— 合併結果的 deviceId 是整筆勝方的，跟這組的值
  // 沒有對應，拿它決勝會讓三方合併依順序得到不同答案）。純函式、與歷史無關 → 必收斂。
  const vi = stable(fields.map((k) => inc[k])), vc = stable(fields.map((k) => cur[k]));
  return cmpStr(vi, vc) >= 0 ? inc : cur;
}

// 合併：回 { rec, changed }。changed = 結果與 cur 不同（伺服器據此決定要不要寫、要不要佔 seq）。
export function mergeRecord(cur, inc) {
  if (!inc) return { rec: cur, changed: false };
  if (!cur) return { rec: inc, changed: true };
  const type = inc.type || cur.type;
  if (APPEND_ONLY.has(type)) return { rec: cur, changed: false };
  const groups = groupsOf(type);
  // 刪除／無追蹤表：整筆語意
  if (!groups || inc.deleted || cur.deleted) {
    const win = recWins(inc, cur) ? inc : cur;
    return { rec: win, changed: win === inc && stable(inc) !== stable(cur) };
  }
  const base = recWins(inc, cur) ? inc : cur;
  const out = { ...base };
  const f = {};
  // 比這一版新的欄位組（本機的 TRACKED 沒有）要原封帶過去，否則時間戳一消失，
  // 對方的 effTs 就會退路到 updatedAt，讓舊值取得一個全新的章。
  //
  // **只從 base 那一側帶，不要取兩邊 max**：未知欄位的「值」本來就是
  // `{...base}` 抄來的，時間戳從同一筆抄，值與時間戳才配得起來。取 max 會讓
  // 舊值配到一個貨真價實的新時間戳 —— 那比丟掉還糟：丟掉上面的 effTs 偵測得
  // 出來，錯配偵測不出來，而且會把那段推論整個廢掉（實測兩者一起上反而全滅）。
  const bf = base && base._f;
  if (bf && typeof bf === 'object') {
    for (const k of Object.keys(bf)) if (!groups[k] && Number.isFinite(bf[k])) f[k] = bf[k];
  }
  for (const [g, fields] of Object.entries(groups)) {
    const w = pickGroup(g, fields, inc, cur);
    for (const k of fields) {
      if (has(w, k)) out[k] = w[k];
      else delete out[k];
    }
    f[g] = Math.max(effTs(inc, g), effTs(cur, g));
  }
  out._f = f;
  out.updatedAt = Math.max(inc.updatedAt || 0, cur.updatedAt || 0);
  out.deviceId = base.deviceId;
  return { rec: out, changed: stable(out) !== stable(cur) };
}

// 伺服器端：把不合法的 _f 收斂（壞掉的客戶端不能讓 _f 無限長大）。
//
// v1.73.2：未知鍵改成**放行**而不是刪掉。舊版 Worker 把新鍵砍掉，等於在伺服器上
// 親手製造出「有 _f 卻缺這一組」的記錄，新版客戶端會把它讀成「沒有意見」，於是兩台
// 新裝置各守各的值、誰也贏不了誰（實測：客戶端先上、Worker 後上會造成永久分歧，
// 所以**部署順序是 Worker 先、客戶端後**）。放行之後，以後再加任何新欄位組，
// 伺服器都只是一條透明管道，這個順序要求就永久消失。
//
// 但放行就得補閘門 —— 原本擋膨脹的白名單沒了：
const F_MAX_UNKNOWN = 8;                              // TRACKED.trip 現在 12 組；同時「在飛」的未知組歷來最多 1 個
const F_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;       // 擋 unicode、超長鍵名、__proto__
// 值域也要擋，而且**已知鍵一起擋** —— 這是順手補的既有漏洞：現在只驗
// Number.isFinite，所以任何客戶端推一筆 `_f: { title: 9e15 }`，這趟的行程名就
// 永久凍結、誰都改不動，介面上還完全看不出為什麼。
// 超出的鍵直接丟掉而不是 clamp：clamp 的結果會隨伺服器當下時間變動。
const fTsOk = (v) => Number.isFinite(v) && v > 0 && v <= Date.now() + 26 * 3600 * 1000;
export function sanitizeF(rec) {
  const groups = groupsOf(rec && rec.type);
  if (!rec || !groups) { if (rec && rec._f !== undefined) delete rec._f; return rec; }
  if (!rec._f || typeof rec._f !== 'object') { delete rec._f; return rec; }
  const f = {};
  for (const g of Object.keys(groups)) if (fTsOk(rec._f[g])) f[g] = rec._f[g];
  let extra = 0;
  for (const k of Object.keys(rec._f)) {
    if (groups[k] || !fTsOk(rec._f[k]) || !F_KEY_RE.test(k)) continue;
    if (++extra > F_MAX_UNKNOWN) break;    // 多的丟掉就好，不要整筆拒絕（那會讓一台壞裝置卡死全家的同步）
    f[k] = rec._f[k];
  }
  rec._f = f;
  return rec;
}
