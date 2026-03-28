// ═══════════════════════════════════════════
//   12 TRIBES — AGENT INTELLIGENCE ENGINE v1.0
//   Multi-Factor Signal Fusion | Regime Detection | Trade Decision Matrix
//   Processes: News Sentiment + Price Data + Technical Signals + Macro Regime
// ═══════════════════════════════════════════

import { analyzeSentiment } from './newsIntelligenceService.js';

// ═══════ MARKET REGIME DETECTOR ═══════
// Classifies current market regime from multiple inputs

const REGIMES = {
  RISK_ON:      { label: 'Risk-On',       color: '#10B981', action: 'Full deployment — favor momentum and growth' },
  CAUTIOUS:     { label: 'Cautious',      color: '#A3E635', action: 'Selective deployment — favor quality and value' },
  NEUTRAL:      { label: 'Neutral',       color: '#F59E0B', action: 'Balanced positioning — maintain diversification' },
  RISK_OFF:     { label: 'Risk-Off',      color: '#F97316', action: 'Defensive posture — increase hedges and cash' },
  CRISIS:       { label: 'Crisis Mode',   color: '#EF4444', action: 'Capital preservation — max hedges, min exposure' },
};

export function detectRegime(composite, fearGreed, priceData) {
  let score = 50; // Start neutral

  // Factor 1: News composite (30%)
  if (composite) {
    score += (composite.score - 50) * 0.3;
  }

  // Factor 2: Fear & Greed (25%)
  if (fearGreed?.current?.value) {
    score += (fearGreed.current.value - 50) * 0.25;
  }

  // Factor 3: Price trends (25%)
  if (priceData && Object.keys(priceData).length > 0) {
    let priceScore = 0;
    let count = 0;
    Object.values(priceData).forEach(p => {
      if (p.change24h !== undefined) {
        priceScore += p.change24h > 0 ? 1 : -1;
        count++;
      }
    });
    if (count > 0) {
      score += (priceScore / count) * 12.5; // Normalized contribution
    }
  }

  // Factor 4: High-impact bearish concentration (20%)
  if (composite?.highImpactCount > 5) {
    score -= 10; // Heavy news flow is usually bearish
  }

  // Classify
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  let regime;
  if (clamped >= 70) regime = REGIMES.RISK_ON;
  else if (clamped >= 55) regime = REGIMES.CAUTIOUS;
  else if (clamped >= 45) regime = REGIMES.NEUTRAL;
  else if (clamped >= 30) regime = REGIMES.RISK_OFF;
  else regime = REGIMES.CRISIS;

  return {
    ...regime,
    score: clamped,
    factors: {
      newsSentiment: composite?.score || 50,
      fearGreed: fearGreed?.current?.value || 50,
      priceTrend: score,
    },
  };
}

// ═══════ AGENT DECISION MATRIX ═══════
// Each agent has a unique algorithm for converting intelligence into decisions

