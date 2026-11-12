// 主題在第一個畫面就套上（一般的 <script>，放在 <head>、同步執行；CSP 只准本站的檔，所以不能寫成內嵌）。
// 為什麼要另外一支：偏好由 prefs.js 的 apply() 套，但它在 app.js 這個模組整串載完才跑——
// 不先處理的話，每次打開都會先閃一下另一個主題的底色。字級照舊由 apply() 套（一直是這樣，這支只管主題；高對比 2026-11-12 拿掉了）。
// 2026-11-13 起預設是和紙（Yolin 核可）：index.html 的 <html> 直接寫 data-theme="washi"、網址列顏色寫和紙白，
// 這支只處理「選了深色的人」——把 data-theme 拿掉、網址列換回深藍，選深色的人才不會先閃一下白。
// 讀的是 prefs.js 存的同一個鍵；讀不到（無痕模式、壞掉的 JSON）就什麼都不做，維持和紙，等 apply() 照常處理。
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('tripquest.prefs') || '{}');
    if (p && p.theme === 'dark') {
      document.documentElement.removeAttribute('data-theme');
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#0f1523');
    }
  } catch (e) { /* 無痕模式或資料壞掉：交給 prefs.js */ }
})();
