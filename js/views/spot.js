// 景點設定頁 —— 只做四件事：改名字、幾點到、停留多久、刪掉它。
//
// 這頁本來還有示意圖、介紹文字、「用地圖帶我去」、任務清單與加照片按鈕。
// 全部拿掉了，因為那些在別的地方都已經有，而且更靠近使用者真正在做事的地方：
//   · 任務與加照片 → 行程頁的任務列（v1.41 起收合狀態就有 📷🖼️）
//   · 地圖         → 景點標題列右邊的 🗺️ 圖示
//   · 加任務／改任務 → 「調整每天的行程」的「✏️ 改任務」（有新增、編輯、刪除）
// 同一件事散在兩三個地方，長輩只會更難找。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, modal, promptDialog, confirmDialog } from '../ui.js';
import { navigate, back } from '../router.js';
import { enrichSpot } from '../enrich.js';
import { spotTimes, stayOptions } from '../spottime.js';

export default async function spot(tripId, spotId) {
  const s = store.get(spotId);
  const t = store.get(tripId);
  if (!s || !t) { navigate('/', { replace: true }); return; }

  setTop({ title: '景點設定' });

  const quests = store.questsOf(spotId);
  const photoCount = quests.reduce((n, q) => n + store.submissionsOf(q.id).length, 0);
  const tm = spotTimes(s);

  const nameField = h('input', {
    class: 'field', type: 'text', value: s.name || '', maxlength: 40, placeholder: '景點名稱',
  });

  // 「幾點到」跟搜尋頁同一套：時/分 雙下拉，預設「未設定」→ 沒動就存 null。
  // iOS 的原生 time input 在空值時會把「當下時間」畫在欄位上（v1.51.5 修過搜尋頁，
  // 這頁是同族問題）。匯入的時間可能是 13:05 這種不在固定選項裡的分鐘，補成選項。
  const curH = Number.isFinite(tm.startMin) ? Math.floor(tm.startMin / 60) : null;
  const curM = Number.isFinite(tm.startMin) ? tm.startMin % 60 : null;
  const minOpts = [...new Set([0, 5, 10, 15, 20, 30, 40, 45, 50, ...(curM != null ? [curM] : [])])].sort((a, b) => a - b);
  const hourSel = h('select', { class: 'field' },
    h('option', { value: '', selected: curH == null }, '未設定'),
    ...Array.from({ length: 24 }, (_, hh) => h('option', { value: hh, selected: hh === curH }, `${hh} 時`)));
  const minSel = h('select', { class: 'field', disabled: curH == null },
    ...minOpts.map((mm) => h('option', { value: mm, selected: mm === (curM ?? 0) }, `${String(mm).padStart(2, '0')} 分`)));
  hourSel.addEventListener('change', () => { minSel.disabled = hourSel.value === ''; });
  const pickedMin = () => (hourSel.value === '' ? null : (+hourSel.value) * 60 + (+minSel.value || 0));

  // 位置：路線圖靠這個。查不到的店家可以手動貼 Google 地圖連結或座標。
  const posLine = h('div', { class: 'form-hint', style: 'margin:2px 0 8px' });
  const drawPos = () => {
    const cur = store.getRaw(spotId);
    posLine.textContent = cur.lat != null
      ? `已有位置（${{ photo: '來自照片', osm: '地名查詢', wiki: '維基百科', manual: '手動設定' }[cur.geoSrc] || '景點資料庫'}）`
      : '還沒有位置 —— 路線圖上看不到這個點';
  };
  const posBtns = h('div', { class: 'row2', style: 'margin-bottom:4px' },
    h('button', { class: 'btn btn-soft', onclick: async () => {
      toast('查詢中…');
      try {
        const { locateSpot } = await import('../geocode.js');
        const cur = store.getRaw(spotId);
        const r = await locateSpot(cur, { region: t.region || '' });
        if (!r) { toast('查不到這個名字的位置，可以改用「貼座標」'); return; }
        await store.patch(spotId, { lat: r.lat, lng: r.lng, geoSrc: r.src });
        drawPos(); toast('找到了，已存位置');
      } catch (e) { toast('查詢失敗：' + e.message); }
    } }, '🔍 查位置'),
    h('button', { class: 'btn btn-soft', onclick: async () => {
      const v = await promptDialog('貼上地圖連結或座標', {
        placeholder: '24.677, 121.767',
        hint: '可以貼：Google 地圖的分享連結（含 maps.app.goo.gl 短網址）、Apple 地圖連結，或直接貼「緯度, 經度」兩個數字。',
      });
      if (!v) return;
      const ok = await applyPastedLocation(spotId, v, t);
      if (ok) drawPos();
    } }, '📋 貼座標'),
  );
  const posClear = h('button', { class: 'btn btn-ghost btn-block', onclick: async () => {
    if (!(await confirmDialog('要清掉這個景點的位置嗎？路線圖上會看不到它。', { danger: true, okLabel: '清除' }))) return;
    await store.patch(spotId, { lat: null, lng: null, geoSrc: null });
    drawPos(); toast('已清除位置');
  } }, '清除位置');
  drawPos();
  const stayField = h('select', { class: 'field spot-stay' },
    ...stayOptions(tm.stayMin).map((o) =>
      h('option', { value: o.v, selected: String(tm.stayMin || '') === o.v }, o.label)));

  const save = async () => {
    const name = nameField.value.trim();
    if (!name) { toast('名字不能空白'); nameField.focus(); return; }
    const startMin = pickedMin();
    const stayMin = stayField.value ? parseInt(stayField.value, 10) : null;
    const renamed = name !== s.name;
    await store.patch(spotId, {
      name,
      startMin, stayMin,
      // 舊的字串欄位清掉，只留一套，免得海報／回顧讀到過期的值
      startTime: '', endTime: '',
      // 改了名字就重新去找示意圖（原本那張是照舊名字抓的）
      ...(renamed ? { _enrichV: 0, _noHero: false } : {}),
    });
    if (renamed) enrichSpot(store.getRaw(spotId)).catch(() => {});
    // 改了時間 → 檢查有沒有任務跟新時段不合（例：改成早上、任務卻是「夜裡點燈」）。
    // 已拍照片的任務絕不動；使用者不換也尊重（提示一次，不強迫）。
    if (startMin !== tm.startMin || stayMin !== tm.stayMin) {
      await offerTimeFixQuests();
    }
    toast('已儲存');
    back(`/trip/${tripId}/plan`);
  };

  async function offerTimeFixQuests() {
    try {
      const { timeWindow, phraseOk } = await import('../quests/compose.js');
      const cur = store.getRaw(spotId);
      const win = timeWindow(cur);
      const clash = store.questsOf(spotId).filter((q) =>
        q.when && !phraseOk({ when: q.when }, win) && !store.submissionsOf(q.id).length);
      if (!clash.length) return;
      const ok = await confirmDialog(
        `有 ${clash.length} 個任務跟新的時間不太合（例如「${clash[0].title}」）。要換成合適時段的任務嗎？

已拍照片的任務不會動。`,
        { okLabel: '幫我換' });
      if (!ok) return;
      const { themedQuestsForSpot } = await import('../quests/generate.js');
      const fresh = await themedQuestsForSpot(cur, tripId);   // cur 已帶新時間 → 句型已過濾
      const keep = new Set(store.questsOf(spotId).map((q) => q.title));
      let i = 0;
      for (const q of clash) await store.remove(q.id);
      for (const nq of fresh) {
        if (i >= clash.length) break;
        if (keep.has(nq.title)) continue;
        const { uuid } = await import('../ids.js');
        await store.put({
          id: uuid(), type: 'quest', tripId, spotId,
          title: nq.title, hint: nq.hint, kind: nq.kind || 'view',
          source: 'template', when: nq.when || null, order: clash[i].order ?? 0, refImage: null,
        });
        i++;
      }
      toast('已換上合適時段的任務');
    } catch { /* 換不成就算了，儲存本身不受影響 */ }
  }

  const del = async () => {
    const lines = [`「${s.name}」會從行程裡移除。`];
    if (quests.length) lines.push(`連同 ${quests.length} 個拍照任務`);
    if (photoCount) lines.push(`以及已經拍的 ${photoCount} 張照片`);
    lines.push(quests.length || photoCount ? '一起刪掉，而且救不回來。' : '這個景點還沒有任務或照片。');
    const ok = await modal({
      title: '要刪掉這個景點嗎？',
      body: h('div', {},
        h('div', { class: 'del-warn' },
          h('p', { style: 'margin:0 0 6px;font-weight:800' }, lines[0]),
          ...lines.slice(1).map((x) => h('p', { style: 'margin:0 0 4px' }, x))),
        photoCount
          ? h('p', { class: 'sm muted', style: 'margin:12px 0 0' },
            '想留照片的話，先到「照片」那一頁看過再刪。')
          : null,
      ),
      actions: [
        { label: '不要，我再想想', value: false },
        { label: photoCount ? `還是刪掉（含 ${photoCount} 張照片）` : '刪掉', value: true, danger: true },
      ],
    });
    if (!ok) return;
    for (const q of quests) {
      for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
      await store.remove(q.id);
    }
    await store.remove(spotId);
    toast('已刪除');
    navigate(`/trip/${tripId}/plan`, { replace: true });
  };

  render(h('div', { class: 'page form compact' },
    field('景點名稱', nameField),
    field('幾點到', h('div', { class: 'spot-time-row' },
      h('div', { class: 'fs-hm spot-time' }, hourSel, minSel),
      h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { hourSel.value = ''; minSel.disabled = true; },
      }, '清除'))),
    field('停留多久', stayField),
    h('div', { class: 'form-field' },
      h('span', { class: 'form-label' }, '地圖位置'),
      posLine, posBtns, posClear),

    h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:18px', onclick: save }, '儲存'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => back(`/trip/${tripId}/plan`) }, '取消'),

    h('div', { class: 'danger-zone', style: 'margin-top:22px' },
      h('button', { class: 'btn btn-danger btn-block', onclick: del }, '🗑️ 刪除這個景點'),
    ),
  ));
}

