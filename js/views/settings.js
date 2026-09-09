import { setTop, render } from '../app.js';
import { keepOriginals, originalUsage, dropOriginals } from '../photoexport.js';
import * as store from '../store.js';
import { h, toast, confirmDialog, promptDialog, modal, fmtBytes } from '../ui.js';
import { navigate } from '../router.js';
import { estimate, isPersisted, requestPersist, wipeAll } from '../db.js';
import { importBundle, importShareCode, joinInvite, parseInviteText } from '../share.js';
import { getPrefs, setPref, FS_LABELS } from '../prefs.js';
import { getConfig, setConfig, modeLabel, syncEnabled, testConnection, syncNow } from '../sync.js';
import { myName, setMyName, exportCard, encodeCard, decodeCard, importCard } from '../identity.js';
import { pendingCount } from '../outbox.js';
import { getContacts, setContacts } from '../emergency.js';
import { getHome, setHome } from '../weather.js';
import { wipeAllTripKeys, usageOf } from '../aikeys.js';

const HOME_CITIES = [
  { name: '台北', lat: 25.03, lng: 121.56 }, { name: '新北', lat: 25.01, lng: 121.46 },
  { name: '桃園', lat: 24.99, lng: 121.31 }, { name: '台中', lat: 24.15, lng: 120.67 },
  { name: '台南', lat: 22.99, lng: 120.21 }, { name: '高雄', lat: 22.63, lng: 120.30 },
  { name: '新竹', lat: 24.80, lng: 120.97 }, { name: '花蓮', lat: 23.98, lng: 121.60 },
  { name: '宜蘭', lat: 24.76, lng: 121.75 }, { name: '嘉義', lat: 23.48, lng: 120.45 },
];

