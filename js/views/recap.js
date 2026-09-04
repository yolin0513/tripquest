// 行程最終回顧 —— 一份可留念的成果報告 + 可匯出的回顧卡。

import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, avatar } from '../ui.js';
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
  page.append(h('div', { class: 'center-fill', style: 'min-height:140px' }, h('div', { class: 'spinner' })));

  const r = await buildRecap(tripId);

  // 有開 AI → 用 AI 潤飾過的文案（有快取秒回；沒開 / 失敗就用內建句子）
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

  if (ai && (ai.opening || ai.closing)) {
    if (ai.closing) out.append(h('p', { class: 'recap-closing' }, '「' + ai.closing + '」'));
    out.append(h('p', { class: 'form-hint center', style: 'margin-top:4px' }, '✨ 文字由 AI 潤飾'));
  }

  // 動作
  out.append(h('div', { class: 'stack', style: 'margin-top:22px' },
    h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => exportCard(tripId, r, ai) }, '📤 存成圖片 / 分享'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/album`) }, '🎬 做成回憶影片'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => navigate(`/trip/${tripId}/poster`) }, '🎨 做一張行程海報'),
  ));

  page.replaceChildren(out);
}

function num(ic, n, label) {
  return h('div', { class: 'recap-num' },
    h('div', { class: 'recap-num-ic' }, ic),
    h('div', { class: 'recap-num-n' }, String(n)),
    h('div', { class: 'recap-num-l' }, label));
}

// ---------- 匯出回顧卡（canvas）----------
async function exportCard(tripId, r, ai) {
  toast('產生回顧卡…');
  const theme = themeMeta(themeForTrip(store.spotsOf(tripId)));
  const p = theme.poster;
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');

  x.fillStyle = p.paper; x.fillRect(0, 0, W, H);
  // 頂部色帶
  x.fillStyle = p.band; x.fillRect(0, 0, W, 12);
  x.fillStyle = p.band; x.fillRect(0, H - 12, W, 12);

  x.textAlign = 'center';
  x.fillStyle = p.ink;
  x.font = `800 68px "PingFang TC","Noto Sans TC",sans-serif`;
  wrapText(x, r.title, W / 2, 130, W - 140, 74);
  x.fillStyle = p.sub; x.font = `400 34px "PingFang TC","Noto Sans TC",sans-serif`;
  x.fillText([r.dateRange, `${r.dayCount} 天 · ${r.people} 人`].filter(Boolean).join('　·　'), W / 2, 205);
  if (ai && ai.opening) {
    x.fillStyle = p.ink; x.font = `400 30px "PingFang TC","Noto Sans TC",sans-serif`;
    wrapText(x, ai.opening, W / 2, 262, W - 180, 40);
  }

  // 四宮格大數字
  const cells = [
    ['📷', r.photoCount, '張照片'],
    ['👣', r.distanceKm >= 0.1 ? r.distanceKm : r.spotCount, r.distanceKm >= 0.1 ? '公里' : '個地方'],
    ['✅', `${r.doneCount}/${r.questTotal}`, '個任務'],
    ['💬', r.interactions, '次互動'],
  ];
  const gx = [W / 2 - 250, W / 2 + 250];
  const gy = [370, 620];
  cells.forEach((cell, i) => {
    const cx = gx[i % 2], cy = gy[Math.floor(i / 2)];
    x.font = '64px sans-serif'; x.fillText(cell[0], cx, cy - 40);
    x.fillStyle = p.accent; x.font = `900 76px "PingFang TC",sans-serif`;
    x.fillText(String(cell[1]), cx, cy + 40);
    x.fillStyle = p.sub; x.font = `400 30px "PingFang TC",sans-serif`;
    x.fillText(cell[2], cx, cy + 82);
    x.fillStyle = p.ink;
  });

  // 美食
  let yy = 800;
  if (r.foods.length) {
    x.fillStyle = p.ink; x.font = `800 38px "PingFang TC",sans-serif`;
    x.fillText(`吃了 ${r.foods.length} 樣美食`, W / 2, yy);
    yy += 50;
    x.font = `400 30px "PingFang TC",sans-serif`; x.fillStyle = p.sub;
    const names = r.foods.map((f) => f.title.replace(/^必吃：/, '')).slice(0, 6);
    wrapText(x, names.join('・'), W / 2, yy, W - 160, 42);
    yy += 90;
  }

  // 徽章
  if (r.tripBadges.length) {
    x.fillStyle = p.ink; x.font = `800 36px "PingFang TC",sans-serif`;
    x.fillText(`解鎖 ${r.tripBadges.length} 個徽章`, W / 2, yy + 20);
    x.font = '46px sans-serif';
    x.fillText(r.tripBadges.slice(0, 10).map((b) => b.emoji).join(' '), W / 2, yy + 80);
  }

  // 頁尾
  if (ai && ai.closing) {
    x.fillStyle = p.ink; x.font = `italic 400 32px "PingFang TC","Noto Sans TC",sans-serif`;
    wrapText(x, '「' + ai.closing + '」', W / 2, H - 150, W - 180, 42);
  }
  x.fillStyle = p.sub; x.font = `400 28px "PingFang TC",sans-serif`;
  x.fillText('TripQuest 旅圖任務' + (ai && (ai.opening || ai.closing) ? '　·　✨ AI 潤飾' : ''), W / 2, H - 60);

  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  const file = new File([blob], `${r.title}-回顧.jpg`, { type: 'image/jpeg' });
  if (await nativeShare({ title: r.title, text: '我們的旅程回顧', files: [file] })) return;
  downloadBlob(blob, file.name);
  toast('已存成圖片');
}

function wrapText(ctx, text, cx, y, maxW, lh) {
  const chars = [...String(text)];
  let line = '';
  const lines = [];
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, cx, y + i * lh));
  return y + lines.length * lh;
}
