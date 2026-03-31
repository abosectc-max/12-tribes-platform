import { useState, useEffect, useCallback, useMemo } from "react";
import * as recharts from "recharts";
import { useResponsive } from "../hooks/useResponsive";
import BrandLogo from "../components/BrandLogo.jsx";
import { haptics } from "../hooks/useHaptics.js";

const API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();
const getToken = () => { try { return localStorage.getItem('12tribes_auth_token') || ''; } catch { return ''; } };
const {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar, Legend
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — MISSION CONTROL v1.0
//   AI-Powered Investment Platform
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

// Server data is fetched dynamically in the main component

const ASSET_CLASSES = [
  { name: "Stocks", pct: 25, notional: 15000, leverage: 1.5, effective: 22500, color: "#00D4FF", strategy: "Momentum + Mean Reversion", dailyReturn: 1.0, volatility: 2.0 },
  { name: "Crypto", pct: 15, notional: 9000, leverage: 1.25, effective: 11250, color: "#A855F7", strategy: "Trend-following + Grid", dailyReturn: 1.5, volatility: 3.5 },
  { name: "Forex", pct: 20, notional: 12000, leverage: 5.0, effective: 60000, color: "#10B981", strategy: "Carry Trade + Range", dailyReturn: 0.8, volatility: 1.5 },
  { name: "Options", pct: 15, notional: 9000, leverage: 2.0, effective: 18000, color: "#F59E0B", strategy: "Vol Selling + Spreads", dailyReturn: 2.0, volatility: 4.5 },
  { name: "Futures", pct: 10, notional: 6000, leverage: 10.0, effective: 60000, color: "#EF4444", strategy: "Micro Contracts + Hedge", dailyReturn: 1.2, volatility: 2.5 },
  { name: "Cash", pct: 15, notional: 9000, leverage: 1.0, effective: 9000, color: "#6B7280", strategy: "Margin Buffer + Opportunity", dailyReturn: 0.0, volatility: 0.0 },
];

// Agent icons mapped by name — real agent data fetched from API
const AGENT_ICONS = {
  Sentinel: "🛡️", Viper: "⚡", Oracle: "🔮", Phoenix: "🔥",
  Spectre: "👻", Titan: "🏛️", Debugger: "🔍",
};
const AGENT_ROLE_LABELS = {
  Sentinel: "Risk Monitor", Viper: "Momentum Scanner", Oracle: "Macro Analyst",
  Phoenix: "Self-Healing Engine", Spectre: "Volatility Trader", Titan: "Position Sizer",
  Debugger: "Platform Diagnostics",
};

// Generate Monte Carlo paths
function generateMonteCarloPaths(initial, days, numPaths, meanReturn, stdReturn) {
  const paths = [];
  for (let p = 0; p < numPaths; p++) {
    const path = [{ day: 0, value: initial }];
    let val = initial;
    for (let d = 1; d <= days; d++) {
      const u1 = Math.random(); const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const ret = meanReturn + stdReturn * z;
      val *= (1 + ret);
      if (d % 5 === 0 || d === days) path.push({ day: d, value: val });
    }
    paths.push(path);
  }
  return paths;
}

// Generate growth projection data
function generateGrowthData(initial, days, dailyReturn) {
  const data = [];
  let conservative = initial, base = initial, aggressive = initial;
  for (let d = 0; d <= days; d += 5) {
    data.push({
      day: d,
      conservative: Math.round(conservative),
      base: Math.round(base),
      aggressive: Math.round(aggressive),
    });
    for (let i = 0; i < 5 && d + i < days; i++) {
      conservative *= (1 + dailyReturn * 0.5);
      base *= (1 + dailyReturn);
      aggressive *= (1 + dailyReturn * 1.5);
    }
  }
  return data;
}

// Generate daily P&L data
function generateDailyPnL(days) {
  const data = [];
  let cumulative = 0;
  for (let d = 1; d <= days; d++) {
    const pnl = (Math.random() - 0.35) * 1800;
    cumulative += pnl;
    data.push({ day: d, daily: Math.round(pnl), cumulative: Math.round(cumulative) });
  }
  return data;
}

// No static trade generator — real trades fetched from API

// === STYLES ===
const glassStyle = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "24px",
  boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
};

