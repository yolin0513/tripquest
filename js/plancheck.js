// 行程檢查（v1.69）—— 找出「確定有問題」的安排，並給一個可以單獨套用的修正建議。
//
// 三個 Opus 5 代理評估後的定案清單。判準只有一條：
//   **只報「不需要任何假設就成立」的事。** 誤報一次，長輩以後就不看了。
//
// 報這幾條：
//   · order    使用者自己填的兩個「幾點到」前後顛倒（純使用者輸入，零估算）
//   · overlap  前一站的固定時段還沒結束，下一站就開始了（同上）
//   · late     趕不上 —— 但要通過三道閘（見 route.js 的 lateSoft）：矩陣來自 OSRM、
//              上游沒有任何假設停留、遲到超過 20 分。不通過就不進這張清單。
//   · overnight 這一天排到隔天了 —— **陳述不是警告**（夜景→夜市→凌晨拉麵是正當安排）
//
// 刻意不報：
//   · 「到達時已打烊」：專案裡沒有任何景點的營業時間資料（見 STATUS）。一條只在 1%
//     的景點上發言的檢查會製造假的安全感，比不做更糟。
//   · 「停留時間太短」：stayMin 大多數情況根本沒填，這條會在使用者什麼都沒做的時候開罵。
//   · 「一天塞太多點」：太主觀，而且它客觀可驗證的核心已經被 overnight 涵蓋。
//
// 修正建議的原則（代理點名的阻斷級問題）：**優先動 stayMin 或 order，避免寫 startMin**。
// 幫景點補上 startMin 等於替使用者種下一個永久的固定時刻約束，從此每次微調順序都會
// 跳警告 —— 那正是「假警告淹沒長輩」的來源，而且是 App 自己種的。

import { spotTimes, fmtHHMM } from './spottime.js';

export const MAX_SHOWN = 3;
const MIN_STAY = 15;              // 建議縮短停留時，不會把人壓到比這更短

// 這一條問題「當下的樣子」。使用者按了「這樣沒關係」之後，只要相關數字沒變就不再報；
// 一旦他改了時間，簽章對不上，問題就會重新出現（不是永久消音）。
export function issueSig(it) {
  return [it.kind, it.at ?? '', it.prevAt ?? '', it.amount ?? ''].join(':');
}

function isOk(spot, it) {
  const ok = spot && spot._ok;
  return !!(ok && ok[it.kind] === issueSig(it));
}

