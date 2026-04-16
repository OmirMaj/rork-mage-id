function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function derivePrimaryLight(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(s * 1.1, 1), Math.min(l + 0.12, 0.9));
}

function derivePrimaryDark(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, Math.max(l - 0.12, 0.1));
}

let _customPrimary: string | null = null;
let _customAccent: string | null = null;

export function setCustomColors(primary: string | null, accent: string | null) {
  _customPrimary = primary;
  _customAccent = accent;
}

export const Colors = {
  get primary() { return _customPrimary || '#1A6B3C'; },
  get primaryLight() { return _customPrimary ? derivePrimaryLight(_customPrimary) : '#2A9055'; },
  get primaryDark() { return _customPrimary ? derivePrimaryDark(_customPrimary) : '#0F4526'; },
  get accent() { return _customAccent || '#FF9500'; },
  accentLight: '#FFCC00',
  accentMuted: '#FFE0A0',

  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F2F7',
  surfaceElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: 'rgba(60,60,67,0.1)',

  text: '#000000',
  textSecondary: 'rgba(60,60,67,0.6)',
  textMuted: 'rgba(60,60,67,0.36)',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  border: 'rgba(60,60,67,0.18)',
  borderLight: 'rgba(60,60,67,0.08)',

  success: '#34C759',
  successLight: '#E8FAF0',
  warning: '#FF9500',
  warningLight: '#FFF3E0',
  error: '#FF3B30',
  errorLight: '#FFF0EF',
  info: '#007AFF',
  infoLight: '#EBF3FF',

  shadow: 'rgba(0,0,0,0.05)',
  overlay: 'rgba(0,0,0,0.45)',

  fillTertiary: 'rgba(120,120,128,0.12)',
  fillSecondary: 'rgba(120,120,128,0.08)',
};

export default {
  light: {
    text: Colors.text,
    background: Colors.background,
    tint: Colors.primary,
    tabIconDefault: Colors.textMuted,
    tabIconSelected: Colors.primary,
  },
};
