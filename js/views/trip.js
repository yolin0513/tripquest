import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, toast, mount, confirmDialog, promptDialog, modal, fmtDate, avatar, smoothScrollTo, KIND_META } from '../ui.js';
import { navigate, back, navRestoredScroll } from '../router.js';
import { getPrefs } from '../prefs.js';
import { uuid, hashHue, deviceId } from '../ids.js';
import { shooterOf } from '../badges.js';
import { shareURL, exportBundle, downloadBlob, nativeShare } from '../share.js';
import * as pos from '../pos.js';
import { askShare } from './posconsent.js';
import { generateForTrip, themedQuestsForSpot } from '../quests/generate.js';
import { blobURL } from '../photos.js';
import { enrichTrip, refImageFor, creditLine } from '../enrich.js';
import { addPhotoButtons } from '../addphoto.js';
import { activeMemberId, ensureMember } from '../claim.js';
import { myName } from '../identity.js';
import { pickDateRange, rangeLabel } from '../daterange.js';
import { loadThemes, themeForSpot, themeMeta, themePlaceholder } from '../theme.js';
import { loadEmergency } from '../emergency.js';
import { aiConfigCard, mapsConfigCard } from './ai-config.js';
import { mapsDirUrl, mapsSearchUrl } from '../maps.js';
import { spotTimes } from '../spottime.js';

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

