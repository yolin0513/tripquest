// 「加到主畫面」的圖示化教學。
//
// 長輩做不到的是「找到分享按鈕、往下捲、找到加入主畫面」這一串。所以這裡不寫
// 一段文字了事 —— 每一步一張大圖示、一句話，而且**先認出他現在是用什麼開的**：
// 從 LINE 點進來的畫面根本沒有那顆分享按鈕，教他按也按不到。
//
// **不要寫死位置**。使用者實機回報：我們寫「右上角的三個點」，他的 LINE 上
// 是在右下角。第三方 App 的介面會隨版本、機型、系統設定改變，寫死位置只會
// 讓人在錯的地方找。一律改成描述按鈕**長什麼樣子**與**功能叫什麼名字**，
// 再給一句「找不到就請家人幫忙」的退路。

import { h, modal, toast } from '../ui.js';
import { platform, canPromptInstall, promptInstall, dismissGuide, ICONS } from '../install.js';

// 每一份教學最後都給一句退路。長輩找不到按鈕時最需要的不是更多說明，
// 是「這不是你的問題，找人幫忙就好」。
function helpLine(where) {
  return h('p', { class: 'ig-help' },
    `找不到也沒關係 —— 請家人幫忙用 ${where} 開一次就好。`
    + '也可以先不管它，直接按下面的「直接加入」照樣能用。');
}

function step(n, icon, title, sub) {
  return h('div', { class: 'ig-step' },
    h('span', { class: 'ig-num' }, String(n)),
    h('span', { class: 'ig-ic' }, icon),
    h('span', { class: 'ig-txt' },
      h('span', { class: 'ig-t' }, title),
      sub ? h('span', { class: 'ig-s' }, sub) : null),
  );
}

// 這個環境根本不能加到主畫面（LINE/FB/IG 的內建瀏覽器，或 iPhone 上的 Chrome）
// —— 先請他換到真正能裝的瀏覽器，不要教他按一顆不存在的按鈕。
function cannotInstallBody(p, showWarn) {
  const where = p.os === 'ios' ? 'Safari' : '瀏覽器';
  const how = p.inApp
    ? `你現在是用 ${p.inApp} 裡面的瀏覽器看這一頁，這裡沒辦法把 App 加到主畫面。`
    : `iPhone 上只有 Safari 可以把 App 加到主畫面，${p.label} 不行。`;
  return h('div', {},
    showWarn ? h('div', { class: 'ig-warn' }, how) : null,
    p.inApp
      ? step(1, ICONS.dotsIcon(), '找「⋯」或「⋮」的按鈕', '在畫面的角落，位置每個版本不一樣')
      : step(1, h('span', { class: 'ig-emoji' }, '🔗'), '把這一頁的網址複製起來', ''),
    step(2, h('span', { class: 'ig-emoji' }, '🧭'),
      p.inApp ? `選「用 ${where} 開啟」` : `打開 ${where}，把網址貼上去`,
      p.inApp ? '也可能寫「用其他瀏覽器開啟」或「在瀏覽器中開啟」' : ''),
    step(3, h('span', { class: 'ig-emoji' }, '↩️'), `${where} 打開之後，會接著教你加到主畫面`, '同一頁會再跳一次說明'),
    helpLine(where),
  );
}

function iosBody() {
  return h('div', {},
    step(1, ICONS.shareIcon(), '按「分享」', '一個方框加上往上的箭頭，長這樣 ↗'),
    step(2, h('span', { class: 'ig-emoji' }, '👆'), '在選單裡找「加入主畫面」', '清單有點長，要滑一下'),
    step(3, ICONS.plusBoxIcon(), '按「新增」', '主畫面就會多一個 TripQuest 圖示'),
    helpLine('Safari'),
  );
}

function androidBody() {
  return h('div', {},
    step(1, ICONS.dotsIcon(), '按「⋮」選單', '三個點排成一直線'),
    step(2, ICONS.plusBoxIcon(), '選「安裝應用程式」或「加到主畫面」', '兩種寫法都可能'),
    step(3, h('span', { class: 'ig-emoji' }, '✅'), '按「安裝」', '主畫面就會多一個 TripQuest 圖示'),
    helpLine('Chrome'),
  );
}

// opts.why：為什麼現在要裝（邀請流程會帶一句 iPhone 的資料分開的說明）
// opts.after：裝好之後要做什麼（邀請流程會說「按貼上邀請連結」）
export async function openInstallGuide({ why = '', after = '' } = {}) {
  const p = platform();

  // Android 有系統安裝對話框就別教了，直接一顆按鈕
  if (p.os === 'android' && canPromptInstall() && !p.inApp) {
    const go = await modal({
      title: '把 TripQuest 裝到主畫面',
      body: h('div', {},
        why ? h('div', { class: 'ig-warn' }, why) : null,
        h('p', { style: 'margin:0 0 6px' }, '按下面的按鈕，手機會問你要不要安裝，按「安裝」就好。'),
        after ? h('p', { class: 'sm muted', style: 'margin:10px 0 0' }, after) : null),
      actions: [{ label: '以後再說', value: false }, { label: '現在安裝', value: true, primary: true }],
    });
    if (!go) return false;
    const r = await promptInstall();
    if (r === 'accepted') { toast('安裝好了，看一下主畫面 🎉'); return true; }
    return false;
  }

  // why 已經講過原因時，body 裡就不要再講一次同樣的話
  const body = !p.canInstall ? cannotInstallBody(p, !why) : (p.os === 'ios' ? iosBody() : androidBody());
  const res = await modal({
    title: !p.canInstall ? `先用${p.os === 'ios' ? ' Safari ' : '瀏覽器'}打開` : '把 TripQuest 加到主畫面',
    body: h('div', { class: 'ig-wrap' },
      why ? h('div', { class: 'ig-warn' }, why) : null,
      body,
      after ? h('p', { class: 'ig-after' }, after) : null),
    actions: [{ label: '不要再提醒', value: 'never' }, { label: '知道了', value: true, primary: true }],
  });
  if (res === 'never') { dismissGuide(); toast('好，不再提醒'); }
  return res === true;
}

// 首頁／邀請頁用的橫幅（可關掉）
export function installBanner({ onOpen, onClose }) {
  const p = platform();
  const bar = h('div', { class: 'ig-banner' },
    h('span', { class: 'ig-banner-ic' }, '📲'),
    h('span', { class: 'ig-banner-txt' },
      h('b', {}, '把 TripQuest 放到主畫面'),
      h('span', { class: 'sm muted' }, !p.canInstall ? `現在是用 ${p.label} 開的，要先換到${p.os === 'ios' ? ' Safari' : '瀏覽器'}` : '下次一按就開，也比較不會弄丟資料')),
    h('button', { class: 'btn btn-sm btn-primary', onclick: onOpen }, '怎麼做'),
    h('button', { class: 'ig-banner-x', 'aria-label': '關閉', onclick: () => { dismissGuide(); onClose && onClose(); } }, '×'),
  );
  return bar;
}