const glassCardStyle = {
  ...glassStyle,
  padding: "16px",
  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  "@media (min-width: 768px)": {
    padding: "24px"
  }
};

const glassCardHoverStyle = {
  ...glassCardStyle,
  background: "rgba(255,255,255,0.07)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.08), inset 0 0.5px 0 rgba(255,255,255,0.5), inset 0 -0.5px 0 rgba(255,255,255,0.04)",
  transform: "translateY(-2px)",
};

// === COMPONENTS ===

function GlassCard({ children, style, className, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ ...(hovered ? glassCardHoverStyle : glassCardStyle), ...style }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick ? (e) => { haptics.select(); onClick(e); } : undefined}
    >
      {children}
    </div>
  );
}

function MetricCard({ label, value, change, prefix = "", suffix = "", color = "#00D4FF", isMobile = false }) {
  const isPositive = typeof change === "number" ? change >= 0 : true;
  const safeValue = typeof value === "number" ? (isNaN(value) ? 0 : value) : (value || '—');
  const safeChange = typeof change === "number" ? (isNaN(change) ? 0 : change) : change;
  return (
    <GlassCard style={{ minWidth: 0, flex: isMobile ? "unset" : "1 1 120px", minHeight: isMobile ? 90 : 120 }}>
      <div style={{ fontSize: isMobile ? 10 : 12, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: isMobile ? 22 : 32, fontWeight: 700, color, lineHeight: 1.1 }}>
        {prefix}{typeof safeValue === "number" ? safeValue.toLocaleString() : safeValue}{suffix}
      </div>
      {safeChange !== undefined && (
        <div style={{ fontSize: isMobile ? 11 : 13, color: isPositive ? "#10B981" : "#EF4444", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span>{isPositive ? "▲" : "▼"}</span>
          <span>{Math.abs(safeChange || 0).toFixed(2)}%</span>
          {!isMobile && <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>today</span>}
        </div>
      )}
    </GlassCard>
  );
}

function AgentCard({ agent, isMobile = false }) {
  const statusColors = { active: "#10B981", idle: "#F59E0B", quarantined: "#EF4444", monitoring: "#00D4FF", error: "#EF4444" };
  const icon = AGENT_ICONS[agent.name] || "🤖";
  const roleLabel = AGENT_ROLE_LABELS[agent.name] || agent.role;
  const statusColor = statusColors[agent.status] || "#6B7280";
  return (
    <GlassCard style={{ padding: isMobile ? 12 : 16, display: "flex", alignItems: "center", gap: isMobile ? 12 : 16, flexDirection: isMobile ? "column" : "row", textAlign: isMobile ? "center" : "left" }}>
      <div style={{ fontSize: isMobile ? 28 : 32, width: isMobile ? 40 : 48, textAlign: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, justifyContent: isMobile ? "center" : "flex-start", flexWrap: "wrap" }}>
          <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "#fff" }}>{agent.name}</span>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}`,
          }} />
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{roleLabel}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Win Rate: <span style={{ color: "#00D4FF" }}>{agent.winRate || 0}%</span></span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Trades: <span style={{ color: "#A855F7" }}>{(agent.trades || 0).toLocaleString()}</span></span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>P&L: <span style={{ color: (agent.totalPnl || 0) >= 0 ? "#10B981" : "#EF4444" }}>{(agent.totalPnl || 0) >= 0 ? '+' : ''}${(agent.totalPnl || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></span>
        </div>
        {agent.strategy && agent.strategy !== 'default' && (
          <div style={{ fontSize: 10, color: "#A855F7", marginTop: 4 }}>Strategy: {agent.strategy}</div>
        )}
        {agent.circuitBreaker && (
          <div style={{ fontSize: 10, color: "#EF4444", marginTop: 4 }}>Circuit breaker: {agent.circuitBreaker?.reason || 'triggered'}</div>
        )}
      </div>
      <div style={{
        padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
        background: `${statusColor}22`, color: statusColor,
        textTransform: "uppercase",
      }}>
        {agent.status}
      </div>
    </GlassCard>
  );
}

function AllocationChart({ isMobile = false }) {
  const activeAssets = ASSET_CLASSES.filter(a => a.pct > 0);
  const chartSize = isMobile ? 140 : 180;
  return (
    <GlassCard>
      <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Capital Allocation</div>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 16 : 24, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ width: chartSize, height: chartSize, flexShrink: 0 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={activeAssets} dataKey="pct" nameKey="name" cx="50%" cy="50%" innerRadius={isMobile ? 35 : 50} outerRadius={isMobile ? 60 : 80} paddingAngle={3} strokeWidth={0}>
                {activeAssets.map((a, i) => <Cell key={i} fill={a.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, width: isMobile ? "100%" : "auto" }}>
          {activeAssets.map(a => (
            <div key={a.name} style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, marginBottom: 8, fontSize: isMobile ? 12 : 13 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color, flexShrink: 0 }} />
              <span style={{ color: "rgba(255,255,255,0.7)", flex: 1, minWidth: 0 }}>{a.name}</span>
              <span style={{ fontWeight: 600, color: "#fff", flexShrink: 0 }}>{a.pct}%</span>
              {!isMobile && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>${a.notional.toLocaleString()}</span>}
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function GrowthProjection({ data, isMobile = false }) {
  return (
    <GlassCard>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 12, flexDirection: isMobile ? "column" : "row", gap: isMobile ? 8 : 0 }}>
        <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff" }}>Growth Projection (252 Trading Days)</div>
        <div style={{ display: "flex", gap: isMobile ? 8 : 16, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
          {[{ label: "Conservative", color: "#6B7280" }, { label: "Base (1.2%)", color: "#00D4FF" }, { label: "Aggressive", color: "#A855F7" }].map(l => (
            <span key={l.label} style={{ fontSize: isMobile ? 10 : 11, color: l.color, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 2, background: l.color, display: "inline-block" }} /> {!isMobile && l.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: isMobile ? 200 : 280 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gradBase" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00D4FF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradAgg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A855F7" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={v => `D${v}`} />
            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ background: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, backdropFilter: "blur(20px)" }}
              labelStyle={{ color: "rgba(255,255,255,0.5)" }}
              formatter={(v) => [`$${Number(v).toLocaleString()}`, ""]}
            />
            <Area type="monotone" dataKey="aggressive" stroke="#A855F7" fill="url(#gradAgg)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="base" stroke="#00D4FF" fill="url(#gradBase)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="conservative" stroke="#6B7280" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

function DailyPnLChart({ data, isMobile = false }) {
  return (
    <GlassCard>
      <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Daily P&L (Last 30 Days)</div>
      <div style={{ height: isMobile ? 180 : 220 }}>
        <ResponsiveContainer>
          <BarChart data={data.slice(-30)}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={10} />
            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
              formatter={(v) => [`$${Number(v).toLocaleString()}`, ""]}
            />
            <Bar dataKey="daily" radius={[4, 4, 0, 0]}>
              {data.slice(-30).map((entry, i) => (
                <Cell key={i} fill={entry.daily >= 0 ? "#10B981" : "#EF4444"} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

function TradeLog({ trades, isMobile = false }) {
  return (
    <GlassCard style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff" }}>Live Trade Feed</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{trades.length} recent trades · auto-refresh 15s</div>
      </div>
      {trades.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No trades recorded yet — agents are generating signals...</div>
      ) : (
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: isMobile ? -10 : 0, paddingBottom: isMobile ? 10 : 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 11 : 12, minWidth: isMobile ? 800 : "auto" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              {["Time", "Asset", "Side", "Qty", "Entry", "Close", "P&L", "Agent", "Investor"].map(h => (
                <th key={h} style={{ padding: isMobile ? "8px 10px" : "10px 12px", textAlign: "left", color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1, fontSize: isMobile ? 9 : 10, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 15).map((t, i) => {
              const pnl = t.realized_pnl || 0;
              const timeStr = t.time ? new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
              return (
                <tr key={t.id || i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "rgba(255,255,255,0.6)", fontFamily: "monospace", fontSize: isMobile ? 10 : 11, whiteSpace: "nowrap" }}>{timeStr}</td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>{t.symbol}</td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 6, fontSize: isMobile ? 9 : 10, fontWeight: 700,
                      background: t.side === "LONG" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                      color: t.side === "LONG" ? "#10B981" : "#EF4444",
                      whiteSpace: "nowrap"
                    }}>{t.side}</span>
                  </td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "rgba(255,255,255,0.6)", fontFamily: "monospace", fontSize: isMobile ? 10 : 11, whiteSpace: "nowrap" }}>{t.quantity}</td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "rgba(255,255,255,0.6)", fontFamily: "monospace", fontSize: isMobile ? 10 : 11, whiteSpace: "nowrap" }}>${(t.entry_price || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "rgba(255,255,255,0.6)", fontFamily: "monospace", fontSize: isMobile ? 10 : 11, whiteSpace: "nowrap" }}>${(t.close_price || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", fontFamily: "monospace", fontWeight: 600, color: pnl >= 0 ? "#10B981" : "#EF4444", fontSize: isMobile ? 10 : 11, whiteSpace: "nowrap" }}>
                    {pnl >= 0 ? "+" : ""}${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "#A855F7", fontSize: isMobile ? 10 : 11, whiteSpace: "nowrap" }}>{t.agent || '—'}</td>
                  <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "rgba(255,255,255,0.5)", fontSize: isMobile ? 10 : 11, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.investor || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </GlassCard>
  );
}

function InvestorTable({ serverUsers, groupData, isMobile = false, isTablet = false }) {
  const memberCount = serverUsers.length;
  return (
    <GlassCard>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 12, flexDirection: isMobile ? "column" : "row", gap: isMobile ? 6 : 0 }}>
        <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff" }}>Investor Roster</div>
        <div style={{ fontSize: isMobile ? 11 : 12, color: "rgba(255,255,255,0.4)" }}>{memberCount} {memberCount === 1 ? 'Member' : 'Members'}</div>
      </div>
      {memberCount === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No investors registered yet</div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(280px, 1fr))", gap: isMobile ? 10 : 12 }}>
        {serverUsers.map(user => {
          const avatar = (user.firstName?.[0] || '') + (user.lastName?.[0] || '') || user.email?.[0]?.toUpperCase() || '?';
          const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
          const equity = user.equity || user.walletEquity || 0;
          const initial = user.initialBalance || user.walletInitial || 100000;
          const gain = equity - initial;
          const gainPct = initial > 0 ? (gain / initial * 100) : 0;
          return (
            <div key={user.id} style={{
              padding: isMobile ? 12 : 16, borderRadius: 16,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", gap: isMobile ? 10 : 12,
            }}>
              <div style={{
                width: isMobile ? 36 : 42, height: isMobile ? 36 : 42, borderRadius: 13,
                background: "linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: isMobile ? 12 : 13, fontWeight: 700, color: "#00D4FF", flexShrink: 0,
              }}>{avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ fontSize: isMobile ? 10 : 11, color: "rgba(255,255,255,0.35)" }}>{user.email}</div>
                <div style={{ fontSize: isMobile ? 9 : 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                  {user.role || 'investor'} · {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                  {user.isTrading && <span style={{ marginLeft: 6, color: "#10B981" }}>● trading</span>}
                  {user.openPositions > 0 && <span style={{ marginLeft: 4, color: "rgba(255,255,255,0.35)" }}>· {user.openPositions} pos</span>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 700, color: "#fff" }}>${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: isMobile ? 10 : 11, color: gain >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                  {gain >= 0 ? "+" : ""}{gainPct.toFixed(2)}%
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>of ${initial.toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </GlassCard>
  );
}

function RiskPanel({ isMobile = false, isTablet = false }) {
  const metrics = [
    { label: "Portfolio Beta", value: "1.24", status: "normal" },
    { label: "Max Drawdown", value: "-4.8%", status: "normal" },
    { label: "Sharpe Ratio", value: "1.87", status: "good" },
    { label: "Sortino Ratio", value: "2.41", status: "good" },
    { label: "VaR (95%)", value: "-$1,842", status: "warning" },
    { label: "Margin Util.", value: "62%", status: "normal" },
    { label: "Correlation", value: "0.38", status: "good" },
    { label: "Win Rate", value: "64.2%", status: "good" },
  ];
  const statusColors = { good: "#10B981", normal: "#00D4FF", warning: "#F59E0B", critical: "#EF4444" };
  return (
    <GlassCard>
      <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Risk Command Center</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : isTablet ? "repeat(3, 1fr)" : "repeat(auto-fill, minmax(150px, 1fr))", gap: isMobile ? 10 : 10 }}>
        {metrics.map(m => (
          <div key={m.label} style={{
            padding: isMobile ? 12 : 12, borderRadius: 14, minHeight: isMobile ? 80 : 90,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", justifyContent: "space-between"
          }}>
            <div style={{ fontSize: isMobile ? 10 : 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: statusColors[m.status] }}>{m.value}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function SelfHealingPanel({ isMobile = false }) {
  const [healEvents] = useState([
    { time: "14:32", event: "Model drift detected on VIPER momentum scanner", action: "Retrained on 90-day rolling window", result: "Accuracy restored: 85.1% → 91.7%" },
    { time: "13:15", event: "Correlation spike: BTC/SPY exceeded 0.70 threshold", action: "Reduced crypto allocation 15% → 10%, rebalanced to forex", result: "Portfolio correlation normalized to 0.42" },
    { time: "11:48", event: "Slippage anomaly on EUR/USD entries", action: "Switched to limit orders, adjusted fill expectation model", result: "Avg slippage reduced from 2.1bps to 0.8bps" },
    { time: "09:22", event: "Overnight gap risk detected on futures positions", action: "Tightened stop-losses, reduced MES position by 30%", result: "Gap exposure reduced from $3,200 to $1,100" },
  ]);
  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 8 : 10, marginBottom: 12, flexDirection: isMobile ? "column" : "row" }}>
        <span style={{ fontSize: isMobile ? 18 : 20, flexShrink: 0 }}>🔥</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff" }}>Phoenix Self-Healing Engine</div>
          <div style={{ fontSize: isMobile ? 10 : 11, color: "rgba(255,255,255,0.4)" }}>Autonomous model repair & portfolio rebalancing</div>
        </div>
        <div style={{
          marginLeft: isMobile ? 0 : "auto", padding: "4px 10px", borderRadius: 12,
          background: "rgba(16,185,129,0.15)", color: "#10B981", fontSize: isMobile ? 10 : 11, fontWeight: 600, flexShrink: 0
        }}>ACTIVE</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {healEvents.map((e, i) => (
          <div key={i} style={{
            padding: isMobile ? 10 : 12, borderRadius: 14,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "monospace", fontSize: isMobile ? 10 : 11, color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>{e.time}</span>
              <span style={{ fontSize: isMobile ? 11 : 12, color: "#F59E0B" }}>⚠️ {e.event}</span>
            </div>
            <div style={{ fontSize: isMobile ? 11 : 12, color: "#00D4FF", marginBottom: 3 }}>→ {e.action}</div>
            <div style={{ fontSize: isMobile ? 10 : 11, color: "#10B981" }}>✓ {e.result}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function GrowthTable({ isMobile = false, totalAUM = 0 }) {
  const rates = [0.008, 0.010, 0.012, 0.015, 0.020];
  const days = [30, 60, 90, 120, 180, 252];
  const initial = totalAUM > 0 ? totalAUM : 60000;
  return (
    <GlassCard>
      <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Capital Growth Matrix (${initial.toLocaleString()} Current AUM)</div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: isMobile ? -10 : 0, paddingBottom: isMobile ? 10 : 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 11 : 12, minWidth: isMobile ? 500 : "auto" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <th style={{ padding: isMobile ? "8px 10px" : "10px 12px", textAlign: "left", color: "rgba(255,255,255,0.4)", fontSize: isMobile ? 9 : 10, letterSpacing: 1 }}>TIMEFRAME</th>
              {rates.map(r => (
                <th key={r} style={{ padding: isMobile ? "8px 10px" : "10px 12px", textAlign: "right", color: r === 0.012 ? "#00D4FF" : "rgba(255,255,255,0.4)", fontSize: isMobile ? 9 : 10, letterSpacing: 1, whiteSpace: "nowrap" }}>
                  {(r * 100).toFixed(1)}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: isMobile ? "8px 10px" : "10px 12px", color: "rgba(255,255,255,0.6)", fontWeight: 600, whiteSpace: "nowrap" }}>{d} Days</td>
                {rates.map(r => {
                  const final_ = initial * Math.pow(1 + r - 0.0001, d);
                  const ret = ((final_ / initial) - 1) * 100;
                  return (
                    <td key={r} style={{
                      padding: isMobile ? "8px 10px" : "10px 12px", textAlign: "right", fontFamily: "monospace",
                      color: r === 0.012 ? "#00D4FF" : "#fff",
                      fontWeight: r === 0.012 ? 700 : 400,
                      whiteSpace: "nowrap",
                    }}>
                      ${final_.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      {!isMobile && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>+{ret.toFixed(0)}%</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function AssetStrategyCards({ isMobile = false, isTablet = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(280px, 1fr))", gap: isMobile ? 12 : 16 }}>
      {ASSET_CLASSES.filter(a => a.name !== "Cash").map(asset => (
        <GlassCard key={asset.name} style={{ borderLeft: `3px solid ${asset.color}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: isMobile ? 15 : 16, fontWeight: 700, color: asset.color }}>{asset.name}</div>
              <div style={{ fontSize: isMobile ? 10 : 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{asset.strategy}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
              <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: "#fff" }}>{asset.pct}%</div>
              <div style={{ fontSize: isMobile ? 9 : 10, color: "rgba(255,255,255,0.4)" }}>allocation</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 6 : 8 }}>
            {[
              { label: "Notional", value: `$${asset.notional.toLocaleString()}` },
              { label: "Leverage", value: `${asset.leverage}x` },
              { label: "Effective", value: `$${asset.effective.toLocaleString()}` },
              { label: "Daily Ret", value: `${asset.dailyReturn.toFixed(1)}%` },
            ].map(m => (
              <div key={m.label} style={{ padding: isMobile ? 6 : 8, borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
                <div style={{ fontSize: isMobile ? 8 : 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>{m.label}</div>
                <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, color: "#fff", marginTop: 2 }}>{m.value}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// === VIEWS ===

function OverviewView({ growthData, pnlData, trades, groupData, isMobile, isTablet }) {
  const totalAUM = groupData.totalEquity || 0;
  const totalPnL = groupData.totalPnL || 0;
  const returnPct = groupData.returnPct || 0;
  const openPos = groupData.openPositions || 0;
  const winRate = groupData.winRate || 0;
  const memberCount = groupData.investorCount || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
      {/* Metric cards: 2-col grid on mobile, flex row on desktop */}
      <div style={isMobile
        ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }
        : { display: "flex", gap: 16, flexWrap: "wrap" }
      }>
        <MetricCard label="Total AUM" value={Math.round(totalAUM)} prefix="$" change={returnPct} color="#00D4FF" isMobile={isMobile} />
        <MetricCard label="Total P&L" value={Math.round(totalPnL)} prefix={totalPnL >= 0 ? "+$" : "-$"} color={totalPnL >= 0 ? "#10B981" : "#EF4444"} isMobile={isMobile} />
        <MetricCard label="Investors" value={memberCount} color="#A855F7" isMobile={isMobile} />
        <MetricCard label="Open Positions" value={openPos} color="#F59E0B" isMobile={isMobile} />
        <MetricCard label="Win Rate" value={winRate.toFixed(1)} suffix="%" color="#10B981" isMobile={isMobile} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr" : "2fr 1fr", gap: isMobile ? 16 : 20 }}>
        <GrowthProjection data={growthData} isMobile={isMobile} />
        <AllocationChart isMobile={isMobile} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 20 }}>
        <DailyPnLChart data={pnlData} isMobile={isMobile} />
        <RiskPanel isMobile={isMobile} isTablet={isTablet} />
      </div>
      <TradeLog trades={trades} isMobile={isMobile} />
    </div>
  );
}

function AgentsView({ isMobile, isTablet, liveAgents = [] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
      {liveAgents.length === 0 ? (
        <GlassCard><div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading agent data...</div></GlassCard>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(320px, 1fr))", gap: isMobile ? 12 : 16 }}>
        {liveAgents.map(a => <AgentCard key={a.id} agent={a} isMobile={isMobile} />)}
      </div>
      )}
      <SelfHealingPanel isMobile={isMobile} />
    </div>
  );
}

