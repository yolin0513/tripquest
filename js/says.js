// 吉祥物講一句短話（v1.87.0；Yolin：「吉祥物對話框可以實際放進 App 了」）。
// 在對的時候講一句，講的是**畫面上已經確定的事**——旅程的日期、Open-Meteo 的預報、任務的完成數；
// 沒有把握的不講（設計原則：猜出來的東西不准變成使用者看得到的字）。每句誰說、什麼時候講，表在 STATUS。
//
// 規矩：
//   - 不擋操作：跟著版面排（不浮在別的東西上面）；主頁一次最多一句。
//   - 可以關：✕（44px 以上）。關掉的那一句這趟不再講（存本機 localStorage，不同步——講不講是這台手機自己的事）；
//     天氣那兩句照「哪一天」記：今天關掉下雨那句，改天又要下雨會再講。
//   - 出場只動 opacity／transform（淡入、往上 6px）；減少動態效果（glyphs.js 的 reducedMotion）照樣顯示、不動。
//   - 吉祥物一律 aria-hidden；那句話在 role="status" 裡，讀螢幕的軟體念得到。
// 完成任務那一句不在主頁：在慶祝畫面上，由照片上緣探頭的那一隻講（addphoto.js 用 sayOnPeek 做好、交給 ui.js 的 celebrate）。
import { h, mountPeek } from './ui.js';
import { mascot, reducedMotion } from './glyphs.js';

// 主頁那幾句誰講（glyphs.js 的吉祥物種類）：出發、下雨＝雪納瑞（主角、撐傘那一隻）；下雪＝山雀（踩雪板那一隻）；
// 旅程結束＝白熊（行程回顧那一隻）——v1.95.0 起只在卡上沒有小鳳時；平常由「旅程結束了」卡上探頭的小鳳講（CARD_WHO、sayRow 的 onCard）。
// 出發＝雪納瑞：v1.95.0 起拿相機從對話框上緣探頭（trip.js 給 peek），圖載不到才站在左邊。
// 完成任務＝照片上探頭的那一隻（peeks.js 挑的，預設小鳳）。
export const SAY_WHO = Object.freeze({ depart: 'schnauzer', rain: 'schnauzer', snow: 'tit', end: 'bear' });
// 主頁那一句的吉祥物多高（px）：左邊那一隻畫這麼高；下雨／下雪換成探頭圖時，邊線以上也是這麼高（peeks.js 的 peekFit）
export const WHO_PX = 56;
// v1.95.0 結束那一句掛在「旅程結束了」卡上時，講話的是卡上探頭的小鳳（peeks.js 的 DONE_PEEK 那一張）；
// SAY_WHO.end 的北北只在卡上沒有小鳳（peeks.js 載不到）時站在卡片下面講。
export const CARD_WHO = 'cockatiel';

