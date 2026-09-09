import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, avatar, toast, chooseFrom } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';
import { subPhoto } from '../photoimg.js';
import { ensureMember, activeMemberId } from '../claim.js';
import { shooterOf, subjectsOf } from '../badges.js';
import { openTagger } from '../phototag.js';
import { openViewer } from '../viewer.js';
import { blobURL } from '../photos.js';

const REACTIONS = ['❤️', '👍', '😍', '👏'];

// 只有新舊兩種。照片本來就是照時間拍的，時間順序自然就對應行程順序，
// 再多給「照行程」「照人分」只是讓長輩多一個要想的東西。
// 預設「最新的在前」：旅途中打開照片牆，最常見的是想看剛剛拍了什麼。
const SORTS = [
  { id: 'new', label: '🕘 最新在前' },
  { id: 'old', label: '🕗 最舊在前' },
];
const VIEW_KEY = (tripId) => 'tripquest.wall.' + tripId;

// v1.57：兩種檢視 —— 相簿（格狀，一眼看很多張、好找）與動態（誰拍的、留言）。
// 預設相簿：手機相簿與 LINE 相簿都是格狀，長輩最熟；動態流保留給「看誰拍了什麼」。
const MODES = [
  { id: 'grid', label: '▦ 相簿' },
  { id: 'feed', label: '☰ 動態' },
];
function loadView(tripId) {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY(tripId)) || '{}');
    // 舊的 'spot' / 'person' 會落回 'new'
    // 檢視偏好跨行程記住（tripquest.wall.mode）：這趟沒選過就用上次的選擇，都沒有就相簿
    const globalMode = localStorage.getItem('tripquest.wall.mode');
    const mode = MODES.some((m) => m.id === v.mode) ? v.mode : (MODES.some((m) => m.id === globalMode) ? globalMode : 'grid');
    return { sort: SORTS.some((s) => s.id === v.sort) ? v.sort : 'new', spot: v.spot || '', untagged: !!v.untagged, mode };
  } catch { return { sort: 'new', spot: '', untagged: false, mode: 'grid' }; }
}
function saveView(tripId, v) {
  try { localStorage.setItem(VIEW_KEY(tripId), JSON.stringify(v)); if (v.mode) localStorage.setItem('tripquest.wall.mode', v.mode); } catch { /* noop */ }
}

// 排序與篩選都在這裡，畫面只負責顯示
function arrange(all, view) {
  const spotOf = (sub) => {
    const q = store.getRaw(sub.questId);
    return q ? q.spotId : null;
  };

  let list = all.slice();
  if (view.spot) list = list.filter((s) => spotOf(s) === view.spot);
  if (view.untagged) list = list.filter((s) => !store.isPhotoTagged(s));

  const at = (s) => s.takenAt || s.createdAt || 0;
  list.sort(view.sort === 'old' ? (a, b) => at(a) - at(b) : (a, b) => at(b) - at(a));
  return { list, spotOf };
}

