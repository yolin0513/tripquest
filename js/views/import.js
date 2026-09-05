// 匯入行程表 —— 照片 / PDF / 純文字 → 確認 → 景點清單。
//
// 三條路，一條比一條需要更多東西：
//   1. 純文字：完全本機，不需要網路、不需要 AI、不需要金鑰。永遠可用。
//   2. 照片／PDF + 這台手機的 AI 金鑰：內容會傳給 Claude 辨識（送出前一定要按確認）。
//   3. 沒有金鑰又想用照片：教使用者用手機內建的文字辨識，複製後走第 1 條路。
//      （不是打發他 —— iPhone 的「即時文字」和 Android 的 Lens 辨識中文行程表很準，
//       而且完全在他自己的手機上跑。）
//
// 隱私：照片在送出前會重新繪製成 JPEG，EXIF 與 GPS 不會跟著走；原始檔只活在
// 這個函式的區域變數裡，流程結束就沒了，不進 IndexedDB、不進快取、不上傳到同步後端。

import { h, modal, toast } from '../ui.js';
import { parseItinerary, fromRows, annotate, fmtTime } from '../itinerary.js';

const STAYS = [
  { v: '', label: '不設定' }, { v: '30', label: '30 分' }, { v: '60', label: '1 小時' },
  { v: '90', label: '1.5 時' }, { v: '120', label: '2 小時' }, { v: '180', label: '3 小時' },
  { v: '240', label: '4 小時' },
];
// 下拉選單的欄位很窄，「2 小時 30 分」會被截掉 —— 這裡用短寫法
const shortStay = (m) => (m < 60 ? m + ' 分' : String(+(m / 60).toFixed(1)) + ' 小時');

// 主入口。回傳 { items, usedAi } 或 null（使用者取消）
export default async function openImport({ cityHint = '' } = {}) {
  const src = await pickSource();
  if (!src) return null;

  let parsed = null;
  let usedAi = false;

  if (src === 'text') {
    const text = await askText();
    if (!text) return null;
    parsed = parseItinerary(text);
  } else {
    const files = await pickFiles(src);
    if (!files || !files.length) return null;
    const got = await runAi(files);
    if (!got) return null;
    parsed = fromRows(got.rows);
    usedAi = true;
    if (got.microUsd) parsed.warnings.push(`這次辨識花了約 US$${(got.microUsd / 1e6).toFixed(3)}`);
  }

  if (!parsed.items.length && !parsed.unparsed.length) {
    await modal({ title: '沒讀到景點', body: h('p', {}, '我在裡面找不到看得懂的景點。可以改用「直接打字」，一行一個景點試試看。') });
    return null;
  }

  const confirmed = await confirmItems(parsed, cityHint);
  if (!confirmed) return null;
  return { items: confirmed, usedAi };
}

// ---------- 步驟 1：選來源 ----------
function pickSource() {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const big = (icon, label, sub, v) => h('button', { class: 'imp-src', onclick: () => close(v) },
      h('span', { class: 'imp-src-i' }, icon),
      h('span', {}, h('span', { class: 'imp-src-t' }, label), h('span', { class: 'imp-src-s' }, sub)));

    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(null); } },
      h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' },
        h('h2', { class: 'modal-title' }, '匯入行程表'),
        h('div', { class: 'modal-body' },
          h('p', { class: 'sm muted', style: 'margin:0 0 14px' }, '把旅行社或家人給的行程表變成拍照任務。'),
          big('⌨️', '直接打字或貼上', '最單純，不用網路也能用', 'text'),
          big('📷', '拍照片或從相簿選', '需要 AI 辨識文字，會先問過你', 'photo'),
          big('📄', '選 PDF 檔', '需要 AI 辨識文字，會先問過你', 'pdf'),
        ),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消')),
      ));
    root.append(overlay);
    document.addEventListener('keydown', onKey);
  });
}

