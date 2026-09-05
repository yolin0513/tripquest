// 景點示意圖 + 一句介紹 —— 抓回來存成 blob（之後離線也看得到）。
// 只送出景點名稱／座標，不送任何個人資料。預設開啟；可在行程設定關閉。
// 對長輩很重要：任務卡有「要拍的東西長怎樣」的照片，比純文字好懂太多。
//
// 為什麼不用 REST summary 的縮圖網址自己改尺寸（舊做法，其實一張都沒抓成功過）：
// 那個網址現在長成 https://thumb.wikimedia.org/…/330px-X.jpg?utm_source=…，
// 把 330px 換成 800px 會直接 400、而且回的是 HTML 錯誤頁，storeImage 只好丟掉。
// 正確做法是用 Action API 的 prop=pageimages 指定 pithumbsize，它會回一個真的存在的尺寸；
// 或直接用 Commons imageinfo 的 iiurlwidth（順便一次拿到作者與授權，標示才有依據）。
//
// 來源優先序（全部免金鑰）：
//   1. 策展資料指定的 Commons 檔名
//   2. 對應語言維基的頁面圖（查不到就用 langlinks 換當地語言，日本景點用日文命中率高）
//   3. 維基站內搜尋（「清水寺 本堂」這種查不到的，搜尋會帶到「清水寺」）
//   4. Commons 座標搜尋（該座標附近的公開照片）
//   5. Commons 關鍵字搜尋
//   6. 都沒有 → 不留白，由畫面用主題色塊佔位（themePlaceholder，純本機）

import * as db from './db.js';
import * as store from './store.js';
import { sha256Hex } from './ids.js';

const THUMB = 640;          // 景點示意圖寬度（.quest-focus-photo 最大用到 240px 高）
const DISH_THUMB = 480;     // 美食示意圖小一點就夠
export const ENRICH_VERSION = 2;   // 改抓法時 +1，舊行程會自動重抓

const inFlight = new Map();

// 成功收到 Wikimedia 回應的次數。用來分辨「查了但沒有」與「根本連不上」——
// 沒網路時如果也標成「這個景點沒有圖」，之後有網路就永遠不會再補了。
let netHits = 0;
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// ---------- Wikimedia API ----------
async function api(host, params) {
  try {
    const u = new URL(`https://${host}/w/api.php`);
    u.search = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', origin: '*', ...params,
    }).toString();
    const r = await fetch(u.toString(), { headers: { accept: 'application/json' } });
    netHits++;                       // 有回應就算連得上（就算內容是「查無此頁」）
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }           // 連不上：netHits 不動
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function attrOf(ii) {
  const em = (ii && ii.extmetadata) || {};
  return {
    author: stripTags(em.Artist && em.Artist.value).slice(0, 60),
    license: stripTags(em.LicenseShortName && em.LicenseShortName.value).slice(0, 40),
    licenseUrl: (em.LicenseUrl && em.LicenseUrl.value) || '',
    page: (ii && ii.descriptionurl) || '',
  };
}

function imgOf(page) {
  const ii = page && page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  const url = ii.thumburl || ii.url;
  if (!url || /\.svg($|\?)/i.test(url)) return null;
  return { url, attr: attrOf(ii), title: page.title || '' };
}

// Commons 上某個檔案：一次拿到指定寬度的網址 + 作者與授權
async function commonsFile(file, width = THUMB) {
  const name = String(file || '').replace(/^File:/i, '');
  if (!name) return null;
  const d = await api('commons.wikimedia.org', {
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(width),
    titles: 'File:' + name,
  });
  const page = d && d.query && d.query.pages && d.query.pages[0];
  if (!page || page.missing) return null;
  return imgOf(page);
}

