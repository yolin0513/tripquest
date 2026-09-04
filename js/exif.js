// 極簡 JPEG EXIF 讀取器：只取「拍攝時間」與「GPS 座標」兩項。
// 用途：在把照片重新編碼（會清掉所有中繼資料）之前，先把這兩個值讀出來，
//       時間永遠留著（用於排序 / 影片順序），座標只有在使用者為該行程開啟地圖時才寫入記錄。
// 不依賴任何套件。

export async function readExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xffd8) return {}; // 非 JPEG

    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        // APP1 — 檢查 "Exif\0\0"
        if (view.getUint32(offset + 4) === 0x45786966) {
          return parseTiff(view, offset + 10);
        }
      }
      if (marker === 0xffda) break; // 進入影像資料
      offset += 2 + size;
    }
    return {};
  } catch {
    return {};
  }
}

function parseTiff(view, start) {
  const little = view.getUint16(start) === 0x4949;
  const get16 = (o) => view.getUint16(o, little);
  const get32 = (o) => view.getUint32(o, little);

  const ifd0 = start + get32(start + 4);
  const out = {};
  let exifIfdPtr = 0;
  let gpsIfdPtr = 0;

  const readIFD = (ifdStart, handler) => {
    const count = get16(ifdStart);
    for (let i = 0; i < count; i++) {
      const entry = ifdStart + 2 + i * 12;
      const tag = get16(entry);
      const format = get16(entry + 2);
      const components = get32(entry + 4);
      const len = FORMAT_BYTES[format] * components;
      let valOffset = entry + 8;
      if (len > 4) valOffset = start + get32(entry + 8);
      handler(tag, format, components, valOffset);
    }
  };

  const readString = (o, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = view.getUint8(o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const readRational = (o) => get32(o) / get32(o + 4);

  readIFD(ifd0, (tag, fmt, comp, o) => {
    if (tag === 0x8769) exifIfdPtr = start + get32(o);
    if (tag === 0x8825) gpsIfdPtr = start + get32(o);
    if (tag === 0x0132 && !out.dateTime) out.dateTime = readString(o, 20);
  });

  if (exifIfdPtr) {
    readIFD(exifIfdPtr, (tag, fmt, comp, o) => {
      if (tag === 0x9003) out.dateTimeOriginal = readString(o, 20); // DateTimeOriginal
    });
  }

  if (gpsIfdPtr) {
    let latRef = 'N', lngRef = 'E', lat = null, lng = null;
    readIFD(gpsIfdPtr, (tag, fmt, comp, o) => {
      if (tag === 1) latRef = readString(o, 2);
      if (tag === 2) lat = readRational(o) + readRational(o + 8) / 60 + readRational(o + 16) / 3600;
      if (tag === 3) lngRef = readString(o, 2);
      if (tag === 4) lng = readRational(o) + readRational(o + 8) / 60 + readRational(o + 16) / 3600;
    });
    if (lat != null && lng != null && isFinite(lat) && isFinite(lng)) {
      // 只留小數 3 位（~110 公尺）——足以標出地標，但標不到住家門口
      out.gps = {
        lat: +( (latRef === 'S' ? -lat : lat).toFixed(3) ),
        lng: +( (lngRef === 'W' ? -lng : lng).toFixed(3) ),
      };
    }
  }

  // 時間字串 "2024:03:15 09:30:00" → epoch ms
  const raw = out.dateTimeOriginal || out.dateTime;
  if (raw && /^\d{4}:\d{2}:\d{2}/.test(raw)) {
    const [d, t] = raw.split(' ');
    const iso = d.replace(/:/g, '-') + 'T' + (t || '00:00:00');
    const ms = Date.parse(iso);
    if (!isNaN(ms)) out.takenAt = ms;
  }
  return out;
}

const FORMAT_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
