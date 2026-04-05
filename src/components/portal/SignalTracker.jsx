import { useState, useCallback, useEffect } from 'react';
import { haptics } from '../../hooks/useHaptics.js';

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

export default SignalTracker;
