// ═══════════════════════════════════════════
//   12 TRIBES — NEWS INTELLIGENCE SERVICE v1.0
//   Live Financial News | NLP Sentiment | Multi-Source Aggregation
//   RSS feeds via rss2json.com (free, no API key required)
//   + CoinGecko trending + Fear & Greed Index
// ═══════════════════════════════════════════

// ═══════ RSS NEWS SOURCES ═══════
// All fetched through rss2json.com proxy (free tier: 10K req/day, CORS-friendly)
const RSS_SOURCES = [
  {
    id: 'reuters-business',
    name: 'Reuters',
    url: 'https://www.rss-bridge.org/bridge01/?action=display&bridge=Reuters&feed=business&format=Atom',
    fallbackUrl: 'https://news.google.com/rss/search?q=stock+market+finance&hl=en-US&gl=US&ceid=US:en',
    category: 'general',
  },
  {
    id: 'google-finance',
    name: 'Google News',
    url: 'https://news.google.com/rss/search?q=financial+markets+stocks+economy&hl=en-US&gl=US&ceid=US:en',
    category: 'general',
  },
  {
    id: 'google-crypto',
    name: 'Google Crypto',
    url: 'https://news.google.com/rss/search?q=bitcoin+ethereum+cryptocurrency+crypto+market&hl=en-US&gl=US&ceid=US:en',
    category: 'crypto',
  },
  {
    id: 'google-forex',
    name: 'Google Forex',
    url: 'https://news.google.com/rss/search?q=forex+currency+dollar+euro+interest+rate&hl=en-US&gl=US&ceid=US:en',
    category: 'forex',
  },
  {
    id: 'google-commodities',
    name: 'Google Commodities',
    url: 'https://news.google.com/rss/search?q=oil+gold+commodities+futures+market&hl=en-US&gl=US&ceid=US:en',
    category: 'commodities',
  },
  {
    id: 'google-economy',
    name: 'Google Economy',
    url: 'https://news.google.com/rss/search?q=federal+reserve+inflation+GDP+employment+economic&hl=en-US&gl=US&ceid=US:en',
    category: 'macro',
  },
  {
    id: 'google-options',
    name: 'Google Options',
    url: 'https://news.google.com/rss/search?q=options+trading+volatility+VIX+derivatives&hl=en-US&gl=US&ceid=US:en',
    category: 'options',
  },
];

// ═══════ NLP SENTIMENT ENGINE ═══════
// Keyword-based financial sentiment scoring with weighted terms

const BULLISH_TERMS = {
  // Strong bullish (weight 3)
  'surge': 3, 'soar': 3, 'skyrocket': 3, 'all-time high': 3, 'record high': 3,
  'breakout': 3, 'moon': 3, 'parabolic': 3, 'explosive growth': 3, 'massive rally': 3,
  // Medium bullish (weight 2)
  'rally': 2, 'gain': 2, 'jump': 2, 'rise': 2, 'climb': 2, 'bullish': 2, 'bull': 2,
  'upturn': 2, 'recovery': 2, 'rebound': 2, 'positive': 2, 'growth': 2, 'expand': 2,
  'upgrade': 2, 'beat expectations': 2, 'outperform': 2, 'strong earnings': 2,
  'rate cut': 2, 'dovish': 2, 'stimulus': 2, 'easing': 2, 'buying': 2, 'inflow': 2,
  'accumulation': 2, 'momentum': 2, 'upside': 2, 'boom': 2,
  // Mild bullish (weight 1)
  'up': 1, 'higher': 1, 'advance': 1, 'support': 1, 'opportunity': 1,
  'improve': 1, 'steady': 1, 'resilient': 1, 'green': 1, 'above': 1,
  'optimism': 1, 'confident': 1, 'approve': 1, 'launch': 1,
};

