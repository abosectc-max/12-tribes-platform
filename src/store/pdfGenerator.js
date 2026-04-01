/**
 * PDF Generator Service
 * Generates printable HTML documents for investment statements, trade confirmations, and tax reports
 * Uses window.print() for PDF creation (no external libraries)
 */

/**
 * Generate a professional monthly performance statement
 * @param {object} statementData - Real statement data from API
 * @param {string} statementData.month - "March 2026"
 * @param {number} statementData.startValue - Opening balance
 * @param {number} statementData.endValue - Closing balance
 * @param {number} statementData.pnl - Realized PnL
 * @param {number} statementData.returnPct - Return percentage
 * @param {Array} statementData.trades - Trades executed this month
 * @param {object} statementData.agentPerformance - Per-agent stats
 * @param {string} statementData.investorName - Investor name
 * @param {string} statementData.investorId - Investor ID
 * @param {number} statementData.year - Year
 * @param {number} statementData.monthNum - Month number 1-12
 * @returns {string} HTML document string
 */
export function generateMonthlyStatement(statementData) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const month = statementData.monthNum || 1;
  const year = statementData.year || new Date().getFullYear();
  const monthName = monthNames[month - 1];
  const startDate = new Date(year, month - 1, 1).toLocaleDateString();
  const endDate = new Date(year, month, 0).toLocaleDateString();

  const totalReturn = statementData.pnl || 0;
  const statement = {
    investorName: statementData.investorName || 'Investor',
    investorId: statementData.investorId || '',
    openingBalance: statementData.startValue || 0,
    closingBalance: statementData.endValue || 0,
    totalReturn,
    returnPercentage: statementData.returnPct || 0,
    totalFees: 0,
    performanceFee: 0,
    platformFee: 0,
    trades: (statementData.trades || []).map(t => ({
      date: t.date ? new Date(t.date).toLocaleDateString() : '',
      symbol: t.symbol || '',
      type: t.side || 'BUY',
      quantity: t.quantity || 0,
      price: t.closePrice || t.entryPrice || 0,
      value: Math.abs(t.pnl || 0),
      agent: t.agent || 'Auto',
    })),
    aiPerformance: statementData.agentPerformance || {},
    riskMetrics: {
      maxDrawdown: statementData.maxDrawdown || 0,
      sharpeRatio: statementData.sharpeRatio || 0,
      volatility: statementData.volatility || 0,
      beta: statementData.beta || 0,
    },
    allocation: statementData.allocation || { stocks: 0, bonds: 0, cash: 0 },
  };

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>12 Tribes - Monthly Statement ${monthName} ${year}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
      color: #333;
      line-height: 1.6;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px;
    }

    .header {
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
      color: #ffffff;
      padding: 40px;
      margin: -40px -40px 40px -40px;
      border-bottom: 3px solid #00D4FF;
    }

    .header h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 10px;
      color: #00D4FF;
    }

    .header p {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.7);
    }

    .statement-header {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-bottom: 40px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .stat-box {
      padding: 15px;
    }

    .stat-label {
      font-size: 12px;
      color: #666;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 5px;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #0a0a1a;
    }

    .stat-value.positive {
      color: #00FF00;
    }

    .stat-value.negative {
      color: #FF0000;
    }

    .section {
      margin-bottom: 40px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #0a0a1a;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #00D4FF;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }

    thead {
      background: #f0f0f0;
    }

    th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #333;
      font-size: 12px;
      text-transform: uppercase;
      border-bottom: 2px solid #ddd;
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid #eee;
      font-size: 13px;
    }

    tbody tr:hover {
      background: #f9f9f9;
    }

    .text-right {
      text-align: right;
    }

    .text-center {
      text-align: center;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }

    .summary-card {
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #00D4FF;
    }

    .summary-card h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 10px;
      text-transform: uppercase;
    }

    .summary-card p {
      font-size: 20px;
      font-weight: 700;
      color: #0a0a1a;
    }

    .allocation-chart {
      display: flex;
      height: 30px;
      margin: 20px 0;
      border-radius: 4px;
      overflow: hidden;
    }

    .allocation-segment {
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 12px;
    }

    .segment-stocks { background: #00D4FF; width: 65%; }
    .segment-bonds { background: #FFD700; width: 20%; }
    .segment-cash { background: #90EE90; width: 15%; color: #333; }

    .allocation-legend {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 10px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
    }

    .legend-color {
      width: 20px;
      height: 20px;
      border-radius: 4px;
    }

    .risk-metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }

    .metric-item {
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .metric-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 5px;
    }

    .metric-value {
      font-size: 22px;
      font-weight: 700;
      color: #0a0a1a;
    }

    .disclaimer {
      background: #fff3cd;
      padding: 20px;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      margin-top: 30px;
      font-size: 11px;
      color: #333;
    }

    .disclaimer-title {
      font-weight: 700;
      margin-bottom: 10px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 11px;
      color: #999;
    }

    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      .container {
        padding: 20px;
      }
      .header {
        margin: -20px -20px 20px -20px;
      }
      .section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>12 TRIBES AI INVESTMENT GROUP</h1>
      <p>Monthly Performance Statement</p>
    </div>

    <div class="statement-header">
      <div class="stat-box">
        <div class="stat-label">Opening Balance</div>
        <div class="stat-value">$${statement.openingBalance.toLocaleString()}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Closing Balance</div>
        <div class="stat-value">$${statement.closingBalance.toLocaleString()}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Total Return</div>
        <div class="stat-value positive">+${statement.totalReturn.toLocaleString()} (${statement.returnPercentage}%)</div>
      </div>
    </div>

    <div style="margin-bottom: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
      <p><strong>Period:</strong> ${monthName} 1 - ${monthName} 31, ${year} | <strong>Investor ID:</strong> ${investorId}</p>
      <p><strong>Investor:</strong> ${statement.investorName}</p>
    </div>

    <!-- PERFORMANCE OVERVIEW -->
    <div class="section">
      <h2 class="section-title">Performance Overview</h2>
      <div class="summary-grid">
        <div class="summary-card">
          <h3>Monthly Return</h3>
          <p class="positive">+${statement.returnPercentage}%</p>
        </div>
        <div class="summary-card">
          <h3>Total Fees</h3>
          <p>-$${statement.totalFees}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Fee Type</th>
            <th class="text-right">Amount</th>
            <th class="text-right">Percentage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Performance Fee (20% on gains)</td>
            <td class="text-right">$${statement.performanceFee}</td>
            <td class="text-right">${(statement.performanceFee / statement.totalReturn * 100).toFixed(2)}%</td>
          </tr>
          <tr>
            <td>Platform Fee</td>
            <td class="text-right">$${statement.platformFee}</td>
            <td class="text-right">${(statement.platformFee / statement.totalFees * 100).toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- TRADE SUMMARY -->
    <div class="section">
      <h2 class="section-title">Trade Summary</h2>
      <p style="margin-bottom: 15px; color: #666;">Total Trades: ${statement.trades.length}</p>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Type</th>
            <th class="text-right">Quantity</th>
            <th class="text-right">Price</th>
            <th class="text-right">Value</th>
            <th>AI Agent</th>
          </tr>
        </thead>
        <tbody>
          ${statement.trades.map(trade => `
            <tr>
              <td>${trade.date}</td>
              <td><strong>${trade.symbol}</strong></td>
              <td><span style="padding: 4px 8px; background: ${trade.type === 'BUY' ? '#e8f5e9' : '#ffebee'}; border-radius: 4px; color: ${trade.type === 'BUY' ? '#2e7d32' : '#c62828'};">${trade.type}</span></td>
              <td class="text-right">${trade.quantity}</td>
              <td class="text-right">$${trade.price.toFixed(2)}</td>
              <td class="text-right">$${trade.value.toLocaleString()}</td>
              <td>${trade.agent}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- AI AGENT PERFORMANCE -->
    <div class="section">
      <h2 class="section-title">AI Agent Performance</h2>

      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th class="text-right">Total Trades</th>
            <th class="text-right">Win Rate</th>
            <th class="text-right">Avg Return</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(statement.aiPerformance).map(([agent, stats]) => `
            <tr>
              <td><strong>${agent.charAt(0).toUpperCase() + agent.slice(1)}</strong></td>
              <td class="text-right">${stats.trades}</td>
              <td class="text-right">${stats.winRate}%</td>
              <td class="text-right text-green">${stats.avgReturn}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- PORTFOLIO ALLOCATION -->
    <div class="section">
      <h2 class="section-title">Portfolio Allocation</h2>

      <div class="allocation-chart">
        <div class="allocation-segment segment-stocks">${statement.allocation.stocks}% Stocks</div>
        <div class="allocation-segment segment-bonds">${statement.allocation.bonds}% Bonds</div>
        <div class="allocation-segment segment-cash">${statement.allocation.cash}% Cash</div>
      </div>

      <div class="allocation-legend">
        <div class="legend-item">
          <div class="legend-color" style="background: #00D4FF;"></div>
          <span>Equities: ${statement.allocation.stocks}%</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #FFD700;"></div>
          <span>Fixed Income: ${statement.allocation.bonds}%</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #90EE90;"></div>
          <span>Cash: ${statement.allocation.cash}%</span>
        </div>
      </div>
    </div>

    <!-- RISK METRICS -->
    <div class="section">
      <h2 class="section-title">Risk Metrics</h2>

      <div class="risk-metrics">
        <div class="metric-item">
          <div class="metric-label">Max Drawdown</div>
          <div class="metric-value negative">${statement.riskMetrics.maxDrawdown}%</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Sharpe Ratio</div>
          <div class="metric-value">${statement.riskMetrics.sharpeRatio}</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Volatility (Annual)</div>
          <div class="metric-value">${statement.riskMetrics.volatility}%</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Beta vs S&P 500</div>
          <div class="metric-value">${statement.riskMetrics.beta}</div>
        </div>
      </div>
    </div>

    <!-- DISCLAIMER -->
    <div class="disclaimer">
      <div class="disclaimer-title">IMPORTANT DISCLOSURE</div>
      <p>This statement reflects simulated/virtual trading activity on the 12 Tribes AI Investment Platform. This is NOT a real brokerage statement. All returns shown are hypothetical and for educational purposes only. Past performance is not indicative of future results. The platform uses virtual currency and AI-generated trading signals that may not reflect real market conditions. Users should consult a qualified financial advisor before making real investment decisions. See Terms & Conditions for full disclosures.</p>
    </div>

    <div class="footer">
      <p>12 Tribes AI Investment Group | Confidential | Generated ${new Date().toLocaleDateString()}</p>
      <p>This document is generated automatically and does not require a signature.</p>
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Generate a single trade confirmation document
 * @param {object} trade - Trade object { symbol, type, quantity, price, date, tradeId, agent }
 * @returns {string} HTML document string
 */
export function generateTradeConfirmation(trade) {
  const tradeDate = new Date(trade.date);
  const confirmationNumber = `TC-${Date.now().toString().slice(-8)}`;
  const value = trade.quantity * trade.price;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Trade Confirmation - ${confirmationNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: white;
      color: #333;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      padding: 40px;
    }
    .header {
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
      color: white;
      padding: 30px;
      margin: -40px -40px 40px -40px;
      border-bottom: 3px solid #00D4FF;
    }
    .header h1 {
      font-size: 28px;
      color: #00D4FF;
      margin-bottom: 5px;
    }
    .header p {
      font-size: 13px;
      color: rgba(255,255,255,0.7);
    }
    .confirmation-num {
      background: rgba(0, 212, 255, 0.1);
      padding: 15px;
      margin-bottom: 30px;
      border-left: 4px solid #00D4FF;
      border-radius: 4px;
    }
    .confirmation-num strong {
      color: #00D4FF;
    }
    .trade-details {
      background: #f8f9fa;
      padding: 25px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .detail-row {
      display: grid;
      grid-template-columns: 200px 1fr;
      margin-bottom: 15px;
      gap: 20px;
    }
    .detail-label {
      font-weight: 600;
      color: #666;
      font-size: 12px;
      text-transform: uppercase;
    }
    .detail-value {
      font-size: 16px;
      color: #0a0a1a;
      font-weight: 500;
    }
    .symbol {
      font-size: 32px;
      font-weight: 700;
      color: #00D4FF;
    }
    .type-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      margin: 5px 0;
    }
    .type-badge.buy {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .type-badge.sell {
      background: #ffebee;
      color: #c62828;
    }
    .summary {
      background: white;
      border: 2px solid #00D4FF;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .summary-line {
      display: grid;
      grid-template-columns: 1fr auto;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
    }
    .summary-line:last-child {
      border-bottom: none;
    }
    .summary-total {
      display: grid;
      grid-template-columns: 1fr auto;
      font-size: 18px;
      font-weight: 700;
      color: #0a0a1a;
      padding-top: 10px;
      border-top: 2px solid #00D4FF;
    }
    .disclaimer {
      background: #fff3cd;
      padding: 15px;
      border-radius: 4px;
      font-size: 11px;
      color: #333;
      border-left: 4px solid #ffc107;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 11px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TRADE CONFIRMATION</h1>
      <p>12 Tribes AI Investment Platform</p>
    </div>

    <div class="confirmation-num">
      <strong>Confirmation #:</strong> ${confirmationNumber}
    </div>

    <div class="trade-details">
      <div style="margin-bottom: 25px;">
        <div class="symbol">${trade.symbol}</div>
        <span class="type-badge ${trade.type.toLowerCase()}">${trade.type}</span>
      </div>

      <div class="detail-row">
        <div class="detail-label">Trade Date</div>
        <div class="detail-value">${tradeDate.toLocaleDateString()}</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">Quantity</div>
        <div class="detail-value">${trade.quantity.toLocaleString()} shares</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">Price per Share</div>
        <div class="detail-value">$${trade.price.toFixed(2)}</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">AI Agent</div>
        <div class="detail-value">${trade.agent || 'System'}</div>
      </div>
    </div>

    <div class="summary">
      <div class="summary-line">
        <span>Subtotal (${trade.quantity} × $${trade.price.toFixed(2)})</span>
        <span>$${value.toFixed(2)}</span>
      </div>
      <div class="summary-line">
        <span>Commission</span>
        <span>$0.00</span>
      </div>
      <div class="summary-total">
        <span>Total Value</span>
        <span>$${value.toFixed(2)}</span>
      </div>
    </div>

    <div class="disclaimer">
      <strong>Virtual Trading Disclaimer:</strong> This is a simulated trade executed on the 12 Tribes AI Investment Platform using virtual currency. This confirmation is for informational and educational purposes only. No real funds or securities are involved. Virtual trading results may not reflect real market conditions.
    </div>

    <div class="footer">
      <p>12 Tribes AI Investment Group | Simulated Trading Platform</p>
      <p>For support, contact: support@12tribes.ai</p>
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Generate annual tax report
 * @param {string} investorId - Investor identifier
 * @param {number} year - Tax year
 * @returns {string} HTML document string
 */
export function generateTaxReport(taxDataInput) {
  const investorId = taxDataInput.investorId || '';
  const year = taxDataInput.year || new Date().getFullYear();
  const taxData = {
    investorId,
    year,
    realizedGains: taxDataInput.realizedGains || { shortTerm: 0, longTerm: 0, total: 0 },
    realizedLosses: taxDataInput.realizedLosses || { shortTerm: 0, longTerm: 0, total: 0 },
    netGain: taxDataInput.netGain || 0,
    fees: taxDataInput.fees || 0,
    washSales: taxDataInput.washSales || [],
    positions: taxDataInput.positions || { longTerm: 0, shortTerm: 0 },
  };

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Annual Tax Report ${year}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: white;
      color: #333;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px;
    }
    .header {
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
      color: white;
      padding: 40px;
      margin: -40px -40px 40px -40px;
      border-bottom: 3px solid #00D4FF;
    }
    .header h1 {
      font-size: 32px;
      color: #00D4FF;
      margin-bottom: 10px;
    }
    .section {
      margin-bottom: 40px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #0a0a1a;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #00D4FF;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-box {
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #00D4FF;
    }
    .summary-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .summary-value {
      font-size: 24px;
      font-weight: 700;
      color: #0a0a1a;
    }
    .summary-value.positive {
      color: #00FF00;
    }
    .summary-value.negative {
      color: #FF0000;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th {
      background: #f0f0f0;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #ddd;
      font-size: 12px;
      text-transform: uppercase;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #eee;
    }
    .text-right {
      text-align: right;
    }
    .disclaimer {
      background: #fff3cd;
      padding: 20px;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      margin-top: 30px;
      font-size: 11px;
      color: #333;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ANNUAL TAX REPORT ${year}</h1>
      <p>12 Tribes AI Investment Platform | Investor ID: ${investorId}</p>
    </div>

    <div class="section">
      <h2 class="section-title">Capital Gains Summary</h2>

      <div class="summary-grid">
        <div class="summary-box">
          <div class="summary-label">Total Realized Gains</div>
          <div class="summary-value positive">+$${taxData.realizedGains.total.toLocaleString()}</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Total Realized Losses</div>
          <div class="summary-value negative">-$${Math.abs(taxData.realizedLosses.total).toLocaleString()}</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Net Capital Gain</div>
          <div class="summary-value positive">+$${taxData.netGain.toLocaleString()}</div>
        </div>
        <div class="summary-box">
          <div class="summary-label">Fees & Commissions</div>
          <div class="summary-value">-$${taxData.fees.toLocaleString()}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Gains Detail</h2>

      <table>
        <thead>
          <tr>
            <th>Holding Period</th>
            <th class="text-right">Gains</th>
            <th class="text-right">Losses</th>
            <th class="text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Short-term (< 1 year)</td>
            <td class="text-right">${taxData.realizedGains.shortTerm.toLocaleString()}</td>
            <td class="text-right">${taxData.realizedLosses.shortTerm}</td>
            <td class="text-right">${(taxData.realizedGains.shortTerm + taxData.realizedLosses.shortTerm).toLocaleString()}</td>
          </tr>
          <tr>
            <td>Long-term (≥ 1 year)</td>
            <td class="text-right">${taxData.realizedGains.longTerm.toLocaleString()}</td>
            <td class="text-right">${taxData.realizedLosses.longTerm}</td>
            <td class="text-right">${(taxData.realizedGains.longTerm + taxData.realizedLosses.longTerm).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2 class="section-title">Wash Sale Adjustments</h2>

      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Adjusted Basis</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${taxData.washSales.map(ws => `
            <tr>
              <td><strong>${ws.symbol}</strong></td>
              <td class="text-right">$${ws.adjustedBasis}</td>
              <td>${ws.date}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p style="font-size: 12px; color: #666; margin-top: 10px;">Wash sale rules have been applied to adjust cost basis where necessary. Disallowed losses are deferred to adjusted basis.</p>
    </div>

    <div class="section">
      <h2 class="section-title">Position Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th class="text-right">Count</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Long-term Positions (closed)</td>
            <td class="text-right">${taxData.positions.longTerm}</td>
          </tr>
          <tr>
            <td>Short-term Positions (closed)</td>
            <td class="text-right">${taxData.positions.shortTerm}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="disclaimer">
      <strong>IMPORTANT TAX DISCLAIMER:</strong> This tax report is generated from simulated trading activity on the 12 Tribes AI Investment Platform and is provided for informational purposes only. Since all trades are virtual/simulated, there are no actual tax implications. This report should NOT be used for real tax filing. For actual investment tax reporting, consult a qualified tax professional. The platform uses virtual currency, and no real gains or losses are realized.
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Open print dialog for HTML content
 * @param {string} htmlContent - HTML document string
 */
export function openPrintView(htmlContent) {
  const printWindow = window.open('', '_blank');
  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Trigger print dialog after content loads
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };
}

/**
 * Generate current portfolio snapshot as printable HTML
 * @param {string} investorId - Investor identifier
 * @returns {string} HTML document string
 */
export function generatePortfolioSnapshot(snapshotData) {
  const snapshot = {
    investorId: snapshotData.investorId || '',
    snapshotDate: new Date().toLocaleDateString(),
    totalValue: snapshotData.totalValue || 0,
    totalCost: snapshotData.totalCost || 0,
    unrealizedGain: snapshotData.unrealizedGain || 0,
    gainPercent: snapshotData.gainPercent || 0,
    positions: snapshotData.positions || [],
    cash: snapshotData.cash || 0,
    invested: snapshotData.invested || 0,
  };

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Portfolio Snapshot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: white; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px; }
    .header { background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%); color: white; padding: 40px; margin: -40px -40px 40px -40px; border-bottom: 3px solid #00D4FF; }
    .header h1 { font-size: 32px; color: #00D4FF; margin-bottom: 10px; }
    .info { margin-bottom: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
    .stat { padding: 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #00D4FF; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 8px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #0a0a1a; }
    .stat-value.positive { color: #00FF00; }
    .section-title { font-size: 18px; font-weight: 700; color: #0a0a1a; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #00D4FF; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f0f0f0; padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #ddd; font-size: 12px; text-transform: uppercase; }
    td { padding: 10px 12px; border-bottom: 1px solid #eee; }
    .text-right { text-align: right; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PORTFOLIO SNAPSHOT</h1>
      <p>12 Tribes AI Investment Platform</p>
    </div>

    <div class="info">
      <strong>Investor ID:</strong> ${snapshot.investorId} | <strong>Date:</strong> ${snapshot.snapshotDate}
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Total Portfolio Value</div>
        <div class="stat-value">$${snapshot.totalValue.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Unrealized Gain</div>
        <div class="stat-value positive">+$${snapshot.unrealizedGain.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Gain Percentage</div>
        <div class="stat-value positive">+${snapshot.gainPercent}%</div>
      </div>
    </div>

    <div>
      <h2 class="section-title">Current Holdings</h2>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th class="text-right">Shares</th>
            <th class="text-right">Price</th>
            <th class="text-right">Value</th>
            <th class="text-right">Gain/Loss</th>
            <th class="text-right">%</th>
          </tr>
        </thead>
        <tbody>
          ${snapshot.positions.map(pos => `
            <tr>
              <td><strong>${pos.symbol}</strong></td>
              <td class="text-right">${pos.shares || '-'}</td>
              <td class="text-right">${pos.price ? '$' + pos.price.toFixed(2) : '-'}</td>
              <td class="text-right">$${pos.value.toLocaleString()}</td>
              <td class="text-right" style="color: ${pos.gain >= 0 ? '#00FF00' : '#FF0000'}">
                ${pos.gain >= 0 ? '+' : ''}$${pos.gain.toFixed(2)}
              </td>
              <td class="text-right" style="color: ${pos.gainPercent >= 0 ? '#00FF00' : '#FF0000'}">
                ${pos.gainPercent >= 0 ? '+' : ''}${pos.gainPercent.toFixed(1)}%
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
  `;

  return html;
}
