// AI 文案協調層 —— 有開 AI 的行程「自動」用 AI 生成行程表 / 影片 / 回顧的文案，
// 沒開就用內建句型庫。全部走這裡，保證：
//   · 產一次就快取成 aiText 記錄，跟著群組同步 → 旅伴不用各自再花錢
//   · 輸入沒變就不重打（sig 比對）；正在產的不會重複觸發（inFlight）
//   · 任何失敗 / 沒金鑰 / 超上限 → 回傳 null 或舊快取，呼叫端安靜退回內建做法
//   · 只有行程建立者（有金鑰那台）會真的呼叫；其他人只讀同步下來的結果
//
// aiText 記錄：{ type:'aiText', tripId, groupId, key, payload, sig, aiAt }
//   key: tripText | spotBlurbs | spotQuests | photoCaptions | recapText

import * as store from './store.js';
import { aiOn, aiComplete, aiJSON } from './ai.js';
import { myDeviceId } from './identity.js';
import { themeMeta, themeForSpot } from './theme.js';

// 只有行程建立者（貼了金鑰那台）會真的呼叫 AI；舊行程沒記 createdByDevice → 放行
function isCreator(trip) {
  if (!trip) return false;
  if (!trip.createdByDevice) return true;
  return trip.createdByDevice === myDeviceId();
}

// ---------- 快取讀寫 ----------
export function aiTextRec(tripId, key) {
  return store.exportRecords().find(
    (r) => r.type === 'aiText' && r.tripId === tripId && r.key === key && !r.deleted,
  ) || null;
}
export function aiPayload(tripId, key) {
  const r = aiTextRec(tripId, key);
  return r ? (r.payload ?? (r.lines ? { lines: r.lines } : null)) : null;
}
async function writePayload(tripId, key, payload, sig) {
  const trip = store.get(tripId);
  const cur = aiTextRec(tripId, key);
  await store.put({
    id: cur ? cur.id : undefined,
    type: 'aiText', tripId, groupId: trip && trip.groupId, key,
    payload, sig, aiAt: Date.now(),
  });
}

function sigOf(obj) {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

const inFlight = new Map();

// 核心：回傳快取 payload，或（建立者且該產時）產一份、快取、回傳。永不 throw。
//
// 併發安全的關鍵：從「查快取」到「登記 inFlight」這段路上絕不能有 await —— 這裡的
// 每一步都是同步的，JS 單執行緒保證兩個幾乎同時的呼叫，先跑到的那個會不被打斷地
// 做完「查快取 → 查 inFlight → 登記 inFlight」整套，第二個呼叫進來時一定看得到
// 第一個已經登記的 inFlight，不會兩邊都誤判「還沒人在做」而各自真的打一次 API
// （例如 enrichTrip 背景任務跟第一次進頁的 warmTripContent 幾乎同時觸發時）。
// 真正要等的（aiOn 要讀 IndexedDB 金鑰、generate 要打 API）全部搬進 inFlight
// 追蹤的 promise 裡面才 await。
function ensure(tripId, key, sig, generate) {
  const cached = aiTextRec(tripId, key);
  if (cached && cached.sig === sig && cached.payload) return Promise.resolve(cached.payload);

  const flightKey = tripId + ':' + key;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey).catch(() => (cached ? cached.payload : null));

  const p = (async () => {
    try {
      const trip = store.get(tripId);
      if (!trip || !isCreator(trip)) return cached ? cached.payload : null;
      if (!(await aiOn(tripId))) return cached ? cached.payload : null;
      // 等 aiOn 的這段時間，sig 有可能已經被別的呼叫寫好了（沒被 inFlight 擋到的舊快取）
      const cached2 = aiTextRec(tripId, key);
      if (cached2 && cached2.sig === sig && cached2.payload) return cached2.payload;
      const payload = await generate();
      if (payload && (Array.isArray(payload) ? payload.length : Object.keys(payload).length)) {
        await writePayload(tripId, key, payload, sig);
        return payload;
      }
    } catch { /* 靜默 */ }
    return cached ? cached.payload : null;
  })().finally(() => inFlight.delete(flightKey));

  inFlight.set(flightKey, p);
  return p;
}

// ---------- 行程模型（給 prompt 用的精簡版）----------
function tripDigest(tripId) {
  const trip = store.get(tripId);
  const spots = store.spotsOf(tripId).slice().sort((a, b) => (a.day || 1) - (b.day || 1) || (a.order || 0) - (b.order || 0));
  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) => ({
    day,
    region: list[0]?.region || trip.region || '',
    theme: themeMeta(list[0] ? themeForSpot(list[0]) : 'journey').label,
    spots: list.map((s) => s.name),
  }));
  return { title: trip.title || '我們的旅程', region: trip.region || '', days, spots };
}