// ---------- 步驟 2a：純文字 ----------
async function askText() {
  const ta = h('textarea', {
    class: 'field mono', rows: 10,
    placeholder: '一行一個，像這樣：\n\n第1天\n09:00 清水寺\n11:30 金閣寺\n14:00-16:30 錦市場\n\n第2天\n10:00 大阪城 停留2小時',
  });
  const ok = await modal({
    title: '貼上行程',
    body: h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 10px' },
        '從 LINE、Email 或 PDF 複製起來貼進來就好。格式亂一點沒關係，我會盡量讀，讀完再給你確認。'),
      ta),
    actions: [{ label: '取消', value: false }, { label: '讀讀看', value: true, primary: true }],
  });
  if (!ok) return null;
  const t = ta.value.trim();
  if (!t) { toast('還沒貼上東西'); return null; }
  return t;
}

// ---------- 步驟 2b：選檔案 ----------
function pickFiles(kind) {
  return new Promise((resolve) => {
    const inp = h('input', {
      type: 'file',
      accept: kind === 'pdf' ? 'application/pdf' : 'image/*',
      multiple: kind !== 'pdf',
      style: 'position:fixed;left:-9999px;width:1px;height:1px',
    });
    let done = false;
    const finish = (v) => { if (done) return; done = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', () => finish([...(inp.files || [])].slice(0, 5)));
    // 使用者按了取消時，change 不會觸發。等視窗回到前景再收尾，不然這個 Promise 永遠不結束。
    window.addEventListener('focus', () => setTimeout(() => finish(inp.files && inp.files.length ? [...inp.files] : null), 600), { once: true });
    document.body.append(inp);
    inp.click();
  });
}

// ---------- 步驟 3：AI 辨識（含金鑰與明確告知）----------
async function runAi(files) {
  const { deviceAiReady, aiReadItinerary } = await import('../ai.js');

  if (!(await deviceAiReady())) {
    const got = await noKeyHelp();
    if (!got) return null;
    if (!(await deviceAiReady())) return null;
  }

  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > 12 * 1024 * 1024) {
    await modal({ title: '檔案太大', body: h('p', {}, '這些檔案加起來超過 12MB，辨識會很慢。請只選行程表那幾頁，或改用「直接打字」。') });
    return null;
  }

  // 明確告知 —— 這是「內容要離開這台手機」的唯一一個路口，一定要按過才走。
  const names = files.map((f) => f.name || '（未命名）').join('、');
  const go = await modal({
    title: '要把它傳給 AI 辨識嗎？',
    body: h('div', {},
      h('p', { style: 'margin:0 0 10px' }, h('b', {}, `${files.length} 個檔案：`), names),
      h('div', { class: 'imp-note' },
        h('p', { style: 'margin:0 0 6px' }, '📤 內容會傳到 Anthropic 的 Claude 服務辨識文字，用你自己的 API 金鑰。'),
        h('p', { style: 'margin:0 0 6px' }, '🖼️ 照片送出前會重新存一次，拍照地點等隱藏資訊不會跟著送。'),
        h('p', { style: 'margin:0 0 6px' }, '🗑️ 只傳這一次。辨識完 App 不會留下原始檔案。'),
        h('p', { style: 'margin:0' }, '💰 一張行程表大約 US$0.01～0.03，從你的金鑰額度扣。')),
      h('p', { class: 'sm muted', style: 'margin:10px 0 0' }, '不想傳出去的話，可以用手機內建的文字辨識，複製後改用「直接打字」。')),
    actions: [{ label: '不要，改打字', value: false }, { label: '好，開始辨識', value: true, primary: true }],
  });
  if (!go) return null;

  const busy = busyBox('正在辨識行程表…', '第一次大概要 20～40 秒，請不要關掉');
  try {
    const payload = [];
    for (const f of files) payload.push(await shrink(f));
    const res = await aiReadItinerary({ files: payload });
    // 立刻放掉：base64 字串很大，而且是使用者的行程內容，不要留在記憶體裡等 GC
    payload.length = 0;
    if (res.error) {
      const msg = res.error === 'no-key' ? '這台手機還沒設定 AI 金鑰。'
        : res.error === 'over-cap' ? '這支金鑰的花費上限已經用完了。'
          : res.error === 'parse' ? 'AI 有回覆，但我看不懂它整理出來的格式。可以再試一次，或改用「直接打字」。'
            : /401|authentication/i.test(res.error) ? '金鑰不正確，請重新設定。'
              : /abort|network|failed/i.test(res.error) ? '連不上網路，或是等太久了。'
                : '辨識失敗：' + res.error;
      await modal({ title: '沒辨識成功', body: h('p', {}, msg) });
      return null;
    }
    if (!res.rows.length) {
      await modal({ title: '沒讀到景點', body: h('p', {}, 'AI 在這些檔案裡找不到行程。確認一下拍到的是行程表，或改用「直接打字」。') });
      return null;
    }
    return res;
  } finally {
    busy.remove();
  }
}

