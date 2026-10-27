// 海報 P1 版型（npm run posterlayouttest；秒級、不開瀏覽器）——docs/DESIGN_海報重做.md 第 2、4、5 節
//
// 涵蓋的程式：js/poster/layout.js（版面純函式）、js/poster/index.js（modelFrom、posterPages）、js/tripday.js（dayRoute、weekdayLabel）
// 入口：modelFrom → posterPages，跟 renderPoster／renderPreview 用的是同一條（buildModel 是 modelFrom 接上 store）。
//   L1 張數＝天數＋1（封面一張＋每天一張），不論幾天；第一張是封面
//   L2 每一張的區塊從 0 接到 1350：不重疊、不留縫、不超出；區塊順序固定
//   L3 固定高度：同一種區塊在每一張都一樣高（會收起來的只在「收起來」時把高度讓給指定的那一區）
//   L4 時間軸最多 5 站，多的明寫「還有 N 站」；剛好 5 站不寫
//   L5 時間選填：有填才寫，沒填是空字串（不內插、不補）
//   L6 日期選填：沒有出發日 → 頁首沒有日期、封面沒有日期範圍；有 → 「M/D（週X）」
//   L7 頁首「DAY N」＋「第一站 → 最後一站」（跟行程頁同一支 dayRoute）
//   L8 副標、每天一句：沒有就整區收起來，照片區往上補
//   L9 數字格是數出來的：天數、景點數、照片數
//   L10 同行夥伴最多 6 個頭像，多的寫「＋N 位」；標題是「同行夥伴」不是「今日」
//   L11 照片退回規則：使用者照片 → 示意圖（一定貼「示意圖」）→ 都沒有就色塊＋第一站站名、沒有照片
//   L12 副照片：只放有的、不重複主照片；一張都沒有 → 副照片區收起來
//   L13 頁尾「第 N／M 張」，M 是匯出的總張數
//   L14 整份版面沒有類別名、類別 emoji、每站 emoji、每站介紹
// 畫出來的樣子（尺寸 1080×1350、張數、字對底的對比）在瀏覽器，見 docs/VERIFY_第1批.md F 節。
// 突變見 tools/mutations/mut_posterlayout.json。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s !== './data/themes.json' && !/^\.\/data\/places\/[\w-]+\.json$/.test(s)) throw new Error('posterlayouttest 不供應：' + s);
  const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
const theme = await import('../js/theme.js');
const { modelFrom, posterPages } = await import('../js/poster/index.js');
const L = await import('../js/poster/layout.js');
const T = await theme.loadThemes();

let pass = 0;
const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };
// 找不到那一區（或那一張不存在）回一個標著 missing 的空殼——突變把整張拿掉時，斷言照樣是「紅」而不是整支當掉
const has = (pg, id) => !!(pg && pg.blocks.some((b) => b.id === id));
const blk = (pg, id) => (pg && pg.blocks.find((b) => b.id === id)) || { missing: true, photos: [], rows: [], stats: [], chips: [] };

// 合成行程：名字、日期都是造的。spots 依天、依順序；照片用 subs（使用者拍的）與 heroHash（示意圖）
function build({ days = [], startDate = '', subtitle = '', dayLines = {}, members = 3 } = {}) {
  const spots = [], subsOf = {}, questsOf = {};
  days.forEach((list, di) => list.forEach((sp, k) => {
    const id = `d${di + 1}s${k}`;
    spots.push({ id, name: sp.name || `第${di + 1}天站${k + 1}`, day: di + 1, order: k, startTime: sp.time || '', heroHash: sp.hero || null,
      emoji: T.themes.nature.emoji, blurb: '合成介紹句' });
    questsOf[id] = [{ id: 'q-' + id }];
    subsOf['q-' + id] = (sp.subs || []).map((h) => ({ thumbHash: h }));
  }));
  const mem = Array.from({ length: members }, (_, i) => ({ id: 'm' + i, displayName: '成員' + i }));
  const model = modelFrom({
    trip: { id: 't', groupId: 'g', title: '合成行程', startDate, endDate: startDate ? '2030-01-10' : '' },
    spots, members: mem, aiTx: { subtitle, dayLines },
    questsOf: (sid) => questsOf[sid] || [], submissionsOf: (qid) => subsOf[qid] || [], lookup: null,
  });
  return { model, pages: posterPages(model) };
}
const n = (k, extra = {}) => Array.from({ length: k }, (_, i) => ({ name: `站${i + 1}`, ...extra }));

