// 在暫存複本裡改一支檔的某幾段（每段必須剛好命中一次），用來做盤點的實測
// 用法：node inv_patch.mjs <檔案> <patch.json>   patch.json：[{from, to}]
import fs from 'node:fs';
const [file, pj] = process.argv.slice(2);
let s = fs.readFileSync(file, 'utf8');
for (const { from, to } of JSON.parse(fs.readFileSync(pj, 'utf8'))) {
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log(`✗ 突變點命中 ${n} 次：${from.slice(0, 60)}`); process.exit(9); }
  s = s.replace(from, to);
}
fs.writeFileSync(file, s);
console.log('已改：', file);
