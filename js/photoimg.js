// 投稿照片的顯示元件。
//
// 為什麼需要它（使用者實機回報，已在 scripts/synctest.mjs 重現）：
// 照片牆上出現三則「媽媽 拍的」，有標題、有按讚鈕、有留言框，**照片本身完全沒有**
// —— 不是破圖，是連位置都沒有。原因有兩層：
//
//   ① 照片牆去要的是 `sub.photoHash`（**全圖**）。但同步的分層設計是
//      「縮圖全部立即同步，全圖延遲抓」（見 outbox.js 開頭）—— 媽媽那 2MB 的全圖
//      還卡在上傳佇列（或上傳失敗）時，爸爸這邊記錄已經同步到了，全圖卻還不存在。
//   ② 抓不到時 `blobURL()` 回空字串，`<img src="">` 在畫面上是 **0px**。
//      沒有破圖圖示、沒有替代文字、什麼都沒有 —— 使用者看到的是「照片消失了」。
//
// 所以這裡：一律**先用縮圖**（那是同步保證會到的），全圖只當升級；
// 而且 blob 還沒到時要講清楚狀態並給重試，不是默默留白。

import { h } from './ui.js';
import { blobURL } from './photos.js';
import * as db from './db.js';

const localFirst = async (hashes) => {
  for (const hash of hashes) {
    if (!hash) continue;
    const e = await db.getBlob(hash).catch(() => null);
    if (e && e.blob) return blobURL(hash);
  }
  return '';
};

// sub: submission 記錄。回傳一個 <div class="ph">，裡面是 <img> 或狀態。
export function subPhoto(sub, { className = 'fi-photo', alt = '' } = {}) {
  const img = h('img', { class: className, alt, loading: 'lazy', hidden: true });
  const state = h('div', { class: 'ph-state', hidden: true });
  const wrap = h('div', { class: 'ph' }, img, state);
  // 縮圖優先：那是同步保證會到的那一份。全圖有就更好，沒有也照樣看得到照片。
  const order = [sub.thumbHash, sub.photoHash].filter(Boolean);
  let stop = null;
  let busy = false;

  const show = (url) => {
    img.src = url;
    img.hidden = false;
    state.hidden = true;
    if (stop) { stop(); stop = null; }        // 到了就不用再等了
  };
  const say = (text, sub2, retry) => {
    state.hidden = false;
    img.hidden = true;
    state.replaceChildren(
      h('span', { class: 'ph-state-t' }, text),
      sub2 ? h('span', { class: 'ph-state-s' }, sub2) : null,
      retry ? h('button', {
        class: 'btn btn-sm ph-retry', type: 'button',
        onclick: (e) => { e.stopPropagation(); e.preventDefault(); load(true); },
      }, '重新下載') : null,
    );
  };

  async function load(manual = false) {
    if (busy) return;
    busy = true;
    try {
      const local = await localFirst(order);
      if (local) { show(local); return; }

      say('照片下載中…', '', false);
      if (manual) {
        // 按了重試就順便把整個佇列推一次 —— 常常是「伺服器上其實已經有了，
        // 只是這台還沒去拉」。
        try { await (await import('./outbox.js')).drain({ force: true }); } catch { /* noop */ }
        const again = await localFirst(order);
        if (again) { show(again); return; }
      }
      // 直接跟伺服器要（blobURL 內部會 lazyFetch 並存進本機）
      for (const hash of order) {
        const url = await blobURL(hash);
        if (url) { show(url); return; }
      }
      say('照片還沒傳過來', '拍照的人網路好一點就會自動出現', true);
    } finally { busy = false; }
  }

  // blob 之後才到（背景同步、或旅伴終於連上 Wi-Fi）→ 自己補上，不用重開頁面
  const watch = async () => {
    const { onChange } = await import('./outbox.js');
    stop = onChange(() => {
      if (!wrap.isConnected) { if (stop) { stop(); stop = null; } return; }
      if (img.hidden) load();
    });
  };
  load().then(() => { if (img.hidden) watch(); });
  // v1.73.6：這個監聽器以前**從不移除** —— 一張照片一個，一趟 189 張就是 189 個，
  // 每次重畫再累積一輪。它本身是無害的（有 isConnected 守衛），但那是「靠守衛
  // 擋住後果」而不是「不要留下來」。上面的 onChange 已經會自己收（看 stop()），
  // 這一條照同一個做法。
  const onOnline = () => {
    if (!wrap.isConnected) { window.removeEventListener('online', onOnline); return; }
    if (img.hidden) load();
  };
  window.addEventListener('online', onOnline);

  return wrap;
}
