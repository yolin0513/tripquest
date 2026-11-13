import * as store from '../store.js';
import { h, toast, mount, confirmDialog, promptDialog, modal, fmtDate, avatar, smoothScrollTo, KIND_META, qty, mountPeek } from '../ui.js';
import { navigate, back, navRestoredScroll, refreshPage } from '../router.js';
import { getPrefs } from '../prefs.js';
import { uuid, hashHue, deviceId } from '../ids.js';
import { shooterOf, earnedBadges } from '../badges.js';
import { shareURL, exportBundle, downloadBlob, nativeShare } from '../share.js';
import * as pos from '../pos.js';
import { askShare } from './posconsent.js';
import { generateForTrip, themedQuestsForSpot, photoQuestId, loadPlaceLookup, placeLookupSync } from '../quests/generate.js';
import { blobURL } from '../photos.js';
import { enrichTrip, refImageFor, creditLine } from '../enrich.js';
import { addPhotoButtons } from '../addphoto.js';
import { activeMemberId, ensureMember } from '../claim.js';
import { myName } from '../identity.js';
import { pickDateRange, rangeLabel } from '../daterange.js';
import { loadThemes, themeForSpot, themeMeta, themePlaceholder, trustedTheme } from '../theme.js';
import { loadEmergency } from '../emergency.js';
import { aiConfigCard, mapsConfigCard, keyNotice, AI_WHY } from './ai-config.js';
import { mapsDirUrl, mapsSearchUrl } from '../maps.js';
import { spotTimes } from '../spottime.js';
import { tripPhase, countdownText, defaultDay, weekdayLabel, dayRoute, timelineStates, takeDayJump } from '../tripday.js';
import { paperPlane } from '../glyphs.js';
import { dayRealMap } from '../realmap.js';
import { tripOverviewMap } from '../overmap.js';
import { LEG_MODES, LEG_LABEL, LEG_ICON, legModeOf } from '../legs.js';
import { buyCounts } from '../buylist.js';
import { staysOf } from '../stays.js';
import { flightsOf, nextFlight, flightCountdown } from '../flights.js';

