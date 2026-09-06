import { setTop, render } from '../app.js';
import { h, toast, spinnerBox, modal } from '../ui.js';
import { navigate } from '../router.js';
import { importShareCode, peekShareCode, peekInvite, joinInvite } from '../share.js';
import { ensureMember } from '../claim.js';
import { isStandalone, platform, shouldOfferInstall } from '../install.js';
import { openInstallGuide } from './installguide.js';

// 由分享連結進入：
//   #/join?j=<code>  同步邀請（加入同一個群組）
//   #/join?d=<code>  任務清單（複製一份，單機）
//
// iPhone 的坑（Apple 官方說法，見 js/install.js 的註解）：主畫面 App 與 Safari
// 的儲存空間是分開的。在 Safari 加入之後把網頁加到主畫面，從主畫面打開就是一個
// 全新的空 App —— 旅程「不見了」。而且主畫面圖示打開的是 manifest 的 start_url，
// 不是這個帶邀請碼的網址，所以連自動重加的機會都沒有。
// 所以 iPhone 上把順序倒過來：**先裝、再加入**，並且把邀請連結複製到剪貼簿當橋。
export default async function join(query) {
  setTop({ title: '加入旅程', back: false });
  const syncCode = query.j;
  const copyCode = query.d;
  if (!syncCode && !copyCode) { navigate('/', { replace: true }); return; }

  render(h('div', { class: 'page' }, spinnerBox('正在讀這個邀請…', '大行程可能要等一下')));

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

  const std = isStandalone();
  const p = platform();
  // 只有 iPhone 會「加入之後從主畫面看不到」。Android 的 WebAPK 跟瀏覽器共用
  // 儲存空間，先加入再安裝完全沒問題，不要拿同一套嚇他。
  const iosRisk = !std && p.os === 'ios';

  const doJoin = async (btn) => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '加入中…（大行程最多約 1 分鐘，請稍候）';
    try {
      const tripId = syncCode ? await joinInvite(syncCode) : await importShareCode(copyCode);
      toast('已加入！');
      if (syncCode && tripId) await ensureMember(tripId, { force: true });   // 「這是誰的手機？」
      navigate(`/trip/${tripId}`, { replace: true });
    } catch (err) {
      toast('加入失敗：' + err.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  // 兩邊儲存空間不通，剪貼簿是唯一過得去的橋 —— 裝好 App 之後靠它把邀請帶過去
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(location.href); return true; } catch { return false; }
  };

  const installFirst = h('div', { class: 'join-install' },
    h('div', { class: 'join-install-t' }, '📲 iPhone 請先把 App 加到主畫面'),
    h('p', { class: 'join-install-p' },
      'iPhone 規定：主畫面的 App 跟 Safari 的資料是分開的。'
      + '如果現在直接在這裡加入，之後從主畫面打開會看不到這個旅程。'),
    h('button', {
      class: 'btn btn-primary btn-block btn-big',
      onclick: async () => {
        const okCopy = await copyInvite();
        await openInstallGuide({
          why: okCopy ? '邀請連結已經複製起來了，裝好之後用得到。' : '',
          after: okCopy
            ? '裝好之後，打開主畫面的 TripQuest，按最上面的「貼上邀請連結」就完成了。'
            : '裝好之後，打開主畫面的 TripQuest，按最上面的「貼上邀請連結」，把旅伴給你的連結貼進去。',
        });
      },
    }, '① 教我加到主畫面'),
    h('p', { class: 'sm muted center', style: 'margin:10px 0 0' }, '（會順便幫你把邀請連結複製起來）'),
  );

  const page = h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '旅伴邀請你加入'),
      h('p', { class: 'muted lg' }, heading),
      h('p', { class: 'sm muted' }, `${info.spots} 個景點 · ${info.quests} 個拍照任務`),
      info.sync ? h('p', { class: 'sm muted' }, '加入後大家的照片會自動同步') : null,
    ),

    iosRisk ? installFirst : null,

    h('button', {
      class: iosRisk ? 'btn btn-soft btn-block' : 'btn btn-primary btn-block btn-big',
      onclick: (e) => doJoin(e.currentTarget),
    }, iosRisk ? '② 我只想在 Safari 用，直接加入' : '加入這個旅程'),

    // Android／桌機：加入照樣安全（儲存空間共用），安裝只是方便，所以放後面、講法也軟
    (!iosRisk && !std && shouldOfferInstall())
      ? h('button', {
          class: 'btn btn-ghost btn-block',
          onclick: () => openInstallGuide({ after: '裝好之後，主畫面就會有 TripQuest 的圖示。' }),
        }, '📲 順便把 App 放到主畫面')
      : null,

    h('button', { class: 'btn btn-ghost btn-block', onclick: () => navigate('/') }, '先不要'),
    h('p', { class: 'form-hint center' }, info.sync
      ? '你的照片會存在自己手機，也會同步一份到旅伴共用的伺服器。'
      : '加入後會在你的裝置建立一份任務清單，照片只留在自己手機。'),
  );
  render(page);

  // 第一次點連結就主動跳引導。先讓他看到「誰邀請我、什麼行程」再跳，
  // 不然一進來就是一個不知道在講什麼的對話框。
  // 已經是主畫面 App、或按過「不要再提醒」就不跳。
  if (!std && shouldOfferInstall() && (iosRisk || !p.canInstall)) {
    setTimeout(async () => {
      if (!document.body.contains(page)) return;      // 使用者已經離開這一頁
      const okCopy = await copyInvite().catch(() => false);
      await openInstallGuide({
        why: !p.canInstall
          ? `你是用 ${p.label} 開這個連結的，這個畫面沒辦法把 App 加到主畫面。`
          : 'iPhone 的主畫面 App 跟 Safari 資料是分開的，先裝好再加入才不會弄丟。',
        after: okCopy ? '邀請連結已經幫你複製起來了。裝好之後打開 TripQuest，按「貼上邀請連結」就完成。' : '',
      });
    }, 700);
  }
}

// 首頁的「貼上邀請連結」用：先試剪貼簿，看起來像邀請就問一句要不要用。
// iPhone 的 readText() 會跳一顆系統的「貼上」確認鈕，那一下是 Apple 規定的，跳不掉。
export async function inviteFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { text = ''; }
  const t = String(text || '').trim();
  if (!/[?&][jd]=/.test(t) && !/^[A-Za-z0-9_\-=]{24,}$/.test(t)) return null;
  const ok = await modal({
    title: '找到一個邀請連結',
    body: h('div', {},
      h('p', { style: 'margin:0 0 8px' }, '要用剪貼簿裡的這個連結加入嗎？'),
      h('p', { class: 'sm muted', style: 'word-break:break-all;margin:0' },
        t.slice(0, 90) + (t.length > 90 ? '…' : ''))),
    actions: [{ label: '不是這個', value: false }, { label: '就是它', value: true, primary: true }],
  });
  return ok ? t : null;
}