// 畫面要展開哪一個景點。跟 currentSpot 的差別：**以「今天」為錨**。
// 「帶我去下一站」指向下一個未完成的（不管哪一天）是對的；但展開不一樣 ——
// 人在第 2 天，卻因為第 1 天有一張沒補拍就把畫面拉回第 1 天，那是幫倒忙。
function focusSpot(tripId, todayDay) {
  const manual = store.getHereSpot(tripId);
  if (manual) return store.get(manual);
  const spots = store.spotsOf(tripId);
  const undone = spots.filter((s) => {
    const p = store.spotProgress(s.id);
    return p.total === 0 || p.done < p.total;
  });
  if (!undone.length) return null;
  if (todayDay === -1) return null;               // 旅程結束了：全部收合，把回顧推到最上面
  if (todayDay > 0) {
    const today = undone.find((s) => (s.day || 1) === todayDay);
    if (today) return today;                      // 今天還有沒拍完的 → 就是它
    if (spots.some((s) => (s.day || 1) === todayDay)) return null;  // 今天全拍完了 → 不強迫展開別天
  }
  return undone[0];
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
    welcomeCard(tripId),
    syncBanner(tripId, t),
    h('div', { class: 'progress-banner' },
      h('div', { class: 'pb-text' },
        h('div', { class: 'pb-title' }, allDone ? '全部完成了！🎉' : `已完成 ${prog.done} / ${prog.total}`),
        h('div', { class: 'pb-sub' }, allDone ? '可以做回憶影片了' : (prog.done === 0 ? '開始拍第一張吧' : '繼續加油！')),
        h('div', { class: 'progress-track' }, h('i', { style: `width:${Math.round(prog.ratio * 100)}%` })),
      ),
      ring(prog.ratio, { size: 64, label: `${prog.done}/${prog.total}` }),
    ),

    joinBanner(tripId, members),
    members.length ? crewButton(tripId, t, members) : null,

    // 同步的旅程、還沒說「我是誰」→ 提示（點一下就好，非強制）
    // 還沒說「這是誰的手機」→ 旅伴那邊會看到你「還沒加入」，而且你開了位置分享也
    // 傳不出去（v1.63/v1.64 實機踩過：建立者從來沒走過這一步）。原本是一顆軟性按鈕，
    // 實機回報「被忽略了」；改成講清楚後果的提示卡。**不用彈窗**——彈窗會蓋住別的
    // 對話框，900 毫秒後突然跳出來對長輩也不友善。
    (store.getRaw(t.groupId)?.syncSecret && !activeMemberId(tripId) && members.length > 1)
      ? h('div', { class: 'claim-nudge' },
          h('div', { class: 'claim-nudge-t' }, '👋 旅伴還看不到你'),
          h('p', { class: 'claim-nudge-p' }, '先告訴大家「這是誰的手機」，你拍的照片才會算在你名下，旅伴也才看得到你已經加入。'),
          h('button', {
            class: 'btn btn-primary btn-block',
            onclick: async () => { const got = await ensureMember(tripId, { force: true }); if (got) toast('好了，旅伴現在看得到你了'); trip(tripId); },
          }, '選擇我是誰'))
      : null,

    posBanner(tripId),

    // 全部完成 / 旅程結束 → 直接把「回顧」拉到最上面
    // 旅程結束／全部完成時給回顧入口，但「帶我去下一站」還是要留著 ——
    // 回程日過了照片還沒補完的情況很常見，那時候一樣需要導航與「換一站」。
    (allDone || tripEnded(t)) && spots.length
      ? h('div', {},
          h('button', { class: 'btn btn-primary btn-block btn-big', style: 'margin-top:8px', onclick: () => navigate(`/trip/${tripId}/memories`) },
            allDone ? '🎉 全部完成！去看回顧與回憶影片' : '🎁 旅程結束了，來看回顧'),
          nextStationButton(tripId, t, allDone))
      : nextStationButton(tripId, t, allDone),

    h('div', { class: 'stack', style: 'margin-top:6px' },
      // 找附近（v1.59）：自駕最常用——獨立入口、不塞 SOS（緊急頁不放生活設施）
      h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/nearby`) }, '🅿️ 找附近：停車場・廁所・超商'),
      spots.length ? h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/plan`) }, '📅 調整每天的行程') : null,
      // 「把任務分享給旅伴」移到旅程設定（v1.59.1）——分享＝邀請旅伴加入，
      // 語意屬於「旅伴與電話」那一區；行程頁保持「出遊當下」的操作。
      // 不另留快速入口：⚙️ 一步就到，而且旅伴清單（頭像列點開）裡也有「分享邀請連結」。
    ),
  );

  if (spots.length === 0) {
    container.append(h('div', { class: 'empty' }, h('p', {}, '這個旅程還沒有景點'),
      // 簡易的「景點名稱」對話框不好用（實機回報）—— 統一帶去「調整每天的行程」，
      // 那裡有完整的加景點、搜尋加入、時間停留設定
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/trip/${tripId}/plan`) }, '＋ 去安排景點')));
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
    // 「現在這一站」＝手動指定的，沒指定就是第一個未完成的。
    // 展開規則一律以它為準（天與景點兩層都是），畫面才會只聚焦在一個地方。
    const focus = focusSpot(tripId, todayDay);
    const focusId = focus ? focus.id : null;
    const focusDay = focus ? (focus.day || 1) : null;

    // 「現在這一站」換了（他自己改的，或前一站拍完自動往下走）→ 把記住的折疊狀態清掉，
    // 新的預設才生效。不清的話，之前按過一次「全部展開」就等於永遠全部展開 ——
    // 使用者實機看到的「第二天的全部任務都是展開的」就是這樣來的。
    try {
      const fk = 'tripquest.focus.' + tripId;
      if (localStorage.getItem(fk) !== String(focusId)) {
        for (const s of spots) localStorage.removeItem('tripquest.spotOpen.' + s.id);
        for (const d of byDay.keys()) localStorage.removeItem(`tripquest.dayOpen.${tripId}.${d}`);
        localStorage.setItem(fk, String(focusId));
      }
    } catch { /* noop */ }
    for (const day of dayNums) {
      container.append(dayCollapse(day, byDay.get(day), tripId, t, {
        dayNums, todayDay, allDone, focusDay, focusId, hereId,
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

  watchHere(tripId);
  // 剛打開行程頁就是最想看到最新狀態的時候 —— 立刻拉一次，不等下一輪排程
  import('../outbox.js').then((o) => o.refreshNow()).catch(() => {});



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
// 捲動目標一律是「那一天的標題列」——使用者要先知道自己在第幾天，再看到那一站。
// 有指定「現在這一站」就用它所屬的那一天（那天會展開、而且只有那一站是展開的，
// 所以捲到天的標題列就看得到它）；沒指定就用今天。
// 例外：如果捲到天的標題列之後，那一站仍然落在畫面外（那天景點很多時會這樣），
// 就改捲到那一站，因為「看到我要去的那一站」才是真正的目的。
function scrollToToday(container, todayDay, hereId) {
  if (!hereId && !(todayDay > 0)) return;
  if (navRestoredScroll()) return;
  if (getPrefs().autoScroll === false) return;

  const spotSec = hereId ? container.querySelector(`.qcollapse[data-spot="${CSS.escape(hereId)}"]`) : null;
  const day = hereId ? (store.getRaw(hereId)?.day || 1) : todayDay;
  const daySec = container.querySelector(`.daycollapse[data-day="${day}"]`);
  const dayHead = daySec && (daySec.querySelector('.dc-head') || daySec);
  const spotHead = spotSec && (spotSec.querySelector('.qc-head') || spotSec);
  const head = dayHead || spotHead;
  if (!head) return;

  const topH = document.getElementById('topbar')?.offsetHeight || 60;
  const tabH = document.getElementById('tabbar')?.offsetHeight || 76;
  const bottom = window.innerHeight - tabH;
  const r = head.getBoundingClientRect();

  // 本來就看得到（連那一站也看得到）就別動
  const spotVisibleNow = !spotHead || (() => {
    const q = spotHead.getBoundingClientRect();
    return q.top >= topH && q.bottom <= bottom;
  })();
  if (r.top >= topH && r.bottom <= bottom && spotVisibleNow) return;

  let target = Math.max(0, window.scrollY + r.top - topH - 10);

  // 捲到天的標題列之後，那一站還是看不到 → 改捲到那一站
  if (spotHead && head !== spotHead) {
    const q = spotHead.getBoundingClientRect();
    const spotTopAfter = q.top - (target - window.scrollY);
    if (spotTopAfter > bottom - 60) target = Math.max(0, window.scrollY + q.top - topH - 10);
  }

  if (Math.abs(target - window.scrollY) < 24) return;
  smoothScrollTo(target);
}


// 「用地圖帶我去下一站」＋「換一站」
function nextStationButton(tripId, t, allDone) {
  // 不看「旅程結束了沒」——回程日過了但照片還沒補完是很常見的，人也可能還在路上。
  // 只要還有下一站（自動推導或使用者指定）就給按鈕；全部拍完了 currentSpot 自然回 null。
  const next = currentSpot(tripId);
  if (!next) return null;
  void allDone;
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
        body.append(h('button', {
          class: 'here-pick' + (manual === s.id ? ' on' : ''),
          onclick: () => close(s.id),
        },
          h('span', { class: 'here-pick-emoji' }, s.emoji || '📍'),
          h('span', { class: 'here-pick-name' }, s.name),
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

  // 帶上是誰改的。離線也會先在本機生效，outbox 會在連線恢復後推出去。
  const meId = activeMemberId(tripId);
  const actor = { id: meId, name: (meId && store.getRaw(meId)?.displayName) || myName() || '' };

  if (res === 'auto') { await store.clearHereSpot(tripId, actor); toast('改成自動照順序'); }
  else { await store.setHereSpot(tripId, res, actor); toast(`現在這一站：${store.get(res)?.name || ''}`); }
  // 不傳 fresh：選完通常是接著要點導航，畫面這時候跳走反而礙事。
  // 自動捲動留到「下一次重新打開這趟行程」再做。
  trip(tripId);
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
  if (ctx.focusDay) dflt = day === ctx.focusDay;          // 現在這一站在哪一天就開哪一天
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
      h('div', { class: 'dc-inner' }, ...daySpots.map((s) => spotSection(s, tripId, ctx.focusId, ctx.hereId)))),
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
function spotSection(s, tripId, focusId, hereId) {
  const quests = store.questsOf(s.id);
  const p = store.spotProgress(s.id);
  const allDone = p.total > 0 && p.done === p.total;
  const isHere = !!hereId && hereId === s.id;

  const openKey = 'tripquest.spotOpen.' + s.id;
  // 預設**只展開現在這一站**（使用者手動指定的，或第一個未完成的）。
  // 原本沒指定時是 `!allDone` —— 那會把當天所有未完成的景點通通展開，
  // 使用者實機看到的就是「第二天的全部任務都是展開的」。
  const isFocus = !!focusId && focusId === s.id;
  const dflt = isFocus;                        // 沒有焦點（全完成／旅程已結束）就全部收合
  let open = dflt;
  try {
    const stored = localStorage.getItem(openKey);
    if (stored === '1') open = true;
    else if (stored === '0') open = false;
  } catch { /* noop */ }

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
          h('span', { class: 'qc-theme' },
            // 從行程表匯入的才有時間；沒有就不佔位置
            spotTimes(s).label ? '🕘 ' + spotTimes(s).label + ' · ' : '',
            tm.emoji + ' ' + tm.label)),
        h('span', {
          class: 'qc-prog' + (allDone ? ' done' : (p.done ? ' part' : '')),
        }, p.total ? (allDone ? '✓ 完成' : `${p.done}/${p.total}`) : '—'),
        chev,
      ),
      spotMapButton(s),
      // 這裡本來有一顆「編輯」，但它會把長輩帶到景點頁 —— 而拍照按鈕在那裡，
      // 於是「編輯」看起來就成了加照片的入口。拍照按鈕現在直接在任務卡上，
      // 景點的改名 / 刪除 / 改任務都集中到「調整每天的行程」。
    ),
    h('div', { class: 'qc-body' }, h('div', { class: 'qc-inner' },
      ...quests.map((q) => questLine(q, s, tk)))),
  );
  return sec;
}

// 同步進來的東西要自己出現在畫面上，不用使用者重開 App。
// 原本只看「現在這一站」與 claim 數，所以旅伴新增的景點、改的名字、新照片
// 都不會讓這頁重畫（實機回報「一直沒更新」的一半原因）。改成看一份輕量的
// 內容簽章：同步每次拉取都會 emit，簽章沒變就不重畫（避免整頁狂重繪）。
let hereWatch = null;
function tripSignature(tripId) {
  const t = store.get(tripId);
  if (!t) return '';
  const recs = store.exportRecords();
  let claims = 0, maxUp = t.updatedAt || 0;
  for (const r of recs) {
    if (r.tripId !== tripId) continue;
    if (r.type === 'memberClaim') claims++;
    if (r.updatedAt > maxUp) maxUp = r.updatedAt;
  }
  const spots = store.spotsOf(tripId);
  const quests = store.questsOfTrip(tripId);
  return [store.getHereSpot(tripId) || '', claims, spots.length, quests.length,
    store.submissionsOfTrip(tripId).length, store.membersOf(t.groupId).length, maxUp].join('|');
}
function watchHere(tripId) {
  if (hereWatch) { hereWatch(); hereWatch = null; }
  let last = tripSignature(tripId);
  hereWatch = store.subscribe(() => {
    if (!location.hash.includes(`/trip/${tripId}`) || location.hash.match(/\/(spot|plan|poster|weather|people|expenses|memories)/)) return;
    const now = tripSignature(tripId);
    if (now === last) return;
    last = now;
    trip(tripId);
  });
}

// ---------- 旅伴：誰真的加入了（v1.57.3）----------
// 資料依據：memberClaim（append-only、會同步）＝某台裝置認領了某個成員。
//   有 claim ＝ 真的有人用這個名字在用 App（取最早的 claimedAt 當「加入時間」）；
//   沒有 claim ＝ 名字被列出來但還沒有人認領 —— 顯示「還沒加入」。
//   限制：建立者自己也要選過一次「這是誰的手機」才算（第一次拍照/按讚時會問）。
function crewInfo(tripId, t) {
  const recs = store.exportRecords();
  const claims = recs.filter((r) => r.type === 'memberClaim' && r.tripId === tripId);
  const subs = store.submissionsOfTrip(tripId);
  const members = store.membersOf(t.groupId);
  return members.map((m) => {
    const mine = claims.filter((c) => c.memberId === m.id);
    const joinedAt = mine.length ? Math.min(...mine.map((c) => c.claimedAt || Infinity)) : null;
    const shot = subs.filter((s) => shooterOf(s) === m.id);
    let lastAt = Math.max(0, ...mine.map((c) => c.claimedAt || 0),
      ...shot.map((s) => s.takenAt || s.createdAt || 0),
      ...recs.filter((r) => (r.type === 'reaction' || r.type === 'comment') && r.actorId === m.id && r.tripId === tripId)
        .map((r) => r.createdAt || 0));
    return { m, joined: !!mine.length, joinedAt: Number.isFinite(joinedAt) ? joinedAt : null,
      devices: mine.length, photos: shot.length, lastAt: lastAt || null,
      isNew: !!mine.length && Date.now() - joinedAt < 24 * 3600000 };
  });
}
const fmtDT = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function fmtAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} 分鐘前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小時前`;
  return `${Math.round(s / 86400)} 天前`;
}
function crewButton(tripId, t, members) {
  const info = crewInfo(tripId, t);
  return h('button', { class: 'crew-btn', 'aria-label': '看旅伴清單', onclick: () => openCrew(tripId, t) },
    h('div', { class: 'avatars' }, ...info.map((x) => h('span', { class: 'crew-wrap' },
      (() => { const a = avatar(x.m.displayName, hashHue(x.m.id)); if (!x.joined) a.classList.add('ghost'); return a; })(),
      x.isNew ? h('span', { class: 'crew-new' }, '新') : null,
    ))),
    h('span', { class: 'crew-label' }, `${info.filter((x) => x.joined).length}/${info.length} 位已加入 ›`),
  );
}
async function openCrew(tripId, t) {
  const { modal } = await import('../ui.js');
  const info = crewInfo(tripId, t).sort((a, b) => (b.joined - a.joined) || (a.joinedAt || 0) - (b.joinedAt || 0));
  const anyPending = info.some((x) => !x.joined);
  let close = null;
  const v = await modal({
    expose: (fn) => { close = fn; },
    title: '👥 旅伴',
    closeX: true,
    body: h('div', {},
      ...info.map((x) => h('div', { class: 'crew-row' },
        h('span', { class: 'crew-wrap' },
          (() => { const a = avatar(x.m.displayName, hashHue(x.m.id)); if (!x.joined) a.classList.add('ghost'); return a; })(),
          x.isNew ? h('span', { class: 'crew-new' }, '新') : null),
        h('div', { class: 'cr-main' },
          h('div', { class: 'cr-name' }, x.m.displayName),
          x.joined
            ? h('div', { class: 'cr-line ok' }, `✓ ${fmtDT(x.joinedAt)} 加入${x.devices > 1 ? `（${x.devices} 台裝置）` : ''}`)
            : h('div', { class: 'cr-line' }, '⏳ 還沒加入 — 把邀請連結傳給他就能加入'),
          x.joined ? h('div', { class: 'cr-line' },
            `拍了 ${x.photos} 張` + (x.lastAt ? ` · 最後活動 ${fmtAgo(x.lastAt)}` : '')) : null,
        ),
      )),
      h('p', { class: 'form-hint', style: 'margin-top:10px' },
        '「加入」以選過「這是誰的手機」為準 —— 名字被列出來但還沒點過自己名字的人，會顯示還沒加入。'
        + '手機沒有推播，所以旅伴的動作是每 20 秒去問一次伺服器；剛加入的人可能要等一下才出現。'),
      h('button', {
        class: 'btn btn-soft btn-block', style: 'margin-top:8px',
        onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = '更新中…';
          try { await (await import('../outbox.js')).refreshNow(); } finally { close && close('refresh'); }
        },
      }, '🔄 立刻檢查有沒有新的旅伴'),
    ),
    actions: [
      // 「還沒加入——把邀請連結傳給他」不能是一句沒有按鈕的話
      ...(anyPending ? [{ label: '🔗 分享邀請連結', value: 'share', primary: true }] : []),
      { label: '知道了', value: true },
    ],
  });
  if (v === 'share') doShare(tripId);
  if (v === 'refresh') { await openCrew(tripId, t); }        // 更新完直接把清單重開，看得到新結果
}
// 有人新加入 → 一次性橫幅（本機記住看過哪些 claim；claim 會同步，所以旅伴的手機也會看到）
function joinBanner(tripId, members) {
  const key = 'tripquest.claimseen.' + tripId;
  const claims = store.exportRecords().filter((r) => r.type === 'memberClaim' && r.tripId === tripId);
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch { seen = null; }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(claims.map((c) => c.id))); } catch { /* noop */ } };
  if (!Array.isArray(seen)) { save(); return null; }   // 第一次看這頁：全部記為已看，不對歷史轟炸
  const fresh = claims.filter((c) => !seen.includes(c.id) && c.deviceId !== deviceId());
  if (!fresh.length) { save(); return null; }
  const names = [...new Set(fresh.map((c) => store.getRaw(c.memberId)?.displayName).filter(Boolean))];
  if (!names.length) { save(); return null; }
  const el = h('div', { class: 'join-banner' },
    h('span', {}, `🎉 ${names.join('、')} 加入了旅程`),
    h('button', { class: 'jb-x', 'aria-label': '知道了', onclick: () => { save(); el.remove(); } }, '✕'),
  );
  // 背景同步會觸發重繪 —— 不能「顯示即算看過」，不然橫幅幾秒就消失。
  // 按 ✕ 或停留 8 秒才算；重繪期間 seen 還沒存 → 橫幅繼續在。
  setTimeout(save, 8000);
  return el;
}