// v1.74：沒有任務的地點**不算未完成** —— 留白之後這種地點是常態（對不上策展資料庫的
// 餐廳、民宿、店家），把 total === 0 當成未完成的話，「現在這一站／帶我去下一站」
// 會永遠卡在第一個沒有任務的地點上。
function nextIncompleteSpot(tripId) {
  for (const s of store.spotsOf(tripId)) {
    const p = store.spotProgress(s.id);
    if (p.total > 0 && p.done < p.total) return s;
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
    return p.total > 0 && p.done < p.total;         // 0 任務的地點不算未完成（見 nextIncompleteSpot）
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
  if (pick) { await store.patch(tripId, { country: pick }); toast('已設定'); refreshPage(); }
}

// 這次打開 App 以來看過任務頁的旅程（只在記憶體裡；關掉 App 再開就清空）。用來分「回來」與「新打開」，見 trip() 的 selKey。
const taskSeen = new Set();

export default async function trip(tripId, { fresh = false, drawPage, setTop } = {}) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  await loadThemes().catch(() => {});
  await loadPlaceLookup().catch(() => {});   // 標題列的類別字要從景點庫重算；載不到就不印（placeLookupSync 回 null）

  setTop({
    title: t.title,
    action: { icon: '⚙️', label: '旅程設定', short: '設定', onClick: () => navigate(`/trip/${tripId}/settings`) },
  });

  const prog = store.tripProgress(tripId);
  const spots = store.spotsOf(tripId);
  const allDone = prog.total > 0 && prog.done === prog.total;

  const byDay = new Map();
  for (const s of spots) {
    const d = s.day || 1;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  // v1.84.0 主頁上線：任務頁只做任務——一行進度、日期列、各站的任務。
  // 原本在上面的出發倒數、進度卡、新旅伴橫幅、旅伴列、「旅伴還看不到你」、位置分享、回顧大按鈕、今天主角卡、找附近、天氣條
  // 搬到主頁（tripHome）或行程分頁；「拍照解任務」不搬（Yolin：主頁不放任務的跳轉；拍照就在每一列）。對照表在 STATUS。
  // 歡迎卡與同步列留在這裡：加入後落在這一頁（join.js），歡迎卡教的就是這一頁；拍完上傳的進度也在拍照的這一頁看。
  const container = h('div', { class: 'page' },
    welcomeCard(tripId),
    syncBanner(tripId, t),
    prog.total > 0 ? h('div', { class: 'task-prog', role: 'status' },
      h('span', { class: 'tp-title' }, allDone ? '全部完成了！🎉' : `已完成 ${prog.done} / ${prog.total}`),
      h('div', { class: 'progress-track' }, h('i', { style: `width:${Math.round(prog.ratio * 100)}%` }))) : null,
  );

  if (spots.length === 0) {
    container.append(h('div', { class: 'empty' }, h('p', {}, '這個旅程還沒有景點'),
      // 簡易的「景點名稱」對話框不好用（實機回報）—— 統一帶去「調整每天的行程」，
      // 那裡有完整的加景點、搜尋加入、時間停留設定
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/trip/${tripId}/plan`) }, '＋ 去安排景點')));
  } else {
    const dayNums = [...byDay.keys()].sort((a, b) => a - b);
    const todayDay = dayForToday(t);

    // 全部展開 / 全部收合 小工具（景點多於一個時顯示）
    // v1.74.11 起一次只顯示一天（上面的日期列切換），所以這兩顆只管景點；
    // 天不再有「收合」——收起來就是空白，長輩會以為行程不見了。
    if (spots.length > 1) {
      const setAll = (open) => {
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
    const selKey = 'tripquest.daySel.' + tripId;
    const seen = taskSeen.has(tripId);
    taskSeen.add(tripId);
    try {
      const fk = 'tripquest.focus.' + tripId;
      if (localStorage.getItem(fk) !== String(focusId)) {
        for (const s of spots) localStorage.removeItem('tripquest.spotOpen.' + s.id);
        localStorage.removeItem(selKey);
        localStorage.setItem(fk, String(focusId));
      }
      // 新打開這趟行程＝「帶我到今天」：一律回到預設的那一天，不沿用上次看到哪一天。
      // 返回、底部分頁切回來才沿用——他剛剛在看第 3 天，回來還是第 3 天。
      // 不能只看 fresh：router 每一次導覽（包括返回）都給 fresh。
      // 分「回來」原本看 navRestoredScroll()，但 router 只在捲動事件時記位置：整頁沒捲過，回來也算第一次進來。
      // v1.86.0 任務頁拿掉天的標題卡之後常常不用捲，collapsetest 撞到（選第 2 天 → 切到照片再切回來 → 變回第 1 天）。
      // 改看 taskSeen（這次打開 App 以來看過這一趟的任務頁沒有）；不改 router——它一改，測試範圍會放大成全套。
      if (fresh && !seen) localStorage.removeItem(selKey);
    } catch { /* noop */ }

    // 選中哪一天：手動選的（還在這趟的天數裡）> 現在這一站那天 > 今天 > 第一天
    let sel = defaultDay({ dayNums, todayDay, focusDay });
    try {
      const stored = Number(localStorage.getItem(selKey));
      // 「總覽」（第 0 格）2026-11-13 跟地圖一起搬到「行程」分頁，任務頁不再接受 0
      if (dayNums.includes(stored)) sel = stored;
      // 剛在景點設定頁改過某一站 → 停在那一站那一天（spot.js 存的，只用一次）
      const jump = takeDayJump(localStorage, tripId, dayNums);
      if (jump != null) {
        sel = jump;
        localStorage.setItem(selKey, String(sel));
      }
    } catch { /* noop */ }

    const daySecs = new Map();
    const strip = dayStrip(dayNums, byDay, t, { todayDay, sel, onPick: (d) => pick(d), overview: false });
    function pick(d, { scroll = true } = {}) {
      for (const [n, sec] of daySecs) sec.classList.toggle('open', n === d);
      strip.select(d);
      try { localStorage.setItem(selKey, String(d)); } catch { /* noop */ }
      // 換天之後把那一天的開頭帶到日期列下面；本來就看得到就不動
      // v1.86.0 起任務頁沒有天的標題卡了，「開頭」是第一站（dayStart：有時間就是那一行時間，沒有就是第一站的標題列）
      const head = scroll && daySecs.get(d) ? dayStart(daySecs.get(d)) : null;
      if (head) {
        const stripH = strip.el.getBoundingClientRect().bottom;
        const r = head.getBoundingClientRect();
        if (r.top < stripH || r.top > window.innerHeight * 0.6) smoothScrollTo(Math.max(0, window.scrollY + r.top - stripH - 8));
      }
    }
    // 「📷 拍照解任務」跳到那一站（jumpToSpot）v1.84.0 拿掉：它在今天主角卡上，主角卡搬到主頁、主頁不放任務的跳轉（Yolin）。
    // 只有一天就不需要日期列（只有一格，沒東西可以切）
    // 日期列放在「全部展開／收合」上面：它是這一區的目錄
    if (dayNums.length > 1) container.insertBefore(strip.el, container.querySelector('.day-tools'));
    // 「總覽」地圖 2026-11-13 搬到「行程」分頁（overviewSection()），跟每天的地圖放一起
    for (const day of dayNums) {
      const sec = dayCollapse(day, byDay.get(day), tripId, t, { todayDay, focusId, hereId, open: day === sel });
      daySecs.set(day, sec);
      container.append(sec);
    }
    // 新增景點在「調整每天的行程」裡；這裡不再重複放
  }

  // 每天的天氣摘要原本填在「天」的標題卡上；v1.86.0 標題卡拿掉了（天氣在主頁的天氣條與天氣頁），任務頁不再抓天氣。
  drawPage(container);

  // 進來時把「今天」帶到眼前。原本要等天氣摘要填完（最多 700ms）再捲；任務頁不抓天氣之後，畫完就捲
  // （跟以前沒有座標的旅程同一個時機）。
  if (fresh) {
    Promise.resolve()
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
      // v1.73.6：這裡跟 watchHere 是同一個病，而且黑名單更短（只有四個）。
      // warmTripContent 要等 AI 回應、幾秒鐘才回來，這期間使用者早就換頁了 ——
      // 回來就把人家的畫面畫掉。改用同一個白名單判斷：網址正好是行程頁本身才重畫。
      // 2026-11-11：選項開著時一樣先不重畫，記下來等收起來再補（見 watchHere 上面）
      if (changed && onTripPage(tripId)) { if (legPickOpen()) hereDirty = true; else refreshPage(); }
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
//   4. 只捲到那一天的開頭，不捲進任務深處，他才知道自己在哪一天（第幾天看上面的日期列，選中的就是那一天）
//   5. 設定可以整個關掉
// 捲動目標是「那一天的開頭」（v1.86.0 之前是天的標題卡；標題卡拿掉之後是第一站，見 dayStart）。
// 有指定「現在這一站」就用它所屬的那一天（那天會展開、而且只有那一站是展開的，
// 所以捲到那一天的開頭就看得到它）；沒指定就用今天。
// 例外：如果捲到那一天的開頭之後，那一站仍然落在畫面外（那天景點很多時會這樣），
// 就改捲到那一站，因為「看到我要去的那一站」才是真正的目的。
// 那一天的開頭（v1.86.0）：第一站有填時間 → 那一行時間（它在第一站卡片上方）；沒填 → 第一站的標題列；連站都沒有 → 整個區塊。
// 不用整個第一站（.tl-item）：展開的那一站很高，「本來就看得到就不動」看的是下緣，會變成永遠不成立、每次都捲。
function dayStart(daySec) {
  const li = daySec.querySelector('.tl-item');
  if (!li) return daySec;
  const tm = li.querySelector('.tl-time');
  return (tm && tm.textContent) ? tm : (li.querySelector('.qc-head') || li);
}
function scrollToToday(container, todayDay, hereId) {
  if (!hereId && !(todayDay > 0)) return;
  if (navRestoredScroll()) return;
  if (getPrefs().autoScroll === false) return;

  // v1.74.11：一次只顯示一天，捲的目標是**正在顯示的那一天**（日期列已經選中今天或現在這一站那天）。
  // 不能照日期去找：沒顯示的那幾天量出來位置是 0，會把畫面捲到不對的地方。
  const daySec = container.querySelector('.daycollapse.open');
  const spotSec = hereId && daySec ? daySec.querySelector(`.qcollapse[data-spot="${CSS.escape(hereId)}"]`) : null;
  const dayHead = daySec && dayStart(daySec);
  const spotHead = spotSec && (spotSec.querySelector('.qc-head') || spotSec);
  const head = dayHead || spotHead;
  if (!head) return;

  // 日期列黏在標題列下面，被它蓋住的那一段也算看不到
  const stripEl = container.querySelector('.daystrip');
  const topH = (document.getElementById('topbar')?.offsetHeight || 60) + (stripEl ? stripEl.offsetHeight : 0);
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

// 2026-11-13「今天」主角卡（風格提案第 10 項）：下一站的時間（有填才寫，大數字；沒填不補猜的）＋帶路＋換一站。
// 帶路那顆與「換一站」照舊是 nextStationButton（文字與行為都沒變）；這張卡把它們包起來、加上時間。
// v1.84.0 從任務頁搬到主頁，「📷 拍照解任務・還有 N 個」拿掉（Yolin：主頁不放任務的跳轉，任務維持在自己的頁籤）。
function todayCard(tripId, t) {
  const nav = nextStationButton(tripId, t, false);
  if (!nav) return null;
  const next = currentSpot(tripId);
  const label = store.getHereSpot(tripId) ? '現在這一站' : '下一站';
  const time = spotTimes(next).startTime || '';
  const later = upNextToday(tripId, t, next);
  return h('section', { class: 'today-card', 'aria-label': label },
    h('div', { class: 'today-head' },
      h('span', { class: 'today-label' }, label),
      time ? h('span', { class: 'today-time' }, time) : null),
    nav,
    // v1.84.0「今天接下來」（規劃 5.1，Yolin「都照建議做」）：主頁不放整天的時間軸（那是行程分頁的），只放後面兩站＋去行程分頁
    later.length ? h('div', { class: 'today-next' },
      h('div', { class: 'tn-label' }, '今天接下來'),
      h('ol', { class: 'tn-list' }, ...later.map((s) => {
        const st = spotTimes(s).startTime || '';
        return h('li', { class: 'tn-item' },
          st ? h('span', { class: 'tn-time' }, st) : null,
          h('span', { class: 'tn-name' }, `${s.emoji || '📍'} ${s.name}`));
      })),
      h('button', { class: 'tn-all', onclick: () => navigate(`/trip/${tripId}/itinerary`) }, '整天的行程 ›')) : null);
}

// 今天接下來：今天的行程裡排在下一站後面、還沒拍完的最多兩站（0 任務的地點照排，跟「下一站」同一個規矩）。
// 只講今天：旅程中、而且下一站就在今天，才有；下一站在別天（手動指定、或今天全拍完了）就不出現。沒有就不出現（不猜）。
function upNextToday(tripId, t, next) {
  // 還沒出發 todayDay 是 0、結束了是 -1：沒有哪一站的 day 是它，today 自然是空的——所以只要一道「下一站在不在今天」就夠
  const todayDay = dayForToday(t);
  const today = next ? store.spotsOf(tripId).filter((s) => (s.day || 1) === todayDay) : [];
  const i = today.findIndex((s) => s.id === next.id);
  if (i < 0) return [];                 // 下一站不在今天（在別天、還沒出發、結束了）→ 不出現
  return today.slice(i + 1).filter((s) => {
    const p = store.spotProgress(s.id);
    return !(p.total > 0 && p.done === p.total);
  }).slice(0, 2);
}

// 今晚住（規劃 5.1）：今天落在 [入住, 退房) 的住宿；只填了入住日的，只有入住那天算。點了用地圖帶過去（有地址用地址、沒有用名稱）。
// 住宿沒有「入住時間」這個欄位，所以不寫時間（規劃寫的「・入住時間」做不到，照實不寫）。日期是使用者填的，不從站名推。
function tonightStays(tripId) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return staysOf(tripId).filter((s) => s.checkIn && (s.checkOut ? s.checkIn <= today && today < s.checkOut : s.checkIn === today));
}

// 旅程結束後「💰 還有 N 筆帳沒結清」（規劃 5.1）：跟分帳頁同一套算法（settleTrip 的結清方案筆數）；
// 結清了（0 筆）、沒有花費、有查不到匯率的花費（算不準）都不出現——不猜。背景算（匯率可能要上網查），算完才放上去。
async function fillUnsettled(slot, tripId, t) {
  try {
    const [ex, fx] = await Promise.all([import('../expenses.js'), import('../fx.js')]);
    const list = ex.tripExpenses(tripId);
    if (!list.length) return;
    await fx.loadCurrencies();
    const base = t.baseCurrency || fx.currencyForCountry(t.country) || 'TWD';
    const rates = list.every((e) => e.currency === base) ? null : await fx.getRates();
    const s = ex.settleTrip(tripId, base, rates);
    if (s.missingRate || !s.transfers.length || !slot.isConnected) return;
    slot.replaceChildren(h('button', { class: 'btn btn-soft btn-block th-money', onclick: () => navigate(`/trip/${tripId}/expenses`) },
      `💰 還有 ${s.transfers.length} 筆帳沒結清`));
  } catch { /* 算不出來就不出現（不顯示 0、不猜） */ }
  finally { slot.dataset.checked = '1'; }   // 算完了（不管有沒有放東西）：測試等這個，才分得出「沒出現」與「還沒算完」
}

// ---- v1.86.0 主頁補內容（守夜模式照建議做；決定與替代方案見 STATUS）----
// 這趟的數字（結束後）：天數、景點、照片、花費總額。每一格都是「有才放」：
//   天數＝出發～結束日（含頭尾；兩個日期都有、而且結束不早於出發才放）；照片＝有照片的投稿張數（0 不放）；
//   花費＝跟分帳頁同一套算法的合計（背景算；沒有花費、有任何一筆查不到匯率〔合計算不準〕、合計是 0 都不放）。
const numCell = (v, k, cls = '') => h('div', { class: 'thn-cell' + (cls ? ' ' + cls : '') }, h('span', { class: 'thn-v' }, v), h('span', { class: 'thn-k' }, k));
function tripDays(t) {
  if (!t.startDate || !t.endDate) return 0;
  const a = new Date(t.startDate + 'T00:00:00'), b = new Date(t.endDate + 'T00:00:00');
  const n = Math.round((b - a) / 86400000) + 1;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function endNums(tripId, t, spots) {
  const photos = store.submissionsOfTrip(tripId).filter((x) => x.photoHash || x.thumbHash).length;
  const days = tripDays(t);
  const grid = h('div', { class: 'thn-grid' },
    days ? numCell(String(days), '天') : null,
    spots.length ? numCell(String(spots.length), '個景點') : null,
    photos ? numCell(String(photos), '張照片') : null);
  const el = h('section', { class: 'th-nums', 'aria-label': '這趟的數字' }, h('div', { class: 'th-sec-t' }, '這趟的數字'), grid);
  fillSpent(el, grid, tripId, t);
  return el;
}
async function fillSpent(el, grid, tripId, t) {
  try {
    const [ex, fx] = await Promise.all([import('../expenses.js'), import('../fx.js')]);
    const list = ex.tripExpenses(tripId);
    if (!list.length) return;
    await fx.loadCurrencies();
    const base = t.baseCurrency || fx.currencyForCountry(t.country) || 'TWD';
    const rates = list.every((e) => e.currency === base) ? null : await fx.getRates();
    const s = ex.settleTrip(tripId, base, rates);
    if (s.missingRate || !(s.totals.grand > 0) || !grid.isConnected) return;
    grid.append(numCell(fx.fmtMoney(s.totals.grand, base), '花費', 'thn-money'));   // 金額長，自己佔一整列（不然在窄格子裡從數字中間斷開）
  } catch { /* 算不出來就不放那一格 */ }
  finally { el.dataset.checked = '1'; }   // 算完了：測試等這個，才分得出「沒放」與「還沒算完」
}

// 照片列：最多 6 張縮圖，讚多的先、同讚數新的先。圖載不到的那張不放（還沒同步下來、壞掉的檔）；一張都沒有就整段不放。
// 標題寫「這趟的照片」不寫「精選」——沒有人真的挑過。整段是一顆按鈕，點了到照片分頁。
// 最多試 12 張：前面幾張載不到就往後補，但不為了湊滿一直往後抓（每一張載不到的都可能要上網問一次）。
async function fillShots(slot, tripId) {
  try {
    const subs = store.submissionsOfTrip(tripId).filter((x) => x.thumbHash || x.photoHash);
    if (!subs.length) return;
    const likes = new Map(subs.map((x) => [x.id, store.likesOf(x.id).count]));
    const when = (x) => x.takenAt || x.createdAt || 0;
    const ranked = subs.slice().sort((a, b) => (likes.get(b.id) - likes.get(a.id)) || (when(b) - when(a)));
    const urls = [];
    for (const x of ranked.slice(0, 12)) {
      const u = (await blobURL(x.thumbHash).catch(() => '')) || (await blobURL(x.photoHash).catch(() => ''));
      if (u) urls.push(u);
      if (urls.length === 6) break;
    }
    if (!urls.length || !slot.isConnected) return;
    const row = h('span', { class: 'th-shots-row', 'aria-hidden': 'true' });
    for (const u of urls) {
      const img = h('img', { class: 'th-shot', src: u, alt: '' });
      // 有網址但解不開（壞掉的檔）：那一張拿掉；全部拿掉了整段收起來
      img.addEventListener('error', () => { img.remove(); if (!row.querySelector('img')) slot.replaceChildren(); });
      row.append(img);
    }
    slot.replaceChildren(h('button', { class: 'th-shots', type: 'button', 'aria-label': `這趟的照片，共 ${subs.length} 張，看全部照片`,
      onclick: () => navigate(`/trip/${tripId}/people`) },
      h('span', { class: 'th-sec-t' }, '📸 這趟的照片'), row));
  } catch { /* 載不到就不放 */ }
  finally { slot.dataset.checked = '1'; }
}

// 出發前：每天的行程預覽。一天一列「第 N 天 日期 · 第一站 → 最後一站」（使用者排的站名，不另外編），最多 5 天、多的寫「還有 N 天」。
// 整張是一顆按鈕，點了到行程分頁。
function planPreview(tripId, t, spots) {
  const byDay = new Map();
  for (const s of spots) { const d = s.day || 1; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(s); }
  const dayNums = [...byDay.keys()].sort((a, b) => a - b);
  const shown = dayNums.slice(0, 5);
  return h('button', { class: 'th-plan', type: 'button', onclick: () => navigate(`/trip/${tripId}/itinerary`) },
    h('span', { class: 'th-sec-t' }, '🗺️ 每天的行程'),
    ...shown.map((d) => h('span', { class: 'thp-day' },
      h('span', { class: 'thp-n' }, `第 ${d} 天`),
      dayDate(t, d) ? h('span', { class: 'thp-d' }, dayDate(t, d)) : null,
      h('span', { class: 'thp-r' }, dayRoute(byDay.get(d))))),
    dayNums.length > shown.length ? h('span', { class: 'thp-more' }, `還有 ${dayNums.length - shown.length} 天 ›`) : null);
}

// 出發前：下一班航班（有才放；字跟行程分頁旅途資訊卡那一列一樣），點了到航班頁
function flightRow(tripId) {
  const nf = nextFlight(tripId);
  if (!nf) return null;
  return h('button', { class: 'btn btn-soft btn-block th-flight', onclick: () => navigate(`/trip/${tripId}/flights`) },
    `✈️ 航班・${nf.flightNo ? nf.flightNo + ' ' : ''}${flightCountdown(nf)}`);
}

// 同步的旅程、還沒說「我是誰」→ 提示（點一下就好，非強制）
// 還沒說「這是誰的手機」→ 旅伴那邊會看到你「還沒加入」，而且你開了位置分享也
// 傳不出去（v1.63/v1.64 實機踩過：建立者從來沒走過這一步）。原本是一顆軟性按鈕，
// 實機回報「被忽略了」；改成講清楚後果的提示卡。**不用彈窗**——彈窗會蓋住別的
// 對話框，900 毫秒後突然跳出來對長輩也不友善。v1.84.0 從任務頁搬到主頁（通知那一格）。
function claimNudge(tripId, t, members) {
  if (!(store.getRaw(t.groupId)?.syncSecret && !activeMemberId(tripId) && members.length > 1)) return null;
  return h('div', { class: 'claim-nudge' },
    h('div', { class: 'claim-nudge-t' }, '👋 旅伴還看不到你'),
    h('p', { class: 'claim-nudge-p' }, '先告訴大家「這是誰的手機」，你拍的照片才會算在你名下，旅伴也才看得到你已經加入。'),
    h('button', {
      class: 'btn btn-primary btn-block',
      onclick: async () => { const got = await ensureMember(tripId, { force: true }); if (got) toast('好了，旅伴現在看得到你了'); refreshPage(); },
    }, '選擇我是誰'));
}

// ---------- 主頁（v1.84.0）----------
// Yolin 2026-11-13：「會有一個主頁，可以很直覺的看到這些提示以及導航到下一站」→ 選方案二、改兩處
// （主頁不放任務的跳轉；回顧搬去行程分頁），之後「可以 都照建議做」＝docs/DESIGN_主頁規劃.md 第 5 節（示意圖 4、5）。
// 主頁只講「現在」：通知（一次一張）→ 出發倒數／今天第幾天 → 天氣條 → 下一站（帶我去、換一站）→ 小工具。
// 旅程結束後（結束日 23:59:59 過了）：旅程結束了＋去看回顧 → 小工具。沒有天氣、沒有下一站。
// 任務的數字與拍照在「任務」分頁。舊位置 → 新位置的對照表在 STATUS。
export async function tripHome(tripId, { fresh = false, drawPage, setTop } = {}) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({
    title: t.title,
    action: { icon: '⚙️', label: '旅程設定', short: '設定', onClick: () => navigate(`/trip/${tripId}/settings`) },
  });
  const spots = store.spotsOf(tripId);
  const members = store.membersOf(t.groupId);
  const prog = store.tripProgress(tripId);
  const allDone = prog.total > 0 && prog.done === prog.total;
  const ended = tripEnded(t);
  const todayDay = dayForToday(t);
  // 出發倒數：只在「還沒出發」時出現；沒設出發日就不出現（不顯示 0、不猜）
  const cd = countdownText(t.startDate, t.endDate);

  // 通知一次只放一張、放最上面：有人新加入 > 旅伴還看不到你（規劃「會讓主頁太長的東西」那一節）
  const note = joinBanner(tripId, members) || claimNudge(tripId, t, members);

  const goMem = () => navigate(`/trip/${tripId}/memories`);
  let main = null;
  if (!spots.length) {
    main = h('div', { class: 'empty th-empty' }, h('p', {}, '這個旅程還沒有景點'),
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/trip/${tripId}/plan`) }, '＋ 去安排景點'));
  } else if (ended) {
    // 旅程結束後：合成一張（原本進度卡「全部完成了」跟回顧大按鈕同一句話講兩次）
    // v1.86.0「拍了 N 張照片」搬到下面「這趟的數字」（同一個數字不講兩次）；卡上只留任務數
    const stats = [prog.total ? `完成 ${prog.done} / ${prog.total} 個任務` : null].filter(Boolean);
    main = h('section', { class: 'th-end' },
      h('div', { class: 'th-end-t' }, '🎁 旅程結束了'),
      // 每一段自己不換行（layouttest 抓到：320／360px 寬時「拍了 51」換行「張照片」，數字和量詞被拆開）；要換行只換在「・」後面
      stats.length ? h('div', { class: 'th-end-s' }, ...stats.flatMap((s, i) => [i ? '・' : null, h('span', { class: 'th-end-part' }, s)])) : null,
      h('button', { class: 'btn btn-primary btn-block btn-big th-end-go', onclick: goMem }, '去看回顧與回憶影片'));
  } else {
    // 下一站卡；全部拍完了（又沒指定現在這一站）就沒有下一站——換成「全部完成」那一張，回顧影片這時已經開放
    main = todayCard(tripId, t) || (allDone ? h('section', { class: 'th-end' },
      h('div', { class: 'th-end-t' }, '🎉 任務全部完成了'),
      h('button', { class: 'btn btn-primary btn-block btn-big th-end-go', onclick: goMem }, '去看回顧與回憶影片')) : null);
  }
  // 「旅程結束了」「任務全部完成了」那張卡：小鳳打領結從卡片上緣探頭、揮翅膀（v1.85.0 新的出場處；圖載不到：卡片照樣出）。
  // 只有真的導覽到主頁（fresh）才動；主頁自己重畫（現在在哪一站變了、AI 文案回來）時停在靜止圖，不會每重畫一次就再跳一次。
  // 0.3＝顯示縮放（畫布 1 單位畫成幾 px）：比天氣頁的提醒卡小一點，卡片上面空出來的高度少一些（主頁一打開就要看到這張卡）
  if (main && main.classList.contains('th-end')) {
    const pk = await import('../peeks.js').catch(() => null);
    if (pk) {
      const el = pk.peek(pk.DONE_PEEK, 0.3);
      mountPeek(main, el);
      if (fresh) pk.cheer(el, { soft: true });
    }
  }

  // v1.86.0 主頁補內容（守夜模式照建議做；決定與替代方案見 STATUS）。都是「有才放」，沒有的不放、不顯示 0、不猜；不放任務的跳轉。
  //   結束後：這趟的數字（天數・景點・照片・花費）；出發前：每天的行程預覽＋下一班航班；照片列：有照片就有（不分哪個階段）
  const shotsSlot = spots.length ? h('div', { class: 'th-shots-slot' }) : null;
  const page = h('div', { class: 'page trip-home' },
    note,
    cd ? h('div', { class: 'countdown', role: 'status' },
      h('span', { class: 'cd-big' }, cd),
      h('span', { class: 'cd-sub' }, rangeLabel(t.startDate, t.endDate))) : null,
    todayDay > 0 ? h('div', { class: 'th-day' },
      h('span', { class: 'th-day-n' }, `今天是第 ${todayDay} 天`),
      t.startDate ? h('span', { class: 'th-day-d' }, `${dayDate(t, todayDay)} ${weekdayLabel(t.startDate, todayDay)}`.trim()) : null) : null,
    main,
    ended && spots.length ? endNums(tripId, t, spots) : null,
    todayDay === 0 && spots.length ? planPreview(tripId, t, spots) : null,
    todayDay === 0 ? flightRow(tripId) : null,
    // 今晚住（旅程沒結束才有；今天落在某一間住宿的日期裡才有）
    ...(ended ? [] : tonightStays(tripId).map((s) => h('a', {
      class: 'th-stay', href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.address || s.name)}`,
      target: '_blank', rel: 'noopener',
    },
      h('span', { class: 'th-stay-t' }, `🛏️ 今晚住：${s.name}`),
      s.address ? h('span', { class: 'th-stay-s' }, s.address) : null))),
    // 出發前：待買還剩幾項（規劃 5.1「出發前」；0 項或沒有清單就不出現），點了到待買清單（行程分頁裡）
    cd && buyCounts(tripId).left > 0 ? h('button', { class: 'btn btn-soft btn-block th-buy', onclick: () => navigate(`/trip/${tripId}/buy`) },
      `🛒 待買還有 ${buyCounts(tripId).left} 項沒買`) : null,
    // 照片列（背景載縮圖，fillShots 填進來；一張都載不到就是空的）
    shotsSlot,
    // 結束後：還有幾筆帳沒結清（背景算，fillUnsettled 填進來；結清了就是空的）
    ended ? h('div', { class: 'th-money-slot' }) : null,
    // 小工具：找附近、旅伴、（結束後）照片、位置分享（分享中才有；分享期過了自己不顯示，見 posBanner）
    h('div', { class: 'stack th-tools' },
      h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/nearby`) }, '🅿️ 找附近：停車場・廁所・超商'),
      members.length ? crewButton(tripId, t, members) : null,
      ended ? h('button', { class: 'btn btn-soft btn-block th-photos', onclick: () => navigate(`/trip/${tripId}/people`) }, '📸 看大家的照片') : null,
      posBanner(tripId)),
  );

  // 天氣條（有座標景點、旅程還沒結束才有；背景載入）：放在下一站卡上面（第幾天那一行下面）
  if (spots.some((s) => s.lat != null) && !ended) {
    const wxSlot = h('div', { class: 'wx-slot' });
    page.insertBefore(wxSlot, main && main.parentNode === page ? main : page.querySelector('.th-tools'));
    fillWeather(wxSlot, page, tripId, t);
  }

  const moneySlot = page.querySelector('.th-money-slot');
  if (moneySlot) fillUnsettled(moneySlot, tripId, t);
  if (shotsSlot) fillShots(shotsSlot, tripId);

  drawPage(page);
  watchHere(tripId);
  import('../outbox.js').then((o) => o.refreshNow()).catch(() => {});
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
    localStorage.removeItem('tripquest.daySel.' + tripId);   // 日期列回到新那一站所在的那一天
  } catch { /* noop */ }

  // 帶上是誰改的。離線也會先在本機生效，outbox 會在連線恢復後推出去。
  const meId = activeMemberId(tripId);
  const actor = { id: meId, name: (meId && store.getRaw(meId)?.displayName) || myName() || '' };

  if (res === 'auto') { await store.clearHereSpot(tripId, actor); toast('改成自動照順序'); }
  else { await store.setHereSpot(tripId, res, actor); toast(`現在這一站：${store.get(res)?.name || ''}`); }
  // 不傳 fresh：選完通常是接著要點導航，畫面這時候跳走反而礙事。
  // 自動捲動留到「下一次重新打開這趟行程」再做。
  refreshPage();
}

