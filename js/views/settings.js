import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, promptDialog, fmtBytes } from '../ui.js';
import { navigate } from '../router.js';
import { estimate, isPersisted, requestPersist, wipeAll } from '../db.js';
import { deviceName, setDeviceName } from '../ids.js';
import { importBundle, importShareCode } from '../share.js';

export default async function settings() {
  setTop({ title: '設定', back: false });

  const est = await estimate();
  const persisted = await isPersisted();
  const usedPct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;

  const bundleInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  bundleInput.addEventListener('change', async () => {
    const f = bundleInput.files[0]; bundleInput.value = '';
    if (!f) return;
    toast('匯入中…');
    try {
      const tripId = await importBundle(f);
      toast('匯入完成');
      if (tripId) navigate(`/trip/${tripId}`);
    } catch (e) { toast('匯入失敗：' + e.message); }
  });

  render(h('div', { class: 'page form' },
    h('div', { class: 'section-label' }, '這台裝置'),
    h('div', { class: 'setting-row' },
      h('span', {}, '裝置名稱'),
      h('button', { class: 'btn btn-soft', onclick: async () => {
        const v = await promptDialog('裝置名稱', { value: deviceName() });
        if (v) { setDeviceName(v); toast('已更新'); settings(); }
      } }, deviceName()),
    ),

    h('div', { class: 'section-label' }, '儲存空間'),
    h('div', { class: 'storage-box card' },
      h('div', { class: 'storage-bar' }, h('div', { class: 'storage-fill', style: `width:${usedPct}%` })),
      h('div', { class: 'sm muted' }, `已用 ${fmtBytes(est.usage)}${est.quota ? ` / 可用約 ${fmtBytes(est.quota)}` : ''}`),
      h('div', { class: 'form-hint' },
        persisted
          ? '✓ 系統已承諾保留資料，不會自動清除。'
          : '⚠ 尚未取得持久化許可。iOS 上若長期不開啟，資料可能在約 7 天後被清除——建議把 App 加到主畫面，並定期用「匯出備份」留一份。'),
      !persisted ? h('button', { class: 'btn btn-soft', onclick: async () => {
        const ok = await requestPersist();
        toast(ok ? '已取得持久化許可' : '系統未授予，請把 App 加到主畫面再試');
        settings();
      } }, '要求保留資料') : null,
    ),

    h('div', { class: 'section-label' }, '加入 / 匯入'),
    h('button', { class: 'btn btn-soft btn-block', onclick: joinByCode }, '🔗 用任務代碼加入行程'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => bundleInput.click() }, '📥 匯入完整備份檔（.tripquest.json）'),
    bundleInput,

    h('div', { class: 'section-label' }, '關於'),
    h('div', { class: 'about card' },
      h('p', { class: 'sm' }, 'TripQuest 旅圖任務 v1.0 —— 純前端 PWA，所有資料（含照片）只存在你的瀏覽器，不需註冊、不需後端。'),
      h('p', { class: 'form-hint' }, '任務資料來源：內建策展資料庫 + 規則式模板；開啟「維基百科參考照片」後會向 zh.wikipedia.org 查詢（僅送景點名稱）。'),
    ),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog('清除所有行程與照片？此動作無法復原。建議先匯出備份。', { danger: true, okLabel: '全部清除' })) {
          await wipeAll();
          location.reload();
        }
      } }, '清除所有資料'),
    ),
  ));
}

async function joinByCode() {
  const raw = await promptDialog('貼上任務代碼或分享連結', { multiline: true, okLabel: '加入' });
  if (!raw) return;
  const code = raw.includes('d=') ? raw.split('d=')[1].trim().split(/[&\s]/)[0] : raw.trim();
  try {
    const tripId = await importShareCode(code);
    toast('已加入行程');
    navigate(`/trip/${tripId}`);
  } catch (e) { toast('代碼無法解析：' + e.message); }
}