// ---------- 剛加入的第一分鐘（v1.57）----------
// 歡迎卡只出現一次（加入時 share.js 立旗）；同步進度列只在還有待抓照片時出現，
// 每 1.5 秒問一次 outbox，抓完變「已是最新」再淡出。
function welcomeCard(tripId) {
  const key = 'tripquest.welcome.' + tripId;
  let on = false;
  try { on = localStorage.getItem(key) === '1'; } catch { /* noop */ }
  if (!on) return null;
  const card = h('div', { class: 'welcome-card' },
    h('div', {},
      h('div', { class: 'wc-t' }, '👋 歡迎加入！拍照任務這樣玩'),
      h('div', { class: 'wc-p' }, '點下面的景點 → 看任務 → 按 📷 拍一張。大家的照片會自動同步到「📸 照片」。')),
    h('button', { class: 'wc-x', 'aria-label': '知道了', onclick: () => { try { localStorage.removeItem(key); } catch { /* noop */ } card.remove(); } }, '✕'),
  );
  return card;
}
function syncBanner(tripId, t) {
  const group = store.getRaw(t.groupId);
  if (!group || !group.syncSecret) return null;
  const line = h('span', {}, '正在接收照片…');
  const el = h('div', { class: 'sync-banner', hidden: true }, h('div', { class: 'spinner' }), line);
  let shown = false, timer = 0;
  let idle = 0;
  const tick = async () => {
    if (!document.body.contains(el) && shown) { clearInterval(timer); return; }
    let n = 0, st = null;
    try {
      const o = await import('../outbox.js');
      st = await o.syncStatus(tripId);
      n = st.missing + st.uploads;
      // 缺縮圖但沒有在同步 → 主動拉一次（剛加入、或上次被切到背景中斷）；連續三次沒進展就不再催
      if (st.missing > 0 && !st.draining && idle < 3) { idle++; o.drain().catch(() => {}); }
    } catch { n = 0; }
    if (n > 0) { el.hidden = false; shown = true; line.textContent = st && st.uploads && !st.missing ? `正在上傳照片… 還有 ${st.uploads} 張` : `正在接收照片… 還有 ${n} 張`; }
    else if (shown) {
      clearInterval(timer);
      el.classList.add('done'); el.querySelector('.spinner')?.remove(); line.textContent = '✓ 照片都到齊了';
      setTimeout(() => el.remove(), 2500);
      store.notifyExternalChange();
    } else { clearInterval(timer); el.remove(); }
  };
  tick(); timer = setInterval(tick, 1500);
  return el;
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
  // 一個任務現在有兩個圖面：收合列的小縮圖，以及展開後的大圖（可能還沒建）
  const els = document.querySelectorAll(`.qref[data-q="${CSS.escape(questId)}"]`);
  if (!els.length) return;
  const q = store.getRaw(questId);
  if (!q) return;
  const sp = store.getRaw(q.spotId);
  const subs = store.submissionsOf(questId);
  const pick = refImageFor(q, sp, subs[0] && (subs[0].thumbHash || subs[0].photoHash));
  for (const el of els) {
    el.querySelector('.img-credit')?.remove();
    el.classList.remove('is-placeholder', 'has-img');
    el.style.backgroundImage = '';
    paintRef(el, pick, sp ? (sp.theme || themeForSpot(sp)) : 'journey', q.spotId,
      { credit: !el.classList.contains('qline-thumb') });
  }
}

