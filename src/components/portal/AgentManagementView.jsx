import { useState, useEffect, useCallback } from 'react';

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


// ════════════════════════════════════════
//   ADMIN PANEL — extracted to src/components/portal/AdminPanel.jsx (W8-D)
//   Includes: ADMIN_API_BASE, AdminTaxSection, AdminPanel
// ════════════════════════════════════════
// AdminPanel is imported above from ../components/portal/AdminPanel.jsx


export default AgentManagementView;
