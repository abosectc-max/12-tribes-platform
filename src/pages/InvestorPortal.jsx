import { useState, useEffect, useMemo, useCallback } from "react";
import * as recharts from "recharts";
import { useResponsive } from '../hooks/useResponsive';
import {
  registerUser, registerPasskey, authenticateWithPasskey, loginWithEmail,
  isPasskeySupported, getUserByEmail, setSession, getSession, logout as authLogout,
  changePassword, getVerificationCode, verifyEmail, isEmailVerified, resendVerificationCode,
  generate2FASecret, verify2FASetup, verify2FACode, is2FAEnabled, disable2FA,
  requestPasswordReset, resetPassword,
} from '../store/authStore.js';
import { createWallet, ensureWallet, getWallet, getPositions, getTradeHistory, tickPrices, getMarketPrices } from '../store/walletStore.js';
import { recordSnapshot, getPerformanceMetrics, getEquityHistoryByPeriod, getPositionPerformance } from '../store/performanceTracker.js';
import {
  initFundManager, getFundSettings, updateFundSettings,
  startAutoTrading, stopAutoTrading, getAutoTradingStatus,
  simulateAgentTrade, getWithdrawalHistory, getCompoundProjection,
} from '../store/fundManager.js';
import BrandLogo from '../components/BrandLogo.jsx';

const {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — INVESTOR PORTAL v2.0
//   Passkey Auth | Left Sidebar | Onboarding
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

// === GLASS STYLES ===
const glass = {
  background: "rgba(255,255,255,0.07)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "24px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
};

const inputStyle = {
  width: "100%", padding: "14px 18px", borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 15,
  outline: "none", transition: "all 0.2s", boxSizing: "border-box",
  fontFamily: "inherit",
};

const focusGlow = "0 0 0 3px rgba(0,212,255,0.15)";

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

function generateTransactions() {
  const types = ["Deposit", "Dividend", "Rebalance", "Fee"];
  const txns = [];
  for (let i = 0; i < 10; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const amount = type === "Deposit" ? 100000 : type === "Fee" ? -(Math.random() * 20 + 5) : (Math.random() * 200 + 10);
    txns.push({
      id: `TXN_${String(i + 1).padStart(4, "0")}`,
      date: new Date(2026, Math.floor(Math.random() * 3), Math.floor(Math.random() * 28) + 1).toLocaleDateString(),
      type, amount: amount.toFixed(2),
      description: type === "Deposit" ? "Initial contribution" : type === "Dividend" ? "Monthly distribution" : type === "Fee" ? "Management fee" : "Quarterly rebalance",
    });
  }
  return txns.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function generateMonthlyStatements() {
  return [
    { month: "January 2026", startValue: 100000, endValue: 104680, returnPct: 4.68, fees: 250 },
    { month: "February 2026", startValue: 104680, endValue: 109952, returnPct: 5.04, fees: 262 },
    { month: "March 2026", startValue: 109952, endValue: 110667, returnPct: 0.65, fees: 275 },
  ];
}


// ════════════════════════════════════════
//   AUTH SCREEN — Login / Register / Passkey
// ════════════════════════════════════════

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "passkey-setup"
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
    </div>
  );
}