const BEARISH_TERMS = {
  // Strong bearish (weight 3)
  'crash': 3, 'collapse': 3, 'plunge': 3, 'freefall': 3, 'capitulation': 3,
  'black swan': 3, 'circuit breaker': 3, 'flash crash': 3, 'liquidation': 3,
  'bank run': 3, 'default': 3, 'bankruptcy': 3, 'insolvent': 3,
  // Medium bearish (weight 2)
  'sell-off': 2, 'selloff': 2, 'decline': 2, 'drop': 2, 'fall': 2, 'bearish': 2,
  'bear': 2, 'slump': 2, 'downturn': 2, 'correction': 2, 'negative': 2,
  'contraction': 2, 'recession': 2, 'downgrade': 2, 'miss expectations': 2,
  'underperform': 2, 'weak earnings': 2, 'rate hike': 2, 'hawkish': 2,
  'tightening': 2, 'outflow': 2, 'selling': 2, 'distribution': 2, 'downside': 2,
  'inflation': 2, 'tariff': 2, 'sanction': 2, 'war': 2, 'conflict': 2,
  // Mild bearish (weight 1)
  'down': 1, 'lower': 1, 'resistance': 1, 'risk': 1, 'concern': 1,
  'fear': 1, 'uncertainty': 1, 'volatile': 1, 'red': 1, 'below': 1,
  'caution': 1, 'worry': 1, 'pressure': 1, 'cut': 1, 'layoff': 1, 'loss': 1,
};

// Impact keywords — determines how much this news moves markets
const HIGH_IMPACT_TERMS = [
  'federal reserve', 'fed', 'fomc', 'interest rate', 'rate decision',
  'inflation', 'cpi', 'pce', 'gdp', 'non-farm payroll', 'nfp', 'employment',
  'earnings', 'revenue', 'profit', 'guidance', 'outlook',
  'war', 'invasion', 'sanctions', 'tariff', 'trade war',
  'crash', 'crisis', 'default', 'bankruptcy', 'bailout',
  'bitcoin', 'etf approval', 'halving', 'regulation',
  'opec', 'oil production', 'supply cut',
  'debt ceiling', 'government shutdown', 'election',
];

const MEDIUM_IMPACT_TERMS = [
  'upgrade', 'downgrade', 'analyst', 'price target',
  'ipo', 'merger', 'acquisition', 'buyback', 'dividend',
  'housing', 'consumer confidence', 'pmi', 'manufacturing',
  'yield', 'treasury', 'bond', 'dollar index',
  'sec', 'regulation', 'compliance', 'lawsuit',
];

// Asset class detection
const ASSET_TAGS = {
  stocks: ['stock', 'shares', 'equity', 'nasdaq', 's&p', 'dow', 'earnings', 'ipo', 'tech', 'apple', 'nvidia', 'microsoft', 'amazon', 'google', 'meta', 'tesla', 'jpmorgan', 'spy', 'qqq'],
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'token', 'defi', 'nft', 'solana', 'altcoin', 'binance', 'coinbase', 'stablecoin', 'halving'],
  forex: ['forex', 'currency', 'dollar', 'euro', 'yen', 'pound', 'fx', 'exchange rate', 'central bank', 'boj', 'ecb', 'boe'],
  options: ['options', 'volatility', 'vix', 'derivatives', 'calls', 'puts', 'implied volatility', 'gamma', 'delta', 'straddle', 'strangle'],
  futures: ['futures', 'commodity', 'oil', 'gold', 'silver', 'wheat', 'natural gas', 'copper', 'crude', 'wti', 'brent', 'opec'],
  macro: ['gdp', 'inflation', 'interest rate', 'federal reserve', 'employment', 'recession', 'fiscal', 'monetary policy', 'cpi', 'pce', 'payroll', 'jobs', 'treasury', 'yield curve'],
};

// Agent mapping — which agent cares about which categories
const AGENT_INTERESTS = {
  viper: ['stocks', 'crypto'],           // Momentum & speed
  oracle: ['macro', 'forex'],            // Macro intelligence
  spectre: ['options'],                   // Options strategy
  sentinel: ['macro', 'stocks', 'crypto', 'forex', 'options', 'futures'], // Risk — monitors everything
  phoenix: ['stocks', 'crypto'],         // Self-healing / recovery
  titan: ['macro', 'stocks'],            // Position sizing
};

