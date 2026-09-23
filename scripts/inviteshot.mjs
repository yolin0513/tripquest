// 產生「邀請連結改版前後長度對比」的示意圖（node scripts/inviteshot.mjs）。
// 輸出：screenshots/features/v1580-邀請連結-LINE顯示長度對比.png
//
// 為什麼要有這一支：原本那張圖（v1.58）是臨時手做的，改版前那條舊格式連結的前段看不出是不是
// 真實行程的連結——舊格式的連結裡含群組祕鑰。2026-09-23 換成這一支重畫：**連結一律是一看就知道
// 是假的字串**，只保留原圖要表達的事：同一趟行程，舊連結 728 字、新連結約 154 字。
// 字數是照兩種格式的長度造的（不是從任何真實行程量出來的）；畫面上的字數由程式數出來，不寫死。
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'screenshots', 'features', 'v1580-邀請連結-LINE顯示長度對比.png');
const BASE = 'https://yolin0513.github.io/tripquest/?openExternalBrowser=1#/join?';

// 改版前：j= 後面接 gzip＋base64url 的整包資料（v1.57 實測一趟 23 個景點是 728 字）。這裡用假字串補到同樣長度。
const FAKE = 'EXAMPLE-fake-NOT-a-real-link-';
let oldLink = BASE + 'j=';
while (oldLink.length < 728) oldLink += FAKE;
oldLink = oldLink.slice(0, 728);
const SHOWN = 420;                       // LINE 泡泡裡看得到的大約長度，其餘折疊
// 改版後：g=群組識別碼（22）、k=祕鑰（22）、t=行程前 8 碼、n=行程名（base64url）
const newLink = BASE + 'g=EXAMPLEgroupFAKE00000&k=EXAMPLEkeyFAKE0000000&t=00000000&n=EXAMPLEtripNameFAKE000';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;width:390px;background:#8faedc;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif}
  .bar{background:#6b7f9e;color:#fff;font-weight:700;font-size:13px;padding:14px 14px}
  .cap{color:#fff;font-size:12px;margin:18px 14px 6px}
  .bub{background:#9ee05c;border-radius:14px;margin:0 60px 0 12px;padding:12px 12px;font-size:14px;line-height:1.55;color:#222;word-break:break-all}
  .bub a{color:#2b52b4}
  .more{color:#5a6b50}
  .note{background:#6b7f9e;color:#fff;font-size:11px;line-height:1.6;margin:22px 12px 18px;padding:10px 12px}
</style>
<div class="bar">模擬 LINE 聊天室（390px）— 邀請連結前後對比</div>
<div class="cap">改版前（v1.57，${oldLink.length} 字）</div>
<div class="bub">一起來完成這趟旅程的拍照任務！<br><a>${esc(oldLink.slice(0, SHOWN))}</a><br>
  <span class="more">…（後面還有約 ${oldLink.length - SHOWN} 個字，共 ${oldLink.length} 字）</span></div>
<div class="cap">改版後（v1.58，${newLink.length} 字）</div>
<div class="bub">媽媽 邀請你加入「家族旅行（範例）」（2026-10-10～2026-10-12）的拍照任務！<br><a>${esc(newLink)}</a></div>
<div class="note">※ 樣式模擬圖（非真 LINE 畫面）。兩條連結都是<b>示意用的假字串</b>，不是任何真實行程的連結；
  只呈現同字級同寬度下兩種連結貼進訊息的長度差。</div>`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 600, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(`已輸出 ${path.relative(ROOT, OUT)}（改版前 ${oldLink.length} 字、改版後 ${newLink.length} 字）`);
