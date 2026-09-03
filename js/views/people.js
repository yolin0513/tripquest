import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, avatar } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';
import { blobURL } from '../photos.js';

const REACTIONS = ['❤️', '👍', '😍', '👏'];

export default async function people(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '照片牆' });

  const members = store.membersOf(t.groupId);
  const subs = [...store.submissionsOfTrip(tripId)].reverse(); // 新的在前
  const prog = store.tripProgress(tripId);

  // 我是誰（按讚 / 留言用）
  let me = store.getActiveMember(tripId);
  if (me && !store.getRaw(me)) me = null;

  const page = h('div', { class: 'page' });

  // 每個人的進度
  page.append(h('div', { class: 'section-label' }, `大家一起完成了 ${prog.done} / ${prog.total}`));
  for (const m of members) {
    const mineSubs = store.submissionsOfTrip(tripId).filter((s) => s.memberId === m.id);
    const questSet = new Set(mineSubs.map((s) => s.questId));
    const ratio = prog.total ? questSet.size / prog.total : 0;
    page.append(h('div', { class: 'people-row' },
      avatar(m.displayName, hashHue(m.id)),
      h('div', { class: 'pr-main' },
        h('div', { class: 'pr-name' }, m.displayName),
        h('div', { class: 'pr-count' }, `拍到 ${questSet.size} 個任務 · ${mineSubs.length} 張照片`),
        h('div', { class: 'pr-mini-track' }, h('i', { style: `width:${Math.round(ratio * 100)}%` })),
      ),
    ));
  }

  // 照片動態
  page.append(h('div', { class: 'section-label' }, subs.length ? '大家拍的照片' : '還沒有照片'));
  if (!subs.length) {
    page.append(h('div', { class: 'empty' }, h('p', {}, '快去拍第一張！'),
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/trip/${tripId}`) }, '回任務清單')));
  }

  render(page);

  for (const sub of subs) {
    page.append(await feedItem(sub, tripId, () => me, (v) => { me = v; }));
  }
}

async function feedItem(sub, tripId, getMe, setMe) {
  const quest = store.getRaw(sub.questId);
  const spot = quest ? store.getRaw(quest.spotId) : null;
  const author = sub.memberId ? store.getRaw(sub.memberId) : null;
  const url = await blobURL(sub.photoHash);

  const item = h('div', { class: 'feed-item' });
  item.append(h('div', { class: 'fi-head' },
    avatar(author?.displayName || '?', hashHue(sub.memberId || sub.deviceId || 'x')),
    h('div', {},
      h('div', { class: 'fi-who' }, author?.displayName || sub.byDevice || '旅伴'),
      h('div', { class: 'fi-what' }, [spot?.name, quest?.title].filter(Boolean).join(' · ')),
    ),
  ));
  item.append(h('img', { class: 'fi-photo', src: url, alt: '', loading: 'lazy' }));

  const actions = h('div', { class: 'fi-actions' });
  const commentsBox = h('div', { class: 'fi-comments' });
  item.append(actions, commentsBox);

  const redraw = () => {
    const reacts = store.reactionsOf(sub.id);
    const mine = getMe() ? store.myReaction(sub.id, getMe()) : null;
    actions.replaceChildren(
      ...REACTIONS.map((emo) => {
        const n = reacts.filter((r) => r.emoji === emo).length;
        return h('button', {
          class: 'react-btn' + (mine?.emoji === emo ? ' on' : ''),
          onclick: async () => {
            const actor = await ensureMe(tripId, getMe, setMe);
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
      commentAdder(sub, tripId, getMe, setMe, redraw),
    );
  };
  redraw();
  return item;
}

function commentAdder(sub, tripId, getMe, setMe, redraw) {
  const field = h('input', { class: 'field', type: 'text', placeholder: '留一句鼓勵…', maxlength: 240 });
  const send = async () => {
    const text = field.value.trim();
    if (!text) return;
    const actor = await ensureMe(tripId, getMe, setMe);
    if (!actor) return;
    await store.addComment(sub.id, actor, text);
    field.value = '';
    redraw();
  };
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  return h('div', { class: 'fi-comment-add' }, field,
    h('button', { class: 'btn btn-soft', onclick: send }, '送出'));
}

async function ensureMe(tripId, getMe, setMe) {
  let me = getMe();
  if (me && store.getRaw(me)) return me;
  const members = store.membersOf(store.get(tripId).groupId);
  if (members.length === 1) { me = members[0].id; }
  else {
    me = await pick(members);
    if (!me) return null;
  }
  store.setActiveMember(tripId, me);
  setMe(me);
  toast('你是「' + store.getRaw(me).displayName + '」，之後不再問');
  return me;
}

function pick(members) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); resolve(v); };
    const card = h('div', { class: 'modal-card' },
      h('h2', { class: 'modal-title' }, '你是哪一位？'),
      h('div', { class: 'member-pick' },
        ...members.map((m) => h('button', { class: 'btn btn-soft btn-block btn-big', onclick: () => done(m.id) }, m.displayName)),
        h('button', { class: 'btn btn-ghost btn-block', onclick: () => done(null) }, '取消'),
      ),
    );
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, card);
    document.getElementById('modalRoot').append(overlay);
  });
}
