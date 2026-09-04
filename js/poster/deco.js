// 手繪風裝飾 —— 全部是 Path2D 常數，向量、零位元組、不會 taint canvas。

// 葉子
export function leaf(ctx, x, y, s, rot, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = color;
  const p = new Path2D('M0,-10 C7,-7 7,7 0,10 C-7,7 -7,-7 0,-10 Z');
  ctx.fill(p);
  ctx.strokeStyle = color; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
  ctx.restore();
}

// 一小根帶三片葉的枝
export function sprig(ctx, x, y, s, rot, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, -14, 4, -30); ctx.stroke();
  ctx.restore();
  leaf(ctx, x + 6 * s, y - 10 * s, s * 0.9, rot + 0.6, color);
  leaf(ctx, x + 2 * s, y - 22 * s, s * 0.8, rot - 0.5, color);
  leaf(ctx, x + 4 * s, y - 30 * s, s * 0.7, rot + 0.2, color);
}

// 雲
export function cloud(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-14, 0, 10, 0, 7); ctx.arc(-2, -5, 13, 0, 7); ctx.arc(12, 0, 10, 0, 7);
  ctx.rect(-14, 0, 26, 10);
  ctx.fill();
  ctx.restore();
}

// 小屋
export function house(ctx, x, y, s, rot, wall, roof) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(s, s);
  ctx.fillStyle = wall; ctx.fillRect(-11, -6, 22, 18);
  ctx.fillStyle = roof;
  ctx.beginPath(); ctx.moveTo(-15, -6); ctx.lineTo(0, -20); ctx.lineTo(15, -6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-4, 0, 8, 12);
  ctx.restore();
}

// 太陽
export function sun(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
    ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
    ctx.stroke();
  }
  ctx.restore();
}

// 彩旗（bunting）
export function bunting(ctx, x1, y1, x2, y2, colors) {
  ctx.save();
  ctx.strokeStyle = 'rgba(90,70,50,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  const cy = Math.max(y1, y2) + 24;
  ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, cy, x2, y2); ctx.stroke();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const mx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * ((x1 + x2) / 2) + t * t * x2;
    const my = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(mx - 8, my); ctx.lineTo(mx + 8, my); ctx.lineTo(mx, my + 14); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// 一朵水彩暈染色塊（低透明度疊路徑，不用 filter）
export function blob(ctx, x, y, r, color, seedFn) {
  ctx.save(); ctx.translate(x, y);
  for (let layer = 0; layer < 3; layer++) {
    ctx.globalAlpha = 0.05 + layer * 0.03;
    ctx.fillStyle = color;
    ctx.beginPath();
    const pts = 9;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = r * (0.72 + 0.4 * seedFn() - layer * 0.05);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.82;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// 種子亂數（同一 tripId → 同一張海報）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