// 今天是這趟的第幾天：0 = 還沒開始、-1 = 已結束、null = 沒設日期、正整數 = 進行中
function dayForToday(t) {
  const p = tripPhase(t.startDate, t.endDate);
  return { none: null, before: 0, after: -1, during: p.day }[p.phase];
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

// 日期列：所有天數排成一列、一直看得到（不是下拉選單、也不是上一天／下一天的箭頭——
// 那兩種會把「這趟有幾天」藏起來，長輩不知道還有別天）。天數多時橫向捲，選中的那格會捲進畫面。
function dayStrip(dayNums, byDay, t, { todayDay, sel, onPick, overview = false }) {
  const cells = new Map();
  // 第 0 格＝總覽（整趟所有天畫在同一張地圖；Yolin 2026-11-05 選 A）。放最前面：它是「全部」，各天是它的細目。
  if (overview) {
    cells.set(0, h('button', { class: 'ds-day ds-all', dataset: { day: '0' }, 'aria-label': `總覽，全部 ${dayNums.length} 天的地圖`, onclick: () => onPick(0) },
      h('span', { class: 'ds-num' }, '總覽'),
      h('span', { class: 'ds-sub' }, `全部 ${dayNums.length} 天`)));
  }
  for (const d of dayNums) {
    const dp = dayProgress(byDay.get(d));
    const done = dp.total > 0 && dp.done === dp.total;
    const dstr = dayDate(t, d);
    const wk = weekdayLabel(t.startDate, d);
    const isToday = todayDay === d && todayDay > 0;
    // 2026-11-05 Yolin：日期列不列站名（原本第三行是當天第一站）。讀屏的 aria-label 照樣念得到第一站。
    const first = dayRoute(byDay.get(d).slice(0, 1));
    cells.set(d, h('button', {
      class: 'ds-day' + (isToday ? ' is-today' : '') + (done ? ' done' : ''),
      dataset: { day: String(d) },
      'aria-label': `第 ${d} 天${dstr ? '，' + dstr + (wk ? ' ' + wk : '') : ''}${isToday ? '，今天' : ''}${first ? '，從' + first + '開始' : ''}${done ? '，全部完成' : ''}`,
      onclick: () => onPick(d),
    },
      h('span', { class: 'ds-num' }, `第 ${d} 天`),
      // 2026-11-05 Yolin 挑版本一：「第 N 天」大字＋小字日期，**不顯示星期**（讀屏的 aria-label 照樣念星期）
      h('span', { class: 'ds-sub' }, isToday ? '今天' : (dstr || (done ? '✓ 完成' : `${byDay.get(d).length} 站`))),
    ));
  }
  // 紙飛機（原創圖形，js/glyphs.js）：停在選中那一格正上方、機頭朝右（下一天）；換天時飛過去（減少動態時直接跳）
  const plane = h('span', { class: 'ds-plane', 'aria-hidden': 'true' }, paperPlane());
  const el = h('nav', { class: 'daystrip', 'aria-label': `共 ${dayNums.length} 天，選一天看行程` },
    h('div', { class: 'ds-track' }, plane, ...cells.values()));
  const select = (d) => {
    for (const [n, c] of cells) {
      c.classList.toggle('on', n === d);
      c.setAttribute('aria-pressed', String(n === d));
    }
    const c = cells.get(d);
    if (c) plane.style.left = (c.offsetLeft + c.offsetWidth / 2) + 'px';
    // 選中的那一格捲進日期列中央（只捲日期列，不捲整頁）
    if (c && el.isConnected) {
      const tr = el.querySelector('.ds-track');
      const target = c.offsetLeft - (tr.clientWidth - c.offsetWidth) / 2;
      tr.scrollTo({ left: Math.max(0, target), behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
    }
  };
  select(sel);
  // 第一次畫上去時還沒有版面，等掛上之後再把選中那格捲進來。
  // 黏住的位置照標題列**實際**的高度：它是 min-height，還加了 iPhone 瀏海的安全區、字級大時也會長高，
  // 寫死 --topbar-h 的話日期列會滑進標題列底下被蓋住。
  requestAnimationFrame(() => {
    const tb = document.getElementById('topbar');
    if (tb) el.style.top = tb.offsetHeight + 'px';
    select(sel);
  });
  return { el, select };
}

// 「同行夥伴」那一列（每一天時間軸的開頭）v1.86.0 拿掉：旅伴在主頁的旅伴列（crewButton）就看得到、點了有完整清單。

// 當日地圖的照片圖釘：這一站所有任務裡最新的一張投稿（沒照片的投稿不算）
function latestSpotSub(s) {
  const qids = new Set(store.questsOf(s.id).map((q) => q.id));
  return store.submissionsOfTrip(s.tripId)
    .filter((x) => qids.has(x.questId) && (x.thumbHash || x.photoHash))
    .sort((a, b) => (b.takenAt || b.createdAt || 0) - (a.takenAt || a.createdAt || 0))[0] || null;
}

// 「天」這一層：v1.74.11 起是日期列選中的那一天（class open ＝ 正在顯示），景點排成時間軸
// v1.86.0 拿掉天的標題卡（第 N 天／今天／第一站 → 最後一站／日期・N 個景點・完成 x/y／天氣摘要），各東西的新位置：
//   第 N 天與日期 → 上面的日期列（選中的那一格；只有一天的旅程沒有日期列，也就沒有天的字——只有一天不用分）；
//   第一站 → 最後一站、景點數 → 行程分頁每天的標題（本來就有）；天氣摘要 → 主頁的天氣條＋天氣頁；
//   完成 x/y → 任務頁最上面那一行（整趟的）；日期列那一格全部完成照舊打勾、讀屏念「全部完成」。對照表在 STATUS。
function dayCollapse(day, daySpots, tripId, t, ctx) {
  const open = !!ctx.open;
  const isToday = ctx.todayDay === day && ctx.todayDay > 0;
  const states = timelineStates(daySpots.map((s) => s.id), { live: isToday, nowId: ctx.focusId });

  return h('section', { class: 'daycollapse' + (open ? ' open' : ''), dataset: { day: String(day) } },
    h('div', { class: 'dc-body' },
      h('div', { class: 'dc-inner' },
        // 當日地圖（查看路線）2026-11-13 搬到「行程」分頁（itinerary() 的 dayMap()）：它畫的是計畫中的景點，屬於行程。
        // 時間軸：左邊一條虛線、每站一個點；有填時間的在那一站卡片上方寫幾點，沒填就只有點（不補猜的時間）。
        // 進行中而且看的是今天，才分「已到／現在／未到」（現在這一站之後的淡一點）；其餘不分，不猜他走到哪。
        // 兩站之間一列「怎麼去」（js/legs.js）：就放在兩張卡中間，看行程時一眼就看到、點了就能設——不藏在編輯頁。
        legTimeline(daySpots, (s) => h('li', { class: 'tl-item' + (states[s.id] ? ' tl-' + states[s.id] : '') },
            h('span', { class: 'tl-time' }, spotTimes(s).startTime || ''),
            h('span', { class: 'tl-dot', 'aria-hidden': 'true' }),
            spotSection(s, tripId, ctx.focusId, ctx.hereId))))),
  );
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
    // v1.86.0 之前這裡還把每天的天氣摘要塞進任務頁「天」的標題卡；標題卡拿掉了，現在只有主頁呼叫（畫天氣條）

    let hereTemp = null, hereName = '出發地';
    const home = wx.getHome();
    if (home && home.lat != null) { hereTemp = await wx.hereTempNow(home.lat, home.lng); hereName = home.name || '居住地'; }
    else {
      const pos = await geo.currentPosition({ timeout: 5000, maxAgeMs: 900000 }).catch(() => null);
      if (pos) { hereTemp = await wx.hereTempNow(pos.lat, pos.lng); hereName = '你的位置'; }
    }
    const tips = wx.buildAdvice({ dest: { elevation: f.elevation }, destDays: days, hereTemp, hereName });
    // 「那一天」會下雨／下雪（旅程中看今天、還沒出發看出發那天）：提示那一行換成那一天、有數字的一句（全部的提醒在天氣頁）。
    // 2026-11-13 第四段，Dispatch 定 A：只用這裡本來就有的預報，不多送任何資料。
    // 天氣條上不放探頭圖、也不加高（Yolin 2026-11-13：任務頁東西一多，任務就被擠到下面）；探頭圖只在天氣頁的出門提醒卡。
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const alert = wx.dayAlert(trip, days, today);

    const btn = h('button', {
      class: 'wx-strip', onclick: () => navigate(`/trip/${tripId}/weather`),
    },
      h('div', { class: 'wx-strip-days' }, ...days.slice(0, 5).map((d) => h('span', { class: 'wx-strip-day' },
        h('span', {}, d._tripDay ? `D${d._tripDay}` : (d.date.slice(5).replace('-', '/'))),
        h('span', { class: 'wx-strip-ic' }, wx.wxIcon(d.code)),
        h('span', { class: 'wx-strip-t' }, `${d.tmax}°`),
      ))),
      alert
        ? h('div', { class: 'wx-strip-tip', 'data-wx': alert.kind }, alert.text)
        : tips.length
          ? h('div', { class: 'wx-strip-tip' }, '🧳 ' + tips[0].text)
          : h('div', { class: 'wx-strip-tip muted' }, '天氣還算舒服，點看每天預報'),
    );
    slot.replaceChildren(btn);
  } catch { /* 靜默：天氣是加分項 */ }
}

// 兩站之間「怎麼去」的那一列。prev＝現在排在前面的那一站；顯示與否完全交給 legModeOf：
// 記下的前一站不是現在這一站（重排、刪站、換天）就當成沒設定——舊選擇不套到沒人選過的路段上。
// 沒設定就寫「還沒設定」，不預選任何一種（不拿最常見的去填）。
// 2026-11-13 同類合成一張卡（風格提案第 9 項）：航班、住宿、待買三列放同一張卡，每列一顆按鈕（≥56px，觸控底線沒動）。
// 每列的字跟原本那三顆按鈕一樣（2026-11-05 投票：有東西才寫數量，沒有就只寫名字，不寫 0）。
function infoCard(tripId) {
  const nf = nextFlight(tripId);
  const flSub = nf ? `・${nf.flightNo ? nf.flightNo + ' ' : ''}${flightCountdown(nf)}` : (flightsOf(tripId).length ? `・${flightsOf(tripId).length} 段` : '');
  const { total, left } = buyCounts(tripId);
  const buySub = total === 0 ? '' : (left === 0 ? '・全部買齊了' : `・還有 ${left} 項沒買`);
  const n = staysOf(tripId).length;
  // 右邊的「›」用偽元素畫（css .info-row::after）：按鈕的字照舊是「✈️ 航班・…」，讀螢幕的軟體也不會多念一個符號
  const row = (cls, name, sub, path) => h('button', { class: 'info-row ' + cls, type: 'button', onclick: () => navigate(`/trip/${tripId}/${path}`) },
    h('span', { class: 'info-name' }, name), sub ? h('span', { class: 'info-sub' }, sub) : null);
  return h('div', { class: 'info-card' },
    row('fl-entry', '✈️ 航班', flSub, 'flights'),
    row('stay-entry', '🏨 住宿', n ? `・${n} 間` : '', 'stays'),
    row('buy-entry', '🛒 待買清單', buySub, 'buy'));
}

// 當日地圖（查看路線；js/realmap.js）：有座標的站才畫得上去，沒座標的在圖下列出來；沒網路退回示意圖（js/daymap.js）。
// 2026-11-13 從任務頁搬到「行程」分頁。
function dayMap(daySpots, tripId, day) {
  return dayRealMap(daySpots, (s) => spotTimes(s).startTime || '', {
    playKey: `${tripId}:${day}`,   // 播放中整頁重畫（同步進來）時，新畫出來的播放器接著播
    hasPhoto: (s) => !!latestSpotSub(s),
    // 縮圖優先（同步保證會到的那一份），拿不到再試全圖；都拿不到回空字串 → 圖釘維持圓點
    photoOf: async (s) => { const sub = latestSpotSub(s); return sub ? ((await blobURL(sub.thumbHash)) || (await blobURL(sub.photoHash))) : ''; },
  });
}

function legRow(prev, s, i) {
  const cur = legModeOf(prev, s);
  const name = (x) => x.name || '（沒有名字）';
  const label = cur ? `${LEG_ICON[cur] ? LEG_ICON[cur] + ' ' : ''}${LEG_LABEL[cur]}` : '怎麼去：還沒設定';
  const pick = h('div', { class: 'tl-leg-pick', role: 'group', 'aria-label': `第 ${i} 站到第 ${i + 1} 站怎麼去` });
  pick.hidden = true;
  const save = async (k) => {
    await store.patch(s.id, k ? { legFrom: prev.id, legMode: k } : { legFrom: null, legMode: null });
    refreshPage();
  };
  // 2026-11-11 Yolin 選 A：點開後是兩欄格子，最上面一行寫「甲 → 乙 怎麼去？」；每格圖示在上、名字在下（名字一律一行，見 css）。
  // 顯示的名字（LEG_LABEL）與存進去的代號（dataset.mode／save(k)）是兩件事：改名只動 LEG_LABEL，代號一律用 k。
  // 「其他」沒有圖示，也放一個空的圖示位，名字才跟別格對齊。
  pick.append(h('div', { class: 'tl-leg-ttl' }, `${name(prev)} → ${name(s)} 怎麼去？`));
  pick.append(...LEG_MODES.map((k) => h('button', {
    class: 'tl-leg-opt' + (k === cur ? ' is-on' : ''), type: 'button', dataset: { mode: k }, 'aria-pressed': String(k === cur),
    onclick: () => save(k),
  }, h('span', { class: 'tl-leg-ic', 'aria-hidden': 'true' }, LEG_ICON[k] || ''), h('span', { class: 'tl-leg-name' }, LEG_LABEL[k]))));
  // 「清除」只在選過的時候才有（沒選過就沒東西可清）。不能寫成 append(..., cur ? 鈕 : null)：
  // 原生 append() 會把 null 印成文字「null」（h() 會略過 null，append 不會）——2026-11-11 Yolin 截圖就是這樣。
  if (cur) pick.append(h('button', { class: 'tl-leg-opt tl-leg-clear', type: 'button', onclick: () => save(null) }, h('span', { class: 'tl-leg-name' }, '清除')));
  const btn = h('button', {
    class: 'tl-leg-btn' + (cur ? '' : ' is-unset'), type: 'button', 'aria-expanded': 'false',
    ...(cur ? { dataset: { mode: cur } } : {}),   // 和紙主題照選的方式上色（css .tl-leg-btn[data-mode]）
    'aria-label': `從「${name(prev)}」到「${name(s)}」怎麼去：${cur ? LEG_LABEL[cur] : '還沒設定'}，點一下設定`,
    onclick: () => {
      pick.hidden = !pick.hidden; btn.setAttribute('aria-expanded', String(!pick.hidden));
      if (pick.hidden && flushHere) flushHere();     // 收起來：選項開著時擋下的背景重畫補上（見 watchHere 上面）
    },
  }, label, h('span', { class: 'tl-leg-chev', 'aria-hidden': 'true' }, ' ▸'));
  // 選了交通方式才多一行「甲 → 乙」（錄影那批：站與站之間一行交通）。放在按鈕外面，按鈕的字不變。
  // 分鐘數只在走路／開車、而且路線服務真的算出來（src 'osrm'）時才補上（fillLegMinutes）；
  // 電車、公車、船、飛機沒有班次資料——不拿開車時間冒充，就不寫分鐘。
  const route = cur ? h('div', { class: 'tl-leg-route' },
    h('span', { class: 'tl-leg-ends' }, `${name(prev)} → ${name(s)}`),
    h('span', { class: 'tl-leg-min', dataset: { from: prev.id, to: s.id, mode: cur } })) : null;
  return h('li', { class: 'tl-leg', dataset: { spot: s.id, mode: cur || '' } }, btn, route, pick);
}

function legTimeline(daySpots, item) {
  const ol = h('ol', { class: 'timeline' }, ...daySpots.flatMap((s, i) => [i > 0 ? legRow(daySpots[i - 1], s, i) : null, item(s)]).filter(Boolean));
  queueMicrotask(() => { fillLegMinutes(ol, daySpots).catch(() => {}); });
  return ol;
}

// 走路／開車那幾段補「約 N 分鐘」。一天一種方式一次路線矩陣（route.js 有快取與節流）；
// 降級成直線估算（src 'est'）就不寫——那是猜的。跨區長途也不寫。
const LEG_ROUTE_MODE = { walk: 'walk', car: 'drive' };
async function fillLegMinutes(ol, daySpots) {
  const slots = [...ol.querySelectorAll('.tl-leg-min')].filter((x) => LEG_ROUTE_MODE[x.dataset.mode]);
  if (!slots.length) return;
  let route;
  try { route = await import('../route.js'); } catch { return; }
  const placed = daySpots.filter((s) => s.lat != null && s.lng != null);
  const at = new Map(placed.map((s, i) => [s.id, i]));
  for (const mode of new Set(slots.map((x) => LEG_ROUTE_MODE[x.dataset.mode]))) {
    const mine = slots.filter((x) => LEG_ROUTE_MODE[x.dataset.mode] === mode && at.has(x.dataset.from) && at.has(x.dataset.to));
    if (!mine.length || placed.length < 2) continue;
    let m;
    try { m = await route.travelMatrix(placed.map((s) => ({ lat: s.lat, lng: s.lng })), mode); } catch { continue; }
    if (!m || m.src !== 'osrm' || !ol.isConnected) continue;
    for (const x of mine) {
      const a = placed[at.get(x.dataset.from)], b = placed[at.get(x.dataset.to)];
      const sec = m.sec[at.get(x.dataset.from)][at.get(x.dataset.to)];
      if (!Number.isFinite(sec) || route.longHaul(a, b, sec)) continue;
      x.textContent = `約 ${route.fmtDur(sec)}`;
      x.title = mode === 'walk' ? '路線服務算的步行時間' : '路線服務算的開車時間（不含塞車）';
    }
  }
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
  // 沒有焦點（全完成／旅程已結束）就全部收合。**沒有任務的地點例外**：它收合起來
  // 就只剩一行名字，「＋ 新增任務」與加照片兩個入口全被藏在裡面（v1.74 實機看到）。
  const dflt = isFocus || quests.length === 0;
  let open = dflt;
  try {
    const stored = localStorage.getItem(openKey);
    if (stored === '1') open = true;
    else if (stored === '0') open = false;
  } catch { /* noop */ }

  // 照名字猜的類別只拿來挑顏色（顏色是裝飾、不主張「這是什麼地方」，Dispatch 2026-10-27）；
  // 寫成字的只有可信類別（trustedTheme：從景點庫重算，不看存著的 s.theme——存著的也是猜的，2026-10-27 查到）
  const tk = s.theme || themeForSpot(s);
  const tm = themeMeta(tk);
  const trusted = trustedTheme(s, placeLookupSync()).key;
  const shown = trusted ? themeMeta(trusted) : null;
  const when = spotTimes(s).label;
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
          // 從行程表匯入的才有時間；時間與類別都沒有就整行不放
          (when || shown) ? h('span', { class: 'qc-theme' },
            when ? '🕘 ' + when + (shown ? ' · ' : '') : '',
            shown ? shown.emoji + ' ' + shown.label : '') : null,
          // 使用者自己標的（不是猜的）：只在 === true 時顯示，沒標就什麼都不寫
          (s.important === true || s.booked === true) ? h('span', { class: 'qc-tags' },
            s.important === true ? h('span', { class: 'qc-tag tag-important' }, '⭐ 重要') : null,
            s.booked === true ? h('span', { class: 'qc-tag tag-booked' }, '✅ 訂好位') : null) : null),
        // 進度與箭頭包成一組：一列放不下時整組折到第二行，不會只掉一個箭頭在左下角
        h('span', { class: 'qc-side' },
          h('span', {
            class: 'qc-prog' + (allDone ? ' done' : (p.done ? ' part' : '')),
          }, p.total ? (allDone ? '✓ 完成' : `${p.done}/${p.total}`) : '—'),
          chev),
      ),
      spotMapButton(s),
      // 這裡本來有一顆「編輯」，但它會把長輩帶到景點頁 —— 而拍照按鈕在那裡，
      // 於是「編輯」看起來就成了加照片的入口。拍照按鈕現在直接在任務卡上，
      // 景點的改名 / 刪除 / 改任務都集中到「調整每天的行程」。
    ),
    h('div', { class: 'qc-body' }, h('div', { class: 'qc-inner' },
      ...quests.map((q) => questLine(q, s, tk)),
      spotAddRow(s, tripId, quests.length))),
  );
  return sec;
}

