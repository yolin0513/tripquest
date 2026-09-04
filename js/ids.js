// 識別碼、裝置指紋、雜湊工具
// 設計目標：所有記錄用 UUID，未來多裝置合併時不會撞號；照片以內容雜湊定址，天然去重、天然無衝突。

const DEVICE_KEY = 'tripquest.deviceId';
const DEVICE_NAME_KEY = 'tripquest.deviceName';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // 極舊瀏覽器退路
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// 這台裝置的穩定 ID（用於 last-write-wins 的決勝、以及標記照片來源裝置）
export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function deviceName() {
  return localStorage.getItem(DEVICE_NAME_KEY) || '我';
}
export function setDeviceName(name) {
  localStorage.setItem(DEVICE_NAME_KEY, String(name || '').slice(0, 40) || '我');
}

// 短邀請碼 / 任務代碼：給人唸的，去掉易混字元
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function shortCode(len = 6) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

// 內容雜湊（SHA-256 → hex），用來為照片 blob 定址
export async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 依字串產生穩定的頭像色相（給成員頭像用）
export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
