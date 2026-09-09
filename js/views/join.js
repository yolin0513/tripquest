import { setTop, render } from '../app.js';
import { h, toast, spinnerBox, modal, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';
import { importShareCode, peekShareCode, peekInvite, joinInvite, parseShortInvite, parseInviteText, fetchInviteSummary } from '../share.js';
import { ensureMember } from '../claim.js';
import { isStandalone, platform, shouldOfferInstall } from '../install.js';
import { openInstallGuide } from './installguide.js';

// 由分享連結進入：
//   #/join?g=..&k=..&t=..&n=..[&u=..]  短邀請（v1.58；摘要跟伺服器拿，見 share.js）
//   #/join?j=<code>  舊版同步邀請（整包資料壓在連結裡，繼續相容）
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
  const short = (!syncCode && !copyCode) ? parseShortInvite(query) : null;
  if (!syncCode && !copyCode && !short) { navigate('/', { replace: true }); return; }

  let info;
  if (short) {
    // v1.58 短連結：連結只帶識別碼與行程名。行程名直接畫（0 秒的「這是誰的行程」），
    // 其餘摘要在頁面畫好之後跟伺服器拿——拿不到也**不擋加入**：識別碼都在手上，
    // 加入流程自己有退避重試（見 render 之後那段）。
    info = { sync: true, group: '', title: short.title || '行程', spots: 0, quests: 0, members: 0, dates: [], who: [], preview: [] };
  } else {
    render(h('div', { class: 'page' }, spinnerBox('正在讀這個邀請…', '大行程可能要等一下')));
    try {
      info = syncCode ? await peekInvite(syncCode) : await peekShareCode(copyCode);
    } catch (e) {
      render(h('div', { class: 'page' }, h('div', { class: 'empty' },
        h('p', {}, '這個邀請連結無法解析'),
        h('p', { class: 'form-hint' }, e.message),
        h('button', { class: 'btn btn-soft', onclick: () => navigate('/') }, '回首頁'))));
      return;
    }
  }

  // 群組名稱預設是「<行程名> 旅伴」，跟行程名一起顯示會變成「京都三日遊 旅伴 · 京都三日遊」
  // 這種重複又難讀的字串。名稱已經包含行程名時就只顯示行程名。
  const headingOf = (inf) => {
    const groupName = String(inf.group || '').trim();
    const tripTitle = String(inf.title || '行程').trim();
    return (!groupName || groupName.includes(tripTitle)) ? tripTitle : `${tripTitle}（${groupName}）`;
  };
  // 短連結的摘要是之後才到的：標題與「N 個景點」做成節點，摘要到了原地更新
  const headingEl = h('p', { class: 'muted lg' }, headingOf(info));
  const countEl = h('p', { class: 'sm muted' },
    short ? '正在讀行程內容…' : `${info.spots} 個景點 · ${info.quests} 個拍照任務`);

  const std = isStandalone();
  const p = platform();
  // 只有 iPhone 會「加入之後從主畫面看不到」。Android 的 WebAPK 跟瀏覽器共用
  // 儲存空間，先加入再安裝完全沒問題，不要拿同一套嚇他。
  const iosRisk = !std && p.os === 'ios';

  // 加入：按鈕原地變成進度卡（連線 → 接收 N 筆 → 整理），成功就進行程頁；
  // 失敗不只 toast，卡片留在原地講清楚原因並給「再試一次」
  const progress = h('div', { class: 'join-progress', hidden: true });
  const doJoin = async (btn) => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.hidden = true;
    progress.hidden = false;
    const line = h('div', {}, '連線中…'), sub = h('div', { class: 'jp-sub' }, '通常幾秒就好；大行程最多約 1 分鐘');
    progress.replaceChildren(h('div', { class: 'spinner', style: 'margin:0 auto 8px' }), line, sub);
    try {
      const tripId = (syncCode || short)
        ? await joinInvite(syncCode || short, {
            onProgress: (m) => { line.textContent = m; },
            // 連結指定了非內建的同步伺服器 → 一定要使用者看過主機名再點頭
            confirmHost: async (host) => confirmDialog(
              `這個邀請要把你的資料同步到「${host}」（不是 TripQuest 的預設伺服器）。`
              + '只有在這是你家人自己架的伺服器時才繼續。', { danger: true, okLabel: '我認得，繼續' }),
          })
        : await importShareCode(copyCode);
      line.textContent = '好了，帶你進行程…';
      if ((syncCode || short) && tripId) await ensureMember(tripId, { force: true });   // 「這是誰的手機？」
      navigate(`/trip/${tripId}`, { replace: true });
    } catch (err) {
      progress.replaceChildren(
        h('div', {}, '這次沒加入成功'),
        h('div', { class: 'jp-sub' }, err.message),
        h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:10px', onclick: () => { progress.hidden = true; btn.hidden = false; btn.disabled = false; btn.textContent = original; doJoin(btn); } }, '再試一次'),
      );
    }
  };
  // 行程骨架：日期、誰邀請、前幾個景點。舊 v4 連結自帶（同步渲染）；
  // 短連結是伺服器摘要到了才補進 pvWrap（見 render 之後那段）。
  const fmtDates = (d) => (d && d[0] ? (d[1] && d[1] !== d[0] ? `${d[0]} ～ ${d[1]}` : d[0]) : '');
  const buildPreview = (inf) => {
    const pv = inf.preview || [];
    if (!pv.length && !(inf.who || []).length && !fmtDates(inf.dates)) return null;
    const byDay = new Map();
    for (const x of pv) { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x.n); }
    return h('div', { class: 'join-preview' },
      fmtDates(inf.dates) ? h('div', {}, '📅 ' + fmtDates(inf.dates)) : null,
      (inf.who || []).length ? h('div', { style: 'margin-top:4px' }, '👥 ' + inf.who.join('、') + (inf.members > inf.who.length ? ` 等 ${inf.members} 人` : '')) : null,
      ...[...byDay.keys()].sort((a, b) => a - b).slice(0, 3).map((d) => h('div', {},
        h('div', { class: 'jp-day' }, `第 ${d} 天`),
        ...byDay.get(d).slice(0, 4).map((n) => h('div', { class: 'jp-spot' }, '· ' + n)))),
      pv.length && inf.spots > pv.length ? h('div', { class: 'jp-spot' }, `…還有 ${inf.spots - pv.length} 個景點`) : null,
    );
  };
  const pvWrap = h('div');
  {
    const first = buildPreview(info);
    if (first) pvWrap.append(first);
    else if (short) pvWrap.append(h('div', { class: 'join-preview' }, '⏳ 正在讀行程內容…'));
  }

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
            ? '裝好之後，打開主畫面的 TripQuest，按「貼上邀請連結」就完成了。'
            : '裝好之後，打開主畫面的 TripQuest，按「貼上邀請連結」，把旅伴給你的連結貼進去。',
        });
      },
    }, '① 教我加到主畫面'),
    h('p', { class: 'sm muted center', style: 'margin:10px 0 0' }, '（會順便幫你把邀請連結複製起來）'),
  );

  const page = h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h2', {}, '旅伴邀請你加入'),
      headingEl,
      countEl,
      info.sync ? h('p', { class: 'sm muted' }, '加入後大家的照片會自動同步') : null,
    ),
    pvWrap,
    progress,

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

  // 短連結：摘要（日期／旅伴／景點）在背景跟伺服器拿，到了原地補畫。
  // 三種失敗長相分開講：403＝連結被截斷（重傳才有救）、離線＝等網路就好、
  // 404 與其他＝旅伴的資料還在上傳（退避重試）。無論哪種都不動「加入」按鈕——
  // 識別碼都在連結裡，摘要只是預告片。
  if (short) (async () => {
    const note = (msg) => pvWrap.replaceChildren(h('div', { class: 'join-preview' }, msg));
    const delays = [1500, 3000, 5000, 8000, 12000];
    for (let i = 0; i <= delays.length; i++) {
      if (!document.body.contains(page)) return;      // 使用者已離開這一頁
      try {
        const s = await fetchInviteSummary(short);
        info = { ...info, ...s, group: s.groupName || '', preview: s.preview || [] };
        headingEl.textContent = headingOf(info);
        countEl.textContent = `${info.spots} 個景點 · ${info.quests} 個拍照任務`;
        const box = buildPreview(info);
        pvWrap.replaceChildren();
        if (box) pvWrap.append(box);
        return;
      } catch (e) {
        if (e && e.status === 403) { countEl.textContent = ''; note('這個連結好像不完整（複製時可能少了幾個字）。請旅伴長按整段重新傳一次。'); return; }
        note(navigator.onLine === false
          ? '📶 現在沒有網路——行程內容連上網就會出現。'
          : '⏳ 旅伴的行程還在上傳，馬上就好…');
        if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
    countEl.textContent = '';
    note('行程內容暫時讀不到，不影響加入——按下面的按鈕就可以開始。');
  })();

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
  if (!/[?&][jd]=/.test(t) && !parseInviteText(t) && !/^[A-Za-z0-9_\-=]{24,}$/.test(t)) return null;
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