// ================= 1. 行程表 + 影片文案（一次呼叫）=================
// payload: { subtitle, dayLines:{[day]:string}, videoIntro, videoOutro, narration:{[day]:string} }
export async function ensureTripText(tripId) {
  const d = tripDigest(tripId);
  if (!d.days.length) return null;
  const sig = sigOf({ t: d.title, days: d.days.map((x) => [x.day, x.region, x.spots]) });
  return ensure(tripId, 'tripText', sig, async () => {
    const dayList = d.days.map((x) => `第${x.day}天（${x.region || '—'}，${x.theme}）：${x.spots.join('、')}`).join('\n');
    const obj = await aiJSON(tripId, {
      feature: 'narrate', maxTokens: 700,
      system: '你在幫一份給長輩看的家庭旅遊「行程表海報」與「回憶影片」寫文案。全部繁體中文、親切自然、不誇飾、不用英文與流行語。嚴格回一個 JSON 物件，不要多餘文字。',
      prompt:
        `旅程名稱：${d.title}\n${dayList}\n\n` +
        '請產生：\n' +
        '{\n' +
        '  "subtitle": "海報副標，一句 12～20 字，點出這趟的味道",\n' +
        '  "dayLines": { "1": "海報上第1天的一句話 10～18 字", ... 每天一句 },\n' +
        '  "videoIntro": "影片片頭旁白，一句 12～20 字",\n' +
        '  "videoOutro": "影片片尾旁白，一句 12～20 字",\n' +
        '  "narration": { "1": "影片第1天字卡旁白 12～22 字", ... 每天一句 }\n' +
        '}',
    });
    if (!obj || typeof obj !== 'object') return null;
    const pickMap = (m) => {
      const out = {};
      if (m && typeof m === 'object') for (const k of Object.keys(m)) {
        const v = String(m[k] || '').trim();
        if (v) out[String(parseInt(k, 10) || k)] = v.slice(0, 60);
      }
      return out;
    };
    return {
      subtitle: String(obj.subtitle || '').trim().slice(0, 40) || null,
      dayLines: pickMap(obj.dayLines),
      videoIntro: String(obj.videoIntro || '').trim().slice(0, 40) || null,
      videoOutro: String(obj.videoOutro || '').trim().slice(0, 40) || null,
      narration: pickMap(obj.narration),
    };
  });
}

// ================= 2. 每個景點一句介紹（一次呼叫，全部景點）=================
// payload: { [spotId]: blurb }。同時寫回 spot.blurb（aiBlurb 標記），poster / spot 頁直接讀。
export async function ensureSpotBlurbs(tripId) {
  const spots = store.spotsOf(tripId);
  const targets = spots.filter((s) => !s.blurbManual);
  if (!targets.length) return null;
  const sig = sigOf(targets.map((s) => [s.id, s.name, s.region]));

  const payload = await ensure(tripId, 'spotBlurbs', sig, async () => {
    const d = tripDigest(tripId);
    const list = targets.map((s, i) => `${i + 1}. ${s.name}${s.region ? '（' + s.region + '）' : ''}`).join('\n');
    const arr = await aiJSON(tripId, {
      feature: 'recommend', maxTokens: 900,
      system: '你是台灣在地旅遊小幫手，正在幫一份給長輩看的行程表寫每個地點的一句介紹。每句 25～40 字、繁體中文、親切、講最有代表性的東西或必拍必吃，不要英文、不要誇飾、不要流行語。同一趟裡句型不要重複。嚴格回一個 JSON 字串陣列，長度與清單相同，順序對應。',
      prompt: `旅程：${d.title}\n地點清單：\n${list}\n\n只回 JSON 陣列，例如 ["…","…"]`,
    });
    if (!Array.isArray(arr)) return null;
    const out = {};
    targets.forEach((s, i) => {
      const line = String(arr[i] || '').trim().replace(/^\d+[.、]\s*/, '').replace(/^["「]|["」]$/g, '');
      if (line.length >= 8) out[s.id] = line.slice(0, 60);
    });
    return Object.keys(out).length ? out : null;
  });

  // 寫回 spot.blurb（保留內建版當退路；使用者手改過的不動）
  if (payload) {
    for (const s of targets) {
      const line = payload[s.id];
      const fresh = store.getRaw(s.id);
      if (!line || !fresh || fresh.blurbManual) continue;
      if (fresh.blurb === line && fresh.aiBlurb) continue;
      await store.patch(s.id, {
        blurbBuiltin: fresh.blurbBuiltin || (fresh.aiBlurb ? fresh.blurbBuiltin : fresh.blurb) || '',
        blurb: line, aiBlurb: true, aiAt: Date.now(),
      });
    }
  }
  return payload;
}