/**
 * Analyze sentiment of a headline/article text
 * Returns: { score: -1 to 1, label: 'bullish'|'bearish'|'neutral', confidence: 0-1, impact: 'high'|'medium'|'low' }
 */
export function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  let bullScore = 0, bearScore = 0;

  Object.entries(BULLISH_TERMS).forEach(([term, weight]) => {
    if (lower.includes(term)) bullScore += weight;
  });

  Object.entries(BEARISH_TERMS).forEach(([term, weight]) => {
    if (lower.includes(term)) bearScore += weight;
  });

  const total = bullScore + bearScore;
  const netScore = total === 0 ? 0 : (bullScore - bearScore) / Math.max(total, 1);
  const confidence = Math.min(1, total / 8); // Normalize confidence

  // Impact assessment
  let impact = 'low';
  if (HIGH_IMPACT_TERMS.some(t => lower.includes(t))) impact = 'high';
  else if (MEDIUM_IMPACT_TERMS.some(t => lower.includes(t))) impact = 'medium';

  // Asset class tagging
  const assetClasses = [];
  Object.entries(ASSET_TAGS).forEach(([cls, terms]) => {
    if (terms.some(t => lower.includes(t))) assetClasses.push(cls);
  });
  if (assetClasses.length === 0) assetClasses.push('general');

  // Agent relevance
  const relevantAgents = [];
  Object.entries(AGENT_INTERESTS).forEach(([agent, interests]) => {
    if (assetClasses.some(cls => interests.includes(cls))) {
      relevantAgents.push(agent);
    }
  });

  return {
    score: Math.max(-1, Math.min(1, netScore)),
    label: netScore > 0.15 ? 'bullish' : netScore < -0.15 ? 'bearish' : 'neutral',
    confidence,
    impact,
    bullScore,
    bearScore,
    assetClasses,
    relevantAgents,
  };
}

// ═══════ RSS FETCH ENGINE ═══════

const RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json';

let newsCache = [];
let lastNewsFetch = 0;
const NEWS_COOLDOWN = 120_000; // 2 minutes between fetches
let fetchingNews = false;

async function fetchRSSFeed(source) {
  try {
    const url = `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(source.url)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      // Try fallback URL if primary fails
      if (source.fallbackUrl) {
        const fallbackResp = await fetch(
          `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(source.fallbackUrl)}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!fallbackResp.ok) return [];
        const fallbackData = await fallbackResp.json();
        return (fallbackData.items || []).map(item => normalizeNewsItem(item, source));
      }
      return [];
    }
    const data = await resp.json();
    if (data.status !== 'ok') return [];
    return (data.items || []).map(item => normalizeNewsItem(item, source));
  } catch (err) {
    console.warn(`[NewsIntel] RSS fetch failed for ${source.name}:`, err.message);
    return [];
  }
}

function normalizeNewsItem(item, source) {
  const title = (item.title || '').replace(/<[^>]+>/g, '').trim();
  const description = (item.description || '').replace(/<[^>]+>/g, '').trim();
  const fullText = `${title} ${description}`;
  const sentiment = analyzeSentiment(fullText);
  const pubDate = new Date(item.pubDate || Date.now());

  return {
    id: `${source.id}_${pubDate.getTime()}_${title.slice(0, 20)}`,
    title,
    description: description.slice(0, 280),
    source: source.name,
    sourceId: source.id,
    category: source.category,
    url: item.link || '#',
    thumbnail: item.thumbnail || item.enclosure?.link || null,
    publishedAt: pubDate.toISOString(),
    timestamp: pubDate.getTime(),
    timeAgo: getTimeAgo(pubDate),
    sentiment,
  };
}