// spots：這一天依 order 排好的景點；chain：chainTimes 的輸出；conflicts：timeConflicts 的輸出
// 回傳依「當天時間先後」排序的問題清單（不是依嚴重度 —— 長輩是照順序讀一天的行程的，
// 而且修最早的那一條通常會連帶解掉後面的，所以時間順序同時也是正確的修復順序）。
export function dayIssues(spots, chain, conflicts) {
  const idxOf = new Map(spots.map((s, i) => [s.id, i]));
  const out = [];

  for (const c of conflicts || []) {
    const i = idxOf.get(c.id);
    if (i == null) continue;
    const prevI = idxOf.get(c.prevId);
    if (c.kind === 'order') {
      out.push({
        kind: 'order', i, id: c.id, prevId: c.prevId, at: c.at, prevAt: c.prevAt,
        title: `${spots[i].name || '這一站'} 訂 ${fmtHHMM(c.at)}，卻排在 ${c.prevName || '前一站'}（${fmtHHMM(c.prevAt)}）後面`,
        advice: `把這兩站的順序對調`,
        fix: prevI != null ? { type: 'swap', a: c.prevId, b: c.id } : null,
      });
    } else if (c.kind === 'overlap') {
      const cut = c.prevEnd - c.at;
      const prevStay = prevI != null ? (spotTimes(spots[prevI]).stayMin || 0) : 0;
      const left = prevStay - cut;
      out.push({
        kind: 'overlap', i, id: c.id, prevId: c.prevId, at: c.at, prevAt: c.prevAt, amount: cut,
        title: `${c.prevName || '前一站'} ${fmtHHMM(c.prevAt)} 停到 ${fmtHHMM(c.prevEnd)}，但 ${spots[i].name || '這一站'} 訂 ${fmtHHMM(c.at)}`,
        advice: left >= MIN_STAY
          ? `把 ${c.prevName || '前一站'} 的停留改成 ${fmtDurMin(left)}`
          : `這兩個時間差太多，要自己看一下`,
        fix: (left >= MIN_STAY && c.prevId) ? { type: 'stay', id: c.prevId, stayMin: left } : null,
      });
    }
  }

  // 連鎖項目要收斂回根因（代理點名）。同一站如果已經因為「使用者自己填的兩個
  // 時間打架」被報了，那個遲到就是同一件事的副作用 —— 報兩次只會讓人以為
  // 有兩個問題，而且兩條的修正建議互相矛盾（一個要對調順序、一個要縮短停留）。
  // 保留零估算的那一條（conflict），丟掉建立在車程估算上的那一條（late）。
  const covered = new Set(out.map((x) => x.id));

  for (let i = 1; i < chain.length; i++) {
    const c = chain[i];
    if (covered.has(c.id)) continue;
    // 只收「硬」遲到。lateSoft 代表這個數字建立在估算上（離線的直線車程、
    // 我們自己猜的停留），那種不該進清單，畫面上已經用灰字說「可能有點趕」了。
    if (!(c.late > 0 && !c.lateSoft)) continue;
    const prev = chain[i - 1];
    const prevStay = spotTimes(spots[i - 1]).stayMin;
    const canCut = Number.isFinite(prevStay) && prevStay - c.late >= MIN_STAY;
    out.push({
      kind: 'late', i, id: c.id, prevId: spots[i - 1].id, at: c.arrive, amount: c.late,
      title: `${spots[i].name || '這一站'} 訂 ${fmtHHMM(c.arrive)}，但從 ${spots[i - 1].name || '上一站'} 過去`
        + `最快 ${fmtHHMM(prev.leave + Math.round(c.travel / 60))} 才會到`,
      advice: canCut
        ? `把 ${spots[i - 1].name || '上一站'} 的停留縮短 ${fmtDurMin(c.late)}`
        : `要自己看一下 —— 縮短前一站也來不及`,
      fix: canCut ? { type: 'stay', id: spots[i - 1].id, stayMin: prevStay - c.late } : null,
    });
  }

  // 排到隔天：陳述，不加 ⚠、也沒有修正按鈕。夜景 → 夜市 → 凌晨拉麵是正當安排。
  //
  // 但這一條**繼承了規則 1 的弱點**（代理 C 點名，v1.70.1 才補上）：離開時刻是
  // 「到達 + 停留」，而停留常常是我們自己依類別猜的。實測：使用者只填了「夜市 22:00」
  // 一個時間、後面兩站什麼都沒填，我們照樣宣稱「這一天會排到隔天 02:10」—— 那個
  // 02:10 完全是三個猜出來的停留堆出來的，使用者從沒說過他要在夜市待 90 分鐘。
  //
  // 不刪掉這一條（「你這天比想像中長」是真的有用的訊息），但**要講清楚它是推算**。
  // 這跟畫面上既有的「（停留未設，先用 1 小時推算）」是同一套誠實原則。
  const last = chain[chain.length - 1];
  if (last && Number.isFinite(last.leave) && last.leave >= 1440) {
    const guessed = chain.some((c) => c.stayAssumed);
    out.push({
      kind: 'overnight', i: chain.length - 1, id: last.id, at: last.leave, note: true, soft: guessed,
      title: (guessed ? '照目前的推算，' : '') + `這一天會排到${fmtHHMM(last.leave)}`,
      advice: guessed
        ? '有幾站的停留時間是估的 —— 實際待多久會影響這個時間'
        : '如果本來就打算跑夜場，這樣沒問題',
      fix: null,
    });
  }

  const kept = out.filter((it) => !isOk(spots[it.i], it));
  kept.sort((a, b) => a.i - b.i || (a.kind < b.kind ? -1 : 1));
  return kept;
}

function fmtDurMin(m) {
  if (!Number.isFinite(m)) return '';
  const h = Math.floor(m / 60), mi = m % 60;
  return h ? `${h} 小時${mi ? ` ${mi} 分` : ''}` : `${mi} 分`;
}
export { fmtDurMin };
