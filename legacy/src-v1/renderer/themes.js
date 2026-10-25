// 内置皮肤定义 —— 皮肤 = 一组 CSS 变量。新增皮肤只需在这里加一项。
// 用户自定义皮肤存到 userData/themes.json，启动时合并。

const BUILTIN_THEMES = {
  "default": {
    "name": "经典红",
    "builtin": true,
    "vars": {
      "--bg": "#f6f7f9",
      "--bg-2": "#ffffff",
      "--bg-3": "#eef0f4",
      "--text": "#1f2329",
      "--text-2": "#6b7280",
      "--text-3": "#9ca3af",
      "--accent": "#c62f2f",
      "--accent-2": "#e13c3c",
      "--accent-fg": "#ffffff",
      "--border": "#e3e6ea",
      "--shadow": "0 2px 12px rgba(0,0,0,.08)",
      "--titlebar": "#c62f2f",
      "--titlebar-fg": "#ffffff",
      "--radius": "8px",
      "--lyric-active": "#c62f2f"
    }
  },
  "dark": {
    "name": "暗夜黑",
    "builtin": true,
    "vars": {
      "--bg": "#1a1b1e",
      "--bg-2": "#232428",
      "--bg-3": "#2c2e33",
      "--text": "#e8eaed",
      "--text-2": "#a0a4ab",
      "--text-3": "#6b7078",
      "--accent": "#e13c3c",
      "--accent-2": "#ff5252",
      "--accent-fg": "#ffffff",
      "--border": "#34363b",
      "--shadow": "0 2px 16px rgba(0,0,0,.4)",
      "--titlebar": "#141518",
      "--titlebar-fg": "#e8eaed",
      "--radius": "8px",
      "--lyric-active": "#ff5252"
    }
  },
  "sakura": {
    "name": "樱花粉",
    "builtin": true,
    "vars": {
      "--bg": "#fff5f8",
      "--bg-2": "#ffffff",
      "--bg-3": "#ffe9f0",
      "--text": "#3d2b33",
      "--text-2": "#8a6b78",
      "--text-3": "#b8a0aa",
      "--accent": "#ff6b9d",
      "--accent-2": "#ff8bb3",
      "--accent-fg": "#ffffff",
      "--border": "#ffd6e4",
      "--shadow": "0 2px 14px rgba(255,107,157,.15)",
      "--titlebar": "#ff8bb3",
      "--titlebar-fg": "#ffffff",
      "--radius": "12px",
      "--lyric-active": "#ff6b9d"
    }
  },
  "aurora": {
    "name": "极光青",
    "builtin": true,
    "vars": {
      "--bg": "#0e1a1f",
      "--bg-2": "#14242b",
      "--bg-3": "#1b3038",
      "--text": "#dff5f2",
      "--text-2": "#8bb8b3",
      "--text-3": "#5c8480",
      "--accent": "#2ee6c5",
      "--accent-2": "#5cf0d6",
      "--accent-fg": "#04221d",
      "--border": "#22404a",
      "--shadow": "0 2px 18px rgba(46,230,197,.18)",
      "--titlebar": "#0a1418",
      "--titlebar-fg": "#2ee6c5",
      "--radius": "10px",
      "--lyric-active": "#2ee6c5"
    }
  },
  "paper": {
    "name": "素纸米",
    "builtin": true,
    "vars": {
      "--bg": "#f5f2ea",
      "--bg-2": "#fdfbf6",
      "--bg-3": "#ebe6da",
      "--text": "#33302a",
      "--text-2": "#726c60",
      "--text-3": "#a39c8d",
      "--accent": "#8a6f47",
      "--accent-2": "#a6875a",
      "--accent-fg": "#ffffff",
      "--border": "#ddd6c6",
      "--shadow": "0 2px 12px rgba(80,70,50,.10)",
      "--titlebar": "#e8e2d4",
      "--titlebar-fg": "#4a453b",
      "--radius": "6px",
      "--lyric-active": "#8a6f47"
    }
  },
  "glass": {
    "name": "玻璃蓝",
    "builtin": true,
    "vars": {
      "--bg": "#eef4fb",
      "--bg-2": "rgba(255,255,255,.72)",
      "--bg-3": "#dde9f7",
      "--text": "#1a2b3d",
      "--text-2": "#5a7186",
      "--text-3": "#8fa3b8",
      "--accent": "#2b7de9",
      "--accent-2": "#4a95f5",
      "--accent-fg": "#ffffff",
      "--border": "rgba(180,205,230,.7)",
      "--shadow": "0 4px 20px rgba(43,125,233,.14)",
      "--titlebar": "rgba(43,125,233,.92)",
      "--titlebar-fg": "#ffffff",
      "--radius": "10px",
      "--lyric-active": "#2b7de9"
    }
  }
};

