import { setTop, render } from '../app.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { importShareCode, peekShareCode, peekInvite, joinInvite } from '../share.js';
import { ensureMember } from '../claim.js';

// 由分享連結進入：
//   #/join?j=<code>  同步邀請（加入同一個群組）
//   #/join?d=<code>  任務清單（複製一份，單機）
export default async function join(query) {
  setTop({ title: '加入旅程', back: false });
  const syncCode = query.j;
  const copyCode = query.d;
  if (!syncCode && !copyCode) { navigate('/', { replace: true }); return; }

  render(h('div', { class: 'page' }, h('div', { class: 'center-fill' }, h('div', { class: 'spinner' }))));

  let info;
  try {
    info = syncCode ? await peekInvite(syncCode) : await peekShareCode(copyCode);
  } catch (e) {
    render(h('div', { class: 'page' }, h('div', { class: 'empty' },
      h('p', {}, '這個邀請連結無法解析'),
      h('p', { class: 'form-hint' }, e.message),
      h('button', { class: 'btn btn-soft', onclick: () => navigate('/') }, '回首頁'))));
    return;
  }

  // 群組名稱預設是「<行程名> 旅伴」，跟行程名一起顯示會變成「京都三日遊 旅伴 · 京都三日遊」
  // 這種重複又難讀的字串。名稱已經包含行程名時就只顯示行程名。
  const groupName = String(info.group || '').trim();
  const tripTitle = String(info.title || '行程').trim();
  const heading = (!groupName || groupName.includes(tripTitle)) ? tripTitle : `${tripTitle}（${groupName}）`;

  render(h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '旅伴邀請你加入'),
      h('p', { class: 'muted lg' }, heading),
      h('p', { class: 'sm muted' }, `${info.spots} 個景點 · ${info.quests} 個拍照任務`),
      info.sync ? h('p', { class: 'sm muted' }, '加入後大家的照片會自動同步') : null,
    ),
    h('button', {
      class: 'btn btn-primary btn-block btn-big', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = '加入中…（大行程最多約 1 分鐘，請稍候）';
        try {
          let tripId;
          if (syncCode) {
            tripId = await joinInvite(syncCode);
          } else {
            tripId = await importShareCode(copyCode);
          }
          toast('已加入！');
          if (syncCode && tripId) {
            await ensureMember(tripId, { force: true }); // 「這是誰的手機？」
          }
          navigate(`/trip/${tripId}`, { replace: true });
        } catch (err) {
          toast('加入失敗：' + err.message);
          btn.disabled = false;
          btn.textContent = original;
        }
      },
    }, '加入這個旅程'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => navigate('/') }, '先不要'),
    h('p', { class: 'form-hint center' }, info.sync
      ? '你的照片會存在自己手機，也會同步一份到旅伴共用的伺服器。'
      : '加入後會在你的裝置建立一份任務清單，照片只留在自己手機。'),
  ));
}
