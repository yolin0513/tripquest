import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, promptDialog, modal, fmtBytes } from '../ui.js';
import { navigate } from '../router.js';
import { estimate, isPersisted, requestPersist, wipeAll } from '../db.js';
import { importBundle, importShareCode, joinInvite } from '../share.js';
import { getPrefs, setPref, FS_LABELS } from '../prefs.js';
import { getConfig, setConfig, modeLabel, syncEnabled, testConnection, syncNow } from '../sync.js';
import { myName, setMyName, exportCard, encodeCard, decodeCard, importCard } from '../identity.js';
import { pendingCount } from '../outbox.js';

export default async function settings() {
  setTop({ title: '設定', back: false });

  const est = await estimate();
  const persisted = await isPersisted();
  const usedPct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const prefs = getPrefs();
  const syncCfg = getConfig();
  const pending = await pendingCount();

  const bundleInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  bundleInput.addEventListener('change', async () => {
    const f = bundleInput.files[0]; bundleInput.value = '';
    if (!f) return;
    toast('匯入中…');
    try {
      const tripId = await importBundle(f);
      toast('匯入完成');
      if (tripId) navigate(`/trip/${tripId}`, { replace: true });
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

    // ---- 我 ----
    h('div', { class: 'section-label' }, '我'),
    h('div', { class: 'setting-row' },
      h('span', { style: 'font-weight:700' }, '我的名字'),
      h('button', { class: 'btn btn-soft', onclick: async () => {
        const v = await promptDialog('你的名字', { value: myName() });
        if (v) { await setMyName(v); toast('已更新'); settings(); }
      } }, myName())),

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
      h('p', { class: 'sm' }, `目前：${modeLabel()}`),
      syncEnabled()
        ? h('p', { class: 'form-hint' }, '大家的手機會自動同步行程、任務、照片、按讚與留言。')
        : h('p', { class: 'form-hint' }, '尚未設定。現在用「分享連結」給旅伴任務清單、用「匯出 / 匯入備份」合併照片。設定同步後，一切自動。'),
      syncEnabled() && pending.total ? h('p', { class: 'tag tag-todo', style: 'display:inline-block' }, `📤 ${pending.blobs} 張照片待上傳`) : null,
      h('div', { class: 'stack', style: 'margin-top:10px' },
        h('button', { class: 'btn btn-soft btn-block', onclick: () => configureSync(settings) },
          syncEnabled() ? '更改伺服器設定' : '設定同步伺服器'),
        syncEnabled() ? h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
          toast('同步中…');
          try { const r = await syncNow({ onProgress: (m) => toast(m) }); toast(r.skipped ? '目前是單機模式' : '同步完成'); }
          catch (e) { toast('同步失敗：' + e.message); }
          settings();
        } }, '立即同步') : null,
      ),
      h('p', { class: 'form-hint' }, '伺服器可用 Cloudflare（免費，見 SETUP_TODO.md），或家人在自己電腦執行 server 資料夾。'),
    ),

    // ---- 我的身分 ----
    h('div', { class: 'section-label' }, '我的身分'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm' }, `你是「${myName()}」。換手機時，用下面的備份卡就能把過去的照片認回來。`),
      h('button', { class: 'btn btn-soft btn-block', onclick: showIdentityCard }, '🪪 顯示 / 儲存我的身分備份卡'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => restoreIdentityCard(settings) }, '從備份卡還原（換新手機時）'),
    ),

    // ---- 加入 / 匯入 ----
    h('div', { class: 'section-label' }, '加入 / 匯入'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => joinByCode(settings) }, '🔗 用邀請連結加入旅伴的旅程'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => bundleInput.click() }, '📥 匯入備份檔（.tripquest.json）'),
    bundleInput,

    // ---- 關於 ----
    h('div', { class: 'section-label' }, '關於'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm' }, 'TripQuest 旅圖任務 v1.2 — 純前端 App，不需帳號密碼。單機可用；設定同步後照片會存一份到旅伴共用的伺服器。'),
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
  const raw = await promptDialog('貼上邀請連結', { multiline: true, okLabel: '加入' });
  if (!raw) return;
  const s = raw.trim();
  try {
    if (s.includes('j=')) {
      const tripId = await joinInvite(s.split('j=')[1].trim().split(/[&\s]/)[0]);
      toast('已加入');
      navigate(`/trip/${tripId}`, { replace: true });
    } else {
      const code = s.includes('d=') ? s.split('d=')[1].trim().split(/[&\s]/)[0] : s;
      const tripId = await importShareCode(code);
      toast('已加入');
      navigate(`/trip/${tripId}`, { replace: true });
    }
  } catch (e) { toast('連結無法解析：' + e.message); }
}