/** 把皮肤变量应用到 :root */
function applyTheme(theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute('data-theme', theme.id || 'custom');
  document.body.classList.toggle('theme-dark', isDarkTheme(theme));
}

/** 粗判深浅：用 --bg 的亮度决定滚动条/毛玻璃等附加样式 */
function isDarkTheme(theme) {
  const bg = theme.vars['--bg'] || '#ffffff';
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

/** 从一张图片里提取主色，生成一整套皮肤变量（自定义皮肤用） */
function buildThemeFromColor(baseHex, name) {
  const [h, s, l] = hexToHsl(baseHex);
  const dark = l < 50;
  return {
    id: 'custom-' + baseHex.replace('#', ''),
    name: name || ('自定义 ' + baseHex.toUpperCase()),
    builtin: false,
    vars: {
      '--bg':        dark ? hsl(h, Math.min(s, 30), 10) : hsl(h, Math.min(s, 40), 97),
      '--bg-2':      dark ? hsl(h, Math.min(s, 25), 15) : '#ffffff',
      '--bg-3':      dark ? hsl(h, Math.min(s, 25), 20) : hsl(h, Math.min(s, 45), 93),
      '--text':      dark ? hsl(h, 15, 92) : hsl(h, 20, 15),
      '--text-2':    dark ? hsl(h, 12, 65) : hsl(h, 12, 42),
      '--text-3':    dark ? hsl(h, 10, 45) : hsl(h, 10, 62),
      '--accent':    baseHex,
      '--accent-2':  hsl(h, Math.min(s + 8, 95), Math.min(l + 8, 70)),
      '--accent-fg': (l > 62 || s < 25) ? '#1a1a1a' : '#ffffff',
      '--border':    dark ? hsl(h, Math.min(s, 22), 24) : hsl(h, Math.min(s, 35), 87),
      '--shadow':    '0 2px 14px ' + rgba(h, s, dark ? 20 : 45, dark ? .45 : .14),
      '--titlebar':  dark ? hsl(h, Math.min(s, 30), 8) : baseHex,
      '--titlebar-fg': (dark || l < 62) ? hsl(h, 15, 95) : '#1a1a1a',
      '--radius':    '10px',
      '--lyric-active': baseHex,
    }
  };
}

function hexToHsl(hex) {
  const m = hex.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16) / 255);
  const [r, g, b] = m;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
function hsl(h, s, l) { return `hsl(${h} ${s}% ${l}%)`; }
function rgba(h, s, l, a) { return `hsla(${h} ${s}% ${l}% / ${a})`; }

/** 从图片取主色调（去饱和像素的加权平均，比纯平均好看） */
function extractDominantColor(imgEl) {
  const c = document.createElement('canvas');
  const W = c.width = 64, H = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const rr = d[i], gg = d[i+1], bb = d[i+2], a = d[i+3];
    if (a < 128) continue;
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.299*rr + 0.587*gg + 0.114*bb) / 255;
    if (lum < 0.12 || lum > 0.94) continue;      // 丢掉纯黑纯白
    const w = sat * sat * (1 - Math.abs(lum - 0.5) * 1.2) + 0.01;
    r += rr * w; g += gg * w; b += bb * w; wsum += w;
  }
  if (!wsum) return { hex: '#c62f2f', palette: [] };
  return { hex: rgbToHex(r/wsum, g/wsum, b/wsum), palette: [] };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

// 显式暴露到 window：便于调试、扩展和歌词窗口复用
window.BUILTIN_THEMES = BUILTIN_THEMES;
window.applyTheme = applyTheme;
window.buildThemeFromColor = buildThemeFromColor;
window.extractDominantColor = extractDominantColor;
