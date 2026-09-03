import { setTop, render } from '../app.js';
import * as store from '../store.js';
import { h, toast, esc } from '../ui.js';
import { navigate } from '../router.js';
import { uuid } from '../ids.js';
import { generateForTrip } from '../quests/generate.js';

export default function create() {
  setTop({ title: '建立新行程' });

  const state = { members: ['我'] };

  const titleField = h('input', { class: 'field', type: 'text', placeholder: '例：京都五天四夜', maxlength: 40 });
  const regionField = h('input', { class: 'field', type: 'text', placeholder: '例：京都（可留空，用來輔助出題）', maxlength: 20 });
  const startField = h('input', { class: 'field', type: 'date' });
  const endField = h('input', { class: 'field', type: 'date' });
  const itinField = h('textarea', {
    class: 'field mono', rows: 7,
    placeholder: '一行一個景點，或用「、」分隔：\n\n第1天 清水寺、金閣寺、伏見稻荷大社\n第2天 嵐山竹林、大阪城\n道頓堀',
  });

  const memberList = h('div', { class: 'chip-input' });
  const memberField = h('input', { class: 'field', type: 'text', placeholder: '輸入旅伴名字後按 Enter', maxlength: 16 });
  function renderMembers() {
    memberList.replaceChildren(...state.members.map((name, i) =>
      h('span', { class: 'chip' }, name,
        h('button', { class: 'chip-x', 'aria-label': '移除', onclick: () => { state.members.splice(i, 1); renderMembers(); } }, '×'))
    ));
  }
  memberField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = memberField.value.trim();
      if (v && !state.members.includes(v)) { state.members.push(v); renderMembers(); }
      memberField.value = '';
    }
  });
  renderMembers();

  const submitBtn = h('button', { class: 'btn btn-primary btn-block', onclick: submit }, '產生任務');

  async function submit() {
    const title = titleField.value.trim();
    const itineraryText = itinField.value.trim();
    if (!title) { toast('幫行程取個名字'); titleField.focus(); return; }
    if (!itineraryText) { toast('至少貼一個景點進去'); itinField.focus(); return; }
    if (memberField.value.trim()) {
      const v = memberField.value.trim();
      if (!state.members.includes(v)) state.members.push(v);
    }
    if (!state.members.length) state.members.push('我');

    submitBtn.disabled = true;
    submitBtn.textContent = '產生中…';
    try {
      const groupId = uuid();
      const tripId = uuid();
      const region = regionField.value.trim();
      await store.put({ id: groupId, type: 'group', name: title + ' 旅伴', joinCode: '' });
      for (const name of state.members) {
        await store.put({ id: uuid(), type: 'member', groupId, displayName: name, avatarHue: null });
      }
      await store.put({
        id: tripId, type: 'trip', groupId, title,
        startDate: startField.value || '', endDate: endField.value || '',
        region, allowGeo: false,
      });

      const { spots, quests } = await generateForTrip({ tripId, itineraryText, region });
      if (!spots.length) { toast('沒抓到景點，換個寫法試試'); submitBtn.disabled = false; submitBtn.textContent = '產生任務'; return; }
      for (const s of spots) await store.put(s);
      for (const q of quests) await store.put(q);

      const curatedN = spots.filter((s) => s.source === 'curated').length;
      toast(`已建立 ${spots.length} 個景點、${quests.length} 個任務`);
      navigate(`/trip/${tripId}`, { replace: true });
      void curatedN;
    } catch (err) {
      console.error(err);
      toast('產生失敗：' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '產生任務';
    }
  }

  render(h('div', { class: 'page form' },
    field('行程名稱', titleField),
    field('主要地區', regionField),
    h('div', { class: 'row-2' }, field('出發日', startField), field('回程日', endField)),
    field('旅伴', h('div', {}, memberList, memberField)),
    field('行程景點', itinField, '系統會先比對內建的知名景點資料庫，沒收錄的就依景點類型自動出題。之後都能自己改。'),
    submitBtn,
  ));
}

function field(label, control, hint) {
  return h('label', { class: 'form-field' },
    h('span', { class: 'form-label' }, label),
    control,
    hint ? h('span', { class: 'form-hint' }, hint) : null,
  );
}
