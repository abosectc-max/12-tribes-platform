import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useResponsive } from '../hooks/useResponsive.js';
import BrandLogo from '../components/BrandLogo.jsx';

const API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();

// ═══════════════════════════════════════════
//   12 TRIBES — PLATFORM LANDING PAGE v1.0
//   Marketing | Onboarding | Conversion
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.07)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 24,
  boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
  ...extra,
});

function AnimatedCounter({ end, duration = 2000, prefix = "", suffix = "" }) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    let start = 0;
    const step = end / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [started, end, duration]);

  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
}

function FeatureCard({ icon, title, description, color }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...glass({ padding: 32 }),
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        transform: hovered ? "translateY(-4px)" : "none",
        boxShadow: hovered
          ? `0 16px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 40px ${color}15`
          : "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
        cursor: "default",
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 16, marginBottom: 20,
        background: `linear-gradient(135deg, ${color}25, ${color}08)`,
        border: `1px solid ${color}30`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28,
      }}>{icon}</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>{title}</h3>
      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, margin: 0 }}>{description}</p>
    </div>
  );
}

function AgentShowcase() {
  const agents = [
    { icon: "⚡", name: "Viper", desc: "Momentum scanner detecting breakout patterns across 500+ instruments in real-time", color: "#00D4FF" },
    { icon: "🔮", name: "Oracle", desc: "Macro intelligence engine analyzing geopolitical events, Fed policy, and economic indicators", color: "#A855F7" },
    { icon: "🛡️", name: "Sentinel", desc: "24/7 risk monitor enforcing position limits, drawdown gates, and margin requirements", color: "#10B981" },
    { icon: "🔥", name: "Phoenix", desc: "Self-healing engine that detects model drift, retrains algorithms, and rebalances autonomously", color: "#F59E0B" },
    { icon: "👻", name: "Spectre", desc: "Options strategist optimizing volatility trades, spreads, and theta decay capture", color: "#EF4444" },
    { icon: "🏛️", name: "Titan", desc: "Position sizer using Kelly Criterion to optimize capital allocation across all trades", color: "#A855F7" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
      {agents.map(a => (
        <div key={a.name} style={{
          ...glass({ padding: 24 }),
          display: "flex", gap: 16, alignItems: "flex-start",
          borderLeft: `3px solid ${a.color}`,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: `${a.color}15`, border: `1px solid ${a.color}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
          }}>{a.icon}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: a.color, marginBottom: 6 }}>{a.name}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{a.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TwelveTribes_Landing() {
  const { isMobile, isTablet } = useResponsive();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY || 0);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #050510 0%, #0a0a1a 20%, #0d1117 40%, #0a0f1e 60%, #111827 80%, #0a0a1a 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      overflow: "auto",
    }}>
      {/* Ambient effects */}
      <div style={{ position: "fixed", top: -300, right: -200, width: 900, height: 900, background: "radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 55%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", top: "30%", left: -200, width: 700, height: 700, background: "radial-gradient(circle, rgba(168,85,247,0.06) 0%, transparent 55%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, right: "20%", width: 600, height: 600, background: "radial-gradient(circle, rgba(16,185,129,0.05) 0%, transparent 55%)", pointerEvents: "none" }} />

      {/* Nav */}
      <nav style={{
        ...glass({ borderRadius: 0, borderTop: "none", borderLeft: "none", borderRight: "none", padding: `14px ${isMobile ? '16px' : '48px'}` }),
        position: "sticky", top: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: scrollY > 50 ? "rgba(10,10,26,0.9)" : "rgba(255,255,255,0.04)",
        transition: "background 0.3s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandLogo size={38} />
          {!isMobile && <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>12 TRIBES</span>}
        </div>
        {!isMobile && <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: "Mission Control", path: "/mission-control" },
            { label: "Trading Engine", path: "/trading-engine" },
            { label: "Risk Analytics", path: "/risk-analytics" },
            { label: "Performance", path: "/performance" },
            { label: "Market Intel", path: "/market-intel" },
          ].map(item => (
            <Link key={item.path} to={item.path} style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", cursor: "pointer", transition: "color 0.2s" }}>{item.label}</Link>
          ))}
        </div>}
        <div style={{ display: "flex", gap: isMobile ? 8 : 12 }}>
          <Link to="/investor-portal" style={{
            padding: isMobile ? "8px 16px" : "10px 24px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent", color: "#fff", fontSize: isMobile ? 11 : 13, fontWeight: 500, cursor: "pointer",
            display: "inline-flex", alignItems: "center",
          }}>{isMobile ? 'Sign' : 'Sign In'}</Link>
          <Link to="/mission-control" style={{
            padding: isMobile ? "8px 16px" : "10px 24px", borderRadius: 14, border: "none",
            background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
            fontSize: isMobile ? 11 : 13, fontWeight: 600, cursor: "pointer",
            boxShadow: "0 4px 16px rgba(0,212,255,0.3)",
            display: "inline-flex", alignItems: "center",
          }}>{isMobile ? 'Start' : 'Get Started'}</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ padding: isMobile ? "60px 16px 40px" : "120px 48px 80px", textAlign: "center", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{
          display: "inline-block", padding: "6px 20px", borderRadius: 20,
          background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
          fontSize: isMobile ? 10 : 12, color: "#00D4FF", fontWeight: 600, letterSpacing: 1.5,
          textTransform: "uppercase", marginBottom: 32,
        }}>AI-Powered Investment Intelligence</div>
        <h1 style={{
          fontSize: isMobile ? 36 : 64, fontWeight: 800, lineHeight: 1.05, margin: "0 0 24px",
          background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 50%, #00D4FF 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}>
          Where 12 Minds<br />Become One Edge
        </h1>
        <p style={{ fontSize: isMobile ? 14 : 20, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 640, margin: "0 auto 40px" }}>
          A collective investment platform powered by 6 AI agents working in concert. Real-time signal generation, autonomous risk management, and self-healing algorithms.
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          <Link to="/mission-control" style={{
            padding: "16px 40px", borderRadius: 18, border: "none",
            background: "linear-gradient(135deg, #00D4FF, #A855F7)", color: "#fff",
            fontSize: 16, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 6px 24px rgba(0,212,255,0.35)",
            transition: "all 0.2s",
            display: "inline-flex", alignItems: "center",
          }}>Launch Platform</Link>
          <Link to="/trading-engine" style={{
            padding: "16px 40px", borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)", color: "#fff",
            fontSize: 16, fontWeight: 500, cursor: "pointer",
            display: "inline-flex", alignItems: "center",
          }}>View Demo</Link>
        </div>
      </section>

      {/* Stats */}
      <section style={{ padding: isMobile ? "20px 16px 40px" : "40px 48px 80px" }}>
        <div style={{
          ...glass({ padding: isMobile ? 20 : 40 }),
          maxWidth: 1200, margin: "0 auto",
          display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 16 : 32, textAlign: "center",
        }}>
          {[
            { value: 60000, prefix: "$", label: "Assets Under Management", color: "#00D4FF" },
            { value: 12, label: "Investors", color: "#A855F7" },
            { value: 6, label: "AI Agents Active", color: "#10B981" },
            { value: 2876, label: "Trades Executed", color: "#F59E0B" },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: isMobile ? 24 : 42, fontWeight: 800, color: s.color }}>
                <AnimatedCounter end={s.value} prefix={s.prefix || ""} />
              </div>
              <div style={{ fontSize: isMobile ? 10 : 13, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: isMobile ? "20px 16px 40px" : "40px 48px 80px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 48 }}>
          <h2 style={{ fontSize: isMobile ? 24 : 36, fontWeight: 800, color: "#fff", margin: "0 0 12px" }}>Platform Capabilities</h2>
          <p style={{ fontSize: isMobile ? 13 : 16, color: "rgba(255,255,255,0.4)" }}>Six integrated modules designed for decision superiority</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
          <FeatureCard icon="📡" title="Multi-Source Intel Fusion" description="Ingest market data, news, SEC filings, sentiment, on-chain data, and macro signals into a unified layer." color="#00D4FF" />
          <FeatureCard icon="⚡" title="Adaptive Signal Generation" description="ML pipelines that continuously generate, validate, and rank trade signals across 5 asset classes." color="#A855F7" />
          <FeatureCard icon="🛡️" title="Risk Command Center" description="Real-time VaR, stress testing, correlation monitoring, and automated drawdown protection." color="#10B981" />
          <FeatureCard icon="🎯" title="Smart Execution" description="Intelligent order routing with slippage estimation, optimal timing, and human-in-the-loop override." color="#F59E0B" />
          <FeatureCard icon="🔥" title="Self-Healing Engine" description="Autonomous model repair detecting drift, retraining algorithms, and rebalancing without human intervention." color="#EF4444" />
          <FeatureCard icon="📊" title="Investor Portal" description="Individual dashboards with P&L attribution, monthly statements, tax reporting, and portfolio analytics." color="#00D4FF" />
        </div>
      </section>

      {/* AI Agents */}
      <section style={{ padding: isMobile ? "20px 16px 40px" : "40px 48px 80px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 48 }}>
          <h2 style={{ fontSize: isMobile ? 24 : 36, fontWeight: 800, color: "#fff", margin: "0 0 12px" }}>Meet the AI Agents</h2>
          <p style={{ fontSize: isMobile ? 13 : 16, color: "rgba(255,255,255,0.4)" }}>Six specialized agents working in concert to find and execute the best trades</p>
        </div>
        <AgentShowcase />
      </section>

      {/* Architecture */}
      <section style={{ padding: isMobile ? "20px 16px 40px" : "40px 48px 80px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={glass({ padding: isMobile ? 24 : 48 })}>
          <h2 style={{ fontSize: isMobile ? 20 : 28, fontWeight: 700, color: "#fff", marginBottom: isMobile ? 16 : 32, textAlign: "center" }}>Platform Architecture</h2>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { label: "Data Ingestion", sub: "47 sources", color: "#00D4FF" },
              { label: "Signal Processing", sub: "342 signals/hr", color: "#A855F7" },
              { label: "Risk Filter", sub: "64% approved", color: "#F59E0B" },
              { label: "Position Sizing", sub: "Kelly 0.5x", color: "#10B981" },
              { label: "Execution", sub: "47ms avg", color: "#EF4444" },
              { label: "Self-Healing", sub: "96.1% accuracy", color: "#F59E0B" },
            ].map((stage, i) => (
              <div key={stage.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  padding: "16px 24px", borderRadius: 16,
                  background: `${stage.color}10`, border: `1px solid ${stage.color}30`,
                  textAlign: "center", minWidth: 130,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: stage.color }}>{stage.label}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{stage.sub}</div>
                </div>
                {i < 5 && <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 18 }}>→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — Request Access Waitlist Form */}
      <RequestAccessSection isMobile={isMobile} glass={glass} />

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: isMobile ? "20px 16px" : "40px 48px",
        display: "flex", justifyContent: isMobile ? "center" : "space-between", alignItems: "center",
        maxWidth: 1200, margin: "0 auto",
        flexDirection: isMobile ? "column" : "row",
        gap: isMobile ? 12 : 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandLogo size={32} />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1.5 }}>12 TRIBES</span>
        </div>
        <div style={{ fontSize: isMobile ? 9 : 11, color: "rgba(255,255,255,0.2)", textAlign: isMobile ? "center" : "left" }}>
          12 Tribes Investments | AI-Powered Investment Platform | All data simulated for demonstration
        </div>
      </footer>
    </div>
  );
}


// ═══════ REQUEST ACCESS WAITLIST FORM ═══════
function RequestAccessSection({ isMobile, glass }) {
  const [formState, setFormState] = useState("idle"); // idle | submitting | submitted | error
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [responseMsg, setResponseMsg] = useState("");

  const inputStyle = {
    width: "100%", padding: "12px 16px", borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)",
    color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setFormState("submitting");
    try {
      const resp = await fetch(`${API_BASE}/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), message: message.trim() }),
      });
      const data = await resp.json();
      if (data.status === "approved") {
        setResponseMsg("You're approved! Head to Sign In to create your account.");
      } else if (data.status === "pending") {
        setResponseMsg(data.message || "Request submitted! We'll notify you when approved.");
      } else if (data.status === "denied") {
        setResponseMsg(data.message || "Your request was not approved.");
      } else if (data.error) {
        setResponseMsg(data.error);
        setFormState("error");
        return;
      }
      setFormState("submitted");
    } catch (err) {
      setResponseMsg("Network error. Please try again.");
      setFormState("error");
    }
  };

  if (formState === "submitted") {
    return (
      <section style={{ padding: isMobile ? "30px 16px 50px" : "60px 48px 100px", textAlign: "center" }}>
        <div style={{
          ...glass({ padding: isMobile ? "30px 20px" : "60px 48px" }),
          maxWidth: 800, margin: "0 auto",
          background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.06))",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <h2 style={{ fontSize: isMobile ? 20 : 28, fontWeight: 800, color: "#fff", margin: "0 0 12px" }}>Request Received</h2>
          <p style={{ fontSize: isMobile ? 13 : 16, color: "rgba(255,255,255,0.6)", margin: 0, lineHeight: 1.6 }}>
            {responseMsg}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: isMobile ? "30px 16px 50px" : "60px 48px 100px", textAlign: "center" }}>
      <div style={{
        ...glass({ padding: isMobile ? "30px 20px" : "60px 48px" }),
        maxWidth: 800, margin: "0 auto",
        background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.06))",
      }}>
        <h2 style={{ fontSize: isMobile ? 20 : 32, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>Ready to Join the Tribe?</h2>
        <p style={{ fontSize: isMobile ? 13 : 16, color: "rgba(255,255,255,0.5)", margin: "0 0 28px" }}>
          12 investors. 6 AI agents. One unified edge. Request access below.
        </p>

        <form onSubmit={handleSubmit} style={{
          display: "flex", flexDirection: "column", gap: 12,
          maxWidth: 480, margin: "0 auto", textAlign: "left",
        }}>
          <div style={{ display: "flex", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
            <input type="text" placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} required
              style={inputStyle} onFocus={e => e.target.style.borderColor = "rgba(0,212,255,0.5)"} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />
            <input type="text" placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} required
              style={inputStyle} onFocus={e => e.target.style.borderColor = "rgba(0,212,255,0.5)"} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />
          </div>
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required
            style={inputStyle} onFocus={e => e.target.style.borderColor = "rgba(0,212,255,0.5)"} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />
          <textarea placeholder="Why do you want to join? (optional)" value={message} onChange={e => setMessage(e.target.value)}
            rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            onFocus={e => e.target.style.borderColor = "rgba(0,212,255,0.5)"} onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"} />

          {formState === "error" && (
            <div style={{ color: "#ff6b6b", fontSize: 13, textAlign: "center" }}>{responseMsg}</div>
          )}

          <button type="submit" disabled={formState === "submitting"} style={{
            padding: "14px 48px", borderRadius: 18, border: "none",
            background: formState === "submitting" ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #00D4FF, #A855F7)",
            color: "#fff", fontSize: 16, fontWeight: 700, cursor: formState === "submitting" ? "wait" : "pointer",
            boxShadow: "0 6px 24px rgba(0,212,255,0.35)", marginTop: 8,
            transition: "all 0.3s", opacity: formState === "submitting" ? 0.7 : 1,
          }}>
            {formState === "submitting" ? "Submitting..." : "Request Access"}
          </button>
        </form>
      </div>
    </section>
  );
}