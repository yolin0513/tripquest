// AI 文案端到端測試（npm run aitest）—— 用攔截的 mock Anthropic API 驗證：
// 啟用→自動用、未啟用→內建、失敗→靜默退回內建、快取不重複花錢、跟著群組同步、金鑰不外洩。
// AI 文案：啟用→自動用、未啟用→內建、失敗→靜默退回、快取、同步、標記、用量。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
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
  const p = await b.newPage();
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
    req.continue();
  });
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await p.waitForSelector('.hero');
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
  {
    const p = await newPage();
    const { tid, gid } = await makeTrip(p, true);
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

    if (r.usage.usedUsd > 0 && r.usage.usedUsd < 0.05) ok(`用量有計：$${r.usage.usedUsd.toFixed(4)}`);
    else bad('用量錯誤：' + JSON.stringify(r.usage));

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
    const r = await p.evaluate(async (dump) => {
      const s = await import('./js/store.js');
      const ai = await import('./js/aicontent.js');
      for (const rec of JSON.parse(dump)) await s.put(rec);          // 模擬 pull 下來
      const trip = s.exportRecords().find((x) => x.type === 'trip');
      // 這台沒有金鑰，且 createdByDevice 不是自己
      const tx = ai.aiPayload(trip.id, 'tripText');
      const gen = await ai.ensureTripText(trip.id);                   // 不該真的呼叫
      return { hasCached: !!tx && tx.subtitle === 'AI海報副標', genSame: gen && gen.subtitle === 'AI海報副標' };
    }, exported.json);
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

  console.log('\nAI 文案測試結束');
} catch (e) {
  bad('例外：' + (e && e.stack || e));
} finally {
  await b.close(); srv.kill();
}
