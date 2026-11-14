// 把幾張 JPEG 包成一份 PDF（v1.88.0 行程海報的「存成 PDF」）。純函式：位元組進、位元組出。
// 不用外部套件：PDF 本來就能直接放 JPEG（/DCTDecode），不必解碼、不必壓縮；每一頁一張圖、鋪滿整頁。
// 頁面大小照圖的比例：寬固定 A4 的 595.28pt，高等比例——長圖就是一頁長頁（不切、不硬縮進 A4，列印時由印表機縮放）。
// 結構：1 目錄、2 頁面樹；第 i 頁＝頁（3＋3i）、內容（4＋3i）、圖（5＋3i）。最後是 xref（每個物件的位元組位置）與 trailer。
// scripts/itinposterlayouttest.mjs 驗：xref 的每一個位置都正好指到「N 0 obj」、startxref 指到 xref、頁數、長度欄位與內容一致。

export const A4_WIDTH_PT = 595.28;

// images：[{ bytes: Uint8Array（JPEG）, w, h }]（w、h 是像素，只拿來算比例與寫進圖的欄位）
export function pdfFromJpegs(images, { pageWidthPt = A4_WIDTH_PT } = {}) {
  if (!images || !images.length) throw new Error('沒有圖可以放進 PDF');
  const enc = new TextEncoder();
  const parts = [];
  let len = 0;
  const offsets = [];
  const raw = (u8) => { parts.push(u8); len += u8.length; };
  const str = (s) => raw(enc.encode(s));
  const obj = (n, body) => { offsets[n] = len; str(`${n} 0 obj\n${body}\nendobj\n`); };

  // 檔頭第二行放四個大於 127 的位元組：告訴讀的程式這是二進位檔（PDF 規格的建議寫法）
  str('%PDF-1.4\n');
  raw(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const n = images.length;
  const pageIds = images.map((_, i) => 3 + 3 * i);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`);
  images.forEach((im, i) => {
    if (!(im && im.bytes && im.bytes.length && im.w > 0 && im.h > 0)) throw new Error(`第 ${i + 1} 張圖是空的`);
    const pw = +pageWidthPt.toFixed(2), ph = +(pageWidthPt * im.h / im.w).toFixed(2);
    const page = 3 + 3 * i, content = page + 1, img = page + 2;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${img} 0 R >> >> /Contents ${content} 0 R >>`);
    const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    obj(content, `<< /Length ${enc.encode(draw).length} >>\nstream\n${draw}\nendstream`);
    offsets[img] = len;
    str(`${img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
    raw(im.bytes);
    str('\nendstream\nendobj\n');
  });

  const size = 3 + 3 * n;
  const xref = len;
  let x = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let k = 1; k < size; k++) x += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
  str(x);
  str(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
