// 「減少動態效果」的樣式檢查（npm run motioncsstest；秒級、不開瀏覽器）
//
// 涵蓋的程式：css/style.css
//
// 為什麼要這支：v1.74.10 以前 `.reduce-motion` 這個 class 有被加上（js/prefs.js），但整份 CSS
// 只有一條規則認它（照片檢視器的淡入）；淡入、彈出、撒彩帶、往上滑、折疊展開全部照跑。
// 一條一條補 `.reduce-motion .xxx { animation: none }` 的做法是排除制——以後每加一段動畫
// 都要有人記得補一條，而那個人不會記得（共用慣例 §5.2）。所以改成一條總開關：
//   .reduce-motion *, ::before, ::after → 動畫、轉場的時間與延遲壓到 0.01ms、只跑一次（全部 !important）
// 這支驗三件：
//   M1 母體：style.css 裡宣告了動畫／轉場的規則有幾條（必須 > 0，否則下面的「全部被蓋過」是空話）
//   M2 總開關存在、在最外層（不被 @media 包住）、三個選擇器都在、每個屬性都 !important 而且值夠小
//   M3 能贏過總開關的寫法（別的規則對動畫／轉場用 !important）只准是登記過的例外；登記了卻沒命中也報
// 真的「瀏覽器算出來的時間是 0」由 motiontest（開瀏覽器）驗；這支只驗樣式表的結構，好讓它每版都跑得起。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS_PATH = 'css/style.css';

// 登記的例外：選擇器 → 理由。只有列在這裡的才准對動畫／轉場用 !important。
export const EXEMPT = {
  // 載入中的轉圈不是裝飾：停住的圈看起來像當掉了。放慢、照樣轉（WCAG 2.3.3 對「必要的動態」的例外）。
  '.reduce-motion .spinner': '載入中的指示；停住會像當掉，改成慢速照轉',
};

const MOTION_PROPS = /^(animation|animation-name|animation-duration|animation-delay|animation-iteration-count|transition|transition-property|transition-duration|transition-delay)$/;
const OVERRIDE_SELS = ['.reduce-motion *', '.reduce-motion *::before', '.reduce-motion *::after'];
// 總開關必須帶的屬性 → 值要通過的判斷
const REQUIRED = {
  'animation-duration': (v) => tinyTime(v),
  'animation-delay': (v) => zeroTime(v),
  'animation-iteration-count': (v) => v === '1',
  'transition-duration': (v) => tinyTime(v),
  'transition-delay': (v) => zeroTime(v),
};

function secs(v) {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(v.trim());
  if (!m) return null;
  return m[2] === 'ms' ? Number(m[1]) / 1000 : Number(m[1]);
}
function tinyTime(v) { const s = secs(v); return s != null && s >= 0 && s <= 0.00001; }
function zeroTime(v) { const s = secs(v); return s === 0; }

// 很小的 CSS 解析：去註解，照大括號切；@media／@supports 往裡面走，@keyframes 整塊跳過（裡面是百分比不是元素）。
// 回傳 [{ sel, decls: [{ prop, value, important }], atTop }]
export function parseCss(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  function walk(s, atTop) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      // 找對應的右括號
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      if (depth) throw new Error(`大括號不成對（從「${head.slice(0, 40)}」開始）`);
      const body = s.slice(open + 1, j - 1);
      // 前一段若有沒收尾的 @import 之類（以 ; 結束），head 會帶著它：只取最後一個 ; 之後
      const h = head.includes(';') ? head.slice(head.lastIndexOf(';') + 1).trim() : head;
      if (/^@(-webkit-)?keyframes\b/.test(h)) { /* 跳過 */ }
      else if (h.startsWith('@')) walk(body, false);
      else {
        const decls = [];
        for (const raw of body.split(';')) {
          const k = raw.indexOf(':');
          if (k < 0) continue;
          const prop = raw.slice(0, k).trim().toLowerCase();
          let value = raw.slice(k + 1).trim();
          const important = /!important\s*$/i.test(value);
          value = value.replace(/!important\s*$/i, '').trim();
          if (prop) decls.push({ prop, value, important });
        }
        out.push({ sel: h.replace(/\s+/g, ' '), decls, atTop });
      }
      i = j;
    }
  }
  walk(src, true);
  return out;
}

const selList = (sel) => sel.split(',').map((x) => x.trim()).filter(Boolean);
const isMotionDecl = (d) => MOTION_PROPS.test(d.prop) && !/^none\b/.test(d.value);

