import { useState, useEffect, useMemo, useCallback } from "react";
import * as recharts from "recharts";
import { useResponsive } from '../hooks/useResponsive.js';
import { startNewsAutoFetch, getNewsStatus, analyzeSentiment } from '../store/newsIntelligenceService.js';
import { detectRegime, getAgentProfiles, generateTradeSignals, getUpcomingRiskEvents, generateIntelBriefing } from '../store/agentIntelligenceEngine.js';
import { startAutoFetch } from '../store/marketDataService.js';
import BrandLogo from '../components/BrandLogo.jsx';
import { haptics } from '../hooks/useHaptics.js';

const {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — MARKET INTELLIGENCE v2.0
//   Live News | Agent Intel | Regime Detection
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 24, padding: 24,
  boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
  ...extra,
});

const inner = (extra = {}) => ({
  padding: 14, borderRadius: 16,
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
  ...extra,
});

const sentColors = { bullish: "#10B981", bearish: "#EF4444", neutral: "#6B7280" };
const impactColors = { high: "#EF4444", medium: "#F59E0B", low: "#6B7280", critical: "#FF0040" };

// ═══════ REGIME BANNER ═══════
function RegimeBanner({ regime }) {
  if (!regime) return null;
  return (
    <div style={{
      ...glass({ padding: "16px 24px", borderRadius: 18 }),
      borderLeft: `4px solid ${regime.color}`,
      display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: `${regime.color}20`, border: `2px solid ${regime.color}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, fontWeight: 900, color: regime.color,
        }}>{regime.score}</div>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 2 }}>Market Regime</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: regime.color }}>{regime.label}</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{regime.action}</div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {Object.entries(regime.factors || {}).map(([k, v]) => (
          <div key={k} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1 }}>
              {k === 'newsSentiment' ? 'News' : k === 'fearGreed' ? 'F&G' : 'Price'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: v >= 55 ? "#10B981" : v >= 45 ? "#F59E0B" : "#EF4444" }}>{Math.round(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════ LIVE NEWS FEED ═══════
function LiveNewsFeed({ news, filter, onFilterChange }) {
  const categories = ['all', 'general', 'crypto', 'forex', 'commodities', 'macro', 'options'];

  const filtered = filter === 'all' ? news : news.filter(n => n.category === filter || n.sentiment.assetClasses.includes(filter));

  return (
    <div style={glass()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Live Intelligence Feed</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>({news.length} articles)</span>
        </div>
      </div>

      {/* Category filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => { haptics.select(); onFilterChange(cat); }} style={{
            padding: "8px 14px", borderRadius: 10, border: "none", cursor: "pointer", minHeight: 36,
            fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
            background: filter === cat ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.04)",
            color: filter === cat ? "#00D4FF" : "rgba(255,255,255,0.4)",
            transition: "all 0.15s",
          }}>{cat}</button>
        ))}
      </div>

      {/* News items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 600, overflowY: "auto" }}>
        {filtered.slice(0, 25).map((item, i) => (
          <div key={item.id || i} style={{
            ...inner({ padding: "12px 16px" }),
            display: "flex", gap: 12, alignItems: "flex-start",
            borderLeft: `3px solid ${sentColors[item.sentiment?.label] || "#6B7280"}`,
          }}>
            <div style={{ flex: "0 0 48px", textAlign: "center" }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{item.timeAgo}</div>
              <div style={{
                marginTop: 4, width: 32, height: 32, borderRadius: 8, margin: "4px auto 0",
                background: `${sentColors[item.sentiment?.label] || "#6B7280"}15`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 800, color: sentColors[item.sentiment?.label] || "#6B7280",
              }}>
                {item.sentiment?.label === 'bullish' ? '▲' : item.sentiment?.label === 'bearish' ? '▼' : '—'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.45, marginBottom: 6 }}>{item.title}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{item.source}</span>
                <span style={{
                  padding: "1px 7px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                  background: `${sentColors[item.sentiment?.label]}18`, color: sentColors[item.sentiment?.label],
                }}>{(item.sentiment?.label || 'neutral').toUpperCase()}</span>
                <span style={{
                  padding: "1px 7px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                  background: `${impactColors[item.sentiment?.impact]}18`, color: impactColors[item.sentiment?.impact],
                }}>{(item.sentiment?.impact || 'low').toUpperCase()}</span>
                {item.sentiment?.assetClasses?.map(cls => (
                  <span key={cls} style={{
                    padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: "rgba(0,212,255,0.08)", color: "rgba(0,212,255,0.6)",
                  }}>{cls}</span>
                ))}
              </div>
            </div>
            <div style={{ flex: "0 0 36px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginBottom: 2 }}>SCORE</div>
              <div style={{
                fontSize: 14, fontWeight: 700,
                color: (item.sentiment?.score || 0) > 0 ? "#10B981" : (item.sentiment?.score || 0) < 0 ? "#EF4444" : "#6B7280",
              }}>{((item.sentiment?.score || 0) > 0 ? '+' : '')}{((item.sentiment?.score || 0) * 100).toFixed(0)}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            No articles found for this category. Fetching live data...
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════ AGENT INTELLIGENCE PANEL ═══════
function AgentIntelPanel({ agentIntel, tradeSignals }) {
  const profiles = getAgentProfiles();
  if (!agentIntel) return null;

  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Agent Intelligence Console</div>

      {/* Trade Signals */}
      {tradeSignals && tradeSignals.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#FFD93D", textTransform: "uppercase", letterSpacing: 2, marginBottom: 10, fontWeight: 700 }}>Active Trade Signals</div>
          {tradeSignals.map((sig, i) => (
            <div key={i} style={{
              ...inner({ padding: 16, marginBottom: 8 }),
              borderLeft: `3px solid ${sig.agentColor}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{sig.agentIcon}</span>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: sig.agentColor }}>{sig.agentName}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 8 }}>{sig.algorithm}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{
                    padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 800,
                    background: sig.direction === 'LONG' ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                    color: sig.direction === 'LONG' ? "#10B981" : "#EF4444",
                  }}>{sig.direction}</span>
                  <span style={{
                    padding: "4px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: "rgba(0,212,255,0.1)", color: "#00D4FF",
                  }}>{sig.asset}</span>
                </div>
              </div>
              <div style={{
                padding: "8px 12px", borderRadius: 10, marginBottom: 8,
                background: "rgba(255,255,255,0.02)", fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5,
              }}>{sig.action}</div>
              <div style={{ display: "flex", gap: 16, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                <span>Conviction: <span style={{ color: "#FFD93D", fontWeight: 600 }}>{(sig.strength * 100).toFixed(0)}%</span></span>
                <span>Hold: {sig.holdPeriod}</span>
                <span>Regime: {sig.regime}</span>
                {sig.urgency !== 'normal' && (
                  <span style={{ color: sig.urgency === 'critical' ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>
                    {sig.urgency === 'critical' ? '🔴 CRITICAL' : '⚠️ ELEVATED'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-Agent Status Grid */}
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 10, fontWeight: 600 }}>Agent Status</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {Object.entries(profiles).map(([id, profile]) => {
          const intel = agentIntel[id];
          const alertCount = intel?.alerts?.length || 0;
          const signalCount = intel?.signals?.length || 0;
          const urgency = intel?.urgency || 'normal';

          return (
            <div key={id} style={{
              ...inner({ padding: 16 }),
              borderLeft: `3px solid ${profile.color}`,
              opacity: alertCount === 0 ? 0.6 : 1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 24 }}>{profile.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: profile.color }}>{profile.name}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{profile.role}</div>
                </div>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: urgency === 'critical' ? '#EF4444' : urgency === 'elevated' ? '#F59E0B' : '#10B981',
                  boxShadow: `0 0 8px ${urgency === 'critical' ? '#EF4444' : urgency === 'elevated' ? '#F59E0B' : '#10B981'}`,
                }} />
              </div>
              <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{alertCount}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>ALERTS</div>
                </div>
                <div style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#FFD93D" }}>{signalCount}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>SIGNALS</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>{profile.description}</div>
              {intel?.alerts?.[0] && (
                <div style={{
                  marginTop: 8, padding: "6px 10px", borderRadius: 8,
                  background: "rgba(255,255,255,0.02)", fontSize: 10, color: "rgba(255,255,255,0.5)",
                  borderLeft: `2px solid ${sentColors[intel.alerts[0].sentiment]}`,
                }}>
                  Latest: {intel.alerts[0].title.slice(0, 60)}...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════ FEAR & GREED LIVE ═══════
function FearGreedLive({ data }) {
  if (!data?.current) return null;

  const v = data.current.value;
  const getColor = (val) => val >= 75 ? "#10B981" : val >= 55 ? "#A3E635" : val >= 45 ? "#F59E0B" : val >= 25 ? "#F97316" : "#EF4444";
  const color = getColor(v);

  return (
    <div style={glass()}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Crypto Fear & Greed</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>LIVE</span>
      </div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{
          width: 120, height: 120, borderRadius: "50%", margin: "0 auto",
          background: `conic-gradient(${color} ${v * 3.6}deg, rgba(255,255,255,0.05) 0deg)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 30px ${color}30`,
        }}>
          <div style={{
            width: 92, height: 92, borderRadius: "50%", background: "rgba(10,10,26,0.9)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ fontSize: 32, fontWeight: 800, color }}>{v}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1 }}>{data.current.label}</div>
          </div>
        </div>
      </div>
      {/* 30-day history chart */}
      {data.history?.length > 0 && (
        <div style={{ height: 100 }}>
          <ResponsiveContainer>
            <AreaChart data={data.history}>
              <defs>
                <linearGradient id="fgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.15)" fontSize={8} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.15)" fontSize={8} />
              <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11 }} />
              <Area type="monotone" dataKey="value" stroke={color} fill="url(#fgGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ═══════ RISK EVENTS CALENDAR ═══════
function RiskEventsCalendar({ events }) {
  if (!events || events.length === 0) return null;

  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Upcoming Risk Events</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.slice(0, 8).map((e, i) => (
          <div key={i} style={{
            ...inner({ padding: "12px 16px" }),
            display: "flex", alignItems: "center", gap: 14,
            borderLeft: `3px solid ${impactColors[e.impact] || "#6B7280"}`,
            background: e.isToday ? "rgba(239,68,68,0.05)" : e.isTomorrow ? "rgba(245,158,11,0.04)" : "rgba(255,255,255,0.03)",
          }}>
            <div style={{ flex: "0 0 50px", textAlign: "center" }}>
              {e.isToday ? (
                <div style={{ fontSize: 11, fontWeight: 800, color: "#EF4444", textTransform: "uppercase" }}>TODAY</div>
              ) : e.isTomorrow ? (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>TMRW</div>
              ) : (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{e.daysUntil}d</div>
              )}
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{e.time}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 2 }}>{e.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>{e.description}</div>
            </div>
            <span style={{
              padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
              background: `${impactColors[e.impact]}18`, color: impactColors[e.impact],
            }}>{e.impact.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════ MARKET COMPOSITE GAUGE ═══════
function CompositeGauge({ composite }) {
  if (!composite) return null;

  const getColor = (s) => s >= 65 ? "#10B981" : s >= 55 ? "#A3E635" : s >= 45 ? "#F59E0B" : s >= 35 ? "#F97316" : "#EF4444";

  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Market Pulse Composite</div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 52, fontWeight: 900, color: getColor(composite.score) }}>{composite.score}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: getColor(composite.score), textTransform: "uppercase" }}>{composite.label}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
          {composite.totalNews} articles analyzed | Confidence: {(composite.confidence * 100).toFixed(0)}%
        </div>
      </div>

      {/* Signal breakdown */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Bullish", value: composite.signalCounts?.bullish || 0, color: "#10B981" },
          { label: "Bearish", value: composite.signalCounts?.bearish || 0, color: "#EF4444" },
          { label: "Neutral", value: composite.signalCounts?.neutral || 0, color: "#6B7280" },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 12, background: `${s.color}10` }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Per-asset signals */}
      {composite.signals?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Asset Signals</div>
          {composite.signals.map(s => (
            <div key={s.asset} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", flex: "0 0 80px", textTransform: "capitalize" }}>{s.asset}</span>
              <span style={{
                padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: s.signal === 'BUY' ? "rgba(16,185,129,0.15)" : s.signal === 'SELL' ? "rgba(239,68,68,0.15)" : "rgba(107,114,128,0.15)",
                color: s.signal === 'BUY' ? "#10B981" : s.signal === 'SELL' ? "#EF4444" : "#6B7280",
              }}>{s.signal}</span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.05)" }}>
                <div style={{
                  height: "100%", borderRadius: 2, width: `${s.strength * 100}%`,
                  background: s.signal === 'BUY' ? "#10B981" : s.signal === 'SELL' ? "#EF4444" : "#6B7280",
                }} />
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", flex: "0 0 50px", textAlign: "right" }}>
                {s.bullCount}B / {s.bearCount}R
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════ TRENDING CRYPTO ═══════
function TrendingCrypto({ trending }) {
  if (!trending || trending.length === 0) return null;

  return (
    <div style={glass()}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Trending Crypto</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>CoinGecko</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {trending.map((coin, i) => (
          <div key={coin.symbol} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.3)", width: 20, textAlign: "center" }}>#{i + 1}</span>
            {coin.thumb && <img src={coin.thumb} alt="" style={{ width: 24, height: 24, borderRadius: 6 }} />}
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{coin.name}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{coin.symbol}</span>
            </div>
            {coin.rank && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>MCap #{coin.rank}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════ INTEL BRIEFING ═══════
function IntelBriefing({ briefing }) {
  if (!briefing) return null;

  return (
    <div style={glass({ background: "rgba(0,212,255,0.03)", borderColor: "rgba(0,212,255,0.15)" })}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <BrandLogo size={28} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "#00D4FF" }}>Intelligence Briefing</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{new Date().toLocaleTimeString()}</span>
      </div>
      <pre style={{
        fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace", fontSize: 12,
        color: "rgba(255,255,255,0.6)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap",
        padding: 16, borderRadius: 14, background: "rgba(0,0,0,0.2)",
      }}>{briefing}</pre>
    </div>
  );
}

// ═══════ MAIN COMPONENT ═══════
export default function TwelveTribes_MarketIntel() {
  const { isMobile, isTablet } = useResponsive();
  const [view, setView] = useState("command");
  const [clock, setClock] = useState(new Date());
  const [newsFilter, setNewsFilter] = useState('all');

  // Live intelligence state
  const [intelData, setIntelData] = useState({
    news: [], fearGreed: null, trending: [], composite: null, agentIntel: null, lastUpdate: null,
  });
  const [priceData, setPriceData] = useState({});
  const [isLive, setIsLive] = useState(false);

  // Derived state
  const regime = useMemo(
    () => detectRegime(intelData.composite, intelData.fearGreed, priceData),
    [intelData.composite, intelData.fearGreed, priceData]
  );

  const tradeSignals = useMemo(
    () => generateTradeSignals(intelData.agentIntel, regime, intelData.composite),
    [intelData.agentIntel, regime, intelData.composite]
  );

  const riskEvents = useMemo(() => getUpcomingRiskEvents(), []);

  const briefing = useMemo(
    () => generateIntelBriefing(intelData.composite, regime, tradeSignals, intelData.fearGreed),
    [intelData.composite, regime, tradeSignals, intelData.fearGreed]
  );

  // Clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Start live news intelligence
  useEffect(() => {
    const cleanup = startNewsAutoFetch((data) => {
      setIntelData(data);
      setIsLive(true);
    }, 120_000); // Refresh every 2 minutes
    return cleanup;
  }, []);

  // Start live price data
  useEffect(() => {
    const cleanup = startAutoFetch((prices) => {
      setPriceData(prices);
    }, 30_000);
    return cleanup;
  }, []);

  const views = [
    { id: "command", label: "Command", icon: "⬡" },
    { id: "news", label: "News Feed", icon: "◈" },
    { id: "agents", label: "Agent Intel", icon: "◆" },
    { id: "calendar", label: "Events", icon: "◇" },
    { id: "briefing", label: "Briefing", icon: "▣" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a1a 0%, #0d1117 25%, #0a0f1e 50%, #111827 75%, #0a0a1a 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      overflow: "auto",
    }}>
      <div style={{ position: "fixed", top: -200, right: -200, width: 600, height: 600, background: "radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(168,85,247,0.04) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Header */}
      <div style={{
        ...glass({ borderRadius: 0, borderTop: "none", borderLeft: "none", borderRight: "none", padding: `calc(14px + env(safe-area-inset-top, 0px)) ${isMobile ? '16px' : '32px'} 14px` }),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BrandLogo size={38} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5 }}>12 TRIBES</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase" }}>Intelligence Command</div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 3, overflowX: isMobile ? "auto" : "visible" }}>
          {views.map(v => (
            <button key={v.id} onClick={() => { haptics.light(); setView(v.id); }} style={{
              padding: isMobile ? "10px 14px" : "8px 18px", borderRadius: 12, border: "none", cursor: "pointer", minHeight: 44,
              fontSize: isMobile ? 10 : 13, fontWeight: 500, transition: "all 0.2s",
              background: view === v.id ? "rgba(0,212,255,0.12)" : "transparent",
              color: view === v.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
              whiteSpace: "nowrap",
            }}>
              {!isMobile && <span style={{ marginRight: 5 }}>{v.icon}</span>}{isMobile ? v.label.split(' ')[0] : v.label}
            </button>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            padding: "5px 12px", borderRadius: 9,
            background: isLive ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
            border: `1px solid ${isLive ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: isLive ? "#10B981" : "#F59E0B",
              boxShadow: `0 0 8px ${isLive ? "#10B981" : "#F59E0B"}`,
            }} />
            <span style={{ fontSize: 10, color: isLive ? "#10B981" : "#F59E0B", fontWeight: 600 }}>
              {isLive ? 'LIVE' : 'CONNECTING'}
            </span>
          </div>
          {!isMobile && (
            <div style={{ fontSize: 13, fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}>{clock.toLocaleTimeString()}</div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: `20px ${isMobile ? '16px' : '32px'}`, maxWidth: 1600, margin: "0 auto" }}>

        {/* Regime Banner — always visible */}
        <div style={{ marginBottom: 20 }}>
          <RegimeBanner regime={regime} />
        </div>

        {/* ═══ COMMAND VIEW ═══ */}
        {view === "command" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Row 1: Composite + Fear/Greed + Trending */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "1fr 1fr 1fr", gap: 20 }}>
              <CompositeGauge composite={intelData.composite} />
              <FearGreedLive data={intelData.fearGreed} />
              {!isMobile && <TrendingCrypto trending={intelData.trending} />}
            </div>

            {/* Row 2: News + Events */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: 20 }}>
              <LiveNewsFeed news={intelData.news} filter={newsFilter} onFilterChange={setNewsFilter} />
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <RiskEventsCalendar events={riskEvents} />
                {isMobile && <TrendingCrypto trending={intelData.trending} />}
              </div>
            </div>

            {/* Row 3: Agent Intel */}
            <AgentIntelPanel agentIntel={intelData.agentIntel} tradeSignals={tradeSignals} />
          </div>
        )}

        {/* ═══ NEWS FEED VIEW ═══ */}
        {view === "news" && (
          <LiveNewsFeed news={intelData.news} filter={newsFilter} onFilterChange={setNewsFilter} />
        )}

        {/* ═══ AGENT INTEL VIEW ═══ */}
        {view === "agents" && (
          <AgentIntelPanel agentIntel={intelData.agentIntel} tradeSignals={tradeSignals} />
        )}

        {/* ═══ EVENTS CALENDAR VIEW ═══ */}
        {view === "calendar" && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
            <RiskEventsCalendar events={riskEvents} />
            <FearGreedLive data={intelData.fearGreed} />
          </div>
        )}

        {/* ═══ BRIEFING VIEW ═══ */}
        {view === "briefing" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <IntelBriefing briefing={briefing} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
              <CompositeGauge composite={intelData.composite} />
              <RiskEventsCalendar events={riskEvents} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: `16px ${isMobile ? '16px' : '32px'}`, textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
        12 TRIBES v2.0 | Intelligence Command Center | {intelData.news.length} articles | {isLive ? 'Live Data' : 'Connecting...'} | Last Update: {intelData.lastUpdate ? new Date(intelData.lastUpdate).toLocaleTimeString() : '—'}
      </div>

      {/* Pulse animation keyframe (injected once) */}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
