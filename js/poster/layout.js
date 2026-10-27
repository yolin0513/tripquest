// 海報版型 P1（docs/DESIGN_海報重做.md 第 2、4 節）——純函式，不碰 canvas、不碰 DOM（scripts/posterlayouttest.mjs 直接餵模型）。
// 固定 4:5（1080×1350）：封面一張＋每天一張，不論幾天。每一區固定高度；內容放不下就截斷並**明寫還有幾個**，不讓東西無聲消失。
// 沒有的資料就不出現（日期、副標、每天一句、照片）——不編、不補、不用預設值冒充。
// 不印主題章、主題插圖、每站 emoji、每站介紹（Dispatch 2026-10-27）；類別只留 theme 給畫圖那一半挑配色。

import { dayRoute, weekdayLabel } from '../tripday.js';

export const PW = 1080;
export const PH = 1350;
export const TIMELINE_MAX = 5;   // D5 最多列幾站
export const CHIPS_MAX = 6;      // C6 最多幾個頭像

// 第 day 天的「M/D（週X）」；沒設出發日、日期不存在 → ''（不猜）
export function dayDateLabel(startDate, day) {
  const [y, m, d] = String(startDate || '').split('-').map(Number);
  if (!y || !m || !d || !(day >= 1)) return '';
  const t = new Date(y, m - 1, d);
  if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return '';
  t.setDate(t.getDate() + (day - 1));
  const wk = weekdayLabel(startDate, day);
  return wk ? `${t.getMonth() + 1}/${t.getDate()}（${wk}）` : '';
}

// 照片：使用者拍的優先，再來景點示意圖（一定貼「示意圖」標籤）；items 依那天的順序
function photoOf(it) {
  if (!it || !it.photoHash) return null;
  return { hash: it.photoHash.hash, user: !!it.photoHash.user, tag: it.photoHash.user ? '' : '示意圖', name: it.name };
}
function pickPhotos(items, n) {
  const withPhoto = items.filter((it) => it.photoHash);
  const ordered = [...withPhoto.filter((it) => it.photoHash.user), ...withPhoto.filter((it) => !it.photoHash.user)];
  return ordered.slice(0, n).map(photoOf);
}

// 從上往下排：固定高度的區塊依序接起來，收起來的區塊把高度讓給 grow 指定的那一區
function stack(list) {
  let y = 0;
  return list.map((b) => { const out = { ...b, y }; y += b.h; return out; });
}

export function coverPage(model) {
  const allItems = model.days.flatMap((d) => d.items);
  const [photo] = pickPhotos(allItems, 1);
  const hasSub = !!model.subtitle;
  const members = model.members || [];
  return {
    kind: 'cover',
    theme: model.tripTheme || null,
    blocks: stack([
      { id: 'C1', h: 110, brand: 'TripQuest' },
      { id: 'C2', h: 190, title: model.title, dateRange: model.dateRange || '' },
      ...(hasSub ? [{ id: 'C3', h: 60, text: model.subtitle }] : []),
      // C3 收起來時 C4 往上補（照片變高），其他區不動
      { id: 'C4', h: hasSub ? 640 : 700, photo: photo || null, fallback: photo ? '' : model.title },
      { id: 'C5', h: 150, stats: [
        { unit: '天', value: model.dayCount },
        { unit: '個地方', value: model.spotCount },
        { unit: '張照片', value: model.photoCount || 0 },
      ] },
      // 欄位刻意不叫 label：畫圖那一半不准讀 .label（postertruthtest P9 守，那是類別名的欄位）
      { id: 'C6', h: 120, heading: '同行夥伴', chips: members.slice(0, CHIPS_MAX), more: Math.max(0, members.length - CHIPS_MAX) },
      { id: 'C7', h: 80 },
    ]),
  };
}

export function dayPage(model, day, index, total) {
  const photos = pickPhotos(day.items, 3);
  const main = photos[0] || null;
  const side = photos.slice(1);
  const hasLine = !!day.aiLine;
  const rows = day.items.slice(0, TIMELINE_MAX).map((it) => ({ time: it.startTime || '', name: it.name }));
  const more = Math.max(0, day.items.length - TIMELINE_MAX);
  // D2 590、D3 240、D4 70：D4 收起來讓給 D3；D3 沒有照片就整區收起來、讓給 D2
  const d3h = 240 + (hasLine ? 0 : 70);
  const blocks = [
    { id: 'D1', h: 170, dayTag: `DAY ${day.day}`, date: dayDateLabel(model.startDate, day.day), route: dayRoute(day.items) },
    { id: 'D2', h: 590 + (side.length ? 0 : d3h), photo: main, fallback: main ? '' : (day.items[0] ? day.items[0].name : '') },
    ...(side.length ? [{ id: 'D3', h: d3h, photos: side }] : []),
    ...(hasLine ? [{ id: 'D4', h: 70, text: day.aiLine }] : []),
    { id: 'D5', h: 200, rows, more, moreText: more ? `還有 ${more} 站` : '' },
    { id: 'D6', h: 80, pageText: `第 ${index + 1}／${total} 張` },
  ];
  return { kind: 'day', day: day.day, theme: day.theme || null, blocks: stack(blocks) };
}

// 封面＋每天一張。total 算進封面，頁尾的「第 N／M 張」跟匯出的張數一致
export function pagesFrom(model) {
  const total = model.days.length + 1;
  return [coverPage(model), ...model.days.map((d, i) => dayPage(model, d, i + 1, total))];
}