// ---- 設定同步伺服器 ----
async function configureSync(refresh) {
  const cfg = getConfig();
  const modeBtns = h('div', { class: 'music-pick' });
  let mode = cfg.mode === 'local' ? 'cloud' : cfg.mode;
  let url = cfg.url || '';
  const urlField = h('input', { class: 'field', type: 'url', value: url, placeholder: 'https://tripquest.你的名字.workers.dev' });
  function drawModes() {
    modeBtns.replaceChildren(
      h('button', { class: mode === 'cloud' ? 'on' : '', onclick: () => { mode = 'cloud'; drawModes(); } }, '☁️ Cloudflare（推薦）'),
      h('button', { class: mode === 'lan' ? 'on' : '', onclick: () => { mode = 'lan'; drawModes(); } }, '🖥️ 自架伺服器 / Tunnel'),
      h('button', { class: mode === 'off' ? 'on' : '', onclick: () => { mode = 'off'; drawModes(); } }, '📴 關閉同步（單機）'),
    );
  }
  drawModes();
  const res = await modal({
    title: '多人同步',
    body: h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 10px' }, '選一種、貼上伺服器網址。設定完成後所有旅程自動同步。'),
      modeBtns,
      h('div', { style: 'margin-top:10px' }, urlField),
      h('p', { class: 'form-hint' }, '沒有伺服器？看專案的 SETUP_TODO.md，Cloudflare 免費、約 40 分鐘。'),
    ),
    actions: [{ label: '取消', value: null }, { label: '儲存', value: 'save', primary: true }],
  });
  if (res !== 'save') return;
  if (mode === 'off') { setConfig({ mode: 'local', url: '' }); toast('已改回單機'); return refresh(); }
  const u = urlField.value.trim().replace(/\/$/, '');
  if (!u) { toast('請填網址'); return refresh(); }
  toast('測試連線中…');
  const st = await testConnection(u);
  if (!st.ok) { toast('連不上：' + (st.detail || '')); }
  else toast('連線成功！');
  setConfig({ mode, url: u });
  // 幫現有群組補上同步祕鑰
  const { ensureGroupSync } = await import('../share.js');
  for (const g of store.exportRecords().filter((r) => r.type === 'group' && !r.deleted)) await ensureGroupSync(g.id);
  syncNow().catch(() => {});
  refresh();
}

// ---- 身分備份卡 ----
async function showIdentityCard() {
  const card = await exportCard();
  const code = encodeCard(card);
  await modal({
    title: '我的身分備份卡',
    body: h('div', {},
      h('p', { class: 'sm muted' }, '換手機時，在新手機的「設定 → 從備份卡還原」貼上這串，過去所有照片就會認回來。建議截圖、或用 LINE 傳給自己。'),
      h('textarea', { class: 'field mono', rows: 5, readonly: true, onclick: (e) => e.target.select() }, code),
      h('button', {
        class: 'btn btn-primary btn-block', onclick: async () => {
          try { await navigator.clipboard.writeText(code); toast('已複製'); } catch { toast('請長按上面文字複製'); }
        },
      }, '複製'),
      card.groups.length ? h('p', { class: 'form-hint' }, `包含 ${card.groups.length} 個已同步的群組。`) : null,
    ),
    actions: [{ label: '關閉', value: true }],
  });
}

async function restoreIdentityCard(refresh) {
  const raw = await promptDialog('貼上身分備份卡', { multiline: true, okLabel: '還原' });
  if (!raw) return;
  try {
    const card = decodeCard(raw.trim());
    if (!await confirmDialog(`這會把這台裝置的身分改成「${card.name || '（未命名）'}」，並接手它已加入的 ${(card.groups || []).length} 個群組。要繼續嗎？`)) return;
    const r = await importCard(card);
    toast(`已還原，接手 ${r.groups} 個群組`);
    const { syncNow: sn } = await import('../sync.js');
    sn().catch(() => {});
    refresh();
  } catch (e) { toast('還原失敗：' + e.message); }
}
