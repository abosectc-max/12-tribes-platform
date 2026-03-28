// ═══════════════════════════════════════════
//   12 TRIBES — LIVE MARKET DATA SERVICE v1.0
//   CoinGecko (Crypto) + Yahoo Finance Proxy (Stocks/Forex/ETFs)
//   Free tier — no API keys required
// ═══════════════════════════════════════════

// Symbol → CoinGecko ID mapping
const CRYPTO_MAP = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  AVAX: 'avalanche-2',
}

// Stocks/ETFs/Forex symbols for Yahoo Finance
const YAHOO_SYMBOLS = {
  // Stocks
  AAPL: 'AAPL', MSFT: 'MSFT', NVDA: 'NVDA', TSLA: 'TSLA',
  AMZN: 'AMZN', GOOGL: 'GOOGL', META: 'META', JPM: 'JPM',
  // ETFs
  SPY: 'SPY', QQQ: 'QQQ', GLD: 'GLD', TLT: 'TLT',
  // Forex (Yahoo format)
  'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X',
  'USD/JPY': 'USDJPY=X', 'AUD/USD': 'AUDUSD=X',
}

let lastFetchTime = 0
let cachedPrices = {}
let fetchInProgress = false
const FETCH_COOLDOWN = 30_000 // 30 seconds between API calls

// ═══════ COINGECKO — FREE CRYPTO PRICES ═══════
async function fetchCryptoPrices() {
  try {
    const ids = Object.values(CRYPTO_MAP).join(',')
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`)
    const data = await resp.json()

    const prices = {}
    Object.entries(CRYPTO_MAP).forEach(([symbol, geckoId]) => {
      if (data[geckoId]?.usd) {
        prices[symbol] = {
          price: data[geckoId].usd,
          change24h: data[geckoId].usd_24h_change || 0,
        }
      }
    })
    return prices
  } catch (err) {
    console.warn('[MarketData] CoinGecko fetch failed:', err.message)
    return {}
  }
}

// ═══════ YAHOO FINANCE — STOCKS/FOREX/ETFS ═══════
// Uses the free Yahoo Finance v8 quote endpoint
async function fetchYahooPrices() {
  try {
    const yahooSymbols = Object.values(YAHOO_SYMBOLS).join(',')
    // Yahoo Finance v8 quote API (CORS-friendly via query params)
    const resp = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbols}?interval=1d&range=1d`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }
    )

    // Yahoo v8 often has CORS issues from browser. Try v7 as fallback
    if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`)
    const data = await resp.json()

    const prices = {}
    // Parse Yahoo response
    if (data?.chart?.result) {
      data.chart.result.forEach(item => {
        const meta = item.meta
        if (meta?.regularMarketPrice) {
          // Reverse-map Yahoo symbol to our symbol
          const ourSymbol = Object.entries(YAHOO_SYMBOLS)
            .find(([_, ySym]) => ySym === meta.symbol)?.[0]
          if (ourSymbol) {
            prices[ourSymbol] = {
              price: meta.regularMarketPrice,
              change24h: meta.regularMarketPrice - (meta.previousClose || meta.regularMarketPrice),
            }
          }
        }
      })
    }
    return prices
  } catch (err) {
    console.warn('[MarketData] Yahoo Finance fetch failed:', err.message)
    // Try individual symbol fetches as fallback
    return fetchYahooIndividual()
  }
}

// Fallback: fetch each Yahoo symbol individually
async function fetchYahooIndividual() {
  const prices = {}
  const entries = Object.entries(YAHOO_SYMBOLS)

  // Batch into groups of 4 to avoid rate limits
  for (let i = 0; i < entries.length; i += 4) {
    const batch = entries.slice(i, i + 4)
    const promises = batch.map(async ([ourSymbol, yahooSymbol]) => {
      try {
        const resp = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
          { signal: AbortSignal.timeout(6000) }
        )
        if (!resp.ok) return
        const data = await resp.json()
        const meta = data?.chart?.result?.[0]?.meta
        if (meta?.regularMarketPrice) {
          prices[ourSymbol] = {
            price: meta.regularMarketPrice,
            change24h: meta.regularMarketPrice - (meta.previousClose || meta.regularMarketPrice),
          }
        }
      } catch {
        // Silent fail per symbol
      }
    })
    await Promise.all(promises)
  }
  return prices
}

// ═══════ COMBINED FETCH ═══════
export async function fetchAllPrices() {
  const now = Date.now()
  if (fetchInProgress) return cachedPrices
  if (now - lastFetchTime < FETCH_COOLDOWN && Object.keys(cachedPrices).length > 0) {
    return cachedPrices
  }

  fetchInProgress = true

  try {
    // Fetch crypto and traditional markets in parallel
    const [cryptoPrices, yahooPrices] = await Promise.all([
      fetchCryptoPrices(),
      fetchYahooPrices(),
    ])

    const merged = { ...cryptoPrices, ...yahooPrices }

    if (Object.keys(merged).length > 0) {
      cachedPrices = merged
      lastFetchTime = now
    }

    return merged
  } catch (err) {
    console.warn('[MarketData] Combined fetch error:', err.message)
    return cachedPrices
  } finally {
    fetchInProgress = false
  }
}

// ═══════ PRICE HISTORY (CoinGecko 7-day) ═══════
export async function fetchCryptoHistory(symbol, days = 7) {
  const geckoId = CRYPTO_MAP[symbol]
  if (!geckoId) return []

  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!resp.ok) return []
    const data = await resp.json()

    return (data.prices || []).map(([ts, price]) => ({
      time: ts,
      price,
      date: new Date(ts).toLocaleDateString(),
    }))
  } catch {
    return []
  }
}

// ═══════ STATUS ═══════
export function getDataStatus() {
  return {
    lastFetch: lastFetchTime ? new Date(lastFetchTime).toLocaleTimeString() : 'Never',
    cachedSymbols: Object.keys(cachedPrices).length,
    cooldownRemaining: Math.max(0, FETCH_COOLDOWN - (Date.now() - lastFetchTime)),
    isLive: Object.keys(cachedPrices).length > 0,
  }
}

// ═══════ AUTO-UPDATER HOOK HELPER ═══════
// Call this from a React useEffect to start auto-fetching
export function startAutoFetch(onUpdate, intervalMs = 30_000) {
  let running = true

  const tick = async () => {
    if (!running) return
    const prices = await fetchAllPrices()
    if (running && Object.keys(prices).length > 0) {
      onUpdate(prices)
    }
  }

  // Initial fetch
  tick()

  // Recurring
  const id = setInterval(tick, intervalMs)

  // Return cleanup function
  return () => {
    running = false
    clearInterval(id)
  }
}