const AGENT_PROFILES = {
  viper: {
    name: 'Viper',
    role: 'Momentum & Speed',
    icon: '⚡',
    color: '#00E676',
    algorithm: 'momentum-breakout',
    riskTolerance: 0.7,    // High — aggressive entries
    newsWeight: 0.3,        // Moderate news sensitivity
    technicalWeight: 0.5,   // Heavy technical focus
    macroWeight: 0.2,       // Light macro awareness
    holdPeriod: 'minutes-hours',
    description: 'Hunts for rapid price acceleration patterns. Uses news catalysts to front-run momentum shifts. Enters fast, exits faster.',
  },
  oracle: {
    name: 'Oracle',
    role: 'Macro Intelligence',
    icon: '🔮',
    color: '#A855F7',
    algorithm: 'macro-regime',
    riskTolerance: 0.5,    // Moderate
    newsWeight: 0.5,        // Heavy news dependency
    technicalWeight: 0.2,   // Light technical
    macroWeight: 0.3,       // Heavy macro focus
    holdPeriod: 'days-weeks',
    description: 'Interprets macro trends, central bank policy, and geopolitical shifts. Positions ahead of regime changes.',
  },
  spectre: {
    name: 'Spectre',
    role: 'Options Strategy',
    icon: '👻',
    color: '#FF6B6B',
    algorithm: 'volatility-edge',
    riskTolerance: 0.4,    // Conservative per-trade
    newsWeight: 0.4,        // News drives IV
    technicalWeight: 0.3,   // Moderate
    macroWeight: 0.3,       // Moderate
    holdPeriod: 'days-expiry',
    description: 'Exploits volatility mispricing. Uses news catalysts to predict IV expansion/contraction. Sells premium in calm, buys in chaos.',
  },
  sentinel: {
    name: 'Sentinel',
    role: 'Risk Guardian',
    icon: '🛡️',
    color: '#00D4FF',
    algorithm: 'risk-defense',
    riskTolerance: 0.2,    // Ultra-conservative
    newsWeight: 0.5,        // Hyper-aware of threats
    technicalWeight: 0.2,   // Monitors support/resistance
    macroWeight: 0.3,       // Macro risk factors
    holdPeriod: 'continuous',
    description: 'Never sleeps. Monitors every position, every signal for existential risk. Can override any agent and force-close positions.',
  },
  phoenix: {
    name: 'Phoenix',
    role: 'Self-Healing',
    icon: '🔥',
    color: '#FFD93D',
    algorithm: 'recovery-adaptive',
    riskTolerance: 0.3,    // Conservative during recovery
    newsWeight: 0.35,       // Moderate
    technicalWeight: 0.4,   // Looks for bottoms
    macroWeight: 0.25,      // Moderate
    holdPeriod: 'hours-days',
    description: 'Activates after drawdowns. Deploys proven recovery strategies — DCA, mean reversion, oversold bounces.',
  },
  titan: {
    name: 'Titan',
    role: 'Position Sizing',
    icon: '🏛️',
    color: '#FF8A65',
    algorithm: 'kelly-optimal',
    riskTolerance: 0.5,    // Dynamic
    newsWeight: 0.3,        // Affects sizing
    technicalWeight: 0.3,   // Signal quality
    macroWeight: 0.4,       // Regime affects sizing
    holdPeriod: 'per-trade',
    description: 'Calculates optimal position size for every trade using Kelly Criterion, volatility scaling, and correlation-adjusted risk.',
  },
  debugger: {
    name: 'Debugger',
    role: 'Platform Stability',
    icon: '🔧',
    color: '#78909C',
    algorithm: 'anomaly-detection',
    riskTolerance: 0.0,    // Does not trade
    newsWeight: 0.0,
    technicalWeight: 0.0,
    macroWeight: 0.0,
    holdPeriod: 'continuous',
    description: '24/7 platform guardian. Monitors error rates, detects anomalies, auto-repairs failures, and ensures 99.999% uptime. Can halt trading if platform integrity is compromised.',
  },
};

export function getAgentProfiles() {
  return AGENT_PROFILES;
}

// ═══════ TRADE SIGNAL GENERATOR ═══════
// Produces actionable trade signals from intelligence fusion

export function generateTradeSignals(agentIntel, regime, composite) {
  const signals = [];

  if (!agentIntel || !regime) return signals;

  Object.entries(AGENT_PROFILES).forEach(([agentId, profile]) => {
    const intel = agentIntel[agentId];
    if (!intel || !intel.alerts || intel.alerts.length === 0) return;

    // Agent-specific signal generation
    const alerts = intel.alerts || [];
    const highImpactAlerts = alerts.filter(a => a.impact === 'high');
    const recentAlerts = alerts.slice(0, 10);

    // Calculate agent's conviction level
    let conviction = 0;
    recentAlerts.forEach(alert => {
      const weight = alert.impact === 'high' ? 3 : alert.impact === 'medium' ? 2 : 1;
      conviction += (alert.score || 0) * weight;
    });
    conviction = conviction / Math.max(recentAlerts.length, 1);

    // Regime modifier
    const regimeMultiplier = (regime.score || 50) >= 55 ? 1.2 : (regime.score || 50) >= 45 ? 1.0 : 0.7;
    conviction *= regimeMultiplier;

    // Generate signal if conviction is strong enough
    if (Math.abs(conviction) > 0.15) {
      const direction = conviction > 0 ? 'LONG' : 'SHORT';
      const strength = Math.min(1, Math.abs(conviction));

      // Get the most relevant asset class for this agent
      const assetVotes = {};
      recentAlerts.forEach(a => {
        const classes = a.assetClasses || a.sentiment?.assetClasses || [];
        classes.forEach(cls => {
          assetVotes[cls] = (assetVotes[cls] || 0) + 1;
        });
      });
      const topAsset = Object.entries(assetVotes)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';

      signals.push({
        agent: agentId,
        agentName: profile.name,
        agentIcon: profile.icon,
        agentColor: profile.color,
        direction,
        asset: topAsset,
        strength,
        conviction: conviction.toFixed(3),
        regime: regime.label,
        algorithm: profile.algorithm,
        holdPeriod: profile.holdPeriod,
        newsDrivers: highImpactAlerts.slice(0, 3).map(a => a.title),
        action: intel.signals?.[0]?.action || generateAgentDecision(agentId, direction, strength, regime),
        timestamp: Date.now(),
        urgency: intel.urgency || 'normal',
      });
    }
  });

  // Sort by strength (strongest conviction first)
  signals.sort((a, b) => b.strength - a.strength);

  return signals;
}

