import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { renderPreview, renderPoster, presetList } from '../poster/index.js';
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
  const canvas = h('canvas', { class: 'poster-canvas' });
  const styleRow = h('div', { class: 'music-pick' });
  const busy = h('div', { class: 'form-hint center', hidden: true });

  function drawStyles() {
    styleRow.replaceChildren(...presetList().map((s) => h('button', {
      class: presetId === s.id ? 'on' : '',
      onclick: () => { presetId = s.id; store.patch(tripId, { posterStyle: s.id }); drawStyles(); refresh(); },
    }, s.label)));
  }
  drawStyles();

  async function refresh() {
    busy.hidden = false; busy.textContent = '繪製預覽…';
    try { await renderPreview(canvas, tripId, presetId); }
    catch (e) { console.error(e); toast('預覽失敗：' + e.message); }
    busy.hidden = true;
  }

  render(h('div', { class: 'page' },
    h('p', { class: 'muted center', style: 'margin:0 0 10px' }, '把行程做成一張海報，存下來傳 LINE 或列印。'),
    h('div', { class: 'poster-frame' }, canvas),
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
