import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { renderPreview, renderPoster, presetList, warmPosterAi } from '../poster/index.js';
import { downloadBlob, nativeShare } from '../share.js';

export default async function poster(tripId) {
  const t = store.get(tripId);
  if (!t) { navigate('/', { replace: true }); return; }
  setTop({ title: '行程海報' });

  const spots = store.spotsOf(tripId);
  if (!spots.length) {
    render(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', {}, '這個行程還沒有景點'))));
    return;
  }

  let presetId = t.posterStyle || 'watercolor';
  let page = 0;
  const canvas = h('canvas', { class: 'poster-canvas' });
  const frame = h('div', { class: 'poster-frame' }, canvas);
  const styleRow = h('div', { class: 'music-pick' });
  const busy = h('div', { class: 'form-hint center', hidden: true });
  // ≥3 天的行程，匯出是一天一張 —— 預覽也一張一張翻，跟成品一致
  const pagePrev = h('button', { class: 'btn btn-soft pager-btn', onclick: () => { page--; refresh(-1); } }, '‹ 前一張');
  const pageLbl = h('span', { class: 'pager-lbl' });
  const pageNext = h('button', { class: 'btn btn-soft pager-btn', onclick: () => { page++; refresh(1); } }, '下一張 ›');
  const pager = h('div', { class: 'pager', hidden: true }, pagePrev, pageLbl, pageNext);

  function drawStyles() {
    styleRow.replaceChildren(...presetList().map((s) => h('button', {
      class: presetId === s.id ? 'on' : '',
      onclick: () => { presetId = s.id; store.patch(tripId, { posterStyle: s.id }); drawStyles(); refresh(); },
    }, s.label)));
  }
  drawStyles();

  // dir：-1 往前翻、+1 往後翻、0 首次或換風格。
  // 每天的海報高度不一樣，直接換內容整個版面會上下跳、按鈕也跟著跑 ——
  // 所以 (1) 翻頁列放在預覽「上面」（位置永遠不受下面內容影響）、
  // (2) 有多張時預覽容器鎖成固定高度、短的那張置中留白（.paged）、
  // (3) 翻頁時舊畫面往旁邊滑出、新畫面滑入，讓人知道是「換頁」不是內容突變。
  async function refresh(dir = 0) {
    busy.hidden = false; busy.textContent = '繪製預覽…';
    try {
      const animate = dir !== 0 && !document.documentElement.classList.contains('reduce-motion');
      let ghost = null;
      if (animate && canvas.width) {
        ghost = document.createElement('canvas');
        ghost.width = canvas.width; ghost.height = canvas.height;
        ghost.getContext('2d').drawImage(canvas, 0, 0);
        const fr = frame.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
        ghost.className = 'poster-ghost';
        Object.assign(ghost.style, {
          left: (cr.left - fr.left) + 'px', top: (cr.top - fr.top) + 'px',
          width: cr.width + 'px', height: cr.height + 'px',
        });
        frame.append(ghost);
      }
      const info = await renderPreview(canvas, tripId, presetId, page);
      page = info.page;
      pager.hidden = info.pages <= 1;
      frame.classList.toggle('paged', info.pages > 1);
      // 「第 1 天」＋「1 / 3 張」講的是同一件事 —— 一句就好。
      // 兩端用 visibility 藏（不是 disabled）：第一張根本沒有「前一張」可去，
      // 灰掉的按鈕還是會被按；用 visibility 而非移除，中間的字才不會左右跳。
      pageLbl.textContent = `${info.label} / 共 ${info.pages} 天`;
      pagePrev.style.visibility = info.page === 0 ? 'hidden' : 'visible';
      pageNext.style.visibility = info.page >= info.pages - 1 ? 'hidden' : 'visible';
      if (ghost) {
        const dist = frame.clientWidth || 360;
        ghost.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * dist}px)` }],
          { duration: 280, easing: 'ease' });
        canvas.animate([{ transform: `translateX(${dir * dist}px)` }, { transform: 'translateX(0)' }],
          { duration: 280, easing: 'ease' });
        setTimeout(() => ghost.remove(), 340);
      }
    } catch (e) { console.error(e); toast('預覽失敗：' + e.message); }
    busy.hidden = true;
  }


  render(h('div', { class: 'page' },
    h('p', { class: 'muted center', style: 'margin:0 0 10px' }, '把行程做成一張海報，存下來傳 LINE 或列印。'),
    pager,
    frame,
    busy,
    h('div', { class: 'section-label' }, '風格'),
    styleRow,

    h('div', { class: 'section-label' }, '產生'),
    h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => doExport('share') }, '📤 存成圖片 / 傳給家人'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => doExport('print') }, '🖨️ 存高解析度（列印用）'),
    h('p', { class: 'form-hint center' }, '照片用你們自己拍的；還沒拍的用該景點的維基百科公開圖片。全部在手機本機產生。'),
    h('p', { class: 'form-hint center' }, '沒有拍攝時間嗎？可到每個景點的「編輯」裡填上，海報會顯示時間軸。'),
  ));

  refresh();

  // 有開 AI → 背景把海報文案產一產，好了重畫預覽
  if (t.aiEnabled) {
    warmPosterAi(tripId).then((changed) => {
      if (changed && location.hash.includes(`/trip/${tripId}/poster`)) refresh();
    }).catch(() => {});
  }

  async function doExport(mode) {
    const overlay = h('div', { class: 'record-overlay' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'record-pct' }, '準備中…'),
    );
    document.body.append(overlay);
    const pct = overlay.querySelector('.record-pct');
    try {
      const results = await renderPoster(tripId, { presetId, onProgress: (m) => { pct.textContent = m; } });
      overlay.remove();
      if (!t.posterMade) store.patch(tripId, { posterMade: true }).catch(() => {});
      const files = results.map((r) => new File([r.blob], `${r.label}.jpg`, { type: 'image/jpeg' }));
      if (mode === 'share' && await nativeShare({ title: t.title, text: '我們的行程', files })) return;
      for (const [i, r] of results.entries()) {
        downloadBlob(r.blob, `${r.label}.jpg`);
        if (results.length > 1) await new Promise((res) => setTimeout(res, 400));
        void i;
      }
      toast(results.length > 1 ? `已存 ${results.length} 張（一天一張）` : '已存成圖片');
    } catch (e) {
      overlay.remove();
      console.error(e);
      toast('產生失敗：' + e.message);
    }
  }
}
