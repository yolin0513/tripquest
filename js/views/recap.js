// 行程最終回顧 —— 一份可留念的成果報告 + 可匯出的回顧卡。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, avatar, spinnerBox } from '../ui.js';
import { navigate } from '../router.js';
import { hashHue } from '../ids.js';
import { blobURL } from '../photos.js';
import { downloadBlob, nativeShare } from '../share.js';
import { buildRecap } from '../recap.js';
import { loadThemes, themeForTrip, themeMeta } from '../theme.js';

export default async function recap(tripId) {
  const trip = store.get(tripId);
  if (!trip) { navigate('/', { replace: true }); return; }
  setTop({ title: '行程回顧' });
  await loadThemes().catch(() => {});

  const page = h('div', { class: 'page' });
  render(page);
  page.append(spinnerBox('正在整理這趟的回顧…', '要算路線、找美食、查當時的天氣'));

  const r = await buildRecap(tripId);

  // 有開 AI → 用潤飾過的文案（有快取秒回；沒開 / 失敗就用內建句子）
  let ai = null;
  if (trip.aiEnabled) {
    try { ai = await import('../aicontent.js').then((m) => m.ensureRecapText(tripId, r)); }
    catch { ai = null; }
  }

  const out = h('div', { class: 'recap' });

  // 標題
  out.append(h('div', { class: 'recap-head' },
    h('div', { class: 'recap-title' }, r.title),
    h('div', { class: 'recap-sub' }, [r.dateRange, `${r.dayCount} 天`, `${r.people} 人`].filter(Boolean).join('　·　')),
  ));

  if (ai && ai.opening) {
    out.append(h('p', { class: 'recap-opening' }, ai.opening));
  }

  // 大數字
  out.append(h('div', { class: 'recap-nums' },
    num('📷', r.photoCount, '張照片'),
    num('📍', r.spotCount, '個地方'),
    num('✅', `${r.doneCount}/${r.questTotal}`, '個任務'),
    r.distanceKm >= 0.1 ? num('👣', r.distanceKm, '公里') : null,
    num('💬', r.interactions, '次互動'),
  ));

  // 天氣
  if (r.weather) {
    out.append(h('div', { class: 'recap-line' },
      h('span', { class: 'recap-line-ic' }, '🌤️'),
      h('span', {}, (ai && ai.weather) || (`這幾天最高 ${r.weather.hi} 度、最低 ${r.weather.lo} 度` +
        (r.weather.rainyDays ? `，有 ${r.weather.rainyDays} 天下雨` : '，天氣不錯'))),
    ));
  }

  // 待最久 / 最多回憶
  if (r.topSpot) {
    out.append(h('div', { class: 'recap-line' }, h('span', { class: 'recap-line-ic' }, '🏆'),
      h('span', {}, (ai && ai.topSpot) || `最多回憶的地方是「${r.topSpot.name}」，拍了 ${r.topSpot.photos} 張`)));
  }
  if (r.longestSpot && r.longestSpot.mins >= 60) {
    out.append(h('div', { class: 'recap-line' }, h('span', { class: 'recap-line-ic' }, '⏳'),
      h('span', {}, `待最久的是「${r.longestSpot.name}」，約 ${Math.round(r.longestSpot.mins / 30) / 2} 小時`)));
  }

  // 美食
  if (r.foods.length) {
    out.append(h('div', { class: 'section-label' }, `吃了這些（${r.foods.length} 樣）`));
    const fg = h('div', { class: 'recap-foods' });
    out.append(fg);
    for (const f of r.foods) {
      const cell = h('div', { class: 'recap-food' }, h('div', { class: 'recap-food-ph' }, '🍜'),
        h('div', { class: 'recap-food-t' }, f.title.replace(/^必吃：/, '')));
      fg.append(cell);
      if (f.thumbHash) blobURL(f.thumbHash).then((u) => { if (u) cell.firstChild.style.backgroundImage = `url("${u}")`; });
    }
  }

  // 每個人
  out.append(h('div', { class: 'section-label' }, '每個人的貢獻'));
  out.append(h('div', { class: 'stack' }, ...r.perMember.map((m) =>
    h('div', { class: 'recap-person' },
      avatar(m.name, hashHue(m.id)),
      h('div', { class: 'recap-person-main' },
        h('div', { style: 'font-weight:800' }, m.name, m.badges ? h('span', { class: 'pr-badges' }, ` 🏅${m.badges}`) : null),
        h('div', { class: 'muted sm' },
          `完成 ${m.done} · 拍 ${m.shot} 張`
          + (m.helped ? ` · 幫拍 ${m.helped}` : '')
          + (m.inPhotos ? ` · 入鏡 ${m.inPhotos}` : '')
          + (m.social ? ` · 互動 ${m.social}` : '')),
      ),
    ))));

  // 徽章
  if (r.tripBadges.length) {
    out.append(h('div', { class: 'section-label' }, `這趟解鎖 ${r.tripBadges.length} 個徽章`));
    out.append(h('div', { class: 'recap-badges' }, ...r.tripBadges.map((b) =>
      h('span', { class: 'recap-badge' }, `${b.emoji} ${b.name}`))));
  }

  if (ai && ai.closing) {
    out.append(h('p', { class: 'recap-closing' }, '「' + ai.closing + '」'));
  }

  // 動作 —— 只留這一頁自己的事（影片與海報在「回顧」分頁本來就有入口，不重複放）
  out.append(h('div', { class: 'stack', style: 'margin-top:22px' },
    h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => exportCard(tripId, r, ai) }, '📤 存成圖片 / 分享'),
  ));

  page.replaceChildren(out);
}

