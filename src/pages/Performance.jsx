import { useState, useEffect, useMemo } from "react";
import * as recharts from "recharts";
import { useResponsive } from '../hooks/useResponsive.js';
import BrandLogo from '../components/BrandLogo.jsx';
const {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Legend
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — PERFORMANCE ANALYTICS v1.0
//   Attribution | Benchmarks | Deep Dive
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

const glass = (extra = {}) => ({
  background: "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 50%, rgba(220,230,255,0.12) 100%)",
  backdropFilter: "blur(80px) saturate(220%) brightness(1.15)",
  WebkitBackdropFilter: "blur(80px) saturate(220%) brightness(1.15)",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 24, padding: 24,
  boxShadow: "0 8px 40px rgba(0,0,0,0.08), 0 0 120px rgba(180,200,255,0.06), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(255,255,255,0.1)",
  ...extra,
});

const inner = (extra = {}) => ({
  padding: 14, borderRadius: 16,
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
  ...extra,
});

// === DATA ===
function generateBenchmarkComparison(days) {
  const data = [];
  let portfolio = 100, spx = 100, btc = 100, bonds = 100;
  for (let d = 0; d <= days; d++) {
    if (d > 0) {
      portfolio *= (1 + (Math.random() - 0.4) * 0.025);
      spx *= (1 + (Math.random() - 0.47) * 0.015);
      btc *= (1 + (Math.random() - 0.48) * 0.04);
      bonds *= (1 + (Math.random() - 0.49) * 0.005);
    }
    if (d % 3 === 0 || d === days) {
      data.push({
        day: d,
        portfolio: parseFloat(portfolio.toFixed(2)),
        "S&P 500": parseFloat(spx.toFixed(2)),
        "BTC": parseFloat(btc.toFixed(2)),
        "Bonds": parseFloat(bonds.toFixed(2)),
      });
    }
  }
  return data;
}

function generateMonthlyReturns() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months.slice(0, 3).map((m, i) => ({
    month: m,
    portfolio: parseFloat(((Math.random() * 8 + 2) * (i === 2 ? 0.3 : 1)).toFixed(2)),
    spx: parseFloat(((Math.random() * 4 + 0.5) * (i === 2 ? 0.2 : 1)).toFixed(2)),
    alpha: 0,
  })).map(m => ({ ...m, alpha: parseFloat((m.portfolio - m.spx).toFixed(2)) }));
}

function generateAttribution() {
  return [
    { asset: "Stocks", return_pct: 4.2, contribution: 1.05, weight: 25, color: "#00D4FF" },
    { asset: "Crypto", return_pct: 8.7, contribution: 1.31, weight: 15, color: "#A855F7" },
    { asset: "Forex", return_pct: 2.1, contribution: 0.42, weight: 20, color: "#10B981" },
    { asset: "Options", return_pct: 6.8, contribution: 1.02, weight: 15, color: "#F59E0B" },
    { asset: "Futures", return_pct: 3.9, contribution: 0.39, weight: 10, color: "#EF4444" },
  ];
}

function generateAgentAttribution() {
  return [
    { agent: "Viper", icon: "⚡", trades: 892, winRate: 64.2, avgReturn: 1.8, totalPnL: 4234, bestTrade: 1240, worstTrade: -680 },
    { agent: "Oracle", icon: "🔮", trades: 456, winRate: 71.5, avgReturn: 2.3, totalPnL: 3891, bestTrade: 890, worstTrade: -420 },
    { agent: "Spectre", icon: "👻", trades: 634, winRate: 58.9, avgReturn: 1.4, totalPnL: 2156, bestTrade: 780, worstTrade: -520 },
    { agent: "Sentinel", icon: "🛡️", trades: 1247, winRate: 62.1, avgReturn: 0.9, totalPnL: 1890, bestTrade: 560, worstTrade: -340 },
    { agent: "Titan", icon: "🏛️", trades: 1891, winRate: 66.8, avgReturn: 1.1, totalPnL: 3420, bestTrade: 920, worstTrade: -510 },
    { agent: "Phoenix", icon: "🔥", trades: 2103, winRate: 69.4, avgReturn: 1.5, totalPnL: 5120, bestTrade: 1560, worstTrade: -380 },
  ];
}