// 貼上的內容 → 位置。三條路：
//   1) 文字裡直接有座標（完整網址／純數字／geo:／Apple 地圖）→ 立刻存
//   2) Google 短網址 → 借道自家 Worker 跟隨轉址；轉址後有座標就用，
//      只有地名（Google 常給「地址＋店名」）就拿去查，查到幾個讓使用者挑
//   3) 都不行 → 講清楚可以貼什麼、以及「在地圖上長按會出現座標」這條替代路
async function applyPastedLocation(spotId, text, trip) {
  const geo = await import('../geocode.js');
  const direct = geo.parseCoordInput(text);
  if (direct) {
    await store.patch(spotId, { lat: direct.lat, lng: direct.lng, geoSrc: 'manual' });
    toast('已存位置');
    return true;
  }

  const short = geo.findShortMapLink(text);
  if (short) {
    if (navigator.onLine === false) {
      await explainPaste('短網址要連上網才能查出位置（網址本身沒有座標）。');
      return false;
    }
    toast('正在查這個連結…');
    let r = null;
    try { r = await geo.resolveMapLink(short); }
    catch { await explainPaste('這個短網址查不出來（可能是網路不順，或連結已失效）。'); return false; }
    if (r && r.lat != null) {
      await store.patch(spotId, { lat: r.lat, lng: r.lng, geoSrc: 'manual' });
      toast('已存位置');
      return true;
    }
    if (r && r.query) {
      const picked = await pickFromQuery(r.query, trip);
      if (picked === 'none') {
        await explainPaste(`連結指到「${r.query.slice(0, 30)}」，但這個名字在免費地圖資料裡查不到。`);
        return false;
      }
      if (!picked) return false;                        // 使用者自己取消
      await store.patch(spotId, { lat: picked.lat, lng: picked.lng, geoSrc: 'manual' });
      toast('已存位置');
      return true;
    }
    await explainPaste('這個連結裡沒有位置資訊。');
    return false;
  }

  await explainPaste('這段文字裡找不到座標，也沒有地圖連結。');
  return false;
}