function getTimeAgo(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Fetch all news from all RSS sources
 * Returns deduplicated, sentiment-analyzed, sorted array
 */
export async function fetchAllNews(force = false) {
  const now = Date.now();

  // Return cache if within cooldown
  if (!force && now - lastNewsFetch < NEWS_COOLDOWN && newsCache.length > 0) {
    return newsCache;
  }

  if (fetchingNews) return newsCache;
  fetchingNews = true;

  try {
    // Fetch all sources in parallel
    const results = await Promise.allSettled(
      RSS_SOURCES.map(source => fetchRSSFeed(source))
    );

    // Merge all articles
    let allNews = [];
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        allNews = allNews.concat(result.value);
      }
    });

    // Deduplicate by similar titles (fuzzy match)
    const seen = new Set();
    allNews = allNews.filter(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by recency
    allNews.sort((a, b) => b.timestamp - a.timestamp);

    // Cap at 100 items
    allNews = allNews.slice(0, 100);

    if (allNews.length > 0) {
      newsCache = allNews;
      lastNewsFetch = now;
    }

    return allNews;
  } catch (err) {
    console.warn('[NewsIntel] Fetch all news error:', err.message);
    return newsCache;
  } finally {
    fetchingNews = false;
  }
}

// ═══════ FEAR & GREED INDEX (alternative.me — free, no key) ═══════

let fearGreedCache = null;
let lastFearGreedFetch = 0;

export async function fetchFearGreedIndex() {
  const now = Date.now();
  if (now - lastFearGreedFetch < 600_000 && fearGreedCache) return fearGreedCache; // 10 min cache

  try {
    const resp = await fetch(
      'https://api.alternative.me/fng/?limit=30&format=json',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (data?.data?.length > 0) {
      const current = data.data[0];
      const history = data.data.map(d => ({
        date: new Date(parseInt(d.timestamp) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: parseInt(d.value),
        label: d.value_classification,
      })).reverse();

      fearGreedCache = {
        current: {
          value: parseInt(current.value),
          label: current.value_classification,
          timestamp: current.timestamp,
        },
        history,
      };
      lastFearGreedFetch = now;
      return fearGreedCache;
    }
    return fearGreedCache;
  } catch (err) {
    console.warn('[NewsIntel] Fear & Greed fetch failed:', err.message);
    return fearGreedCache || { current: { value: 50, label: 'Neutral' }, history: [] };
  }
}

// ═══════ COINGECKO TRENDING ═══════

let trendingCache = null;
let lastTrendingFetch = 0;

export async function fetchTrendingCoins() {
  const now = Date.now();
  if (now - lastTrendingFetch < 300_000 && trendingCache) return trendingCache; // 5 min cache

  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/search/trending',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    trendingCache = (data.coins || []).slice(0, 10).map(c => ({
      name: c.item.name,
      symbol: c.item.symbol,
      rank: c.item.market_cap_rank,
      price_btc: c.item.price_btc,
      thumb: c.item.thumb,
      score: c.item.score,
    }));
    lastTrendingFetch = now;
    return trendingCache;
  } catch (err) {
    console.warn('[NewsIntel] Trending coins fetch failed:', err.message);
    return trendingCache || [];
  }
}

// ═══════ MARKET COMPOSITE SCORE ═══════
// Aggregates all intelligence into a single market readiness score

