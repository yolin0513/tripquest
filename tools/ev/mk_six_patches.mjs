// F9 六條的突變 patch（用程式寫 JSON，不經 shell）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 輸出到 tools/mutations/（mutlint 檢查的那個目錄）；第一個參數可指定別的目錄（驗證「重新產生＝入庫的那份」用）
const S = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mutations');
const P = {
  // 第 1 條：✗ 那一行不點名驗法（訊息）；以及拿掉「登記對不上就停」本身（P3、P6、Q7 共用這一行）
  six1: [['——commit 之後跑 npm run f8verify"\n      echo "擋下：F8 驗法沒有驗過（$f 改過', '——請重新驗證"\n      echo "擋下：F8 驗法沒有驗過（$f 改過']],
  six1b: [['echo "擋下：F8 驗法沒有驗過（$f 改過、驗法還沒重跑）"; exit 6', 'true']],
  // 第 2 條：登記相符也擋
  six2: [['  echo "F8 驗法：這次動到了$TOUCHED，登記相符"', '  echo "F8 驗法：這次動到了$TOUCHED，登記相符"; exit 6']],
  // 第 3 條：f8verify 失敗時不刪登記（開始前先刪、中途停下時刪，兩道都拿掉；單拿一道見 six3a／six3b）
  six3: [['if (!ONLY) console.log(`開始前：', 'if (false) console.log(`開始前：'],
    ['  console.log(`擋下：F8 驗法沒有跑完，不登記（.logs/f8.verified ${dropReg(REG)}）`);', '  console.log(`擋下：F8 驗法沒有跑完，不登記（.logs/f8.verified 沒動）`);']],
  six3a: [['if (!ONLY) console.log(`開始前：', 'if (false) console.log(`開始前：']],
  six3b: [['  console.log(`擋下：F8 驗法沒有跑完，不登記（.logs/f8.verified ${dropReg(REG)}）`);', '  console.log(`擋下：F8 驗法沒有跑完，不登記（.logs/f8.verified 沒動）`);']],
  // 第 4 條：f8verify 不先確認工作區＝HEAD
  six4: [['if (pre.length) give(', 'if (false) give(']],
  // 第 5 條：不管有沒有動到都看登記
  six5: [['if [ -n "$TOUCHED" ]; then', 'if true; then']],
  // 第 6 條：只看最後一個 commit
  six6: [['git log --format= --name-only "$RANGE" >', 'git log -1 --format= --name-only HEAD >']],
};
for (const [k, list] of Object.entries(P)) fs.writeFileSync(path.join(S, `psix_${k}.json`), JSON.stringify(list.map(([from, to]) => ({ from, to }))));
console.log(Object.keys(P).length + ' 個');