function CapitalView({ growthData, isMobile, isTablet, totalAUM = 0 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
      <AssetStrategyCards isMobile={isMobile} isTablet={isTablet} />
      <GrowthProjection data={growthData} isMobile={isMobile} />
      <GrowthTable isMobile={isMobile} totalAUM={totalAUM} />
    </div>
  );
}

function InvestorsView({ groupData, serverUsers, isMobile, isTablet }) {
  const totalAUM = groupData.totalEquity || 0;
  const investors = serverUsers; // Show all members — admins are investors too
  const memberCount = investors.length || groupData.investorCount || 0;
  const perInvestor = memberCount > 0 ? totalAUM / memberCount : 0;
  const avgGain = groupData.returnPct || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
      <div style={isMobile
        ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }
        : { display: "flex", gap: 16, flexWrap: "wrap" }
      }>
        <MetricCard label="Total AUM" value={Math.round(totalAUM)} prefix="$" color="#00D4FF" isMobile={isMobile} />
        <MetricCard label="Per Investor" value={Math.round(perInvestor)} prefix="$" color="#A855F7" isMobile={isMobile} />
        <MetricCard label="Avg Return" value={avgGain.toFixed(1)} suffix="%" color="#10B981" isMobile={isMobile} />
        <MetricCard label="Members" value={memberCount} color="#F59E0B" isMobile={isMobile} />
      </div>
      <InvestorTable serverUsers={investors} groupData={groupData} isMobile={isMobile} isTablet={isTablet} />
    </div>
  );
}