// 前置：版面常數就是設計稿寫的
yes(L.PW === 1080 && L.PH === 1350 && L.TIMELINE_MAX === 5 && L.CHIPS_MAX === 6, `前置：版面 ${L.PW}×${L.PH}、時間軸最多 ${L.TIMELINE_MAX} 站、頭像最多 ${L.CHIPS_MAX} 個`);

// L1
for (const k of [1, 2, 3, 7]) {
  const { pages } = build({ days: Array.from({ length: k }, () => n(2)) });
  yes(pages.length === k + 1 && pages[0].kind === 'cover' && pages.slice(1).every((p, i) => p.kind === 'day' && p.day === i + 1),
    `L1 ${k} 天 → ${pages.length} 張（封面＋每天一張；第一張是封面）`);
}

// L2／L3：把會收起來的區塊各種組合都造一次
const ORDER_C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], ORDER_D = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
const three = () => [{ name: 'A', subs: ['h1'] }, { name: 'B', subs: ['h2'] }, { name: 'C', subs: ['h3'] }];
const combos = [
  build({ subtitle: '副標', dayLines: { 1: '一句' }, days: [three()] }),   // 全有
  build({ days: [three()] }),                                              // 沒副標、沒一句
  build({ dayLines: { 1: '一句' }, days: [[{ name: 'A', subs: ['h1'] }]] }),              // 有一句、沒副照片
  build({ days: [[{ name: 'A' }]] }),                                                     // 什麼都沒有
];
const allPages = combos.flatMap((c) => c.pages);
const tiles = (pg) => {
  let y = 0;
  for (const b of pg.blocks) { if (b.y !== y || !(b.h > 0)) return false; y += b.h; }
  return y === L.PH;
};
const ordered = (pg) => {
  const ids = pg.blocks.map((b) => b.id), ord = pg.kind === 'cover' ? ORDER_C : ORDER_D;
  return ids.every((id, i) => i === 0 || ord.indexOf(id) > ord.indexOf(ids[i - 1])) && ids.every((id) => ord.includes(id));
};
yes(allPages.length === 8 && allPages.every(tiles), `L2 ${allPages.length} 張（4 種收起來的組合）每一張都從 0 接到 ${L.PH}、不重疊不留縫`);
yes(allPages.every(ordered), 'L2 區塊順序固定（C1→C7、D1→D6）');
const heights = {};
for (const pg of allPages) for (const b of pg.blocks) (heights[b.id] = heights[b.id] || new Set()).add(b.h);
const fixed = ['C1', 'C2', 'C3', 'C5', 'C6', 'C7', 'D1', 'D4', 'D5', 'D6'];
yes(fixed.every((id) => heights[id] && heights[id].size === 1),
  `L3 不會被讓高度的區塊在每一張都一樣高（${fixed.map((id) => id + '=' + [...(heights[id] || [])].join('/')).join(' ')}）`);
const full = combos[0].pages, bare = combos[3].pages;
yes(blk(full[0], 'C4').h === 640 && blk(combos[1].pages[0], 'C4').h === 700, `L3 C4 只在副標收起來時變高（${blk(full[0], 'C4').h} → ${blk(combos[1].pages[0], 'C4').h}）`);
yes(blk(full[1], 'D2').h === 590 && blk(bare[1], 'D2').h === 900, `L3 D2 只在副照片與每天一句都收起來時吃滿（${blk(full[1], 'D2').h} → ${blk(bare[1], 'D2').h}）`);