// 回傳 { ok, lines: [判定行…], motionCount }
export function checkCss(text, exempt = EXEMPT) {
  const lines = [];
  let ok = true;
  const say = (good, msg) => { lines.push((good ? '✓ ' : '✗ ') + msg); if (!good) ok = false; };
  let rules;
  try { rules = parseCss(text); } catch (e) { say(false, `M0 樣式表解析失敗：${e.message}`); return { ok, lines, motionCount: 0 }; }

  // M1 母體
  const motion = rules.filter((r) => r.decls.some(isMotionDecl));
  const isOverride = (r) => OVERRIDE_SELS.every((s) => selList(r.sel).includes(s));
  const subjects = motion.filter((r) => !isOverride(r) && !(r.sel in exempt));
  say(subjects.length > 0, `M1 母體：宣告了動畫／轉場的規則 ${subjects.length} 條（總開關與登記例外不算；解析出的規則共 ${rules.length} 條）`);

  // M2 總開關
  const ov = rules.filter(isOverride);
  if (ov.length !== 1) say(false, `M2 總開關：要剛好一條同時含 ${OVERRIDE_SELS.join('、')} 的規則，找到 ${ov.length} 條`);
  else {
    const r = ov[0];
    say(r.atTop, 'M2 總開關在最外層（沒被 @media／@supports 包住，否則只在某些條件下才生效）');
    for (const [prop, good] of Object.entries(REQUIRED)) {
      const d = r.decls.find((x) => x.prop === prop);
      say(!!d && d.important && good(d.value), `M2 總開關的 ${prop}：${d ? d.value + (d.important ? ' !important' : '（沒有 !important）') : '沒寫'}`);
    }
  }

  // M3 能贏過總開關的寫法只准是登記過的
  const strong = rules.filter((r) => !isOverride(r) && r.decls.some((d) => MOTION_PROPS.test(d.prop) && d.important));
  const unreg = strong.filter((r) => !(r.sel in exempt));
  say(unreg.length === 0, `M3 對動畫／轉場用 !important 的規則都有登記（共 ${strong.length} 條${unreg.length ? '；沒登記：' + unreg.map((r) => r.sel).join('｜') : ''}）`);
  const stale = Object.keys(exempt).filter((s) => !strong.some((r) => r.sel === s));
  say(stale.length === 0, `M3 登記的例外每一條都真的命中（${Object.keys(exempt).length} 條${stale.length ? '；沒命中：' + stale.join('｜') : ''}）`);
  return { ok, lines, motionCount: subjects.length };
}

// ---------- 執行 ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMain) {
  let pass = 0;
  const yes = (cond, msg) => { if (cond) { pass++; console.log('✓ ' + msg); } else { console.log('✗ ' + msg); process.exitCode = 1; } };

  // 對照組：同一個 checkCss，餵合成的樣式表。每一種壞法只讓它自己那一條紅。
  const GOOD = [
    '.a { animation: fade .2s ease; }',
    '.reduce-motion *, .reduce-motion *::before, .reduce-motion *::after {',
    '  animation-duration: 0.01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;',
    '  transition-duration: 0.01ms !important; transition-delay: 0s !important; }',
  ].join('\n');
  const ctl = (name, css, wantRed, exempt = {}) => {
    const r = checkCss(css, exempt);
    const red = r.lines.filter((l) => l.startsWith('✗ '));
    // wantRed 可以是幾類：每一類都要紅到、而且不准紅到別類
    const want = wantRed == null ? [] : [].concat(wantRed);
    const hit = want.length === 0 ? red.length === 0
      : want.every((w) => red.some((l) => l.startsWith('✗ ' + w))) && red.every((l) => want.some((w) => l.startsWith('✗ ' + w)));
    yes(hit, `對照組 ${name}：${want.length ? '應只紅 ' + want.join('＋') : '應全過'}，實際紅 ${red.length} 條${red.length ? '（' + red.map((l) => l.slice(2, 40)).join('｜') + '）' : ''}`);
  };
  ctl('合格的樣式表', GOOD, null);
  ctl('沒有任何動畫', GOOD.replace('.a { animation: fade .2s ease; }', '.a { color: red; }'), 'M1');
  // 少一個選擇器，那條就不再是總開關，而是一條沒登記的 !important ——兩類都該紅
  ctl('總開關少了 ::after', GOOD.replace(', .reduce-motion *::after', ''), ['M2', 'M3']);
  ctl('總開關被包在 @media 裡', '.a { animation: fade .2s; }\n@media (min-width: 1px) {' + GOOD.split('\n').slice(1).join('\n') + '}', 'M2');
  ctl('總開關少了 !important', GOOD.replace('transition-duration: 0.01ms !important', 'transition-duration: 0.01ms'), 'M2');
  ctl('總開關的時間太長', GOOD.replace('animation-duration: 0.01ms', 'animation-duration: 0.2s'), 'M2');
  ctl('總開關沒限次數', GOOD.replace('animation-iteration-count: 1 !important;', ''), 'M2');
  ctl('沒登記的 !important 動畫', GOOD + '\n.b { animation-duration: 2s !important; }', 'M3');
  ctl('登記了卻沒命中', GOOD, 'M3', { '.不存在': '測試' });
  ctl('登記過的例外放行', GOOD + '\n.reduce-motion .spinner { animation-duration: 1.6s !important; }', null, { '.reduce-motion .spinner': '測試' });
  ctl('@keyframes 裡的百分比不算規則', GOOD + '\n@keyframes k { from { transform: scale(0); } 60% { animation-duration: 9s !important; } }', null);

  // 真的樣式表
  let text = null;
  try { text = fs.readFileSync(new URL('../' + CSS_PATH, import.meta.url), 'utf8'); } catch (e) { yes(false, `讀不到 ${CSS_PATH}：${e.code || e.message}`); }
  if (text != null) {
    const r = checkCss(text);
    console.log(`— ${CSS_PATH}（${text.split('\n').length} 行）—`);
    for (const l of r.lines) yes(l.startsWith('✓ '), l.slice(2));
  }
  console.log(`\n${pass} 項通過` + (process.exitCode ? '，有失敗' : ''));
}
