// 影像壓縮 worker：在背景執行緒把照片縮到 1600px、重新編碼成 JPEG，
// 順便產一張 320px 縮圖。重新編碼會清掉所有 EXIF（含 GPS）——這正是預設要的隱私行為。

self.onmessage = async (e) => {
  const { id, blob, maxEdge = 1600, thumbEdge = 320, quality = 0.82 } = e.data;
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const photo = await encode(bmp, maxEdge, quality);
    const thumb = await encode(bmp, thumbEdge, 0.72);
    bmp.close?.();
    self.postMessage({ id, ok: true, photo: photo.blob, thumb: thumb.blob, w: photo.w, h: photo.h });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};

async function encode(bmp, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob, w, h };
}
