import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, toast, confirmDialog, promptDialog, modal, fmtDate, avatar, KIND_META } from '../ui.js';
import { navigate, back, navRestoredScroll } from '../router.js';
import { getPrefs } from '../prefs.js';
import { uuid, hashHue } from '../ids.js';
import { shareURL, exportBundle, downloadBlob, nativeShare } from '../share.js';
import { generateForTrip, themedQuestsForSpot } from '../quests/generate.js';
import { blobURL } from '../photos.js';
import { enrichTrip, refImageFor, creditLine } from '../enrich.js';
import { addPhotoButtons } from '../addphoto.js';
import { activeMemberId, ensureMember } from '../claim.js';
import { pickDateRange, rangeLabel } from '../daterange.js';
import { loadThemes, themeForSpot, themeMeta, themePlaceholder } from '../theme.js';
import { loadEmergency } from '../emergency.js';
import { aiConfigCard } from './ai-config.js';
import { mapsDirUrl, mapsSearchUrl } from '../maps.js';

function nextIncompleteSpot(tripId) {
  for (const s of store.spotsOf(tripId)) {
    const p = store.spotProgress(s.id);
    if (p.total === 0 || p.done < p.total) return s;
  }
  return null;
}

// 「現在這一站」：使用者手動指定的優先，沒指定就照順序找第一個還沒完成的。
// 會這樣做是因為：人到了景點常常不會當下就上傳照片，那個景點就一直算「沒完成」，
// 機械式地找第一個未完成的話，「帶我去下一站」會永遠卡在同一個地方。
function currentSpot(tripId) {
  const manual = store.getHereSpot(tripId);      // 完成後會自動失效，不會困住
  if (manual) return store.get(manual);
  return nextIncompleteSpot(tripId);
}

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