// 地名 → 候選清單 → 讓使用者確認是哪一個。
// 一律讓人確認、不自動挑：免費地圖資料對「地址＋店名」的模糊比對會給出很遠的結果
//（實測踩過兩次：三公里外的飯店、22 公里外的同連鎖分店），自動套用等於默默存錯位置。
async function pickFromQuery(query, trip) {
  const geo = await import('../geocode.js');
  const admins = geo.adminTokens(query);          // 原文裡的鄉鎮名（蘇澳鎮…）
  const found = [];
  // 多試幾個候選並把結果**合起來**排序 —— 只取「第一個有結果的候選」會挑到別家分店
  for (const q of geo.placeCandidates(query).slice(0, 4)) {
    let hits = [];
    try { hits = await geo.geocodeSearch(q, { limit: 4, region: trip?.region || '' }); }
    catch { hits = []; }
    for (const h of hits || []) {
      if (found.some((f) => f.hit.name === h.name && Math.abs(f.hit.lat - h.lat) < 0.002)) continue;
      found.push({ hit: h, from: q, score: scoreHit(h, q, admins) });
    }
    if (found.length >= 6) break;
  }
  if (!found.length) return 'none';
  found.sort((a, b) => b.score - a.score);
  return chooseHit(found, trip);
}

// 結果評分：地址對得上原文的鄉鎮 > 名字跟搜尋詞吻合
function scoreHit(hit, q, admins) {
  const full = String(hit.fullName || '') + ' ' + String(hit.name || '');
  let sc = 0;
  for (const a of admins) if (full.includes(a)) sc += a.endsWith('縣') || a.endsWith('市') ? 1 : 3;
  if (String(hit.name || '').includes(q) || q.includes(String(hit.name || ''))) sc += 1;
  if (hit.wiki) sc += 0.5;
  return sc;
}

