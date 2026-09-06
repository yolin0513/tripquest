import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, ring, fmtDate, avatar, toast } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';
import { isStandalone, shouldOfferInstall } from '../install.js';

// 從邀請連結加入，剪貼簿優先
async function joinFromLink() {
  const { inviteFromClipboard } = await import('./join.js');
  const { joinByCode, joinByText } = await import('./settings.js');
  const fromClip = await inviteFromClipboard().catch(() => null);
  if (fromClip) {
    if (await joinByText(fromClip)) return;
    toast('這個連結加入失敗，再貼一次看看');
  }
  await joinByCode();
}

export default function home() {
  setTop({ title: 'TripQuest', back: false });
  const trips = store.trips();
  const std = isStandalone();

  // 剛裝好、從主畫面第一次打開，而且一個旅程都沒有 —— 十之八九是「在 Safari 點了
  // 旅伴的連結、裝了 App，結果打開是空的」那個情境（iPhone 的儲存空間是分開的）。
  // 這時候最該給的不是「建立新旅程」，是「把剛剛那個邀請貼進來」。
  const justInstalledEmpty = std && trips.length === 0;

  render(h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '把旅行變成拍照任務'),
      h('p', { class: 'muted lg' }, '一起完成、一起回味'),
    ),

    justInstalledEmpty
      ? h('div', { class: 'join-hint' },
          h('div', { class: 'join-hint-t' }, '🔗 旅伴給你邀請連結了嗎？'),
          h('p', { class: 'join-hint-p' }, '在瀏覽器裡加入的旅程不會跟著進來，在這裡貼一次連結就好。'),
          h('button', { class: 'btn btn-primary btn-block btn-big', onclick: joinFromLink }, '貼上邀請連結'),
        )
      : null,

    trips.length
      ? h('div', { class: 'stack' }, ...trips.map(tripCard))
      : h('div', { class: 'empty' },
          h('div', { class: 'empty-emoji' }, '🧳'),
          h('p', {}, '還沒有旅程'),
          h('p', { class: 'muted sm' }, justInstalledEmpty ? '或按下面的按鈕自己開一個' : '按下面的按鈕開一個'),
        ),

    h('button', {
      class: justInstalledEmpty ? 'btn btn-soft btn-block' : 'btn btn-primary btn-block btn-big',
      onclick: () => navigate('/new'),
    }, '＋ 建立新旅程'),

    justInstalledEmpty
      ? null
      : h('button', { class: 'btn btn-ghost btn-block', onclick: joinFromLink }, '🔗 用邀請連結加入旅伴的旅程'),

    // 還沒裝成 App 的話，在首頁給一個不吵的入口（可以永久關掉）
    (!std && shouldOfferInstall())
      ? h('button', {
          class: 'btn btn-ghost btn-block',
          onclick: async () => {
            const { openInstallGuide } = await import('./installguide.js');
            await openInstallGuide({ after: '裝好之後，主畫面就會有 TripQuest 的圖示。' });
            home();
          },
        }, '📲 把 TripQuest 放到主畫面')
      : null,
  ));
}

function tripCard(trip) {
  const p = store.tripProgress(trip.id);
  const members = store.membersOf(trip.groupId);
  const spots = store.spotsOf(trip.id);
  return h('button', {
    class: 'card trip-card', onclick: () => navigate(`/trip/${trip.id}`),
  },
    h('div', { class: 'trip-card-main' },
      h('div', { class: 'trip-card-title' }, trip.title || '未命名旅程'),
      h('div', { class: 'muted sm' },
        [trip.region, spots.length ? `${spots.length} 個景點` : null,
         trip.startDate ? `${fmtDate(trip.startDate)}${trip.endDate ? '–' + fmtDate(trip.endDate) : ''}` : null]
          .filter(Boolean).join('　')),
      members.length ? h('div', { class: 'avatars' }, ...members.slice(0, 6).map((m) => avatar(m.displayName, hashHue(m.id)))) : null,
    ),
    ring(p.ratio, { size: 60, label: `${p.done}/${p.total}` }),
  );
}