export default async function trip(tripId, { fresh = false } = {}) {
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

    // 全部完成 / 旅程結束 → 直接把「回顧」拉到最上面
    (allDone || tripEnded(t)) && spots.length
      ? h('button', { class: 'btn btn-primary btn-block btn-big', style: 'margin-top:8px', onclick: () => navigate(`/trip/${tripId}/memories`) },
          allDone ? '🎉 全部完成！去看回顧與回憶影片' : '🎁 旅程結束了，來看回顧')
      : nextStationButton(tripId, t, allDone),

    h('div', { class: 'stack', style: 'margin-top:6px' },
      spots.length ? h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/plan`) }, '📅 調整每天的行程') : null,
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => doShare(tripId) }, '🔗 把任務分享給旅伴'),
    ),
  );

  if (spots.length === 0) {
    container.append(h('div', { class: 'empty' }, h('p', {}, '這個旅程還沒有景點'),
      h('button', { class: 'btn btn-primary', onclick: () => addSpot(tripId) }, '＋ 新增景點')));
  } else {
    const dayNums = [...byDay.keys()].sort((a, b) => a - b);
    const todayDay = dayForToday(t);
    const daySecs = [];

    // 全部展開 / 全部收合 小工具（只在多於一天時顯示）
    if (dayNums.length > 1) {
      // 兩層一起：天和景點都展開／收合。只收「天」的話，展開後裡面景點還是關的，
      // 使用者得再一個個點，等於沒有「全部展開」。
      const setAll = (open) => {
        for (const el of container.querySelectorAll('.daycollapse')) {
          el.classList.toggle('open', open);
          const chv = el.querySelector('.dc-chev');
          if (chv) chv.textContent = open ? '▾' : '▸';
          el.querySelector('.dc-head')?.setAttribute('aria-expanded', String(open));
          try { localStorage.setItem(`tripquest.dayOpen.${tripId}.${el.dataset.day}`, open ? '1' : '0'); } catch { /* noop */ }
        }
        for (const el of container.querySelectorAll('.qcollapse')) {
          el.classList.toggle('open', open);
          const chv = el.querySelector('.qc-chev');
          if (chv) chv.textContent = open ? '▾' : '▸';
          el.querySelector('.qc-toggle')?.setAttribute('aria-expanded', String(open));
          // 跟個別點擊寫的是同一個 key，之後他自己再點哪一個就以那次為準
          try { localStorage.setItem('tripquest.spotOpen.' + el.dataset.spot, open ? '1' : '0'); } catch { /* noop */ }
        }
      };
      container.append(h('div', { class: 'day-tools' },
        h('button', { class: 'day-tool-btn', onclick: () => setAll(true) }, '全部展開'),
        h('button', { class: 'day-tool-btn', onclick: () => setAll(false) }, '全部收合'),
      ));
    }

    const hereId = store.getHereSpot(tripId);
    const hereDay = hereId ? (store.get(hereId)?.day || 1) : null;
    for (const day of dayNums) {
      container.append(dayCollapse(day, byDay.get(day), tripId, t, {
        dayNums, todayDay, allDone, hereDay, hereId,
      }));
    }
    // 新增景點在「調整每天的行程」裡；這裡不再重複放
  }

  // 天氣提醒條 + 每天的天氣摘要（有座標景點、旅程還沒結束才有；背景載入）
  let wxReady = Promise.resolve();
  if (spots.some((s) => s.lat != null) && !tripEnded(t)) {
    const wxSlot = h('div', { class: 'wx-slot' });
    container.insertBefore(wxSlot, container.querySelector('.stack')?.nextSibling || null);
    wxReady = fillWeather(wxSlot, container, tripId, t);
  }

  render(container);

  // 進來時把「今天」帶到眼前。天氣條是後來才填的、會把下面的內容往下推，
  // 所以等它填完（或最多等 700ms）再捲，不然捲到一半畫面又被推走。
  if (fresh) {
    Promise.race([wxReady, new Promise((r) => setTimeout(r, 700))])
      .then(() => scrollToToday(container, dayForToday(t), store.getHereSpot(tripId)))
      .catch(() => {});
  }

  // 背景補示意圖。抓好一張就把那一張換上去，不整頁重畫 —— 大行程要抓一分鐘，
  // 整頁重畫會讓使用者看到一半的畫面突然跳掉。
  // 一律呼叫：enrichTrip 自己會判斷有沒有事要做，而且它還要修「同步過來但本機沒圖」的情況
  // （那個從記錄看不出來，得去 IndexedDB 查有沒有 blob）。
  if (t.allowWiki !== false) startEnrich(tripId);

  // 有開 AI → 背景自動產生 / 更新行程表與任務文案（有快取就秒回、沒開就不會進來）
  if (t.aiEnabled && spots.length) {
    import('../aicontent.js').then(async ({ warmTripContent }) => {
      const changed = await warmTripContent(tripId);
      if (changed && location.hash.includes(`/trip/${tripId}`) && !location.hash.match(/\/(spot|plan|poster|weather)/)) trip(tripId);
    }).catch(() => {});
  }
}

function tripEnded(t) {
  if (!t.endDate) return false;
  return new Date(t.endDate + 'T23:59:59') < new Date();
}

// ---------- 進入旅程頁時自動捲到「今天」 ----------
// 刻意保守，長輩最怕畫面自己亂跳：
//   1. 只有旅程「進行中」才動（還沒出發、已結束都不動）
//   2. 回到看過的畫面不動（返回、底部分頁切回來）—— router 已經還原他原本捲到哪裡
//   3. 今天那一列本來就看得到就不動
//   4. 只捲到「第 N 天」的標題列，不捲進任務深處，他才知道自己在哪一天
//   5. 設定可以整個關掉
function scrollToToday(container, todayDay, hereId) {
  if (!hereId && !(todayDay > 0)) return;
  if (navRestoredScroll()) return;
  if (getPrefs().autoScroll === false) return;

  // 有指定「現在這一站」就捲到那一站；否則捲到今天那一天的標題列
  let head = null;
  if (hereId) {
    const sp = container.querySelector(`.qcollapse[data-spot="${CSS.escape(hereId)}"]`);
    head = sp && (sp.querySelector('.qc-head') || sp);
  }
  if (!head) {
    const sec = container.querySelector(`.daycollapse[data-day="${todayDay}"]`);
    head = sec && (sec.querySelector('.dc-head') || sec);
  }
  if (!head) return;

  const topH = document.getElementById('topbar')?.offsetHeight || 60;
  const tabH = document.getElementById('tabbar')?.offsetHeight || 76;
  const r = head.getBoundingClientRect();
  if (r.top >= topH && r.bottom <= window.innerHeight - tabH) return;   // 本來就看得到

  const target = Math.max(0, window.scrollY + r.top - topH - 10);
  if (Math.abs(target - window.scrollY) < 24) return;
  smoothScrollTo(target);
}

function smoothScrollTo(top) {
  // 尊重系統／App 的「減少動態效果」：直接跳過去，不做動畫
  if (document.documentElement.classList.contains('reduce-motion')) {
    window.scrollTo(0, top);
    return;
  }
  const from = window.scrollY;
  const dist = top - from;
  const dur = 320;                       // 要快：長輩不喜歡畫面慢慢飄
  const t0 = performance.now();
  let cancelled = false;

  // 使用者一碰畫面就讓給他，不要跟他搶
  const stop = () => { cancelled = true; };
  const opts = { passive: true };
  window.addEventListener('touchstart', stop, opts);
  window.addEventListener('wheel', stop, opts);
  window.addEventListener('keydown', stop);
  const cleanup = () => {
    window.removeEventListener('touchstart', stop, opts);
    window.removeEventListener('wheel', stop, opts);
    window.removeEventListener('keydown', stop);
  };

  const step = (now) => {
    if (cancelled) { cleanup(); return; }
    const p = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, from + dist * (1 - Math.pow(1 - p, 3)));   // ease-out
    if (p < 1) requestAnimationFrame(step);
    else cleanup();
  };
  requestAnimationFrame(step);
}

// 「用地圖帶我去下一站」＋「換一站」
function nextStationButton(tripId, t, allDone) {
  if (allDone || tripEnded(t)) return null;
  const next = currentSpot(tripId);
  if (!next) return null;
  const manual = !!store.getHereSpot(tripId);
  const url = mapsDirUrl(next);

  const nav = url ? h('a', {
    class: 'btn btn-primary btn-block btn-big nextstn-btn',
    href: url, target: '_blank', rel: 'noopener', style: 'text-decoration:none',
  },
    h('span', {}, manual ? '🧭 用地圖帶我去這一站' : '🧭 用地圖帶我去下一站'),
    h('span', { class: 'nextstn-name' }, `${next.emoji || '📍'} ${next.name}`),
  ) : h('div', { class: 'nextstn-plain' },
    h('span', {}, manual ? '📍 現在這一站' : '📍 下一站'),
    h('span', { class: 'nextstn-name' }, `${next.emoji || '📍'} ${next.name}`),
  );

  return h('div', { class: 'nextstn', style: 'margin-top:8px' },
    nav,
    h('button', { class: 'nextstn-switch', onclick: () => pickHereSpot(tripId) },
      manual ? '不是這一站？換一站' : '換一站'),
  );
}

// 選「現在在哪一站」。也提供「自動」把手動狀態關掉，不會被困住。
async function pickHereSpot(tripId) {
  const spots = store.spotsOf(tripId);
  if (!spots.length) return;
  const manual = store.getHereSpot(tripId);
  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  const res = await new Promise((resolve) => {
    const ov = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === ov) close(null); } });
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };

    const body = h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 12px' },
        '到了景點還沒拍照也沒關係，直接告訴 App 你現在在哪裡就好。'));
    for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      body.append(h('div', { class: 'section-label', style: 'margin:14px 2px 8px' }, `第 ${day} 天`));
      for (const s of list) {
        const p = store.spotProgress(s.id);
        const done = p.total > 0 && p.done === p.total;
        body.append(h('button', {
          class: 'here-pick' + (manual === s.id ? ' on' : ''),
          onclick: () => close(s.id),
        },
          h('span', { class: 'here-pick-emoji' }, s.emoji || '📍'),
          h('span', { class: 'here-pick-main' },
            h('span', { class: 'here-pick-name' }, s.name),
            h('span', { class: 'muted sm' }, p.total ? (done ? '✓ 已完成' : `完成 ${p.done}/${p.total}`) : '還沒有任務'),
          ),
          manual === s.id ? h('span', { class: 'here-pick-tick' }, '✓') : null,
        ));
      }
    }

    ov.append(h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' },
      h('h2', { class: 'modal-title' }, '你現在在哪一站？'),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => close('auto') }, '自動（照順序）'),
        h('button', { class: 'btn', onclick: () => close(null) }, '取消'),
      ),
    ));
    document.getElementById('modalRoot').append(ov);
    document.addEventListener('keydown', onKey);
  });
  if (res === null) return;

  // 換站時把折疊狀態清掉，新的預設（只展開這一站）才會生效 ——
  // 不然使用者會覺得「我明明選了，畫面卻沒反應」
  try {
    for (const s of spots) localStorage.removeItem('tripquest.spotOpen.' + s.id);
    for (const d of byDay.keys()) localStorage.removeItem(`tripquest.dayOpen.${tripId}.${d}`);
  } catch { /* noop */ }

  if (res === 'auto') { store.clearHereSpot(tripId); toast('改成自動照順序'); }
  else { store.setHereSpot(tripId, res); toast(`現在這一站：${store.get(res)?.name || ''}`); }
  trip(tripId, { fresh: true });
}

// 今天是這趟的第幾天：0 = 還沒開始、-1 = 已結束、null = 沒設日期、正整數 = 進行中
function dayForToday(t) {
  if (!t.startDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(t.startDate + 'T00:00:00');
  const end = new Date((t.endDate || t.startDate) + 'T00:00:00');
  if (today < start) return 0;
  if (today > end) return -1;
  return Math.floor((today - start) / 86400000) + 1;
}

function dayDate(t, day) {
  if (!t.startDate) return '';
  const d = new Date(t.startDate + 'T00:00:00');
  d.setDate(d.getDate() + (day - 1));
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function dayProgress(daySpots) {
  let done = 0, total = 0;
  for (const s of daySpots) { const p = store.spotProgress(s.id); done += p.done; total += p.total; }
  return { done, total };
}

// 「天」這一層的折疊
function dayCollapse(day, daySpots, tripId, t, ctx) {
  const dp = dayProgress(daySpots);
  const dayDone = dp.total > 0 && dp.done === dp.total;
  const dstr = dayDate(t, day);

  // 預設展開規則。使用者手動指定「現在這一站」時，那一天最優先 ——
  // 他自己講的，比日期推算準。
  let dflt;
  if (ctx.hereDay) dflt = day === ctx.hereDay;
  else if (ctx.allDone) dflt = false;
  else if (ctx.todayDay == null || ctx.todayDay === 0) dflt = day === ctx.dayNums[0];   // 沒設日期 / 還沒開始 → 只開第一天
  else if (ctx.todayDay === -1) dflt = false;                                            // 已結束 → 全收
  else dflt = day === ctx.todayDay;                                                      // 進行中 → 只開今天

  const key = `tripquest.dayOpen.${tripId}.${day}`;
  let open = dflt;
  try {
    const stored = localStorage.getItem(key);
    if (stored === '1') open = true;
    else if (stored === '0') open = false;
  } catch { /* noop */ }

  const chev = h('span', { class: 'dc-chev' }, open ? '▾' : '▸');
  const isToday = ctx.todayDay === day && ctx.todayDay > 0;

  const meta = [
    dstr || null,
    `${daySpots.length} 個景點`,
    dp.total ? (dayDone ? '✓ 全部完成' : `完成 ${dp.done}/${dp.total}`) : null,
  ].filter(Boolean).join(' · ');

  const wxSpan = h('span', { class: 'dc-wx' });   // 天氣摘要背景填（另起一行）

  const sec = h('section', { class: 'daycollapse' + (open ? ' open' : ''), dataset: { day: String(day) } },
    h('button', {
      class: 'dc-head' + (isToday ? ' is-today' : ''), 'aria-expanded': String(open),
      onclick: () => {
        const nowOpen = !sec.classList.contains('open');
        sec.classList.toggle('open', nowOpen);
        chev.textContent = nowOpen ? '▾' : '▸';
        try { localStorage.setItem(key, nowOpen ? '1' : '0'); } catch { /* noop */ }
      },
    },
      h('span', { class: 'dc-main' },
        h('span', { class: 'dc-row1' },
          h('span', { class: 'dc-daynum' }, `第 ${day} 天`),
          isToday ? h('span', { class: 'dc-todaytag' }, '今天') : null,
        ),
        h('span', { class: 'dc-meta' }, h('span', {}, meta), wxSpan),
      ),
      chev,
    ),
    h('div', { class: 'dc-body' },
      h('div', { class: 'dc-inner' }, ...daySpots.map((s) => spotSection(s, tripId, ctx.hereId)))),
  );
  sec._wxSpan = wxSpan;
  return sec;
}

async function fillWeather(slot, container, tripId, trip) {
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

    // 每天的天氣摘要塞進「天」折疊的標題列（只填日期真的對得上的那幾天）
    if (trip.startDate) {
      const p2 = (n) => String(n).padStart(2, '0');
      for (const d of days) {
        if (!d._tripDay) continue;
        const ex = new Date(trip.startDate + 'T00:00:00');
        ex.setDate(ex.getDate() + (d._tripDay - 1));
        const expected = `${ex.getFullYear()}-${p2(ex.getMonth() + 1)}-${p2(ex.getDate())}`;
        if (d.date !== expected) continue;
        const sec = container.querySelector(`.daycollapse[data-day="${d._tripDay}"]`);
        const span = sec && sec._wxSpan;
        if (span) span.textContent = `${wx.wxIcon(d.code)} ${d.tmax}° / ${d.tmin}°`;
      }
    }

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

// 每個景點的任務清單。預設規則：**還沒完成的展開、完成的收起** —— 進來就看得到還要做什麼，
// 做完的自動讓位。使用者自己點過的展開／收合永遠優先（存 localStorage）。
function spotSection(s, tripId, hereId) {
  const quests = store.questsOf(s.id);
  const p = store.spotProgress(s.id);
  const allDone = p.total > 0 && p.done === p.total;
  const isHere = !!hereId && hereId === s.id;

  const openKey = 'tripquest.spotOpen.' + s.id;
  let open;
  try {
    const stored = localStorage.getItem(openKey);
    if (stored === '1') open = true;
    else if (stored === '0') open = false;
    // 有指定「現在這一站」時只展開那一站，其他收起來
    else if (hereId) open = isHere;
    else open = !allDone;
  } catch { open = hereId ? isHere : !allDone; }

  const tk = s.theme || themeForSpot(s);
  const tm = themeMeta(tk);
  const chev = h('span', { class: 'qc-chev' }, open ? '▾' : '▸');
  const sec = h('section', {
    class: 'qcollapse' + (open ? ' open' : '') + (isHere ? ' is-here' : ''),
    dataset: { spot: s.id },
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
          isHere ? h('span', { class: 'qc-here' }, '📍 現在這一站') : null,
          h('span', { class: 'qc-theme' }, tm.emoji + ' ' + tm.label)),
        h('span', {
          class: 'qc-prog' + (allDone ? ' done' : (p.done ? ' part' : '')),
        }, p.total ? (allDone ? '✓ 完成' : `${p.done}/${p.total}`) : '—'),
        chev,
      ),
      // 這裡本來有一顆「編輯」，但它會把長輩帶到景點頁 —— 而拍照按鈕在那裡，
      // 於是「編輯」看起來就成了加照片的入口。拍照按鈕現在直接在任務卡上，
      // 景點的改名 / 刪除 / 改任務都集中到「調整每天的行程」。
    ),
    h('div', { class: 'qc-body' }, h('div', { class: 'qc-inner' },
      spotMapButton(s),
      ...quests.map((q) => questBigCard(q, s, tk)))),
  );
  return sec;
}

// ---------- 背景補示意圖 ----------
// 舊行程（v1.25 以前建立的）不用做任何事：`needsEnrich()` 看的是每個景點的 `_enrichV`，
// 舊資料沒有這個欄位就算 0，所以下次打開行程頁自然會補。使用者什麼都不用設定。
let enriching = null;

function startEnrich(tripId) {
  if (enriching === tripId) return;              // 同一趟不要同時跑兩份
  if (!navigator.onLine) {
    // 沒網路就安靜等著，連上再補（一次性，別累積一堆 listener）
    const onBack = () => {
      window.removeEventListener('online', onBack);
      if (location.hash.includes(`/trip/${tripId}`)) startEnrich(tripId);
    };
    window.addEventListener('online', onBack);
    return;
  }
  enriching = tripId;
  enrichTrip(tripId, {
    onProgress: ({ type, id }) => {
      if (!location.hash.includes(`/trip/${tripId}`)) return;
      if (type === 'spot') for (const q of store.questsOf(id)) repaintQuestPhoto(q.id);
      else repaintQuestPhoto(id);
    },
  }).catch(() => {}).finally(() => { enriching = null; });
}

// 只換那一張卡的圖，不動其他 DOM
function repaintQuestPhoto(questId) {
  const el = document.querySelector(`.qbig-photo[data-q="${CSS.escape(questId)}"]`);
  if (!el) return;
  const q = store.getRaw(questId);
  if (!q) return;
  const sp = store.getRaw(q.spotId);
  const subs = store.submissionsOf(questId);
  el.querySelector('.img-credit')?.remove();
  el.classList.remove('is-placeholder', 'has-img');
  el.style.backgroundImage = '';
  paintRef(el, refImageFor(q, sp, subs[0] && (subs[0].thumbHash || subs[0].photoHash)),
    sp ? (sp.theme || themeForSpot(sp)) : 'journey', q.spotId);
}

// 把示意圖畫上去。抓不到圖（或 blob 被清掉）一律用主題色塊，不留一塊空白。
export function paintRef(el, pick, themeKey, seed) {
  const placeholder = () => {
    el.style.backgroundImage = `url("${themePlaceholder(themeKey, seed)}")`;
    el.classList.add('is-placeholder');
    el.classList.remove('has-img');
    el.querySelector('.img-credit')?.remove();     // 沒有圖就不能留著別人的授權標示
  };
  if (!pick) { placeholder(); return; }
  el.classList.add('has-img');
  blobURL(pick.hash).then((u) => {
    if (!u) { placeholder(); return; }             // 同步過來但本機還沒抓到圖
    el.style.backgroundImage = `url("${u}")`;
    // 出處等圖真的出現才標。先標的話，圖載不出來時就會變成
    // 「大大的 emoji ＋ 別人的姓名授權」，看起來像那個 emoji 是他的作品。
    if (pick.own) return;
    const line = creditLine(pick.attr, pick.generic);
    if (line && !el.querySelector('.img-credit')) el.append(h('span', { class: 'img-credit' }, line));
  }).catch(placeholder);
}

function spotMapButton(s) {
  const url = mapsSearchUrl(s);
  if (!url) return null;
  return h('a', {
    class: 'btn btn-soft btn-block map-btn', href: url, target: '_blank', rel: 'noopener',
    style: 'text-decoration:none; margin-bottom:12px',
  }, `🗺️ 用地圖看「${s.name}」在哪裡`);
}

function questBigCard(q, spot, themeKey) {
  const done = store.isQuestDone(q.id);
  const subs = store.submissionsOf(q.id);
  const km = KIND_META[q.kind] || KIND_META.thing;
  const likeCount = subs.reduce((n, s) => n + store.reactionsOf(s.id).length, 0);

  const photo = h('div', { class: 'qbig-photo', dataset: { q: q.id } },
    h('span', { class: 'qbig-emoji' }, km.icon),
    done ? h('span', { class: 'qbig-check' }, '✓') : null,
  );
  // 自己拍過了就顯示自己的照片；還沒拍才給參考圖
  paintRef(photo, refImageFor(q, spot, subs[0] && (subs[0].thumbHash || subs[0].photoHash)), themeKey, spot.id);

  // 卡片本身不再是一顆大按鈕 —— 加照片的兩顆按鈕要直接放在卡片上，
  // 長輩一眼就看得到、按一下就開始，不用先點進任何地方。
  return h('div', { class: 'qbig' + (done ? ' done' : '') },
    h('button', {
      class: 'qbig-open', onclick: () => navigate(`/quest/${q.id}`),
      'aria-label': `看「${q.title}」的照片`,
    },
      photo,
      h('div', { class: 'qbig-body' },
        h('div', { class: 'qbig-title' }, q.title,
          q.aiQuest ? h('span', { class: 'ai-mark', title: '這個任務由 AI 出題' }, ' ✨') : null),
        q.hint ? h('div', { class: 'qbig-hint' }, q.hint) : null,
        h('div', { class: 'qbig-foot' },
          h('span', { class: 'tag' }, km.label),
          h('span', { class: 'qbig-status' }, done ? `✓ 完成（${subs.length} 張）` : '還沒拍'),
          likeCount ? h('span', { class: 'qbig-likes' }, '❤️ ' + likeCount) : null,
        ),
      ),
    ),
    h('div', { class: 'qbig-actions' },
      addPhotoButtons(q.tripId, q.id, { compact: true, onDone: () => trip(q.tripId) }),
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
    } }, t.title || '未命名')),

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

    h('div', { class: 'section-label', style: 'margin:22px 2px 8px' }, 'AI 加值（進階、可選）'),
    aiConfigCard(tripId, () => settings(tripId)),

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