async function ensurePhotoQuest(s) {
  const id = photoQuestId(s.id);
  if (store.get(id)) return store.get(id);
  const rec = {
    id, type: 'quest', tripId: s.tripId, spotId: s.id,
    title: `${s.name} 的照片`, hint: '', kind: 'thing', source: 'photo',
    order: store.questsOf(s.id).length, refImage: null,
  };
  await store.put(rec);
  return rec;
}

// 任務列最後（沒有任務時就是整個內容）的兩個入口。
// 以前要新增一個任務得走五步：行程頁 →「調整每天的行程」→ 展開景點 →「✏️ 任務」→「＋ 新增任務」。
// 沒有任務的地點更麻煩：上傳鈕只畫在任務列上，所以它連放照片的地方都沒有。
// 加照片的兩顆只給**沒有任務**的地點：有任務的地點每一列自己就有拍照／從相簿選
// （那是先前定下來不能退讓的一條：加照片要一眼看到、一次點到），再放一組只會把
// 卡片變高 —— 實測一個五個任務的景點會從 657px 變成 719px，densitytest 的門檻是 700。
function spotAddRow(s, tripId, questCount) {
  return h('div', { class: 'qline-add' + (questCount ? '' : ' empty') },
    h('button', {
      class: 'btn btn-soft btn-sm', onclick: async () => {
        const { addQuestDialog } = await import('./plan.js');
        if (await addQuestDialog(tripId, s.id)) refreshPage();
      },
    }, '＋ 新增任務'),
    // 「重要／訂好位」的切換鈕在景點設定頁（2026-11-09 Yolin 選 A）：放這裡卡片超過 densitytest 的 700px；
    // 標好的標籤照樣顯示在這張卡的站名下面。
    // 照片仍然掛在任務底下：第一次選照片時才把中性的照片任務建起來（ensureQuest）
    questCount ? null : addPhotoButtons(tripId, photoQuestId(s.id), {
      compact: true,
      ensureQuest: () => ensurePhotoQuest(s),
      onDone: () => refreshPage(),
    }),
  );
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
// 「還在行程頁本身嗎？」—— 白名單，不是黑名單。
//
// v1.73.6：以前是列出「哪些子頁不要重畫」（spot|plan|poster|weather|people|
// expenses|memories）。那份清單漏了 album，於是在相簿／影片頁選一首配樂
// （store.patch 會 bump trip.updatedAt，正好在 tripSignature 的 maxUp 裡）
// 就會讓行程頁把相簿頁整個畫掉 —— 使用者看到的是「按了音樂就跳回任務頁」。
// 線上逐頁實測，同樣中招的有 7 個：settings / album / findspot / sos /
// nearby / badges / recap。
//
// 黑名單在這裡註定會漏：每加一個子頁就要記得回來補一行，而漏掉的後果是
// 「使用者在那一頁做任何會寫入的事，畫面就被抽掉」。改成問一個不會漏的問題：
// **網址是不是正好就是行程頁本身**（後面沒有東西）。新增子頁不必再回來改。
// 2026-11-13 白名單多一頁：「行程」分頁（itinerary()）。它也畫整趟的資料（航班、住宿、待買、每天的行程），
// 旅伴同步進來要跟著更新；兩頁共用同一個訂閱（watchHere），在兩頁之間切換不退訂，重畫的是當下那一頁。
// v1.84.0 再多一頁：主頁（tripHome）。新旅伴、換了現在這一站、新照片都要跟著更新。
function onTripPage(tripId) {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0].replace(/\/+$/, '');
  return path === `/trip/${tripId}` || path === `/trip/${tripId}/itinerary` || path === `/trip/${tripId}/home`;
}