// L4
const tl = (k) => blk(build({ days: [n(k)] }).pages[1], 'D5');
const t5 = tl(5), t6 = tl(6), t12 = tl(12);
yes(t6.rows.length === 5 && t6.more === 1 && t6.moreText === '還有 1 站', `L4 一天 6 站 → 時間軸 5 行＋「${t6.moreText}」`);
yes(t12.rows.length === 5 && t12.moreText === '還有 7 站', `L4 一天 12 站 → 5 行＋「${t12.moreText}」`);
yes(t5.rows.length === 5 && t5.more === 0 && t5.moreText === '', `L4 剛好 5 站 → 5 行、不寫「還有」（實得「${t5.moreText}」）`);
yes(t6.rows.map((r) => r.name).join() === '站1,站2,站3,站4,站5', `L4 列出來的是前 5 站、照順序（${t6.rows.map((r) => r.name).join('、')}）`);

// L5
const tt = blk(build({ days: [[{ name: 'A', time: '09:30' }, { name: 'B' }, { name: 'C', time: '14:00' }]] }).pages[1], 'D5');
yes(tt.rows.map((r) => r.time).join('|') === '09:30||14:00', `L5 有填才寫時間、沒填是空的，不內插（實得 ${tt.rows.map((r) => r.time || '（空）').join('、')}）`);

// L6
const noDate = build({ days: [n(1), n(1)] }), withDate = build({ startDate: '2030-01-04', days: [n(1), n(1)] });
yes(blk(noDate.pages[1], 'D1').date === '' && blk(noDate.pages[0], 'C2').dateRange === '',
  `L6 沒有出發日 → 頁首沒有日期、封面沒有日期範圍（實得「${blk(noDate.pages[1], 'D1').date}」「${blk(noDate.pages[0], 'C2').dateRange}」）`);
yes(blk(withDate.pages[1], 'D1').date === '1/4（週五）' && blk(withDate.pages[2], 'D1').date === '1/5（週六）',
  `L6 出發日 2030-01-04 → 第 1 天「${blk(withDate.pages[1], 'D1').date}」、第 2 天「${blk(withDate.pages[2], 'D1').date}」`);
yes(L.dayDateLabel('2030-02-30', 1) === '' && L.dayDateLabel('', 1) === '', 'L6 不存在的日期、空的出發日 → 不寫（不猜）');

// L7
const route = build({ days: [[{ name: '甲' }, { name: '乙' }, { name: '丙' }], [{ name: '丁' }]] });
yes(blk(route.pages[1], 'D1').dayTag === 'DAY 1' && blk(route.pages[1], 'D1').route === '甲 → 丙' && blk(route.pages[2], 'D1').route === '丁',
  `L7 頁首「${blk(route.pages[1], 'D1').dayTag}」＋「${blk(route.pages[1], 'D1').route}」；只有一站就是站名（「${blk(route.pages[2], 'D1').route}」）`);

// L8
yes(has(full[0], 'C3') && blk(full[0], 'C3').text === '副標' && !has(combos[1].pages[0], 'C3'), 'L8 有副標才有 C3；沒有就整區收起來');
yes(has(full[1], 'D4') && !has(combos[1].pages[1], 'D4'), 'L8 有每天一句才有 D4；沒有就整區收起來');

// L9
const cnt = build({ days: [[{ name: 'A', subs: ['h1', 'h2'] }, { name: 'B' }], [{ name: 'C', subs: ['h3'] }]] });
const st = blk(cnt.pages[0], 'C5').stats.map((s) => s.value).join(',');
yes(st === '2,3,3', `L9 數字格＝天數 2、景點 3、照片 3（數出來的；實得 ${st}）`);

// L10
const c6 = (k) => blk(build({ members: k, days: [n(1)] }).pages[0], 'C6');
yes(c6(9).chips.length === 6 && c6(9).more === 3 && c6(4).chips.length === 4 && c6(4).more === 0,
  `L10 9 位 → 6 個頭像＋3 位；4 位 → 4 個、沒有「＋」`);
