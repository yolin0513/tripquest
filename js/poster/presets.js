// 行程海報的三種風格 —— 純資料，交給同一個排版引擎。

export const PRESETS = {
  watercolor: {
    id: 'watercolor', label: '🎨 水彩',
    paper: '#f6efe0', ink: '#4a3f33', sub: '#7d6f5c', line: '#c9b8a0',
    accent: '#5b8a72', accent2: '#c98a5b', band: '#e8dcc6',
    blobColors: ['#8fb59c', '#e0b07a', '#a7c4d6', '#d99a9a'],
    bunting: ['#e0b07a', '#8fb59c', '#d99a9a', '#a7c4d6'],
    displayFont: 'Caveat', paperTexture: true, decoDensity: 1,
    polaroid: { border: 14, bottom: 46, shadow: 'rgba(74,63,51,0.28)', rotate: 6, tint: 'rgba(246,239,224,0.0)' },
  },
  minimal: {
    id: 'minimal', label: '⚪ 簡約',
    paper: '#ffffff', ink: '#1c1c1e', sub: '#8a8a8e', line: '#e2e2e5',
    accent: '#3563e9', accent2: '#3563e9', band: '#f2f2f4',
    blobColors: ['#e8ecff', '#eef0f2'],
    bunting: ['#3563e9', '#c7d0ea'],
    displayFont: 'Caveat', paperTexture: false, decoDensity: 0.35,
    polaroid: { border: 8, bottom: 0, shadow: 'rgba(0,0,0,0.12)', rotate: 0, tint: 'rgba(0,0,0,0)' },
  },
  magazine: {
    id: 'magazine', label: '📖 雜誌',
    paper: '#111318', ink: '#f4f6fb', sub: '#a9b2c6', line: '#333a49',
    accent: '#ffb454', accent2: '#ff6b8b', band: '#1c2130',
    blobColors: ['#2a3350', '#3a2b3f'],
    bunting: ['#ffb454', '#ff6b8b', '#5b8cff'],
    displayFont: 'Caveat', paperTexture: 'dark', decoDensity: 0.5,
    polaroid: { border: 10, bottom: 0, shadow: 'rgba(0,0,0,0.5)', rotate: 3, tint: 'rgba(0,0,0,0)' },
  },
};

export const CJK_STACK = '"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",sans-serif';