// 使用者正打開「怎麼去」的選項時，背景來的變動先不整頁重畫（2026-11-11 守夜）。
// 補維基圖片會 store.patch 站點的 heroHash／heroAttr／heroPool（真資料欄位，會推高 updatedAt）→ 上面的簽章變了
// → 整頁重畫，剛點開的選項就被收起來；旅伴同步進來、AI 文案回來也一樣。legviewtest 原樣跑 6 次被這個打斷 5 次，
// 真的使用者也會撞到：剛點開，背景一來就收起來。
// 選項收起來時（再點一次那一列）補做一次；選了某一種的話 save() 自己會重畫，那一次就帶到最新的。
// 只擋「選項開著」這一種：其他會被重畫打斷的操作（例：展開的任務卡）沒有實際回報，這次不擴大。
function legPickOpen() { return !!document.querySelector('.tl-leg-pick:not([hidden])'); }
let hereDirty = false;     // 選項開著時，有東西想重畫（簽章以外的來源，例：AI 文案回來）
let flushHere = null;      // 選項收起來時叫它：剛才擋下的重畫補上

function watchHere(tripId, sig = tripSignature) {
  if (hereWatch) { hereWatch(); hereWatch = null; }
  let last = sig(tripId);
  hereDirty = false;                                 // 這一次畫的就是最新的
  const check = () => {
    if (!onTripPage(tripId)) return;
    const now = sig(tripId);
    if (now === last && !hereDirty) return;
    if (legPickOpen()) { hereDirty = true; return; }  // 先不重畫、last 不動；收起來時 flushHere 再看一次
    last = now;
    hereDirty = false;
    refreshPage();
  };
  hereWatch = store.subscribe(check);
  flushHere = check;
  // 而且離開就退訂 —— 光靠上面那道守衛，訂閱會一直掛著（plan.js 與 sos.js
  // 都有做這件事，只有這裡沒有）。守衛是第二道防線，不是唯一那道。
  const off = () => {
    if (onTripPage(tripId)) return;                 // 只是換了 query／同一頁的話不退
    if (hereWatch) { hereWatch(); hereWatch = null; }
    flushHere = null;
    window.removeEventListener('hashchange', off);
  };
  window.addEventListener('hashchange', off);
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
        .map((r) => r.createdAt || 0),
      // v1.76.0 的讚是一筆會被改的 like（換表情、收回），最後活動時間看 updatedAt
      ...recs.filter((r) => r.type === 'like' && r.actorId === m.id && r.tripId === tripId).map((r) => r.updatedAt || r.createdAt || 0));
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
    // 有東西是「再也送不出去」的 → 不能繼續顯示「正在上傳」（那會永遠轉下去）。
    // 這是使用者唯一會看到這件事的地方，所以要說原因，也要說他該做什麼（v1.73.1）。
    if (st && st.dead && !n) {
      clearInterval(timer);
      el.hidden = false; shown = true;
      el.classList.add('done'); el.querySelector('.spinner')?.remove();
      line.textContent = st.deadBlobs
        ? `⚠️ 有 ${st.deadBlobs} 張照片傳不出去（${st.deadWhy}）—— 這幾張只存在這支手機，移除旅程前請先「匯出完整備份」`
        : `⚠️ 這趟的資料傳不出去（${st.deadWhy}）—— 旅伴看不到你這邊的更新`;
      return;
    }
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
  // 任務列只標「我按過」、不放數字（Yolin 2026-11-10 第 4 題）：一列可能有好幾張照片，加總的數字容易被讀錯
  const meId = activeMemberId(q.tripId);
  const iLiked = !!meId && subs.some((s) => store.likesOf(s.id, meId).mine);
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
          iLiked ? h('span', { class: 'qline-likes' }, '❤️ 我按過') : null,
          subs.length ? h('button', {
            class: 'qline-link', onclick: () => navigate(`/quest/${q.id}`),
          }, `看照片（${subs.length} 張）`) : null,
        ),
        addPhotoButtons(q.tripId, q.id, { compact: true, onDone: () => refreshPage() }),
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
        // 「1 張」包成不斷行的一段：qty 用的是不換行空白，但 .qline-sub 有 overflow-wrap:anywhere，
        // 擠的時候照樣會在「1」與「張」之間斷開（layouttest bad-wrap，320px 大字）
        ...(done ? ['✓ 已完成　', h('span', { class: 'qline-qty' }, qty(subs.length, '張'))] : ['還沒拍']),
        iLiked ? '　❤️' : ''),
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
      addPhotoButtons(q.tripId, q.id, { icons: true, onDone: () => refreshPage() })),
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
  // 永久失敗的上傳以前完全不擋（pendingOf 排除了 dead）—— 那些照片只存在這台手機，
  // 移除就是硬刪、永久消失。但叫他「等上傳跑完」是一個他永遠做不到的指示，
  // 所以這一支要講真話、給一條真的走得通的路（v1.73.1）。
  if (pending.dead) {
    const go = await modal({
      title: '有照片一直傳不出去',
      body: h('div', {},
        h('p', {}, pending.deadBlobs
          ? `有 ${pending.deadBlobs} 張照片送不到旅伴那邊（${pending.deadWhy}），再等也不會成功。`
          : `這趟的資料送不到旅伴那邊（${pending.deadWhy}），再等也不會成功。`),
        h('p', {}, '這幾張只存在這台手機。現在移除的話就沒有了，而且救不回來。'),
        h('p', { class: 'form-hint' }, '建議先按行程頁下面的「⬇️ 匯出完整備份（含照片）」，把照片留在手機或雲端硬碟，再回來移除。')),
      actions: [{ label: '先去匯出', value: false }, { label: '我知道，還是移除', value: true, danger: true }],
    });
    if (!go) return;
  }
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
  const keys = ['me', 'welcome', 'claimseen', 'poshare', 'wall', 'focus', 'here', 'daySel', 'dayJump'].map((k) => `tripquest.${k}.${tripId}`);
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
      refreshPage();                                     // 行程頁的常駐指示要跟著變
    });
    mount(box,
      h('div', {},
        h('div', { style: 'font-weight:700' }, '📍 讓家人看到我在哪'),
        h('div', { class: 'form-hint' }, on
          ? (pos.shareEnded(t)
            ? '這趟旅行已經結束，不會再傳出你的位置。'   // 開關還開著，但分享期過了、已經不送（跟行程頁橫幅同一條判斷）
            : '分享中：家人在「緊急求助」頁看得到你最後的位置。隨時可以關。')
          : '預設關閉。走失時家人可以看到你最後一次打開 App 的位置，只在這趟旅行期間。')),
      cb);
  };
  draw();
  return box;
}