export default async function settings() {
  setTop({ title: '設定', back: false });

  const est = await estimate();
  const persisted = await isPersisted();
  const usedPct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const prefs = getPrefs();
  const pending = await pendingCount();
  const orig = await originalUsage();
  const origLine = orig.count
    ? `現在留著 ${orig.count} 張原始檔，佔 ${fmtBytes(orig.bytes)}。`
    : (keepOriginals() ? '目前還沒有留下任何原始檔（只對打開之後拍的照片有效）。' : '目前沒有保留原始檔。');

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

    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '打開旅程時自動捲到今天'),
        h('div', { class: 'form-hint' }, '旅行途中打開旅程，畫面會自動移到「今天」那一段。關掉的話畫面一律停在最上面，自己往下找。')),
      checkbox(prefs.autoScroll !== false, (on) => { setPref('autoScroll', on); })),

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

    // ---- 照片品質 ----
    // 「匯出無壓縮的照片」這件事只有從現在起才做得到 —— 匯入時一律縮到長邊
    // 1600px，原始檔從來沒有被留下來過。所以這個開關要把代價講清楚，
    // 而且預設關（多留一份原檔，佔用會變成大約十倍）。
    h('div', { class: 'section-label' }, '照片品質'),
    h('label', { class: 'switch-row' },
      h('div', {}, h('div', { style: 'font-weight:700' }, '連原始檔一起留著'),
        h('div', { class: 'form-hint' },
          '平常拍的照片會縮到長邊 1600px 再存（大約 300KB）。打開這個開關，之後拍的照片會多留一份沒有壓縮的原始檔，'
          + '匯出時就能拿到原畫質。代價是佔用空間大約變成 10 倍（一張 3–5MB）。'
          + '原始檔只留在這支手機裡，不會同步給旅伴、也不會進備份檔。'),
        h('div', { class: 'form-hint' }, origLine)),
      checkbox(prefs.keepOriginal === true, (on) => { setPref('keepOriginal', on); settings(); })),
    orig.count ? h('button', { class: 'btn btn-ghost btn-block', onclick: async () => {
      const ok = await confirmDialog(`要刪掉已經留下來的 ${orig.count} 張原始檔嗎？可以空出 ${fmtBytes(orig.bytes)}。

壓縮過的那份（1600px）會留著，照片不會不見。`, { danger: true, okLabel: '刪掉原始檔' });
      if (!ok) return;
      const r = await dropOriginals();
      toast(`已刪掉 ${r.count} 張原始檔，空出 ${fmtBytes(r.freed)}`);
      settings();
    } }, `刪掉已留的原始檔（${fmtBytes(orig.bytes)}）`) : null,

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
    h('div', { class: 'section-label' }, '和旅伴同步'),
    h('div', { class: 'card about' },
      syncEnabled()
        ? h('p', { class: 'sm' }, '✅ 已開啟。你和旅伴的行程、任務、照片、按讚留言會自動互相同步，不用做任何設定。')
        : h('p', { class: 'sm' }, '⚠️ 目前是單機模式，照片不會自動同步給旅伴。可以用「分享連結」給旅伴任務清單、用「匯出 / 匯入備份」交換照片。'),
      syncEnabled() && pending.total
        ? h('p', { class: 'tag tag-todo', style: 'display:inline-block' }, `📤 還有 ${pending.blobs} 張照片正在上傳`)
        : null,
      h('div', { class: 'stack', style: 'margin-top:10px' },
        syncEnabled() ? h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
          toast('同步中…');
          try { const r = await syncNow({ onProgress: (m) => toast(m) }); toast(r.skipped ? '目前是單機模式' : '同步完成'); }
          catch (e) { toast('同步失敗：' + e.message); }
          settings();
        } }, '🔄 立即同步一次') : null,
      ),
      h('p', { class: 'form-hint' }, '平常不用管它，App 會自己在背景同步。照片只有你們這群人看得到。'),
      // 進階：一般使用者不需要動，收在摺疊裡避免誤觸把正常運作的同步改壞
      advancedSyncRow(settings),
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
    removedTripsCard(settings),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => bundleInput.click() }, '📥 匯入備份檔（.tripquest.json）'),
    bundleInput,

    // ---- AI（進階、可選）----
    h('div', { class: 'section-label' }, 'AI 加值功能'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm muted' }, 'AI 是每個行程各自決定要不要開、由建立者輸入自己的 API 金鑰（設定在「行程 → 旅程設定」裡）。金鑰只存在那台手機，不會傳給旅伴。開了之後，行程表、海報、回憶影片、最終回顧的文案會自動改用 AI 生成；沒開就用內建句型庫。'),
      aiSpendBox(),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (await confirmDialog('清除這台手機上「所有行程」的 AI 金鑰？\n\n提醒：本機刪除不等於停用金鑰，若擔心外流，還要到供應商網站把該金鑰停用。', { danger: true, okLabel: '全部清除' })) {
          await wipeAllTripKeys(); toast('已清除所有 AI 金鑰');
        }
      } }, '🔑 清除所有 AI 金鑰'),
    ),

    // ---- 關於 ----
    h('div', { class: 'section-label' }, '關於'),
    h('div', { class: 'card about' },
      h('p', { class: 'sm' }, 'TripQuest 旅圖任務 — 純前端 App，不需帳號密碼。單機可用；設定同步後照片會存一份到旅伴共用的伺服器。'),
      h('p', { class: 'form-hint' }, '任務來源：內建景點資料庫 + 規則模板；景點示意圖來自 zh.wikipedia.org（只送景點名稱）。AI 加值功能預設關閉，開了也只用建立者自己的金鑰。'),
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

// 同步的伺服器設定：正常情況下 App 內建就設好了，一般使用者不需要（也不該）動它——
// 改錯會讓原本好好的同步壞掉。收在「進階」摺疊裡，需要排除問題時才展開。
function advancedSyncRow(refresh) {
  const wrap = h('div', { style: 'margin-top:10px' });
  const body = h('div', { hidden: true, style: 'margin-top:10px' },
    h('p', { class: 'form-hint' }, `目前使用：${modeLabel()}`),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => configureSync(refresh) }, '更改同步伺服器'),
    h('p', { class: 'form-hint' }, '除非有人請你改，否則不用動這裡。改錯會讓和旅伴的同步停掉。'),
  );
  const toggle = h('button', {
    class: 'btn btn-ghost sm-btn', style: 'width:100%',
    onclick: () => { body.hidden = !body.hidden; toggle.textContent = body.hidden ? '⚙️ 進階設定' : '⚙️ 收起進階設定'; },
  }, '⚙️ 進階設定');
  wrap.append(toggle, body);
  return wrap;
}

