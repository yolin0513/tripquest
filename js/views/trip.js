import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, toast, confirmDialog, promptDialog, modal, fmtDate, avatar, KIND_META } from '../ui.js';
import { navigate, back } from '../router.js';
import { uuid, hashHue } from '../ids.js';
import { shareURL, exportBundle, downloadBlob, nativeShare } from '../share.js';
import { generateForTrip, themedQuestsForSpot } from '../quests/generate.js';
import { blobURL } from '../photos.js';
import { enrichTrip } from '../enrich.js';
import { activeMemberId, ensureMember } from '../claim.js';
import { pickDateRange, rangeLabel } from '../daterange.js';
import { loadThemes, themeForSpot, themeMeta } from '../theme.js';
import { loadEmergency } from '../emergency.js';

const COUNTRY_NAMES = {};
function countryName(code) { return code ? (COUNTRY_NAMES[code] || code) : ''; }
async function pickCountry(tripId) {
  const D = await loadEmergency();
  Object.entries(D.countries || {}).forEach(([k, v]) => { COUNTRY_NAMES[k] = v.name; });
  const entries = Object.entries(D.countries || {});
  const actions = entries.map(([code, v]) => ({ label: `${v.name}（報警 ${v.police || v.all}）`, value: code }));
  actions.push({ label: '取消', value: null });
  const pick = await modal({ title: '目的地國家', body: h('p', { class: 'sm muted' }, '用來顯示正確的當地緊急電話。'), actions });
  if (pick) { await store.patch(tripId, { country: pick }); toast('已設定'); settings(tripId); }
}

