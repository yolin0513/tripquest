// 行程海報（v1.88.0；Yolin：行程設定好之後，輸出一張 PNG 圖片或 PDF，內含這趟的景點和每天規劃；可以選全部集中一張或每天一張）。
// 從行程分頁「行程」那一格的「🗺️ 做成行程海報」進來。回顧那邊的海報（views/poster.js）不動。
// 版型兩種（路線圖、分天色帶）、張數兩種（全部一張、每天一張）；上次選的記在這台手機（localStorage，不同步）。
// 預覽跟成品畫的是同一份版面（js/itinposter/）——預覽跟成品不一樣就是騙人。
import * as store from '../store.js';
import { h, toast, qty } from '../ui.js';
import { navigate } from '../router.js';
import { downloadBlob, nativeShare } from '../share.js';
import { gatherModel, tripForecast, renderPages, drawPoster, pngFiles, pdfFile, safeName } from '../itinposter/index.js';

const PREF = 'tripquest.itinPoster.';
const KINDS = [['route', '路線圖'], ['band', '分天色帶']];
const SPLITS = [['one', '全部一張'], ['day', '每天一張']];

function loadPref(tripId) {
  try {
    const v = JSON.parse(localStorage.getItem(PREF + tripId) || 'null');
    if (v && KINDS.some(([k]) => k === v.kind) && SPLITS.some(([k]) => k === v.split)) return { kind: v.kind, split: v.split };
  } catch { /* 讀不到：用預設 */ }
  return { kind: 'route', split: 'one' };
}