// 把示意圖畫上去。抓不到圖（或 blob 被清掉）一律用主題色塊，不留一塊空白。
export function paintRef(el, pick, themeKey, seed, { credit = true } = {}) {
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
    // 縮圖只有 56px，標上授權只會變成一團看不清的字壓在圖上。
    // 展開後的大圖仍然會標，出處不會消失。
    if (pick.own || !credit) return;
    const line = creditLine(pick.attr, pick.generic);
    if (line && !el.querySelector('.img-credit')) el.append(h('span', { class: 'img-credit' }, line));
  }).catch(placeholder);
}

// 地圖入口從「整寬一顆大按鈕」縮成標題列右邊的小圖示。
// 每個景點省下約 64px；一趟 30 個景點就是 1900px 的滑動距離。
// 觸控區仍然 48×48，而且有 aria-label —— 縮的是留白，不是可用性。
function spotMapButton(s) {
  const url = mapsSearchUrl(s);
  if (!url) return null;
  return h('a', {
    class: 'qc-map', href: url, target: '_blank', rel: 'noopener',
    'aria-label': `導航到「${s.name}」`, title: `導航到「${s.name}」`,
    onclick: (e) => e.stopPropagation(),
  }, h('span', { class: 'qc-map-ic' }, '🗺️'), h('span', { class: 'qc-map-t' }, '導航'));
}

