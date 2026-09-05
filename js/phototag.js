// 照片標記畫面 —— 上傳時完全不問「照片裡有誰」，一次選 10 張也不會被統一套用標錯；
// 改成事後在照片牆點照片進來，一張一張標，可以「下一張」連續標完。
//
// 兩個設計決定：
//   1. 點名字就直接存，沒有「儲存」按鈕 —— 長輩少一個要記得按的東西，也不會標完忘了存。
//   2. 標記存成 store 的 phototag 記錄（見 store.js），不是改投稿本身，否則不會同步。

import { h, mount, toast, confirmDialog, promptDialog } from './ui.js';
import * as store from './store.js';
import { blobURL } from './photos.js';

export function openTagger(tripId, startId, listIn) {
  const trip = store.get(tripId);
  if (!trip) return Promise.resolve(false);

  const members = store.membersOf(trip.groupId);
  const all = (listIn && listIn.length ? listIn : store.submissionsOfTrip(tripId))
    .filter((s) => store.getRaw(s.id));
  if (!all.length) return Promise.resolve(false);

  let i = Math.max(0, all.findIndex((s) => s.id === startId));
  let changed = false;

  return new Promise((resolve) => {
    const body = h('div', { class: 'tagger-body' });
    const counter = h('span', { class: 'tagger-count' });
    const card = h('div', { class: 'tagger' },
      h('div', { class: 'tagger-head' },
        counter,
        h('button', { class: 'tagger-close', 'aria-label': '關閉', onclick: close }, '✕'),
      ),
      body,
    );
    const overlay = h('div', { class: 'modal-overlay tagger-overlay' }, card);
    document.getElementById('modalRoot').append(overlay);
    document.addEventListener('keydown', onKey);
    draw();

    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(changed);
    }

    function go(step) {
      const next = i + step;
      if (next < 0 || next >= all.length) return;
      i = next;
      card.scrollTop = 0;
      draw();
    }

    // 下一張「還沒標的」；沒有了就收工
    function goNextUntagged() {
      for (let k = i + 1; k < all.length; k++) {
        if (!store.isPhotoTagged(store.getRaw(all[k].id) || all[k])) { i = k; card.scrollTop = 0; draw(); return; }
      }
      toast('都標好了，謝謝！');
      close();
    }

    async function draw() {
      const sub = store.getRaw(all[i].id) || all[i];
      counter.textContent = `第 ${i + 1} / ${all.length} 張`;

      const quest = store.getRaw(sub.questId);
      const spot = quest ? store.getRaw(quest.spotId) : null;

      const img = h('img', { class: 'tagger-photo', alt: '' });
      blobURL(sub.photoHash).then((u) => { if (u) img.src = u; });

      const subjRow = h('div', { class: 'tagger-chips' });
      const shotRow = h('div', { class: 'tagger-chips' });
      const saved = h('div', { class: 'tagger-saved' }, store.isPhotoTagged(sub) ? '✓ 已標記' : '尚未標記');

      const isLast = i >= all.length - 1;
      const cta = h('button', { class: 'btn btn-primary btn-block btn-big', style: 'margin-top:10px' });

      // 剩幾張沒標：每次存完都要重算，不然標完了按鈕還在喊「還有 N 張」
      function paintCta() {
        const left = store.untaggedPhotos(tripId).length;
        if (left > 0) {
          cta.textContent = `下一張還沒標的（還有 ${left} 張）`;
          cta.onclick = goNextUntagged;
        } else {
          cta.textContent = '標好了';
          cta.onclick = close;
        }
      }

      // 點一下就存：標記寫進 phototag 記錄，統計與徽章下次讀就是新的
      async function save(changes, redraw) {
        try {
          await store.setPhotoTag(sub.id, changes);
          changed = true;
          saved.textContent = '✓ 已存';
          redraw();
          paintCta();
        } catch (e) {
          console.error(e);
          toast('存不起來，請再試一次');
        }
      }

      const drawSubjects = () => {
        const cur = store.photoTag(store.getRaw(sub.id));
        const picked = new Set(cur.subjectIds);
        // 「沒有人」只有在真的標過、而且標成沒有人時才亮 —— 還沒標的照片不該看起來像已經選好了
        const noneChosen = cur.explicit && picked.size === 0;
        mount(subjRow,
          ...members.map((m) => h('button', {
            class: 'tagger-chip' + (picked.has(m.id) ? ' on' : ''),
            onclick: () => {
              const next = new Set(picked);
              next.has(m.id) ? next.delete(m.id) : next.add(m.id);
              save({ subjectIds: [...next] }, drawSubjects);
            },
          }, picked.has(m.id) ? '✓ ' + m.displayName : m.displayName)),
          h('button', {
            class: 'tagger-chip ghost' + (noneChosen ? ' on' : ''),
            onclick: () => save({ subjectIds: [] }, drawSubjects),
          }, noneChosen ? '✓ 沒有人（風景 / 食物）' : '沒有人（風景 / 食物）'),
        );
      };

      const drawShooter = () => {
        const cur = store.photoTag(store.getRaw(sub.id)).photographerId;
        mount(shotRow,
          ...members.map((m) => h('button', {
            class: 'tagger-chip' + (cur === m.id ? ' on' : ''),
            onclick: () => save({ photographerId: m.id }, drawShooter),
          }, cur === m.id ? '✓ ' + m.displayName : m.displayName)),
        );
      };
      drawSubjects();
      drawShooter();
      paintCta();

      mount(body,
        img,
        h('div', { class: 'tagger-where' }, [spot?.name, quest?.title].filter(Boolean).join(' · ') || '這趟的照片'),
        saved,

        h('div', { class: 'tagger-label' }, '照片裡有誰？',
          h('span', { class: 'tagger-sub' }, '可以複選，點一下就存好了')),
        subjRow,

        h('div', { class: 'tagger-label' }, '這張是誰拍的？'),
        shotRow,

        h('div', { class: 'tagger-nav' },
          h('button', { class: 'btn btn-soft', disabled: i === 0, onclick: () => go(-1) }, '‹ 上一張'),
          h('button', { class: 'btn btn-soft', disabled: isLast, onclick: () => go(1) }, '下一張 ›'),
        ),
        cta,

        h('div', { class: 'tagger-more' },
          h('button', { class: 'tag-btn', onclick: async () => {
            const c = await promptDialog('照片說明（可留空）', { value: store.photoCaption(store.getRaw(sub.id)), multiline: true });
            if (c === null) return;
            await store.setPhotoTag(sub.id, { caption: c });
            changed = true; toast('已更新'); draw();
          } }, '✏️ 加說明'),
          h('button', { class: 'tag-btn danger', onclick: async () => {
            if (!await confirmDialog('刪除這張照片？', { danger: true, okLabel: '刪除' })) return;
            await store.deleteSubmission(sub.id);
            changed = true;
            all.splice(i, 1);
            if (!all.length) { toast('已刪除'); close(); return; }
            if (i >= all.length) i = all.length - 1;
            toast('已刪除'); draw();
          } }, '🗑️ 刪除這張'),
        ),
      );
    }
  });
}
