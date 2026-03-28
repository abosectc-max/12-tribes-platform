/**
 * adminDashboard.js
 * Admin/manager dashboard data layer for 12 Tribes AI investment platform
 *
 * Features:
 * - Group-level portfolio metrics aggregation
 * - Individual investor performance ranking
 * - Agent performance leaderboard (across all investors)
 * - Risk aggregation and metrics
 * - Trading activity summary
 * - Platform health integration
 * - Revenue/fee tracking with HWM logic
 * - Alerts and capital deployment metrics
 * - Monthly/quarterly performance reports
 */

const STORAGE_KEYS = {
  ADMIN_DATA: '12tribes_admin_data',
  HIGH_WATER_MARKS: '12tribes_hwm',
};

/**
 * Initialize or get investor data cache
 */
function getAdminDataCache() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ADMIN_DATA);
    return stored
      ? JSON.parse(stored)
      : {
          investors: [],
          agents: [],
          lastUpdated: null,
          cacheVersion: 1,
        };
  } catch (error) {
    console.error('Failed to retrieve admin data cache:', error);
    return {
      investors: [],
      agents: [],
      lastUpdated: null,
      cacheVersion: 1,
    };
  }
}

/**
 * Save admin data cache
 */
function saveAdminDataCache(cache) {
  try {
    localStorage.setItem(STORAGE_KEYS.ADMIN_DATA, JSON.stringify(cache));
  } catch (error) {
    console.error('Failed to save admin data cache:', error);
  }
}

/**
 * Get all High Water Marks
 */
function getHWMCache() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.HIGH_WATER_MARKS);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Failed to retrieve HWM:', error);
    return {};
  }
}

/**
 * Save High Water Marks
 */
function saveHWMCache(hwm) {
  try {
    localStorage.setItem(STORAGE_KEYS.HIGH_WATER_MARKS, JSON.stringify(hwm));
  } catch (error) {
    console.error('Failed to save HWM:', error);
  }
}

/**
 * Refresh admin data from investor stores
 * Aggregates all investor portfolios and agent performance
 */
function refreshAdminData() {
  const cache = getAdminDataCache();

  // Simulate loading from investor stores
  // In production, this would pull from actual investor storage or API
  const investorIds = getAllInvestorIds();
  const aggregatedAgents = [];
  const investorMetrics = [];

  investorIds.forEach(investorId => {
    const investorData = getInvestorMetrics(investorId);
    investorMetrics.push(investorData);

    // Aggregate agent data
    if (investorData.agents && Array.isArray(investorData.agents)) {
      investorData.agents.forEach(agent => {
        const existing = aggregatedAgents.find(a => a.agentId === agent.agentId);
        if (existing) {
          existing.trades += agent.trades;
          existing.volume += agent.volume;
          existing.wins += agent.wins;
          existing.losses += agent.losses;
          existing.profitFactor = existing.profitFactor || 0;
        } else {
          aggregatedAgents.push({ ...agent, investorId });
        }
      });
    }
  });

  cache.investors = investorMetrics;
  cache.agents = aggregatedAgents;
  cache.lastUpdated = new Date().toISOString();
  saveAdminDataCache(cache);

  return cache;
}

/**
 * Get all investor IDs from storage
 */