// 分享中的常駐指示 —— 長輩的手機常是子女設定的，這一條是手機主人唯一會看到的提醒。
// 分享期過了（pos.shareEnded：結束日的隔天也過完）就不顯示：那時已經不送位置，開關還開著也不能說「正在分享」。
function posBanner(tripId) {
  if (!pos.sharing(tripId) || pos.shareEnded(store.get(tripId))) return null;
  return h('div', { class: 'pos-banner' },
    h('span', {}, '📍 正在跟旅伴分享你的位置'),
    h('button', {
      class: 'pos-banner-off',
      onclick: async () => { await pos.setSharing(tripId, false); toast('已停止分享'); refreshPage(); },
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
// 2026-11-13「行程」分頁（Yolin 11-11 提、11-13 守夜做；決定與替代方案見 STATUS）。
// 放：航班／住宿／待買（合成一張卡）、調整每天的行程、每天的行程（時間、兩站之間怎麼去、當天地圖＝查看路線）。
// 「怎麼去」在任務頁也有一份（Yolin 11-12：留在任務頁、行程頁也顯示）——兩邊是同一個 legRow，改哪一邊都存同一筆。
// 回顧（v1.84.0 從底部分頁搬進「行程」分頁；Yolin 2026-11-13「都照建議做」＝規劃第 5.2 節、示意圖 6）。
// 換位置只看結束日（結束日 23:59:59 過了，跟回顧頁開放影片同一條 tripEnded）——不看「全部拍完」：
// 提早拍完、旅程還沒結束時，行程分頁還要看今天去哪，不能被回顧擠下去。沒設結束日 → 一直在最下面那一列。
// 回顧頁本身（memories.js：成就、影片、海報、最終回顧）沒動，改的只是入口放哪。
function myBadgeCount(tripId, t) {
  const me = activeMemberId(tripId) || (store.membersOf(t.groupId)[0] || {}).id;
  return me ? earnedBadges(tripId, me).length : null;
}
function memoriesCard(tripId, t, ended) {
  const n = myBadgeCount(tripId, t);
  const badgeTxt = n == null ? '成就徽章' : `成就 ${n} 個`;
  if (!ended) {
    // 出發前、旅程中：最下面一列，不搶位置。全部拍完時影片照樣開放（memories.js 的 ready），這一列照實寫
    const prog = store.tripProgress(tripId);
    const allDone = prog.total > 0 && prog.done === prog.total;
    return h('button', { class: 'itin-mem-row', type: 'button', onclick: () => navigate(`/trip/${tripId}/memories`) },
      h('span', { class: 'imr-title' }, '🎁 回顧與成就'),
      h('span', { class: 'imr-sub' }, `${badgeTxt}・${allDone ? '回憶影片可以做了' : '影片與最終回顧旅程結束後開放'}`));
  }
  // 結束日過了：排到最上面，三個成品入口＋成就（卡片跟回顧頁同一個樣子）
  const card = (emoji, title, sub, path) => h('button', { class: 'mem-card', type: 'button', onclick: () => navigate(`/trip/${tripId}/${path}`) },
    h('span', { class: 'mem-card-emoji' }, emoji),
    h('span', { class: 'mem-card-body' }, h('span', { class: 'mem-card-title' }, title), h('span', { class: 'mem-card-sub' }, sub)),
    h('span', { class: 'mem-card-arrow' }, '›'));
  return h('section', { class: 'itin-mem', 'aria-label': '這趟的回顧' },
    h('div', { class: 'section-label' }, '🎁 這趟的回顧'),
    card('🎬', '回憶影片與相簿', '做成短片，或產生一個給家人看的相簿網址', 'album'),
    card('🎁', '最終回顧', '走了多遠、吃了哪些、每個人的貢獻…一份成果報告', 'recap'),
    card('🎨', '行程海報', '把行程排成一張手繪水彩風的長圖，傳 LINE 或列印', 'poster'),
    h('button', { class: 'itin-mem-row', type: 'button', onclick: () => navigate(`/trip/${tripId}/memories`) },
      h('span', { class: 'imr-title' }, `🏅 ${badgeTxt}`),
      h('span', { class: 'imr-sub' }, '大家的表現與全部回顧')));
}

export async function itinerary(tripId, { drawPage, setTop } = {}) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: t.title, action: { icon: '⚙️', label: '旅程設定', short: '設定', onClick: () => navigate(`/trip/${tripId}/settings`) } });
  const spots = store.spotsOf(tripId);
  const byDay = new Map();
  for (const s of spots) { const d = s.day || 1; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(s); }
  const ended = tripEnded(t);
  // v1.86.0 最上面一排「行程｜回顧」（守夜模式照建議做；決定與替代方案見 STATUS）。
  // 預設：結束日過了 → 回顧；其餘（出發前、旅程中、沒設結束日、全部拍完但還沒結束）→ 行程。只看結束日，跟原本回顧排到最上面同一條。
  // 記住剛剛看哪一格：sessionStorage（重畫、返回、切分頁回來都停在那一格；關掉 App 再開回到預設）。
  // 存的時候連「當時結束了沒」一起存：旅程中切去看回顧，結束日一過，下一次照新的預設（回顧），不沿用舊的。
  // 不用 localStorage：旅程中點過一次回顧，之後每次打開都落在回顧，會找不到今天的行程。
  const tabKey = 'tripquest.itinTab.' + tripId;
  const phase = ended ? '1' : '0';
  let tab = ended ? 'mem' : 'plan';
  try {
    const raw = sessionStorage.getItem(tabKey) || '';
    const [p, v] = raw.split(':');
    if (p === phase && (v === 'plan' || v === 'mem')) tab = v;
  } catch { /* noop */ }
  const planPane = h('div', { class: 'itin-pane', id: 'itin-pane-plan', role: 'tabpanel', 'aria-label': '行程' });
  const memPane = h('div', { class: 'itin-pane', id: 'itin-pane-mem', role: 'tabpanel', 'aria-label': '回顧' });
  const segBtn = (key, label, pane) => h('button', { type: 'button', role: 'tab', 'aria-controls': pane.id, dataset: { tab: key }, onclick: () => show(key) }, label);
  const seg = h('div', { class: 'seg itin-seg', role: 'tablist', 'aria-label': '行程或回顧' },
    segBtn('plan', '行程', planPane), segBtn('mem', '回顧', memPane));
  const page = h('div', { class: 'page itin-page' + (ended ? ' is-ended' : '') }, seg, planPane, memPane);
  // 兩格各自第一次顯示時才建：地圖、日期列的紙飛機要量尺寸，藏著（display:none）的時候量不到
  const built = new Set();
  function show(key) {
    for (const b of seg.querySelectorAll('button')) {
      const on = b.dataset.tab === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    planPane.hidden = key !== 'plan';
    memPane.hidden = key !== 'mem';
    try { sessionStorage.setItem(tabKey, `${phase}:${key}`); } catch { /* noop */ }
    if (built.has(key)) return;
    built.add(key);
    if (key === 'plan') buildPlan(); else buildMem();
  }
  // 回顧那一格：結束日過了＝三個成品入口＋成就（memoriesCard 的卡片）；還沒結束＝那一列（影片什麼時候開放照實寫）
  function buildMem() {
    memPane.append(memoriesCard(tripId, t, ended));
  }
  // 行程那一格：沒結束＝旅途資訊卡 → 每天的行程；結束後＝每天的行程 → 旅途資訊收成一列放最下面（點開照樣是同一張卡）。
  // 原本最下面那一列回顧（還沒結束時）搬進「回顧」那一格，這裡不再放。
  function buildPlan() {
    // 原生 append 不會略過 null（會寫成「null」兩個字，v1.86.0 截圖抓到）——先濾掉；h() 才會自己略過
    planPane.append(...[
      ended ? null : h('div', { class: 'section-label' }, '旅途資訊'),
      ended ? null : infoCard(tripId),
      h('div', { class: 'section-label' }, '每天的行程'),
      h('button', { class: 'btn btn-soft btn-block itin-edit', onclick: () => navigate(`/trip/${tripId}/plan`) },
        spots.length ? '📅 調整每天的行程' : '＋ 去安排景點')].filter(Boolean));
    if (spots.length) planDays();
    if (ended) {
      planPane.append(h('details', { class: 'info-fold' },
        h('summary', { class: 'info-fold-sum' }, '旅途資訊（航班・住宿・待買）'),
        infoCard(tripId)));
    }
  }
  function planDays() {
    const dayNums = [...byDay.keys()].sort((a, b) => a - b);
    const todayDay = dayForToday(t);
    const key = 'tripquest.itinDay.' + tripId;
    const many = dayNums.length > 1;
    let sel = dayNums.includes(todayDay) ? todayDay : dayNums[0];
    try {
      const raw = localStorage.getItem(key), s = Number(raw);
      if (dayNums.includes(s) || (many && raw === '0')) sel = s;
    } catch { /* noop */ }
    const secs = new Map();
    const pickDay = (d) => {
      for (const [n, sec] of secs) sec.classList.toggle('open', n === d);
      strip.select(d);
      try { localStorage.setItem(key, String(d)); } catch { /* noop */ }
    };
    // 日期列最前面一格是「總覽」（整趟所有天畫在同一張地圖；Yolin 2026-11-05 選 A；2026-11-13 從任務頁搬來）
    const strip = dayStrip(dayNums, byDay, t, { todayDay, sel, onPick: pickDay, overview: many });
    if (many) {
      planPane.append(strip.el);
      const ov = h('section', { class: 'daycollapse dc-overview' + (sel === 0 ? ' open' : ''), dataset: { day: '0' } },
        h('div', { class: 'dc-head' }, h('span', { class: 'dc-main' },
          h('span', { class: 'dc-row1' }, h('span', { class: 'dc-daynum' }, '總覽')),
          h('span', { class: 'dc-meta' }, h('span', {}, `全部 ${dayNums.length} 天 · ${spots.length} 個景點`)))),
        h('div', { class: 'dc-body' }, h('div', { class: 'dc-inner' },
          tripOverviewMap(byDay, dayNums, { onPickDay: pickDay }))));
      secs.set(0, ov);
      planPane.append(ov);
    }
    for (const day of dayNums) {
      const ds = byDay.get(day);
      const dstr = dayDate(t, day);
      const route = dayRoute(ds);
      const isToday = todayDay === day && todayDay > 0;
      const meta = [dstr ? `${dstr} ${weekdayLabel(t.startDate, day)}`.trim() : null, `${ds.length} 個景點`].filter(Boolean).join(' · ');
      const sec = h('section', { class: 'daycollapse itin-day' + (day === sel ? ' open' : ''), dataset: { day: String(day) } },
        h('div', { class: 'dc-head' + (isToday ? ' is-today' : '') },
          h('span', { class: 'dc-main' },
            h('span', { class: 'dc-row1' }, h('span', { class: 'dc-daynum' }, `第 ${day} 天`),
              isToday ? h('span', { class: 'dc-todaytag' }, '今天') : null),
            route ? h('span', { class: 'dc-route' }, route) : null,
            h('span', { class: 'dc-meta' }, h('span', {}, meta)))),
        h('div', { class: 'dc-body' }, h('div', { class: 'dc-inner' },
          dayMap(ds, tripId, day),
          legTimeline(ds, (s) => h('li', { class: 'tl-item' },
            h('span', { class: 'tl-time' }, spotTimes(s).startTime || ''),
            h('span', { class: 'tl-dot', 'aria-hidden': 'true' }),
            h('div', { class: 'itin-stop' }, `${s.emoji || '📍'} ${s.name || '（沒有名字）'}`))))));
      secs.set(day, sec);
      planPane.append(sec);
    }
  }
  drawPage(page);
  show(tab);   // 掛上之後才建（量得到尺寸）
  // 旅伴同步進來（例：別人加了航班、改了行程）→ 整頁重畫（見 onTripPage）。簽章只放這一頁畫得到的東西：
  // 背景補維基圖片（heroHash）、AI 文案這些這一頁不顯示的欄位改了不重畫——不然點到一半，按鈕被換掉（overviewtest 實測）。
  watchHere(tripId, itinSignature);
}

function itinSignature(tripId) {
  const t = store.get(tripId);
  if (!t) return '';
  const { total, left } = buyCounts(tripId);
  const fl = flightsOf(tripId).map((f) => [f.id, f.flightNo, f.depDate, f.depTime].join(',')).join(';');
  const sp = store.spotsOf(tripId).map((s) => [s.id, s.name, s.emoji, s.day, s.order, s.startMin, s.startTime, s.stayMin, s.endTime,
    s.legFrom, s.legMode, s.lat, s.lng].join(',')).join(';');
  return [t.title, t.startDate, t.endDate, staysOf(tripId).length, total, left, fl, sp, store.submissionsOfTrip(tripId).length].join('|');
}

export async function settings(tripId, { drawPage, setTop }) {
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

  drawPage(h('div', { class: 'page form' },
    settingRow('旅程名稱', h('button', { class: 'btn btn-soft', onclick: async () => {
      const v = await promptDialog('旅程名稱', { value: t.title });
      if (v) { store.patch(tripId, { title: v }); toast('已更新'); refreshPage(); }
    } }, t.title || '未命名')),

    settingRow('旅程日期', h('button', { class: 'btn btn-soft', onclick: async () => {
      const res = await pickDateRange({ start: t.startDate, end: t.endDate });
      if (res) { await store.patch(tripId, { startDate: res.start, endDate: res.end }); toast('已更新日期'); refreshPage(); }
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
    // AI 的輸出沒辦法事先保證，總要有一條重來的路（v1.72）。
    // 只在有開 AI 的行程出現 —— 沒開的人看到這顆按鈕只會困惑。
    t.aiEnabled ? aiTextRow(tripId) : null,

    h('div', { class: 'section-label', style: 'margin:22px 2px 8px' }, '進階：自帶金鑰（可選）'),
    h('div', { class: 'sub-label' }, 'AI 加值'),
    aiConfigCard(tripId, () => refreshPage()),
    h('div', { class: 'sub-label' }, '地圖加值'),
    mapsConfigCard(tripId),
    keyNotice(),

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
          // 旅伴是群組層級的：帳與照片都照「整個群組」算，不只這一趟（v1.74.9 以前照片只看這一趟、帳完全不看）
          const { memberExpenseCounts } = await import('../expenses.js');
          const { paid, shared } = memberExpenseCounts(groupId, m.id);
          const photos = store.trips().filter((t) => t.groupId === groupId)
            .reduce((n, t) => n + store.submissionsOfTrip(t.id).filter((s) => s.memberId === m.id).length, 0);
          if (paid || shared || photos) {
            const lines = [];
            if (paid || shared) {
              lines.push(`${m.displayName} 在分帳裡有帳：付了 ${paid} 筆、參與分攤 ${shared} 筆。`);
              lines.push(`移除之後這些帳照樣算，結清方案會寫成「${m.displayName}（已移除）」，錢一樣對得上。`);
              lines.push('如果是記錯了，請先到「分帳」把那幾筆改掉，再回來移除。');
            }
            if (photos) lines.push(`${m.displayName} 有 ${photos} 張照片，移除後那些照片會標為「未指定」。`);
            lines.push('', '要移除嗎？');
            if (!await confirmDialog(lines.join('\n'), { danger: true, okLabel: '移除' })) return;
          }
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

// 文案狀態列：**把每一種失敗講出來**。
//
// v1.72.0 的問題不是機制壞了（實測會重產），是每一種擋下來的情況都靜默：
// 這台不是建立者、這台沒有金鑰、超過花費上限、API 掛掉 —— 使用者只看到「文字沒變」，
// 而且我自己在查的時候也一樣看不出卡在哪。

function aiTextRow(tripId) {
  const box = h('div', {});
  const draw = async () => {
    const { aiTextStatus } = await import('../aicontent.js');
    const st = await aiTextStatus(tripId);
    if (st.state === 'off') { box.replaceChildren(); return; }
    const btn = h('button', { class: 'btn btn-soft', onclick: () => redoAiText(tripId, draw) }, '重新產生');
    if (st.state === 'fresh') {
      box.replaceChildren(settingRow('影片與海報文案',
        h('div', { style: 'display:flex;align-items:center;gap:10px' },
          h('span', { class: 'tag tag-ok' }, '最新'), btn)));
      return;
    }
    const w = AI_WHY[st.why] || AI_WHY.pending;
    box.replaceChildren(
      settingRow('影片與海報文案',
        h('div', { style: 'display:flex;align-items:center;gap:10px' },
          h('span', { class: 'tag tag-todo' }, '待更新'), btn)),
      h('p', { class: 'form-hint' }, `${w.t} —— ${w.a}。`
        + (st.detail ? `（${st.detail}）` : '')),
    );
  };
  draw();
  return box;
}

// 把這趟的 AI 文案全部丟掉，下次進行程頁會重新產一份。
// **先確認這台真的產得出來再刪** —— v1.72.0 沒確認就刪，沒有金鑰的裝置按下去
// 會把文案刪光又產不回來，影片字卡直接變空白（實測確認）。
async function redoAiText(tripId, after) {
  const { canRegenerate, clearTripText, warmTripContent } = await import('../aicontent.js');
  const can = await canRegenerate(tripId);
  if (!can.ok) {
    const w = AI_WHY[can.why] || AI_WHY.pending;
    await confirmDialog(`這台手機沒辦法重新產生：${w.t}。\n\n${w.a}。`, { okLabel: '知道了', cancelLabel: '關閉' });
    return;
  }
  if (!await confirmDialog(
    '會把這趟的影片字卡、海報文案、景點介紹、照片字幕全部重新產一遍。\n\n'
    + '你自己改過的不會動。旅伴那邊也會換成新的一份（大家看的本來就該是同一份）。',
    { okLabel: '重新產生' })) return;
  toast('正在重新產生…');
  await clearTripText(tripId);
  await warmTripContent(tripId);
  toast('文案已重新產生');
  if (after) await after();
}

async function regenerate(tripId) {
  // v1.74：只替對得上內建景點資料庫的地點補。其餘地點一律留白（自己新增），
  // 所以這裡照實講，不要讓使用者以為按了就會每個地點都長出任務。
  if (!await confirmDialog('會替「內建景點資料庫裡有的地點」補上任務。你改過或自訂的不會動，重複的不會重加。\n\n資料庫裡沒有的地點（餐廳、民宿、店家…）不會自動產生任務，請用景點卡上的「＋ 新增任務」。')) return;
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
