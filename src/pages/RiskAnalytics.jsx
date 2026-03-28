import { useState, useEffect, useMemo } from "react";
import * as recharts from "recharts";
import { useResponsive } from '../hooks/useResponsive.js';
import BrandLogo from '../components/BrandLogo.jsx';
const {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — RISK ANALYTICS v1.0
//   VaR | Stress Testing | Drawdown Analysis
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.07)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 24, padding: 24,
  boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
  ...extra,
});

const inner = (extra = {}) => ({
  padding: 14, borderRadius: 16,
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
  ...extra,
});

// === DATA ===
function generateDrawdownHistory(days) {
  const data = [];
  let value = 60000, peak = 60000;
  for (let d = 0; d <= days; d++) {
    const ret = (Math.random() - 0.42) * 0.025;
    value *= (1 + ret);
    if (value > peak) peak = value;
    const dd = ((value - peak) / peak) * 100;
    if (d % 2 === 0) {
      data.push({ day: d, value: Math.round(value), peak: Math.round(peak), drawdown: parseFloat(dd.toFixed(2)) });
    }
  }
  return data;
}

function generateVaRDistribution() {
  const data = [];
  for (let i = -6; i <= 6; i += 0.2) {
    const density = Math.exp(-0.5 * Math.pow((i - 0.5) / 1.8, 2)) / (1.8 * Math.sqrt(2 * Math.PI));
    data.push({ return_pct: parseFloat(i.toFixed(1)), density: parseFloat((density * 100).toFixed(2)) });
  }
  return data;
}

function generateCorrelationMatrix() {
  const assets = ["Stocks", "Crypto", "Forex", "Options", "Futures"];
  const matrix = [];
  const corrs = [
    [1.00, 0.62, 0.15, 0.78, 0.85],
    [0.62, 1.00, 0.08, 0.45, 0.52],
    [0.15, 0.08, 1.00, 0.12, 0.18],
    [0.78, 0.45, 0.12, 1.00, 0.71],
    [0.85, 0.52, 0.18, 0.71, 1.00],
  ];
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      matrix.push({ row: assets[i], col: assets[j], value: corrs[i][j] });
    }
  }
  return { assets, matrix, corrs };
}

function generateStressScenarios() {
  return [
    { name: "Black Monday (1987)", spx: -22.6, portfolio: -14.2, maxLoss: -8520, recovery: "18 days", severity: "extreme" },
    { name: "Dot-com Crash (2000)", spx: -9.1, portfolio: -6.8, maxLoss: -4080, recovery: "12 days", severity: "severe" },
    { name: "GFC (2008)", spx: -17.0, portfolio: -11.3, maxLoss: -6780, recovery: "22 days", severity: "extreme" },
    { name: "COVID Crash (2020)", spx: -12.0, portfolio: -8.1, maxLoss: -4860, recovery: "8 days", severity: "severe" },
    { name: "Rate Shock (+200bps)", spx: -8.5, portfolio: -5.4, maxLoss: -3240, recovery: "6 days", severity: "moderate" },
    { name: "Crypto Winter (-60%)", spx: -2.1, portfolio: -9.8, maxLoss: -5880, recovery: "45 days", severity: "severe" },
    { name: "USD Flash Crash", spx: -1.5, portfolio: -7.2, maxLoss: -4320, recovery: "3 days", severity: "moderate" },
    { name: "Liquidity Freeze", spx: -6.3, portfolio: -10.5, maxLoss: -6300, recovery: "15 days", severity: "severe" },
  ];
}

function generateRollingRisk(days) {
  const data = [];
  let vol = 1.5, sharpe = 1.2, var95 = -1200;
  for (let d = 0; d < days; d += 5) {
    vol += (Math.random() - 0.48) * 0.3;
    vol = Math.max(0.5, Math.min(5, vol));
    sharpe += (Math.random() - 0.48) * 0.15;
    sharpe = Math.max(0, Math.min(3, sharpe));
    var95 += (Math.random() - 0.5) * 200;
    var95 = Math.min(-400, Math.max(-3000, var95));
    data.push({
      day: d, volatility: parseFloat(vol.toFixed(2)),
      sharpe: parseFloat(sharpe.toFixed(2)),
      var95: Math.round(var95),
    });
  }
  return data;
}

// === COMPONENTS ===

