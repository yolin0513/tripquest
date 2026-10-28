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
// 照字找元素再像使用者一樣點（2026-10-28，washitest 撞到）：找不到、點不到都**丟例外、點名是哪一個**。
// 原本各測試自己寫的 clickText 找不到就回 false，呼叫的地方多半沒接回傳值，於是錯誤被吞掉、
// 下一步等畫面逾時 30 秒，紀錄上只剩「Waiting failed: 30000ms exceeded」，看不出是哪個按鈕不在。
// 要「記成 ✗、繼續跑」的地方用上面的 userClick（回 { ok, why }）；這支給「點不到後面就沒意義」的導覽步驟，
// 呼叫的測試要有最外層的 catch 把例外記成 ✗ 並照樣印總結（不然突變執行器會記成沒跑完）。
export async function clickText(page, sel, text, { pause = 250 } = {}) {
  const label = `「${text}」（${sel}）`;
  const hd = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t)) || null, sel, text);
  const el = hd.asElement();
  if (!el) throw new Error(`找不到${label}——當時在 ${await page.evaluate(() => location.hash || '#/')}`);
  const r = await userClick(page, el, label);
  if (!r.ok) throw new Error(r.why);
  await new Promise((res) => setTimeout(res, pause));
  return true;
}

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