const KEY = (tripId) => 'tripquest.said.' + tripId;
export function saidKeys(tripId) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(tripId)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function markSaid(tripId, key) {
  try {
    const v = saidKeys(tripId).filter((k) => k !== key);
    v.push(key);
    localStorage.setItem(KEY(tripId), JSON.stringify(v.slice(-40)));   // 天氣那兩句每天一個鍵：留最近 40 個就夠
  } catch { /* 存不了：這次關掉，下次打開還會講（不影響別的） */ }
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 出發當天早上：今天就是出發日（手機的日期）、而且還不到中午 12 點
export function departLine(trip, now = new Date()) {
  if (!trip || !trip.startDate || trip.startDate !== ymd(now) || now.getHours() >= 12) return null;
  return { key: 'depart', who: SAY_WHO.depart, text: '今天出發！東西都帶齊了嗎？' };
}
// 旅程結束：結束日過了（跟主頁「旅程結束了」那張卡同一條 tripEnded，由呼叫的一方判斷）
export function endLine(ended) {
  return ended ? { key: 'end', who: SAY_WHO.end, text: '這趟旅程結束了，辛苦啦！' } : null;
}
// 下雨／下雪：跟天氣條同一個判斷（weather.js 的 dayAlert：旅程中看今天、還沒出發看出發那天；下雪優先）。
// 預報是機率，所以講「可能」；數字天氣條上已經有，這裡不重複。
export function weatherLine(alert, today) {
  if (!alert || !alert.day || !SAY_WHO[alert.kind]) return null;
  const isToday = alert.day.date === today;
  const text = alert.kind === 'snow'
    ? (isToday ? '今天可能會下雪，穿暖一點、走路慢慢來！' : '出發那天可能會下雪，保暖的衣服記得帶！')
    : (isToday ? '今天可能會下雨，傘帶了嗎？' : '出發那天可能會下雨，傘先放進行李吧！');
  // peek：講話的換成哪一張探頭圖（peeks.js 的 WEATHER_PEEK 的鍵；v1.87.1 Yolin 看 v1.87.0 實機——下雨那句要配撐傘那一隻）。
  // 這支不 import peeks.js（圖用到時才載），由呼叫的一方（trip.js 的 fillWeather）載圖、做好交給 sayRow。
  return { key: `${alert.kind}:${alert.day.date}`, who: SAY_WHO[alert.kind], text, peek: alert.kind };
}
// 完成任務那一句（慶祝畫面，照片上探頭的那一隻講）：講的是完成數，不評論照片
export function doneLine(allDone) {
  return allDone ? '全部拍完了，辛苦啦！' : '下一個也一起拍吧！';
}

// 主頁的一句：左邊一隻小的吉祥物、右邊一個對話框、最右邊 ✕。已經關過的那一句回 null（不放）。
// animate：淡入那一下只在真的導覽進主頁時做；主頁自己重畫（同步進來、換了現在這一站）時直接出現，不會每重畫一次就閃一次。
// peek：探頭圖（peeks.js 做好的 <svg>；下雨＝鬍鬍撐傘、下雪＝山雀踩雪板）。有的話不放左邊那一隻、對話框沒有尾巴，
//   牠從對話框上緣探頭、手扣在框上——跟天氣頁出門提醒卡同一種擺法（v1.87.1）。圖載不到時呼叫的一方給 null，照舊是左邊那一隻。
// onCard（v1.95.0，吉祥物融入介面第一版）：卡片上緣已經有一隻探頭（主頁「旅程結束了」那張卡的小鳳），由牠講——
//   不放左邊那一隻；整列放進卡片、絕對定位在卡片上緣上面、小鳳的左邊（--say-right 讓出牠的寬度），對話框的尾巴朝右指向牠；
//   ✕ 移到最左邊（尾巴那一側要貼著小鳳）。✕ 與「關過的這趟不再講」照舊；關掉之後小鳳還在、只是不講話。
//   卡片上面要留的高度＝max(小鳳露出來的高度, 這一列排出來的高度)——排成幾行要看螢幕寬，放進畫面之後量（roomOnCard）。
export function sayRow(tripId, line, { animate = true, peek = null, onCard = null } = {}) {
  if (!line || saidKeys(tripId).includes(line.key)) return null;
  const text = h('p', { class: 'say-text', role: 'status' }, line.text);
  const el = h('div', { class: 'say' + (peek ? ' say-peek' : '') + (onCard ? ' say-card' : ''), dataset: { say: line.key, who: onCard ? CARD_WHO : line.who } },
    peek || onCard ? null : h('span', { class: 'say-who', 'aria-hidden': 'true' }, mascot(line.who, WHO_PX)),
    text,
    h('button', {
      class: 'say-x', type: 'button', 'aria-label': '關掉這句話',
      onclick: () => {
        markSaid(tripId, line.key); el.remove();
        if (onCard) { onCard.classList.remove('has-say'); onCard.style.marginTop = ''; }
      },
    }, '✕'));
  if (peek) mountPeek(text, peek);
  if (onCard) {
    const pw = parseFloat(onCard.querySelector(':scope > .gl-peek')?.getAttribute('width')) || 0;
    el.style.setProperty('--say-right', `${Math.round(pw) + 18}px`);
    onCard.classList.add('has-say');
    onCard.append(el);
    roomOnCard(onCard, el);
  }
  if (animate && !reducedMotion()) el.classList.add('say-in');
  return el;
}

// 卡片上面留多高（onCard 那一列）：放進畫面之後量那一列的高度；轉螢幕、字級改了跟著重算；那一列不在畫面上了（換頁、關掉）就停。
// 只改版面、不是動畫。量到之前是 .th-end.has-peek 的「露出高度＋8」；ResizeObserver 在第一次畫之前就回呼，畫面上看不到那一格。
// CSS 刻意不寫保底高度：保底夠高的話這支壞了不會有測試紅（saytest S11b 的「整列在頁面裡」靠這支才成立）。
// 跟 ui.js 的 roomForSay 同一個想法，但這一列是在畫進畫面「之前」做好的——一開始不在畫面上是正常的，要等它第一次出現才算數。
function roomOnCard(card, el) {
  if (typeof ResizeObserver === 'undefined') return;
  const rise = parseFloat(card.style.getPropertyValue('--pk-rise')) || 0;
  let seen = false;
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) { if (seen) ro.disconnect(); return; }
    seen = true;
    card.style.marginTop = `${Math.ceil(Math.max(rise + 8, el.offsetHeight + 12))}px`;
  });
  ro.observe(el);
}

// 慶祝畫面上的那一句：沒有自己的吉祥物——講話的是照片上緣探頭的那一隻，對話框放在牠的右邊、尾巴指向牠。
// 慶祝畫面本身 2.2 秒自己關、或按按鈕關，這一句跟著一起關，所以沒有 ✕。
export function sayOnPeek(text, peekEl) {
  const w = parseFloat(peekEl && peekEl.getAttribute('width')) || 0;
  const el = h('p', { class: 'say-text say-pk', role: 'status', style: `--say-off:${Math.round(w / 2) + 6}px` }, text);
  if (!reducedMotion()) el.classList.add('say-in');
  return el;
}
