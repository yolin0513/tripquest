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
import { getAIConfig, setAIConfig, aiConfigured, aiTest, aiUsage, FEATURES } from '../ai.js';
import { getContacts, setContacts } from '../emergency.js';
import { getHome, setHome } from '../weather.js';

const HOME_CITIES = [
  { name: '台北', lat: 25.03, lng: 121.56 }, { name: '新北', lat: 25.01, lng: 121.46 },
  { name: '桃園', lat: 24.99, lng: 121.31 }, { name: '台中', lat: 24.15, lng: 120.67 },
  { name: '台南', lat: 22.99, lng: 120.21 }, { name: '高雄', lat: 22.63, lng: 120.30 },
  { name: '新竹', lat: 24.80, lng: 120.97 }, { name: '花蓮', lat: 23.98, lng: 121.60 },
  { name: '宜蘭', lat: 24.76, lng: 121.75 }, { name: '嘉義', lat: 23.48, lng: 120.45 },
];

const AI_FEATURE_LABELS = {
  recommend: ['景點・美食一句話介紹', '內建資料庫沒有的景點，補一句在地介紹'],
  narrate: ['回憶影片旁白文字', '每天一句溫暖的旁白（仍可自己改）'],
  tts: ['旁白語音（唸出來）', '把旁白配成語音，需要伺服器設定 Google TTS 金鑰'],
};

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
    h('div', { class: 'setting-row' },
      h('div', {}, h('span', { style: 'font-weight:700' }, '居住地'),
        h('div', { class: 'form-hint' }, '天氣提醒會用它算「比家裡冷幾度」。')),
      h('button', { class: 'btn btn-soft', onclick: () => pickHome(settings) },
        (getHome() && getHome().name) || '未設定')),

    // ---- 緊急聯絡人 ----
    h('div', { class: 'section-label' }, '緊急聯絡人'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm muted' }, '出門在外走失或需要幫忙時，右下角紅色「🆘」按鈕會用到這些聯絡人。只存這支手機，不會同步給旅伴。'),
      emergencyContactEditor(settings),
      h('button', { class: 'btn btn-danger btn-block', style: 'margin-top:10px', onclick: () => navigate('/sos') }, '🆘 打開緊急求助畫面'),
    ),

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

    // ---- AI 加值（進階、可選）----
    h('div', { class: 'section-label' }, 'AI 加值功能（進階、可選）'),
    aiSection(settings),

    // ---- 關於 ----
    h('div', { class: 'section-label' }, '關於'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm' }, 'TripQuest 旅圖任務 v1.4 — 純前端 App，不需帳號密碼。單機可用；設定同步後照片會存一份到旅伴共用的伺服器。'),
      h('p', { class: 'form-hint' }, '任務來源：內建景點資料庫 + 規則模板；景點示意圖來自 zh.wikipedia.org（只送景點名稱）。AI 加值功能預設關閉。'),
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

async function pickHome(refresh) {
  const actions = HOME_CITIES.map((c) => ({ label: c.name, value: c.name }));
  actions.push({ label: '用目前位置（GPS）', value: '__gps' });
  actions.push({ label: '清除', value: '__clear' });
  actions.push({ label: '取消', value: null });
  const pick = await modal({ title: '居住地', body: h('p', { class: 'sm muted' }, '選一個離你家最近的城市就好。'), actions });
  if (!pick) return;
  if (pick === '__clear') { setHome(null); toast('已清除'); return refresh(); }
  if (pick === '__gps') {
    toast('定位中…');
    const { currentPosition } = await import('../geo.js');
    const pos = await currentPosition({ timeout: 8000, maxAgeMs: 0 });
    if (pos) { setHome({ lat: pos.lat, lng: pos.lng, name: '目前位置' }); toast('已設定'); }
    else toast('拿不到位置，請開啟定位權限');
    return refresh();
  }
  const c = HOME_CITIES.find((x) => x.name === pick);
  if (c) { setHome({ ...c }); toast('已設定為 ' + c.name); }
  refresh();
}

function emergencyContactEditor(refresh) {
  const wrap = h('div', {});
  const draw = async () => {
    const list = await getContacts();
    wrap.replaceChildren(
      ...list.map((c, i) => h('div', { class: 'contact-row' },
        h('div', { class: 'contact-row-main' },
          h('div', { style: 'font-weight:700' }, c.name + (c.relation ? `（${c.relation}）` : '')),
          h('div', { class: 'muted sm' }, c.phone || '未填電話'),
        ),
        h('button', { class: 'btn btn-soft sm-btn', onclick: async () => {
          const name = await promptDialog('名字', { value: c.name });
          if (name === null) return;
          const phone = await promptDialog('電話', { value: c.phone || '', placeholder: '09xx-xxx-xxx' });
          const rel = await promptDialog('關係（例：兒子、女兒，可留空）', { value: c.relation || '' });
          list[i] = { name: name || c.name, phone: (phone || '').trim(), relation: (rel || '').trim() };
          await setContacts(list); draw();
        } }, '✎'),
        h('button', { class: 'btn btn-danger sm-btn', onclick: async () => {
          list.splice(i, 1); await setContacts(list); draw();
        } }, '🗑️'),
      )),
      h('button', { class: 'btn btn-soft btn-block', style: 'margin-top:8px', onclick: async () => {
        const name = await promptDialog('聯絡人名字', { okLabel: '下一步' });
        if (!name) return;
        const phone = await promptDialog('電話', { placeholder: '09xx-xxx-xxx', okLabel: '下一步' });
        const rel = await promptDialog('關係（可留空）', { okLabel: '加入' });
        list.push({ name, phone: (phone || '').trim(), relation: (rel || '').trim() });
        await setContacts(list); draw();
      } }, '＋ 加緊急聯絡人'),
    );
  };
  draw();
  return wrap;
}

// ---- AI 加值層 ----
function aiSection(refresh) {
  const cfg = getAIConfig();
  const on = aiConfigured();

  const box = h('div', { class: 'card about' },
    h('p', { class: 'sm' }, on
      ? '已連上你自己的 AI 伺服器。沒開的功能一切照舊，不會有任何花費。'
      : '不設定也完全能用 —— 這是給想要「更精美一點」的人的選項。金鑰放在你自己的 Cloudflare Worker（我們不經手），Worker 有每月花費上限與速率限制。'),
  );

  if (!on) {
    box.append(h('button', { class: 'btn btn-soft btn-block', onclick: () => configureAI(refresh) }, '⚙️ 設定 AI 伺服器'),
      h('p', { class: 'form-hint' }, '做法見 docs/AI_INTEGRATION.md。實測一年約 $0～3 美金；訂閱制服務一律不建議。'));
    return box;
  }

  // 各功能開關
  for (const f of FEATURES) {
    const [title, hint] = AI_FEATURE_LABELS[f];
    box.append(h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, title), h('div', { class: 'form-hint' }, hint)),
      checkbox(cfg.features[f], (v) => { setAIConfig({ features: { [f]: v } }); })));
  }

  // 用量 / 花費
  const usageLine = h('p', { class: 'sm muted', style: 'margin-top:10px' }, '讀取本月用量…');
  const bar = h('div', { class: 'storage-bar', style: 'margin-top:6px' }, h('i', { style: 'width:0%' }));
  aiUsage().then((u) => {
    if (!u) { usageLine.textContent = '（連不上伺服器，無法顯示用量）'; return; }
    const pct = u.capUsd ? Math.min(100, (u.usedUsd / u.capUsd) * 100) : 0;
    bar.firstChild.style.width = pct + '%';
    usageLine.textContent = `本月已用 $${u.usedUsd.toFixed(2)} / 上限 $${u.capUsd.toFixed(2)}（${u.calls} 次）・每月 1 號重置`;
  });
  box.append(usageLine, bar);

  box.append(h('div', { class: 'stack', style: 'margin-top:12px' },
    h('button', { class: 'btn btn-soft btn-block', onclick: () => configureAI(refresh) }, '更改伺服器 / 通行碼'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: async () => {
      if (await confirmDialog('移除 AI 設定？功能會回到免金鑰的做法。')) { setAIConfig({ url: '', token: '' }); toast('已移除'); refresh(); }
    } }, '移除 AI 設定'),
  ));
  return box;
}

