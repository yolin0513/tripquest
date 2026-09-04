// 依主題組出「不罐頭」的介紹句與任務文字。
// 同一趟行程共用一個 ctx，記住已用過的句型，儘量不重複。
// 有接 AI 時由 ai.js 產生更自然的版本；這裡是沒金鑰也要有差異感的保底。

import { mulberry32, hashStr } from '../poster/deco.js';

let _phrases = null;
export async function loadPhrases() {
  if (!_phrases) {
    try { _phrases = await fetch('./data/phrases.json').then((r) => r.json()); }
    catch { _phrases = { themes: {}, mustQuest: {} }; }
  }
  return _phrases;
}

export function makeCtx(tripId) {
  return { rng: mulberry32(hashStr(String(tripId || 'trip'))), used: new Set() };
}

function pick(arr, ctx, tag) {
  if (!arr || !arr.length) return null;
  // 先挑沒用過的；全用過了就整組重置
  const fresh = arr.map((v, i) => [v, i]).filter(([, i]) => !ctx.used.has(tag + i));
  const pool = fresh.length ? fresh : arr.map((v, i) => [v, i]);
  if (!fresh.length) for (let i = 0; i < arr.length; i++) ctx.used.delete(tag + i);
  const [val, idx] = pool[Math.floor(ctx.rng() * pool.length)];
  ctx.used.add(tag + idx);
  return val;
}

function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : ''))
    .replace(/\s{2,}/g, ' ').replace(/（）|「」/g, '').replace(/，(?=[，。、])/g, '').trim();
}

function themeBlock(theme) {
  const T = (_phrases && _phrases.themes) || {};
  return T[theme] || T.journey || { blurb: [], features: [], questTitles: [], questHints: [], kind: 'view' };
}

// 一句介紹（給沒有 blurb 的景點）
export function composeBlurb(spot, theme, ctx) {
  const b = themeBlock(theme);
  const must = (spot.must || [])[0] || '';
  const vars = {
    name: shortName(spot.name), must,
    feature: pick(b.features, ctx, 'f:' + theme) || '這裡的樣子',
    district: spot.district || '',
  };
  // 需要 {must} 但沒有必吃項 → 換一個不需要的句型
  let tries = 0, out = '';
  do {
    const p = pick(b.blurb, ctx, 'b:' + theme);
    if (!p) break;
    if (p.includes('{must}') && !must) { tries++; continue; }
    out = fill(p, vars);
    break;
  } while (tries < 4);
  return out || fill((b.blurb || [])[0] || '{name}是這趟的一站。', vars);
}

// 主題化任務（取代舊的 byTag/byType 模板）
export function composeQuests(spot, theme, ctx, { max = 4 } = {}) {
  const b = themeBlock(theme);
  const name = shortName(spot.name);
  const out = [];
  const nTheme = Math.min((b.questTitles || []).length, spot.must && spot.must.length ? 2 : 3);

  for (let i = 0; i < nTheme; i++) {
    const title = fill(pick(b.questTitles, ctx, 'qt:' + theme), { name });
    const hint = fill(pick(b.questHints, ctx, 'qh:' + theme), { name });
    if (title && !out.some((o) => o.title === title)) {
      out.push({ title, hint, kind: b.kind || 'view', source: 'template' });
    }
  }

  // 必吃清單 → 一項一個任務
  const mustCfg = (_phrases && _phrases.mustQuest) || {};
  const mq = mustCfg[theme] || mustCfg.default;
  if (mq && Array.isArray(spot.must)) {
    for (const item of spot.must.slice(0, 3)) {
      out.push({
        title: fill(mq.title, { item, name }),
        hint: fill(mq.hint, { item, name }),
        kind: 'food', source: 'must',
      });
    }
  }

  if (!out.length) {
    out.push({ title: `${name} 代表照`, hint: `拍一張最能說「我來過 ${name}」的照片。`, kind: 'view', source: 'generic' });
  }
  return out.slice(0, max + 3);
}

function shortName(n) {
  const s = String(n || '').trim();
  return s.length > 14 ? s.replace(/（.*?）/g, '').trim() : s;
}