async function commonsSearch(term, width, limit = 8) {
  const d = await api('commons.wikimedia.org', {
    generator: 'search', gsrsearch: `${term} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(width),
  });
  const pages = (d && d.query && d.query.pages) || [];
  pages.sort((a, b) => (a.index || 99) - (b.index || 99));
  return pages.map(imgOf).filter(Boolean);
}

// 該座標附近的公開照片（景點名稱查不到時的退路）
async function commonsNear(lat, lng, width, radius = 700) {
  const d = await api('commons.wikimedia.org', {
    generator: 'geosearch', ggscoord: `${lat}|${lng}`, ggsradius: String(radius),
    ggslimit: '12', ggsnamespace: '6',
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(width),
  });
  return ((d && d.query && d.query.pages) || []).map(imgOf).filter(Boolean);
}

// 某語言維基的頁面：圖檔名 + 座標 + 摘要一次拿
async function wikiPage(lang, title) {
  const d = await api(`${lang}.wikipedia.org`, {
    prop: 'pageimages|coordinates|extracts|pageprops',
    piprop: 'thumbnail|name', pithumbsize: String(THUMB),
    colimit: '1', exintro: '1', explaintext: '1', exsentences: '2',
    ppprop: 'disambiguation', redirects: '1', titles: title,
  });
  const page = d && d.query && d.query.pages && d.query.pages[0];
  if (!page || page.missing) return null;
  const co = page.coordinates && page.coordinates[0];
  // 消歧義頁（例：中文維基的「金閣寺」是消歧義，真正的條目叫「鹿苑寺」）。
  // 它沒有圖，而且摘要是「金閣寺可以指：」—— 那句話不能拿去當景點介紹。
  const disambig = !!(page.pageprops && 'disambiguation' in page.pageprops);
  return {
    title: page.title,
    file: disambig ? null : (page.pageimage || null),
    thumb: disambig ? null : ((page.thumbnail && page.thumbnail.source) || null),
    lat: co ? co.lat : null,
    lng: co ? co.lon : null,
    extract: disambig ? '' : (page.extract || ''),
    disambig,
  };
}

// 搜尋結果要跟查的名字沾得上邊才算數。少了這個檢查，「阿嬤家的後院第三棵樹」
// 這種查無此地的名字會撈到毫不相干、卻剛好有圖的條目 —— 給錯的示意圖比沒有更糟。
function related(query, title) {
  const clean = (s) => String(s).replace(/\s+/g, '').replace(/[（(][^）)]*[）)]/g, '');  // 去掉「象山 (臺北市)」的消歧義括號
  const q = clean(query), t = clean(title);
  if (!q || !t) return false;
  if (q.includes(t) || t.includes(q)) return t.length >= 2;
  const set = new Set(t);
  let hit = 0;
  for (const ch of new Set(q)) if (set.has(ch)) hit++;
  return hit / new Set(q).size >= 0.6;
}

// strict：景點要檢查搜到的條目跟名字沾不沾得上邊（給錯的地點照片會誤導）。
// 美食則刻意不檢查 —— 找「該道菜」的通用照本來就是要找相近的料理，而且畫面會標「示意圖」。
// needGeo：只接受「有座標」的條目。解消歧義時用 —— 中文維基搜「金閣寺」第一名是
// 三島由紀夫的小說《金閣寺》，那本書沒有座標，寺廟（鹿苑寺）有。景點要的是地方，
// 有沒有座標就是最乾淨的判準，比看標題像不像可靠得多。
async function wikiSearch(lang, term, { strict = true, skip = '', needGeo = false } = {}) {
  const d = await api(`${lang}.wikipedia.org`, {
    generator: 'search', gsrsearch: term, gsrlimit: '5', gsrnamespace: '0',
    prop: 'pageimages|extracts|pageprops|coordinates', piprop: 'thumbnail|name', pithumbsize: String(THUMB),
    colimit: '1', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exsentences: '2',
  });
  const pages = ((d && d.query && d.query.pages) || []).slice();
  pages.sort((a, b) => (a.index || 99) - (b.index || 99));
  const p = pages.find((x) => x.thumbnail
    && x.title !== skip
    && !(x.pageprops && 'disambiguation' in x.pageprops)
    && (!needGeo || (x.coordinates && x.coordinates.length))
    && (!strict || related(term, x.title)));
  if (!p) return null;
  const co = p.coordinates && p.coordinates[0];
  return {
    title: p.title, file: p.pageimage || null, thumb: p.thumbnail.source, extract: p.extract || '',
    lat: co ? co.lat : null, lng: co ? co.lon : null,
  };
}

async function langLinks(lang, title) {
  const d = await api(`${lang}.wikipedia.org`, { prop: 'langlinks', lllimit: '80', redirects: '1', titles: title });
  const page = d && d.query && d.query.pages && d.query.pages[0];
  const out = {};
  for (const l of (page && page.langlinks) || []) out[l.lang] = l.title;
  return out;
}

// ---------- 下載並存進 IndexedDB（之後離線也看得到）----------
async function storeImage(url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size < 1500) return null;
    const hash = await sha256Hex(await blob.arrayBuffer());
    if (!(await db.getBlob(hash))) await db.putBlob({ hash, blob, bytes: blob.size, kind: 'hero' });
    return hash;
  } catch { return null; }
}

// 從維基頁面拿到的圖：優先走 Commons（才有作者與授權可以標），失敗才用 pageimages 的網址
async function takeWikiImage(page, width = THUMB) {
  if (page.file) {
    const c = await commonsFile(page.file, width);
    if (c) {
      const hash = await storeImage(c.url);
      if (hash) return { hash, attr: c.attr };
    }
  }
  if (page.thumb) {
    const hash = await storeImage(page.thumb);
    if (hash) return { hash, attr: { author: '', license: '', licenseUrl: '', page: '' } };
  }
  return null;
}

async function takeCandidates(list) {
  for (const c of list.slice(0, 4)) {
    const hash = await storeImage(c.url);
    if (hash) return { hash, attr: c.attr };
  }
  return null;
}

// ---------- 美食：找「該道菜」的通用照片 ----------
// 店家名幾乎查不到，但料理本身在 Commons 上很多。找到的是示意圖不是該店實照，
// 所以一律標記 generic，畫面上會寫「示意圖」。
const DISH_WORDS = [
  // 日本
  '章魚燒', '大阪燒', '文字燒', '串炸', '串燒', '拉麵', '沾麵', '烏龍麵', '蕎麥麵', '素麵',
  '壽司', '生魚片', '丼飯', '親子丼', '牛丼', '海鮮丼', '鮪魚丼', '鮭魚卵丼', '天婦羅',
  '咖哩', '燒肉', '燒鳥', '關東煮', '飯糰', '可麗餅', '鯛魚燒', '銅鑼燒', '糰子', '麻糬',
  '和菓子', '蕨餅', '最中', '羊羹', '抹茶', '聖代', '泡芙', '玉子燒', '海膽', '和牛',
  '鰻魚飯', '豬排', '可樂餅', '炸肉餅', '메', '味噌湯', '納豆', '烏龍茶', '清酒',
  // 台灣
  '牛肉麵', '滷肉飯', '雞肉飯', '小籠包', '刈包', '肉圓', '蚵仔煎', '臭豆腐', '大腸包小腸',
  '胡椒餅', '車輪餅', '雞排', '珍珠奶茶', '鹽酥雞', '米糕', '碗粿', '棺材板', '擔仔麵',
  '豆花', '仙草', '愛玉', '鳳梨酥', '太陽餅', '肉粽', '粉圓', '米血', '甜不辣', '生煎包',
  '刀削麵', '餃子', '燒賣', '春捲', '蔥抓餅', '蛋餅', '豆漿', '油條',
  '割包', '香腸', '米粉', '扁食', '餛飩', '蔥油餅', '茶葉蛋', '木瓜牛奶', '滷味', '魚丸',
  '小卷', '紅茶', '綠茶', '青茶', '魚酥', '芋圓', '貢丸', '花枝', '蝦捲', '潤餅', '蚵嗲',
  '米苔目', '肉羹', '麵線', '豬血糕', '下午茶', '珍珠', '芒果冰', '鵝肉', '鴨肉',
  // 韓國
  '泡菜', '烤肉', '拌飯', '辣炒年糕', '人蔘雞', '炸雞', '飯捲', '部隊鍋', '冷麵',
  // 泛用（含食材，放最後才比較不會蓋掉更精確的詞）
  '霜淇淋', '冰淇淋', '刨冰', '甜甜圈', '蛋糕', '布丁', '麵包', '吐司', '可頌', '鬆餅',
  '漢堡', '披薩', '薯條', '三明治', '沙拉', '咖啡', '啤酒', '果汁', '奶茶',
  '帝王蟹', '螃蟹', '龍蝦', '牡蠣', '扇貝', '干貝', '鮭魚', '鮪魚', '哈密瓜', '草莓',
  '玉米', '山葵', '粥', '火鍋', '牛排', '烤魚',
];

// 「必吃：會津屋章魚燒」→ 依序試：章魚燒（料理本身）、會津屋章魚燒（原字串）、括號裡的英文
function dishTerms(rawTitle) {
  let t = String(rawTitle || '').replace(/^(必吃|必嚐|必喝)[：:]\s*/, '').trim();
  const paren = (t.match(/[（(]([^）)]+)[）)]/) || [])[1] || '';
  t = t.replace(/\s*[（(][^）)]*[）)]\s*/g, ' ').trim();
  if (!t) return null;

  // 店名＋料理是查不到的（照片只有料理有），所以先抽出料理本身
  let dish = null;
  for (const w of DISH_WORDS) {
    if (t.includes(w) && (!dish || w.length > dish.length)) dish = w;
  }
  // 沒對到詞就把烹調法前綴拿掉再試（現烤和牛串 → 和牛串）
  const stripped = t.replace(/^(現[烤切炒做買煮炸]|手工|special|老店)\s*/i, '').trim();

  const safe = [];      // 可以拿去查維基條目的（是料理名，不是店名）
  const loose = [];     // 只拿去 Commons 搜圖的
  if (dish) safe.push(dish);
  if (/^[A-Za-z][A-Za-z\s'-]{2,}$/.test(paren)) safe.push(paren.trim());
  if (stripped && stripped !== t) loose.push(stripped);
  loose.push(t);
  return { safe, loose };
}

// 匯出給涵蓋率量測用
export async function dishImage(rawTitle) {
  const terms = dishTerms(rawTitle);
  if (!terms) return null;

  // 料理名：Commons 搜圖 + 維基條目圖（多數料理都有條目，且條目圖通常最具代表性）
  for (const q of terms.safe) {
    const got = await takeCandidates(await commonsSearch(q, DISH_THUMB));
    if (got) return { hash: got.hash, attr: got.attr, source: 'commons:dish', generic: true };
    const w = await wikiSearch('zh', q, { strict: false });
    if (w) {
      const gw = await takeWikiImage(w, DISH_THUMB);
      if (gw) return { hash: gw.hash, attr: gw.attr, source: 'wiki:dish', generic: true };
    }
  }
  // 原字串只拿去 Commons 搜圖：拿店名去搜維基條目容易撈到毫不相干、又剛好有圖的條目
  for (const q of terms.loose) {
    const got = await takeCandidates(await commonsSearch(q, DISH_THUMB));
    if (got) return { hash: got.hash, attr: got.attr, source: 'commons:dish', generic: true };
  }
  return null;
}

// ---------- 景點 ----------
export async function enrichSpot(spot) {
  if (!spot) return spot;
  if (spot._enrichV >= ENRICH_VERSION && spot.heroHash) return spot;
  if (spot._enrichV >= ENRICH_VERSION && spot._noHero) return spot;   // 上次也真的找不到，別每次重打
  if (offline()) return spot;                                          // 沒網路就安靜略過，不留下任何標記
  if (inFlight.has(spot.id)) return inFlight.get(spot.id);
  const p = _enrich(spot).finally(() => inFlight.delete(spot.id));
  inFlight.set(spot.id, p);
  return p;
}

async function _enrich(spot) {
  const patch = { _enriched: true };
  const net0 = netHits;
  try {
    let got = null;
    let source = null;

    // 1. 策展資料指定的 Commons 圖
    if (!spot.heroHash && spot.commonsImg) {
      const c = await commonsFile(spot.commonsImg);
      if (c) {
        const hash = await storeImage(c.url);
        if (hash) { got = { hash, attr: c.attr }; source = 'curated'; }
      }
    }

    // 2. 維基頁面（先指定語言，再用 langlinks 換當地語言）
    const lang0 = (spot.wikiRef && spot.wikiRef.lang) || 'zh';
    const title0 = (spot.wikiRef && spot.wikiRef.title) || spot.name;
    let page = await wikiPage(lang0, title0);

    if (page) {
      if (page.lat != null && spot.lat == null) { patch.lat = page.lat; patch.lng = page.lng; }
      if (page.extract) {
        if (!spot.blurb) patch.blurb = trimExtract(page.extract);
        patch.wikiExtract = trimExtract(page.extract, 120);
      }
      if (!spot.heroHash && !got) {
        got = await takeWikiImage(page);
        if (got) source = 'wikipedia:' + lang0;
      }
      // 這個語言的條目沒有圖 → 換當地語言再試（日本景點用日文命中率高）
      if (!spot.heroHash && !got) {
        const links = await langLinks(lang0, page.title);
        for (const lg of ['ja', 'ko', 'en']) {
          if (lg === lang0 || !links[lg]) continue;
          const alt = await wikiPage(lg, links[lg]);
          if (!alt) continue;
          if (!patch.wikiExtract && alt.extract) patch.wikiExtract = trimExtract(alt.extract, 120);
          if (alt.lat != null && patch.lat == null && spot.lat == null) { patch.lat = alt.lat; patch.lng = alt.lng; }
          got = await takeWikiImage(alt);
          if (got) { source = 'wikipedia:' + lg; break; }
        }
      }
    }

    // 3. 查不到條目、或查到的是消歧義頁 → 站內搜尋
    //    （「清水寺 本堂」會帶到「清水寺」；「金閣寺」的消歧義會帶到「鹿苑寺」）
    if (!spot.heroHash && !got && (!page || page.disambig)) {
      const ambiguous = !!(page && page.disambig);
      for (const lg of [lang0, 'ja', 'en']) {
        // 消歧義代表這個詞真的存在、只是有多個條目 → 放寬標題相關性，改用「有沒有座標」
        // 認出哪一個才是地方（不然搜「金閣寺」會拿到三島由紀夫的同名小說）
        const s = await wikiSearch(lg, spot.name, {
          strict: !ambiguous, needGeo: ambiguous, skip: page ? page.title : '',
        });
        if (!s) continue;
        if (!spot.blurb && !patch.blurb && s.extract) patch.blurb = trimExtract(s.extract);
        if (s.lat != null && patch.lat == null && spot.lat == null) { patch.lat = s.lat; patch.lng = s.lng; }
        got = await takeWikiImage(s);
        if (got) { source = 'wikisearch:' + lg; break; }
      }
    }

    // 4. 座標附近的 Commons 照片
    const lat = spot.lat ?? patch.lat, lng = spot.lng ?? patch.lng;
    if (!spot.heroHash && !got && lat != null && lng != null) {
      const near = await commonsNear(lat, lng, THUMB);
      got = await takeCandidates(near);
      if (got) source = 'commons:geo';
    }

    // 刻意不做「拿景點名去 Commons 關鍵字搜尋」這一步：實測 155 個真實地名一次都沒靠它
    // 命中（維基那幾步就全包了），但查無此地的名字反而會撈到毫不相干、卻剛好有圖的檔案。
    // 有一張錯的示意圖，比沒有圖更糟 —— 沒有圖至少會退到主題色塊。

    if (got) {
      patch.heroHash = got.hash;
      patch.heroAttr = got.attr;
      patch.heroSource = source;
      patch._noHero = false;
      patch._enrichV = ENRICH_VERSION;
    } else if (spot.heroHash) {
      patch._enrichV = ENRICH_VERSION;
    } else if (netHits > net0) {
      // 真的問過了、就是沒有 → 記下來，畫面用主題色塊佔位，也不用每次重打 API
      patch._noHero = true;
      patch._enrichV = ENRICH_VERSION;
    }
    // 一次都沒連上（飛航模式、國外沒網路）→ 什麼都不標，下次有網路再補
  } catch { /* 靜默：示意圖是加分項，抓不到不能影響任何流程 */ }

  await store.patch(spot.id, patch).catch(() => {});
  return store.getRaw(spot.id);
}

// 美食任務的示意圖（每個任務自己一張，不跟景點共用）
export async function enrichFoodQuest(quest) {
  if (!quest || quest.kind !== 'food') return quest;
  if (quest._enrichV >= ENRICH_VERSION) return quest;
  if (offline()) return quest;
  if (inFlight.has(quest.id)) return inFlight.get(quest.id);
  const p = (async () => {
    const patch = {};
    const net0 = netHits;
    try {
      const got = await dishImage(quest.title);
      if (got) {
        patch.refHash = got.hash; patch.refAttr = got.attr; patch.refGeneric = true;
        patch._enrichV = ENRICH_VERSION;
      } else if (netHits > net0) {
        patch._enrichV = ENRICH_VERSION;     // 問過了就是沒有
      }
      // 連不上就不標，下次有網路再補
    } catch { /* 靜默 */ }
    if (Object.keys(patch).length) await store.patch(quest.id, patch).catch(() => {});
    return store.getRaw(quest.id);
  })().finally(() => inFlight.delete(quest.id));
  inFlight.set(quest.id, p);
  return p;
}

function trimExtract(s, max = 40) {
  const first = String(s).split(/。|\n/)[0].trim();
  return (first.length > max ? first.slice(0, max) + '…' : first) || '';
}

// 一次補齊整個行程。背景漸進執行：一個一個抓、中間留間隔不打爆對方，
// 每抓完一個就 onProgress 通知畫面把那一張補上去（不用整頁重畫）。
export async function enrichTrip(tripId, { force = false, onProgress } = {}) {
  const trip = store.get(tripId);
  if (!trip || (trip.allowWiki === false && !force)) return;
  if (offline()) return;

  const tell = (type, id) => { try { onProgress && onProgress({ type, id }); } catch { /* 畫面的錯不能影響補圖 */ } };

  for (const s of store.spotsOf(tripId)) {
    const stale = (s._enrichV || 0) < ENRICH_VERSION;
    if (!stale && !force) continue;
    if (force) await store.patch(s.id, { _enrichV: 0, _noHero: false });
    await enrichSpot(store.getRaw(s.id));
    tell('spot', s.id);
    if (offline()) return;                                  // 中途斷網就停，剩下的下次再補
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const q of store.questsOfTrip(tripId)) {
    if (q.kind !== 'food') continue;
    const stale = (q._enrichV || 0) < ENRICH_VERSION;
    if (!stale && !force) continue;
    if (force) await store.patch(q.id, { _enrichV: 0 });
    await enrichFoodQuest(store.getRaw(q.id));
    tell('quest', q.id);
    if (offline()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ---------- 給畫面用 ----------
// 這個任務要顯示哪一張示意圖：自己拍的 > 該道菜的通用照 > 景點照 > （null → 主題色塊）
export function refImageFor(quest, spot, ownHash) {
  if (ownHash) return { hash: ownHash, own: true };
  if (quest && quest.refHash) return { hash: quest.refHash, attr: quest.refAttr, generic: true };
  if (spot && spot.heroHash) return { hash: spot.heroHash, attr: spot.heroAttr };
  return null;
}

// 圖片出處：Wikimedia 多是 CC 授權，要標作者與授權條款。
// 美食那種「該道菜的通用照」還要講清楚不是該店實照，不然會誤導。
export function creditLine(attr, generic) {
  const bits = [];
  if (generic) bits.push('示意圖');
  if (attr && attr.author) bits.push(attr.author);
  if (attr && attr.license) bits.push(attr.license);
  return bits.join(' · ');
}

// 還有沒有沒補完的（畫面決定要不要重跑）
export function needsEnrich(tripId) {
  const spots = store.spotsOf(tripId).some((s) => (s._enrichV || 0) < ENRICH_VERSION);
  const foods = store.questsOfTrip(tripId).some((q) => q.kind === 'food' && (q._enrichV || 0) < ENRICH_VERSION);
  return spots || foods;
}
