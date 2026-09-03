import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast } from '../ui.js';
import { navigate } from '../router.js';
import { uuid } from '../ids.js';
import { generateForTrip, curatedIndex, searchCurated } from '../quests/generate.js';
import { enrichTrip } from '../enrich.js';

export default async function create() {
  setTop({ title: '建立新旅程' });

  const state = { members: ['我'], picked: new Map() /* id -> {name,region} */ };

  const titleField = h('input', { class: 'field', type: 'text', placeholder: '例：京都家族旅行', maxlength: 40 });
  const startField = h('input', { class: 'field', type: 'date' });
  const endField = h('input', { class: 'field', type: 'date' });

  // 旅伴
  const memberList = h('div', { class: 'chip-input' });
  const memberField = h('input', { class: 'field', type: 'text', placeholder: '打名字後按 Enter', maxlength: 16 });
  function drawMembers() {
    memberList.replaceChildren(...state.members.map((name, i) =>
      h('span', { class: 'chip' }, name,
        h('button', { class: 'chip-x', 'aria-label': '移除 ' + name, onclick: () => { state.members.splice(i, 1); drawMembers(); } }, '×'))));
  }
  memberField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMember(memberField.value); memberField.value = ''; }
  });
  function addMember(v) {
    v = v.trim();
    if (v && !state.members.includes(v)) { state.members.push(v); drawMembers(); }
  }
  drawMembers();

  // 熱門地區 + 景點點選
  const index = await curatedIndex();
  const regionBar = h('div', { class: 'quick-pick' });
  const spotArea = h('div', { class: 'stack' });
  let activeRegion = null;

  function drawRegions() {
    regionBar.replaceChildren(...index.map((g) =>
      h('button', { class: activeRegion === g.region ? 'on' : '', onclick: () => { activeRegion = activeRegion === g.region ? null : g.region; drawRegions(); drawSpotArea(); } },
        g.region)));
  }
  function drawSpotArea() {
    spotArea.replaceChildren();
    if (!activeRegion) return;
    const g = index.find((x) => x.region === activeRegion);
    spotArea.append(h('div', { class: 'quick-pick' }, ...g.spots.map((s) => spotToggle(s))));
  }
  function spotToggle(s) {
    const on = state.picked.has(s.id);
    return h('button', { class: on ? 'on' : '', onclick: () => {
      if (state.picked.has(s.id)) state.picked.delete(s.id);
      else state.picked.set(s.id, { name: s.name, region: s.region });
      drawSpotArea(); drawSearchResults(); updatePickedSummary();
    } }, `${s.emoji || '📍'} ${s.name}`);
  }

  // 搜尋（打字少，通常用點的就好）
  const searchField = h('input', { class: 'field', type: 'search', placeholder: '找不到？打幾個字搜尋景點' });
  const searchResults = h('div', { class: 'search-results' });
  let searchTimer = null;
  searchField.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(drawSearchResults, 200);
  });
  async function drawSearchResults() {
    const q = searchField.value.trim();
    if (!q) { searchResults.replaceChildren(); return; }
    const hits = await searchCurated(q);
    searchResults.replaceChildren(...hits.map((s) => {
      const on = state.picked.has(s.id);
      return h('button', { onclick: () => {
        if (on) state.picked.delete(s.id); else state.picked.set(s.id, { name: s.name, region: s.region });
        drawSearchResults(); drawSpotArea(); updatePickedSummary();
      } },
        h('span', {}, `${s.emoji || '📍'} ${s.name}`),
        h('span', { class: 'tag' + (on ? ' tag-ok' : '') }, on ? '已加入 ✓' : `＋ 加入`));
    }));
  }

  const pickedSummary = h('div', { class: 'muted sm' });
  function updatePickedSummary() {
    pickedSummary.textContent = state.picked.size ? `已選 ${state.picked.size} 個景點` : '';
  }

  // 進階：自己貼行程（給年輕人代勞）
  const itinField = h('textarea', {
    class: 'field mono', rows: 5,
    placeholder: '一行一個景點，或用「、」分隔：\n清水寺、金閣寺\n第2天 大阪城、道頓堀',
  });
  const advDetails = h('details', {},
    h('summary', { style: 'cursor:pointer;font-weight:700;padding:8px 0' }, '或：直接貼上完整行程文字'),
    h('div', { style: 'margin-top:8px' }, itinField,
      h('span', { class: 'form-hint' }, '會先比對內建的知名景點，其餘依景點類型自動出題。')));

  const submitBtn = h('button', { class: 'btn btn-primary btn-block btn-big', onclick: submit }, '產生拍照任務');

  drawRegions();

  async function submit() {
    const title = titleField.value.trim();
    if (!title) { toast('先幫這趟旅程取個名字'); titleField.focus(); return; }
    if (memberField.value.trim()) addMember(memberField.value);
    if (!state.members.length) state.members.push('我');

    const itineraryText = itinField.value.trim();
    if (!state.picked.size && !itineraryText) { toast('選幾個景點，或貼上行程'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = '產生中…';
    try {
      const groupId = uuid();
      const tripId = uuid();
      const region = state.picked.size ? [...state.picked.values()][0].region : '';
      await store.put({ id: groupId, type: 'group', name: title + ' 旅伴', joinCode: '' });
      for (const name of state.members) await store.put({ id: uuid(), type: 'member', groupId, displayName: name });
      await store.put({
        id: tripId, type: 'trip', groupId, title,
        startDate: startField.value || '', endDate: endField.value || '',
        region, allowGeo: false, allowWiki: true,
      });

      // 點選的景點 + 貼上的文字，一起丟進產生器
      const linesFromPicks = [...state.picked.values()].map((p) => `${p.region} ${p.name}`).join('\n');
      const fullText = [linesFromPicks, itineraryText].filter(Boolean).join('\n');
      const { spots, quests } = await generateForTrip({ tripId, itineraryText: fullText, region });
      if (!spots.length) { toast('沒抓到景點，再試一次'); submitBtn.disabled = false; submitBtn.textContent = '產生拍照任務'; return; }
      for (const s of spots) await store.put(s);
      for (const q of quests) await store.put(q);

      toast(`建立了 ${spots.length} 個景點、${quests.length} 個任務`);
      navigate(`/trip/${tripId}`, { replace: true });
      enrichTrip(tripId).catch(() => {}); // 背景補景點示意圖
    } catch (err) {
      console.error(err);
      toast('產生失敗：' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '產生拍照任務';
    }
  }

  render(h('div', { class: 'page form' },
    field('旅程名稱', titleField),
    h('div', { class: 'row-2' }, field('出發日', startField), field('回程日', endField)),
    field('有誰要一起', h('div', {}, memberList, memberField)),

    h('div', { class: 'section-label' }, '選景點（用點的就好）'),
    regionBar,
    spotArea,
    pickedSummary,
    h('div', { style: 'margin-top:12px' }, searchField, searchResults),

    h('div', { style: 'margin-top:16px' }, advDetails),

    submitBtn,
  ));
}

function field(label, control) {
  return h('label', { class: 'form-field' },
    h('span', { class: 'form-label' }, label),
    control);
}