export default async function trip(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  await loadThemes().catch(() => {});

  setTop({
    title: t.title,
    action: { icon: '⚙️', label: '旅程設定', onClick: () => navigate(`/trip/${tripId}/settings`) },
  });

  const prog = store.tripProgress(tripId);
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(t.groupId);
  const allDone = prog.total > 0 && prog.done === prog.total;

  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  const container = h('div', { class: 'page' },
    h('div', { class: 'progress-banner' },
      h('div', { class: 'pb-text' },
        h('div', { class: 'pb-title' }, allDone ? '全部完成了！🎉' : `已完成 ${prog.done} / ${prog.total}`),
        h('div', { class: 'pb-sub' }, allDone ? '可以做回憶影片了' : (prog.done === 0 ? '開始拍第一張吧' : '繼續加油！')),
        h('div', { class: 'progress-track' }, h('i', { style: `width:${Math.round(prog.ratio * 100)}%` })),
      ),
      ring(prog.ratio, { size: 64, label: `${prog.done}/${prog.total}` }),
    ),

    members.length ? h('div', { class: 'avatars pad-x', style: 'margin:12px 0' },
      ...members.map((m) => avatar(m.displayName, hashHue(m.id)))) : null,

    // 同步的旅程、還沒說「我是誰」→ 提示（點一下就好，非強制）
    (store.getRaw(t.groupId)?.syncSecret && !activeMemberId(tripId) && members.length > 1)
      ? h('button', {
          class: 'btn btn-soft btn-block', style: 'border-color:var(--primary)',
          onclick: async () => { await ensureMember(tripId, { force: true }); trip(tripId); },
        }, '👋 告訴大家你是誰（拍照前先選一次）')
      : null,

    h('div', { class: 'stack', style: 'margin-top:6px' },
      h('button', { class: 'btn btn-soft btn-block btn-big', onclick: () => navigate(`/trip/${tripId}/people`) },
        '📸 看照片牆 / 幫旅伴按讚'),
      h('button', {
        class: 'btn btn-block btn-big ' + (allDone ? 'btn-primary' : 'btn-soft is-locked'),
        onclick: () => allDone ? navigate(`/trip/${tripId}/album`) : toast(`還有 ${prog.total - prog.done} 個任務就能做影片`),
      }, allDone ? '🎬 製作回憶影片' : `🔒 回憶影片（還差 ${prog.total - prog.done} 個）`),
      h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/poster`) }, '🎨 做一張行程海報'),
      spots.length ? h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/plan`) }, '📅 調整每天的行程') : null,
      h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/expenses`) }, '💰 分帳（誰付了、誰該還誰）'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => doShare(tripId) }, '🔗 把任務分享給旅伴'),
      h('button', { class: 'btn btn-ghost btn-block', style: 'color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,transparent)', onclick: () => navigate(`/trip/${tripId}/sos`) }, '🆘 緊急求助（迷路、找警局醫院）'),
    ),
  );

  if (spots.length === 0) {
    container.append(h('div', { class: 'empty' }, h('p', {}, '這個旅程還沒有景點'),
      h('button', { class: 'btn btn-primary', onclick: () => addSpot(tripId) }, '＋ 新增景點')));
  } else {
    for (const [day, daySpots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      const sec = h('section', { class: 'day-group' }, h('h3', { class: 'day-title' }, `第 ${day} 天`));
      for (const s of daySpots) sec.append(spotSection(s, tripId));
      container.append(sec);
    }
    container.append(h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:20px', onclick: () => addSpot(tripId) }, '＋ 新增景點'));
  }

  // 天氣提醒條（有座標景點才顯示；背景載入）
  if (spots.some((s) => s.lat != null)) {
    const wxSlot = h('div', { class: 'wx-slot' });
    container.insertBefore(wxSlot, container.querySelector('.stack')?.nextSibling || null);
    fillWeatherStrip(wxSlot, tripId, t);
  }

  render(container);

  // 背景補景點示意圖，回來後重繪一次
  if (t.allowWiki !== false && spots.some((s) => !s._enriched)) {
    enrichTrip(tripId).then(() => {
      if (location.hash.includes(`/trip/${tripId}`) && !location.hash.includes('/spot/')) trip(tripId);
    }).catch(() => {});
  }
}

async function fillWeatherStrip(slot, tripId, trip) {
  try {
    const [{ destCoords, tripForecastDays }, wx, geo] = await Promise.all([
      import('./weather.js'), import('../weather.js'), import('../geo.js'),
    ]);
    const dc = destCoords(tripId);
    if (!dc) return;
    const f = await wx.forecast(dc.lat, dc.lng);
    if (!f) return;
    const days = tripForecastDays(trip, f.days);
    if (!days.length) return;

    let hereTemp = null, hereName = '出發地';
    const home = wx.getHome();
    if (home && home.lat != null) { hereTemp = await wx.hereTempNow(home.lat, home.lng); hereName = home.name || '居住地'; }
    else {
      const pos = await geo.currentPosition({ timeout: 5000, maxAgeMs: 900000 }).catch(() => null);
      if (pos) { hereTemp = await wx.hereTempNow(pos.lat, pos.lng); hereName = '你的位置'; }
    }
    const tips = wx.buildAdvice({ dest: { elevation: f.elevation }, destDays: days, hereTemp, hereName });

    slot.replaceChildren(h('button', {
      class: 'wx-strip', onclick: () => navigate(`/trip/${tripId}/weather`),
    },
      h('div', { class: 'wx-strip-days' }, ...days.slice(0, 5).map((d) => h('span', { class: 'wx-strip-day' },
        h('span', {}, d._tripDay ? `D${d._tripDay}` : (d.date.slice(5).replace('-', '/'))),
        h('span', { class: 'wx-strip-ic' }, wx.wxIcon(d.code)),
        h('span', { class: 'wx-strip-t' }, `${d.tmax}°`),
      ))),
      tips.length
        ? h('div', { class: 'wx-strip-tip' }, '🧳 ' + tips[0].text)
        : h('div', { class: 'wx-strip-tip muted' }, '天氣還算舒服，點看每天預報'),
    ));
  } catch { /* 靜默：天氣是加分項 */ }
}

// 每個景點的任務清單：預設折疊，標題列顯示完成進度（3/5）。
// 展開時機：有任務剛完成 → 自動展開；使用者點擊 → 展開/收合並記住。
function spotSection(s, tripId) {
  const quests = store.questsOf(s.id);
  const p = store.spotProgress(s.id);
  const allDone = p.total > 0 && p.done === p.total;

  const openKey = 'tripquest.spotOpen.' + s.id;
  const seenKey = 'tripquest.spotSeen.' + s.id;
  let open;
  try {
    const seen = +(localStorage.getItem(seenKey) || 0);
    const justCompleted = p.done > seen;
    localStorage.setItem(seenKey, String(p.done));
    const stored = localStorage.getItem(openKey);
    if (justCompleted && !allDone) open = true;
    else if (stored === '1') open = true;
    else if (stored === '0') open = false;
    else open = p.done > 0 && !allDone;
  } catch { open = p.done > 0 && !allDone; }

  const tk = s.theme || themeForSpot(s);
  const tm = themeMeta(tk);
  const chev = h('span', { class: 'qc-chev' }, open ? '▾' : '▸');
  const sec = h('section', {
    class: 'qcollapse' + (open ? ' open' : ''),
    style: `--theme-accent:${tm.poster.accent}`,
  },
    h('div', { class: 'qc-head' },
      h('button', {
        class: 'qc-toggle', 'aria-expanded': String(open),
        onclick: () => {
          const nowOpen = !sec.classList.contains('open');
          sec.classList.toggle('open', nowOpen);
          chev.textContent = nowOpen ? '▾' : '▸';
          try { localStorage.setItem(openKey, nowOpen ? '1' : '0'); } catch { /* noop */ }
        },
      },
        h('span', { class: 'qc-emoji' }, s.emoji || '📍'),
        h('span', { class: 'qc-name' }, s.name,
          h('span', { class: 'qc-theme' }, tm.emoji + ' ' + tm.label)),
        h('span', {
          class: 'qc-prog' + (allDone ? ' done' : (p.done ? ' part' : '')),
        }, p.total ? (allDone ? '✓ 完成' : `${p.done}/${p.total}`) : '—'),
        chev,
      ),
      h('button', {
        class: 'qc-edit', 'aria-label': '編輯景點',
        onclick: () => navigate(`/trip/${tripId}/spot/${s.id}`),
      }, '編輯'),
    ),
    h('div', { class: 'qc-body' }, h('div', { class: 'qc-inner' }, ...quests.map((q) => questBigCard(q, s)))),
  );
  return sec;
}

function questBigCard(q, spot) {
  const done = store.isQuestDone(q.id);
  const subs = store.submissionsOf(q.id);
  const km = KIND_META[q.kind] || KIND_META.thing;
  const likeCount = subs.reduce((n, s) => n + store.reactionsOf(s.id).length, 0);

  const photo = h('div', { class: 'qbig-photo' + (spot.heroHash ? ' has-img' : '') },
    h('span', { class: 'qbig-emoji' }, km.icon),
    done ? h('span', { class: 'qbig-check' }, '✓') : null,
  );
  if (spot.heroHash) blobURL(spot.heroHash).then((u) => { if (u) photo.style.backgroundImage = `url("${u}")`; });
  else if (subs[0]) blobURL(subs[0].thumbHash).then((u) => { if (u) { photo.style.backgroundImage = `url("${u}")`; photo.classList.add('has-img'); } });

  return h('button', {
    class: 'qbig' + (done ? ' done' : ''),
    onclick: () => navigate(`/quest/${q.id}`),
  },
    photo,
    h('div', { class: 'qbig-body' },
      h('div', { class: 'qbig-title' }, q.title),
      q.hint ? h('div', { class: 'qbig-hint' }, q.hint) : null,
      h('div', { class: 'qbig-foot' },
        h('span', { class: 'tag' }, km.label),
        h('span', { class: 'qbig-status' }, done ? `✓ 完成（${subs.length} 張）` : '還沒拍'),
        likeCount ? h('span', { class: 'qbig-likes' }, '❤️ ' + likeCount) : null,
      ),
    ),
  );
}

// ---------- 分享 ----------
async function doShare(tripId) {
  toast('產生分享連結中…');
  const url = await shareURL(tripId);
  if (await nativeShare({ title: 'TripQuest 拍照任務', text: '一起來完成這趟旅程的拍照任務！', url })) return;
  await modal({
    title: '分享給旅伴',
    body: h('div', {},
      h('p', { class: 'sm muted' }, '把連結傳給旅伴，他們打開就有一樣的任務清單。（不含照片）'),
      h('textarea', { class: 'field mono', rows: 4, readonly: true, onclick: (e) => e.target.select() }, url),
      h('button', {
        class: 'btn btn-primary btn-block', onclick: async () => {
          try { await navigator.clipboard.writeText(url); toast('已複製'); } catch { toast('請長按上面文字複製'); }
        },
      }, '複製連結'),
    ),
    actions: [{ label: '關閉', value: true }],
  });
}

// ---------- 新增景點 ----------
async function addSpot(tripId) {
  const name = await promptDialog('景點名稱', { placeholder: '例：奈良公園', okLabel: '新增' });
  if (!name) return;
  const t = store.get(tripId);
  const spots = store.spotsOf(tripId);
  const maxDay = spots.reduce((m, s) => Math.max(m, s.day || 1), 1);
  const { spots: gs, quests: gq } = await generateForTrip({ tripId, itineraryText: name, region: t.region || '' });
  const spot = gs[0] || { id: uuid(), type: 'spot', tripId, name, day: maxDay, order: spots.length };
  spot.day = maxDay; spot.order = spots.length;
  await store.put(spot);
  for (const q of gq) { q.spotId = spot.id; await store.put(q); }
  toast(`已新增「${spot.name}」`);
  enrichTrip(tripId).catch(() => {});
  navigate(`/trip/${tripId}`);
}

// ---------- 旅程設定 ----------
export async function settings(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '旅程設定' });
  try {
    const D = await loadEmergency();
    Object.entries(D.countries || {}).forEach(([k, v]) => { COUNTRY_NAMES[k] = v.name; });
  } catch { /* noop */ }

  const geoToggle = h('input', { type: 'checkbox', checked: !!t.allowGeo });
  geoToggle.addEventListener('change', async () => {
    await store.patch(tripId, { allowGeo: geoToggle.checked });
    if (!geoToggle.checked) {
      // 關閉時，把已存的座標清掉（回頭尊重意願）
      let n = 0;
      for (const sub of store.submissionsOfTrip(tripId)) {
        if (sub.gps) { const raw = store.getRaw(sub.id); raw.gps = null; const { putRecord } = await import('../db.js'); await putRecord(raw); n++; }
      }
      toast(n ? `已停止記錄位置，並清除 ${n} 張既有座標` : '已停止記錄位置');
    } else {
      toast('之後匯入的照片會記錄位置（只存本機、約 110 公尺精度）');
    }
  });

  const wikiToggle = h('input', { type: 'checkbox', checked: t.allowWiki !== false });
  wikiToggle.addEventListener('change', async () => {
    await store.patch(tripId, { allowWiki: wikiToggle.checked });
    toast(wikiToggle.checked ? '會抓景點示意圖' : '已關閉');
    if (wikiToggle.checked) enrichTrip(tripId).catch(() => {});
  });

  render(h('div', { class: 'page form' },
    settingRow('旅程名稱', h('button', { class: 'btn btn-soft', onclick: async () => {
      const v = await promptDialog('旅程名稱', { value: t.title });
      if (v) { store.patch(tripId, { title: v }); toast('已更新'); settings(tripId); }
    } }, '改名字')),

    settingRow('旅程日期', h('button', { class: 'btn btn-soft', onclick: async () => {
      const res = await pickDateRange({ start: t.startDate, end: t.endDate });
      if (res) { await store.patch(tripId, { startDate: res.start, endDate: res.end }); toast('已更新日期'); settings(tripId); }
    } }, t.startDate ? rangeLabel(t.startDate, t.endDate) : '選擇')),

    settingRow('目的地國家（緊急電話用）', h('button', { class: 'btn btn-soft', onclick: () => pickCountry(tripId) },
      countryName(t.country) || '未設定')),

    h('div', { class: 'section-label', style: 'margin:22px 2px 8px' }, '旅伴與電話'),
    memberEditor(tripId, t.groupId),

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '景點示意圖'),
        h('div', { class: 'form-hint' }, '從維基百科抓一張「要拍的東西長怎樣」的參考圖（只送景點名稱、抓回後可離線看）。')),
      wikiToggle),

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '記錄照片位置'),
        h('div', { class: 'form-hint' }, '預設關閉。開啟後之後匯入的照片會保留 GPS（只存本機，用於相簿地圖）。照片一律不會上傳。')),
      geoToggle),

    settingRow('重新產生任務', h('button', { class: 'btn btn-soft', onclick: () => regenerate(tripId) }, '補齊')),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        toast('打包中…');
        const blob = await exportBundle(tripId);
        downloadBlob(blob, `${t.title || 'trip'}.tripquest.json`);
      } }, '⬇️ 匯出完整備份（含照片）'),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog(`確定刪除「${t.title}」？照片也會一起刪掉，無法復原。`, { danger: true, okLabel: '刪除' })) {
          for (const q of store.questsOfTrip(tripId)) for (const sub of store.submissionsOf(q.id)) await store.deleteSubmission(sub.id);
          for (const s of store.spotsOf(tripId)) await store.remove(s.id);
          for (const q of store.questsOfTrip(tripId)) await store.remove(q.id);
          await store.remove(tripId);
          toast('已刪除');
          navigate('/', { replace: true });
        }
      } }, '🗑️ 刪除這個旅程'),
    ),
  ));
}

function settingRow(label, control) {
  return h('div', { class: 'setting-row' }, h('span', { style: 'font-weight:700' }, label), control);
}

function memberEditor(tripId, groupId) {
  const wrap = h('div', {});
  const draw = () => {
    wrap.replaceChildren(
      ...store.membersOf(groupId).map((m) => h('div', { class: 'member-row' },
        h('div', { class: 'member-row-main' },
          h('div', { style: 'font-weight:700' }, m.displayName),
          h('div', { class: 'muted sm' }, m.phone ? '📞 ' + m.phone : '未填電話（緊急求助會用到）'),
        ),
        h('button', { class: 'btn btn-soft sm-btn', onclick: async () => {
          const name = await promptDialog('名字', { value: m.displayName });
          if (name === null) return;
          const phone = await promptDialog('電話（可留空，用於緊急求助）', { value: m.phone || '', placeholder: '09xx-xxx-xxx' });
          await store.patch(m.id, { displayName: name || m.displayName, phone: (phone || '').trim() });
          draw();
        } }, '✎'),
        h('button', { class: 'btn btn-danger sm-btn', onclick: async () => {
          const used = store.submissionsOfTrip(tripId).some((s) => s.memberId === m.id);
          if (used && !await confirmDialog(`${m.displayName} 已有照片，移除後那些照片會標為「未指定」。要繼續嗎？`)) return;
          await store.remove(m.id);
          draw();
        } }, '🗑️'),
      )),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:10px', onclick: async () => {
        const name = await promptDialog('旅伴名字', { okLabel: '下一步' });
        if (!name) return;
        const phone = await promptDialog('電話（可留空）', { placeholder: '09xx-xxx-xxx', okLabel: '加入' });
        await store.put({ id: uuid(), type: 'member', groupId, displayName: name, phone: (phone || '').trim() });
        draw();
      } }, '＋ 加旅伴'),
    );
  };
  draw();
  return wrap;
}

async function regenerate(tripId) {
  if (!await confirmDialog('會依現有景點補上任務。你改過或自訂的不會動，重複的不會重加。')) return;
  let added = 0;
  for (const s of store.spotsOf(tripId)) {
    const existing = store.questsOf(s.id);
    const fresh = await themedQuestsForSpot(s, tripId);
    let k = 0;
    for (const q of fresh) {
      if (existing.some((e) => e.title === q.title)) continue;
      await store.put({ id: uuid(), type: 'quest', tripId, spotId: s.id, title: q.title, hint: q.hint, kind: q.kind, source: q.source || 'template', order: existing.length + k, refImage: null });
      added++; k++;
    }
  }
  toast(added ? `補了 ${added} 個任務` : '沒有可補的');
  navigate(`/trip/${tripId}`, { replace: true });
}