function getAllInvestorIds() {
  // Simulates retrieving list of investors
  // In production, would be persisted list
  try {
    const stored = localStorage.getItem('12tribes_investor_list');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Get metrics for a single investor
 */
function getInvestorMetrics(investorId) {
  try {
    const stored = localStorage.getItem(`12tribes_investor_${investorId}`);
    return stored
      ? JSON.parse(stored)
      : {
          investorId,
          name: 'Unknown Investor',
          aum: 0,
          pnl: 0,
          return: 0,
          agents: [],
        };
  } catch {
    return {
      investorId,
      name: 'Unknown Investor',
      aum: 0,
      pnl: 0,
      return: 0,
      agents: [],
    };
  }
}

/**
 * Get group-level overview
 * @returns {Object} { totalAUM, totalPnL, totalReturn, investorCount, avgReturn }
 */
export function getGroupOverview() {
  const cache = getAdminDataCache();

  if (!cache.investors || cache.investors.length === 0) {
    return {
      totalAUM: 0,
      totalPnL: 0,
      totalReturn: 0,
      investorCount: 0,
      avgReturn: 0,
      groupSharpe: 0,
    };
  }

  const totalAUM = cache.investors.reduce((sum, inv) => sum + (inv.aum || 0), 0);
  const totalPnL = cache.investors.reduce((sum, inv) => sum + (inv.pnl || 0), 0);
  const avgReturn =
    cache.investors.reduce((sum, inv) => sum + (inv.return || 0), 0) /
    cache.investors.length;
  const totalReturn = totalAUM > 0 ? (totalPnL / totalAUM) * 100 : 0;

  return {
    totalAUM,
    totalPnL,
    totalReturn,
    investorCount: cache.investors.length,
    avgReturn,
    groupSharpe: calculateGroupSharpe(cache.investors),
  };
}

/**
 * Calculate group Sharpe ratio
 */
function calculateGroupSharpe(investors) {
  if (investors.length === 0) return 0;
  const returns = investors.map(inv => inv.return || 0);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const riskFreeRate = 0.02; // 2% annual risk-free rate
  return stdDev > 0 ? (mean - riskFreeRate) / stdDev : 0;
}

/**
 * Get investor rankings by return
 * @returns {Array} Investors sorted by return (descending)
 */
export function getInvestorRankings() {
  const cache = getAdminDataCache();
  const rankings = [...(cache.investors || [])];

  rankings.sort((a, b) => (b.return || 0) - (a.return || 0));

  return rankings.map((inv, index) => ({
    rank: index + 1,
    ...inv,
  }));
}

/**
 * Get agent performance leaderboard across all investors
 * @returns {Array} Agents sorted by performance metrics
 */
export function getAgentPerformanceAll() {
  const cache = getAdminDataCache();
  const agents = [...(cache.agents || [])];

  // Calculate performance score
  agents.forEach(agent => {
    const winRate = agent.trades > 0 ? agent.wins / agent.trades : 0;
    const profitFactor = agent.losses > 0 ? agent.wins / agent.losses : agent.wins > 0 ? 10 : 0;
    agent.performanceScore = winRate * 0.6 + Math.min(profitFactor / 10, 1) * 0.4;
  });

  agents.sort((a, b) => (b.performanceScore || 0) - (a.performanceScore || 0));

  return agents.map((agent, index) => ({
    rank: index + 1,
    ...agent,
  }));
}

/**
 * Get group-wide risk metrics
 * @returns {Object} { groupVaR, maxDrawdown, concentrationRisk, sharpe }
 */
export function getGroupRiskMetrics() {
  const cache = getAdminDataCache();

  if (!cache.investors || cache.investors.length === 0) {
    return {
      groupVaR: 0,
      maxDrawdown: 0,
      concentrationRisk: 0,
      sharpe: 0,
    };
  }

  const overview = getGroupOverview();
  const drawdowns = cache.investors
    .map(inv => inv.maxDrawdown || 0)
    .sort((a, b) => a - b);

  // VaR (95% confidence) - simplified
  const varIndex = Math.floor(cache.investors.length * 0.05);
  const groupVaR = varIndex >= 0 ? drawdowns[varIndex] : 0;

  // Max drawdown
  const maxDrawdown = Math.min(...drawdowns);

  // Concentration risk (Herfindahl index)
  const totalAUM = overview.totalAUM;
  let concentrationRisk = 0;
  if (totalAUM > 0) {
    cache.investors.forEach(inv => {
      const weight = (inv.aum || 0) / totalAUM;
      concentrationRisk += weight * weight;
    });
  }

  return {
    groupVaR,
    maxDrawdown,
    concentrationRisk,
    sharpe: overview.groupSharpe,
  };
}

/**
 * Get trading activity summary
 * @param {number} days - Number of days to summarize
 * @returns {Object} Trading metrics
 */
export function getTradingActivity(days = 30) {
  const cache = getAdminDataCache();
  const agents = cache.agents || [];

  const totalTrades = agents.reduce((sum, agent) => sum + (agent.trades || 0), 0);
  const totalVolume = agents.reduce((sum, agent) => sum + (agent.volume || 0), 0);

  const topAgents = [...agents]
    .sort((a, b) => (b.trades || 0) - (a.trades || 0))
    .slice(0, 5);

  const symbols = {};
  agents.forEach(agent => {
    if (agent.topSymbols && Array.isArray(agent.topSymbols)) {
      agent.topSymbols.forEach(sym => {
        symbols[sym] = (symbols[sym] || 0) + 1;
      });
    }
  });

  const topSymbols = Object.entries(symbols)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  return {
    period: `Last ${days} days`,
    tradesPerDay: totalTrades / days,
    totalTrades,
    totalVolume,
    averageTradeSize: totalTrades > 0 ? totalVolume / totalTrades : 0,
    topAgents,
    topSymbols,
    volumeByAsset: calculateVolumeByAsset(agents),
  };
}

/**
 * Calculate volume by asset class
 */
function calculateVolumeByAsset(agents) {
  const assetClasses = {
    equities: 0,
    options: 0,
    futures: 0,
    crypto: 0,
    other: 0,
  };

  agents.forEach(agent => {
    if (agent.assetClass) {
      assetClasses[agent.assetClass] = (assetClasses[agent.assetClass] || 0) + (agent.volume || 0);
    }
  });

  return assetClasses;
}

/**
 * Calculate management fees for a period
 * 2% per year on AUM
 * @param {string} period - 'month', 'quarter', 'year'
 * @returns {Object} Fee amounts per investor
 */
export function calculateManagementFees(period = 'month') {
  const cache = getAdminDataCache();
  const investors = cache.investors || [];
  const periodMultipliers = {
    month: 1 / 12,
    quarter: 1 / 4,
    year: 1,
  };
  const multiplier = periodMultipliers[period] || 1 / 12;
  const annualRate = 0.02; // 2%

  const fees = {};
  let totalFees = 0;

  investors.forEach(inv => {
    const fee = (inv.aum || 0) * annualRate * multiplier;
    fees[inv.investorId] = {
      investorName: inv.name,
      aum: inv.aum,
      fee,
    };
    totalFees += fee;
  });

  return {
    period,
    fees,
    totalFees,
    rate: `${annualRate * 100}% per annum`,
  };
}

/**
 * Calculate performance fees with HWM logic
 * 20% of profits above High Water Mark
 * @param {string} period - 'month', 'quarter', 'year'
 * @returns {Object} Performance fees per investor
 */
export function calculatePerformanceFees(period = 'month') {
  const cache = getAdminDataCache();
  const investors = cache.investors || [];
  const hwmCache = getHWMCache();
  const performanceFeeRate = 0.20; // 20%

  const fees = {};
  let totalFees = 0;

  investors.forEach(inv => {
    const investorId = inv.investorId;
    const currentPnL = inv.pnl || 0;
    const hwm = hwmCache[investorId] || 0;

    // Only charge fee on gains above HWM
    const profitableGains = Math.max(0, currentPnL - hwm);
    const fee = profitableGains > 0 ? profitableGains * performanceFeeRate : 0;

    fees[investorId] = {
      investorName: inv.name,
      currentPnL,
      highWaterMark: hwm,
      profitableGains,
      fee,
    };
    totalFees += fee;

    // Update HWM if new high reached
    if (currentPnL > hwm) {
      hwmCache[investorId] = currentPnL;
    }
  });

  saveHWMCache(hwmCache);

  return {
    period,
    fees,
    totalFees,
    rate: `${performanceFeeRate * 100}% above HWM`,
  };
}

/**
 * Get High Water Marks per investor
 * @returns {Object} HWM values keyed by investorId
 */
export function getHighWaterMarks() {
  return getHWMCache();
}

/**
 * Get capital deployment metrics
 * @returns {Object} Deployed vs cash, by asset class
 */
export function getCapitalDeployment() {
  const cache = getAdminDataCache();
  const investors = cache.investors || [];

  let totalDeployed = 0;
  let totalCash = 0;
  const byAssetClass = {
    equities: 0,
    options: 0,
    futures: 0,
    crypto: 0,
    other: 0,
  };

  investors.forEach(inv => {
    totalDeployed += inv.deployed || 0;
    totalCash += inv.cash || 0;

    if (inv.positionsByAsset) {
      Object.entries(inv.positionsByAsset).forEach(([asset, value]) => {
        byAssetClass[asset] = (byAssetClass[asset] || 0) + value;
      });
    }
  });

  const totalAUM = getGroupOverview().totalAUM;
  const deploymentRatio = totalAUM > 0 ? (totalDeployed / totalAUM) * 100 : 0;

  return {
    deployed: totalDeployed,
    cash: totalCash,
    total: totalDeployed + totalCash,
    deploymentRatio,
    byAssetClass,
  };
}

/**
 * Get admin-level alerts
 * @returns {Array} Actionable alerts
 */
export function getAdminAlerts() {
  const cache = getAdminDataCache();
  const alerts = [];

  const investors = cache.investors || [];
  const overview = getGroupOverview();
  const riskMetrics = getGroupRiskMetrics();

  // Check for investors exceeding drawdown limits
  investors.forEach(inv => {
    if (inv.maxDrawdown && inv.maxDrawdown < -0.2) {
      // 20% drawdown threshold
      alerts.push({
        id: `alert_drawdown_${inv.investorId}`,
        severity: 'warning',
        title: 'Investor Drawdown Exceeded',
        message: `${inv.name} has exceeded 20% drawdown limit (current: ${(inv.maxDrawdown * 100).toFixed(2)}%)`,
        timestamp: new Date().toISOString(),
        investorId: inv.investorId,
      });
    }
  });

  // Check for group concentration risk
  if (riskMetrics.concentrationRisk > 0.3) {
    alerts.push({
      id: 'alert_concentration',
      severity: 'warning',
      title: 'High Concentration Risk',
      message: `Group concentration index is high: ${(riskMetrics.concentrationRisk * 100).toFixed(2)}%`,
      timestamp: new Date().toISOString(),
    });
  }

  // Check for underperforming agents
  const agents = cache.agents || [];
  agents.forEach(agent => {
    if (agent.performanceScore !== undefined && agent.performanceScore < 0.3) {
      alerts.push({
        id: `alert_agent_${agent.agentId}`,
        severity: 'info',
        title: 'Agent Underperformance',
        message: `Agent ${agent.agentId} has low performance score: ${(agent.performanceScore * 100).toFixed(2)}%`,
        timestamp: new Date().toISOString(),
        agentId: agent.agentId,
      });
    }
  });

  return alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * Get monthly performance report data
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Object} Complete monthly report
 */
export function getMonthlyReport(month, year) {
  const overview = getGroupOverview();
  const rankings = getInvestorRankings();
  const tradingActivity = getTradingActivity(30);
  const managementFees = calculateManagementFees('month');
  const performanceFees = calculatePerformanceFees('month');
  const riskMetrics = getGroupRiskMetrics();
  const alerts = getAdminAlerts();

  return {
    period: `${month}/${year}`,
    generatedAt: new Date().toISOString(),
    groupOverview: overview,
    investorRankings: rankings,
    tradingActivity,
    managementFees,
    performanceFees,
    riskMetrics,
    topPerformingAgent: getAgentPerformanceAll()[0],
    systemAlerts: alerts.filter(a => a.severity === 'warning'),
    summary: {
      bestPerformer: rankings[0],
      worstPerformer: rankings[rankings.length - 1],
      totalFeesGenerated: managementFees.totalFees + performanceFees.totalFees,
    },
  };
}

/**
 * Get deep dive on a single investor
 * @param {string} investorId - Investor ID
 * @returns {Object} Detailed investor metrics
 */
export function getInvestorDetail(investorId) {
  const investorData = getInvestorMetrics(investorId);
  const hwmCache = getHWMCache();
  const hwm = hwmCache[investorId] || 0;

  // Calculate investor-specific risk metrics
  const positionCount = investorData.positions ? investorData.positions.length : 0;
  const topPosition = investorData.positions
    ? investorData.positions.reduce((prev, current) =>
        (prev.value || 0) > (current.value || 0) ? prev : current
      )
    : null;

  return {
    ...investorData,
    highWaterMark: hwm,
    gainsSinceHWM: investorData.pnl - hwm,
    positionCount,
    largestPosition: topPosition,
    riskProfile: {
      maxDrawdown: investorData.maxDrawdown || 0,
      volatility: investorData.volatility || 0,
      var95: investorData.var95 || 0,
    },
    agentCount: investorData.agents ? investorData.agents.length : 0,
    assetAllocation: investorData.assetAllocation || {},
  };
}

/**
 * Force refresh of admin data
 */
export function refreshAdminDashboard() {
  return refreshAdminData();
}

/**
 * Update investor in admin cache (mock data sync)
 */
export function syncInvestorData(investorId, investorData) {
  const cache = getAdminDataCache();
  const idx = cache.investors.findIndex(inv => inv.investorId === investorId);

  if (idx >= 0) {
    cache.investors[idx] = { ...cache.investors[idx], ...investorData };
  } else {
    cache.investors.push({ investorId, ...investorData });
  }

  cache.lastUpdated = new Date().toISOString();
  saveAdminDataCache(cache);
}
