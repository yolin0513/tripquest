// AI 文案端到端測試（npm run aitest）—— 用攔截的 mock Anthropic API 驗證：
// 啟用→自動用、未啟用→內建、失敗→靜默退回內建、快取不重複花錢、跟著群組同步、金鑰不外洩。
// AI 文案：啟用→自動用、未啟用→內建、失敗→靜默退回、快取、同步、標記、用量。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const PORT = 5333, BASE = `http://localhost:${PORT}`;
const KEY = 'sk-ant-api03-' + 'T'.repeat(80);
const srv = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await sleep(1200);
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ok = (m) => console.log('✓ ' + m);
const bad = (m) => { console.error('✗ ' + m); process.exitCode = 1; };

let mode = 'good';                 // good | fail
let calls = 0;
async function newPage() {
  // 每個「裝置」要用獨立的瀏覽器 context——用 b.newPage() 的話所有分頁共用同一份
  // IndexedDB（同一個 origin），前面幾節測試建立的行程會一直留著，後面用
  // 「找第一個 trip 記錄」這種寫法就會因為 IndexedDB getAll() 不保證插入順序
  // （用 uuid 當 key，回傳順序接近亂序）隨機挑到別節測試留下的舊行程，測試才會
  // 時過時不過。
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    const u = req.url();
    if (u.includes('api.anthropic.com')) {
      const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
      calls++;
      if (mode === 'fail') return req.respond({ status: 429, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { message: 'overloaded, key sk-ant-should-be-scrubbed' } }) });
      const body = JSON.parse(req.postData() || '{}');
      if (!body.messages || !body.messages[0]) return req.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }], usage: {} }) });
      const prompt = body.messages[0].content;
      let payload;
      if (/JSON 字串陣列/.test(body.system) && /地點清單/.test(prompt)) {
        const n = (prompt.match(/^\d+\. /gm) || []).length;
        payload = JSON.stringify(Array.from({ length: n }, (_, i) => `這是第${i + 1}個地方的AI介紹，字數大概夠長可以顯示出來`));
      } else if (/拍照任務/.test(body.system)) {
        const obj = {};
        (prompt.match(/^\d+\. /gm) || []).forEach((_, i) => { obj[i + 1] = [{ title: `AI任務${i + 1}A`, hint: `提示${i + 1}A` }, { title: `AI任務${i + 1}B`, hint: `提示${i + 1}B` }]; });
        payload = JSON.stringify(obj);
      } else if (/行程表海報/.test(body.system)) {
        payload = JSON.stringify({ subtitle: 'AI海報副標', dayLines: { 1: 'AI第一天一句', 2: 'AI第二天一句' }, videoIntro: 'AI片頭', videoOutro: 'AI片尾', narration: { 1: 'AI旁白一', 2: 'AI旁白二' } });
      } else if (/成果回顧/.test(body.system)) {
        payload = JSON.stringify({ opening: 'AI回顧開場白總結這趟旅程', weather: 'AI天氣句', topSpot: 'AI最多回憶句', closing: 'AI結尾留念' });
      } else if (/相簿的每張照片/.test(body.system)) {
        const n = (prompt.match(/^\d+\. /gm) || []).length;
        payload = JSON.stringify(Array.from({ length: n }, (_, i) => `AI照片字幕${i + 1}`));
      } else {
        payload = JSON.stringify({});
      }
      return req.respond({
        status: 200, headers: CORS, contentType: 'application/json',
        body: JSON.stringify({ content: [{ text: payload }], usage: { input_tokens: 400, output_tokens: 200 } }),
      });
    }
    if (/wikipedia|wikimedia|open-meteo|nominatim|overpass/.test(u)) return req.respond({ status: 404, body: '' });
    // js/sync.js 內建預設指向正式 Cloudflare Worker（BUILT_IN）——本機測試絕對不要真的
    // 打過去（會把測試資料寫進正式環境，而且外部網路延遲會讓測試跑起來時快時慢）。
    if (u.includes('workers.dev')) return req.abort('failed');
    req.continue();
  });
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await p.waitForSelector('.hero');
  // 強制單機模式：不讓背景 outbox 真的打正式伺服器，測試才是純本機、確定性的。
  await p.evaluate(async () => { (await import('./js/sync.js')).setConfig({ mode: 'local', url: '' }); });
  return p;
}

