import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, avatar, toast, chooseFrom } from '../ui.js';
import { navigate, back } from '../router.js';
import { hashHue } from '../ids.js';
import { blobURL } from '../photos.js';
import { ensureMember, activeMemberId } from '../claim.js';
import { creditOf, shooterOf, subjectsOf, helpedOthers, earnedBadges } from '../badges.js';
import { openTagger } from '../phototag.js';

const REACTIONS = ['❤️', '👍', '😍', '👏'];

// 排序方式。預設「最新的在前」：旅途中打開照片牆，最常見的是想看剛剛拍了什麼。
const SORTS = [
  { id: 'new', label: '🕘 最新的在前' },
  { id: 'old', label: '🕗 最舊的在前' },
  { id: 'spot', label: '📍 照行程順序' },
  { id: 'person', label: '👥 照人分' },
];
const VIEW_KEY = (tripId) => 'tripquest.wall.' + tripId;

function loadView(tripId) {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY(tripId)) || '{}');
    return { sort: SORTS.some((s) => s.id === v.sort) ? v.sort : 'new', spot: v.spot || '', untagged: !!v.untagged };
  } catch { return { sort: 'new', spot: '', untagged: false }; }
}
function saveView(tripId, v) {
  try { localStorage.setItem(VIEW_KEY(tripId), JSON.stringify(v)); } catch { /* noop */ }
}

// 排序與篩選都在這裡，畫面只負責顯示
function arrange(all, view, tripId) {
  const spotOrder = new Map();
  store.spotsOf(tripId).forEach((s, i) => spotOrder.set(s.id, i));
  const spotOf = (sub) => {
    const q = store.getRaw(sub.questId);
    return q ? q.spotId : null;
  };

  let list = all.slice();
  if (view.spot) list = list.filter((s) => spotOf(s) === view.spot);
  if (view.untagged) list = list.filter((s) => !store.isPhotoTagged(s));

  const at = (s) => s.takenAt || s.createdAt || 0;
  if (view.sort === 'old') list.sort((a, b) => at(a) - at(b));
  else if (view.sort === 'spot') {
    list.sort((a, b) => (spotOrder.get(spotOf(a)) ?? 999) - (spotOrder.get(spotOf(b)) ?? 999) || at(a) - at(b));
  } else if (view.sort === 'person') {
    const name = (s) => {
      const id = shooterOf(s);
      return (id && store.getRaw(id)?.displayName) || s.byDevice || '';
    };
    list.sort((a, b) => name(a).localeCompare(name(b), 'zh-Hant') || at(b) - at(a));
  } else list.sort((a, b) => at(b) - at(a));           // 預設：最新的在前
  return { list, spotOf };
}

export default async function people(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '照片牆' });

  const members = store.membersOf(t.groupId);
  const prog = store.tripProgress(tripId);
  const page = h('div', { class: 'page' });

  // 每個人的進度（歸屬一律走標記，改標記後回到這頁就是新數字）
  page.append(h('div', { class: 'section-label' }, `大家一起完成了 ${prog.done} / ${prog.total}`));
  const allSubs = store.submissionsOfTrip(tripId);
  for (const m of members) {
    const credited = new Set(allSubs.filter((s) => creditOf(s) === m.id).map((s) => s.questId));
    const shot = allSubs.filter((s) => shooterOf(s) === m.id);
    const forOthers = shot.filter((s) => helpedOthers(s, m.id)).length;
    const inPhotos = allSubs.filter((s) => subjectsOf(s).includes(m.id)).length;
    const ratio = prog.total ? credited.size / prog.total : 0;
    const bCount = earnedBadges(tripId, m.id).length;
    page.append(h('div', { class: 'people-row' },
      avatar(m.displayName, hashHue(m.id)),
      h('div', { class: 'pr-main' },
        h('div', { class: 'pr-name' }, m.displayName, bCount ? h('span', { class: 'pr-badges' }, `🏅${bCount}`) : null),
        h('div', { class: 'pr-count' },
          `完成 ${credited.size} 個任務 · 拍 ${shot.length} 張`
          + (forOthers ? ` · 幫拍 ${forOthers}` : '')
          + (inPhotos ? ` · 入鏡 ${inPhotos}` : '')),
        h('div', { class: 'pr-mini-track' }, h('i', { style: `width:${Math.round(ratio * 100)}%` })),
      ),
    ));
  }
  page.append(h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/badges`) }, '🏅 看成就徽章'));

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
  const { list: subs, spotOf } = arrange(allSubs, view, tripId);

  // 控制項壓在一行裡（景點下拉 + 排序小圖示），讓照片本身是焦點。
  // 景點一多的時候，一整排 chips 會把畫面吃掉一大半。
  const filtered = !!(view.spot || view.untagged);
  const title = !allSubs.length ? '還沒有照片'
    : (filtered ? `符合的照片 ${subs.length}／${allSubs.length}` : '大家拍的照片');

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

    const openSort = async () => {
      const got = await chooseFrom({
        title: '照片怎麼排？',
        options: SORTS.map((s) => ({ value: s.id, label: s.label })),
        value: view.sort,
      });
      if (got !== undefined && got !== view.sort) apply({ sort: got });
    };

    page.append(h('div', { class: 'wall-bar' },
      h('span', { class: 'wall-bar-title' }, title),
      h('button', { class: 'wall-ctl' + (filtered ? ' on' : ''), onclick: openFilter },
        h('span', { class: 'wall-ctl-label' }, label),
        h('span', { class: 'wall-ctl-chev' }, '▾'),
      ),
      h('button', {
        class: 'wall-ctl wall-ctl-icon' + (view.sort === 'new' ? '' : ' on'),
        'aria-label': '排序方式', title: '排序方式', onclick: openSort,
      }, '⇅'),
    ));
  } else {
    page.append(h('div', { class: 'section-label' }, title));
  }

  if (!allSubs.length) {
    page.append(h('div', { class: 'empty' }, h('p', {}, '快去拍第一張！'),
      h('button', { class: 'btn btn-primary', onclick: () => back(`/trip/${tripId}`) }, '回任務清單')));
  } else if (!subs.length) {
    page.append(h('div', { class: 'empty' },
      h('p', {}, '這個條件下沒有照片'),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => { saveView(tripId, { ...view, spot: '', untagged: false }); people(tripId); },
      }, '看全部照片')));
  }

  render(page);

  for (const sub of subs) {
    page.append(await feedItem(sub, tripId, subs, members.length > 1));
  }
}

async function feedItem(sub, tripId, allSubs, multi) {
  const quest = store.getRaw(sub.questId);
  const spot = quest ? store.getRaw(quest.spotId) : null;
  const url = await blobURL(sub.photoHash);

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

  // 點照片 → 標記畫面（也能在那裡加說明、刪除）
  const photoWrap = h('button', {
    class: 'fi-photo-btn',
    onclick: async () => { if (await openTagger(tripId, sub.id, allSubs)) people(tripId); },
  },
    h('img', { class: 'fi-photo', src: url, alt: caption || '', loading: 'lazy' }),
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
