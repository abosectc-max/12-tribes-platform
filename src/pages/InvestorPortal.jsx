import { useState, useEffect, useMemo, useCallback } from "react";
import * as recharts from "recharts";
import { useResponsive } from '../hooks/useResponsive';
import {
  registerUser, registerPasskey, authenticateWithPasskey, loginWithEmail,
  isPasskeySupported, getUserByEmail, setSession, getSession, logout as authLogout,
  changePassword, getVerificationCode, verifyEmail, isEmailVerified, resendVerificationCode,
  generate2FASecret, verify2FASetup, verify2FACode, is2FAEnabled, disable2FA,
  requestPasswordReset, resetPassword, getPasskeyStatus, removePasskey,
} from '../store/authStore.js';
import { createWallet, ensureWallet, getWallet, getPositions, getTradeHistory, tickPrices, getMarketPrices, syncFromServer } from '../store/walletStore.js';
import { recordSnapshot, getPerformanceMetrics, getEquityHistoryByPeriod, getPositionPerformance } from '../store/performanceTracker.js';
import {
  initFundManager, getFundSettings, updateFundSettings,
  startAutoTrading, stopAutoTrading, getAutoTradingStatus,
  simulateAgentTrade, getWithdrawalHistory, getCompoundProjection,
} from '../store/fundManager.js';
import BrandLogo from '../components/BrandLogo.jsx';
import { haptics } from '../hooks/useHaptics.js';
import { isPushSupported, getPermissionState, requestPermission, notifications as pushNotify } from '../hooks/useNotifications.js';
import { generateMonthlyStatement, openPrintView } from '../store/pdfGenerator.js';
import { getTheme, getThemePreference, setTheme, getAvailableThemes, applyTheme } from '../store/themeService.js';

const {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — INVESTOR PORTAL v2.0
//   Passkey Auth | Left Sidebar | Onboarding
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

// === APPLE LIQUID GLASS — TRUE TRANSPARENT ===
// Shadows are calibrated for dark backgrounds — rgba(0,0,0,0.06) is invisible on dark.
const glass = {
  background: "rgba(255,255,255,0.055)",
  backdropFilter: "blur(40px) saturate(200%)",
  WebkitBackdropFilter: "blur(40px) saturate(200%)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "24px",
  boxShadow: "0 4px 24px rgba(0,0,0,0.32), 0 1px 4px rgba(0,0,0,0.20), inset 0 0.5px 0 rgba(255,255,255,0.10), inset 0 -0.5px 0 rgba(0,0,0,0.10)",
};

// === SLATE GRAY — Headers & Footer ===
// Matches iOS Settings / Apple Slate aesthetic
const slateGlass = {
  background: "rgba(51, 65, 85, 0.72)",
  backdropFilter: "blur(40px) saturate(160%)",
  WebkitBackdropFilter: "blur(40px) saturate(160%)",
  border: "1px solid rgba(100, 116, 139, 0.22)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.14), inset 0 0.5px 0 rgba(148,163,184,0.15)",
};

const inputStyle = {
  width: "100%", padding: "14px 18px", borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 15,
  outline: "none", transition: "all 0.2s", boxSizing: "border-box",
  fontFamily: "inherit",
};

const focusGlow = "0 0 0 3px rgba(0,212,255,0.15)";

// Haptics imported from shared module: ../hooks/useHaptics.js

// ═══════ REFRESH BUTTON COMPONENT ═══════
function RefreshButton({ onRefresh, label = "Refresh", style = {} }) {
  const [spinning, setSpinning] = useState(false);
  const handleClick = async () => {
    haptics.refresh();
    setSpinning(true);
    try { await Promise.resolve(onRefresh()); } catch {}
    setTimeout(() => setSpinning(false), 600);
  };
  return (
    <button onClick={handleClick} disabled={spinning} style={{
      padding: '8px 18px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
      background: spinning ? 'rgba(0,212,255,0.08)' : 'transparent',
      color: spinning ? '#00D4FF' : 'rgba(255,255,255,0.5)',
      fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
      transition: 'all 0.2s', fontWeight: 500, ...style,
    }}>
      <span style={{
        display: 'inline-block',
        transition: 'transform 0.6s ease',
        transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)',
        fontSize: 14,
      }}>↻</span>
      {label}
    </button>
  );
}

// Safe area helper — adds iOS notch/status bar padding in PWA standalone mode
const safeAreaTop = "env(safe-area-inset-top, 0px)";
const safeAreaBottom = "env(safe-area-inset-bottom, 0px)";

// === TERMS ACCEPTANCE UTILITIES ===
const TERMS_STORAGE_KEY = '12tribes_terms_accepted';
function checkTermsAccepted(userId) {
  try {
    const data = JSON.parse(localStorage.getItem(TERMS_STORAGE_KEY) || '{}');
    return !!data[userId];
  } catch { return false; }
}
function recordTermsAcceptance(userId) {
  try {
    const data = JSON.parse(localStorage.getItem(TERMS_STORAGE_KEY) || '{}');
    data[userId] = { accepted: true, timestamp: new Date().toISOString() };
    localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

// === DATA GENERATORS ===
function generatePortfolioHistory(initial, days) {
  const data = [];
  let value = initial;
  const startDate = new Date(2026, 0, 5);
  for (let d = 0; d <= days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    if (d > 0) { const r = (Math.random() - 0.38) * 0.03; value *= (1 + r); }
    if (d % 3 === 0 || d === days) {
      data.push({
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: Math.round(value),
      });
    }
  }
  return data;
}

/**
 * Build real activity feed from live trade data + wallet events.
 * Combines: open positions (BUY/SELL entries), closed trades (realized P&L),
 * and the initial deposit. No fake data.
 */
function buildActivityFromTrades(positions, tradeHistory, wallet) {
  const txns = [];

  // Initial deposit
  if (wallet) {
    const depositDate = wallet.depositTimestamp || wallet.createdAt;
    txns.push({
      id: 'TXN_DEPOSIT',
      date: depositDate ? new Date(depositDate).toLocaleDateString() : new Date().toLocaleDateString(),
      type: 'Deposit',
      amount: (wallet.initialBalance || wallet.depositAmount || 100000).toFixed(2),
      description: 'Initial capital contribution',
      sortTime: depositDate ? new Date(depositDate).getTime() : 0,
    });
  }

  // Open positions → "Entry" transactions
  if (Array.isArray(positions)) {
    positions.forEach((p, i) => {
      const cost = (p.entryPrice || 0) * (p.quantity || 0);
      txns.push({
        id: p.id || `TXN_OPEN_${i}`,
        date: p.openTimestamp ? new Date(p.openTimestamp).toLocaleDateString() : new Date(p.openTime || Date.now()).toLocaleDateString(),
        type: p.side === 'LONG' ? 'Buy' : 'Sell',
        amount: (p.side === 'LONG' ? -cost : -(cost * 0.5)).toFixed(2),
        description: `${p.side} ${p.quantity}x ${p.symbol} @ $${(p.entryPrice || 0).toFixed(2)}${p.agent ? ` (${p.agent})` : ''}`,
        sortTime: p.openTime || new Date(p.openTimestamp || 0).getTime(),
      });
    });
  }

  // Closed trades → "Close" transactions with realized P&L
  if (Array.isArray(tradeHistory)) {
    tradeHistory.forEach((t, i) => {
      const pnl = t.realizedPnL || 0;
      txns.push({
        id: t.id || `TXN_CLOSE_${i}`,
        date: t.closeTimestamp ? new Date(t.closeTimestamp).toLocaleDateString() : new Date(t.closeTime || Date.now()).toLocaleDateString(),
        type: pnl >= 0 ? 'Profit' : 'Loss',
        amount: pnl.toFixed(2),
        description: `Closed ${t.side} ${t.quantity}x ${t.symbol} @ $${(t.closePrice || 0).toFixed(2)}${t.agent ? ` (${t.agent})` : ''} — ${(t.returnPct || 0).toFixed(1)}%`,
        sortTime: t.closeTime || new Date(t.closeTimestamp || 0).getTime(),
      });
    });
  }

  // Sort newest first
  txns.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
  return txns;
}

// Monthly statements now fetched from /api/statements — see StatementsView component


// ════════════════════════════════════════
//   AUTH SCREEN — Login / Register / Passkey
// ════════════════════════════════════════

function AuthScreen({ onAuth }) {
  // Support ?mode=register in the URL so approval email CTA lands directly on the register form
  const initialMode = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('mode');
      return ['register', 'request-access'].includes(p) ? p : 'login';
    } catch { return 'login'; }
  })();
  const [mode, setMode] = useState(initialMode); // "login" | "register" | "request-access"
  const { isMobile } = useResponsive();

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
      padding: `calc(16px + ${safeAreaTop}) 16px calc(16px + ${safeAreaBottom}) 16px`,
    }}>
      <div style={{ position: "fixed", top: -300, right: -200, width: 800, height: 800, background: "radial-gradient(circle, rgba(0,212,255,0.1) 0%, transparent 60%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, left: -100, width: 600, height: 600, background: "radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 60%)", pointerEvents: "none" }} />

      {mode === "login" && <LoginForm onAuth={onAuth} onSwitch={setMode} isMobile={isMobile} />}
      {mode === "register" && <RegisterForm onAuth={onAuth} onSwitch={setMode} isMobile={isMobile} />}
      {mode === "request-access" && <RequestAccessForm onSwitch={setMode} isMobile={isMobile} />}
    </div>
  );
}

