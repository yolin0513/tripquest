// 行程海報的三種風格。主題（themes.json）再疊上去換色 / 換裝飾 / 換時間軸。
//   themeMode 'full'   → 紙、墨、色塊、彩旗全部吃主題色（水彩用）
//   themeMode 'accent' → 保留自己的紙與墨，只吃主題的重點色（簡約 / 雜誌用）

export const PRESETS = {
  watercolor: {
    id: 'watercolor', label: '🎨 水彩', themeMode: 'full',
    paper: '#f6efe0', ink: '#4a3f33', sub: '#7d6f5c', line: '#c9b8a0',
    accent: '#5b8a72', accent2: '#c98a5b', band: '#e8dcc6',
    blobColors: ['#8fb59c', '#e0b07a', '#a7c4d6', '#d99a9a'],
    bunting: ['#e0b07a', '#8fb59c', '#d99a9a', '#a7c4d6'],
    displayFont: 'Caveat', paperTexture: true, decoDensity: 1,
    polaroid: { border: 14, bottom: 46, shadow: 'rgba(74,63,51,0.28)', rotate: 6, tint: 'rgba(246,239,224,0.0)' },
  },
  minimal: {
    id: 'minimal', label: '⚪ 簡約', themeMode: 'accent',
    paper: '#ffffff', ink: '#1c1c1e', sub: '#8a8a8e', line: '#e2e2e5',
    accent: '#3563e9', accent2: '#3563e9', band: '#f2f2f4',
    blobColors: ['#e8ecff', '#eef0f2'],
    bunting: ['#3563e9', '#c7d0ea'],
    displayFont: 'Caveat', paperTexture: false, decoDensity: 0.4,
    polaroid: { border: 8, bottom: 0, shadow: 'rgba(0,0,0,0.12)', rotate: 0, tint: 'rgba(0,0,0,0)' },
  },
  magazine: {
    id: 'magazine', label: '📖 雜誌', themeMode: 'accent',
    paper: '#111318', ink: '#f4f6fb', sub: '#a9b2c6', line: '#333a49',
    accent: '#ffb454', accent2: '#ff6b8b', band: '#1c2130',
    blobColors: ['#2a3350', '#3a2b3f'],
    bunting: ['#ffb454', '#ff6b8b', '#5b8cff'],
    displayFont: 'Caveat', paperTexture: 'dark', decoDensity: 0.55,
    polaroid: { border: 10, bottom: 0, shadow: 'rgba(0,0,0,0.5)', rotate: 3, tint: 'rgba(0,0,0,0)' },
  },
};

export const CJK_STACK = '"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",sans-serif';

// preset + 主題 → 實際樣式
export function styleFor(preset, themeMeta) {
  const tp = (themeMeta && themeMeta.poster) || {};
  const deco = (themeMeta && themeMeta.deco) || null;
  const timeline = (themeMeta && themeMeta.timeline) || 'dot';
  if (preset.themeMode === 'full') {
    return {
      ...preset,
      paper: tp.paper || preset.paper, ink: tp.ink || preset.ink, sub: tp.sub || preset.sub,
      line: tp.line || preset.line, accent: tp.accent || preset.accent, accent2: tp.accent2 || preset.accent2,
      band: tp.band || preset.band,
      blobColors: tp.blobColors || preset.blobColors, bunting: tp.bunting || preset.bunting,
      polaroidTint: tp.polaroidTint || 'rgba(0,0,0,0)',
      tilt: tp.tilt ?? preset.polaroid.rotate,
      deco, timeline,
    };
  }
  // accent 模式：保留紙 / 墨，換重點色與裝飾
  return {
    ...preset,
    accent: tp.accent || preset.accent, accent2: tp.accent2 || preset.accent2,
    blobColors: tp.blobColors || preset.blobColors,
    bunting: tp.bunting || preset.bunting,
    band: preset.band,
    polaroidTint: 'rgba(0,0,0,0)',
    tilt: preset.polaroid.rotate,
    deco, timeline,
  };
}
