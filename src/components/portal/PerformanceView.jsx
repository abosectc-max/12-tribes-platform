import { useState, useMemo } from 'react';
import * as recharts from 'recharts';
import { getPerformanceMetrics, getEquityHistoryByPeriod, getPositionPerformance } from '../../store/performanceTracker.js';

const { AreaChart, Area, LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } = recharts;

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
//   RESEARCH VIEW — extracted to src/components/portal/ResearchView.jsx (W8-D)
// ════════════════════════════════════════
// ResearchView is imported above from ../components/portal/ResearchView.jsx



// ════════════════════════════════════════
//   FUND MANAGEMENT VIEW
// ════════════════════════════════════════

// ════════════════════════════════════════
//   WITHDRAWAL REQUEST PANEL
// ════════════════════════════════════════


export default PerformanceView;