function num(ic, n, label) {
  return h('div', { class: 'recap-num' },
    h('div', { class: 'recap-num-ic' }, ic),
    h('div', { class: 'recap-num-n' }, String(n)),
    h('div', { class: 'recap-num-l' }, label));
}

// ---------- 匯出回顧卡（canvas） ----------
//
// 使用者實測回報三個跑版：開場文字壓到 📷、「次互動」上有重疊、13 個徽章
// 超出右邊被切掉。根本原因是舊版**每一塊的 y 都寫死**（文字卡在 262、
// 宮格卡在 370…），內容一多（AI 開場三行、美食名稱換行）就直接疊在一起，
// 徽章又只畫 emoji 一長串。改成**流式排版**：每一塊自己量高度、游標往下推，
// 畫布高度最後才決定 —— 資料多就變長，永遠不重疊、不溢出。
// renderRecapCard 拆出來、回傳每一塊的框，測試就能自動驗「不重疊、不出界」。

const CARD_FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';

function cardWrap(x, text, maxW, size, { weight = 400, min = 24, maxLines = 99 } = {}) {
  let s = size;
  const measure = (px) => {
    x.font = `${weight} ${px}px ${CARD_FONT}`;
    const lines = [];
    let line = '';
    for (const ch of [...String(text)]) {
      if (line && x.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  };
  let lines = measure(s);
  while (lines.length > maxLines && s > min) { s -= 2; lines = measure(s); }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return { lines, size: s, lh: Math.round(s * 1.35) };
}

// 把「emoji 名稱」的小塊排成置中的多行（徽章用）—— 幾個都放得下，放不下就換行
function chipLines(x, chips, maxW, size) {
  x.font = `600 ${size}px ${CARD_FONT}`;
  const gap = x.measureText('　').width;
  const lines = [];
  let cur = [], w = 0;
  for (const c of chips) {
    const cw = x.measureText(c).width;
    if (cur.length && w + gap + cw > maxW) { lines.push({ items: cur, w }); cur = []; w = 0; }
    w += (cur.length ? gap : 0) + cw;
    cur.push(c);
  }
  if (cur.length) lines.push({ items: cur, w });
  return { lines, gap };
}

// r / ai → { canvas, boxes }。boxes: 每一塊的名稱與外框，給測試驗不重疊、不出界。
export function renderRecapCard(r, ai, p) {
  const W = 1080, PAD = 90, maxW = W - PAD * 2;
  // 先用一張暫時畫布量字，因為總高度要等排完版才知道
  const mc = document.createElement('canvas').getContext('2d');
  const boxes = [];
  const ops = [];                 // 先記下要畫什麼，量完總高才真的畫
  let y = 100;

  const block = (name, hgt, draw) => { boxes.push({ name, y0: y, y1: y + hgt }); ops.push({ y, draw }); y += hgt; };
  const text = (name, str, size, { weight = 400, color = 'ink', min = 24, maxLines = 99, italic = false, gapAfter = 0 } = {}) => {
    const f = cardWrap(mc, str, maxW, size, { weight, min, maxLines });
    block(name, f.lines.length * f.lh, (x, top) => {
      x.font = `${italic ? 'italic ' : ''}${weight} ${f.size}px ${CARD_FONT}`;
      x.fillStyle = p[color]; x.textAlign = 'center'; x.textBaseline = 'top';
      f.lines.forEach((ln, i) => x.fillText(ln, W / 2, top + i * f.lh));
    });
    y += gapAfter;
  };
  const gap = (n) => { y += n; };

  // 標題區
  text('title', r.title, 66, { weight: 800, min: 42, maxLines: 2, gapAfter: 14 });
  text('sub', [r.dateRange, `${r.dayCount} 天 · ${r.people} 人`].filter(Boolean).join('　·　'),
    34, { color: 'sub', min: 26, maxLines: 2, gapAfter: 10 });
  if (ai && ai.opening) text('opening', ai.opening, 30, { min: 26, maxLines: 4 });
  gap(44);

  // 大數字宮格：兩欄，列數依內容而定
  const cells = [
    ['📷', r.photoCount, '張照片'],
    ['👣', r.distanceKm >= 0.1 ? r.distanceKm : r.spotCount, r.distanceKm >= 0.1 ? '公里' : '個地方'],
    ['✅', `${r.doneCount}/${r.questTotal}`, '個任務'],
    ['💬', r.interactions, '次互動'],
  ];
  const CELL_H = 196, colX = [W / 2 - 240, W / 2 + 240];
  for (let row = 0; row < Math.ceil(cells.length / 2); row++) {
    const rowCells = cells.slice(row * 2, row * 2 + 2);
    block(`nums-row${row}`, CELL_H, (x, top) => {
      rowCells.forEach((cell, i) => {
        const cx = colX[i];
        x.textAlign = 'center'; x.textBaseline = 'top';
        x.font = '56px sans-serif'; x.fillStyle = p.ink;
        x.fillText(cell[0], cx, top);
        const nf = cardWrap(mc, String(cell[1]), 430, 74, { weight: 900, min: 40, maxLines: 1 });
        x.font = `900 ${nf.size}px ${CARD_FONT}`; x.fillStyle = p.accent;
        x.fillText(String(cell[1]), cx, top + 74);
        x.font = `400 30px ${CARD_FONT}`; x.fillStyle = p.sub;
        x.fillText(cell[2], cx, top + 160);
      });
    });
    if (row < Math.ceil(cells.length / 2) - 1) gap(26);
  }
  gap(46);

  // 美食：名稱全列出來（換行），最多 5 行
  if (r.foods.length) {
    text('foods-title', `吃了 ${r.foods.length} 樣美食`, 38, { weight: 800, maxLines: 1, gapAfter: 16 });
    text('foods', r.foods.map((f) => f.title.replace(/^必吃：/, '')).join('・'),
      30, { color: 'sub', min: 26, maxLines: 5 });
    gap(40);
  }

  // 徽章：「emoji 名稱」一顆一顆排、放不下換行 —— 13 個也不會被切掉
  if (r.tripBadges.length) {
    text('badges-title', `解鎖 ${r.tripBadges.length} 個徽章`, 36, { weight: 800, maxLines: 1, gapAfter: 16 });
    const chips = r.tripBadges.map((b) => `${b.emoji} ${b.name}`);
    const SIZE = 30, LH = 52;
    const { lines, gap: cg } = chipLines(mc, chips, maxW, SIZE);
    block('badges', lines.length * LH, (x, top) => {
      x.font = `600 ${SIZE}px ${CARD_FONT}`; x.fillStyle = p.ink; x.textBaseline = 'top'; x.textAlign = 'left';
      lines.forEach((ln, i) => {
        let cx = W / 2 - ln.w / 2;
        for (const c of ln.items) { x.fillText(c, cx, top + i * LH); cx += x.measureText(c).width + cg; }
      });
    });
    gap(40);
  }

  // 結尾
  if (ai && ai.closing) { text('closing', '「' + ai.closing + '」', 32, { italic: true, min: 26, maxLines: 3 }); gap(28); }
  text('footer', 'TripQuest 旅圖任務', 28, { color: 'sub', maxLines: 1 });

  // 量完了 → 真的畫
  const H = Math.max(1350, y + 90);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = p.paper; x.fillRect(0, 0, W, H);
  x.fillStyle = p.band; x.fillRect(0, 0, W, 12); x.fillRect(0, H - 12, W, 12);
  for (const op of ops) op.draw(x, op.y);
  return { canvas: c, boxes, W, H };
}

async function exportCard(tripId, r, ai) {
  toast('產生回顧卡…');
  const theme = themeMeta(themeForTrip(store.spotsOf(tripId)));
  const { canvas } = renderRecapCard(r, ai, theme.poster);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  const file = new File([blob], `${r.title}-回顧.jpg`, { type: 'image/jpeg' });
  if (await nativeShare({ title: r.title, text: '我們的旅程回顧', files: [file] })) return;
  downloadBlob(blob, file.name);
  toast('已存成圖片');
}