async function configureAI(refresh) {
  const cfg = getAIConfig();
  const urlField = h('input', { class: 'field', type: 'url', value: cfg.url, placeholder: 'https://tripquest.你的名字.workers.dev' });
  const tokenField = h('input', { class: 'field', type: 'text', value: cfg.token, placeholder: 'AI 通行碼（你在 Worker 設的 AI_ACCESS_TOKEN）' });
  const res = await modal({
    title: 'AI 伺服器設定',
    body: h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 10px' }, '同一個 Cloudflare Worker 就能跑同步 + AI。這裡只填網址和你自訂的通行碼，真正的 API 金鑰請用 `wrangler secret put` 設在 Worker，不要填在這裡。'),
      h('div', { class: 'stack' }, urlField, tokenField),
      h('p', { class: 'form-hint' }, '把通行碼分享給家人，他們在自己手機貼上就能用。金鑰外流也只會撞到每月上限，不會無限刷。'),
    ),
    actions: [{ label: '取消', value: null }, { label: '測試並儲存', value: 'save', primary: true }],
  });
  if (res !== 'save') return;
  const url = urlField.value.trim().replace(/\/$/, '');
  const token = tokenField.value.trim();
  if (!url || !token) { toast('網址和通行碼都要填'); return refresh(); }
  toast('測試中…');
  const t = await aiTest(url, token);
  if (!t.ok) { toast('連不上：' + (t.message || t.error || '')); return; }
  setAIConfig({ url, token });
  const f = t.usage && t.usage.features || {};
  toast(`連線成功！文字：${f.recommend ? '可用' : '未設金鑰'}、語音：${f.tts ? '可用' : '未設金鑰'}`);
  refresh();
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
