// 回顧影片「預告片」風格的拍點表（v1.97.0；規劃 docs/DESIGN_回顧影片預告片風格.md 第 2、3.2、5 節）
//
// 純函式：不碰畫面、不讀行程資料。畫面（js/trailer.js）與配樂（js/music.js 的 createTrailerScore）讀同一份，
// 所以切點一定落在配樂的拍子上——兩邊各算一份，改了一邊忘了另一邊，就會差一拍。
//
// 一拍 0.6 秒（100 bpm）。每一個鏡頭的起點都是整數拍。完整版（照片 ≥ 33 張）121 拍＝72.6 秒：
//   冷開場 8 → 出品卡 4 → 鋪陳 32（6 張×4 拍＋2 張字卡×4 拍）→ 加速 32（6 張×3 拍＋4 張×2 拍＋路線 6 拍）
//   → 高潮快剪 16（16 張×1 拍）＋全黑 2 → 片名卡 10 → 彩蛋 7 → 片尾字卡 10
// 照片不夠：先縮快剪、再縮加速，不重複用同一張；少於 MIN_PHOTOS 張不提供（畫面照實寫）。
// 平穩版（減少動態效果）：加速每張 3 拍、快剪每張 3 拍（≥ 1.5 秒）、張數跟著變少；沒有白閃。

export const BPM = 100;
export const BEAT = 60 / BPM;          // 0.6 秒
export const MIN_PHOTOS = 8;           // 照片少於這個數不提供預告片（規劃第 2 節；合成資料試過：8 張＝鋪陳 6＋加速 1＋彩蛋 1）
export const FULL = Object.freeze({ build: 6, accel: 10, montage: 16 });
export const NEED = FULL.build + FULL.accel + FULL.montage + 1;   // 33（＋1 是彩蛋）

const SEC_BEATS = Object.freeze({ cold: 8, studio: 4, buildPhoto: 4, card: 4, route: 6, silence: 2, title: 10, egg: 7, end: 10 });
const ACCEL_BEATS = 32;
const MONTAGE_BEATS = 16;
const CALM_BEATS = 3;                  // 平穩版每張 3 拍＝1.8 秒（規劃第 5 節：至少 1.5 秒）

// n：序列裡的照片數（不含彩蛋）；days：每一張的「第幾天」（換天用）；route：有沒有路線段；
// cards：鋪陳要穿插的字卡（['members', 'days'] 的子集合，資料沒有就不放）；calm：平穩版
export function planTrailer({ n, days = [], route = false, cards = ['members', 'days'], calm = false }) {
  // 這一道與 js/trailer.js 的 all.length < MIN_PHOTOS（trailerInfo、buildTrailer 各一處）互為備援：單獨移除任一道不會讓任何測試紅，
  // 移除前要確認另一道仍在（兩道一起動的是 mut_trailer1119.json「門檻 8 → 7」那條）
  if (!(n >= MIN_PHOTOS - 1)) return null;
  const build = Math.min(FULL.build, n);
  const rest = n - build;
  let accel = Math.min(FULL.accel, rest);
  let montage = Math.min(FULL.montage, rest - accel);

  const shots = [];
  let b = 0;
  const push = (s) => { s.b0 = b; s.t0 = b * BEAT; s.dur = s.beats * BEAT; shots.push(s); b += s.beats; };

  push({ kind: 'cold', section: 'cold', beats: SEC_BEATS.cold });
  push({ kind: 'studio', section: 'studio', beats: SEC_BEATS.studio });

  // 鋪陳：P P 字卡 P P 字卡 P P（照片少時字卡排到照片後面）
  let pi = 0;
  const cardAt = [2, 4];
  for (let k = 0; k < build; k++) {
    push({ kind: 'photo', section: 'build', idx: pi++, beats: SEC_BEATS.buildPhoto, dip: true });
    const ci = cardAt.indexOf(k + 1);
    if (ci >= 0 && cards[ci]) push({ kind: 'card', section: 'build', card: cards[ci], beats: SEC_BEATS.card });
  }
  for (let ci = 0; ci < cards.length; ci++) {
    if (cardAt[ci] > build && cards[ci]) push({ kind: 'card', section: 'build', card: cards[ci], beats: SEC_BEATS.card });
  }

  // 加速：一般版前面 3 拍、最後 4 張 2 拍；路線段插在中間
  const routeBeats = route ? SEC_BEATS.route : 0;
  if (calm) accel = Math.min(accel, Math.floor((ACCEL_BEATS - routeBeats) / CALM_BEATS));
  const accelStart = shots.length;
  const accelBeats = (k) => (calm ? CALM_BEATS : (k >= accel - Math.min(accel, 4) ? 2 : 3));
  const routeAfter = Math.ceil(accel / 2);
  for (let k = 0; k < accel; k++) {
    if (route && k === routeAfter) push({ kind: 'route', section: 'accel', beats: routeBeats });
    push({ kind: 'photo', section: 'accel', idx: pi++, beats: accelBeats(k) });
  }
  if (route && accel === routeAfter) push({ kind: 'route', section: 'accel', beats: routeBeats });
  // 換天的地方切黑一拍：那張照片的最後一拍是黑的（照片 ≥ 2 拍才做，至少留一拍畫面）
  for (let s = accelStart; s < shots.length; s++) {
    const a = shots[s];
    if (a.kind !== 'photo') continue;
    let nx = null;
    for (let j = s + 1; j < shots.length; j++) if (shots[j].kind === 'photo') { nx = shots[j]; break; }
    if (nx && a.beats >= 2 && days[a.idx] != null && days[nx.idx] != null && days[a.idx] !== days[nx.idx]) a.blackTail = true;
  }

  // 高潮快剪：一般版每張 1 拍、硬切，偶數張的下拍白閃（每 2 拍最多一次）；平穩版每張 3 拍、沒有白閃
  if (calm) montage = Math.min(montage, Math.floor(MONTAGE_BEATS / CALM_BEATS));
  for (let k = 0; k < montage; k++) {
    push({ kind: 'photo', section: 'montage', idx: pi++, beats: calm ? CALM_BEATS : 1, flash: !calm && k % 2 === 0, dip: calm });
  }
  if (montage > 0) push({ kind: 'black', section: 'silence', beats: SEC_BEATS.silence });

  push({ kind: 'title', section: 'title', beats: SEC_BEATS.title });
  push({ kind: 'egg', section: 'egg', beats: SEC_BEATS.egg });
  push({ kind: 'end', section: 'end', beats: SEC_BEATS.end });

  // 段落（配樂與測試讀這一份）
  const sections = [];
  for (const s of shots) {
    const last = sections[sections.length - 1];
    if (last && last.name === s.section) { last.b1 = s.b0 + s.beats; continue; }
    sections.push({ name: s.section, b0: s.b0, b1: s.b0 + s.beats });
  }
  const flashes = shots.filter((s) => s.flash).map((s) => s.t0);
  return {
    shots, sections, flashes, calm,
    beats: b, total: b * BEAT,
    used: { build, accel, montage, egg: 1 },
    photos: pi,
  };
}

// 第 t 秒落在哪一個鏡頭（二分搜尋；t 超出範圍就夾在頭尾）
export function shotAt(plan, t) {
  const s = plan.shots;
  let lo = 0, hi = s.length - 1;
  if (t <= 0) return s[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t0 <= t + 1e-9) lo = mid; else hi = mid - 1;
  }
  return s[lo];
}
