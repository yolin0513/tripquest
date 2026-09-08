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

// 句型可以是字串，或 { t, when }（有時段限制：night/evening/morning）
const txt = (v) => (typeof v === 'string' ? v : (v && v.t) || '');

// 景點的時間視窗 [到達, 離開]（分鐘）；沒設時間回 null = 不限制
export function timeWindow(spot) {
  const a = Number.isFinite(spot && spot.startMin) ? spot.startMin : null;
  if (a == null) return null;
  return [a, a + (Number.isFinite(spot.stayMin) && spot.stayMin > 0 ? spot.stayMin : 60)];
}
// 07:00–08:00 的景點不該拿到「夜裡點燈」（實機回報）。
// night＝離開時仍在 18:00 後、evening＝16:00 後、morning＝10:00 前就到。
export function phraseOk(item, win) {
  const when = item && item.when;
  if (!when || !win) return true;                 // 沒標時段、或景點沒設時間 → 都可以
  const [a, b] = win;
  if (when === 'night') return b >= 18 * 60;
  if (when === 'evening') return b >= 16 * 60;
  if (when === 'morning') return a <= 10 * 60;
  return true;
}

function pick(arr, ctx, tag, allow = null) {
  if (!arr || !arr.length) return null;
  // 用原始索引記「用過」，過濾不會讓編號跑掉
  const usable = arr.map((v, i) => [v, i]).filter(([v]) => !allow || allow(v));
  if (!usable.length) return null;
  // 先挑沒用過的；全用過了就整組重置
  const fresh = usable.filter(([, i]) => !ctx.used.has(tag + i));
  const pool = fresh.length ? fresh : usable;
  if (!fresh.length) for (const [, i] of usable) ctx.used.delete(tag + i);
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
    const p = txt(pick(b.blurb, ctx, 'b:' + theme));
    if (!p) break;
    if (p.includes('{must}') && !must) { tries++; continue; }
    out = fill(p, vars);
    break;
  } while (tries < 4);
  return out || fill(txt((b.blurb || [])[0]) || '{name}是這趟的一站。', vars);
}

// 主題化任務（取代舊的 byTag/byType 模板）
export function composeQuests(spot, theme, ctx, { max = 4 } = {}) {
  const b = themeBlock(theme);
  const name = shortName(spot.name);
  const out = [];
  const nTheme = Math.min((b.questTitles || []).length, spot.must && spot.must.length ? 2 : 3);

  const win = timeWindow(spot);
  const allow = (v) => phraseOk(v, win);
  for (let i = 0; i < nTheme; i++) {
    const ti = pick(b.questTitles, ctx, 'qt:' + theme, allow);
    const hi = pick(b.questHints, ctx, 'qh:' + theme, allow);
    const title = fill(txt(ti), { name });
    const hint = fill(txt(hi), { name });
    if (title && !out.some((o) => o.title === title)) {
      // when 記在任務上：之後改時間才有辦法提醒「這個任務跟時段不合」
      out.push({ title, hint, kind: b.kind || 'view', source: 'template',
        when: (ti && ti.when) || (hi && hi.when) || null });
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

// 句子裡塞得下的名字。Nominatim 常給「新千岁机场 / 新千歲機場」這種複合名，
// 整串嵌進任務描述很難讀 —— 取一段就好（有中文段就取最後一個中文段，
// 通常是繁體那段），再去掉括號附註。
function shortName(n) {
  let s = String(n || '').trim();
  if (/[/｜|]/.test(s)) {
    const segs = s.split(/\s*[/｜|]\s*/).filter(Boolean);
    const cjk = segs.filter((x) => /[\u4e00-\u9fff]/.test(x));
    s = (cjk.length ? cjk[cjk.length - 1] : segs[0]) || s;
  }
  s = s.replace(/（.*?）|\(.*?\)/g, '').trim();
  if (s.length > 14) s = s.replace(/^(臺灣|台灣|台湾)/, '').trim();
  return s.length > 16 ? s.slice(0, 16) : s;
}
