import { setTop, render } from '../app.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { importShareCode, peekShareCode } from '../share.js';

// 由分享連結進入：#/join?d=<code>
export default async function join(query) {
  setTop({ title: '加入行程', back: false });
  const code = query.d;
  if (!code) { navigate('/', { replace: true }); return; }

  render(h('div', { class: 'page' }, h('div', { class: 'center-fill' }, h('div', { class: 'spinner' }))));

  let info;
  try {
    info = await peekShareCode(code);
  } catch (e) {
    render(h('div', { class: 'page' }, h('div', { class: 'empty' },
      h('p', {}, '這個邀請連結無法解析'),
      h('p', { class: 'form-hint' }, e.message),
      h('button', { class: 'btn btn-soft', onclick: () => navigate('/') }, '回首頁'))));
    return;
  }

  render(h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '旅伴邀請你加入'),
      h('p', { class: 'muted' }, `${info.group} · ${info.title}`),
      h('p', { class: 'sm muted' }, `${info.spots} 個景點 · ${info.quests} 個拍照任務`),
    ),
    h('button', {
      class: 'btn btn-primary btn-block', onclick: async () => {
        try {
          const tripId = await importShareCode(code);
          toast('已加入！開始拍照解任務吧');
          navigate(`/trip/${tripId}`, { replace: true });
        } catch (e) { toast('加入失敗：' + e.message); }
      },
    }, '加入這個行程'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => navigate('/') }, '先不要'),
    h('p', { class: 'form-hint center' }, '加入後會在你的裝置建立一份任務清單，你的照片只留在自己手機。'),
  ));
}