// 照片重繪成 JPEG：順便把 EXIF／GPS 拿掉，也把尺寸壓到 AI 讀得夠清楚就好的大小。
async function shrink(file) {
  const b64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  if (file.type === 'application/pdf') return { mime: 'application/pdf', b64: await b64(file) };
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600;                                     // 再大對辨識沒有幫助，只是變貴變慢
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    c.width = c.height = 0;
    return { mime: 'image/jpeg', b64: await b64(blob) };
  } catch {
    return { mime: /^image\//.test(file.type) ? file.type : 'image/jpeg', b64: await b64(file) };
  }
}

// 沒金鑰時的兩條路：教他用手機內建辨識（免費、不外傳），或現在貼一支金鑰。
async function noKeyHelp() {
  const which = await modal({
    title: '照片需要文字辨識',
    body: h('div', {},
      h('p', { style: 'margin:0 0 12px' }, '把照片上的字讀出來，有兩個辦法：'),
      h('div', { class: 'imp-note' },
        h('p', { style: 'margin:0 0 6px' }, h('b', {}, '① 用手機內建的（免費、不外傳）')),
        h('p', { class: 'sm', style: 'margin:0 0 4px' }, 'iPhone：打開「照片」→ 點右下角的 ⧉ 文字圖示 → 全選 → 拷貝'),
        h('p', { class: 'sm', style: 'margin:0' }, 'Android：打開「Google 相簿」→ 點「Lens」→ 選取文字 → 複製'),
        h('p', { class: 'sm', style: 'margin:6px 0 0' }, '複製好之後回來選「直接打字或貼上」。')),
      h('p', { class: 'sm muted', style: 'margin:12px 0 0' }, '② 貼一支你自己的 Claude API 金鑰，讓 App 幫你辨識（會把照片傳出去）。')),
    actions: [{ label: '我去複製文字', value: 'manual' }, { label: '貼金鑰', value: 'key', primary: true }],
  });
  if (which !== 'key') return false;

  const keyField = h('input', { class: 'field', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false' });
  const status = h('p', { class: 'sm muted', style: 'margin:8px 0 0' }, '');
  const ok = await modal({
    title: '貼上 Claude API 金鑰',
    body: h('div', {},
      h('p', { class: 'sm muted', style: 'margin:0 0 10px' },
        '到 console.anthropic.com 申請，貼在這裡。金鑰只存在這支手機，不會同步、不會出現在分享連結或備份裡。'),
      keyField, status),
    actions: [{ label: '取消', value: false }, { label: '存起來', value: true, primary: true }],
  });
  if (!ok) return false;

  const key = keyField.value.trim();
  const { looksLikeAnthropicKey, setDeviceKey } = await import('../aikeys.js');
  if (!looksLikeAnthropicKey(key)) { toast('這看起來不像 Claude 的金鑰'); return false; }
  const busy = busyBox('檢查金鑰…', '');
  try {
    const { aiTestKey } = await import('../ai.js');
    const r = await aiTestKey(key);
    if (!r.ok) { await modal({ title: '金鑰不能用', body: h('p', {}, r.message) }); return false; }
    await setDeviceKey({ key, capUsd: 2 });
    toast('金鑰已存在這支手機 ✓');
    return true;
  } finally { busy.remove(); }
}

// ---------- 步驟 4：確認與修改 ----------
async function confirmItems(parsed, cityHint) {
  const items = parsed.items.map((it) => ({ ...it }));
  let nextId = items.length;

  const list = h('div', { class: 'imp-list' });
  const summary = h('div', { class: 'imp-sum' });

  const draw = () => {
    list.replaceChildren();
    const days = [...new Set(items.map((i) => i.day))].sort((a, b) => a - b);
    for (const d of days) {
      list.append(h('div', { class: 'imp-day' }, `第 ${d} 天`));
      for (const it of items.filter((x) => x.day === d)) list.append(row(it));
      list.append(h('button', {
        class: 'imp-add', type: 'button',
        onclick: () => { items.push(blank(d, nextId++)); draw(); },
      }, '＋ 這一天再加一個'));
    }
    if (!days.length) {
      list.append(h('p', { class: 'muted sm', style: 'padding:12px 2px' }, '目前一個都沒有。按下面的按鈕自己加。'));
      list.append(h('button', { class: 'imp-add', type: 'button', onclick: () => { items.push(blank(1, nextId++)); draw(); } }, '＋ 加一個景點'));
    }
    if (parsed.unparsed.length) {
      list.append(h('div', { class: 'imp-day' }, `看不懂的 ${parsed.unparsed.length} 行`));
      parsed.unparsed.forEach((raw, i) => list.append(
        h('div', { class: 'imp-bad' },
          h('span', { class: 'imp-bad-t' }, raw),
          h('button', {
            class: 'btn btn-sm', type: 'button',
            onclick: (e) => {
              const it = blank(1, nextId++);
              it.name = raw.slice(0, 24);
              items.push(it);
              parsed.unparsed.splice(parsed.unparsed.indexOf(raw), 1);
              draw();
              void i; void e;
            },
          }, '手動加進來'))));
    }
    tally();
  };

  const tally = () => {
    const on = items.filter((i) => i.include && i.name.trim());
    const warn = on.filter((i) => (i.warnings || []).length);
    summary.replaceChildren(
      h('b', {}, `要建立 ${on.length} 個景點`),
      warn.length ? h('span', { class: 'imp-warn-c' }, `　⚠ ${warn.length} 個要看一下`) : null,
    );
  };

  const blank = (day, n) => ({
    id: 'new' + n, day, name: '', startMin: null, endMin: null, stayMin: null,
    stayGuess: true, timeApprox: false, include: true, kind: 'spot', raw: '', warnings: [],
  });

  function row(it) {
    const chk = h('input', { type: 'checkbox', class: 'imp-chk', checked: it.include });
    chk.addEventListener('change', () => { it.include = chk.checked; card.classList.toggle('off', !chk.checked); tally(); });

    const daySel = h('select', { class: 'imp-in imp-day-sel' },
      ...Array.from({ length: Math.max(6, Math.max(...items.map((x) => x.day)) + 1) }, (_, i) =>
        h('option', { value: String(i + 1), selected: it.day === i + 1 }, `第${i + 1}天`)));
    daySel.addEventListener('change', () => { it.day = parseInt(daySel.value, 10); draw(); });

    const time = h('input', { class: 'imp-in imp-time', type: 'time', value: fmtTime(it.startMin) });
    time.addEventListener('change', () => {
      const m = time.value.match(/^(\d{2}):(\d{2})$/);
      it.startMin = m ? +m[1] * 60 + +m[2] : null;
      it.timeApprox = false;
      it.warnings = (it.warnings || []).filter((w) => !w.includes('時間'));
      redrawWarn();
    });

    // 解析出來的時間不見得剛好是選單裡的那幾個（14:00-16:30 就是 150 分）。
    // 沒有對應選項時 select 會顯示「不設定」，看起來像被丟掉了 —— 所以把實際值補進去。
    const opts = [...STAYS];
    const cur = String(it.stayMin || '');
    if (cur && !opts.some((s) => s.v === cur)) {
      opts.push({ v: cur, label: shortStay(it.stayMin) });
      opts.sort((a, b) => (parseInt(a.v, 10) || 0) - (parseInt(b.v, 10) || 0));
    }
    const stay = h('select', { class: 'imp-in imp-stay' },
      ...opts.map((s) => h('option', { value: s.v, selected: cur === s.v }, s.label)));
    stay.addEventListener('change', () => { it.stayMin = stay.value ? parseInt(stay.value, 10) : null; it.stayGuess = false; });

    const name = h('input', { class: 'imp-in imp-name', type: 'text', value: it.name, placeholder: '景點名稱', maxlength: 40 });
    name.addEventListener('input', () => {
      it.name = name.value;
      it.warnings = (it.warnings || []).filter((w) => !w.includes('名字') && !w.includes('資料庫'));
      redrawWarn(); tally();
    });

    const badge = h('span', { class: 'imp-badge', title: it.matched ? '這個景點我認得，會自動配圖與出題' : '' }, it.matched ? '✓' : '');
    const warnBox = h('div', { class: 'imp-warn' });
    const redrawWarn = () => {
      const ws = it.warnings || [];
      warnBox.replaceChildren(...(ws.length ? [h('span', {}, '⚠ ' + ws.join('、'))] : []));
      warnBox.hidden = !ws.length;
    };

    // 名字放第一行、獨佔整個寬度 —— 那是長輩要看的東西。
    // 第二行才是「第幾天／幾點／停留多久」三個窄欄位；擠在同一行會全部被截掉。
    const card = h('div', { class: 'imp-row' + (it.include ? '' : ' off') },
      h('div', { class: 'imp-r1' }, h('label', { class: 'imp-chk-w' }, chk), name, badge,
        h('button', { class: 'imp-del', type: 'button', title: '刪掉這一筆',
          onclick: () => { items.splice(items.indexOf(it), 1); draw(); } }, '✕')),
      h('div', { class: 'imp-r2' }, daySel, time, stay),
      warnBox,
    );
    redrawWarn();
    return card;
  }

  draw();

  // 對照策展地點庫，把「我不認得這個名字」標出來 —— 這是最值得長輩多看一眼的那幾筆
  annotate(items, cityHint).then(() => draw()).catch(() => {});

  const ok = await modal({
    title: '確認一下再建立',
    body: h('div', { class: 'imp-wrap' },
      parsed.warnings.length
        ? h('div', { class: 'imp-note' }, ...parsed.warnings.map((w) => h('p', { style: 'margin:0 0 4px' }, '· ' + w)))
        : null,
      h('p', { class: 'sm muted', style: 'margin:10px 0' }, '不對的地方直接改。不想要的把左邊的勾勾拿掉就不會建立。'),
      summary, list),
    actions: [{ label: '取消', value: false }, { label: '就這樣建立', value: true, primary: true }],
  });
  if (!ok) return null;

  const out = items.filter((i) => i.include && i.name.trim());
  if (!out.length) { toast('一個景點都沒勾'); return null; }
  return out.map((i) => ({
    name: i.name.trim(), day: i.day,
    startMin: i.startMin, stayMin: i.stayMin,
  }));
}

function busyBox(title, sub) {
  const root = document.getElementById('modalRoot');
  const el = h('div', { class: 'modal-overlay' },
    h('div', { class: 'modal-card', style: 'text-align:center' },
      h('div', { class: 'modal-body' },
        h('div', { class: 'spinner', style: 'margin:8px auto 14px' }),
        h('p', { style: 'margin:0;font-weight:700' }, title),
        sub ? h('p', { class: 'sm muted', style: 'margin:6px 0 0' }, sub) : null)));
  root.append(el);
  return el;
}