// ================= 3. 每個景點的任務名稱與提示（一次呼叫）=================
// 只替換內建模板產生的任務（source: template / generic / view）；策展題與必吃題不動。
export async function ensureSpotQuests(tripId) {
  const spots = store.spotsOf(tripId);
  const editable = [];
  for (const s of spots) {
    const qs = store.questsOf(s.id).filter((q) => ['template', 'generic', 'view', 'ai'].includes(q.source) && !q.titleManual);
    if (qs.length) editable.push({ spot: s, quests: qs });
  }
  if (!editable.length) return null;
  const sig = sigOf(editable.map((e) => [e.spot.id, e.spot.name, e.quests.length]));

  const payload = await ensure(tripId, 'spotQuests', sig, async () => {
    const blocks = editable.map((e, i) =>
      `${i + 1}. ${e.spot.name}：需要 ${e.quests.length} 個拍照任務`).join('\n');
    const obj = await aiJSON(tripId, {
      feature: 'recommend', maxTokens: 1100,
      system: '你在幫一個家庭旅遊拍照 App 出「拍照任務」。每個任務有標題（6～12 字，像闖關）與提示（一句話，說要拍成怎樣算完成，給長輩看）。繁體中文、具體、不誇飾。嚴格回 JSON 物件：{"1":[{"title":"…","hint":"…"}],"2":[...]}，數字對應清單編號，每個地點的任務數與清單一致。',
      prompt: `地點與需要的任務數：\n${blocks}`,
    });
    if (!obj || typeof obj !== 'object') return null;
    const out = {};
    editable.forEach((e, i) => {
      const items = obj[String(i + 1)] || obj[i + 1];
      if (Array.isArray(items) && items.length) {
        out[e.spot.id] = items.slice(0, e.quests.length).map((it) => ({
          title: String(it.title || '').trim().slice(0, 24),
          hint: String(it.hint || '').trim().slice(0, 80),
        })).filter((it) => it.title);
      }
    });
    return Object.keys(out).length ? out : null;
  });

  if (payload) {
    for (const e of editable) {
      const items = payload[e.spot.id];
      if (!Array.isArray(items)) continue;
      for (let i = 0; i < e.quests.length && i < items.length; i++) {
        const q = store.getRaw(e.quests[i].id);
        if (!q || q.titleManual) continue;
        if (q.title === items[i].title && q.aiQuest) continue;
        await store.patch(q.id, { title: items[i].title, hint: items[i].hint || q.hint, source: 'ai', aiQuest: true });
      }
    }
  }
  return payload;
}

// ================= 4. 照片字幕（只補使用者沒寫 caption 的）=================
// payload: { [photoHash]: caption }
export async function ensurePhotoCaptions(tripId) {
  const gone = new Set(store.exportRecords().filter((r) => r.type === 'retraction').map((r) => r.submissionId));
  const subs = store.submissionsOfTrip(tripId).filter((s) => !gone.has(s.id) && !store.photoCaption(s).trim());
  const seen = new Set();
  const targets = [];
  for (const s of subs) {
    if (seen.has(s.photoHash)) continue;
    seen.add(s.photoHash);
    const q = store.getRaw(s.questId);
    const spot = q ? store.getRaw(q.spotId) : null;
    const tag = store.photoTag(s);
    const member = tag.photographerId ? store.getRaw(tag.photographerId) : null;
    targets.push({ hash: s.photoHash, quest: q?.title || '', spot: spot?.name || '', who: member?.displayName || '', day: spot?.day || 1 });
  }
  if (targets.length < 2) return null;
  const sig = sigOf(targets.map((t) => t.hash).sort());

  return ensure(tripId, 'photoCaptions', sig, async () => {
    const list = targets.map((t, i) => `${i + 1}. 第${t.day}天 ${t.spot}｜任務：${t.quest}${t.who ? '｜拍攝：' + t.who : ''}`).join('\n');
    const arr = await aiJSON(tripId, {
      feature: 'narrate', maxTokens: 900,
      system: '你在幫家庭旅遊相簿的每張照片寫一句短字幕，8～16 字、繁體中文、溫暖具體、像在說回憶，不要英文。嚴格回 JSON 字串陣列，長度與清單相同、順序對應。',
      prompt: `照片清單：\n${list}\n\n只回 JSON 陣列`,
    });
    if (!Array.isArray(arr)) return null;
    const out = {};
    targets.forEach((t, i) => {
      const c = String(arr[i] || '').trim().replace(/^\d+[.、]\s*/, '').replace(/^["「]|["」]$/g, '');
      if (c.length >= 4) out[t.hash] = c.slice(0, 40);
    });
    return Object.keys(out).length ? out : null;
  });
}

