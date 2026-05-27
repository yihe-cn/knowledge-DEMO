// Primitives.jsx — Card, PillButton, Icon, PhoneStatusBar, TopBar
import React from 'react';
import { neuRaised, neuInset } from '../theme.js';
import {
  ChevronLeft, BookOpen, BarChart2, Lock, Check, ChevronRight,
  Play, Zap, RefreshCw, Sparkles, User, RotateCcw, Heart,
  Flame, Target, Route, X, Dot, MessageCircle, AlertCircle,
} from 'lucide-react';

const ICON_MAP = {
  back:    ChevronLeft,
  book:    BookOpen,
  chart:   BarChart2,
  lock:    Lock,
  check:   Check,
  arrow:   ChevronRight,
  play:    Play,
  bolt:    Zap,
  auto:    RefreshCw,
  spark:   Sparkles,
  user:    User,
  refresh: RotateCcw,
  heart:   Heart,
  flame:   Flame,
  target:  Target,
  route:   Route,
  sparkle: Sparkles,
  close:   X,
  dot:     Dot,
  chat:    MessageCircle,
  alert:   AlertCircle,
};

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
  const LucideIcon = ICON_MAP[name];
  if (!LucideIcon) return null;
  return <LucideIcon size={size} color={color} strokeWidth={stroke} />;
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
