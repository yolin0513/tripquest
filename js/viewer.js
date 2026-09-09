// 全螢幕照片檢視（v1.57）—— 相簿格狀與照片牆點照片都進這裡。
//
//   · 左右滑看上一張／下一張；往下滑或按左上角大顆 ✕ 關閉；Android 實體返回鍵也關
//     （開啟時 pushState 一筆，popstate 就關，不會退出行程）。
//   · 雙指縮放（1～4 倍）、雙擊放大到 2.5 倍再雙擊還原；放大時單指拖曳看細節。
//   · 先秀縮圖（同步保證會到的那份），背景抓全圖，抓到就無縫換上（先預載再換 src）。
//   · 下方：誰拍的／景點／任務、四顆按讚（沿用照片牆同一套 reaction 記錄）、
//     💬 留言（抽屜：看留言、直接留言 —— 沿用同一套 comment 記錄）。
//   · 觸控區都 ≥ 48px；文字跟著 App 的字級設定。

import * as store from './store.js';
import { h, toast } from './ui.js';
import { blobURL } from './photos.js';
import { ensureMember, activeMemberId } from './claim.js';
import { shooterOf, subjectsOf } from './badges.js';

const REACTIONS = ['❤️', '👍', '😍', '👏'];

// subs：要翻閱的清單（已排序、已篩選）；index：從哪一張開始。
// 回傳 Promise，關閉時 resolve({ changed })—— changed 表示有按讚／留言，呼叫端可重繪。
export function openViewer(tripId, subs, index = 0, { onTag = null } = {}) {
  return new Promise((resolve) => {
    let i = Math.max(0, Math.min(subs.length - 1, index));
    let changed = false;
    let closed = false;
    let pushed = false;

    // ---------- DOM ----------
    const counter = h('span', { class: 'pv-counter' });
    const closeBtn = h('button', { class: 'pv-btn pv-close', 'aria-label': '關閉', onclick: () => close() }, '✕');
    const tagBtn = h('button', { class: 'pv-btn pv-tag', 'aria-label': '標記與說明', hidden: !onTag,
      onclick: async () => { if (!onTag) return; const cur = subs[i]; await closeNow(); onTag(cur); } }, '✏️');
    const track = h('div', { class: 'pv-track' });
    const stage = h('div', { class: 'pv-stage' }, track);
    const caption = h('div', { class: 'pv-caption' });
    const reacts = h('div', { class: 'pv-reacts' });
    const commentBtn = h('button', { class: 'pv-btn pv-cbtn', onclick: () => toggleSheet() });
    const bottom = h('div', { class: 'pv-bottom' }, caption, h('div', { class: 'pv-actions' }, reacts, commentBtn));
    const sheetList = h('div', { class: 'pv-clist' });
    const field = h('input', { class: 'field', type: 'text', placeholder: '留一句話給拍的人…', maxlength: 240 });
    const sheet = h('div', { class: 'pv-sheet', hidden: true },
      h('div', { class: 'pv-sheet-head' }, h('span', {}, '留言'),
        h('button', { class: 'pv-btn', 'aria-label': '收起留言', onclick: () => toggleSheet(false) }, '⌄')),
      sheetList,
      h('div', { class: 'pv-cadd' }, field, h('button', { class: 'btn btn-primary', onclick: () => sendComment() }, '送出')),
    );
    const root = h('div', { class: 'pv', role: 'dialog', 'aria-label': '照片檢視' },
      h('div', { class: 'pv-top' }, closeBtn, counter, tagBtn),
      stage, bottom, sheet,
    );
    document.body.append(root);
    document.body.classList.add('pv-open');

    // ---------- 圖片：滑動不重建（元素快取重用）＋ 縮圖滿版 ＋ 全圖 decode 完才換 ----------
    // 實機錄影抽幀抓到的兩個閃爍源（b026 單幀亮度 32、b027 縮圖以原始小尺寸置中）：
    //   ① 每次滑完把三格砍掉重建 → 中間格在 blob URL 非同步載入前是空的 → 黑一幀。
    //      改成以照片 id 快取 slide 元素：滑過去的那格本來就載好、就在畫面上，直接
    //      變成新的中間格，DOM 只是重新排位，不會有空窗。
    //   ② CSS 只限最大尺寸，240px 縮圖不會被放大 → 先小圖後大圖，肉眼就是跳一下。
    //      .pv-img 改滿版 object-fit: contain（縮圖放大到與全圖同版面），全圖用
    //      decode() 解完才換 src —— 換上那一刻只有清晰度變化，沒有尺寸/亮度斷點。
    const slideCache = new Map();           // sub.id → slide 元素（含載入狀態）
    const slideFor = (sub) => {
      if (!sub) return h('div', { class: 'pv-slide' });
      if (slideCache.has(sub.id)) return slideCache.get(sub.id);
      const img = h('img', { class: 'pv-img', alt: '', draggable: false });
      const slide = h('div', { class: 'pv-slide' }, img);
      slideCache.set(sub.id, slide);
      (async () => {
        const thumb = await blobURL(sub.thumbHash).catch(() => '');
        if (thumb) {
          img.src = thumb;
          try { await img.decode(); } catch { /* 解不了就讓瀏覽器自己排 */ }
        }
        if (sub.photoHash && sub.photoHash !== sub.thumbHash) {
          const full = await blobURL(sub.photoHash).catch(() => '');
          if (!full) return;
          const pre = new Image();
          pre.src = full;
          try { await pre.decode(); } catch { await new Promise((r) => { pre.onload = r; pre.onerror = r; }); }
          // 縮圖→全圖：150ms 交叉淡入（全圖疊在縮圖上淡入，底圖一直在 → 不可能空窗；
          // 版面同尺寸 → 不跳大小）。使用者開了「減少動態」就直接換。
          const reduced = document.documentElement.classList.contains('reduce-motion');
          if (reduced || !thumb) {
            img.src = full;                 // 已解碼：換上只有清晰度變化
            img.dataset.full = '1';
          } else {
            const top = h('img', { class: 'pv-img pv-fadein', alt: '', draggable: false, src: full });
            slide.append(top);
            requestAnimationFrame(() => requestAnimationFrame(() => top.classList.add('on')));
            setTimeout(() => {
              img.src = full;               // 底圖也換成全圖（同一張、已解碼），再拿掉疊層
              img.dataset.full = '1';
              top.remove();
            }, 200);
          }
        } else if (!thumb && sub.photoHash) {
          const full = await blobURL(sub.photoHash).catch(() => '');
          if (full) img.src = full;
        }
      })();
      return slide;
    };
    let slides = [];
    function buildSlides() {
      // 快取只留目前位置附近 ±3 張（縮圖/全圖的 blob URL 另有全域快取，這裡只管 DOM）
      const keep = new Set();
      for (let k = i - 3; k <= i + 3; k++) if (subs[k]) keep.add(subs[k].id);
      for (const id of [...slideCache.keys()]) if (!keep.has(id)) slideCache.delete(id);
      slides = [subs[i - 1], subs[i], subs[i + 1]].map(slideFor);
      track.replaceChildren(...slides);     // 中間格是剛剛就在畫面上的那個元素 → 不會空一幀
      track.style.transition = 'none';
      track.style.transform = 'translateX(calc(-100% / 3))';   // 軌道寬 300%：中間那格 = -1/3
      resetZoom();
      counter.textContent = `${i + 1} / ${subs.length}`;
      drawMeta();
    }

    // ---------- 說明、按讚、留言 ----------
    function drawMeta() {
      const sub = subs[i];
      const quest = store.getRaw(sub.questId);
      const spot = quest ? store.getRaw(quest.spotId) : null;
      const shooter = shooterOf(sub);
      const who = shooter ? store.getRaw(shooter)?.displayName : null;
      const subjects = subjectsOf(sub).map((id) => store.getRaw(id)?.displayName).filter(Boolean);
      const cap = store.photoCaption(sub);
      caption.replaceChildren(
        h('div', { class: 'pv-cap-1' }, (who || sub.byDevice || '旅伴') + ' 拍的' + (subjects.length ? ` · 📸 ${subjects.join('、')}` : '')),
        h('div', { class: 'pv-cap-2' }, [spot?.name, quest?.title].filter(Boolean).join(' · ') + (cap ? `　「${cap}」` : '')),
      );
      const rs = store.reactionsOf(sub.id);
      const me = activeMemberId(tripId);
      const mine = me ? store.myReaction(sub.id, me) : null;
      reacts.replaceChildren(...REACTIONS.map((emo) => {
        const n = rs.filter((r) => r.emoji === emo).length;
        return h('button', {
          class: 'react-btn pv-react' + (mine?.emoji === emo ? ' on' : ''),
          onclick: async () => {
            const actor = await ensureMember(tripId);
            if (!actor) return;
            await store.toggleReaction(sub.id, actor, emo);
            changed = true;
            drawMeta();
          },
        }, emo, n ? String(n) : '');
      }));
      const cs = store.commentsOf(sub.id);
      commentBtn.textContent = `💬 留言${cs.length ? ' ' + cs.length : ''}`;
      sheetList.replaceChildren(...(cs.length ? cs.map((c) => {
        const w = c.actorId ? store.getRaw(c.actorId) : null;
        return h('div', { class: 'fi-comment' }, h('b', {}, (w?.displayName || '旅伴') + '：'), c.text);
      }) : [h('p', { class: 'muted sm', style: 'margin:6px 0' }, '還沒有留言，留一句吧')]));
    }
    async function sendComment() {
      const text = field.value.trim();
      if (!text) return;
      const actor = await ensureMember(tripId);
      if (!actor) { toast('先選一下你是誰'); return; }
      await store.addComment(subs[i].id, actor, text);
      field.value = '';
      changed = true;
      drawMeta();
    }
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendComment(); } });
    function toggleSheet(force) {
      const open = force !== undefined ? force : sheet.hidden;
      sheet.hidden = !open;
      if (open) setTimeout(() => field.focus(), 50);
    }

    // ---------- 手勢：左右滑、下滑關閉、雙指縮放、雙擊 ----------
    let scale = 1, tx = 0, ty = 0;          // 目前這一張的縮放與位移
    const curImg = () => slides[1] && slides[1].querySelector('img');
    function applyZoom() {
      const img = curImg();
      if (img) img.style.transform = scale > 1 ? `translate(${tx}px, ${ty}px) scale(${scale})` : '';
    }
    function resetZoom() { scale = 1; tx = 0; ty = 0; applyZoom(); }

    const ptrs = new Map();
    let gesture = null;                     // { kind: 'swipe'|'pinch'|'pan', ... }
    let lastTap = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pv-bottom, .pv-sheet, .pv-top')) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture?.(e.pointerId);
      if (ptrs.size === 1) {
        gesture = { kind: scale > 1 ? 'pan' : 'swipe', x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, t0: Date.now(), dx: 0, dy: 0 };
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx0: tx, ty0: ty };
        track.style.transition = 'none'; track.style.transform = 'translateX(calc(-100% / 3))';
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !gesture) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.kind === 'pinch' && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        scale = Math.max(1, Math.min(4, gesture.s0 * (d / Math.max(1, gesture.d0))));
        applyZoom();
        return;
      }
      const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
      gesture.dx = dx; gesture.dy = dy;
      if (gesture.kind === 'pan') { tx = gesture.tx0 + dx; ty = gesture.ty0 + dy; applyZoom(); return; }
      // swipe：先判定方向（水平翻頁 / 垂直關閉）
      if (!gesture.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      track.style.transition = 'none';
      if (gesture.axis === 'x') track.style.transform = `translateX(calc(-100% / 3 + ${dx}px))`;
      else if (gesture.axis === 'y' && dy > 0) { track.style.transform = `translate(calc(-100% / 3), ${dy}px)`; root.style.opacity = String(Math.max(0.35, 1 - dy / 400)); }
    });
    const endPtr = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'pinch') {
        if (ptrs.size < 2) { if (scale < 1.05) resetZoom(); gesture = null; }
        return;
      }
      const g = gesture; gesture = null;
      const dt = Date.now() - g.t0;
      const isTap = Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8 && dt < 400;
      if (g.kind === 'pan' && !isTap) return;        // 放大時拖曳看細節；輕點仍要能雙擊還原
      if (isTap) {
        const now = Date.now();
        if (now - lastTap < 320) {                    // 雙擊：放大 / 還原
          if (scale > 1) resetZoom();
          else { scale = 2.5; const r = stage.getBoundingClientRect(); tx = (r.width / 2 - (e.clientX - r.left)) * 1.5; ty = (r.height / 2 - (e.clientY - r.top)) * 1.5; applyZoom(); }
          lastTap = 0;
        } else { lastTap = now; root.classList.toggle('pv-hide-ui'); }   // 單擊：藏／顯示上下列
        track.style.transition = ''; track.style.transform = 'translateX(calc(-100% / 3))';
        return;
      }
      if (g.axis === 'y' && g.dy > 90) { close(); return; }
      root.style.opacity = '';
      const fast = Math.abs(g.dx) / Math.max(1, dt) > 0.45;
      if (g.axis === 'x' && (Math.abs(g.dx) > 70 || fast)) {
        if (g.dx < 0 && i < subs.length - 1) return go(1);
        if (g.dx > 0 && i > 0) return go(-1);
      }
      track.style.transition = ''; track.style.transform = 'translateX(calc(-100% / 3))';
    };
    stage.addEventListener('pointerup', endPtr);
    stage.addEventListener('pointercancel', endPtr);
    let going = false;
    function go(dir) {
      if (going) return;
      const ni = i + dir;
      if (ni < 0 || ni >= subs.length) return;
      going = true;
      track.style.transition = '';
      track.style.transform = dir > 0 ? 'translateX(calc(-200% / 3))' : 'translateX(0)';
      const done = () => { track.removeEventListener('transitionend', done); i = ni; buildSlides(); going = false; };
      track.addEventListener('transitionend', done);
      setTimeout(done, 320);                         // transitionend 沒來（縮到背景）也要收尾
    }

    // ---------- 關閉、鍵盤、返回鍵 ----------
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    const onPop = () => { pushed = false; closeNow(); };
    try { history.pushState({ tqViewer: 1 }, ''); pushed = true; } catch { pushed = false; }
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);

    function close() {
      if (closed) return;
      if (pushed) { history.back(); return; }        // popstate → closeNow
      closeNow();
    }
    function closeNow() {
      if (closed) return Promise.resolve();
      closed = true;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('pv-open');
      root.remove();
      resolve({ changed });
      return Promise.resolve();
    }

    // 給測試／鍵盤用的公開句柄
    root.__tq = { go, close, get index() { return i; }, get scale() { return scale; }, zoomTo: (s) => { scale = s; applyZoom(); } };
    buildSlides();
  });
}
