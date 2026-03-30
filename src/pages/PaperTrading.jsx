import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  getWalletState, getWallet, getPositions, getTradeHistory,
  getMarketPrices, getAllSymbols, getGroupStats, getAgentLeaderboard,
  executeTrade, closePosition, tickPrices, updateLivePrices, getDataSource,
  AI_AGENTS
} from '../store/walletStore.js'
import { getAllUsers } from '../store/authStore.js'
import { startAutoFetch, getDataStatus } from '../store/marketDataService.js'
import { useResponsive } from '../hooks/useResponsive.js'
import BrandLogo from '../components/BrandLogo.jsx'

// ═══════════════════════════════════════════
//   12 TRIBES — PAPER TRADING TERMINAL v1.0
//   Virtual Trade Execution | $100K per investor
//   Apple Liquid Glass UI
// ═══════════════════════════════════════════

const glass = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 50%, rgba(200,220,255,0.08) 100%)",
  backdropFilter: "blur(60px) saturate(200%) brightness(1.1)",
  WebkitBackdropFilter: "blur(60px) saturate(200%) brightness(1.1)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 20,
  boxShadow: "0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.25)",
}

const glassCard = {
  ...glass,
  padding: 24,
  marginBottom: 16,
}

const ASSET_CLASSES = {
  Stocks: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM'],
  Crypto: ['BTC', 'ETH', 'SOL', 'AVAX'],
  Forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
  ETFs: ['SPY', 'QQQ', 'GLD', 'TLT'],
}

const COLORS = ['#00D4FF', '#7B61FF', '#FF6B6B', '#00E676', '#FFD93D', '#FF8A65',
  '#4FC3F7', '#BA68C8', '#81C784', '#FFB74D', '#E57373', '#64B5F6']

