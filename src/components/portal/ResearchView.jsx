import { useState, useEffect } from 'react';
import RefreshButton from '../RefreshButton';

function ResearchView({ isMobile }) {
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [research, setResearch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allSymbols, setAllSymbols] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('12tribes_recent_research') || '[]'); } catch { return []; }
  });

  const API_BASE = (() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return `http://${window.location.hostname}:4000/api`;
  })();

  // Load all available symbols on mount
  useEffect(() => {
    fetch(`${API_BASE}/market/search`).then(r => r.json()).then(d => setAllSymbols(d.results || [])).catch(() => {});
  }, []);

  // Live search filtering
  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return; }
    const q = query.toUpperCase();
    setSearchResults(allSymbols.filter(s => s.includes(q)).slice(0, 10));
  }, [query, allSymbols]);

  // Auto-refresh research data every 10 seconds
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => {
    if (!selectedSymbol) return;
    const interval = setInterval(() => {
      fetch(`${API_BASE}/market/research/${encodeURIComponent(selectedSymbol)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) { setResearch(data); setRefreshError(false); }
          else { setRefreshError(true); }
        })
        .catch(() => { setRefreshError(true); });
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedSymbol]);

  const handleSearch = async (symbol) => {
    const sym = (symbol || query).toUpperCase().trim();
    if (!sym) return;
    setLoading(true);
    setError('');
    setSelectedSymbol(sym);
    setQuery(sym);
    setSearchResults([]);
    try {
      const res = await fetch(`${API_BASE}/market/research/${encodeURIComponent(sym)}`);
      const data = await res.json();
      if (res.ok) {
        setResearch(data);
        // Update recent searches
        const updated = [sym, ...recentSearches.filter(s => s !== sym)].slice(0, 8);
        setRecentSearches(updated);
        try { localStorage.setItem('12tribes_recent_research', JSON.stringify(updated)); } catch {}
      } else {
        setError(data.error || 'Symbol not found');
        setResearch(null);
      }
    } catch (err) {
      setError('Network error — could not reach research API');
    }
    setLoading(false);
  };

  const glass = {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18, backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)",
    boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.35)",
  };

  const signalColor = (signal) => {
    if (['BULLISH', 'STRONG', 'OVERSOLD', 'NEAR_SUPPORT'].includes(signal)) return '#10B981';
    if (['BEARISH', 'WEAK', 'OVERBOUGHT', 'NEAR_RESISTANCE', 'HIGH'].includes(signal)) return '#EF4444';
    return 'rgba(255,255,255,0.5)';
  };

  const verdictColor = (verdict) => {
    if (verdict === 'BULLISH') return '#10B981';
    if (verdict === 'LEAN_BULLISH') return '#34D399';
    if (verdict === 'BEARISH') return '#EF4444';
    if (verdict === 'LEAN_BEARISH') return '#F87171';
    return '#F59E0B';
  };

  // Mini sparkline chart from price history
  const Sparkline = ({ data, width = 280, height = 80 }) => {
    if (!data || data.length < 2) return null;
    const prices = data.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 8) - 4;
      return `${x},${y}`;
    }).join(' ');
    const isUp = prices[prices.length - 1] >= prices[0];
    const color = isUp ? '#10B981' : '#EF4444';
    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`grad-${isUp ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#grad-${isUp ? 'up' : 'down'})`} />
      </svg>
    );
  };

  // Signal strength gauge
  const SignalGauge = ({ strength }) => {
    const normalized = (strength + 100) / 200; // 0 to 1
    const angle = normalized * 180 - 90;
    const color = strength > 20 ? '#10B981' : strength < -20 ? '#EF4444' : '#F59E0B';
    return (
      <svg width="120" height="70" viewBox="0 0 120 70">
        <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" strokeLinecap="round" />
        <path d={`M 10 65 A 50 50 0 0 1 ${60 + 50 * Math.cos(Math.PI - normalized * Math.PI)} ${65 - 50 * Math.sin(Math.PI - normalized * Math.PI)}`}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <text x="60" y="58" textAnchor="middle" fill={color} fontSize="18" fontWeight="800" fontFamily="system-ui">
          {strength > 0 ? '+' : ''}{strength}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">SIGNAL</text>
      </svg>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Search Header */}
      <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Market Research</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
              AI-powered technical analysis across stocks, crypto, forex, ETFs, futures, options & cash
              {refreshError && <span style={{ color: '#EF4444', marginLeft: 8 }}>● Connection issue</span>}
            </div>
          </div>
          {selectedSymbol && <RefreshButton onRefresh={() => handleSearch(selectedSymbol)} />}
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search symbol (AAPL, BTC, EUR/USD...)"
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 14, fontSize: 14,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', outline: 'none',
              }}
            />
            <button onClick={() => handleSearch()} disabled={loading}
              style={{
                padding: '12px 24px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))',
                color: '#00D4FF', fontSize: 13, fontWeight: 600,
              }}>
              {loading ? '...' : 'Analyze'}
            </button>
          </div>

          {/* Search Dropdown */}
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 100,
              ...glass, padding: 8, maxHeight: 200, overflowY: 'auto',
            }}>
              {searchResults.map(s => (
                <button key={s} onClick={() => handleSearch(s)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: 'none',
                    background: 'transparent', color: '#fff', fontSize: 14, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left', display: 'block',
                  }}
                  onMouseOver={e => e.target.style.background = 'rgba(0,212,255,0.1)'}
                  onMouseOut={e => e.target.style.background = 'transparent'}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick Chips — categorized */}
        <div style={{ marginTop: 14 }}>
          {[
            { label: 'Stocks', symbols: ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'META', 'AMZN', 'GOOGL'] },
            { label: 'Crypto', symbols: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'DOT', 'LINK'] },
            { label: 'Forex', symbols: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD'] },
            { label: 'ETFs', symbols: ['SPY', 'QQQ', 'GLD', 'TLT', 'XLF', 'XLE', 'ARKK'] },
            { label: 'Futures', symbols: ['CL=F', 'GC=F', 'SI=F', 'NG=F', 'ES=F', 'NQ=F'] },
            { label: 'Options', symbols: ['TQQQ', 'SOXL', 'UVXY', 'SPXS', 'SQQQ'] },
            { label: 'Cash', symbols: ['BIL', 'SHV', 'SGOV'] },
          ].map(cat => (
            <div key={cat.label} style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, marginRight: 8 }}>{cat.label}</span>
              {cat.symbols.map(s => (
                <button key={s} onClick={() => handleSearch(s)}
                  style={{
                    padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: selectedSymbol === s ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)',
                    color: selectedSymbol === s ? '#00D4FF' : 'rgba(255,255,255,0.45)',
                    fontSize: 11, fontWeight: 600, marginRight: 4, marginBottom: 4,
                  }}>
                  {s}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Recent Searches */}
        {recentSearches.length > 0 && !research && (
          <div style={{ marginTop: 12 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: 1 }}>Recent </span>
            {recentSearches.map(s => (
              <button key={s} onClick={() => handleSearch(s)}
                style={{
                  padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)',
                  background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 11,
                  cursor: 'pointer', marginRight: 4, marginBottom: 4,
                }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...glass, padding: 16, textAlign: 'center', color: '#EF4444', fontSize: 13, border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* ═══ RESEARCH RESULTS ═══ */}
      {research && (
        <>
          {/* Price Header Card */}
          <div style={{ ...glass, padding: isMobile ? 16 : 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{research.symbol}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background: 'rgba(0,212,255,0.1)', color: '#00D4FF',
                  }}>{research.assetClass}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background: research.dataSource === 'real' ? 'rgba(16,185,129,0.15)'
                      : research.dataSource === 'initializing' ? 'rgba(0,212,255,0.15)'
                      : research.dataSource === 'stale' ? 'rgba(239,68,68,0.15)'
                      : 'rgba(245,158,11,0.15)',
                    color: research.dataSource === 'real' ? '#10B981'
                      : research.dataSource === 'initializing' ? '#00D4FF'
                      : research.dataSource === 'stale' ? '#EF4444'
                      : '#F59E0B',
                  }}>{research.dataSource === 'real' ? 'LIVE'
                    : research.dataSource === 'initializing' ? 'CONNECTING...'
                    : research.dataSource === 'stale' ? 'STALE'
                    : 'SIMULATED'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>
                    ${research.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: research.price < 10 ? 4 : 2 })}
                  </span>
                  <span style={{
                    fontSize: 16, fontWeight: 700,
                    color: research.changePct >= 0 ? '#10B981' : '#EF4444',
                  }}>
                    {research.changePct >= 0 ? '+' : ''}{research.changePct.toFixed(2)}%
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                  O: ${research.open.toFixed(2)} &nbsp; H: ${research.high.toFixed(2)} &nbsp; L: ${research.low.toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Sparkline data={research.priceHistory} width={isMobile ? 200 : 280} height={70} />
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>Last 60 ticks</div>
              </div>
            </div>
          </div>

          {/* AI Verdict + Signal Gauge */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <div style={{
              ...glass, padding: 20,
              borderColor: `${verdictColor(research.aiVerdict.verdict)}33`,
            }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>AI Verdict</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{
                  padding: '6px 16px', borderRadius: 10, fontSize: 14, fontWeight: 800,
                  background: `${verdictColor(research.aiVerdict.verdict)}20`,
                  color: verdictColor(research.aiVerdict.verdict),
                  border: `1px solid ${verdictColor(research.aiVerdict.verdict)}40`,
                }}>
                  {research.aiVerdict.verdict.replace('_', ' ')}
                </span>
                <SignalGauge strength={research.aiVerdict.signalStrength} />
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                {research.aiVerdict.detail}
              </div>
            </div>

            {/* Key Technicals */}
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Technical Indicators</div>
              {[
                { label: 'RSI (14)', value: research.technicals.rsi.toFixed(1), bar: research.technicals.rsi, max: 100, color: research.technicals.rsi > 70 ? '#EF4444' : research.technicals.rsi < 30 ? '#10B981' : '#00D4FF' },
                { label: 'Momentum', value: `${research.technicals.momentum > 0 ? '+' : ''}${research.technicals.momentum.toFixed(2)}%`, bar: Math.abs(research.technicals.momentum) * 10, max: 100, color: research.technicals.momentum > 0 ? '#10B981' : '#EF4444' },
                { label: 'Volatility', value: `${research.technicals.volatility.toFixed(2)}%`, bar: research.technicals.volatility * 20, max: 100, color: research.technicals.volatility > 3 ? '#F59E0B' : '#00D4FF' },
                { label: 'Regime', value: research.technicals.regime.replace('_', ' ').toUpperCase(), bar: 0, max: 0, color: research.technicals.regime === 'trending_up' ? '#10B981' : research.technicals.regime === 'trending_down' ? '#EF4444' : '#F59E0B' },
              ].map(t => (
                <div key={t.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.value}</span>
                  </div>
                  {t.max > 0 && (
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: t.color, width: `${Math.min(t.bar, 100)}%`, transition: 'width 0.5s' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Signal Breakdown */}
          <div style={{ ...glass, padding: isMobile ? 16 : 20 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Signal Breakdown</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 8 }}>
              {research.signals.map((s, i) => (
                <div key={i} style={{
                  padding: '12px 14px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, textTransform: 'uppercase' }}>{s.indicator}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{s.detail}</div>
                  </div>
                  <span style={{
                    padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, flexShrink: 0,
                    background: `${signalColor(s.signal)}15`, color: signalColor(s.signal),
                    border: `1px solid ${signalColor(s.signal)}30`,
                  }}>
                    {s.signal}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Support/Resistance + Moving Averages */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Key Levels</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Support</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#10B981' }}>${research.levels.support.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Current Price</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>${research.price.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Resistance</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#EF4444' }}>${research.levels.resistance.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Moving Averages</div>
              {[
                { label: 'SMA 10', value: research.technicals.sma10, vs: research.price },
                { label: 'SMA 30', value: research.technicals.sma30, vs: research.price },
                { label: 'EMA 12', value: research.technicals.ema12, vs: research.price },
                { label: 'EMA 26', value: research.technicals.ema26, vs: research.price },
                { label: 'MACD', value: research.technicals.macd, isRaw: true },
              ].map(ma => (
                <div key={ma.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{ma.label}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      {ma.isRaw ? (ma.value > 0 ? '+' : '') + ma.value.toFixed(4) : '$' + ma.value.toFixed(2)}
                    </span>
                    {!ma.isRaw && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: ma.vs > ma.value ? '#10B981' : '#EF4444' }}>
                        {ma.vs > ma.value ? 'ABOVE' : 'BELOW'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tracking Agents */}
          {research.agents.length > 0 && (
            <div style={{ ...glass, padding: 20 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>AI Agents Tracking {research.symbol}</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
                {research.agents.map(a => (
                  <div key={a.name} style={{
                    padding: '14px 16px', borderRadius: 14,
                    background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#00D4FF', marginBottom: 4 }}>{a.name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{a.role.replace('_', ' ')}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>{a.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ textAlign: 'center', padding: '8px 16px', fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>
            {research?.dataSource === 'real'
              ? 'Live market data — not financial advice. AI signals are algorithmic analysis, not trade recommendations.'
              : 'Paper trading analysis — not financial advice. Signals are generated from simulated market data.'}
          </div>
        </>
      )}

      {/* Empty State */}
      {!research && !loading && !error && (
        <div style={{ ...glass, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>⊘</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Select an asset to analyze</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
            Search or tap a symbol above to get AI-powered technical analysis, signal breakdowns, and agent insights
          </div>
        </div>
      )}

      {loading && (
        <div style={{ ...glass, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Analyzing {selectedSymbol}...</div>
        </div>
      )}
    </div>
  );
}

export default ResearchView;
