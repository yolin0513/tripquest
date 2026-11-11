// 瀏覽器測試共用：掃整個畫面有沒有「空值被當成文字印出來」（被 scripts/*test.mjs import，不單獨執行）
//
// 起因（2026-11-11，Yolin iPhone 截圖）：行程頁「怎麼去」沒設定的那一組，選項底下出現一個沒有樣式的純文字 null。
// 成因：js/views/trip.js 的 legRow 把 `cur ? 清除鈕 : null` 傳給 DOM 原生的 Element.append()——
// 我們自己的 h() 會略過 null，但原生 append() 不會，它把 null 轉成文字節點 "null"。
// 那一族 bug 長得都一樣：某個值是空的，卻被當成文字印出來。所以不只查那一處，整個畫面掃一次。
//
// 掃什麼：root 底下**每一個文字節點**（含被 hidden 收起來的——收起來的選項打開就看得到）＋
//        aria-label／title／placeholder／alt 四種屬性（讀屏軟體會念出來）。
// 抓什麼：獨立的 null、undefined、NaN（前後不是英文字母——「nullable」不算），以及 [object Object]。
// 每一個分支（四種字樣、文字與屬性兩種位置）都有自己的合成樣本，每次掃之前先放進真的畫面、確認抓得到，再拿掉；
// 任何一個樣本沒抓到就判「掃描器壞了」，不給出「0 處」（共用慣例 §5.3、§5.13）。
// 回傳 { ok, texts, attrs, hits, broken }：texts／attrs＝實際掃了幾個文字節點、幾個屬性（母體，給呼叫端斷言非 0）。

export const BLANK_WORDS = ['null', 'undefined', 'NaN'];

export async function blankTextScan(page, root = '#view') {
  return page.evaluate((root, words) => {
    const base = document.querySelector(root);
    if (!base) return { ok: false, broken: [`找不到 ${root}`], texts: 0, attrs: 0, hits: [] };
    const wordRe = new RegExp(`(^|[^A-Za-z])(${words.join('|')})(?![A-Za-z])`);
    const bad = (s) => wordRe.test(s) || s.includes('[object Object]');
    const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
    const where = (el) => {
      const parts = [];
      for (let e = el; e && e !== base && parts.length < 3; e = e.parentElement) {
        parts.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''));
      }
      return parts.join(' > ');
    };
    const scan = () => {
      const hits = []; let texts = 0, attrs = 0;
      const tw = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const p = n.parentElement;
        if (p && (p.closest('script, style'))) continue;
        texts++;
        const t = n.data.trim();
        if (t && bad(t)) hits.push({ where: where(p), kind: '文字', text: t.slice(0, 60) });
      }
      for (const el of base.querySelectorAll('*')) {
        for (const a of ATTRS) {
          const v = el.getAttribute(a);
          if (v == null) continue;
          attrs++;
          if (bad(v)) hits.push({ where: where(el), kind: a, text: v.slice(0, 60) });
        }
      }
      return { hits, texts, attrs };
    };
    // 對照組：每個分支一個合成樣本，各放在一個收起來的元素裡（跟真的 bug 一樣，hidden 也要抓得到）。
    // 判定「抓到了」＝放進樣本之後，同一種位置、同一段字的命中數比放之前多——不是「命中清單裡有這段字」
    // （畫面上本來就有同樣的命中時，後者不放樣本也成立，對照組就變成恆真）。
    const count = (r, kind, text) => r.hits.filter((h) => h.kind === kind && h.text === text).length;
    const samples = [
      ...words.map((w) => ({ id: `文字 ${w}`, kind: '文字', text: w,
        mk: () => { const s = document.createElement('span'); s.hidden = true; s.append('前面'); s.append(w); return s; } })),
      { id: '文字 [object Object]', kind: '文字', text: String({}),
        mk: () => { const s = document.createElement('span'); s.hidden = true; s.append(String({})); return s; } },
      { id: '屬性 aria-label', kind: 'aria-label', text: `從「${undefined}」出發`,
        mk: () => { const s = document.createElement('button'); s.hidden = true; s.setAttribute('aria-label', `從「${undefined}」出發`); return s; } },
    ];
    const broken = [];
    const before = scan();
    for (const smp of samples) {
      const el = smp.mk(); el.dataset.blankCtrl = '1';
      base.append(el);
      const r = scan();
      el.remove();
      if (!(count(r, smp.kind, smp.text) > count(before, smp.kind, smp.text))) broken.push(smp.id);
    }
    // 反向對照：正常的字（含 nullable、Annual 這種包著字樣的英文字）不能被判成命中
    const okEl = document.createElement('span'); okEl.hidden = true; okEl.append('nullable 設定、Annual 報告、undefinedness');
    base.append(okEl);
    // 判定用命中數（放進正常的字之後命中數不能變多）——不能用「命中的字是不是包含在樣本裡」：
    // 畫面上真的有 null 時，它是「nullable」的子字串，反向對照會被誤判成壞了（2026-11-11 第一次跑就撞到）
    const r0 = scan();
    if (r0.hits.length !== before.hits.length) broken.push('反向：包在英文字裡的被誤判');
    okEl.remove();
    if (document.querySelector('[data-blank-ctrl]')) broken.push('對照樣本沒拿乾淨');
    const real = scan();
    return { ok: broken.length === 0, broken, ...real };
  }, root, BLANK_WORDS);
}