function CorrelationHeatmap({ data }) {
  const { assets, corrs } = data;
  const getColor = (v) => {
    if (v >= 0.7) return "#EF4444";
    if (v >= 0.4) return "#F59E0B";
    if (v >= 0.2) return "#10B981";
    return "#6B7280";
  };
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Correlation Matrix</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", margin: "0 auto" }}>
          <thead>
            <tr>
              <th style={{ padding: 8 }} />
              {assets.map(a => (
                <th key={a} style={{ padding: "8px 14px", fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((row, i) => (
              <tr key={row}>
                <td style={{ padding: "8px 14px", fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500, textAlign: "right" }}>{row}</td>
                {assets.map((col, j) => {
                  const v = corrs[i][j];
                  const bg = getColor(v);
                  return (
                    <td key={col} style={{ padding: 4 }}>
                      <div style={{
                        width: 56, height: 42, borderRadius: 8,
                        background: i === j ? "rgba(0,212,255,0.15)" : `${bg}${Math.round(v * 40 + 10).toString(16).padStart(2, "0")}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, color: i === j ? "#00D4FF" : bg,
                        border: `1px solid ${i === j ? "rgba(0,212,255,0.3)" : "rgba(255,255,255,0.04)"}`,
                      }}>
                        {v.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 16 }}>
        {[{ label: "Low (<0.2)", color: "#6B7280" }, { label: "Moderate (0.2-0.4)", color: "#10B981" }, { label: "High (0.4-0.7)", color: "#F59E0B" }, { label: "Critical (>0.7)", color: "#EF4444" }].map(l => (
          <span key={l.label} style={{ fontSize: 10, color: l.color, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />{l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function DrawdownChart({ data }) {
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Drawdown Analysis (90 Days)</div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `D${v}`} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `${v}%`} domain={["auto", 0]} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} formatter={v => [`${v}%`, "Drawdown"]} />
            <Area type="monotone" dataKey="drawdown" stroke="#EF4444" fill="url(#ddGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function VaRChart({ data }) {
  const var95 = -2.5, var99 = -3.8;
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4 }}>Value at Risk Distribution</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>Daily return distribution with VaR thresholds</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="varGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00D4FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="return_pct" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `${v}%`} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
            <Area type="monotone" dataKey="density" stroke="#00D4FF" fill="url(#varGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 12 }}>
        <div style={inner({ padding: "10px 20px", textAlign: "center" })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>VaR 95%</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#F59E0B", marginTop: 2 }}>-$1,500</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{var95}% daily</div>
        </div>
        <div style={inner({ padding: "10px 20px", textAlign: "center" })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>VaR 99%</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#EF4444", marginTop: 2 }}>-$2,280</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{var99}% daily</div>
        </div>
        <div style={inner({ padding: "10px 20px", textAlign: "center" })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>CVaR 95%</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#EF4444", marginTop: 2 }}>-$2,040</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Expected shortfall</div>
        </div>
      </div>
    </div>
  );
}

function StressTestTable({ scenarios }) {
  const sevColors = { extreme: "#EF4444", severe: "#F59E0B", moderate: "#10B981" };
  return (
    <div style={glass({ overflow: "hidden" })}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Historical Stress Test Scenarios</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              {["Scenario", "S&P 500", "Portfolio Impact", "Max Loss", "Recovery", "Severity"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "rgba(255,255,255,0.4)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map(s => (
              <tr key={s.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "12px 14px", fontWeight: 600, color: "#fff" }}>{s.name}</td>
                <td style={{ padding: "12px 14px", fontFamily: "monospace", color: "#EF4444" }}>{s.spx}%</td>
                <td style={{ padding: "12px 14px", fontFamily: "monospace", color: "#F59E0B" }}>{s.portfolio}%</td>
                <td style={{ padding: "12px 14px", fontFamily: "monospace", fontWeight: 600, color: "#EF4444" }}>${s.maxLoss.toLocaleString()}</td>
                <td style={{ padding: "12px 14px", color: "rgba(255,255,255,0.5)" }}>{s.recovery}</td>
                <td style={{ padding: "12px 14px" }}>
                  <span style={{
                    padding: "3px 10px", borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background: `${sevColors[s.severity]}18`, color: sevColors[s.severity],
                    textTransform: "uppercase",
                  }}>{s.severity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RollingRiskChart({ data }) {
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Rolling Risk Metrics (90 Days)</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `D${v}`} />
            <YAxis yAxisId="left" stroke="rgba(255,255,255,0.2)" fontSize={10} />
            <YAxis yAxisId="right" orientation="right" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `$${v}`} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="volatility" stroke="#F59E0B" strokeWidth={2} dot={false} name="Volatility %" />
            <Line yAxisId="left" type="monotone" dataKey="sharpe" stroke="#10B981" strokeWidth={2} dot={false} name="Sharpe" />
            <Bar yAxisId="right" dataKey="var95" name="VaR 95%">
              {data.map((d, i) => <Cell key={i} fill={d.var95 < -1800 ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.3)"} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RiskRadar() {
  const data = [
    { metric: "Market Risk", value: 72 },
    { metric: "Liquidity Risk", value: 45 },
    { metric: "Concentration", value: 58 },
    { metric: "Leverage", value: 65 },
    { metric: "Correlation", value: 42 },
    { metric: "Model Risk", value: 35 },
    { metric: "Counterparty", value: 28 },
    { metric: "Operational", value: 22 },
  ];
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Risk Profile Radar</div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <RadarChart data={data}>
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
            <PolarRadiusAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} domain={[0, 100]} />
            <Radar name="Risk Score" dataKey="value" stroke="#00D4FF" fill="#00D4FF" fillOpacity={0.15} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RiskLimitsPanel() {
  const limits = [
    { label: "Daily Loss Limit", current: -680, limit: -1200, pct: 56.7, status: "ok" },
    { label: "Max Drawdown", current: -4.8, limit: -8.0, pct: 60, status: "ok" },
    { label: "Margin Utilization", current: 62, limit: 80, pct: 77.5, status: "warning" },
    { label: "Single Position Max", current: 8.2, limit: 10, pct: 82, status: "warning" },
    { label: "Correlation Ceiling", current: 0.62, limit: 0.70, pct: 88.6, status: "critical" },
    { label: "Leverage Ratio", current: 2.1, limit: 3.0, pct: 70, status: "ok" },
  ];
  const statusColors = { ok: "#10B981", warning: "#F59E0B", critical: "#EF4444" };
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 20 }}>Risk Limits Monitor</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {limits.map(l => (
          <div key={l.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{l.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: statusColors[l.status] }}>{l.current}{typeof l.current === "number" && l.label.includes("%") ? "%" : ""}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>/ {l.limit}</span>
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.05)" }}>
              <div style={{
                height: "100%", borderRadius: 3, width: `${Math.min(l.pct, 100)}%`,
                background: l.pct > 85 ? "#EF4444" : l.pct > 70 ? "#F59E0B" : "#10B981",
                transition: "width 0.5s",
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// === MAIN ===
export default function TwelveTribes_RiskAnalytics() {
  const { isMobile, isTablet } = useResponsive();
  const [view, setView] = useState("overview");
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const drawdownData = useMemo(() => generateDrawdownHistory(90), []);
  const varData = useMemo(() => generateVaRDistribution(), []);
  const corrData = useMemo(() => generateCorrelationMatrix(), []);
  const stressScenarios = useMemo(() => generateStressScenarios(), []);
  const rollingRisk = useMemo(() => generateRollingRisk(90), []);

  const views = [
    { id: "overview", label: "Overview", icon: "◉" },
    { id: "stress", label: "Stress Test", icon: "◈" },
    { id: "correlation", label: "Correlation", icon: "◆" },
    { id: "limits", label: "Limits", icon: "◇" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a1a 0%, #0d1117 25%, #0a0f1e 50%, #111827 75%, #0a0a1a 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      overflow: "auto",
    }}>
      <div style={{ position: "fixed", top: -200, right: -200, width: 600, height: 600, background: "radial-gradient(circle, rgba(239,68,68,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(245,158,11,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{
        ...glass({ borderRadius: 0, borderTop: "none", borderLeft: "none", borderRight: "none", padding: `14px ${isMobile ? '16px' : '32px'}` }),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BrandLogo size={38} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5 }}>12 TRIBES</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase" }}>Risk Analytics</div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 3, overflowX: isMobile ? "auto" : "visible" }}>
          {views.map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              padding: "8px 18px", borderRadius: 12, border: "none", cursor: "pointer",
              fontSize: isMobile ? 11 : 13, fontWeight: 500, transition: "all 0.2s",
              background: view === v.id ? "rgba(0,212,255,0.12)" : "transparent",
              color: view === v.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
              whiteSpace: "nowrap",
            }}>
              {!isMobile && <span style={{ marginRight: 5 }}>{v.icon}</span>}{isMobile ? v.label.slice(0, 3) : v.label}
            </button>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            padding: "5px 12px", borderRadius: 9,
            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
            <span style={{ fontSize: 10, color: "#10B981", fontWeight: 600 }}>MONITORING</span>
          </div>
          <div style={{ fontSize: 13, fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}>{clock.toLocaleTimeString()}</div>
        </div>
      </div>

      <div style={{ padding: `20px ${isMobile ? '16px' : '32px'}`, maxWidth: 1600, margin: "0 auto" }}>
        {/* Top metrics */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {[
            { label: "Portfolio VaR (95%)", value: "-$1,500", color: "#F59E0B" },
            { label: "Max Drawdown", value: "-4.8%", color: "#EF4444" },
            { label: "Sharpe Ratio", value: "1.87", color: "#10B981" },
            { label: "Sortino Ratio", value: "2.41", color: "#10B981" },
            { label: "Beta", value: "1.24", color: "#00D4FF" },
            { label: "Margin Buffer", value: "$9,000", color: "#A855F7" },
          ].map(m => (
            <div key={m.label} style={{ ...glass({ padding: 16 }), flex: "1 1 140px" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>

        {view === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
              <VaRChart data={varData} />
              <DrawdownChart data={drawdownData} />
            </div>
            <RollingRiskChart data={rollingRisk} />
          </div>
        )}

        {view === "stress" && <StressTestTable scenarios={stressScenarios} />}

        {view === "correlation" && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 20 }}>
            <CorrelationHeatmap data={corrData} />
            <RiskRadar />
          </div>
        )}

        {view === "limits" && <RiskLimitsPanel />}
      </div>

      <div style={{ padding: `16px ${isMobile ? '16px' : '32px'}`, textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
        12 TRIBES v1.0 | Risk Analytics | All data simulated for demonstration
      </div>
    </div>
  );
}