// 任務列：收合是一列（約 88px），點一下才展開大圖與說明。
//
// 之前每張卡固定 414px（大圖 340 ＋ 說明 ＋ 兩顆按鈕），一個螢幕只放得下 1.7 張，
// 一個五個任務的景點就要滑 2300px。使用者實機回報「景點一多要滑很久」。
//
// 收合時**照樣可以直接加照片** —— 右邊那兩顆就是拍照與從相簿選，各自一下就到，
// 不必先展開。這是先前定下來、不能退讓的一條：加照片要一眼看到、一次點到。
// 展開的內容是第一次打開時才建，30 個任務不會在進頁面時就抓 30 張大圖。
function questLine(q, spot, themeKey) {
  const done = store.isQuestDone(q.id);
  const subs = store.submissionsOf(q.id);
  const km = KIND_META[q.kind] || KIND_META.thing;
  const likeCount = subs.reduce((n, s) => n + store.reactionsOf(s.id).length, 0);
  const refPick = () => refImageFor(q, spot, subs[0] && (subs[0].thumbHash || subs[0].photoHash));

  // 完成的任務，縮圖就是他自己拍的那張（refImageFor 本來就優先用投稿）
  const thumb = h('div', { class: 'qline-thumb qref', dataset: { q: q.id } },
    h('span', { class: 'qline-emoji' }, km.icon));
  paintRef(thumb, refPick(), themeKey, spot.id, { credit: false });

  const more = h('div', { class: 'qline-more' });
  let built = false;

  const buildMore = () => {
    const photo = h('div', { class: 'qline-photo qref', dataset: { q: q.id } },
      h('span', { class: 'qbig-emoji' }, km.icon),
      done ? h('span', { class: 'qbig-check' }, '✓') : null);
    paintRef(photo, refPick(), themeKey, spot.id);
    // 0fr/1fr 這個收合手法要求**只有一個子元素**：grid-template-rows: 0fr 只定義
    // 一列，多出來的子元素會掉進隱含列（auto），收合之後照樣佔高度、內容漏出來。
    // 所以大圖與說明要包在同一層裡。
    more.append(h('div', { class: 'qline-inner' },
      photo,
      h('div', { class: 'qline-detail' },
        q.hint ? h('p', { class: 'qline-hint' }, q.hint) : null,
        h('div', { class: 'qline-tags' },
          h('span', { class: 'tag' }, km.label),
          likeCount ? h('span', { class: 'qline-likes' }, '❤️ ' + likeCount) : null,
          subs.length ? h('button', {
            class: 'qline-link', onclick: () => navigate(`/quest/${q.id}`),
          }, `看照片（${subs.length} 張）`) : null,
        ),
        addPhotoButtons(q.tripId, q.id, { compact: true, onDone: () => trip(q.tripId) }),
      ),
    ));
  };

  const row = h('div', { class: 'qline' + (done ? ' done' : ''), dataset: { quest: q.id } });

  const head = h('button', {
    class: 'qline-head', 'aria-expanded': 'false',
    onclick: () => {
      const nowOpen = !row.classList.contains('open');
      // 同一時間只展開一個 —— 不然展開兩三個之後又回到「要滑很久」
      for (const other of document.querySelectorAll('.qline.open')) {
        if (other === row) continue;
        other.classList.remove('open');
        other.querySelector('.qline-head')?.setAttribute('aria-expanded', 'false');
      }
      if (nowOpen && !built) { built = true; buildMore(); }
      row.classList.toggle('open', nowOpen);
      head.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  },
    thumb,
    h('span', { class: 'qline-main' },
      h('span', { class: 'qline-title' }, q.title,
        null),   // 「AI 出題」的 ✨ 標示已依使用者要求移除
      h('span', { class: 'qline-sub' },
        done ? `✓ 已完成　${subs.length} 張` : '還沒拍',
        likeCount ? `　❤️ ${likeCount}` : ''),
    ),
    h('span', { class: 'qline-chev' }, '▸'),
  );

  row.append(
    head,
    // 完成與否，右邊都是同樣位置、同樣的兩顆圖示鈕。
    // 之前完成的列改成一個綠色打勾，等於完成前後的操作方式不一樣 ——
    // 想再拍一張的人會在原本的位置找不到東西。
    // 完成狀態改由縮圖（換成他自己拍的那張）與列上的「✓ 已完成」表示。
    h('div', { class: 'qline-act' },
      addPhotoButtons(q.tripId, q.id, { icons: true, onDone: () => trip(q.tripId) })),
    more,
  );
  return row;
}

// 從這台裝置移除旅程（v1.62，三代理 3:0）。
//
// 之前這裡是「同步刪除」：任何一位成員按下去，全家的行程與照片一起消失，
// 連建立者都救不回來（使用者實機回報）。現在只清這台裝置，伺服器與旅伴不受影響。
// 全群組刪除這一版**不提供**——沒有帳號系統，「建立者」只能靠可被覆寫的本機欄位
// 判斷，撐不起「把全家資料一次清掉」這種權限。
async function removeTrip(tripId, t) {
  const store2 = store;
  const g = store2.getRaw(t.groupId);
  const outbox = await import('../outbox.js');
  const { syncEnabled } = await import('../sync.js');
  const shared = !!(g && g.syncSecret) && syncEnabled();

  // 還沒送出去的照片只有這台有 —— 移除等於全家一起失去，先擋下來
  const pending = await outbox.pendingOf(t.groupId);
  if (pending.total) {
    await modal({
      title: '先等照片上傳完',
      body: h('div', {},
        h('p', {}, `還有 ${pending.blobs || pending.total} 張照片沒有傳給旅伴。現在移除的話，那些照片只存在這台手機，會跟著一起不見。`),
        h('p', { class: 'form-hint' }, '請連上網路，等行程頁的「正在傳照片」跑完再移除。')),
      actions: [{ label: '知道了', value: true }],
    });
    return;
  }

  const subs = store2.submissionsOfTrip(tripId);
  const originals = subs.filter((s) => s.originalHash).length;
  const ok = await modal({
    title: shared ? '從我的手機移除這趟旅程' : '刪除這趟旅程',
    body: h('div', {},
      shared
        ? h('div', {},
            h('p', { style: 'margin:0 0 8px' }, `「${t.title}」會從這台手機消失，${subs.length} 張照片的本機副本也會清掉。`),
            h('p', { class: 'form-hint', style: 'line-height:1.7' },
              '· 其他旅伴看得到的內容完全不受影響\n· 之後想看，用邀請連結就能加回來（下面會幫你把連結留著）'.split('\n').map((x) => h('div', {}, x))))
        : h('div', {},
            h('p', { style: 'margin:0 0 8px' }, `這趟旅程只存在這台手機（沒有同步給任何人），移除就等於永久刪除，${subs.length} 張照片一起沒有，無法復原。`),
            h('p', { class: 'form-hint' }, '建議先按上面的「匯出完整備份」再移除。')),
      originals ? h('p', { class: 'form-hint', style: 'margin-top:8px' },
        `※ 其中 ${originals} 張有保留原始檔，原始檔只存在這台手機，會一起清掉。`) : null,
    ),
    actions: [{ label: '取消', value: false }, { label: shared ? '移除' : '永久刪除', value: true, danger: true }],
  });
  if (!ok) return;

  // 1) 先把位置分享關掉（自己的座標不要留在伺服器與旅伴手機上）
  try { const pos2 = await import('../pos.js'); await pos2.stopSharing(tripId); } catch { /* noop */ }
  // 2) 等在途的同步跑完，不然它會把剛清掉的記錄塞回來
  await outbox.idle();
  // 3) 留一份祕鑰在本機 meta（不是記錄、不同步、不進匯出）→ 之後可以一鍵加回來
  if (shared) {
    try {
      const db2 = await import('../db.js');
      const { getConfig } = await import('../sync.js');
      const kept = (await db2.metaGet('removedGroups')) || [];
      const next = kept.filter((x) => x.groupId !== g.id);
      next.unshift({ groupId: g.id, secret: g.syncSecret, url: getConfig().url || '', title: t.title || '旅程', tripId, at: Date.now() });
      await db2.metaSet('removedGroups', next.slice(0, 10));
    } catch { /* 留不住也還有旅伴的連結可用 */ }
  }
  // 4) 清本機：記錄＋照片＋待送佇列＋同步游標＋AI 金鑰＋各種旗標
  await store2.forgetGroup(t.groupId, { onlyTripId: tripId });
  await outbox.forgetGroup(t.groupId);
  try {
    const db2 = await import('../db.js');
    await db2.metaSet('seq:' + t.groupId, 0);
    await db2.tripSecretDelete(tripId);
  } catch { /* noop */ }
  clearTripKeys(tripId);
  try { (await import('../photos.js')).revokeAll(); } catch { /* noop */ }

  toast(shared ? '已從這台手機移除' : '已刪除');
  navigate('/', { replace: true });
}

// 這趟旅程在本機留下的所有 localStorage 旗標
function clearTripKeys(tripId) {
  const spotIds = store.spotsOf(tripId).map((s) => s.id);
  const keys = ['me', 'welcome', 'claimseen', 'poshare', 'wall', 'focus', 'here'].map((k) => `tripquest.${k}.${tripId}`);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (keys.includes(k)) { localStorage.removeItem(k); continue; }
      if (k.startsWith(`tripquest.dayOpen.${tripId}`)) { localStorage.removeItem(k); continue; }
      if (spotIds.some((sid) => k === `tripquest.spotOpen.${sid}`)) localStorage.removeItem(k);
    }
  } catch { /* noop */ }
}

