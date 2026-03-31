import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as recharts from "recharts";
import { useResponsive } from '../hooks/useResponsive';
import BrandLogo from '../components/BrandLogo.jsx';
import { haptics } from '../hooks/useHaptics.js';
const {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart, Scatter
} = recharts;

// ═══════════════════════════════════════════
//   12 TRIBES — AI TRADING ENGINE v1.0
//   Signal Generation | Execution | Live Feed
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

// === GLASS STYLES ===
const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 24,
  boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4), inset 0 -0.5px 0 rgba(255,255,255,0.05)",
  padding: 24,
  ...extra,
});

const glassInner = (extra = {}) => ({
  padding: 14, borderRadius: 16,
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
  ...extra,
});

// === DATA GENERATORS ===
const SYMBOLS = {
  stocks: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "JPM"],
  crypto: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"],
  forex: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "GBP/JPY"],
  options: ["SPY 520C 4/18", "QQQ 440P 4/18", "AAPL 200C 5/16", "TSLA 280P 4/18"],
  futures: ["MES Jun26", "MNQ Jun26", "MGC Jun26", "M2K Jun26"],
};

const ALL_SYMBOLS = Object.values(SYMBOLS).flat();

function generateSignals(count) {
  const signals = [];
  const types = ["LONG", "SHORT"];
  const sources = ["Viper", "Oracle", "Spectre", "Sentinel", "Phoenix"];
  const strategies = ["Momentum Breakout", "Mean Reversion", "Trend Follow", "Vol Crush", "Carry Trade", "Grid Entry", "Gap Fill", "RSI Divergence"];
  for (let i = 0; i < count; i++) {
    const confidence = Math.random() * 40 + 60;
    const type = types[Math.floor(Math.random() * 2)];
    signals.push({
      id: `SIG_${String(i + 1).padStart(4, "0")}`,
      time: `${String(Math.floor(Math.random() * 24)).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
      symbol: ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)],
      type,
      confidence: confidence.toFixed(1),
      strategy: strategies[Math.floor(Math.random() * strategies.length)],
      agent: sources[Math.floor(Math.random() * sources.length)],
      status: confidence > 85 ? "APPROVED" : confidence > 75 ? "REVIEW" : "REJECTED",
      riskScore: (Math.random() * 5 + 1).toFixed(1),
      expectedReturn: (type === "LONG" ? 1 : -1) * (Math.random() * 3 + 0.5),
      stopLoss: (Math.random() * 2 + 0.5).toFixed(2),
      takeProfit: (Math.random() * 4 + 1).toFixed(2),
    });
  }
  return signals.sort((a, b) => b.confidence - a.confidence);
}

function generateOrderBook() {
  const bids = [], asks = [];
  let bidPrice = 521.50, askPrice = 521.55;
  for (let i = 0; i < 12; i++) {
    bids.push({ price: (bidPrice - i * 0.05).toFixed(2), size: Math.floor(Math.random() * 500 + 50), total: 0 });
    asks.push({ price: (askPrice + i * 0.05).toFixed(2), size: Math.floor(Math.random() * 500 + 50), total: 0 });
  }
  let bTotal = 0, aTotal = 0;
  bids.forEach(b => { bTotal += b.size; b.total = bTotal; });
  asks.forEach(a => { aTotal += a.size; a.total = aTotal; });
  return { bids, asks };
}

function generateCandlestick(count) {
  const data = [];
  let price = 521;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open + (Math.random() - 0.48) * 4;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    const volume = Math.floor(Math.random() * 50000 + 10000);
    data.push({
      time: `${String(9 + Math.floor(i * 6.5 / count)).padStart(2, "0")}:${String(Math.floor((i * 390 / count) % 60)).padStart(2, "0")}`,
      open: open.toFixed(2), close: close.toFixed(2),
      high: high.toFixed(2), low: low.toFixed(2),
      volume, color: close >= open ? "#10B981" : "#EF4444",
      mid: ((high + low) / 2).toFixed(2),
    });
    price = close;
  }
  return data;
}

function generateExecutionQueue() {
  const statuses = ["QUEUED", "ROUTING", "PARTIAL", "FILLED", "CANCELLED"];
  const venues = ["IB-SMART", "IB-ARCA", "IB-NYSE", "IB-NASDAQ", "BINANCE", "OANDA"];
  const queue = [];
  for (let i = 0; i < 15; i++) {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const filledQty = status === "FILLED" ? 100 : status === "PARTIAL" ? Math.floor(Math.random() * 80 + 10) : 0;
    queue.push({
      id: `ORD_${String(i + 1).padStart(5, "0")}`,
      time: `${String(9 + Math.floor(Math.random() * 7)).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
      symbol: ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)],
      side: Math.random() > 0.5 ? "BUY" : "SELL",
      qty: 100,
      filledQty,
      price: (Math.random() * 500 + 20).toFixed(2),
      venue: venues[Math.floor(Math.random() * venues.length)],
      status,
      slippage: status === "FILLED" ? (Math.random() * 3 - 0.5).toFixed(2) : "—",
      latency: status !== "QUEUED" ? `${Math.floor(Math.random() * 200 + 5)}ms` : "—",
    });
  }
  return queue.sort((a, b) => b.time.localeCompare(a.time));
}

