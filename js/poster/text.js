// canvas 2D 文字排版 —— CJK 逐字斷行、拉丁按空白斷行。
// 兩段式：先量測算高，再設 canvas 高度，再畫。

export function wrapLines(ctx, text, maxW, font) {
  ctx.font = font;
  const out = [];
  let line = '';
  const flush = () => { if (line) out.push(line); line = ''; };
  for (const ch of String(text || '')) {
    if (ch === '\n') { flush(); continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      // 拉丁字：盡量在最後一個空白處斷
      const sp = line.lastIndexOf(' ');
      if (sp > 0 && /[A-Za-z0-9]/.test(ch)) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
      else { out.push(line); line = ch; }
    } else {
      line = test;
    }
  }
  flush();
  return out;
}

// 畫多行，回傳畫完的 y
export function drawParagraph(ctx, text, x, y, maxW, { font, color, lineHeight, align = 'left', maxLines = 99 }) {
  let lines = wrapLines(ctx, text, maxW, font);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = clip(ctx, lines[maxLines - 1] + '…', maxW, font);
  }
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

export function paragraphHeight(ctx, text, maxW, font, lineHeight, maxLines = 99) {
  const n = Math.min(wrapLines(ctx, text, maxW, font).length, maxLines);
  return n * lineHeight;
}

export function clip(ctx, text, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