// 位置分享開關（旅程設定）。預設關；開之前一定先過同意畫面。
function posShareRow(tripId, t) {
  const box = h('div', { class: 'switch-row' });
  const draw = () => {
    const on = pos.sharing(tripId);
    const cb = h('input', { type: 'checkbox', checked: on });
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        if (!(await askShare(tripId, t))) { cb.checked = false; return; }
        await pos.setSharing(tripId, true);
        toast('已開始分享位置給旅伴');
      } else {
        await pos.setSharing(tripId, false);
        toast('已停止分享，伺服器上的位置也刪掉了');
      }
      draw();
      trip(tripId);                                     // 行程頁的常駐指示要跟著變
    });
    mount(box,
      h('div', {},
        h('div', { style: 'font-weight:700' }, '📍 讓家人看到我在哪'),
        h('div', { class: 'form-hint' }, on
          ? '分享中：家人在「緊急求助」頁看得到你最後的位置。隨時可以關。'
          : '預設關閉。走失時家人可以看到你最後一次打開 App 的位置，只在這趟旅行期間。')),
      cb);
  };
  draw();
  return box;
}

// 分享中的常駐指示 —— 長輩的手機常是子女設定的，這一條是手機主人唯一會看到的提醒
function posBanner(tripId) {
  if (!pos.sharing(tripId)) return null;
  return h('div', { class: 'pos-banner' },
    h('span', {}, '📍 正在跟旅伴分享你的位置'),
    h('button', {
      class: 'pos-banner-off',
      onclick: async () => { await pos.setSharing(tripId, false); toast('已停止分享'); trip(tripId); },
    }, '停止'),
  );
}