function generateAgentPipeline() {
  return [
    {
      id: "INGEST", name: "Data Ingestion", icon: "📡", status: "active",
      metrics: { throughput: "24.3k msg/s", latency: "2.1ms", sources: 47, uptime: "99.97%" },
      feeds: ["Market Data (L2)", "News API", "SEC EDGAR", "Social Sentiment", "On-Chain", "Macro Calendar"],
    },
    {
      id: "PROCESS", name: "Signal Processing", icon: "⚙️", status: "active",
      metrics: { signals: "342/hr", filtered: "89/hr", accuracy: "87.6%", models: 12 },
      agents: ["Viper — Momentum", "Oracle — Macro", "Spectre — Options"],
    },
    {
      id: "RISK", name: "Risk Filter", icon: "🛡️", status: "active",
      metrics: { approved: "64%", rejected: "21%", review: "15%", varLimit: "$1,842" },
      checks: ["Position Limits", "Correlation Check", "Margin Buffer", "Drawdown Gate"],
    },
    {
      id: "SIZE", name: "Position Sizing", icon: "🏛️", status: "active",
      metrics: { method: "Kelly 0.5x", maxSize: "10%", avgSize: "$3,200", leverage: "2.1x" },
      agent: "Titan",
    },
    {
      id: "EXEC", name: "Execution", icon: "⚡", status: "active",
      metrics: { fills: "94.2%", avgSlippage: "0.8bps", avgLatency: "47ms", venues: 6 },
      routing: ["IB Smart Router", "BINANCE", "OANDA"],
    },
    {
      id: "HEAL", name: "Self-Healing", icon: "🔥", status: "active",
      metrics: { interventions: "7 today", modelRetrains: 3, rebalances: 2, accuracy: "96.1%" },
      agent: "Phoenix",
    },
  ];
}

// === COMPONENTS ===