// === MAIN APP ===

export default function TwelveTribes_MissionControl() {
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const [activeView, setActiveView] = useState("overview");
  const [clock, setClock] = useState(new Date());
  const [groupData, setGroupData] = useState({});
  const [serverUsers, setServerUsers] = useState([]);
  const [liveTrades, setLiveTrades] = useState([]);
  const [liveAgents, setLiveAgents] = useState([]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real data from server — 15s refresh for live feel
  // Critical data (group, users) fetched independently from optional data (trades, agents)
  // to prevent slow/hanging endpoints from blocking the entire dashboard
  useEffect(() => {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const fetchWithTimeout = (url, opts, ms = 8000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
    };

    const fetchData = async () => {
      // Critical: group + roster (never blocked by slow endpoints)
      try {
        const [groupRes, usersRes] = await Promise.all([
          fetchWithTimeout(`${API_BASE}/wallet/group`, { headers }),
          fetchWithTimeout(`${API_BASE}/investors/roster`, { headers }),
        ]);
        if (groupRes.ok) { const gd = await groupRes.json(); setGroupData(gd); }
        if (usersRes.ok) { const ud = await usersRes.json(); setServerUsers(Array.isArray(ud) ? ud : ud.users || []); }
      } catch (err) { console.error("MissionControl critical fetch error:", err); }

      // Optional: trades + agents (may be slow, must not block core data)
      try {
        const [tradesRes, agentsRes] = await Promise.all([
          fetchWithTimeout(`${API_BASE}/admin/trades/recent?limit=25`, { headers }).catch(() => null),
          fetchWithTimeout(`${API_BASE}/admin/agents/status`, { headers }).catch(() => null),
        ]);
        if (tradesRes?.ok) { const td = await tradesRes.json(); setLiveTrades(td.trades || []); }
        if (agentsRes?.ok) { const ad = await agentsRes.json(); setLiveAgents(ad.agents || []); }
      } catch { /* optional data — silent fail */ }
    };

    fetchData();
    const poller = setInterval(fetchData, 15000);
    return () => clearInterval(poller);
  }, []);

  const totalAUM = groupData.totalEquity || 0;
  const growthData = useMemo(() => generateGrowthData(totalAUM > 0 ? totalAUM : 60000, 252, 0.012), [totalAUM]);
  const pnlData = useMemo(() => generateDailyPnL(90), []);

  const navItems = [
    { id: "overview", label: "Overview", icon: "◉" },
    { id: "capital", label: "Capital", icon: "◈" },
    { id: "agents", label: "AI Agents", icon: "◆" },
    { id: "investors", label: "Investors", icon: "◇" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a1a 0%, #0d1117 25%, #0a0f1e 50%, #111827 75%, #0a0a1a 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      overflow: "auto",
    }}>
      {/* Ambient glow effects */}
      <div style={{ position: "fixed", top: -200, right: -200, width: 600, height: 600, background: "radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(168,85,247,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Header */}
      <div style={{
        ...glassStyle,
        borderRadius: 0,
        borderTop: "none", borderLeft: "none", borderRight: "none",
        padding: isMobile ? "10px 12px" : isTablet ? "14px 24px" : "16px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
        gap: isMobile ? 8 : 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, flexShrink: 0 }}>
          <BrandLogo size={isMobile ? 30 : 40} />
          {!isMobile && <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>12 TRIBES</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 3, textTransform: "uppercase" }}>Mission Control</div>
          </div>}
        </div>

        <nav style={{ display: "flex", gap: isMobile ? 2 : 4, flex: 1, justifyContent: "center", minWidth: 0 }}>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { haptics.light(); setActiveView(item.id); }}
              style={{
                padding: isMobile ? "8px 12px" : "8px 20px", borderRadius: 14, border: "none", cursor: "pointer", minHeight: 44, minWidth: isMobile ? 44 : "auto",
                fontSize: isMobile ? 11 : 13, fontWeight: activeView === item.id ? 600 : 500, transition: "all 0.2s",
                background: activeView === item.id ? "rgba(0,212,255,0.15)" : "transparent",
                color: activeView === item.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
                whiteSpace: "nowrap",
                flexShrink: 0,
                touchAction: "manipulation",
                display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", gap: isMobile ? 2 : 6,
              }}
            >
              <span style={{ fontSize: isMobile ? 16 : 13 }}>{item.icon}</span>
              {isMobile ? <span style={{ fontSize: 9, lineHeight: 1 }}>{item.label}</span> : <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16, flexShrink: 0 }}>
          <div style={{
            padding: isMobile ? "4px 8px" : "6px 14px", borderRadius: 10,
            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
            {!isMobile && <span style={{ fontSize: 11, color: "#10B981", fontWeight: 600 }}>LIVE</span>}
          </div>
          {!isMobile && <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace", color: "rgba(255,255,255,0.7)" }}>
              {clock.toLocaleTimeString()}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              {clock.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </div>}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: isMobile ? "12px 10px" : isTablet ? "20px 24px" : "24px 32px", maxWidth: 1600, margin: "0 auto", paddingBottom: isMobile ? 100 : 24 }}>
        {activeView === "overview" && <OverviewView growthData={growthData} pnlData={pnlData} trades={liveTrades} groupData={groupData} isMobile={isMobile} isTablet={isTablet} />}
        {activeView === "capital" && <CapitalView growthData={growthData} isMobile={isMobile} isTablet={isTablet} totalAUM={totalAUM} />}
        {activeView === "agents" && <AgentsView isMobile={isMobile} isTablet={isTablet} liveAgents={liveAgents} />}
        {activeView === "investors" && <InvestorsView groupData={groupData} serverUsers={serverUsers} isMobile={isMobile} isTablet={isTablet} />}
      </div>

      {/* Footer */}
      <div style={{ padding: isMobile ? "12px 16px 32px" : "16px 32px", textAlign: "center", fontSize: isMobile ? 9 : 10, color: "rgba(255,255,255,0.2)" }}>
        12 TRIBES v1.0 | AI-Powered Investment Platform | Mission Control
      </div>
    </div>
  );
}