export default async function people(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '照片牆' });

  const members = store.membersOf(t.groupId);
  const page = h('div', { class: 'page' });

  // 「大家的進度」區塊已移到「回顧」分頁（v1.57.2）—— 照片頁只留照片
  import('../outbox.js').then((o) => o.refreshNow()).catch(() => {});   // 開照片牆先拉一次
  const allSubs = store.submissionsOfTrip(tripId);

  // 還沒標記的照片 —— 不吵，但看得到，一按就進連續標記
  const untagged = store.untaggedPhotos(tripId);
  if (untagged.length) {
    page.append(h('button', {
      class: 'untag-cta',
      onclick: async () => {
        const first = untagged[0];
        if (await openTagger(tripId, first.id, allSubs)) people(tripId);
      },
    },
      h('span', { class: 'untag-cta-main' },
        h('span', { style: 'font-weight:800' }, `還有 ${untagged.length} 張沒標記`),
        h('span', { class: 'muted sm' }, '標一下照片裡有誰，統計和徽章會更準'),
      ),
      h('span', {}, '›'),
    ));
  }

  // ---------- 排序與篩選 ----------
  const view = loadView(tripId);
  const { list: subs, spotOf } = arrange(allSubs, view);

  // 控制項壓在一行裡（景點下拉 + 排序小圖示），讓照片本身是焦點。
  // 景點一多的時候，一整排 chips 會把畫面吃掉一大半。
  const filtered = !!(view.spot || view.untagged);
  // 標題盡量短：頂列已經寫「照片牆」了，這裡改成給實際有用的數字
  const title = !allSubs.length ? '還沒有照片'
    : (filtered ? `${subs.length}／${allSubs.length} 張` : `${allSubs.length} 張照片`);

  if (allSubs.length) {
    const apply = (patch) => { saveView(tripId, { ...view, ...patch }); people(tripId); };

    const counts = new Map();
    for (const s of allSubs) {
      const sid = spotOf(s);
      if (sid) counts.set(sid, (counts.get(sid) || 0) + 1);
    }
    const spotsWithPhotos = store.spotsOf(tripId).filter((s) => counts.get(s.id));
    const pickedSpot = view.spot ? store.get(view.spot) : null;
    const label = view.untagged ? '只看未標記' : (pickedSpot ? pickedSpot.name : '全部照片');

    const openFilter = async () => {
      const options = [{ value: '', label: '全部照片', tag: String(allSubs.length) }];
      if (members.length > 1 && (untagged.length || view.untagged)) {
        options.push({ value: '__untagged', label: '只看未標記', sub: '還沒標「照片裡有誰」的', tag: String(untagged.length) });
      }
      for (const s of spotsWithPhotos) {
        options.push({ value: s.id, label: `${s.emoji || '📍'} ${s.name}`, tag: String(counts.get(s.id)) });
      }
      const cur = view.untagged ? '__untagged' : (view.spot || '');
      const got = await chooseFrom({ title: '要看哪些照片？', options, value: cur });
      if (got === undefined || got === cur) return;
      apply(got === '__untagged' ? { spot: '', untagged: true } : { spot: got, untagged: false });
    };

    // 只有兩種，用「按一下就換」的切換鈕比跳選單少兩下；
    // 但按鈕上直接寫現在是哪一種，不然長輩看圖示猜不出來、按完也不知道換了什麼。
    const sortNow = SORTS.find((x) => x.id === view.sort) || SORTS[0];
    const toggleSort = () => apply({ sort: view.sort === 'old' ? 'new' : 'old' });

    page.append(h('div', { class: 'wall-modes' }, ...MODES.map((m) => h('button', {
      class: 'wall-mode' + (view.mode === m.id ? ' on' : ''),
      'aria-pressed': String(view.mode === m.id),
      onclick: () => { if (view.mode !== m.id) apply({ mode: m.id }); },
    }, m.label))));
    page.append(h('div', { class: 'wall-bar' },
      h('span', { class: 'wall-bar-title' }, title),
      h('button', { class: 'wall-ctl' + (filtered ? ' on' : ''), onclick: openFilter },
        h('span', { class: 'wall-ctl-label' }, label),
        h('span', { class: 'wall-ctl-chev' }, '▾'),
      ),
      h('button', {
        class: 'wall-ctl wall-ctl-sort' + (view.sort === 'new' ? '' : ' on'),
        'aria-label': `目前是${sortNow.label}，點一下換另一種`,
        title: '點一下換新舊順序', onclick: toggleSort,
      }, h('span', { class: 'wall-ctl-label' }, sortNow.label)),
    ));
  } else {
    page.append(h('div', { class: 'section-label' }, title));
  }

  if (!allSubs.length) {
    page.append(h('div', { class: 'empty' }, h('p', {}, '快去拍第一張！'),
      // 按鈕文字說了目的地就要真的去那裡：back() 是「回上一頁」，從分帳分頁切過來時
      // 會退回分帳（使用者實機回報的正是這個）。標了地名的按鈕一律用 navigate。
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/trip/${tripId}`) }, '回任務清單')));
  } else if (!subs.length) {
    page.append(h('div', { class: 'empty' },
      h('p', {}, '這個條件下沒有照片'),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => { saveView(tripId, { ...view, spot: '', untagged: false }); people(tripId); },
      }, '看全部照片')));
  }

  render(page);

  if (view.mode === 'grid') {
    if (subs.length) page.append(gridView(tripId, t, subs, spotOf, members.length > 1));
    return;
  }
  for (const sub of subs) {
    page.append(await feedItem(sub, tripId, subs, members.length > 1));
  }
}

// ---------- 相簿（格狀）----------
// 依天分組（景點的天數；沒有就用拍攝日期對照行程起日），一天一段、標題貼頂。
// 200 張以上也要順：縮圖用 IntersectionObserver 快到可視範圍才解碼，離開後不釋放（縮圖很小）。
function gridView(tripId, trip, subs, spotOf, multi) {
  const dayOf = (sub) => {
    const sid = spotOf(sub);
    const sp = sid ? store.getRaw(sid) : null;
    if (sp && sp.day) return sp.day;
    if (trip.startDate && (sub.takenAt || sub.createdAt)) {
      const d0 = new Date(trip.startDate + 'T00:00:00').getTime();
      const d = Math.floor(((sub.takenAt || sub.createdAt) - d0) / 86400000) + 1;
      if (d >= 1 && d < 60) return d;
    }
    return 0;
  };
  const dateOfDay = (d) => {
    if (!trip.startDate || !d) return '';
    const x = new Date(new Date(trip.startDate + 'T00:00:00').getTime() + (d - 1) * 86400000);
    return `${x.getMonth() + 1}/${x.getDate()}`;
  };
  const groups = new Map();
  for (const s of subs) { const d = dayOf(s); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(s); }
  const order = [...groups.keys()].sort((a, b) => (a || 99) - (b || 99));
  const wrap = h('div', { class: 'pg' });
  const io = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { loadCell(e.target); io.unobserve(e.target); }
  }, { rootMargin: '600px 0px' }) : null;
  const loadCell = (cell) => {
    if (cell.dataset.loaded) return;
    cell.dataset.loaded = '1';
    const sub = subs[+cell.dataset.i];
    (async () => {
      const url = await blobURL(sub.thumbHash).catch(() => '') || await blobURL(sub.photoHash).catch(() => '');
      const img = cell.querySelector('img');
      if (url) { img.src = url; img.hidden = false; cell.classList.remove('pg-wait'); }
      else cell.classList.add('pg-miss');
    })();
  };
  let idx = 0;
  for (const d of order) {
    const list = groups.get(d);
    wrap.append(h('div', { class: 'pg-day' },
      h('span', {}, d ? `第 ${d} 天` : '其他'), dateOfDay(d) ? h('span', { class: 'pg-date' }, dateOfDay(d)) : null,
      h('span', { class: 'pg-n' }, `${list.length} 張`)));
    const grid = h('div', { class: 'pg-grid' });
    for (const sub of list) {
      const i = subs.indexOf(sub);
      const likes = store.reactionsOf(sub.id).length;
      const cell = h('button', {
        class: 'pg-cell pg-wait', dataset: { i: String(i) }, 'aria-label': `第 ${idx + 1} 張照片`,
        onclick: async () => {
          const { changed } = await openViewer(tripId, subs, i, {
            onTag: async (s) => { if (await openTagger(tripId, s.id, subs)) people(tripId); },
          });
          if (changed) people(tripId);
        },
      },
        h('img', { alt: '', hidden: true, draggable: false }),
        likes ? h('span', { class: 'pg-likes' }, `❤️ ${likes}`) : null,
        (multi && !store.isPhotoTagged(sub)) ? h('span', { class: 'pg-untag' }, '未標記') : null,
      );
      if (io) io.observe(cell); else loadCell(cell);
      grid.append(cell);
      idx++;
    }
    wrap.append(grid);
  }
  return wrap;
}

async function feedItem(sub, tripId, allSubs, multi) {
  const quest = store.getRaw(sub.questId);
  const spot = quest ? store.getRaw(quest.spotId) : null;

  const shooter = shooterOf(sub);
  const author = shooter ? store.getRaw(shooter) : null;
  const subjects = subjectsOf(sub).map((id) => store.getRaw(id)?.displayName).filter(Boolean);
  const caption = store.photoCaption(sub);
  const needsTag = multi && !store.isPhotoTagged(sub);

  const item = h('div', { class: 'feed-item' });
  item.append(h('div', { class: 'fi-head' },
    avatar(author?.displayName || '?', hashHue(shooter || sub.deviceId || 'x')),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'fi-who' }, (author?.displayName || sub.byDevice || '旅伴') + ' 拍的'),
      h('div', { class: 'fi-what' }, [spot?.name, quest?.title].filter(Boolean).join(' · ')),
      subjects.length ? h('div', { class: 'fi-what' }, '📸 ' + subjects.join('、')) : null,
      caption ? h('div', { class: 'fi-what' }, caption) : null,
    ),
  ));

  // 點照片 → 全螢幕放大（左右滑、按讚、留言）；標記／說明從檢視器右上角 ✏️ 進
  const photoWrap = h('button', {
    class: 'fi-photo-btn',
    onclick: async () => {
      const { changed } = await openViewer(tripId, allSubs, allSubs.indexOf(sub), {
        onTag: async (s) => { if (await openTagger(tripId, s.id, allSubs)) people(tripId); },
      });
      if (changed) redraw();
    },
  },
    subPhoto(sub, { className: 'fi-photo', alt: caption || '' }),
    needsTag ? h('span', { class: 'untag-dot' }, '未標記') : null,
  );
  item.append(photoWrap);

  const actions = h('div', { class: 'fi-actions' });
  const commentsBox = h('div', { class: 'fi-comments' });
  item.append(actions, commentsBox);

  const redraw = () => {
    const reacts = store.reactionsOf(sub.id);
    const me = activeMemberId(tripId);
    const mine = me ? store.myReaction(sub.id, me) : null;
    actions.replaceChildren(
      ...REACTIONS.map((emo) => {
        const n = reacts.filter((r) => r.emoji === emo).length;
        return h('button', {
          class: 'react-btn' + (mine?.emoji === emo ? ' on' : ''),
          onclick: async () => {
            const actor = await ensureMember(tripId);
            if (!actor) return;
            await store.toggleReaction(sub.id, actor, emo);
            redraw();
          },
        }, emo, n ? String(n) : '');
      }),
    );
    const comments = store.commentsOf(sub.id);
    commentsBox.replaceChildren(
      ...comments.map((c) => {
        const who = c.actorId ? store.getRaw(c.actorId) : null;
        return h('div', { class: 'fi-comment' }, h('b', {}, (who?.displayName || '旅伴') + '：'), c.text);
      }),
      commentAdder(sub, tripId, redraw),
    );
  };
  redraw();
  return item;
}

function commentAdder(sub, tripId, redraw) {
  const field = h('input', { class: 'field', type: 'text', placeholder: '留一句鼓勵…', maxlength: 240 });
  const send = async () => {
    const text = field.value.trim();
    if (!text) return;
    const actor = await ensureMember(tripId);
    if (!actor) { toast('先選一下你是誰'); return; }
    await store.addComment(sub.id, actor, text);
    field.value = '';
    redraw();
  };
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  return h('div', { class: 'fi-comment-add' }, field,
    h('button', { class: 'btn btn-soft', onclick: send }, '送出'));
}