// ═══════ LOGIN FORM ═══════
function LoginForm({ onAuth, onSwitch, isMobile }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMode, setResetMode] = useState(false); // forgot password flow
  const [resetStep, setResetStep] = useState(1); // 1: enter email, 2: enter code + new password
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    if (!email.includes("@")) { setError("Enter your email first"); return; }
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
    if (!email.includes("@")) { setError("Enter a valid email address"); return; }
    if (!password) { setError("Enter your password"); return; }
    setLoading(true);
    try {
      const result = await loginWithEmail(email, password);
      setLoading(false);
      if (result.success) {
        onAuth(result.user);
      } else {
        setError(result.error || 'Login failed. Please try again.');
      }
    } catch (err) {
      setLoading(false);
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

            {/* Forgot Password Link */}
            <div style={{ textAlign: "right", marginTop: -6 }}>
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
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>New to 12 Tribes?</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
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
  const [passkeyStatus, setPasskeyStatus] = useState("pending"); // pending | success | skipped | error

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
    if (password.length < 6) return "Password must be at least 6 characters";
    return null;
  };

  const [verificationCode, setVerificationCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState("");

  const handleRegister = async () => {
    const err = validateStep1();
    if (err) { setError(err); return; }
    setError(""); setLoading(true);

    const result = await registerUser({ firstName, lastName, email, phone: formatPhone(phone), password });
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
              <input type="password" placeholder="Min 6 characters" value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleRegister()}
                style={inputStyle} />
            </div>

            {error && <div style={{ fontSize: 12, color: "#EF4444", padding: "0 4px" }}>{error}</div>}

            <button onClick={handleRegister}
              style={{
                width: "100%", padding: "14px", borderRadius: 16, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
                fontSize: 15, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,212,255,0.3)",
                marginTop: 4,
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
  { id: "performance", label: "Performance", icon: "▲" },
  { id: "activity", label: "Activity", icon: "◈" },
  { id: "agents", label: "AI Agents", icon: "◆" },
  { id: "statements", label: "Statements", icon: "▣" },
  { id: "paper-trading", label: "Paper Trading", icon: "⬢" },
  { id: "fund-management", label: "Fund Mgmt", icon: "⟐" },
  { id: "settings", label: "Settings", icon: "◇" },
];

function LeftSidebar({ activeTab, onTabChange, investor, onLogout, isOpen, onToggle, isMobile }) {
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
        ...glass, borderRadius: 0, borderLeft: "none", borderTop: "none", borderBottom: "none",
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
              fontSize: 20, cursor: "pointer", padding: 4,
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
          {SIDEBAR_ITEMS.map(item => {
            const active = activeTab === item.id;
            return (
              <button key={item.id}
                onClick={() => { onTabChange(item.id); if (isMobile) onToggle(); }}
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
              </button>
            );
          })}
        </div>

        {/* Sign Out */}
        <div style={{ padding: "12px 12px 20px" }}>
          <button onClick={onLogout}
            style={{
              width: "100%", padding: "12px 16px", borderRadius: 14, cursor: "pointer",
              border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)",
              color: "#EF4444", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, justifyContent: "center",
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
//   PERFORMANCE VIEW — Daily/Weekly/Monthly/Annual
// ════════════════════════════════════════

function PerformanceView({ investor, wallet, positions, tradeHistory, isMobile }) {
  const [chartPeriod, setChartPeriod] = useState("monthly");

  const perf = getPerformanceMetrics(investor.id, wallet);
  const chartData = getEquityHistoryByPeriod(investor.id, chartPeriod, perf.currentEquity, perf.initialBalance);
  const breakdown = getPositionPerformance(positions, tradeHistory);

  const periods = [
    { key: "daily", label: "Today", ...perf.daily },
    { key: "weekly", label: "7 Days", ...perf.weekly },
    { key: "monthly", label: "30 Days", ...perf.monthly },
    { key: "annual", label: "1 Year", ...perf.annual },
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
          <span style={{ fontSize: 12, fontWeight: 700, color }}>{typeof value === 'number' ? value.toFixed(2) : value}{suffix}</span>
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
          <div style={{ fontSize: 28, fontWeight: 800, color: "#fff" }}>${perf.currentEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", display: isMobile ? "none" : "block" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>All-Time P&L</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: perf.allTime.pnl >= 0 ? "#10B981" : "#EF4444" }}>
            {perf.allTime.pnl >= 0 ? "+" : ""}${perf.allTime.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", display: isMobile ? "none" : "block" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>All-Time Return</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: perf.allTime.return >= 0 ? "#10B981" : "#EF4444" }}>
            {perf.allTime.return >= 0 ? "+" : ""}{perf.allTime.return.toFixed(2)}%
          </div>
        </div>
        {perf.winStreak > 0 && (
          <>
            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", display: isMobile ? "none" : "block" }} />
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
          <RiskBar label="Sharpe Ratio" value={perf.sharpeRatio} max={3} color="#00D4FF" />
          <RiskBar label="Daily Volatility" value={perf.volatility} max={5} color="#F59E0B" suffix="%" />
          <RiskBar label="Max Drawdown" value={perf.maxDrawdown} max={25} color="#EF4444" suffix="%" />
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
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Best Day</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{perf.bestDay.date}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#10B981" }}>+{perf.bestDay.return.toFixed(2)}%</span>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Worst Day</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{perf.worstDay.date}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#EF4444" }}>{perf.worstDay.return.toFixed(2)}%</span>
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
//   FUND MANAGEMENT VIEW
// ════════════════════════════════════════

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
    background: "rgba(255,255,255,0.07)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 24,
    boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
  };

  const pillBtn = (active, color = "#00D4FF") => ({
    padding: "8px 16px", borderRadius: 12, cursor: "pointer",
    border: active ? `1px solid ${color}40` : "1px solid rgba(255,255,255,0.08)",
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

      {/* Withdrawal History */}
      {withdrawHistory.length > 0 && (
        <div style={{ ...glassStyle, padding: isMobile ? 20 : 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Withdrawal History</div>
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

  // Check initial status — re-check after server sync completes (async pull)
  useEffect(() => {
    const checkAndRestore = () => {
      const status = getAutoTradingStatus(investorId);
      if (status && status.isAutoTrading) {
        setTradingActive(true);
        setTradingMode(status.tradingMode || 'balanced');
        setSessionStats({ trades: status.totalTradesExecuted || 0, pnl: status.sessionPnL || 0, startTime: status.tradingStartedAt });
        return true;
      }
      return false;
    };
    // Immediate check (covers localStorage hit)
    if (!checkAndRestore()) {
      // Delayed re-check catches async server pull that restores isAutoTrading
      const t1 = setTimeout(checkAndRestore, 1500);
      const t2 = setTimeout(checkAndRestore, 3500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [investorId]);

  // Auto-trade interval when active
  useEffect(() => {
    if (!tradingActive) return;
    const interval = setInterval(() => {
      const trade = simulateAgentTrade(investorId);
      if (trade) {
        setRecentTrades(prev => [trade, ...prev].slice(0, 8));
        setSessionStats(prev => ({
          ...prev,
          trades: prev.trades + 1,
          pnl: prev.pnl + (trade.estimatedPnL || 0),
        }));
        if (onTick) onTick();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [tradingActive, investorId, onTick]);

  const handleStart = () => {
    setIsStarting(true);
    initFundManager(investorId);
    setTimeout(() => {
      startAutoTrading(investorId, tradingMode);
      setTradingActive(true);
      setSessionStats({ trades: 0, pnl: 0, startTime: Date.now() });
      setIsStarting(false);
    }, 1500);
  };

  const handleStop = () => {
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
    background: "rgba(255,255,255,0.07)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 24,
    boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
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
                border: tradingMode === m.key ? "1px solid rgba(0,212,255,0.4)" : "1px solid rgba(255,255,255,0.08)",
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
        <button onClick={handleStop}
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
          <button key={m} onClick={() => handleModeChange(m)}
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

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Trades Executed", v: sessionStats.trades, c: "#00D4FF" },
          { l: "Session P&L", v: `${sessionStats.pnl >= 0 ? '+' : ''}$${sessionStats.pnl.toFixed(0)}`, c: sessionStats.pnl >= 0 ? "#10B981" : "#EF4444" },
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

  // Live wallet data — refreshes every 3 seconds + records equity snapshots
  useEffect(() => {
    const interval = setInterval(() => {
      tickPrices();
      const w = getWallet(investor.id);
      if (w) recordSnapshot(investor.id, w);
      setTick(t => t + 1);
    }, 3000);
    // Record initial snapshot on mount
    const w0 = getWallet(investor.id);
    if (w0) recordSnapshot(investor.id, w0);
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
  const transactions = useMemo(() => generateTransactions(), [investor]);
  const statements = useMemo(() => generateMonthlyStatements(), []);

  const firstName = investor.firstName || investor.name?.split(' ')[0] || 'Investor';
  const sidebarWidth = isMobile ? 0 : 260;

  const allocation = [
    { name: "Stocks", value: 25, color: "#00D4FF" },
    { name: "Crypto", value: 15, color: "#A855F7" },
    { name: "Forex", value: 20, color: "#10B981" },
    { name: "Options", value: 15, color: "#F59E0B" },
    { name: "Futures", value: 10, color: "#EF4444" },
    { name: "Cash", value: 15, color: "#6B7280" },
  ];

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
      />

      {/* Main Content (offset by sidebar width on desktop) */}
      <div style={{ marginLeft: sidebarWidth, minHeight: "100vh", transition: "margin 0.3s" }}>
        {/* Top Bar */}
        <div style={{
          ...glass, borderRadius: 0, borderTop: "none", borderRight: "none",
          padding: `calc(14px + ${safeAreaTop}) 24px 14px 24px`, display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Mobile hamburger */}
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)}
                style={{
                  background: "none", border: "none", color: "#00D4FF",
                  fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1,
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

          <div style={{
            padding: "6px 14px", borderRadius: 10,
            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
            fontSize: 11, fontWeight: 600, color: "#10B981",
          }}>
            ● Markets Open
          </div>
        </div>

        {/* Content Area */}
        <div style={{ padding: isMobile ? 16 : 28, maxWidth: 1100 }}>

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
                    <span style={{ fontSize: 14, color: "#A855F7", fontWeight: 600 }}>8.33%</span>
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
                  { l: "Total Trades", v: `${(wallet?.tradeCount || 0) + tradeHistory.length}`, c: "#00D4FF" },
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

          {/* ═══ ACTIVITY VIEW ═══ */}
          {activeTab === "activity" && (
            <div style={{ ...glass, padding: 24, overflowX: "auto" }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Transaction History</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 500 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                    {["Date", "Type", "Description", "Amount"].map(h => (
                      <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "rgba(255,255,255,0.4)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(t => (
                    <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.6)" }}>{t.date}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: t.type === "Deposit" ? "rgba(0,212,255,0.1)" : t.type === "Fee" ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)", color: t.type === "Deposit" ? "#00D4FF" : t.type === "Fee" ? "#EF4444" : "#10B981" }}>{t.type}</span>
                      </td>
                      <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.6)" }}>{t.description}</td>
                      <td style={{ padding: "12px 14px", fontFamily: "monospace", fontWeight: 600, color: parseFloat(t.amount) >= 0 ? "#10B981" : "#EF4444" }}>
                        {parseFloat(t.amount) >= 0 ? "+" : ""}${t.amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ═══ AI AGENTS VIEW ═══ */}
          {activeTab === "agents" && (
            <div style={{ ...glass, padding: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>AI Agents Working For You</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 12 }}>
                {[
                  { icon: "⚡", name: "Viper", role: "Momentum & Speed", status: "Active", color: "#00E676", trades: 47, winRate: "78%", pnl: "+$412" },
                  { icon: "🔮", name: "Oracle", role: "Macro Intelligence", status: "Active", color: "#A855F7", trades: 31, winRate: "82%", pnl: "+$289" },
                  { icon: "👻", name: "Spectre", role: "Options Strategy", status: "Standby", color: "#FF6B6B", trades: 18, winRate: "72%", pnl: "+$156" },
                  { icon: "🛡️", name: "Sentinel", role: "Risk Guardian", status: "Active", color: "#00D4FF", trades: 0, winRate: "N/A", pnl: "$0" },
                  { icon: "🔥", name: "Phoenix", role: "Self-Healing", status: "Active", color: "#FFD93D", trades: 5, winRate: "100%", pnl: "+$88" },
                  { icon: "🏛️", name: "Titan", role: "Position Sizing", status: "Active", color: "#FF8A65", trades: 22, winRate: "81%", pnl: "+$201" },
                ].map(a => (
                  <div key={a.name} style={{ padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                      <span style={{ fontSize: 28 }}>{a.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: a.color }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{a.role}</div>
                      </div>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.status === "Active" ? "#10B981" : "#F59E0B", boxShadow: `0 0 6px ${a.status === "Active" ? "#10B981" : "#F59E0B"}` }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[{ l: "Trades", v: a.trades }, { l: "Win Rate", v: a.winRate }, { l: "P&L", v: a.pnl }].map(s => (
                        <div key={s.l} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 4 }}>{s.l}</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ STATEMENTS VIEW ═══ */}
          {activeTab === "statements" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Monthly Statements</div>
              {statements.map(s => (
                <div key={s.month} style={{ ...glass, padding: 24, display: "flex", alignItems: isMobile ? "stretch" : "center", gap: 20, flexDirection: isMobile ? "column" : "row" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{s.month}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Monthly performance report</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                    {[{ l: "START", v: `$${s.startValue.toLocaleString()}`, c: "rgba(255,255,255,0.7)" }, { l: "END", v: `$${s.endValue.toLocaleString()}`, c: "#fff" }, { l: "RETURN", v: `+${s.returnPct}%`, c: "#10B981" }, { l: "FEES", v: `-$${s.fees}`, c: "#EF4444" }].map(m => (
                      <div key={m.l} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>{m.l}</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: m.c }}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                  <button style={{ padding: "10px 20px", borderRadius: 12, border: "1px solid rgba(0,212,255,0.3)", background: "rgba(0,212,255,0.08)", color: "#00D4FF", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>View PDF</button>
                </div>
              ))}
            </div>
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

          {/* ═══ SETTINGS VIEW ═══ */}
          {activeTab === "settings" && (
            <SettingsView investor={investor} isMobile={isMobile} />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "20px 24px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
          12 TRIBES v2.0 | AI-Powered Investment Platform | Investor Portal
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//   SETTINGS VIEW — Password, 2FA, Account
// ════════════════════════════════════════

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

  const sectionStyle = {
    ...glass, padding: isMobile ? 24 : 32, maxWidth: 600, marginBottom: 20,
  };
  const labelStyle = { fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 };
  const fieldStyle = { padding: "12px 16px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 15, color: "rgba(255,255,255,0.7)" };
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
    if (!currentPw) { setPwMsg({ type: "error", text: "Enter your current password" }); return; }
    if (newPw.length < 6) { setPwMsg({ type: "error", text: "New password must be at least 6 characters" }); return; }
    if (newPw !== confirmPw) { setPwMsg({ type: "error", text: "Passwords do not match" }); return; }
    setPwLoading(true);
    const result = await changePassword(investor.email, currentPw, newPw);
    setPwLoading(false);
    if (result.success) {
      setPwMsg({ type: "success", text: "Password updated successfully" });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } else {
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
            { label: "Passkey", value: investor.hasPasskey ? "Enabled" : "Not set up" },
            { label: "2FA", value: twoFAEnabled ? "Enabled" : "Disabled", badge: twoFAEnabled ? "Active" : null, badgeColor: "#10B981" },
            { label: "Ownership", value: "8.33%" },
            { label: "Account Type", value: "Member — LLC" },
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
            <div style={{ padding: 20, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
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
            <div style={{ padding: 20, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
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
    background: "rgba(255,255,255,0.07)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 24,
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

            <div style={{ padding: "16px 0", marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
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
  if (savedSession) ensureWallet(savedSession); // Ensure wallet exists for restored sessions
  const [user, setUser] = useState(savedSession || null);
  const [phase, setPhase] = useState(() => {
    if (!savedSession) return "auth";
    if (!checkTermsAccepted(savedSession.id)) return "terms";
    return "dashboard";
  }); // "auth" | "terms" | "2fa" | "onboarding" | "dashboard"

  const handleAuth = (authenticatedUser) => {
    // Ensure wallet exists for returning users (creates $100K wallet if missing)
    ensureWallet(authenticatedUser);
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
    return <OnboardingTutorial investor={user} onComplete={() => setPhase("dashboard")} />;
  }

  return <PortfolioDashboard investor={user} onLogout={handleLogout} />;
}
