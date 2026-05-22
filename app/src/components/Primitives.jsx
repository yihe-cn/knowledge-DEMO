// Primitives.jsx — Card, PillButton, Icon, PhoneStatusBar, TopBar
import React from 'react';
import { neuRaised, neuInset } from '../theme.js';

export function Card({ children, t, style = {}, inset = false, radius = 22, depth = 1, onClick }) {
  const s = inset ? neuInset(t, radius, depth) : neuRaised(t, radius, depth);
  return (
    <div
      onClick={onClick}
      style={{
        ...s,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .15s ease, box-shadow .15s ease',
        ...style,
      }}
    >{children}</div>
  );
}

export function PillButton({ children, t, onClick, primary = false, disabled = false, style = {} }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        appearance: 'none', border: 0, cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '14px 22px', borderRadius: 999,
        background: primary ? t.accent : t.surface,
        color: primary ? '#fff' : t.text,
        fontSize: 15, fontWeight: 600, letterSpacing: '0.01em',
        opacity: disabled ? 0.5 : 1,
        boxShadow: primary
          ? `4px 4px 10px ${t.sDark}, -3px -3px 8px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.18)`
          : `4px 4px 10px ${t.sDark}, -3px -3px 8px ${t.sLight}`,
        transition: 'all .15s ease',
        fontFamily: 'inherit',
        ...style,
      }}
    >{children}</button>
  );
}

export function Icon({ name, size = 20, color = 'currentColor', stroke = 1.6 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'book':    return <svg {...p}><path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2V5z"/><path d="M4 17h15"/></svg>;
    case 'chat':    return <svg {...p}><path d="M21 12a8 8 0 1 1-3-6.2L21 5l-1 4a8 8 0 0 1 1 3z"/></svg>;
    case 'chart':   return <svg {...p}><path d="M4 19V5"/><path d="M9 19V9"/><path d="M14 19v-7"/><path d="M19 19V7"/></svg>;
    case 'lock':    return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>;
    case 'check':   return <svg {...p}><path d="M5 12.5l4 4L19 7"/></svg>;
    case 'arrow':   return <svg {...p}><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>;
    case 'back':    return <svg {...p}><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>;
    case 'play':    return <svg {...p}><path d="M7 5l12 7-12 7V5z"/></svg>;
    case 'bolt':    return <svg {...p}><path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"/></svg>;
    case 'auto':    return <svg {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'spark':   return <svg {...p}><path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M6 6l3 3"/><path d="M15 15l3 3"/><path d="M6 18l3-3"/><path d="M15 9l3-3"/></svg>;
    case 'user':    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>;
    case 'refresh': return <svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>;
    case 'heart':   return <svg {...p}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>;
    case 'flame':   return <svg {...p}><path d="M12 3c1 3 4 5 4 9a4 4 0 1 1-8 0c0-2 1-3 1-5 2 1 3 2 3-4z"/></svg>;
    case 'target':  return <svg {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>;
    case 'route':   return <svg {...p}><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 6h6a4 4 0 0 1 4 4v4M16 18h-6a4 4 0 0 1-4-4v-4"/></svg>;
    case 'sparkle': return <svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/></svg>;
    case 'close':   return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'dot':     return <svg {...p}><circle cx="12" cy="12" r="3" fill={color}/></svg>;
    default:        return null;
  }
}

export function PhoneStatusBar({ t, dark }) {
  const c = dark ? '#E8E6E1' : '#2A2620';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px 8px', fontFamily: '-apple-system, "SF Pro", system-ui', fontWeight: 600, fontSize: 15, color: c }}>
      <span>9:41</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="0.6" fill={c}/><rect x="4.5" y="5" width="3" height="6" rx="0.6" fill={c}/><rect x="9" y="2.5" width="3" height="8.5" rx="0.6" fill={c}/><rect x="13.5" y="0" width="3" height="11" rx="0.6" fill={c}/></svg>
        <svg width="22" height="11" viewBox="0 0 22 11"><rect x="0.5" y="0.5" width="19" height="10" rx="2.5" stroke={c} strokeOpacity="0.4" fill="none"/><rect x="2" y="2" width="14" height="7" rx="1.4" fill={c}/></svg>
      </span>
    </div>
  );
}

export function TopBar({ t, title, onBack, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px 14px' }}>
      {onBack && (
        <div onClick={onBack} style={{ ...neuRaised(t, 999), width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="back" size={18} color={t.text} />
        </div>
      )}
      <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: t.text, letterSpacing: '0.01em' }}>{title}</div>
      {right}
    </div>
  );
}
