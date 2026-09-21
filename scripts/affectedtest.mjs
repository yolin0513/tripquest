// 受影響測試挑選器的測試（npm run affectedtest；純 Node，放在鏈的最前面）。
// 規格：docs/SPEC_測試範圍.md §7。
//
// 挑選器壞掉的樣子是「少挑幾支，看起來照樣全綠」—— 畫面上跟「這次改動真的只影響這幾支」
// 一模一樣。所以這支測試守的是：
//   · 歷史上七個「改了 A、紅在 B」的案例，拿當年的改動清單回放，當年紅的那幾支都要挑得到
//   · 鏈、直接引用、閉包這三個輸入，解析不到時要報錯，不能靜默變少
//   · 只改文件＝恰好底線；沒人涵蓋的程式檔＝全套；輸出永遠講「這不是全綠」與 N/M
//   · STATUS 寫的鏈長度跟 package.json 對得上

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASELINE, AMP_A_TESTS, SW_VERSION_ONLY, SW_VERSION_TESTS, CLOSURE_STOP, parseChain, extractRefs, buildImportGraph, closure, select, formatReport, classifyChanges } from './affected.mjs';
import { loadRepo } from './run-affected.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const yes = (c, m, extra = '') => {
  if (c) { pass++; console.log('✓ ' + m); }
  else { console.log('✗ ' + m + (extra ? '\n   ' + extra : '')); process.exitCode = 1; }
};

const repo = loadRepo(ROOT);
const { chain, refs, graph } = repo;
const names = chain.map((t) => t.name);
const pick = (changed) => select({ changed, ...repo });

// ---------- T8 鏈的解析 ----------
console.log('\n[T8] 鏈的解析');
yes(chain.length >= 40, `package.json 的鏈解析出 ${chain.length} 支（≥ 40）`);
yes(chain.every((t) => fs.existsSync(path.join(ROOT, t.file))), '鏈裡每一支都對得到 scripts/ 下實際存在的檔');
yes(new Set(names).size === names.length, '鏈裡沒有重複的測試');
{
  // 對照組：故意寫錯檔名的假鏈 —— 解析器必須丟錯，不能跳過那一支。
  // 檔名要是格式合法的 ASCII：用中文的話會先在「格式看不懂」那一關被擋掉，
  // 「檔案不存在」這一關就從來沒被測到（2026-09-19 突變實測踩過）。
  const fake = { scripts: { test: 'node scripts/zhtest.mjs && node scripts/nosuchtest.mjs && node scripts/emptytest.mjs' } };
  let err = null;
  try { parseChain(fake, (p) => fs.existsSync(path.join(ROOT, p))); } catch (e) { err = e; }
  yes(err && /nosuchtest\.mjs 不存在/.test(err.message), '對照組：假鏈裡寫錯的檔名會讓解析器報「不存在」（不是靜默略過）', err ? err.message : '沒有丟錯');
  let err2 = null;
  try { parseChain({ scripts: { test: 'node scripts/zhtest.mjs && npm run sweep' } }, () => true); } catch (e) { err2 = e; }
  yes(!!err2, '對照組：鏈裡有看不懂的一段（npm run …）也會報錯');
}

// ---------- T9 直接引用 ----------
console.log('\n[T9] 每支測試的直接引用');
{
  const withRefs = chain.filter((t) => (refs[t.name] || []).length > 0);
  const without = chain.filter((t) => !(refs[t.name] || []).length).map((t) => t.name);
  yes(withRefs.length >= 35, `${withRefs.length}/${chain.length} 支解析得到至少一個引用（≥ 35）`,
    '解析不到的：' + without.join('、'));
  console.log('   解析不到引用的：' + (without.length ? without.join('、') : '（無）'));
  // 已知的引用必須解析得到（測試寫法各不相同：page.evaluate 的動態 import、相對路徑、spawn）
  yes(refs.mergetest.includes('js/merge.js'), 'mergetest 的 ../js/merge.js 解析得到');
  yes(refs.tagtest.includes('js/store.js'), 'tagtest 在 page.evaluate 裡的 /js/store.js 解析得到');
  yes(refs.synctest.includes('server/index.mjs'), 'synctest spawn 的 server/index.mjs 解析得到');
  yes(refs.nearbytest.includes('js/views/'), 'nearbytest 的 js/views 目錄引用解析成目錄');
  yes(refs.affectedtest.includes('scripts/affected.mjs'), 'affectedtest 自己 import 的 helper 算引用');
  // 這支檔案的 fixture 寫滿了 js/app.js、css/style.css…；那是資料，算成引用的話它會「涵蓋」一大片程式檔
  yes(refs.affectedtest.length > 0 && refs.affectedtest.every((p) => p.startsWith('scripts/')),
    'affectedtest 的 fixture 路徑不算引用（只認它 import 的 helper）', JSON.stringify(refs.affectedtest));
  // 對照組：不存在的路徑、網址裡剛好長得像 data/ 的片段，不算引用
  const r = extractRefs("fetch('https://api.example.com/data/2.5/x'); import('/js/沒有這個.js');",
    (p) => (fs.existsSync(path.join(ROOT, p)) ? 'file' : null));
  yes(r.length === 0, '對照組：不存在的路徑不算引用', JSON.stringify(r));
}