function generateAgentDecision(agentId, direction, strength, regime) {
  const sizing = strength > 0.7 ? 'Full Kelly' : strength > 0.4 ? 'Half Kelly' : 'Quarter Kelly';
  const isLong = direction === 'LONG';

  const decisions = {
    viper: isLong
      ? `Enter momentum long — ${sizing} — target 1.5-2% move — stop at -0.5%`
      : `Short momentum breakdown — ${sizing} — target -1.5% — stop at +0.6%`,
    oracle: isLong
      ? `Position for macro expansion — ${sizing} — scale in over 2-3 sessions`
      : `Hedge macro exposure — ${sizing} — defensive rotation initiated`,
    spectre: isLong
      ? `Sell OTM puts — collect premium on bullish bias — ${sizing}`
      : `Buy ATM puts — hedge portfolio delta — ${sizing}`,
    sentinel: isLong
      ? `Widen stop-losses 10% — allow room for upside continuation`
      : `Tighten all stops to 1.5% — reduce max drawdown tolerance`,
    phoenix: isLong
      ? `Deploy recovery capital — DCA into oversold positions — ${sizing}`
      : `Halt recovery operations — preserve remaining capital`,
    titan: isLong
      ? `Increase position limits to ${sizing} — volatility-adjusted`
      : `Reduce position limits to ${sizing} — increase cash reserve to 25%`,
  };

  return decisions[agentId] || `Execute ${direction} at ${sizing}`;
}

// ═══════ CORRELATION MATRIX ═══════
// Tracks cross-asset signal correlation for portfolio optimization

export function computeSignalCorrelation(signals) {
  const assets = [...new Set(signals.map(s => s.asset))];
  const matrix = {};

  assets.forEach(a1 => {
    matrix[a1] = {};
    assets.forEach(a2 => {
      if (a1 === a2) { matrix[a1][a2] = 1.0; return; }

      const s1 = signals.filter(s => s.asset === a1);
      const s2 = signals.filter(s => s.asset === a2);

      if (s1.length === 0 || s2.length === 0) { matrix[a1][a2] = 0; return; }

      // Simple correlation: same direction = positive, opposite = negative
      const avg1 = s1.reduce((sum, s) => sum + (s.direction === 'LONG' ? 1 : -1), 0) / s1.length;
      const avg2 = s2.reduce((sum, s) => sum + (s.direction === 'LONG' ? 1 : -1), 0) / s2.length;
      matrix[a1][a2] = parseFloat((avg1 * avg2).toFixed(2));
    });
  });

  return matrix;
}

// ═══════ RISK EVENTS CALENDAR ═══════
// Upcoming events that could impact trading

