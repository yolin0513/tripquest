// 瀏覽器測試共用：像使用者一樣點一個元素（被 scripts/*test.mjs import，不單獨執行）
//
// 元素在 DOM 裡 ≠ 使用者看得到 ≠ 使用者點得到。puppeteer 的 ElementHandle.click() 只在元素整個不在畫面裡時才捲；
// 一半被底部分頁列蓋住時它照樣點元素正中央，點到的是分頁列——頁面真的換了、什麼錯都沒報，只是後面等不到東西而逾時。
// （2026-10-27 itinviewtest：首頁第 5 張旅程卡 y 695～794、視窗高 780，正中央是分頁列，點下去進了設定頁。）
//
// 做法：① 捲到畫面中間；② 確認中心那一點打到的是目標自己（沒被黏住的標題列、底部分頁列、對話框蓋住）；
// ③ 在「確認過的同一點」按下去（不交給 handle.click() 自己再算一次座標）。
// 點不到回 { ok:false, why } 並**不按**，不丟例外——讓呼叫的測試用自己的斷言記成 ✗、照樣跑完印總結
// （丟例外會變成「沒跑完」，突變執行器記成沒有結果、不算紅）。why 指名蓋住它的是什麼。
export async function userClick(page, handle, label = '目標') {
  if (!handle) return { ok: false, why: `找不到${label}` };
  const pt = await handle.evaluate(async (el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((r) => setTimeout(r, 120));
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, why: `沒有大小 ${r.width}×${r.height}` };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { ok: false, why: `捲過之後中心還在視窗外（${Math.round(x)}, ${Math.round(y)}）` };
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === el || el.contains(hit))) {
      const cls = hit && typeof hit.className === 'string' ? hit.className.trim().split(/\s+/).filter(Boolean).map((c) => '.' + c).join('') : '';
      const d = hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}${cls}` : '無';
      return { ok: false, why: `被蓋住：中心那一點是 ${d}` };
    }
    return { ok: true, x, y };
  });
  if (!pt.ok) return { ok: false, why: `點不到${label}（${pt.why}）` };
  await page.mouse.click(pt.x, pt.y);
  return { ok: true, why: `點在 (${Math.round(pt.x)}, ${Math.round(pt.y)})` };
}