// ---------- T10 閉包 ----------
console.log('\n[T10] 閉包（假的三層 import 圖）');
{
  const files = {
    'js/a.js': "import { b } from './b.js';\nexport const a = b;",
    'js/b.js': "export * from './c.js';",
    'js/c.js': 'export const c = 1;',
    'js/d.js': 'export const d = 1;',
  };
  const g = buildImportGraph(files);
  const fakeChain = [{ name: 't1', file: 'scripts/t1.mjs' }, { name: 't2', file: 'scripts/t2.mjs' }];
  const fakeRefs = { t1: ['js/a.js'], t2: ['js/d.js'] };
  yes(g.get('js/a.js').length > 0 && g.get('js/b.js').length > 0, '前置：假圖 a→b→c 兩條邊都建得出來', JSON.stringify([...g]));
  const rc = select({ changed: ['js/c.js'], chain: fakeChain, refs: fakeRefs, graph: g });
  yes(rc.selected.includes('t1') && !rc.full, '改 c（隔兩層）→ 挑中引用 a 的 t1，且沒有放大到全套', JSON.stringify(rc));
  const rd = select({ changed: ['js/d.js'], chain: fakeChain, refs: fakeRefs, graph: g });
  yes(!rd.selected.includes('t1') && rd.selected.includes('t2') && !rd.full, '改不相干的 d → 不挑 t1（只挑直接引用 d 的 t2）', JSON.stringify(rd));
  // 真的 repo：collapsetest 只引用 store.js，沒有直接引用 db.js；db.js 在 store.js 的閉包裡
  yes(!refs.collapsetest.includes('js/db.js') && closure(graph, 'js/store.js').has('js/db.js'),
    '前置（真 repo）：collapsetest 沒直接引用 js/db.js，但 js/db.js 在 js/store.js 的閉包裡');
  const rr = pick(['js/db.js']);
  yes(rr.selected.includes('collapsetest') && (rr.reasons.collapsetest || []).some((s) => s.includes('閉包')),
    '真 repo：改 js/db.js → collapsetest 因閉包被挑中');
}

// ---------- T11 只改文件 ----------
console.log('\n[T11] 只改文件 → 恰好底線');
{
  yes(BASELINE.length > 0 && BASELINE.every((b) => names.includes(b)), `前置：底線 ${BASELINE.length} 支，每一支都在鏈裡`,
    '不在鏈裡的：' + BASELINE.filter((b) => !names.includes(b)).join('、'));
  const r = pick(['docs/x.md', 'README.md', 'screenshots/features/x.png']);
  const same = r.selected.length === BASELINE.length && BASELINE.every((b) => r.selected.includes(b));
  yes(same && !r.full, `只改 docs／*.md／screenshots → 恰好底線 ${BASELINE.length} 支`, JSON.stringify(r.selected));
}