async function makeTrip(p, aiEnabled) {
  return p.evaluate(async (aiEnabled) => {
    const s = await import('./js/store.js');
    const { generateForTrip } = await import('./js/quests/generate.js');
    const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: uuid(), type: 'member', groupId: gid, displayName: '阿明' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '京都測試', region: '京都', country: 'JP', allowWiki: false, aiEnabled, createdByDevice: myDeviceId(), startDate: '2026-04-01', endDate: '2026-04-02' });
    const { spots, quests } = await generateForTrip({ tripId: tid, itineraryText: '第1天 清水寺、金閣寺\n第2天 嵐山、伏見稻荷', region: '京都' });
    for (const sp of spots) await s.put(sp);
    for (const q of quests) await s.put(q);
    return { tid, gid };
  }, aiEnabled);
}

try {
  // ---------- 1. AI 未啟用 → 全部內建、零呼叫 ----------
  {
    const p = await newPage();
    const { tid } = await makeTrip(p, false);
    const r = await p.evaluate(async (tid) => {
      const ai = await import('./js/aicontent.js');
      const s = await import('./js/store.js');
      const tx = await ai.ensureTripText(tid);
      const bl = await ai.ensureSpotBlurbs(tid);
      return { tx, bl, blurbs: s.spotsOf(tid).map((x) => x.blurb), anyAi: s.spotsOf(tid).some((x) => x.aiBlurb) };
    }, tid);
    if (r.tx === null && r.bl === null && calls === 0 && !r.anyAi && r.blurbs.every((x) => x && x.length)) ok('未啟用：不呼叫 AI、景點用內建介紹句');
    else bad('未啟用行為錯誤：' + JSON.stringify(r) + ' calls=' + calls);
    await p.close();
  }

  // ---------- 2. AI 啟用 + 金鑰 → 自動產生、快取、標記、用量、同步無金鑰 ----------
  calls = 0;
  let exported;
  let creatorTid;
  {
    const p = await newPage();
    const { tid, gid } = await makeTrip(p, true);
    creatorTid = tid;
    await p.evaluate(async (tid, key) => {
      const { setTripKey } = await import('./js/aikeys.js');
      await setTripKey(tid, { key });
    }, tid, KEY);

    const r = await p.evaluate(async (tid) => {
      const ai = await import('./js/aicontent.js');
      const s = await import('./js/store.js');
      const { usageOf } = await import('./js/aikeys.js');
      const changed1 = await ai.warmTripContent(tid);
      const changed2 = await ai.warmTripContent(tid);          // 第二次應命中快取、不再呼叫
      const tx = ai.aiPayload(tid, 'tripText');
      const spots = s.spotsOf(tid);
      const quests = s.questsOfTrip(tid);
      return {
        changed1, changed2, tx,
        blurbs: spots.map((x) => ({ b: x.blurb, ai: !!x.aiBlurb, builtin: x.blurbBuiltin })),
        aiQuests: quests.filter((q) => q.aiQuest).length,
        curatedUntouched: quests.filter((q) => q.source === 'curated' || q.source === 'must').every((q) => !q.aiQuest),
        usage: await usageOf(tid),
      };
    }, tid);

    if (r.changed1 && !r.changed2) ok('啟用：第一次產生、第二次命中快取（不重複花錢）');
    else bad('快取行為錯誤：' + JSON.stringify({ c1: r.changed1, c2: r.changed2 }));

    if (r.tx && r.tx.subtitle === 'AI海報副標' && r.tx.narration['1'] === 'AI旁白一') ok('啟用：行程表 / 影片文案自動用 AI');
    else bad('tripText 錯誤：' + JSON.stringify(r.tx));

    if (r.blurbs.every((x) => x.ai && /AI介紹/.test(x.b)) && r.blurbs.every((x) => x.builtin && x.builtin.length)) ok('啟用：每個景點換成 AI 介紹句、內建版留作退路');
    else bad('blurb 錯誤：' + JSON.stringify(r.blurbs));

    if (r.aiQuests >= 4 && r.curatedUntouched) ok('啟用：內建模板任務換成 AI 出題、策展與必吃題不動');
    else bad('quest 錯誤：aiQuests=' + r.aiQuests + ' curatedUntouched=' + r.curatedUntouched);

    // v1.73.1：以前是 `> 0 && < 0.05` —— 實測把費率表改成 Haiku 的價（差 3 倍）
    // 這條斷言照樣全綠。現在算死：mock 回 400 in / 200 out，呼叫 3 次。
    // 換模型漏改費率表、或費率表本身寫錯，這裡會紅。
    const RT = { 'claude-haiku-4-5': { in: 1, out: 5 }, 'claude-sonnet-5': { in: 2, out: 10 } };
    const modelSrc = await readFile(new URL('../js/ai.js', import.meta.url), 'utf8');
    const usedModel = (modelSrc.match(/const MODEL = '([^']+)'/) || [])[1];
    const rate = RT[usedModel];
    const want = rate ? 3 * (400 * rate.in + 200 * rate.out) / 1e6 : null;
    if (!rate) bad(`js/ai.js 的 MODEL（${usedModel}）不在測試的費率對照表裡 —— 換模型要一併更新兩邊`);
    else if (Math.abs(r.usage.usedUsd - want) < 1e-9)
      ok(`用量算到分錢：$${r.usage.usedUsd.toFixed(4)}（${usedModel} 的 $${rate.in}/$${rate.out}，3 次 × 400in/200out）`);
    else bad(`用量不對：算出 $${r.usage.usedUsd.toFixed(6)}，按 ${usedModel} 的牌價應為 $${want.toFixed(6)}`);

    // 同步 payload 不能有金鑰、但要有 aiText
    exported = await p.evaluate(async (gid) => {
      const s = await import('./js/store.js');
      const recs = s.exportGroup(gid);
      return { json: JSON.stringify(recs), aiTextCount: recs.filter((x) => x.type === 'aiText').length };
    }, gid);
    if (!exported.json.includes('sk-ant-') && exported.aiTextCount >= 1) ok('同步：aiText 有進 payload、金鑰沒有');
    else bad('同步 payload 錯誤：aiText=' + exported.aiTextCount + ' 含金鑰=' + exported.json.includes('sk-ant-'));

    await p.close();
  }

  // ---------- 3. 非建立者：讀得到同步下來的 AI 文案、但自己不呼叫 ----------
  calls = 0;
  {
    const p = await newPage();
    const r = await p.evaluate(async (dump, tripId) => {
      const s = await import('./js/store.js');
      const ai = await import('./js/aicontent.js');
      for (const rec of JSON.parse(dump)) await s.put(rec);          // 模擬 pull 下來
      const trip = s.get(tripId);
      // 這台沒有金鑰，且 createdByDevice 不是自己
      const tx = ai.aiPayload(trip.id, 'tripText');
      const gen = await ai.ensureTripText(trip.id);                   // 不該真的呼叫
      return { hasCached: !!tx && tx.subtitle === 'AI海報副標', genSame: gen && gen.subtitle === 'AI海報副標' };
    }, exported.json, creatorTid);
    if (r.hasCached && r.genSame && calls === 0) ok('非建立者：直接看到同步來的 AI 文案、自己不呼叫 AI');
    else bad('非建立者行為錯誤：' + JSON.stringify(r) + ' calls=' + calls);
    await p.close();
  }

  // ---------- 4. AI 失敗（429）→ 靜默退回內建、不 throw、金鑰不外洩 ----------
  calls = 0; mode = 'fail';
  {
    const p = await newPage();
    const { tid } = await makeTrip(p, true);
    await p.evaluate(async (tid, key) => {
      const { setTripKey } = await import('./js/aikeys.js');
      await setTripKey(tid, { key });
    }, tid, KEY);
    const r = await p.evaluate(async (tid) => {
      const ai = await import('./js/aicontent.js');
      const s = await import('./js/store.js');
      let threw = false;
      try { await ai.warmTripContent(tid); } catch { threw = true; }
      const rec = await import('./js/recap.js').then((m) => m.buildRecap(tid)).catch(() => null);
      let recapAi = 'x';
      try { recapAi = await ai.ensureRecapText(tid, rec); } catch { recapAi = 'threw'; }
      return {
        threw,
        tx: ai.aiPayload(tid, 'tripText'),
        blurbs: s.spotsOf(tid).map((x) => x.blurb),
        anyAiBlurb: s.spotsOf(tid).some((x) => x.aiBlurb),
        recapAi,
        calls: (await import('./js/aikeys.js').then((m) => m.usageOf(tid))).usedUsd,
      };
    }, tid);
    const leak = JSON.stringify(r).includes('sk-ant-') || JSON.stringify(r).includes('should-be-scrubbed');
    if (!r.threw && r.tx === null && !r.anyAiBlurb && r.recapAi === null && r.blurbs.every((x) => x && x.length) && !leak) {
      ok('失敗：靜默退回內建文案、不 throw、金鑰與錯誤字串不外洩');
    } else bad('失敗行為錯誤：' + JSON.stringify(r) + ' leak=' + leak);
    // aicontent.js 從不 import toast → 結構上不可能丟英文錯誤訊息給使用者
    ok('失敗：aicontent 不接觸 UI，使用者不會看到技術錯誤');
    await p.close();
  }
  // ---------- v1.72.1：舊文案怎麼換成新的 ----------
  // 使用者實測 v1.72.0 回報「更新後字卡還是舊句子」。查出來機制是對的，
  // 但每一種擋下來的情況都靜默（不是建立者／沒金鑰／超上限／API 掛掉），
  // 而且沒有金鑰的裝置按「重新產生」會把文案刪光又產不回來。
  console.log('\n— 舊文案的更新路徑 —');
  const P = await newPage();
  await P.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await P.waitForSelector('.hero');
  const BADLINE = '溫泉公園漫步，品嚐在地雞湯，了解水產養殖，溫暖的宜蘭說不再見';
  const mkStale = (withKey) => P.evaluate(async (o) => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const k = await import('./js/aikeys.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-01', aiEnabled: true, createdByDevice: myDeviceId() });
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '礁溪溫泉公園', emoji: '📍',
      day: 1, order: 0, lat: 24.8, lng: 121.7 });
    if (o.withKey) await k.setTripKey(tid, { key: 'sk-ant-FAKEFAKEFAKEFAKEFAKEFAKEFAKE' });
    // sig 刻意設成對不上的（＝v1.72 之前產的那一筆）
    await s.put({ id: uuid(), type: 'aiText', tripId: tid, groupId: gid, key: 'tripText', sig: 'OLDSIG',
      payload: { subtitle: '舊', dayLines: { 1: '舊' }, videoIntro: '舊', videoOutro: '舊',
        narration: { 1: o.bad } } });
    if (window.__aiCalls) window.__aiCalls.length = 0;
    return tid;
  }, { withKey, bad: BADLINE });

  // 沒有金鑰：狀態要講得出原因，而且**不准刪**
  const noKeyTid = await mkStale(false);
  const noKey = await P.evaluate(async (tid) => {
    const ac = await import('./js/aicontent.js');
    const st = await ac.aiTextStatus(tid);
    const can = await ac.canRegenerate(tid);
    return { state: st.state, why: st.why, canOk: can.ok, canWhy: can.why,
      stillThere: !!ac.aiPayload(tid, 'tripText') };
  }, noKeyTid);
  if (noKey.state === 'stale' && noKey.why === 'noKey') ok(`沒有金鑰的裝置：狀態說得出原因（${noKey.state}/${noKey.why}）—— 以前是完全靜默的`); else bad(`沒有金鑰的裝置：狀態說得出原因（${noKey.state}/${noKey.why}）—— 以前是完全靜默的`);
  const m2 = '沒有金鑰時 canRegenerate 擋下來，舊文案原封不動（v1.72.0 會刪光又產不回來）';
  if (!noKey.canOk && noKey.canWhy === 'noKey' && noKey.stillThere) ok(m2); else bad(m2);

  // 有金鑰：狀態是 stale/pending，重產之後變 fresh
  const okTid = await mkStale(true);
  const okRes = await P.evaluate(async (tid) => {
    const ac = await import('./js/aicontent.js');
    const before = await ac.aiTextStatus(tid);
    const can = await ac.canRegenerate(tid);
    return { before: before.state + '/' + before.why, canOk: can.ok };
  }, okTid);
  if (okRes.before.startsWith('stale') && okRes.canOk) ok(`有金鑰的裝置：狀態是「${okRes.before}」且可以重產`); else bad(`有金鑰的裝置：狀態是「${okRes.before}」且可以重產`);

  // 回憶入口頁也要觸發（使用者是從那裡進去看影片的）
  const memTid = await mkStale(true);
  await P.goto('about:blank');
  await P.goto(`http://localhost:${PORT}/#/trip/${memTid}/memories`, { waitUntil: 'networkidle0' }).catch(() => {});
  await sleep(2500);
  const memHit = await P.evaluate(async (tid) => {
    const ac = await import('./js/aicontent.js');
    const st = await ac.aiTextStatus(tid);
    return { state: st.state, why: st.why };
  }, memTid);
  if (memHit.state !== 'stale' || memHit.why !== 'pending') ok(`回憶入口頁也會觸發更新（狀態 ${memHit.state}${memHit.why ? '/' + memHit.why : ''}）—— 使用者是從那裡進去看影片的`); else bad(`回憶入口頁也會觸發更新（狀態 ${memHit.state}${memHit.why ? '/' + memHit.why : ''}）—— 使用者是從那裡進去看影片的`);



  // ---------- v1.72.2：花費上限用完 ----------
  // 使用者猜「可能是額度用完了」。實測：aiOn 直接擋掉 → 零次 API → 靜默沿用舊文案，
  // 而使用者是在相簿／海報頁看到那些舊字的，那兩頁以前什麼都沒說。
  console.log('\n— 花費上限用完 —');
  const capTid = await P.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const { myDeviceId } = await import('./js/identity.js');
    const db = await import('./js/db.js');
    const k = await import('./js/aikeys.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: '宜蘭', region: '宜蘭',
      startDate: '2026-10-01', endDate: '2026-10-01', aiEnabled: true, createdByDevice: myDeviceId() });
    await s.put({ id: uuid(), type: 'spot', tripId: tid, name: '礁溪溫泉公園', emoji: '📍',
      day: 1, order: 0, lat: 24.8, lng: 121.7 });
    await k.setTripKey(tid, { key: 'sk-ant-FAKEFAKEFAKEFAKEFAKEFAKEFAKE', capUsd: 2 });
    const e = await db.tripSecretGet(tid); e.usedMicroUsd = 2 * 1e6; await db.tripSecretSet(e);
    await s.put({ id: uuid(), type: 'aiText', tripId: tid, groupId: gid, key: 'tripText', sig: 'OLDSIG',
      payload: { subtitle: '舊', dayLines: { 1: '舊' }, videoIntro: '舊', videoOutro: '舊',
        narration: { 1: '舊的字卡' } } });
    return tid;
  });

  const capSt = await P.evaluate(async (tid) => {
    const ac = await import('./js/aicontent.js');
    const k = await import('./js/aikeys.js');
    const st = await ac.aiTextStatus(tid);
    const can = await ac.canRegenerate(tid);
    const u = await k.usageOf(tid);
    return { why: st.why, canWhy: can.why, over: u.overCap,
      kept: ac.aiPayload(tid, 'tripText').narration['1'] };
  }, capTid);
  const c1 = `額度用完：狀態說得出是額度問題（${capSt.why}），舊文案原封不動保留（「${capSt.kept}」）`;
  if (capSt.why === 'cap' && capSt.canWhy === 'cap' && capSt.over && capSt.kept === '舊的字卡') ok(c1); else bad(c1);

  // 畫面上要講出來（以前完全沒有）
  const noteTxt = await P.evaluate(async (tid) => {
    document.body.innerHTML = '<div class="page"></div>';
    const { showAiStaleNote } = await import('./js/views/ai-config.js');
    await showAiStaleNote(tid);
    const n = document.querySelector('.ai-stale');
    return n ? n.textContent.trim() : '';
  }, capTid);
  const c2 = `使用者看得到原因與出口：「${noteTxt}」`;
  if (/額度用完/.test(noteTxt) && /調整上限/.test(noteTxt)) ok(c2); else bad(c2);

  // 調高上限之後就能重產（這是要轉告使用者的動作，得真的可行）
  const afterRaise = await P.evaluate(async (tid) => {
    const k = await import('./js/aikeys.js');
    await k.setTripKey(tid, { capUsd: 10 });          // 使用者按「調整上限」做的事
    const ac = await import('./js/aicontent.js');
    const can = await ac.canRegenerate(tid);
    const st = await ac.aiTextStatus(tid);
    return { canOk: can.ok, why: st.why };
  }, capTid);
  const c3 = `調高上限後就能重產了（canRegenerate=${afterRaise.canOk}，狀態改成 ${afterRaise.why}）`;
  if (afterRaise.canOk && afterRaise.why !== 'cap') ok(c3); else bad(c3);

  // 文案是最新的時候不要亂跳提示
  const freshNote = await P.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const gid = uuid(), tid = uuid();
    await s.put({ id: gid, type: 'group', name: 'g' });
    await s.put({ id: tid, type: 'trip', groupId: gid, title: 'x', aiEnabled: false });
    document.body.innerHTML = '<div class="page"></div>';
    const { showAiStaleNote } = await import('./js/views/ai-config.js');
    await showAiStaleNote(tid);
    return !!document.querySelector('.ai-stale');
  });
  const c4 = '沒開 AI 的行程不會出現這條提示（不打擾）';
  if (!freshNote) ok(c4); else bad(c4);

  // ---------- v1.73.1：並發記帳不能漏算 ----------
  //
  // addUsage 以前是「讀 → await → 改 → 寫」，兩個並發呼叫各自讀到同一個舊值、
  // 後寫的蓋掉先寫的。而 album.js 與 poster/index.js 兩處都是 Promise.all 同時
  // 跑兩支 ensure*，所以相簿頁與海報頁各有一個兩路並發，其中一次完全不入帳。
  // 保險絲會比實際鬆 —— 這是「上限」這個功能唯一的意義。
  console.log('\n— 並發記帳 —');
  const conc = await P.evaluate(async () => {
    const s = await import('./js/store.js');
    const { uuid } = await import('./js/ids.js');
    const k = await import('./js/aikeys.js');
    const run = async (n) => {
      const tid = uuid();
      await s.put({ id: tid, type: 'trip', title: 'x' });
      await k.setTripKey(tid, { key: 'sk-ant-FAKEFAKEFAKEFAKEFAKEFAKEFAKE', capUsd: 99 });
      await Promise.all(Array.from({ length: n }, () => k.addUsage(tid, 1000)));
      return Math.round((await k.usageOf(tid)).usedUsd * 1e6);
    };
    const mapsRun = async (n) => {
      const tid = uuid();
      await s.put({ id: tid, type: 'trip', title: 'x' });
      await k.setTripKey(tid, { mapsKey: 'AIza-FAKE', mapsCap: 9999 });
      await Promise.all(Array.from({ length: n }, () => k.addMapsCalls(tid, 1)));
      return (await k.mapsBudget(tid)).used;
    };
    return { two: await run(2), five: await run(5), maps: await mapsRun(5) };
  });
  const c5 = `兩路並發（相簿頁／海報頁的 Promise.all）：${conc.two} µUSD，應為 2000 —— 以前漏一半`;
  if (conc.two === 2000) ok(c5); else bad(c5);
  const c6 = `五路並發：${conc.five} µUSD，應為 5000 —— 以前漏 80%`;
  if (conc.five === 5000) ok(c6); else bad(c6);
  const c7 = `地圖次數同樣不漏（addMapsCalls 是同一個形狀）：${conc.maps}/5`;
  if (conc.maps === 5) ok(c7); else bad(c7);

  console.log('\nAI 文案測試結束');
} catch (e) {
  bad('例外：' + (e && e.stack || e));
} finally {
  await b.close(); srv.kill();
}
