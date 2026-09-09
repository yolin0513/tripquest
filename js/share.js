// 分享與備份
//  - 任務代碼 / 連結：只含行程 + 景點 + 任務（小，~數 KB），gzip + base64url 塞進網址。
//    朋友開連結就得到同一份任務清單，各自獨立解任務。這是出遊當下「多人一起玩」的關鍵。
//  - 完整備份（.tripquest）：含照片，單一 JSON 檔，透過 LINE / AirDrop 傳，事後匯入合併。
//    v2 會接雲端同步，屆時這層改為背景自動化。

import * as store from './store.js';
import * as db from './db.js';
import { uuid } from './ids.js';
import { getConfig, setConfig, syncEnabled, DEFAULT_CLOUD_URL } from './sync.js';

// 128-bit 群組祕鑰（放在邀請連結的 #fragment，永不進伺服器的網址記錄）。
// v1.58 起用 base64url（22 字，比 hex 省 10 字）；既有群組的 hex 祕鑰不輪替，
// 伺服器兩種都收。頭尾避開 - 和 _：有些通訊軟體長按選取會把頭尾符號切掉，
// 重骰一次成本為零。
function newSecret() {
  for (;;) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    const s = base64urlFromBytes(b);
    if (!/^[-_]|[-_]$/.test(s)) return s;
  }
}

// 分批推送——避免行程大（照片留言讚多）時整包塞進一次 POST 在慢的行動網路上逾時。
// 每批有自己的逾時 + 最多重試 1 次；整體有個總預算，超過就放手交給 outbox 背景重試
// （分享連結還是照樣給，不要卡住使用者）。
// chunkSize 80：伺服器的 D1 資料庫一次最多處理約 100 筆寫入，這裡留餘裕（伺服器
// 端 worker.mjs 現在也會自己再拆一次批次，這裡的分批主要是為了單一請求別太大、
// 在慢網路上更快送完、失敗時重試的代價也更小）。
async function pushAllChunked(adapter, records, { chunkSize = 80, chunkTimeoutMs = 12000, totalBudgetMs = 40000 } = {}) {
  const deadline = Date.now() + totalBudgetMs;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    if (Date.now() > deadline) return;                      // 時間到了，剩下的交給背景 outbox
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), chunkTimeoutMs));
      try { await Promise.race([adapter.push(chunk), timeout]); lastErr = null; break; }
      catch (e) { lastErr = e; }
    }
    if (lastErr) return;                                      // 這批推不上去，別再硬撐後面幾批
  }
}

export async function ensureGroupSync(groupId) {
  const g = store.getRaw(groupId);
  if (!g) return null;
  const cfg = getConfig();
  const patch = {};
  if (!g.syncSecret) patch.syncSecret = newSecret();
  if (cfg.url && g.syncUrl !== cfg.url) patch.syncUrl = cfg.url;
  if (Object.keys(patch).length) await store.patch(groupId, patch);
  // 祕鑰產生「之前」就拍的照片從沒排進上傳佇列（onSubmission 那時看群組沒祕鑰就略過）
  // → 第一次分享前拍的照片永遠傳不上去、旅伴那邊只看到「重新下載」。這裡補排一次；
  // enqueueBlob 依 id 去重、drain 上傳前會 HEAD，不會重傳已在伺服器的。
  try {
    const o = await import('./outbox.js');
    for (const r of store.exportGroup(groupId)) {
      if (r.type !== 'submission' || r.deleted) continue;
      await o.enqueueBlob(groupId, r.thumbHash);
      await o.enqueueBlob(groupId, r.photoHash);
    }
    await o.enqueuePush(groupId);
  } catch { /* 沒設同步就算了 */ }
  return store.getRaw(groupId);
}

