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

// 一組欄位的「有效時間戳」：有 _f 就用，沒有就退路到整筆 updatedAt
export function effTs(rec, g) {
  const f = rec && rec._f;
  if (f && Number.isFinite(f[g])) return f[g];
  return (rec && rec.updatedAt) || 0;
}

// 把一筆記錄的 _f 播種齊全（缺的組用 ts）；不改其他欄位
export function seedF(rec, ts) {
  const groups = groupsOf(rec.type);
  if (!groups) return rec._f;
  const f = { ...(rec._f || {}) };
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

// 伺服器端：把不合法的 _f 收斂到白名單（壞掉的客戶端不能讓 _f 無限長大）
export function sanitizeF(rec) {
  const groups = groupsOf(rec && rec.type);
  if (!rec || !groups) { if (rec && rec._f !== undefined) delete rec._f; return rec; }
  if (!rec._f || typeof rec._f !== 'object') { delete rec._f; return rec; }
  const f = {};
  for (const g of Object.keys(groups)) if (Number.isFinite(rec._f[g])) f[g] = rec._f[g];
  rec._f = f;
  return rec;
}