// ---------- T12 放大器 D ----------
console.log('\n[T12] 放大器 D：沒人涵蓋的程式檔');
{
  const r = pick(['js/__nobody.js']);
  yes(r.full && r.fullReasons.some((s) => s.includes('放大器 D') && s.includes('js/__nobody.js')),
    '改沒有任何測試涵蓋的 js/__nobody.js → 全套，而且點名這個檔', JSON.stringify(r.fullReasons));
  // D 的另一種模式（修訂 1-B 的門檻：十版觸發 ≥ 4 版時改用）：畫面組＋資料組，照樣點名
  const ab = select({ changed: ['js/__nobody.js'], ...repo, dMode: 'ab' });
  yes(!ab.full && AMP_A_TESTS.every((t) => ab.selected.includes(t)) && ab.selected.includes('synctest')
    && ab.notes.some((s) => s.includes('js/__nobody.js')),
    'D 用「A∪B」模式時：不是全套、畫面組與資料組（含 synctest）全挑、點名 js/__nobody.js', JSON.stringify(ab.notes));
  const c = pick(['js/itinerary.js']);
  yes(!c.full && c.selected.includes('itintest'), '對照組：改有人涵蓋的 js/itinerary.js → 不觸發 D（挑到 itintest）', JSON.stringify(c.fullReasons));
}