// ---------- 壓縮工具 ----------
async function gzip(str) {
  if (typeof CompressionStream === 'undefined') return btoa(unescape(encodeURIComponent(str)));
  const cs = new CompressionStream('gzip');
  const stream = new Blob([str]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return base64urlFromBytes(new Uint8Array(buf));
}
async function gunzip(b64) {
  const bytes = bytesFromBase64url(b64);
  if (typeof DecompressionStream === 'undefined') return decodeURIComponent(escape(atob(b64)));
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).text();
}
function base64urlFromBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromBase64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// UUID（36 字）↔ base64url（22 字）無損互轉——短邀請連結用。
// 解碼錯不會馬上噴錯，而是往後默默指到一個不存在的群組（pull 端 404 空轉），
// 所以這是全連結最脆的一環：兩個方向只有這一份實作，jointest 有 round-trip 測試。
export function uuidToB64(id) {
  const hex = String(id).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return '';
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return base64urlFromBytes(b);
}
export function b64ToUuid(s) {
  let b;
  try { b = bytesFromBase64url(String(s || '')); } catch { return ''; }
  if (b.length !== 16) return '';
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function b64urlUtf8(str) { return base64urlFromBytes(new TextEncoder().encode(str)); }
function utf8FromB64url(s) { try { return new TextDecoder().decode(bytesFromBase64url(String(s || ''))); } catch { return ''; } }

// ---------- 任務代碼（無照片）----------
export async function makeShareCode(tripId) {
  const trip = store.get(tripId);
  const grp = store.get(trip.groupId);
  const spots = store.spotsOf(tripId);
  const quests = store.questsOfTrip(tripId);
  const payload = {
    v: 1, kind: 'questset',
    trip: { title: trip.title, startDate: trip.startDate, endDate: trip.endDate, region: trip.region || '' },
    group: { name: grp?.name || '旅伴' },
    spots: spots.map((s) => ({ id: s.id, name: s.name, region: s.region, day: s.day, order: s.order, lat: s.lat, lng: s.lng })),
    quests: quests.filter((q) => !q.deleted).map((q) => ({ id: q.id, spotId: q.spotId, title: q.title, hint: q.hint, kind: q.kind, order: q.order })),
  };
  return gzip(JSON.stringify(payload));
}

// 邀請連結的網址前半段。
//
// 加上 openExternalBrowser=1：LINE 看到這個參數會直接用系統預設瀏覽器開
//（iOS → Safari、Android → Chrome），而不是它自己的內建瀏覽器。這很重要，
// 因為 LINE 的內建瀏覽器**不能把 App 加到主畫面**，而長輩十之八九是從 LINE
// 點連結的。有這個參數就根本不用教他「怎麼跳出 LINE」——那個教學還會因為
// LINE 版本與機型不同而講錯位置。
//
// 這個參數必須是**真正的查詢字串**（在 # 之前）；邀請碼在 fragment 裡，
// 順序不能弄反。我們的 hash 路由只看 location.hash，所以在別的地方開啟時
// 這個參數完全被忽略，沒有副作用。
//
// 出處：LINE 自己的網站就在用（help.line.me/…?openExternalBrowser=1、
// manager.line.biz/…?openExternalBrowser=true），Classmethod DevelopersIO
// 也在 iOS 與 Android 兩邊實測過。但**它不在 LINE 的開發者文件裡**，所以當成
// 「有就更好」的加分項：加到主畫面的教學與「直接加入」那條路都要留著。
export function inviteBase() {
  const u = new URL(location.href);
  u.hash = '';
  u.search = '?openExternalBrowser=1';
  return u.toString();
}

export async function shareURL(tripId) {
  const base = inviteBase();
  // 有設定同步 → 產生「加入同一個群組」的邀請；否則退回「複製一份任務清單」
  if (syncEnabled()) {
    const trip = store.get(tripId);
    const group = await ensureGroupSync(trip.groupId);
    const spots = store.spotsOf(tripId);
    const quests = store.questsOfTrip(tripId);
    const members = store.membersOf(trip.groupId);
    // 連結只帶「群組識別碼」，不帶整包資料——不然景點/任務一多，網址長到
    // LINE 等 App 傳不過去、貼上也常斷行漏字，變成「無法解析」。
    // 朋友點連結加入時，直接從伺服器把這個群組的資料整包拉下來（見 joinInvite）。
    // 所以這裡要先確保伺服器上真的有最新資料：即時推一次。行程大（照片留言讚多）
    // 時整包塞一次 POST 在慢的行動網路上會逾時，所以拆成一小批一小批推、每批有
    // 自己的逾時與重試。這個背景推送最多給 40 秒——但不要讓使用者對著「分享」
    // 按鈕乾等這麼久：只等最多 6 秒讓小行程快速完成，時間到了就先把連結生出來，
    // 推送在背景繼續跑完（加入那邊有自己的重試，會等到資料真的送達）。
    try {
      const { adapterForGroup } = await import('./sync.js');
      const adapter = adapterForGroup(group.id, group.syncSecret);
      const pushJob = pushAllChunked(adapter, store.exportGroup(group.id)).catch(() => {});
      await Promise.race([pushJob, new Promise((r) => setTimeout(r, 6000))]);
    } catch { /* 推不上去也繼續給連結；outbox 背景會重試，加入時也會再拉一次 */ }
    // v1.58：短連結（~150 字；v4 帶摘要時約 700 字）。摘要不再塞連結——改由伺服器
    // GET /invite 用群組記錄現算（伺服器本來就存明文記錄、也在每次 API 收 Bearer 祕鑰，
    // 這不會讓它多看到任何東西；反而 v4 連結被貼到公開場合時，任何人都能離線解碼出
    // 成員名與 12 個景點名——新格式要通過祕鑰驗證才讀得到摘要，是隱私改善）。
    // 祕鑰照樣只在 # fragment，不進任何伺服器的網址記錄。三代理投票 3:0 採此案。
    // n=行程名：分享後推送還沒到伺服器的頭幾秒（push 競態），對方秒點連結時 /invite
    // 還查不到——至少行程名要立刻出現，這是「家人傳的、不是詐騙」的第一眼訊號。
    const gcode = uuidToB64(group.id);
    if (gcode) {
      const parts = [`g=${gcode}`, `k=${group.syncSecret}`, `t=${tripId.slice(0, 8)}`];
      if (trip.title) parts.push(`n=${b64urlUtf8(String(trip.title).slice(0, 24))}`);
      const cfgUrl = getConfig().url || '';
      if (cfgUrl && cfgUrl !== DEFAULT_CLOUD_URL) parts.push(`u=${encodeURIComponent(cfgUrl)}`);
      return `${base}#/join?${parts.join('&')}`;
    }
    // 極罕見：群組 id 不是標準 UUID（很早期的資料）—— 退回 v4 長連結，至少能用
    const payload = {
      v: 4, kind: 'sync',
      url: getConfig().url,
      groupId: group.id, secret: group.syncSecret, tripId,
      title: trip.title, groupName: group.name || '旅伴',
      spots: spots.length, quests: quests.length, members: members.length,
      dates: [trip.startDate || '', trip.endDate || ''],
      who: members.slice(0, 4).map((m) => m.displayName).filter(Boolean),
      preview: spots.slice(0, 12).map((s) => ({ n: s.name, d: s.day || 1 })),
    };
    return `${base}#/join?j=${await gzip(JSON.stringify(payload))}`;
  }
  const code = await makeShareCode(tripId);
  return `${base}#/join?d=${code}`;
}

// ---------- 同步邀請 ----------
export async function peekInvite(code) {
  const p = JSON.parse(await gunzip(code));
  if (p.kind !== 'sync') throw new Error('邀請格式不符');
  if (Array.isArray(p.records)) {
    // 舊版連結相容（v2，整包資料直接帶在連結裡）
    const spots = p.records.filter((r) => r.type === 'spot').length;
    const quests = p.records.filter((r) => r.type === 'quest').length;
    const grp = p.records.find((r) => r.type === 'group');
    return { sync: true, group: grp?.name || '旅伴', title: p.title || '行程', spots, quests, url: p.url };
  }
  return { sync: true, group: p.groupName || '旅伴', title: p.title || '行程', spots: p.spots || 0, quests: p.quests || 0, url: p.url,
    dates: Array.isArray(p.dates) ? p.dates : [], who: Array.isArray(p.who) ? p.who : [], preview: Array.isArray(p.preview) ? p.preview : [] };
}

export async function joinInvite(code, { onProgress = null } = {}) {
  const prog = (m) => { try { onProgress && onProgress(m); } catch { /* noop */ } };
  // v1.58：也接受已解析的短連結物件（parseShortInvite 的結果）；字串則是舊版 gzip 碼
  const p = typeof code === 'string' ? JSON.parse(await gunzip(code)) : code;
  if (p.kind !== 'sync') throw new Error('邀請格式不符');
  // 設定同步後端（若本機還沒設）
  if (p.url && getConfig().mode === 'local') {
    setConfig({ mode: p.url.includes('workers.dev') ? 'cloud' : 'lan', url: p.url });
  } else if (!p.url && p.short && getConfig().mode === 'local') {
    // 短連結不帶 u= 代表用內建雲端；這台還在單機（剛裝好）就先指回內建，加入才有地方拉
    setConfig({ mode: 'cloud', url: DEFAULT_CLOUD_URL });
  }
  if (Array.isArray(p.records) && p.records.length) {
    // 舊版連結相容：資料本來就帶在連結裡
    await store.importRecords(p.records, { merge: true });
  } else {
    // 新版連結：只帶群組識別碼，資料整包從伺服器拉下來（這台是新裝置，since=0）。
    // 先把每一頁收集起來、最後一次寫進 IndexedDB —— 不要一頁寫一次（一個大行程
    // 好幾百筆記錄，每頁都整包重寫一次 IndexedDB 很慢，慢的操作在手機上更容易
    // 遇到瀏覽器把分頁切到背景、連線被回收的情況）。
    const { adapterForGroup, setCursor } = await import('./sync.js');
    const adapter = adapterForGroup(p.groupId, p.secret);
    // pull 對「伺服器還沒見過這個群組」的回應是 404（不是 200 配空陣列）——
    // 分享連結當下的推送還沒送達時就是這個狀態，不能讓它整個丟出去、要當成
    // 「還沒有資料」一樣的情況去重試，不然使用者會看到一個原始的技術錯誤。
    const pullAll = async () => {
      let since = 0;
      const all = [];
      for (let guard = 0; guard < 30; guard++) {
        let res;
        try { res = await adapter.pull(since); }
        catch { return { all, since }; }               // 404 / 網路問題 → 當作這次還拉不到
        if (res.records && res.records.length) { all.push(...res.records); prog(`正在接收行程… ${all.length} 筆`); }
        if (typeof res.seq === 'number') since = res.seq;
        if (!res.more) break;
      }
      return { all, since };
    };
    // 分享連結的當下會盡量把資料先推上伺服器，但那是「盡力而為」——網路慢、
    // 行程大（照片留言讚多，推送拆成好幾批）、分享當下手機被切去背景，都可能讓
    // 資料還沒真的送達。這裡不要一拉是空的就直接放棄，退避重試（總共約 50 秒），
    // 給伺服器足夠時間跟上——分享那邊的背景推送最多留了 40 秒的預算。
    let all = [], since = 0;
    const delays = [2000, 3000, 5000, 8000, 10000, 12000];
    prog('連線到旅伴的伺服器…');
    for (let i = 0; i <= delays.length; i++) {
      ({ all, since } = await pullAll());
      if (all.length) break;
      if (i < delays.length) { prog(`旅伴的資料還在上傳中，等一下再試（第 ${i + 1} 次）`); await new Promise((r) => setTimeout(r, delays[i])); }
    }
    if (!all.length) throw new Error('伺服器上還沒有這趟旅程的資料，可能是行程比較大、推送還沒完成。請等旅伴那邊網路穩定一點後再分享一次連結，或請他到「設定 → 多人同步」按「立即同步」後再分享。');
    prog(`整理 ${all.length} 筆資料…`);
    await store.importRecords(all, { merge: true });
    await setCursor(p.groupId, since);
  }
  // 照片縮圖在背景繼續抓（行程頁會顯示「正在接收照片」進度列），不讓使用者等它
  try { const { drain } = await import('./outbox.js'); drain().catch(() => {}); } catch { /* 稍後自動重試 */ }
  // 短連結只帶 tripId 前 8 碼：資料拉完後在本機解析成完整 id；比不到（那個行程
  // 已被刪）就退到這個群組最近更新的行程——按了「加入」不能沒有下一頁。
  let tripId = p.tripId || '';
  if (!tripId) {
    const trips = store.exportGroup(p.groupId).filter((r) => r.type === 'trip' && !r.deleted);
    const hit = (p.tripPrefix && trips.find((t) => String(t.id).startsWith(p.tripPrefix)))
      || trips.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (!hit) throw new Error('這個群組裡還沒有行程資料，請旅伴稍後重新分享一次連結。');
    tripId = hit.id;
  }
  try { localStorage.setItem('tripquest.welcome.' + tripId, '1'); } catch { /* noop */ }
  return tripId;
}

// ---------- v1.58 短邀請連結 ----------
// 格式：#/join?g=<groupId b64url 22>&k=<祕鑰>&t=<tripId 前 8>&n=<行程名 b64url>[&u=<自架網址>]
// 祕鑰照樣只在 # fragment；摘要改由伺服器 GET /invite 現算（見 shareURL 的說明）。
export function parseShortInvite(query) {
  const groupId = b64ToUuid(query.g || '');
  const secret = String(query.k || '');
  if (!groupId || !/^[A-Za-z0-9_-]{22,64}$/.test(secret)) return null;
  return {
    kind: 'sync', short: true, groupId, secret,
    tripPrefix: String(query.t || '').slice(0, 8),
    title: utf8FromB64url(query.n || ''),
    url: String(query.u || ''),                       // router 的 URLSearchParams 已解碼過
  };
}

// 從貼上的整串文字撈出短連結參數（前後可能帶字、可能被斷行）。
// 每個值後面都加負向斷言：連結被多貼了字時寧可不認，也不要吞下錯位的識別碼。
export function parseInviteText(s) {
  const t = String(s || '');
  const pick = (name, re) => {
    const m = t.match(new RegExp('[?&#]' + name + '=(' + re + ')(?![A-Za-z0-9_-])'));
    return m ? m[1] : '';
  };
  const g = pick('g', '[A-Za-z0-9_-]{22}');
  const k = pick('k', '[A-Za-z0-9_-]{22,64}');
  if (!g || !k) return null;
  let u = '';
  const um = t.match(/[?&]u=([^&#\s]+)/);
  if (um) { try { u = decodeURIComponent(um[1]); } catch { u = ''; } }
  return parseShortInvite({ g, k, t: pick('t', '[0-9a-f]{1,8}'), n: pick('n', '[A-Za-z0-9_-]+'), u });
}

// 跟伺服器拿邀請摘要（祕鑰走 Authorization header，不進網址）。
// 404 = 旅伴的資料還沒推完（分享當下的 push 競態）；403 = 祕鑰不對（連結多半被截斷）。
export async function fetchInviteSummary(p, { timeoutMs = 12000 } = {}) {
  const base = String(p.url || getConfig().url || DEFAULT_CLOUD_URL).replace(/\/+$/, '');
  const res = await fetch(`${base}/invite?g=${encodeURIComponent(p.groupId)}&t=${encodeURIComponent(p.tripPrefix || '')}`, {
    headers: { authorization: 'Bearer ' + p.secret },
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) { const e = new Error('讀取邀請摘要失敗（' + res.status + '）'); e.status = res.status; throw e; }
  return res.json();
}

export async function peekShareCode(code) {
  const p = JSON.parse(await gunzip(code));
  if (p.kind !== 'questset') throw new Error('代碼格式不符');
  return {
    group: p.group?.name || '旅伴',
    title: p.trip?.title || '行程',
    spots: (p.spots || []).length,
    quests: (p.quests || []).length,
  };
}

export async function importShareCode(code) {
  const json = await gunzip(code);
  const p = JSON.parse(json);
  if (p.kind !== 'questset') throw new Error('代碼格式不符');
  const groupId = uuid();
  const tripId = uuid();
  await store.put({ id: groupId, type: 'group', name: p.group?.name || '旅伴', joinCode: '' });
  await store.put({
    id: tripId, type: 'trip', groupId,
    title: p.trip.title, startDate: p.trip.startDate, endDate: p.trip.endDate,
    region: p.trip.region || '', allowGeo: false, joinedFromShare: true,
  });
  const idMap = new Map();
  for (const s of p.spots) {
    const nid = uuid();
    idMap.set(s.id, nid);
    await store.put({
      id: nid, type: 'spot', tripId, name: s.name, nameLocal: s.name,
      region: s.region, day: s.day, order: s.order, lat: s.lat ?? null, lng: s.lng ?? null, source: 'shared',
    });
  }
  for (const q of p.quests) {
    await store.put({
      id: uuid(), type: 'quest', tripId, spotId: idMap.get(q.spotId),
      title: q.title, hint: q.hint, kind: q.kind, order: q.order, source: 'shared', refImage: null,
    });
  }
  return tripId;
}

// ---------- 完整備份（含照片）----------
export async function exportBundle(tripId) {
  const trip = store.get(tripId);
  const ids = new Set([tripId, trip.groupId]);
  for (const r of store.exportRecords()) {
    if (r.tripId === tripId || (r.type === 'member' && r.groupId === trip.groupId)) ids.add(r.id);
  }
  const records = store.exportRecords().filter((r) => ids.has(r.id));
  const hashes = new Set();
  for (const r of records) {
    if (r.type === 'submission') { hashes.add(r.photoHash); hashes.add(r.thumbHash); }
  }
  const blobs = {};
  for (const hHash of hashes) {
    if (!hHash) continue;
    const entry = await db.getBlob(hHash);
    if (entry) blobs[hHash] = { b64: await blobToB64(entry.blob), kind: entry.kind, type: entry.blob.type };
  }
  const bundle = { app: 'tripquest', v: 1, exportedAt: Date.now(), records, blobs };
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' });
}

export async function importBundle(file) {
  const text = await file.text();
  const bundle = JSON.parse(text);
  if (bundle.app !== 'tripquest') throw new Error('不是 TripQuest 備份檔');
  for (const [hHash, b] of Object.entries(bundle.blobs || {})) {
    const existing = await db.getBlob(hHash);
    if (!existing) {
      const blob = b64ToBlob(b.b64, b.type || 'image/jpeg');
      await db.putBlob({ hash: hHash, blob, bytes: blob.size, kind: b.kind || 'photo' });
    }
  }
  await store.importRecords(bundle.records || [], { merge: true });
  const trip = (bundle.records || []).find((r) => r.type === 'trip');
  return trip?.id || null;
}

function blobToB64(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

// ---------- 觸發下載 / 分享 ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function nativeShare({ title, text, url, files }) {
  if (navigator.share) {
    try {
      const data = { title, text };
      if (url) data.url = url;
      if (files && navigator.canShare && navigator.canShare({ files })) data.files = files;
      await navigator.share(data);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  return false;
}

// 測試用（jointest 需要偽造一個「伺服器上還沒有資料」的連結）
export const __gzip = gzip;
export const __gunzip = gunzip;