// ================= 5. 最終回顧文案 =================
// facts: 從 buildRecap 出來的精簡數字。payload: { opening, weather, topSpot, longest, closing }
export async function ensureRecapText(tripId, facts) {
  if (!facts) return null;
  const sig = sigOf({
    t: facts.title, ph: facts.photoCount, sp: facts.spotCount, km: facts.distanceKm,
    done: facts.doneCount, foods: (facts.foods || []).length, people: facts.people,
    hi: facts.weather?.hi, lo: facts.weather?.lo,
  });
  return ensure(tripId, 'recapText', sig, async () => {
    const obj = await aiJSON(tripId, {
      feature: 'narrate', maxTokens: 500,
      system: '你在幫一份家庭旅遊「成果回顧」寫文案，給長輩看。繁體中文、溫暖、具體帶到數字、不誇飾、不用英文。嚴格回 JSON 物件，不要多餘文字。',
      prompt:
        `旅程：${facts.title}\n` +
        `${facts.dayCount} 天、${facts.people} 人、去了 ${facts.spotCount} 個地方、拍 ${facts.photoCount} 張、` +
        `完成 ${facts.doneCount}/${facts.questTotal} 個任務、走約 ${facts.distanceKm} 公里、互動 ${facts.interactions} 次。\n` +
        (facts.weather ? `天氣最高 ${facts.weather.hi} 度、最低 ${facts.weather.lo} 度、${facts.weather.rainyDays || 0} 天下雨。\n` : '') +
        (facts.topSpot ? `最多照片：${facts.topSpot.name}（${facts.topSpot.photos} 張）。\n` : '') +
        (facts.longestSpot ? `待最久：${facts.longestSpot.name}。\n` : '') +
        ((facts.foods || []).length ? `吃到：${facts.foods.map((f) => f.title).slice(0, 6).join('、')}。\n` : '') +
        '\n請產生：\n{\n' +
        '  "opening": "開場一句 15～28 字，總結這趟",\n' +
        '  "weather": "把天氣講成一句自然的話（沒有天氣資料就回空字串）",\n' +
        '  "topSpot": "把最多回憶的地方講成一句（沒有就空字串）",\n' +
        '  "closing": "結尾一句 12～20 字，留念的話"\n}',
    });
    if (!obj || typeof obj !== 'object') return null;
    const s = (v) => String(v || '').trim().slice(0, 80);
    const out = { opening: s(obj.opening), weather: s(obj.weather), topSpot: s(obj.topSpot), closing: s(obj.closing) };
    return (out.opening || out.closing) ? out : null;
  });
}

// 行程頁載入時在背景把該產的都產一產（安靜、有快取就秒回）。
// 回傳 true = 這次真的有新內容產生 / 更新（呼叫端才需要重繪，避免無限重繪）。
//
// 同一個 tripId 同時只會真的跑一份：trip.js 進頁會呼叫、enrichTrip 補完景點後的
// 重繪也會再呼叫一次，兩個幾乎同時發生時不能各自都去產生 / 花錢一次。
const warmingTrips = new Map();
export function warmTripContent(tripId) {
  if (warmingTrips.has(tripId)) return warmingTrips.get(tripId);
  const p = (async () => {
    const trip = store.get(tripId);
    if (!trip || !trip.aiEnabled) return false;
    const before = warmStamp(tripId);
    try {
      await ensureTripText(tripId);
      await ensureSpotBlurbs(tripId);
      await ensureSpotQuests(tripId);
    } catch { /* 靜默 */ }
    return warmStamp(tripId) !== before;
  })().finally(() => warmingTrips.delete(tripId));
  warmingTrips.set(tripId, p);
  return p;
}

function warmStamp(tripId) {
  const parts = ['tripText', 'spotBlurbs', 'spotQuests'].map((k) => {
    const r = aiTextRec(tripId, k);
    return k + (r ? r.sig + ':' + r.aiAt : '-');
  });
  for (const s of store.spotsOf(tripId)) if (s.aiBlurb) parts.push(s.id + s.blurb);
  return parts.join('|');
}

// 這趟有沒有用到 AI 文案（給畫面顯示「✨ 由 AI 生成」小標記）
export function tripUsesAiText(tripId) {
  const trip = store.get(tripId);
  if (!trip || !trip.aiEnabled) return false;
  return ['tripText', 'spotBlurbs', 'spotQuests', 'photoCaptions', 'recapText']
    .some((k) => { const r = aiTextRec(tripId, k); return r && r.payload; });
}

void aiComplete;