export function computeMarketComposite(news, fearGreed) {
  if (!news || news.length === 0) {
    return {
      score: 50, label: 'Insufficient Data', signals: [], confidence: 0,
      totalNews: 0, signalCounts: { bullish: 0, bearish: 0, neutral: 0 },
      highImpactCount: 0, avgSentiment: 0, assetSignals: {},
    };
  }

  // Recent news only (last 12 hours)
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const recentNews = news.filter(n => n.timestamp > cutoff);

  // Aggregate sentiment
  let totalSentiment = 0;
  let highImpactCount = 0;
  let totalWeight = 0;

  const signalCounts = { bullish: 0, bearish: 0, neutral: 0 };
  const assetSignals = {};

  recentNews.forEach(item => {
    const s = item.sentiment;
    if (!s) return;
    const weight = s.impact === 'high' ? 3 : s.impact === 'medium' ? 2 : 1;
    totalSentiment += (s.score || 0) * weight;
    totalWeight += weight;
    if (s.label && signalCounts[s.label] !== undefined) signalCounts[s.label]++;
    if (s.impact === 'high') highImpactCount++;

    // Per-asset signals
    (s.assetClasses || []).forEach(cls => {
      if (!assetSignals[cls]) assetSignals[cls] = { bull: 0, bear: 0, count: 0 };
      assetSignals[cls].count++;
      if (s.label === 'bullish') assetSignals[cls].bull++;
      if (s.label === 'bearish') assetSignals[cls].bear++;
    });
  });

  const avgSentiment = totalWeight > 0 ? totalSentiment / totalWeight : 0;

  // Fear & Greed factor (0-100 scale → -1 to 1)
  const fgFactor = fearGreed?.current?.value
    ? (fearGreed.current.value - 50) / 50
    : 0;

  // Composite: 70% news sentiment + 30% fear/greed
  const composite = (avgSentiment * 0.7 + fgFactor * 0.3);
  const normalizedScore = Math.round(50 + composite * 50);

  // Generate signals per asset class
  const signals = Object.entries(assetSignals).map(([asset, data]) => {
    const ratio = data.count > 0 ? (data.bull - data.bear) / data.count : 0;
    return {
      asset,
      signal: ratio > 0.2 ? 'BUY' : ratio < -0.2 ? 'SELL' : 'HOLD',
      strength: Math.abs(ratio),
      bullCount: data.bull,
      bearCount: data.bear,
      totalNews: data.count,
    };
  });

  const label = normalizedScore >= 70 ? 'Strong Bullish'
    : normalizedScore >= 55 ? 'Bullish'
    : normalizedScore >= 45 ? 'Neutral'
    : normalizedScore >= 30 ? 'Bearish'
    : 'Strong Bearish';

  return {
    score: Math.max(0, Math.min(100, normalizedScore)),
    label,
    signals,
    confidence: Math.min(1, recentNews.length / 20),
    totalNews: recentNews.length,
    signalCounts,
    highImpactCount,
    avgSentiment,
    assetSignals,
  };
}

// ═══════ AGENT INTEL DISPATCHER ═══════
// Routes news to relevant agents and generates action items

export function generateAgentIntel(news) {
  const agentIntel = {
    viper: { alerts: [], signals: [], urgency: 'normal' },
    oracle: { alerts: [], signals: [], urgency: 'normal' },
    spectre: { alerts: [], signals: [], urgency: 'normal' },
    sentinel: { alerts: [], signals: [], urgency: 'normal' },
    phoenix: { alerts: [], signals: [], urgency: 'normal' },
    titan: { alerts: [], signals: [], urgency: 'normal' },
  };

  // Only process recent high/medium impact news
  const recentNews = (news || [])
    .filter(n => n.sentiment && n.sentiment.impact !== 'low')
    .slice(0, 30);

  recentNews.forEach(item => {
    const s = item.sentiment;
    if (!s || !s.relevantAgents) return;

    s.relevantAgents.forEach(agent => {
      if (!agentIntel[agent]) return;

      // Add alert
      agentIntel[agent].alerts.push({
        title: item.title,
        source: item.source,
        sentiment: s.label,
        impact: s.impact,
        score: s.score,
        assetClasses: s.assetClasses,
        timeAgo: item.timeAgo,
        timestamp: item.timestamp,
      });

      // Generate signals for high-impact items
      if (s.impact === 'high') {
        agentIntel[agent].urgency = 'elevated';

        (s.assetClasses || []).forEach(cls => {
          agentIntel[agent].signals.push({
            type: s.label === 'bullish' ? 'OPPORTUNITY' : s.label === 'bearish' ? 'RISK' : 'MONITOR',
            asset: cls,
            headline: item.title.slice(0, 80),
            confidence: s.confidence,
            action: generateAgentAction(agent, s),
          });
        });
      }
    });
  });

  // Check for critical conditions across all agents
  const bearishHighImpact = recentNews.filter(
    n => n.sentiment.label === 'bearish' && n.sentiment.impact === 'high'
  ).length;

  if (bearishHighImpact >= 3) {
    agentIntel.sentinel.urgency = 'critical';
    agentIntel.sentinel.signals.unshift({
      type: 'CRITICAL',
      asset: 'all',
      headline: `${bearishHighImpact} high-impact bearish signals detected — risk protocol activated`,
      confidence: 0.9,
      action: 'REDUCE EXPOSURE — Tighten stops, reduce position sizes, increase cash buffer',
    });
  }

  return agentIntel;
}

