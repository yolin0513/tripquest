// 等動畫：peektest、mascottest 共用的等待函式（2026-11-21；Dispatch 00:5x：「peektest 和 mascottest 用同一個等待函式，不要各寫一份」）
//
// 為什麼（.logs/v1100/diagP9.mjs，2026-11-21 00:33 那一場的實測）：
//   - 撐傘／E：「一出來就量」的時候，動畫常常還在等起跑——慶祝畫面那 4 張 20 次裡 19 次第一次取位置時 pending true、startTime null、
//     currentTime 0（第二次才起跑）。2203 那次撐傘兩次都停在 0、時間軸卻走了 200ms，照 Web Animations 的算法只有還沒起跑才會這樣（推論）。
//     → 量之前先等每一段真的起跑（until 'ready'）。
//   - P9：原本截圖前對每一段動畫 finish()，從半途跳到最後；那 9 次截圖都跟穩定的畫面不同（0.33～2.28 畫素），自己播完的那 1 次只差 0.22。
//     → 改成等每一段自己播完（until 'finished'），不呼叫 finish()。
//
// waitAnimsIn(target, until, ms)：可以在頁面裡跑（page.evaluate 直接傳這個函式，不經 eval），也可以在 node 裡跑（對照組傳假的動畫物件）。
//   target：選擇器字串（找那張圖，等它和它裡面每一段動畫），或一組動畫物件。
//   until：'ready'＝等每一段起跑（Animation.ready 兌現、pending 變 false）；'finished'＝等每一段自己播完（Animation.finished 兌現）。
//   ms：最多等幾毫秒。等不到回 timeout true——呼叫的地方一律當「這一次沒量到」，不能當成綠（用下面的 waitedOk 判）。
//   回傳的標記（通過時也印：§5.20）：{ until, ms, found, n, before, after, waited, timeout }
//     before／after：等之前、等之後還沒起跑（ready）或還沒播完（finished）的段數；waited：實際等了幾毫秒。
//   timeout 的兩個來源互為備援：Promise 沒在時限內兌現（!done），或兌現了卻還有段數沒到（after > 0）。
//     真的 Animation 兌現時 pending／playState 已經變了，後者在真的頁面上走不到——拿掉它是等價突變，不另配突變（§5.12）；
//     保留它是因為假的物件或瀏覽器的怪行為可能讓兩者不一致，寧可判成沒量到。
export async function waitAnimsIn(target, until, ms) {
  let list = target;
  if (typeof target === 'string') {
    const el = document.querySelector(target);
    list = el ? el.getAnimations({ subtree: true }) : null;
  }
  if (!list) return { until, ms, found: false, n: 0, before: null, after: null, waited: 0, timeout: true };
  const left = () => list.filter((a) => (until === 'ready' ? a.pending : a.playState !== 'finished')).length;
  const t0 = performance.now();
  const before = left();
  let timer = null;
  const done = await Promise.race([
    Promise.all(list.map((a) => (until === 'ready' ? a.ready : a.finished))).then(() => true, () => false),
    new Promise((res) => { timer = setTimeout(() => res(false), ms); }),
  ]);
  clearTimeout(timer);
  const after = left();
  return { until, ms, found: true, n: list.length, before, after, waited: Math.round(performance.now() - t0), timeout: !done || after > 0 };
}

// 在頁面裡等（puppeteer 的 page）
export const waitAnims = (page, sel, until, ms) => page.evaluate(waitAnimsIn, sel, until, ms);

// 判定：這個標記算不算「等到了」。等不到、標記不在（等待被拿掉）、找不到圖、等的不是要的那一種，一律 false＝這一次沒量到。
export const waitedOk = (w, until) => !!w && w.found === true && w.until === until && !w.timeout && w.after === 0;

// 印在斷言訊息裡的那一段
export const waitBrief = (w) => (!w ? '沒等（標記不在）'
  : !w.found ? '找不到那張圖'
  : `等${w.until === 'ready' ? '起跑' : '播完'}：${w.n} 段、等之前 ${w.before} 段沒${w.until === 'ready' ? '起跑' : '播完'}、等之後 ${w.after} 段、等了 ${w.waited}ms（最多 ${w.ms}ms）${w.timeout ? '、逾時' : ''}`);