export default async function itinposter(tripId, { drawPage, setTop }) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '行程海報' });
  if (!store.spotsOf(tripId).length) {
    drawPage(h('div', { class: 'page' }, h('div', { class: 'empty' },
      h('p', {}, '這趟還沒有排景點，排好再來做海報。'),
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/trip/${tripId}/plan`) }, '＋ 去安排景點'))));
    return;
  }

  const pref = loadPref(tripId);
  let forecast = null, model = null, pages = [], page = 0;
  const canvas = h('canvas', { class: 'poster-canvas', role: 'img', 'aria-label': '行程海報預覽' });
  const frame = h('div', { class: 'poster-frame ip-frame' }, canvas);
  const busy = h('div', { class: 'form-hint center', hidden: true });
  const pagePrev = h('button', { class: 'btn btn-soft pager-btn', type: 'button', onclick: () => { page--; show(-1); } }, '‹ 前一張');
  const pageLbl = h('span', { class: 'pager-lbl' });
  const pageNext = h('button', { class: 'btn btn-soft pager-btn', type: 'button', onclick: () => { page++; show(1); } }, '下一張 ›');
  const pager = h('div', { class: 'pager', hidden: true }, pagePrev, pageLbl, pageNext);

  const seg = (key, opts, label) => h('div', { class: 'seg ip-seg', role: 'radiogroup', 'aria-label': label, dataset: { key } },
    ...opts.map(([v, text]) => h('button', {
      type: 'button', role: 'radio', dataset: { v },
      onclick: () => {
        if (pref[key] === v) return;
        pref[key] = v;
        try { localStorage.setItem(PREF + tripId, JSON.stringify(pref)); } catch { /* 存不了：這次照樣換 */ }
        syncSegs();
        page = 0;
        relayout();
      },
    }, text)));
  const kindSeg = seg('kind', KINDS, '海報版型');
  const splitSeg = seg('split', SPLITS, '幾張');
  function syncSegs() {
    for (const s of [kindSeg, splitSeg]) {
      for (const b of s.querySelectorAll('button')) {
        const on = pref[s.dataset.key] === b.dataset.v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
    }
  }
  syncSegs();

  async function rebuild() { model = await gatherModel(tripId, { forecast }); }
  function relayout() { pages = renderPages(model, pref); page = Math.max(0, Math.min(page, pages.length - 1)); show(0); }

  // dir：-1 往前翻、+1 往後翻、0 換版型或第一次。翻頁動畫只動 transform（舊的滑出、新的滑入），減少動態效果就不動。
  async function show(dir) {
    if (!pages.length) return;
    busy.hidden = false; busy.textContent = '畫預覽…';
    try {
      const off = document.createElement('canvas');
      await drawPoster(off, pages[page]);
      const animate = dir !== 0 && canvas.width && !document.documentElement.classList.contains('reduce-motion')
        && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      canvas.width = off.width; canvas.height = off.height;
      canvas.getContext('2d').drawImage(off, 0, 0);
      canvas.dataset.page = String(page);
      canvas.dataset.kind = pref.kind;
      canvas.dataset.split = pref.split;
      const many = pages.length > 1;
      pager.hidden = !many;
      frame.classList.toggle('paged', many);
      pageLbl.textContent = many ? `${pages[page].label} / 共 ${qty(pages.length, '張')}` : '';
      pagePrev.style.visibility = page === 0 ? 'hidden' : 'visible';
      pageNext.style.visibility = page >= pages.length - 1 ? 'hidden' : 'visible';
      if (animate) {
        const dist = frame.clientWidth || 360;
        canvas.animate([{ transform: `translateX(${dir * dist * 0.25}px)`, opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }],
          { duration: 220, easing: 'ease-out' });
      }
    } catch (e) { console.error(e); toast('預覽畫不出來：' + e.message); }
    busy.hidden = true;
  }

  async function doExport(type) {
    const overlay = h('div', { class: 'record-overlay' }, h('div', { class: 'spinner' }), h('div', { class: 'record-pct' }, '準備中…'));
    document.body.append(overlay);
    const pct = overlay.querySelector('.record-pct');
    try {
      const base = safeName(t.title);
      const files = type === 'pdf'
        ? [await pdfFile(pages, base, (m) => { pct.textContent = m; })]
        : await pngFiles(pages, base, (m) => { pct.textContent = m; });
      overlay.remove();
      // 圖片先試手機的分享（傳 LINE）；分享不了檔案的（多半是電腦）就下載。PDF 直接下載（多半是要列印）。
      // 先確認分享得了「檔案」再分享——分享不了檔案時 nativeShare 會只分享文字，使用者會以為傳了圖。
      if (type === 'png' && navigator.canShare && navigator.canShare({ files })
        && await nativeShare({ title: t.title, text: '我們的行程', files })) return;
      for (const f of files) {
        downloadBlob(f, f.name);
        if (files.length > 1) await new Promise((r) => setTimeout(r, 400));
      }
      toast(type === 'pdf' ? `已存 PDF（${qty(pages.length, '頁')}）` : `已存 ${qty(files.length, '張')}圖片`);
    } catch (e) {
      overlay.remove();
      console.error(e);
      toast('存不出來：' + e.message);
    }
  }

  drawPage(h('div', { class: 'page itin-poster' },
    h('p', { class: 'muted center', style: 'margin:0 0 10px' }, '把排好的行程做成海報：存成圖片傳給家人，或存成 PDF 列印。'),
    h('div', { class: 'section-label' }, '版型'),
    kindSeg,
    h('div', { class: 'section-label' }, '張數'),
    splitSeg,
    pager,
    frame,
    busy,
    h('div', { class: 'section-label' }, '存下來'),
    h('button', { class: 'btn btn-primary btn-block btn-big ip-png', type: 'button', onclick: () => doExport('png') }, '🖼️ 存成圖片（PNG）'),
    h('button', { class: 'btn btn-soft btn-block ip-pdf', type: 'button', onclick: () => doExport('pdf') }, '📄 存成 PDF（列印用）'),
    h('p', { class: 'form-hint center' }, '全部在這支手機上產生，不會上傳。'),
    h('p', { class: 'form-hint center' }, '必吃清單只列景點資料庫整理過的；沒對上資料庫的地點只寫名字。天氣預報查得到的日子（大約兩週內）才會寫在「小提醒」。'),
  ));

  await rebuild();
  relayout();
  // 天氣預報在背景查；查到新的（不是舊快取）才放進小提醒、重畫一次
  tripForecast(tripId).then(async (f) => {
    if (!f || f.stale || !canvas.isConnected) return;
    forecast = f;
    await rebuild();
    if (canvas.isConnected) relayout();
  }).catch(() => {});
}
