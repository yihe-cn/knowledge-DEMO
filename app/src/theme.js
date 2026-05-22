// theme.js — neumorphic palette and surface helpers

export const THEMES = {
  cream: {
    bg: '#ECE7DD',
    surface: '#ECE7DD',
    surface2: '#E4DED1',
    text: '#2A2620',
    textSoft: '#6B6356',
    textMute: '#9B9081',
    line: 'rgba(120,100,70,0.10)',
    sLight: 'rgba(255,253,247,0.95)',
    sDark: 'rgba(150,130,95,0.32)',
    accent: '#2C5F5A',
    accentSoft: '#B8743A',
    good: '#3D8B5C',
    warn: '#C97A3D',
    bad: '#C25A4F',
  },
  slate: {
    bg: '#E4E7ED',
    surface: '#E4E7ED',
    surface2: '#DCDFE6',
    text: '#1F2430',
    textSoft: '#5A6273',
    textMute: '#8B91A1',
    line: 'rgba(80,90,120,0.10)',
    sLight: 'rgba(255,255,255,0.95)',
    sDark: 'rgba(110,120,150,0.32)',
    accent: '#3F4DB5',
    accentSoft: '#8A5BC4',
    good: '#3A7A60',
    warn: '#C97A3D',
    bad: '#C25A4F',
  },
  dark: {
    bg: '#1F2128',
    surface: '#1F2128',
    surface2: '#23262E',
    text: '#E8E6E1',
    textSoft: '#9A9B9F',
    textMute: '#6A6B70',
    line: 'rgba(255,255,255,0.06)',
    sLight: 'rgba(58,62,72,0.85)',
    sDark: 'rgba(0,0,0,0.55)',
    accent: '#7BB8A8',
    accentSoft: '#D29A5F',
    good: '#7BC49A',
    warn: '#E1A074',
    bad: '#E08A82',
  },
};

export function useTheme(name) {
  return THEMES[name] || THEMES.cream;
}

export function neuRaised(t, r = 18, depth = 1) {
  const d1 = depth * 6, d2 = depth * 14;
  return {
    background: t.surface,
    borderRadius: r,
    boxShadow: `${d1}px ${d1}px ${d2}px ${t.sDark}, -${d1}px -${d1}px ${d2}px ${t.sLight}`,
  };
}

export function neuInset(t, r = 18, depth = 1) {
  const d1 = depth * 3, d2 = depth * 6;
  return {
    background: t.surface,
    borderRadius: r,
    boxShadow: `inset ${d1}px ${d1}px ${d2}px ${t.sDark}, inset -${d1}px -${d1}px ${d2}px ${t.sLight}`,
  };
}

export function neuFlat(t, r = 18) {
  return {
    background: t.surface,
    borderRadius: r,
    boxShadow: `2px 2px 5px ${t.sDark}, -2px -2px 5px ${t.sLight}`,
  };
}