yes(c6(3).heading === '同行夥伴' && !JSON.stringify(c6(3)).includes('今日'), `L10 標題是「${c6(3).heading}」，沒有「今日」`);

// L11
const p11 = build({ days: [[{ name: 'A', hero: 'hero1' }, { name: 'B', subs: ['u1'] }], [{ name: 'C', hero: 'hero2' }], [{ name: '空空' }]] }).pages;
const d2a = blk(p11[1], 'D2'), d2b = blk(p11[2], 'D2'), d2c = blk(p11[3], 'D2');
yes(d2a.photo && d2a.photo.hash === 'u1' && d2a.photo.user && d2a.photo.tag === '', `L11 那天有使用者照片 → 主照片用它（不是排在前面的示意圖），不貼標籤（實得 ${d2a.photo && d2a.photo.hash}）`);
yes(d2b.photo && d2b.photo.hash === 'hero2' && d2b.photo.tag === '示意圖', `L11 只有示意圖 → 用它、貼「${d2b.photo && d2b.photo.tag}」`);
yes(d2c.photo === null && d2c.fallback === '空空', `L11 都沒有 → 沒有照片、色塊寫第一站「${d2c.fallback}」`);
const c4 = blk(p11[0], 'C4');
yes(c4.photo && c4.photo.hash === 'u1', `L11 封面主照片：全趟第一張使用者照片優先（實得 ${c4.photo && c4.photo.hash}）`);

// L12
const p12 = build({ days: [[{ name: 'A', subs: ['u1'] }, { name: 'B', hero: 'hB' }, { name: 'C', subs: ['u3'] }, { name: 'D', subs: ['u4'] }]] }).pages[1];
const d3 = blk(p12, 'D3');
const mainHash = blk(p12, 'D2').photo && blk(p12, 'D2').photo.hash;
yes(d3.photos.map((x) => x.hash).join() === 'u3,u4' && !d3.photos.some((x) => x.hash === mainHash),
  `L12 副照片是主照片以外的 2 張、使用者照片優先（實得 ${d3.photos.map((x) => x.hash).join('、')}）`);
const p12b = build({ days: [[{ name: 'A', subs: ['u1'] }, { name: 'B', hero: 'hB' }]] }).pages[1];
yes(blk(p12b, 'D3').photos.length === 1 && blk(p12b, 'D3').photos[0].tag === '示意圖', 'L12 只剩 1 張就只放 1 張（示意圖照樣貼標籤），空位不放假照片');
yes(!!bare[1] && !has(bare[1], 'D3'), 'L12 一張副照片都沒有 → D3 整區收起來');

// L13
const p13 = build({ days: [n(1), n(1), n(1)] }).pages;
yes(p13.slice(1).map((pg) => blk(pg, 'D6').pageText).join('、') === '第 2／4 張、第 3／4 張、第 4／4 張', `L13 頁尾「第 N／M 張」，M＝匯出的 4 張（${p13.slice(1).map((pg) => blk(pg, 'D6').pageText).join('、')}）`);

// L14：每一站都帶 emoji 與介紹（合成的），整份版面裡一個都不能有
const LABELS = Object.values(T.themes).map((x) => x.label), EMOJIS = Object.values(T.themes).map((x) => x.emoji).filter(Boolean);
const all = JSON.stringify(allPages.concat(p11, p13));
yes(all.includes('站1') && all.includes('同行夥伴'), 'L14 前置：版面 JSON 讀得到站名與同行夥伴（不是空的）');
const leak = [...LABELS.filter((l) => all.includes(l)), ...EMOJIS.filter((e) => all.includes(e)), ...['合成介紹句', '"emoji"', '"blurb"'].filter((x) => all.includes(x))];
yes(leak.length === 0, `L14 整份版面沒有類別名、類別 emoji、每站 emoji、每站介紹（實得 ${leak.join('、') || '0 個'}）`);

console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