function SignalCard({ signal }) {
  const { isMobile } = useResponsive();
  const statusColors = { APPROVED: "#10B981", REVIEW: "#F59E0B", REJECTED: "#EF4444" };
  const sColor = statusColors[signal.status];
  return (
    <div style={{
      ...glassInner(),
      display: "flex", alignItems: "center", gap: isMobile ? 10 : 14,
      borderLeft: `3px solid ${sColor}`,
      flexWrap: isMobile ? "wrap" : "nowrap",
    }}>
      <div style={{ flex: isMobile ? "0 0 50px" : "0 0 70px", textAlign: "center" }}>
        <div style={{
          fontSize: isMobile ? 18 : 24, fontWeight: 800,
          color: signal.type === "LONG" ? "#10B981" : "#EF4444",
        }}>{signal.type === "LONG" ? "▲" : "▼"}</div>
        <div style={{ fontSize: isMobile ? 8 : 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{signal.type}</div>
      </div>
      <div style={{ flex: isMobile ? "1 1 100%" : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 700, color: "#fff" }}>{signal.symbol}</span>
          <span style={{
            padding: "2px 8px", borderRadius: 8, fontSize: isMobile ? 8 : 10, fontWeight: 600,
            background: `${sColor}22`, color: sColor,
          }}>{signal.status}</span>
        </div>
        <div style={{ fontSize: isMobile ? 10 : 11, color: "rgba(255,255,255,0.5)" }}>{signal.strategy} — via {signal.agent}</div>
        <div style={{ display: "flex", gap: isMobile ? 8 : 14, marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>SL: <span style={{ color: "#EF4444" }}>{signal.stopLoss}%</span></span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>TP: <span style={{ color: "#10B981" }}>{signal.takeProfit}%</span></span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>Risk: <span style={{ color: parseFloat(signal.riskScore) > 3 ? "#F59E0B" : "#10B981" }}>{signal.riskScore}/10</span></span>
        </div>
      </div>
      <div style={{ textAlign: "right", flex: isMobile ? "0 0 auto" : undefined }}>
        <div style={{ fontSize: isMobile ? 20 : 28, fontWeight: 800, color: parseFloat(signal.confidence) > 85 ? "#10B981" : parseFloat(signal.confidence) > 75 ? "#F59E0B" : "#EF4444" }}>
          {signal.confidence}
        </div>
        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1 }}>Confidence</div>
      </div>
    </div>
  );
}

function PipelineView({ pipeline }) {
  const { isMobile } = useResponsive();
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 20 }}>AI Agent Pipeline — Signal to Execution</div>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {pipeline.map((stage, idx) => (
          <div key={stage.id} style={{ flex: "1 0 " + (isMobile ? "160px" : "200px"), display: "flex", alignItems: "stretch", gap: 12 }}>
            <div style={{
              ...glassInner({ padding: isMobile ? 12 : 16, flex: 1, display: "flex", flexDirection: "column" }),
              borderTop: `3px solid ${stage.status === "active" ? "#10B981" : "#F59E0B"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: isMobile ? 18 : 22 }}>{stage.icon}</span>
                <div>
                  <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: "#fff" }}>{stage.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 6px #10B981" }} />
                    <span style={{ fontSize: 8, color: "#10B981", textTransform: "uppercase" }}>Active</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr" + (isMobile ? "" : " 1fr"), gap: 6, flex: 1 }}>
                {Object.entries(stage.metrics).map(([k, v]) => (
                  <div key={k} style={{ padding: "6px 8px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {k.replace(/([A-Z])/g, " $1").trim()}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#00D4FF", marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            {idx < pipeline.length - 1 && (
              <div style={{ display: "flex", alignItems: "center", color: "rgba(255,255,255,0.2)", fontSize: 20 }}>→</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderBookView({ book }) {
  const { isMobile } = useResponsive();
  const maxTotal = Math.max(book.bids[book.bids.length - 1]?.total || 1, book.asks[book.asks.length - 1]?.total || 1);
  return (
    <div style={glass()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Order Book — SPY</div>
        <div style={{ fontSize: 12, color: "#00D4FF", fontFamily: "monospace" }}>$521.52</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: isMobile ? 9 : 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
            <span>Bids</span><span>Size</span>
          </div>
          {book.bids.map((b, i) => (
            <div key={i} style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: isMobile ? "2px 6px" : "3px 8px", marginBottom: 2, borderRadius: 4 }}>
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${(b.total / maxTotal) * 100}%`, background: "rgba(16,185,129,0.1)", borderRadius: 4 }} />
              <span style={{ fontSize: isMobile ? 10 : 12, fontFamily: "monospace", color: "#10B981", position: "relative" }}>{b.price}</span>
              <span style={{ fontSize: isMobile ? 10 : 12, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", position: "relative" }}>{b.size}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: isMobile ? 9 : 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
            <span>Asks</span><span>Size</span>
          </div>
          {book.asks.map((a, i) => (
            <div key={i} style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: isMobile ? "2px 6px" : "3px 8px", marginBottom: 2, borderRadius: 4 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(a.total / maxTotal) * 100}%`, background: "rgba(239,68,68,0.1)", borderRadius: 4 }} />
              <span style={{ fontSize: isMobile ? 10 : 12, fontFamily: "monospace", color: "#EF4444", position: "relative" }}>{a.price}</span>
              <span style={{ fontSize: isMobile ? 10 : 12, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", position: "relative" }}>{a.size}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExecutionQueueView({ orders }) {
  const { isMobile } = useResponsive();
  const statusColors = { QUEUED: "#6B7280", ROUTING: "#00D4FF", PARTIAL: "#F59E0B", FILLED: "#10B981", CANCELLED: "#EF4444" };
  return (
    <div style={glass({ overflow: "hidden" })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Execution Queue</div>
        <div style={{ display: "flex", gap: isMobile ? 4 : 8, flexWrap: "wrap" }}>
          {Object.entries(statusColors).map(([s, c]) => (
            <span key={s} style={{ fontSize: isMobile ? 8 : 9, color: c, display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: c }} />{isMobile ? s.substring(0, 3) : s}
            </span>
          ))}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 9 : 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {["Time", "Order ID", "Symbol", "Side", "Qty", "Filled", "Price", "Venue", "Slippage", "Latency", "Status"].map(h => (
                <th key={h} style={{ padding: isMobile ? "6px 8px" : "8px 10px", textAlign: "left", color: "rgba(255,255,255,0.35)", fontSize: isMobile ? 8 : 9, textTransform: "uppercase", letterSpacing: 1, fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{o.time}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: "rgba(255,255,255,0.3)", fontSize: isMobile ? 8 : 9 }}>{o.id}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontWeight: 600, color: "#fff" }}>{o.symbol}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px" }}>
                  <span style={{
                    padding: "2px 6px", borderRadius: 4, fontSize: isMobile ? 8 : 9, fontWeight: 700,
                    background: o.side === "BUY" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    color: o.side === "BUY" ? "#10B981" : "#EF4444",
                  }}>{o.side}</span>
                </td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>{o.qty}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: o.filledQty === o.qty ? "#10B981" : "rgba(255,255,255,0.5)" }}>{o.filledQty}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}>${o.price}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontSize: isMobile ? 9 : 10, color: "#A855F7" }}>{o.venue}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: o.slippage !== "—" && parseFloat(o.slippage) > 1 ? "#F59E0B" : "rgba(255,255,255,0.4)" }}>{o.slippage}{o.slippage !== "—" ? "bps" : ""}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px", fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{o.latency}</td>
                <td style={{ padding: isMobile ? "6px 8px" : "8px 10px" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 6, fontSize: isMobile ? 8 : 9, fontWeight: 600,
                    background: `${statusColors[o.status]}18`, color: statusColors[o.status],
                  }}>{o.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriceChart({ data }) {
  const { isMobile } = useResponsive();
  return (
    <div style={glass()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: "#fff" }}>SPY</span>
          <span style={{ fontSize: isMobile ? 11 : 13, color: "rgba(255,255,255,0.4)", marginLeft: isMobile ? 4 : 8 }}>S&P 500 ETF</span>
        </div>
        <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
          {["1m", "5m", "15m", "1H", "1D"].map((tf, i) => (
            <button key={tf} style={{
              padding: isMobile ? "3px 6px" : "4px 10px", borderRadius: 8, border: "none", cursor: "pointer",
              background: i === 2 ? "rgba(0,212,255,0.15)" : "transparent",
              color: i === 2 ? "#00D4FF" : "rgba(255,255,255,0.4)", fontSize: isMobile ? 9 : 11,
              whiteSpace: "nowrap",
            }}>{tf}</button>
          ))}
        </div>
      </div>
      <div style={{ height: isMobile ? 200 : 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#00D4FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" fontSize={9} />
            <YAxis stroke="rgba(255,255,255,0.2)" fontSize={10} domain={["auto", "auto"]} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
              formatter={(v, name) => [`$${Number(v).toFixed(2)}`, name]}
            />
            <Area type="monotone" dataKey="mid" stroke="none" fill="url(#priceGrad)" />
            <Line type="monotone" dataKey="close" stroke="#00D4FF" strokeWidth={2} dot={false} />
            <Bar dataKey="volume" fill="rgba(255,255,255,0.06)" yAxisId="right" />
            <YAxis yAxisId="right" orientation="right" stroke="rgba(255,255,255,0.1)" fontSize={9} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KellyCalculator() {
  const { isMobile } = useResponsive();
  const [winRate, setWinRate] = useState(64);
  const [avgWin, setAvgWin] = useState(2.1);
  const [avgLoss, setAvgLoss] = useState(1.3);
  const w = winRate / 100;
  const kellyFull = w - (1 - w) / (avgWin / avgLoss);
  const kellyHalf = kellyFull * 0.5;
  return (
    <div style={glass()}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Kelly Criterion Calculator</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Win Rate %", value: winRate, set: setWinRate, min: 30, max: 90 },
          { label: "Avg Win %", value: avgWin, set: setAvgWin, min: 0.5, max: 10 },
          { label: "Avg Loss %", value: avgLoss, set: setAvgLoss, min: 0.5, max: 10 },
        ].map(p => (
          <div key={p.label}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>{p.label}</div>
            <input
              type="range" min={p.min} max={p.max} step={0.1} value={p.value}
              onChange={e => p.set(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#00D4FF" }}
            />
            <div style={{ fontSize: isMobile ? 14 : 18, fontWeight: 700, color: "#00D4FF", textAlign: "center", marginTop: 4 }}>{p.value}%</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14 }}>
        <div style={glassInner({ textAlign: "center", padding: isMobile ? 12 : 16 })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>Full Kelly</div>
          <div style={{ fontSize: isMobile ? 20 : 28, fontWeight: 800, color: kellyFull > 0 ? "#10B981" : "#EF4444", marginTop: 4 }}>{(kellyFull * 100).toFixed(1)}%</div>
        </div>
        <div style={glassInner({ textAlign: "center", padding: isMobile ? 12 : 16, borderColor: "rgba(0,212,255,0.2)" })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>Half Kelly (Used)</div>
          <div style={{ fontSize: isMobile ? 20 : 28, fontWeight: 800, color: "#00D4FF", marginTop: 4 }}>{(kellyHalf * 100).toFixed(1)}%</div>
        </div>
        <div style={glassInner({ textAlign: "center", padding: isMobile ? 12 : 16 })}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>Position Size ($60k)</div>
          <div style={{ fontSize: isMobile ? 16 : 28, fontWeight: 800, color: "#A855F7", marginTop: 4 }}>${(60000 * Math.max(kellyHalf, 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
    </div>
  );
}

function LiveMetricBar() {
  const { isMobile } = useResponsive();
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(p => p + 1), 2000); return () => clearInterval(t); }, []);
  const metrics = useMemo(() => [
    { label: "Signals/hr", value: Math.floor(280 + Math.sin(tick) * 40), color: "#00D4FF" },
    { label: "Fill Rate", value: `${(93 + Math.random() * 3).toFixed(1)}%`, color: "#10B981" },
    { label: "Avg Latency", value: `${Math.floor(40 + Math.random() * 30)}ms`, color: "#A855F7" },
    { label: "Slippage", value: `${(0.5 + Math.random() * 1.2).toFixed(1)}bps`, color: "#F59E0B" },
    { label: "Open Orders", value: Math.floor(8 + Math.random() * 10), color: "#00D4FF" },
    { label: "P&L Today", value: `+$${Math.floor(500 + Math.random() * 600)}`, color: "#10B981" },
  ], [tick]);

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {metrics.map(m => (
        <div key={m.label} style={{ ...glass({ padding: isMobile ? 12 : 16 }), flex: isMobile ? "1 1 calc(50% - 6px)" : "1 1 140px", minWidth: isMobile ? undefined : 140 }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{m.label}</div>
          <div style={{ fontSize: isMobile ? 18 : 26, fontWeight: 700, color: m.color }}>{m.value}</div>
        </div>
      ))}
    </div>
  );
}

// === MAIN APP ===
export default function TwelveTribes_TradingEngine() {
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const [view, setView] = useState("signals");
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const signals = useMemo(() => generateSignals(20), []);
  const orderBook = useMemo(() => generateOrderBook(), []);
  const priceData = useMemo(() => generateCandlestick(65), []);
  const execQueue = useMemo(() => generateExecutionQueue(), []);
  const pipeline = useMemo(() => generateAgentPipeline(), []);

  const views = [
    { id: "signals", label: "Signals", icon: "◉" },
    { id: "execution", label: "Execution", icon: "◈" },
    { id: "pipeline", label: "Pipeline", icon: "◆" },
    { id: "sizing", label: "Sizing", icon: "◇" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a1a 0%, #0d1117 25%, #0a0f1e 50%, #111827 75%, #0a0a1a 100%)",
      color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      overflow: "auto",
    }}>
      <div style={{ position: "fixed", top: -200, right: -200, width: 600, height: 600, background: "radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -200, left: -100, width: 500, height: 500, background: "radial-gradient(circle, rgba(168,85,247,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Header */}
      <div style={{
        ...glass({ borderRadius: 0, borderTop: "none", borderLeft: "none", borderRight: "none", padding: isMobile ? "14px 16px" : "14px 32px" }),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
        flexWrap: isMobile ? "wrap" : "nowrap",
        gap: isMobile ? 8 : 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BrandLogo size={38} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5 }}>12 TRIBES</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase" }}>AI Trading Engine</div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 3, overflowX: "auto", flexBasis: isMobile ? "100%" : "auto", order: isMobile ? 3 : 0 }}>
          {views.map(v => (
            <button key={v.id} onClick={() => { haptics.light(); setView(v.id); }} style={{
              padding: isMobile ? "10px 14px" : "8px 18px", borderRadius: 12, border: "none", cursor: "pointer", minHeight: 44,
              fontSize: isMobile ? 11 : 13, fontWeight: 500, transition: "all 0.2s",
              background: view === v.id ? "rgba(0,212,255,0.12)" : "transparent",
              color: view === v.id ? "#00D4FF" : "rgba(255,255,255,0.5)",
              whiteSpace: "nowrap",
            }}>
              <span style={{ marginRight: isMobile ? 2 : 5 }}>{v.icon}</span>{isMobile ? "" : v.label}
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
            <span style={{ fontSize: 10, color: "#10B981", fontWeight: 600 }}>TRADING</span>
          </div>
          <div style={{ fontSize: 13, fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}>
            {clock.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: isMobile ? "16px 16px" : "20px 32px", maxWidth: 1600, margin: "0 auto" }}>
        <LiveMetricBar />

        <div style={{ marginTop: 20 }}>
          {view === "signals" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr" : "2fr 1fr", gap: 20 }}>
                <PriceChart data={priceData} />
                <OrderBookView book={orderBook} />
              </div>
              <div style={glass()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Active Signals ({signals.filter(s => s.status === "APPROVED").length} Approved)</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {["All", "Approved", "Review", "Rejected"].map((f, i) => (
                      <span key={f} style={{
                        padding: isMobile ? "3px 6px" : "4px 10px", borderRadius: 8, fontSize: isMobile ? 9 : 10, cursor: "pointer",
                        background: i === 0 ? "rgba(0,212,255,0.12)" : "transparent",
                        color: i === 0 ? "#00D4FF" : "rgba(255,255,255,0.4)",
                        whiteSpace: "nowrap",
                      }}>{f}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {signals.slice(0, 10).map(s => <SignalCard key={s.id} signal={s} />)}
                </div>
              </div>
            </div>
          )}

          {view === "execution" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <ExecutionQueueView orders={execQueue} />
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
                <div style={glass()}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Venue Distribution</div>
                  {["IB-SMART", "IB-ARCA", "IB-NYSE", "BINANCE", "OANDA"].map((v, i) => {
                    const pct = [35, 22, 18, 15, 10][i];
                    return (
                      <div key={v} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: isMobile ? 11 : 12, marginBottom: 4 }}>
                          <span style={{ color: "rgba(255,255,255,0.6)" }}>{v}</span>
                          <span style={{ color: "#00D4FF" }}>{pct}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.05)" }}>
                          <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: `linear-gradient(90deg, #00D4FF, #A855F7)`, transition: "width 0.5s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={glass()}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Execution Quality</div>
                  {[
                    { label: "Fill Rate", value: "94.2%", benchmark: "90%+", status: "good" },
                    { label: "Avg Slippage", value: "0.8 bps", benchmark: "<2 bps", status: "good" },
                    { label: "Avg Latency", value: "47ms", benchmark: "<100ms", status: "good" },
                    { label: "Rejection Rate", value: "3.1%", benchmark: "<5%", status: "good" },
                    { label: "Partial Fills", value: "8.7%", benchmark: "<15%", status: "good" },
                  ].map(m => (
                    <div key={m.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: isMobile ? "6px 0" : "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", flexWrap: "wrap", gap: 4 }}>
                      <span style={{ fontSize: isMobile ? 11 : 12, color: "rgba(255,255,255,0.5)" }}>{m.label}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10 }}>
                        <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 600, color: "#10B981" }}>{m.value}</span>
                        <span style={{ fontSize: isMobile ? 9 : 10, color: "rgba(255,255,255,0.25)" }}>target: {m.benchmark}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === "pipeline" && <PipelineView pipeline={pipeline} />}

          {view === "sizing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <KellyCalculator />
              <div style={glass()}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>Position Sizing Rules</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  {[
                    { rule: "Max Single Position", value: "10% of AUM", amount: "$6,000" },
                    { rule: "Max Correlated Group", value: "25% of AUM", amount: "$15,000" },
                    { rule: "Max Leverage", value: "2.0x overall", amount: "$120,000" },
                    { rule: "Cash Reserve Floor", value: "15% minimum", amount: "$9,000" },
                    { rule: "Daily Loss Limit", value: "-2% of AUM", amount: "-$1,200" },
                    { rule: "Max Drawdown Gate", value: "-8% from peak", amount: "-$4,800" },
                  ].map(r => (
                    <div key={r.rule} style={glassInner({ padding: isMobile ? 12 : 16 })}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{r.rule}</div>
                      <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: "#fff" }}>{r.value}</div>
                      <div style={{ fontSize: isMobile ? 11 : 12, color: "#00D4FF", marginTop: 4 }}>{r.amount}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: isMobile ? "16px 16px" : "16px 32px", textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
        12 TRIBES v1.0 | AI Trading Engine | All data simulated for demonstration
      </div>
    </div>
  );
}