async function chooseHit(found, trip) {
  const geo = await import('../geocode.js');
  let close = null;
  const res = await modal({
    title: '是這個地方嗎？',
    expose: (fn) => { close = fn; },
    body: h('div', {},
      h('p', { class: 'form-hint', style: 'margin:0 0 8px' }, '從連結的地址找到這幾個，請確認是哪一個：'),
      h('div', { class: 'stack' }, ...found.slice(0, 4).map((f) => h('button', {
        class: 'btn btn-soft btn-block', style: 'text-align:left',
        onclick: () => close && close(f.hit),
      },
        h('div', { style: 'font-weight:700' }, f.hit.name || '這個地點'),
        h('div', { class: 'form-hint' }, String(f.hit.fullName || '').slice(0, 44))))),
    ),
    actions: [{ label: '都不是，我自己找', value: 'retry' }, { label: '取消', value: null }],
  });
  if (res !== 'retry') return res;
  // 讓使用者自己改搜尋詞（連鎖店、地標的正式名稱常常跟連結上的不一樣）
  const q2 = await promptDialog('要找的地方叫什麼？', { value: found[0]?.from || '', okLabel: '搜尋' });
  if (!q2) return null;
  let hits2 = [];
  try { hits2 = await geo.geocodeSearch(q2, { limit: 4, region: trip?.region || '' }); }
  catch { hits2 = []; }
  if (!hits2 || !hits2.length) { toast('這個名字查不到，可以改貼座標'); return null; }
  return chooseHit(hits2.map((x) => ({ hit: x, from: q2, score: 0 })), trip);
}

// 失敗時要講「可以怎麼做」，不是只說看不懂
async function explainPaste(why) {
  await modal({
    title: '這個貼上的內容用不了',
    body: h('div', {},
      h('p', { style: 'margin:0 0 10px' }, why),
      h('div', { class: 'form-hint', style: 'line-height:1.7' },
        h('div', { style: 'font-weight:700;margin-bottom:4px' }, '可以貼這幾種：'),
        h('div', {}, '· Google 地圖的分享連結（包含 maps.app.goo.gl 短網址）'),
        h('div', {}, '· Apple 地圖的連結'),
        h('div', {}, '· 直接貼兩個數字：24.677, 121.767'),
        h('div', { style: 'font-weight:700;margin:10px 0 4px' }, '都不行的話（最保險）：'),
        h('div', {}, '在 Google 地圖上「長按」那個地點，畫面下方會出現一組座標數字，點一下複製，再貼回這裡。'),
      )),
    actions: [{ label: '知道了', value: true }],
  });
}

function field(label, control) {
  return h('label', { class: 'form-field' }, h('span', { class: 'form-label' }, label), control);
}
