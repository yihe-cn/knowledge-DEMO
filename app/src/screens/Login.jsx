// Login.jsx — 演示用硬编码登录门：simugo / simugo123
import React, { useState } from 'react';
import { neuRaised, neuInset } from '../theme.js';
import { User, Lock, ArrowRight, Sparkles, Eye, EyeOff } from 'lucide-react';

const FIXED_USERNAME = 'simugo';
const FIXED_PASSWORD = 'simugo123';

export default function LoginScreen({ t, onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [focused, setFocused] = useState(null); // 'user' | 'pwd' | null
  const [loading, setLoading] = useState(false);

  const submit = () => {
    if (loading) return;
    if (username.trim() === FIXED_USERNAME && password === FIXED_PASSWORD) {
      setError('');
      setLoading(true);
      // 给一个轻微的过渡感，避免点完瞬间跳走显得突兀
      setTimeout(() => onLogin(), 280);
    } else {
      setError('账号或密码错误，请重试');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') submit();
  };

  // Field 容器：聚焦时变 inset + 描边高亮
  const fieldWrap = (key) => ({
    ...(focused === key ? neuInset(t, 16, 1) : neuRaised(t, 16, 0.7)),
    background: t.surface,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    transition: 'box-shadow .25s ease',
    border: `1px solid ${focused === key ? `${t.accent}55` : 'transparent'}`,
  });

  const inputStyle = {
    flex: 1,
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: t.text,
    fontSize: 15,
    fontFamily: 'inherit',
    letterSpacing: '0.01em',
    padding: '6px 0',
  };

  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: t.textSoft,
    letterSpacing: '0.14em',
    marginBottom: 8,
    display: 'block',
    textTransform: 'uppercase',
  };

  return (
    <div style={{
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 22px',
      background: t.bg,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 背景装饰：两个柔和的光晕 */}
      <div aria-hidden style={{
        position: 'absolute',
        top: '-12%', right: '-18%',
        width: 280, height: 280, borderRadius: '50%',
        background: `radial-gradient(circle, ${t.accent}33 0%, ${t.accent}00 70%)`,
        filter: 'blur(8px)',
        pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute',
        bottom: '-10%', left: '-20%',
        width: 320, height: 320, borderRadius: '50%',
        background: `radial-gradient(circle, ${t.accentSoft}2A 0%, ${t.accentSoft}00 70%)`,
        filter: 'blur(8px)',
        pointerEvents: 'none',
      }} />

      <div style={{
        ...neuRaised(t, 28, 1.6),
        background: t.surface,
        width: '100%',
        maxWidth: 380,
        padding: '36px 28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        position: 'relative',
        zIndex: 1,
      }}>
        {/* 品牌头部 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{
            ...neuRaised(t, 18, 1),
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
            color: '#fff',
          }}>
            <Sparkles size={26} strokeWidth={2} />
          </div>
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <div style={{
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '0.14em',
              color: t.text,
              lineHeight: 1.1,
            }}>SIMUGO</div>
            <div style={{
              marginTop: 8,
              fontSize: 12,
              color: t.textSoft,
              letterSpacing: '0.06em',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 18, height: 1, background: t.line }} />
              学 · 练 · 评 一体演示平台
              <span style={{ width: 18, height: 1, background: t.line }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 6 }}>
          <div>
            <label style={labelStyle}>账号</label>
            <div style={fieldWrap('user')}>
              <User size={18} color={focused === 'user' ? t.accent : t.textMute} strokeWidth={2} />
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); if (error) setError(''); }}
                onFocus={() => setFocused('user')}
                onBlur={() => setFocused(null)}
                onKeyDown={onKeyDown}
                placeholder="请输入账号"
                autoComplete="username"
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>密码</label>
            <div style={fieldWrap('pwd')}>
              <Lock size={18} color={focused === 'pwd' ? t.accent : t.textMute} strokeWidth={2} />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                onFocus={() => setFocused('pwd')}
                onBlur={() => setFocused(null)}
                onKeyDown={onKeyDown}
                placeholder="请输入密码"
                autoComplete="current-password"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                style={{
                  border: 0, background: 'transparent', cursor: 'pointer',
                  padding: 4, display: 'flex', alignItems: 'center',
                  color: t.textMute,
                }}
              >
                {showPwd ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
              </button>
            </div>
          </div>
        </div>

        {/* 错误提示：占位高度避免抖动 */}
        <div style={{
          minHeight: 18,
          fontSize: 12.5,
          color: t.bad,
          textAlign: 'center',
          letterSpacing: '0.02em',
          marginTop: -8,
          opacity: error ? 1 : 0,
          transition: 'opacity .2s ease',
        }}>
          {error || ' '}
        </div>

        {/* 登录按钮（自带渐变 + 箭头） */}
        <button
          onClick={submit}
          disabled={loading}
          style={{
            appearance: 'none', border: 0,
            cursor: loading ? 'wait' : 'pointer',
            width: '100%',
            padding: '15px 22px',
            borderRadius: 999,
            background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
            color: '#fff',
            fontSize: 15, fontWeight: 700,
            letterSpacing: '0.06em',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: `6px 6px 14px ${t.sDark}, -4px -4px 10px ${t.sLight}, inset 0 1px 0 rgba(255,255,255,0.22)`,
            transition: 'transform .15s ease, box-shadow .15s ease, opacity .2s ease',
            opacity: loading ? 0.85 : 1,
            fontFamily: 'inherit',
            marginTop: -4,
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          <span>{loading ? '登录中…' : '登 录'}</span>
          {!loading && <ArrowRight size={18} strokeWidth={2.4} />}
        </button>

        <div style={{
          marginTop: 6,
          fontSize: 11.5,
          color: t.textMute,
          textAlign: 'center',
          letterSpacing: '0.04em',
        }}>
          演示账号 · 仅限内部体验使用
        </div>
      </div>

      <div style={{
        marginTop: 22,
        fontSize: 11,
        color: t.textMute,
        letterSpacing: '0.08em',
        position: 'relative',
        zIndex: 1,
      }}>
        © SIMUGO · Powered by Agentic RAG
      </div>
    </div>
  );
}
