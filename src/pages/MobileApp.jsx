import { useState, useEffect, useMemo, useCallback } from "react";
import * as recharts from "recharts";
const { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } = recharts;
import {
  getWalletState, getWallet, getPositions, getTradeHistory,
  getMarketPrices, getGroupStats, tickPrices, getAgentLeaderboard,
  INITIAL_BALANCE
} from "../store/walletStore.js";
import { getAllUsers } from "../store/authStore.js";
import BrandLogo from '../components/BrandLogo.jsx';

// ═══════════════════════════════════════════
//   12 TRIBES — MOBILE INVESTOR APP v1.0
//   Touch-optimized | Swipe Nav | Glass UI
// ═══════════════════════════════════════════

const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 20, padding: 16,
  boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4)",
  ...extra,
});

function generateSparkline(initial, points) {
  const data = [];
  let val = initial;
  for (let i = 0; i < points; i++) {
    val *= (1 + (Math.random() - 0.42) * 0.02);
    data.push({ i, v: Math.round(val) });
  }
  return data;
}

// === MOBILE SCREENS ===

function PortfolioScreen({ wallet, positions, sparkline }) {
  const totalPnL = wallet.equity - wallet.initialBalance;
  const pnlPct = ((wallet.equity / wallet.initialBalance) - 1) * 100;
  const allocation = [
    { name: "Stocks", value: 35, color: "#00D4FF" },
    { name: "Crypto", value: 20, color: "#A855F7" },
    { name: "Forex", value: 15, color: "#10B981" },
    { name: "Cash", value: 30, color: "#6B7280" },
  ];

  return (
    <div style={{ padding: "0 16px 100px" }}>
      {/* Portfolio Value Hero */}
      <div style={{ textAlign: "center", padding: "24px 0 16px" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 2 }}>Virtual Portfolio</div>
        <div style={{ fontSize: 42, fontWeight: 800, color: "#fff", margin: "8px 0 4px" }}>
          ${wallet.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div style={{ fontSize: 15, color: totalPnL >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
          {totalPnL >= 0 ? "+" : ""}{totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          <span style={{ marginLeft: 6, fontSize: 13 }}>({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
        </div>
        <div style={{
          display: "inline-block", marginTop: 8, padding: "4px 12px", borderRadius: 10,
          background: "rgba(245,158,11,0.12)", fontSize: 10, color: "#F59E0B", fontWeight: 600,
        }}>PAPER TRADING — $100K VIRTUAL</div>
      </div>

      {/* Sparkline */}
      <div style={{ ...glass({ padding: "12px 0" }), marginBottom: 16 }}>
        <div style={{ height: 120 }}>
          <ResponsiveContainer>
            <AreaChart data={sparkline}>
              <defs>
                <linearGradient id="mSparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={totalPnL >= 0 ? "#10B981" : "#EF4444"} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={totalPnL >= 0 ? "#10B981" : "#EF4444"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={totalPnL >= 0 ? "#10B981" : "#EF4444"} fill="url(#mSparkGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Cash Balance", value: `$${wallet.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#00D4FF" },
          { label: "Open Positions", value: positions.length, color: "#A855F7" },
          { label: "Realized P&L", value: `${wallet.realizedPnL >= 0 ? "+" : ""}$${wallet.realizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: wallet.realizedPnL >= 0 ? "#10B981" : "#EF4444" },
          { label: "Win Rate", value: wallet.tradeCount > 0 ? `${((wallet.winCount / Math.max(wallet.winCount + wallet.lossCount, 1)) * 100).toFixed(0)}%` : "—", color: "#F59E0B" },
        ].map(s => (
          <div key={s.label} style={glass({ padding: 14 })}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Allocation */}
      <div style={glass({ marginBottom: 16 })}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Allocation</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 80, height: 80 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={allocation} dataKey="value" innerRadius={25} outerRadius={38} paddingAngle={3} strokeWidth={0}>
                  {allocation.map((a, i) => <Cell key={i} fill={a.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1 }}>
            {allocation.map(a => (
              <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", flex: 1 }}>{a.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{a.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Positions */}
      <div style={glass()}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Open Positions</div>
        {positions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No open positions</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {positions.map(p => (
              <div key={p.id} style={{
                padding: 12, borderRadius: 14,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{p.symbol}</span>
                    <span style={{
                      padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                      background: p.side === "LONG" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                      color: p.side === "LONG" ? "#10B981" : "#EF4444",
                    }}>{p.side}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                    {p.quantity} @ ${p.entryPrice.toLocaleString()} — {p.agent}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: p.unrealizedPnL >= 0 ? "#10B981" : "#EF4444" }}>
                    {p.unrealizedPnL >= 0 ? "+" : ""}${p.unrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontSize: 10, color: p.returnPct >= 0 ? "#10B981" : "#EF4444" }}>
                    {p.returnPct >= 0 ? "+" : ""}{p.returnPct.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MarketsScreen({ prices }) {
  const categories = {
    "Stocks": ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "JPM"],
    "Crypto": ["BTC", "ETH", "SOL", "AVAX"],
    "Forex": ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD"],
    "ETFs": ["SPY", "QQQ", "GLD", "TLT"],
  };

  const [activeCategory, setActiveCategory] = useState("Stocks");

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", padding: "20px 0 16px" }}>Markets</div>

      {/* Category tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
        {Object.keys(categories).map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)} style={{
            padding: "8px 16px", borderRadius: 12, border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
            background: activeCategory === cat ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.05)",
            color: activeCategory === cat ? "#00D4FF" : "rgba(255,255,255,0.5)",
          }}>{cat}</button>
        ))}
      </div>

      {/* Price list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {categories[activeCategory].map(symbol => {
          const price = prices[symbol] || 0;
          const change = (Math.random() - 0.45) * 3;
          return (
            <div key={symbol} style={{
              ...glass({ padding: 14 }),
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "linear-gradient(135deg, rgba(0,212,255,0.15), rgba(168,85,247,0.1))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 800, color: "#00D4FF",
              }}>{symbol.slice(0, 2)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{symbol}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                  {activeCategory === "Crypto" ? "Cryptocurrency" : activeCategory === "Forex" ? "Currency Pair" : "Equity"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: "monospace" }}>
                  ${price.toLocaleString(undefined, { minimumFractionDigits: price < 10 ? 4 : 2, maximumFractionDigits: price < 10 ? 4 : 2 })}
                </div>
                <div style={{ fontSize: 11, color: change >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
                  {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentsScreen() {
  const leaderboard = getAgentLeaderboard();
  const icons = { Viper: "⚡", Oracle: "🔮", Spectre: "👻", Sentinel: "🛡️", Phoenix: "🔥", Titan: "🏛️" };

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", padding: "20px 0 16px" }}>AI Agents</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {leaderboard.map((agent, rank) => (
          <div key={agent.name} style={{
            ...glass({ padding: 16 }),
            borderLeft: `3px solid ${rank === 0 ? "#F59E0B" : rank === 1 ? "#C0C0C0" : rank === 2 ? "#CD7F32" : "rgba(255,255,255,0.1)"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: rank < 3 ? ["#F59E0B", "#C0C0C0", "#CD7F32"][rank] : "rgba(255,255,255,0.3)", width: 20, textAlign: "center" }}>#{rank + 1}</div>
              <span style={{ fontSize: 28 }}>{icons[agent.name] || "🤖"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{agent.name}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Trades: <span style={{ color: "#00D4FF" }}>{agent.totalTrades}</span></span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Win: <span style={{ color: "#10B981" }}>{agent.totalTrades > 0 ? ((agent.wins / agent.totalTrades) * 100).toFixed(0) : 0}%</span></span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: agent.totalPnL >= 0 ? "#10B981" : "#EF4444" }}>
                  {agent.totalPnL >= 0 ? "+" : ""}${agent.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupScreen() {
  const stats = getGroupStats();
  const users = getAllUsers();
  const wallets = users.map(inv => ({ ...inv, ...getWallet(inv.id) })).sort((a, b) => (b.equity || 0) - (a.equity || 0));

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", padding: "20px 0 16px" }}>Group Overview</div>

      {/* Group stats */}
      <div style={{ ...glass({ textAlign: "center", marginBottom: 16, padding: 24 }) }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 2 }}>Total Group Equity</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: "#00D4FF", margin: "8px 0" }}>
          ${stats.totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div style={{ fontSize: 13, color: stats.totalPnL >= 0 ? "#10B981" : "#EF4444" }}>
          {stats.totalPnL >= 0 ? "+" : ""}${stats.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({stats.returnPct >= 0 ? "+" : ""}{stats.returnPct.toFixed(2)}%)
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <div style={glass({ padding: 12, textAlign: "center" })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Open Positions</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#A855F7", marginTop: 4 }}>{stats.openPositions}</div>
        </div>
        <div style={glass({ padding: 12, textAlign: "center" })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Closed Trades</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#F59E0B", marginTop: 4 }}>{stats.closedTrades}</div>
        </div>
      </div>

      {/* Investor leaderboard */}
      <div style={glass()}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Investor Rankings</div>
        {wallets.map((w, i) => {
          const pnl = w.equity - w.initialBalance;
          return (
            <div key={w.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
              borderBottom: i < wallets.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", width: 20 }}>#{i + 1}</span>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: "linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: "#00D4FF",
              }}>{w.avatar}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{w.name}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>${w.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 10, color: pnl >= 0 ? "#10B981" : "#EF4444" }}>
                  {pnl >= 0 ? "+" : ""}{((pnl / w.initialBalance) * 100).toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === MAIN MOBILE APP ===
export default function TwelveTribes_MobileApp() {
  const [tab, setTab] = useState("portfolio");
  const [clock, setClock] = useState(new Date());
  const [tick, setTick] = useState(0);

  // Live clock
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  // Simulate live price ticks
  useEffect(() => {
    const t = setInterval(() => {
      tickPrices();
      setTick(prev => prev + 1);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const wallet = getWallet("INV_01") || { equity: INITIAL_BALANCE, balance: INITIAL_BALANCE, initialBalance: INITIAL_BALANCE, realizedPnL: 0, unrealizedPnL: 0, tradeCount: 0, winCount: 0, lossCount: 0 };
  const positions = getPositions("INV_01");
  const prices = getMarketPrices();
  const sparkline = useMemo(() => generateSparkline(INITIAL_BALANCE, 30), []);

  const tabs = [
    { id: "portfolio", label: "Portfolio", icon: "◉" },
    { id: "markets", label: "Markets", icon: "◈" },
    { id: "agents", label: "Agents", icon: "◆" },
    { id: "group", label: "Group", icon: "◇" },
  ];

  return (
    <div style={{
      minHeight: "100vh", maxWidth: 480, margin: "0 auto",
      background: "linear-gradient(180deg, #0a0a1a 0%, #0d1117 50%, #111827 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
      position: "relative", overflow: "auto",
    }}>
      {/* Status bar */}
      <div style={{
        padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(10,10,26,0.9)", backdropFilter: "blur(20px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BrandLogo size={28} />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>12 TRIBES</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            padding: "3px 8px", borderRadius: 6,
            background: "rgba(245,158,11,0.12)", fontSize: 9, color: "#F59E0B", fontWeight: 700,
          }}>PAPER</div>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>

      {/* Screen content */}
      {tab === "portfolio" && <PortfolioScreen wallet={wallet} positions={positions} sparkline={sparkline} />}
      {tab === "markets" && <MarketsScreen prices={prices} />}
      {tab === "agents" && <AgentsScreen />}
      {tab === "group" && <GroupScreen />}

      {/* Bottom tab bar */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 480,
        background: "rgba(10,10,26,0.95)", backdropFilter: "blur(30px)",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        display: "flex", padding: "8px 0 20px", zIndex: 100,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, border: "none", cursor: "pointer",
            background: "transparent",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            padding: "6px 0",
          }}>
            <span style={{ fontSize: 18, color: tab === t.id ? "#00D4FF" : "rgba(255,255,255,0.3)" }}>{t.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: tab === t.id ? "#00D4FF" : "rgba(255,255,255,0.3)",
            }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}