// ═══════ REQUEST ACCESS FORM ═══════
function RequestAccessForm({ onSwitch, isMobile }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `http://${hostname}:4000/api`;
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError("First name, last name, and email are required.");
      return;
    }
    if (!email.includes("@") || !email.includes(".")) {
      setError("Enter a valid email address.");
      return;
    }
    setError(""); setLoading(true); setSuccess("");
    try {
      const resp = await fetch(`${API_BASE}/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), message: message.trim() }),
      });
      const data = await resp.json();
      if (data.status === 'approved') {
        setSuccess("You have already been approved! You may create an account.");
      } else if (data.status === 'pending') {
        setSuccess(data.message || "Your request has been submitted. You will be notified when approved.");
      } else if (data.status === 'denied') {
        setError(data.message || "Your previous request was not approved.");
      } else if (data.error) {
        setError(data.error);
      } else {
        setSuccess("Your request has been submitted. You will be notified when approved.");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ ...glass, padding: isMobile ? 28 : 44, width: isMobile ? "100%" : 480, maxWidth: "100%", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <BrandLogo size={isMobile ? "md" : "lg"} />
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 8 }}>Request Access to the Investment Platform</p>
      </div>

      {success ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{success.includes('approved') ? '✓' : '◇'}</div>
          <div style={{ color: success.includes('approved') ? '#10B981' : '#00D4FF', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{success}</div>
          {success.includes('approved') && (
            <button onClick={() => onSwitch("register")} style={{
              width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, marginTop: 16,
              background: "linear-gradient(135deg, #10B981, #00D4FF)", color: "#fff",
            }}>Create Your Account</button>
          )}
          <button onClick={() => onSwitch("login")} style={{
            background: "none", border: "none", color: "#00D4FF", cursor: "pointer", fontSize: 13, marginTop: 16, fontWeight: 500,
          }}>Back to Sign In</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name" style={{ ...inputStyle, flex: 1 }}
              onFocus={e => e.target.style.boxShadow = focusGlow} onBlur={e => e.target.style.boxShadow = "none"} />
            <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name" style={{ ...inputStyle, flex: 1 }}
              onFocus={e => e.target.style.boxShadow = focusGlow} onBlur={e => e.target.style.boxShadow = "none"} />
          </div>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email Address" type="email" style={{ ...inputStyle, marginBottom: 14 }}
            onFocus={e => e.target.style.boxShadow = focusGlow} onBlur={e => e.target.style.boxShadow = "none"} />
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Why do you want to join? (optional)" rows={3}
            style={{ ...inputStyle, marginBottom: 14, resize: "vertical", minHeight: 60 }}
            onFocus={e => e.target.style.boxShadow = focusGlow} onBlur={e => e.target.style.boxShadow = "none"} />

          {error && <div style={{ color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{error}</div>}

          <button type="submit" disabled={loading} style={{
            width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: loading ? "wait" : "pointer", fontSize: 15, fontWeight: 700,
            background: loading ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff", transition: "all 0.2s",
          }}>{loading ? "Submitting..." : "Request Access"}</button>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Already approved? </span>
            <button type="button" onClick={() => onSwitch("register")} style={{ background: "none", border: "none", color: "#00D4FF", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              Create Account
            </button>
            <span style={{ color: "rgba(255,255,255,0.15)", margin: "0 8px" }}>|</span>
            <button type="button" onClick={() => onSwitch("login")} style={{ background: "none", border: "none", color: "#00D4FF", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              Sign In
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ═══════ LOGIN FORM ═══════
function LoginForm({ onAuth, onSwitch, isMobile }) {
  const savedEmail = (() => { try { return localStorage.getItem('12tribes_remembered_email') || ''; } catch { return ''; } })();
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(!!savedEmail);
  const [error, setError] = useState("");
  const [resetMode, setResetMode] = useState(false); // forgot password flow
  const [resetStep, setResetStep] = useState(1); // 1: enter email, 2: enter code + new password
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    if (!email.includes("@")) { haptics.error(); setError("Enter your email first"); return; }
    haptics.medium();
    setLoading(true); setError("");
    const result = await authenticateWithPasskey(email);
    setLoading(false);
    if (result.success) {
      onAuth(result.user);
    } else {
      setError(result.error);
    }
  };

  const handleEmailLogin = async () => {
    setError("");
    if (!email.includes("@")) { haptics.error(); setError("Enter a valid email address"); return; }
    if (!password) { haptics.error(); setError("Enter your password"); return; }
    haptics.medium();
    setLoading(true);
    try {
      const result = await loginWithEmail(email, password);
      setLoading(false);
      if (result.success) {
        haptics.success();
        // Remember Me: save or clear email for next visit
        try {
          if (rememberMe) {
            localStorage.setItem('12tribes_remembered_email', email.toLowerCase().trim());
          } else {
            localStorage.removeItem('12tribes_remembered_email');
          }
        } catch {}
        onAuth(result.user);
      } else {
        haptics.error();
        setError(result.error || 'Login failed. Please try again.');
      }
    } catch (err) {
      setLoading(false);
      haptics.error();
      setError('Connection error. Please try again.');
      console.error('[Login] Unhandled error:', err);
    }
  };

  const handleRequestReset = async () => {
    setError(""); setResetMessage("");
    if (!email.includes("@")) { setError("Enter your email address first"); return; }
    setLoading(true);
    try {
      const result = await requestPasswordReset(email);
      setLoading(false);
      if (result.success) {
        setResetMessage("Reset code generated. Check the server console for the code.");
        setResetStep(2);
      } else {
        setError(result.error);
      }
    } catch {
      setLoading(false);
      setError("Unable to process reset request.");
    }
  };

  const handleResetPassword = async () => {
    setError(""); setResetMessage("");
    if (!resetCode || resetCode.length !== 6) { setError("Enter the 6-digit reset code"); return; }
    if (!newPassword || newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const result = await resetPassword(email, resetCode, newPassword);
      setLoading(false);
      if (result.success) {
        setResetMessage("Password reset! You can now sign in.");
        setTimeout(() => {
          setResetMode(false); setResetStep(1);
          setResetCode(""); setNewPassword(""); setConfirmPassword("");
          setResetMessage(""); setError("");
        }, 2000);
      } else {
        setError(result.error);
      }
    } catch {
      setLoading(false);
      setError("Unable to reset password.");
    }
  };

  const supportsPasskey = isPasskeySupported();
  const user = email.includes("@") ? getUserByEmail(email) : null;
  const hasPasskey = user?.hasPasskey;

  return (
    <div style={{ ...glass, padding: isMobile ? 32 : 48, width: isMobile ? "100%" : 440, maxWidth: 440, textAlign: "center" }}>
      {/* Logo */}
      <div style={{ margin: "0 auto 24px" }}><BrandLogo size={64} /></div>

      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: "0 0 4px", letterSpacing: 1 }}>12 TRIBES</h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 32px", letterSpacing: 2, textTransform: "uppercase" }}>Investor Portal</p>

      {!resetMode ? (
        <>
          <form onSubmit={e => { e.preventDefault(); handleEmailLogin(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="email" placeholder="Email address" value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              style={inputStyle}
            />
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
            />

            {/* Remember Me + Forgot Password Row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: -6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <div
                  onClick={() => setRememberMe(!rememberMe)}
                  style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    border: rememberMe ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.15)",
                    background: rememberMe ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.04)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                >
                  {rememberMe && <span style={{ fontSize: 12, color: "#00D4FF", lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", userSelect: "none" }}>Remember me</span>
              </label>
              <span onClick={() => { setResetMode(true); setResetStep(1); setError(""); setResetMessage(""); }}
                style={{ fontSize: 12, color: "#00D4FF", cursor: "pointer", opacity: 0.8 }}>
                Forgot password?
              </span>
            </div>

            {/* Sign In Button */}
            <button type="submit" disabled={loading}
              style={{
                width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                background: loading ? "rgba(255,255,255,0.15)" : "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
                fontSize: 15, fontWeight: 600, letterSpacing: 0.5,
                boxShadow: loading ? "none" : "0 4px 16px rgba(0,212,255,0.3)",
                opacity: 1, transition: "all 0.2s",
                WebkitAppearance: "none", WebkitTapHighlightColor: "transparent",
              }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            {error && (
              <div style={{
                fontSize: 14, color: "#fff", textAlign: "center", padding: "12px 16px",
                background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: 12,
              }}>{error}</div>
            )}

            {/* Passkey Button */}
            {supportsPasskey && (
              <button type="button" onClick={handlePasskeyLogin} disabled={loading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 16, cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.04)", color: "#fff",
                  fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 10,
                  opacity: loading ? 0.6 : 1, transition: "all 0.2s",
                  WebkitAppearance: "none", WebkitTapHighlightColor: "transparent",
                }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {hasPasskey ? 'Sign in with Passkey' : 'Sign in with Passkey'}
              </button>
            )}
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0" }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>New to 12 Tribes?</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
            </div>

            {/* Create Account Button */}
            <button type="button" onClick={() => onSwitch("register")}
              style={{
                width: "100%", padding: "14px", borderRadius: 16, cursor: "pointer",
                border: "1px solid rgba(0,212,255,0.3)",
                background: "rgba(0,212,255,0.06)", color: "#00D4FF",
                fontSize: 14, fontWeight: 600, transition: "all 0.2s",
              }}>
              Create Account
            </button>

            {/* Request Access Button */}
            <button type="button" onClick={() => onSwitch("request-access")}
              style={{
                width: "100%", padding: "12px", borderRadius: 16, cursor: "pointer",
                border: "1px solid rgba(168,85,247,0.25)",
                background: "rgba(168,85,247,0.06)", color: "#A855F7",
                fontSize: 13, fontWeight: 500, transition: "all 0.2s",
              }}>
              Request Access
            </button>
          </div>
        </>
      ) : (
        /* ─── FORGOT PASSWORD FLOW ─── */
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", margin: "0 0 4px" }}>
            {resetStep === 1 ? "Enter your email to receive a reset code." : "Enter the reset code and your new password."}
          </p>

          {resetStep === 1 && (
            <>
              <input type="email" placeholder="Email address" value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                style={inputStyle}
              />
              <button type="button" onClick={handleRequestReset} disabled={loading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                  background: loading ? "rgba(255,255,255,0.15)" : "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
                  fontSize: 15, fontWeight: 600, WebkitAppearance: "none", WebkitTapHighlightColor: "transparent",
                }}>
                {loading ? 'Sending...' : 'Send Reset Code'}
              </button>
            </>
          )}

          {resetStep === 2 && (
            <>
              <input type="text" placeholder="6-digit reset code" value={resetCode} maxLength={6}
                onChange={e => { setResetCode(e.target.value.replace(/\D/g, '')); setError(""); }}
                style={{ ...inputStyle, textAlign: "center", letterSpacing: 8, fontSize: 20 }}
              />
              <input type="password" placeholder="New password" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                style={inputStyle}
              />
              <input type="password" placeholder="Confirm new password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
              <button type="button" onClick={handleResetPassword} disabled={loading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                  background: loading ? "rgba(255,255,255,0.15)" : "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
                  fontSize: 15, fontWeight: 600, WebkitAppearance: "none", WebkitTapHighlightColor: "transparent",
                }}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </>
          )}

          {error && (
            <div style={{
              fontSize: 14, color: "#fff", textAlign: "center", padding: "12px 16px",
              background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 12,
            }}>{error}</div>
          )}

          {resetMessage && (
            <div style={{
              fontSize: 14, color: "#fff", textAlign: "center", padding: "12px 16px",
              background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)",
              borderRadius: 12,
            }}>{resetMessage}</div>
          )}

          {/* Back to Login */}
          <span onClick={() => { setResetMode(false); setError(""); setResetMessage(""); }}
            style={{ fontSize: 13, color: "#00D4FF", cursor: "pointer", textAlign: "center", marginTop: 4 }}>
            ← Back to Sign In
          </span>
        </div>
      )}

      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 24 }}>
        12 Tribes Investments | Secured with Passkeys
      </p>
    </div>
  );
}


// ═══════ REGISTRATION FORM (Multi-Step Onboarding) ═══════
function RegisterForm({ onAuth, onSwitch, isMobile }) {
  const [step, setStep] = useState(1); // 1: info, 2: passkey setup, 3: welcome
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registeredUser, setRegisteredUser] = useState(null);
  const [passkeyStatus, setPasskeyStatus] = useState("pending");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false); // pending | success | skipped | error

  const formatPhone = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const validateStep1 = () => {
    if (!firstName.trim()) return "First name is required";
    if (!lastName.trim()) return "Last name is required";
    if (!email.includes("@") || !email.includes(".")) return "Enter a valid email address";
    if (phone.replace(/\D/g, '').length < 10) return "Enter a valid 10-digit phone number";
    if (password.length < 12) return "Password must be at least 12 characters";
    if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
    if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
    if (!/[0-9]/.test(password)) return "Password must contain at least one number";
    if (!tosAccepted) return "You must accept the Terms of Service";
    if (!privacyConsent) return "You must consent to the Privacy Policy";
    return null;
  };

  const [verificationCode, setVerificationCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState("");

  const handleRegister = async () => {
    const err = validateStep1();
    if (err) { setError(err); return; }
    setError(""); setLoading(true);

    const result = await registerUser({ firstName, lastName, email, phone: formatPhone(phone), password, tosAccepted, privacyConsent });
    setLoading(false);
    if (!result.success) { setError(result.error); return; }

    setRegisteredUser(result.user);
    if (result.verificationCode) setVerificationCode(result.verificationCode);
    setStep(2); // Move to email verification
  };

  const handleVerifyEmail = () => {
    setVerifyError("");
    const result = verifyEmail(email, verifyCode);
    if (result.success) {
      // Move to passkey setup or welcome
      if (!isPasskeySupported()) {
        setPasskeyStatus("skipped");
        setStep(4);
      } else {
        setStep(3); // Passkey setup
      }
    } else {
      setVerifyError(result.error);
    }
  };

  const handleResendCode = () => {
    const result = resendVerificationCode(email);
    if (result.success) {
      setVerificationCode(result.code);
      setVerifyError("New code sent!");
    }
  };

  const handleSetupPasskey = async () => {
    setLoading(true); setError("");
    const result = await registerPasskey(email);
    setLoading(false);
    if (result.success) {
      setPasskeyStatus("success");
      setTimeout(() => setStep(4), 1200);
    } else {
      setError(result.error);
      setPasskeyStatus("error");
    }
  };

  const handleSkipPasskey = () => {
    setPasskeyStatus("skipped");
    setStep(4);
  };

  const handleEnterPortal = () => {
    setSession(registeredUser);
    // Create $100K virtual wallet for new investor
    createWallet(registeredUser);
    onAuth({ ...registeredUser, isNewUser: true });
  };

  const supportsPasskey = isPasskeySupported();

  return (
    <div style={{
      ...glass, padding: isMobile ? 28 : 44, width: isMobile ? "100%" : 480,
      maxWidth: 480, textAlign: "center",
    }}>
      {/* Progress Dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 28 }}>
        {[1, 2, 3, 4].map(s => (
          <div key={s} style={{
            width: step >= s ? 28 : 10, height: 10, borderRadius: 5,
            background: step >= s ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "rgba(255,255,255,0.1)",
            transition: "all 0.4s",
          }} />
        ))}
      </div>

      {/* ═══ STEP 1: Personal Information ═══ */}
      {step === 1 && (
        <>
          <div style={{
            width: 56, height: 56, borderRadius: 18, margin: "0 auto 20px",
            background: "linear-gradient(135deg, #00D4FF, #A855F7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, color: "#fff",
          }}>✦</div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 6px" }}>Create Your Account</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 28px" }}>
            Join the 12 Tribes investment collective
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
            {/* Name Row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>First Name</label>
                <input type="text" placeholder="John" value={firstName}
                  onChange={e => { setFirstName(e.target.value); setError(""); }}
                  style={inputStyle} autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Last Name</label>
                <input type="text" placeholder="Doe" value={lastName}
                  onChange={e => { setLastName(e.target.value); setError(""); }}
                  style={inputStyle} />
              </div>
            </div>

            {/* Email */}
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Email Address</label>
              <input type="email" placeholder="john@example.com" value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                style={inputStyle} />
            </div>

            {/* Phone */}
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Phone Number</label>
              <input type="tel" placeholder="(555) 123-4567" value={phone}
                onChange={e => { setPhone(formatPhone(e.target.value)); setError(""); }}
                style={inputStyle} />
            </div>

            {/* Password */}
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Password</label>
              <input type="password" placeholder="Min 12 chars — uppercase, lowercase, number" value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleRegister()}
                style={inputStyle} />
            </div>

            {/* Consent Checkboxes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <div onClick={() => setTosAccepted(!tosAccepted)} style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                  border: tosAccepted ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.15)",
                  background: tosAccepted ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.04)",
                  display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
                }}>
                  {tosAccepted && <span style={{ fontSize: 13, color: "#00D4FF", lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>
                  I accept the <a href="/terms" target="_blank" style={{ color: "#00D4FF", textDecoration: "none" }}>Terms of Service</a> and acknowledge the risk disclosures
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <div onClick={() => setPrivacyConsent(!privacyConsent)} style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                  border: privacyConsent ? "1px solid rgba(168,85,247,0.5)" : "1px solid rgba(255,255,255,0.15)",
                  background: privacyConsent ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.04)",
                  display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
                }}>
                  {privacyConsent && <span style={{ fontSize: 13, color: "#A855F7", lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>
                  I consent to the <a href="/terms" target="_blank" style={{ color: "#A855F7", textDecoration: "none" }}>Privacy Policy</a> and data processing practices
                </span>
              </label>
            </div>

            {error && <div style={{ fontSize: 12, color: "#EF4444", padding: "0 4px" }}>{error}</div>}

            <button onClick={handleRegister} disabled={!tosAccepted || !privacyConsent}
              style={{
                width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                background: tosAccepted && privacyConsent ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "rgba(255,255,255,0.08)",
                color: tosAccepted && privacyConsent ? "#fff" : "rgba(255,255,255,0.3)",
                fontSize: 15, fontWeight: 600,
                boxShadow: tosAccepted && privacyConsent ? "0 4px 16px rgba(0,212,255,0.3)" : "none",
                marginTop: 4, transition: "all 0.2s",
              }}>
              Continue
            </button>
          </div>

          <button onClick={() => onSwitch("login")}
            style={{
              marginTop: 20, background: "none", border: "none", cursor: "pointer",
              fontSize: 13, color: "rgba(255,255,255,0.4)",
            }}>
            Already have an account? <span style={{ color: "#00D4FF", fontWeight: 600 }}>Sign In</span>
          </button>
          <button type="button" onClick={() => onSwitch("request-access")} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4,
            }}>
            Need access? <span style={{ color: "#A855F7", fontWeight: 500 }}>Request Access</span>
          </button>
        </>
      )}

      {/* ═══ STEP 2: Email Verification ═══ */}
      {step === 2 && (
        <>
          <div style={{
            width: 72, height: 72, borderRadius: 22, margin: "0 auto 24px",
            background: "linear-gradient(135deg, #00D4FF, #10B981)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, color: "#fff",
            boxShadow: "0 4px 24px rgba(0,212,255,0.3)",
          }}>✉</div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>Verify Your Email</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>
            We sent a 6-digit verification code to <strong style={{ color: "#00D4FF" }}>{email}</strong>
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: "0 0 24px" }}>
            (For this demo, your code is: <span style={{ color: "#10B981", fontWeight: 700, letterSpacing: 2, fontSize: 16 }}>{verificationCode}</span>)
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 320, margin: "0 auto" }}>
            <input type="text" placeholder="Enter 6-digit code" value={verifyCode}
              onChange={e => { setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setVerifyError(""); }}
              onKeyDown={e => e.key === "Enter" && verifyCode.length === 6 && handleVerifyEmail()}
              style={{ ...inputStyle, textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: 700 }}
              maxLength={6} autoFocus />

            {verifyError && (
              <div style={{ fontSize: 12, color: verifyError === "New code sent!" ? "#10B981" : "#EF4444", textAlign: "center" }}>{verifyError}</div>
            )}

            <button onClick={handleVerifyEmail} disabled={verifyCode.length !== 6}
              style={{
                width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                background: verifyCode.length === 6 ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "rgba(255,255,255,0.06)",
                color: verifyCode.length === 6 ? "#fff" : "rgba(255,255,255,0.3)",
                fontSize: 15, fontWeight: 600,
                boxShadow: verifyCode.length === 6 ? "0 4px 16px rgba(0,212,255,0.3)" : "none",
              }}>
              Verify Email
            </button>

            <button onClick={handleResendCode}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: "rgba(255,255,255,0.4)", padding: "8px",
              }}>
              Didn't receive it? <span style={{ color: "#00D4FF", fontWeight: 600 }}>Resend Code</span>
            </button>
          </div>
        </>
      )}

      {/* ═══ STEP 3: Passkey Setup ═══ */}
      {step === 3 && (
        <>
          <div style={{
            width: 72, height: 72, borderRadius: 22, margin: "0 auto 24px",
            background: passkeyStatus === "success"
              ? "linear-gradient(135deg, #10B981, #00D4FF)"
              : "linear-gradient(135deg, #A855F7, #00D4FF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: passkeyStatus === "success" ? 32 : 28, color: "#fff",
            transition: "all 0.4s",
            boxShadow: "0 4px 24px rgba(0,212,255,0.3)",
          }}>
            {passkeyStatus === "success" ? "✓" : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </div>

          {passkeyStatus === "success" ? (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "#10B981", margin: "0 0 8px" }}>Passkey Created</h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>
                You can now sign in instantly with Face ID, Touch ID, or your device PIN.
              </p>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>Set Up Passkey</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>
                Hi {firstName}! Secure your account with a passkey.
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 28px", lineHeight: 1.6 }}>
                Passkeys use your device's biometrics (Face ID, Touch ID, or PIN) for fast, phishing-resistant authentication. No passwords to remember.
              </p>

              {/* Benefits */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 28 }}>
                {[
                  { icon: "🔐", label: "Phishing Proof" },
                  { icon: "⚡", label: "Instant Login" },
                  { icon: "🧬", label: "Biometric" },
                ].map(b => (
                  <div key={b.label} style={{
                    padding: "14px 8px", borderRadius: 14, textAlign: "center",
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                  }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{b.icon}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>{b.label}</div>
                  </div>
                ))}
              </div>

              {error && <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 12 }}>{error}</div>}

              {supportsPasskey ? (
                <button onClick={handleSetupPasskey} disabled={loading}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
                    fontSize: 15, fontWeight: 600, marginBottom: 12,
                    boxShadow: "0 4px 16px rgba(0,212,255,0.3)",
                    opacity: loading ? 0.6 : 1,
                  }}>
                  {loading ? "Setting up..." : "Create Passkey"}
                </button>
              ) : (
                <div style={{
                  padding: 16, borderRadius: 14, marginBottom: 12,
                  background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)",
                  fontSize: 13, color: "#F59E0B", lineHeight: 1.5,
                }}>
                  Passkeys aren't supported on this browser. You can still use email/password to sign in.
                </div>
              )}

              <button onClick={handleSkipPasskey}
                style={{
                  width: "100%", padding: "12px", borderRadius: 16, cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent", color: "rgba(255,255,255,0.4)",
                  fontSize: 13, fontWeight: 500,
                }}>
                Skip for now
              </button>
            </>
          )}
        </>
      )}

      {/* ═══ STEP 4: Welcome ═══ */}
      {step === 4 && (
        <>
          <div style={{ margin: "0 auto 24px" }}><BrandLogo size={80} /></div>

          <h2 style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>
            Welcome, {firstName}!
          </h2>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", margin: "0 0 32px", lineHeight: 1.6 }}>
            Your account is ready. You're now part of the 12 Tribes investment collective. Let's explore your portfolio.
          </p>

          {/* Summary Card */}
          <div style={{
            ...glass, padding: 20, borderRadius: 18, marginBottom: 28, textAlign: "left",
            background: "rgba(255,255,255,0.03)",
          }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Account Summary</div>
            {[
              { label: "Name", value: `${firstName} ${lastName}` },
              { label: "Email", value: email },
              { label: "Phone", value: phone },
              { label: "Passkey", value: passkeyStatus === "success" ? "Enabled" : "Not set up" },
              { label: "Virtual Wallet Deposit", value: "$100,000" },
            ].map(r => (
              <div key={r.label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{r.label}</span>
                <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{r.value}</span>
              </div>
            ))}
          </div>

          <button onClick={handleEnterPortal}
            style={{
              width: "100%", padding: "16px", borderRadius: 16, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
              fontSize: 16, fontWeight: 700, letterSpacing: 0.5,
              boxShadow: "0 4px 20px rgba(0,212,255,0.3)",
            }}>
            Enter My Portal →
          </button>
        </>
      )}
    </div>
  );
}


// ════════════════════════════════════════
//   ONBOARDING TUTORIAL (6-step walkthrough)
// ════════════════════════════════════════

const ONBOARDING_STEPS = [
  { id: "welcome", icon: "✦", grad: "linear-gradient(135deg, #00D4FF, #A855F7)", title: "Welcome to 12 Tribes", sub: "Your AI-Powered Investment Platform",
    text: ["You've joined an exclusive 12-investor collective managing a shared capital pool with institutional-grade AI.", "This quick tour walks you through your portfolio, our AI agents, paper trading, and how your money is protected."] },
  { id: "portfolio", icon: "◉", grad: "linear-gradient(135deg, #00D4FF, #10B981)", title: "Your Portfolio", sub: "Track Your Investment in Real Time",
    text: ["Your $100,000 virtual wallet is deployed across 5 asset classes: Stocks, Crypto, Forex, Options, and Futures, with a cash buffer.", "Every dollar is tracked live — equity value, daily P&L, total return, and allocation breakdown."],
    cards: [{ l: "Virtual Balance", v: "$100K", c: "#00D4FF" }, { l: "Asset Classes", v: "5 Active", c: "#A855F7" }, { l: "AI Agents", v: "6 Active", c: "#10B981" }, { l: "Live Data", v: "Real-Time", c: "#F59E0B" }] },
  { id: "agents", icon: "◆", grad: "linear-gradient(135deg, #A855F7, #FF6B6B)", title: "Your AI Agents", sub: "6 Specialists Working 24/7",
    text: ["Your investment is managed by 6 purpose-built AI agents, each a specialist — from momentum detection to risk management.", "They operate autonomously, cross-validate signals, and adapt to market conditions in real time."],
    agents: [
      { n: "Viper", r: "Momentum", i: "⚡", c: "#00E676" }, { n: "Oracle", r: "Macro Intel", i: "🔮", c: "#A855F7" },
      { n: "Spectre", r: "Options", i: "👻", c: "#FF6B6B" }, { n: "Sentinel", r: "Risk Guard", i: "🛡️", c: "#00D4FF" },
      { n: "Phoenix", r: "Self-Heal", i: "🔥", c: "#FFD93D" }, { n: "Titan", r: "Sizing", i: "🏛️", c: "#FF8A65" }] },
  { id: "paper", icon: "⬢", grad: "linear-gradient(135deg, #FFD93D, #FF8A65)", title: "Paper Trading", sub: "$100K Virtual Currency for Testing",
    text: ["Every strategy is battle-tested with $100K in virtual currency using real market data before real capital is deployed.", "Paper trades mirror real conditions — fills, slippage, P&L calculations all match live trading."],
    cards: [{ l: "Virtual Balance", v: "$100K", c: "#FFD93D" }, { l: "Market Data", v: "Live", c: "#00E676" }, { l: "Simulation", v: "Full", c: "#00D4FF" }, { l: "Tracking", v: "Per Trade", c: "#A855F7" }] },
  { id: "risk", icon: "◇", grad: "linear-gradient(135deg, #10B981, #00D4FF)", title: "Risk Controls", sub: "Multiple Layers of Protection",
    text: ["Multi-layered risk controls protect your capital around the clock.", "If any threshold is breached, the system reduces exposure automatically."],
    risks: ["Position limits — no single position exceeds 5%", "Drawdown breaker — auto-deleverage at -8%", "Correlation guard — prevents overconcentration", "VaR monitoring — 99% tracked every 30s", "Drift detection — flags degrading models"] },
  { id: "ready", icon: "▣", grad: "linear-gradient(135deg, #00D4FF, #A855F7, #10B981)", title: "You're All Set", sub: "Your Dashboard Awaits",
    text: ["Everything you need — portfolio tracking, AI agent performance, trade review, and monthly statements.", "Your dashboard updates in real time. Welcome to the collective."] },
];

function OnboardingTutorial({ investor, onComplete }) {
  const [step, setStep] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const { isMobile } = useResponsive();
  const s = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  const go = (n) => { setFadeIn(false); setTimeout(() => { setStep(n); setFadeIn(true); }, 250); };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: `calc(${isMobile ? 16 : 24}px + ${safeAreaTop}) ${isMobile ? 16 : 24}px calc(${isMobile ? 16 : 24}px + ${safeAreaBottom})`,
      background: "linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif", color: "#fff",
    }}>
      {/* Progress */}
      <div style={{ position: "fixed", top: safeAreaTop, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.05)", zIndex: 100 }}>
        <div style={{ height: "100%", width: `${((step + 1) / ONBOARDING_STEPS.length) * 100}%`, background: "linear-gradient(90deg, #00D4FF, #A855F7)", transition: "width 0.5s", boxShadow: "0 0 12px rgba(0,212,255,0.4)" }} />
      </div>

      {/* Skip */}
      {!isLast && <button onClick={onComplete} style={{ position: "fixed", top: `calc(16px + ${safeAreaTop})`, right: 20, padding: "8px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", zIndex: 100 }}>Skip Tour</button>}

      {/* Card */}
      <div style={{ ...glass, maxWidth: 680, width: "100%", padding: isMobile ? "24px 20px" : 40, opacity: fadeIn ? 1 : 0, transform: fadeIn ? "translateY(0)" : "translateY(10px)", transition: "all 0.3s" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 16px", background: s.grad, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#fff", boxShadow: "0 4px 20px rgba(0,212,255,0.25)" }}>{s.icon}</div>
          {step === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>Welcome, <span style={{ color: "#00D4FF", fontWeight: 600 }}>{investor.firstName}</span></div>}
          <h2 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 800, margin: "0 0 4px" }}>{s.title}</h2>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: 0 }}>{s.sub}</p>
        </div>

        {s.text.map((t, i) => <p key={i} style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.7, margin: `0 0 ${i < s.text.length - 1 ? 12 : 20}px` }}>{t}</p>)}

        {s.cards && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
            {s.cards.map(c => (
              <div key={c.l} style={{ padding: 14, borderRadius: 14, textAlign: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>{c.l}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.c }}>{c.v}</div>
              </div>
            ))}
          </div>
        )}

        {s.agents && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
            {s.agents.map(a => (
              <div key={a.n} style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 24 }}>{a.i}</span>
                <div><div style={{ fontSize: 13, fontWeight: 700, color: a.c }}>{a.n}</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{a.r}</div></div>
              </div>
            ))}
          </div>
        )}

        {s.risks && (
          <div style={{ marginBottom: 24 }}>
            {s.risks.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, marginBottom: 6, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ width: 8, height: 8, borderRadius: 3, background: ["#00D4FF", "#10B981", "#A855F7", "#F59E0B", "#FF6B6B"][i], boxShadow: `0 0 6px ${["#00D4FF", "#10B981", "#A855F7", "#F59E0B", "#FF6B6B"][i]}60` }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {step > 0 ? <button onClick={() => go(step - 1)} style={{ padding: "10px 20px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Back</button> : <div />}
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>{step + 1}/{ONBOARDING_STEPS.length}</span>
          <button onClick={() => isLast ? onComplete() : go(step + 1)} style={{ padding: "10px 24px", borderRadius: 14, border: "none", cursor: "pointer", background: isLast ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))", color: "#fff", fontSize: 13, fontWeight: 700, boxShadow: isLast ? "0 4px 16px rgba(0,212,255,0.3)" : "none" }}>
            {isLast ? "Enter Dashboard →" : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════
//   LEFT SIDEBAR NAVIGATION
// ════════════════════════════════════════

const SIDEBAR_ITEMS = [
  { id: "portfolio", label: "Portfolio", icon: "◉" },
  { id: "research", label: "Research", icon: "⊘" },
  { id: "performance", label: "Performance", icon: "▲" },
  { id: "activity", label: "Activity", icon: "◈" },
  { id: "agents", label: "AI Agents", icon: "◆" },
  { id: "statements", label: "Statements", icon: "▣" },
  { id: "signals", label: "Signals", icon: "◎" },
  { id: "paper-trading", label: "Paper Trading", icon: "⬢" },
  { id: "fund-management", label: "Fund Mgmt", icon: "⟐" },
  { id: "tax-reporting", label: "Tax Center", icon: "§" },
  { id: "messages", label: "Messages", icon: "💬" },
  { id: "capital-calls", label: "Capital Calls", icon: "💰" },
  { id: "fees", label: "Fees", icon: "📊" },
  { id: "documents", label: "Documents", icon: "📁" },
  { id: "feedback", label: "Feedback", icon: "✉" },
  { id: "settings", label: "Settings", icon: "◇" },
];

function LeftSidebar({ activeTab, onTabChange, investor, onLogout, isOpen, onToggle, isMobile, adminNotifCount = 0 }) {
  const sidebarWidth = 260;

  // Desktop: permanent sidebar. Mobile: slide-out drawer.
  return (
    <>
      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div onClick={onToggle} style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.6)", transition: "opacity 0.3s",
        }} />
      )}

      {/* Sidebar panel */}
      <div style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: sidebarWidth,
        zIndex: 201,
        ...slateGlass, borderRadius: 0, borderLeft: "none", borderTop: "none", borderBottom: "none",
        display: "flex", flexDirection: "column",
        transform: isMobile ? (isOpen ? "translateX(0)" : `translateX(-${sidebarWidth}px)`) : "translateX(0)",
        transition: "transform 0.3s ease",
      }}>
        {/* Logo + Close */}
        <div style={{
          padding: `calc(20px + ${safeAreaTop}) 20px 16px`, display: "flex", alignItems: "center", gap: 12,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <BrandLogo size={38} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>12 TRIBES</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 2, textTransform: "uppercase" }}>Investor Portal</div>
          </div>
          {isMobile && (
            <button onClick={onToggle} style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.4)",
              fontSize: 20, cursor: "pointer", padding: 8,
              minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 10, WebkitTapHighlightColor: "transparent",
            }}>✕</button>
          )}
        </div>

        {/* User Profile Card */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 13,
            background: "linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: "#00D4FF",
          }}>{investor.avatar}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{investor.firstName || investor.name?.split(' ')[0]}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{investor.email}</div>
          </div>
        </div>

        {/* Nav Items */}
        <div style={{ flex: 1, padding: "12px 12px", overflowY: "auto" }}>
          {[...SIDEBAR_ITEMS, ...(investor?.role === 'admin' ? [{ id: "admin", label: "Admin Panel", icon: "⚙" }] : [])].map(item => {
            const active = activeTab === item.id;
            return (
              <button key={item.id}
                onClick={() => { haptics.light(); onTabChange(item.id); if (isMobile) onToggle(); }}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 14, border: "none",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                  marginBottom: 4,
                  background: active ? "rgba(0,212,255,0.1)" : "transparent",
                  color: active ? "#00D4FF" : "rgba(255,255,255,0.5)",
                  fontSize: 14, fontWeight: active ? 600 : 500,
                  transition: "all 0.15s", textAlign: "left",
                }}>
                <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
                {item.label}
                {item.id === 'admin' && adminNotifCount > 0 && (
                  <span style={{
                    marginLeft: 'auto', padding: '2px 7px', borderRadius: 10,
                    background: 'rgba(239,68,68,0.25)', color: '#EF4444',
                    fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center',
                  }}>{adminNotifCount}</span>
                )}
              </button>
            );
          })}

          {/* Divider — External Pages */}
          <div style={{ margin: "12px 0 8px", padding: "0 16px" }}>
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Platform Tools</div>
          </div>
          {[
            { path: "/mission-control", label: "Command Center", icon: "◉" },
            { path: "/trading-engine", label: "Trading Engine", icon: "◆" },
            { path: "/risk-analytics", label: "Risk Analytics", icon: "◇" },
            { path: "/market-intel", label: "Market Intel", icon: "▤" },
          ].map(item => (
            <a key={item.path} href={item.path}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 14, border: "none",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                marginBottom: 4, textDecoration: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.4)",
                fontSize: 14, fontWeight: 500,
                transition: "all 0.15s", textAlign: "left", boxSizing: "border-box",
              }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
              {item.label}
              <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.4 }}>↗</span>
            </a>
          ))}
        </div>

        {/* Sign Out — always visible, pinned to bottom with safe area */}
        <div style={{
          padding: `12px 12px calc(12px + ${safeAreaBottom})`,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          <button onClick={() => { haptics.heavy(); onLogout(); }}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 14, cursor: "pointer",
              border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)",
              color: "#EF4444", fontSize: 14, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, justifyContent: "center",
              WebkitTapHighlightColor: "transparent",
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}


// ════════════════════════════════════════
//   SIGNAL TRACKER — Full spectrum signal intelligence
// ════════════════════════════════════════

function SignalTracker({ investor, isMobile }) {
  const [stats, setStats] = useState(null);
  const [signals, setSignals] = useState([]);
  const [heatmap, setHeatmap] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState("live");
  const [loading, setLoading] = useState(true);

  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') return 'http://localhost:4000/api';
    return 'https://one2-tribes-api.onrender.com/api';
  })();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('12tribes_auth_token') : '';
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  const glass = { background: "rgba(255,255,255,0.03)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)" };

  const safeFetch = useCallback((url) => {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
    return Promise.race([fetch(url, { headers }), timeout(12000)]).catch(() => null);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, signalsRes] = await Promise.all([
        safeFetch(`${API_BASE}/signals/stats`),
        safeFetch(`${API_BASE}/signals?limit=100`),
      ]);
      if (statsRes?.ok) setStats(await statsRes.json());
      if (signalsRes?.ok) { const d = await signalsRes.json(); setSignals(d.signals || []); }
    } catch (e) { console.error('Signal fetch error:', e); }
    setLoading(false);
    try {
      const heatmapRes = await safeFetch(`${API_BASE}/signals/heatmap`);
      if (heatmapRes?.ok) setHeatmap(await heatmapRes.json());
    } catch (e) { /* heatmap is non-critical */ }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 20000);
    return () => { clearInterval(interval); };
  }, []);

  if (loading) return (
    <div style={{ ...glass, padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
      <div style={{ fontSize: 16, marginBottom: 8 }}>Connecting to Signal Engine...</div>
      <div style={{ fontSize: 12 }}>Fetching signal data from trading server</div>
    </div>
  );

  const subTabs = [
    { id: "live", label: "Live Feed" },
    { id: "stats", label: "Analytics" },
    { id: "heatmap", label: "Heatmap" },
    { id: "agents", label: "Agent P&L" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Signal Intelligence</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              {stats ? `${stats.total} signals tracked | ${stats.executed} executed | ${stats.winRate}% win rate` : 'Initializing...'}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {subTabs.map(t => (
              <button key={t.id} onClick={() => { haptics.select(); setActiveSubTab(t.id); }} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                background: activeSubTab === t.id ? "rgba(0,212,255,0.2)" : "rgba(255,255,255,0.05)",
                color: activeSubTab === t.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
              }}>{t.label}</button>
            ))}
            <RefreshButton onRefresh={fetchAll} />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: 12 }}>
          {[
            { label: "Total Signals", value: stats.total, color: "#00D4FF" },
            { label: "Win Rate", value: `${stats.winRate}%`, color: stats.winRate >= 50 ? "#10B981" : "#EF4444" },
            { label: "Total P&L", value: `${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: stats.totalPnL >= 0 ? "#10B981" : "#EF4444" },
            { label: "Avg P&L", value: `$${(stats.avgPnL || 0).toFixed(2)}`, color: (stats.avgPnL || 0) >= 0 ? "#10B981" : "#EF4444" },
            { label: "Conversion", value: `${stats.conversionRate}%`, color: "#A855F7" },
          ].map(m => (
            <div key={m.label} style={{ ...glass, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Live Feed */}
      {activeSubTab === "live" && (
        <div style={{ ...glass, padding: 20, maxHeight: 500, overflowY: "auto" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Recent Signals</div>
          {signals.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)" }}>Signals will appear here as trading begins...</div>
          ) : (
            isMobile ? (
              /* Mobile: Card-based signal feed */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {signals.slice(0, 30).map((sig, i) => (
                  <div key={sig.signal_id || i} style={{
                    padding: 14, borderRadius: 12,
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{sig.symbol}</span>
                        <span style={{ color: sig.side === 'LONG' ? "#10B981" : "#EF4444", fontWeight: 600, fontSize: 11 }}>{sig.side}</span>
                        <span style={{ color: "#A855F7", fontSize: 11, fontWeight: 600 }}>{sig.agent}</span>
                      </div>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{new Date(sig.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: Math.abs(sig.adjusted_score) >= 0.7 ? "rgba(16,185,129,0.15)" : Math.abs(sig.adjusted_score) >= 0.5 ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
                        color: Math.abs(sig.adjusted_score) >= 0.7 ? "#10B981" : Math.abs(sig.adjusted_score) >= 0.5 ? "#F59E0B" : "rgba(255,255,255,0.5)",
                      }}>{((sig.adjusted_score || 0) * 100).toFixed(0)}%</span>
                      <span style={{ fontSize: 11 }}>
                        {"●".repeat(Math.min(sig.confluence || 0, 6))}
                        <span style={{ color: "rgba(255,255,255,0.2)" }}>{"○".repeat(Math.max(0, 6 - (sig.confluence || 0)))}</span>
                      </span>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: sig.action === 'EXECUTED' ? "rgba(16,185,129,0.15)" : sig.action === 'REJECTED' ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                        color: sig.action === 'EXECUTED' ? "#10B981" : sig.action === 'REJECTED' ? "#EF4444" : "rgba(255,255,255,0.4)",
                      }}>{sig.action}</span>
                      <span style={{ fontSize: 12, fontWeight: 600,
                        color: sig.pnl == null ? "rgba(255,255,255,0.2)" : sig.pnl >= 0 ? "#10B981" : "#EF4444",
                      }}>{sig.pnl != null ? `${sig.pnl >= 0 ? '+' : ''}$${sig.pnl.toFixed(2)}` : '—'}</span>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: sig.outcome === 'WIN' ? "rgba(16,185,129,0.15)" : sig.outcome === 'LOSS' ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                        color: sig.outcome === 'WIN' ? "#10B981" : sig.outcome === 'LOSS' ? "#EF4444" : "rgba(255,255,255,0.3)",
                      }}>{sig.outcome || 'PENDING'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Desktop: Full table */
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Time", "Agent", "Symbol", "Side", "Score", "Confluence", "Action", "P&L", "Outcome"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "rgba(255,255,255,0.35)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.slice(0, 50).map((sig, i) => (
                    <tr key={sig.signal_id || i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "8px 10px", color: "rgba(255,255,255,0.5)" }}>{new Date(sig.timestamp).toLocaleTimeString()}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 600, color: "#A855F7" }}>{sig.agent}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{sig.symbol}</td>
                      <td style={{ padding: "8px 10px", color: sig.side === 'LONG' ? "#10B981" : "#EF4444", fontWeight: 600 }}>{sig.side}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: Math.abs(sig.adjusted_score || 0) >= 0.7 ? "rgba(16,185,129,0.15)" : Math.abs(sig.adjusted_score || 0) >= 0.5 ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
                          color: Math.abs(sig.adjusted_score || 0) >= 0.7 ? "#10B981" : Math.abs(sig.adjusted_score || 0) >= 0.5 ? "#F59E0B" : "rgba(255,255,255,0.5)",
                        }}>{((sig.adjusted_score || 0) * 100).toFixed(0)}%</span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {"●".repeat(Math.min(sig.confluence || 0, 6))}
                        <span style={{ color: "rgba(255,255,255,0.2)" }}>{"○".repeat(Math.max(0, 6 - (sig.confluence || 0)))}</span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                          background: sig.action === 'EXECUTED' ? "rgba(16,185,129,0.15)" : sig.action === 'REJECTED' ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                          color: sig.action === 'EXECUTED' ? "#10B981" : sig.action === 'REJECTED' ? "#EF4444" : "rgba(255,255,255,0.4)",
                        }}>{sig.action}</span>
                      </td>
                      <td style={{ padding: "8px 10px", color: sig.pnl == null ? "rgba(255,255,255,0.2)" : sig.pnl >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                        {sig.pnl != null ? `${sig.pnl >= 0 ? '+' : ''}$${sig.pnl.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                          background: sig.outcome === 'WIN' ? "rgba(16,185,129,0.15)" : sig.outcome === 'LOSS' ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                          color: sig.outcome === 'WIN' ? "#10B981" : sig.outcome === 'LOSS' ? "#EF4444" : "rgba(255,255,255,0.3)",
                        }}>{sig.outcome || 'PENDING'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}

      {/* Analytics */}
      {activeSubTab === "stats" && stats && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Confluence Distribution */}
          <div style={{ ...glass, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Win Rate by Confluence Level</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(7, 1fr)", gap: 10 }}>
              {Object.entries(stats.confluenceDist || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([level, data]) => (
                <div key={level} style={{ ...glass, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{level} indicators</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: data.winRate >= 55 ? "#10B981" : data.winRate >= 45 ? "#F59E0B" : "#EF4444" }}>{data.winRate}%</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{data.count} signals</div>
                  <div style={{ fontSize: 10, color: (data.totalPnL || 0) >= 0 ? "#10B981" : "#EF4444" }}>${(data.totalPnL || 0).toFixed(0)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top indicators */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#10B981" }}>Top Winning Indicators</div>
              {(stats.topWinIndicators || []).slice(0, 8).map(([indicator, count], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.7)" }}>{indicator}</span>
                  <span style={{ color: "#10B981", fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#EF4444" }}>Top Losing Indicators</div>
              {(stats.topLossIndicators || []).slice(0, 8).map(([indicator, count], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.7)" }}>{indicator}</span>
                  <span style={{ color: "#EF4444", fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Symbol Performance */}
          {stats.symbolStats && Object.keys(stats.symbolStats).length > 0 && (
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Signal Performance by Symbol</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10 }}>
                {Object.entries(stats.symbolStats).sort((a, b) => (b[1].totalPnL || 0) - (a[1].totalPnL || 0)).map(([sym, data]) => (
                  <div key={sym} style={{ ...glass, padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{sym}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{data.signals || 0} signals | {data.winRate || 0}% win</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: (data.totalPnL || 0) >= 0 ? "#10B981" : "#EF4444", marginTop: 4 }}>
                      {(data.totalPnL || 0) >= 0 ? '+' : ''}${(data.totalPnL || 0).toFixed(0)}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>avg {data.avgPnLPct}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Heatmap */}
      {activeSubTab === "heatmap" && heatmap && (
        <div style={{ ...glass, padding: 20, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Signal Strength Heatmap</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Session: <span style={{ color: "#00D4FF" }}>{heatmap.session?.label}</span>
              {" | "}Regime: <span style={{ color: heatmap.correlationRegime === 'RISK_ON' ? "#10B981" : heatmap.correlationRegime === 'RISK_OFF' ? "#EF4444" : "#F59E0B" }}>{heatmap.correlationRegime}</span>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", color: "rgba(255,255,255,0.35)", fontSize: 10 }}>SYMBOL</th>
                {Object.keys(Object.values(heatmap.heatmap || {})[0] || {}).map(agent => (
                  <th key={agent} style={{ padding: "8px 10px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{agent}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(heatmap.heatmap || {}).filter(([, agents]) => Object.keys(agents).length > 0).map(([sym, agents]) => (
                <tr key={sym} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{sym}</td>
                  {Object.entries(agents).map(([agent, data]) => {
                    const score = data.score || 0;
                    const abs = Math.abs(score);
                    const bg = abs < 0.2 ? "rgba(255,255,255,0.03)" :
                               score > 0 ? `rgba(16,185,129,${Math.min(abs * 0.6, 0.5)})` :
                               `rgba(239,68,68,${Math.min(abs * 0.6, 0.5)})`;
                    const color = abs < 0.2 ? "rgba(255,255,255,0.2)" : score > 0 ? "#10B981" : "#EF4444";
                    return (
                      <td key={agent} style={{ padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ background: bg, borderRadius: 6, padding: "4px 6px", display: "inline-block", minWidth: 50 }}>
                          <span style={{ color, fontWeight: 700, fontSize: 12 }}>{(score * 100).toFixed(0)}%</span>
                          <span style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{data.confluence}c</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Agent P&L Breakdown */}
      {activeSubTab === "agents" && stats?.agentStats && (
        <div style={{ ...glass, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Agent Signal Performance</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 14 }}>
            {Object.entries(stats.agentStats).map(([name, data]) => (
              <div key={name} style={{ ...glass, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#A855F7" }}>{name}</span>
                  <span style={{ fontSize: 12, color: (data.totalPnL || 0) >= 0 ? "#10B981" : "#EF4444", fontWeight: 700 }}>
                    {(data.totalPnL || 0) >= 0 ? '+' : ''}${(data.totalPnL || 0).toFixed(0)}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[
                    { l: "Generated", v: data.generated, c: "#00D4FF" },
                    { l: "Executed", v: data.executed, c: "#A855F7" },
                    { l: "Win Rate", v: `${data.winRate}%`, c: data.winRate >= 50 ? "#10B981" : "#EF4444" },
                  ].map(m => (
                    <div key={m.l} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>{m.l}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: m.c }}>{m.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                  <span>Avg Score: {data.avgScore}</span>
                  <span>Conversion: {data.conversionRate}%</span>
                  <span>W/L: {data.wins}/{data.losses}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//   PERFORMANCE VIEW — Daily/Weekly/Monthly/Annual
// ════════════════════════════════════════

function PerformanceView({ investor, wallet, positions, tradeHistory, isMobile }) {
  const [chartPeriod, setChartPeriod] = useState("monthly");
  const [serverPerf, setServerPerf] = useState(null);

  const token = (() => { try { return localStorage.getItem('12tribes_auth_token') || ''; } catch { return ''; } })();
  const apiBase = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();

  const fetchPerf = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/wallet/performance?period=${chartPeriod}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) setServerPerf(await res.json());
    } catch {}
  }, [chartPeriod]);

  useEffect(() => {
    fetchPerf();
    const interval = setInterval(fetchPerf, 30000);
    return () => clearInterval(interval);
  }, [chartPeriod]);

  const perf = getPerformanceMetrics(investor.id, wallet);
  const chartData = getEquityHistoryByPeriod(investor.id, chartPeriod, perf.currentEquity, perf.initialBalance);
  const breakdown = getPositionPerformance(positions, tradeHistory);

  // Use server data to compute accurate all-time return when available
  const currentEquity = serverPerf?.currentEquity || wallet?.equity || perf.currentEquity;
  const initialBalance = serverPerf?.initialBalance || wallet?.initialBalance || perf.initialBalance;
  const allTimePnL = currentEquity - initialBalance;
  const allTimeReturn = initialBalance > 0 ? (allTimePnL / initialBalance * 100) : 0;

  // Server-backed risk metrics (fallback when local snapshots are sparse)
  const serverSharpe = perf.sharpeRatio || serverPerf?.sharpeRatio || 0;
  const serverMaxDD = Math.abs(perf.maxDrawdown) || serverPerf?.maxDrawdown || 0;
  const serverVolatility = perf.volatility || (() => {
    const snaps = serverPerf?.snapshots;
    if (!snaps || snaps.length < 3) return 0;
    const r = [];
    for (let i = 1; i < snaps.length; i++) {
      if (snaps[i - 1].equity > 0) r.push((snaps[i].equity - snaps[i - 1].equity) / snaps[i - 1].equity * 100);
    }
    if (r.length < 2) return 0;
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
  })();

  // Override perf periods with server-computed data when snapshots are sparse
  const hasGoodHistory = perf.equityHistory.length >= 7;
  const periods = hasGoodHistory ? [
    { key: "daily", label: "Today", ...perf.daily },
    { key: "weekly", label: "7 Days", ...perf.weekly },
    { key: "monthly", label: "30 Days", ...perf.monthly },
    { key: "annual", label: "1 Year", ...perf.annual },
  ] : [
    // When history is sparse, use all-time return for all periods (they're equivalent)
    { key: "daily", label: "Today", return: allTimeReturn, pnl: allTimePnL },
    { key: "weekly", label: "7 Days", return: allTimeReturn, pnl: allTimePnL },
    { key: "monthly", label: "30 Days", return: allTimeReturn, pnl: allTimePnL },
    { key: "annual", label: "1 Year", return: allTimeReturn, pnl: allTimePnL },
  ];

  // Radial gauge for return %
  const ReturnGauge = ({ pct, label, pnl, size = 130 }) => {
    const clamped = Math.max(-20, Math.min(20, pct));
    const normalized = ((clamped + 20) / 40); // 0 to 1
    const angle = normalized * 270 - 135; // -135 to +135 degrees
    const isPositive = pct >= 0;
    const color = isPositive ? "#10B981" : "#EF4444";
    const bgColor = isPositive ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)";
    const borderColor = isPositive ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)";
    const r = size * 0.38;
    const cx = size / 2;
    const cy = size / 2 + 4;

    // Create arc path for the gauge track
    const startAngle = -225 * (Math.PI / 180);
    const endAngle = 45 * (Math.PI / 180);
    const fillAngle = (startAngle + (endAngle - startAngle) * normalized);

    const arcPath = (start, end) => {
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const largeArc = (end - start) > Math.PI ? 1 : 0;
      return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    };

    return (
      <div style={{
        background: bgColor, border: `1px solid ${borderColor}`,
        borderRadius: 20, padding: isMobile ? 16 : 20,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>
          {label}
        </div>
        <svg width={size} height={size * 0.68} viewBox={`0 0 ${size} ${size * 0.72}`}>
          {/* Track */}
          <path d={arcPath(startAngle, endAngle)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} strokeLinecap="round" />
          {/* Fill */}
          <path d={arcPath(startAngle, fillAngle)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
          {/* Center text */}
          <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize={size * 0.18} fontWeight="800" fontFamily="system-ui">
            {isPositive ? "+" : ""}{pct.toFixed(2)}%
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={10} fontFamily="system-ui">
            {isPositive ? "+" : ""}${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </text>
        </svg>
      </div>
    );
  };

  // Risk metric bar
  const RiskBar = ({ label, value, max, color, suffix = "" }) => {
    const pct = Math.min(Math.abs(value) / max * 100, 100);
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color }}>{typeof value === 'number' ? (isNaN(value) ? '0.00' : value.toFixed(2)) : (value || '—')}{suffix}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
          <div style={{ height: "100%", borderRadius: 3, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
        </div>
      </div>
    );
  };

  const chartXKey = chartPeriod === 'daily' ? 'time' : 'date';
  const chartColor = (chartData.length >= 2 && chartData[chartData.length - 1]?.equity >= chartData[0]?.equity) ? "#10B981" : "#EF4444";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ─── HEADER WITH REFRESH ─── */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <RefreshButton onRefresh={fetchPerf} />
      </div>

      {/* ─── PERIOD RETURN METERS ─── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 14 }}>
        {periods.map(p => (
          <ReturnGauge key={p.key} pct={p.return} label={p.label} pnl={p.pnl} size={isMobile ? 110 : 140} />
        ))}
      </div>

      {/* ─── ALL-TIME SUMMARY BAR ─── */}
      <div style={{
        ...glass, padding: isMobile ? 16 : 24,
        display: "flex", alignItems: isMobile ? "flex-start" : "center",
        flexDirection: isMobile ? "column" : "row",
        gap: isMobile ? 12 : 32, justifyContent: "center",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Current Equity</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#fff" }}>${currentEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.04)", display: isMobile ? "none" : "block" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>All-Time P&L</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: allTimePnL >= 0 ? "#10B981" : "#EF4444" }}>
            {allTimePnL >= 0 ? "+" : ""}${Math.abs(allTimePnL).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.04)", display: isMobile ? "none" : "block" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>All-Time Return</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: allTimeReturn >= 0 ? "#10B981" : "#EF4444" }}>
            {allTimeReturn >= 0 ? "+" : ""}{allTimeReturn.toFixed(2)}%
          </div>
        </div>
        {perf.winStreak > 0 && (
          <>
            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.04)", display: isMobile ? "none" : "block" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Win Streak</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#10B981" }}>{perf.winStreak} days</div>
            </div>
          </>
        )}
      </div>

      {/* ─── EQUITY CHART WITH PERIOD TOGGLE ─── */}
      <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Equity Curve</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { k: "daily", l: "1D" },
              { k: "weekly", l: "1W" },
              { k: "monthly", l: "1M" },
              { k: "annual", l: "1Y" },
            ].map(btn => (
              <button key={btn.k} onClick={() => setChartPeriod(btn.k)}
                style={{
                  padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
                  background: chartPeriod === btn.k ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.04)",
                  color: chartPeriod === btn.k ? "#00D4FF" : "rgba(255,255,255,0.4)",
                  transition: "all 0.15s",
                }}>
                {btn.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: isMobile ? 220 : 300 }}>
          <ResponsiveContainer>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey={chartXKey} stroke="rgba(255,255,255,0.2)" fontSize={10} tickLine={false}
                tickFormatter={v => {
                  if (chartPeriod === 'daily') return v;
                  if (!v) return '';
                  const parts = v.split('-');
                  return `${parts[1]}/${parts[2]}`;
                }}
              />
              <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} tickLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{ background: "rgba(0,0,0,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                formatter={(v) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "Equity"]}
              />
              <Area type="monotone" dataKey="equity" stroke={chartColor} fill="url(#perfGrad)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── RISK METRICS + BEST/WORST ─── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
        {/* Risk Metrics */}
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Risk Metrics</div>
          <RiskBar label="Sharpe Ratio" value={serverSharpe} max={3} color="#00D4FF" />
          <RiskBar label="CAGR" value={serverPerf?.cagr || allTimeReturn} max={100} color="#10B981" suffix="%" />
          <RiskBar label="Daily Volatility" value={serverVolatility} max={5} color="#F59E0B" suffix="%" />
          <RiskBar label="Max Drawdown" value={serverMaxDD} max={25} color="#EF4444" suffix="%" />
          <div style={{ marginTop: 8, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Win / Loss Streak</span>
              <div>
                {perf.winStreak > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: "#10B981", marginRight: 8 }}>{perf.winStreak}W</span>}
                {perf.lossStreak > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: "#EF4444" }}>{perf.lossStreak}L</span>}
                {perf.winStreak === 0 && perf.lossStreak === 0 && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>—</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Best / Worst Days */}
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Highlights</div>

          <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.12)", marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              {hasGoodHistory ? 'Best Day' : 'Total Gain'}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                {hasGoodHistory ? perf.bestDay.date : new Date().toISOString().split('T')[0]}
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#10B981" }}>
                +{(hasGoodHistory ? perf.bestDay.return : (allTimeReturn > 0 ? allTimeReturn : 0)).toFixed(2)}%
              </span>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 14, background: allTimeReturn < 0 ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${allTimeReturn < 0 ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)"}`, marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              {hasGoodHistory ? 'Worst Day' : 'Win Rate'}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                {hasGoodHistory ? perf.worstDay.date : `${wallet?.winCount || 0}W / ${wallet?.lossCount || 0}L`}
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: hasGoodHistory ? "#EF4444" : "#00D4FF" }}>
                {hasGoodHistory ? `${(perf.worstDay?.return || 0).toFixed(2)}%` : `${wallet?.winRate?.toFixed(1) || 0}%`}
              </span>
            </div>
          </div>

          {/* Performance by Asset Class */}
          {breakdown.byAsset.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>By Asset Class</div>
              {breakdown.byAsset.map(a => (
                <div key={a.asset} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>{a.asset}</span>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{a.trades} trades</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: a.pnl >= 0 ? "#10B981" : "#EF4444" }}>
                      {a.pnl >= 0 ? "+" : ""}${a.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ─── AGENT PERFORMANCE BREAKDOWN ─── */}
      {breakdown.byAgent.length > 0 && (
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Agent Performance</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
            {breakdown.byAgent.map(a => {
              const winRate = a.trades > 0 ? ((a.wins / a.trades) * 100) : 0;
              return (
                <div key={a.agent} style={{
                  padding: "14px 16px", borderRadius: 14,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#00D4FF", marginBottom: 6 }}>{a.agent}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>P&L</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: a.pnl >= 0 ? "#10B981" : "#EF4444" }}>
                      {a.pnl >= 0 ? "+" : ""}${a.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Win Rate</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: winRate >= 50 ? "#10B981" : "#EF4444" }}>{winRate.toFixed(1)}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Trades</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{a.trades}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//   RESEARCH VIEW — AI-Powered Market Intelligence
// ════════════════════════════════════════

function ResearchView({ isMobile }) {
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [research, setResearch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allSymbols, setAllSymbols] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('12tribes_recent_research') || '[]'); } catch { return []; }
  });

  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();

  // Load all available symbols on mount
  useEffect(() => {
    fetch(`${API_BASE}/market/search`).then(r => r.json()).then(d => setAllSymbols(d.results || [])).catch(() => {});
  }, []);

  // Live search filtering
  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return; }
    const q = query.toUpperCase();
    setSearchResults(allSymbols.filter(s => s.includes(q)).slice(0, 10));
  }, [query, allSymbols]);

  // Auto-refresh research data every 10 seconds
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => {
    if (!selectedSymbol) return;
    const interval = setInterval(() => {
      fetch(`${API_BASE}/market/research/${encodeURIComponent(selectedSymbol)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) { setResearch(data); setRefreshError(false); }
          else { setRefreshError(true); }
        })
        .catch(() => { setRefreshError(true); });
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedSymbol]);

  const handleSearch = async (symbol) => {
    const sym = (symbol || query).toUpperCase().trim();
    if (!sym) return;
    setLoading(true);
    setError('');
    setSelectedSymbol(sym);
    setQuery(sym);
    setSearchResults([]);
    try {
      const res = await fetch(`${API_BASE}/market/research/${encodeURIComponent(sym)}`);
      const data = await res.json();
      if (res.ok) {
        setResearch(data);
        // Update recent searches
        const updated = [sym, ...recentSearches.filter(s => s !== sym)].slice(0, 8);
        setRecentSearches(updated);
        try { localStorage.setItem('12tribes_recent_research', JSON.stringify(updated)); } catch {}
      } else {
        setError(data.error || 'Symbol not found');
        setResearch(null);
      }
    } catch (err) {
      setError('Network error — could not reach research API');
    }
    setLoading(false);
  };

  const glass = {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18, backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)",
    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.35)",
  };

  const signalColor = (signal) => {
    if (['BULLISH', 'STRONG', 'OVERSOLD', 'NEAR_SUPPORT'].includes(signal)) return '#10B981';
    if (['BEARISH', 'WEAK', 'OVERBOUGHT', 'NEAR_RESISTANCE', 'HIGH'].includes(signal)) return '#EF4444';
    return 'rgba(255,255,255,0.5)';
  };

  const verdictColor = (verdict) => {
    if (verdict === 'BULLISH') return '#10B981';
    if (verdict === 'LEAN_BULLISH') return '#34D399';
    if (verdict === 'BEARISH') return '#EF4444';
    if (verdict === 'LEAN_BEARISH') return '#F87171';
    return '#F59E0B';
  };

  // Mini sparkline chart from price history
  const Sparkline = ({ data, width = 280, height = 80 }) => {
    if (!data || data.length < 2) return null;
    const prices = data.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 8) - 4;
      return `${x},${y}`;
    }).join(' ');
    const isUp = prices[prices.length - 1] >= prices[0];
    const color = isUp ? '#10B981' : '#EF4444';
    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`grad-${isUp ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#grad-${isUp ? 'up' : 'down'})`} />
      </svg>
    );
  };

  // Signal strength gauge
  const SignalGauge = ({ strength }) => {
    const normalized = (strength + 100) / 200; // 0 to 1
    const angle = normalized * 180 - 90;
    const color = strength > 20 ? '#10B981' : strength < -20 ? '#EF4444' : '#F59E0B';
    return (
      <svg width="120" height="70" viewBox="0 0 120 70">
        <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" strokeLinecap="round" />
        <path d={`M 10 65 A 50 50 0 0 1 ${60 + 50 * Math.cos(Math.PI - normalized * Math.PI)} ${65 - 50 * Math.sin(Math.PI - normalized * Math.PI)}`}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <text x="60" y="58" textAnchor="middle" fill={color} fontSize="18" fontWeight="800" fontFamily="system-ui">
          {strength > 0 ? '+' : ''}{strength}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">SIGNAL</text>
      </svg>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Search Header */}
      <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Market Research</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
              AI-powered technical analysis across stocks, crypto, forex, ETFs, futures, options & cash
              {refreshError && <span style={{ color: '#EF4444', marginLeft: 8 }}>● Connection issue</span>}
            </div>
          </div>
          {selectedSymbol && <RefreshButton onRefresh={() => handleSearch(selectedSymbol)} />}
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search symbol (AAPL, BTC, EUR/USD...)"
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 14, fontSize: 14,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', outline: 'none',
              }}
            />
            <button onClick={() => handleSearch()} disabled={loading}
              style={{
                padding: '12px 24px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))',
                color: '#00D4FF', fontSize: 13, fontWeight: 600,
              }}>
              {loading ? '...' : 'Analyze'}
            </button>
          </div>

          {/* Search Dropdown */}
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 100,
              ...glass, padding: 8, maxHeight: 200, overflowY: 'auto',
            }}>
              {searchResults.map(s => (
                <button key={s} onClick={() => handleSearch(s)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: 'none',
                    background: 'transparent', color: '#fff', fontSize: 14, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left', display: 'block',
                  }}
                  onMouseOver={e => e.target.style.background = 'rgba(0,212,255,0.1)'}
                  onMouseOut={e => e.target.style.background = 'transparent'}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick Chips — categorized */}
        <div style={{ marginTop: 14 }}>
          {[
            { label: 'Stocks', symbols: ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'META', 'AMZN', 'GOOGL'] },
            { label: 'Crypto', symbols: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'DOT', 'LINK'] },
            { label: 'Forex', symbols: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD'] },
            { label: 'ETFs', symbols: ['SPY', 'QQQ', 'GLD', 'TLT', 'XLF', 'XLE', 'ARKK'] },
            { label: 'Futures', symbols: ['CL=F', 'GC=F', 'SI=F', 'NG=F', 'ES=F', 'NQ=F'] },
            { label: 'Options', symbols: ['TQQQ', 'SOXL', 'UVXY', 'SPXS', 'SQQQ'] },
            { label: 'Cash', symbols: ['BIL', 'SHV', 'SGOV'] },
          ].map(cat => (
            <div key={cat.label} style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, marginRight: 8 }}>{cat.label}</span>
              {cat.symbols.map(s => (
                <button key={s} onClick={() => handleSearch(s)}
                  style={{
                    padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: selectedSymbol === s ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
                    color: selectedSymbol === s ? '#00D4FF' : 'rgba(255,255,255,0.45)',
                    fontSize: 11, fontWeight: 600, marginRight: 4, marginBottom: 4,
                  }}>
                  {s}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Recent Searches */}
        {recentSearches.length > 0 && !research && (
          <div style={{ marginTop: 12 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: 1 }}>Recent </span>
            {recentSearches.map(s => (
              <button key={s} onClick={() => handleSearch(s)}
                style={{
                  padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)',
                  background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 11,
                  cursor: 'pointer', marginRight: 4, marginBottom: 4,
                }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...glass, padding: 16, textAlign: 'center', color: '#EF4444', fontSize: 13, border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* ═══ RESEARCH RESULTS ═══ */}
      {research && (
        <>
          {/* Price Header Card */}
          <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{research.symbol}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background: 'rgba(0,212,255,0.1)', color: '#00D4FF',
                  }}>{research.assetClass}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background: research.dataSource === 'real' ? 'rgba(16,185,129,0.15)'
                      : research.dataSource === 'initializing' ? 'rgba(0,212,255,0.15)'
                      : research.dataSource === 'stale' ? 'rgba(239,68,68,0.15)'
                      : 'rgba(245,158,11,0.15)',
                    color: research.dataSource === 'real' ? '#10B981'
                      : research.dataSource === 'initializing' ? '#00D4FF'
                      : research.dataSource === 'stale' ? '#EF4444'
                      : '#F59E0B',
                  }}>{research.dataSource === 'real' ? 'LIVE'
                    : research.dataSource === 'initializing' ? 'CONNECTING...'
                    : research.dataSource === 'stale' ? 'STALE'
                    : 'SIMULATED'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>
                    ${research.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: research.price < 10 ? 4 : 2 })}
                  </span>
                  <span style={{
                    fontSize: 16, fontWeight: 700,
                    color: research.changePct >= 0 ? '#10B981' : '#EF4444',
                  }}>
                    {research.changePct >= 0 ? '+' : ''}{research.changePct.toFixed(2)}%
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                  O: ${research.open.toFixed(2)} &nbsp; H: ${research.high.toFixed(2)} &nbsp; L: ${research.low.toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Sparkline data={research.priceHistory} width={isMobile ? 200 : 280} height={70} />
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>Last 60 ticks</div>
              </div>
            </div>
          </div>

          {/* AI Verdict + Signal Gauge */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <div style={{
              ...glass, padding: 20,
              borderColor: `${verdictColor(research.aiVerdict.verdict)}33`,
            }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>AI Verdict</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{
                  padding: '6px 16px', borderRadius: 10, fontSize: 14, fontWeight: 800,
                  background: `${verdictColor(research.aiVerdict.verdict)}20`,
                  color: verdictColor(research.aiVerdict.verdict),
                  border: `1px solid ${verdictColor(research.aiVerdict.verdict)}40`,
                }}>
                  {research.aiVerdict.verdict.replace('_', ' ')}
                </span>
                <SignalGauge strength={research.aiVerdict.signalStrength} />
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                {research.aiVerdict.detail}
              </div>
            </div>

            {/* Key Technicals */}
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Technical Indicators</div>
              {[
                { label: 'RSI (14)', value: research.technicals.rsi.toFixed(1), bar: research.technicals.rsi, max: 100, color: research.technicals.rsi > 70 ? '#EF4444' : research.technicals.rsi < 30 ? '#10B981' : '#00D4FF' },
                { label: 'Momentum', value: `${research.technicals.momentum > 0 ? '+' : ''}${research.technicals.momentum.toFixed(2)}%`, bar: Math.abs(research.technicals.momentum) * 10, max: 100, color: research.technicals.momentum > 0 ? '#10B981' : '#EF4444' },
                { label: 'Volatility', value: `${research.technicals.volatility.toFixed(2)}%`, bar: research.technicals.volatility * 20, max: 100, color: research.technicals.volatility > 3 ? '#F59E0B' : '#00D4FF' },
                { label: 'Regime', value: research.technicals.regime.replace('_', ' ').toUpperCase(), bar: 0, max: 0, color: research.technicals.regime === 'trending_up' ? '#10B981' : research.technicals.regime === 'trending_down' ? '#EF4444' : '#F59E0B' },
              ].map(t => (
                <div key={t.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.value}</span>
                  </div>
                  {t.max > 0 && (
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: t.color, width: `${Math.min(t.bar, 100)}%`, transition: 'width 0.5s' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Signal Breakdown */}
          <div style={{ ...glass, padding: isMobile ? 16 : 20 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Signal Breakdown</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 8 }}>
              {research.signals.map((s, i) => (
                <div key={i} style={{
                  padding: '12px 14px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, textTransform: 'uppercase' }}>{s.indicator}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{s.detail}</div>
                  </div>
                  <span style={{
                    padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, flexShrink: 0,
                    background: `${signalColor(s.signal)}15`, color: signalColor(s.signal),
                    border: `1px solid ${signalColor(s.signal)}30`,
                  }}>
                    {s.signal}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Support/Resistance + Moving Averages */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Key Levels</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Support</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#10B981' }}>${research.levels.support.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Current Price</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>${research.price.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Resistance</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#EF4444' }}>${research.levels.resistance.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Moving Averages</div>
              {[
                { label: 'SMA 10', value: research.technicals.sma10, vs: research.price },
                { label: 'SMA 30', value: research.technicals.sma30, vs: research.price },
                { label: 'EMA 12', value: research.technicals.ema12, vs: research.price },
                { label: 'EMA 26', value: research.technicals.ema26, vs: research.price },
                { label: 'MACD', value: research.technicals.macd, isRaw: true },
              ].map(ma => (
                <div key={ma.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{ma.label}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      {ma.isRaw ? (ma.value > 0 ? '+' : '') + ma.value.toFixed(4) : '$' + ma.value.toFixed(2)}
                    </span>
                    {!ma.isRaw && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: ma.vs > ma.value ? '#10B981' : '#EF4444' }}>
                        {ma.vs > ma.value ? 'ABOVE' : 'BELOW'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tracking Agents */}
          {research.agents.length > 0 && (
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>AI Agents Tracking {research.symbol}</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
                {research.agents.map(a => (
                  <div key={a.name} style={{
                    padding: '14px 16px', borderRadius: 14,
                    background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', marginBottom: 4 }}>{a.name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{a.role.replace('_', ' ')}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>{a.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ textAlign: 'center', padding: '8px 16px', fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>
            {research?.dataSource === 'real'
              ? 'Live market data — not financial advice. AI signals are algorithmic analysis, not trade recommendations.'
              : 'Paper trading analysis — not financial advice. Signals are generated from simulated market data.'}
          </div>
        </>
      )}

      {/* Empty State */}
      {!research && !loading && !error && (
        <div style={{ ...glass, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>⊘</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Select an asset to analyze</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
            Search or tap a symbol above to get AI-powered technical analysis, signal breakdowns, and agent insights
          </div>
        </div>
      )}

      {loading && (
        <div style={{ ...glass, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Analyzing {selectedSymbol}...</div>
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════
//   FUND MANAGEMENT VIEW
// ════════════════════════════════════════

// ════════════════════════════════════════
//   WITHDRAWAL REQUEST PANEL
// ════════════════════════════════════════

function WithdrawalRequestPanel({ investorId, wallet, isMobile, glassStyle, pillBtn }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [taxSummary, setTaxSummary] = useState(null);

  const API = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();
  const token = (() => {
    try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; }
  })();
  const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  const availableBalance = wallet?.equity || wallet?.balance || 0;

  const fetchRequests = async () => {
    try {
      const r = await fetch(`${API}/withdrawals`, { headers: authHeaders });
      if (r.ok) {
        const data = await r.json();
        setRequests(data.withdrawals || []);
      }
    } catch {}
    setLoadingRequests(false);
  };

  const fetchTaxSummary = async () => {
    try {
      const yr = new Date().getFullYear();
      const r = await fetch(`${API}/tax/summary/${yr}`, { headers: authHeaders });
      if (r.ok) {
        const data = await r.json();
        setTaxSummary(data.report || null);
      }
    } catch {}
  };

  useEffect(() => { fetchRequests(); fetchTaxSummary(); }, []);

  const handleSubmit = async () => {
    const withdrawAmt = parseFloat(amount);
    if (!withdrawAmt || withdrawAmt <= 0) { setError('Enter a valid amount'); return; }
    if (withdrawAmt > availableBalance) { setError(`Amount exceeds available balance ($${availableBalance.toLocaleString()})`); return; }

    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`${API}/withdrawals`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ amount: withdrawAmt, method, notes: notes.trim() }),
      });
      const data = await r.json();
      if (r.ok) {
        setSuccess(`Withdrawal request for $${withdrawAmt.toLocaleString()} submitted successfully`);
        setAmount('');
        setNotes('');
        setShowForm(false);
        fetchRequests();
        setTimeout(() => setSuccess(''), 5000);
      } else {
        setError(data.error || 'Failed to submit request');
      }
    } catch { setError('Network error. Please try again.'); }
    setSubmitting(false);
  };

  const quickAmounts = [1000, 5000, 10000, 25000, 50000].filter(a => a <= availableBalance);

  const statusConfig = {
    pending: { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B', label: 'Pending Review' },
    approved: { bg: 'rgba(0,212,255,0.1)', color: '#00D4FF', label: 'Approved' },
    processing: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7', label: 'Processing' },
    completed: { bg: 'rgba(34,197,94,0.1)', color: '#22C55E', label: 'Completed' },
    denied: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444', label: 'Denied' },
  };

  const pendingTotal = requests.filter(r => ['pending', 'approved', 'processing'].includes(r.status))
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Withdraw Funds</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            Available: <span style={{ color: "#10B981", fontWeight: 700 }}>${availableBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            {pendingTotal > 0 && <span style={{ color: "#F59E0B", marginLeft: 8 }}>({`$${pendingTotal.toLocaleString()} pending`})</span>}
          </div>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{
          padding: "10px 20px", borderRadius: 14, cursor: "pointer", border: "none",
          background: showForm ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #00D4FF, #A855F7)",
          color: "#fff", fontSize: 13, fontWeight: 700, transition: "all 0.2s",
        }}>
          {showForm ? "Cancel" : "Request Withdrawal"}
        </button>
      </div>

      {success && (
        <div style={{ padding: "12px 16px", borderRadius: 14, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.15)", color: "#22C55E", fontSize: 13, marginBottom: 16 }}>
          ✓ {success}
        </div>
      )}

      {/* Withdrawal Request Form */}
      {showForm && (
        <div style={{ padding: 20, borderRadius: 18, background: "rgba(30,30,34,0.6)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 16 }}>

          {/* Quick Amount Buttons */}
          {quickAmounts.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Quick Select</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {quickAmounts.map(qa => (
                  <button key={qa} onClick={() => setAmount(String(qa))} style={{
                    padding: "8px 16px", borderRadius: 12, cursor: "pointer",
                    border: parseFloat(amount) === qa ? "1px solid rgba(0,212,255,0.4)" : "1px solid rgba(255,255,255,0.04)",
                    background: parseFloat(amount) === qa ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.06)",
                    color: parseFloat(amount) === qa ? "#00D4FF" : "rgba(255,255,255,0.5)",
                    fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                  }}>${qa.toLocaleString()}</button>
                ))}
                <button onClick={() => setAmount(String(Math.floor(availableBalance)))} style={{
                  padding: "8px 16px", borderRadius: 12, cursor: "pointer",
                  border: "1px solid rgba(239,68,68,0.2)",
                  background: "rgba(239,68,68,0.06)",
                  color: "#EF4444", fontSize: 13, fontWeight: 600,
                }}>Max</button>
              </div>
            </div>
          )}

          {/* Amount Input */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Withdrawal Amount ($)</div>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              max={availableBalance}
              style={{
                width: "100%", padding: "14px 18px", borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.04)", background: "rgba(30,30,34,0.9)",
                color: "#fff", fontSize: 22, fontWeight: 700, outline: "none",
                boxSizing: "border-box", fontFamily: "inherit",
              }}
            />
            {parseFloat(amount) > 0 && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                Remaining after withdrawal: ${(availableBalance - parseFloat(amount)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            )}
          </div>

          {/* Tax Impact Notice */}
          {parseFloat(amount) > 0 && taxSummary && (
            <div style={{
              padding: 16, borderRadius: 16, marginBottom: 16,
              background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)",
            }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>§</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B" }}>Tax Impact — {new Date().getFullYear()} YTD</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                <div>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Realized Gains (ST)</span>
                  <div style={{ fontWeight: 700, color: (taxSummary.scheduleD?.shortTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", marginTop: 2 }}>
                    ${(taxSummary.scheduleD?.shortTermGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Realized Gains (LT)</span>
                  <div style={{ fontWeight: 700, color: (taxSummary.scheduleD?.longTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", marginTop: 2 }}>
                    ${(taxSummary.scheduleD?.longTermGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Total Transactions</span>
                  <div style={{ fontWeight: 700, color: "#00D4FF", marginTop: 2 }}>{taxSummary.totalTransactions || 0}</div>
                </div>
                <div>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Wash Sales</span>
                  <div style={{ fontWeight: 700, color: (taxSummary.washSaleCount || 0) > 0 ? "#F59E0B" : "#10B981", marginTop: 2 }}>{taxSummary.washSaleCount || 0}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
                Withdrawing funds does not change your tax liability — taxes are based on realized trades, not withdrawals. Ensure you retain sufficient funds for estimated quarterly tax payments.
              </div>
            </div>
          )}

          {/* Method */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Withdrawal Method</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { key: "bank_transfer", label: "Bank Transfer", icon: "🏦" },
                { key: "crypto_wallet", label: "Crypto Wallet", icon: "₿" },
                { key: "wire_transfer", label: "Wire Transfer", icon: "🌐" },
                { key: "check", label: "Check", icon: "📄" },
              ].map(m => (
                <button key={m.key} onClick={() => setMethod(m.key)} style={{
                  padding: "10px 16px", borderRadius: 14, cursor: "pointer",
                  border: method === m.key ? "1px solid rgba(0,212,255,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  background: method === m.key ? "rgba(0,212,255,0.1)" : "rgba(255,255,255,0.06)",
                  color: method === m.key ? "#00D4FF" : "rgba(255,255,255,0.5)",
                  fontSize: 12, fontWeight: 600, transition: "all 0.15s",
                }}>{m.icon} {m.label}</button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Notes (optional)</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any special instructions for this withdrawal..."
              maxLength={500}
              style={{
                width: "100%", minHeight: 70, padding: "12px 16px", borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.04)", background: "rgba(30,30,34,0.9)",
                color: "#fff", fontSize: 13, outline: "none", resize: "vertical",
                fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(239,68,68,0.1)", color: "#EF4444", fontSize: 12, marginBottom: 12 }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={submitting || !amount || parseFloat(amount) <= 0} style={{
            width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
            cursor: submitting ? "wait" : "pointer",
            background: parseFloat(amount) > 0 ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "rgba(255,255,255,0.06)",
            color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
            opacity: submitting ? 0.6 : 1,
          }}>
            {submitting ? 'Submitting Request...' : `Request $${parseFloat(amount || 0).toLocaleString()} Withdrawal`}
          </button>
        </div>
      )}

      {/* ═══ WITHDRAWAL SUMMARY KPI CARDS ═══ */}
      {requests.length > 0 && (() => {
        const completed = requests.filter(r => r.status === 'completed');
        const pending = requests.filter(r => r.status === 'pending' || r.status === 'processing');
        const totalWithdrawn = completed.reduce((s, r) => s + (r.amount || 0), 0);
        const totalPending = pending.reduce((s, r) => s + (r.amount || 0), 0);
        return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Total Withdrawn</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#22C55E" }}>${totalWithdrawn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Pending</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#F59E0B" }}>${totalPending.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Completed</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{completed.length}</div>
            </div>
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Total Requests</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{requests.length}</div>
            </div>
          </div>
        );
      })()}

      {/* Withdrawal Request History */}
      {loadingRequests ? (
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, textAlign: "center", padding: 16 }}>Loading requests...</div>
      ) : requests.length === 0 ? (
        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 13, textAlign: "center", padding: 20 }}>
          No withdrawal requests yet. Click "Request Withdrawal" to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Request History</div>
          {requests.map(wr => {
            const sc = statusConfig[wr.status] || statusConfig.pending;
            return (
              <div key={wr.id} style={{
                padding: "14px 16px", borderRadius: 16,
                background: "rgba(30,30,34,0.5)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
                    ${wr.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <span style={{ padding: "4px 10px", borderRadius: 8, background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700 }}>
                    {sc.label}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                  <span>{wr.method?.replace(/_/g, ' ')}</span>
                  <span>{new Date(wr.createdAt).toLocaleDateString()}</span>
                  {wr.completedAt && <span style={{ color: "#22C55E" }}>Completed {new Date(wr.completedAt).toLocaleDateString()}</span>}
                </div>
                {wr.notes && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 8, fontStyle: "italic" }}>"{wr.notes}"</div>
                )}
                {wr.adminNotes && (
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}>
                    <div style={{ fontSize: 10, color: "#A855F7", fontWeight: 600, marginBottom: 2 }}>Admin Response</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{wr.adminNotes}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function FundManagementView({ investorId, wallet, isMobile }) {
  const [settings, setSettings] = useState(() => {
    initFundManager(investorId);
    return getFundSettings(investorId);
  });
  const currentEquity = wallet?.equity || 100000;
  const [projection, setProjection] = useState([]);

  // Refresh settings from store every render (parent tick forces re-render)
  useEffect(() => {
    setSettings(getFundSettings(investorId));
  }, [investorId, wallet?.equity]);

  useEffect(() => {
    const proj = getCompoundProjection(investorId);
    setProjection(proj || []);
  }, [investorId, currentEquity, settings?.distribution?.mode, settings?.distribution?.hybridCompoundPercent]);

  const update = (changes) => {
    updateFundSettings(investorId, changes);
    setSettings(getFundSettings(investorId));
  };

  const withdrawHistory = getWithdrawalHistory(investorId) || [];

  // Resolve nested settings with safe defaults
  const distMode = settings?.distribution?.mode || 'compound';
  const compoundPct = settings?.distribution?.hybridCompoundPercent || 60;
  const wSchedule = settings?.withdrawal?.schedule || 'monthly';
  const wType = settings?.withdrawal?.type || 'percentage_of_profits';
  const wAmount = settings?.withdrawal?.amount || 0;
  const wThreshold = settings?.withdrawal?.thresholdAmount || 100000;
  const wMinBalance = settings?.withdrawal?.minimumBalance || 50000;
  const wMethod = settings?.withdrawal?.method || 'bank_transfer';

  const glassStyle = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 24,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
  };

  const pillBtn = (active, color = "#00D4FF") => ({
    padding: "8px 16px", borderRadius: 12, cursor: "pointer",
    border: active ? `1px solid ${color}40` : "1px solid rgba(255,255,255,0.04)",
    background: active ? `${color}18` : "rgba(255,255,255,0.03)",
    color: active ? color : "rgba(255,255,255,0.5)",
    fontSize: 12, fontWeight: 600, transition: "all 0.2s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Distribution Mode Selection */}
      <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Fund Distribution</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>
          Choose how your trading profits are handled
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
          {[
            { key: "compound", icon: "📈", title: "Full Compound", desc: "All profits reinvested for maximum growth", color: "#10B981" },
            { key: "withdraw", icon: "💰", title: "Withdraw Profits", desc: "Take profits on a regular schedule", color: "#00D4FF" },
            { key: "hybrid", icon: "⚖️", title: "Hybrid", desc: "Split between compounding and withdrawals", color: "#A855F7" },
          ].map(m => (
            <button key={m.key} onClick={() => update({ distribution: { ...settings.distribution, mode: m.key } })}
              style={{
                padding: 20, borderRadius: 18, cursor: "pointer", textAlign: "left",
                border: distMode === m.key ? `2px solid ${m.color}` : "2px solid rgba(255,255,255,0.06)",
                background: distMode === m.key ? `${m.color}12` : "rgba(255,255,255,0.02)",
                transition: "all 0.2s",
              }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{m.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: distMode === m.key ? m.color : "#fff", marginBottom: 4 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Compound Projection */}
      {distMode === "compound" && (
        <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#10B981", marginBottom: 4 }}>Compound Growth Projection</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
            Estimated 12-month growth at current performance
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10 }}>
            {[3, 6, 9, 12].map(month => {
              const p = projection.find(pr => pr.month === month);
              const projected = p ? (p.value || p.balance || currentEquity) : currentEquity;
              const gain = projected - currentEquity;
              return (
                <div key={month} style={{ padding: 16, borderRadius: 14, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.12)", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{month} Months</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#10B981" }}>${projected.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div style={{ fontSize: 11, color: "rgba(16,185,129,0.6)", marginTop: 2 }}>+${gain.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Withdrawal Configuration */}
      {(distMode === "withdraw" || distMode === "hybrid") && (
        <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#00D4FF", marginBottom: 16 }}>Withdrawal Settings</div>

          {/* Hybrid slider */}
          {distMode === "hybrid" && (
            <div style={{ marginBottom: 24, padding: 16, borderRadius: 14, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>Profit Split</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#10B981" }}>Compound: {compoundPct}%</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#00D4FF" }}>Withdraw: {100 - compoundPct}%</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[80, 70, 60, 50, 40, 30, 20].map(pct => (
                  <button key={pct} onClick={() => update({ distribution: { ...settings.distribution, hybridCompoundPercent: pct, hybridWithdrawPercent: 100 - pct } })}
                    style={pillBtn(compoundPct === pct, "#A855F7")}>
                    {pct}/{100 - pct}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Schedule */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Withdrawal Schedule</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["weekly", "biweekly", "monthly", "quarterly"].map(s => (
                <button key={s} onClick={() => update({ withdrawal: { ...settings.withdrawal, schedule: s } })}
                  style={pillBtn(wSchedule === s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Withdrawal Type</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { key: "fixed_amount", label: "Fixed Amount" },
                { key: "percentage_of_profits", label: "% of Profits" },
                { key: "percentage_of_equity", label: "% of Equity" },
                { key: "above_threshold", label: "Above Threshold" },
              ].map(t => (
                <button key={t.key} onClick={() => update({ withdrawal: { ...settings.withdrawal, type: t.key } })}
                  style={pillBtn(wType === t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount Input */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              {wType === "fixed_amount" ? "Amount per Withdrawal ($)" :
               wType === "above_threshold" ? "Keep Balance Above ($)" :
               "Percentage (%)"}
            </div>
            <input
              type="number"
              value={wType === "above_threshold" ? wThreshold : wAmount}
              onChange={e => {
                const val = parseFloat(e.target.value) || 0;
                if (wType === "above_threshold") {
                  update({ withdrawal: { ...settings.withdrawal, thresholdAmount: val } });
                } else {
                  update({ withdrawal: { ...settings.withdrawal, amount: val } });
                }
              }}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)", color: "#fff",
                fontSize: 16, fontWeight: 600, outline: "none",
                boxSizing: "border-box", fontFamily: "inherit",
              }}
            />
          </div>

          {/* Minimum Balance */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Minimum Balance (Never Withdraw Below)
            </div>
            <input
              type="number"
              value={wMinBalance}
              onChange={e => update({ withdrawal: { ...settings.withdrawal, minimumBalance: parseFloat(e.target.value) || 50000 } })}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)", color: "#fff",
                fontSize: 16, fontWeight: 600, outline: "none",
                boxSizing: "border-box", fontFamily: "inherit",
              }}
            />
          </div>

          {/* Withdrawal Method */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Withdrawal Method</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { key: "bank_transfer", label: "Bank Transfer" },
                { key: "crypto_wallet", label: "Crypto Wallet" },
                { key: "hold_cash", label: "Hold as Cash" },
              ].map(m => (
                <button key={m.key} onClick={() => update({ withdrawal: { ...settings.withdrawal, method: m.key } })}
                  style={pillBtn(wMethod === m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ REQUEST WITHDRAWAL ═══ */}
      <WithdrawalRequestPanel investorId={investorId} wallet={wallet} isMobile={isMobile} glassStyle={glassStyle} pillBtn={pillBtn} />

      {/* Withdrawal History */}
      {withdrawHistory.length > 0 && (
        <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Scheduled Withdrawal History</div>
          {withdrawHistory.map((w, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{w.date}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{w.method}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#00D4FF" }}>${(w.amount || 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Summary Card */}
      <div style={{ ...glassStyle, padding: isMobile ? 16 : 24, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Current Configuration</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>MODE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: distMode === 'compound' ? '#10B981' : distMode === 'withdraw' ? '#00D4FF' : '#A855F7' }}>
              {distMode.charAt(0).toUpperCase() + distMode.slice(1)}
            </div>
          </div>
          {distMode !== 'compound' && (
            <>
              <div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>SCHEDULE</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{wSchedule.charAt(0).toUpperCase() + wSchedule.slice(1)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>METHOD</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{wMethod.replace(/_/g, ' ')}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//   TRADING CONTROL PANEL
// ════════════════════════════════════════

function TradingControlPanel({ investorId, wallet, isMobile, onTick }) {
  const [tradingActive, setTradingActive] = useState(false);
  const [tradingMode, setTradingMode] = useState('balanced');
  const [recentTrades, setRecentTrades] = useState([]);
  const [sessionStats, setSessionStats] = useState({ trades: 0, pnl: 0, startTime: null });
  const [isStarting, setIsStarting] = useState(false);
  const [serverStats, setServerStats] = useState(null);

  // API base for server-side auto-trading
  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `http://${hostname}:4000/api`;
  })();
  const authToken = (() => { try { return localStorage.getItem('12tribes_auth_token') || ''; } catch { return ''; } })();

  // Check initial status — from server first, then localStorage fallback
  useEffect(() => {
    let cancelled = false;
    const checkServer = async () => {
      try {
        const res = await fetch(`${API_BASE}/auto-trading/status`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.isActive) {
            setTradingActive(true);
            setTradingMode(data.tradingMode || 'balanced');
            setSessionStats({ trades: data.todayTrades || 0, pnl: 0, startTime: data.startedAt });
            setServerStats(data);
            return;
          }
        }
      } catch {}
      // Fallback to localStorage
      const status = getAutoTradingStatus(investorId);
      if (status && status.isAutoTrading && !cancelled) {
        setTradingActive(true);
        setTradingMode(status.tradingMode || 'balanced');
        setSessionStats({ trades: status.totalTradesExecuted || 0, pnl: status.sessionPnL || 0, startTime: status.tradingStartedAt });
      }
    };
    checkServer();
    return () => { cancelled = true; };
  }, [investorId]);

  // Poll server for live trade activity + run client-side trades as visual supplement
  useEffect(() => {
    if (!tradingActive) return;
    const interval = setInterval(async () => {
      // Client-side trade for instant visual feedback
      const trade = simulateAgentTrade(investorId);
      if (trade) {
        setRecentTrades(prev => [trade, ...prev].slice(0, 8));
        setSessionStats(prev => ({
          ...prev,
          trades: prev.trades + 1,
          pnl: prev.pnl + (trade.pnl || trade.estimatedPnL || 0),
        }));
        if (onTick) onTick();
      }
      // Also poll server-side stats periodically
      try {
        const res = await fetch(`${API_BASE}/auto-trading/status`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setServerStats(data);
        }
      } catch (err) { console.warn('[TradingPanel] Server poll error:', err.message); }
    }, 5000);
    return () => clearInterval(interval);
  }, [tradingActive, investorId, onTick]);

  // Also fetch recent server-side auto-trade logs for the feed
  useEffect(() => {
    if (!tradingActive) return;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/auto-trades`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (res.ok) {
          const logs = await res.json();
          if (logs.length > 0 && recentTrades.length === 0) {
            // Seed the feed with server-side trades on initial load
            setRecentTrades(logs.slice(0, 8).map(l => ({
              agent: l.agent, symbol: l.symbol, side: l.side,
              quantity: l.quantity, price: 0, reason: l.reason,
              executedAt: new Date(l.timestamp).getTime(),
            })));
          }
        }
      } catch {}
    };
    fetchLogs();
  }, [tradingActive]);

  const handleStart = async () => {
    setIsStarting(true);
    initFundManager(investorId);
    try {
      // Enable server-side auto-trading and WAIT for confirmation
      const res = await fetch(`${API_BASE}/auto-trading/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ enabled: true, mode: tradingMode }),
      });
      if (!res.ok) throw new Error('Server toggle failed');
      const data = await res.json();
      // Server confirmed — now activate locally
      startAutoTrading(investorId, tradingMode);
      setTradingActive(true);
      setSessionStats({ trades: 0, pnl: 0, startTime: Date.now() });
      if (data.agents) setServerStats(prev => ({ ...prev, activeAgents: data.agents }));
    } catch (err) {
      console.error('Failed to start trading:', err);
      // Fallback: still try local activation so UI doesn't freeze
      startAutoTrading(investorId, tradingMode);
      setTradingActive(true);
      setSessionStats({ trades: 0, pnl: 0, startTime: Date.now() });
    }
    setIsStarting(false);
  };

  const handleStop = async () => {
    // Require explicit confirmation before stopping 24/7 trading
    if (!confirm('Are you sure you want to stop auto-trading? The AI agents will cease all trading activity until you restart.')) return;
    try {
      // Disable server-side auto-trading and wait for positions to close
      const res = await fetch(`${API_BASE}/auto-trading/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ enabled: false }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[Trading] Stopped — positions closed:', data.positionsClosed);
      }
    } catch (err) {
      console.error('Failed to stop trading on server:', err);
    }
    stopAutoTrading(investorId);
    setTradingActive(false);
  };

  const handleModeChange = (mode) => {
    setTradingMode(mode);
    const currentSettings = getFundSettings(investorId);
    updateFundSettings(investorId, { autoTrading: { ...currentSettings.autoTrading, tradingMode: mode } });
  };

  const elapsedTime = sessionStats.startTime
    ? Math.floor((Date.now() - sessionStats.startTime) / 60000)
    : 0;

  const glassStyle = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 24,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
  };

  if (!tradingActive && !isStarting) {
    return (
      <div style={{ ...glassStyle, padding: isMobile ? 24 : 32, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>
          AI Trading Engine
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 20, lineHeight: 1.6 }}>
          Activate 6 AI agents to autonomously trade stocks, crypto, forex, and more using your ${(wallet?.balance || 100000).toLocaleString()} balance.
        </div>

        {/* Mode Selection */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24 }}>
          {[
            { key: "conservative", label: "Conservative", desc: "Lower risk, steady gains" },
            { key: "balanced", label: "Balanced", desc: "Optimal risk/reward" },
            { key: "aggressive", label: "Aggressive", desc: "Higher risk, higher potential" },
          ].map(m => (
            <button key={m.key} onClick={() => setTradingMode(m.key)}
              style={{
                padding: "10px 18px", borderRadius: 14, cursor: "pointer",
                border: tradingMode === m.key ? "1px solid rgba(0,212,255,0.4)" : "1px solid rgba(255,255,255,0.04)",
                background: tradingMode === m.key ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.03)",
                color: tradingMode === m.key ? "#00D4FF" : "rgba(255,255,255,0.5)",
                fontSize: 12, fontWeight: 600, transition: "all 0.2s",
              }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Start Button */}
        <button onClick={handleStart}
          style={{
            padding: "16px 48px", borderRadius: 18, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #10B981, #00D4FF)",
            color: "#fff", fontSize: 17, fontWeight: 700, letterSpacing: 0.5,
            boxShadow: "0 4px 24px rgba(16,185,129,0.4), 0 0 60px rgba(16,185,129,0.15)",
            transition: "all 0.3s", display: "inline-flex", alignItems: "center", gap: 10,
          }}>
          <span style={{ fontSize: 20 }}>▶</span> Start AI Trading
        </button>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 12 }}>
          6 agents will begin executing trades immediately
        </div>
      </div>
    );
  }

  if (isStarting) {
    return (
      <div style={{ ...glassStyle, padding: isMobile ? 24 : 40, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16, animation: "pulse 1.5s ease-in-out infinite" }}>◉</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#00D4FF", marginBottom: 8 }}>Initializing AI Agents...</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Connecting to market data feeds and calibrating models</div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.1); } }`}</style>
      </div>
    );
  }

  // Active trading view
  return (
    <div style={{ ...glassStyle, padding: isMobile ? 16 : 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", background: "#10B981",
            boxShadow: "0 0 8px #10B981, 0 0 20px rgba(16,185,129,0.3)",
            animation: "pulse 2s ease-in-out infinite",
          }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "#10B981", textTransform: "uppercase", letterSpacing: 1.5 }}>
            AI Agents Active
          </span>
        </div>
        <button onClick={() => { haptics.heavy(); handleStop(); }}
          style={{
            padding: "8px 20px", borderRadius: 12, cursor: "pointer",
            border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)",
            color: "#EF4444", fontSize: 12, fontWeight: 600,
          }}>
          Pause Trading
        </button>
      </div>

      {/* Mode Toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {["conservative", "balanced", "aggressive"].map(m => (
          <button key={m} onClick={() => { haptics.select(); handleModeChange(m); }}
            style={{
              padding: "6px 14px", borderRadius: 10, border: "none", cursor: "pointer",
              background: tradingMode === m ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.04)",
              color: tradingMode === m ? "#00D4FF" : "rgba(255,255,255,0.4)",
              fontSize: 11, fontWeight: 600, textTransform: "capitalize",
            }}>
            {m}
          </button>
        ))}
      </div>

      {/* Server-side indicator */}
      {serverStats && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: serverStats.isActive ? "#10B981" : "#EF4444" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1 }}>
            SERVER-SIDE ENGINE: {serverStats.isActive ? 'ACTIVE' : 'INACTIVE'} | {serverStats.openPositions} positions | {serverStats.todayTrades} trades today
          </span>
        </div>
      )}

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Trades Executed", v: serverStats?.tradeCount || serverStats?.todayTrades || sessionStats.trades, c: "#00D4FF" },
          (() => {
            const pnl = serverStats
              ? ((serverStats.equity || 0) - (serverStats.initialBalance || 100000))
              : sessionStats.pnl;
            return { l: "Session P&L", v: `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, c: pnl >= 0 ? "#10B981" : "#EF4444" };
          })(),
          { l: "Time Active", v: elapsedTime < 60 ? `${elapsedTime}m` : `${Math.floor(elapsedTime / 60)}h ${elapsedTime % 60}m`, c: "rgba(255,255,255,0.7)" },
        ].map(s => (
          <div key={s.l} style={{ textAlign: "center", padding: "12px 8px", borderRadius: 14, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{s.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.c }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Live Trade Feed */}
      {recentTrades.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Live Agent Activity</div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {recentTrades.map((t, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                borderRadius: 12, marginBottom: 4,
                background: i === 0 ? "rgba(0,212,255,0.06)" : "rgba(255,255,255,0.02)",
                border: i === 0 ? "1px solid rgba(0,212,255,0.15)" : "1px solid transparent",
                opacity: i === 0 ? 1 : 0.7,
                transition: "all 0.3s",
              }}>
                <span style={{ fontSize: 16 }}>{t.agentIcon || "◆"}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.agent === 'Viper' ? '#00E676' : t.agent === 'Oracle' ? '#A855F7' : t.agent === 'Spectre' ? '#FF6B6B' : t.agent === 'Sentinel' ? '#00D4FF' : t.agent === 'Phoenix' ? '#FFD93D' : '#FF8A65' }}>
                    {t.agent}
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>{t.reason}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.side === 'BUY' ? '#10B981' : '#EF4444' }}>
                    {t.side} {t.quantity} {t.symbol}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>${t.price?.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

// ════════════════════════════════════════
//   PORTFOLIO DASHBOARD (Main Content)
// ════════════════════════════════════════

function PortfolioDashboard({ investor, onLogout }) {
  const [activeTab, setActiveTab] = useState("portfolio");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const { isMobile, isTablet } = useResponsive();
  const [adminNotifCount, setAdminNotifCount] = useState(0);

  // Fetch admin notification count (only for admins)
  useEffect(() => {
    if (investor?.role !== 'admin') return;
    const API_BASE = (() => {
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
      if (window.location.hostname === 'localhost') return 'http://localhost:4000/api';
      return 'https://one2-tribes-api.onrender.com/api';
    })();
    const token = localStorage.getItem('12tribes_auth_token');
    const fetchNotifCount = () => {
      fetch(`${API_BASE}/admin/notifications/count`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setAdminNotifCount(data.total || 0); })
        .catch(() => {});
    };
    fetchNotifCount();
    const interval = setInterval(fetchNotifCount, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [investor?.role, investor?.id]);

  // Live wallet data — refreshes every 3 seconds + records equity snapshots
  // Sync from server every 30s to keep local wallet data fresh
  useEffect(() => {
    let syncCounter = 0;
    const interval = setInterval(() => {
      tickPrices();
      syncCounter++;
      // Re-sync from server every 30 seconds (every 10th tick)
      if (syncCounter % 10 === 0) {
        syncFromServer(investor.id).catch(() => {});
      }
      const w = getWallet(investor.id);
      if (w) recordSnapshot(investor.id, w);
      setTick(t => t + 1);
    }, 3000);
    // Sync from server + record initial snapshot on mount
    syncFromServer(investor.id).then(() => {
      const w0 = getWallet(investor.id);
      if (w0) recordSnapshot(investor.id, w0);
      setTick(t => t + 1);
    }).catch(() => {});
    return () => clearInterval(interval);
  }, [investor.id]);

  const wallet = getWallet(investor.id);
  const initialBalance = wallet?.initialBalance || investor.virtualBalance || 100000;
  const currentValue = wallet?.equity || initialBalance;
  const totalGain = currentValue - initialBalance;
  const totalGainPct = initialBalance > 0 ? (totalGain / initialBalance * 100) : 0;
  const positions = getPositions(investor.id);
  const tradeHistory = getTradeHistory(investor.id);
  const portfolioHistory = useMemo(() => generatePortfolioHistory(initialBalance, 82), [investor]);
  const transactions = useMemo(() => buildActivityFromTrades(positions, tradeHistory, wallet), [positions, tradeHistory, wallet]);
  // Statements: fetched from API (real data)
  const [statements, setStatements] = useState([]);
  const [statementsLoading, setStatementsLoading] = useState(false);
  useEffect(() => {
    if (activeTab !== 'statements') return;
    setStatementsLoading(true);
    const API_BASE = (() => {
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
      if (window.location.hostname === 'localhost') return 'http://localhost:4000/api';
      return 'https://one2-tribes-api.onrender.com/api';
    })();
    const token = localStorage.getItem('12tribes_auth_token');
    fetch(`${API_BASE}/statements`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.statements) setStatements(data.statements); })
      .catch(() => {})
      .finally(() => setStatementsLoading(false));
  }, [activeTab, investor.id]);

  const firstName = investor.firstName || investor.name?.split(' ')[0] || 'Investor';
  const sidebarWidth = isMobile ? 0 : 260;

  // Dynamic allocation from open positions + trade history (all 7 asset classes)
  const allocation = useMemo(() => {
    const classColors = {
      stock: "#00D4FF", crypto: "#A855F7", forex: "#10B981",
      options: "#F59E0B", futures: "#EF4444", etf: "#3B82F6", cash: "#6B7280",
    };
    const classNames = {
      stock: "Stocks", crypto: "Crypto", forex: "Forex",
      options: "Options", futures: "Futures", etf: "ETFs", cash: "Cash",
    };
    const classifySymbol = (sym) => {
      if (['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(sym)) return 'crypto';
      if (sym && sym.includes('/')) return 'forex';
      if (sym && sym.endsWith('=F')) return 'futures';
      if (['BIL','SHV','SGOV'].includes(sym)) return 'cash';
      if (['SPY','QQQ','GLD','TLT','IWM','EEM','VOO','DIA','VTI','XLF','XLE','XLK','ARKK','HYG'].includes(sym)) return 'etf';
      if (['TQQQ','SOXL','UVXY','SPXS','SQQQ','TNA'].includes(sym)) return 'options';
      return 'stock';
    };

    const totalEquity = wallet?.equity || wallet?.balance || 100000;
    const positionsAll = positions || [];
    const trades = tradeHistory || [];

    // 1. Current open position values by asset class
    const openTotals = {};
    positionsAll.forEach(p => {
      const cls = classifySymbol(p.symbol);
      const posValue = Math.abs((p.quantity || 0) * (p.currentPrice || p.current_price || p.entryPrice || p.entry_price || 0));
      openTotals[cls] = (openTotals[cls] || 0) + posValue;
    });
    const totalOpenValue = Object.values(openTotals).reduce((s, v) => s + v, 0);

    // 2. Trade volume by asset class (from closed trade history)
    // This shows where the fund has been deploying capital across all 7 classes
    const tradeVolume = {};
    trades.forEach(t => {
      const cls = classifySymbol(t.symbol);
      const vol = Math.abs((t.quantity || 0) * (t.entryPrice || t.entry_price || 0));
      tradeVolume[cls] = (tradeVolume[cls] || 0) + vol;
    });
    const totalTradeVol = Object.values(tradeVolume).reduce((s, v) => s + v, 0);

    // 3. Blend: 60% weight on open positions, 40% on historical trade volume
    // This ensures all actively traded asset classes appear in the allocation
    const blended = {};
    const allClasses = new Set([...Object.keys(openTotals), ...Object.keys(tradeVolume)]);
    const openWeight = totalOpenValue > 0 ? 0.6 : 0;
    const histWeight = totalTradeVol > 0 ? (1 - openWeight) : 0;

    allClasses.forEach(cls => {
      const openPct = totalOpenValue > 0 ? (openTotals[cls] || 0) / totalOpenValue : 0;
      const histPct = totalTradeVol > 0 ? (tradeVolume[cls] || 0) / totalTradeVol : 0;
      blended[cls] = (openPct * openWeight) + (histPct * histWeight);
    });

    // 4. Cash = remaining equity not in open positions, scaled into the blend
    const cashFromEquity = Math.max(0, totalEquity - totalOpenValue);
    const cashPct = totalEquity > 0 ? cashFromEquity / totalEquity : 1;
    // Scale invested allocation down to make room for cash
    const investedPct = 1 - cashPct;
    const finalAlloc = {};
    Object.entries(blended).forEach(([cls, pct]) => {
      finalAlloc[cls] = pct * investedPct;
    });
    finalAlloc['cash'] = (finalAlloc['cash'] || 0) + cashPct;

    // Normalize to 100%
    const total = Object.values(finalAlloc).reduce((s, v) => s + v, 0);
    if (total <= 0) return [{ name: "Cash", value: 100, color: "#6B7280" }];

    return Object.entries(finalAlloc)
      .filter(([, v]) => v / total > 0.005) // Exclude < 0.5%
      .map(([cls, v]) => ({
        name: classNames[cls] || cls,
        value: parseFloat((v / total * 100).toFixed(1)),
        color: classColors[cls] || "#6B7280",
      }))
      .sort((a, b) => b.value - a.value);
  }, [positions, wallet, tradeHistory]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)",
      color: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
    }}>
      {/* Ambient glow */}
      <div style={{ position: "fixed", top: -200, right: -200, width: 600, height: 600, background: "radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Left Sidebar */}
      <LeftSidebar
        activeTab={activeTab} onTabChange={setActiveTab}
        investor={investor} onLogout={onLogout}
        isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)}
        isMobile={isMobile}
        adminNotifCount={adminNotifCount}
      />

      {/* Main Content (offset by sidebar width on desktop) */}
      <div style={{ marginLeft: sidebarWidth, minHeight: "100vh", transition: "margin 0.3s" }}>
        {/* Top Bar */}
        <div style={{
          ...slateGlass, borderRadius: 0, borderTop: "none", borderRight: "none",
          padding: `calc(14px + ${safeAreaTop}) ${isMobile ? 16 : 24}px 14px ${isMobile ? 16 : 24}px`, display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, zIndex: 100, gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Mobile hamburger */}
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)}
                style={{
                  background: "none", border: "none", color: "#00D4FF",
                  fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1,
                  minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 10, WebkitTapHighlightColor: "transparent",
                }}>☰</button>
            )}
            <div>
              <h1 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 700 }}>
                Welcome, <span style={{ color: "#00D4FF" }}>{firstName}</span>
              </h1>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <RefreshButton label="Sync" onRefresh={() => syncFromServer(investor.id).then(() => setTick(t => t + 1))} />
            <div style={{
              padding: "6px 14px", borderRadius: 10,
              background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
              fontSize: 11, fontWeight: 600, color: "#10B981",
            }}>
              ● Markets Open
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ padding: isMobile ? 16 : 28, maxWidth: 1100, paddingBottom: isMobile ? `calc(32px + ${safeAreaBottom})` : 40 }}>

          {/* ═══ PORTFOLIO VIEW ═══ */}
          {activeTab === "portfolio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Hero */}
              <div style={{ ...glass, padding: isMobile ? 24 : 32, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Your Portfolio Value</div>
                <div style={{ fontSize: isMobile ? 36 : 52, fontWeight: 800, lineHeight: 1 }}>${currentValue.toLocaleString()}</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: 14, color: totalGain >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                      {totalGain >= 0 ? "+" : ""}${totalGain.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>total gain</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 14, color: totalGain >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                      {totalGain >= 0 ? "+" : ""}{totalGainPct.toFixed(2)}%
                    </span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>return</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 14, color: "#A855F7", fontWeight: 600 }}>{(investor.ownershipPct || 0).toFixed(2)}%</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>ownership</span>
                  </div>
                </div>
              </div>

              {/* ─── AI TRADING CONTROLS ─── */}
              <TradingControlPanel investorId={investor.id} wallet={wallet} isMobile={isMobile} onTick={() => setTick(t => t + 1)} />

              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 14 }}>
                {[
                  { l: "Initial Deposit", v: `$${initialBalance.toLocaleString()}`, c: "rgba(255,255,255,0.6)" },
                  { l: "Realized P&L", v: `${(wallet?.realizedPnL || 0) >= 0 ? '+' : ''}$${(wallet?.realizedPnL || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, c: (wallet?.realizedPnL || 0) >= 0 ? "#10B981" : "#EF4444" },
                  { l: "Open Positions", v: `${positions.length}`, c: "#A855F7" },
                  { l: "Total Trades", v: `${wallet?.tradeCount || 0}`, c: "#00D4FF" },
                ].map(m => (
                  <div key={m.l} style={{ ...glass, padding: 18 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{m.l}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>

              {/* Chart + Allocation */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: 20 }}>
                <div style={{ ...glass, padding: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Portfolio Growth</div>
                  <div style={{ height: isMobile ? 220 : 280 }}>
                    <ResponsiveContainer>
                      <AreaChart data={portfolioHistory}>
                        <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00D4FF" stopOpacity={0.3} /><stop offset="100%" stopColor="#00D4FF" stopOpacity={0} /></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="date" stroke="rgba(255,255,255,0.3)" fontSize={10} />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                        <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} formatter={(v) => [`$${Number(v).toLocaleString()}`, "Value"]} />
                        <Area type="monotone" dataKey="value" stroke="#00D4FF" fill="url(#pg)" strokeWidth={2.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div style={{ ...glass, padding: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Allocation</div>
                  <div style={{ height: 160, marginBottom: 16 }}>
                    <ResponsiveContainer>
                      <PieChart><Pie data={allocation} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} strokeWidth={0}>{allocation.map((a, i) => <Cell key={i} fill={a.color} />)}</Pie></PieChart>
                    </ResponsiveContainer>
                  </div>
                  {allocation.map(a => (
                    <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 3, background: a.color }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", flex: 1 }}>{a.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{a.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ PERFORMANCE VIEW ═══ */}
          {activeTab === "performance" && (
            <PerformanceView investor={investor} wallet={wallet} positions={positions} tradeHistory={tradeHistory} isMobile={isMobile} />
          )}

          {/* ═══ RESEARCH VIEW ═══ */}
          {activeTab === "research" && (
            <ResearchView isMobile={isMobile} />
          )}

          {/* ═══ ACTIVITY VIEW — Live Trade Feed ═══ */}
          {activeTab === "activity" && (
            <div style={{ ...glass, padding: isMobile ? 16 : 24, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Live Activity Feed</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{transactions.length} events</div>
              </div>
              {transactions.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>◈</div>
                  <div>No activity yet. AI agents are analyzing markets.</div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 13, minWidth: isMobile ? undefined : 500 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      {["Date", "Type", "Details", "Amount"].map(h => (
                        <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "rgba(255,255,255,0.4)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(t => {
                      const typeColors = {
                        Deposit: { bg: "rgba(0,212,255,0.1)", fg: "#00D4FF" },
                        Buy: { bg: "rgba(59,130,246,0.1)", fg: "#3B82F6" },
                        Sell: { bg: "rgba(168,85,247,0.1)", fg: "#A855F7" },
                        Profit: { bg: "rgba(16,185,129,0.1)", fg: "#10B981" },
                        Loss: { bg: "rgba(239,68,68,0.1)", fg: "#EF4444" },
                      };
                      const tc = typeColors[t.type] || { bg: "rgba(255,255,255,0.05)", fg: "rgba(255,255,255,0.6)" };
                      return (
                        <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>{t.date}</td>
                          <td style={{ padding: "12px 14px" }}>
                            <span style={{ padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: tc.bg, color: tc.fg }}>{t.type}</span>
                          </td>
                          <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.6)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>{t.description}</td>
                          <td style={{ padding: "12px 14px", fontFamily: "monospace", fontWeight: 600, color: parseFloat(t.amount) >= 0 ? "#10B981" : "#EF4444", whiteSpace: "nowrap" }}>
                            {parseFloat(t.amount) >= 0 ? "+" : ""}${parseFloat(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ═══ AI AGENTS VIEW ═══ */}
          {activeTab === "agents" && (
            <AgentManagementView isMobile={isMobile} isTablet={isTablet} glass={glass} />
          )}

          {/* ═══ STATEMENTS VIEW ═══ */}
          {activeTab === "statements" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Monthly Statements</div>
                {statements.length > 0 && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                    {statements.length} month{statements.length !== 1 ? 's' : ''} of activity
                  </div>
                )}
              </div>
              {statementsLoading && (
                <div style={{ ...glass, padding: 40, textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                  Loading statements...
                </div>
              )}
              {!statementsLoading && statements.length === 0 && (
                <div style={{ ...glass, padding: 40, textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                  No statements available yet. Statements are generated once trading activity begins.
                </div>
              )}
              {statements.map(s => {
                const pnlPositive = (s.pnl || 0) >= 0;
                return (
                  <div key={s.key || s.month} style={{ ...glass, padding: 24, display: "flex", alignItems: isMobile ? "stretch" : "center", gap: 20, flexDirection: isMobile ? "column" : "row" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                        {s.month}
                        {s.isCurrent && <span style={{ fontSize: 10, color: "#00D4FF", marginLeft: 8, padding: "2px 8px", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 8 }}>CURRENT</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                        {s.tradeCount} trade{s.tradeCount !== 1 ? 's' : ''} | Win rate: {s.winRate || 0}%
                        {s.openPositions ? ` | ${s.openPositions} open positions` : ''}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 16 }}>
                      {[
                        { l: "START", v: `$${(s.startValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, c: "rgba(255,255,255,0.7)" },
                        { l: "END", v: `$${(s.endValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, c: "#fff" },
                        { l: "P&L", v: `${pnlPositive ? '+' : ''}$${(s.pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, c: pnlPositive ? "#10B981" : "#EF4444" },
                        { l: "RETURN", v: `${pnlPositive ? '+' : ''}${(s.returnPct || 0).toFixed(2)}%`, c: pnlPositive ? "#10B981" : "#EF4444" },
                      ].map(m => (
                        <div key={m.l} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>{m.l}</div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: m.c }}>{m.v}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const html = generateMonthlyStatement(s);
                        openPrintView(html);
                      }}
                      style={{ padding: "10px 20px", borderRadius: 12, border: "1px solid rgba(0,212,255,0.3)", background: "rgba(0,212,255,0.08)", color: "#00D4FF", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}
                    >
                      View PDF
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ SIGNAL TRACKER ═══ */}
          {activeTab === "signals" && (
            <SignalTracker investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ PAPER TRADING LINK ═══ */}
          {activeTab === "paper-trading" && (
            <div style={{ ...glass, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⬢</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Paper Trading Terminal</h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 24, lineHeight: 1.6 }}>
                Practice trading with $100,000 in virtual currency using real market data. Test strategies risk-free before deploying real capital.
              </p>
              <a href="/paper-trading" style={{
                display: "inline-block", padding: "14px 32px", borderRadius: 16, textDecoration: "none",
                background: "linear-gradient(135deg, #FFD93D, #FF8A65)", color: "#000",
                fontSize: 15, fontWeight: 700, boxShadow: "0 4px 16px rgba(255,217,61,0.3)",
              }}>
                Launch Paper Trading →
              </a>
            </div>
          )}

          {/* ═══ FUND MANAGEMENT VIEW ═══ */}
          {activeTab === "fund-management" && (
            <FundManagementView investorId={investor.id} wallet={wallet} isMobile={isMobile} />
          )}

          {/* ═══ TAX REPORTING CENTER ═══ */}
          {activeTab === "tax-reporting" && (
            <TaxReportingView investor={investor} wallet={wallet} isMobile={isMobile} />
          )}

          {/* ═══ MESSAGES VIEW ═══ */}
          {activeTab === "messages" && (
            <MessagesView investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ CAPITAL CALLS VIEW ═══ */}
          {activeTab === "capital-calls" && (
            <CapitalCallsView investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ FEES VIEW ═══ */}
          {activeTab === "fees" && (
            <FeesView investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ DOCUMENT VAULT VIEW ═══ */}
          {activeTab === "documents" && (
            <DocumentVaultView investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ FEEDBACK VIEW ═══ */}
          {activeTab === "feedback" && (
            <FeedbackView investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ SETTINGS VIEW ═══ */}
          {activeTab === "settings" && (
            <SettingsView investor={investor} isMobile={isMobile} />
          )}

          {/* ═══ ADMIN PANEL ═══ */}
          {activeTab === "admin" && investor?.role === 'admin' && (
            <AdminPanel investor={investor} isMobile={isMobile} />
          )}
        </div>

        {/* Footer */}
        <div style={{
          ...slateGlass, borderRadius: 0,
          borderLeft: "none", borderRight: "none", borderBottom: "none",
          padding: "16px 24px", textAlign: "center",
          fontSize: 10, letterSpacing: 1, color: "rgba(148,163,184,0.55)",
        }}>
          12 TRIBES v2.0 | AI-Powered Investment Platform | Investor Portal
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//   TAX REPORTING CENTER
// ════════════════════════════════════════

function TaxReportingView({ investor, wallet, isMobile }) {
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [activeSection, setActiveSection] = useState('summary');
  const [summary, setSummary] = useState(null);
  const [quarterly, setQuarterly] = useState([]);
  const [taxLots, setTaxLots] = useState([]);
  const [washSales, setWashSales] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const API = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();
  const token = (() => {
    try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; }
  })();
  const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  const fetchTaxData = async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, q1Res, q2Res, q3Res, q4Res, lotsRes, washRes, ledgerRes, configRes] = await Promise.all([
        fetch(`${API}/tax/summary/${taxYear}`, { headers: authHeaders }),
        fetch(`${API}/tax/quarterly/${taxYear}/Q1`, { headers: authHeaders }),
        fetch(`${API}/tax/quarterly/${taxYear}/Q2`, { headers: authHeaders }),
        fetch(`${API}/tax/quarterly/${taxYear}/Q3`, { headers: authHeaders }),
        fetch(`${API}/tax/quarterly/${taxYear}/Q4`, { headers: authHeaders }),
        fetch(`${API}/tax/lots`, { headers: authHeaders }),
        fetch(`${API}/tax/wash-sales`, { headers: authHeaders }),
        fetch(`${API}/tax/ledger?year=${taxYear}`, { headers: authHeaders }),
        fetch(`${API}/tax/config`, { headers: authHeaders }),
      ]);

      if (summaryRes.ok) { const d = await summaryRes.json(); setSummary(d.report || null); }
      const qData = [];
      for (const [i, r] of [q1Res, q2Res, q3Res, q4Res].entries()) {
        if (r.ok) { const d = await r.json(); qData.push(d.estimate || null); }
        else qData.push(null);
      }
      setQuarterly(qData.filter(Boolean));
      if (lotsRes.ok) { const d = await lotsRes.json(); setTaxLots(d.lots || []); }
      if (washRes.ok) { const d = await washRes.json(); setWashSales(d.washSales || []); }
      if (ledgerRes.ok) { const d = await ledgerRes.json(); setLedger(d.entries || []); }
      if (configRes.ok) { const d = await configRes.json(); setConfig(d.config || null); }
    } catch (e) {
      setError('Failed to load tax data. Ensure the server is running.');
    }
    setLoading(false);
  };

  useEffect(() => { fetchTaxData(); }, [taxYear]);

  const downloadCSV = () => {
    window.open(`${API}/tax/export/${taxYear}?token=${token}`, '_blank');
  };

  const glass = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 24,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
  };

  const sections = [
    { id: 'summary', label: 'Tax Summary', icon: '§' },
    { id: 'quarterly', label: 'Quarterly Est.', icon: '◔' },
    { id: 'lots', label: 'Tax Lots', icon: '▤' },
    { id: 'ledger', label: 'Ledger', icon: '▥' },
    { id: 'wash-sales', label: 'Wash Sales', icon: '⚠' },
  ];

  const sd = summary?.scheduleD || {};
  const f8949 = summary?.form8949 || { partI: [], partII: [] };
  const totalTx = summary?.totalTransactions || 0;
  const washCount = summary?.washSaleCount || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>§ Tax Reporting Center</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              IRS Form 8949 & Schedule D — Cost Basis: {config?.costBasisMethod || 'FIFO'}
              {config?.enableWashSaleDetection && ' — Wash Sale Detection: ON'}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={taxYear} onChange={e => setTaxYear(parseInt(e.target.value))} style={{
              padding: "10px 16px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(30,30,34,0.9)", color: "#fff", fontSize: 14, fontWeight: 700, outline: "none", cursor: "pointer",
            }}>
              {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <RefreshButton onRefresh={fetchTaxData} />
            <button onClick={downloadCSV} style={{
              padding: "10px 20px", borderRadius: 14, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff",
              fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
            }}>
              Export CSV
            </button>
          </div>
        </div>

        {/* Section Tabs */}
        <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
              padding: "8px 16px", borderRadius: 12, cursor: "pointer",
              border: activeSection === s.id ? "1px solid rgba(0,212,255,0.3)" : "1px solid rgba(255,255,255,0.04)",
              background: activeSection === s.id ? "rgba(0,212,255,0.1)" : "rgba(255,255,255,0.03)",
              color: activeSection === s.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
              fontSize: 12, fontWeight: 600, transition: "all 0.15s",
            }}>{s.icon} {s.label}</button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ ...glass, padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>Loading tax data...</div>
      )}
      {error && (
        <div style={{ ...glass, padding: 20, color: "#EF4444", fontSize: 13, background: "rgba(239,68,68,0.06)" }}>{error}</div>
      )}

      {/* ═══ TAX SUMMARY (Schedule D) ═══ */}
      {!loading && activeSection === 'summary' && (
        <>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 12 }}>
            {[
              { label: "Net Gain/Loss", value: sd.netGainLoss, prefix: "$", color: (sd.netGainLoss || 0) >= 0 ? "#10B981" : "#EF4444" },
              { label: "Short-Term G/L", value: sd.shortTermGainLoss, prefix: "$", color: (sd.shortTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444" },
              { label: "Long-Term G/L", value: sd.longTermGainLoss, prefix: "$", color: (sd.longTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444" },
              { label: "Transactions", value: totalTx, prefix: "", color: "#00D4FF" },
            ].map((kpi, i) => (
              <div key={i} style={{ ...glass, padding: isMobile ? 16 : 20, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{kpi.label}</div>
                <div style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, color: kpi.color }}>
                  {kpi.prefix}{typeof kpi.value === 'number' ? kpi.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}
                </div>
              </div>
            ))}
          </div>

          {/* Schedule D Breakdown */}
          <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Schedule D Summary</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
              {/* Part I — Short-Term */}
              <div style={{ padding: 20, borderRadius: 18, background: "rgba(255,138,101,0.06)", border: "1px solid rgba(255,138,101,0.12)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#FF8A65", marginBottom: 12 }}>Part I — Short-Term (Box A)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>Proceeds</span>
                    <span style={{ color: "#fff", fontWeight: 600 }}>${(sd.shortTermProceeds || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>Cost Basis</span>
                    <span style={{ color: "#fff", fontWeight: 600 }}>${(sd.shortTermCostBasis || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  {(sd.shortTermAdjustments || 0) !== 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "#F59E0B" }}>Wash Sale Adj. (Code W)</span>
                      <span style={{ color: "#F59E0B", fontWeight: 600 }}>${(sd.shortTermAdjustments || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>Gain/Loss</span>
                    <span style={{ color: (sd.shortTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", fontWeight: 700 }}>${(sd.shortTermGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
              {/* Part II — Long-Term */}
              <div style={{ padding: 20, borderRadius: 18, background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.12)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#00D4FF", marginBottom: 12 }}>Part II — Long-Term (Box D)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>Proceeds</span>
                    <span style={{ color: "#fff", fontWeight: 600 }}>${(sd.longTermProceeds || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>Cost Basis</span>
                    <span style={{ color: "#fff", fontWeight: 600 }}>${(sd.longTermCostBasis || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  {(sd.longTermAdjustments || 0) !== 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "#F59E0B" }}>Wash Sale Adj. (Code W)</span>
                      <span style={{ color: "#F59E0B", fontWeight: 600 }}>${(sd.longTermAdjustments || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>Gain/Loss</span>
                    <span style={{ color: (sd.longTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", fontWeight: 700 }}>${(sd.longTermGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>
            {washCount > 0 && (
              <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 14, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 16 }}>⚠</span>
                <span style={{ fontSize: 12, color: "#F59E0B" }}>{washCount} wash sale event{washCount > 1 ? 's' : ''} detected — disallowed losses added to replacement lot cost basis</span>
              </div>
            )}
            <div style={{ marginTop: 16, fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.6 }}>
              This data is generated for informational purposes. Consult your CPA or tax advisor for official filings. Form 8949 line items available via CSV export.
            </div>
          </div>
        </>
      )}

      {/* ═══ QUARTERLY ESTIMATES ═══ */}
      {!loading && activeSection === 'quarterly' && (
        <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Quarterly Estimated Tax</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>For 1040-ES estimated payments</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 12 }}>
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => {
              const qd = quarterly[i] || {};
              const isActive = qd.tradeCount > 0;
              return (
                <div key={q} style={{
                  padding: 20, borderRadius: 18,
                  background: isActive ? "rgba(168,85,247,0.06)" : "rgba(255,255,255,0.02)",
                  border: isActive ? "1px solid rgba(168,85,247,0.15)" : "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: isActive ? "#A855F7" : "rgba(255,255,255,0.2)" }}>{q} {taxYear}</div>
                    {isActive && <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(168,85,247,0.15)", color: "#A855F7", fontWeight: 600 }}>{qd.tradeCount} trades</span>}
                  </div>
                  {isActive ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Short-Term G/L</span>
                        <span style={{ color: (qd.shortTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>${(qd.shortTermGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Long-Term G/L</span>
                        <span style={{ color: (qd.longTermGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>${(qd.longTermGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Net G/L</span>
                        <span style={{ color: (qd.netGainLoss || 0) >= 0 ? "#10B981" : "#EF4444", fontWeight: 700 }}>${(qd.netGainLoss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                      {(qd.washSaleAdjustments || 0) > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                          <span style={{ color: "#F59E0B" }}>Wash Sale Adj.</span>
                          <span style={{ color: "#F59E0B", fontWeight: 600 }}>${qd.washSaleAdjustments.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 12, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.1)" }}>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>ESTIMATED TAX DUE</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: (qd.estimatedTotalTax || 0) > 0 ? "#EF4444" : "rgba(255,255,255,0.3)" }}>
                          ${(qd.estimatedTotalTax || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                          ST: ${(qd.estimatedShortTermTax || 0).toLocaleString()} | LT: ${(qd.estimatedLongTermTax || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "16px 0" }}>No trading activity</div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16, fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.6 }}>
            Estimated tax uses approximate rates (32% short-term, 15% long-term). Your actual rate depends on your total income. Consult your CPA for precise 1040-ES payment amounts.
          </div>
        </div>
      )}

      {/* ═══ TAX LOTS ═══ */}
      {!loading && activeSection === 'lots' && (
        <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Tax Lots — Cost Basis Tracking</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{config?.costBasisMethod || 'FIFO'} method — {taxLots.length} lot{taxLots.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          {taxLots.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
              No tax lots recorded yet. Lots are created when trades execute.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {taxLots.slice(0, 50).map(lot => {
                const statusColor = lot.status === 'OPEN' ? '#10B981' : lot.status === 'PARTIAL' ? '#F59E0B' : 'rgba(255,255,255,0.3)';
                return (
                  <div key={lot.id} style={{
                    padding: isMobile ? 14 : 16, borderRadius: 16,
                    background: "rgba(30,30,34,0.5)", border: "1px solid rgba(255,255,255,0.06)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{lot.symbol}</span>
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700,
                          background: lot.side === 'LONG' ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                          color: lot.side === 'LONG' ? "#10B981" : "#EF4444",
                        }}>{lot.side}</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 600, background: `${statusColor}18`, color: statusColor }}>{lot.status}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{lot.agent}</span>
                    </div>
                    <div style={{ display: "flex", gap: isMobile ? 12 : 20, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                      <span>Qty: <b style={{ color: "#fff" }}>{lot.quantity}</b></span>
                      <span>Basis: <b style={{ color: "#fff" }}>${(lot.adjusted_cost_basis || lot.cost_basis || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
                      <span>Per Unit: <b style={{ color: "#fff" }}>${(lot.price_per_unit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
                      {lot.wash_sale_adjustment > 0 && (
                        <span style={{ color: "#F59E0B" }}>Wash Adj: +${lot.wash_sale_adjustment.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      )}
                      <span>{new Date(lot.acquired_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
              {taxLots.length > 50 && <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)", padding: 8 }}>Showing 50 of {taxLots.length} lots — export CSV for full data</div>}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAX LEDGER ═══ */}
      {!loading && activeSection === 'ledger' && (
        <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Immutable Tax Ledger</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>{ledger.length} entries for {taxYear}</div>
          {ledger.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)", fontSize: 13 }}>No ledger entries for {taxYear}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ledger.slice(0, 100).map(e => (
                <div key={e.id} style={{
                  padding: isMobile ? 14 : 16, borderRadius: 16,
                  background: e.is_wash_sale ? "rgba(245,158,11,0.04)" : "rgba(30,30,34,0.5)",
                  border: e.is_wash_sale ? "1px solid rgba(245,158,11,0.12)" : "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{e.symbol}</span>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>{e.holding_period === 'SHORT_TERM' ? 'ST' : 'LT'}</span>
                      {e.is_wash_sale && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>WASH SALE</span>}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: e.adjusted_gain_loss >= 0 ? "#10B981" : "#EF4444" }}>
                      {e.adjusted_gain_loss >= 0 ? '+' : ''}${e.adjusted_gain_loss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: isMobile ? 10 : 16, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                    <span>Qty: {e.quantity}</span>
                    <span>Proceeds: ${e.proceeds.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    <span>Basis: ${e.cost_basis.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    <span>Hold: {e.hold_days}d</span>
                    <span>{new Date(e.disposed_at).toLocaleDateString()}</span>
                    {e.agent && <span>{e.agent}</span>}
                  </div>
                </div>
              ))}
              {ledger.length > 100 && <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)", padding: 8 }}>Showing 100 of {ledger.length} — export CSV for full data</div>}
            </div>
          )}
        </div>
      )}

      {/* ═══ WASH SALES ═══ */}
      {!loading && activeSection === 'wash-sales' && (
        <div style={{ ...glass, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F59E0B", marginBottom: 4 }}>⚠ Wash Sale Events</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
            Losses disallowed under IRS 30-day wash sale rule — added to replacement lot cost basis
          </div>
          {washSales.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
              No wash sale events detected. This is good — all losses are currently deductible.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {washSales.map(ws => (
                <div key={ws.id} style={{
                  padding: 16, borderRadius: 16,
                  background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{ws.symbol}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#F59E0B" }}>−${ws.disallowed_loss.toLocaleString(undefined, { maximumFractionDigits: 2 })} disallowed</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                    <span>Original Loss: ${Math.abs(ws.original_loss).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    <span>Loss Date: {new Date(ws.loss_disposed_at).toLocaleDateString()}</span>
                    <span>Replacement: {new Date(ws.replacement_acquired_at).toLocaleDateString()}</span>
                    <span>Detected: {new Date(ws.detected_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//   FEEDBACK VIEW — Submit & View Feedback
// ════════════════════════════════════════

const FEEDBACK_CATEGORIES = [
  { id: 'general', label: 'General', icon: '💬' },
  { id: 'feature', label: 'Feature Request', icon: '✨' },
  { id: 'bug', label: 'Bug Report', icon: '🐛' },
  { id: 'ui', label: 'UI/UX', icon: '🎨' },
  { id: 'performance', label: 'Performance', icon: '⚡' },
  { id: 'other', label: 'Other', icon: '📋' },
];

function FeedbackView({ investor, isMobile }) {
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [myFeedback, setMyFeedback] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const API = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();
  const token = (() => {
    try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; }
  })();

  useEffect(() => {
    fetchMyFeedback();
  }, []);

  const fetchMyFeedback = async () => {
    try {
      const r = await fetch(`${API}/feedback`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const data = await r.json();
        setMyFeedback(data.feedback || []);
      }
    } catch {}
    setLoadingHistory(false);
  };

  const handleSubmit = async () => {
    if (!message.trim()) { haptics.error(); setError('Please enter your feedback'); return; }
    haptics.heavy();
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch(`${API}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ category, message: message.trim(), rating: rating || null }),
      });
      const data = await r.json();
      if (r.ok) {
        haptics.success();
        setSubmitted(true);
        setMessage('');
        setRating(0);
        setCategory('general');
        fetchMyFeedback();
        setTimeout(() => setSubmitted(false), 4000);
      } else {
        haptics.error();
        setError(data.error || 'Failed to submit feedback');
      }
    } catch { haptics.error(); setError('Network error. Please try again.'); }
    setSubmitting(false);
  };

  const handleDelete = async (fbId) => {
    if (!confirm('Delete this feedback? This cannot be undone.')) return;
    haptics.heavy();
    setDeletingId(fbId);
    try {
      const r = await fetch(`${API}/feedback/${fbId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        haptics.success();
        setMyFeedback(prev => prev.filter(f => f.id !== fbId));
      } else {
        haptics.error();
        const data = await r.json().catch(() => ({}));
        alert(data.error || 'Failed to delete feedback');
      }
    } catch { haptics.error(); alert('Network error. Please try again.'); }
    setDeletingId(null);
  };

  const glassStyle = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 24,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
  };

  const statusColors = {
    new: { bg: 'rgba(0,212,255,0.1)', color: '#00D4FF', label: 'New' },
    reviewed: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7', label: 'Reviewed' },
    resolved: { bg: 'rgba(34,197,94,0.1)', color: '#22C55E', label: 'Resolved' },
    declined: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444', label: 'Declined' },
  };

  return (
    <div style={{ padding: isMobile ? "16px 12px" : "24px 32px", maxWidth: 800 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Feedback</h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 24 }}>
        Help us improve the platform. Your feedback goes directly to the team.
      </p>

      {/* Submit Feedback Card */}
      <div style={{ ...glassStyle, padding: isMobile ? 20 : 28, marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Submit Feedback</div>

        {/* Category Selection */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Category</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {FEEDBACK_CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => setCategory(cat.id)} style={{
                padding: "8px 14px", borderRadius: 12, cursor: "pointer",
                border: category === cat.id ? "1px solid rgba(0,212,255,0.3)" : "1px solid rgba(255,255,255,0.06)",
                background: category === cat.id ? "rgba(0,212,255,0.1)" : "rgba(30,30,34,0.6)",
                color: category === cat.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
                fontSize: 12, fontWeight: 600, transition: "all 0.15s",
              }}>
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rating */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Rating (optional)</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3, 4, 5].map(star => (
              <button key={star} onClick={() => setRating(star === rating ? 0 : star)} style={{
                width: 36, height: 36, borderRadius: 10, cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.06)",
                background: star <= rating ? "rgba(255,186,0,0.15)" : "rgba(30,30,34,0.6)",
                color: star <= rating ? "#FFBA00" : "rgba(255,255,255,0.2)",
                fontSize: 16, transition: "all 0.15s",
              }}>★</button>
            ))}
          </div>
        </div>

        {/* Message */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Your Feedback</div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Tell us what you think, report an issue, or suggest an improvement..."
            maxLength={2000}
            style={{
              width: "100%", minHeight: 120, padding: "14px 16px", borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.04)", background: "rgba(30,30,34,0.9)",
              color: "#fff", fontSize: 14, outline: "none", resize: "vertical",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4, textAlign: "right" }}>
            {message.length}/2000
          </div>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(239,68,68,0.1)", color: "#EF4444", fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {submitted && (
          <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(34,197,94,0.1)", color: "#22C55E", fontSize: 12, marginBottom: 12 }}>
            ✓ Feedback submitted successfully. Thank you!
          </div>
        )}

        <button onClick={handleSubmit} disabled={submitting || !message.trim()} style={{
          width: "100%", padding: "14px 0", borderRadius: 14, border: "none", cursor: submitting ? "wait" : "pointer",
          background: message.trim() ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "rgba(255,255,255,0.06)",
          color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
          opacity: submitting ? 0.6 : 1,
        }}>
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </div>

      {/* Previous Feedback */}
      <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Your Submissions</div>
          <RefreshButton onRefresh={fetchMyFeedback} />
        </div>
        {loadingHistory ? (
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, textAlign: "center", padding: 20 }}>Loading...</div>
        ) : myFeedback.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 13, textAlign: "center", padding: 30 }}>
            No feedback submitted yet. We'd love to hear from you!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {myFeedback.map(fb => {
              const sc = statusColors[fb.status] || statusColors.new;
              const cat = FEEDBACK_CATEGORIES.find(c => c.id === fb.category);
              return (
                <div key={fb.id} style={{
                  padding: "14px 16px", borderRadius: 16,
                  background: "rgba(30,30,34,0.6)", border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600 }}>{sc.label}</span>
                      {cat && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{cat.icon} {cat.label}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                        {new Date(fb.createdAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleDelete(fb.id)}
                        disabled={deletingId === fb.id}
                        style={{
                          padding: "4px 10px", borderRadius: 8, cursor: deletingId === fb.id ? "wait" : "pointer",
                          border: "1px solid rgba(239,68,68,0.15)", background: "rgba(239,68,68,0.08)",
                          color: "#EF4444", fontSize: 10, fontWeight: 600, transition: "all 0.15s",
                          opacity: deletingId === fb.id ? 0.5 : 1,
                        }}
                      >
                        {deletingId === fb.id ? '...' : '✕ Delete'}
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                    {fb.message}
                  </div>
                  {fb.rating > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#FFBA00" }}>
                      {'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}
                    </div>
                  )}
                  {fb.adminNotes && (
                    <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}>
                      <div style={{ fontSize: 10, color: "#A855F7", fontWeight: 600, marginBottom: 4 }}>Admin Response</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>{fb.adminNotes}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


// ════════════════════════════════════════
// ════════════════════════════════════════
//   NOTIFICATIONS SECTION (Settings)
// ════════════════════════════════════════

const EMAIL_NOTIF_CONFIG = [
  {
    key: "trade_confirmations",
    label: "Trade Confirmations",
    description: "Email every time a trade is executed on your account",
    icon: "⚡",
    color: "#00D4FF",
  },
  {
    key: "account_updates",
    label: "Account Updates",
    description: "Balance changes, ownership adjustments, and capital account events",
    icon: "💼",
    color: "#A855F7",
  },
  {
    key: "announcements",
    label: "Platform Announcements",
    description: "Fund news, strategy updates, and important notices from 12 Tribes",
    icon: "📣",
    color: "#F59E0B",
  },
  {
    key: "onboarding",
    label: "Onboarding & Welcome",
    description: "Account setup confirmations and platform onboarding messages",
    icon: "🏛️",
    color: "#10B981",
  },
];

const API_BASE_NOTIF = (() => {
  try {
    if (import.meta?.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    const host = window.location.hostname;
    return host === 'localhost' ? 'http://localhost:4000/api' : 'https://one2-tribes-api.onrender.com/api';
  } catch { return 'https://one2-tribes-api.onrender.com/api'; }
})();

function NotificationsSection({ investor }) {
  // Push notification state
  const [permState, setPermState] = useState(getPermissionState());
  const [testSent, setTestSent] = useState(false);
  const supported = isPushSupported();

  // Email notification prefs
  const [emailPrefs, setEmailPrefs] = useState({
    trade_confirmations: false,
    account_updates: false,
    announcements: false,
    onboarding: true,
  });
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null); // key currently being saved
  const [saveMsg, setSaveMsg] = useState(null); // { type, text }

  // Load prefs on mount
  useEffect(() => {
    if (!investor) return;
    const token = (() => { try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; } })();
    if (!token) { setPrefsLoading(false); return; }
    fetch(`${API_BASE_NOTIF}/auth/notification-prefs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (data.prefs) setEmailPrefs(data.prefs); })
      .catch(() => {})
      .finally(() => setPrefsLoading(false));
  }, [investor]);

  const handleToggle = async (key) => {
    haptics.medium();
    const newVal = !emailPrefs[key];
    const updated = { ...emailPrefs, [key]: newVal };
    setEmailPrefs(updated);
    setSavingKey(key);
    setSaveMsg(null);
    try {
      const token = (() => { try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; } })();
      const resp = await fetch(`${API_BASE_NOTIF}/auth/notification-prefs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prefs: updated }),
      });
      const data = await resp.json();
      if (data.success) {
        haptics.success();
        setSaveMsg({ type: 'success', text: `${EMAIL_NOTIF_CONFIG.find(c => c.key === key)?.label} ${newVal ? 'enabled' : 'disabled'}` });
      } else {
        // Revert on failure
        setEmailPrefs(prev => ({ ...prev, [key]: !newVal }));
        haptics.error();
        setSaveMsg({ type: 'error', text: data.error || 'Failed to save preference' });
      }
    } catch {
      setEmailPrefs(prev => ({ ...prev, [key]: !newVal }));
      haptics.error();
      setSaveMsg({ type: 'error', text: 'Network error — preference not saved' });
    }
    setSavingKey(null);
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const handleEnable = async () => {
    haptics.medium();
    const result = await requestPermission();
    setPermState(result);
    if (result === 'granted') haptics.success(); else haptics.error();
  };

  const handleTest = async () => {
    haptics.medium();
    await pushNotify.systemAlert("Notifications are working! You'll receive trade alerts, signals, and portfolio updates here.");
    setTestSent(true);
    haptics.success();
    setTimeout(() => setTestSent(false), 3000);
  };

  const sectionStyle = { ...glass, padding: 28, marginBottom: 2, borderRadius: 20 };
  const dividerStyle = { height: 1, background: "rgba(255,255,255,0.06)", margin: "20px 0" };

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>🔔</span> Notifications
      </div>

      {/* ─── EMAIL NOTIFICATIONS ─── */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16 }}>
          Email Notifications
        </div>

        {prefsLoading ? (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", padding: "12px 0" }}>Loading preferences…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {EMAIL_NOTIF_CONFIG.map(cfg => {
              const isOn = !!emailPrefs[cfg.key];
              const isSaving = savingKey === cfg.key;
              return (
                <div key={cfg.key} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 16px", borderRadius: 16,
                  background: isOn ? `${cfg.color}08` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isOn ? cfg.color + '25' : 'rgba(255,255,255,0.06)'}`,
                  transition: "all 0.2s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: isOn ? `${cfg.color}18` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${isOn ? cfg.color + '30' : 'rgba(255,255,255,0.08)'}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, transition: "all 0.2s",
                    }}>{cfg.icon}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: isOn ? "#fff" : "rgba(255,255,255,0.65)", marginBottom: 2 }}>{cfg.label}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>{cfg.description}</div>
                    </div>
                  </div>
                  {/* Toggle switch */}
                  <button
                    onClick={() => !isSaving && handleToggle(cfg.key)}
                    disabled={isSaving}
                    style={{
                      position: "relative", width: 48, height: 28, borderRadius: 14,
                      border: "none", cursor: isSaving ? "wait" : "pointer", flexShrink: 0,
                      background: isOn ? `linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)` : "rgba(255,255,255,0.1)",
                      transition: "all 0.25s", boxShadow: isOn ? `0 2px 12px ${cfg.color}40` : "none",
                      opacity: isSaving ? 0.6 : 1,
                    }}
                  >
                    <span style={{
                      position: "absolute", top: 4, left: isOn ? 24 : 4,
                      width: 20, height: 20, borderRadius: "50%",
                      background: "#fff", transition: "left 0.25s",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                    }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {saveMsg && (
          <div style={{
            marginTop: 12, fontSize: 13, padding: "8px 14px", borderRadius: 10,
            color: saveMsg.type === 'success' ? "#10B981" : "#EF4444",
            background: saveMsg.type === 'success' ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${saveMsg.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>
            {saveMsg.type === 'success' ? '✓' : '✗'} {saveMsg.text}
          </div>
        )}
      </div>

      <div style={dividerStyle} />

      {/* ─── PUSH NOTIFICATIONS ─── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16 }}>
          Push Notifications
        </div>

        {!supported ? (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
            Push notifications are not supported on this device/browser. Install the app as a PWA for notification support.
          </div>
        ) : permState === 'granted' ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
              <span style={{ fontSize: 14, color: "#10B981", fontWeight: 600 }}>Push Enabled</span>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.6 }}>
              You'll receive real-time alerts for trade executions, new signals, and risk events on your device.
            </p>
            <button onClick={handleTest} style={{
              padding: "12px 20px", borderRadius: 14, border: "1px solid rgba(0,212,255,0.3)",
              background: testSent ? "rgba(16,185,129,0.15)" : "rgba(0,212,255,0.08)",
              color: testSent ? "#10B981" : "#00D4FF", fontSize: 13, fontWeight: 600,
              cursor: "pointer", transition: "all 0.2s",
            }}>
              {testSent ? '✓ Test Sent' : 'Send Test Notification'}
            </button>
          </div>
        ) : permState === 'denied' ? (
          <div style={{ fontSize: 13, color: "rgba(239,68,68,0.8)", lineHeight: 1.6 }}>
            Push notifications are blocked. To enable them, open your browser settings and allow notifications for this site.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.6 }}>
              Enable push notifications to receive real-time trade alerts, signal updates, and risk warnings directly on your device.
            </p>
            <button onClick={handleEnable} style={{
              padding: "14px 20px", borderRadius: 14, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
              fontSize: 14, fontWeight: 600, transition: "all 0.2s",
              boxShadow: "0 4px 16px rgba(0,212,255,0.25)",
            }}>
              Enable Push Notifications
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

//   SETTINGS VIEW — Password, 2FA, Account
// ════════════════════════════════════════

// ════════════════════════════════════════
//   APPEARANCE / THEME SELECTOR
// ════════════════════════════════════════

function AppearanceSection({ glass, sectionStyle, isMobile }) {
  const [preference, setPreference] = useState(() => getThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState(() => getTheme());

  const handleThemeChange = (themeId) => {
    haptics.medium();
    setTheme(themeId);
    setPreference(themeId);
    setResolvedTheme(themeId === 'auto' ? getTheme() : themeId);
  };

  // Listen for system changes when in auto mode
  useEffect(() => {
    if (preference !== 'auto') return;
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handler = () => setResolvedTheme(getTheme());
    mql?.addEventListener?.('change', handler);
    return () => mql?.removeEventListener?.('change', handler);
  }, [preference]);

  const options = [
    { id: 'auto', label: 'Automatic' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ];

  const activeIdx = options.findIndex(o => o.id === preference);

  // iPhone-accurate screen data
  const previews = [
    { id: 'auto', screens: [
      { bg: '#0f1225', isLight: false, accent: '#00D4FF', lines: ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.05)'] },
      { bg: '#F2F4F8', isLight: true,  accent: '#0077CC', lines: ['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.03)'] },
    ]},
    { id: 'dark', screens: [
      { bg: '#0f1225', isLight: false, accent: '#00D4FF', lines: ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.05)'] },
    ]},
    { id: 'light', screens: [
      { bg: '#F2F4F8', isLight: true,  accent: '#0077CC', lines: ['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.03)'] },
    ]},
  ];

  // Authentic iPhone mockup — matches iOS Settings > Display & Brightness exactly
  const iPhoneFrame = ({ screen, w, h }) => {
    const isDark = !screen.isLight;
    const deviceBorder = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)';
    const islandBg = '#000';
    const statusFg = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
    const homePill = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
    const cardBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
    const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const r = Math.round(w * 0.2);
    return (
      <div style={{
        width: w, height: h,
        borderRadius: r,
        background: screen.bg,
        border: `1.5px solid ${deviceBorder}`,
        boxShadow: `0 6px 24px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.16), inset 0 0.5px 0 rgba(255,255,255,0.1)`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Dynamic Island */}
        <div style={{ height: Math.round(h * 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 5, flexShrink: 0 }}>
          <div style={{ width: Math.round(w * 0.34), height: Math.round(h * 0.055), borderRadius: 99, background: islandBg }} />
        </div>

        {/* Status bar — time left, icons right */}
        <div style={{ height: Math.round(h * 0.075), display: 'flex', alignItems: 'center', padding: `0 ${Math.round(w * 0.12)}px`, justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ width: Math.round(w * 0.22), height: 2.5, borderRadius: 1.5, background: statusFg }} />
          <div style={{ display: 'flex', gap: 2.5, alignItems: 'center' }}>
            <div style={{ width: 10, height: 5, borderRadius: 1, background: screen.accent, opacity: 0.75 }} />
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: statusFg, opacity: 0.7 }} />
            <div style={{ width: 7, height: 5, borderRadius: 1, border: `1px solid ${statusFg}`, opacity: 0.6 }}>
              <div style={{ width: '70%', height: '100%', background: statusFg, borderRadius: 0.5 }} />
            </div>
          </div>
        </div>

        {/* App content area */}
        <div style={{ flex: 1, padding: `${Math.round(h * 0.04)}px ${Math.round(w * 0.1)}px`, display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.04) }}>
          {/* Header block */}
          <div style={{ height: Math.round(h * 0.1), borderRadius: Math.round(w * 0.06), background: screen.lines[0] }} />
          {/* Sub-lines */}
          <div style={{ height: Math.round(h * 0.065), borderRadius: Math.round(w * 0.04), background: screen.lines[1], width: '78%' }} />
          <div style={{ height: Math.round(h * 0.065), borderRadius: Math.round(w * 0.04), background: screen.lines[2], width: '55%' }} />
          {/* Card */}
          <div style={{ flex: 1, borderRadius: Math.round(w * 0.08), background: cardBg, border: `0.5px solid ${cardBorder}`, marginTop: Math.round(h * 0.02), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '60%', height: Math.round(h * 0.055), borderRadius: 99, background: screen.accent, opacity: 0.7 }} />
          </div>
        </div>

        {/* Home indicator */}
        <div style={{ height: Math.round(h * 0.08), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: Math.round(w * 0.32), height: 3, borderRadius: 1.5, background: homePill }} />
        </div>
      </div>
    );
  };

  // iOS-blue for selected indicator — matches Settings.app exactly
  const IOS_BLUE = '#007AFF';
  const fw = isMobile ? 52 : 62;
  const fh = isMobile ? 104 : 124;

  return (
    <div style={{ ...sectionStyle }}>
      {/* Section title — matches iOS Settings section header style */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 18 }}>Appearance</div>

      {/* Appearance thumbnails — iPhone Settings > Display & Brightness layout */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: isMobile ? 18 : 28, marginBottom: 28 }}>
        {previews.map(p => {
          const isActive = preference === p.id;
          return (
            <button
              key={p.id}
              onClick={() => handleThemeChange(p.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', outline: 'none',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
                padding: 0,
                WebkitTapHighlightColor: 'transparent',
                transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isActive ? 'scale(1.06)' : 'scale(0.96)',
              }}
            >
              {/* Device frame(s) */}
              <div style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'flex-end',
                // Active: subtle blue ring behind device
                filter: isActive ? `drop-shadow(0 0 8px rgba(0,122,255,0.45))` : 'none',
                transition: 'filter 0.3s ease',
              }}>
                {p.screens.length === 1 ? (
                  iPhoneFrame({ screen: p.screens[0], w: fw, h: fh })
                ) : (
                  // Automatic: two phones slightly overlapping at angle
                  <>
                    <div style={{ transform: 'rotate(-6deg) translateX(6px)', zIndex: 1, transformOrigin: 'bottom center' }}>
                      {iPhoneFrame({ screen: p.screens[0], w: fw - 8, h: fh - 16 })}
                    </div>
                    <div style={{ transform: 'rotate(6deg) translateX(-6px)', zIndex: 2, transformOrigin: 'bottom center' }}>
                      {iPhoneFrame({ screen: p.screens[1], w: fw - 8, h: fh - 16 })}
                    </div>
                  </>
                )}
              </div>

              {/* Label — same weight/size as iOS Settings */}
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
                transition: 'color 0.2s ease',
                letterSpacing: 0.1,
              }}>
                {options.find(o => o.id === p.id)?.label}
              </span>

              {/* iOS-style radio — filled blue circle + white checkmark when active */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: isActive ? IOS_BLUE : 'transparent',
                border: isActive ? `none` : `1.5px solid rgba(255,255,255,0.22)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isActive ? 'scale(1)' : 'scale(0.9)',
                boxShadow: isActive ? `0 2px 8px rgba(0,122,255,0.5)` : 'none',
              }}>
                {isActive && (
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M2.2 5.8L4.4 8L8.8 3" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* iOS-authentic segmented control — white pill on system gray track */}
      <div style={{
        position: 'relative',
        display: 'flex',
        background: 'rgba(118,118,128,0.18)',
        borderRadius: 10,
        padding: 2,
      }}>
        {/* Sliding white pill */}
        <div style={{
          position: 'absolute',
          top: 2,
          left: `calc(${(activeIdx / options.length) * 100}% + 2px)`,
          width: `calc(${100 / options.length}% - 4px)`,
          height: 'calc(100% - 4px)',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.14)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2), 0 0.5px 0 rgba(255,255,255,0.12)',
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 1,
        }} />
        {options.map((opt) => {
          const isActive = preference === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handleThemeChange(opt.id)}
              style={{
                flex: 1, position: 'relative', zIndex: 2,
                padding: '7px 0', border: 'none', background: 'transparent',
                cursor: 'pointer', outline: 'none',
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                transition: 'color 0.2s ease',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}


function SettingsView({ investor, isMobile }) {
  // Password Change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState(null); // { type: "success"|"error", text }
  const [pwLoading, setPwLoading] = useState(false);

  // 2FA Setup
  const [twoFASetupMode, setTwoFASetupMode] = useState(false);
  const [twoFASecret, setTwoFASecret] = useState(null);
  const [twoFAOtpUrl, setTwoFAOtpUrl] = useState(null);
  const [twoFACode, setTwoFACode] = useState("");
  const [twoFAMsg, setTwoFAMsg] = useState(null);
  const [backupCodes, setBackupCodes] = useState(null);
  const [twoFAEnabled, setTwoFAEnabled] = useState(is2FAEnabled(investor.email));

  // Passkey Management
  const [passkeyCredentials, setPasskeyCredentials] = useState([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState(null);
  const [passkeyHasKey, setPasskeyHasKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPasskeyStatus().then(data => {
      if (cancelled) return;
      setPasskeyHasKey(data.hasPasskey);
      setPasskeyCredentials(data.credentials || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleRegisterPasskey = async () => {
    haptics.medium();
    setPasskeyMsg(null);
    setPasskeyLoading(true);
    const result = await registerPasskey(investor.email);
    setPasskeyLoading(false);
    if (result.success) {
      haptics.success();
      setPasskeyMsg({ type: "success", text: "Passkey created successfully! You can now sign in with biometrics." });
      setPasskeyHasKey(true);
      // Refresh credential list
      const status = await getPasskeyStatus();
      setPasskeyCredentials(status.credentials || []);
    } else {
      setPasskeyMsg({ type: "error", text: result.error });
    }
  };

  const handleRemovePasskey = async (credentialId) => {
    setPasskeyMsg(null);
    setPasskeyLoading(true);
    const result = await removePasskey(credentialId);
    setPasskeyLoading(false);
    if (result.success) {
      setPasskeyMsg({ type: "success", text: "Passkey removed." });
      const status = await getPasskeyStatus();
      setPasskeyHasKey(status.hasPasskey);
      setPasskeyCredentials(status.credentials || []);
    } else {
      setPasskeyMsg({ type: "error", text: result.error });
    }
  };

  const sectionStyle = {
    ...glass, padding: isMobile ? 24 : 32, maxWidth: 600, marginBottom: 20,
  };
  const labelStyle = { fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 };
  const fieldStyle = { padding: "12px 16px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.04)", fontSize: 15, color: "rgba(255,255,255,0.7)" };
  const btnPrimary = {
    padding: "12px 24px", borderRadius: 14, border: "none", cursor: "pointer",
    background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
    fontSize: 14, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,212,255,0.2)",
  };
  const btnSecondary = {
    padding: "12px 24px", borderRadius: 14, cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500,
  };

  const handlePasswordChange = async () => {
    setPwMsg(null);
    if (!currentPw) { haptics.error(); setPwMsg({ type: "error", text: "Enter your current password" }); return; }
    if (newPw.length < 6) { haptics.error(); setPwMsg({ type: "error", text: "New password must be at least 6 characters" }); return; }
    if (newPw !== confirmPw) { haptics.error(); setPwMsg({ type: "error", text: "Passwords do not match" }); return; }
    haptics.medium();
    setPwLoading(true);
    const result = await changePassword(investor.email, currentPw, newPw);
    setPwLoading(false);
    if (result.success) {
      haptics.success();
      setPwMsg({ type: "success", text: "Password updated successfully" });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } else {
      haptics.error();
      setPwMsg({ type: "error", text: result.error });
    }
  };

  const handleStart2FA = () => {
    const result = generate2FASecret(investor.email);
    if (result.success) {
      setTwoFASecret(result.secret);
      setTwoFAOtpUrl(result.otpauthUrl);
      setTwoFASetupMode(true);
      setTwoFAMsg(null);
      setBackupCodes(null);
    }
  };

  const handleVerify2FA = async () => {
    setTwoFAMsg(null);
    const result = await verify2FASetup(investor.email, twoFACode);
    if (result.success) {
      setTwoFAEnabled(true);
      setBackupCodes(result.backupCodes);
      setTwoFAMsg({ type: "success", text: "2FA enabled successfully! Save your backup codes." });
      setTwoFACode("");
    } else {
      setTwoFAMsg({ type: "error", text: result.error });
    }
  };

  const handleDisable2FA = () => {
    disable2FA(investor.email);
    setTwoFAEnabled(false);
    setTwoFASetupMode(false);
    setTwoFASecret(null);
    setBackupCodes(null);
    setTwoFAMsg(null);
  };

  const emailVerified = isEmailVerified(investor.email);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Account Info */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Account Information</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[
            { label: "Name", value: investor.name || `${investor.firstName} ${investor.lastName}` },
            { label: "Email", value: investor.email, badge: emailVerified ? "Verified" : "Unverified", badgeColor: emailVerified ? "#10B981" : "#F59E0B" },
            { label: "Phone", value: investor.phone || "Not set" },
            { label: "Investor ID", value: investor.id },
            { label: "Passkey", value: passkeyHasKey ? "Enabled" : "Not set up", badge: passkeyHasKey ? "Active" : null, badgeColor: "#10B981" },
            { label: "2FA", value: twoFAEnabled ? "Enabled" : "Disabled", badge: twoFAEnabled ? "Active" : null, badgeColor: "#10B981" },
            { label: "Ownership", value: `${(investor.ownershipPct || 0).toFixed(2)}%` },
            { label: "Account Type", value: investor.accountType || "Member — LLC" },
          ].map(f => (
            <div key={f.label}>
              <div style={labelStyle}>{f.label}</div>
              <div style={{ ...fieldStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{f.value}</span>
                {f.badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 8,
                    background: `${f.badgeColor}20`, color: f.badgeColor, letterSpacing: 0.5,
                  }}>{f.badge}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Appearance / Theme */}
      <AppearanceSection glass={glass} sectionStyle={sectionStyle} isMobile={isMobile} />

      {/* Notifications */}
      <NotificationsSection investor={investor} />

      {/* Change Password */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔑</span> Change Password
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={labelStyle}>Current Password</div>
            <input type="password" value={currentPw} onChange={e => { setCurrentPw(e.target.value); setPwMsg(null); }}
              placeholder="Enter current password" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>New Password</div>
            <input type="password" value={newPw} onChange={e => { setNewPw(e.target.value); setPwMsg(null); }}
              placeholder="Min 6 characters" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Confirm New Password</div>
            <input type="password" value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setPwMsg(null); }}
              placeholder="Re-enter new password"
              onKeyDown={e => e.key === "Enter" && handlePasswordChange()}
              style={inputStyle} />
          </div>
          {pwMsg && (
            <div style={{ fontSize: 13, color: pwMsg.type === "success" ? "#10B981" : "#EF4444", padding: "8px 12px", borderRadius: 10, background: pwMsg.type === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)" }}>
              {pwMsg.text}
            </div>
          )}
          <button onClick={handlePasswordChange} disabled={pwLoading} style={{ ...btnPrimary, opacity: pwLoading ? 0.6 : 1 }}>
            {pwLoading ? "Updating..." : "Update Password"}
          </button>
        </div>
      </div>

      {/* Two-Factor Authentication */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🛡️</span> Two-Factor Authentication
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 1.6 }}>
          Add an extra layer of security using Google Authenticator, Authy, or any TOTP-compatible app.
        </p>

        {twoFAEnabled && !twoFASetupMode ? (
          <div>
            <div style={{ padding: 16, borderRadius: 14, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#10B981" }}>2FA is Active</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Your account is protected with two-factor authentication</div>
              </div>
            </div>
            <button onClick={handleDisable2FA} style={{ ...btnSecondary, color: "#EF4444", borderColor: "rgba(239,68,68,0.3)" }}>
              Disable 2FA
            </button>
          </div>
        ) : twoFASetupMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Step 1: Show secret */}
            <div style={{ padding: 20, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>STEP 1 — Open your authenticator app and add a new account</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>Scan the QR code or manually enter this secret key:</div>
              <div style={{
                padding: "14px 18px", borderRadius: 12, background: "rgba(0,212,255,0.06)",
                border: "1px solid rgba(0,212,255,0.15)", fontFamily: "monospace",
                fontSize: 16, fontWeight: 700, letterSpacing: 3, color: "#00D4FF",
                wordBreak: "break-all", textAlign: "center",
              }}>
                {twoFASecret}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 8, textAlign: "center" }}>
                Account: {investor.email} | Issuer: 12Tribes
              </div>
            </div>

            {/* Step 2: Enter code */}
            <div style={{ padding: 20, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>STEP 2 — Enter the 6-digit code from your authenticator app</div>
              <input type="text" value={twoFACode}
                onChange={e => { setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6)); setTwoFAMsg(null); }}
                onKeyDown={e => e.key === "Enter" && twoFACode.length === 6 && handleVerify2FA()}
                placeholder="000000"
                style={{ ...inputStyle, textAlign: "center", fontSize: 28, letterSpacing: 10, fontWeight: 700, maxWidth: 280, margin: "0 auto", display: "block" }}
                maxLength={6} />
            </div>

            {twoFAMsg && (
              <div style={{ fontSize: 13, color: twoFAMsg.type === "success" ? "#10B981" : "#EF4444", padding: "10px 14px", borderRadius: 10, background: twoFAMsg.type === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)" }}>
                {twoFAMsg.text}
              </div>
            )}

            {/* Backup Codes */}
            {backupCodes && (
              <div style={{ padding: 20, borderRadius: 16, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#F59E0B", marginBottom: 10 }}>⚠ Backup Codes — Save These Now</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
                  If you lose access to your authenticator app, use one of these codes to sign in. Each code can only be used once.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {backupCodes.map((code, i) => (
                    <div key={i} style={{
                      padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.04)",
                      fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#F59E0B",
                      textAlign: "center", letterSpacing: 1,
                    }}>{code}</div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={handleVerify2FA} disabled={twoFACode.length !== 6}
                style={{ ...btnPrimary, flex: 1, opacity: twoFACode.length !== 6 ? 0.4 : 1 }}>
                Verify & Enable 2FA
              </button>
              <button onClick={() => { setTwoFASetupMode(false); setTwoFASecret(null); setTwoFAMsg(null); }}
                style={btnSecondary}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={handleStart2FA} style={btnPrimary}>
            Set Up 2FA
          </button>
        )}
      </div>

      {/* Passkey Management */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔐</span> Passkey Authentication
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 1.6 }}>
          Sign in instantly with Face ID, Touch ID, or your device PIN. No password needed — fast, phishing-resistant, and secure.
        </p>

        {passkeyMsg && (
          <div style={{ fontSize: 13, color: passkeyMsg.type === "success" ? "#10B981" : "#EF4444", padding: "10px 14px", borderRadius: 10, background: passkeyMsg.type === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", marginBottom: 16 }}>
            {passkeyMsg.text}
          </div>
        )}

        {passkeyCredentials.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Registered Passkeys</div>
            {passkeyCredentials.map((cred, i) => (
              <div key={cred.id || i} style={{
                padding: "14px 16px", borderRadius: 14, marginBottom: 8,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                    {cred.device_name || "Unknown Device"}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                    Added {cred.created_at ? new Date(cred.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}
                    {cred.last_used ? ` · Last used ${new Date(cred.last_used).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' · Never used'}
                  </div>
                </div>
                <button onClick={() => handleRemovePasskey(cred.credential_id)} disabled={passkeyLoading}
                  style={{ ...btnSecondary, padding: "6px 14px", fontSize: 12, color: "#EF4444", borderColor: "rgba(239,68,68,0.3)" }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {isPasskeySupported() ? (
          <button onClick={handleRegisterPasskey} disabled={passkeyLoading}
            style={{ ...btnPrimary, opacity: passkeyLoading ? 0.6 : 1 }}>
            {passkeyLoading ? "Setting up..." : passkeyHasKey ? "Add Another Passkey" : "Create Passkey"}
          </button>
        ) : (
          <div style={{ padding: 16, borderRadius: 14, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 13, color: "#F59E0B" }}>
            Passkeys aren't supported on this browser. Try using Chrome, Safari, or Edge on a device with biometric authentication.
          </div>
        )}
      </div>
    </div>
  );
}


// ════════════════════════════════════════
//   2FA VERIFICATION SCREEN (Login Gate)
// ════════════════════════════════════════

function TwoFactorScreen({ user, onVerified, onCancel }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { isMobile } = useResponsive();

  const handleVerify = async () => {
    if (code.length < 6) { setError("Enter a 6-digit code"); return; }
    setLoading(true); setError("");
    const result = await verify2FACode(user.email, code);
    setLoading(false);
    if (result.success) {
      if (result.usedBackupCode) {
        setError(`Backup code used. ${result.remainingBackupCodes} remaining.`);
        setTimeout(onVerified, 2000);
      } else {
        onVerified();
      }
    } else {
      setError(result.error);
      setCode("");
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: isMobile ? 16 : 32,
      background: "linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
      color: "#fff",
    }}>
      <div style={{ ...glass, padding: isMobile ? 32 : 48, width: isMobile ? "100%" : 420, maxWidth: 420, textAlign: "center" }}>
        <div style={{ margin: "0 auto 20px" }}><BrandLogo size={56} /></div>

        <div style={{
          width: 64, height: 64, borderRadius: 20, margin: "0 auto 20px",
          background: "linear-gradient(135deg, #A855F7, #00D4FF)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, boxShadow: "0 4px 20px rgba(168,85,247,0.3)",
        }}>🛡️</div>

        <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Two-Factor Authentication</h2>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 24px" }}>
          Enter the 6-digit code from your authenticator app
        </p>

        <input type="text" value={code}
          onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(""); }}
          onKeyDown={e => e.key === "Enter" && code.length === 6 && handleVerify()}
          placeholder="000000" autoFocus
          style={{ ...inputStyle, textAlign: "center", fontSize: 32, letterSpacing: 10, fontWeight: 700, marginBottom: 16 }}
          maxLength={6} />

        {error && (
          <div style={{ fontSize: 12, color: error.includes("Backup") ? "#F59E0B" : "#EF4444", marginBottom: 12 }}>{error}</div>
        )}

        <button onClick={handleVerify} disabled={loading || code.length !== 6}
          style={{
            width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
            background: code.length === 6 ? "linear-gradient(135deg, #00D4FF, #A855F7)" : "rgba(255,255,255,0.06)",
            color: code.length === 6 ? "#fff" : "rgba(255,255,255,0.3)",
            fontSize: 15, fontWeight: 600, marginBottom: 12,
            boxShadow: code.length === 6 ? "0 4px 16px rgba(0,212,255,0.3)" : "none",
            opacity: loading ? 0.6 : 1,
          }}>
          {loading ? "Verifying..." : "Verify"}
        </button>

        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 12 }}>
          You can also enter a backup code
        </p>

        <button onClick={onCancel}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
          Cancel &amp; Sign Out
        </button>
      </div>
    </div>
  );
}


// ════════════════════════════════════════
//   TERMS & CONDITIONS ACCEPTANCE SCREEN
// ════════════════════════════════════════

function TermsAcceptanceScreen({ user, onAccept }) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const { isMobile } = useResponsive();

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 50) {
      setScrolledToBottom(true);
    }
  };

  const glassStyle = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 24,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4)",
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: isMobile ? 16 : 32,
      background: "linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
      color: "#fff",
    }}>
      <div style={{ maxWidth: 720, width: "100%" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <BrandLogo size={64} />
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: "16px 0 4px", letterSpacing: 1 }}>Terms & Conditions</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Please read and accept before continuing</p>
        </div>

        {/* Scrollable Terms */}
        <div style={{ ...glassStyle, padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div onScroll={handleScroll} style={{
            maxHeight: isMobile ? "50vh" : "55vh", overflowY: "auto", padding: isMobile ? 20 : 32,
            fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.8,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#D4AC0D", marginBottom: 12 }}>12 TRIBES AI INVESTMENT GROUP — TERMS OF SERVICE</h2>
            <p style={{ marginBottom: 16 }}>Last Updated: March 2026</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>1. ACCEPTANCE OF TERMS</h3>
            <p style={{ marginBottom: 12 }}>By accessing, browsing, or using the 12 Tribes AI Investment Group platform ("Platform"), you ("User," "you," or "your") acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions ("Terms"). If you do not agree to these Terms, you must immediately cease all use of the Platform. You must be at least 18 years of age to use this Platform. By using the Platform, you represent and warrant that you are at least 18 years old and have the legal capacity to enter into these Terms. We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the modified Terms.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>2. PLATFORM DESCRIPTION</h3>
            <p style={{ marginBottom: 12 }}>The 12 Tribes AI Investment Group Platform is an AI-powered investment simulation and analytics platform designed for educational and informational purposes. The Platform utilizes virtual currency ($100,000 allocated per participant) for simulated paper trading across multiple asset classes including equities, cryptocurrencies, foreign exchange, options, and futures. The Platform is NOT a registered broker-dealer, investment advisor, transfer agent, or financial institution under any federal or state securities laws. The Platform does not hold, manage, or have custody of any real funds, securities, or financial instruments. No real money is at risk when using the Platform.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>3. NO INVESTMENT ADVICE</h3>
            <p style={{ marginBottom: 12 }}>Nothing contained on this Platform constitutes investment advice, financial advice, trading advice, or any other sort of professional advice. The information, trade signals, AI agent recommendations, market analysis, and any other content provided through the Platform are for informational and educational purposes only. Past performance, whether simulated, backtested, or otherwise, does not guarantee or indicate future results. You should not make any real investment decisions based solely on the information provided by the Platform. Always consult with a qualified, licensed financial advisor, broker, or other financial professional before making any investment decisions with real capital.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>4. VIRTUAL TRADING DISCLAIMER</h3>
            <p style={{ marginBottom: 12 }}>All trades executed on the Platform use virtual (simulated) currency and do not involve real money or real securities. Virtual trading results may differ materially from actual trading results. Simulated trading programs in general are designed with the benefit of hindsight and have inherent limitations including but not limited to: (a) no actual market impact from orders; (b) idealized execution without real-world slippage, partial fills, or rejected orders; (c) absence of emotional and psychological factors that affect real trading decisions; (d) no real counterparty risk; and (e) the ability to be adjusted after the fact. HYPOTHETICAL OR SIMULATED PERFORMANCE RESULTS HAVE CERTAIN INHERENT LIMITATIONS. UNLIKE AN ACTUAL PERFORMANCE RECORD, SIMULATED RESULTS DO NOT REPRESENT ACTUAL TRADING.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>5. AI AGENT DISCLOSURE</h3>
            <p style={{ marginBottom: 12 }}>The Platform employs multiple AI agents ("Agents") that operate using algorithmic trading strategies. These Agents may analyze market data, generate trade signals, execute simulated trades, and manage simulated portfolio risk. Users acknowledge and agree that: (a) AI Agents may fail, produce inaccurate signals, or make unprofitable trading decisions; (b) algorithmic models may degrade over time as market conditions change; (c) past accuracy of any Agent does not guarantee future accuracy; (d) the Platform employs multiple risk controls and safeguards, but no system is infallible; and (e) AI-generated content should not be relied upon as the sole basis for any real investment decision.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>6. RISK DISCLOSURE</h3>
            <p style={{ marginBottom: 12 }}>Trading in financial instruments, including but not limited to stocks, cryptocurrencies, foreign exchange, options, and futures, involves substantial risk of loss and is not suitable for all investors. The high degree of leverage that is often obtainable in trading can work against you as well as for you. You should carefully consider whether trading is suitable for you in light of your financial condition, investment experience, and risk tolerance. You should not invest money you cannot afford to lose. Market conditions can change rapidly and unpredictably due to economic events, geopolitical developments, natural disasters, regulatory changes, and other factors beyond anyone's control or prediction.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>7. USER RESPONSIBILITIES</h3>
            <p style={{ marginBottom: 12 }}>As a User of the Platform, you agree to: (a) maintain the security of your account credentials, including passkeys and passwords; (b) provide accurate and truthful information during registration; (c) not attempt to manipulate, exploit, hack, reverse engineer, decompile, or disassemble any part of the Platform; (d) not use the Platform for any illegal, unauthorized, or fraudulent purpose; (e) not interfere with or disrupt the Platform's operation or servers; (f) not attempt to gain unauthorized access to other users' accounts or data; (g) comply with all applicable local, state, national, and international laws and regulations.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>8. INTELLECTUAL PROPERTY</h3>
            <p style={{ marginBottom: 12 }}>All content, features, functionality, code, algorithms, AI models, trade strategies, design elements, trademarks, and other intellectual property associated with the Platform are and shall remain the exclusive property of 12 Tribes AI Investment Group LLC and its licensors. You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Platform for its intended purpose. You may not copy, reproduce, distribute, modify, create derivative works of, publicly display, publicly perform, republish, download, store, or transmit any material from the Platform without prior written consent.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>9. DATA & PRIVACY</h3>
            <p style={{ marginBottom: 12 }}>The Platform collects and processes certain information including registration data, trading activity, preferences, and usage patterns. In the current version, all data is stored locally on the User's device using browser localStorage technology. No personal data is transmitted to external servers. Users may delete their data at any time by clearing their browser's local storage. We reserve the right to implement server-side data storage in future versions, at which point an updated Privacy Policy will be provided. By using the Platform, you consent to the collection, storage, and processing of your data as described herein.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>10. LIMITATION OF LIABILITY</h3>
            <p style={{ marginBottom: 12 }}>THE PLATFORM IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, 12 TRIBES AI INVESTMENT GROUP LLC DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL 12 TRIBES AI INVESTMENT GROUP LLC, ITS DIRECTORS, EMPLOYEES, PARTNERS, AGENTS, SUPPLIERS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU, IF ANY, FOR ACCESS TO THE PLATFORM DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>11. INDEMNIFICATION</h3>
            <p style={{ marginBottom: 12 }}>You agree to defend, indemnify, and hold harmless 12 Tribes AI Investment Group LLC and its officers, directors, employees, contractors, agents, licensors, suppliers, successors, and assigns from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, or fees (including reasonable attorneys' fees) arising out of or relating to your violation of these Terms or your use of the Platform.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>12. DISPUTE RESOLUTION & GOVERNING LAW</h3>
            <p style={{ marginBottom: 12 }}>These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States of America, without regard to its conflict of law provisions. Any dispute arising from or relating to these Terms or the Platform shall be resolved through binding arbitration administered by the American Arbitration Association in accordance with its Commercial Arbitration Rules. The arbitration shall take place in Wilmington, Delaware. You agree to waive any right to a jury trial or to participate in a class action lawsuit.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>13. TERMINATION</h3>
            <p style={{ marginBottom: 12 }}>Either party may terminate the User's access to the Platform at any time, with or without cause. Upon termination, the User's virtual positions will be closed and virtual funds will be forfeited. No real funds are at stake, and no refund or compensation is owed upon termination. Sections 3, 4, 5, 6, 8, 10, 11, and 12 shall survive termination of these Terms.</p>

            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 20, marginBottom: 8 }}>14. CONTACT INFORMATION</h3>
            <p style={{ marginBottom: 12 }}>For questions or concerns regarding these Terms, please contact: 12 Tribes AI Investment Group LLC — Email: legal@12tribes.ai</p>

            <div style={{ padding: "16px 0", marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              © 2026 12 Tribes AI Investment Group LLC. All rights reserved.
            </div>
          </div>

          {/* Scroll indicator */}
          {!scrolledToBottom && (
            <div style={{
              position: "relative", marginTop: -40, height: 40, pointerEvents: "none",
              background: "linear-gradient(transparent, rgba(10,10,26,0.95))",
              display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8,
            }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", animation: "pulse 2s infinite" }}>↓ Scroll to read all terms</span>
            </div>
          )}
        </div>

        {/* Acceptance */}
        <div style={{ ...glassStyle, padding: isMobile ? 16 : 24 }}>
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
            opacity: scrolledToBottom ? 1 : 0.4, pointerEvents: scrolledToBottom ? "auto" : "none",
            marginBottom: 16,
          }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 2, accentColor: "#D4AC0D", cursor: "pointer" }}
              disabled={!scrolledToBottom}
            />
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
              I have read, understood, and agree to the <strong style={{ color: "#D4AC0D" }}>Terms & Conditions</strong> of 12 Tribes AI Investment Group. I acknowledge that all trading on this platform uses virtual currency for simulation purposes only.
            </span>
          </label>

          <button onClick={onAccept} disabled={!agreed || !scrolledToBottom}
            style={{
              width: "100%", padding: "16px", borderRadius: 16, border: "none", cursor: agreed ? "pointer" : "default",
              background: agreed ? "linear-gradient(135deg, #D4AC0D, #FFD54F)" : "rgba(255,255,255,0.06)",
              color: agreed ? "#0a0a1a" : "rgba(255,255,255,0.2)",
              fontSize: 16, fontWeight: 700, letterSpacing: 0.5,
              boxShadow: agreed ? "0 4px 20px rgba(212,172,13,0.3)" : "none",
              transition: "all 0.3s",
            }}>
            {agreed ? "Accept & Continue →" : "Please read and accept the terms above"}
          </button>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

// ════════════════════════════════════════
//   MAIN APP — Auth Flow Controller
// ════════════════════════════════════════

export default function TwelveTribes_InvestorPortal() {
  // Restore session from localStorage on mount — wallet data persists across logouts
  const savedSession = getSession();
  if (savedSession) {
    ensureWallet(savedSession);
    // Hydrate from server — overwrites stale localStorage with authoritative server state
    syncFromServer(savedSession.id).catch(() => {});
  }
  const [user, setUser] = useState(savedSession || null);
  const [phase, setPhase] = useState(() => {
    if (!savedSession) return "auth";
    if (!checkTermsAccepted(savedSession.id)) return "terms";
    return "dashboard";
  }); // "auth" | "terms" | "2fa" | "onboarding" | "kyc" | "dashboard"

  const handleAuth = (authenticatedUser) => {
    // Ensure wallet exists for returning users (creates $100K wallet if missing)
    ensureWallet(authenticatedUser);
    // Pull authoritative state from server (wallet, positions, trades, agent stats)
    syncFromServer(authenticatedUser.id).catch(() => {});
    setUser(authenticatedUser);
    // Check if 2FA is required
    if (is2FAEnabled(authenticatedUser.email) && !authenticatedUser.isNewUser) {
      setPhase("2fa");
    } else if (!checkTermsAccepted(authenticatedUser.id)) {
      setPhase("terms");
    } else if (authenticatedUser.isNewUser) {
      setPhase("onboarding");
    } else {
      setPhase("dashboard");
    }
  };

  const handle2FAVerified = () => {
    if (!checkTermsAccepted(user.id)) {
      setPhase("terms");
    } else {
      setPhase("dashboard");
    }
  };

  const handleLogout = () => {
    authLogout();
    setUser(null);
    setPhase("auth");
  };

  if (phase === "auth" || !user) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  if (phase === "2fa" && user) {
    return <TwoFactorScreen user={user} onVerified={handle2FAVerified} onCancel={handleLogout} />;
  }

  if (phase === "terms" && user) {
    return <TermsAcceptanceScreen user={user} onAccept={() => {
      recordTermsAcceptance(user.id);
      if (user.isNewUser) {
        setPhase("onboarding");
      } else {
        setPhase("dashboard");
      }
    }} />;
  }

  if (phase === "onboarding") {
    return <OnboardingTutorial investor={user} onComplete={() => setPhase("kyc")} />;
  }

  if (phase === "kyc") {
    return <KYCOnboardingWizard investor={user} onComplete={() => setPhase("dashboard")} />;
  }

  return <PortfolioDashboard investor={user} onLogout={handleLogout} />;
}


// ════════════════════════════════════════
//   AGENT MANAGEMENT VIEW — Live status + toggle control
// ════════════════════════════════════════

function AgentManagementView({ isMobile, isTablet, glass }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);
  const [postMortems, setPostMortems] = useState([]);
  const [insights, setInsights] = useState([]);
  const [activeView, setActiveView] = useState('agents'); // 'agents' | 'post-mortems' | 'insights'

  const AGENT_META = {
    Viper: { icon: '⚡', color: '#00E676', role: 'Momentum & Speed' },
    Oracle: { icon: '🔮', color: '#A855F7', role: 'Macro Intelligence' },
    Spectre: { icon: '👻', color: '#FF6B6B', role: 'Options Strategy' },
    Sentinel: { icon: '🛡️', color: '#00D4FF', role: 'Risk Guardian' },
    Phoenix: { icon: '🔥', color: '#FFD93D', role: 'Self-Healing' },
    Titan: { icon: '🏛️', color: '#FF8A65', role: 'Position Sizing' },
  };

  const token = (() => { try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; } })();
  const API = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `http://${hostname}:4000/api`;
  })();
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchAgents = async () => {
    try {
      const resp = await fetch(`${API}/agents/status`, { headers });
      if (resp.ok) { const data = await resp.json(); setAgents(data.agents || []); }
    } catch (e) { console.error('Failed to fetch agents:', e); }
    setLoading(false);
  };

  const fetchPostMortems = async () => {
    try {
      const resp = await fetch(`${API}/agents/post-mortems?limit=30`, { headers });
      if (resp.ok) { const data = await resp.json(); setPostMortems(data.post_mortems || []); }
    } catch (e) { console.error('Failed to fetch post-mortems:', e); }
  };

  const fetchInsights = async () => {
    try {
      const resp = await fetch(`${API}/agents/learning-insights`, { headers });
      if (resp.ok) { const data = await resp.json(); setInsights(data.insights || []); }
    } catch (e) { console.error('Failed to fetch insights:', e); }
  };

  useEffect(() => { fetchAgents(); fetchPostMortems(); fetchInsights(); const iv = setInterval(fetchAgents, 30000); return () => clearInterval(iv); }, []);

  const toggleAgent = async (name, currentlyEnabled) => {
    setToggling(name);
    try {
      const resp = await fetch(`${API}/agents/${name}/toggle`, {
        method: 'PUT', headers, body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      if (resp.ok) {
        setAgents(prev => prev.map(a => a.name === name ? { ...a, enabled: !currentlyEnabled } : a));
      }
    } catch (e) { console.error('Toggle failed:', e); }
    setToggling(null);
  };

  const viewTabStyle = (active) => ({
    padding: isMobile ? '8px 14px' : '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? '#00D4FF' : 'rgba(255,255,255,0.4)',
    fontSize: isMobile ? 11 : 13, fontWeight: 600, whiteSpace: 'nowrap',
  });

  const enabledCount = agents.filter(a => a.enabled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header + Sub-tabs */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>AI Trading Agents</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{enabledCount} of {agents.length} agents active</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setActiveView('agents')} style={viewTabStyle(activeView === 'agents')}>Agents</button>
          <button onClick={() => { setActiveView('post-mortems'); fetchPostMortems(); }} style={viewTabStyle(activeView === 'post-mortems')}>Post-Mortems</button>
          <button onClick={() => { setActiveView('insights'); fetchInsights(); }} style={viewTabStyle(activeView === 'insights')}>Learning</button>
        </div>
      </div>

      {/* ── Agent Cards Grid ── */}
      {activeView === 'agents' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 14 }}>
          {loading ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>Loading agents...</div>
          ) : agents.map(a => {
            const meta = AGENT_META[a.name] || { icon: '🤖', color: '#888', role: 'Agent' };
            return (
              <div key={a.name} style={{
                padding: 20, borderRadius: 20,
                background: a.enabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)',
                border: `1px solid ${a.enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'}`,
                opacity: a.enabled ? 1 : 0.55,
                transition: 'all 0.3s ease',
              }}>
                {/* Top: Icon + Name + Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <span style={{ fontSize: 30 }}>{meta.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: meta.color }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{meta.role}</div>
                  </div>
                  {/* Toggle Switch */}
                  <button
                    onClick={() => toggleAgent(a.name, a.enabled)}
                    disabled={toggling === a.name}
                    style={{
                      width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                      background: a.enabled ? '#10B981' : 'rgba(255,255,255,0.1)',
                      position: 'relative', transition: 'background 0.3s',
                      opacity: toggling === a.name ? 0.5 : 1,
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute', top: 3,
                      left: a.enabled ? 25 : 3,
                      transition: 'left 0.3s',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                </div>

                {/* Status indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: a.enabled ? '#10B981' : '#6B7280',
                    boxShadow: a.enabled ? '0 0 8px #10B981' : 'none',
                  }} />
                  <span style={{ fontSize: 11, color: a.enabled ? '#10B981' : 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {a.enabled ? 'Active' : 'Disabled'}
                  </span>
                  {a.openPositions > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,212,255,0.1)', color: '#00D4FF' }}>
                      {a.openPositions} open
                    </span>
                  )}
                </div>

                {/* Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { l: 'Trades', v: a.trades || 0 },
                    { l: 'Win Rate', v: a.winRate === 'N/A' ? '—' : `${a.winRate}%` },
                    { l: 'P&L', v: a.totalPnl >= 0 ? `+$${Math.abs(a.totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `-$${Math.abs(a.totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign: 'center', padding: '8px 0', borderRadius: 10, background: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.l}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Best/Worst trade row */}
                {a.trades > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Best: <span style={{ color: '#10B981', fontWeight: 600 }}>+${Math.max(0, a.bestTrade).toFixed(0)}</span></span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Worst: <span style={{ color: '#EF4444', fontWeight: 600 }}>${Math.min(0, a.worstTrade).toFixed(0)}</span></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Post-Mortem Feed ── */}
      {activeView === 'post-mortems' && (
        <div style={{ ...glass, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Trade Post-Mortems</div>
          {postMortems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No post-mortem analyses yet. Trades will be analyzed as they close.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {postMortems.slice(0, 20).map((pm, i) => {
                const meta = AGENT_META[pm.agent] || { icon: '🤖', color: '#888' };
                return (
                  <div key={pm.id || i} style={{
                    padding: 14, borderRadius: 14,
                    background: pm.outcome === 'WIN' ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
                    border: `1px solid ${pm.outcome === 'WIN' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 18 }}>{meta.icon}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{pm.agent}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>{pm.symbol} {pm.side}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: pm.outcome === 'WIN' ? '#10B981' : '#EF4444' }}>
                        {pm.pnl >= 0 ? '+' : ''}{pm.pnl?.toFixed(2)}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 700,
                        background: pm.outcome === 'WIN' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                        color: pm.outcome === 'WIN' ? '#10B981' : '#EF4444',
                      }}>{pm.outcome}</span>
                    </div>
                    {/* Patterns */}
                    {pm.patterns_detected?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                        {pm.patterns_detected.map((p, j) => (
                          <span key={j} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, background: 'rgba(168,85,247,0.1)', color: '#A855F7', fontWeight: 600 }}>
                            {p.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Self-healing action */}
                    {pm.self_healing_action && (
                      <div style={{ fontSize: 11, color: '#FFD93D', marginTop: 4 }}>
                        🔧 {pm.self_healing_detail}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 6 }}>
                      Hold: {pm.hold_time_display} · Entry: ${pm.entry_price?.toFixed(2)} → Exit: ${pm.close_price?.toFixed(2)} · Return: {pm.return_pct?.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Learning Insights ── */}
      {activeView === 'insights' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 14 }}>
          {insights.map(ins => {
            const meta = AGENT_META[ins.agent] || { icon: '🤖', color: '#888' };
            return (
              <div key={ins.agent} style={{ ...glass, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 24 }}>{meta.icon}</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: meta.color }}>{ins.agent}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{ins.totalAnalyzed} trades analyzed</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  {[
                    { l: 'Avg P&L', v: `$${ins.avgPnl?.toFixed(0) || 0}` },
                    { l: 'Avg Hold', v: ins.avgHoldTime > 3600 ? `${(ins.avgHoldTime / 3600).toFixed(1)}h` : `${Math.round(ins.avgHoldTime / 60)}m` },
                    { l: 'Healed', v: ins.selfHealingActions || 0 },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 3 }}>{s.l}</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {ins.bestPatterns?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4, textTransform: 'uppercase' }}>Best Patterns</div>
                    {ins.bestPatterns.map((p, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#10B981', marginBottom: 2 }}>✓ {p.pattern.replace(/_/g, ' ')} — {p.winRate} ({p.trades} trades)</div>
                    ))}
                  </div>
                )}
                {ins.worstPatterns?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4, textTransform: 'uppercase' }}>Avoid Patterns</div>
                    {ins.worstPatterns.map((p, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#EF4444', marginBottom: 2 }}>✗ {p.pattern.replace(/_/g, ' ')} — {p.winRate} ({p.trades} trades)</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {insights.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>Learning insights will appear as trades are analyzed.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//   ADMIN PANEL — Access Request Management
// ════════════════════════════════════════

const ADMIN_API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();

// ════════════════════════════════════════
//   ADMIN TAX SECTION
// ════════════════════════════════════════

function AdminTaxSection({ isMobile, glass, authHeaders }) {
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [fundSummary, setFundSummary] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [msg, setMsg] = useState('');

  const API = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();

  const [error, setError] = useState('');

  const fetchFundSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const [sumRes, allocRes] = await Promise.all([
        fetch(`${API}/admin/tax/fund-summary/${taxYear}`, { headers: authHeaders }),
        fetch(`${API}/admin/tax/allocations/${taxYear}`, { headers: authHeaders }),
      ]);
      if (sumRes.ok) { const d = await sumRes.json(); setFundSummary(d.summary || null); }
      else { console.warn('[TaxAdmin] Fund summary fetch failed:', sumRes.status); }
      if (allocRes.ok) { const d = await allocRes.json(); setAllocations(d.allocations || []); }
      else { console.warn('[TaxAdmin] Allocations fetch failed:', allocRes.status); }
    } catch (err) { console.error('[TaxAdmin] Fetch error:', err); setError(err.message); }
    setLoading(false);
  };

  useEffect(() => { fetchFundSummary(); }, [taxYear]);

  const computeAllocations = async () => {
    setComputing(true);
    setMsg('');
    setError('');
    try {
      const r = await fetch(`${API}/admin/tax/allocations/${taxYear}`, { method: 'POST', headers: authHeaders });
      if (r.ok) {
        const d = await r.json();
        setAllocations(d.allocations || []);
        setFundSummary(d.fundTotals || fundSummary);
        setMsg(`K-1 allocations computed for ${d.allocations?.length || 0} investors`);
        setTimeout(() => setMsg(''), 4000);
      } else {
        const errData = await r.json().catch(() => ({}));
        setError(errData.error || `Server returned ${r.status}`);
      }
    } catch (err) { setError(`Network error: ${err.message}`); }
    setComputing(false);
  };

  const fs = fundSummary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>§ Fund Tax Administration</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={taxYear} onChange={e => setTaxYear(parseInt(e.target.value))} style={{
            padding: '8px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(30,30,34,0.9)', color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none',
          }}>
            {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={computeAllocations} disabled={computing} style={{
            padding: '8px 18px', borderRadius: 12, border: 'none', cursor: computing ? 'wait' : 'pointer',
            background: 'linear-gradient(135deg, #A855F7, #7C3AED)', color: '#fff', fontSize: 12, fontWeight: 700,
            opacity: computing ? 0.6 : 1,
          }}>
            {computing ? 'Computing...' : 'Compute K-1 Allocations'}
          </button>
        </div>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(34,197,94,0.1)', color: '#22C55E', fontSize: 12 }}>{msg}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 12 }}>⚠ {error}</div>}

      {loading && <div style={{ textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.3)' }}>Loading fund tax data...</div>}

      {/* Fund-Level Summary (Form 1065) */}
      {!loading && fundSummary && (
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 14 }}>Fund Summary — Form 1065 Data</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'Net Gain/Loss', value: fs.netGainLoss, color: (fs.netGainLoss || 0) >= 0 ? '#10B981' : '#EF4444' },
              { label: 'Short-Term G/L', value: fs.shortTermGainLoss, color: (fs.shortTermGainLoss || 0) >= 0 ? '#10B981' : '#EF4444' },
              { label: 'Long-Term G/L', value: fs.longTermGainLoss, color: (fs.longTermGainLoss || 0) >= 0 ? '#10B981' : '#EF4444' },
              { label: 'Total Trades', value: fs.totalTransactions, color: '#00D4FF', noPrefix: true },
            ].map((k, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 14, background: 'rgba(30,30,34,0.5)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.noPrefix ? '' : '$'}{typeof k.value === 'number' ? k.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            <span>Wash Sales: <b style={{ color: '#F59E0B' }}>{fs.washSaleEvents || 0}</b> (${(fs.totalWashSaleDisallowed || 0).toLocaleString()} disallowed)</span>
            <span>Crypto: <b style={{ color: '#00D4FF' }}>{fs.byAssetClass?.crypto?.trades || 0}</b> trades (${(fs.byAssetClass?.crypto?.gainLoss || 0).toLocaleString()})</span>
            <span>Equity: <b style={{ color: '#A855F7' }}>{fs.byAssetClass?.equity?.trades || 0}</b> trades (${(fs.byAssetClass?.equity?.gainLoss || 0).toLocaleString()})</span>
          </div>
          {fs.byAgent && Object.keys(fs.byAgent).length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(fs.byAgent).map(([agent, data]) => (
                <div key={agent} style={{ padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)' }}>{agent}:</span>{' '}
                  <span style={{ color: data.gainLoss >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>${data.gainLoss.toLocaleString()}</span>
                  <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>({data.trades} trades)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* K-1 Investor Allocations */}
      {!loading && allocations.length > 0 && (
        <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 14 }}>K-1 Investor Allocations — {taxYear}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allocations.map(a => (
              <div key={a.user_id} style={{
                padding: 16, borderRadius: 16, background: 'rgba(30,30,34,0.5)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{a.investor_name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{a.investor_email} — {a.ownership_pct}% ownership</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: (a.allocated_net_gain_loss || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                    ${(a.allocated_net_gain_loss || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 6, fontSize: 11 }}>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>ST Gains:</span> <span style={{ color: '#10B981' }}>${(a.allocated_short_term_gains || 0).toLocaleString()}</span></div>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>ST Losses:</span> <span style={{ color: '#EF4444' }}>${(a.allocated_short_term_losses || 0).toLocaleString()}</span></div>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>LT Gains:</span> <span style={{ color: '#10B981' }}>${(a.allocated_long_term_gains || 0).toLocaleString()}</span></div>
                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>LT Losses:</span> <span style={{ color: '#EF4444' }}>${(a.allocated_long_term_losses || 0).toLocaleString()}</span></div>
                </div>
                {(a.allocated_wash_sale_disallowed || 0) > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#F59E0B' }}>
                    Wash sale disallowed: ${a.allocated_wash_sale_disallowed.toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !fundSummary && allocations.length === 0 && (
        <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>§</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No tax data for {taxYear} yet</div>
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 4 }}>Tax lots are created automatically as trades execute</div>
        </div>
      )}
    </div>
  );
}

function AdminPanel({ investor, isMobile }) {
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [activeSection, setActiveSection] = useState('requests'); // 'requests' | 'users' | 'health' | 'qa' | 'feedback'
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [qaReports, setQaReports] = useState([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(null);
  const [adminFeedback, setAdminFeedback] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [selectedWithdrawalUser, setSelectedWithdrawalUser] = useState(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', firstName: '', lastName: '', role: 'investor' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [complianceData, setComplianceData] = useState(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState('');

  const token = (() => {
    try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; }
  })();

  const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests`, { headers: authHeaders });
      if (resp.status === 401 || resp.status === 403) {
        // Token may be stale from old deploy — try re-login silently
        setError("Session expired. Please sign out and sign back in to refresh admin access.");
        setLoading(false);
        return;
      }
      const data = await resp.json();
      if (Array.isArray(data)) setRequests(data);
      else setError(data.error || "Failed to load requests.");
    } catch {
      setError("Network error loading requests.");
    }
    setLoading(false);
  }, [token]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users`, { headers: authHeaders });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) setUsers(data);
      }
    } catch { /* silent */ }
    setUsersLoading(false);
  }, [token]);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/health`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); setHealthData(data); }
    } catch { /* silent */ }
    setHealthLoading(false);
  }, [token]);

  const fetchQaReports = useCallback(async () => {
    setQaLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/qa-reports`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); if (Array.isArray(data)) setQaReports(data); }
    } catch { /* silent */ }
    setQaLoading(false);
  }, [token]);

  const fetchAdminFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/feedback`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); setAdminFeedback(data.feedback || []); }
    } catch { /* silent */ }
    setFeedbackLoading(false);
  }, [token]);

  const updateFeedbackStatus = async (fbId, status, adminNotes) => {
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/feedback/${fbId}`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ status, ...(adminNotes !== undefined ? { adminNotes } : {}) }),
      });
      if (resp.ok) fetchAdminFeedback();
    } catch { /* silent */ }
  };

  const fetchAdminWithdrawals = useCallback(async () => {
    setWithdrawalsLoading(true);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/withdrawals`, { headers: authHeaders });
      if (resp.ok) { const data = await resp.json(); setAdminWithdrawals(data.withdrawals || []); }
    } catch { /* silent */ }
    setWithdrawalsLoading(false);
  }, [token]);

  const updateWithdrawalStatus = async (wrId, status, adminNotes) => {
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/withdrawals/${wrId}`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ status, ...(adminNotes !== undefined ? { adminNotes } : {}) }),
      });
      if (resp.ok) fetchAdminWithdrawals();
    } catch { /* silent */ }
  };

  const fetchCompliance = async (retries = 2) => {
    setComplianceLoading(true);
    setComplianceError('');
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const resp = await fetch(`${ADMIN_API_BASE}/compliance/dashboard`, { headers: authHeaders, signal: controller.signal });
        clearTimeout(timer);
        if (resp.ok) {
          setComplianceData(await resp.json());
          setComplianceLoading(false);
          return;
        }
        if (resp.status === 502 || resp.status === 503) {
          // Server cold-starting — wait and retry
          if (attempt < retries) { await new Promise(r => setTimeout(r, 3000)); continue; }
          setComplianceError('Server is starting up. Please try again in a moment.');
        } else if (resp.status === 401 || resp.status === 403) {
          setComplianceError('Session expired or insufficient permissions. Please sign out and back in.');
        } else {
          setComplianceError(`Server returned ${resp.status}. Please retry.`);
        }
      } catch (e) {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 3000)); continue; }
        setComplianceError(e.name === 'AbortError' ? 'Request timed out — server may be waking up. Please retry.' : `Network error: ${e.message}`);
      }
    }
    setComplianceLoading(false);
  };

  useEffect(() => { fetchRequests(); fetchUsers(); fetchHealth(); fetchQaReports(); fetchAdminFeedback(); fetchAdminWithdrawals(); }, [fetchRequests, fetchUsers, fetchHealth, fetchQaReports, fetchAdminFeedback, fetchAdminWithdrawals]);

  // Auto-refresh health every 30s when on health tab
  useEffect(() => {
    if (activeSection !== 'health') return;
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [activeSection, fetchHealth]);

  // Auto-refresh compliance every 60s when on compliance tab
  useEffect(() => {
    if (activeSection !== 'compliance') return;
    if (!complianceData && !complianceLoading) fetchCompliance(3);
    const interval = setInterval(() => fetchCompliance(1), 60000);
    return () => clearInterval(interval);
  }, [activeSection]);

  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const handleAction = async (requestId, status) => {
    setActionLoading(requestId);
    setActionError('');
    setActionSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests/${requestId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      const data = await resp.json();
      if (data.success) {
        // Remove from list — approved/denied requests are no longer shown
        setRequests(prev => prev.filter(r => r.id !== requestId));
        const action = status === 'approved' ? 'Approved' : 'Denied';
        if (data.emailSent) {
          setActionSuccess(`${action} — notification email sent to ${data.request?.email || 'user'}`);
        } else {
          const emailNote = data.emailError ? ` (Email failed: ${data.emailError})` : ' (No email sent)';
          setActionSuccess(`${action}${emailNote}`);
        }
      } else {
        setActionError(data.error || `Failed to ${status === 'approved' ? 'approve' : 'deny'} request.`);
      }
    } catch (err) {
      setActionError(`Network error: ${err.message || 'Could not reach server.'}`);
    }
    setActionLoading(null);
  };

  const handleResendEmail = async (requestId, email) => {
    setActionLoading(requestId);
    setActionError('');
    setActionSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests/${requestId}/resend-email`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await resp.json();
      if (data.emailSent) {
        setActionSuccess(`Approval email re-sent to ${email}`);
      } else {
        setActionError(`Email failed: ${data.emailError || 'Unknown error'}`);
      }
    } catch (err) {
      setActionError(`Network error: ${err.message || 'Could not reach server.'}`);
    }
    setActionLoading(null);
  };

  const handleDeleteRequest = async (requestId, email) => {
    if (!window.confirm(`Delete access request for ${email}? This cannot be undone.`)) return;
    setActionLoading(requestId);
    setActionError('');
    setActionSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/access-requests/${requestId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await resp.json();
      if (data.success) {
        setRequests(prev => prev.filter(r => r.id !== requestId));
        setActionSuccess(`Deleted request for ${email}`);
      } else {
        setActionError(data.error || 'Failed to delete request.');
      }
    } catch (err) {
      setActionError(`Network error: ${err.message || 'Could not reach server.'}`);
    }
    setActionLoading(null);
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Permanently delete ${userEmail}? This will close all their positions and remove their account. This action cannot be undone.`)) return;
    setDeleteLoading(userId);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users/${userId}`, {
        method: 'DELETE', headers: authHeaders,
      });
      const data = await resp.json();
      if (data.success) {
        setUsers(prev => prev.filter(u => u.id !== userId));
      } else {
        alert(data.error || 'Failed to delete user');
      }
    } catch { alert('Network error deleting user'); }
    setDeleteLoading(null);
  };

  const [roleLoading, setRoleLoading] = useState(null);
  const handleChangeRole = async (userId, userEmail, newRole) => {
    if (!window.confirm(`Change ${userEmail} role to "${newRole}"?`)) return;
    setRoleLoading(userId);
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ role: newRole }),
      });
      const data = await resp.json();
      if (data.success) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      } else {
        alert(data.error || 'Failed to change role');
      }
    } catch { alert('Network error changing role'); }
    setRoleLoading(null);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError('');
    setCreateSuccess('');
    try {
      const resp = await fetch(`${ADMIN_API_BASE}/admin/users`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify(createForm),
      });
      const data = await resp.json();
      if (data.success) {
        setCreateSuccess(`Account created for ${data.user.email} (${data.user.role}) — Temporary Password: ${data.tempPassword}`);
        setCreateForm({ email: '', firstName: '', lastName: '', role: 'investor' });
        fetchUsers(); // Refresh user list
      } else {
        setCreateError(data.error || 'Failed to create user');
      }
    } catch { setCreateError('Network error creating user'); }
    setCreateLoading(false);
  };

  const glass = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 20,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.35)",
  };

  const pending = requests.filter(r => r.status === 'pending');

  const statusBadge = (status) => {
    const colors = { pending: '#F59E0B', approved: '#10B981', denied: '#EF4444', admin: '#A855F7', investor: '#00D4FF' };
    return {
      display: 'inline-block', padding: '3px 10px', borderRadius: 8,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
      background: `${colors[status] || '#666'}20`, color: colors[status] || '#666',
      textTransform: 'uppercase',
    };
  };

  const tabStyle = (active) => ({
    padding: isMobile ? '10px 14px' : '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? '#00D4FF' : 'rgba(255,255,255,0.4)',
    fontSize: isMobile ? 11 : 13, fontWeight: 600, transition: 'all 0.2s',
    whiteSpace: 'nowrap', flexShrink: 0, minHeight: isMobile ? 44 : 'auto',
    touchAction: 'manipulation',
  });

  return (
    <div style={{ padding: 0 }}>
      <h2 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>Admin Panel</h2>
      <p style={{ fontSize: isMobile ? 12 : 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 14px' }}>Manage users, access requests, and platform settings</p>

      {/* Tab Switcher — horizontally scrollable on mobile */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 6,
        marginLeft: isMobile ? -16 : 0,
        marginRight: isMobile ? -16 : 0,
        paddingLeft: isMobile ? 16 : 0,
        paddingRight: isMobile ? 16 : 0,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        <button onClick={() => setActiveSection('requests')} style={tabStyle(activeSection === 'requests')}>
          Access Requests {pending.length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: '#F59E0B', color: '#000', fontSize: 10, fontWeight: 800 }}>{pending.length}</span>}
        </button>
        <button onClick={() => setActiveSection('users')} style={tabStyle(activeSection === 'users')}>
          User Accounts <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800 }}>{users.length}</span>
        </button>
        <button onClick={() => { setActiveSection('health'); fetchHealth(); }} style={tabStyle(activeSection === 'health')}>
          Health
        </button>
        <button onClick={() => { setActiveSection('qa'); fetchQaReports(); }} style={tabStyle(activeSection === 'qa')}>
          QA {qaReports.length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(168,85,247,0.3)', color: '#A855F7', fontSize: 10, fontWeight: 800 }}>{qaReports.length}</span>}
        </button>
        <button onClick={() => { setActiveSection('feedback'); fetchAdminFeedback(); }} style={tabStyle(activeSection === 'feedback')}>
          Feedback {adminFeedback.filter(f => f.status === 'new').length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.25)', color: '#EF4444', fontSize: 10, fontWeight: 800 }}>{adminFeedback.filter(f => f.status === 'new').length} new</span>}
        </button>
        <button onClick={() => { setActiveSection('withdrawals'); fetchAdminWithdrawals(); }} style={tabStyle(activeSection === 'withdrawals')}>
          Withdrawals {adminWithdrawals.filter(w => w.status === 'pending').length > 0 && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.3)', color: '#F59E0B', fontSize: 10, fontWeight: 800 }}>{adminWithdrawals.filter(w => w.status === 'pending').length}</span>}
        </button>
        <button onClick={() => setActiveSection('tax-admin')} style={tabStyle(activeSection === 'tax-admin')}>
          § Tax Admin
        </button>
        <button onClick={() => { setActiveSection('compliance'); fetchCompliance(); }} style={tabStyle(activeSection === 'compliance')}>
          🛡️ Compliance
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Users', count: users.length, color: '#00D4FF' },
          { label: 'Pending Requests', count: pending.length, color: '#F59E0B' },
        ].map(s => (
          <div key={s.label} style={{ ...glass, padding: '14px 20px', flex: '1 1 100px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ color: '#EF4444', textAlign: 'center', padding: 16, marginBottom: 16, ...glass, border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}
      {actionError && <div style={{ color: '#EF4444', textAlign: 'center', padding: 12, marginBottom: 16, ...glass, border: '1px solid rgba(239,68,68,0.2)', fontSize: 13 }}>{actionError}</div>}
      {actionSuccess && <div style={{ color: '#10B981', textAlign: 'center', padding: 12, marginBottom: 16, ...glass, border: '1px solid rgba(16,185,129,0.2)', fontSize: 13 }}>{actionSuccess}</div>}

      {/* ═══════ ACCESS REQUESTS SECTION ═══════ */}
      {activeSection === 'requests' && (
        <>
          {loading && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading requests...</div>}

          {!loading && !error && pending.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◇</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No pending access requests</div>
            </div>
          )}

          {pending.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F59E0B', margin: '0 0 12px' }}>Pending Requests ({pending.length})</h3>
              {pending.map(r => (
                <div key={r.id} style={{ ...glass, padding: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#00D4FF', flexShrink: 0,
                  }}>{(r.first_name?.[0] || '') + (r.last_name?.[0] || '')}</div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                      {r.first_name} {r.last_name}
                      {r.previously_rejected && (
                        <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: 10, fontWeight: 700 }}>
                          PREVIOUSLY REJECTED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{r.email}</div>
                    {r.previously_rejected && r.previous_denial_date && (
                      <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12 }}>&#9888;</span> Previously denied on {new Date(r.previous_denial_date).toLocaleDateString()}
                      </div>
                    )}
                    {r.message && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4, fontStyle: 'italic' }}>"{r.message}"</div>}
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>Submitted {new Date(r.submitted_at).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => handleAction(r.id, 'approved')} disabled={actionLoading === r.id}
                      style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'rgba(16,185,129,0.2)', color: '#10B981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {actionLoading === r.id ? '...' : 'Approve'}
                    </button>
                    <button onClick={() => handleAction(r.id, 'denied')} disabled={actionLoading === r.id}
                      style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {actionLoading === r.id ? '...' : 'Deny'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resolved requests — audit trail */}
          {(() => {
            const resolved = requests.filter(r => r.status === 'approved' || r.status === 'denied');
            if (resolved.length === 0) return null;
            return (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.3)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Resolved ({resolved.length})
                </h3>
                {resolved.map(r => {
                  const isApproved = r.status === 'approved';
                  return (
                    <div key={r.id} style={{ ...glass, padding: '12px 16px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: 0.7 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: isApproved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: isApproved ? '#10B981' : '#EF4444', flexShrink: 0,
                      }}>{(r.first_name?.[0] || '') + (r.last_name?.[0] || '')}</div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{r.first_name} {r.last_name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{r.email}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
                          Submitted {new Date(r.submitted_at).toLocaleDateString()}
                          {r.reviewed_at && ` · Reviewed ${new Date(r.reviewed_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <span style={{
                        padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                        background: isApproved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)',
                        color: isApproved ? '#10B981' : '#EF4444',
                        border: `1px solid ${isApproved ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.2)'}`,
                      }}>
                        {isApproved ? '✓ Approved' : '✕ Denied'}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        </>
      )}

      {/* ═══════ USER ACCOUNTS SECTION ═══════ */}
      {activeSection === 'users' && (
        <>
          {/* Create User Button + Form */}
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setShowCreateUser(!showCreateUser)} style={{
              padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(16,185,129,0.3)',
              background: showCreateUser ? 'rgba(16,185,129,0.15)' : 'transparent',
              color: '#10B981', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {showCreateUser ? '✕ Cancel' : '+ Create User'}
            </button>
          </div>

          {showCreateUser && (
            <form onSubmit={handleCreateUser} style={{ ...glass, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#10B981', margin: '0 0 16px' }}>Create New User</h3>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
                {[
                  { key: 'firstName', placeholder: 'First Name', type: 'text' },
                  { key: 'lastName', placeholder: 'Last Name', type: 'text' },
                  { key: 'email', placeholder: 'Email Address', type: 'email' },
                ].map(f => (
                  <input key={f.key} type={f.type} placeholder={f.placeholder} required
                    value={createForm[f.key]}
                    onChange={e => setCreateForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{
                      padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13, outline: 'none',
                    }} />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Role:</label>
                <select value={createForm.role}
                  onChange={e => setCreateForm(prev => ({ ...prev, role: e.target.value }))}
                  style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, outline: 'none',
                  }}>
                  <option value="investor" style={{ background: '#1a1a2e' }}>Investor</option>
                  <option value="admin" style={{ background: '#1a1a2e' }}>Admin</option>
                </select>
              </div>
              {createError && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)' }}>{createError}</div>}
              {createSuccess && (
                <div style={{ color: '#10B981', fontSize: 12, marginBottom: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div style={{ marginBottom: 6 }}>{createSuccess.split(' — ')[0]}</div>
                  {createSuccess.includes('Temporary Password:') && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Temp Password:</span>
                      <code style={{ background: 'rgba(255,255,255,0.04)', padding: '4px 10px', borderRadius: 6, fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 0.5, userSelect: 'all' }}>
                        {createSuccess.split('Temporary Password: ')[1]}
                      </code>
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(createSuccess.split('Temporary Password: ')[1]); }}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer' }}>
                        Copy
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>A welcome email with this password has been sent to the user.</div>
                </div>
              )}
              <button type="submit" disabled={createLoading} style={{
                padding: '10px 24px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.3), rgba(0,212,255,0.2))',
                color: '#10B981', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: createLoading ? 0.5 : 1,
              }}>
                {createLoading ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          )}

          {usersLoading && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading users...</div>}

          {!usersLoading && users.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No registered users</div>
            </div>
          )}

          {!usersLoading && users.length > 0 && (
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#00D4FF', margin: '0 0 12px' }}>Registered Accounts ({users.length})</h3>
              {users.map(u => (
                <div key={u.id} style={{ ...glass, padding: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: u.role === 'admin'
                      ? 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(0,212,255,0.2))'
                      : 'rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    color: u.role === 'admin' ? '#A855F7' : 'rgba(255,255,255,0.4)',
                    flexShrink: 0,
                  }}>{(u.firstName?.[0] || '').toUpperCase()}{(u.lastName?.[0] || '').toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{u.firstName} {u.lastName}</span>
                      <span style={statusBadge(u.role)}>{u.role}</span>
                      {u.emailVerified && <span style={{ fontSize: 10, color: '#10B981' }}>✓ Verified</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{u.email}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>Mode: {u.tradingMode || 'paper'}</span>
                      <span>Logins: {u.loginCount || 0}</span>
                      {u.lastLogin && <span>Last: {new Date(u.lastLogin).toLocaleDateString()}</span>}
                      {u.createdAt && <span>Joined: {new Date(u.createdAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  {/* Role change + Delete — hidden for self */}
                  {u.email !== investor?.email && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleChangeRole(u.id, u.email, u.role === 'admin' ? 'investor' : 'admin')}
                        disabled={roleLoading === u.id}
                        style={{
                          padding: '8px 14px', borderRadius: 10,
                          border: `1px solid ${u.role === 'admin' ? 'rgba(0,212,255,0.25)' : 'rgba(168,85,247,0.25)'}`,
                          background: u.role === 'admin' ? 'rgba(0,212,255,0.08)' : 'rgba(168,85,247,0.08)',
                          color: u.role === 'admin' ? '#00D4FF' : '#A855F7',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          opacity: roleLoading === u.id ? 0.5 : 1, transition: 'all 0.2s',
                        }}>
                        {roleLoading === u.id ? '...' : u.role === 'admin' ? 'Make Investor' : 'Make Admin'}
                      </button>
                      <button onClick={() => handleDeleteUser(u.id, u.email)} disabled={deleteLoading === u.id}
                        style={{
                          padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)',
                          background: 'rgba(239,68,68,0.08)', color: '#EF4444', fontSize: 11, fontWeight: 600,
                          cursor: 'pointer', opacity: deleteLoading === u.id ? 0.5 : 1, transition: 'all 0.2s',
                        }}>
                        {deleteLoading === u.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══════ PLATFORM HEALTH SECTION ═══════ */}
      {activeSection === 'health' && (
        <>
          {healthLoading && !healthData && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading health data...</div>}
          {healthData && (() => {
            const h = healthData;
            const statusColor = h.status === 'operational' ? '#10B981' : '#EF4444';
            const metricCard = (label, value, color, sub) => (
              <div style={{ ...glass, padding: '14px 16px', flex: '1 1 140px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: color || '#fff' }}>{value}</div>
                {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{sub}</div>}
              </div>
            );
            return (
              <div>
                {/* Status Banner */}
                <div style={{ ...glass, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${statusColor}30` }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor, boxShadow: `0 0 12px ${statusColor}60` }} />
                  <div style={{ fontSize: 16, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: 1 }}>{h.status}</div>
                  <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Last check: {new Date(h.timestamp).toLocaleTimeString()}</div>
                </div>

                {/* Server Metrics */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Server</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('Uptime', h.server.uptimeHuman, '#10B981')}
                  {metricCard('Memory (Heap)', `${h.server.memoryMB.heapUsed} MB`, '#00D4FF', `of ${h.server.memoryMB.heapTotal} MB`)}
                  {metricCard('RSS', `${h.server.memoryMB.rss} MB`, '#A855F7')}
                  {metricCard('Node', h.server.nodeVersion, '#F59E0B')}
                </div>

                {/* Database Metrics */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Database</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('Users', h.database.users, '#00D4FF')}
                  {metricCard('Wallets', h.database.wallets, '#A855F7')}
                  {metricCard('Open Positions', h.database.positions.open, '#10B981', `of ${h.database.positions.total} total`)}
                  {metricCard('Trades', h.database.trades, '#F59E0B')}
                </div>

                {/* Trading Engine */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Trading Engine</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('Status', h.tradingEngine.active ? 'ACTIVE' : 'OFFLINE', h.tradingEngine.active ? '#10B981' : '#EF4444')}
                  {metricCard('Trades/Hour', h.tradingEngine.tradesLastHour, '#00D4FF')}
                  {metricCard('Trades/24h', h.tradingEngine.tradesLast24h, '#A855F7')}
                  {metricCard('AI Agents', h.tradingEngine.agentCount, '#F59E0B')}
                </div>

                {/* WebSocket & Market Data */}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', margin: '0 0 10px' }}>Live Data</h3>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  {metricCard('WS Connections', h.websocket.connections, '#00D4FF')}
                  {metricCard('Market Symbols', h.marketData.symbolCount, '#A855F7')}
                  {metricCard('BTC', `$${(h.marketData.samplePrices?.BTC || 0).toLocaleString()}`, '#F59E0B')}
                  {metricCard('Risk Events (24h)', h.risk.eventsLast24h, h.risk.criticalEvents > 0 ? '#EF4444' : '#10B981', h.risk.criticalEvents > 0 ? `${h.risk.criticalEvents} critical` : 'No critical')}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ═══════ QA REPORTS SECTION ═══════ */}
      {activeSection === 'qa' && (
        <>
          {qaLoading && qaReports.length === 0 && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading QA reports...</div>}

          {!qaLoading && qaReports.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No QA/QC reports yet</div>
              <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 8 }}>Automated audits run every 6 hours and will appear here</div>
            </div>
          )}

          {qaReports.length > 0 && qaReports.map(report => {
            const sev = report.severity_counts || {};
            const sevColor = sev.critical > 0 ? '#EF4444' : sev.high > 0 ? '#F59E0B' : '#10B981';
            return (
              <div key={report.id} style={{ ...glass, padding: 20, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: sevColor, boxShadow: `0 0 8px ${sevColor}60` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{report.summary}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {new Date(report.created_at).toLocaleString()} · Source: {report.source || 'manual'}
                    </div>
                  </div>
                  <span style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                    background: report.status === 'new' ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.05)',
                    color: report.status === 'new' ? '#00D4FF' : 'rgba(255,255,255,0.4)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{report.status}</span>
                </div>

                {/* Severity Counts */}
                {Object.keys(sev).length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {sev.critical > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontSize: 11, fontWeight: 600 }}>🔴 {sev.critical} Critical</span>}
                    {sev.high > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', fontSize: 11, fontWeight: 600 }}>⚠️ {sev.high} High</span>}
                    {sev.medium > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(0,212,255,0.1)', color: '#00D4FF', fontSize: 11, fontWeight: 600 }}>🔄 {sev.medium} Medium</span>}
                    {sev.low > 0 && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600 }}>{sev.low} Low</span>}
                  </div>
                )}

                {/* Issues List */}
                {report.issues && report.issues.length > 0 && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, maxHeight: 200, overflowY: 'auto' }}>
                    {report.issues.slice(0, 10).map((issue, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', padding: '4px 0', borderBottom: i < report.issues.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                        <span style={{ color: issue.severity === 'critical' ? '#EF4444' : issue.severity === 'high' ? '#F59E0B' : '#00D4FF', fontWeight: 600, marginRight: 8 }}>
                          [{(issue.severity || 'info').toUpperCase()}]
                        </span>
                        {issue.description || issue.message || JSON.stringify(issue)}
                      </div>
                    ))}
                    {report.issues.length > 10 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8, textAlign: 'center' }}>+{report.issues.length - 10} more issues</div>}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ═══ FEEDBACK MANAGEMENT ═══ */}
      {activeSection === 'feedback' && (
        <>
          {feedbackLoading && adminFeedback.length === 0 && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading feedback...</div>}

          {!feedbackLoading && adminFeedback.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✉</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No feedback received yet</div>
            </div>
          )}

          {adminFeedback.length > 0 && adminFeedback.map(fb => {
            const statusColors = {
              new: { bg: 'rgba(0,212,255,0.1)', color: '#00D4FF' },
              reviewed: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7' },
              resolved: { bg: 'rgba(34,197,94,0.1)', color: '#22C55E' },
              declined: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
            };
            const sc = statusColors[fb.status] || statusColors.new;
            return (
              <div key={fb.id} style={{ ...glass, padding: 20, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{fb.userName}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{fb.userEmail} · {new Date(fb.createdAt).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {fb.rating > 0 && <span style={{ fontSize: 12, color: '#FFBA00' }}>{'★'.repeat(fb.rating)}</span>}
                    <span style={{ padding: '3px 10px', borderRadius: 8, background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{fb.status}</span>
                  </div>
                </div>
                <div style={{ padding: '2px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                  {fb.category || 'general'}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 12 }}>{fb.message}</div>

                {fb.adminNotes && (
                  <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: '#A855F7', fontWeight: 600, marginBottom: 4 }}>Admin Notes</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{fb.adminNotes}</div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['new', 'reviewed', 'resolved', 'declined'].map(s => (
                    <button key={s} onClick={() => updateFeedbackStatus(fb.id, s)} style={{
                      padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                      border: fb.status === s ? `1px solid ${(statusColors[s] || statusColors.new).color}40` : '1px solid rgba(255,255,255,0.06)',
                      background: fb.status === s ? (statusColors[s] || statusColors.new).bg : 'rgba(30,30,34,0.6)',
                      color: fb.status === s ? (statusColors[s] || statusColors.new).color : 'rgba(255,255,255,0.4)',
                      textTransform: 'capitalize',
                    }}>{s}</button>
                  ))}
                  <button onClick={() => {
                    const notes = prompt('Enter admin notes/response:');
                    if (notes !== null) updateFeedbackStatus(fb.id, fb.status, notes);
                  }} style={{
                    padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(30,30,34,0.6)', color: 'rgba(255,255,255,0.4)',
                  }}>
                    Add Notes
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ═══ WITHDRAWAL MANAGEMENT ═══ */}
      {activeSection === 'withdrawals' && (
        <>
          {withdrawalsLoading && adminWithdrawals.length === 0 && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading withdrawal requests...</div>}

          {!withdrawalsLoading && adminWithdrawals.length === 0 && (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>No withdrawal requests</div>
            </div>
          )}

          {/* Summary Stats */}
          {adminWithdrawals.length > 0 && (() => {
            const statusColors = {
              pending: { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B' },
              approved: { bg: 'rgba(0,212,255,0.1)', color: '#00D4FF' },
              processing: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7' },
              completed: { bg: 'rgba(34,197,94,0.1)', color: '#22C55E' },
              denied: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
            };

            // Group withdrawals by investor
            const byInvestor = {};
            adminWithdrawals.forEach(wr => {
              const key = wr.userId;
              if (!byInvestor[key]) {
                byInvestor[key] = {
                  userId: key,
                  userName: wr.userName || 'Unknown',
                  userEmail: wr.userEmail || '',
                  requests: [],
                  totalWithdrawn: 0,
                  totalPending: 0,
                  completedCount: 0,
                  pendingCount: 0,
                };
              }
              byInvestor[key].requests.push(wr);
              if (wr.status === 'completed') {
                byInvestor[key].totalWithdrawn += wr.amount;
                byInvestor[key].completedCount++;
              }
              if (wr.status === 'pending' || wr.status === 'processing' || wr.status === 'approved') {
                byInvestor[key].totalPending += wr.amount;
                byInvestor[key].pendingCount++;
              }
            });
            const investorList = Object.values(byInvestor).sort((a, b) => b.totalWithdrawn - a.totalWithdrawn);
            const grandTotal = investorList.reduce((s, inv) => s + inv.totalWithdrawn, 0);

            return (
              <>
                {/* Top-level stats */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Pending', count: adminWithdrawals.filter(w => w.status === 'pending').length, total: adminWithdrawals.filter(w => w.status === 'pending').reduce((s, w) => s + w.amount, 0), color: '#F59E0B' },
                    { label: 'Processing', count: adminWithdrawals.filter(w => w.status === 'processing').length, total: adminWithdrawals.filter(w => w.status === 'processing').reduce((s, w) => s + w.amount, 0), color: '#A855F7' },
                    { label: 'Completed', count: adminWithdrawals.filter(w => w.status === 'completed').length, total: adminWithdrawals.filter(w => w.status === 'completed').reduce((s, w) => s + w.amount, 0), color: '#22C55E' },
                    { label: 'Total Withdrawn', count: investorList.length + ' investors', total: grandTotal, color: '#00D4FF' },
                  ].map(s => (
                    <div key={s.label} style={{ ...glass, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginTop: 4 }}>{typeof s.count === 'number' ? s.count : s.count}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>${s.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    </div>
                  ))}
                </div>

                {/* ── INVESTOR DETAIL VIEW ── */}
                {selectedWithdrawalUser && (() => {
                  const inv = byInvestor[selectedWithdrawalUser];
                  if (!inv) return null;
                  const sorted = [...inv.requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                  return (
                    <div style={{ marginBottom: 16 }}>
                      {/* Back button + header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <button onClick={() => setSelectedWithdrawalUser(null)} style={{
                          padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          border: '1px solid rgba(0,212,255,0.2)', background: 'rgba(0,212,255,0.06)', color: '#00D4FF',
                        }}>← Back</button>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{inv.userName}</div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{inv.userEmail}</div>
                        </div>
                      </div>

                      {/* Investor withdrawal summary */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                        <div style={{ ...glass, padding: 14, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>Total Withdrawn</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#22C55E', marginTop: 4 }}>${inv.totalWithdrawn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{inv.completedCount} completed</div>
                        </div>
                        <div style={{ ...glass, padding: 14, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>Pending</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#F59E0B', marginTop: 4 }}>${inv.totalPending.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{inv.pendingCount} requests</div>
                        </div>
                        <div style={{ ...glass, padding: 14, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>All Requests</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 4 }}>{inv.requests.length}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>total</div>
                        </div>
                      </div>

                      {/* Individual withdrawal history */}
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Withdrawal History</div>
                      {sorted.map(wr => {
                        const sc = statusColors[wr.status] || statusColors.pending;
                        return (
                          <div key={wr.id} style={{ ...glass, padding: 16, marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>${wr.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                <span style={{ padding: '3px 10px', borderRadius: 8, background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{wr.status}</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{new Date(wr.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                            </div>

                            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 8, flexWrap: 'wrap' }}>
                              <span>Method: {(wr.method || '').replace(/_/g, ' ')}</span>
                              <span>Requested: {new Date(wr.createdAt).toLocaleTimeString()}</span>
                              {wr.completedAt && <span>Completed: {new Date(wr.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                              <span>Balance at request: ${(wr.walletEquityAtRequest || 0).toLocaleString()}</span>
                            </div>

                            {wr.notes && (
                              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, fontStyle: 'italic', padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                                "{wr.notes}"
                              </div>
                            )}

                            {wr.adminNotes && (
                              <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)', marginBottom: 8 }}>
                                <div style={{ fontSize: 10, color: '#A855F7', fontWeight: 600, marginBottom: 2 }}>Admin Notes</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{wr.adminNotes}</div>
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {['pending', 'approved', 'processing', 'completed', 'denied'].map(s => (
                                <button key={s} onClick={() => {
                                  if (s === 'completed' && wr.status !== 'completed') {
                                    if (!confirm(`Mark as completed? This will deduct $${wr.amount.toLocaleString()} from ${inv.userName}'s wallet.`)) return;
                                  }
                                  updateWithdrawalStatus(wr.id, s);
                                }} style={{
                                  padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                                  border: wr.status === s ? `1px solid ${(statusColors[s] || statusColors.pending).color}40` : '1px solid rgba(255,255,255,0.06)',
                                  background: wr.status === s ? (statusColors[s] || statusColors.pending).bg : 'rgba(30,30,34,0.6)',
                                  color: wr.status === s ? (statusColors[s] || statusColors.pending).color : 'rgba(255,255,255,0.4)',
                                  textTransform: 'capitalize',
                                }}>{s}</button>
                              ))}
                              <button onClick={() => {
                                const notes = prompt('Enter admin notes for this withdrawal:');
                                if (notes !== null) updateWithdrawalStatus(wr.id, wr.status, notes);
                              }} style={{
                                padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                                border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(30,30,34,0.6)', color: 'rgba(255,255,255,0.4)',
                              }}>Add Notes</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* ── INVESTOR LIST VIEW (when no user selected) ── */}
                {!selectedWithdrawalUser && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Withdrawals by Investor</div>
                    {investorList.map(inv => {
                      const hasPending = inv.pendingCount > 0;
                      return (
                        <div key={inv.userId} onClick={() => setSelectedWithdrawalUser(inv.userId)} style={{
                          ...glass, padding: 18, marginBottom: 8, cursor: 'pointer',
                          border: hasPending ? '1px solid rgba(245,158,11,0.15)' : '1px solid rgba(255,255,255,0.04)',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,212,255,0.3)'; e.currentTarget.style.background = 'rgba(0,212,255,0.03)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = hasPending ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)'; e.currentTarget.style.background = ''; }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                              <div style={{
                                width: 40, height: 40, borderRadius: 12,
                                background: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(168,85,247,0.15))',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 16, fontWeight: 800, color: '#00D4FF',
                              }}>{(inv.userName || '?')[0].toUpperCase()}</div>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{inv.userName}</div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{inv.userEmail}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 18, fontWeight: 800, color: '#22C55E' }}>${inv.totalWithdrawn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 3 }}>
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{inv.completedCount} completed</span>
                                {hasPending && (
                                  <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700 }}>{inv.pendingCount} pending · ${inv.totalPending.toLocaleString()}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>{inv.requests.length} total requests · Click to view history →</div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* ═══ TAX ADMIN ═══ */}
      {activeSection === 'tax-admin' && (
        <AdminTaxSection isMobile={isMobile} glass={glass} authHeaders={authHeaders} />
      )}

      {/* ═══ COMPLIANCE DASHBOARD ═══ */}
      {activeSection === 'compliance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {complianceLoading ? (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🛡️</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Loading compliance data...</div>
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 6 }}>Connecting to compliance engine (may take a moment if server is waking up)</div>
            </div>
          ) : complianceError ? (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
              <div style={{ color: '#F59E0B', fontSize: 14, marginBottom: 12 }}>{complianceError}</div>
              <button onClick={() => fetchCompliance(3)} style={{
                padding: '10px 24px', borderRadius: 12, border: '1px solid rgba(0,212,255,0.3)',
                background: 'rgba(0,212,255,0.1)', color: '#00D4FF', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}>Retry</button>
            </div>
          ) : !complianceData ? (
            <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🛡️</div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, marginBottom: 12 }}>No compliance data loaded yet</div>
              <button onClick={() => fetchCompliance(3)} style={{
                padding: '10px 24px', borderRadius: 12, border: '1px solid rgba(0,212,255,0.3)',
                background: 'rgba(0,212,255,0.1)', color: '#00D4FF', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}>Load Compliance Dashboard</button>
            </div>
          ) : (
            <>
              {/* Overall Score Card */}
              <div style={{ ...glass, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Compliance Score</div>
                    <div style={{ fontSize: 48, fontWeight: 800, color: complianceData.health?.overall_score >= 80 ? '#10B981' : complianceData.health?.overall_score >= 60 ? '#F59E0B' : '#EF4444' }}>
                      {complianceData.health?.overall_score || 0}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 8, display: 'inline-block', marginTop: 4,
                      background: (complianceData.health?.overall_status === 'COMPLIANT' || complianceData.health?.overall_status === 'FULLY_COMPLIANT') ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                      color: (complianceData.health?.overall_status === 'COMPLIANT' || complianceData.health?.overall_status === 'FULLY_COMPLIANT') ? '#10B981' : '#F59E0B',
                    }}>{complianceData.health?.overall_status || 'UNKNOWN'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[
                      { l: 'Frameworks', v: complianceData.health?.frameworks_checked || 0, c: '#00D4FF' },
                      { l: 'Audit Entries', v: complianceData.audit?.totalEntries || 0, c: '#A855F7' },
                      { l: 'Alerts', v: complianceData.alerts?.total || 0, c: complianceData.alerts?.total > 0 ? '#EF4444' : '#10B981' },
                    ].map(s => (
                      <div key={s.l} style={{ textAlign: 'center', padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>{s.l}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Framework Scores Grid */}
              <div style={{ ...glass, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Regulatory Framework Scores</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
                  {(complianceData.health?.checks || []).map((check, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
                      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 800,
                        background: check.score >= 80 ? 'rgba(16,185,129,0.12)' : check.score >= 60 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                        color: check.score >= 80 ? '#10B981' : check.score >= 60 ? '#F59E0B' : '#EF4444',
                      }}>{check.score}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{check.name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{check.framework}</div>
                      </div>
                      <span style={{
                        fontSize: 9, padding: '3px 8px', borderRadius: 6, fontWeight: 700,
                        background: check.status === 'IMPLEMENTED' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: check.status === 'IMPLEMENTED' ? '#10B981' : '#F59E0B',
                      }}>{check.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Audit Chain + Trade Flags + Settlements Row */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
                {/* Audit Chain Integrity */}
                <div style={{ ...glass, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Audit Chain</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: complianceData.audit?.chainIntegrity?.valid ? '#10B981' : '#EF4444', marginBottom: 4 }}>
                    {complianceData.audit?.chainIntegrity?.valid ? '✓ INTACT' : '✗ BROKEN'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {complianceData.audit?.chainIntegrity?.entriesChecked || 0} entries verified
                  </div>
                  {(complianceData.audit?.chainIntegrity?.violations?.length || 0) > 0 && (
                    <div style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>
                      {complianceData.audit.chainIntegrity.violations.length} violations detected
                    </div>
                  )}
                </div>

                {/* Trade Flags */}
                <div style={{ ...glass, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Trade Flags</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: complianceData.tradeFlags?.pending > 0 ? '#F59E0B' : '#10B981' }}>
                        {complianceData.tradeFlags?.pending || 0}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Pending</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#10B981' }}>{complianceData.tradeFlags?.resolved || 0}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Resolved</div>
                    </div>
                  </div>
                </div>

                {/* Settlements */}
                <div style={{ ...glass, padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Settlements</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#00D4FF' }}>{complianceData.settlements?.total || 0}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {complianceData.settlements?.pending || 0} pending · {complianceData.settlements?.failToDeliverActions?.length || 0} FTD actions
                  </div>
                </div>
              </div>

              {/* Self-Healing Activity */}
              {complianceData.selfHealing?.recentActions?.length > 0 && (
                <div style={{ ...glass, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🔧 Self-Healing Activity</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {complianceData.selfHealing.recentActions.map((pm, i) => (
                      <div key={i} style={{ padding: 10, borderRadius: 10, background: 'rgba(255,217,61,0.04)', border: '1px solid rgba(255,217,61,0.1)' }}>
                        <div style={{ fontSize: 12, color: '#FFD93D', fontWeight: 600 }}>{pm.self_healing_action?.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{pm.self_healing_detail}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>{pm.agent} · {pm.symbol} · {new Date(pm.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Alerts */}
              {complianceData.alerts?.recent?.length > 0 && (
                <div style={{ ...glass, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#EF4444' }}>⚠️ Recent Compliance Alerts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {complianceData.alerts.recent.map((alert, i) => (
                      <div key={i} style={{ padding: 10, borderRadius: 10, background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444' }}>{alert.type?.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{new Date(alert.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* FTC Disclaimers */}
              <div style={{ ...glass, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📋 FTC Required Disclaimers</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(complianceData.disclaimers || {}).map(([key, text]) => (
                    <div key={key} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#00D4FF', textTransform: 'uppercase', marginBottom: 4 }}>{key.replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Refresh Button */}
      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <RefreshButton label="Refresh All" onRefresh={() => { fetchRequests(); fetchUsers(); fetchHealth(); fetchQaReports(); fetchAdminFeedback(); fetchAdminWithdrawals(); if (activeSection === 'compliance') fetchCompliance(); }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//   MESSAGES VIEW
// ════════════════════════════════════════
function MessagesView({ investor, isMobile }) {
  const [messages, setMessages] = useState([]);
  const [sent, setSent] = useState([]);
  const [view, setView] = useState('inbox');
  const [selected, setSelected] = useState(null);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const API = (() => { if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL; return `http://${window.location.hostname}:4000/api`; })();
  const token = (() => { try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; } })();
  const hdr = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  const glass = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: isMobile ? 16 : 24 };

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const [inRes, sentRes] = await Promise.all([
        fetch(`${API}/messages`, { headers: hdr }),
        fetch(`${API}/messages/sent`, { headers: hdr }),
      ]);
      if (inRes.ok) { const d = await inRes.json(); setMessages(d.messages || []); }
      if (sentRes.ok) { const d = await sentRes.json(); setSent(d.messages || []); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useState(() => { fetchMessages(); }, []);

  const sendMessage = async () => {
    setSending(true);
    try {
      const r = await fetch(`${API}/messages`, { method: 'POST', headers: hdr, body: JSON.stringify({ subject, body, toUserId: null, parentId: selected?.id || null }) });
      if (r.ok) { setComposing(false); setSubject(''); setBody(''); fetchMessages(); }
    } catch (e) { console.error(e); }
    setSending(false);
  };

  const readMsg = async (msg) => {
    setSelected(msg);
    if (!msg.read) { fetch(`${API}/messages/${msg.id}`, { headers: hdr }); }
  };

  const timeAgo = (d) => {
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`;
  };

  const list = view === 'inbox' ? messages : sent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, color: '#fff' }}>Messages</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setView('inbox')} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: view === 'inbox' ? 'rgba(0,212,170,0.15)' : 'rgba(255,255,255,0.03)', color: view === 'inbox' ? '#00d4aa' : 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Inbox ({messages.length})</button>
          <button onClick={() => setView('sent')} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: view === 'sent' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.03)', color: view === 'sent' ? '#a855f7' : 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Sent ({sent.length})</button>
          <button onClick={() => setComposing(true)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #00d4aa, #00a888)', color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✏ Compose</button>
        </div>
      </div>

      {composing && (
        <div style={{ ...glass, border: '1px solid rgba(0,212,170,0.2)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#00d4aa', marginBottom: 12 }}>New Message to Admin</div>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: '#fff', fontSize: 13, marginBottom: 8, outline: 'none', boxSizing: 'border-box' }} />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Your message..." rows={4} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: '#fff', fontSize: 13, marginBottom: 8, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={sendMessage} disabled={sending || !body.trim()} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: body.trim() ? '#00d4aa' : 'rgba(255,255,255,0.05)', color: body.trim() ? '#000' : '#666', cursor: body.trim() ? 'pointer' : 'default', fontWeight: 700, fontSize: 12 }}>{sending ? 'Sending...' : 'Send'}</button>
            <button onClick={() => setComposing(false)} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {selected && (
        <div style={{ ...glass, border: '1px solid rgba(0,212,170,0.15)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{selected.subject || '(No subject)'}</div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>{timeAgo(selected.created_at)}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selected.body}</div>
          <button onClick={() => { setComposing(true); setSubject(`Re: ${selected.subject || ''}`); }} style={{ marginTop: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(0,212,170,0.3)', background: 'rgba(0,212,170,0.08)', color: '#00d4aa', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>↩ Reply</button>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 40 }}>Loading...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: 40 }}>No messages yet</div>}
          {list.map(m => (
            <div key={m.id} onClick={() => readMsg(m)} style={{ ...glass, padding: '12px 16px', cursor: 'pointer', borderLeft: !m.read ? '3px solid #00d4aa' : '3px solid transparent', opacity: m.read ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: m.read ? 400 : 700, color: '#fff' }}>{m.subject || '(No subject)'}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{timeAgo(m.created_at)}</div>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.body?.substring(0, 80)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//   CAPITAL CALLS VIEW
// ════════════════════════════════════════
function CapitalCallsView({ investor, isMobile }) {
  const [calls, setCalls] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [loading, setLoading] = useState(true);

  const API = (() => { if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL; return `http://${window.location.hostname}:4000/api`; })();
  const token = (() => { try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; } })();
  const hdr = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const glass = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: isMobile ? 16 : 24 };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [callsRes, distRes] = await Promise.all([
        fetch(`${API}/capital-calls`, { headers: hdr }),
        fetch(`${API}/distributions`, { headers: hdr }),
      ]);
      if (callsRes.ok) { const d = await callsRes.json(); setCalls(d.capitalCalls || []); }
      if (distRes.ok) { const d = await distRes.json(); setDistributions(d.distributions || []); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useState(() => { fetchData(); }, []);

  const statusColor = { pending: '#ffa502', funded: '#00d4aa', overdue: '#ff4757', cancelled: '#888' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, color: '#fff' }}>Capital Calls & Distributions</h2>

      <div style={glass}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#00d4aa', marginBottom: 16 }}>💰 Capital Calls</div>
        {loading ? <div style={{ color: 'rgba(255,255,255,0.3)' }}>Loading...</div> : calls.length === 0 ? <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No capital calls</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {calls.map(c => (
              <div key={c.id} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>${parseFloat(c.amount).toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Due: {c.due_date ? new Date(c.due_date).toLocaleDateString() : 'TBD'}</div>
                  {c.notes && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{c.notes}</div>}
                </div>
                <span style={{ padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: statusColor[c.status] || '#888', background: `${statusColor[c.status] || '#888'}15`, textTransform: 'uppercase' }}>{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={glass}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#a855f7', marginBottom: 16 }}>📤 Distributions</div>
        {distributions.length === 0 ? <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No distributions yet</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {distributions.map(d => {
              const myShare = (d.per_investor || []).find(i => i.userId === investor?.id);
              return (
                <div key={d.id} style={{ padding: 12, borderRadius: 10, background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#00d4aa' }}>+${myShare?.amount?.toLocaleString() || '0'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{d.type} distribution • {d.distributed_at ? new Date(d.distributed_at).toLocaleDateString() : 'Pending'}</div>
                  </div>
                  <span style={{ padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: d.status === 'distributed' ? '#00d4aa' : '#ffa502', background: d.status === 'distributed' ? 'rgba(0,212,170,0.1)' : 'rgba(255,165,2,0.1)' }}>{d.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//   FEES VIEW
// ════════════════════════════════════════
function FeesView({ investor, isMobile }) {
  const [summary, setSummary] = useState(null);
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);

  const API = (() => { if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL; return `http://${window.location.hostname}:4000/api`; })();
  const token = (() => { try { return localStorage.getItem('12tribes_auth_token'); } catch { return null; } })();
  const hdr = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const glass = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: isMobile ? 16 : 24 };

  const fetchFees = async () => {
    setLoading(true);
    try {
      const [sumRes, feeRes] = await Promise.all([
        fetch(`${API}/fees/summary`, { headers: hdr }),
        fetch(`${API}/fees`, { headers: hdr }),
      ]);
      if (sumRes.ok) { const d = await sumRes.json(); setSummary(d.summary || null); }
      if (feeRes.ok) { const d = await feeRes.json(); setFees(d.fees || []); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useState(() => { fetchFees(); }, []);

  if (loading) return <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 40 }}>Loading fee data...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, color: '#fff' }}>Fee Transparency</h2>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Mgmt Fee Rate', value: `${((summary.mgmtFeeRate || 0) * 100).toFixed(1)}%`, sub: 'Annual' },
            { label: 'Perf Fee Rate', value: `${((summary.perfFeeRate || 0) * 100).toFixed(0)}%`, sub: `Above ${((summary.hurdleRate || 0) * 100).toFixed(0)}% hurdle` },
            { label: 'Fees Accrued', value: `$${(summary.totalAccrued || 0).toFixed(2)}`, sub: 'Pending', color: '#ffa502' },
            { label: 'Fees Collected', value: `$${(summary.totalCollected || 0).toFixed(2)}`, sub: 'Total to date', color: '#a855f7' },
          ].map((kpi, i) => (
            <div key={i} style={glass}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>{kpi.label}</div>
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: kpi.color || '#00d4aa', marginTop: 4 }}>{kpi.value}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{kpi.sub}</div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div style={glass}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>High-Water Mark</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#00d4aa' }}>${(summary.highWaterMark || 0).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>Performance fees only charged on new all-time highs above this level + hurdle rate</div>
        </div>
      )}

      <div style={glass}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Fee History</div>
        {fees.length === 0 ? <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No fee entries yet</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Date', 'Type', 'Amount', 'AUM Basis', 'Rate', 'Status'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fees.slice(0, 50).map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.6)' }}>{f.period_start}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, color: f.fee_type === 'management' ? '#00d4aa' : '#a855f7', background: f.fee_type === 'management' ? 'rgba(0,212,170,0.1)' : 'rgba(168,85,247,0.1)' }}>{f.fee_type}</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#fff', fontWeight: 600 }}>${(f.amount || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.5)' }}>${(f.aum_basis || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.5)' }}>{((f.rate_applied || 0) * 100).toFixed(2)}%</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, color: f.status === 'collected' ? '#a855f7' : f.status === 'waived' ? '#888' : '#ffa502', background: f.status === 'collected' ? 'rgba(168,85,247,0.1)' : f.status === 'waived' ? 'rgba(136,136,136,0.1)' : 'rgba(255,165,2,0.1)' }}>{f.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//   DOCUMENT VAULT VIEW
// ════════════════════════════════════════

function DocumentVaultView({ investor, isMobile }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docDetail, setDocDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (window.location.hostname === 'localhost') return 'http://localhost:4000/api';
    return 'https://one2-tribes-api.onrender.com/api';
  })();
  const token = localStorage.getItem('12tribes_auth_token');
  const hdrs = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    fetch(`${API_BASE}/documents`, { headers: hdrs })
      .then(r => r.ok ? r.json() : { documents: [] })
      .then(data => setDocuments(data.documents || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const viewDocument = (doc) => {
    setSelectedDoc(doc);
    setDetailLoading(true);
    fetch(`${API_BASE}/documents/${doc.type}/${doc.id}`, { headers: hdrs })
      .then(r => r.ok ? r.json() : null)
      .then(data => setDocDetail(data))
      .catch(() => setDocDetail(null))
      .finally(() => setDetailLoading(false));
  };

  const typeIcons = { trades: '📈', wallet: '💰', tax: '📋', fees: '💳', capital: '🏦' };
  const typeColors = { trades: '#00d4aa', wallet: '#00D4FF', tax: '#a855f7', fees: '#ffa502', capital: '#10B981' };

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Loading documents...</div>;

  return (
    <div style={{ padding: isMobile ? 16 : 24 }}>
      <h2 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Document Vault</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>Your investment documents — trade confirmations, tax statements, fee reports, and wallet statements.</p>

      {selectedDoc && docDetail ? (
        <div>
          <button onClick={() => { setSelectedDoc(null); setDocDetail(null); }} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer', marginBottom: 20 }}>← Back to Documents</button>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 16 }}>{selectedDoc.title}</h3>
            {detailLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.4)' }}>Loading...</div>
            ) : docDetail.summary ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                {Object.entries(docDetail.summary).map(([key, val]) => (
                  <div key={key} style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{key.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#00D4FF' }}>{typeof val === 'number' ? (val > 100 ? `$${val.toLocaleString()}` : val) : val}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {(docDetail.trades || docDetail.entries || []).length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>Description</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(docDetail.trades || docDetail.entries || []).slice(0, 50).map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.5)' }}>{new Date(item.created_at || item.date).toLocaleDateString()}</td>
                        <td style={{ padding: '8px 10px', color: '#fff' }}>{item.symbol ? `${item.side} ${item.quantity} ${item.symbol}` : item.description || item.fee_type || 'Entry'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#00d4aa', fontWeight: 600 }}>${(item.quantity && item.entry_price ? item.quantity * item.entry_price : item.amount || item.gains || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          {documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.3)' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📁</div>
              <p>No documents available yet. Documents will appear as you trade and accrue fees.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 12 }}>
              {documents.map(doc => (
                <div key={doc.id} onClick={() => viewDocument(doc)} style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 14 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = typeColors[doc.type] || '#00D4FF'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${typeColors[doc.type] || '#00D4FF'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{typeIcons[doc.type] || '📄'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{doc.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                      {new Date(doc.date).toLocaleDateString()} {doc.count ? `• ${doc.count} entries` : ''} {doc.balance !== undefined ? `• $${doc.balance.toLocaleString()}` : ''}
                    </div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16 }}>→</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//   KYC ONBOARDING WIZARD
// ════════════════════════════════════════

function KYCOnboardingWizard({ investor, onComplete }) {
  const { isMobile } = useResponsive();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [riskAnswers, setRiskAnswers] = useState({ experience: null, tolerance: null, timeHorizon: null, lossReaction: null, income: null });
  const [riskProfile, setRiskProfile] = useState(null);
  const [accreditedChecks, setAccreditedChecks] = useState({ income: false, netWorth: false, certification: false, institutional: false });
  const [fundingAck, setFundingAck] = useState(false);

  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (window.location.hostname === 'localhost') return 'http://localhost:4000/api';
    return 'https://one2-tribes-api.onrender.com/api';
  })();
  const token = localStorage.getItem('12tribes_auth_token');
  const hdrs = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  const calculateRisk = () => {
    let s = 0;
    s += { none: 0, '1-3': 1, '3-10': 2, '10plus': 3 }[riskAnswers.experience] || 0;
    s += { conservative: 0, moderate: 3, aggressive: 5, veryAggressive: 7 }[riskAnswers.tolerance] || 0;
    s += { lessThan1: 0, '1-5': 2, '5-10': 4, '10plus': 5 }[riskAnswers.timeHorizon] || 0;
    s += { sellAll: 0, sellSome: 2, hold: 4, buyMore: 5 }[riskAnswers.lossReaction] || 0;
    s += { '50-100': 0, '100-200': 2, '200-500': 3, '500plus': 5 }[riskAnswers.income] || 0;
    if (s <= 5) return 'Conservative';
    if (s <= 10) return 'Moderate';
    if (s <= 15) return 'Aggressive';
    return 'Very Aggressive';
  };

  const isStep2Valid = dateOfBirth && address.street && address.city && address.state && address.zip;
  const isStep3Valid = Object.values(riskAnswers).every(v => v !== null);
  const isStep4Valid = Object.values(accreditedChecks).some(v => v);

  const handleNext = () => {
    setError('');
    if (step === 2 && !isStep2Valid) { setError('Please fill in all fields'); return; }
    if (step === 3 && !isStep3Valid) { setError('Please answer all questions'); return; }
    if (step === 3) setRiskProfile(calculateRisk());
    if (step === 4 && !isStep4Valid) { setError('Please confirm at least one criterion'); return; }
    if (step === 5 && !fundingAck) { setError('Please acknowledge funding requirements'); return; }
    if (step < 6) setStep(step + 1);
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/onboarding/save`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ complete: true, riskProfile: riskProfile || calculateRisk(), accreditedInvestor: true, onboardingData: { dateOfBirth, address, riskProfile: riskProfile || calculateRisk(), riskAnswers, accreditedChecks } })
      });
      if (!resp.ok) throw new Error('Save failed');
      onComplete();
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  const gCard = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: isMobile ? 16 : 24 };
  const iSt = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 12, color: 'rgba(255,255,255,0.9)', fontSize: 14, fontFamily: 'inherit', marginBottom: 12, boxSizing: 'border-box' };
  const btnP = { background: 'linear-gradient(135deg, #00d4aa 0%, #00a886 100%)', border: 'none', color: '#0a0a1a', padding: '12px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
  const btnS = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)', padding: '12px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' };

  const OptionBtn = ({ label, selected, onClick }) => (
    <button onClick={onClick} style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${selected ? '#00d4aa' : 'rgba(255,255,255,0.1)'}`, background: selected ? 'rgba(0,212,170,0.1)' : 'rgba(255,255,255,0.02)', color: selected ? '#00d4aa' : 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer', textAlign: 'left', width: '100%', marginBottom: 8, fontWeight: selected ? 600 : 400, transition: 'all 0.2s' }}>{label}</button>
  );

  const CheckItem = ({ label, checked, onChange }) => (
    <div onClick={onChange} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, background: checked ? 'rgba(0,212,170,0.05)' : 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${checked ? 'rgba(0,212,170,0.3)' : 'rgba(255,255,255,0.05)'}`, cursor: 'pointer' }}>
      <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${checked ? '#00d4aa' : 'rgba(255,255,255,0.2)'}`, background: checked ? '#00d4aa' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#0a0a1a', flexShrink: 0 }}>{checked ? '✓' : ''}</div>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{label}</span>
    </div>
  );

  const ProgressDots = () => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: isMobile ? 8 : 12, marginBottom: 24 }}>
      {[1,2,3,4,5,6].map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, background: s < step ? '#00d4aa' : s === step ? '#a855f7' : 'transparent', border: `2px solid ${s < step ? '#00d4aa' : s === step ? '#a855f7' : 'rgba(255,255,255,0.15)'}`, color: '#fff' }}>
            {s < step ? '✓' : s}
          </div>
          {i < 5 && <div style={{ width: isMobile ? 12 : 20, height: 2, background: 'rgba(255,255,255,0.08)' }} />}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)', padding: isMobile ? 16 : 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif", color: '#fff' }}>
      <div style={{ ...gCard, maxWidth: isMobile ? '100%' : 560, width: '100%' }}>
        {step > 1 && <ProgressDots />}

        {error && <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid #ff4757', borderRadius: 8, padding: 12, marginBottom: 16, color: '#ff4757', fontSize: 13 }}>{error}</div>}

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, marginBottom: 8 }}>Complete Your Profile</h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>We need a few details to set up your investment account.</p>
            <div style={{ textAlign: 'left', marginBottom: 24 }}>
              {['Personal details & identity', 'Risk profile assessment', 'Accredited investor verification', 'Funding acknowledgment'].map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#00d4aa', color: '#0a0a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>✓</div>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{t}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(2)} style={{ ...btnP, width: '100%' }}>Begin Setup</button>
            <button onClick={onComplete} style={{ marginTop: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 12, cursor: 'pointer' }}>Skip for now</button>
          </div>
        )}

        {/* Step 2: Personal Details */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Personal Details</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 20, textAlign: 'center' }}>Step 2 of 6</p>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6, textTransform: 'uppercase' }}>Date of Birth</label>
            <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} style={iSt} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6, textTransform: 'uppercase' }}>Street Address</label>
            <input type="text" value={address.street} onChange={e => setAddress({...address, street: e.target.value})} placeholder="123 Main Street" style={iSt} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <div><label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>CITY</label><input type="text" value={address.city} onChange={e => setAddress({...address, city: e.target.value})} style={{...iSt, marginBottom: 0}} /></div>
              <div><label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>STATE</label><input type="text" value={address.state} onChange={e => setAddress({...address, state: e.target.value})} style={{...iSt, marginBottom: 0}} /></div>
              <div><label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>ZIP</label><input type="text" value={address.zip} onChange={e => setAddress({...address, zip: e.target.value})} style={{...iSt, marginBottom: 0}} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button onClick={() => setStep(1)} style={btnS}>Back</button>
              <button onClick={handleNext} disabled={!isStep2Valid} style={{ ...btnP, opacity: isStep2Valid ? 1 : 0.4 }}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 3: Risk Profile */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Risk Profile</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 20, textAlign: 'center' }}>Step 3 of 6</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Investment Experience</label>
              {[['none','No experience'],['1-3','1-3 years'],['3-10','3-10 years'],['10plus','10+ years']].map(([v,l]) => <OptionBtn key={v} label={l} selected={riskAnswers.experience===v} onClick={() => setRiskAnswers({...riskAnswers, experience: v})} />)}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Risk Tolerance</label>
              {[['conservative','Conservative — Preserve capital'],['moderate','Moderate — Balanced growth'],['aggressive','Aggressive — High growth'],['veryAggressive','Very Aggressive — Maximum returns']].map(([v,l]) => <OptionBtn key={v} label={l} selected={riskAnswers.tolerance===v} onClick={() => setRiskAnswers({...riskAnswers, tolerance: v})} />)}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Investment Time Horizon</label>
              {[['lessThan1','Less than 1 year'],['1-5','1-5 years'],['5-10','5-10 years'],['10plus','10+ years']].map(([v,l]) => <OptionBtn key={v} label={l} selected={riskAnswers.timeHorizon===v} onClick={() => setRiskAnswers({...riskAnswers, timeHorizon: v})} />)}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>If your portfolio dropped 20%, you would:</label>
              {[['sellAll','Sell everything'],['sellSome','Sell some positions'],['hold','Hold and wait'],['buyMore','Buy more at lower prices']].map(([v,l]) => <OptionBtn key={v} label={l} selected={riskAnswers.lossReaction===v} onClick={() => setRiskAnswers({...riskAnswers, lossReaction: v})} />)}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Annual Income Range</label>
              {[['50-100','$50K - $100K'],['100-200','$100K - $200K'],['200-500','$200K - $500K'],['500plus','$500K+']].map(([v,l]) => <OptionBtn key={v} label={l} selected={riskAnswers.income===v} onClick={() => setRiskAnswers({...riskAnswers, income: v})} />)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button onClick={() => setStep(2)} style={btnS}>Back</button>
              <button onClick={handleNext} disabled={!isStep3Valid} style={{ ...btnP, opacity: isStep3Valid ? 1 : 0.4 }}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 4: Accredited Investor */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Accredited Investor</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textAlign: 'center' }}>Step 4 of 6</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16, textAlign: 'center' }}>Please confirm you meet at least one of the following criteria:</p>
            <CheckItem label="Annual income over $200K (or $300K jointly) for the last 2 years" checked={accreditedChecks.income} onChange={() => setAccreditedChecks({...accreditedChecks, income: !accreditedChecks.income})} />
            <CheckItem label="Net worth over $1M (excluding primary residence)" checked={accreditedChecks.netWorth} onChange={() => setAccreditedChecks({...accreditedChecks, netWorth: !accreditedChecks.netWorth})} />
            <CheckItem label="Hold Series 7, 65, or 82 license in good standing" checked={accreditedChecks.certification} onChange={() => setAccreditedChecks({...accreditedChecks, certification: !accreditedChecks.certification})} />
            <CheckItem label="Qualified institutional buyer or entity with $5M+ in assets" checked={accreditedChecks.institutional} onChange={() => setAccreditedChecks({...accreditedChecks, institutional: !accreditedChecks.institutional})} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button onClick={() => setStep(3)} style={btnS}>Back</button>
              <button onClick={handleNext} disabled={!isStep4Valid} style={{ ...btnP, opacity: isStep4Valid ? 1 : 0.4 }}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 5: Funding Acknowledgment */}
        {step === 5 && (
          <div>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Funding</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 20, textAlign: 'center' }}>Step 5 of 6</p>
            <div style={{ background: 'rgba(0,212,170,0.05)', border: '1px solid rgba(0,212,170,0.15)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, margin: 0 }}>Capital contributions are made via wire transfer or ACH after account approval. Minimum investment is subject to fund terms. You will receive funding instructions upon account activation.</p>
            </div>
            <CheckItem label="I understand the funding process and minimum investment requirements" checked={fundingAck} onChange={() => setFundingAck(!fundingAck)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button onClick={() => setStep(4)} style={btnS}>Back</button>
              <button onClick={handleNext} disabled={!fundingAck} style={{ ...btnP, opacity: fundingAck ? 1 : 0.4 }}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 6: Review & Complete */}
        {step === 6 && (
          <div>
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Review & Complete</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 20, textAlign: 'center' }}>Step 6 of 6</p>
            <div style={{ marginBottom: 20 }}>
              {[
                ['Name', `${investor?.firstName || ''} ${investor?.lastName || ''}`],
                ['Email', investor?.email || ''],
                ['Date of Birth', dateOfBirth],
                ['Address', `${address.street}, ${address.city}, ${address.state} ${address.zip}`],
                ['Risk Profile', riskProfile || calculateRisk()],
                ['Accredited', 'Verified'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 12, padding: 14, marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.6 }}>By completing setup, you certify the information provided is accurate and agree to the fund's terms and conditions.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => setStep(5)} style={btnS}>Back</button>
              <button onClick={handleComplete} disabled={loading} style={{ ...btnP, opacity: loading ? 0.5 : 1 }}>{loading ? 'Saving...' : 'Complete Setup'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