// 這台手機每個行程的 AI 花費（金鑰只在本機，所以只有本機看得到用量）
function aiSpendBox() {
  const box = h('div', { style: 'margin:8px 0' });
  (async () => {
    const trips = store.exportRecords().filter((r) => r.type === 'trip' && !r.deleted);
    const rows = [];
    let total = 0;
    for (const t of trips) {
      const u = await usageOf(t.id);
      if (!u || !u.hasKey) continue;
      total += u.usedUsd;
      rows.push(h('div', { class: 'setting-row', style: 'padding:6px 0' },
        h('span', { class: 'sm' }, t.title || '（未命名行程）'),
        h('span', { class: 'sm mono' + (u.overCap ? ' tag-todo' : '') },
          `$${u.usedUsd.toFixed(3)} / $${u.capUsd.toFixed(2)}` + (u.overCap ? '（已達上限）' : '')),
      ));
    }
    if (!rows.length) {
      box.replaceChildren(h('p', { class: 'form-hint' }, '目前這台手機沒有任何行程輸入 AI 金鑰。'));
      return;
    }
    box.replaceChildren(
      h('div', { class: 'section-label', style: 'margin:4px 0' }, `這台手機的 AI 花費（合計約 $${total.toFixed(3)}）`),
      ...rows,
      h('p', { class: 'form-hint' }, '費用直接向你的 API 供應商計，這裡是本機估算；真正的上限請在供應商 Billing 設定。'),
    );
  })();
  return box;
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

// 從一段文字（整條連結或純代碼）加入。首頁的剪貼簿流程也用這一支。
// 回傳成功與否，讓呼叫端決定失敗後要不要再請使用者自己貼一次。
// 從這台裝置移除過的旅程（v1.62）。移除時把群組祕鑰留在本機 meta，
// 這樣長輩不用去 LINE 翻當初的邀請連結就能加回來 —— 三代理都指出「請他自己
// 留著連結」對這個族群不可靠，而且獨自建立的行程移除後連結就不存在於任何地方了。
function removedTripsCard(refresh) {
  const box = h('div', { class: 'stack', style: 'margin-top:6px' });
  (async () => {
    const db = await import('../db.js');
    const kept = (await db.metaGet('removedGroups')) || [];
    if (!kept.length) return;
    box.append(h('p', { class: 'form-hint', style: 'margin:8px 2px 2px' }, '從這台手機移除過的旅程：'));
    for (const it of kept) {
      box.append(h('div', { class: 'setting-row' },
        h('span', { style: 'font-weight:700' }, it.title || '旅程'),
        h('div', { class: 'row2' },
          h('button', {
            class: 'btn btn-soft', onclick: async () => {
              toast('加回來中…');
              try {
                const store = await import('../store.js');
                store.unforget(it.groupId);
                const { joinInvite } = await import('../share.js');
                const tid = await joinInvite({ kind: 'sync', short: true, groupId: it.groupId, secret: it.secret,
                  url: it.url || '', tripPrefix: String(it.tripId || '').slice(0, 8) });
                const rest = ((await db.metaGet('removedGroups')) || []).filter((x) => x.groupId !== it.groupId);
                await db.metaSet('removedGroups', rest);
                toast('已加回來');
                navigate(`/trip/${tid}`, { replace: true });
              } catch (e) { toast('加不回來：' + e.message, 4000); }
            },
          }, '加回來'),
          h('button', {
            class: 'btn btn-ghost', onclick: async () => {
              if (!(await confirmDialog(`要徹底忘掉「${it.title || '這趟旅程'}」嗎？之後只能請旅伴重新傳邀請連結。`, { danger: true, okLabel: '忘掉' }))) return;
              const rest = ((await db.metaGet('removedGroups')) || []).filter((x) => x.groupId !== it.groupId);
              await db.metaSet('removedGroups', rest);
              refresh();
            },
          }, '徹底忘掉'),
        )));
    }
  })();
  return box;
}

export async function joinByText(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  try {
    const short = parseInviteText(s);
    if (s.includes('j=')) {
      toast('加入中…（大行程最多約 1 分鐘，請稍候）', 4000);
      const tripId = await joinInvite(s.split('j=')[1].trim().split(/[&\s]/)[0]);
      toast('已加入');
      navigate(`/trip/${tripId}`, { replace: true });
    } else if (short) {
      // v1.58 短連結——貼進來的可能是整段訊息文字，parseInviteText 會自己撈參數
      toast('加入中…（大行程最多約 1 分鐘，請稍候）', 4000);
      const tripId = await joinInvite(short);
      toast('已加入');
      navigate(`/trip/${tripId}`, { replace: true });
    } else {
      const code = s.includes('d=') ? s.split('d=')[1].trim().split(/[&\s]/)[0] : s;
      const tripId = await importShareCode(code);
      toast('已加入');
      navigate(`/trip/${tripId}`, { replace: true });
    }
    return true;
  } catch (e) {
    toast(/伺服器上還沒有/.test(e.message) ? e.message : '連結無法解析：' + e.message, 4000);
    return false;
  }
}

export async function joinByCode() {
  const raw = await promptDialog('貼上邀請連結', { multiline: true, okLabel: '加入' });
  if (!raw) return false;
  return joinByText(raw);
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
      h('p', { class: 'form-hint' }, '正常情況下不用改這裡——App 已經內建設定好的伺服器了。'),
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
