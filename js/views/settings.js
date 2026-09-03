import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, promptDialog, fmtBytes } from '../ui.js';
import { navigate } from '../router.js';
import { estimate, isPersisted, requestPersist, wipeAll } from '../db.js';
import { deviceName, setDeviceName } from '../ids.js';
import { importBundle, importShareCode } from '../share.js';
import { getPrefs, setPref, FS_LABELS } from '../prefs.js';
import { getConfig, setConfig, activeAdapter, syncNow } from '../sync.js';

export default async function settings() {
  setTop({ title: '設定', back: false });

  const est = await estimate();
  const persisted = await isPersisted();
  const usedPct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const prefs = getPrefs();
  const syncCfg = getConfig();

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
    // ---- 看得舒服 ----
    h('div', { class: 'section-label' }, '看得舒服'),
    h('div', { class: 'form-field' },
      h('span', { class: 'form-label' }, '字體大小'),
      h('div', { class: 'seg' }, ...Object.entries(FS_LABELS).map(([k, label]) =>
        h('button', { class: prefs.fs === k ? 'on' : '', onclick: () => { setPref('fs', k); settings(); } }, label))),
    ),
    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '高對比模式'),
        h('div', { class: 'form-hint' }, '背景更深、文字更白，看起來更清楚。')),
      checkbox(prefs.contrast === 'high', (on) => { setPref('contrast', on ? 'high' : 'normal'); })),

    // ---- 這台裝置 ----
    h('div', { class: 'section-label' }, '這台裝置'),
    h('div', { class: 'setting-row' },
      h('span', { style: 'font-weight:700' }, '裝置名稱'),
      h('button', { class: 'btn btn-soft', onclick: async () => {
        const v = await promptDialog('裝置名稱', { value: deviceName() });
        if (v) { setDeviceName(v); toast('已更新'); settings(); }
      } }, deviceName())),

    // ---- 儲存空間 ----
    h('div', { class: 'section-label' }, '儲存空間'),
    h('div', { class: 'card storage-box' },
      h('div', { class: 'storage-bar' }, h('i', { style: `width:${usedPct}%` })),
      h('div', { class: 'sm muted' }, `已用 ${fmtBytes(est.usage)}${est.quota ? ` / 約 ${fmtBytes(est.quota)}` : ''}`),
      h('div', { class: 'form-hint' }, persisted
        ? '✓ 系統已答應保留資料，不會自動清除。'
        : '⚠ iOS 上若長期沒開，資料可能約 7 天後被清掉——建議把 App 加到主畫面，並常常用「匯出備份」留一份。'),
      !persisted ? h('button', { class: 'btn btn-soft', onclick: async () => {
        const ok = await requestPersist();
        toast(ok ? '好了，資料會被保留' : '系統沒答應，請先把 App 加到主畫面');
        settings();
      } }, '要求保留資料') : null,
    ),

    // ---- 多人同步 ----
    h('div', { class: 'section-label' }, '多人同步'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm' }, `目前：${activeAdapter().label}`),
      h('p', { class: 'form-hint' }, syncCfg.mode === 'lan'
        ? '大家的手機會透過你設定的伺服器互相同步行程、任務與照片。'
        : '尚未設定伺服器。現在用「分享連結」給旅伴任務清單，用「匯出 / 匯入備份」合併照片。'),
      h('div', { class: 'row-2', style: 'margin-top:8px' },
        h('button', { class: 'btn btn-soft', onclick: async () => {
          const url = await promptDialog('伺服器網址', {
            value: syncCfg.url || 'http://192.168.',
            placeholder: 'http://192.168.0.10:8787',
          });
          if (url === null) return;
          if (!url) { setConfig({}); toast('已改回單機'); return settings(); }
          setConfig({ mode: 'lan', url: url.trim() });
          toast('已設定，測試連線中…');
          const st = await activeAdapter().status();
          toast(st.ok ? '連線成功！' : '連不上：' + st.detail);
          settings();
        } }, syncCfg.mode === 'lan' ? '更改伺服器' : '設定伺服器'),
        syncCfg.mode === 'lan' ? h('button', { class: 'btn btn-primary', onclick: async () => {
          toast('同步中…');
          try { const r = await syncNow({ onProgress: (m) => toast(m) }); toast(r.skipped ? '目前是單機模式' : `同步完成`); }
          catch (e) { toast('同步失敗：' + e.message); }
          settings();
        } }, '立即同步') : null,
      ),
      h('p', { class: 'form-hint' }, '伺服器可由家人在自己的電腦執行（專案裡的 server 資料夾），不需要註冊任何服務。'),
    ),

    // ---- 加入 / 匯入 ----
    h('div', { class: 'section-label' }, '加入 / 匯入'),
    h('button', { class: 'btn btn-soft btn-block', onclick: joinByCode }, '🔗 用代碼加入旅伴的旅程'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => bundleInput.click() }, '📥 匯入備份檔（.tripquest.json）'),
    bundleInput,

    // ---- 關於 ----
    h('div', { class: 'section-label' }, '關於'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm' }, 'TripQuest 旅圖任務 v1.1 — 純前端 App，所有資料（含照片）只存在你的裝置，不需註冊。'),
      h('p', { class: 'form-hint' }, '任務來源：內建景點資料庫 + 規則模板；景點示意圖來自 zh.wikipedia.org（只送景點名稱）。'),
    ),

    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog('清除所有旅程與照片？無法復原，建議先匯出備份。', { danger: true, okLabel: '全部清除' })) {
          await wipeAll();
          location.reload();
        }
      } }, '清除所有資料'),
    ),
  ));
}

function checkbox(checked, onChange) {
  const el = h('input', { type: 'checkbox', checked });
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

async function joinByCode() {
  const raw = await promptDialog('貼上代碼或分享連結', { multiline: true, okLabel: '加入' });
  if (!raw) return;
  const code = raw.includes('d=') ? raw.split('d=')[1].trim().split(/[&\s]/)[0] : raw.trim();
  try {
    const tripId = await importShareCode(code);
    toast('已加入');
    navigate(`/trip/${tripId}`);
  } catch (e) { toast('代碼無法解析：' + e.message); }
}
