// 測試耗時的按次預測（共用慣例 v11.3 §5.19；2026-10-02）。
//
// 歸類按次、不按指令名稱：同一個 test:affected 實測從 111 秒到 1109 秒都有（看這次挑到哪幾支），
// 所以每次開跑前依「這次實際要跑的那幾支」各自上次的實測秒數加總來預測：
//   · 有一支沒量過 → 預測不出 → 一律當重負載；
//   · 預測超過 600 秒（10 分鐘）→ 重負載；
//   · 預測法最近不準（同一版預測法下，最近連續 3 次實際都超過預估 50% 以上；或有一次預估是常規、實際卻超過 10 分鐘而沒拿許可）
//     → 改好預測法（PREDICTOR_VERSION 加 1）之前一律當重負載。
// 重負載要先向 Dispatch 要許可，拿到後加 --approved 才跑。預估與實際每次都記進 .logs/run-history.jsonl。
// 每支的實測秒數記在 .logs/test-times.json（這台機器的實測；換一台全部沒量過，第一次一律當重負載——這是對的）。

import fs from 'node:fs';
import path from 'node:path';

export const PREDICTOR_VERSION = 1;
export const LIMIT_SEC = 600;
export const OVERRUN = 1.5;

export function predict(selected, times) {
  const secOf = (n) => (times[n] && typeof times[n].sec === 'number' && times[n].sec >= 0 ? times[n].sec : null);
  const unknown = selected.filter((n) => secOf(n) === null);
  const sec = selected.reduce((s, n) => s + (unknown.includes(n) ? 0 : secOf(n)), 0);
  return { sec: unknown.length ? null : sec, known: selected.length - unknown.length, unknown };
}

// 預測法最近準不準：只看同一版預測法的紀錄
export function predictorBroken(history, version = PREDICTOR_VERSION) {
  const h = history.filter((e) => e.version === version && typeof e.actualSec === 'number');
  const withPred = h.filter((e) => typeof e.predictedSec === 'number' && e.predictedSec > 0);
  const last3 = withPred.slice(-3);
  if (last3.length === 3 && last3.every((e) => e.actualSec > e.predictedSec * OVERRUN)) {
    return `同一版預測法最近連續 3 次實際都超過預估 ${Math.round((OVERRUN - 1) * 100)}% 以上（${last3.map((e) => `${e.predictedSec}→${Math.round(e.actualSec)} 秒`).join('、')}）`;
  }
  const crossed = h.find((e) => !e.heavy && !e.approved && e.actualSec > LIMIT_SEC);
  if (crossed) return `有一次預估是常規、實際卻跑了 ${Math.round(crossed.actualSec)} 秒（超過 ${LIMIT_SEC} 秒）而沒拿許可（${crossed.at}）`;
  return null;
}

// 重負載的判準（Dispatch 2026-10-02 改定；本意是防筆電過熱關機，不是數程序）：
//   （2 個以上工作程序 且 預期超過 60 秒）或 任何預期超過 600 秒 或 任何會開瀏覽器的套件。
//   其餘照跑、不用許可，但照樣記進資源紀錄。沒量過、預測不出、預測法不準仍一律當重負載（v11.3）。
// browser／multi：這次要跑的測試裡，會開瀏覽器的、會開 2 個以上工作程序的（由 run-affected 從測試與它 import 的輔助檔判斷）
export const MULTI_SEC = 60;
export function classify({ pred, history = [], version = PREDICTOR_VERSION, browser = [], multi = [] }) {
  const broken = predictorBroken(history, version);
  if (broken) return { heavy: true, reason: `預測法要改：${broken}；改好之前一律當重負載` };
  if (pred.unknown.length) return { heavy: true, reason: `預測不出：${pred.unknown.length} 支沒量過（${pred.unknown.slice(0, 5).join('、')}${pred.unknown.length > 5 ? '…' : ''}）` };
  if (browser.length) return { heavy: true, reason: `會開瀏覽器：${browser.length} 支（${browser.slice(0, 5).join('、')}${browser.length > 5 ? '…' : ''}）` };
  if (pred.sec > LIMIT_SEC) return { heavy: true, reason: `預估 ${pred.sec} 秒，超過 ${LIMIT_SEC} 秒` };
  if (multi.length && pred.sec > MULTI_SEC) return { heavy: true, reason: `會開 2 個以上工作程序（${multi.slice(0, 5).join('、')}）且預估 ${pred.sec} 秒超過 ${MULTI_SEC} 秒` };
  return { heavy: false, reason: `預估 ${pred.sec} 秒；不開瀏覽器${multi.length ? `、多程序但不到 ${MULTI_SEC} 秒` : ''}` };
}

// ---------- 檔案 ----------
// 每支的實測耗時與量的日期**進版控**（tools/test-times.json，v11.3 §5.19 3d）：只有測試名、秒數、日期，沒有路徑與個資；
// 換一台機器也有歷史，預測器不會永遠冷啟動。格式 { 測試名: { sec, at } }。由 run-affected 自己寫——
// 它在拍完「跑完後」的工作區之後才寫，所以工作區守衛不會把它算成測試動到的檔。
// run-history 留在 .logs/（每次開跑一筆：模式、支數、預估、實際、結束方式、停在哪一支——只有數字與測試名）。
export const files = (root) => ({ times: path.join(root, 'tools', 'test-times.json'), history: path.join(root, '.logs', 'run-history.jsonl') });
export function loadTimes(root) {
  const f = files(root).times;
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, 'utf8'));          // 讀不懂就丟錯：不當成「全部沒量過」默默放行，也不當成 0 秒
}
export function saveTimes(root, times) {
  fs.mkdirSync(path.dirname(files(root).times), { recursive: true });
  fs.writeFileSync(files(root).times, JSON.stringify(times, null, 2) + '\n');
}
export function loadHistory(root) {
  const f = files(root).history;
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`run-history 第 ${i + 1} 行讀不懂`); }
  });
}
export function appendHistory(root, e) {
  fs.mkdirSync(path.dirname(files(root).history), { recursive: true });
  fs.appendFileSync(files(root).history, JSON.stringify({ ...e, version: PREDICTOR_VERSION, at: new Date().toISOString() }) + '\n');
}