function generateAgentAction(agent, sentiment) {
  const actions = {
    viper: {
      bullish: 'Scan for momentum breakout entries — prioritize high-volume movers',
      bearish: 'Watch for oversold bounce opportunities — set tight stops',
      neutral: 'Reduce activity — wait for directional clarity',
    },
    oracle: {
      bullish: 'Macro environment supportive — increase allocation to risk assets',
      bearish: 'Macro headwinds detected — rotate to defensive positions',
      neutral: 'Mixed signals — maintain current macro positioning',
    },
    spectre: {
      bullish: 'Sell puts on strength — consider bull call spreads',
      bearish: 'Buy protective puts — consider bear put spreads',
      neutral: 'Sell premium — iron condors on elevated IV',
    },
    sentinel: {
      bullish: 'Lower risk threshold temporarily — allow wider stops',
      bearish: 'Raise risk threshold — tighten all stops, reduce max position size',
      neutral: 'Maintain current risk parameters',
    },
    phoenix: {
      bullish: 'Deploy recovery capital to lagging positions',
      bearish: 'Pause recovery operations — preserve capital',
      neutral: 'Continue staged recovery on existing positions',
    },
    titan: {
      bullish: 'Increase position size limits — Kelly criterion supports larger bets',
      bearish: 'Reduce position sizes — half Kelly recommended',
      neutral: 'Maintain standard position sizing',
    },
  };

  return actions[agent]?.[sentiment.label] || 'Continue monitoring';
}

// ═══════ AUTO-UPDATER ═══════
// Continuous intelligence gathering loop

export function startNewsAutoFetch(onUpdate, intervalMs = 120_000) {
  let running = true;

  const tick = async () => {
    if (!running) return;

    try {
      const [news, fearGreed, trending] = await Promise.allSettled([
        fetchAllNews(),
        fetchFearGreedIndex(),
        fetchTrendingCoins(),
      ]);

      const newsData = news.status === 'fulfilled' ? news.value : [];
      const fgData = fearGreed.status === 'fulfilled' ? fearGreed.value : null;
      const trendingData = trending.status === 'fulfilled' ? trending.value : [];

      const composite = computeMarketComposite(newsData, fgData);
      const agentIntel = generateAgentIntel(newsData);

      if (running) {
        onUpdate({
          news: newsData,
          fearGreed: fgData,
          trending: trendingData,
          composite,
          agentIntel,
          lastUpdate: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('[NewsIntel] Auto-fetch error:', err.message);
    }
  };

  // Initial fetch
  tick();

  // Recurring
  const id = setInterval(tick, intervalMs);

  return () => {
    running = false;
    clearInterval(id);
  };
}

// ═══════ NEWS STATUS ═══════
export function getNewsStatus() {
  return {
    cachedArticles: newsCache.length,
    lastFetch: lastNewsFetch ? new Date(lastNewsFetch).toLocaleTimeString() : 'Never',
    sources: RSS_SOURCES.length,
    cooldownRemaining: Math.max(0, NEWS_COOLDOWN - (Date.now() - lastNewsFetch)),
    hasFearGreed: !!fearGreedCache,
    hasTrending: !!trendingCache,
  };
}
