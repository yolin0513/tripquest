// 讚（v1.76.0，2026-11-10 投票 (c)＋Yolin 決定）——純函式，不碰 store／DOM，給畫面與測試共用。
//
// 形式：每人每張照片「一筆」紀錄，id 固定 like:<submissionId>:<actorId>，type 'like'。
//   emoji 是字串＝按著那個表情；null＝收回。整筆依 updatedAt 比新舊（跟 phototag 的 tag:<id> 同一條路），
//   不進 merge.js 的 APPEND_ONLY、也不進 TRACKED（likesynctest 有守衛）——所以 Worker 不用改、不用先部署。
//   時間戳交給 store.put 的 stamp：max(now, 舊值+1)，時鐘慢的裝置改了也一定贏過它看過的版本。
//
// 讚數＝「現在按著讚的不同的人」，不是紀錄筆數。所有讀讚的地方都要走 likeSummary，不准再數 .length。
//
// 按表情的三種結果（Yolin 2026-11-10 第 3 題：按另一個表情是「換表情」，不是取消）：
//   沒按過／已收回 ＋ 按任何表情 → 那個表情
//   按著 X ＋ 再按 X           → null（收回）
//   按著 X ＋ 按 Y             → Y（換表情，人數不變）
export const LIKE_TYPE = 'like';
export const LIKE_PREFIX = 'like:';
export const likeId = (submissionId, actorId) => `${LIKE_PREFIX}${submissionId}:${actorId}`;

const isEmoji = (e) => typeof e === 'string' && e !== '';

export function nextEmoji(prevEmoji, pressed) {
  if (!isEmoji(pressed)) throw new Error('nextEmoji：按的表情要是非空字串');
  return isEmoji(prevEmoji) && prevEmoji === pressed ? null : pressed;
}

// records：可迭代的紀錄（store 的全部紀錄或測試造的陣列）
// 回傳 { count, mine, legacy, showCount }
//   count     按著讚的不同的人數（只數 like 紀錄，而且 id 要等於 likeId(照片, 那個人)——id 對不上的不算）
//   mine      我按著的表情；沒按或收回是 null（「我按過」只看新的 like，不看舊的 reaction）
//   legacy    這張照片上有沒有舊式 reaction 紀錄
//   showCount 畫面要不要顯示數字：有人按、而且沒有舊式紀錄
//
// ⚠ 過渡用（Dispatch 2026-11-10 定的中間路線）：照片上只要存在任何舊式 reaction，就不顯示數字。
//   為什麼：v1.75.0 以前的手機按的是舊式 reaction（取消不會同步、同一人可能好幾筆），新版只數 like；
//   兩種混在一張照片上時，只數 like 會顯示一個錯的數字（3 個舊讚＋1 個新讚 → 顯示 1），寧可不顯示。
//   什麼時候可以拿掉：家人的手機都更新到 v1.76.0 以上、而且之後不再有新的 reaction 紀錄產生
//   （查法：所有 reaction 的 createdAt 都早於最後一台手機更新的時間）。拿掉之後，舊行程照片上的舊讚不會被算進數字
//   ——Yolin 2026-11-10 說舊行程的資料不用管，所以那是可接受的。拿掉時連 likenumtest 的「有舊讚就不顯示」三個情境一起改。
export function likeSummary(records, submissionId, me = null) {
  const actors = new Set();
  let mine = null;
  let legacy = false;
  for (const r of records) {
    if (!r || r.submissionId !== submissionId || r.deleted) continue;
    if (r.type === 'reaction') { legacy = true; continue; }
    if (r.type !== LIKE_TYPE || !isEmoji(r.emoji) || !r.actorId) continue;
    if (r.id !== likeId(submissionId, r.actorId)) continue;
    actors.add(r.actorId);
    if (me && r.actorId === me) mine = r.emoji;
  }
  const count = actors.size;
  return { count, mine, legacy, showCount: count > 0 && !legacy };
}