// ---------- 分享 ----------
async function doShare(tripId) {
  toast('產生分享連結中…');
  const url = await shareURL(tripId);
  // 訊息文字本身就是最快的「摘要」：對方還沒點連結、在聊天室裡就看到是誰的什麼行程
  //（v1.58 連結縮短後不再帶完整摘要，這行字接手 0 秒信任訊號的工作）。
  const t = store.get(tripId);
  const meId = activeMemberId(tripId);
  const meName = (meId && store.getRaw(meId)?.displayName) || '';
  const dates = t?.startDate ? (t.endDate && t.endDate !== t.startDate ? `${t.startDate}～${t.endDate}` : t.startDate) : '';
  const text = `${meName ? meName + ' ' : ''}邀請你加入「${t?.title || '旅程'}」${dates ? `（${dates}）` : ''}的拍照任務！`;
  if (await nativeShare({ title: 'TripQuest 拍照任務', text, url })) return;
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
    // 分享＝邀請旅伴加入，放在旅伴名單正上方（v1.59.1 從行程頁移來）
    h('button', { class: 'btn btn-primary btn-block', onclick: () => doShare(tripId) }, '🔗 把任務分享給旅伴'),
    h('p', { class: 'form-hint', style: 'margin:4px 2px 10px' }, '旅伴點連結就能加入，照片會自動同步。'),
    posShareRow(tripId, t),
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

    h('div', { class: 'section-label', style: 'margin:22px 2px 8px' }, '地圖加值（大眾運輸，進階、可選）'),
    mapsConfigCard(tripId),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        toast('打包中…');
        const blob = await exportBundle(tripId);
        downloadBlob(blob, `${t.title || 'trip'}.tripquest.json`);
      } }, '⬇️ 匯出完整備份（含照片）'),
      h('button', { class: 'btn btn-danger btn-block', onclick: () => removeTrip(tripId, t) },
        '🗑️ 從我的手機移除這趟旅程'),
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
