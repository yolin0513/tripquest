import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { uuid } from '../ids.js';
import { generateForTrip, placeHierarchy, placesOfCity, searchPlaces } from '../quests/generate.js';
import { enrichTrip } from '../enrich.js';
import { dateRangeField } from '../daterange.js';
import { myDeviceId } from '../identity.js';

export default async function create() {
  setTop({ title: '建立新旅程' });

  const state = {
    members: ['我'],
    picked: new Map(),          // placeId -> { name, cityId, blurb, emoji }
    nav: { country: null, region: null, city: null, district: null },
    dates: { start: '', end: '' },
  };

  // ---- 基本欄位 ----
  const titleField = h('input', { class: 'field', type: 'text', placeholder: '例：京都家族旅行', maxlength: 40 });
  const dateField = dateRangeField(state.dates);

  const memberList = h('div', { class: 'chip-input' });
  const memberField = h('input', { class: 'field', type: 'text', placeholder: '打名字後按 Enter', maxlength: 16 });
  let lastMemberDel = 0;
  const removeMember = (name) => {
    // 依名字（不是索引）刪，且擋掉重繪後 350ms 內的第二次觸發 —— 避免手機上一個
    // tap 產生的殘留點擊落到「移位後」的鄰居身上，把旁邊的也一起刪掉。
    if (Date.now() - lastMemberDel < 350) return;
    lastMemberDel = Date.now();
    const idx = state.members.indexOf(name);
    if (idx > -1) { state.members.splice(idx, 1); drawMembers(); }
  };
  const drawMembers = () => memberList.replaceChildren(...state.members.map((name) =>
    h('span', { class: 'chip' }, name,
      h('button', { class: 'chip-x', type: 'button', 'aria-label': '移除 ' + name, onclick: () => removeMember(name) }, '×'))));
  memberField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMember(memberField.value); memberField.value = ''; }
  });
  const addMember = (v) => { v = v.trim(); if (v && !state.members.includes(v)) { state.members.push(v); drawMembers(); } };
  drawMembers();

  // ---- 階層選景點 ----
  const idx = await placeHierarchy();
  const crumb = h('div', { class: 'crumb' });
  const picker = h('div', { class: 'picker' });
  const pickedBar = h('div', { class: 'picked-bar', hidden: true });

  function crumbLabel() {
    const n = state.nav;
    if (n.city) return null; // city 層在 picker 內自己畫行政區
    const parts = [];
    if (n.country) parts.push(cget('countries', n.country).name);
    if (n.region) parts.push(cget2(n.country, n.region).name);
    return parts;
  }
  function cget(_, id) { return idx.countries.find((c) => c.id === id); }
  function cget2(cid, rid) { return cget(0, cid).regions.find((r) => r.id === rid); }
  function cget3(cid, rid, ciId) { return cget2(cid, rid).cities.find((c) => c.id === ciId); }

  function drawCrumb() {
    const n = state.nav;
    const steps = [{ label: '選地區', to: {} }];
    if (n.country) steps.push({ label: cget(0, n.country).emoji + ' ' + cget(0, n.country).name, to: { country: n.country } });
    if (n.region) steps.push({ label: cget2(n.country, n.region).name, to: { country: n.country, region: n.region } });
    if (n.city) steps.push({ label: cget3(n.country, n.region, n.city).name, to: state.nav });
    crumb.replaceChildren(...steps.map((s, i) => h('span', {},
      i > 0 ? h('span', { class: 'crumb-sep' }, '›') : null,
      h('button', {
        class: 'crumb-btn' + (i === steps.length - 1 ? ' cur' : ''),
        onclick: () => { state.nav = { ...s.to }; draw(); },
      }, s.label),
    )));
  }

  function draw() {
    drawCrumb();
    const n = state.nav;
    picker.replaceChildren();

    if (!n.country) {
      picker.append(grid(idx.countries.map((c) =>
        bigBtn(`${c.emoji} ${c.name}`, () => { state.nav = { country: c.id }; draw(); }))));
      return;
    }
    if (!n.region) {
      const c = cget(0, n.country);
      picker.append(grid(c.regions.map((r) =>
        bigBtn(r.name, () => { state.nav = { country: n.country, region: r.id }; draw(); }))));
      return;
    }
    if (!n.city) {
      const r = cget2(n.country, n.region);
      picker.append(grid(r.cities.map((ci) =>
        bigBtn(`${ci.emoji} ${ci.name}`, () => { state.nav = { country: n.country, region: n.region, city: ci.id }; state.nav.district = null; draw(); }))));
      return;
    }
    // city 層：行政區篩選 + 地點卡
    drawCity();
  }

  async function drawCity() {
    const ci = cget3(state.nav.country, state.nav.region, state.nav.city);
    picker.replaceChildren(h('div', { class: 'center-fill', style: 'min-height:120px' }, h('div', { class: 'spinner' })));
    const all = await placesOfCity(ci.id);
    const districts = ['全部', ...ci.districts.filter((d) => all.some((p) => matchDistrict(p.district, d)))];
    const active = state.nav.district || '全部';

    const chips = h('div', { class: 'quick-pick' }, ...districts.map((d) =>
      h('button', { class: (active === d ? 'on' : '') + ' chip-sm', onclick: () => { state.nav.district = d === '全部' ? null : d; drawCity(); } }, d)));

    const shown = active === '全部' ? all : all.filter((p) => matchDistrict(p.district, active));
    const cards = h('div', { class: 'stack' }, ...shown.map((p) => placeCard(p, ci.id)));

    picker.replaceChildren(chips, cards);
  }

  function matchDistrict(placeDist, chip) {
    if (!placeDist) return false;
    const base = chip.split('（')[0];
    return placeDist === chip || placeDist.startsWith(base) || placeDist.includes(base);
  }

  function placeCard(p, cityId) {
    const on = state.picked.has(p.id);
    const card = h('button', {
      class: 'place-card' + (on ? ' on' : ''),
      onclick: () => {
        if (state.picked.has(p.id)) state.picked.delete(p.id);
        else state.picked.set(p.id, { name: p.name, cityId, cityName: p.cityName || cget3(state.nav.country, state.nav.region, state.nav.city)?.name || '', blurb: p.blurb, emoji: p.emoji });
        card.classList.toggle('on');
        card.querySelector('.pc-add').textContent = state.picked.has(p.id) ? '✓ 已選' : '＋';
        drawPickedBar();
        drawSearch();
      },
    },
      h('span', { class: 'pc-emoji' }, p.emoji || '📍'),
      h('span', { class: 'pc-main' },
        h('span', { class: 'pc-name' }, p.name, p.hot ? h('span', { class: 'tag tag-hot' }, '熱門') : null),
        p.blurb ? h('span', { class: 'pc-blurb' }, p.blurb) : null,
        h('span', { class: 'pc-tags' }, ...(p.must || []).slice(0, 3).map((m) => h('span', { class: 'tag tag-must' }, m))),
      ),
      h('span', { class: 'pc-add' }, on ? '✓ 已選' : '＋'),
    );
    return card;
  }

  // ---- 搜尋（輔助）----
  const searchField = h('input', { class: 'field', type: 'search', placeholder: '🔍 找不到？打幾個字搜（士林夜市、淡水、鼎泰豐…）' });
  const searchResults = h('div', { class: 'stack', style: 'margin-top:8px' });
  let searchTimer = null;
  searchField.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(drawSearch, 220); });
  async function drawSearch() {
    const q = searchField.value.trim();
    if (!q) { searchResults.replaceChildren(); return; }
    const hits = await searchPlaces(q);
    if (!hits.length) {
      searchResults.replaceChildren(h('p', { class: 'muted sm', style: 'padding:8px 2px' },
        `找不到「${q}」。可以在下面「進階」直接打字，系統會自動出題。`));
      return;
    }
    searchResults.replaceChildren(...hits.map((p) => {
      const card = placeCard(p, p.cityId);
      card.prepend(h('span', { class: 'pc-city' }, `${p.cityName} · `));
      return card;
    }));
  }

  // ---- 已選欄 ----
  let lastPickDel = 0;
  function drawPickedBar() {
    pickedBar.hidden = state.picked.size === 0;
    if (!state.picked.size) return;
    pickedBar.replaceChildren(
      h('span', { class: 'pb-count' }, `已選 ${state.picked.size} 個`),
      h('div', { class: 'pb-chips' }, ...[...state.picked.entries()].map(([id, v]) =>
        h('span', { class: 'chip chip-sm' }, `${v.emoji || '📍'} ${v.name}`,
          h('button', { class: 'chip-x', type: 'button', onclick: () => {
            if (Date.now() - lastPickDel < 350) return;
            lastPickDel = Date.now();
            state.picked.delete(id); drawPickedBar(); draw(); drawSearch();
          } }, '×')))),
    );
  }

  // ---- 進階：貼行程文字 ----
  const itinField = h('textarea', {
    class: 'field mono', rows: 5,
    placeholder: '一行一個景點，或用「、」分隔：\n第1天 清水寺、金閣寺\n第2天 大阪城、道頓堀\n（不在清單裡的也可以，系統會自動出題）',
  });
  const aiChk = h('input', { type: 'checkbox' });

  // ---- 進階：匯入行程表（照片 / PDF / 文字）----
  state.imported = [];
  const importBar = h('div', { class: 'imp-bar', hidden: true });
  const drawImported = () => {
    importBar.hidden = !state.imported.length;
    if (!state.imported.length) return;
    const days = new Set(state.imported.map((i) => i.day)).size;
    importBar.replaceChildren(
      h('span', {}, `📋 已匯入 ${state.imported.length} 個景點（${days} 天）`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { state.imported = []; drawImported(); } }, '清除'),
    );
  };
  const importBtn = h('button', { class: 'btn btn-block', type: 'button', onclick: async () => {
    const { default: openImport } = await import('./import.js');
    const picks = [...state.picked.values()];
    const res = await openImport({ cityHint: picks.length ? (picks[0].cityName || '') : '' });
    if (!res) return;
    state.imported = res.items;
    if (res.usedAi) aiChk.checked = true;      // 已經有金鑰了，順手把 AI 加值打開
    drawImported();
    toast(`讀到 ${res.items.length} 個景點`);
  } }, '📋 匯入行程表（照片／PDF／文字）');

  const advDetails = h('details', {},
    h('summary', { style: 'cursor:pointer;font-weight:700;padding:10px 0' }, '進階（可略過）'),
    h('div', { style: 'margin-top:8px' },
      h('div', { class: 'form-field' },
        h('span', { class: 'form-label' }, '有現成的行程表？'),
        importBtn,
        h('div', { class: 'form-hint' }, '旅行社給的 PDF、家人傳的照片、或是 LINE 上複製的文字都可以。讀完會先給你確認再建立。'),
        importBar),
      field('直接貼上完整行程文字', itinField),
      h('label', { class: 'switch-row' },
        h('div', {}, h('div', { style: 'font-weight:700' }, '建立後開啟 AI 加值'),
          h('div', { class: 'form-hint' }, '預設關閉。開了之後到「旅程設定」貼你自己的 API 金鑰即可（只存這台手機）。不開一切照舊。')),
        aiChk),
    ));

  const submitBtn = h('button', { class: 'btn btn-primary btn-block btn-big', onclick: submit }, '產生拍照任務');

  draw();

  async function submit() {
    const title = titleField.value.trim();
    if (!title) { toast('先幫這趟旅程取個名字'); titleField.focus(); return; }
    if (memberField.value.trim()) addMember(memberField.value);
    if (!state.members.length) state.members.push('我');

    const itineraryText = itinField.value.trim();
    if (!state.picked.size && !itineraryText && !state.imported.length) {
      toast('選幾個景點，或用「進階」匯入行程表'); return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '產生中…';
    try {
      const groupId = uuid();
      const tripId = uuid();
      const picks = [...state.picked.keys()];
      const region = picks.length ? (state.picked.get(picks[0])?.cityName || '') : '';
      const country = state.nav.country || countryOfCity(idx, state.picked.get(picks[0])?.cityId) || '';

      // 依旅程天數把選到的景點平均分配
      const days = tripDays(state.dates.start, state.dates.end);
      const items = picks.map((placeId, i) => ({ placeId, day: days > 1 ? Math.min(days, Math.floor(i / Math.ceil(picks.length / days)) + 1) : 1 }));
      // 匯入的自己帶了第幾天與時間，不要被上面那套平均分配蓋掉
      for (const im of state.imported) items.push({ name: im.name, day: im.day, startMin: im.startMin, stayMin: im.stayMin, region });

      await store.put({ id: groupId, type: 'group', name: title + ' 旅伴', joinCode: '' });
      for (const name of state.members) await store.put({ id: uuid(), type: 'member', groupId, displayName: name });
      await store.put({
        id: tripId, type: 'trip', groupId, title,
        startDate: state.dates.start || '', endDate: state.dates.end || '',
        region: region, country, allowGeo: false, allowWiki: true,
        createdByDevice: myDeviceId(),
        aiEnabled: !!aiChk.checked,
      });

      // 這台手機已經有預設金鑰的話，複製一份給這趟（各自算自己的花費上限）。
      // 不複製的話使用者要在「旅程設定」再貼一次同一支金鑰。
      if (aiChk.checked) {
        try { const { adoptDeviceKey } = await import('../aikeys.js'); await adoptDeviceKey(tripId); } catch { /* 沒有就算了 */ }
      }

      const { spots, quests } = await generateForTrip({ tripId, items, itineraryText, region });
      if (!spots.length) { toast('沒抓到景點，再試一次'); submitBtn.disabled = false; submitBtn.textContent = '產生拍照任務'; return; }
      for (const s of spots) await store.put(s);
      for (const q of quests) await store.put(q);

      const { syncEnabled } = await import('../sync.js');
      if (syncEnabled()) { const { ensureGroupSync } = await import('../share.js'); await ensureGroupSync(groupId); }

      toast(`建立了 ${spots.length} 個景點、${quests.length} 個任務`);
      navigate(`/trip/${tripId}`, { replace: true });
      enrichTrip(tripId).catch(() => {});
    } catch (err) {
      console.error(err);
      toast('產生失敗：' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '產生拍照任務';
    }
  }

  render(h('div', { class: 'page form' },
    field('旅程名稱', titleField),
    field('哪幾天去？', dateField),
    field('有誰要一起', h('div', {}, memberList, memberField)),

    h('div', { class: 'section-label' }, '選景點'),
    crumb,
    picker,
    h('div', { style: 'margin-top:12px' }, searchField, searchResults),
    pickedBar,

    h('div', { style: 'margin-top:14px' }, advDetails),
    submitBtn,
  ));
}

function countryOfCity(idx, cityId) {
  if (!idx || !cityId) return '';
  for (const c of idx.countries || []) {
    for (const r of c.regions || []) {
      if ((r.cities || []).some((ci) => ci.id === cityId)) return c.id;
    }
  }
  return '';
}

function tripDays(start, end) {
  if (!start || !end) return 1;
  const d = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  return d > 0 && d < 30 ? d : 1;
}

function field(label, control) {
  return h('label', { class: 'form-field' }, h('span', { class: 'form-label' }, label), control);
}
function grid(children) { return h('div', { class: 'quick-pick' }, ...children); }
function bigBtn(label, onclick) { return h('button', { class: 'pick-big', onclick }, label); }