// ---------- 修訂二：目錄引用不展開閉包，放大器 D 恢復作用 ----------
console.log('\n[修訂二] 目錄引用不展開閉包');
{
  yes(refs.nearbytest.includes('js/views/') && refs.emptytest.includes('js/views/'),
    '前置：nearbytest 與 emptytest 引用的是整個 js/views/ 目錄');
  // 目錄引用仍然讓那支測試被挑中（規則 2 不變），只是不再往下展開閉包
  const v = pick(['js/views/album.js']);
  yes((v.reasons.emptytest || []).some((w) => w.includes('直接引用 js/views/album.js')),
    '改 js/views/album.js → emptytest 照樣被挑中（規則 2）');

  // 目錄引用**不**展開閉包：`js/geocode.js` 是被好幾個 view import 的，如果目錄引用
  // 會往下展開，引用整個 `js/views/` 的 emptytest 就會被算成「涵蓋 geocode」。
  // 這是修訂二真正的行為，也是放大器 D 能不能響的關鍵。
  yes(!!graph.get('js/views/plan.js')?.includes('js/geocode.js') || !!graph.get('js/views/findspot.js')?.includes('js/geocode.js'),
    '前置：js/geocode.js 確實被某個 view import（所以「展不展開」分得出差別）');
  const geo = pick(['js/geocode.js']);
  yes(!(geo.reasons.emptytest || []).some((w) => w.includes('閉包')),
    '改 js/geocode.js → 引用整個 js/views/ 的 emptytest 不會因「閉包」被挑中', JSON.stringify(geo.reasons.emptytest));
  yes(geo.selected.includes('geotest'), '但真的點名 js/geocode.js 的 geotest 照樣被挑中');

  // 「沒有任何測試點名的程式檔」：以程式算出來的為準，不寫死。
  // v1.74 把最後五個（expenses、fx、photoimg、places、viewer）補完之後應該是 0。
  const codeFiles = [...graph.keys(), 'css/style.css'].filter((f) => /^(js|css|workers|server)\//.test(f)).sort();
  const unnamed = codeFiles.filter((f) => pick([f]).fullReasons.some((w) => w.includes('放大器 D')));
  yes(codeFiles.length > 50, `前置：程式檔 ${codeFiles.length} 個`);
  // 對照組：有測試點名的真實檔不觸發 D
  const named = pick(['js/itinerary.js']);
  yes(!named.full && named.selected.includes('itintest'),
    '對照組：改有測試點名的 js/itinerary.js → 不觸發 D', JSON.stringify(named.fullReasons));

  // 算錢的那幾個檔（v1.74 補了斷言）：現在有人點名，不再因為「沒人認領」跑全套
  for (const [file, test] of [['js/fx.js', 'moneytest'], ['js/expenses.js', 'moneytest'], ['js/places.js', 'moneytest'],
    ['js/photoimg.js', 'photosynctest'], ['js/viewer.js', 'albumtest']]) {
    const r = pick([file]);
    yes(!r.full && r.selected.includes(test), `改 ${file} → 挑中 ${test}，不再放大到全套（${r.n}/${r.m}）`, JSON.stringify(r.fullReasons));
  }
  yes(unnamed.length === 0, `沒有任何測試點名的程式檔：${unnamed.length} 個（v1.74 補完之後應該是 0）`, unnamed.join('、'));
}

// ---------- T13 測試腳本本身 ----------
console.log('\n[T13] 改測試腳本本身');
{
  const r = pick(['scripts/geotest.mjs']);
  yes(r.selected.includes('geotest') && !r.full && r.reasons.geotest.some((s) => s.includes('腳本本身')),
    '改 scripts/geotest.mjs → 挑中 geotest（理由是腳本本身），沒有放大到全套', JSON.stringify(r.reasons.geotest));
}

// ---------- T14 輸出口徑 ----------
console.log('\n[T14] 輸出口徑');
{
  const out = formatReport(pick(['docs/x.md']));
  yes(out.includes(`這不是全綠：本次跑 ${BASELINE.length}/${chain.length} 支`), `部分測試時印「這不是全綠：本次跑 ${BASELINE.length}/${chain.length} 支」`, out.split('\n')[0]);
  // 對照組：長度不同的假鏈 —— M 要從鏈數出來，不能寫死
  const fakeChain = BASELINE.concat(['x1']).map((n) => ({ name: n, file: `scripts/${n}.mjs` }));
  const fo = formatReport(select({ changed: ['docs/x.md'], chain: fakeChain, refs: {}, graph: new Map() }));
  yes(fo.includes(`本次跑 ${BASELINE.length}/${fakeChain.length} 支`), `對照組：假鏈 ${fakeChain.length} 支時印 ${BASELINE.length}/${fakeChain.length}`, fo.split('\n')[0]);
  const co = formatReport(pick(['js/router.js']));
  yes(co.includes('放大到全套') && co.includes(`${chain.length}/${chain.length}`) && !co.includes('這不是全綠'),
    '命中 C 時印「放大到全套」與 M/M，不印「這不是全綠」', co.split('\n')[0]);
  // 從真實入口跑一次（npm run affected 用的就是這支）
  const p = spawnSync(process.execPath, ['scripts/run-affected.mjs', '--files', 'docs/x.md', '--dry'], { cwd: ROOT, encoding: 'utf8' });
  yes(p.status === 0 && p.stdout.includes(`這不是全綠：本次跑 ${BASELINE.length}/${chain.length} 支`) && p.stdout.includes('距上次全面檢測'),
    '真實入口 run-affected.mjs --files … --dry：印出 N/M 與「距上次全面檢測」', (p.stderr || p.stdout).slice(0, 400));
}

// ---------- T15 文件對程式 ----------
console.log('\n[T15] STATUS 的鏈長度對得上 package.json');
{
  const status = fs.readFileSync(path.join(ROOT, 'docs/STATUS.md'), 'utf8');
  const sec = (status.split(/^## 測試\s*$/m)[1] || '').split(/^## /m)[0];
  const m = sec.match(/完整的鏈\s*\**\s*(\d+)\s*支/);
  yes(!!m, 'STATUS「測試」節有「完整的鏈 N 支」這句');
  yes(!!m && Number(m[1]) === chain.length, `那個 N（${m ? m[1] : '無'}）＝鏈的實際長度 ${chain.length}`);
}

// ---------- T1–T7 七個歷史案例回放 ----------
// 改動清單是 `git show --name-status <commit>` 實查的結果（歷史不會變，寫死）。
// 「受波及」＝當年那個 commit 為了跟上改動而一起修的測試（規格 §1 的表）。
const S = (list) => list.map(([status, p]) => ({ status, path: p }));
const CASES = [
  { id: '①', sha: 'abbbe71', hit: ['tabbartest'], files: S([['M', 'css/style.css'], ['M', 'docs/STATUS.md'], ['M', 'js/app.js'], ['M', 'js/fx.js'], ['M', 'js/router.js'], ['M', 'js/views/recap.js'], ['M', 'package.json'], ['A', 'screenshots/features/v1735-任務列愛心數-390px特大字-修正前.png'], ['A', 'screenshots/features/v1735-任務列愛心數-390px特大字-修正後.png'], ['A', 'screenshots/features/v1735-回顧日期列-390px特大字-修正前.png'], ['A', 'screenshots/features/v1735-回顧日期列-390px特大字-修正後.png'], ['A', 'screenshots/features/v1735-回顧統計格-390px特大字-修正前.png'], ['A', 'screenshots/features/v1735-回顧統計格-390px特大字-修正後.png'], ['M', 'scripts/layouttest.mjs'], ['A', 'scripts/shotxl.mjs'], ['M', 'sw.js']]) },
  { id: '②', sha: '3fbfc34', hit: ['tagtest', 'walltest', 'screenshots', 'scrolltest', 'imgtest'], files: S([['M', 'css/style.css'], ['M', 'js/addphoto.js'], ['M', 'js/views/trip.js'], ['M', 'package.json'], ['A', 'screenshots/_density/collapsed.png'], ['A', 'screenshots/_density/contrast.png'], ['A', 'screenshots/_density/expanded.png'], ['A', 'screenshots/_density/xl.png'], ['M', 'screenshots/features/v1.26-任務卡示意圖.png'], ['M', 'screenshots/features/v1.26-查不到圖佔位.png'], ['M', 'screenshots/features/v1.26-美食示意圖.png'], ['A', 'scripts/densitytest.mjs'], ['M', 'scripts/gallery.mjs'], ['M', 'scripts/imgtest.mjs'], ['M', 'scripts/screenshots.mjs'], ['M', 'scripts/scrolltest.mjs'], ['M', 'scripts/sweep.mjs'], ['M', 'scripts/tagtest.mjs'], ['M', 'scripts/walltest.mjs'], ['M', 'sw.js']]) },
  { id: '③', sha: '3187de2', hit: ['scrolltest', 'tagtest'], files: S([['M', 'css/style.css'], ['A', 'js/photoimg.js'], ['M', 'js/phototag.js'], ['M', 'js/views/people.js'], ['M', 'js/views/quest.js'], ['M', 'js/views/trip.js'], ['M', 'package.json'], ['A', 'screenshots/_density/repro-wall.png'], ['M', 'screenshots/features/v1.26-任務卡示意圖.png'], ['M', 'screenshots/features/v1.26-查不到圖佔位.png'], ['M', 'screenshots/features/v1.26-美食示意圖.png'], ['A', 'scripts/collapsetest.mjs'], ['A', 'scripts/photosynctest.mjs'], ['M', 'scripts/scrolltest.mjs'], ['M', 'scripts/tagtest.mjs'], ['M', 'sw.js']]) },
  { id: '④', sha: 'cc7dfe1', hit: ['tagtest'], files: S([['M', 'css/style.css'], ['M', 'js/poster/index.js'], ['M', 'js/recap.js'], ['A', 'js/spottime.js'], ['M', 'js/views/import.js'], ['M', 'js/views/plan.js'], ['M', 'js/views/spot.js'], ['M', 'js/views/trip.js'], ['M', 'package.json'], ['M', 'screenshots/features/v1.26-查不到圖佔位.png'], ['M', 'screenshots/features/v1.26-美食示意圖.png'], ['A', 'scripts/plantest.mjs'], ['M', 'scripts/tagtest.mjs'], ['M', 'sw.js']]) },
  { id: '⑤', sha: 'cb0097a', hit: ['photosynctest', 'tagtest', 'walltest', 'synctest'], files: S([['M', 'css/style.css'], ['M', 'js/outbox.js'], ['M', 'js/share.js'], ['A', 'js/viewer.js'], ['M', 'js/views/join.js'], ['M', 'js/views/people.js'], ['M', 'js/views/trip.js'], ['M', 'package.json'], ['M', 'screenshots/_v147/海報-3天-預覽翻到第3天.png'], ['M', 'screenshots/_v147/海報頁-翻頁-短的一天置中.png'], ['M', 'screenshots/_v147/海報頁-翻頁列.png'], ['M', 'screenshots/_v147/路線圖-使用者情境-羅東群聚加粉鳥林-全景.png'], ['M', 'screenshots/_v147/路線圖-使用者情境-羅東群聚加粉鳥林-特寫.png'], ['M', 'screenshots/_v147/路線圖-羅東擠了十五個點-全景.png'], ['M', 'screenshots/_v147/路線圖-羅東擠了十五個點-特寫.png'], ['M', 'screenshots/features/v1.26-任務卡示意圖.png'], ['M', 'screenshots/features/v1.26-查不到圖佔位.png'], ['M', 'screenshots/features/v1.26-美食示意圖.png'], ['A', 'screenshots/features/v1570-全螢幕檢視-按讚.png'], ['A', 'screenshots/features/v1570-全螢幕檢視-留言.png'], ['A', 'screenshots/features/v1570-加入後-歡迎卡與同步進度.png'], ['A', 'screenshots/features/v1570-相簿格狀-依天分組.png'], ['A', 'screenshots/features/v1570-邀請加入-連線前摘要.png'], ['A', 'scripts/albumtest.mjs'], ['A', 'scripts/jointest.mjs'], ['M', 'scripts/photosynctest.mjs'], ['M', 'scripts/synctest.mjs'], ['M', 'scripts/tagtest.mjs'], ['M', 'scripts/walltest.mjs'], ['M', 'sw.js']]) },
  { id: '⑥', sha: 'd58f6a3', hit: ['scrolltest', 'screenshots'], files: S([['M', 'css/style.css'], ['M', 'js/viewer.js'], ['M', 'js/views/memories.js'], ['M', 'js/views/people.js'], ['M', 'screenshots/_v147/海報-3天-預覽翻到第3天.png'], ['M', 'screenshots/_v147/海報頁-翻頁-短的一天置中.png'], ['M', 'screenshots/_v147/海報頁-翻頁列.png'], ['M', 'screenshots/_v147/路線圖-使用者情境-羅東群聚加粉鳥林-全景.png'], ['M', 'screenshots/_v147/路線圖-使用者情境-羅東群聚加粉鳥林-特寫.png'], ['M', 'screenshots/_v147/路線圖-羅東擠了十五個點-特寫.png'], ['M', 'screenshots/features/v1.26-任務卡示意圖.png'], ['M', 'screenshots/features/v1.26-查不到圖佔位.png'], ['M', 'screenshots/features/v1.26-美食示意圖.png'], ['A', 'screenshots/features/v1572-移動前-回顧頁.png'], ['A', 'screenshots/features/v1572-移動前-照片頁含進度區.png'], ['A', 'screenshots/features/v1572-移動後-回顧頁含大家的進度.png'], ['A', 'screenshots/features/v1572-移動後-照片頁只留照片.png'], ['M', 'scripts/albumtest.mjs'], ['M', 'scripts/gallery.mjs'], ['M', 'scripts/screenshots.mjs'], ['M', 'scripts/scrolltest.mjs'], ['M', 'sw.js']]) },
  { id: '⑦', sha: '81865e1', hit: ['updatetest', 'nearbytest'], files: S([['M', 'css/style.css'], ['M', 'docs/STATUS.md'], ['M', 'js/app.js'], ['M', 'js/nearby.js'], ['M', 'js/views/nearby.js'], ['M', 'js/views/trip.js'], ['M', 'screenshots/_v147/海報-3天-預覽翻到第3天.png'], ['M', 'screenshots/_v147/海報頁-翻頁-短的一天置中.png'], ['M', 'screenshots/_v147/海報頁-翻頁列.png'], ['M', 'screenshots/_v147/路線圖-使用者情境-羅東群聚加粉鳥林-全景.png'], ['M', 'screenshots/_v147/路線圖-使用者情境-羅東群聚加粉鳥林-特寫.png'], ['M', 'screenshots/_v147/路線圖-羅東擠了十五個點-全景.png'], ['M', 'screenshots/features/v1.26-任務卡示意圖.png'], ['M', 'screenshots/features/v1.26-查不到圖佔位.png'], ['M', 'screenshots/features/v1.26-美食示意圖.png'], ['A', 'screenshots/features/v1591-找附近-四分類-只顯示距離.png'], ['A', 'screenshots/features/v1591-旅程設定-分享按鈕在旅伴區.png'], ['M', 'scripts/nearbytest.mjs'], ['M', 'scripts/updatetest.mjs'], ['M', 'sw.js']]) },
];

// 嚴格回放：只留 App 程式改動（js/、css/），拿掉 sw.js 與當年一起修的測試腳本。
// 原文清單每一例都有 sw.js（每版 bump VERSION）→ 放大器 C 全套，七例靠 C 就全部「挑得到」，
// 看不出挑選規則本身有沒有用；嚴格回放才量得到 A／B／C／閉包各自的貢獻。
const strictOf = (files) => files.filter((f) => /^(js|css)\//.test(f.path));

console.log('\n[T1–T7] 七個歷史案例回放');
for (const c of CASES) {
  yes(c.files.length > 0 && strictOf(c.files).length > 0, `${c.id} ${c.sha} 前置：改動清單 ${c.files.length} 個檔（程式檔 ${strictOf(c.files).length} 個）`);
  const missingInChain = c.hit.filter((h) => !names.includes(h));
  yes(missingInChain.length === 0, `${c.id} 前置：當年受波及的 ${c.hit.join('、')} 都還在鏈裡`, '不在鏈裡：' + missingInChain.join('、'));

  const r = pick(c.files);
  const miss = c.hit.filter((h) => !r.selected.includes(h));
  yes(miss.length === 0, `${c.id} 原文清單：受波及的全部挑得到（${r.n}/${r.m}${r.full ? '，全套' : ''}）`, '漏掉：' + miss.join('、'));

  // 沒有「已知缺口」豁免：留著它，下一個缺口就會被靜默收進去（修訂 1-C）
  const s = pick(strictOf(c.files));
  const sMiss = c.hit.filter((h) => !s.selected.includes(h));
  yes(sMiss.length === 0, `${c.id} 嚴格回放：受波及的挑得到（${s.n}/${s.m}${s.full ? '，全套' : ''}）`, '漏掉：' + sMiss.join('、'));
}
{
  // 案例 ② 的 imgtest：是放大器 A 挑到的（不是全套順便帶到）
  const c2 = CASES.find((x) => x.id === '②');
  const s2 = pick(strictOf(c2.files));
  yes(!s2.full && (s2.reasons.imgtest || []).some((w) => w.startsWith('放大器 A')), '嚴格回放 ②：imgtest 被放大器 A 挑到（沒有放大到全套）', JSON.stringify(s2.reasons.imgtest));
}

// ---------- 修訂 1-A：sw.js 只改 VERSION 那一行 ----------
console.log('\n[修訂 1-A] sw.js 只改 VERSION 行');
{
  const E = [{ path: 'sw.js', status: 'M' }];
  // v1.73.3（31b33a7）實際的 sw.js diff：只有 VERSION 一刪一增
  const VERSION_ONLY = "diff --git a/sw.js b/sw.js\nindex a619504..4411db6 100644\n--- a/sw.js\n+++ b/sw.js\n@@ -6 +6 @@\n-const VERSION = 'tripquest-v1.73.2';\n+const VERSION = 'tripquest-v1.73.3';\n";
  // 案例 ⑦（81865e1）實際的 sw.js diff（節錄 +/- 行）：VERSION ＋ 快取策略
  const CASE7 = [
    '--- a/sw.js', '+++ b/sw.js', '@@ -6 +6 @@',
    "-const VERSION = 'tripquest-v1.59.0';", "+const VERSION = 'tripquest-v1.59.1';", '@@ -71,0 +72,2 @@',
    '+// SHELL 清單的路徑集合（fetch handler 用：這些檔案只從本版快取拿，不半路換檔）',
    '+const SHELL_SET = new Set(SHELL_ASSETS.map((u) => new URL(u, self.location.href).pathname));',
    '-  // 同源靜態資源：stale-while-revalidate',
    '+  if (SHELL_SET.has(url.pathname)) {',
    '+    e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));',
  ].join('\n');
  const WITH_OTHER = VERSION_ONLY + "@@ -20,0 +21 @@\n+  './js/newfile.js',\n";

  // (b) 只改 VERSION 行 → 不是全套、加跑 updatetest 與 nearbytest
  const cb = classifyChanges(E, () => VERSION_ONLY);
  yes(cb[0].path === SW_VERSION_ONLY, '只改 VERSION 行的 sw.js 被標成 sw.js#VERSION', JSON.stringify(cb));
  const rb = pick(cb);
  yes(!rb.full && SW_VERSION_TESTS.every((t) => (rb.reasons[t] || []).some((w) => w.includes('VERSION'))),
    '只改 VERSION 行 → 不是全套，updatetest 與 nearbytest 因 VERSION 行被挑中', JSON.stringify(rb.fullReasons));
  // (a) 案例 ⑦ 的 sw.js（快取策略）單獨拿出來 → 仍然全套
  const ra = pick(classifyChanges(E, () => CASE7));
  yes(ra.full && ra.fullReasons.some((w) => w.includes('放大器 C：sw.js')), '案例 ⑦ 的 sw.js（改了快取策略）單獨餵進去 → 仍然全套');
  // (c) 對照組：VERSION 行＋另一行 → 全套
  const rc = pick(classifyChanges(E, () => WITH_OTHER));
  yes(rc.full, '對照組：VERSION 行＋SHELL 清單多一行 → 全套');
  // 判斷不出來 → 保守當成全套
  yes(pick(classifyChanges(E, () => { throw new Error('git 取不到'); })).full, '取不到 diff → 全套');
  yes(pick(classifyChanges(E, () => '')).full, 'diff 是空的 → 全套');
  yes(pick(classifyChanges([{ path: 'sw.js', status: 'A' }], () => VERSION_ONLY)).full, 'sw.js 是新檔 → 全套');
  yes(pick(classifyChanges(E, () => VERSION_ONLY.replace(/const VERSION = /g, 'const VERSION_X = '))).full, 'VERSION 那一行樣式對不上 → 全套');
  // 真實入口：回放 v1.73.3 的 commit（它的 sw.js 只 bump 了 VERSION）
  const p = spawnSync(process.execPath, ['scripts/run-affected.mjs', '--commit', '31b33a7', '--dry'], { cwd: ROOT, encoding: 'utf8' });
  yes(p.status === 0 && p.stdout.includes('sw.js#VERSION') && p.stdout.includes('這不是全綠') && !p.stdout.includes('放大到全套'),
    '真實入口 run-affected --commit 31b33a7：sw.js 認成只改 VERSION，沒有放大到全套', (p.stderr || p.stdout).slice(0, 400));
}

// ---------- 修訂 1-B：閉包不穿過 js/app.js ----------
console.log('\n[修訂 1-B] 閉包不穿過 js/app.js');
{
  // 前置：不設終點的話，app.js 能走到 js/fx.js（用圖自己走，不經 closure()）
  const reach = new Set(); const st = ['js/app.js'];
  while (st.length) { const f = st.pop(); if (reach.has(f)) continue; reach.add(f); for (const d of graph.get(f) || []) st.push(d); }
  // 例子用 js/geocode.js：它有三支測試直接點名（所以不會觸發放大器 D 跑全套，
  // 這條才驗得到「閉包不穿過 app.js」本身）
  yes(reach.size > 40 && reach.has('js/geocode.js'), `前置：不設終點時 js/app.js 能走到 ${reach.size} 個檔（含 js/geocode.js）`);
  yes(CLOSURE_STOP.includes('js/app.js') && closure(graph, 'js/app.js').size === 1, 'closure(js/app.js) 只有它自己');
  yes(refs.updatetest.includes('js/app.js'), '前置：updatetest 直接引用 js/app.js');
  const r = pick(['js/geocode.js']);
  yes(!r.full && !(r.reasons.updatetest || []).length, '改 js/geocode.js → updatetest 不會因為引用 app.js 而被挑中', JSON.stringify(r.reasons.updatetest));
  const r2 = pick(['js/app.js']);
  yes((r2.reasons.updatetest || []).some((w) => w.includes('直接引用 js/app.js')), '改 js/app.js 本身 → updatetest 照樣因直接引用被挑中');
}
{
  // 放大器 A 的貢獻：②③⑥ 受波及的畫面類測試，嚴格回放下靠 A 挑到
  const byA = ['②', '③', '⑥'].map((id) => {
    const c = CASES.find((x) => x.id === id);
    const s = pick(strictOf(c.files));
    return c.hit.filter((h) => AMP_A_TESTS.includes(h) && !BASELINE.includes(h))
      .some((h) => (s.reasons[h] || []).some((w) => w.startsWith('放大器 A')));
  });
  yes(byA.every(Boolean), '嚴格回放 ②③⑥：受波及的畫面類測試是放大器 A 挑到的');
  // 放大器 C 的貢獻：①⑦ 改了路由層 → 全套，且理由點名 app.js／router.js
  for (const id of ['①', '⑦']) {
    const c = CASES.find((x) => x.id === id);
    const s = pick(strictOf(c.files));
    yes(s.full && s.fullReasons.some((w) => /放大器 C：js\/(app|router)\.js/.test(w)), `嚴格回放 ${id}：放大器 C 因路由層改動放大到全套`, JSON.stringify(s.fullReasons));
  }
  // 放大器 B 的貢獻：⑤ 改了 outbox／share → 會起 server 的測試（含 synctest）全挑
  const c5 = CASES.find((x) => x.id === '⑤');
  const s5 = pick(strictOf(c5.files));
  yes((s5.reasons.synctest || []).some((w) => w.startsWith('放大器 B')), '嚴格回放 ⑤：synctest 被放大器 B 挑到');
}

console.log(`\n${process.exitCode ? '✗ 有失敗' : '✓ 全部通過'}（${pass} 項）`);
