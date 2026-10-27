// 和紙主題在第一個畫面就套上（一般的 <script>，放在 <head>、同步執行；CSP 只准本站的檔，所以不能寫成內嵌）。
// 為什麼要另外一支：偏好由 prefs.js 的 apply() 套，但它在 app.js 這個模組整串載完才跑——
// 選了淺色的人每次打開都會先閃一下深藍、再變白。字級與高對比照舊由 apply() 套（一直是這樣，這支只管主題）。
// 讀的是 prefs.js 存的同一個鍵；讀不到（無痕模式、壞掉的 JSON）就什麼都不做，等 apply() 照常處理。
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('tripquest.prefs') || '{}');
    if (p && p.theme === 'washi') {
      document.documentElement.setAttribute('data-theme', 'washi');
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#fffcf6');
    }
  } catch (e) { /* 無痕模式或資料壞掉：交給 prefs.js */ }
})();