export function getUpcomingRiskEvents() {
  const now = new Date();
  const events = [
    { name: 'Core PCE Price Index', date: '2026-03-28', time: '08:30 ET', impact: 'critical', asset: 'macro', description: 'Fed\'s preferred inflation gauge — drives rate expectations' },
    { name: 'Michigan Consumer Sentiment', date: '2026-03-28', time: '10:00 ET', impact: 'high', asset: 'macro', description: 'Consumer confidence indicator — signals spending trends' },
    { name: 'Chicago PMI', date: '2026-03-31', time: '09:45 ET', impact: 'medium', asset: 'macro', description: 'Regional manufacturing activity — leading indicator' },
    { name: 'ISM Manufacturing PMI', date: '2026-04-01', time: '10:00 ET', impact: 'critical', asset: 'macro', description: 'National manufacturing health — above 50 = expansion' },
    { name: 'ADP Employment Change', date: '2026-04-02', time: '08:15 ET', impact: 'high', asset: 'macro', description: 'Private sector jobs — preview of NFP' },
    { name: 'Non-Farm Payrolls', date: '2026-04-04', time: '08:30 ET', impact: 'critical', asset: 'macro', description: 'THE jobs report — single most market-moving data point' },
    { name: 'BTC Halving Cycle Event', date: '2026-04-15', time: 'TBD', impact: 'high', asset: 'crypto', description: 'Post-halving supply dynamics — historically bullish' },
    { name: 'FOMC Rate Decision', date: '2026-05-07', time: '14:00 ET', impact: 'critical', asset: 'macro', description: 'Fed rate decision + press conference — maximum volatility event' },
    { name: 'Q1 Earnings Season Peak', date: '2026-04-14', time: 'Various', impact: 'high', asset: 'stocks', description: 'Major tech + financials reporting — drives sector rotation' },
    { name: 'OPEC+ Meeting', date: '2026-04-03', time: '10:00 ET', impact: 'high', asset: 'futures', description: 'Oil production quotas — impacts energy sector and inflation' },
    { name: 'Options Expiration (Monthly)', date: '2026-04-17', time: '16:00 ET', impact: 'high', asset: 'options', description: 'Quad witching — elevated volume and volatility' },
    { name: 'ECB Rate Decision', date: '2026-04-17', time: '08:15 ET', impact: 'high', asset: 'forex', description: 'European monetary policy — impacts EUR/USD and global yields' },
  ];

  // Filter to upcoming events and sort by date
  return events
    .filter(e => new Date(e.date) >= now || new Date(e.date).toDateString() === now.toDateString())
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(e => ({
      ...e,
      daysUntil: Math.ceil((new Date(e.date) - now) / (1000 * 60 * 60 * 24)),
      isToday: new Date(e.date).toDateString() === now.toDateString(),
      isTomorrow: new Date(e.date).toDateString() === new Date(now.getTime() + 86400000).toDateString(),
    }));
}

// ═══════ INTELLIGENCE SUMMARY ═══════
// Human-readable briefing for the operator

export function generateIntelBriefing(composite, regime, signals, fearGreed) {
  const lines = [];

  // Regime
  if (regime) {
    lines.push(`REGIME: ${regime.label} (Score: ${regime.score}/100)`);
    lines.push(`ACTION: ${regime.action}`);
    lines.push('');
  } else {
    lines.push('REGIME: Initializing...');
    lines.push('');
  }

  // Market composite
  if (composite) {
    lines.push(`NEWS PULSE: ${composite.label || 'Neutral'} — ${composite.totalNews || 0} articles analyzed`);
    const sc = composite.signalCounts || {};
    lines.push(`  Bullish: ${sc.bullish || 0} | Bearish: ${sc.bearish || 0} | Neutral: ${sc.neutral || 0}`);
    lines.push(`  High-Impact Events: ${composite.highImpactCount || 0}`);
    lines.push('');
  }

  // Fear & Greed
  if (fearGreed?.current) {
    lines.push(`FEAR & GREED: ${fearGreed.current.value}/100 (${fearGreed.current.label})`);
    lines.push('');
  }

  // Active signals
  if (signals && signals.length > 0) {
    lines.push(`ACTIVE SIGNALS: ${signals.length}`);
    signals.forEach(s => {
      lines.push(`  ${s.agentIcon} ${s.agentName}: ${s.direction} ${s.asset} (${(s.strength * 100).toFixed(0)}% conviction)`);
    });
  } else {
    lines.push('ACTIVE SIGNALS: None — agents monitoring');
  }

  return lines.join('\n');
}