function formatUSD(n) {
  if (n === undefined || n === null) return '$0.00'
  const neg = n < 0
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${neg ? '-' : ''}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${neg ? '-' : ''}$${(abs / 1e3).toFixed(1)}K`
  return `${neg ? '-' : ''}$${abs.toFixed(2)}`
}

function formatPrice(price, symbol) {
  if (!price) return '—'
  if (symbol && symbol.includes('/')) return price.toFixed(4)
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return price.toFixed(2)
}

// ═══════ PRICE SPARKLINE ═══════
function MiniSparkline({ data, color = '#00D4FF', width = 100, height = 32 }) {
  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`sp_${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#sp_${color.replace('#', '')})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ═══════ ORDER ENTRY PANEL ═══════
function OrderEntry({ prices, onTrade, isMobile }) {
  const [symbol, setSymbol] = useState('AAPL')
  const [side, setSide] = useState('LONG')
  const [quantity, setQuantity] = useState('')
  const users = getAllUsers()
  const [investor, setInvestor] = useState(users[0]?.id || '')
  const [agent, setAgent] = useState('Viper')
  const [category, setCategory] = useState('Stocks')
  const [result, setResult] = useState(null)

  const price = prices[symbol] || 0
  const cost = price * (parseFloat(quantity) || 0)
  const wallet = getWallet(investor)

  const handleSubmit = () => {
    if (!quantity || parseFloat(quantity) <= 0) {
      setResult({ success: false, error: 'Enter a valid quantity' })
      return
    }
    const res = onTrade({
      symbol, side, quantity: parseFloat(quantity), investorId: investor, agent
    })
    setResult(res)
    if (res.success) setQuantity('')
    setTimeout(() => setResult(null), 4000)
  }

  return (
    <div style={glassCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>ORDER ENTRY</h3>
        <span style={{
          padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
          background: 'rgba(255,193,7,0.15)', color: '#FFC107',
        }}>PAPER TRADING</span>
      </div>

      {/* Asset Category Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.keys(ASSET_CLASSES).map(cat => (
          <button key={cat} onClick={() => { setCategory(cat); setSymbol(ASSET_CLASSES[cat][0]) }}
            style={{
              padding: '6px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: category === cat ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.06)',
              color: category === cat ? '#00D4FF' : 'rgba(255,255,255,0.5)',
            }}>
            {cat}
          </button>
        ))}
      </div>

      {/* Symbol Select */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 4 }}>SYMBOL</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, outline: 'none',
            }}>
            {ASSET_CLASSES[category].map(s => (
              <option key={s} value={s} style={{ background: '#1a1a2e' }}>{s} — ${formatPrice(prices[s], s)}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 4 }}>INVESTOR</label>
          <select value={investor} onChange={e => setInvestor(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, outline: 'none',
            }}>
            {users.length === 0 ? (
              <option style={{ background: '#1a1a2e' }}>No investors registered</option>
            ) : users.map(inv => (
              <option key={inv.id} value={inv.id} style={{ background: '#1a1a2e' }}>
                {inv.name} ({formatUSD(getWallet(inv.id)?.balance)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Side Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['LONG', 'SHORT'].map(s => (
          <button key={s} onClick={() => setSide(s)}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, letterSpacing: 1,
              background: side === s
                ? s === 'LONG' ? 'rgba(0,230,118,0.2)' : 'rgba(255,107,107,0.2)'
                : 'rgba(255,255,255,0.04)',
              color: side === s
                ? s === 'LONG' ? '#00E676' : '#FF6B6B'
                : 'rgba(255,255,255,0.3)',
            }}>
            {s === 'LONG' ? '▲ BUY LONG' : '▼ SELL SHORT'}
          </button>
        ))}
      </div>

      {/* Quantity + Agent */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 4 }}>QUANTITY</label>
          <input
            type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
            placeholder="0.00"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 4 }}>AI AGENT</label>
          <select value={agent} onChange={e => setAgent(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, outline: 'none',
            }}>
            {AI_AGENTS.map(a => (
              <option key={a} value={a} style={{ background: '#1a1a2e' }}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Order Summary */}
      <div style={{
        ...glass, padding: 16, borderRadius: 14, marginBottom: 16,
        background: 'rgba(255,255,255,0.03)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Price</span>
          <span style={{ fontSize: 14, color: '#fff', fontWeight: 600 }}>${formatPrice(price, symbol)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            {side === 'LONG' ? 'Total Cost' : 'Margin Required (10%)'}
          </span>
          <span style={{ fontSize: 14, color: '#fff', fontWeight: 600 }}>
            {formatUSD(side === 'LONG' ? cost : cost * 0.1)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Available Balance</span>
          <span style={{ fontSize: 14, color: wallet ? '#00E676' : '#FF6B6B', fontWeight: 600 }}>
            {formatUSD(wallet?.balance)}
          </span>
        </div>
      </div>

      {/* Execute Button */}
      <button onClick={handleSubmit}
        style={{
          width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 700, letterSpacing: 1,
          background: side === 'LONG'
            ? 'linear-gradient(135deg, #00E676, #00C853)'
            : 'linear-gradient(135deg, #FF6B6B, #FF5252)',
          color: '#fff',
          boxShadow: side === 'LONG'
            ? '0 4px 20px rgba(0,230,118,0.3)'
            : '0 4px 20px rgba(255,107,107,0.3)',
        }}>
        EXECUTE {side} — {symbol}
      </button>

      {/* Result Toast */}
      {result && (
        <div style={{
          marginTop: 12, padding: '10px 16px', borderRadius: 12,
          background: result.success ? 'rgba(0,230,118,0.15)' : 'rgba(255,107,107,0.15)',
          color: result.success ? '#00E676' : '#FF6B6B',
          fontSize: 13, fontWeight: 500,
        }}>
          {result.success
            ? `✅ ${result.trade.side} ${result.trade.quantity} ${result.trade.symbol} @ $${formatPrice(result.trade.entryPrice, result.trade.symbol)} — Agent: ${result.trade.agent}`
            : `⚠️ ${result.error}`
          }
        </div>
      )}
    </div>
  )
}

// ═══════ POSITIONS TABLE ═══════
function PositionsPanel({ positions, onClose, isMobile }) {
  if (positions.length === 0) {
    return (
      <div style={glassCard}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#fff' }}>OPEN POSITIONS</h3>
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>
          No open positions. Execute a trade to get started.
        </div>
      </div>
    )
  }

  return (
    <div style={glassCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>
          OPEN POSITIONS <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>({positions.length})</span>
        </h3>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Symbol', 'Side', 'Qty', 'Entry', 'Current', 'P&L', 'Return', 'Agent', 'Action'].map(h => (
                <th key={h} style={{
                  padding: '8px 10px', textAlign: 'left', color: 'rgba(255,255,255,0.4)',
                  fontSize: 11, fontWeight: 600, letterSpacing: 0.5, whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => (
              <tr key={pos.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '10px', color: '#fff', fontWeight: 600 }}>{pos.symbol}</td>
                <td style={{
                  padding: '10px',
                  color: pos.side === 'LONG' ? '#00E676' : '#FF6B6B',
                  fontWeight: 600,
                }}>{pos.side}</td>
                <td style={{ padding: '10px', color: 'rgba(255,255,255,0.7)' }}>{pos.quantity}</td>
                <td style={{ padding: '10px', color: 'rgba(255,255,255,0.7)' }}>${formatPrice(pos.entryPrice, pos.symbol)}</td>
                <td style={{ padding: '10px', color: '#fff' }}>${formatPrice(pos.currentPrice, pos.symbol)}</td>
                <td style={{
                  padding: '10px', fontWeight: 600,
                  color: pos.unrealizedPnL >= 0 ? '#00E676' : '#FF6B6B',
                }}>{formatUSD(pos.unrealizedPnL)}</td>
                <td style={{
                  padding: '10px',
                  color: pos.returnPct >= 0 ? '#00E676' : '#FF6B6B',
                }}>{pos.returnPct >= 0 ? '+' : ''}{pos.returnPct}%</td>
                <td style={{ padding: '10px', color: '#7B61FF' }}>{pos.agent}</td>
                <td style={{ padding: '10px' }}>
                  <button onClick={() => onClose(pos.id)}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 600,
                      background: 'rgba(255,107,107,0.15)', color: '#FF6B6B',
                    }}>
                    CLOSE
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════ TRADE HISTORY ═══════
function TradeHistoryPanel({ trades, isMobile }) {
  const recentTrades = trades.slice(-20).reverse()

  return (
    <div style={glassCard}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#fff' }}>
        TRADE HISTORY <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>({trades.length} total)</span>
      </h3>

      {recentTrades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>
          No closed trades yet. Close a position to see results here.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['ID', 'Symbol', 'Side', 'Qty', 'Entry', 'Close', 'P&L', 'Agent'].map(h => (
                  <th key={h} style={{
                    padding: '8px 10px', textAlign: 'left', color: 'rgba(255,255,255,0.4)',
                    fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentTrades.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{t.id}</td>
                  <td style={{ padding: '8px 10px', color: '#fff', fontWeight: 600 }}>{t.symbol}</td>
                  <td style={{
                    padding: '8px 10px',
                    color: t.side === 'LONG' ? '#00E676' : '#FF6B6B',
                    fontWeight: 600,
                  }}>{t.side}</td>
                  <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.7)' }}>{t.quantity}</td>
                  <td style={{ padding: '8px 10px', color: 'rgba(255,255,255,0.7)' }}>${formatPrice(t.entryPrice, t.symbol)}</td>
                  <td style={{ padding: '8px 10px', color: '#fff' }}>${formatPrice(t.closePrice, t.symbol)}</td>
                  <td style={{
                    padding: '8px 10px', fontWeight: 600,
                    color: t.realizedPnL >= 0 ? '#00E676' : '#FF6B6B',
                  }}>{formatUSD(t.realizedPnL)}</td>
                  <td style={{ padding: '8px 10px', color: '#7B61FF' }}>{t.agent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════ MARKET WATCH ═══════
function MarketWatch({ prices, priceHistory, isMobile }) {
  const [selectedCat, setSelectedCat] = useState('All')

  const symbols = selectedCat === 'All' ? Object.keys(prices) : (ASSET_CLASSES[selectedCat] || [])

  return (
    <div style={glassCard}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#fff' }}>MARKET WATCH</h3>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['All', ...Object.keys(ASSET_CLASSES)].map(cat => (
          <button key={cat} onClick={() => setSelectedCat(cat)}
            style={{
              padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: selectedCat === cat ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.04)',
              color: selectedCat === cat ? '#00D4FF' : 'rgba(255,255,255,0.4)',
            }}>
            {cat}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
        {symbols.map(sym => {
          const history = priceHistory[sym] || []
          const prev = history.length > 1 ? history[history.length - 2]?.v : prices[sym]
          const change = prices[sym] - prev
          const changePct = prev ? ((change / prev) * 100) : 0
          const isUp = change >= 0

          return (
            <div key={sym} style={{
              ...glass, padding: '12px 16px', borderRadius: 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{sym}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginTop: 2 }}>
                  ${formatPrice(prices[sym], sym)}
                </div>
                <div style={{
                  fontSize: 12, fontWeight: 500, marginTop: 2,
                  color: isUp ? '#00E676' : '#FF6B6B',
                }}>
                  {isUp ? '▲' : '▼'} {changePct >= 0 ? '+' : ''}{changePct.toFixed(3)}%
                </div>
              </div>
              <MiniSparkline data={history.slice(-20)} color={isUp ? '#00E676' : '#FF6B6B'} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════ WALLET OVERVIEW ═══════
function WalletOverview({ isMobile }) {
  const stats = getGroupStats()
  const users = getAllUsers()
  const wallets = users.map(inv => ({ ...inv, ...getWallet(inv.id) }))
    .sort((a, b) => (b.equity || 0) - (a.equity || 0))

  return (
    <div style={glassCard}>
      <h3 style={{ margin: '0 0 20px', fontSize: 16, color: '#fff' }}>WALLET OVERVIEW</h3>

      {/* Group Stats Bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: 12, marginBottom: 20,
      }}>
        {[
          { label: 'Group Equity', value: formatUSD(stats.totalEquity), color: '#00D4FF' },
          { label: 'Total P&L', value: formatUSD(stats.totalPnL), color: stats.totalPnL >= 0 ? '#00E676' : '#FF6B6B' },
          { label: 'Open Positions', value: stats.openPositions, color: '#7B61FF' },
          { label: 'Closed Trades', value: stats.closedTrades, color: '#FFD93D' },
        ].map(s => (
          <div key={s.label} style={{
            ...glass, padding: '14px 16px', borderRadius: 14, textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Investor Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
        {wallets.map((w, i) => (
          <div key={w.id} style={{
            ...glass, padding: '12px 16px', borderRadius: 14,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `linear-gradient(135deg, ${COLORS[i]}, ${COLORS[(i + 3) % 12]})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#fff',
            }}>{w.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{w.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                Bal: {formatUSD(w.balance)} | Equity: {formatUSD(w.equity)}
              </div>
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: w.unrealizedPnL >= 0 ? '#00E676' : '#FF6B6B',
            }}>
              {w.unrealizedPnL >= 0 ? '+' : ''}{formatUSD(w.unrealizedPnL)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════ AGENT LEADERBOARD ═══════
function AgentLeaderboard() {
  const agents = getAgentLeaderboard()
  const agentColors = { Viper: '#00E676', Oracle: '#7B61FF', Spectre: '#FF6B6B', Sentinel: '#00D4FF', Phoenix: '#FFD93D', Titan: '#FF8A65' }

  return (
    <div style={glassCard}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#fff' }}>AI AGENT LEADERBOARD</h3>
      {agents.map((a, i) => (
        <div key={a.name} style={{
          ...glass, padding: '12px 16px', borderRadius: 14, marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: `rgba(${i === 0 ? '255,215,0' : i === 1 ? '192,192,192' : '205,127,50'},0.2)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32',
          }}>#{i + 1}</div>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: agentColors[a.name] || '#888',
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: agentColors[a.name] || '#fff' }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              {a.totalTrades} trades | W:{a.wins} L:{a.losses} | Win Rate: {a.totalTrades > 0 ? ((a.wins / a.totalTrades) * 100).toFixed(0) : 0}%
            </div>
          </div>
          <div style={{
            fontSize: 16, fontWeight: 700,
            color: a.totalPnL >= 0 ? '#00E676' : '#FF6B6B',
          }}>
            {formatUSD(a.totalPnL)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ═══════ MAIN COMPONENT ═══════
export default function PaperTrading() {
  const { isMobile, isTablet } = useResponsive()
  const [view, setView] = useState('trade')
  const [tick, setTick] = useState(0)
  const [priceHistory, setPriceHistory] = useState({})

  // Live market data + simulation tick
  useEffect(() => {
    const symbols = getAllSymbols()
    const initHistory = {}
    symbols.forEach(s => {
      const prices = getMarketPrices()
      initHistory[s] = [{ v: prices[s] }]
    })
    setPriceHistory(initHistory)

    // Start live market data auto-fetch (30s interval)
    const stopLiveFeed = startAutoFetch((livePrices) => {
      updateLivePrices(livePrices)
    }, 30_000)

    // Simulation tick every 2 seconds (adds micro-volatility between live updates)
    const interval = setInterval(() => {
      tickPrices()
      setTick(t => t + 1)

      const prices = getMarketPrices()
      setPriceHistory(prev => {
        const next = { ...prev }
        symbols.forEach(s => {
          const arr = [...(next[s] || []), { v: prices[s] }]
          next[s] = arr.slice(-60)
        })
        return next
      })
    }, 2000)

    return () => {
      clearInterval(interval)
      stopLiveFeed()
    }
  }, [])

  const prices = getMarketPrices()
  const positions = getPositions()
  const trades = getTradeHistory()

  const handleTrade = (tradeData) => executeTrade(tradeData)
  const handleClose = (posId) => closePosition(posId)

  const VIEWS = [
    { id: 'trade', label: 'Trade', icon: '◆' },
    { id: 'positions', label: 'Positions', icon: '◉' },
    { id: 'history', label: 'History', icon: '◈' },
    { id: 'market', label: 'Markets', icon: '▤' },
    { id: 'wallets', label: 'Wallets', icon: '⬡' },
    { id: 'agents', label: 'Agents', icon: '◇' },
  ]

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 50%, rgba(0,212,255,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(123,97,255,0.06) 0%, transparent 50%), #0a0a1a',
      padding: isMobile ? '16px' : '24px 32px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      color: '#fff',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandLogo size={40} />
            <div>
              <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 26, fontWeight: 800, letterSpacing: -0.5 }}>
                PAPER TRADING TERMINAL
              </h1>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                12 TRIBES — Virtual Trade Execution Engine
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{
            padding: '6px 12px', borderRadius: 10,
            background: getDataSource() === 'live' ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${getDataSource() === 'live' ? 'rgba(0,230,118,0.3)' : 'rgba(255,255,255,0.1)'}`,
            fontSize: 11, fontWeight: 600,
            color: getDataSource() === 'live' ? '#00E676' : 'rgba(255,255,255,0.4)',
          }}>
            {getDataSource() === 'live' ? '● LIVE DATA' : '○ SIMULATED'}
          </div>
          <div style={{
            padding: '6px 16px', borderRadius: 10,
            background: 'rgba(255,193,7,0.12)', border: '1px solid rgba(255,193,7,0.3)',
            fontSize: 12, fontWeight: 700, color: '#FFC107', letterSpacing: 1,
          }}>
            ⚠ PAPER TRADING — NO REAL MONEY
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div style={{
        ...glass, padding: '6px', borderRadius: 14, marginBottom: 24,
        display: 'flex', gap: 4, overflowX: 'auto',
      }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{
              padding: isMobile ? '8px 12px' : '10px 20px', borderRadius: 10, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 13, fontWeight: 600,
              background: view === v.id ? 'rgba(0,212,255,0.15)' : 'transparent',
              color: view === v.id ? '#00D4FF' : 'rgba(255,255,255,0.4)',
            }}>
            <span style={{ marginRight: 6 }}>{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {view === 'trade' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <div>
            <OrderEntry prices={prices} onTrade={handleTrade} isMobile={isMobile} />
            <AgentLeaderboard />
          </div>
          <div>
            <PositionsPanel positions={positions} onClose={handleClose} isMobile={isMobile} />
            <TradeHistoryPanel trades={trades} isMobile={isMobile} />
          </div>
        </div>
      )}

      {view === 'positions' && (
        <PositionsPanel positions={positions} onClose={handleClose} isMobile={isMobile} />
      )}

      {view === 'history' && (
        <TradeHistoryPanel trades={trades} isMobile={isMobile} />
      )}

      {view === 'market' && (
        <MarketWatch prices={prices} priceHistory={priceHistory} isMobile={isMobile} />
      )}

      {view === 'wallets' && (
        <WalletOverview isMobile={isMobile} />
      )}

      {view === 'agents' && (
        <AgentLeaderboard />
      )}
    </div>
  )
}