function generateWinLossDistribution() {
  const data = [];
  for (let i = -5; i <= 8; i += 0.5) {
    const count = Math.max(0, Math.round(
      (i > 0 ? 25 : 18) * Math.exp(-0.5 * Math.pow((i - (i > 0 ? 1.5 : -1)) / (i > 0 ? 2 : 1.5), 2))
    ));
    if (count > 0) {
      data.push({ return_pct: i, count, type: i >= 0 ? "Win" : "Loss" });
    }
  }
  return data;
}

function generateEquityCurve(days) {
  const data = [];
  let value = 60000;
  for (let d = 0; d <= days; d++) {
    if (d > 0) value *= (1 + (Math.random() - 0.4) * 0.022);
    if (d % 2 === 0 || d === days) {
      data.push({ day: d, value: Math.round(value) });
    }
  }
  return data;
}

// === COMPONENTS ===

function BenchmarkChart({ data }) {
  return (
    <div style={glass()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Performance vs Benchmarks (Normalized)</div>
        <div style={{ display: "flex", gap: 14 }}>
          {[{ label: "12 Tribes", color: "#00D4FF" }, { label: "S&P 500", color: "#F59E0B" }, { label: "BTC", color: "#A855F7" }, { label: "Bonds", color: "#6B7280" }].map(l => (
            <span key={l.label} style={{ fontSize: 10, color: l.color, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 2, background: l.color, display: "inline-block" }} />{l.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `D${v}`} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
            <Line type="monotone" dataKey="portfolio" stroke="#00D4FF" strokeWidth={3} dot={false} name="12 Tribes" />
            <Line type="monotone" dataKey="S&P 500" stroke="#F59E0B" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="BTC" stroke="#A855F7" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Bonds" stroke="#6B7280" strokeWidth={1} dot={false} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AttributionChart({ data }) {
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Return Attribution by Asset Class</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.map(a => (
          <div key={a.asset}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color }} />
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{a.asset}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>({a.weight}% weight)</span>
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <span style={{ fontSize: 12, color: a.color, fontWeight: 600 }}>+{a.return_pct}%</span>
                <span style={{ fontSize: 12, color: "#10B981" }}>+{a.contribution}% contrib</span>
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)" }}>
              <div style={{ height: "100%", borderRadius: 4, width: `${(a.return_pct / 10) * 100}%`, background: `linear-gradient(90deg, ${a.color}88, ${a.color})`, transition: "width 0.5s" }} />
            </div>
          </div>
        ))}
        <div style={{ marginTop: 8, padding: "12px 16px", borderRadius: 14, background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.15)", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#00D4FF" }}>Total Portfolio Return</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#00D4FF" }}>+{data.reduce((s, a) => s + a.contribution, 0).toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

function MonthlyReturnsTable({ data }) {
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Monthly Returns</div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="month" stroke="rgba(255,255,255,0.3)" fontSize={12} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} formatter={v => [`${v}%`, ""]} />
            <Bar dataKey="portfolio" name="12 Tribes" fill="#00D4FF" radius={[6, 6, 0, 0]} fillOpacity={0.8} />
            <Bar dataKey="spx" name="S&P 500" fill="#F59E0B" radius={[6, 6, 0, 0]} fillOpacity={0.5} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AgentLeaderboard({ agents }) {
  const sorted = [...agents].sort((a, b) => b.totalPnL - a.totalPnL);
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>AI Agent Performance Leaderboard</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((a, rank) => (
          <div key={a.agent} style={{
            ...inner(),
            display: "flex", alignItems: "center", gap: 14,
            borderLeft: `3px solid ${rank === 0 ? "#F59E0B" : rank === 1 ? "#C0C0C0" : rank === 2 ? "#CD7F32" : "rgba(255,255,255,0.1)"}`,
          }}>
            <div style={{ width: 28, textAlign: "center", fontSize: 14, fontWeight: 800, color: rank < 3 ? ["#F59E0B", "#C0C0C0", "#CD7F32"][rank] : "rgba(255,255,255,0.3)" }}>
              #{rank + 1}
            </div>
            <span style={{ fontSize: 24 }}>{a.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{a.agent}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Trades: <span style={{ color: "#00D4FF" }}>{a.trades.toLocaleString()}</span></span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Win Rate: <span style={{ color: "#10B981" }}>{a.winRate}%</span></span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Avg Return: <span style={{ color: "#A855F7" }}>{a.avgReturn}%</span></span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#10B981" }}>+${a.totalPnL.toLocaleString()}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 4, justifyContent: "flex-end" }}>
                <span style={{ fontSize: 10, color: "#10B981" }}>Best: +${a.bestTrade}</span>
                <span style={{ fontSize: 10, color: "#EF4444" }}>Worst: -${Math.abs(a.worstTrade)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WinLossChart({ data }) {
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Trade Return Distribution</div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="return_pct" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `${v}%`} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.return_pct >= 0 ? "#10B981" : "#EF4444"} fillOpacity={0.7} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function EquityCurve({ data }) {
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Equity Curve</div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `D${v}`} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} formatter={v => [`$${Number(v).toLocaleString()}`, "Equity"]} />
            <Area type="monotone" dataKey="value" stroke="#10B981" fill="url(#eqGrad)" strokeWidth={2.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KeyMetricsGrid() {
  const metrics = [
    { label: "Total Return", value: "+10.68%", sub: "$6,410 profit", color: "#10B981" },
    { label: "Annualized Return", value: "+52.4%", sub: "vs S&P 12.3%", color: "#10B981" },
    { label: "Sharpe Ratio", value: "1.87", sub: "Risk-adjusted", color: "#00D4FF" },
    { label: "Sortino Ratio", value: "2.41", sub: "Downside-adjusted", color: "#00D4FF" },
    { label: "Max Drawdown", value: "-4.8%", sub: "From peak", color: "#EF4444" },
    { label: "Win Rate", value: "64.2%", sub: "1,847 / 2,876 trades", color: "#10B981" },
    { label: "Profit Factor", value: "1.92", sub: "Gross profit / loss", color: "#A855F7" },
    { label: "Avg Trade", value: "+$7.24", sub: "Per executed trade", color: "#10B981" },
    { label: "Best Day", value: "+$1,842", sub: "Mar 12, 2026", color: "#10B981" },
    { label: "Worst Day", value: "-$924", sub: "Feb 28, 2026", color: "#EF4444" },
    { label: "Calmar Ratio", value: "10.92", sub: "Return / max DD", color: "#A855F7" },
    { label: "Alpha", value: "+38.1%", sub: "vs S&P 500 ann.", color: "#F59E0B" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
      {metrics.map(m => (
        <div key={m.label} style={glass({ padding: 16 })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{m.label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{m.value}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>{m.sub}</div>
        </div>
      ))}
    </div>
  );
}

// === MAIN ===
export default function TwelveTribes_Performance() {
  const { isMobile, isTablet } = useResponsive();
  const [view, setView] = useState("overview");
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const benchmarkData = useMemo(() => generateBenchmarkComparison(90), []);
  const monthlyReturns = useMemo(() => generateMonthlyReturns(), []);
  const attribution = useMemo(() => generateAttribution(), []);
  const agentPerf = useMemo(() => generateAgentAttribution(), []);
  const winLoss = useMemo(() => generateWinLossDistribution(), []);
  const equityCurve = useMemo(() => generateEquityCurve(90), []);

  const views = [
    { id: "overview", label: "Overview", icon: "◉" },
    { id: "attribution", label: "Attribution", icon: "◈" },
    { id: "agents", label: "AI Agents", icon: "◆" },
    { id: "trades", label: "Trade Stats", icon: "◇" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a1a 0%, #0d1117 25%, #0a0f1e 50%, #111827 75%, #0a0a1a 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      overflow: "auto",
    }}>
      <div style={{ position: "fixed", top: -200, right: -200, width: 600, height: 600, background: "radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(0,212,255,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{
        ...glass({ borderRadius: 0, borderTop: "none", borderLeft: "none", borderRight: "none", padding: `14px ${isMobile ? '16px' : '32px'}` }),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BrandLogo size={38} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5 }}>12 TRIBES</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase" }}>Performance Analytics</div>
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
        <div style={{ fontSize: 13, fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}>{clock.toLocaleTimeString()}</div>
      </div>

      <div style={{ padding: `20px ${isMobile ? '16px' : '32px'}`, maxWidth: 1600, margin: "0 auto" }}>
        {view === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <KeyMetricsGrid />
            <BenchmarkChart data={benchmarkData} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
              <EquityCurve data={equityCurve} />
              <MonthlyReturnsTable data={monthlyReturns} />
            </div>
          </div>
        )}
        {view === "attribution" && <AttributionChart data={attribution} />}
        {view === "agents" && <AgentLeaderboard agents={agentPerf} />}
        {view === "trades" && <WinLossChart data={winLoss} />}
      </div>

      <div style={{ padding: `16px ${isMobile ? '16px' : '32px'}`, textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
        12 TRIBES v1.0 | Performance Analytics | All data simulated for demonstration
      </div>
    </div>
  );
}